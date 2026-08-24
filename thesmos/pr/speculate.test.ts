// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { mayConflict, pairsToVerify, verifyProjected } from './speculate.ts';
import type { PullRequest } from './types.ts';

function pr(number: number, files: string[]): PullRequest {
  return {
    number, title: `p${number}`, isDraft: false, baseRefName: 'main', headRefName: `h${number}`,
    mergeStateStatus: 'CLEAN', changedFiles: files.length, files, checks: [],
  };
}

describe('mayConflict', () => {
  it('is true when the changed-file sets intersect', () => {
    expect(mayConflict(pr(1, ['src/a.ts']), pr(2, ['src/a.ts', 'src/b.ts']))).toBe(true);
  });

  it('is false for disjoint file sets', () => {
    expect(mayConflict(pr(1, ['src/a.ts']), pr(2, ['docs/x.md']))).toBe(false);
  });
});

describe('pairsToVerify', () => {
  it('returns only intersecting pairs', () => {
    const pairs = pairsToVerify([pr(1, ['a.ts']), pr(2, ['b.ts']), pr(3, ['a.ts'])]);
    expect(pairs).toEqual([[1, 3]]);
  });
});

describe('verifyProjected', () => {
  it('reports the PR at which the projected tree first breaks', () => {
    // Projection order is main -> 1 -> 2; the tree breaks once 2 is applied.
    const run = (args: string[]) => {
      const merging2 = args.includes('h2');
      if (args[0] === 'merge') return { ok: true, stdout: '', stderr: '' };
      return { ok: !merging2, stdout: '', stderr: merging2 ? 'type error' : '' };
    };
    const result = verifyProjected('/tmp/x', [pr(1, ['a.ts']), pr(2, ['a.ts'])], { run });
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe(2);
  });

  it('passes when every projected state is green', () => {
    const result = verifyProjected('/tmp/x', [pr(1, ['a.ts']), pr(2, ['a.ts'])], {
      run: () => ({ ok: true, stdout: '', stderr: '' }),
    });
    expect(result.ok).toBe(true);
  });
});
