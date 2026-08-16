// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { classify, parseBump } from './classify.ts';
import type { PullRequest } from './types.ts';

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1, title: 'chore(deps): bump left-pad from 1.0.0 to 1.0.1',
    isDraft: false, baseRefName: 'main', headRefName: 'dep', mergeStateStatus: 'CLEAN',
    changedFiles: 2, files: ['package.json', 'package-lock.json'], ...over,
  };
}

describe('parseBump', () => {
  it('reads semver deltas out of Dependabot titles', () => {
    expect(parseBump('bump x from 1.0.0 to 1.0.1')).toBe('patch');
    expect(parseBump('bump x from 1.0.0 to 1.1.0')).toBe('minor');
    expect(parseBump('bump x from 1.0.0 to 2.0.0')).toBe('major');
    expect(parseBump('feat: unrelated title')).toBe('unknown');
  });
});

describe('classify', () => {
  it('treats a lockfile patch bump as reversible', () => {
    expect(classify(pr()).class).toBe('reversible');
  });

  it('rejects an empty patch bump as one-way (vacuous truth guard)', () => {
    const result = classify(pr({ files: [], title: 'chore(deps): bump x from 1.0.0 to 1.0.1' }));
    expect(result.class).toBe('one-way');
    expect(result.reason).not.toMatch(/lockfile/);
  });

  it('treats a minor bump as recoverable', () => {
    const result = classify(pr({ title: 'chore(deps): bump lodash from 4.17.0 to 4.18.0' }));
    expect(result.class).toBe('recoverable');
    expect(result.reason).toMatch(/minor/i);
  });

  it('treats a major bump as one-way even when green', () => {
    const result = classify(pr({ title: 'chore(deps): bump chokidar from 4.0.3 to 5.0.0' }));
    expect(result.class).toBe('one-way');
    expect(result.reason).toMatch(/major/i);
  });

  it('treats anything touching auth or payments as one-way', () => {
    expect(classify(pr({ files: ['src/auth/session.ts'] })).class).toBe('one-way');
  });

  it('treats release and publish machinery as one-way', () => {
    expect(classify(pr({ files: ['.github/workflows/release.yml'] })).class).toBe('one-way');
  });

  it('resolves an unrecognised change to one-way rather than guessing', () => {
    const result = classify(pr({ title: 'wat', files: ['src/mystery.ts'] }));
    expect(result.class).toBe('one-way');
  });

  it('treats a docs-only change as recoverable', () => {
    expect(classify(pr({ title: 'docs: readme', files: ['README.md'] })).class).toBe('recoverable');
  });
});
