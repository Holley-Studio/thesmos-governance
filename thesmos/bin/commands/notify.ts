// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos notify — sends webhook notifications when findings meet a severity threshold.
 *
 * Usage:
 *   thesmos notify --webhook=<url> --on=BLOCKER
 *   thesmos notify --webhook=<url> --on=HIGH --dry-run
 *
 * Reads .thesmos/findings.json (produced by `thesmos review`) and POSTs
 * a JSON payload to the webhook URL if any finding meets or exceeds
 * the specified severity.
 *
 * Slack incoming webhooks are natively supported — the payload format
 * is compatible with Slack's `{"text": "..."}` schema.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../../types.js';

const SEVERITY_ORDER = ['TECH_DEBT', 'LOW', 'MEDIUM', 'HIGH', 'BLOCKER'] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

function severityRank(s: string): number {
  return SEVERITY_ORDER.indexOf(s as Severity);
}

function parseArgs(argv: string[]): { flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      flags[key!] = val !== undefined ? val : true;
    }
  }
  return { flags };
}

async function postWebhook(url: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Webhook POST failed: ${res.status} ${res.statusText}`);
  }
}

function buildSlackPayload(findings: Finding[], threshold: string, repoName: string): Record<string, unknown> {
  const blockers = findings.filter((f) => f.severity === 'BLOCKER');
  const highs    = findings.filter((f) => f.severity === 'HIGH');
  const total    = findings.length;

  const lines = [
    `*Thesmos Governance Alert* — \`${repoName}\``,
    `${total} finding${total === 1 ? '' : 's'} at or above *${threshold}*`,
    '',
    blockers.length > 0 ? `*BLOCKERS (${blockers.length}):*` : null,
    ...blockers.slice(0, 5).map((f) => `  • \`${f.file}:${f.line ?? '?'}\` — ${f.message}`),
    blockers.length > 5 ? `  _…and ${blockers.length - 5} more_` : null,
    highs.length > 0 ? `*HIGH (${highs.length}):*` : null,
    ...highs.slice(0, 3).map((f) => `  • \`${f.file}:${f.line ?? '?'}\` — ${f.message}`),
    highs.length > 3 ? `  _…and ${highs.length - 3} more_` : null,
  ].filter(Boolean);

  return { text: lines.join('\n') };
}

export async function cmdNotify(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);

  const webhookUrl = flags['webhook'] as string | undefined;
  const onSeverity = ((flags['on'] as string | undefined) ?? 'BLOCKER').toUpperCase();
  const dryRun     = flags['dry-run'] === true;
  const reportPath = flags['report'] as string | undefined;

  if (!webhookUrl && !dryRun) {
    process.stderr.write('Usage: thesmos notify --webhook=<url> --on=BLOCKER\n');
    process.stderr.write('       thesmos notify --webhook=<url> --on=HIGH --dry-run\n');
    process.exit(1);
  }

  if (severityRank(onSeverity) === -1) {
    process.stderr.write(`Invalid severity: ${onSeverity}. Use: ${SEVERITY_ORDER.join(' | ')}\n`);
    process.exit(1);
  }

  // Load findings report
  const root = process.cwd();
  const findingsFile = reportPath ?? join(root, '.thesmos', 'findings.json');

  if (!existsSync(findingsFile)) {
    process.stderr.write(`No findings report found at ${findingsFile}.\n`);
    process.stderr.write('Run `thesmos review` first to generate findings.\n');
    process.exit(1);
  }

  let findings: Finding[];
  try {
    const raw = readFileSync(findingsFile, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    findings = Array.isArray(parsed)
      ? (parsed as Finding[])
      : ((parsed as { findings?: Finding[] }).findings ?? []);
  } catch (err) {
    process.stderr.write(`Failed to parse ${findingsFile}: ${String(err)}\n`);
    process.exit(1);
  }

  // Filter to findings at or above the threshold severity
  const minRank = severityRank(onSeverity);
  const matching = findings.filter((f) => severityRank(f.severity) >= minRank);

  if (matching.length === 0) {
    console.log(`No findings at or above ${onSeverity}. Nothing to notify.`);
    return;
  }

  const repoName = root.split('/').pop() ?? 'repo';
  const payload = buildSlackPayload(matching, onSeverity, repoName);

  if (dryRun) {
    console.log('Dry run — would POST this payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  await postWebhook(webhookUrl!, payload);
  console.log(`Notified webhook: ${matching.length} finding${matching.length === 1 ? '' : 's'} at ${onSeverity}+`);
}
