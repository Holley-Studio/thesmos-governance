# Session Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Thesmos the session lifecycle it lacks — `SessionStart` establishes repository and artifact ground truth before work begins, and `PreCompact`/`SessionEnd` persist the context capsule so the next session does not start cold.

**Architecture:** Three modules split so decision logic is pure and testable without a git repository: `gather.ts` (I/O, time-budgeted, never network), `freshness.ts` (pure assessment), `render.ts` (byte-budgeted presentation). A fourth `session-start` subcommand in the existing guard binary wires them to the hook. Two more handlers (`PreCompact`, `SessionEnd`) trigger the existing `context-capsule.ts`.

**Tech Stack:** TypeScript (ESM, `node20` target), vitest, tsup. No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-08-31-session-continuity-design.md](../specs/2026-08-31-session-continuity-design.md)

## Global Constraints

- **Fail open, always.** Every path in `session-start`, `PreCompact`, and `SessionEnd` exits 0. This holds even when `autoMode.failClosed` is `true` — a documented inversion of the guard's normal discipline. The hook authorizes nothing, so failing to observe cannot make an action unsafe.
- **Never call `process.exit()` after writing hook JSON.** A hook's stdout is a pipe; writes are asynchronous and `process.exit()` truncates them mid-flush. Set `process.exitCode = 0` and `return`. (Precedent: `emitAskDecision` in `thesmos/claude-govern.ts`.)
- **`exit 0 + JSON` and `exit codes alone` are distinct signaling modes and must never be mixed.** Exit 2 makes Claude Code discard stdout entirely.
- **No network in the blocking path.** Behind/ahead counts come from cached remote-tracking refs only.
- **Total gather budget: 400ms.** Individual probes fail independently without preventing others from reporting.
- **Rendered payload default cap: 1200 bytes.** Degrade by dropping whole sections in severity order, never by truncating mid-sentence.
- **Staleness thresholds are read from existing config, not duplicated.** `config.doctor.reportMaxAgeDays` (default `7`) is the single source for report age, so `doctor` and `session-start` can never disagree.
- ESM imports use explicit `.js` extensions (repo convention, enforced by `missing_ts_extension`).
- Tests are co-located as `*.test.ts` beside the module. Run with `npm test --workspace=thesmos`.
- Every file starts with `// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.`

---

### Task 1: Freshness types and pure assessment

**Files:**
- Create: `thesmos/session/types.ts`
- Create: `thesmos/session/freshness.ts`
- Test: `thesmos/session/freshness.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module)
- Produces: `FreshnessInputs`, `RepoInputs`, `ArtifactInputs`, `StalenessThresholds`, `FreshnessSignal`, `FreshnessReport`, `SignalSeverity`, and `assessFreshness(inputs: FreshnessInputs, thresholds: StalenessThresholds): FreshnessReport`

- [ ] **Step 1: Create the types module**

Create `thesmos/session/types.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Session freshness types.
 *
 * `null` in an input field means **unknown** — a probe that failed, timed out,
 * or does not apply (no upstream configured). It never means zero. The
 * distinction is load-bearing: reporting "0 commits behind" from a ref that was
 * last fetched a week ago is a false statement of fact, not a conservative one.
 */

export interface RepoInputs {
  isGitRepo: boolean;
  branch: string | null;
  upstream: string | null;
  /** Commits on upstream not in HEAD. null = unknown. */
  behind: number | null;
  /** Commits in HEAD not on upstream. null = unknown. */
  ahead: number | null;
  dirtyCount: number | null;
  /** Epoch ms of .git/FETCH_HEAD mtime. null = never fetched. */
  lastFetchMs: number | null;
}

export interface ArtifactInputs {
  reportMtimeMs: number | null;
  baselineMtimeMs: number | null;
  contextMtimeMs: number | null;
  /** Epoch ms of thesmos/dist/thesmos-guard.js. null = not built. */
  guardDistMtimeMs: number | null;
  /** Newest mtime across governance sources the guard is built from. */
  guardSourceMtimeMs: number | null;
}

export interface FreshnessInputs {
  nowMs: number;
  repo: RepoInputs;
  artifacts: ArtifactInputs;
}

export interface StalenessThresholds {
  reportDays: number;
  baselineDays: number;
  fetchHours: number;
}

export type SignalSeverity = 'ok' | 'notice' | 'warn';

export type SignalId =
  | 'behind'
  | 'ahead'
  | 'dirty'
  | 'report'
  | 'baseline'
  | 'context'
  | 'fetch'
  | 'guardDist';

export interface FreshnessSignal {
  id: SignalId;
  severity: SignalSeverity;
  /** One line, already human-readable. No trailing newline. */
  text: string;
  /** Command that resolves it, when one exists. */
  remedy?: string;
}

export interface FreshnessReport {
  signals: FreshnessSignal[];
  /** True when refs are too old for behind/ahead to be trusted. */
  refsUncertain: boolean;
}
```

- [ ] **Step 2: Write the failing test**

Create `thesmos/session/freshness.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { assessFreshness } from './freshness.js';
import type { FreshnessInputs, StalenessThresholds } from './types.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const THRESHOLDS: StalenessThresholds = {
  reportDays: 7,
  baselineDays: 30,
  fetchHours: 12,
};

function inputs(over: Partial<FreshnessInputs> = {}): FreshnessInputs {
  return {
    nowMs: NOW,
    repo: {
      isGitRepo: true,
      branch: 'main',
      upstream: 'origin/main',
      behind: 0,
      ahead: 0,
      dirtyCount: 0,
      lastFetchMs: NOW - HOUR,
    },
    artifacts: {
      reportMtimeMs: NOW - DAY,
      baselineMtimeMs: NOW - DAY,
      contextMtimeMs: NOW - DAY,
      guardDistMtimeMs: NOW - HOUR,
      guardSourceMtimeMs: NOW - 2 * HOUR,
    },
    ...over,
  };
}

function ids(report: ReturnType<typeof assessFreshness>): string[] {
  return report.signals.filter((s) => s.severity !== 'ok').map((s) => s.id);
}

