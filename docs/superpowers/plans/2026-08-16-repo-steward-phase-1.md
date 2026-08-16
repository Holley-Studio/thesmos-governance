# Repo Steward Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deterministic, stack-aware PR merge engine gated on Thesmos severity, with an append-only action ledger and automatic revert, able to clear this repo's 24-PR backlog.

**Architecture:** Pure functions (`graph`, `classify`, `plan`) compute a merge plan from `gh` JSON with no network or filesystem access, so all hard logic is fixture-testable. One thin impure module (`execute`) mutates GitHub, and it may not act without first writing an intent record to an append-only JSONL ledger. A GitHub Action watches `main` and reverts regressions, because a local watcher dies with the laptop.

**Tech Stack:** TypeScript (ESM, explicit `.ts` import extensions), Vitest, `gh` CLI for all GitHub access, GitHub Actions for the watcher.

## Global Constraints

- Node 20.x / 22.x / 24.x must all pass — CI matrix runs all three.
- Tests: Vitest. Run with `npm test --workspace=thesmos`. No retries to mask flakes.
- Every new file starts with `// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.`
- Imports use explicit `.ts` extensions (repo convention: `import { x } from '../lib/args.ts'`).
- Command modules export `export async function cmdX(argv: string[]): Promise<void>`.
- No raw provider model IDs outside the canonical registry (AGNT_031 / AGNT_037).
- A BLOCKER finding must never ship. The engine treats BLOCKER as a hard merge refusal.
- Ledger lives at `.thesmos/pr-ledger.jsonl`, mirroring the shipped `.thesmos/savings.jsonl` pattern. Git-ignored.
- All GitHub access goes through `gh`; never store or read the user's token.

**Ledger note:** PR #129 (`feat/council-records`) adds a tamper-evident `thesmos/records/` module. Phase 1 deliberately does **not** depend on it, because depending on an unmerged branch would block this work. Task 4 mirrors the shipped `savings.ts` JSONL pattern instead. Migration to `records/` is a follow-up once #129 lands.

---

### Task 1: PR dependency graph

**Files:**
- Create: `thesmos/pr/types.ts`
- Create: `thesmos/pr/graph.ts`
- Test: `thesmos/pr/graph.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type PullRequest = { number: number; title: string; isDraft: boolean; baseRefName: string; headRefName: string; mergeStateStatus: MergeState; changedFiles: number; files: string[] }`
  - `type MergeState = 'CLEAN' | 'BEHIND' | 'DIRTY' | 'UNSTABLE' | 'BLOCKED' | 'UNKNOWN'`
  - `type PrNode = { pr: PullRequest; parent: number | null; children: number[]; depth: number }`
  - `type PrGraph = { nodes: Map<number, PrNode>; roots: number[]; cycles: number[][] }`
  - `buildGraph(prs: PullRequest[], defaultBranch: string): PrGraph`

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/graph.test.ts
import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph.ts';
import type { PullRequest } from './types.ts';

function pr(number: number, headRefName: string, baseRefName: string): PullRequest {
  return {
    number, title: `pr-${number}`, isDraft: false, baseRefName, headRefName,
    mergeStateStatus: 'CLEAN', changedFiles: 1, files: [],
  };
}

