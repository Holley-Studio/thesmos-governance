// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * DispatchAdvisor — pre-execution routing/cost advice for Pantheon Chat.
 *
 * Wraps the deterministic `thesmos advise` heuristic (no LLM call, ~instant)
 * and owns the pure decision logic for:
 *   - when to show the Dispatch Order approval card (shouldGate)
 *   - session budget state (budgetState) — display is advisory, enforcement
 *     lives in the chat controller
 *
 * Fail-open by design: any advise failure (missing CLI, timeout, bad JSON)
 * returns null and the prompt dispatches without a gate.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface AdviceAgent {
  key: string;
  emoji: string;
  name: string;
  domain: string;
  score: number;
}

export interface DispatchAdvice {
  classification: {
    mechanicalPct: number;
    creativePct: number;
    architecturePct: number;
    bulkPct: number;
  };
  recommendation: {
    model: string;
    claudeModel: string;
    codexModel: string;
    costMultiple: string;
    rationale: string;
  };
  agents: AdviceAgent[];
}

/** Council-scale threshold for the chat gate outside auto mode. */
const COUNCIL_GATE_MIN_GODS = 2;
/** Budget warn threshold as a fraction of the session ceiling. */
const BUDGET_WARN_FRACTION = 0.8;
/** Kill advise if it hasn't answered in this many ms — the gate is optional. */
const ADVISE_TIMEOUT_MS = 8000;

/** Parse `thesmos advise --json` output. Null on anything malformed. */
export function parseAdvice(raw: string): DispatchAdvice | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const cls = obj.classification as Record<string, unknown> | undefined;
  const rec = obj.recommendation as Record<string, unknown> | undefined;
  if (!cls || !rec) return null;
  if (typeof rec.claudeModel !== 'string' || typeof rec.model !== 'string') return null;
  const agentsRaw = Array.isArray(obj.agents) ? obj.agents : [];
  const agents: AdviceAgent[] = [];
  for (const a of agentsRaw) {
    const ag = a as Record<string, unknown>;
    if (typeof ag.name === 'string' && typeof ag.domain === 'string') {
      agents.push({
        key: typeof ag.key === 'string' ? ag.key : '',
        emoji: typeof ag.emoji === 'string' ? ag.emoji : '🔮',
        name: ag.name,
        domain: ag.domain,
        score: typeof ag.score === 'number' ? ag.score : 0,
      });
    }
  }
  return {
    classification: {
      mechanicalPct: Number(cls.mechanicalPct) || 0,
      creativePct: Number(cls.creativePct) || 0,
      architecturePct: Number(cls.architecturePct) || 0,
      bulkPct: Number(cls.bulkPct) || 0,
    },
    recommendation: {
      model: rec.model,
      claudeModel: rec.claudeModel,
      codexModel: typeof rec.codexModel === 'string' ? rec.codexModel : '',
      costMultiple: typeof rec.costMultiple === 'string' ? rec.costMultiple : '',
      rationale: typeof rec.rationale === 'string' ? rec.rationale : '',
    },
    agents,
  };
}

/**
 * Gate rule:
 *  - auto mode: ALWAYS gate. Auto disarms the per-call permission dialogs, so
 *    the dispatch order is the single up-front human approval for the run.
 *  - other modes: gate only council-scale work (2+ matched gods) — per-call
 *    gates already protect the user; the card adds routing/cost visibility.
 */
export function shouldGate(advice: DispatchAdvice, permissionMode: string): boolean {
  if (permissionMode === 'auto') return true;
  return advice.agents.length >= COUNCIL_GATE_MIN_GODS;
}

/** Session budget state. No budget configured → always 'ok'. */
export function budgetState(
  totalCostUsd: number,
  budgetUsd: number | undefined,
): 'ok' | 'warn' | 'exceeded' {
  if (budgetUsd === undefined || budgetUsd <= 0) return 'ok';
  if (totalCostUsd >= budgetUsd) return 'exceeded';
  if (totalCostUsd >= budgetUsd * BUDGET_WARN_FRACTION) return 'warn';
  return 'ok';
}

/**
 * Invoke `thesmos advise --text=<prompt> --json` and parse the result.
 * Resolution order mirrors godMapper: local .bin shim, then the monorepo CLI.
 * Returns null (never throws) on any failure — the gate is optional.
 */
export function runAdvise(workspaceRoot: string, promptText: string): Promise<DispatchAdvice | null> {
  const binShim = join(
    workspaceRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'thesmos.cmd' : 'thesmos',
  );
  const monorepoCli = join(workspaceRoot, 'thesmos', 'bin', 'cli.ts');

  let command: string;
  let args: string[];
  if (existsSync(binShim)) {
    command = binShim;
    args = ['advise', `--text=${promptText}`, '--json'];
  } else if (existsSync(monorepoCli)) {
    command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    args = ['tsx', monorepoCli, 'advise', `--text=${promptText}`, '--json'];
  } else {
    return Promise.resolve(null);
  }

  return new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      { cwd: workspaceRoot, timeout: ADVISE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolvePromise(null);
          return;
        }
        resolvePromise(parseAdvice(stdout));
      },
    );
  });
}
