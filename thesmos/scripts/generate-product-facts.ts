// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Write catalog/product-facts.json from live package + catalog + rule registry.
 *
 * Deterministic by construction: the artifact carries a `sourceDigest` of the
 * facts rather than a wall-clock `generatedAt`. Two runs against the same
 * commit produce byte-identical output, so a product-facts diff always means a
 * fact actually changed — which is what makes the drift check worth gating on.
 *
 * Invents nothing: counts are computed, the licence is copied from
 * package.json as-is, and the price is owner-approved repository truth
 * (docs/adr/2026-08-04-thesmos-pro-pricing.md).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveProductFacts } from '../product-facts.js';
import { computePopulationsForRoot, checkPopulationInvariants } from '../agent-populations.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fail loudly on an incoherent population set rather than writing numbers that
// cannot all be true at once.
const problems = checkPopulationInvariants(computePopulationsForRoot(root));
if (problems.length > 0) {
  process.stderr.write(`product-facts: population invariants violated:\n  - ${problems.join('\n  - ')}\n`);
  process.exit(1);
}

const facts = deriveProductFacts();

const artifact = {
  packageName: facts.packageName,
  version: facts.version,
  license: facts.license,
  ruleCount: facts.ruleCount,
  // Deprecated alias, retained so existing consumers keep working.
  agentCount: facts.agentCount,
  agentCountDefinition: facts.agentCountDefinition,
  agentCountDeprecated: facts.agentCountDeprecated,
  agents: facts.agents,
  products: facts.products,
  sourceDigest: facts.sourceDigest,
};

const out = join(root, 'catalog', 'product-facts.json');
writeFileSync(out, JSON.stringify(artifact, null, 2) + '\n', 'utf8');

const a = artifact.agents;
process.stdout.write(`Wrote ${out}\n`);
process.stdout.write(
  `  v${artifact.version} · ${artifact.ruleCount} rules · ${a.availableAgentCount} available agents · ${artifact.license}\n`,
);
process.stdout.write(
  `  free ${a.freeIncludedAgentCount} · pro-exclusive ${a.proExclusiveAgentCount} · pro-total ${a.proTotalAgentCount} · held back ${a.heldBackAgentCount} · reviewers ${a.internalReviewerCount} · catalog ${a.catalogAgentCount}\n`,
);
process.stdout.write(`  digest ${artifact.sourceDigest}\n`);
