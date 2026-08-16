// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** Reads PR state via gh and renders a plan in plain language. */
import type { GhRunner } from './execute.ts';
import type { MergePlan } from './plan.ts';
import type { PullRequest } from './types.ts';

const FIELDS = 'number,title,isDraft,baseRefName,headRefName,mergeStateStatus,changedFiles,files';

export function fetchPullRequests(gh: GhRunner): PullRequest[] {
  const res = gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', FIELDS]);
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

  return parsed.map((raw) => ({
    number: raw.number as number,
    title: raw.title as string,
    isDraft: raw.isDraft as boolean,
    baseRefName: raw.baseRefName as string,
    headRefName: raw.headRefName as string,
    mergeStateStatus: (raw.mergeStateStatus ?? 'UNKNOWN') as PullRequest['mergeStateStatus'],
    changedFiles: (raw.changedFiles ?? 0) as number,
    files: ((raw.files ?? []) as Array<{ path: string }>).map((f) => f.path),
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
};

export function renderPlan(plan: MergePlan, prs: PullRequest[]): string {
  const title = new Map(prs.map((p) => [p.number, p.title]));
  const lines: string[] = [];
  const ready = plan.waves.flat().length;

  lines.push(`  Looked at ${prs.length} open pull requests.`, '');
  if (ready > 0) {
    lines.push(`  ✓ ${ready} ready to merge`);
    plan.waves.forEach((wave, i) => {
      for (const e of wave) lines.push(`      #${e.number}  ${title.get(e.number) ?? ''}${i > 0 ? `  (after wave ${i})` : ''}`);
    });
    lines.push('');
  }

  for (const h of plan.halted.filter((x) => x.reason !== 'PARENT_BLOCKED')) {
    lines.push(`  ✗ #${h.number} — ${PLAIN[h.reason] ?? h.reason}`);
    if (h.detail) lines.push(`      ${h.detail}`);
    if (h.blocks.length) {
      lines.push(`      nothing built on top of it can move: ${h.blocks.map((b) => `#${b}`).join(', ')}`);
    }
  }

  return lines.join('\n') + '\n';
}
