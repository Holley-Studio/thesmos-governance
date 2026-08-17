// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeWave, isAutonomyDisabled, setAutonomy, type GhRunner } from './execute.ts';
import { readEntries } from './ledger.ts';
import { MERGED_LABEL } from './marks.ts';

let root: string;
const now = () => new Date('2026-08-16T12:00:00Z');
const okGh = () => ({ ok: true, stdout: '', stderr: '' });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-exec-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

describe('executeWave', () => {
  it('writes the intent record before calling gh', () => {
    // Deviation from the brief (controller-approved): the brief's version of this
    // test recorded only 'gh' into `order`, then separately asserted a ledger entry
    // existed — that proves the entry exists by the end, not that it was written
    // *before* gh ran. A ledger write that happened after the gh call would still
    // pass. Here both events land in one shared sequence: the injected `gh` reads
    // the ledger itself and pushes a snapshot of what it sees. If the implementation
    // ever called gh before (or without) writing the intent row, `order` would
    // capture an empty phases list instead of ['intent'], and the assertion below
    // would fail.
    // Filtered to the merge call specifically: executeWave also issues a
    // second `gh pr view` call after a successful merge (to capture the
    // merge commit SHA — see the mergeCommit tests below), and that second
    // call happens after the intent row too. Filtering keeps this test's
    // claim scoped to what it actually proves — intent-before-first-mutation
    // — without coupling it to the unrelated SHA-lookup call count.
    const order: string[] = [];
    const gh: GhRunner = (args) => {
      if (args[1] === 'merge') {
        const seen = readEntries(root).map((e) => e.phase);
        order.push(...seen);
        order.push('gh');
      }
      return okGh();
    };
    executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh, now });

    // At the moment gh was invoked, the ledger already contained exactly the
    // intent row — proving the write happened strictly before the call.
    expect(order).toEqual(['intent', 'gh']);

    const entries = readEntries(root);
    expect(entries[0].phase).toBe('intent');
    expect(entries.at(-1)!.phase).toBe('outcome');
  });

  it('records the reversibility class the planner assigned on both the intent and outcome rows', () => {
    // LedgerEntry.class had no writer at all until this: the field existed,
    // was typed, and was documented, but every row Thesmos ever wrote left it
    // undefined. A record of an unattended merge that cannot say what kind of
    // change it landed is not an audit trail.
    executeWave(root, [{ number: 7, wave: 0, class: 'recoverable' }], { gh: okGh, now });

    const entries = readEntries(root).filter((e) => e.pr === 7);
    expect(entries.map((e) => e.class)).toEqual(['recoverable', 'recoverable']);
  });

  it('halts the wave on the first failure', () => {
    const gh = (args: string[]) => args.includes('8')
      ? { ok: false, stdout: '', stderr: 'boom' }
      : okGh();

    const result = executeWave(root, [
      { number: 7, wave: 0, class: 'reversible' }, { number: 8, wave: 0, class: 'reversible' }, { number: 9, wave: 0, class: 'reversible' },
    ], { gh, now });

    expect(result.merged).toEqual([7]);
    expect(result.failed).toEqual([8]);
  });

  it('refuses every mutation while autonomy is off', () => {
    setAutonomy(root, false);
    expect(isAutonomyDisabled(root)).toBe(true);

    let called = false;
    executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh: () => { called = true; return okGh(); }, now });
    expect(called).toBe(false);
  });

  it('re-arms after setAutonomy(root, true)', () => {
    setAutonomy(root, false);
    expect(isAutonomyDisabled(root)).toBe(true);

    setAutonomy(root, true);
    expect(isAutonomyDisabled(root)).toBe(false);

    let called = false;
    const result = executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], {
      gh: () => { called = true; return okGh(); }, now,
    });
    expect(called).toBe(true);
    expect(result.merged).toEqual([7]);
  });

  it('writes a failed outcome and returns normally when gh throws', () => {
    // GhRunner's type promises it never throws, but nothing enforces that at
    // runtime for a real subprocess-backed implementation. A throw must still
    // leave a resolved outcome row — an intent with no outcome is exactly the
    // ambiguous ledger state the ledger-before-action property exists to avoid.
    const gh = (): never => { throw new Error('gh: command not found'); };

    const result = executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh, now });

    expect(result.merged).toEqual([]);
    expect(result.failed).toEqual([7]);

    const entries = readEntries(root);
    expect(entries).toHaveLength(2);
    expect(entries[0].phase).toBe('intent');
    expect(entries[1].phase).toBe('outcome');
    expect(entries[1].ok).toBe(false);
    expect(entries[1].detail).toContain('gh: command not found');
  });

  it('stops mid-wave the moment autonomy is disabled, not just at wave start', () => {
    // The kill switch is billed as absolute: property 3 says no mutation path
    // may run once autonomy is disabled. A check performed only once before the
    // loop starts would let every remaining PR in an in-flight wave continue
    // even after a concurrent operator disables autonomy. Here the injected gh
    // disables autonomy as a side effect of handling PR 7, then asserts PR 8 is
    // never attempted.
    // Tracks which PR numbers gh was ever invoked for, rather than a raw call
    // count: executeWave's mergeCommit lookup (see below) legitimately calls
    // gh a second time for PR 7 itself, so "gh was called exactly once" is no
    // longer the right proxy for "PR 8 was never touched." The property this
    // test actually guards — nothing after the disable point runs — is
    // exactly what `touched` checks.
    const touched = new Set<string>();
    const gh: GhRunner = (args) => {
      touched.add(args[2]);
      setAutonomy(root, false);
      return okGh();
    };

    const result = executeWave(root, [
      { number: 7, wave: 0, class: 'reversible' }, { number: 8, wave: 0, class: 'reversible' },
    ], { gh, now });

    expect(touched.has('8')).toBe(false);
    expect(result.merged).toEqual([7]);
    expect(result.failed).toEqual([]);
  });
});

