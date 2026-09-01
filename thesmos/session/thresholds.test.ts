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

  it('respects an explicit disable while defaulting untouched sibling fields', () => {
    const cfg = {
      ...CONFIG_DEFAULTS,
      session: { start: { enabled: false } },
    } as ThesmosConfig;
    const o = resolveSessionOptions(cfg);
    expect(o.enabled).toBe(false);
    expect(o.backgroundFetch).toBe(true);
    expect(o.maxBytes).toBe(1200);
  });
});
