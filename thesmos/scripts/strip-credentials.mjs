#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Fabricated-credential sweep (WS7).
 *
 * Rewrites the dominant résumé patterns in agent personas into methodology
 * framing. Anything it cannot rewrite confidently is REPORTED, never silently
 * mangled — a garbled persona is worse than a flagged one.
 *
 * Usage: node scripts/strip-credentials.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const PKG_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(PKG_ROOT, '..');
const DRY = process.argv.includes('--dry-run');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Ordered rewrites. Each removes a fabricated claim while keeping the sentence
 * grammatical and the domain intact.
 */
const REWRITES = [
  // "with 20+ years of operating experience across startups, scale-ups and X."
  [/\s*with\s+\d+\+?\s*years?\s+of\s+[^.]*?experience[^.]*?\./gi, '.'],
  // "— a pipeline builder with 10+ years running outbound motions for B2B SaaS."
  [/\s*with\s+\d+\+?\s*years?\s+[^.]*?\./gi, '.'],
  // "You have 15+ years maintaining large codebases through team turnover."
  [/\bYou have\s+\d+\+?\s*years?\s+[^.]*?\./gi, ''],
  // Bare "20+ years of experience" fragments.
  [/\b\d+\+?\s*years?\s+of\s+(?:hands-on\s+)?experience\b/gi, 'domain methodology'],
  // Standalone tenure phrases inside a clause.
  [/\b\d+\+?\s*years?\s+(?:of\s+)?(?:running|building|leading|shipping|working)\b/gi, 'methodology for'],
  // Fabricated outcomes.
  [/,?\s*(?:and\s+)?(?:generated|delivered|drove|grew|grown|reduced|increased|improved|saved|closed)\s+[^.\n]{0,70}?\b\d[\d,]*\+?\s*(?:%|percent|leads|customers|users|followers|deals|hours)\b[^.\n]*\./gi, '.'],
  [/\bFortune\s*(?:100|500)\b\s*/gi, ''],
];

const targets = [
  ...walk(join(PKG_ROOT, 'catalog', 'agents')),
  ...walk(join(REPO_ROOT, 'pantheon-plugin', 'agents')),
];

let changed = 0;
const residual = [];
const YEARS = /\b\d+\+?\s*years?\b(?![^\n]{0,20}\b(ago|old|warranty|retention)\b)/i;

for (const full of targets) {
  const rel = relative(REPO_ROOT, full).replace(/\\/g, '/');
  if (rel.endsWith('AGENT_QUALITY_STANDARD.md')) continue;
  const src = readFileSync(full, 'utf8');
  let out = src;
  for (const [pat, sub] of REWRITES) out = out.replace(pat, sub);

  // Tidy ONLY when a rewrite actually fired, and only on the lines it touched.
  // A blanket whitespace collapse would reformat markdown tables and indented
  // code blocks in every file — a 238-file diff to fix 46 sentences.
  if (out !== src) {
    out = out
      .split('\n')
      .map((line, i) => {
        const before = src.split('\n')[i];
        if (line === before) return line;
        return line.replace(/ {2,}/g, ' ').replace(/\s+\./g, '.').replace(/,\s*\./g, '.').trimEnd();
      })
      .join('\n');
  }

  if (out !== src) {
    if (!DRY) writeFileSync(full, out, 'utf8');
    changed++;
  }
  for (const [i, line] of out.split('\n').entries()) {
    if (YEARS.test(line)) residual.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
  }
}

console.log(`${DRY ? '[dry-run] ' : ''}${changed} file(s) rewritten of ${targets.length} scanned`);
if (residual.length) {
  console.log(`\n${residual.length} residual tenure match(es) needing manual review:`);
  for (const r of residual.slice(0, 40)) console.log('  ' + r);
  if (residual.length > 40) console.log(`  … ${residual.length - 40} more`);
} else {
  console.log('No residual tenure claims.');
}
