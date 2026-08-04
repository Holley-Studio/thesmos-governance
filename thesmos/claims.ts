// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Product claims registry and lint (WS6).
 *
 * ── What a clean run means ──────────────────────────────────────────────────
 * ONLY that public copy matches wording approved in claims-registry.json.
 * It is NOT FTC approval, NOT legal compliance, NOT an independent audit, and
 * NOT certification. The lint enforces a policy; it does not substantiate one.
 *
 * ── Why prohibited wording, not banned words ────────────────────────────────
 * "Every" and "zero" are not inherently false — "zero dependencies" can be
 * exactly true. What is unsubstantiable is an absolute PROMISE about behaviour
 * ("every output checked", "zero blockers reach production"). Rules therefore
 * match specific claim phrasings, and each carries the registry entry that
 * explains why it is prohibited and what to say instead.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type ClaimStatus = 'substantiated' | 'qualified' | 'pending' | 'prohibited';

export type ClaimCategory =
  | 'product_fact'
  | 'security'
  | 'performance'
  | 'cost'
  | 'compatibility'
  | 'compliance'
  | 'certification'
  | 'commercial';

export interface ClaimEvidence {
  type: 'test' | 'audit' | 'source' | 'external';
  location: string;
  verifiedAt: string;
}

export interface ProductClaim {
  id: string;
  claim: string;
  category: ClaimCategory;
  status: ClaimStatus;
  allowedWording?: string[];
  prohibitedWording?: string[];
  productScope: string[];
  versionScope?: string;
  evidence: ClaimEvidence[];
  owner: string;
  qualification?: string;
  expiresAt?: string;
}

export interface ClaimsRegistry {
  version: string;
  disclaimer: string;
  owner: string;
  claims: ProductClaim[];
  exceptions: { path: string; reason: string }[];
}

export function loadClaimsRegistry(pkgRoot: string): ClaimsRegistry {
  const path = join(pkgRoot, 'catalog', 'claims-registry.json');
  if (!existsSync(path)) {
    throw new Error(`Claims registry not found at ${path}. Claims cannot be validated without it.`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ClaimsRegistry;
  validateClaimsRegistry(parsed);
  return parsed;
}

/** Structural invariants. A registry that cannot fail is not a policy. */
export function validateClaimsRegistry(r: ClaimsRegistry): void {
  const errors: string[] = [];
  if (!Array.isArray(r.claims) || r.claims.length === 0) {
    errors.push('claims must be a non-empty array — an empty registry is a lint that can never fail');
  }
  if (!r.disclaimer?.trim()) errors.push('disclaimer is required (a clean lint is not certification)');

  const prohibitedTotal = (r.claims ?? []).reduce((n, c) => n + (c.prohibitedWording?.length ?? 0), 0);
  if (prohibitedTotal === 0) {
    errors.push('no prohibited wording declared anywhere — the lint would always pass');
  }

  const ids = new Set<string>();
  for (const c of r.claims ?? []) {
    if (ids.has(c.id)) errors.push(`duplicate claim id "${c.id}"`);
    ids.add(c.id);
    // A substantiated claim without evidence is just an assertion.
    if (c.status === 'substantiated' && (!c.evidence || c.evidence.length === 0)) {
      errors.push(`claim "${c.id}" is substantiated but carries no evidence`);
    }
    if (c.status === 'qualified' && !c.qualification?.trim()) {
      errors.push(`claim "${c.id}" is qualified but states no qualification`);
    }
    for (const e of c.evidence ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.verifiedAt)) {
        errors.push(`claim "${c.id}" evidence has a non-ISO verifiedAt "${e.verifiedAt}"`);
      }
    }
  }

  for (const e of r.exceptions ?? []) {
    if (!e.reason?.trim()) errors.push(`exception "${e.path}" has no reason`);
    if (e.path === '**' || e.path === '*' || e.path.endsWith('/**')) {
      errors.push(`exception "${e.path}" is a broad glob — exceptions must be path-scoped`);
    }
  }

  if (errors.length > 0) throw new Error(`Claims registry is invalid:\n  - ${errors.join('\n  - ')}`);
}

