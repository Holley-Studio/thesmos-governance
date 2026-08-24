// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The governance severity gate — the connection between Thesmos's rule engine
 * and merge authority (spec §2). computePlan's `blockers` set was passed
 * `new Set()` at both call sites, so the BLOCKER halt in plan.ts was dead
 * code and `pr:merge` was an ordinary merge queue wearing the word
 * "governed"; fetch.ts even carried a plain-language BLOCKER string that
 * could never print.
 *
 * WHAT THIS COVERS. A PR is a BLOCKER when the Thesmos governance check on
 * its head commit has *concluded* with a failing verdict. That check is the
 * `thesmos-pr.yml` workflow (`actions/pr-review`, `fail-on-severity:
 * BLOCKER`), which runs the full rule registry against a complete checkout of
 * the PR and fails only on BLOCKER-severity findings. Its verdict arrives on
 * the same `gh pr list` call the planner already makes, via
 * `statusCheckRollup` — no extra network round-trip per PR.
 *
 * WHY IT IS READ, NOT RECOMPUTED. Running the rules locally is not an option
 * in Phase 1: the working tree holds the default branch, not the PR, so a
 * local scan would evaluate the wrong content and report confidently about
 * files the PR does not contain. Getting the PR's own content means either
 * fetching every changed file over the API (hundreds of calls for a real
 * backlog) or checking each PR out — the same missing "real git runner" that
 * keeps speculate.ts unwired. Reading the verdict CI already computed against
 * the real head is both cheaper and more accurate than either.
 *
 * WHAT THIS DOES NOT COVER — read this before trusting the word "governed":
 *
 *  1. NO CHECK, NO GATE. If the repo has no Thesmos governance workflow, or
 *     it has not run on a PR yet, nothing is reported and the PR is planned
 *     on its other merits. This is deliberately fail-open, because failing
 *     closed would halt every PR in every repo that has not installed the
 *     workflow. It is also the way this gate could silently become inert, so
 *     `governanceCoverage` exists to let the caller say out loud when no PR
 *     reported a governance check at all. An empty blocker set must never be
 *     rendered as "governance passed".
 *  2. HEAD, NOT MERGE RESULT. Spec §5.2 item 4 asks for zero BLOCKERs in the
 *     *merge result*. This is the verdict on the PR head. A BLOCKER that only
 *     appears once two PRs are combined is not caught here — that is the same
 *     projected-state problem speculate.ts describes, and it is equally
 *     unwired.
 *  3. THE THRESHOLD IS THE WORKFLOW'S. If a repo sets `fail-on-severity` to
 *     HIGH, a HIGH finding fails the check and lands here as a BLOCKER halt.
 *     Thesmos reports what the repo configured, not what this module assumes.
 *  4. IDENTIFIED BY NAME. The governance check is recognised by "thesmos" or
 *     "governance" appearing in its check name, workflow name, or legacy
 *     status context. A repo that renames it to neither word is covered by
 *     point 1, not by an error.
 */
import type { CheckContext, PullRequest } from './types.ts';

/**
 * Matched against name + workflowName + context together. Broad on purpose:
 * the shipped workflow is "Thesmos Governance PR Review" with a job named
 * "Governance Review", so either word alone is enough to recognise it even if
 * one of the two is renamed.
 */
const GOVERNANCE_CHECK = /thesmos|governance/i;

/**
 * Verdicts that mean the gate ran and refused. `null`/absent (still running),
 * SUCCESS, NEUTRAL, SKIPPED and CANCELLED are all "no refusal recorded" — a
 * cancelled run reached no verdict, and treating it as a BLOCKER would halt
 * merges every time someone cancels a workflow.
 */
const REFUSED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

function isGovernanceCheck(c: CheckContext): boolean {
  return GOVERNANCE_CHECK.test(`${c.name ?? ''} ${c.workflowName ?? ''} ${c.context ?? ''}`);
}

/** PR numbers whose Thesmos governance check has concluded with a refusal. */
export function deriveBlockers(prs: PullRequest[]): Set<number> {
  const blocked = new Set<number>();
  for (const pr of prs) {
    for (const check of pr.checks) {
      if (!isGovernanceCheck(check)) continue;
      const verdict = (check.conclusion ?? check.state ?? '').toUpperCase();
      if (REFUSED.has(verdict)) { blocked.add(pr.number); break; }
    }
  }
  return blocked;
}

/**
 * How many of these PRs reported a governance check of any verdict. `seen: 0`
 * on a non-empty list means the gate had nothing to read — the caller must
 * surface that rather than let silence pass for approval. See point 1 above.
 */
export function governanceCoverage(prs: PullRequest[]): { seen: number; total: number } {
  return { seen: prs.filter((p) => p.checks.some(isGovernanceCheck)).length, total: prs.length };
}
