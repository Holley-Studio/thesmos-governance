// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The only module that mutates GitHub. gh is injected so tests stay offline.
 * Intent is durable before any call, and a wave halts on first failure —
 * a half-executed wave is worse than one that refused to start.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  if (enabled) rmSync(sentinel(root), { force: true });
  else writeFileSync(sentinel(root), 'autonomy disabled\n', 'utf8');
}

export function executeWave(
  root: string,
  wave: PlanEntry[],
  deps: { gh: GhRunner; now: () => Date },
): { merged: number[]; failed: number[] } {
  const merged: number[] = [];
  const failed: number[] = [];
  if (isAutonomyDisabled(root)) return { merged, failed };

  for (const entry of wave) {
    appendEntry(root, { action: 'merge', pr: entry.number, phase: 'intent' }, deps.now());

    const result = deps.gh(['pr', 'merge', String(entry.number), '--squash', '--delete-branch']);

    appendEntry(root, {
      action: 'merge', pr: entry.number, phase: 'outcome',
      ok: result.ok, detail: result.ok ? undefined : result.stderr.slice(0, 200),
    }, deps.now());

    if (!result.ok) { failed.push(entry.number); break; }
    merged.push(entry.number);
  }

  return { merged, failed };
}
