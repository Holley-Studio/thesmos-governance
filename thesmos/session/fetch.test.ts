// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { spawnBackgroundFetch, FETCH_MARKER, DEFAULT_MIN_INTERVAL_MS } from './fetch.js';

const IS_WIN = platform() === 'win32';

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

  it('touches a stale marker and spawns again once the interval has elapsed', () => {
    // Complements the "fresh marker suppresses a second call" test above:
    // that one never exercises the `age >= minIntervalMs` branch at all,
    // since it always calls back-to-back within the same interval.
    const dir = tmpRepo();
    try {
      expect(spawnBackgroundFetch(dir)).toBe(true);
      const marker = join(dir, '.git', FETCH_MARKER);
      // Back-date the marker past the interval, as if the last attempt was
      // long enough ago that a fresh one is due.
      const old = new Date(Date.now() - (DEFAULT_MIN_INTERVAL_MS + 60_000));
      utimesSync(marker, old, old);
      expect(spawnBackgroundFetch(dir)).toBe(true);
      // The marker itself is touched forward, not recreated — a fresh mtime
      // is what makes the next call (within the new interval) suppressed.
      const ageMs = Date.now() - statSync(marker).mtimeMs;
      expect(ageMs).toBeLessThan(5000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
//
// This test empirically discriminates on TWO of the three spawn options —
// `.unref()` and `stdio: 'ignore'` — each independently mutated and
// confirmed to reproduce the same ~SLOW_FETCH_SECONDS delay (see the task
// report for literal output): dropping `.unref()` makes the guard process
// itself wait on the child; dropping `stdio: 'ignore'` (e.g. 'inherit')
// makes the detached child inherit the guard's stdout pipe and hold it open
// past the guard's own exit, so whatever reads that stdout to EOF — here,
// `execFileSync` — blocks instead. It does NOT discriminate on `detached`
// alone: that flag guards a different hazard (the child dying with the
// guard's process group on a signal like Ctrl-C), not an event-loop or
// pipe hang, so removing it alone does not slow this test down. See the
// `fetch.ts` module docstring for what each flag actually prevents.
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
    // The `ext::` transport and the `sleep` binary are not guaranteed on
    // Windows. Skipping here follows the same convention as
    // guard.cross-platform.test.ts / agent-lifecycle.test.ts (`IS_WIN`
    // early-return) rather than inventing a new one.
    if (IS_WIN) return;

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
      // second. A regression that drops `.unref()` or `stdio: 'ignore'`
      // would make this block for roughly SLOW_FETCH_SECONDS instead (see
      // the comment above this describe block for which flag does what).
      expect(elapsedMs).toBeLessThan((SLOW_FETCH_SECONDS * 1000) / 2);
      expect(typeof res).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Unresolvable `git` on the child's PATH must not crash the process ──────
//
// Critical bug found in review: `spawn('git', ...)` never throws
// synchronously even when `git` cannot be found — Node reports that
// *asynchronously* via an 'error' event, after `spawnBackgroundFetch` has
// already returned `true`. Left unhandled, that event is fatal to the whole
// process (Node's default behavior for an unhandled EventEmitter 'error'),
// which breaks both "spawnBackgroundFetch must never throw" and
// thesmos-guard's documented "session-start always exits 0" — in an
// environment realistic enough to matter: any minimal container or
// sandboxed hook runner where `.git/` exists but PATH does not resolve
// `git` for child processes.
//
// This cannot be reproduced by spawning `dist/thesmos-guard.js session-start`
// with `git` removed from PATH: `gather.ts`'s own probes shell out to `git`
// too, so with git unresolvable, `gatherRepo` reports `isGitRepo: false` and
// `assessFreshness` never sets `refsUncertain`, so `spawnBackgroundFetch` is
// never even called — a PATH-stripped subprocess run of session-start exits
// 0 while never touching the vulnerable code, which would make the test
// pass by evasion rather than by verifying the fix (confirmed empirically:
// its rendered context omits the "Remote refs last fetched" signal entirely
// when git is unresolvable, proving the fetch gate never opens). So this
// exercises `spawnBackgroundFetch` directly, in its own subprocess, so a
// crash is isolated and observable via exit code/stderr instead of taking
// down the whole test worker.
//
// The harness below is loaded through `tsx` (already a devDependency) rather
// than Node's native `--experimental-strip-types`, which does not exist on
// Node 20 — one of the three Node versions this repo's CI matrix runs on.

function resolveTsxCli(): string {
  const candidates = [
    join(HERE, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), // hoisted to workspace root
    join(HERE, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), // or local to thesmos/
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(`Could not find tsx's cli.mjs in any of: ${candidates.join(', ')}`);
  }
  return found;
}

describe('spawnBackgroundFetch — unresolvable git on the child PATH', () => {
  it('does not crash the process when git cannot be found', () => {
    // Node's ENOENT-on-spawn / PATH-search semantics are POSIX-specific
    // here; the Unix repro above is the faithful reproduction of the
    // reviewer's finding, and is what actually exercises the fix.
    if (IS_WIN) return;

    const tsxCli = resolveTsxCli();
    const workDir = mkdtempSync(join(tmpdir(), 'thesmos-fetch-nogit-'));
    try {
      // spawnBackgroundFetch only needs a directory literally named `.git`
      // to exist (a plain fs check) — it does not need a working repo.
      mkdirSync(join(workDir, '.git'));

      const fetchSrcPath = join(HERE, 'fetch.ts');
      const harnessPath = join(workDir, 'harness.mjs');
      writeFileSync(
        harnessPath,
        [
          `import { spawnBackgroundFetch } from ${JSON.stringify(fetchSrcPath)};`,
          `spawnBackgroundFetch(${JSON.stringify(workDir)});`,
          // Give an unhandled async 'error' event a window to crash the
          // process before this fires. If the handler is present, this is
          // what actually ends the process, cleanly.
          `setTimeout(() => process.exit(0), 800);`,
          '',
        ].join('\n'),
      );

      const result = spawnSync(process.execPath, [tsxCli, harnessPath], {
        // `git` must be unresolvable for THIS child's own spawn('git', ...)
        // call — a directory that provably does not exist, so there is no
        // ambiguity about whether some other `git` was found instead.
        env: { ...process.env, PATH: '/thesmos-nonexistent-path-for-testing-only' },
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).toBe(0);
      expect(result.stderr ?? '').not.toMatch(/Unhandled 'error' event|ENOENT|spawn git/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
