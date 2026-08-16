// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** thesmos pr:* — governed pull-request queue. */
import { spawnSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { fetchPullRequests, renderPlan } from '../../pr/fetch.ts';
import { computePlan } from '../../pr/plan.ts';
import type { GhRunner } from '../../pr/execute.ts';

export const realGh: GhRunner = (args) => {
  const r = spawnSync('gh', args, { encoding: 'utf8' });

  // spawnSync never throws for a missing binary — it reports it via `error`
  // with stdout/stderr left undefined. Left unhandled, that surfaces later
  // as "could not read pull requests: " with no detail, which is a
  // confusing dead end for someone who has never installed the GitHub CLI.
  if (r.error) {
    const isMissing = (r.error as NodeJS.ErrnoException).code === 'ENOENT';
    const hint = isMissing
      ? 'the "gh" command was not found. Install the GitHub CLI from https://cli.github.com and try again.'
      : r.error.message;
    return { ok: false, stdout: '', stderr: hint };
  }

  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

export async function cmdPr(argv: string[]): Promise<void> {
  const [sub] = argv;
  createContext();
  const prs = fetchPullRequests(realGh);
  const plan = computePlan(prs, { defaultBranch: 'main', blockers: new Set(), autonomy: 'recoverable' });

  if (sub === 'explain') {
    const raw = argv[1];
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) {
      process.stdout.write(`  "${raw ?? ''}" is not a pull request number. Try: thesmos pr:explain <number>\n`);
      return;
    }

    const halt = plan.halted.find((h) => h.number === n);
    if (halt) {
      process.stdout.write(`  #${n} — ${halt.detail}\n`);
      return;
    }

    // Distinguish "genuinely ready" from "never heard of it" — telling
    // someone a typo'd or already-closed PR number is ready to merge would
    // be a worse dead end than saying plainly that it was not found.
    if (!prs.some((p) => p.number === n)) {
      process.stdout.write(`  #${n} is not among the ${prs.length} open pull requests I looked at. Run "thesmos pr:queue" to see the current list.\n`);
      return;
    }

    process.stdout.write(`  #${n} is ready to merge.\n`);
    return;
  }

  process.stdout.write(renderPlan(plan, prs));
}