export interface ClaimFinding {
  claimId: string;
  status: ClaimStatus;
  file: string;
  line: number;
  excerpt: string;
  phrase: string;
  message: string;
  guidance: string;
}

/** Public surfaces where commercial claims appear. Allowlist, not denylist. */
export const CLAIM_SURFACES: readonly string[] = [
  'README.md',
  'thesmos/README.md',
  'extensions/vscode/README.md',
  'website/',
  'growth/',
  'thesmos/docs/',
  'pantheon/README.md',
  'pantheon/GUIDE.md',
];

export function isClaimExempt(rel: string, registry: ClaimsRegistry): boolean {
  const p = rel.replace(/\\/g, '/');
  return registry.exceptions.some((e) => p.includes(e.path));
}

export function lintClaimContent(
  content: string,
  rel: string,
  registry: ClaimsRegistry,
): ClaimFinding[] {
  const out: ClaimFinding[] = [];
  const lines = content.split('\n');
  for (const claim of registry.claims) {
    for (const phrase of claim.prohibitedWording ?? []) {
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (!re.test(lines[i]!)) continue;
        out.push({
          claimId: claim.id,
          status: claim.status,
          file: rel,
          line: i + 1,
          excerpt: lines[i]!.trim().slice(0, 160),
          phrase,
          message:
            claim.status === 'prohibited'
              ? `Prohibited claim (${claim.id}): "${phrase}".`
              : `Unapproved wording for ${claim.id}: "${phrase}".`,
          guidance:
            claim.qualification ??
            (claim.allowedWording?.length
              ? `Use approved wording: ${claim.allowedWording.map((w) => `"${w}"`).join(' or ')}.`
              : 'Remove the claim or add evidence to the claims registry.'),
        });
      }
    }
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(md|html|txt|json)$/.test(name)) out.push(full);
  }
  return out;
}

export interface ClaimsLintResult {
  findings: ClaimFinding[];
  filesScanned: number;
  errors: number;
  byStatus: Record<string, number>;
}

export function runClaimsLint(repoRoot: string, pkgRoot: string): ClaimsLintResult {
  const registry = loadClaimsRegistry(pkgRoot);
  const files = new Set<string>();
  for (const s of CLAIM_SURFACES) {
    const abs = join(repoRoot, s);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) for (const f of walk(abs)) files.add(relative(repoRoot, f));
    else files.add(s);
  }

  const findings: ClaimFinding[] = [];
  let filesScanned = 0;
  for (const rel of [...files].sort()) {
    if (isClaimExempt(rel, registry)) continue;
    filesScanned++;
    try {
      findings.push(...lintClaimContent(readFileSync(join(repoRoot, rel), 'utf8'), rel, registry));
    } catch {
      /* unreadable file */
    }
  }

  const byStatus: Record<string, number> = {};
  for (const c of registry.claims) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

  return { findings, filesScanned, errors: findings.length, byStatus };
}

export function formatClaimsLint(result: ClaimsLintResult, disclaimer: string): string {
  const lines: string[] = [];
  lines.push(`Claims lint — ${result.filesScanned} public-surface file(s) scanned`);
  if (result.findings.length === 0) {
    lines.push('No unapproved or prohibited claims detected.');
  } else {
    lines.push(`${result.errors} finding(s)`);
    lines.push('');
    for (const f of result.findings.slice(0, 100)) {
      lines.push(`${f.file}:${f.line}  [${f.status}] ${f.claimId} — "${f.phrase}"`);
      lines.push(`  ${f.message}`);
      lines.push(`  > ${f.excerpt}`);
      lines.push(`  fix: ${f.guidance}`);
      lines.push('');
    }
    if (result.findings.length > 100) lines.push(`… ${result.findings.length - 100} more`);
  }
  lines.push('');
  lines.push(disclaimer);
  return lines.join('\n');
}
