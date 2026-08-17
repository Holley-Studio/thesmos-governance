// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The workflow file is the one boundary no unit test crosses, and it is where
 * this branch's ninth built-but-never-invoked bug lived: `runWatch` was
 * correct, tested, and wired to a trigger that fired before there was
 * anything to judge. These tests assert the YAML itself, because a watcher
 * with a wrong trigger passes every test it has and still never fires.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const watchYml = read('.github/workflows/thesmos-watch.yml');
const ciYml = read('.github/workflows/ci.yml');

/** The `name:` a workflow publishes — what `workflow_run.workflows` has to match. */
function workflowName(yml: string): string {
  return /^name:[ \t]*(.+)$/m.exec(yml)?.[1].trim() ?? '';
}

describe('thesmos-watch.yml — it must run after checks conclude, not when they start', () => {
  it('triggers on workflow_run completed, not on push', () => {
    // push fires the instant a commit lands, so the watcher raced a
    // multi-minute CI matrix and read "pending" on essentially every real
    // push — and a push event never comes back, so nothing re-examined the
    // commit once CI actually went red.
    expect(watchYml).toMatch(/^on:\n {2}workflow_run:/m);
    expect(watchYml).toMatch(/^ {4}types: \[completed\]$/m);
    expect(watchYml).not.toMatch(/^ {2}push:$/m);
  });

  it('names the CI workflow exactly as CI names itself', () => {
    // `workflows:` is matched by display name. A rename on either side leaves
    // a trigger that never fires and says nothing about it — the same silent
    // shape, arriving through a different door.
    const name = workflowName(ciYml);
    expect(name).not.toBe('');
    expect(watchYml).toContain(`workflows: ["${name}"]`);
  });

  it('judges only the default branch', () => {
    // workflow_run fires for CI runs on every branch, including forks'.
    expect(watchYml).toMatch(/github\.event\.workflow_run\.head_branch == 'main'/);
  });

  it('stands down on a cancelled or skipped CI run instead of reading it as a red main', () => {
    // ci.yml sets cancel-in-progress, so a superseded run concludes
    // "cancelled". A cancelled check run is not a verdict, and acting on one
    // would revert a pull request nothing had actually judged.
    expect(watchYml).toMatch(/conclusion != 'cancelled'/);
    expect(watchYml).toMatch(/conclusion != 'skipped'/);
  });

  it('checks out the commit being judged, not whatever main has become', () => {
    expect(watchYml).toMatch(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  });

  it('tells pr:watch which commit to judge, rather than letting it assume the tip', () => {
    // The load-bearing line. Without --sha, runWatch falls back to the tip of
    // main — which by then may be a commit CI has not finished with, so the
    // watcher would judge the wrong commit's checks.
    expect(watchYml).toMatch(
      /npx tsx thesmos\/bin\/cli\.ts pr:watch[^\n]*--sha \$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
    );
  });

  it('says why ledger commits deliberately never wake it', () => {
    // Ledger/sentinel commits carry [skip ci], so they produce no CI run and
    // therefore no workflow_run event. That is correct — there is nothing to
    // judge — and it is written down so nobody "fixes" it back into a loop.
    expect(watchYml).toMatch(/skip ci/);
  });
});
