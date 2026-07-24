// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * ProductFacts — single derived fact sheet for version / rule / agent counts.
 *
 * Prefer the generated catalog/product-facts.json when present; otherwise
 * derive live from package.json + pantheon-map + rule registry. Never invent
 * marketing numbers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THESMOS_RULES } from './rules/registry.js';

export interface ProductFacts {
  packageName: string;
  version: string;
  license: string;
  ruleCount: number;
  /** Canonical Pantheon god count from pantheon-map.json. */
  agentCount: number;
  /** ISO date (YYYY-MM-DD) when facts were generated, if from artifact. */
  generatedAt: string | null;
  source: 'artifact' | 'live';
}

interface ProductFactsArtifact {
  packageName: string;
  version: string;
  license: string;
  ruleCount: number;
  agentCount: number;
  generatedAt: string;
}

function findPackageRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name === 'thesmos-governance') return dir;
      } catch {
        /* continue walking */
      }
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPackageMeta(root: string): { name: string; version: string; license: string } {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name?: string;
    version?: string;
    license?: string;
  };
  return {
    name: pkg.name ?? 'thesmos-governance',
    version: pkg.version ?? '0.0.0',
    license: pkg.license ?? 'UNLICENSED',
  };
}

function countAgentsFromMap(root: string): number {
  const mapPath = join(root, 'catalog', 'pantheon-map.json');
  if (!existsSync(mapPath)) return 0;
  try {
    const map = JSON.parse(readFileSync(mapPath, 'utf8')) as { gods?: Record<string, unknown> };
    return map.gods ? Object.keys(map.gods).length : 0;
  } catch {
    return 0;
  }
}

function loadArtifact(root: string): ProductFactsArtifact | null {
  const path = join(root, 'catalog', 'product-facts.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProductFactsArtifact;
  } catch {
    return null;
  }
}

/**
 * Load product facts. Uses catalog/product-facts.json when present and its
 * version matches package.json; otherwise derives live counts.
 */
export function loadProductFacts(): ProductFacts {
  const root = findPackageRoot();
  if (!root) {
    return {
      packageName: 'thesmos-governance',
      version: '0.0.0',
      license: 'UNLICENSED',
      ruleCount: THESMOS_RULES.length,
      agentCount: 0,
      generatedAt: null,
      source: 'live',
    };
  }

  const meta = readPackageMeta(root);
  const artifact = loadArtifact(root);

  if (artifact && artifact.version === meta.version) {
    return {
      packageName: artifact.packageName || meta.name,
      version: artifact.version,
      license: artifact.license || meta.license,
      ruleCount: artifact.ruleCount,
      agentCount: artifact.agentCount,
      generatedAt: artifact.generatedAt,
      source: 'artifact',
    };
  }

  return {
    packageName: meta.name,
    version: meta.version,
    license: meta.license,
    ruleCount: THESMOS_RULES.length,
    agentCount: countAgentsFromMap(root),
    generatedAt: null,
    source: 'live',
  };
}

/** Build a facts object from live sources (for generators / CI checks). */
export function deriveProductFacts(): ProductFacts {
  const root = findPackageRoot();
  if (!root) {
    return {
      packageName: 'thesmos-governance',
      version: '0.0.0',
      license: 'UNLICENSED',
      ruleCount: THESMOS_RULES.length,
      agentCount: 0,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: 'live',
    };
  }
  const meta = readPackageMeta(root);
  return {
    packageName: meta.name,
    version: meta.version,
    license: meta.license,
    ruleCount: THESMOS_RULES.length,
    agentCount: countAgentsFromMap(root),
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'live',
  };
}

/**
 * Returns true when the committed artifact matches live package version and
 * rule/agent counts (within expected drift tolerance of exact match).
 */
export function productFactsAreFresh(): { fresh: boolean; detail: string } {
  const root = findPackageRoot();
  if (!root) return { fresh: false, detail: 'package root not found' };
  const live = deriveProductFacts();
  const artifact = loadArtifact(root);
  if (!artifact) {
    return { fresh: false, detail: 'catalog/product-facts.json missing — run generate:product-facts' };
  }
  if (artifact.version !== live.version) {
    return {
      fresh: false,
      detail: `version drift: artifact ${artifact.version} vs package ${live.version}`,
    };
  }
  if (artifact.ruleCount !== live.ruleCount) {
    return {
      fresh: false,
      detail: `ruleCount drift: artifact ${artifact.ruleCount} vs live ${live.ruleCount}`,
    };
  }
  if (artifact.agentCount !== live.agentCount) {
    return {
      fresh: false,
      detail: `agentCount drift: artifact ${artifact.agentCount} vs live ${live.agentCount}`,
    };
  }
  return { fresh: true, detail: `product-facts.json matches v${live.version}` };
}
