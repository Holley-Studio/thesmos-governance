// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import {
  armedMergesFromGitHub, markPr, MERGED_LABEL, REVERTED_LABEL,
} from './marks.ts';
import { chooseCulprit } from './revert.ts';
import type { GhRunner } from './execute.ts';

const ok = { ok: true, stdout: '', stderr: '' };

/** The JSON shape `gh pr list --json number,labels,mergedAt,mergeCommit` really prints. */
const listJson = (rows: Array<{
  number: number; mergedAt: string; oid?: string | null; labels?: string[];
}>): string => JSON.stringify(rows.map((r) => ({
  number: r.number,
  labels: (r.labels ?? [MERGED_LABEL]).map((name) => ({ name })),
  mergeCommit: r.oid === null ? null : { oid: r.oid ?? `sha-${r.number}` },
  mergedAt: r.mergedAt,
})));

describe('markPr — the mark that makes a Thesmos merge visible to the unattended half', () => {
  it('adds the label to the pull request', () => {
    const calls: string[][] = [];
    const gh: GhRunner = (args) => { calls.push(args); return ok; };

    expect(markPr(gh, 42, MERGED_LABEL)).toEqual({ ok: true });
    expect(calls).toEqual([['pr', 'edit', '42', '--add-label', MERGED_LABEL]]);
  });

  it('does not spend a label-create call when the label already exists', () => {
    // One extra API round-trip before every merge in a wave is waste; the add
    // succeeding is itself proof the label exists.
    const calls: string[][] = [];
    const gh: GhRunner = (args) => { calls.push(args); return ok; };

    markPr(gh, 42, MERGED_LABEL);
    expect(calls.some((c) => c[0] === 'label')).toBe(false);
  });

  it('creates the label and retries once when the repository has never had it', () => {
    // First run on any repository: the label does not exist yet, so the add
    // fails. Without the create-and-retry, Thesmos could never mark its very
    // first merge — and an unmarked merge is invisible to auto-revert.
    const calls: string[][] = [];
    let created = false;
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[0] === 'label') { created = true; return ok; }
      return created ? ok : { ok: false, stdout: '', stderr: `could not add label: '${MERGED_LABEL}' not found` };
    };

    expect(markPr(gh, 42, MERGED_LABEL)).toEqual({ ok: true });
    expect(calls.map((c) => c.slice(0, 2))).toEqual([
      ['pr', 'edit'], ['label', 'create'], ['pr', 'edit'],
    ]);
  });

  it('tolerates a label that another run created a moment earlier', () => {
    // Two waves racing, or a partially-created label: `gh label create` fails
    // with "already exists". That must not turn into a reported failure when
    // the retry then succeeds.
    let adds = 0;
    const gh: GhRunner = (args) => {
      if (args[0] === 'label') return { ok: false, stdout: '', stderr: 'label already exists; use `--force` to update its color and description' };
      adds += 1;
      return adds === 1 ? { ok: false, stdout: '', stderr: 'not found' } : ok;
    };

    expect(markPr(gh, 42, MERGED_LABEL)).toEqual({ ok: true });
  });

  it('reports a truthful failure, never a silent one, when the label cannot be applied at all', () => {
    const gh: GhRunner = () => ({ ok: false, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' });

    const result = markPr(gh, 42, MERGED_LABEL);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/403/);
  });

  it('names the failed label creation too when that is the real cause', () => {
    const gh: GhRunner = (args) => args[0] === 'label'
      ? { ok: false, stdout: '', stderr: 'HTTP 403: labels write access needed' }
      : { ok: false, stdout: '', stderr: 'not found' };

    const result = markPr(gh, 42, MERGED_LABEL);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/labels write access needed/);
  });

  it('reports a failure rather than throwing when gh throws', () => {
    // GhRunner's type promises a total function; a real subprocess wrapper can
    // still throw. A throw here would abort the merge loop after the merge has
    // already happened.
    const gh: GhRunner = () => { throw new Error('gh: command not found'); };

    const result = markPr(gh, 42, MERGED_LABEL);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('gh: command not found');
  });
});