describe('assessFreshness', () => {
  it('reports nothing actionable when everything is current', () => {
    expect(ids(assessFreshness(inputs(), THRESHOLDS))).toEqual([]);
  });

  it('flags a branch behind upstream', () => {
    const r = assessFreshness(
      inputs({ repo: { ...inputs().repo, behind: 14 } }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('behind');
    expect(r.signals.find((s) => s.id === 'behind')?.text).toContain('14');
  });

  it('treats an unknown behind-count as unknown, never as zero', () => {
    const r = assessFreshness(
      inputs({ repo: { ...inputs().repo, behind: null, upstream: null } }),
      THRESHOLDS,
    );
    expect(r.signals.find((s) => s.id === 'behind')?.text ?? '').not.toMatch(/\b0\b/);
  });

  it('marks refs uncertain when the last fetch is older than the threshold', () => {
    const r = assessFreshness(
      inputs({ repo: { ...inputs().repo, lastFetchMs: NOW - 72 * HOUR } }),
      THRESHOLDS,
    );
    expect(r.refsUncertain).toBe(true);
    expect(ids(r)).toContain('fetch');
  });

  it('does not mark refs uncertain on a recent fetch', () => {
    expect(assessFreshness(inputs(), THRESHOLDS).refsUncertain).toBe(false);
  });

  it('flags a stale report past reportDays', () => {
    const r = assessFreshness(
      inputs({ artifacts: { ...inputs().artifacts, reportMtimeMs: NOW - 39 * DAY } }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('report');
    expect(r.signals.find((s) => s.id === 'report')?.remedy).toContain('scan');
  });

  it('flags a stale baseline past baselineDays', () => {
    const r = assessFreshness(
      inputs({ artifacts: { ...inputs().artifacts, baselineMtimeMs: NOW - 61 * DAY } }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('baseline');
  });

  it('flags a guard binary older than its own sources', () => {
    const r = assessFreshness(
      inputs({
        artifacts: {
          ...inputs().artifacts,
          guardDistMtimeMs: NOW - 30 * DAY,
          guardSourceMtimeMs: NOW - HOUR,
        },
      }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('guardDist');
    expect(r.signals.find((s) => s.id === 'guardDist')?.remedy).toContain('build');
  });

  it('omits repo signals entirely outside a git repository', () => {
    const r = assessFreshness(
      inputs({
        repo: {
          isGitRepo: false,
          branch: null,
          upstream: null,
          behind: null,
          ahead: null,
          dirtyCount: null,
          lastFetchMs: null,
        },
      }),
      THRESHOLDS,
    );
    for (const id of ['behind', 'ahead', 'dirty', 'fetch']) {
      expect(r.signals.some((s) => s.id === id)).toBe(false);
    }
  });

  it('handles detached HEAD without inventing an upstream', () => {
    const r = assessFreshness(
      inputs({
        repo: { ...inputs().repo, branch: null, upstream: null, behind: null, ahead: null },
      }),
      THRESHOLDS,
    );
    expect(ids(r)).not.toContain('ahead');
  });

  it('flags uncommitted work', () => {
    const r = assessFreshness(
      inputs({ repo: { ...inputs().repo, dirtyCount: 5 } }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('dirty');
  });

  it('is pure — the same inputs always yield the same report', () => {
    const a = assessFreshness(inputs({ repo: { ...inputs().repo, behind: 3 } }), THRESHOLDS);
    const b = assessFreshness(inputs({ repo: { ...inputs().repo, behind: 3 } }), THRESHOLDS);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test --workspace=thesmos -- session/freshness`
Expected: FAIL — `Failed to resolve import "./freshness.js"`

- [ ] **Step 4: Implement `freshness.ts`**

Create `thesmos/session/freshness.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pure freshness assessment.
 *
 * No I/O, no clock access — `nowMs` is an input. That makes the entire
 * staleness matrix testable as a table, with no fixture repositories to build.
 *
 * The rule this module exists to enforce: **unknown is not zero.** A `null`
 * behind-count produces a signal that says so, never a reassuring "0 behind"
 * derived from a week-old ref.
 */

import type {
  FreshnessInputs,
  FreshnessReport,
  FreshnessSignal,
  StalenessThresholds,
} from './types.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

function days(ms: number): number {
  return Math.floor(ms / DAY);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function assessFreshness(
  inputs: FreshnessInputs,
  thresholds: StalenessThresholds,
): FreshnessReport {
  const { nowMs, repo, artifacts } = inputs;
  const signals: FreshnessSignal[] = [];

  const fetchAgeMs = repo.lastFetchMs === null ? null : nowMs - repo.lastFetchMs;
  const refsUncertain =
    repo.isGitRepo &&
    (fetchAgeMs === null || fetchAgeMs > thresholds.fetchHours * HOUR);

  if (repo.isGitRepo) {
    if (repo.behind === null) {
      if (repo.upstream === null) {
        signals.push({
          id: 'behind',
          severity: 'notice',
          text: 'No upstream is configured for this branch — remote state is unknown.',
        });
      }
    } else if (repo.behind > 0) {
      signals.push({
        id: 'behind',
        severity: 'warn',
        text: `Local branch is ${repo.behind} ${plural(repo.behind, 'commit', 'commits')} behind ${repo.upstream ?? 'upstream'}.`,
        remedy: 'git pull --ff-only',
      });
    }

    if (repo.ahead !== null && repo.ahead > 0) {
      signals.push({
        id: 'ahead',
        severity: 'notice',
        text: `Local branch is ${repo.ahead} ${plural(repo.ahead, 'commit', 'commits')} ahead of ${repo.upstream ?? 'upstream'} (unpushed).`,
      });
    }

    if (repo.dirtyCount !== null && repo.dirtyCount > 0) {
      signals.push({
        id: 'dirty',
        severity: 'notice',
        text: `${repo.dirtyCount} uncommitted ${plural(repo.dirtyCount, 'file', 'files')} in the working tree.`,
      });
    }

    if (refsUncertain) {
      const age = fetchAgeMs === null ? 'never' : `${days(fetchAgeMs)}d ago`;
      signals.push({
        id: 'fetch',
        severity: 'warn',
        text: `Remote refs last fetched ${age} — behind/ahead counts above may be stale. Fetch before relying on branch state.`,
        remedy: 'git fetch --all --prune',
      });
    }
  }

  const artifactAge = (mtime: number | null): number | null =>
    mtime === null ? null : nowMs - mtime;

  const reportAge = artifactAge(artifacts.reportMtimeMs);
  if (reportAge === null) {
    signals.push({
      id: 'report',
      severity: 'warn',
      text: 'No .thesmos/report.json — the repository has never been scanned.',
      remedy: 'npm run thesmos:scan',
    });
  } else if (reportAge > thresholds.reportDays * DAY) {
    signals.push({
      id: 'report',
      severity: 'warn',
      text: `.thesmos/report.json is ${days(reportAge)} days stale (limit ${thresholds.reportDays}).`,
      remedy: 'npm run thesmos:scan',
    });
  }

  const baselineAge = artifactAge(artifacts.baselineMtimeMs);
  if (baselineAge !== null && baselineAge > thresholds.baselineDays * DAY) {
    signals.push({
      id: 'baseline',
      severity: 'notice',
      text: `.thesmos/baseline.json is ${days(baselineAge)} days stale (limit ${thresholds.baselineDays}) — drifted baselines resurface accepted findings.`,
      remedy: 'npm run thesmos:baseline:update',
    });
  }

  const contextAge = artifactAge(artifacts.contextMtimeMs);
  if (contextAge === null || contextAge > thresholds.reportDays * DAY) {
    signals.push({
      id: 'context',
      severity: 'notice',
      text:
        contextAge === null
          ? 'No .thesmos/context.md — this session starts without a project capsule.'
          : `.thesmos/context.md is ${days(contextAge)} days stale.`,
      remedy: 'npm run thesmos:context:snapshot',
    });
  }

  const { guardDistMtimeMs, guardSourceMtimeMs } = artifacts;
  if (guardDistMtimeMs === null) {
    signals.push({
      id: 'guardDist',
      severity: 'warn',
      text: 'The governance guard binary is not built — hooks cannot enforce anything.',
      remedy: 'npm run build --workspace=thesmos',
    });
  } else if (guardSourceMtimeMs !== null && guardSourceMtimeMs > guardDistMtimeMs) {
    signals.push({
      id: 'guardDist',
      severity: 'warn',
      text: `The governance guard binary is older than its sources (built ${days(nowMs - guardDistMtimeMs)}d ago) — hooks are running stale rules.`,
      remedy: 'npm run build --workspace=thesmos',
    });
  }

  return { signals, refsUncertain };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace=thesmos -- session/freshness`
Expected: PASS, 12 tests

- [ ] **Step 6: Commit**

```bash
git add thesmos/session/types.ts thesmos/session/freshness.ts thesmos/session/freshness.test.ts
git commit -m "feat(session): pure freshness assessment with unknown-is-not-zero semantics"
```

---

### Task 2: Time-budgeted input gathering

**Files:**
- Create: `thesmos/session/gather.ts`
- Test: `thesmos/session/gather.test.ts`

**Interfaces:**
- Consumes: `FreshnessInputs`, `RepoInputs`, `ArtifactInputs` from Task 1
- Produces: `gatherFreshnessInputs(root: string, budgetMs?: number): FreshnessInputs`

- [ ] **Step 1: Write the failing test**

Create `thesmos/session/gather.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gatherFreshnessInputs } from './gather.js';

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), 'thesmos-gather-'));
}

describe('gatherFreshnessInputs', () => {
  it('reports isGitRepo false outside a repository', () => {
    const dir = tmpRepo();
    try {
      const out = gatherFreshnessInputs(dir);
      expect(out.repo.isGitRepo).toBe(false);
      expect(out.repo.behind).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads artifact mtimes when present and reports null when absent', () => {
    const dir = tmpRepo();
    try {
      mkdirSync(join(dir, '.thesmos'), { recursive: true });
      writeFileSync(join(dir, '.thesmos', 'report.json'), '{}');
      const out = gatherFreshnessInputs(dir);
      expect(out.artifacts.reportMtimeMs).toBeTypeOf('number');
      expect(out.artifacts.baselineMtimeMs).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects a git repository and its branch without a network call', () => {
    const dir = tmpRepo();
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
      writeFileSync(join(dir, 'a.txt'), 'a');
      execFileSync('git', ['add', '.'], { cwd: dir });
      execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });

      const out = gatherFreshnessInputs(dir);
      expect(out.repo.isGitRepo).toBe(true);
      expect(out.repo.branch).toBe('main');
      expect(out.repo.upstream).toBeNull();
      expect(out.repo.behind).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts dirty files', () => {
    const dir = tmpRepo();
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      writeFileSync(join(dir, 'dirty.txt'), 'x');
      const out = gatherFreshnessInputs(dir);
      expect(out.repo.dirtyCount).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never throws, whatever the root is', () => {
    expect(() => gatherFreshnessInputs('/nonexistent/path/xyz')).not.toThrow();
  });

  it('completes within the time budget', () => {
    const started = Date.now();
    gatherFreshnessInputs(process.cwd(), 400);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=thesmos -- session/gather`
Expected: FAIL — cannot resolve `./gather.js`

- [ ] **Step 3: Implement `gather.ts`**

Create `thesmos/session/gather.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Freshness input gathering — the I/O half.
 *
 * Every probe is independently failable: one that throws or exceeds its slice
 * contributes `null` and does not prevent the others from reporting. `null`
 * always means unknown.
 *
 * **This module never touches the network.** Behind/ahead counts are read from
 * cached remote-tracking refs (~45ms). A fetch is an unbounded network round
 * trip and has no place in a path that blocks session startup.
 */

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactInputs, FreshnessInputs, RepoInputs } from './types.js';

/** Default total wall-clock budget for all probes. */
export const DEFAULT_BUDGET_MS = 400;

/** Governance sources the guard binary is bundled from. */
const GUARD_SOURCES = [
  'thesmos/claude-govern.ts',
  'thesmos/shell-command.ts',
  'thesmos/scope.ts',
  'thesmos/bin/thesmos-guard.ts',
];

function git(root: string, args: string[], timeoutMs: number): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function mtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function newestMtime(root: string, relPaths: string[]): number | null {
  let newest: number | null = null;
  for (const rel of relPaths) {
    const m = mtimeMs(join(root, rel));
    if (m !== null && (newest === null || m > newest)) newest = m;
  }
  return newest;
}

function parseCount(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function gatherRepo(root: string, sliceMs: number): RepoInputs {
  const empty: RepoInputs = {
    isGitRepo: false,
    branch: null,
    upstream: null,
    behind: null,
    ahead: null,
    dirtyCount: null,
    lastFetchMs: null,
  };

  const inside = git(root, ['rev-parse', '--is-inside-work-tree'], sliceMs);
  if (inside !== 'true') return empty;

  const branchRaw = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], sliceMs);
  const branch = branchRaw && branchRaw !== 'HEAD' ? branchRaw : null;

  const upstream = branch
    ? git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], sliceMs)
    : null;

  let behind: number | null = null;
  let ahead: number | null = null;
  if (upstream) {
    // "<behind>\t<ahead>" — one process instead of two.
    const counts = git(root, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`], sliceMs);
    const [b, a] = (counts ?? '').split(/\s+/);
    behind = parseCount(b ?? null);
    ahead = parseCount(a ?? null);
  }

  const status = git(root, ['status', '--porcelain'], sliceMs);
  const dirtyCount =
    status === null ? null : status.length === 0 ? 0 : status.split('\n').length;

  const gitDir = git(root, ['rev-parse', '--git-dir'], sliceMs);
  const lastFetchMs =
    gitDir === null ? null : mtimeMs(join(root, gitDir, 'FETCH_HEAD'));

  return { isGitRepo: true, branch, upstream, behind, ahead, dirtyCount, lastFetchMs };
}

function gatherArtifacts(root: string): ArtifactInputs {
  return {
    reportMtimeMs: mtimeMs(join(root, '.thesmos', 'report.json')),
    baselineMtimeMs: mtimeMs(join(root, '.thesmos', 'baseline.json')),
    contextMtimeMs: mtimeMs(join(root, '.thesmos', 'context.md')),
    guardDistMtimeMs: mtimeMs(join(root, 'thesmos', 'dist', 'thesmos-guard.js')),
    guardSourceMtimeMs: newestMtime(root, GUARD_SOURCES),
  };
}

export function gatherFreshnessInputs(
  root: string,
  budgetMs: number = DEFAULT_BUDGET_MS,
): FreshnessInputs {
  // Six git probes share the budget; stat() calls are ~7ms total and unbudgeted.
  const sliceMs = Math.max(50, Math.floor(budgetMs / 6));
  let repo: RepoInputs;
  try {
    repo = gatherRepo(root, sliceMs);
  } catch {
    repo = {
      isGitRepo: false,
      branch: null,
      upstream: null,
      behind: null,
      ahead: null,
      dirtyCount: null,
      lastFetchMs: null,
    };
  }

  let artifacts: ArtifactInputs;
  try {
    artifacts = gatherArtifacts(root);
  } catch {
    artifacts = {
      reportMtimeMs: null,
      baselineMtimeMs: null,
      contextMtimeMs: null,
      guardDistMtimeMs: null,
      guardSourceMtimeMs: null,
    };
  }

  return { nowMs: Date.now(), repo, artifacts };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=thesmos -- session/gather`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add thesmos/session/gather.ts thesmos/session/gather.test.ts
git commit -m "feat(session): time-budgeted freshness gathering with no network in the blocking path"
```

---

### Task 3: Byte-budgeted rendering

**Files:**
- Create: `thesmos/session/render.ts`
- Test: `thesmos/session/render.test.ts`

**Interfaces:**
- Consumes: `FreshnessReport`, `FreshnessSignal` from Task 1
- Produces: `renderSessionContext(report: FreshnessReport, maxBytes?: number): string` and `DEFAULT_MAX_BYTES: number`

- [ ] **Step 1: Write the failing test**

Create `thesmos/session/render.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { renderSessionContext, DEFAULT_MAX_BYTES } from './render.js';
import type { FreshnessReport, FreshnessSignal } from './types.js';

function report(signals: FreshnessSignal[], refsUncertain = false): FreshnessReport {
  return { signals, refsUncertain };
}

const WARN: FreshnessSignal = {
  id: 'behind',
  severity: 'warn',
  text: 'Local branch is 14 commits behind origin/main.',
  remedy: 'git pull --ff-only',
};

const NOTICE: FreshnessSignal = {
  id: 'dirty',
  severity: 'notice',
  text: '5 uncommitted files in the working tree.',
};

describe('renderSessionContext', () => {
  it('returns an empty string when nothing is actionable', () => {
    expect(renderSessionContext(report([]))).toBe('');
  });

  it('includes warn text and its remedy', () => {
    const out = renderSessionContext(report([WARN]));
    expect(out).toContain('14 commits behind');
    expect(out).toContain('git pull --ff-only');
  });

  it('orders warnings before notices', () => {
    const out = renderSessionContext(report([NOTICE, WARN]));
    expect(out.indexOf('14 commits behind')).toBeLessThan(out.indexOf('uncommitted'));
  });

  it('omits ok signals entirely', () => {
    const out = renderSessionContext(
      report([{ id: 'report', severity: 'ok', text: 'fine' }]),
    );
    expect(out).toBe('');
  });

  it('stays within the byte budget under pathological input', () => {
    const many: FreshnessSignal[] = Array.from({ length: 200 }, (_, i) => ({
      id: 'dirty' as const,
      severity: 'notice' as const,
      text: `${'x'.repeat(300)} entry ${i}`,
      remedy: 'y'.repeat(200),
    }));
    const out = renderSessionContext(report(many));
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
  });

  it('degrades by dropping whole lines, never truncating mid-sentence', () => {
    const many: FreshnessSignal[] = Array.from({ length: 50 }, (_, i) => ({
      id: 'dirty' as const,
      severity: 'notice' as const,
      text: `Signal number ${i} with enough text to matter.`,
    }));
    const out = renderSessionContext(report(many), 300);
    for (const line of out.split('\n')) {
      if (line.startsWith('- ')) expect(line.endsWith('.')).toBe(true);
    }
  });

  it('keeps the highest-severity signal when the budget is very small', () => {
    const out = renderSessionContext(report([NOTICE, WARN]), 200);
    expect(out).toContain('14 commits behind');
  });

  it('surfaces ref uncertainty as an explicit caveat', () => {
    const out = renderSessionContext(report([WARN], true));
    expect(out.toLowerCase()).toContain('stale');
  });

  it('is deterministic', () => {
    const a = renderSessionContext(report([WARN, NOTICE]));
    const b = renderSessionContext(report([WARN, NOTICE]));
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=thesmos -- session/render`
Expected: FAIL — cannot resolve `./render.js`

- [ ] **Step 3: Implement `render.ts`**

Create `thesmos/session/render.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Session-start context rendering.
 *
 * The byte budget is a correctness property, not a preference:
 * `context-capsule.ts` already documents that quality degrades as context
 * fills, so a session-start notice that crowds out the rules it exists to
 * support is a net loss.
 *
 * Degradation drops whole lines in severity order. It never truncates
 * mid-sentence — a half-sentence about a stale baseline is worse than silence,
 * because it reads as a complete claim.
 */

import type { FreshnessReport, FreshnessSignal, SignalSeverity } from './types.js';

export const DEFAULT_MAX_BYTES = 1200;

const HEADER = 'Thesmos — repository state at session start:';
const FOOTER =
  'Address these before relying on repository state. Not automatic — act only if the task needs it.';

const RANK: Record<SignalSeverity, number> = { warn: 0, notice: 1, ok: 2 };

function line(signal: FreshnessSignal): string {
  return signal.remedy
    ? `- ${signal.text}  →  \`${signal.remedy}\``
    : `- ${signal.text}`;
}

function bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function renderSessionContext(
  report: FreshnessReport,
  maxBytes: number = DEFAULT_MAX_BYTES,
): string {
  const actionable = report.signals
    .filter((s) => s.severity !== 'ok')
    .slice()
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  if (actionable.length === 0) return '';

  const caveat = report.refsUncertain
    ? 'Remote refs are stale, so branch counts above are approximate.'
    : null;

  const kept: string[] = [];
  // Header plus footer plus newlines must fit before any signal is admitted.
  let used = bytes(HEADER) + bytes(FOOTER) + 4 + (caveat ? bytes(caveat) + 1 : 0);

  for (const signal of actionable) {
    const candidate = line(signal);
    const cost = bytes(candidate) + 1;
    if (used + cost > maxBytes) continue;
    kept.push(candidate);
    used += cost;
  }

  if (kept.length === 0) return '';

  const parts = [HEADER, ...kept];
  if (caveat) parts.push(caveat);
  parts.push(FOOTER);
  return parts.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=thesmos -- session/render`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add thesmos/session/render.ts thesmos/session/render.test.ts
git commit -m "feat(session): byte-budgeted session context rendering"
```

---

### Task 4: Config thresholds resolution

**Files:**
- Modify: `thesmos/config.ts` (add `session` to `CONFIG_DEFAULTS` and the merge in `loadConfig`)
- Modify: `thesmos/types.ts` (add `session` to `ThesmosConfig`)
- Create: `thesmos/session/thresholds.ts`
- Test: `thesmos/session/thresholds.test.ts`

**Interfaces:**
- Consumes: `StalenessThresholds` from Task 1; `ThesmosConfig` from `thesmos/types.ts`
- Produces: `resolveThresholds(config: ThesmosConfig): StalenessThresholds`, `resolveSessionOptions(config: ThesmosConfig): { enabled: boolean; backgroundFetch: boolean; maxBytes: number }`

- [ ] **Step 1: Add the config type**

In `thesmos/types.ts`, inside the `ThesmosConfig` interface, immediately after the `doctor: { … }` block, add:

```ts
  session?: {
    start?: {
      enabled?: boolean;
      backgroundFetch?: boolean;
      maxBytes?: number;
    };
    staleness?: {
      baselineDays?: number;
      fetchHours?: number;
    };
  };
```

Note there is deliberately **no** `reportDays` key — report age comes from `doctor.reportMaxAgeDays` so the two surfaces cannot disagree.

- [ ] **Step 2: Add defaults**

In `thesmos/config.ts`, inside `CONFIG_DEFAULTS`, immediately after the `doctor: { … }` block, add:

```ts
  session: {
    start: { enabled: true, backgroundFetch: true, maxBytes: 1200 },
    staleness: { baselineDays: 30, fetchHours: 12 },
  },
```

In `loadConfig`, alongside the existing `doctor:` merge, add:

```ts
    session: {
      ...CONFIG_DEFAULTS.session,
      ...(typeof raw.session === 'object' && raw.session !== null
        ? (raw.session as object)
        : {}),
    },
```

- [ ] **Step 3: Write the failing test**

Create `thesmos/session/thresholds.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS } from '../config.js';
import { resolveThresholds, resolveSessionOptions } from './thresholds.js';
import type { ThesmosConfig } from '../types.js';

describe('resolveThresholds', () => {
  it('takes report age from doctor.reportMaxAgeDays, never a parallel key', () => {
    expect(resolveThresholds(CONFIG_DEFAULTS).reportDays).toBe(
      CONFIG_DEFAULTS.doctor.reportMaxAgeDays,
    );
  });

  it('applies defaults when the session key is absent entirely', () => {
    const bare = { ...CONFIG_DEFAULTS, session: undefined } as ThesmosConfig;
    const t = resolveThresholds(bare);
    expect(t.baselineDays).toBe(30);
    expect(t.fetchHours).toBe(12);
  });

  it('honours an explicit override', () => {
    const cfg = {
      ...CONFIG_DEFAULTS,
      session: { staleness: { baselineDays: 90, fetchHours: 1 } },
    } as ThesmosConfig;
    const t = resolveThresholds(cfg);
    expect(t.baselineDays).toBe(90);
    expect(t.fetchHours).toBe(1);
  });
});

describe('resolveSessionOptions', () => {
  it('defaults to enabled with background fetch on', () => {
    const o = resolveSessionOptions(CONFIG_DEFAULTS);
    expect(o.enabled).toBe(true);
    expect(o.backgroundFetch).toBe(true);
    expect(o.maxBytes).toBe(1200);
  });

  it('defaults correctly when session is absent', () => {
    const bare = { ...CONFIG_DEFAULTS, session: undefined } as ThesmosConfig;
    expect(resolveSessionOptions(bare).enabled).toBe(true);
  });

  it('respects an explicit disable', () => {
    const cfg = {
      ...CONFIG_DEFAULTS,
      session: { start: { enabled: false } },
    } as ThesmosConfig;
    expect(resolveSessionOptions(cfg).enabled).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test --workspace=thesmos -- session/thresholds`
Expected: FAIL — cannot resolve `./thresholds.js`

- [ ] **Step 5: Implement `thresholds.ts`**

Create `thesmos/session/thresholds.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Config → session thresholds.
 *
 * Report age deliberately reuses `doctor.reportMaxAgeDays` rather than
 * introducing a parallel key, so `thesmos doctor` and the session hook can
 * never disagree about what "stale" means.
 */

import type { ThesmosConfig } from '../types.js';
import type { StalenessThresholds } from './types.js';

const DEFAULT_BASELINE_DAYS = 30;
const DEFAULT_FETCH_HOURS = 12;
const DEFAULT_MAX_BYTES = 1200;

export function resolveThresholds(config: ThesmosConfig): StalenessThresholds {
  const staleness = config.session?.staleness;
  return {
    reportDays: config.doctor?.reportMaxAgeDays ?? 7,
    baselineDays: staleness?.baselineDays ?? DEFAULT_BASELINE_DAYS,
    fetchHours: staleness?.fetchHours ?? DEFAULT_FETCH_HOURS,
  };
}

export interface SessionStartOptions {
  enabled: boolean;
  backgroundFetch: boolean;
  maxBytes: number;
}

export function resolveSessionOptions(config: ThesmosConfig): SessionStartOptions {
  const start = config.session?.start;
  return {
    enabled: start?.enabled ?? true,
    backgroundFetch: start?.backgroundFetch ?? true,
    maxBytes: start?.maxBytes ?? DEFAULT_MAX_BYTES,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace=thesmos -- session/thresholds config`
Expected: PASS — new tests pass and existing `config.test.ts` still passes

- [ ] **Step 7: Commit**

```bash
git add thesmos/types.ts thesmos/config.ts thesmos/session/thresholds.ts thesmos/session/thresholds.test.ts
git commit -m "feat(session): session config with absent-key defaults, report age shared with doctor"
```

---

### Task 5: The `session-start` subcommand

**Files:**
- Create: `thesmos/session/start.ts`
- Modify: `thesmos/bin/thesmos-guard.ts` (add `session-start` to `SUBCOMMANDS` and dispatch)
- Test: `thesmos/session/start.test.ts`

**Interfaces:**
- Consumes: `gatherFreshnessInputs` (Task 2), `assessFreshness` (Task 1), `renderSessionContext` (Task 3), `resolveThresholds` / `resolveSessionOptions` (Task 4)
- Produces: `runSessionStart(root: string): Promise<void>`, `buildSessionStartPayload(context: string): string`

- [ ] **Step 1: Write the failing test**

Create `thesmos/session/start.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { buildSessionStartPayload } from './start.js';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=thesmos -- session/start`
Expected: FAIL — cannot resolve `./start.js`

- [ ] **Step 3: Implement `start.ts`**

Create `thesmos/session/start.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * SessionStart hook handler.
 *
 * ## Fail-open, deliberately
 *
 * Every other guard path in Thesmos fails **closed**: when governance cannot
 * determine whether an action is safe, the action is refused. That is correct
 * for PreToolUse, where wrongly allowing costs more than wrongly blocking.
 *
 * This handler inverts that, **including under `failClosed: true`**. It
 * authorizes nothing — it observes and reports. A failure to observe cannot
 * make an action unsafe; it can only leave the session as uninformed as it was
 * before this hook existed. A session that *refuses to start* because a
 * staleness probe threw is a broken tool, and its failure mode is catastrophic
 * rather than protective.
 *
 * ## Never call process.exit()
 *
 * A hook's stdout is a pipe and writes to it are asynchronous. `process.exit()`
 * immediately after `write()` truncates the JSON mid-flush and corrupts the
 * hook's own output. Set `process.exitCode` and return; the process exits when
 * the event loop drains. (Same discipline as `emitAskDecision` in
 * `claude-govern.ts`.) This is also why the background fetch in Task 6 must be
 * detached and unref'd.
 */

import { loadConfig, CONFIG_DEFAULTS } from '../config.js';
import { assessFreshness } from './freshness.js';
import { gatherFreshnessInputs } from './gather.js';
import { renderSessionContext } from './render.js';
import { resolveSessionOptions, resolveThresholds } from './thresholds.js';

export function buildSessionStartPayload(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  });
}

export async function runSessionStart(root: string): Promise<void> {
  // Nothing in this function may throw past this boundary.
  try {
    let config = CONFIG_DEFAULTS;
    try {
      config = loadConfig(root);
    } catch {
      // Malformed or absent config must not prevent a session from starting.
    }

    const options = resolveSessionOptions(config);
    if (!options.enabled) {
      process.exitCode = 0;
      return;
    }

    const inputs = gatherFreshnessInputs(root);
    const report = assessFreshness(inputs, resolveThresholds(config));
    const context = renderSessionContext(report, options.maxBytes);

    if (context.length > 0) {
      // Exactly one write; nothing else touches stdout on this path.
      process.stdout.write(buildSessionStartPayload(context) + '\n');
    }
  } catch {
    // Fail open — emit nothing.
  }
  process.exitCode = 0;
}
```

- [ ] **Step 4: Wire the subcommand**

In `thesmos/bin/thesmos-guard.ts`:

Add the import beside the existing ones:

```ts
import { runSessionStart } from '../session/start.js';
```

Change the subcommand set:

```ts
const SUBCOMMANDS = new Set(['check', 'budget-check', 'drift', 'session-start']);
```

Add dispatch immediately after the `budget-check` branch, before the drift fallthrough:

```ts
  if (subcommand === 'session-start') {
    await runSessionStart(root);
    return;
  }
```

Update the usage string in the same file:

```ts
    'Usage: thesmos-guard <check|budget-check|drift|session-start> [--quiet]\n',
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace=thesmos -- session/start`
Expected: PASS, 2 tests

- [ ] **Step 6: Build and verify end to end**

```bash
npm run build --workspace=thesmos
echo '{}' | node thesmos/dist/thesmos-guard.js session-start; echo "exit=$?"
```

Expected: exit 0. In this repository (stale baseline) it prints a JSON envelope; in a fully fresh repository it prints nothing. Both are correct.

- [ ] **Step 7: Commit**

```bash
git add thesmos/session/start.ts thesmos/session/start.test.ts thesmos/bin/thesmos-guard.ts
git commit -m "feat(session): session-start subcommand, fail-open by design"
```

---

### Task 6: Detached background fetch

**Files:**
- Create: `thesmos/session/fetch.ts`
- Modify: `thesmos/session/start.ts` (call it)
- Test: `thesmos/session/fetch.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `spawnBackgroundFetch(root: string, minIntervalMs?: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `thesmos/session/fetch.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=thesmos -- session/fetch`
Expected: FAIL — cannot resolve `./fetch.js`

- [ ] **Step 3: Implement `fetch.ts`**

Create `thesmos/session/fetch.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Detached background fetch.
 *
 * The SessionStart hook cannot fetch in its blocking path, so a behind-count
 * read from week-old refs is *unknown*, not zero. The resolution is to report
 * that uncertainty (see `freshness.ts`) and refresh the refs out of band, so
 * the next turn has truth.
 *
 * **The child must not hold the event loop open.** `start.ts` exits by letting
 * the loop drain — a requirement of the never-call-process.exit() rule. A
 * non-detached child would keep the process alive and hang session startup,
 * which is precisely the failure this hook exists to prevent. Hence
 * `detached: true`, `stdio: 'ignore'`, and `unref()`.
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Marker file inside .git, so it is never committed and never dirties status. */
export const FETCH_MARKER = 'THESMOS_LAST_FETCH_ATTEMPT';

/** Do not spawn more than one fetch per this interval. */
export const DEFAULT_MIN_INTERVAL_MS = 10 * 60 * 1000;

export function spawnBackgroundFetch(
  root: string,
  minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS,
): boolean {
  try {
    const gitDir = join(root, '.git');
    if (!existsSync(gitDir)) return false;

    const marker = join(gitDir, FETCH_MARKER);
    if (existsSync(marker)) {
      const age = Date.now() - statSync(marker).mtimeMs;
      if (age < minIntervalMs) return false;
      utimesSync(marker, new Date(), new Date());
    } else {
      writeFileSync(marker, '');
    }

    const child = spawn('git', ['fetch', '--all', '--prune', '--quiet'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Call it from `start.ts`**

In `thesmos/session/start.ts`, add the import:

```ts
import { spawnBackgroundFetch } from './fetch.js';
```

Then, inside `runSessionStart`, immediately after the `renderSessionContext` call and before the `if (context.length > 0)` block, add:

```ts
    if (options.backgroundFetch && report.refsUncertain) {
      spawnBackgroundFetch(root);
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=thesmos -- session/`
Expected: PASS, all session tests

- [ ] **Step 6: Add the exit-promptness regression test**

Append to `thesmos/session/fetch.test.ts`:

```ts
describe('session-start exits promptly with a fetch in flight', () => {
  it('does not hang when the background fetch is spawned', () => {
    // Regression: a non-detached child keeps the event loop alive, so the
    // process never exits and session startup hangs. This is the single most
    // severe failure mode in the design and the easiest to reintroduce.
    const dir = tmpRepo();
    try {
      const started = Date.now();
      const res = execFileSync(
        process.execPath,
        [join(process.cwd(), 'dist', 'thesmos-guard.js'), 'session-start'],
        { cwd: dir, input: '{}', encoding: 'utf8', timeout: 8000 },
      );
      expect(Date.now() - started).toBeLessThan(8000);
      expect(typeof res).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 7: Build, then run the regression test**

```bash
npm run build --workspace=thesmos
npm test --workspace=thesmos -- session/fetch
```

Expected: PASS. If this hangs, `detached`/`unref()` has regressed.

- [ ] **Step 8: Commit**

```bash
git add thesmos/session/fetch.ts thesmos/session/fetch.test.ts thesmos/session/start.ts
git commit -m "feat(session): detached background fetch that cannot hang session startup"
```

---

### Task 7: PreCompact and SessionEnd capsule persistence

**Files:**
- Create: `thesmos/session/capsule-hooks.ts`
- Modify: `thesmos/bin/thesmos-guard.ts` (add `session-capsule` subcommand)
- Test: `thesmos/session/capsule-hooks.test.ts`

**Interfaces:**
- Consumes: `generateContextCapsule`, `saveContextCapsule` from `thesmos/context-capsule.ts`
- Produces: `runSessionCapsule(root: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `thesmos/session/capsule-hooks.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionCapsule } from './capsule-hooks.js';

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'thesmos-capsule-'));
  mkdirSync(join(dir, '.thesmos'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  writeFileSync(join(dir, '.thesmos', 'config.json'), JSON.stringify({ project: 'demo' }));
  return dir;
}

describe('runSessionCapsule', () => {
  it('writes a context capsule naming the real project', async () => {
    const dir = tmpProject();
    try {
      await runSessionCapsule(dir);
      const path = join(dir, '.thesmos', 'context.md');
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain('demo');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails open on an unwritable or nonexistent root', async () => {
    await expect(runSessionCapsule('/nonexistent/xyz')).resolves.toBeUndefined();
    expect(process.exitCode ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=thesmos -- session/capsule-hooks`
Expected: FAIL — cannot resolve `./capsule-hooks.js`

- [ ] **Step 3: Implement `capsule-hooks.ts`**

Create `thesmos/session/capsule-hooks.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * PreCompact / SessionEnd capsule persistence.
 *
 * `PreCompact` is where "chats never fall behind" is actually solved.
 * Compaction discards detail by design; if nothing durable is written first,
 * everything the session learned is lost. Regenerating the capsule beforehand
 * means the post-compaction context is seeded with current fact rather than a
 * lossy summary.
 *
 * This supplies the missing trigger. `context-capsule.ts` already does the
 * work correctly and is used unchanged — the bug was never its output, it was
 * that nothing ever called it.
 *
 * Fail-open, and never `process.exit()` — same rules as `start.ts`.
 */

import { generateContextCapsule, saveContextCapsule } from '../context-capsule.js';

export async function runSessionCapsule(root: string): Promise<void> {
  try {
    const capsule = generateContextCapsule(root);
    saveContextCapsule(root, capsule);
  } catch {
    // Fail open — a capsule that cannot be written must not end the session badly.
  }
  process.exitCode = 0;
}
```

- [ ] **Step 4: Wire the subcommand**

In `thesmos/bin/thesmos-guard.ts`, add the import:

```ts
import { runSessionCapsule } from '../session/capsule-hooks.js';
```

Extend the subcommand set:

```ts
const SUBCOMMANDS = new Set([
  'check',
  'budget-check',
  'drift',
  'session-start',
  'session-capsule',
]);
```

Add dispatch after the `session-start` branch:

```ts
  if (subcommand === 'session-capsule') {
    await runSessionCapsule(root);
    return;
  }
```

Update the usage string:

```ts
    'Usage: thesmos-guard <check|budget-check|drift|session-start|session-capsule> [--quiet]\n',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=thesmos -- session/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add thesmos/session/capsule-hooks.ts thesmos/session/capsule-hooks.test.ts thesmos/bin/thesmos-guard.ts
git commit -m "feat(session): PreCompact and SessionEnd capsule persistence"
```

---

### Task 8: Hook wiring and installation

**Files:**
- Modify: `thesmos/claude-govern.ts` (`governanceHookCommands`, `getGovernanceHooks`)
- Modify: `hooks/hooks.json` (shipped plugin template)
- Modify: `.claude/settings.json` (this repo's own hooks — dogfooding)
- Test: `thesmos/session/hook-wiring.test.ts`

**Interfaces:**
- Consumes: `buildGuardInvocation` from `thesmos/guard-resolve.js`
- Produces: `governanceHookCommands()` gains `sessionStart` and `sessionCapsule` keys

- [ ] **Step 1: Write the failing test**

Create `thesmos/session/hook-wiring.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { governanceHookCommands } from '../claude-govern.js';

describe('governanceHookCommands', () => {
  it('exposes a session-start command', () => {
    expect(governanceHookCommands().sessionStart).toContain('session-start');
  });

  it('exposes a session-capsule command', () => {
    expect(governanceHookCommands().sessionCapsule).toContain('session-capsule');
  });
});

describe('shipped hooks template', () => {
  const template = JSON.parse(
    readFileSync(join(process.cwd(), '..', 'hooks', 'hooks.json'), 'utf8'),
  ) as { hooks: Record<string, unknown[]> };

  it('registers SessionStart', () => {
    expect(template.hooks.SessionStart).toBeDefined();
    expect(JSON.stringify(template.hooks.SessionStart)).toContain('session-start');
  });

  it('registers PreCompact and SessionEnd', () => {
    expect(JSON.stringify(template.hooks.PreCompact)).toContain('session-capsule');
    expect(JSON.stringify(template.hooks.SessionEnd)).toContain('session-capsule');
  });

  it('keeps the existing PreToolUse, PostToolUse and Stop hooks intact', () => {
    expect(template.hooks.PreToolUse).toBeDefined();
    expect(template.hooks.PostToolUse).toBeDefined();
    expect(template.hooks.Stop).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=thesmos -- session/hook-wiring`
Expected: FAIL — `sessionStart` is undefined

- [ ] **Step 3: Extend `governanceHookCommands`**

In `thesmos/claude-govern.ts`, change the function to:

```ts
export function governanceHookCommands(): {
  check: string;
  budget: string;
  drift: string;
  sessionStart: string;
  sessionCapsule: string;
} {
  return {
    check: buildGuardInvocation('check').command,
    budget: buildGuardInvocation('budget-check').command,
    drift: buildGuardInvocation('drift', ['--quiet']).command,
    sessionStart: buildGuardInvocation('session-start').command,
    sessionCapsule: buildGuardInvocation('session-capsule').command,
  };
}
```

And extend `getGovernanceHooks` to return the three new events:

```ts
function getGovernanceHooks(cmds = governanceHookCommands()): {
  PreToolUse: PreToolUseEntry[];
  PostToolUse: SimpleHookEntry[];
  Stop: SimpleHookEntry[];
  SessionStart: SimpleHookEntry[];
  PreCompact: SimpleHookEntry[];
  SessionEnd: SimpleHookEntry[];
} {
  return {
    PreToolUse: [
      { matcher: 'Write', hooks: [{ type: 'command', command: cmds.check }] },
      { matcher: 'Edit', hooks: [{ type: 'command', command: cmds.check }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: cmds.check }] },
    ],
    PostToolUse: [{ hooks: [{ type: 'command', command: cmds.budget }] }],
    Stop: [{ hooks: [{ type: 'command', command: cmds.drift }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: cmds.sessionStart }] }],
    PreCompact: [{ hooks: [{ type: 'command', command: cmds.sessionCapsule }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: cmds.sessionCapsule }] }],
  };
}
```

If `refreshHookCommands` is typed to a union of `'check' | 'budget-check' | 'drift'`, widen it to include `'session-start'` and `'session-capsule'`.

- [ ] **Step 4: Update the shipped template**

In `hooks/hooks.json`, add three sibling keys inside `"hooks"`, alongside the existing `PreToolUse`, `PostToolUse`, and `Stop`:

```json
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/thesmos/dist/thesmos-guard.js", "session-start"]
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/thesmos/dist/thesmos-guard.js", "session-capsule"]
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/thesmos/dist/thesmos-guard.js", "session-capsule"]
          }
        ]
      }
    ]
```

- [ ] **Step 5: Dogfood in this repository**

In `.claude/settings.json`, add the same three keys inside `"hooks"`, using this repo's local dist path (matching the existing entries' style):

```json
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["thesmos/dist/thesmos-guard.js", "session-start"] }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["thesmos/dist/thesmos-guard.js", "session-capsule"] }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["thesmos/dist/thesmos-guard.js", "session-capsule"] }
        ]
      }
    ]
```

- [ ] **Step 6: Run the full suite**

```bash
npm run build --workspace=thesmos
npm test --workspace=thesmos
npx tsc --noEmit
```

Expected: all tests pass, typecheck clean. `claude-govern.test.ts` and `guard.cross-platform.test.ts` must still pass — they assert on hook installation shape and will catch a malformed addition.

- [ ] **Step 7: Verify the whole thing end to end**

```bash
node thesmos/dist/thesmos-guard.js session-start < /dev/null; echo "exit=$?"
node thesmos/dist/thesmos-guard.js session-capsule < /dev/null; echo "exit=$?"
head -5 .thesmos/context.md
```

Expected: both exit 0. `.thesmos/context.md` now names `thesmos-governance` and carries today's date — replacing the stale `thesmos-helper` capsule from 2026-07-23 that motivated this work.

- [ ] **Step 8: Commit**

```bash
git add thesmos/claude-govern.ts hooks/hooks.json .claude/settings.json thesmos/session/hook-wiring.test.ts
git commit -m "feat(session): wire SessionStart, PreCompact and SessionEnd hooks"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `gather.ts`, time-budgeted, never network | 2 |
| `freshness.ts`, pure assessment | 1 |
| `render.ts`, byte-budgeted | 3 |
| `thesmos-guard session-start` subcommand | 5 |
| Fail-open including under `failClosed` | 5 (docstring + implementation) |
| Never `process.exit()` after hook JSON | 5 |
| Detached, unref'd background fetch | 6 |
| Uncertainty reported, not asserted as zero | 1 (`refsUncertain`, null handling), 3 (caveat) |
| `PreCompact` / `SessionEnd` capsule | 7 |
| Config with absent-key defaults | 4 |
| Report age shared with `doctor` | 4 |
| Full failure-mode table | 1, 2, 5 (each `null` path and `try`/`catch`) |
| Test suites named in the spec | 1, 2, 3, 5, 6, 7, 8 |

Two additions beyond the spec, both justified by evidence found during planning:

- **`guardDist` signal** (Task 1) — a month-old `dist/thesmos-guard.js` silently ran stale governance in this repo and defeated auto mode. A staleness hook that cannot detect its own staleness has an obvious blind spot.
- **`session-capsule` as one subcommand** serving both `PreCompact` and `SessionEnd`, rather than two — identical behavior, and a second subcommand would be duplication.

**Placeholder scan:** none. Every step carries real code or a real command.

**Type consistency:** `FreshnessInputs` / `RepoInputs` / `ArtifactInputs` / `StalenessThresholds` / `FreshnessSignal` / `FreshnessReport` are defined once in Task 1 and consumed unchanged. `assessFreshness`, `gatherFreshnessInputs`, `renderSessionContext`, `resolveThresholds`, `resolveSessionOptions`, `spawnBackgroundFetch`, `runSessionStart`, `runSessionCapsule`, `buildSessionStartPayload` keep identical signatures across every task that references them. `ArtifactInputs.guardDistMtimeMs` / `guardSourceMtimeMs` are introduced in Task 1 and populated in Task 2.
