// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Brand registry — typed loader and naming linter.
 *
 * One machine-readable statement of what this product is called, who owns it,
 * which names are provisional, and which are somebody else's.
 *
 * ── Why a linter and not a style guide ──────────────────────────────────────
 * Naming drift is not a taste problem. "Pantheon Pro" names a tier after a
 * company that sells governance software; "Nike" names an agent after one of
 * the most famous trademarks in the world. A document nobody greps cannot stop
 * either from reappearing in the next marketing page. A CI check can.
 *
 * ── What this is NOT ────────────────────────────────────────────────────────
 * This is not legal advice and not a trademark clearance. A clean lint means
 * the repository is internally consistent with the provisional naming decision
 * recorded in brand-registry.json — nothing more. `masterBrand.status` stays
 * `provisional_pending_legal_clearance` until an attorney says otherwise.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export type BrandClearanceStatus =
  | 'cleared'
  | 'provisional_pending_legal_clearance'
  | 'restricted'
  | 'prohibited_public'
  | 'out_of_scope';

export type NameClassification =
  | 'master_mark'
  | 'product_mark'
  | 'feature_name'
  | 'narrative_persona'
  | 'third_party_review_required';

export type TierStatus = 'available' | 'future_not_available';
export type PriceStatus = 'free' | 'verified' | 'unverified' | 'not_applicable';

export interface BrandLegal {
  owner: string;
  ownerRequired: boolean;
  prohibitedOwnerImplications: string[];
  trademarkSymbolsAllowed: boolean;
  trademarkSymbolNote: string;
}

export interface MasterBrand {
  name: string;
  status: BrandClearanceStatus;
  clearanceRisk: string;
  riskBasis: string;
  references: string[];
  meaning: string;
  prohibitedNarratives: string[];
  narrativeNote: string;
}

export interface ProductFamily {
  id: string;
  canonicalName: string;
  kind: NameClassification;
  status: string;
  legacyAliases?: string[];
  uiCopyAllowance?: string;
  description: string;
}

export interface Tier {
  id: string;
  canonicalName: string;
  status: TierStatus;
  priceStatus: PriceStatus;
  priceNote?: string;
  legacyAliases?: string[];
  marketingAllowed?: boolean;
  description: string;
  note?: string;
}

export interface DisplayRule {
  id: string;
  severity: 'error' | 'warn';
  pattern: string;
  isRegex?: boolean;
  message: string;
  appliesTo: 'public' | 'all';
  replacement: string | null;
}

export interface NameClassificationEntry {
  name: string;
  classification: NameClassification;
  status: string;
  action: string;
  basis?: string;
  reference?: string;
  note?: string;
  allowedUses?: string[];
  prohibitedUses?: string[];
  replacedBy?: string;
}

export interface ThirdParty {
  name: string;
  owner: string;
  relationship: 'compatible_with' | 'exports_for' | 'connects_to_when_configured';
  logoUseAuthorized: boolean;
}

export interface BrandRegistry {
  version: string;
  legal: BrandLegal;
  masterBrand: MasterBrand;
  productFamilies: ProductFamily[];
  tiers: Tier[];
  agentCollective: {
    formalName: string;
    shortNarrativeLabel: string;
    firstUseRule: string;
    prohibitedUses: string[];
    canonicalProductCategory: string;
    narrativeCategory: string;
    narrativeCategoryRule: string;
  };
  publicDisplayRules: DisplayRule[];
  nameClassifications: NameClassificationEntry[];
  thirdParties: ThirdParty[];
  thirdPartyLanguage: {
    allowedVerbs: string[];
    prohibitedVerbs: string[];
    nonAffiliationStatement: string;
    logoPolicy: string;
  };
}

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * Resolve the catalog directory from either the monorepo root or the thesmos
 * workspace directory. Both are real cwds depending on which npm script ran.
 */
export function resolveCatalogDir(root: string): string {
  const asMonorepo = join(root, 'thesmos', 'catalog');
  if (existsSync(asMonorepo)) return asMonorepo;
  return join(root, 'catalog');
}

let cached: BrandRegistry | null = null;