describe('armedMergesFromGitHub — the Action rebuilds its own view from GitHub', () => {
  it('asks only for merged pull requests carrying the Thesmos mark, newest activity first', () => {
    const calls: string[][] = [];
    const gh: GhRunner = (args) => { calls.push(args); return { ok: true, stdout: '[]', stderr: '' }; };

    armedMergesFromGitHub(gh);

    const [args] = calls;
    expect(args.slice(0, 2)).toEqual(['pr', 'list']);
    expect(args).toContain('--state');
    expect(args[args.indexOf('--state') + 1]).toBe('merged');
    expect(args[args.indexOf('--label') + 1]).toBe(MERGED_LABEL);
    // Default gh ordering is by creation date, so a long-open pull request
    // merged today can sit far down the list. Sorting by recent activity is
    // what keeps the merge that just landed on the first page.
    expect(args[args.indexOf('--search') + 1]).toMatch(/sort:updated-desc/);
  });

  it('returns each marked merge as a ledger-shaped row carrying the merge commit SHA', () => {
    const gh: GhRunner = () => ({
      ok: true,
      stdout: listJson([{ number: 7, mergedAt: '2026-08-16T10:00:00Z', oid: 'aaa' }]),
      stderr: '',
    });

    const result = armedMergesFromGitHub(gh);
    expect(result.ok).toBe(true);
    expect(result.entries).toEqual([{
      ts: '2026-08-16T10:00:00Z', action: 'merge', pr: 7, phase: 'outcome', ok: true, mergeCommit: 'aaa',
    }]);
  });

  it('drops a merge that has already been reverted, so it is never chosen twice', () => {
    // This is what the ledger's armedMerges bookkeeping did for the local CLI.
    // On the Action side the label is the only record that survives.
    const gh: GhRunner = () => ({
      ok: true,
      stdout: listJson([
        { number: 7, mergedAt: '2026-08-16T10:00:00Z', oid: 'aaa', labels: [MERGED_LABEL, REVERTED_LABEL] },
        { number: 8, mergedAt: '2026-08-16T11:00:00Z', oid: 'bbb' },
      ]),
      stderr: '',
    });

    expect(armedMergesFromGitHub(gh).entries.map((e) => e.pr)).toEqual([8]);
  });

  it('orders oldest first, so chooseCulprit still picks the newest merge in range', () => {
    // chooseCulprit takes the LAST match, which is only "newest" if the list
    // is chronological. gh hands them back newest-first, so feeding its order
    // through unchanged would revert the wrong pull request — a silent
    // inversion no assertion on the entry contents alone would catch.
    const gh: GhRunner = () => ({
      ok: true,
      stdout: listJson([
        { number: 9, mergedAt: '2026-08-16T12:00:00Z', oid: 'ccc' },
        { number: 8, mergedAt: '2026-08-16T11:00:00Z', oid: 'bbb' },
        { number: 7, mergedAt: '2026-08-16T10:00:00Z', oid: 'aaa' },
      ]),
      stderr: '',
    });

    const { entries } = armedMergesFromGitHub(gh);
    expect(entries.map((e) => e.pr)).toEqual([7, 8, 9]);
    expect(chooseCulprit(entries, ['ccc', 'bbb', 'aaa'])!.pr).toBe(9);
  });

  it('skips a merge GitHub reports with no merge commit rather than inventing one', () => {
    const gh: GhRunner = () => ({
      ok: true,
      stdout: listJson([
        { number: 7, mergedAt: '2026-08-16T10:00:00Z', oid: null },
        { number: 8, mergedAt: '2026-08-16T11:00:00Z', oid: 'bbb' },
      ]),
      stderr: '',
    });

    expect(armedMergesFromGitHub(gh).entries.map((e) => e.pr)).toEqual([8]);
  });

  it('reports the lookup as failed — never as an empty list — when gh cannot answer', () => {
    // The whole point. An empty list means "main is red but none of it is
    // ours, stand down"; a failed lookup means "I do not know". Rendering the
    // second as the first is how a safety net becomes decoration.
    const gh: GhRunner = () => ({ ok: false, stdout: '', stderr: 'HTTP 403' });

    const result = armedMergesFromGitHub(gh);
    expect(result.ok).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.detail).toMatch(/403/);
  });

  it('reports a failure when gh answers with something that is not a list', () => {
    const gh: GhRunner = () => ({ ok: true, stdout: 'not json at all', stderr: '' });
    expect(armedMergesFromGitHub(gh).ok).toBe(false);
  });

  it('reports a failure rather than throwing when gh throws', () => {
    const gh: GhRunner = () => { throw new Error('gh: command not found'); };
    const result = armedMergesFromGitHub(gh);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('gh: command not found');
  });

  it('reports success with no entries when GitHub genuinely has no marked merges', () => {
    const gh: GhRunner = () => ({ ok: true, stdout: '[]', stderr: '' });
    expect(armedMergesFromGitHub(gh)).toEqual({ ok: true, entries: [] });
  });
});
