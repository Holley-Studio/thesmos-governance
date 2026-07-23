// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Write catalog/product-facts.json from live package + pantheon-map + rule registry.
 * Does not invent pricing or licensing — copies package.json license as-is.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveProductFacts } from '../product-facts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const facts = deriveProductFacts();
const artifact = {
  packageName: facts.packageName,
  version: facts.version,
  license: facts.license,
  ruleCount: facts.ruleCount,
  agentCount: facts.agentCount,
  generatedAt: facts.generatedAt ?? new Date().toISOString().slice(0, 10),
};

const out = join(root, 'catalog', 'product-facts.json');
writeFileSync(out, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
process.stdout.write(`Wrote ${out}\n`);
process.stdout.write(
  `  v${artifact.version} · ${artifact.ruleCount} rules · ${artifact.agentCount} agents · ${artifact.license}\n`,
);
