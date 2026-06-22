/**
 * Prometheus Brain Store — .prometheus/brain.json schema and CRUD.
 *
 * Accumulates governance data locally (zero API calls):
 *   - Rule firing frequency and suppression rates
 *   - Detected tech stack and file patterns
 *   - Session history for trend analysis
 *   - Human-approved custom rule proposals
 *
 * `brain:observe` writes to brain.json.
 * `brain:learn`   reads from brain.json and sends a compact summary to Claude API.
 * `brain:report`  reads and displays brain.json without any API call.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeLogger } from './logger.js';

const log = makeLogger('brain-store');

export const BRAIN_STORE_PATH = '.prometheus/brain.json';
export const BRAIN_STORE_DIR = '.prometheus';

// ── Schema ────────────────────────────────────────────────────────────────────

export interface ProposedRule {
  id: string;        // e.g. CUSTOM_001
  name: string;
  description: string;
  severity: string;
  pattern: string;   // regex or description of the pattern
  rationale: string;
  status: 'pending' | 'approved' | 'rejected';
  proposedAt: string;
}

export interface ProposedAgent {
  name: string;
  purpose: string;
  trigger: string;
  rationale: string;
  status: 'pending' | 'approved' | 'rejected';
  proposedAt: string;
}

export interface RuleEffectiveness {
  fires: number;
  suppressed: number;
  fixed: number;
  firstSeen: string;
  lastSeen: string;
}

export interface SessionRecord {
  date: string;
  findings: number;
  rulesSkipped: number;
  newSuppressions: number;
}

export interface BrainStore {
  version: string;
  updatedAt: string;
  suppressions: Record<string, {
    count: number;
    reasons: string[];
    files: string[];
    lastSuppressed: string;
  }>;
  ruleEffectiveness: Record<string, RuleEffectiveness>;
  detectedStack: string[];
  frequentFileTypes: string[];
  highSuppressRules: string[];
  proposedRules: ProposedRule[];
  proposedAgents: ProposedAgent[];
  sessions: SessionRecord[];
  learnEnabled: boolean;
  maxTokensPerRun: number;
  maxCostUsdPerRun: number;
  model: string;
}

const DEFAULT_STORE: BrainStore = {
  version: '1',
  updatedAt: new Date().toISOString(),
  suppressions: {},
  ruleEffectiveness: {},
  detectedStack: [],
  frequentFileTypes: [],
  highSuppressRules: [],
  proposedRules: [],
  proposedAgents: [],
  sessions: [],
  learnEnabled: true,
  maxTokensPerRun: 50000,
  maxCostUsdPerRun: 0.50,
  model: 'claude-haiku-4-5-20251001',
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function loadBrainStore(root: string): BrainStore {
  const path = join(root, BRAIN_STORE_PATH);
  if (!existsSync(path)) return { ...DEFAULT_STORE };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<BrainStore>;
    return { ...DEFAULT_STORE, ...raw };
  } catch (e) {
    log.warn('brain.json corrupt, starting fresh', { error: e instanceof Error ? e.message : String(e) });
    return { ...DEFAULT_STORE };
  }
}

export function saveBrainStore(root: string, store: BrainStore): void {
  const dir = join(root, BRAIN_STORE_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(root, BRAIN_STORE_PATH);
  store.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(store, null, 2) + '\n', 'utf-8');
  log.debug('brain store saved', { path });
}

// ── Observation ───────────────────────────────────────────────────────────────

export interface ObservationInput {
  scanFindings: Array<{ ruleId?: string; rule?: string; category?: string; file?: string; severity?: string }>;
  suppressionsFile?: string; // path to suppressions.json
  rulesSkipped?: number;
  stack?: string[];
}

export function observeIntoStore(root: string, input: ObservationInput): BrainStore {
  const store = loadBrainStore(root);

  // Update rule effectiveness
  for (const finding of input.scanFindings) {
    const ruleId = finding.ruleId ?? finding.rule ?? finding.category ?? 'unknown';
    if (!store.ruleEffectiveness[ruleId]) {
      store.ruleEffectiveness[ruleId] = {
        fires: 0, suppressed: 0, fixed: 0,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
    }
    store.ruleEffectiveness[ruleId]!.fires++;
    store.ruleEffectiveness[ruleId]!.lastSeen = new Date().toISOString();
  }

  // Update suppressions from file
  if (input.suppressionsFile && existsSync(input.suppressionsFile)) {
    try {
      const raw = JSON.parse(readFileSync(input.suppressionsFile, 'utf-8')) as Record<string, { reason?: string; file?: string }>;
      for (const [ruleId, entry] of Object.entries(raw)) {
        if (!store.suppressions[ruleId]) {
          store.suppressions[ruleId] = { count: 0, reasons: [], files: [], lastSuppressed: new Date().toISOString() };
        }
        store.suppressions[ruleId]!.count++;
        if (entry.reason && !store.suppressions[ruleId]!.reasons.includes(entry.reason)) {
          store.suppressions[ruleId]!.reasons.push(entry.reason);
        }
        if (entry.file && !store.suppressions[ruleId]!.files.includes(entry.file)) {
          store.suppressions[ruleId]!.files.push(entry.file);
        }
        store.suppressions[ruleId]!.lastSuppressed = new Date().toISOString();
        // Update ruleEffectiveness suppressed count
        if (store.ruleEffectiveness[ruleId]) {
          store.ruleEffectiveness[ruleId]!.suppressed++;
        }
      }
    } catch {
      // ignore malformed suppressions
    }
  }

  // Compute high-suppress rules (suppression rate > 50%)
  store.highSuppressRules = Object.entries(store.ruleEffectiveness)
    .filter(([, eff]) => eff.fires > 0 && eff.suppressed / eff.fires > 0.5)
    .map(([id]) => id);

  // Update stack
  if (input.stack && input.stack.length > 0) {
    store.detectedStack = [...new Set([...store.detectedStack, ...input.stack])];
  }

  // Add session record
  store.sessions.push({
    date: new Date().toISOString(),
    findings: input.scanFindings.length,
    rulesSkipped: input.rulesSkipped ?? 0,
    newSuppressions: Object.keys(store.suppressions).length,
  });
  // Keep only last 100 sessions
  if (store.sessions.length > 100) {
    store.sessions = store.sessions.slice(-100);
  }

  saveBrainStore(root, store);
  return store;
}

// ── Report formatter ──────────────────────────────────────────────────────────

export function formatBrainReport(store: BrainStore): string {
  const lines: string[] = [
    '\n  Prometheus Brain Report',
    `  Updated: ${new Date(store.updatedAt).toLocaleString()}`,
    `  Model: ${store.model}  ·  Max tokens/run: ${store.maxTokensPerRun.toLocaleString()}  ·  Max cost/run: $${store.maxCostUsdPerRun}`,
    `  Brain:learn: ${store.learnEnabled ? 'enabled' : 'disabled'}`,
    '',
  ];

  const totalSessions = store.sessions.length;
  const totalFindings = store.sessions.reduce((s, r) => s + r.findings, 0);
  lines.push(`  Sessions tracked: ${totalSessions}  ·  Total findings: ${totalFindings}`);

  if (store.detectedStack.length > 0) {
    lines.push(`  Detected stack: ${store.detectedStack.join(', ')}`);
  }

  if (store.highSuppressRules.length > 0) {
    lines.push('');
    lines.push('  High false-positive rules (suppression rate > 50%):');
    for (const ruleId of store.highSuppressRules) {
      const eff = store.ruleEffectiveness[ruleId];
      if (eff) {
        const rate = Math.round((eff.suppressed / eff.fires) * 100);
        lines.push(`    ${ruleId} — ${eff.fires} fires, ${eff.suppressed} suppressed (${rate}%)`);
      }
    }
  }

  if (store.proposedRules.length > 0) {
    const pending = store.proposedRules.filter((r) => r.status === 'pending');
    if (pending.length > 0) {
      lines.push('');
      lines.push(`  Pending rule proposals (${pending.length}):`);
      for (const r of pending) {
        lines.push(`    ${r.id}: "${r.name}" — ${r.description.slice(0, 80)}`);
      }
      lines.push('  Review: prometheus brain:evolve --approve=<ID>');
    }
  }

  if (store.proposedAgents.length > 0) {
    const pending = store.proposedAgents.filter((a) => a.status === 'pending');
    if (pending.length > 0) {
      lines.push('');
      lines.push(`  Pending agent proposals (${pending.length}):`);
      for (const a of pending) {
        lines.push(`    "${a.name}" — ${a.purpose.slice(0, 80)}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}
