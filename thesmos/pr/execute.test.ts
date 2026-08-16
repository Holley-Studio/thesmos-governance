// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeWave, isAutonomyDisabled, setAutonomy } from './execute.ts';
import { readEntries } from './ledger.ts';

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
    const order: string[] = [];
    const gh: import('./execute.ts').GhRunner = () => {
      const seen = readEntries(root).map((e) => e.phase);
      order.push(...seen);
      order.push('gh');
      return okGh();
    };
    executeWave(root, [{ number: 7, wave: 0 }], { gh, now });

    // At the moment gh was invoked, the ledger already contained exactly the
    // intent row — proving the write happened strictly before the call.
    expect(order).toEqual(['intent', 'gh']);

    const entries = readEntries(root);
    expect(entries[0].phase).toBe('intent');
    expect(entries.at(-1)!.phase).toBe('outcome');
  });

  it('halts the wave on the first failure', () => {
    const gh = (args: string[]) => args.includes('8')
      ? { ok: false, stdout: '', stderr: 'boom' }
      : okGh();

    const result = executeWave(root, [
      { number: 7, wave: 0 }, { number: 8, wave: 0 }, { number: 9, wave: 0 },
    ], { gh, now });

    expect(result.merged).toEqual([7]);
    expect(result.failed).toEqual([8]);
  });

  it('refuses every mutation while autonomy is off', () => {
    setAutonomy(root, false);
    expect(isAutonomyDisabled(root)).toBe(true);

    let called = false;
    executeWave(root, [{ number: 7, wave: 0 }], { gh: () => { called = true; return okGh(); }, now });
    expect(called).toBe(false);
  });

  it('re-arms after setAutonomy(root, true)', () => {
    setAutonomy(root, false);
    expect(isAutonomyDisabled(root)).toBe(true);

    setAutonomy(root, true);
    expect(isAutonomyDisabled(root)).toBe(false);

    let called = false;
    const result = executeWave(root, [{ number: 7, wave: 0 }], {
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

    const result = executeWave(root, [{ number: 7, wave: 0 }], { gh, now });

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
    let calls = 0;
    const gh: import('./execute.ts').GhRunner = () => {
      calls += 1;
      setAutonomy(root, false);
      return okGh();
    };

    const result = executeWave(root, [
      { number: 7, wave: 0 }, { number: 8, wave: 0 },
    ], { gh, now });

    expect(calls).toBe(1);
    expect(result.merged).toEqual([7]);
    expect(result.failed).toEqual([]);
  });
});
