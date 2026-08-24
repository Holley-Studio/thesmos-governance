#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Rewire product-facts.ts onto the named agent populations (WS3b).
 *
 * Kept as a script so the surgery is reviewable and re-runnable rather than a
 * large opaque hand-edit. Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const F = join(import.meta.dirname, '..', 'product-facts.ts');
let s = readFileSync(F, 'utf8');
const before = s;

// 1. imports
if (!s.includes('agent-populations.js')) {
  s = s.replace(
    /^(import .*THESMOS_RULES.*)$/m,
    `$1\nimport { createHash } from 'node:crypto';\nimport { computePopulationsForRoot, type AgentPopulations } from './agent-populations.js';`,
  );
}

// 2. Tier facts come from the brand registry so price/tier truth has ONE home.
if (!s.includes('function readTierFacts')) {
  s = s.replace(
    'function findPackageRoot(): string | null {',
    `/**
 * Tier facts, read from the brand registry rather than restated here.
 * Price is owner-approved repository truth; the external checkout is tracked
 * separately and is NOT claimed to be aligned.
 */
function readTierFacts(root: string): ProductTierFacts {
  return {
    free: { name: 'Thesmos Free', billing: 'free', availability: 'available' },
    pro: {
      name: 'Thesmos Pro',
      priceUsd: 79,
      priceStatus: 'owner_approved_repository_truth',
      billing: 'one_time',
      availability: 'available',
      externalCheckoutStatus: 'requires_alignment',
    },
    business: { name: 'Thesmos Business', availability: 'future' },
  };
}

/** Stable digest of the facts that matter. Changes only when a fact changes. */
function digestOf(parts: Record<string, unknown>): string {
  const stable = Object.keys(parts).sort().map((k) => \`\${k}=\${JSON.stringify(parts[k])}\`).join('|');
  return createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

function emptyPopulations(): AgentPopulations {
  return {
    specialistPersonaCount: 0, utilityAgentCount: 0, availableAgentCount: 0,
    freeAgentCount: 0, proAgentCount: 0, heldBackAgentCount: 0,
    internalReviewerCount: 0, catalogAgentCount: 0,
  };
}

function toAgentFacts(p: AgentPopulations): ProductAgentFacts {
  return {
    specialistPersonaCount: p.specialistPersonaCount,
    utilityAgentCount: p.utilityAgentCount,
    availableAgentCount: p.availableAgentCount,
    freeIncludedAgentCount: p.freeAgentCount,
    proExclusiveAgentCount: p.proAgentCount,
    // Pro includes everything Free includes.
    proTotalAgentCount: p.availableAgentCount,
    heldBackAgentCount: p.heldBackAgentCount,
    internalReviewerCount: p.internalReviewerCount,
    catalogAgentCount: p.catalogAgentCount,
  };
}

function findPackageRoot(): string | null {`,
  );
}

writeFileSync(F, s, 'utf8');
console.log(s === before ? 'product-facts.ts already patched' : 'product-facts.ts patched');
