#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Public-claims sweep (WS6).
 *
 * Applies the owner-approved commercial decision ($79 one-time) and replaces
 * prohibited absolute claims with the approved wording from the claims
 * registry. Anything it cannot rewrite confidently is left for the lint to
 * report rather than mangled.
 *
 * Usage: node scripts/sweep-claims.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const PKG_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(PKG_ROOT, '..');
const DRY = process.argv.includes('--dry-run');

const SURFACES = ['README.md', 'thesmos/README.md', 'extensions/vscode/README.md',
                  'website', 'growth', 'thesmos/docs', 'pantheon/README.md', 'pantheon/GUIDE.md'];
const SKIP = ['CHANGELOG', 'docs/audits/', 'docs/legal/', 'docs/adr/', 'claims-registry.json', 'claims.ts', 'node_modules', '/dist/'];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const full = join(dir, n);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(md|html|txt|json)$/.test(n)) out.push(full);
  }
  return out;
}

const REWRITES = [
  // Owner-approved commercial truth: $79 one-time.
  [/\$24\b/g, '$79'],
  [/\b24 USD\b/g, '79 USD'],
  // Prohibited: an updates promise the commercial terms do not yet define.
  [/\blifetime updates\b/gi, 'updates as described in the commercial terms'],
  [/\bno renewal ever\b/gi, 'one-time purchase'],
  // Prohibited: the current release is source-available, not open source.
  [/\bopen source\b/gi, 'source-available'],
  [/\bopen-source\b/gi, 'source-available'],
  // Prohibited: no third-party audit or certification exists.
  [/\bsecurity-audited\b/gi, 'internally reviewed'],
  [/\bSOC 2\b/g, 'documented internal controls'],
  [/\bISO 27001\b/g, 'documented internal controls'],
  [/\bcertified\b/gi, 'verified by Thesmos'],
  // Prohibited absolutes.
  [/\bworld-class\b/gi, 'specialist'],
  [/\bcheapest model that gets it right\b/gi, 'a model tier matched to task depth'],
  // Third-party language.
  [/\bPowered by\b/g, 'Compatible with'],
  [/\bOfficial\b/g, 'Compatible'],
  // Derived count.
  [/\b67 agents\b/g, '68 Thesmos Agents'],
  [/\b67 God Agents\b/g, '68 Thesmos Agents'],
  [/\b21 agents\b/g, '68 Thesmos Agents'],
  [/\b21 governed AI business agents\b/gi, '68 Thesmos Agents'],
];

const files = new Set();
for (const s of SURFACES) {
  const abs = join(REPO_ROOT, s);
  if (!existsSync(abs)) continue;
  if (statSync(abs).isDirectory()) for (const f of walk(abs)) files.add(f);
  else files.add(abs);
}

let changed = 0;
for (const full of files) {
  const rel = relative(REPO_ROOT, full).replace(/\\/g, '/');
  if (SKIP.some((s) => rel.includes(s))) continue;
  const src = readFileSync(full, 'utf8');
  let out = src;
  for (const [pat, sub] of REWRITES) out = out.replace(pat, sub);
  if (out !== src) {
    if (!DRY) writeFileSync(full, out, 'utf8');
    changed++;
  }
}
console.log(`${DRY ? '[dry-run] ' : ''}${changed} file(s) updated of ${files.size} scanned`);