describe('buildGraph', () => {
  it('links a stacked chain by base/head and assigns depth', () => {
    // Mirrors the real chain observed 2026-08-05: #135 -> #136 -> #137
    const graph = buildGraph([
      pr(135, 'feat/model-routing-v5', 'main'),
      pr(136, 'feat/eunomia', 'feat/model-routing-v5'),
      pr(137, 'chore/phase-0', 'feat/eunomia'),
    ], 'main');

    expect(graph.roots).toEqual([135]);
    expect(graph.nodes.get(136)!.parent).toBe(135);
    expect(graph.nodes.get(137)!.parent).toBe(136);
    expect(graph.nodes.get(137)!.depth).toBe(2);
    expect(graph.nodes.get(135)!.children).toEqual([136]);
    expect(graph.cycles).toEqual([]);
  });

  it('detects a cycle instead of looping forever', () => {
    const graph = buildGraph([
      pr(1, 'a', 'b'),
      pr(2, 'b', 'a'),
    ], 'main');

    expect(graph.cycles.length).toBe(1);
    expect(graph.cycles[0].sort()).toEqual([1, 2]);
    expect(graph.roots).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/graph.test.ts`
Expected: FAIL — cannot find module `./graph.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/types.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.

export type MergeState = 'CLEAN' | 'BEHIND' | 'DIRTY' | 'UNSTABLE' | 'BLOCKED' | 'UNKNOWN';

export interface PullRequest {
  number: number;
  title: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  mergeStateStatus: MergeState;
  changedFiles: number;
  files: string[];
}

export interface PrNode {
  pr: PullRequest;
  parent: number | null;
  children: number[];
  depth: number;
}

export interface PrGraph {
  nodes: Map<number, PrNode>;
  roots: number[];
  cycles: number[][];
}
```

```ts
// thesmos/pr/graph.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Builds the PR dependency forest. A PR whose baseRefName is another PR's
 * headRefName is stacked on that PR; GitHub renders these as independent.
 */
import type { PrGraph, PrNode, PullRequest } from './types.ts';

export function buildGraph(prs: PullRequest[], defaultBranch: string): PrGraph {
  const byHead = new Map<string, number>();
  for (const pr of prs) byHead.set(pr.headRefName, pr.number);

  const nodes = new Map<number, PrNode>();
  for (const pr of prs) {
    const parent = pr.baseRefName === defaultBranch ? null : byHead.get(pr.baseRefName) ?? null;
    nodes.set(pr.number, { pr, parent, children: [], depth: 0 });
  }

  for (const node of nodes.values()) {
    if (node.parent !== null) nodes.get(node.parent)?.children.push(node.pr.number);
  }

  const cycles = findCycles(nodes);
  const inCycle = new Set(cycles.flat());

  const roots: number[] = [];
  for (const node of nodes.values()) {
    if (inCycle.has(node.pr.number)) continue;
    if (node.parent === null) roots.push(node.pr.number);
  }

  for (const root of roots) assignDepth(nodes, root, 0, inCycle);

  return { nodes, roots: roots.sort((a, b) => a - b), cycles };
}

function assignDepth(nodes: Map<number, PrNode>, n: number, depth: number, skip: Set<number>): void {
  const node = nodes.get(n);
  if (!node || skip.has(n)) return;
  node.depth = depth;
  for (const child of node.children) assignDepth(nodes, child, depth + 1, skip);
}

function findCycles(nodes: Map<number, PrNode>): number[][] {
  const cycles: number[][] = [];
  const seen = new Set<number>();

  for (const start of nodes.keys()) {
    if (seen.has(start)) continue;
    const path: number[] = [];
    const onPath = new Set<number>();
    let cur: number | null = start;

    while (cur !== null && !seen.has(cur)) {
      if (onPath.has(cur)) {
        cycles.push(path.slice(path.indexOf(cur)));
        break;
      }
      path.push(cur);
      onPath.add(cur);
      cur = nodes.get(cur)?.parent ?? null;
    }
    for (const n of path) seen.add(n);
  }
  return cycles;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run thesmos/pr/graph.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add thesmos/pr/types.ts thesmos/pr/graph.ts thesmos/pr/graph.test.ts
git commit -m "feat(pr): build PR dependency graph with cycle detection"
```

---

### Task 2: Reversibility classification

**Files:**
- Create: `thesmos/pr/classify.ts`
- Test: `thesmos/pr/classify.test.ts`

**Interfaces:**
- Consumes: `PullRequest` from `./types.ts`
- Produces:
  - `type Reversibility = 'reversible' | 'recoverable' | 'one-way'`
  - `type SemverBump = 'patch' | 'minor' | 'major' | 'unknown'`
  - `parseBump(title: string): SemverBump`
  - `classify(pr: PullRequest): { class: Reversibility; reason: string }`

Autonomy is granted by how cheaply an action undoes, never by confidence. Uncertain classification resolves to `one-way` — ambiguity resolves toward asking.

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/classify.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/classify.test.ts`
Expected: FAIL — cannot find module `./classify.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/classify.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Assigns a reversibility class. Autonomy follows how cheaply an action
 * undoes, not how confident we are: a confident wrong merge is still wrong.
 * Unknown shapes resolve to one-way so ambiguity always asks.
 */
import type { PullRequest } from './types.ts';

export type Reversibility = 'reversible' | 'recoverable' | 'one-way';
export type SemverBump = 'patch' | 'minor' | 'major' | 'unknown';

const BUMP_RE = /from\s+v?(\d+)\.(\d+)\.(\d+)\S*\s+to\s+v?(\d+)\.(\d+)\.(\d+)/i;

/** Paths where a mistake is not cheaply undone. */
const ONE_WAY_PATHS = [
  /(^|\/)auth\//, /(^|\/)payments?\//, /(^|\/)billing\//,
  /migrations?\//, /\.github\/workflows\/release/, /(^|\/)secrets?\//,
];

const LOCKFILE_ONLY = /^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const DOCS_ONLY = /\.(md|mdx|txt)$|^docs\//;

export function parseBump(title: string): SemverBump {
  const m = BUMP_RE.exec(title);
  if (!m) return 'unknown';
  const [fromMaj, fromMin, , toMaj, toMin] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (toMaj !== fromMaj) return 'major';
  if (toMin !== fromMin) return 'minor';
  return 'patch';
}

export function classify(pr: PullRequest): { class: Reversibility; reason: string } {
  for (const re of ONE_WAY_PATHS) {
    const hit = pr.files.find((f) => re.test(f));
    if (hit) return { class: 'one-way', reason: `touches sensitive path ${hit}` };
  }

  const bump = parseBump(pr.title);
  if (bump === 'major') {
    return { class: 'one-way', reason: 'major version bump — may contain breaking changes' };
  }
  if (bump === 'patch' && pr.files.every((f) => LOCKFILE_ONLY.test(f))) {
    return { class: 'reversible', reason: 'patch bump, lockfile only' };
  }
  if (bump === 'minor') {
    return { class: 'recoverable', reason: 'minor version bump' };
  }
  if (pr.files.length > 0 && pr.files.every((f) => DOCS_ONLY.test(f))) {
    return { class: 'recoverable', reason: 'documentation only' };
  }

  return { class: 'one-way', reason: 'could not classify confidently — asking rather than guessing' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run thesmos/pr/classify.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add thesmos/pr/classify.ts thesmos/pr/classify.test.ts
git commit -m "feat(pr): classify PRs by reversibility, defaulting to one-way"
```

---

### Task 3: Merge planner

**Files:**
- Create: `thesmos/pr/plan.ts`
- Test: `thesmos/pr/plan.test.ts`

**Interfaces:**
- Consumes: `buildGraph`, `PrGraph`, `PullRequest`, `classify`
- Produces:
  - `type HaltReason = 'RED_BASE' | 'CYCLE' | 'DIRTY' | 'BLOCKER' | 'OBSOLETE' | 'DRAFT' | 'ONE_WAY' | 'PARENT_BLOCKED'`
  - `type PlanEntry = { number: number; wave: number }`
  - `type HaltEntry = { number: number; reason: HaltReason; detail: string; blocks: number[] }`
  - `type MergePlan = { waves: PlanEntry[][]; halted: HaltEntry[] }`
  - `computePlan(prs: PullRequest[], opts: { defaultBranch: string; blockers: Set<number>; autonomy: 'reversible' | 'recoverable' | 'all' }): MergePlan`

`RED_BASE` is the state GitHub renders invisibly today. It must name every PR it blocks.

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/plan.test.ts
import { describe, it, expect } from 'vitest';
import { computePlan } from './plan.ts';
import type { PullRequest } from './types.ts';

function pr(number: number, head: string, base: string, over: Partial<PullRequest> = {}): PullRequest {
  return {
    number, title: `chore(deps): bump p${number} from 1.0.0 to 1.0.1`, isDraft: false,
    baseRefName: base, headRefName: head, mergeStateStatus: 'CLEAN',
    changedFiles: 1, files: ['package-lock.json'], ...over,
  };
}

const opts = { defaultBranch: 'main', blockers: new Set<number>(), autonomy: 'recoverable' as const };

describe('computePlan', () => {
  it('orders a stack into successive waves', () => {
    const plan = computePlan([
      pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(3, 'c', 'b'),
    ], opts);
    expect(plan.waves[0].map((e) => e.number)).toEqual([1]);
    expect(plan.waves[1].map((e) => e.number)).toEqual([2]);
    expect(plan.waves[2].map((e) => e.number)).toEqual([3]);
  });

  it('halts a whole column on a red base and names what it blocks', () => {
    // Mirrors #140 failing beneath five dependents.
    const plan = computePlan([
      pr(140, 'runtime', 'main', { mergeStateStatus: 'UNSTABLE' }),
      pr(141, 'memory', 'runtime'),
      pr(142, 'context', 'memory'),
    ], opts);

    const red = plan.halted.find((h) => h.number === 140)!;
    expect(red.reason).toBe('RED_BASE');
    expect(red.blocks.sort()).toEqual([141, 142]);
    expect(plan.waves.flat()).toEqual([]);
  });

  it('never plans a one-way PR', () => {
    const plan = computePlan([
      pr(1, 'a', 'main', { title: 'chore(deps): bump x from 1.0.0 to 2.0.0' }),
    ], opts);
    expect(plan.waves.flat()).toEqual([]);
    expect(plan.halted[0].reason).toBe('ONE_WAY');
  });

  it('refuses to plan a BLOCKER finding', () => {
    const plan = computePlan([pr(1, 'a', 'main')], { ...opts, blockers: new Set([1]) });
    expect(plan.waves.flat()).toEqual([]);
    expect(plan.halted[0].reason).toBe('BLOCKER');
  });

  it('skips a conflicted PR without attempting resolution', () => {
    const plan = computePlan([pr(1, 'a', 'main', { mergeStateStatus: 'DIRTY' })], opts);
    expect(plan.halted[0].reason).toBe('DIRTY');
  });

  it('orders smallest-first inside a wave', () => {
    const plan = computePlan([
      pr(1, 'a', 'main', { changedFiles: 40 }),
      pr(2, 'b', 'main', { changedFiles: 2 }),
    ], opts);
    expect(plan.waves[0].map((e) => e.number)).toEqual([2, 1]);
  });

  it('reports a cycle rather than planning it', () => {
    const plan = computePlan([pr(1, 'a', 'b'), pr(2, 'b', 'a')], opts);
    expect(plan.halted.every((h) => h.reason === 'CYCLE')).toBe(true);
    expect(plan.waves.flat()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/plan.test.ts`
Expected: FAIL — cannot find module `./plan.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/plan.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Computes merge waves from the PR graph. Pure: no network, no filesystem.
 * A PR is only planned when every ancestor is planned ahead of it.
 */
import { buildGraph } from './graph.ts';
import { classify, type Reversibility } from './classify.ts';
import type { PullRequest } from './types.ts';

export type HaltReason =
  | 'RED_BASE' | 'CYCLE' | 'DIRTY' | 'BLOCKER' | 'OBSOLETE' | 'DRAFT' | 'ONE_WAY' | 'PARENT_BLOCKED';

export interface PlanEntry { number: number; wave: number }
export interface HaltEntry { number: number; reason: HaltReason; detail: string; blocks: number[] }
export interface MergePlan { waves: PlanEntry[][]; halted: HaltEntry[] }

export interface PlanOptions {
  defaultBranch: string;
  blockers: Set<number>;
  autonomy: 'reversible' | 'recoverable' | 'all';
}

const ALLOWED: Record<PlanOptions['autonomy'], Reversibility[]> = {
  reversible: ['reversible'],
  recoverable: ['reversible', 'recoverable'],
  all: ['reversible', 'recoverable', 'one-way'],
};

export function computePlan(prs: PullRequest[], opts: PlanOptions): MergePlan {
  const graph = buildGraph(prs, opts.defaultBranch);
  const halted: HaltEntry[] = [];
  const blocked = new Set<number>();

  for (const cycle of graph.cycles) {
    for (const n of cycle) {
      halted.push({ number: n, reason: 'CYCLE', detail: `dependency cycle: ${cycle.join(' → ')}`, blocks: [] });
      blocked.add(n);
    }
  }

  const descendantsOf = (n: number): number[] => {
    const out: number[] = [];
    const walk = (id: number) => {
      for (const c of graph.nodes.get(id)?.children ?? []) { out.push(c); walk(c); }
    };
    walk(n);
    return out;
  };

  const halt = (n: number, reason: HaltReason, detail: string) => {
    if (blocked.has(n)) return;
    const blocks = descendantsOf(n);
    halted.push({ number: n, reason, detail, blocks });
    blocked.add(n);
    for (const d of blocks) {
      if (!blocked.has(d)) {
        halted.push({ number: d, reason: 'PARENT_BLOCKED', detail: `waiting on #${n}`, blocks: [] });
        blocked.add(d);
      }
    }
  };

  const allowed = ALLOWED[opts.autonomy];

  for (const node of [...graph.nodes.values()].sort((a, b) => a.depth - b.depth)) {
    const { pr } = node;
    if (blocked.has(pr.number)) continue;

    if (opts.blockers.has(pr.number)) { halt(pr.number, 'BLOCKER', 'Thesmos BLOCKER finding'); continue; }
    if (pr.mergeStateStatus === 'DIRTY') { halt(pr.number, 'DIRTY', 'merge conflict — needs a human'); continue; }
    if (pr.mergeStateStatus === 'UNSTABLE' || pr.mergeStateStatus === 'BLOCKED') {
      halt(pr.number, 'RED_BASE', 'checks are failing'); continue;
    }
    if (pr.isDraft) { halt(pr.number, 'DRAFT', 'still a draft'); continue; }

    const cls = classify(pr);
    if (!allowed.includes(cls.class)) { halt(pr.number, 'ONE_WAY', cls.reason); continue; }
  }

  const waves: PlanEntry[][] = [];
  for (const node of graph.nodes.values()) {
    if (blocked.has(node.pr.number)) continue;
    (waves[node.depth] ??= []).push({ number: node.pr.number, wave: node.depth });
  }

  const sized = new Map(prs.map((p) => [p.number, p.changedFiles]));
  for (const wave of waves) {
    if (wave) wave.sort((a, b) => (sized.get(a.number)! - sized.get(b.number)!) || a.number - b.number);
  }

  return { waves: waves.filter(Boolean), halted };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run thesmos/pr/plan.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add thesmos/pr/plan.ts thesmos/pr/plan.test.ts
git commit -m "feat(pr): compute merge waves with named halt states"
```

---

### Task 4: Action ledger

**Files:**
- Create: `thesmos/pr/ledger.ts`
- Test: `thesmos/pr/ledger.test.ts`
- Modify: `.gitignore` — add `.thesmos/pr-ledger.jsonl`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type LedgerAction = 'merge' | 'revert' | 'close'`
  - `type LedgerEntry = { ts: string; action: LedgerAction; pr: number; phase: 'intent' | 'outcome'; class?: string; mergeCommit?: string; ok?: boolean; detail?: string }`
  - `appendEntry(root: string, entry: Omit<LedgerEntry, 'ts'>, now: Date): void`
  - `readEntries(root: string): LedgerEntry[]`
  - `armedMerges(entries: LedgerEntry[]): LedgerEntry[]` — merges with an outcome but no revert

Mirrors the shipped `.thesmos/savings.jsonl` pattern. Intent is written and fsync'd **before** the action, so a merge with no ledger record is impossible. Corrupt lines are skipped, never fatal.

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/ledger.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEntry, readEntries, armedMerges } from './ledger.ts';

let root: string;
const AT = new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-ledger-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

describe('ledger', () => {
  it('appends and reads entries in order', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'intent' }, AT);
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'abc123' }, AT);

    const entries = readEntries(root);
    expect(entries.map((e) => e.phase)).toEqual(['intent', 'outcome']);
    expect(entries[1].mergeCommit).toBe('abc123');
    expect(entries[0].ts).toBe('2026-08-16T12:00:00.000Z');
  });

  it('returns an empty list when no ledger exists', () => {
    expect(readEntries(root)).toEqual([]);
  });

  it('skips a corrupt line instead of throwing', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'intent' }, AT);
    const p = join(root, '.thesmos', 'pr-ledger.jsonl');
    writeFileSync(p, readFileSync(p, 'utf8') + '{not json\n', 'utf8');
    appendEntry(root, { action: 'merge', pr: 2, phase: 'intent' }, AT);

    expect(readEntries(root).map((e) => e.pr)).toEqual([1, 2]);
  });

  it('reports merges that have not been reverted', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'a' }, AT);
    appendEntry(root, { action: 'merge', pr: 2, phase: 'outcome', ok: true, mergeCommit: 'b' }, AT);
    appendEntry(root, { action: 'revert', pr: 1, phase: 'outcome', ok: true }, AT);

    expect(armedMerges(readEntries(root)).map((e) => e.pr)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/ledger.test.ts`
Expected: FAIL — cannot find module `./ledger.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/ledger.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Append-only JSONL record of every autonomous action, mirroring the shipped
 * .thesmos/savings.jsonl pattern. Intent is durable before the action runs, so
 * a merge that left no record cannot happen. Corrupt lines are isolated.
 */
import { appendFileSync, existsSync, mkdirSync, openSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LedgerAction = 'merge' | 'revert' | 'close';

export interface LedgerEntry {
  ts: string;
  action: LedgerAction;
  pr: number;
  phase: 'intent' | 'outcome';
  class?: string;
  mergeCommit?: string;
  ok?: boolean;
  detail?: string;
}

export function ledgerPath(root: string): string {
  return join(root, '.thesmos', 'pr-ledger.jsonl');
}

export function appendEntry(root: string, entry: Omit<LedgerEntry, 'ts'>, now: Date): void {
  const path = ledgerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const line = JSON.stringify({ ts: now.toISOString(), ...entry }) + '\n';
  appendFileSync(path, line, 'utf8');

  // Durability: the record must survive a crash between write and action.
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function readEntries(root: string): LedgerEntry[] {
  const path = ledgerPath(root);
  if (!existsSync(path)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as LedgerEntry); } catch { /* corrupt line is isolated */ }
  }
  return out;
}

/** Merges Thesmos performed that have not since been reverted. */
export function armedMerges(entries: LedgerEntry[]): LedgerEntry[] {
  const reverted = new Set(
    entries.filter((e) => e.action === 'revert' && e.phase === 'outcome').map((e) => e.pr),
  );
  return entries.filter(
    (e) => e.action === 'merge' && e.phase === 'outcome' && e.ok === true && !reverted.has(e.pr),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run thesmos/pr/ledger.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Add the ledger to .gitignore and commit**

```bash
printf '\n# Thesmos PR action ledger (local runtime state)\n.thesmos/pr-ledger.jsonl\n' >> .gitignore
git add thesmos/pr/ledger.ts thesmos/pr/ledger.test.ts .gitignore
git commit -m "feat(pr): append-only action ledger with durable intent records"
```

---

### Task 5: Executor and kill switch

**Files:**
- Create: `thesmos/pr/execute.ts`
- Test: `thesmos/pr/execute.test.ts`

**Interfaces:**
- Consumes: `appendEntry` from `./ledger.ts`, `MergePlan` from `./plan.ts`
- Produces:
  - `type GhRunner = (args: string[]) => { ok: boolean; stdout: string; stderr: string }`
  - `isAutonomyDisabled(root: string): boolean`
  - `setAutonomy(root: string, enabled: boolean): void`
  - `executeWave(root: string, wave: PlanEntry[], deps: { gh: GhRunner; now: () => Date }): { merged: number[]; failed: number[] }`

`gh` is injected so tests never touch the network. Execution halts on the first failure — a partially executed wave is worse than a refused one.

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/execute.test.ts
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
    const order: string[] = [];
    const gh = () => { order.push('gh'); return okGh(); };
    executeWave(root, [{ number: 7, wave: 0 }], { gh, now });

    const entries = readEntries(root);
    expect(entries[0].phase).toBe('intent');
    expect(order).toEqual(['gh']);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/execute.test.ts`
Expected: FAIL — cannot find module `./execute.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/execute.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The only module that mutates GitHub. gh is injected so tests stay offline.
 * Intent is durable before any call, and a wave halts on first failure —
 * a half-executed wave is worse than one that refused to start.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEntry } from './ledger.ts';
import type { PlanEntry } from './plan.ts';

export type GhRunner = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

function sentinel(root: string): string {
  return join(root, '.thesmos', 'autonomy-disabled');
}

export function isAutonomyDisabled(root: string): boolean {
  return existsSync(sentinel(root));
}

export function setAutonomy(root: string, enabled: boolean): void {
  if (enabled) rmSync(sentinel(root), { force: true });
  else writeFileSync(sentinel(root), 'autonomy disabled\n', 'utf8');
}

export function executeWave(
  root: string,
  wave: PlanEntry[],
  deps: { gh: GhRunner; now: () => Date },
): { merged: number[]; failed: number[] } {
  const merged: number[] = [];
  const failed: number[] = [];
  if (isAutonomyDisabled(root)) return { merged, failed };

  for (const entry of wave) {
    appendEntry(root, { action: 'merge', pr: entry.number, phase: 'intent' }, deps.now());

    const result = deps.gh(['pr', 'merge', String(entry.number), '--squash', '--delete-branch']);

    appendEntry(root, {
      action: 'merge', pr: entry.number, phase: 'outcome',
      ok: result.ok, detail: result.ok ? undefined : result.stderr.slice(0, 200),
    }, deps.now());

    if (!result.ok) { failed.push(entry.number); break; }
    merged.push(entry.number);
  }

  return { merged, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run thesmos/pr/execute.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add thesmos/pr/execute.ts thesmos/pr/execute.test.ts
git commit -m "feat(pr): wave executor with ledger-before-action and kill switch"
```

---

### Task 6: `thesmos pr:queue` and `pr:explain`

**Files:**
- Create: `thesmos/pr/fetch.ts`
- Create: `thesmos/bin/commands/pr.ts`
- Modify: `thesmos/bin/cli.ts` — register `pr:queue`, `pr:explain`
- Test: `thesmos/pr/fetch.test.ts`

**Interfaces:**
- Consumes: `computePlan`, `readEntries`, `GhRunner`
- Produces:
  - `fetchPullRequests(gh: GhRunner): PullRequest[]`
  - `renderPlan(plan: MergePlan, prs: PullRequest[]): string`
  - `export async function cmdPr(argv: string[]): Promise<void>`

Read-only. Vocabulary stays plain: no "rebase", "topological", or "speculative" in any user-facing string.

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/fetch.test.ts
import { describe, it, expect } from 'vitest';
import { fetchPullRequests, renderPlan } from './fetch.ts';
import { computePlan } from './plan.ts';

const GH_JSON = JSON.stringify([
  { number: 140, title: 'feat: runtime', isDraft: false, baseRefName: 'main',
    headRefName: 'runtime', mergeStateStatus: 'UNSTABLE', changedFiles: 37, files: [{ path: 'a.ts' }] },
  { number: 141, title: 'feat: memory', isDraft: false, baseRefName: 'runtime',
    headRefName: 'memory', mergeStateStatus: 'CLEAN', changedFiles: 25, files: [{ path: 'b.ts' }] },
]);

describe('fetchPullRequests', () => {
  it('flattens gh file objects into plain paths', () => {
    const prs = fetchPullRequests(() => ({ ok: true, stdout: GH_JSON, stderr: '' }));
    expect(prs[0].files).toEqual(['a.ts']);
    expect(prs[1].number).toBe(141);
  });

  it('throws a clear error when gh fails', () => {
    expect(() => fetchPullRequests(() => ({ ok: false, stdout: '', stderr: 'not logged in' })))
      .toThrow(/not logged in/);
  });
});

describe('renderPlan', () => {
  it('names the blocked PRs and avoids jargon', () => {
    const prs = fetchPullRequests(() => ({ ok: true, stdout: GH_JSON, stderr: '' }));
    const out = renderPlan(
      computePlan(prs, { defaultBranch: 'main', blockers: new Set(), autonomy: 'recoverable' }),
      prs,
    );
    expect(out).toMatch(/#140/);
    expect(out).toMatch(/#141/);
    expect(out).not.toMatch(/rebase|topolog|speculat/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/fetch.test.ts`
Expected: FAIL — cannot find module `./fetch.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/fetch.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** Reads PR state via gh and renders a plan in plain language. */
import type { GhRunner } from './execute.ts';
import type { MergePlan } from './plan.ts';
import type { PullRequest } from './types.ts';

const FIELDS = 'number,title,isDraft,baseRefName,headRefName,mergeStateStatus,changedFiles,files';

export function fetchPullRequests(gh: GhRunner): PullRequest[] {
  const res = gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', FIELDS]);
  if (!res.ok) throw new Error(`could not read pull requests: ${res.stderr.trim()}`);

  return (JSON.parse(res.stdout) as Array<Record<string, unknown>>).map((raw) => ({
    number: raw.number as number,
    title: raw.title as string,
    isDraft: raw.isDraft as boolean,
    baseRefName: raw.baseRefName as string,
    headRefName: raw.headRefName as string,
    mergeStateStatus: (raw.mergeStateStatus ?? 'UNKNOWN') as PullRequest['mergeStateStatus'],
    changedFiles: (raw.changedFiles ?? 0) as number,
    files: ((raw.files ?? []) as Array<{ path: string }>).map((f) => f.path),
  }));
}

const PLAIN: Record<string, string> = {
  RED_BASE: 'its checks are failing',
  DIRTY: 'it clashes with main — this one needs you',
  BLOCKER: 'Thesmos found something that must not ship',
  ONE_WAY: 'this change is hard to undo, so it needs your say-so',
  DRAFT: 'still a draft',
  CYCLE: 'these depend on each other in a loop',
  PARENT_BLOCKED: 'it is waiting on another PR',
  OBSOLETE: 'the files it changes no longer exist',
};

export function renderPlan(plan: MergePlan, prs: PullRequest[]): string {
  const title = new Map(prs.map((p) => [p.number, p.title]));
  const lines: string[] = [];
  const ready = plan.waves.flat().length;

  lines.push(`  Looked at ${prs.length} open pull requests.`, '');
  if (ready > 0) {
    lines.push(`  ✓ ${ready} ready to merge`);
    plan.waves.forEach((wave, i) => {
      for (const e of wave) lines.push(`      #${e.number}  ${title.get(e.number) ?? ''}${i > 0 ? `  (after wave ${i})` : ''}`);
    });
    lines.push('');
  }

  for (const h of plan.halted.filter((x) => x.reason !== 'PARENT_BLOCKED')) {
    lines.push(`  ✗ #${h.number} — ${PLAIN[h.reason] ?? h.reason}`);
    if (h.detail) lines.push(`      ${h.detail}`);
    if (h.blocks.length) {
      lines.push(`      nothing built on top of it can move: ${h.blocks.map((b) => `#${b}`).join(', ')}`);
    }
  }

  return lines.join('\n') + '\n';
}
```

```ts
// thesmos/bin/commands/pr.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** thesmos pr:* — governed pull-request queue. */
import { spawnSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { fetchPullRequests, renderPlan } from '../../pr/fetch.ts';
import { computePlan } from '../../pr/plan.ts';
import type { GhRunner } from '../../pr/execute.ts';

export const realGh: GhRunner = (args) => {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

export async function cmdPr(argv: string[]): Promise<void> {
  const [sub] = argv;
  createContext();
  const prs = fetchPullRequests(realGh);
  const plan = computePlan(prs, { defaultBranch: 'main', blockers: new Set(), autonomy: 'recoverable' });

  if (sub === 'explain') {
    const n = Number(argv[1]);
    const halt = plan.halted.find((h) => h.number === n);
    process.stdout.write(halt ? `  #${n} — ${halt.detail}\n` : `  #${n} is ready to merge.\n`);
    return;
  }

  process.stdout.write(renderPlan(plan, prs));
}
```

- [ ] **Step 4: Register the commands in the CLI**

In `thesmos/bin/cli.ts`, import `cmdPr` alongside the existing command imports and add to the dispatch map, following the existing `'pack:validate'` style:

```ts
  'pr:queue':   (argv) => cmdPr(['queue', ...argv]),
  'pr:explain': (argv) => cmdPr(['explain', ...argv]),
```

- [ ] **Step 5: Run tests and a live smoke check**

Run: `npx vitest run thesmos/pr/`
Expected: PASS (all pr tests)

Run: `npx tsx thesmos/bin/cli.ts pr:queue`
Expected: prints the real plan for this repo's open PRs, naming #140 as blocking its dependents.

- [ ] **Step 6: Commit**

```bash
git add thesmos/pr/fetch.ts thesmos/pr/fetch.test.ts thesmos/bin/commands/pr.ts thesmos/bin/cli.ts
git commit -m "feat(pr): thesmos pr:queue and pr:explain"
```

---

### Task 7: `thesmos pr:merge`

**Files:**
- Modify: `thesmos/bin/commands/pr.ts` — add the `merge` subcommand
- Modify: `thesmos/bin/cli.ts` — register `pr:merge`, `autonomy`
- Test: `thesmos/pr/merge-command.test.ts`

**Interfaces:**
- Consumes: `executeWave`, `setAutonomy`, `computePlan`, `renderPlan`
- Produces: `pr:merge --wave <n> | --all`, `autonomy on|off`

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/merge-command.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMerge } from '../bin/commands/pr.ts';

let root: string;
const now = () => new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-merge-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

const PRS = JSON.stringify([
  { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', isDraft: false, baseRefName: 'main',
    headRefName: 'a', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
  { number: 2, title: 'chore(deps): bump b from 1.0.0 to 2.0.0', isDraft: false, baseRefName: 'main',
    headRefName: 'b', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
]);

describe('runMerge', () => {
  it('merges the reversible PR and never the major bump', () => {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return { ok: true, stdout: args[0] === 'pr' && args[1] === 'list' ? PRS : '', stderr: '' };
    };

    const result = runMerge(root, { wave: 0 }, { gh, now });

    expect(result.merged).toEqual([1]);
    const merges = calls.filter((c) => c[1] === 'merge').map((c) => c[2]);
    expect(merges).toEqual(['1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/merge-command.test.ts`
Expected: FAIL — `runMerge` is not exported

- [ ] **Step 3: Write minimal implementation**

Add to `thesmos/bin/commands/pr.ts`:

```ts
import { executeWave, setAutonomy, isAutonomyDisabled } from '../../pr/execute.ts';

export function runMerge(
  root: string,
  opts: { wave: number | 'all' },
  deps: { gh: GhRunner; now: () => Date },
): { merged: number[]; failed: number[] } {
  const prs = fetchPullRequests(deps.gh);
  const plan = computePlan(prs, { defaultBranch: 'main', blockers: new Set(), autonomy: 'recoverable' });

  const waves = opts.wave === 'all' ? plan.waves : [plan.waves[opts.wave] ?? []];
  const merged: number[] = [];
  const failed: number[] = [];

  for (const wave of waves) {
    const r = executeWave(root, wave, deps);
    merged.push(...r.merged);
    failed.push(...r.failed);
    if (r.failed.length) break;  // never continue past a failure
  }

  return { merged, failed };
}
```

Extend `cmdPr` to route `merge` and `autonomy`:

```ts
  if (sub === 'merge') {
    const { root } = createContext();
    if (isAutonomyDisabled(root)) {
      process.stdout.write('  Autonomy is off. Turn it back on with: thesmos autonomy on\n');
      return;
    }
    const waveArg = argv.includes('--all') ? 'all' as const : Number(argv[argv.indexOf('--wave') + 1] ?? 0);
    const result = runMerge(root, { wave: waveArg }, { gh: realGh, now: () => new Date() });
    process.stdout.write(`  ✓ merged ${result.merged.length}: ${result.merged.map((n) => `#${n}`).join(', ')}\n`);
    if (result.failed.length) {
      process.stdout.write(`  ✗ stopped at #${result.failed[0]} — nothing after it was attempted\n`);
    }
    return;
  }
```

- [ ] **Step 4: Register in the CLI and run tests**

In `thesmos/bin/cli.ts`:

```ts
  'pr:merge':  (argv) => cmdPr(['merge', ...argv]),
  'autonomy':  (argv) => cmdPr(['autonomy', ...argv]),
```

Run: `npx vitest run thesmos/pr/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add thesmos/bin/commands/pr.ts thesmos/bin/cli.ts thesmos/pr/merge-command.test.ts
git commit -m "feat(pr): thesmos pr:merge with wave execution and autonomy switch"
```

---

### Task 8: Revert watcher

**Files:**
- Create: `thesmos/pr/revert.ts`
- Create: `.github/workflows/thesmos-watch.yml`
- Test: `thesmos/pr/revert.test.ts`

**Interfaces:**
- Consumes: `armedMerges`, `readEntries`, `appendEntry`, `GhRunner`
- Produces: `chooseCulprit(entries: LedgerEntry[], failingRange: string[]): LedgerEntry | null`, `performRevert(root, culprit, deps): boolean`

The watcher must be an Action, not a local poll: a safety guarantee that depends on the user keeping a terminal open is not a guarantee.

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/revert.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseCulprit, performRevert } from './revert.ts';
import { appendEntry, readEntries } from './ledger.ts';

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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/revert.test.ts`
Expected: FAIL — cannot find module `./revert.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/revert.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Auto-revert. The claim is not "we won't break main" but "we'll un-break it
 * fast" — this is what makes unattended merging honest. Runs from the watch
 * workflow, because a local poll dies with the laptop.
 */
import { appendEntry, armedMerges, type LedgerEntry } from './ledger.ts';
import { setAutonomy, type GhRunner } from './execute.ts';

export function chooseCulprit(entries: LedgerEntry[], failingRange: string[]): LedgerEntry | null {
  const inRange = armedMerges(entries).filter(
    (e) => e.mergeCommit && failingRange.includes(e.mergeCommit),
  );
  return inRange.length ? inRange[inRange.length - 1] : null;
}

/**
 * `gh pr revert` only *opens* a revert PR — it has no --merge flag — so this
 * is two steps: create, then merge the PR it printed.
 */
export function performRevert(
  root: string,
  culprit: LedgerEntry,
  deps: { gh: GhRunner; now: () => Date },
): boolean {
  appendEntry(root, { action: 'revert', pr: culprit.pr, phase: 'intent' }, deps.now());

  const fail = (detail: string): boolean => {
    appendEntry(root, { action: 'revert', pr: culprit.pr, phase: 'outcome', ok: false, detail }, deps.now());
    setAutonomy(root, false);  // a failed revert must never be retried blindly
    return false;
  };

  const created = deps.gh([
    'pr', 'revert', String(culprit.pr),
    '--title', `Revert #${culprit.pr} — main regressed after merge`,
    '--body', `Automatic revert by Thesmos. main failed after #${culprit.pr} merged.`,
  ]);
  if (!created.ok) return fail(created.stderr.slice(0, 200));

  const revertPr = /\/pull\/(\d+)/.exec(created.stdout)?.[1];
  if (!revertPr) return fail('could not determine the revert PR number');

  const merged = deps.gh(['pr', 'merge', revertPr, '--squash', '--delete-branch']);
  if (!merged.ok) return fail(merged.stderr.slice(0, 200));

  appendEntry(root, {
    action: 'revert', pr: culprit.pr, phase: 'outcome',
    ok: true, detail: `main went red after this merge; reverted via #${revertPr}`,
  }, deps.now());
  return true;
}
```

- [ ] **Step 4: Add the watch workflow**

```yaml
# .github/workflows/thesmos-watch.yml
name: Thesmos Watch

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  watch:
    name: Revert on regression
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 20
      - uses: actions/setup-node@v5
        with:
          node-version: 22.x
      - run: npm ci
      - name: Check main and revert a Thesmos merge if it regressed
        env:
          GH_TOKEN: ${{ github.token }}
        run: npx tsx thesmos/bin/cli.ts pr:watch --range 5
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run thesmos/pr/`
Expected: PASS (all tests across the pr module)

- [ ] **Step 6: Commit**

```bash
git add thesmos/pr/revert.ts thesmos/pr/revert.test.ts .github/workflows/thesmos-watch.yml
git commit -m "feat(pr): auto-revert watcher with fail-closed autonomy halt"
```

---

### Task 9: Speculative verification

**Files:**
- Create: `thesmos/pr/speculate.ts`
- Modify: `thesmos/bin/commands/pr.ts` — add the `watch` subcommand the workflow calls
- Modify: `thesmos/bin/cli.ts` — register `pr:watch`
- Test: `thesmos/pr/speculate.test.ts`

**Interfaces:**
- Consumes: `PullRequest`, `PlanEntry`, `GhRunner`, `chooseCulprit`, `performRevert`
- Produces:
  - `mayConflict(a: PullRequest, b: PullRequest): boolean`
  - `pairsToVerify(wave: PullRequest[]): Array<[number, number]>`
  - `verifyProjected(root, order, deps): { ok: boolean; failedAt?: number }`

Two PRs that touch disjoint file sets cannot produce the semantic conflict this check
exists to catch, so only intersecting pairs are verified. That is what keeps the cost
sane; `--paranoid` verifies everything.

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/speculate.test.ts
import { describe, it, expect } from 'vitest';
import { mayConflict, pairsToVerify, verifyProjected } from './speculate.ts';
import type { PullRequest } from './types.ts';

function pr(number: number, files: string[]): PullRequest {
  return {
    number, title: `p${number}`, isDraft: false, baseRefName: 'main', headRefName: `h${number}`,
    mergeStateStatus: 'CLEAN', changedFiles: files.length, files,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/speculate.test.ts`
Expected: FAIL — cannot find module `./speculate.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/speculate.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Speculative verification: check each PR against the PROJECTED state of main,
 * not its current state. Two PRs green alone can be red together — one renames
 * a symbol, the other adds a caller. Git reports no conflict and CI was happy
 * on both, yet main breaks. Only intersecting pairs can produce that, so only
 * those are verified.
 */
import type { PullRequest } from './types.ts';

export type Runner = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

export function mayConflict(a: PullRequest, b: PullRequest): boolean {
  const set = new Set(a.files);
  return b.files.some((f) => set.has(f));
}

export function pairsToVerify(wave: PullRequest[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      if (mayConflict(wave[i], wave[j])) pairs.push([wave[i].number, wave[j].number]);
    }
  }
  return pairs;
}

/**
 * Builds each projected tree in turn (main, main+A, main+A+B, ...) and runs the
 * repo's own verification against it. Returns the first PR whose addition breaks it.
 */
export function verifyProjected(
  root: string,
  order: PullRequest[],
  deps: { run: Runner },
): { ok: boolean; failedAt?: number } {
  for (const pr of order) {
    const merged = deps.run(['merge', '--no-ff', '--no-commit', pr.headRefName]);
    if (!merged.ok) return { ok: false, failedAt: pr.number };

    const verified = deps.run(['verify', root]);
    if (!verified.ok) return { ok: false, failedAt: pr.number };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Wire the `pr:watch` subcommand the workflow calls**

Task 8's workflow invokes `pr:watch`, which nothing implements yet. Add to
`thesmos/bin/commands/pr.ts`:

```ts
import { chooseCulprit, performRevert } from '../../pr/revert.ts';
import { readEntries } from '../../pr/ledger.ts';

  if (sub === 'watch') {
    const { root } = createContext();
    const n = Number(argv[argv.indexOf('--range') + 1] ?? 5);
    const log = realGh(['api', `repos/{owner}/{repo}/commits?per_page=${n}`, '--jq', '.[].sha']);
    const range = log.stdout.split('\n').filter(Boolean);

    const culprit = chooseCulprit(readEntries(root), range);
    if (!culprit) { process.stdout.write('  Nothing of ours in the failing range.\n'); return; }

    const ok = performRevert(root, culprit, { gh: realGh, now: () => new Date() });
    process.stdout.write(ok
      ? `  ✓ reverted #${culprit.pr} — main went red after it merged\n`
      : `  ✗ could not revert #${culprit.pr}. Autonomy is now OFF and needs you.\n`);
    return;
  }
```

And register it in `thesmos/bin/cli.ts`:

```ts
  'pr:watch': (argv) => cmdPr(['watch', ...argv]),
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run thesmos/pr/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add thesmos/pr/speculate.ts thesmos/pr/speculate.test.ts thesmos/bin/commands/pr.ts thesmos/bin/cli.ts
git commit -m "feat(pr): speculative verification and pr:watch revert entrypoint"
```

---

### Task 10: Concurrency lock and obsolete detection

**Files:**
- Create: `thesmos/pr/lock.ts`
- Modify: `thesmos/pr/plan.ts` — emit `OBSOLETE`
- Test: `thesmos/pr/lock.test.ts`

**Interfaces:**
- Consumes: `PullRequest`, `HaltReason`
- Produces:
  - `acquireLock(root: string, now: Date, ttlMs?: number): boolean`
  - `releaseLock(root: string): void`
  - `detectObsolete(pr: PullRequest, pathsOnTarget: Set<string>): boolean`

Two Thesmos runs merging at once could double-merge a wave. Obsolete detection catches the
`#9`/`#6` case from the spec's problem statement: PRs editing files a merge had deleted.

- [ ] **Step 1: Write the failing test**

```ts
// thesmos/pr/lock.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, releaseLock, detectObsolete } from './lock.ts';
import type { PullRequest } from './types.ts';

let root: string;
const T0 = new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-lock-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

describe('lock', () => {
  it('refuses a second concurrent holder', () => {
    expect(acquireLock(root, T0)).toBe(true);
    expect(acquireLock(root, T0)).toBe(false);
  });

  it('reclaims a stale lock after its ttl', () => {
    acquireLock(root, T0);
    const later = new Date(T0.getTime() + 60 * 60 * 1000);
    expect(acquireLock(root, later, 30 * 60 * 1000)).toBe(true);
  });

  it('can be re-acquired after release', () => {
    acquireLock(root, T0);
    releaseLock(root);
    expect(acquireLock(root, T0)).toBe(true);
  });
});

describe('detectObsolete', () => {
  const pr: PullRequest = {
    number: 9, title: 'bump codeql-action', isDraft: false, baseRefName: 'main',
    headRefName: 'dep', mergeStateStatus: 'CLEAN', changedFiles: 1,
    files: ['.github/workflows/codeql.yml'],
  };

  it('flags a PR whose only file no longer exists on the target', () => {
    expect(detectObsolete(pr, new Set(['.github/workflows/ci.yml']))).toBe(true);
  });

  it('does not flag a PR whose files still exist', () => {
    expect(detectObsolete(pr, new Set(['.github/workflows/codeql.yml']))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run thesmos/pr/lock.test.ts`
Expected: FAIL — cannot find module `./lock.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
// thesmos/pr/lock.ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Single-holder lock so two Thesmos runs cannot double-merge a wave, plus
 * obsolete-PR detection: a PR editing only files that no longer exist on the
 * target can never be useful, and should be closed rather than merged.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PullRequest } from './types.ts';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function lockPath(root: string): string {
  return join(root, '.thesmos', 'pr-lock.json');
}

export function acquireLock(root: string, now: Date, ttlMs: number = DEFAULT_TTL_MS): boolean {
  const path = lockPath(root);

  if (existsSync(path)) {
    try {
      const held = JSON.parse(readFileSync(path, 'utf8')) as { at: string };
      if (now.getTime() - new Date(held.at).getTime() < ttlMs) return false;
    } catch {
      // A corrupt lock is treated as stale rather than wedging the tool forever.
    }
  }

  writeFileSync(path, JSON.stringify({ at: now.toISOString(), pid: process.pid }) + '\n', 'utf8');
  return true;
}

export function releaseLock(root: string): void {
  rmSync(lockPath(root), { force: true });
}

/** True when every file the PR touches is absent from the target branch. */
export function detectObsolete(pr: PullRequest, pathsOnTarget: Set<string>): boolean {
  if (pr.files.length === 0) return false;
  return pr.files.every((f) => !pathsOnTarget.has(f));
}
```

- [ ] **Step 4: Emit OBSOLETE from the planner**

In `thesmos/pr/plan.ts`, extend `PlanOptions` with `pathsOnTarget?: Set<string>` and add this
check inside the per-PR loop, immediately before the `DIRTY` check:

```ts
    if (opts.pathsOnTarget && detectObsolete(pr, opts.pathsOnTarget)) {
      halt(pr.number, 'OBSOLETE', 'every file it changes is already gone from main — close it');
      continue;
    }
```

Import `detectObsolete` from `./lock.ts` at the top of `plan.ts`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run thesmos/pr/`
Expected: PASS (all pr module tests)

- [ ] **Step 6: Commit**

```bash
git add thesmos/pr/lock.ts thesmos/pr/lock.test.ts thesmos/pr/plan.ts
git commit -m "feat(pr): concurrency lock and obsolete-PR detection"
```

---

## Deferred from the spec

Recorded so the gaps are deliberate rather than forgotten:

- **Ledger tamper-evidence (digest chaining).** Spec §12 case 12 asks for digest stability.
  Phase 1's ledger is append-only but not digest-chained, because the tamper-evident
  implementation already exists on PR #129 (`thesmos/records/`). Migrate once #129 lands
  rather than building a second one.
- **`DUPLICATE_INTENT` halt state** (spec §5.4). Needs path-set overlap scoring across all
  open PRs; deferred to Phase 2 alongside dependency policy.
- **`pr:fix` and `pr:tidy`** (spec §5.5). `pr:fix` depends on per-rule remediation that
  Phase 2 introduces. `pr:tidy` depends on `OBSOLETE`, delivered in Task 10, so it is a
  small follow-up.
- **Cross-platform paths** (spec §12 case 14) are covered by the existing CI matrix and the
  Windows guard job rather than by dedicated unit tests; every path here goes through
  `node:path`.

---

## Verification

After all tasks:

```bash
npm run typecheck            # all 3 workspaces, exit 0
npm test --workspace=thesmos # full suite, no failures, no retries
npm run build                # exit 0
npx tsx thesmos/bin/cli.ts pr:queue   # real plan against this repo's 24 PRs
git diff --check             # clean
```

**Acceptance:** `pr:queue` must correctly identify, without hand-holding, the two stacked chains (`#135→#136→#137` and `#140→…→#145`), report `#140` as blocking its five dependents, and refuse to plan any major-version bump.