export function loadBrandRegistry(root: string): BrandRegistry {
  const path = join(resolveCatalogDir(root), 'brand-registry.json');
  if (!existsSync(path)) {
    throw new Error(`Brand registry not found at ${path}. It is required — naming cannot be validated without it.`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as BrandRegistry;
  validateBrandRegistry(parsed);
  cached = parsed;
  return parsed;
}

/** Cached accessor for repeated lint passes within one process. */
export function brandRegistry(root: string): BrandRegistry {
  return cached ?? loadBrandRegistry(root);
}

/**
 * Structural invariants that must hold for the registry to be usable.
 * These are the claims other code relies on, so they fail loudly rather than
 * degrading into a lint that silently checks nothing.
 */
export function validateBrandRegistry(r: BrandRegistry): void {
  const errors: string[] = [];

  if (r.legal?.owner !== 'Holley Studio LLC') {
    errors.push(`legal.owner must be "Holley Studio LLC", got "${r.legal?.owner}"`);
  }
  if (!r.masterBrand?.name) errors.push('masterBrand.name is required');
  if (r.masterBrand?.status !== 'provisional_pending_legal_clearance') {
    // Only an attorney decision may move this off provisional; a code change alone must not.
    errors.push(
      `masterBrand.status must remain "provisional_pending_legal_clearance" until a recorded attorney clearance exists (got "${r.masterBrand?.status}")`,
    );
  }
  if (!Array.isArray(r.publicDisplayRules) || r.publicDisplayRules.length === 0) {
    errors.push('publicDisplayRules must be a non-empty array — an empty rule set is a lint that checks nothing');
  }
  if (r.legal?.trademarkSymbolsAllowed !== false) {
    errors.push('legal.trademarkSymbolsAllowed must be false during Phase 0');
  }

  const tierNames = new Set<string>();
  for (const t of r.tiers ?? []) {
    if (tierNames.has(t.canonicalName)) errors.push(`duplicate tier name "${t.canonicalName}"`);
    tierNames.add(t.canonicalName);
    if (t.status === 'future_not_available' && t.marketingAllowed !== false) {
      errors.push(`tier "${t.canonicalName}" is future_not_available but marketingAllowed is not false`);
    }
  }

  for (const rule of r.publicDisplayRules ?? []) {
    if (rule.isRegex) {
      try {
        new RegExp(rule.pattern);
      } catch {
        errors.push(`publicDisplayRules["${rule.id}"] has an invalid regex: ${rule.pattern}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Brand registry is invalid:\n  - ${errors.join('\n  - ')}`);
  }
}

// ── Naming lint ──────────────────────────────────────────────────────────────

export interface NamingFinding {
  ruleId: string;
  severity: 'error' | 'warn';
  file: string;
  line: number;
  column: number;
  excerpt: string;
  message: string;
  replacement: string | null;
}

/**
 * Files whose naming is PUBLIC-FACING. Deliberately an allowlist rather than a
 * denylist: an audit that silently stops covering new directories is worse than
 * one that reports nothing.
 */
export const PUBLIC_SURFACE_GLOBS: readonly string[] = [
  'README.md',
  'thesmos/README.md',
  'website/',
  'growth/',
  'extensions/vscode/README.md',
  'thesmos/catalog/agents/',
  'thesmos/catalog/skills/',
  'thesmos/docs/',
];

/**
 * Paths exempt from the public naming rules, with the reason each is exempt.
 *
 * Historical records must keep their original wording — rewriting a changelog
 * to match current branding falsifies the record. Compatibility identifiers and
 * CLI namespaces must keep legacy names or installed agents break. And this
 * module plus the registry necessarily contain the very strings they forbid.
 */
export const NAMING_EXEMPT: readonly { pattern: string; reason: string }[] = [
  { pattern: 'CHANGELOG.md', reason: 'historical record — rewriting it falsifies release history' },
  { pattern: 'docs/audits/', reason: 'audit records quote the strings they report' },
  { pattern: 'docs/legal/', reason: 'legal specs quote the marks under review' },
  { pattern: 'docs/plans/', reason: 'historical plans' },
  { pattern: 'docs/superpowers/', reason: 'historical plans and specs' },
  { pattern: 'brand-registry.json', reason: 'the registry defines the forbidden strings' },
  { pattern: 'brand.ts', reason: 'the linter necessarily contains the patterns' },
  { pattern: 'brand.test.ts', reason: 'tests assert on the patterns' },
  { pattern: 'migrations.json', reason: 'legacy alias map must retain legacy names' },
  { pattern: 'node_modules/', reason: 'third-party code' },
  { pattern: '/dist/', reason: 'build output — fix the source' },
  { pattern: 'pantheon/exports/', reason: 'generated — fix the catalog and regenerate' },
  { pattern: '/generated/', reason: 'generated — fix the source and regenerate' },
];

export function isExempt(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  return NAMING_EXEMPT.some((e) => p.includes(e.pattern));
}

export function isPublicSurface(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  return PUBLIC_SURFACE_GLOBS.some((g) => (g.endsWith('/') ? p.startsWith(g) : p === g));
}

/** Lint one file's content against the registry's public display rules. */
export function lintContent(
  content: string,
  relPath: string,
  registry: BrandRegistry,
): NamingFinding[] {
  const findings: NamingFinding[] = [];
  const lines = content.split('\n');

  for (const rule of registry.publicDisplayRules) {
    const re = rule.isRegex
      ? new RegExp(rule.pattern, 'g')
      : new RegExp(rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        // "Thesmos Pantheon" is the sanctioned first-use form, so a bare
        // "Pantheon" rule must not fire on it.
        if (rule.id === 'no-full-pantheon' && line.includes('Full Thesmos Pantheon')) break;
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file: relPath,
          line: i + 1,
          column: m.index + 1,
          // Centre the excerpt on the match. Showing the start of the line
          // makes any match past ~160 chars look like a false positive, which
          // is how a real finding gets dismissed.
          excerpt: excerptAround(line, m.index, m[0].length),
          message: rule.message,
          replacement: rule.replacement,
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
  return findings;
}

/** Excerpt centred on a match, so a hit past column 160 is still visible. */
export function excerptAround(line: string, index: number, length: number, width = 140): string {
  const trimmedStart = line.length - line.trimStart().length;
  if (line.trim().length <= width) return line.trim();
  const half = Math.floor((width - length) / 2);
  const start = Math.max(trimmedStart, index - half);
  const end = Math.min(line.length, index + length + half);
  const prefix = start > trimmedStart ? '…' : '';
  const suffix = end < line.length ? '…' : '';
  return `${prefix}${line.slice(start, end).trim()}${suffix}`;
}

function walk(dir: string, root: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, root, out);
    else if (/\.(md|mdc|txt|json|ts|tsx|js|html)$/.test(name)) out.push(relative(root, full));
  }
  return out;
}

export interface NamingLintResult {
  findings: NamingFinding[];
  filesScanned: number;
  errors: number;
  warnings: number;
}

/** Run the naming lint across public surfaces. The only I/O entry point. */
export function runNamingLint(root: string): NamingLintResult {
  const registry = loadBrandRegistry(root);

  const candidates = new Set<string>();
  for (const g of PUBLIC_SURFACE_GLOBS) {
    const abs = join(root, g);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) for (const f of walk(abs, root)) candidates.add(f);
    else candidates.add(g);
  }

  const findings: NamingFinding[] = [];
  let filesScanned = 0;
  for (const rel of [...candidates].sort()) {
    if (isExempt(rel)) continue;
    filesScanned++;
    let content: string;
    try {
      content = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    findings.push(...lintContent(content, rel, registry));
  }

  return {
    findings,
    filesScanned,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
  };
}

export function formatNamingLintConsole(result: NamingLintResult): string {
  const lines: string[] = [];
  lines.push(`Naming lint — ${result.filesScanned} public-surface file(s) scanned`);
  if (result.findings.length === 0) {
    lines.push('No naming violations found.');
    lines.push('');
    lines.push('Note: a clean lint means internal consistency with the provisional naming');
    lines.push('decision. It is NOT a trademark clearance.');
    return lines.join('\n');
  }
  lines.push(`${result.errors} error(s), ${result.warnings} warning(s)`);
  lines.push('');
  for (const f of result.findings) {
    lines.push(`${f.file}:${f.line}:${f.column}  [${f.severity}] ${f.ruleId}`);
    lines.push(`  ${f.message}`);
    lines.push(`  > ${f.excerpt}`);
    if (f.replacement) lines.push(`  fix: use "${f.replacement}"`);
    lines.push('');
  }
  return lines.join('\n');
}
