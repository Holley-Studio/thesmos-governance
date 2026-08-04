// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Product-facts lint (WS3b).
 *
 * Detects hard-coded product counts, prices, tier names and versions on public
 * surfaces that contradict — or merely restate — the canonical facts.
 *
 * A restated fact is still a defect: it is a copy that will drift. The lint
 * reports the observed value, the expected fact, and the canonical source, so
 * the fix is always "read the fact" rather than "edit the number".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductFacts } from './product-facts.js';
import { type CoverageExclusion } from './lint-coverage.js';

export interface ProductFactFinding {
  file: string;
  line: number;
  observed: string;
  expected: string;
  fact: string;
  canonicalSource: string;
  excerpt: string;
}

/** Public surfaces where product facts appear. */
export const FACT_SURFACES: readonly string[] = [
  'README.md',
  'thesmos/README.md',
  'extensions/vscode/README.md',
  'website/',
  'growth/',
  'pantheon/README.md',
  'pantheon/GUIDE.md',
];

export const FACT_EXCLUSIONS: readonly CoverageExclusion[] = [
  { path: 'CHANGELOG.md', reason: 'historical release record — rewriting it falsifies history' },
  { path: 'docs/audits/', reason: 'audits quote the values they report' },
  { path: 'docs/adr/', reason: 'decision records quote the decision under review' },
  { path: 'docs/legal/', reason: 'legal specs quote figures under review' },
  { path: 'docs/release/', reason: 'release blockers quote the conflicting external value' },
  { path: 'website/downloads/', reason: 'archived download copy, not a live surface' },
];

/**
 * Stale values that must never appear again, each mapped to the canonical fact
 * that replaces it. Generated from the facts so the list cannot drift from
 * them.
 */
export function staleValueRules(facts: ProductFacts): {
  pattern: RegExp;
  observedLabel: string;
  expected: string;
  fact: string;
}[] {
  const a = facts.agents;
  return [
    { pattern: /\$24\b/g, observedLabel: '$24', expected: `$${facts.products.pro.priceUsd}`, fact: 'products.pro.priceUsd' },
    { pattern: /(?<!\d)(?:67|43|40|21|59|61)\s+(?:Thesmos\s+)?(?:God\s+)?[Aa]gents\b/g, observedLabel: 'stale agent count', expected: `${a.availableAgentCount} Thesmos Agents`, fact: 'agents.availableAgentCount' },
    { pattern: /\b62\s+agents\s+with\s+Pro\b/gi, observedLabel: '62 agents with Pro', expected: `${a.proTotalAgentCount} agents with Pro`, fact: 'agents.proTotalAgentCount' },
    { pattern: /\blifetime updates\b/gi, observedLabel: 'lifetime updates', expected: 'updates as described in the commercial terms', fact: 'commercial terms (undefined — see docs/legal)' },
  ];
}

export function lintFactContent(
  content: string,
  rel: string,
  facts: ProductFacts,
): ProductFactFinding[] {
  const out: ProductFactFinding[] = [];
  const lines = content.split('\n');
  for (const rule of staleValueRules(facts)) {
    for (let i = 0; i < lines.length; i++) {
      rule.pattern.lastIndex = 0;
      const m = rule.pattern.exec(lines[i]!);
      if (!m) continue;
      out.push({
        file: rel,
        line: i + 1,
        observed: m[0],
        expected: rule.expected,
        fact: rule.fact,
        canonicalSource: 'thesmos/catalog/product-facts.json',
        excerpt: lines[i]!.trim().slice(0, 140),
      });
    }
  }
  return out;
}

export function formatFactFindings(findings: readonly ProductFactFinding[]): string {
  if (findings.length === 0) return 'No unsupported hard-coded product facts detected.';
  const lines: string[] = [`${findings.length} finding(s)`, ''];
  for (const f of findings.slice(0, 100)) {
    lines.push(`${f.file}:${f.line}`);
    lines.push(`  observed : ${f.observed}`);
    lines.push(`  expected : ${f.expected}`);
    lines.push(`  fact     : ${f.fact}  (canonical: ${f.canonicalSource})`);
    lines.push(`  > ${f.excerpt}`);
    lines.push('');
  }
  if (findings.length > 100) lines.push(`… ${findings.length - 100} more`);
  return lines.join('\n');
}

/** Read a repo-relative file, returning null when unreadable. */
export function readSafe(repoRoot: string, rel: string): string | null {
  try {
    return readFileSync(join(repoRoot, rel), 'utf8');
  } catch {
    return null;
  }
}
