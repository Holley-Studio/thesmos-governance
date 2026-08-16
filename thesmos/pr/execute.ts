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

/**
 * Looks up the merge commit SHA for a PR that was just merged. Without this,
 * chooseCulprit (thesmos/pr/revert.ts) has nothing to match a failing range
 * against and auto-revert can never fire. Must never fabricate a SHA: a
 * lookup that fails, or returns nothing usable, comes back with mergeCommit
 * unset and a truthful reason in `issue`, never an invented value.
 */
function lookupMergeCommit(gh: GhRunner, prNumber: number): { mergeCommit?: string; issue?: string } {
  try {
    const res = gh(['pr', 'view', String(prNumber), '--json', 'mergeCommit', '--jq', '.mergeCommit.oid']);
    const sha = res.ok ? res.stdout.trim() : '';
    if (sha) return { mergeCommit: sha };
    return {
      issue: res.ok
        ? 'merge commit SHA lookup returned nothing usable'
        : (res.stderr.slice(0, 200) || 'merge commit SHA lookup failed'),
    };
  } catch (err) {
    return { issue: String(err).slice(0, 200) };
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

    // Looked up right after a successful merge, on the same gh-injected seam,
    // so tests stay offline and the SHA lands on this same outcome row.
    const { mergeCommit, issue: shaIssue } = result.ok
      ? lookupMergeCommit(deps.gh, entry.number)
      : {};

    appendEntry(root, {
      action: 'merge', pr: entry.number, phase: 'outcome',
      ok: result.ok,
      mergeCommit,
      detail: result.ok
        ? (shaIssue ? `merged, but ${shaIssue}` : undefined)
        : result.stderr.slice(0, 200),
    }, deps.now());

    if (!result.ok) { failed.push(entry.number); break; }
    merged.push(entry.number);
  }

  return { merged, failed };
}