describe('executeWave — merge commit capture (chooseCulprit needs this to ever fire)', () => {
  it('records the merge commit SHA after a successful merge', () => {
    const gh: GhRunner = (args) => {
      if (args[1] === 'merge') return okGh();
      if (args[1] === 'view') return { ok: true, stdout: 'deadbeef123\n', stderr: '' };
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    };
    executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh, now });

    const outcome = readEntries(root).find((e) => e.phase === 'outcome')!;
    expect(outcome.mergeCommit).toBe('deadbeef123');
  });

  it('does not attempt a mergeCommit lookup when the merge itself failed', () => {
    let viewCalled = false;
    const gh: GhRunner = (args) => {
      if (args[1] === 'view') viewCalled = true;
      if (args[1] === 'merge') return { ok: false, stdout: '', stderr: 'conflict' };
      return okGh();
    };
    executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh, now });

    expect(viewCalled).toBe(false);
    const outcome = readEntries(root).find((e) => e.phase === 'outcome')!;
    expect(outcome.mergeCommit).toBeUndefined();
  });

  it('records a truthful outcome without fabricating a SHA when the lookup call fails', () => {
    const gh: GhRunner = (args) => {
      if (args[1] === 'merge') return okGh();
      if (args[1] === 'view') return { ok: false, stdout: '', stderr: 'API rate limited' };
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    };
    executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh, now });

    const outcome = readEntries(root).find((e) => e.phase === 'outcome')!;
    // The merge itself succeeded — that must stay true even though the SHA
    // lookup afterward failed. Conflating the two would report a merge as
    // failed when it was not.
    expect(outcome.ok).toBe(true);
    expect(outcome.mergeCommit).toBeUndefined();
    expect(outcome.detail).toBeTruthy();
  });

  it('does not fabricate a SHA when the lookup succeeds but returns nothing usable', () => {
    const gh: GhRunner = (args) => {
      if (args[1] === 'merge') return okGh();
      if (args[1] === 'view') return { ok: true, stdout: '\n', stderr: '' };
      if (args[1] === 'edit') return okGh();
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    };
    executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh, now });

    const outcome = readEntries(root).find((e) => e.phase === 'outcome')!;
    expect(outcome.ok).toBe(true);
    expect(outcome.mergeCommit).toBeUndefined();
  });
});

// ── the mark that makes a merge visible to auto-revert ──────────────────────
//
// The GitHub Action half cannot read the local ledger — the push that would
// publish it is rejected on any repository with a protected default branch.
// It reconstructs its view by asking GitHub which merged pull requests carry
// the Thesmos label instead (thesmos/pr/marks.ts), so a merge this function
// does not label is a merge auto-revert can never undo.

describe('executeWave — marking merges on GitHub so auto-revert can find them', () => {
  it('labels each merged pull request with the Thesmos mark', () => {
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[1] === 'view') return { ok: true, stdout: 'deadbeef\n', stderr: '' };
      return okGh();
    };

    const result = executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh, now });

    expect(result.merged).toEqual([7]);
    expect(result.unmarked).toEqual([]);
    expect(calls).toContainEqual(['pr', 'edit', '7', '--add-label', MERGED_LABEL]);
  });

  it('never labels a pull request whose merge failed', () => {
    const gh: GhRunner = (args) => args[1] === 'merge'
      ? { ok: false, stdout: '', stderr: 'conflict' }
      : okGh();
    const calls: string[][] = [];
    const recording: GhRunner = (args) => { calls.push(args); return gh(args); };

    executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh: recording, now });

    expect(calls.some((c) => c[1] === 'edit')).toBe(false);
  });

  it('reports a merge it could not label without pretending the merge failed', () => {
    // The merge really happened — reporting it as failed would be the worse
    // lie, and would leave the operator believing the change is not on main.
    // But an unlabelled merge is invisible to auto-revert, so it must be
    // surfaced rather than swallowed.
    const gh: GhRunner = (args) => {
      if (args[1] === 'view') return { ok: true, stdout: 'deadbeef\n', stderr: '' };
      if (args[1] === 'edit' || args[0] === 'label') {
        return { ok: false, stdout: '', stderr: 'HTTP 403: Resource not accessible' };
      }
      return okGh();
    };

    const result = executeWave(root, [{ number: 7, wave: 0, class: 'reversible' }], { gh, now });

    expect(result.merged).toEqual([7]);
    expect(result.failed).toEqual([]);
    expect(result.unmarked.map((u) => u.pr)).toEqual([7]);
    expect(result.unmarked[0].detail).toMatch(/403/);

    // The same fact is durable in the ledger, not only in a return value that
    // a caller might drop on the floor.
    const outcome = readEntries(root).find((e) => e.phase === 'outcome')!;
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toMatch(/label/i);
  });

  it('keeps going through the rest of the wave when one label fails', () => {
    // A label failure is not a merge failure, so it must not trigger the
    // halt-on-first-failure rule that governs merges.
    const gh: GhRunner = (args) => {
      if (args[1] === 'view') return { ok: true, stdout: `sha-${args[2]}\n`, stderr: '' };
      if (args[1] === 'edit' && args[2] === '7') return { ok: false, stdout: '', stderr: 'nope' };
      if (args[0] === 'label') return { ok: false, stdout: '', stderr: 'nope' };
      return okGh();
    };

    const result = executeWave(root, [
      { number: 7, wave: 0, class: 'reversible' }, { number: 8, wave: 0, class: 'reversible' },
    ], { gh, now });

    expect(result.merged).toEqual([7, 8]);
    expect(result.unmarked.map((u) => u.pr)).toEqual([7]);
  });
});
