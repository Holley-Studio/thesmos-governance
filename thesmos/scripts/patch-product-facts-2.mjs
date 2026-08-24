#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** Rewire the three ProductFacts constructors onto named populations. Idempotent. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const F = join(import.meta.dirname, '..', 'product-facts.ts');
let s = readFileSync(F, 'utf8');
const before = s;

const EMPTY = `      packageName: 'thesmos-governance',
      version: '0.0.0',
      license: 'UNLICENSED',
      ruleCount: THESMOS_RULES.length,
      agentCount: 0,`;
const EMPTY_NEW = `      packageName: 'thesmos-governance',
      version: '0.0.0',
      license: 'UNLICENSED',
      ruleCount: THESMOS_RULES.length,
      agentCount: 0,
      agentCountDefinition: 'available_customer_facing' as const,
      agentCountDeprecated: true as const,
      agents: toAgentFacts(emptyPopulations()),
      products: readTierFacts(''),
      sourceDigest: digestOf({ empty: true }),`;
s = s.split(EMPTY).join(EMPTY_NEW);

// artifact branch
s = s.replace(
  `      ruleCount: artifact.ruleCount,
      agentCount: artifact.agentCount,
      generatedAt: artifact.generatedAt,
      source: 'artifact',`,
  `      ruleCount: artifact.ruleCount,
      agentCount: artifact.agents?.availableAgentCount ?? artifact.agentCount,
      agentCountDefinition: 'available_customer_facing' as const,
      agentCountDeprecated: true as const,
      agents: artifact.agents ?? toAgentFacts(computePopulationsForRoot(root)),
      products: artifact.products ?? readTierFacts(root),
      generatedAt: artifact.generatedAt ?? null,
      sourceDigest: artifact.sourceDigest ?? '',
      source: 'artifact',`,
);

// live branches — agentCount is now the customer-available total, not gods-only.
s = s.split(`    ruleCount: THESMOS_RULES.length,
    agentCount: countAgentsFromMap(root),
    generatedAt: null,
    source: 'live',`).join(`    ruleCount: THESMOS_RULES.length,
    ...liveAgentFacts(root),
    generatedAt: null,
    source: 'live',`);

s = s.split(`    ruleCount: THESMOS_RULES.length,
    agentCount: countAgentsFromMap(root),
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'live',`).join(`    ruleCount: THESMOS_RULES.length,
    ...liveAgentFacts(root),
    generatedAt: null,
    source: 'live',`);

// helper
if (!s.includes('function liveAgentFacts')) {
  s = s.replace(
    'function loadArtifact(root: string)',
    `/**
 * Live agent facts. \`agentCount\` is now an ALIAS of availableAgentCount —
 * the gods-only semantics it used to carry under-reported the roster by 12%.
 */
function liveAgentFacts(root: string) {
  const agents = toAgentFacts(computePopulationsForRoot(root));
  const products = readTierFacts(root);
  return {
    agentCount: agents.availableAgentCount,
    agentCountDefinition: 'available_customer_facing' as const,
    agentCountDeprecated: true as const,
    agents,
    products,
    sourceDigest: digestOf({ agents, products, rules: THESMOS_RULES.length }),
  };
}

function loadArtifact(root: string)`,
  );
}

writeFileSync(F, s, 'utf8');
console.log(s === before ? 'no change' : 'constructors rewired');
