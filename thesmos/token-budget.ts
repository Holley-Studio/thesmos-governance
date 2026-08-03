// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Token Budget Governance — AI cost tracking and enforcement for Claude Code sessions.
 *
 * PostToolUse hook captures token usage from every Claude Code tool call,
 * writes append-only event log to .thesmos/token-usage.jsonl, and enforces
 * configurable session/daily/project budgets with alerts and hard stops.
 *
 * Integration:
 *   - PostToolUse hook in .claude/settings.json → `thesmos claude:govern check`
 *   - Checks happen after each tool call; hard-stop exits 2 to block further use
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendSavingsEntry, readSavingsEntries } from './savings.js';
import { type CostResult, costFor } from './models/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelCost {
  inputPer1M: number;
  outputPer1M: number;
}

export interface TokenBudgetConfig {
  enabled: boolean;
  /** Hard stop session at this many tokens (0 = disabled). */
  sessionMaxTokens: number;
  /** Hard stop session at this USD cost. */
  sessionMaxCostUSD: number;
  /** Daily accumulated cost hard stop. */
  dailyMaxCostUSD: number;
  /** Project accumulated cost hard stop. */
  projectMaxCostUSD: number;
  /** Alert when this fraction of any budget is used (0–1). */
  alertAt: number;
  /** Hard stop when this fraction is used (0–1, should be 1.0). */
  hardStopAt: number;
  /**
   * OPTIONAL per-model price override, consulted before the registry.
   *
   * This used to be the primary price table, and it had drifted badly — Opus was
   * billed at $15/$75 (3× the verified rate) and Haiku 4.5 at $0.25/$1.25 (4×
   * under). Prices now come from thesmos/models/registry.ts, which carries a
   * source URL, a verified-at date, and dated price windows. This field remains
   * only so an operator can model a negotiated or preview rate; leave it empty
   * unless you have one.
   */
  modelCostTable: Record<string, ModelCost>;
}

export const TOKEN_BUDGET_DEFAULTS: TokenBudgetConfig = {
  enabled: false,
  sessionMaxTokens: 500_000,
  sessionMaxCostUSD: 5.00,
  dailyMaxCostUSD: 25.00,
  projectMaxCostUSD: 500.00,
  alertAt: 0.80,
  hardStopAt: 1.00,
  // Empty by design: the model registry is the price source of truth.
  modelCostTable: {},
};

// ── Token usage event (one line in .thesmos/token-usage.jsonl) ─────────────

export interface TokenEvent {
  ts: string;
  sessionId: string;
  toolName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** 0 when the cost could not be determined — read `costKnown` before trusting it. */
  costUSD: number;
  /**
   * False when no verified price existed for `model`. Absent on events written
   * before this field existed, which are treated as known for back-compat.
   */
  costKnown?: boolean;
}

// ── File paths ────────────────────────────────────────────────────────────────

const USAGE_LOG = '.thesmos/token-usage.jsonl';
const SESSION_ID_FILE = '.thesmos/token-session-id';

// ── Cost calculation ──────────────────────────────────────────────────────────

/**
 * Cost of a turn, or an explicit unknown.
 *
 * Resolution order: operator override table → model registry → unknown.
 *
 * The previous implementation fell back to a Sonnet 4.6 price for ANY
 * unrecognised model id, so an unknown model produced a confident, wrong
 * number that then fed budget enforcement. Guessing a price is worse than
 * admitting you do not know one: the guess is invisible, and it is wrong in an
 * unknown direction.
 */
export function calcCostResult(
  model: string,
  inputTokens: number,
  outputTokens: number,
  costTable: Record<string, ModelCost>,
  at: Date = new Date(),
): CostResult {
  const override = costTable[model];
  if (override) {
    return {
      known: true,
      modelId: model,
      costUsd: (inputTokens * override.inputPer1M + outputTokens * override.outputPer1M) / 1_000_000,
      price: {
        inputPer1M: override.inputPer1M,
        outputPer1M: override.outputPer1M,
        effectiveFrom: '0000-01-01',
        effectiveTo: null,
        note: 'Operator override from config.modelCostTable.',
      },
    };
  }
  return costFor(model, inputTokens, outputTokens, at);
}

/**
 * Cost in USD, or `null` when no verified price exists.
 *
 * Returns null rather than 0 on purpose — 0 reads as "free", which is a
 * different and equally wrong claim.
 */
export function calcCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  costTable: Record<string, ModelCost>,
  at: Date = new Date(),
): number | null {
  const result = calcCostResult(model, inputTokens, outputTokens, costTable, at);
  return result.known ? result.costUsd : null;
}

// ── Event log ─────────────────────────────────────────────────────────────────

export function appendTokenEvent(root: string, event: TokenEvent): void {
  const logPath = join(root, USAGE_LOG);
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf8');
}

export function readTokenEvents(root: string): TokenEvent[] {
  const logPath = join(root, USAGE_LOG);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TokenEvent);
  } catch {
    return [];
  }
}

// ── Session ID ────────────────────────────────────────────────────────────────

export function getCurrentSessionId(root: string): string {
  const idPath = join(root, SESSION_ID_FILE);
  if (existsSync(idPath)) {
    try { return readFileSync(idPath, 'utf8').trim(); } catch { /* */ }
  }
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  try { writeFileSync(idPath, id, 'utf8'); } catch { /* */ }
  return id;
}

// ── Budget report ─────────────────────────────────────────────────────────────

