// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { spawnBackgroundFetch, FETCH_MARKER } from './fetch.js';

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'thesmos-fetch-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  return dir;
}

describe('spawnBackgroundFetch', () => {
  it('does nothing outside a git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thesmos-nofetch-'));
    try {
      expect(spawnBackgroundFetch(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a marker so a burst of sessions does not spawn a fetch each', () => {
    const dir = tmpRepo();
    try {
      spawnBackgroundFetch(dir);
      expect(existsSync(join(dir, '.git', FETCH_MARKER))).toBe(true);
      // Second call within the interval is suppressed.
      expect(spawnBackgroundFetch(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never throws', () => {
    expect(() => spawnBackgroundFetch('/nonexistent/xyz')).not.toThrow();
  });
});

// ── Exit-promptness regression (subprocess) ─────────────────────────────────
//
// Regression: a non-detached child (or a missing `.unref()`) keeps the event
// loop alive, so the guard process never exits and session startup hangs.
// This is the single most severe failure mode in the whole session-lifecycle
// design and the easiest to reintroduce, so it is asserted against the real
// built binary rather than an in-process call — an in-process call to
// `runSessionStart`/`spawnBackgroundFetch` cannot observe whether the actual
// OS process exits, only whether its own promise resolves. Follows the
// GUARD_ENTRY / beforeAll convention established in `start.test.ts`.

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD_ENTRY = join(HERE, '..', 'dist', 'thesmos-guard.js');

// A plain `git fetch --all` in a repo with no remotes returns in a few
// milliseconds — that made an earlier draft of this test pass identically
// whether or not `.unref()` was present, since the detached child exited
// before the difference could matter. To force a genuine test of "does the
// parent wait for the child," the repo below is given a remote on the `ext::`
// transport that runs `sleep`, which makes `git fetch` itself take a known,
// network-free, deterministic number of seconds to fail its handshake. If the
// guard process is still waiting on that child when it should have exited on
// its own, this shows up as a multi-second delay instead of a coin flip.
const SLOW_FETCH_SECONDS = 4;

function tmpRepoWithSlowRemote(): string {
  const dir = tmpRepo();
  execFileSync('git', ['config', 'protocol.ext.allow', 'always'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', `ext::sleep ${SLOW_FETCH_SECONDS}`], {
    cwd: dir,
  });
  return dir;
}

describe('session-start exits promptly with a fetch in flight', () => {
  beforeAll(() => {
    if (!existsSync(GUARD_ENTRY)) {
      throw new Error(
        `Missing ${GUARD_ENTRY}. Run \`npm run build\` in thesmos/ before these tests.`,
      );
    }
  });

  it('does not hang when the background fetch is spawned', () => {
    const dir = tmpRepoWithSlowRemote();
    try {
      const started = Date.now();
      const res = execFileSync(process.execPath, [GUARD_ENTRY, 'session-start'], {
        cwd: dir,
        input: '{}',
        encoding: 'utf8',
        timeout: 8000,
      });
      const elapsedMs = Date.now() - started;
      // The guard's own git probes and rendering finish in well under a
      // second. A regression that drops `.unref()` (or `detached: true`)
      // would make the process block for roughly SLOW_FETCH_SECONDS while
      // the still-running `git fetch` child holds the event loop open.
      expect(elapsedMs).toBeLessThan((SLOW_FETCH_SECONDS * 1000) / 2);
      expect(typeof res).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
