// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseCulprit, performRevert } from './revert.ts';
import { appendEntry, readEntries } from './ledger.ts';
import { executeWave, isAutonomyDisabled } from './execute.ts';
import type { GhRunner } from './execute.ts';

let root: string;
const now = () => new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-revert-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

describe('chooseCulprit', () => {
  it('picks the newest Thesmos merge inside the failing range', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    appendEntry(root, { action: 'merge', pr: 2, phase: 'outcome', ok: true, mergeCommit: 'bbb' }, now());

    expect(chooseCulprit(readEntries(root), ['aaa', 'bbb'])!.pr).toBe(2);
  });

  it('returns null when no Thesmos merge is in range', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    expect(chooseCulprit(readEntries(root), ['zzz'])).toBeNull();
  });

  it('ignores a merge that was already reverted', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    appendEntry(root, { action: 'revert', pr: 1, phase: 'outcome', ok: true }, now());
    expect(chooseCulprit(readEntries(root), ['aaa'])).toBeNull();
  });
});

describe('performRevert', () => {
  it('creates the revert PR and then merges it', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const culprit = chooseCulprit(readEntries(root), ['aaa'])!;

    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      // `gh pr revert` prints the URL of the PR it created.
      return { ok: true, stdout: 'https://github.com/o/r/pull/99\n', stderr: '' };
    };

    expect(performRevert(root, culprit, { gh, now })).toBe(true);
    expect(calls[0].slice(0, 3)).toEqual(['pr', 'revert', '1']);
    expect(calls[1].slice(0, 3)).toEqual(['pr', 'merge', '99']);  // the new PR, not the original
  });

  it('records the revert and disables autonomy when the revert itself fails', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const culprit = chooseCulprit(readEntries(root), ['aaa'])!;

    const ok = performRevert(root, culprit, { gh: () => ({ ok: false, stdout: '', stderr: 'no' }), now });

    expect(ok).toBe(false);
    expect(readEntries(root).some((e) => e.action === 'revert' && e.ok === false)).toBe(true);
    // The brief's own assertions above don't check the kill switch directly —
    // only the return value and the ledger row. The governing property is
    // "a failed revert must halt all autonomy," so assert that explicitly
    // rather than relying on it as an unverified side effect.
    expect(isAutonomyDisabled(root)).toBe(true);
  });

  it('disables autonomy when the created revert PR cannot be merged', () => {
    // Distinct from the "creation itself fails" case above: here `gh pr revert`
    // succeeds and prints a URL, but the follow-up `gh pr merge` on that new PR
    // fails (e.g. conflicts). This must fail closed exactly like the first-step
    // failure — autonomy off, a failed outcome recorded — not be treated as a
    // partial success.
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const culprit = chooseCulprit(readEntries(root), ['aaa'])!;

    const gh: GhRunner = (args) =>
      args[1] === 'revert'
        ? { ok: true, stdout: 'https://github.com/o/r/pull/99\n', stderr: '' }
        : { ok: false, stdout: '', stderr: 'merge conflict on revert PR' };

    const ok = performRevert(root, culprit, { gh, now });

    expect(ok).toBe(false);
    expect(isAutonomyDisabled(root)).toBe(true);
    expect(readEntries(root).some((e) => e.action === 'revert' && e.ok === false)).toBe(true);
  });
});

describe('end-to-end: executeWave records a mergeCommit that chooseCulprit can actually match', () => {
  // This is the integration the controller flagged: chooseCulprit filters on
  // `e.mergeCommit`, but nothing proves executeWave ever populates that field
  // outside of a hand-written test fixture. Hand-writing `mergeCommit: 'abc123'`
  // into a ledger entry (as every test above does) proves chooseCulprit's own
  // matching logic, but not that the two modules are actually wired together in
  // production. This test drives a real merge through executeWave with nothing
  // but an injected `gh`, and then hands the resulting ledger straight to
  // chooseCulprit — no shortcuts, no hand-written SHA anywhere in this test.
  it('merges PR 42 through executeWave, then chooseCulprit matches it by the SHA gh reported', () => {
    const gh: GhRunner = (args) => {
      if (args[1] === 'merge') return { ok: true, stdout: '', stderr: '' };
      if (args[1] === 'view') return { ok: true, stdout: 'realsha789abc\n', stderr: '' };
      throw new Error(`unexpected gh call in this test: ${args.join(' ')}`);
    };

    const wave = executeWave(root, [{ number: 42, wave: 0, class: 'reversible' }], { gh, now });
    expect(wave.merged).toEqual([42]);

    const culprit = chooseCulprit(readEntries(root), ['unrelated-sha', 'realsha789abc']);
    expect(culprit).not.toBeNull();
    expect(culprit!.pr).toBe(42);
    expect(culprit!.mergeCommit).toBe('realsha789abc');
  });

  it('does not match a failing range that never contains the recorded SHA', () => {
    const gh: GhRunner = (args) => {
      if (args[1] === 'merge') return { ok: true, stdout: '', stderr: '' };
      if (args[1] === 'view') return { ok: true, stdout: 'realsha789abc\n', stderr: '' };
      throw new Error(`unexpected gh call in this test: ${args.join(' ')}`);
    };

    executeWave(root, [{ number: 42, wave: 0, class: 'reversible' }], { gh, now });

    expect(chooseCulprit(readEntries(root), ['some-other-sha'])).toBeNull();
  });
});
