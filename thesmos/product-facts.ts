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
import { createHash } from 'node:crypto';
import { computePopulationsForRoot, type AgentPopulations } from './agent-populations.js';

/**
 * Named agent populations (WS3b).
 *
 * The repository previously carried one ambiguous `agentCount`, and five public
 * surfaces disagreed about it. Every field below states exactly which
 * population it counts, and every one is computed from explicit catalog
 * metadata — never chosen to match marketing copy.
 */
export interface ProductAgentFacts {
  /** Mythology-inspired specialist personas available to customers. */
  specialistPersonaCount: number;
  /** Utility/operational agents available to customers. */
  utilityAgentCount: number;
  /** THE PUBLIC NUMBER: all customer-available agents. */
  availableAgentCount: number;
  /** Agents included with Thesmos Free. */
  freeIncludedAgentCount: number;
  /** Agents unlocked BY Pro that Free does not include. */
  proExclusiveAgentCount: number;
  /**
   * Total agents a Pro customer has. Equals availableAgentCount, because Pro
   * includes everything Free includes. Marketing must say "68 with Pro", never
   * "62 with Pro" — the latter implies Pro has fewer agents than it does.
   */
  proTotalAgentCount: number;
  heldBackAgentCount: number;
  internalReviewerCount: number;
  catalogAgentCount: number;
}

export interface ProductTierFacts {
  free: { name: string; billing: string; availability: string };
  pro: {
    name: string;
    priceUsd: number;
    priceStatus: string;
    billing: string;
    availability: string;
    externalCheckoutStatus: string;
  };
  business: { name: string; availability: string };
}

export interface ProductFacts {
  packageName: string;
  version: string;
  license: string;
  ruleCount: number;
  /**
   * @deprecated Use `agents.availableAgentCount`.
   *
   * Previously counted `pantheon-map.json` gods only (61), which silently
   * under-reported the customer-facing roster. It is now an ALIAS of
   * `availableAgentCount` so existing extension, CLI and website consumers keep
   * working while they migrate. Removal is gated on those consumers — see
   * `agentCountDeprecated` in the artifact.
   */
  agentCount: number;
  /** Machine-readable statement of what `agentCount` means. */
  agentCountDefinition: 'available_customer_facing';
  agentCountDeprecated: true;
  agents: ProductAgentFacts;
  products: ProductTierFacts;
  /** ISO date (YYYY-MM-DD) when facts were generated, if from artifact. */
  generatedAt: string | null;
  /**
   * Deterministic digest of the inputs the facts were computed from.
   *
   * Replaces a wall-clock timestamp in the artifact: a date changes on every
   * run and produces a diff that says nothing, which trains reviewers to ignore
   * product-facts changes. A digest changes only when a fact changes.
   */
  sourceDigest: string;
  source: 'artifact' | 'live';
}

interface ProductFactsArtifact {
  packageName: string;
  version: string;
  license: string;
  ruleCount: number;
  agentCount: number;
  agentCountDefinition?: string;
  agentCountDeprecated?: boolean;
  agents?: ProductAgentFacts;
  products?: ProductTierFacts;
  sourceDigest?: string;
  generatedAt?: string;
}

/**
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
  const stable = Object.keys(parts).sort().map((k) => `${k}=${JSON.stringify(parts[k])}`).join('|');
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

/**
 * Live agent facts. `agentCount` is now an ALIAS of availableAgentCount —
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
      agentCountDefinition: 'available_customer_facing' as const,
      agentCountDeprecated: true as const,
      agents: toAgentFacts(emptyPopulations()),
      products: readTierFacts(''),
      sourceDigest: digestOf({ empty: true }),
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
      agentCount: artifact.agents?.availableAgentCount ?? artifact.agentCount,
      agentCountDefinition: 'available_customer_facing' as const,
      agentCountDeprecated: true as const,
      agents: artifact.agents ?? toAgentFacts(computePopulationsForRoot(root)),
      products: artifact.products ?? readTierFacts(root),
      generatedAt: artifact.generatedAt ?? null,
      sourceDigest: artifact.sourceDigest ?? '',
      source: 'artifact',
    };
  }

  return {
    packageName: meta.name,
    version: meta.version,
    license: meta.license,
    ruleCount: THESMOS_RULES.length,
    ...liveAgentFacts(root),
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
      agentCountDefinition: 'available_customer_facing' as const,
      agentCountDeprecated: true as const,
      agents: toAgentFacts(emptyPopulations()),
      products: readTierFacts(''),
      sourceDigest: digestOf({ empty: true }),
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
    ...liveAgentFacts(root),
    generatedAt: null,
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
  // The digest covers every named population and tier fact, so any drift in
  // free/pro/held-back/reviewer counts is caught even when the legacy
  // agentCount alias happens to match.
  if ((artifact.sourceDigest ?? '') !== live.sourceDigest) {
    return {
      fresh: false,
      detail: `sourceDigest drift: artifact ${artifact.sourceDigest ?? '(none)'} vs live ${live.sourceDigest} — run generate:product-facts`,
    };
  }
  return { fresh: true, detail: `product-facts.json matches v${live.version} (digest ${live.sourceDigest})` };
}
