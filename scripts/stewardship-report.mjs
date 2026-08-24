#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Stewardship report builder.
 *
 * Reads the raw evidence files produced by .github/workflows/repository-stewardship.yml
 * and emits:
 *   - <dir>/summary.json  machine-readable evidence
 *   - stdout              Markdown summary (the workflow redirects it to summary.md)
 *
 * Deliberately dumb: it summarises collected evidence and makes no judgements
 * the underlying commands did not already make. Every number here traces to a
 * command that ran, and anything that could not be determined is reported as
 * unknown rather than inferred.
 *
 * Usage: node scripts/stewardship-report.mjs <report-dir>
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: stewardship-report.mjs <report-dir>');
  process.exit(2);
}

/** Read a file, or null when it does not exist. Never throws. */
function read(name) {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Exit code as a number, or the literal string it contains (e.g. "skipped"),
 * or null when the step never ran. Three distinct states, never collapsed.
 */
function exitOf(name) {
  const raw = read(`${name}.exit`);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? raw : n;
}

function statusLabel(code) {
  if (code === null) return 'not run';
  if (code === 'skipped') return 'skipped (prerequisite missing)';
  return code === 0 ? 'pass' : `fail (exit ${code})`;
}

// ── Collect ──────────────────────────────────────────────────────────────────

const checks = ['doctor', 'health', 'validate', 'catalog', 'export', 'npm-audit', 'knip'].map(
  (name) => ({ name, exitCode: exitOf(name), status: statusLabel(exitOf(name)) }),
);

// Health score, parsed from the CLI output. Reported as null when the format
// changes — a missing score is honest; a guessed one is not.
const healthText = read('health.txt') ?? '';
const scoreMatch = healthText.match(/Score:\s*(\d+)\s*\/\s*100/);
const gradeMatch = healthText.match(/Grade:\s*([A-F][+]?)/);
const health = {
  score: scoreMatch ? Number.parseInt(scoreMatch[1], 10) : null,
  grade: gradeMatch ? gradeMatch[1] : null,
};

// Counts, from the truth-check step.
const countsText = read('counts.txt') ?? '';
const counts = {};
for (const line of countsText.split('\n')) {
  const m = line.match(/^([a-z_]+)=(\d+)$/);
  if (m) counts[m[1]] = Number.parseInt(m[2], 10);
}

// A documented count that disagrees with generated truth is the single most
// reliable staleness signal a repository has.
const documentedClaims = countsText
  .split('--- documented claims ---')[1]
  ?.split('\n')
  .map((l) => l.trim())
  .filter(Boolean) ?? [];

const generatedTruth = counts['generated_model_map_entries'] ?? null;
const countMismatches = generatedTruth === null
  ? []
  : documentedClaims.filter((line) => {
      const nums = [...line.matchAll(/\b(\d{1,4})\b/g)].map((m) => Number.parseInt(m[1], 10));
      // Ignore line numbers (the leading "file:NN:" prefix) by dropping the first match.
      return nums.slice(1).some((n) => n >= 10 && n <= 999 && n !== generatedTruth);
    });

const exportDrift = read('export-drift.txt');

// npm audit — parsed defensively; the schema has changed across major versions.
let vulnerabilities = null;
const auditRaw = read('npm-audit.json');
if (auditRaw) {
  try {
    const parsed = JSON.parse(auditRaw);
    if (parsed?.metadata?.vulnerabilities) vulnerabilities = parsed.metadata.vulnerabilities;
  } catch {
    vulnerabilities = null;
  }
}

let deadCode = null;
const knipRaw = read('knip.json');
if (knipRaw) {
  try {
    const parsed = JSON.parse(knipRaw);
    deadCode = parsed?.note ? { skipped: parsed.note } : { reported: true };
  } catch {
    deadCode = null;
  }
}

const summary = {
  generatedBy: 'repository-stewardship.yml',
  readOnly: true,
  checks,
  health,
  counts,
  documentedClaims,
  countMismatches,
  generatedArtifactDrift: exportDrift ? exportDrift : null,
  vulnerabilities,
  deadCode,
  unresolvedRisks: [
    'This sweep runs on ubuntu-latest only. Windows and macOS behaviour is not verified here.',
    'Dead-code findings are unreferenced-by-static-analysis, not proven dead. No dynamic-reachability allowlist is applied in CI.',
    'The model registry is checked for internal consistency, not against the providers\' current published reality — see each entry\'s verifiedAt date.',
  ],
};

writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');

// ── Markdown ─────────────────────────────────────────────────────────────────

const failing = checks.filter((c) => typeof c.exitCode === 'number' && c.exitCode !== 0);
const lines = [];

lines.push('## 🏛️ Repository stewardship — weekly audit');
lines.push('');
lines.push('_Read-only sweep. No files were changed, no branches deleted, nothing merged or published._');
lines.push('');

if (health.score !== null) {
  lines.push(`**Health:** ${health.score}/100 (${health.grade ?? 'ungraded'})`);
} else {
  lines.push('**Health:** could not be parsed from CLI output — see the attached artifact.');
}
lines.push('');

lines.push('### Checks');
lines.push('');
lines.push('| Check | Result |');
lines.push('|---|---|');
for (const c of checks) lines.push(`| \`${c.name}\` | ${c.status} |`);
lines.push('');

if (Object.keys(counts).length > 0) {
  lines.push('### Counts (generated truth)');
  lines.push('');
  lines.push('| Population | Count |');
  lines.push('|---|---|');
  for (const [k, v] of Object.entries(counts)) lines.push(`| \`${k}\` | ${v} |`);
  lines.push('');
}

if (countMismatches.length > 0) {
  lines.push('### ⚠️ Documented counts that may disagree with generated truth');
  lines.push('');
  lines.push(`Generated model-map entries: **${generatedTruth}**. These lines mention a different number:`);
  lines.push('');
  for (const m of countMismatches.slice(0, 20)) lines.push(`- \`${m}\``);
  lines.push('');
  lines.push('_Note: a number may legitimately describe a different population (authored superset vs exported subset). Confirm which population each claim counts before treating it as an error._');
  lines.push('');
}

if (exportDrift) {
  lines.push('### ⚠️ Generated artifacts are stale');
  lines.push('');
  lines.push('```');
  lines.push(exportDrift.slice(0, 2000));
  lines.push('```');
  lines.push('');
  lines.push('Fix by running the generator — never by editing the artifact:');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run agents:export --workspace=thesmos');
  lines.push('```');
  lines.push('');
}

if (vulnerabilities) {
  const total = Object.values(vulnerabilities).reduce(
    (n, v) => n + (typeof v === 'number' ? v : 0),
    0,
  );
  lines.push(`### Dependencies`);
  lines.push('');
  lines.push(
    total > 0
      ? `\`npm audit --omit=dev\` reports **${total}** advisory/advisories: \`${JSON.stringify(vulnerabilities)}\``
      : 'No production advisories reported.',
  );
  lines.push('');
}

if (deadCode?.skipped) {
  lines.push('### Dead code');
  lines.push('');
  lines.push(`_Not run: ${deadCode.skipped}_`);
  lines.push('');
  lines.push('A grep-based approximation was deliberately **not** substituted — it would not be equivalent evidence.');
  lines.push('');
}

lines.push('### Unresolved risks');
lines.push('');
for (const r of summary.unresolvedRisks) lines.push(`- ${r}`);
lines.push('');

lines.push('### Recommended next actions');
lines.push('');
if (failing.length === 0 && !exportDrift && countMismatches.length === 0) {
  lines.push('None. Every mechanical check passed.');
} else {
  let n = 1;
  if (exportDrift) lines.push(`${n++}. Regenerate artifacts and commit — **Eunomia** (one command, fully reversible).`);
  if (countMismatches.length > 0) lines.push(`${n++}. Reconcile documented counts against generated truth — **Eunomia** / **Mnemosyne**.`);
  for (const c of failing) lines.push(`${n++}. Investigate failing \`${c.name}\` (${c.status}) — see artifact.`);
}
lines.push('');
lines.push('Full evidence (JSON + raw command output) is attached to this workflow run as the `stewardship-report` artifact.');
lines.push('');
lines.push('— Eunomia | Repository Stewardship & Codebase Order');

console.log(lines.join('\n'));
