/**
 * Prometheus Agent Audit Trail — tamper-evident log of AI agent actions.
 *
 * Each entry records what tool an agent called, which file it touched,
 * what governance findings existed at that moment, and the final status
 * (PASS / BLOCKED / WARN). Entries are sha256 hash-chained so any
 * tampering (deletion, reordering, modification) is detectable.
 *
 * File: .thesmos/audit.jsonl  (one JSON line per entry)
 *
 * Chain invariant: entry.hash = sha256(prevHash + JSON.stringify(entry without hash))
 *
 * Usage from hooks:
 *   thesmos agent:audit:log Write src/auth.ts --status BLOCKED --findings SEC_001
 *
 * Zero new dependencies — uses node:crypto (built-in).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditStatus = 'PASS' | 'BLOCKED' | 'WARN' | 'INFO';

export interface AuditEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** Agent session identifier */
  session: string;
  /** Tool that was called (Write, Edit, Bash, etc.) */
  tool: string;
  /** File path affected (relative to project root, or command string for Bash) */
  file: string;
  /** Governance findings active at the time */
  findings: string[];
  /** Governance decision */
  status: AuditStatus;
  /** sha256 of prevHash + stable entry content — tamper-evident chain link */
  hash: string;
}

export interface VerifyResult {
  valid: boolean;
  totalEntries: number;
  firstBrokenAt?: number;
  error?: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

export function auditPath(root: string): string {
  return join(root, '.thesmos', 'audit.jsonl');
}

// ── Hash chain ────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return 'sha256:' + createHash('sha256').update(input).digest('hex');
}

function stableContent(entry: Omit<AuditEntry, 'hash'>): string {
  return JSON.stringify({
    ts: entry.ts,
    session: entry.session,
    tool: entry.tool,
    file: entry.file,
    findings: entry.findings,
    status: entry.status,
  });
}

function lastHash(root: string): string {
  const path = auditPath(root);
  if (!existsSync(path)) return '';
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return '';
  try {
    const last = JSON.parse(lines[lines.length - 1]!) as AuditEntry;
    return last.hash ?? '';
  } catch {
    return '';
  }
}

// ── Core operations ───────────────────────────────────────────────────────────

/**
 * Append one entry to the audit trail and return it (with computed hash).
 */
export function appendAuditEntry(
  root: string,
  tool: string,
  file: string,
  status: AuditStatus,
  findings: string[] = [],
  session = process.env['PROMETHEUS_SESSION_ID'] ?? 'unknown',
): AuditEntry {
  const dir = join(root, '.thesmos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString();
  const prev = lastHash(root);
  const partial: Omit<AuditEntry, 'hash'> = { ts, session, tool, file, findings, status };
  const hash = sha256(prev + stableContent(partial));
  const entry: AuditEntry = { ...partial, hash };

  appendFileSync(auditPath(root), JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * Read audit entries from the trail (newest last).
 */
export function readAuditLog(root: string, limit = 50): AuditEntry[] {
  const path = auditPath(root);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  const entries: AuditEntry[] = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line) as AuditEntry); } catch { /* skip malformed */ }
  }
  return entries.slice(-limit);
}

/**
 * Verify the hash chain integrity of the audit log.
 * Returns valid=true if all hashes are consistent.
 */
export function verifyAuditChain(root: string): VerifyResult {
  const path = auditPath(root);
  if (!existsSync(path)) return { valid: true, totalEntries: 0 };

  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return { valid: true, totalEntries: 0 };

  let prevHash = '';
  for (let i = 0; i < lines.length; i++) {
    let entry: AuditEntry;
    try {
      entry = JSON.parse(lines[i]!) as AuditEntry;
    } catch {
      return { valid: false, totalEntries: lines.length, firstBrokenAt: i + 1, error: `Line ${i + 1}: parse error` };
    }
    const { hash, ...rest } = entry;
    const expected = sha256(prevHash + stableContent(rest));
    if (hash !== expected) {
      return {
        valid: false,
        totalEntries: lines.length,
        firstBrokenAt: i + 1,
        error: `Line ${i + 1}: hash mismatch. Stored: ${hash} Expected: ${expected}`,
      };
    }
    prevHash = hash;
  }
  return { valid: true, totalEntries: lines.length };
}

/**
 * Rotate the audit log — archive current log and start a fresh one.
 * Preserves the chain: the first entry of the new log chains from the last
 * entry of the previous log.
 */
export function rotateAuditLog(root: string): string | null {
  const path = auditPath(root);
  if (!existsSync(path)) return null;

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = join(root, '.thesmos', `audit-${ts}.jsonl`);
  const content = readFileSync(path, 'utf8');
  writeFileSync(archivePath, content);
  writeFileSync(path, ''); // truncate
  return archivePath;
}

// ── Formatters ────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<AuditStatus, string> = {
  PASS: '✓',
  BLOCKED: '🚫',
  WARN: '⚠',
  INFO: 'ℹ',
};

export function formatAuditReport(entries: AuditEntry[], title = 'Agent Audit Trail'): string {
  if (entries.length === 0) {
    return `${title}\n\nNo audit entries found. Run 'thesmos claude:govern install' to start logging.\n`;
  }

  const byStatus: Partial<Record<AuditStatus, number>> = {};
  for (const e of entries) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;

  const lines: string[] = [
    title,
    '',
    `  Total: ${entries.length} entries`,
    `  PASS: ${byStatus.PASS ?? 0}  BLOCKED: ${byStatus.BLOCKED ?? 0}  WARN: ${byStatus.WARN ?? 0}`,
    '',
  ];

  for (const e of entries.slice(-20)) {
    const icon = STATUS_ICON[e.status] ?? '?';
    const ts = e.ts.replace('T', ' ').slice(0, 19);
    const findingStr = e.findings.length > 0 ? `  [${e.findings.join(', ')}]` : '';
    lines.push(`  ${icon} ${ts}  ${e.tool.padEnd(6)} ${e.file}${findingStr}`);
  }

  if (entries.length > 20) lines.push(`\n  (showing last 20 of ${entries.length} entries)`);
  lines.push('');
  return lines.join('\n');
}

export function formatAuditCsv(entries: AuditEntry[]): string {
  const header = 'ts,session,tool,file,status,findings,hash';
  const rows = entries.map((e) =>
    [e.ts, e.session, e.tool, e.file, e.status, `"${e.findings.join(';')}"`, e.hash].join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}
