// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The only module that mutates GitHub. gh is injected so tests stay offline.
 * Intent is durable before any call, and a wave halts on first failure —
 * a half-executed wave is worse than one that refused to start.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appendEntry } from './ledger.ts';
import type { PlanEntry } from './plan.ts';

export type GhRunner = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

function sentinel(root: string): string {
  return join(root, '.thesmos', 'autonomy-disabled');
}

export function isAutonomyDisabled(root: string): boolean {
  return existsSync(sentinel(root));
}

export function setAutonomy(root: string, enabled: boolean): void {
  const path = sentinel(root);
  if (enabled) {
    rmSync(path, { force: true });
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'autonomy disabled\n', 'utf8');
  }
}

export function executeWave(
  root: string,
  wave: PlanEntry[],
  deps: { gh: GhRunner; now: () => Date },
): { merged: number[]; failed: number[] } {
  const merged: number[] = [];
  const failed: number[] = [];

  for (const entry of wave) {
    // Checked per-iteration, not once before the loop: the kill switch is billed
    // as absolute, so a mid-wave disable (e.g. a concurrent operator write to the
    // sentinel) must stop the *next* PR, not just refuse waves that start disabled.
    if (isAutonomyDisabled(root)) break;

    appendEntry(root, { action: 'merge', pr: entry.number, phase: 'intent' }, deps.now());

    // GhRunner's type promises a total function that never throws, but nothing
    // enforces that at runtime — a real subprocess wrapper can still throw. Treat
    // a throw the same as a reported failure so the outcome entry is never skipped
    // and the ledger never holds an intent with no matching outcome.
    let result: { ok: boolean; stdout: string; stderr: string };
    try {
      result = deps.gh(['pr', 'merge', String(entry.number), '--squash', '--delete-branch']);
    } catch (err) {
      result = { ok: false, stdout: '', stderr: String(err) };
    }

    appendEntry(root, {
      action: 'merge', pr: entry.number, phase: 'outcome',
      ok: result.ok, detail: result.ok ? undefined : result.stderr.slice(0, 200),
    }, deps.now());

    if (!result.ok) { failed.push(entry.number); break; }
    merged.push(entry.number);
  }

  return { merged, failed };
}
