// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** Reads PR state via gh and renders a plan in plain language. */
import type { GhRunner } from './execute.ts';
import type { MergePlan } from './plan.ts';
import type { PullRequest } from './types.ts';

// statusCheckRollup carries the governance gate's verdict (thesmos/pr/
// blockers.ts) on the same call the planner already makes — no extra
// round-trip per PR.
const FIELDS = 'number,title,isDraft,baseRefName,headRefName,mergeStateStatus,changedFiles,files,statusCheckRollup';

/**
 * How many open PRs a single plan may consider. The old value was 100 with no
 * truncation signal at all, which is the worst shape available here: a PR
 * whose parent fell off the end of the page has an invisible base, and the
 * graph used to promote that to "root" and merge it ahead of its own parent.
 * Raised far past any realistic backlog, and hitting it now refuses to plan
 * rather than planning against a partial graph.
 */
const PR_LIMIT = 1000;

export function fetchPullRequests(gh: GhRunner): PullRequest[] {
  const res = gh(['pr', 'list', '--state', 'open', '--limit', String(PR_LIMIT), '--json', FIELDS]);
  if (!res.ok) {
    const detail = res.stderr.trim() || 'no further detail was given — try running `gh pr list` directly to see the raw error';
    throw new Error(`could not read pull requests: ${detail}`);
  }

  let parsed: Array<Record<string, unknown>>;
  try {
    parsed = JSON.parse(res.stdout) as Array<Record<string, unknown>>;
  } catch {
    throw new Error('could not read pull requests: gh returned output that was not valid JSON');
  }

  if (parsed.length >= PR_LIMIT) {
    throw new Error(
      `there are too many open pull requests for me to plan safely (I can look at ${PR_LIMIT} at a time, and got that many back). ` +
      'Some of them would be invisible to the plan, and a pull request built on an invisible one could be merged out of order. ' +
      'Close or merge some by hand first.',
    );
  }

  return parsed.map((raw) => ({
    number: raw.number as number,
    title: raw.title as string,
    isDraft: raw.isDraft as boolean,
    baseRefName: raw.baseRefName as string,
    headRefName: raw.headRefName as string,
    mergeStateStatus: (raw.mergeStateStatus ?? 'UNKNOWN') as PullRequest['mergeStateStatus'],
    changedFiles: (raw.changedFiles ?? 0) as number,
    files: ((raw.files ?? []) as Array<{ path: string }>).map((f) => f.path),
    checks: (raw.statusCheckRollup ?? []) as PullRequest['checks'],
  }));
}

const PLAIN: Record<string, string> = {
  RED_BASE: 'its checks are failing',
  DIRTY: 'it clashes with main — this one needs you',
  BLOCKER: 'Thesmos found something that must not ship',
  ONE_WAY: 'this change is hard to undo, so it needs your say-so',
  DRAFT: 'still a draft',
  CYCLE: 'these depend on each other in a loop',
  PARENT_BLOCKED: 'it is waiting on another PR',
  OBSOLETE: 'the files it changes no longer exist',
  UNKNOWN_STATE: "GitHub hasn't finished checking this one — try again in a moment",
  UNRESOLVED_BASE: "it is built on a branch I can't see, so I don't know what has to land first",
};

export function renderPlan(plan: MergePlan, prs: PullRequest[]): string {
  const title = new Map(prs.map((p) => [p.number, p.title]));
  // "wave" is internal vocabulary (spec §10 forbids it in user-facing copy).
  // A stacked PR is named by the PR it waits on instead, which is both plainer
  // and strictly more information than the wave index it replaces.
  const parentOf = new Map<number, number>();
  const byHead = new Map(prs.map((p) => [p.headRefName, p.number]));
  for (const p of prs) {
    const parent = byHead.get(p.baseRefName);
    if (parent !== undefined && parent !== p.number) parentOf.set(p.number, parent);
  }

  const lines: string[] = [];
  const ready = plan.waves.flat().length;
  const shown = plan.halted.filter((x) => x.reason !== 'PARENT_BLOCKED');

  lines.push(`  Looked at ${prs.length} open pull requests.`, '');
  if (ready === 0 && shown.length === 0) {
    lines.push('  Nothing to do.');
    return lines.join('\n') + '\n';
  }

  if (ready > 0) {
    lines.push(`  ✓ ${ready} ready to merge`);
    plan.waves.forEach((wave, i) => {
      for (const e of wave) {
        const parent = parentOf.get(e.number);
        const after = i > 0
          ? (parent !== undefined ? `  (goes in after #${parent} lands)` : '  (goes in after the ones above it land)')
          : '';
        lines.push(`      #${e.number}  ${title.get(e.number) ?? ''}${after}`);
      }
    });
    lines.push('');
  }

  for (const h of shown) {
    lines.push(`  ✗ #${h.number} — ${PLAIN[h.reason] ?? h.reason}`);
    if (h.detail) lines.push(`      ${h.detail}`);
    if (h.blocks.length) {
      lines.push(`      nothing built on top of it can move: ${h.blocks.map((b) => `#${b}`).join(', ')}`);
    }
  }

  return lines.join('\n') + '\n';
}
