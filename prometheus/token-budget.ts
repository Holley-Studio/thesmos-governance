/**
 * Token Budget Governance — AI cost tracking and enforcement for Claude Code sessions.
 *
 * PostToolUse hook captures token usage from every Claude Code tool call,
 * writes append-only event log to .prometheus/token-usage.jsonl, and enforces
 * configurable session/daily/project budgets with alerts and hard stops.
 *
 * Integration:
 *   - PostToolUse hook in .claude/settings.json → `prometheus claude:govern check`
 *   - Checks happen after each tool call; hard-stop exits 2 to block further use
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
  /** Cost per 1M tokens by model ID. */
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
  modelCostTable: {
    // Canonical SDK model IDs (claude-<family>-<version>)
    'claude-sonnet-4-6':              { inputPer1M: 3.00,  outputPer1M: 15.00 },
    'claude-opus-4-8':                { inputPer1M: 15.00, outputPer1M: 75.00 },
    'claude-haiku-4-5-20251001':      { inputPer1M: 0.25,  outputPer1M: 1.25  },
    'claude-opus-4-5':                { inputPer1M: 15.00, outputPer1M: 75.00 },
    'claude-sonnet-4-5':              { inputPer1M: 3.00,  outputPer1M: 15.00 },
    // Legacy API date-suffixed model IDs reported by some Claude Code versions
    'claude-3-5-sonnet-20241022':     { inputPer1M: 3.00,  outputPer1M: 15.00 },
    'claude-3-5-sonnet-20240620':     { inputPer1M: 3.00,  outputPer1M: 15.00 },
    'claude-3-opus-20240229':         { inputPer1M: 15.00, outputPer1M: 75.00 },
    'claude-3-5-haiku-20241022':      { inputPer1M: 0.80,  outputPer1M: 4.00  },
    'claude-3-haiku-20240307':        { inputPer1M: 0.25,  outputPer1M: 1.25  },
    'claude-opus-4-5-20251101':       { inputPer1M: 15.00, outputPer1M: 75.00 },
    'claude-sonnet-4-5-20251101':     { inputPer1M: 3.00,  outputPer1M: 15.00 },
  },
};

// ── Token usage event (one line in .prometheus/token-usage.jsonl) ─────────────

export interface TokenEvent {
  ts: string;
  sessionId: string;
  toolName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

// ── File paths ────────────────────────────────────────────────────────────────

const USAGE_LOG = '.prometheus/token-usage.jsonl';
const SESSION_ID_FILE = '.prometheus/token-session-id';

// ── Cost calculation ──────────────────────────────────────────────────────────

export function calcCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  costTable: Record<string, ModelCost>,
): number {
  const costs = costTable[model] ?? costTable['claude-sonnet-4-6'] ?? { inputPer1M: 3.00, outputPer1M: 15.00 };
  return (inputTokens * costs.inputPer1M + outputTokens * costs.outputPer1M) / 1_000_000;
}

// ── Event log ─────────────────────────────────────────────────────────────────

export function appendTokenEvent(root: string, event: TokenEvent): void {
  const logPath = join(root, USAGE_LOG);
  mkdirSync(join(root, '.prometheus'), { recursive: true });
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
  mkdirSync(join(root, '.prometheus'), { recursive: true });
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

  const alerts: string[] = [];
  let hardStop = false;
  let hardStopReason: string | null = null;

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

  return { session, today, project, alerts, hardStop, hardStopReason };
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
  const model        = hookData.model ?? 'claude-sonnet-4-6';
  const toolName     = hookData.tool_name ?? 'unknown';
  const sessionId    = hookData.session_id ?? getCurrentSessionId(root);

  const costUSD = calcCost(model, inputTokens, outputTokens, config.modelCostTable);

  const event: TokenEvent = {
    ts: new Date().toISOString(),
    sessionId,
    toolName,
    model,
    inputTokens,
    outputTokens,
    costUSD,
  };

  appendTokenEvent(root, event);

  const report = buildBudgetReport(root, config, sessionId);

  for (const alert of report.alerts) {
    process.stdout.write(alert + '\n');
  }

  if (report.hardStop) {
    process.stdout.write(
      `\n🛑 Prometheus: ${report.hardStopReason}.\n` +
      `Run \`prometheus tokens:reset --session\` to continue.\n`,
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
