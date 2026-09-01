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
