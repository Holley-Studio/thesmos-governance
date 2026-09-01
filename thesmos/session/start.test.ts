// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * `session-start` handler tests.
 *
 * Two layers, deliberately:
 *
 *  - `buildSessionStartPayload` is pure — tested directly, in-process.
 *  - `runSessionStart`'s three hard constraints (never `process.exit()` after
 *    writing hook JSON; fail-open including under `autoMode.failClosed:
 *    true`; exit-0-plus-JSON never mixed with exit-code-alone signaling) are
 *    properties of the WHOLE process, not of any function's return value. A
 *    test that only calls `runSessionStart()` in-process and inspects its
 *    resolved value would pass even if the implementation called
 *    `process.exit(0)` — inside a single vitest worker, the process never
 *    gets the chance to actually exit. So the exit-code assertions below
 *    spawn the real built guard binary (`dist/thesmos-guard.js`), following
 *    the pattern already established in `guard.cross-platform.test.ts`.
 *
 * Deliberately NOT tested here: the async-stdout-pipe truncation race itself
 * (see the module docstring in `start.ts` and `emitAskDecision` in
 * `claude-govern.ts`). It is not reliably reproducible as a fast, non-flaky
 * unit test; inspection — no `process.exit()` call anywhere in this module's
 * source — is the honest verification for that specific hazard.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Mocked so one test (below) can force `gatherFreshnessInputs` to throw. The
// default implementation calls through to the real function via `vi.fn(actual)`,
// so every other test — including the payload tests above, which never call
// `runSessionStart` at all — is unaffected.
vi.mock('./gather.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gather.js')>();
  return { ...actual, gatherFreshnessInputs: vi.fn(actual.gatherFreshnessInputs) };
});

import { buildSessionStartPayload, runSessionStart } from './start.js';
import { gatherFreshnessInputs } from './gather.js';

describe('buildSessionStartPayload', () => {
  it('emits the SessionStart hookSpecificOutput envelope', () => {
    const parsed = JSON.parse(buildSessionStartPayload('hello'));
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toBe('hello');
  });

  it('produces valid JSON for context containing quotes and newlines', () => {
    const tricky = 'a "quoted" thing\nand a newline \\ backslash';
    expect(JSON.parse(buildSessionStartPayload(tricky)).hookSpecificOutput.additionalContext)
      .toBe(tricky);
  });
});

// ── Real-process exit-code discipline ───────────────────────────────────────
//
// Mirrors guard.cross-platform.test.ts: spawn the actual built guard so a
// regression that swaps `process.exitCode = 0` for `process.exit(0)`, or
// deletes the outer try/catch so a thrown error escapes, shows up here as a
// nonzero exit code or a crash — neither of which an in-process call to
// `runSessionStart` can observe.

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD_ENTRY = join(HERE, '..', 'dist', 'thesmos-guard.js');

function tmpRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'a');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
}

function runGuardSessionStart(
  cwd: string,
  stdin = '',
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [GUARD_ENTRY, 'session-start'], {
    cwd,
    input: stdin,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Passes if stdout is either empty, or exactly one complete, parseable JSON
 * value. The failure mode this guards against is a truncated fragment left
 * behind by a `process.exit()` that raced an in-flight write.
 */
function expectCleanStdout(stdout: string): void {
  if (stdout.trim().length === 0) return;
  expect(() => JSON.parse(stdout.trim())).not.toThrow();
}

describe('runSessionStart — real-process exit code (subprocess)', () => {
  beforeAll(() => {
    if (!existsSync(GUARD_ENTRY)) {
      throw new Error(
        `Missing ${GUARD_ENTRY}. Run \`npm run build\` in thesmos/ before these tests.`,
      );
    }
  });

  it('exits 0 in a valid, freshly-committed git repo', () => {
    const dir = tmpRoot('thesmos-session-start-repo-');
    try {
      initGitRepo(dir);
      const result = runGuardSessionStart(dir);
      expect(result.status).toBe(0);
      expectCleanStdout(result.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 in a directory that is not a git repository at all', () => {
    const dir = tmpRoot('thesmos-session-start-nogit-');
    try {
      const result = runGuardSessionStart(dir);
      expect(result.status).toBe(0);
      expectCleanStdout(result.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 with a malformed .thesmos/config.json, never a truncated stdout fragment', () => {
    const dir = tmpRoot('thesmos-session-start-badcfg-');
    try {
      mkdirSync(join(dir, '.thesmos'), { recursive: true });
      writeFileSync(join(dir, '.thesmos', 'config.json'), '{not json', 'utf8');
      const result = runGuardSessionStart(dir);
      expect(result.status).toBe(0);
      expectCleanStdout(result.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 on empty stdin', () => {
    const dir = tmpRoot('thesmos-session-start-emptystdin-');
    try {
      initGitRepo(dir);
      const result = runGuardSessionStart(dir, '');
      expect(result.status).toBe(0);
      expectCleanStdout(result.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The documented inversion (see start.ts's module docstring): every OTHER
  // guard path in this codebase fails CLOSED under `autoMode.failClosed:
  // true` — see runGuardDrift in thesmos-guard.ts. session-start deliberately
  // does not. This test exists so that wiring `isFailClosed` into this path
  // later — the natural "make it consistent with everything else" instinct —
  // fails loudly instead of shipping quietly.
  it('exits 0 under autoMode.failClosed: true — the documented inversion', () => {
    const dir = tmpRoot('thesmos-session-start-failclosed-');
    try {
      mkdirSync(join(dir, '.thesmos'), { recursive: true });
      writeFileSync(
        join(dir, '.thesmos', 'config.json'),
        JSON.stringify({ autoMode: { failClosed: true } }),
        'utf8',
      );
      const result = runGuardSessionStart(dir);
      expect(result.status).toBe(0);
      expectCleanStdout(result.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Fail-open on a thrown dependency (in-process) ───────────────────────────
//
// The subprocess tests above prove exit-code discipline under real failure
// conditions this repo can construct (missing repo, malformed config). None
// of gather/assess/render throws in practice, so there is no natural fixture
// for "an arbitrary dependency throws." This test forces that directly and
// checks the outer try/catch in runSessionStart actually catches it, rather
// than relying on the absence of a natural trigger as proof it's unreachable.

describe('runSessionStart — fails open when a dependency throws (in-process)', () => {
  it('resolves, sets exitCode 0, and writes nothing to stdout when gatherFreshnessInputs throws', async () => {
    const savedExitCode = process.exitCode;
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(gatherFreshnessInputs).mockImplementationOnce(() => {
      throw new Error('simulated probe failure');
    });
    try {
      await expect(runSessionStart(process.cwd())).resolves.toBeUndefined();
      expect(process.exitCode).toBe(0);
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
      process.exitCode = savedExitCode;
    }
  });
});
