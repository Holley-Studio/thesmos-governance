// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agent activity log — append-only JSONL recording when Pantheon agents spawn
 * and complete. Written by the Claude Code Agent hook (.claude/hooks/agent-activity.cjs)
 * and agentsPanel.ts (sidebar invocations).
 *
 * Log file: .thesmos/agent-activity.jsonl (gitignored by default)
 * Format:   one JSON object per line, ordered by timestamp.
 */
import { existsSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentActivityEvent {
  ts: string;
  type: 'spawn' | 'complete' | 'error';
  /** Shared across one Claude session — groups related agent spawns */
  sessionId: string;
  /** UUID for this specific agent invocation */
  agentId: string;
  /** UUID of the spawning agent, enabling sub-agent nesting in the UI */
  parentId?: string;
  /** Value of the Agent tool `description` param */
  description: string;
  /** Value of the Agent tool `subagent_type` param, e.g. "Explore", "Zeus" */
  subagentType: string;
  durationMs?: number;
  /** First 200 chars of the agent result */
  resultSummary?: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

function logPath(root: string): string {
  return join(root, '.thesmos', 'agent-activity.jsonl');
}

function ensureDir(root: string): void {
  const dir = join(root, '.thesmos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function logAgentSpawn(
  root: string,
  event: Omit<AgentActivityEvent, 'ts' | 'type'>,
): AgentActivityEvent {
  const full: AgentActivityEvent = {
    ts: new Date().toISOString(),
    type: 'spawn',
    ...event,
  };
  ensureDir(root);
  appendFileSync(logPath(root), JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

export function logAgentComplete(
  root: string,
  partial: Pick<AgentActivityEvent, 'agentId' | 'sessionId'> &
    Partial<Pick<AgentActivityEvent, 'durationMs' | 'resultSummary'>>,
): AgentActivityEvent {
  const full: AgentActivityEvent = {
    ts: new Date().toISOString(),
    type: 'complete',
    description: '',
    subagentType: '',
    ...partial,
  };
  ensureDir(root);
  appendFileSync(logPath(root), JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

export function logAgentError(
  root: string,
  partial: Pick<AgentActivityEvent, 'agentId' | 'sessionId'> &
    Partial<Pick<AgentActivityEvent, 'durationMs' | 'resultSummary'>>,
): AgentActivityEvent {
  const full: AgentActivityEvent = {
    ts: new Date().toISOString(),
    type: 'error',
    description: '',
    subagentType: '',
    ...partial,
  };
  ensureDir(root);
  appendFileSync(logPath(root), JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function readAgentActivityLog(root: string, limit = 200): AgentActivityEvent[] {
  const p = logPath(root);
  if (!existsSync(p)) return [];

  const lines = readFileSync(p, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit);

  const events: AgentActivityEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as AgentActivityEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

/** Return only events newer than `since`. */
export function readAgentActivitySince(root: string, since: Date): AgentActivityEvent[] {
  return readAgentActivityLog(root, 2000).filter(
    (e) => new Date(e.ts) >= since,
  );
}
