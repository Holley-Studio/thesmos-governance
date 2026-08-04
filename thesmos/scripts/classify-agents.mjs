#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * One-time classification pass (WS3).
 *
 * Writes EXPLICIT availability/kind metadata into every canonical agent's
 * frontmatter so that population counts stop depending on folder names,
 * mythology fields, or the presence of a model pin.
 *
 * The derivation below uses those implicit signals exactly ONCE — here — and
 * records the result. After this, `product-facts` reads only the explicit
 * fields, so a future agent lands in a population because someone declared it,
 * not because of where the file happened to be saved.
 *
 * Usage: node scripts/classify-agents.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PKG_ROOT = join(import.meta.dirname, '..');
const AGENTS_DIR = join(PKG_ROOT, 'catalog', 'agents');
const DRY = process.argv.includes('--dry-run');

const free = JSON.parse(readFileSync(join(PKG_ROOT, 'catalog', 'free-agents.json'), 'utf8'));
const holdbacks = JSON.parse(readFileSync(join(PKG_ROOT, 'catalog', 'holdbacks.json'), 'utf8'));
const freeIds = new Set(free.freeAgentIds);
const heldIds = new Set(holdbacks.holdbackAgentIds ?? []);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---/;
const scalar = (block, key) => {
  const m = block.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
};

const rows = [];
for (const full of walk(AGENTS_DIR)) {
  const src = readFileSync(full, 'utf8');
  const fm = src.match(FM);
  if (!fm) continue;                       // READMEs and prose files are not agents
  const block = fm[1];
  const id = scalar(block, 'id');
  if (!id) continue;

  const rel = relative(PKG_ROOT, full).replace(/\\/g, '/');
  const isReviewer = rel.includes('/reviewers/');
  const hasPlatformModel = /^\s*claude_model:/m.test(block);
  const enabled = (scalar(block, 'enabled') ?? 'true').toLowerCase() !== 'false';

  // ── Derivation (implicit signals used here and only here) ────────────────
  let agent_kind, availability, marketed, routable, exportable;

  if (isReviewer) {
    // Internal review tooling. Never marketed as a customer agent.
    agent_kind = 'reviewer';
    availability = 'internal';
    marketed = false;
    routable = false;
    exportable = false;
  } else if (heldIds.has(id)) {
    // Exists in the catalog but the drop is deliberately incomplete.
    agent_kind = 'specialist';
    availability = 'held_back';
    marketed = false;
    routable = false;
    exportable = false;
  } else if (hasPlatformModel) {
    // A platforms.claude_model pin is what the exporter treats as a shippable
    // customer agent today.
    agent_kind = 'specialist';
    availability = freeIds.has(id) ? 'free' : 'pro';
    marketed = true;
    routable = true;
    exportable = true;
  } else {
    // Catalog definition with no platform pin: not shippable as-is.
    agent_kind = 'internal';
    availability = 'internal';
    marketed = false;
    routable = false;
    exportable = false;
  }

  if (!enabled) { availability = 'internal'; marketed = false; routable = false; exportable = false; }

  rows.push({ full, rel, id, agent_kind, availability, marketed, routable, exportable, block, src });
}

// ── Write explicit metadata ────────────────────────────────────────────────
let written = 0;
for (const r of rows) {
  if (/^availability:/m.test(r.block) && /^agent_kind:/m.test(r.block)) continue;
  let block = r.block
    .replace(/^availability:.*$\n?/m, '')
    .replace(/^marketed:.*$\n?/m, '')
    .replace(/^agent_kind:.*$\n?/m, '')
    .replace(/^routable:.*$\n?/m, '')
    .replace(/^exportable:.*$\n?/m, '');

  const meta = [
    `agent_kind: ${r.agent_kind}`,
    `availability: ${r.availability}`,
    `marketed: ${r.marketed}`,
    `routable: ${r.routable}`,
    `exportable: ${r.exportable}`,
  ].join('\n');

  // Insert after `enabled:` when present, else after `id:`.
  if (/^enabled:.*$/m.test(block)) block = block.replace(/^(enabled:.*)$/m, `$1\n${meta}`);
  else block = block.replace(/^(id:.*)$/m, `$1\n${meta}`);

  if (!DRY) writeFileSync(r.full, r.src.replace(FM, `---\n${block}\n---`), 'utf8');
  written++;
}

// ── Report ─────────────────────────────────────────────────────────────────
const tally = (pred) => rows.filter(pred).length;
console.log(`${DRY ? '[dry-run] ' : ''}classified ${rows.length} agent definitions (${written} updated)\n`);
console.log('  catalogAgentCount      ', rows.length);
console.log('  specialistPersonaCount ', tally((r) => r.agent_kind === 'specialist' && r.marketed));
console.log('  utilityAgentCount      ', tally((r) => r.agent_kind === 'utility' && r.marketed));
console.log('  availableAgentCount    ', tally((r) => r.marketed && (r.availability === 'free' || r.availability === 'pro')));
console.log('  freeAgentCount         ', tally((r) => r.availability === 'free'));
console.log('  proAgentCount          ', tally((r) => r.availability === 'pro'));
console.log('  heldBackAgentCount     ', tally((r) => r.availability === 'held_back'));
console.log('  internalReviewerCount  ', tally((r) => r.agent_kind === 'reviewer'));
console.log('  internalOtherCount     ', tally((r) => r.agent_kind === 'internal'));
