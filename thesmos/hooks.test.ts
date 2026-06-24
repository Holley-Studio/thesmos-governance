import { describe, it, expect } from 'vitest';
import {
  hookHasThesmos,
  generateHookBlock,
  buildHookContent,
  injectHookBlock,
  installHooks,
  uninstallHooks,
  getHookStatus,
} from './hooks.ts';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Pure unit tests ───────────────────────────────────────────────────────────

describe('hookHasThesmos', () => {
  it('returns false for empty string', () => {
    expect(hookHasThesmos('')).toBe(false);
  });

  it('returns false for hook without thesmos block', () => {
    expect(hookHasThesmos('#!/usr/bin/env sh\nnpm test\n')).toBe(false);
  });

  it('returns true when thesmos block is present', () => {
    const content = generateHookBlock('pre-commit', 'origin/main');
    expect(hookHasThesmos(content)).toBe(true);
  });
});

describe('generateHookBlock', () => {
  it('includes start and end markers', () => {
    const block = generateHookBlock('pre-commit', 'origin/main');
    expect(block).toContain('# thesmos-governance:start');
    expect(block).toContain('# thesmos-governance:end');
  });

  it('pre-commit block runs ci-check', () => {
    const block = generateHookBlock('pre-commit', 'origin/main');
    expect(block).toContain('thesmos ci-check');
  });

  it('pre-push block runs validate with base ref', () => {
    const block = generateHookBlock('pre-push', 'origin/main');
    expect(block).toContain('thesmos validate');
    expect(block).toContain('origin/main');
  });

  it('uses the provided base ref', () => {
    const block = generateHookBlock('pre-push', 'upstream/develop');
    expect(block).toContain('upstream/develop');
  });
});

describe('buildHookContent', () => {
  it('creates a new file with shebang when no existing content', () => {
    const content = buildHookContent('pre-commit', 'origin/main');
    expect(content).toMatch(/^#!\/usr\/bin\/env sh/);
    expect(content).toContain('thesmos ci-check');
  });

  it('appends to existing hook without shebang duplication', () => {
    const existing = '#!/usr/bin/env sh\nset -e\nnpm test\n';
    const content = buildHookContent('pre-commit', 'origin/main', existing);
    expect((content.match(/#!\/usr\/bin\/env sh/g) ?? []).length).toBe(1);
    expect(content).toContain('npm test');
    expect(content).toContain('thesmos ci-check');
  });

  it('prepends shebang to existing hook that lacks one', () => {
    const existing = 'npm test\n';
    const content = buildHookContent('pre-commit', 'origin/main', existing);
    expect(content).toMatch(/^#!\/usr\/bin\/env sh/);
  });
});

describe('injectHookBlock', () => {
  it('appends block to content that has no existing block', () => {
    const existing = '#!/usr/bin/env sh\nnpm test\n';
    const block = generateHookBlock('pre-commit', 'origin/main');
    const result = injectHookBlock(existing, block);
    expect(result).toContain('npm test');
    expect(result).toContain('thesmos ci-check');
  });

  it('replaces existing block without duplicating', () => {
    const block1 = generateHookBlock('pre-commit', 'origin/main');
    const block2 = generateHookBlock('pre-push', 'origin/main'); // different hook
    const withFirst = injectHookBlock('#!/usr/bin/env sh\n', block1);
    const withSecond = injectHookBlock(withFirst, block2);
    // Should only have one start marker
    expect((withSecond.match(/# thesmos-governance:start/g) ?? []).length).toBe(1);
  });
});

// ── I/O tests using temp directories ─────────────────────────────────────────

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'thesmos-hooks-'));
  // Create minimal .git directory
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

function cleanupTemp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('installHooks (I/O)', () => {
  it('creates pre-commit and pre-push hooks', () => {
    const dir = makeTempRepo();
    try {
      const results = installHooks(dir, { target: 'git', base: 'origin/main' });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.hook)).toContain('pre-commit');
      expect(results.map((r) => r.hook)).toContain('pre-push');
      expect(results.map((r) => r.status)).toEqual(['created', 'created']);
    } finally {
      cleanupTemp(dir);
    }
  });

  it('is idempotent — running twice marks hooks as already-configured', () => {
    const dir = makeTempRepo();
    try {
      installHooks(dir, { target: 'git', base: 'origin/main' });
      const second = installHooks(dir, { target: 'git', base: 'origin/main' });
      expect(second.every((r) => r.status === 'already-configured')).toBe(true);
    } finally {
      cleanupTemp(dir);
    }
  });

  it('dry-run does not write files', () => {
    const dir = makeTempRepo();
    try {
      installHooks(dir, { target: 'git', dryRun: true });
      const status = getHookStatus(dir, 'git');
      expect(status.every((s) => !s.hasThesmos)).toBe(true);
    } finally {
      cleanupTemp(dir);
    }
  });

  it('preserves existing hook content', () => {
    const dir = makeTempRepo();
    try {
      const hookFile = join(dir, '.git', 'hooks', 'pre-commit');
      writeFileSync(hookFile, '#!/usr/bin/env sh\necho "existing"\n', 'utf8');
      installHooks(dir, { target: 'git', base: 'origin/main', hooks: ['pre-commit'] });
      const content = readFileSync(hookFile, 'utf8');
      expect(content).toContain('echo "existing"');
      expect(content).toContain('thesmos ci-check');
    } finally {
      cleanupTemp(dir);
    }
  });
});

describe('uninstallHooks (I/O)', () => {
  it('removes thesmos block from hooks', () => {
    const dir = makeTempRepo();
    try {
      installHooks(dir, { target: 'git', base: 'origin/main' });
      const results = uninstallHooks(dir, { target: 'git' });
      expect(results.map((r) => r.status)).toEqual(['updated', 'updated']);
      const status = getHookStatus(dir, 'git');
      expect(status.every((s) => !s.hasThesmos)).toBe(true);
    } finally {
      cleanupTemp(dir);
    }
  });

  it('skips hooks that have no thesmos block', () => {
    const dir = makeTempRepo();
    try {
      const results = uninstallHooks(dir, { target: 'git' });
      expect(results.every((r) => r.status === 'skipped')).toBe(true);
    } finally {
      cleanupTemp(dir);
    }
  });
});

describe('getHookStatus', () => {
  it('returns false for missing hooks', () => {
    const dir = makeTempRepo();
    try {
      const status = getHookStatus(dir, 'git');
      expect(status.every((s) => !s.exists && !s.hasThesmos)).toBe(true);
    } finally {
      cleanupTemp(dir);
    }
  });

  it('detects thesmos block after install', () => {
    const dir = makeTempRepo();
    try {
      installHooks(dir, { target: 'git' });
      const status = getHookStatus(dir, 'git');
      expect(status.every((s) => s.exists && s.hasThesmos)).toBe(true);
    } finally {
      cleanupTemp(dir);
    }
  });
});
