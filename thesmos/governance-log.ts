// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Governance event log — append-only JSONL for rule fires, blocked actions,
 * and MCP enforcement decisions.
 *
 * Log file: .thesmos/governance.log.jsonl (gitignored by default)
 * Format: one JSON object per line, ordered by timestamp.
 */
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isObject, isTimestamp, readValidatedJsonl, type JsonlReadResult } from './jsonl.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GovernanceOutcome = 'PASS' | 'BLOCKED' | 'WARN' | 'BYPASSED';
export type GovernanceSource = 'scan' | 'mcp' | 'hook' | 'eval' | 'ci';

export interface GovernanceEvent {
  ts: string;
  source: GovernanceSource;
  rule: string;
  action: string;
  path: string;
  outcome: GovernanceOutcome;
  override: boolean;
  session?: string;
  message?: string;
}

export function isGovernanceEvent(value: unknown): value is GovernanceEvent {
  if (!isObject(value)) return false;
  return (
    isTimestamp(value.ts) &&
    ['scan', 'mcp', 'hook', 'eval', 'ci'].includes(value.source as string) &&
    ['PASS', 'BLOCKED', 'WARN', 'BYPASSED'].includes(value.outcome as string) &&
    ['rule', 'action', 'path'].every((key) => typeof value[key] === 'string') &&
    typeof value.override === 'boolean' &&
    (value.session === undefined || typeof value.session === 'string') &&
    (value.message === undefined || typeof value.message === 'string')
  );
}

// ── Paths ─────────────────────────────────────────────────────────────────────

function logPath(root: string): string {
  return join(root, '.thesmos', 'governance.log.jsonl');
}