export interface BudgetReport {
  session: {
    id: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  };
  today: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  };
  project: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  };
  alerts: string[];
  hardStop: boolean;
  hardStopReason: string | null;
  /**
   * Events whose cost could not be determined. When > 0 every cost total above
   * is a LOWER BOUND, and display layers must say so rather than presenting the
   * figure as complete.
   */
  unknownCostEvents: number;
}

export function buildBudgetReport(
  root: string,
  config: TokenBudgetConfig,
  sessionId: string,
): BudgetReport {
  const events = readTokenEvents(root);
  const todayStr = new Date().toISOString().slice(0, 10);

  const sessionEvents = events.filter((e) => e.sessionId === sessionId);
  const todayEvents   = events.filter((e) => e.ts.startsWith(todayStr));

  const sum = (evts: TokenEvent[]) => evts.reduce(
    (acc, e) => ({
      inputTokens:  acc.inputTokens  + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      totalTokens:  acc.totalTokens  + e.inputTokens + e.outputTokens,
      costUSD:      acc.costUSD      + e.costUSD,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 },
  );

  const session = { id: sessionId, ...sum(sessionEvents) };
  const today   = sum(todayEvents);
  const project = sum(events);

  // Events written before `costKnown` existed are treated as known.
  const unknownCostEvents = events.filter((e) => e.costKnown === false).length;

  const alerts: string[] = [];
  let hardStop = false;
  let hardStopReason: string | null = null;

  if (unknownCostEvents > 0) {
    alerts.push(
      `${unknownCostEvents} event(s) had no verified price — cost totals are a lower bound, not a complete figure.`,
    );
  }

  const check = (used: number, max: number, label: string) => {
    if (max <= 0) return;
    const ratio = used / max;
    if (ratio >= config.hardStopAt) {
      hardStop = true;
      hardStopReason = `${label} budget exhausted ($${used.toFixed(2)} / $${max.toFixed(2)})`;
    } else if (ratio >= config.alertAt) {
      const pct = Math.round(ratio * 100);
      alerts.push(`⚡ ${pct}% of ${label} budget used — $${used.toFixed(2)} / $${max.toFixed(2)}`);
    }
  };

  if (config.sessionMaxCostUSD > 0) check(session.costUSD, config.sessionMaxCostUSD, 'session');
  if (config.dailyMaxCostUSD   > 0) check(today.costUSD,   config.dailyMaxCostUSD,   'daily');
  if (config.projectMaxCostUSD > 0) check(project.costUSD, config.projectMaxCostUSD, 'project');

  if (config.sessionMaxTokens > 0 && session.totalTokens >= config.sessionMaxTokens) {
    hardStop = true;
    hardStopReason = `Session token budget exhausted (${session.totalTokens.toLocaleString()} / ${config.sessionMaxTokens.toLocaleString()} tokens)`;
  }

  return { session, today, project, alerts, hardStop, hardStopReason, unknownCostEvents };
}

// ── PostToolUse stdin handler ─────────────────────────────────────────────────

/**
 * Called by Claude Code as a PostToolUse hook.
 * Reads tool usage data from stdin, logs it, checks budgets.
 * Exits 0 (allow) or 2 (hard stop).
 */
export async function runPostToolBudgetCheck(root: string, config: TokenBudgetConfig): Promise<void> {
  if (!config.enabled) process.exit(0);

  let raw = '';
  try {
    raw = await readStdinBudget();
  } catch {
    process.exit(0);
  }
  if (!raw.trim()) process.exit(0);

  let hookData: {
    tool_name?: string;
    session_id?: string;
    model?: string;
    // Claude Code PostToolUse hook exposes cumulative usage at the top level
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  };
  try {
    hookData = JSON.parse(raw) as typeof hookData;
  } catch {
    process.exit(0);
  }

  const inputTokens  = hookData.usage?.input_tokens  ?? 0;
  const outputTokens = hookData.usage?.output_tokens ?? 0;
  // No default model. Attributing an unlabelled turn to a specific model would
  // invent both the model and its price; 'unknown' resolves to unknown cost.
  const model        = hookData.model ?? 'unknown';
  const toolName     = hookData.tool_name ?? 'unknown';
  const sessionId    = hookData.session_id ?? getCurrentSessionId(root);

  const cost = calcCostResult(model, inputTokens, outputTokens, config.modelCostTable);

  const event: TokenEvent = {
    ts: new Date().toISOString(),
    sessionId,
    toolName,
    model,
    inputTokens,
    outputTokens,
    costUSD: cost.known ? cost.costUsd : 0,
    costKnown: cost.known,
  };

  appendTokenEvent(root, event);

  const report = buildBudgetReport(root, config, sessionId);

  for (const alert of report.alerts) {
    process.stdout.write(alert + '\n');
  }

  if (report.hardStop) {
    // Credit Guardian: record the stop once per session (the hook re-fires on
    // every tool call while exhausted). Event only — no dollar claim is made
    // for prevented spend.
    try {
      const alreadyLogged = readSavingsEntries(root).some(
        (e) => e.type === 'budget_stop' && e.detail.includes(sessionId),
      );
      if (!alreadyLogged) {
        appendSavingsEntry(root, {
          ts: new Date().toISOString(),
          type: 'budget_stop',
          detail: `token budget hard stop [${sessionId}]: ${report.hardStopReason ?? 'budget exhausted'}`,
        });
      }
    } catch {
      // Ledger write is best-effort — never block the stop itself.
    }
    process.stdout.write(
      `\n🛑 Thesmos: ${report.hardStopReason}.\n` +
      `Run \`thesmos tokens:reset --session\` to continue.\n`,
    );
    process.exit(2);
  }

  process.exit(0);
}

function readStdinBudget(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end',  () => resolve(data));
    process.stdin.on('error', reject);
  });
}
