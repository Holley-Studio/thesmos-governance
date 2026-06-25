// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Governance event log — append-only JSONL for rule fires, blocked actions,
 * and MCP enforcement decisions.
 *
 * Log file: .thesmos/governance.log.jsonl (gitignored by default)
 * Format: one JSON object per line, ordered by timestamp.
 */
import { existsSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
  event: Omit<GovernanceEvent, 'ts'>,
): GovernanceEvent {
  const full: GovernanceEvent = { ts: new Date().toISOString(), ...event };

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
  message?: string,
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
  session?: string,
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
  session?: string,
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
  session?: string,
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
  const p = logPath(root);
  if (!existsSync(p)) return [];

  const lines = readFileSync(p, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit);

  const events: GovernanceEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as GovernanceEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

export function readGovernanceLogSince(root: string, since: Date): GovernanceEvent[] {
  return readGovernanceLog(root, 10000).filter(
    (e) => new Date(e.ts) >= since,
  );
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface GovernanceSummary {
  total: number;
  blocked: number;
  warned: number;
  passed: number;
  bypassed: number;
  complianceScore: number;
  blockedEvents: GovernanceEvent[];
  bypassedEvents: GovernanceEvent[];
  ruleHits: Record<string, number>;
  topRule: string | null;
  categoryHits: Record<string, number>;
  topCategory: string | null;
  period: { from: string; to: string } | null;
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

export function summariseGovernanceLog(events: GovernanceEvent[]): GovernanceSummary {
  const blocked = events.filter((e) => e.outcome === 'BLOCKED');
  const warned = events.filter((e) => e.outcome === 'WARN');
  const passed = events.filter((e) => e.outcome === 'PASS');
  const bypassed = events.filter((e) => e.outcome === 'BYPASSED');

  const enforced = blocked.length + passed.length + bypassed.length + warned.length;
  const compliant = passed.length + warned.length;
  const complianceScore =
    enforced === 0 ? 100 : Math.round((compliant / enforced) * 1000) / 10;

  const ruleHits: Record<string, number> = {};
  const categoryHits: Record<string, number> = {};

  for (const e of events) {
    if (e.rule === 'passthrough') continue;
    ruleHits[e.rule] = (ruleHits[e.rule] ?? 0) + 1;
    const cat = ruleToCategory(e.rule);
    categoryHits[cat] = (categoryHits[cat] ?? 0) + 1;
  }

  const topRule = Object.entries(ruleHits).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topCategory =
    Object.entries(categoryHits).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const timestamps = events.map((e) => e.ts).sort();
  const period =
    timestamps.length > 0
      ? { from: timestamps[0]!, to: timestamps[timestamps.length - 1]! }
      : null;

  return {
    total: events.length,
    blocked: blocked.length,
    warned: warned.length,
    passed: passed.length,
    bypassed: bypassed.length,
    complianceScore,
    blockedEvents: blocked,
    bypassedEvents: bypassed,
    ruleHits,
    topRule,
    categoryHits,
    topCategory,
    period,
  };
}
