#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** Wire complexity assessment + Fable score gate into routing.ts. Idempotent. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const F = join(import.meta.dirname, '..', 'models', 'routing.ts');
let s = readFileSync(F, 'utf8');
const before = s;

// imports
if (!s.includes('./complexity.js')) {
  s = s.replace(
    "} from './registry.js';",
    `} from './registry.js';
import {
  type ComplexityAssessment,
  type ComplexityBand,
  type CostTier,
  FABLE_MIN_COMPLEXITY_SCORE,
  assessComplexity,
  costTierFor,
} from './complexity.js';`,
  );
}

// new reason codes
if (!s.includes("'frontier-denied-below-threshold'")) {
  s = s.replace(
    "  | 'frontier-denied-no-approval'",
    `  | 'frontier-denied-below-threshold'
  | 'frontier-denied-no-exceptional-reason'
  | 'frontier-denied-unmapped-provider'
  | 'frontier-denied-no-approval'`,
  );
}

// selectProfile: harden the frontier gate with the score + evidence rubric
if (!s.includes('FABLE_MIN_COMPLEXITY_SCORE')) {
  s = s.replace(
    `  if (s.userOverride === 'frontier-long-horizon') {
    if (!isLongHorizon(s)) {`,
    `  if (s.userOverride === 'frontier-long-horizon') {
    const assessment = assessComplexity(s);

    // Gate 1 — score threshold. Length alone is capped below this by rubric.
    if (assessment.score < FABLE_MIN_COMPLEXITY_SCORE) {
      return {
        profile: 'deep-reasoning',
        reasonCodes: ['user-override', 'frontier-denied-below-threshold'],
        approval: 'required-but-missing',
      };
    }
    // Gate 2 — an exceptional reason that is NOT task length.
    if (!assessment.hasExceptionalReasonBeyondLength) {
      return {
        profile: 'deep-reasoning',
        reasonCodes: ['user-override', 'frontier-denied-no-exceptional-reason'],
        approval: 'required-but-missing',
      };
    }
    // Gate 3 — a verified provider mapping must exist.
    if (!resolveProfile('frontier-long-horizon', 'anthropic')) {
      return {
        profile: 'deep-reasoning',
        reasonCodes: ['user-override', 'frontier-denied-unmapped-provider'],
        approval: 'required-but-missing',
      };
    }
    if (!isLongHorizon(s)) {`,
  );
}

// routeModel: attach evidence fields
if (!s.includes('const assessment = assessComplexity(signals)')) {
  s = s.replace(
    '  const selection = selectProfile(signals);',
    `  const assessment: ComplexityAssessment = assessComplexity(signals);
  const selection = selectProfile(signals);`,
  );
}

if (!s.includes('complexityScore:')) {
  s = s.replace(
    `  return {
    requestedProfile: selection.profile,
    resolvedProvider: entry.provider,`,
    `  return {
    requestedProfile: selection.profile,
    selectedAlias: profile,
    complexityScore: assessment.score,
    complexityBand: assessment.band,
    costTier: costTierFor(profile),
    escalated: profileRank(selection.profile) > profileRank('balanced-agentic'),
    // Only true when an availability fallback actually fired — never inferred.
    fallbackUsed: fallback !== null,
    approvalRequired: selection.approval !== 'not-required',
    resolvedProvider: entry.provider,`,
  );
}

writeFileSync(F, s, 'utf8');
console.log(s === before ? 'routing.ts already patched' : 'routing.ts patched');