function thesmosDir(root: string): string {
  return join(root, '.thesmos');
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function appendGovernanceEvent(
  root: string,
  event: Omit<GovernanceEvent, 'ts'>
): GovernanceEvent {
  const full: GovernanceEvent = { ...event, ts: new Date().toISOString() };
  if (!isGovernanceEvent(full)) throw new TypeError('Invalid governance event');

  const dir = thesmosDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  appendFileSync(logPath(root), JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

export function logRuleFire(
  root: string,
  rule: string,
  path: string,
  outcome: GovernanceOutcome,
  source: GovernanceSource = 'scan',
  session?: string,
  message?: string
): GovernanceEvent {
  return appendGovernanceEvent(root, {
    source,
    rule,
    action: 'check',
    path,
    outcome,
    override: false,
    session,
    message,
  });
}

export function logMcpBlock(
  root: string,
  tool: string,
  path: string,
  rule: string,
  message: string,
  session?: string
): GovernanceEvent {
  return appendGovernanceEvent(root, {
    source: 'mcp',
    rule,
    action: tool,
    path,
    outcome: 'BLOCKED',
    override: false,
    session,
    message,
  });
}

export function logMcpPass(
  root: string,
  tool: string,
  path: string,
  session?: string
): GovernanceEvent {
  return appendGovernanceEvent(root, {
    source: 'mcp',
    rule: 'passthrough',
    action: tool,
    path,
    outcome: 'PASS',
    override: false,
    session,
  });
}

export function logMcpOverride(
  root: string,
  tool: string,
  path: string,
  rule: string,
  message: string,
  session?: string
): GovernanceEvent {
  return appendGovernanceEvent(root, {
    source: 'mcp',
    rule,
    action: tool,
    path,
    outcome: 'BYPASSED',
    override: true,
    session,
    message,
  });
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function readGovernanceLog(root: string, limit = 1000): GovernanceEvent[] {
  return readGovernanceLogResult(root, limit).records;
}

export function readGovernanceLogResult(
  root: string,
  limit = 1000
): JsonlReadResult<GovernanceEvent> {
  return readValidatedJsonl(logPath(root), isGovernanceEvent, limit);
}

export function readGovernanceLogSince(root: string, since: Date): GovernanceEvent[] {
  return readGovernanceLog(root, Number.POSITIVE_INFINITY).filter((e) => new Date(e.ts) >= since);
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface GovernanceSummary {
  total: number;
  blocked: number;
  warned: number;
  passed: number;
  bypassed: number;
  /** Null when no enforced events — never invent 100% from an empty log. */
  complianceScore: number | null;
  /** Honest assurance state for empty / partial / full evidence. */
  assuranceState: 'PASS' | 'FAIL' | 'INCOMPLETE' | 'ERROR';
  blockedEvents: GovernanceEvent[];
  bypassedEvents: GovernanceEvent[];
  ruleHits: Record<string, number>;
  topRule: string | null;
  categoryHits: Record<string, number>;
  topCategory: string | null;
  period: { from: string; to: string } | null;
  /** Invalid/unreadable evidence prevents a clean assurance claim. */
  evidenceIssues: string[];
}

function ruleToCategory(rule: string): string {
  const prefix = rule.split('_')[0]?.toUpperCase() ?? rule;
  const MAP: Record<string, string> = {
    SEC: 'Security',
    AUTH: 'Authentication',
    GDPR: 'Privacy',
    MCP: 'MCP Governance',
    AGNT: 'Agent Safety',
    SC: 'Source Control',
    NEXT: 'Next.js',
    K8S: 'Infrastructure',
    DEP: 'Dependencies',
    LIC: 'Licensing',
    PII: 'PII Handling',
    ACC: 'Accuracy',
  };
  return MAP[prefix] ?? prefix;
}

export function summariseGovernanceLog(
  input: GovernanceEvent[],
  evidenceIssues: string[] = []
): GovernanceSummary {
  const events = input.filter(isGovernanceEvent);
  const issues = [...evidenceIssues];
  if (events.length !== input.length)
    issues.push(`${input.length - events.length} invalid governance event(s)`);
  const blocked = events.filter((e) => e.outcome === 'BLOCKED');
  const warned = events.filter((e) => e.outcome === 'WARN');
  const passed = events.filter((e) => e.outcome === 'PASS');
  const bypassed = events.filter((e) => e.outcome === 'BYPASSED');

  const enforced = blocked.length + passed.length + bypassed.length + warned.length;
  const compliant = passed.length + warned.length;
  // Empty log → INCOMPLETE (null score), never a fake 100%.
  const complianceScore =
    issues.length > 0 || enforced === 0 ? null : Math.round((compliant / enforced) * 1000) / 10;
  const assuranceState: GovernanceSummary['assuranceState'] =
    issues.length > 0
      ? 'ERROR'
      : enforced === 0
        ? 'INCOMPLETE'
        : blocked.length + bypassed.length > 0
          ? 'FAIL'
          : 'PASS';

  const ruleHits: Record<string, number> = Object.create(null);
  const categoryHits: Record<string, number> = Object.create(null);

  for (const e of events) {
    if (e.rule === 'passthrough') continue;
    ruleHits[e.rule] = (ruleHits[e.rule] ?? 0) + 1;
    const cat = ruleToCategory(e.rule);
    categoryHits[cat] = (categoryHits[cat] ?? 0) + 1;
  }

  const topRule = Object.entries(ruleHits).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topCategory = Object.entries(categoryHits).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const timestamps = events.map((e) => e.ts).sort((a, b) => Date.parse(a) - Date.parse(b));
  const period =
    timestamps.length > 0 ? { from: timestamps[0]!, to: timestamps[timestamps.length - 1]! } : null;

  return {
    total: events.length,
    blocked: blocked.length,
    warned: warned.length,
    passed: passed.length,
    bypassed: bypassed.length,
    complianceScore,
    assuranceState,
    blockedEvents: blocked,
    bypassedEvents: bypassed,
    ruleHits,
    topRule,
    categoryHits,
    topCategory,
    period,
    evidenceIssues: issues,
  };
}
