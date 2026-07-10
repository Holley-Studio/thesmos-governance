// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkingStateManager } from '../workingState.js';

describe('WorkingStateManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits a spinner label on begin and undefined when the last op disposes', () => {
    const labels: Array<string | undefined> = [];
    const mgr = new WorkingStateManager((l) => labels.push(l));
    const reg = mgr.begin('👁', 'Argus watches the gates');
    expect(labels[0]).toContain('$(sync~spin)');
    expect(labels[0]).toContain('👁');
    expect(labels[0]).toContain('Argus watches the gates');
    reg.dispose();
    expect(labels[labels.length - 1]).toBeUndefined();
    mgr.dispose();
  });

  it('ticks elapsed seconds while running', () => {
    const labels: Array<string | undefined> = [];
    const mgr = new WorkingStateManager((l) => labels.push(l));
    mgr.begin('👁', 'watching');
    vi.advanceTimersByTime(3100);
    expect(labels[labels.length - 1]).toMatch(/\(3s\)/);
    mgr.dispose();
  });

  it('most recent registration wins the display; falls back to prior on dispose', () => {
    const labels: Array<string | undefined> = [];
    const mgr = new WorkingStateManager((l) => labels.push(l));
    const a = mgr.begin('👁', 'scanning');
    const b = mgr.begin('🔨', 'forging');
    expect(labels[labels.length - 1]).toContain('🔨');
    b.dispose();
    expect(labels[labels.length - 1]).toContain('👁');
    a.dispose();
    expect(labels[labels.length - 1]).toBeUndefined();
    mgr.dispose();
  });

  it('double dispose is a no-op', () => {
    const labels: Array<string | undefined> = [];
    const mgr = new WorkingStateManager((l) => labels.push(l));
    const reg = mgr.begin('👁', 'watching');
    reg.dispose();
    reg.dispose();
    expect(labels.filter((l) => l === undefined)).toHaveLength(1);
    mgr.dispose();
  });
});
