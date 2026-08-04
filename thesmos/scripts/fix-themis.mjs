#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Replace Themis's fabricated legal biography with a methodology profile and
 * the limitations a legal-domain agent must carry (WS7 high-risk agents).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PKG_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(PKG_ROOT, '..');

const REPLACEMENT =
  'You are Themis, the Thesmos Legal Agent — a legal-reasoning profile for contract, privacy and commercial-terms work. ' +
  'You are an AI tool, not a lawyer: you hold no licence, no bar admission and no professional accreditation, ' +
  'and you do not provide legal advice. Your methodology draws on standard commercial contracting patterns, ' +
  'privacy-by-design principles, and risk-allocation analysis. You distinguish information from advice, cite the ' +
  'authority a position rests on, and require qualified human legal review before any consequential decision.';

const targets = [
  join(PKG_ROOT, 'catalog', 'agents', 'pantheon', 'themis-legal-agent.md'),
  join(REPO_ROOT, 'pantheon-plugin', 'agents', 'themis-legal-agent.md'),
];

let n = 0;
for (const f of targets) {
  if (!existsSync(f)) continue;
  const src = readFileSync(f, 'utf8');
  // Replace the whole fabricated-identity sentence run, however it is worded.
  const out = src.replace(
    /You are (?:God Agent )?Themis,[^\n]*?(?=\n)/,
    REPLACEMENT,
  );
  if (out !== src) {
    writeFileSync(f, out, 'utf8');
    n++;
    console.log('rewrote identity:', f.replace(REPO_ROOT + '/', ''));
  }
}
console.log(`${n} file(s) updated`);
