// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import {
  SubscriptionUsageProvider,
  SUBSCRIPTION_USAGE_SCHEMA_VERSION,
  normalizePercent,
  normalizeResetsAt,
  normalizeWindowId,
  normalizeStatus,
} from '../usage/subscriptionUsage.js';
import {
  formatWindowShort,
  formatStatusBarUsage,
  describeWindow,
  windowSeverity,
  snapshotSeverity,
  reasonLabel,
} from '../usage/usageDisplay.js';

// A fixed clock so relative-time and staleness assertions are deterministic.
const NOW = new Date('2026-07-29T12:00:00.000Z');
const RESET_5H = new Date('2026-07-29T14:00:00.000Z'); // +2h
const RESET_7D = new Date('2026-08-02T12:00:00.000Z'); // +4d

function statusLine(windows: Record<string, unknown>) {
  return { rate_limits: windows };
}

describe('normalizers', () => {
  it('bounds percentages to [0,100] and rejects the rest', () => {
    expect(normalizePercent(0)).toBe(0);
    expect(normalizePercent(100)).toBe(100);
    expect(normalizePercent(41)).toBe(41);
    expect(normalizePercent(-1)).toBeNull();
    expect(normalizePercent(101)).toBeNull();
    expect(normalizePercent(Number.NaN)).toBeNull();
    expect(normalizePercent('41')).toBeNull();
  });

  it('accepts epoch seconds, epoch ms and ISO for reset times, else null', () => {
    const now = NOW.getTime();
    expect(normalizeResetsAt(Math.floor(RESET_5H.getTime() / 1000), now)).toBe(RESET_5H.toISOString());
    expect(normalizeResetsAt(RESET_5H.getTime(), now)).toBe(RESET_5H.toISOString());
    expect(normalizeResetsAt(RESET_5H.toISOString(), now)).toBe(RESET_5H.toISOString());
    expect(normalizeResetsAt('not a date', now)).toBeNull();
    expect(normalizeResetsAt(0, now)).toBeNull();
    expect(normalizeResetsAt(-5, now)).toBeNull();
    // Implausibly far in the future is rejected.
    expect(normalizeResetsAt(now + 400 * 24 * 3600_000, now)).toBeNull();
  });

  it('maps window ids and statuses to closed sets', () => {
    expect(normalizeWindowId('five_hour')).toBe('five_hour');
    expect(normalizeWindowId('seven_day')).toBe('seven_day');
    expect(normalizeWindowId('one_hour')).toBeNull();
    expect(normalizeStatus('allowed')).toBe('allowed');
    expect(normalizeStatus('rejected')).toBe('rejected');
    expect(normalizeStatus('warning')).toBe('warning');
    expect(normalizeStatus('mystery')).toBeNull();
  });
});

describe('SubscriptionUsageProvider — status-line contract', () => {
  it('reports a valid five-hour and seven-day payload', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStatusLine(
      statusLine({
        five_hour: { used_percentage: 24, resets_at: RESET_5H.toISOString() },
        seven_day: { used_percentage: 41, resets_at: RESET_7D.toISOString() },
      }),
      NOW,
    );
    const snap = p.snapshot(NOW);
    expect(snap.schemaVersion).toBe(SUBSCRIPTION_USAGE_SCHEMA_VERSION);
    expect(snap.provider).toBe('claude');
    expect(snap.windows.five_hour.available).toBe(true);
    expect(snap.windows.five_hour.usedPercent).toBe(24);
    expect(snap.windows.seven_day.usedPercent).toBe(41);
    expect(snap.windows.five_hour.resetsAt).toBe(RESET_5H.toISOString());
    expect(snap.updatedAt).toBe(NOW.toISOString());
  });

  it('treats a missing window independently', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStatusLine(statusLine({ five_hour: { used_percentage: 24, resets_at: RESET_5H.toISOString() } }), NOW);
    const snap = p.snapshot(NOW);
    expect(snap.windows.five_hour.available).toBe(true);
    expect(snap.windows.seven_day.available).toBe(false);
    expect(snap.windows.seven_day.reason).toBe('window-not-reported');
  });

  it('rejects out-of-range percentages without showing a bogus number', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStatusLine(statusLine({ five_hour: { used_percentage: 150 } }), NOW);
    const snap = p.snapshot(NOW);
    expect(snap.windows.five_hour.usedPercent).toBeNull();
    expect(snap.windows.five_hour.reason).toBe('malformed');
  });

  it('marks a window malformed when its reset timestamp is invalid', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStatusLine(statusLine({ five_hour: { resets_at: 'yesterday' } }), NOW);
    expect(p.snapshot(NOW).windows.five_hour.reason).toBe('malformed');
  });

  it('marks the CLI unsupported when a status-line payload omits rate_limits', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStatusLine({ model: { id: 'claude-opus' } }, NOW);
    expect(p.snapshot(NOW).windows.five_hour.reason).toBe('unsupported-cli');
  });
});

describe('SubscriptionUsageProvider — headless rate_limit_event contract', () => {
  const event = {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: Math.floor(RESET_5H.getTime() / 1000),
      rateLimitType: 'five_hour',
      overageStatus: 'rejected',
      overageDisabledReason: 'out_of_credits',
      isUsingOverage: false,
    },
    uuid: 'ff24fb8a-9ec6-4242-99b7-44aaa134e8d6',
    session_id: 'df34d96f-bf3d-4abb-aed2-6a27e50eaed2',
  };

  it('captures status, reset and overage but NOT a fabricated percentage', () => {
    const p = new SubscriptionUsageProvider();
    expect(p.ingestStreamEvent(event, NOW)).toBe(true);
    const w = p.snapshot(NOW).windows.five_hour;
    expect(w.available).toBe(true);
    expect(w.status).toBe('allowed');
    expect(w.resetsAt).toBe(RESET_5H.toISOString());
    expect(w.usingOverage).toBe(false);
    expect(w.usedPercent).toBeNull();
    expect(w.reason).toBe('percentage-not-reported');
    expect(w.source).toBe('stream-rate-limit-event');
  });

  it('never leaks raw ids or account/billing strings into the snapshot', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStreamEvent(event, NOW);
    const serialized = JSON.stringify(p.snapshot(NOW));
    expect(serialized).not.toContain('ff24fb8a');
    expect(serialized).not.toContain('df34d96f');
    expect(serialized).not.toContain('out_of_credits');
    expect(serialized).not.toContain('rateLimitType');
    expect(serialized).not.toContain('overageStatus');
  });

  it('tolerates malformed JSON and non-events without corrupting state', () => {
    const p = new SubscriptionUsageProvider();
    expect(p.ingestStreamLine('{not json')).toBe(false);
    expect(p.ingestStreamEvent(undefined)).toBe(false);
    expect(p.ingestStreamEvent({ type: 'assistant' })).toBe(false);
    expect(p.ingestStreamEvent({ type: 'rate_limit_event' })).toBe(false);
    expect(p.snapshot(NOW).windows.five_hour.reason).toBe('no-first-response');
  });

  it('survives a provider process restart — accumulated state persists', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStreamEvent(event, NOW);
    // Simulate a child restart: the provider object is not reset; a new event arrives.
    const later = new Date(NOW.getTime() + 60_000);
    p.ingestStreamEvent({ ...event, rate_limit_info: { ...event.rate_limit_info, status: 'rejected' } }, later);
    expect(p.snapshot(later).windows.five_hour.status).toBe('rejected');
  });
});

describe('SubscriptionUsageProvider — unavailable states', () => {
  it('reports no-first-response before anything is ingested', () => {
    const snap = new SubscriptionUsageProvider().snapshot(NOW);
    expect(snap.windows.five_hour.available).toBe(false);
    expect(snap.windows.five_hour.reason).toBe('no-first-response');
    expect(snap.updatedAt).toBeNull();
  });

  it('reports unsupported-provider for a non-Claude provider', () => {
    const p = new SubscriptionUsageProvider({ provider: 'openai' });
    p.ingestStreamEvent(
      { type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', status: 'allowed' } },
      NOW,
    );
    expect(p.snapshot(NOW).windows.five_hour.reason).toBe('unsupported-provider');
  });

  it('reports headless-statusline-unavailable once marked and no event arrived', () => {
    const p = new SubscriptionUsageProvider();
    p.markHeadlessStatusLineUnavailable();
    expect(p.snapshot(NOW).windows.five_hour.reason).toBe('headless-statusline-unavailable');
  });

  it('reports stale telemetry once past the stale horizon', () => {
    const p = new SubscriptionUsageProvider({ staleAfterMs: 1000 });
    p.ingestStatusLine(statusLine({ five_hour: { used_percentage: 24, resets_at: RESET_5H.toISOString() } }), NOW);
    const later = new Date(NOW.getTime() + 5000);
    const w = p.snapshot(later).windows.five_hour;
    expect(w.available).toBe(false);
    expect(w.reason).toBe('stale');
  });

  it('clears everything on reset()', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStatusLine(statusLine({ five_hour: { used_percentage: 24 } }), NOW);
    p.reset();
    expect(p.snapshot(NOW).windows.five_hour.reason).toBe('no-first-response');
  });
});

describe('usage display', () => {
  function fiveHour(percent: number | null, opts: Partial<Record<string, unknown>> = {}) {
    const p = new SubscriptionUsageProvider();
    if (percent !== null) {
      p.ingestStatusLine(statusLine({ five_hour: { used_percentage: percent, resets_at: RESET_5H.toISOString() } }), NOW);
    }
    return p.snapshot(NOW).windows.five_hour;
  }

  it('formats a percentage window compactly', () => {
    expect(formatWindowShort(fiveHour(24), NOW)).toBe('5h 24%');
  });

  it('formats a reset-only (headless) window without inventing a percentage', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStreamEvent(
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: RESET_5H.toISOString(), rateLimitType: 'five_hour' } },
      NOW,
    );
    const w = p.snapshot(NOW).windows.five_hour;
    expect(formatWindowShort(w, NOW)).toBe('5h resets 2h');
    expect(describeWindow(w, NOW)).toContain('percentage not reported');
  });

  it('renders an em-dash and an honest reason for an unavailable window', () => {
    const w = fiveHour(null);
    expect(formatWindowShort(w, NOW)).toBe('5h —');
    expect(describeWindow(w, NOW)).toContain('No response yet');
  });

  it('drives severity only from a real percentage', () => {
    expect(windowSeverity(fiveHour(50))).toBe('ok');
    expect(windowSeverity(fiveHour(80))).toBe('warning');
    expect(windowSeverity(fiveHour(95))).toBe('critical');
    // A reset-only window is never a warning/error — we have no percentage.
    const p = new SubscriptionUsageProvider();
    p.ingestStreamEvent(
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: RESET_5H.toISOString(), rateLimitType: 'five_hour' } },
      NOW,
    );
    expect(windowSeverity(p.snapshot(NOW).windows.five_hour)).toBe('ok');
  });

  it('respects custom thresholds', () => {
    expect(windowSeverity(fiveHour(60), { warning: 50, critical: 70 })).toBe('warning');
    expect(windowSeverity(fiveHour(72), { warning: 50, critical: 70 })).toBe('critical');
  });

  it('omits the status-bar segment entirely when nothing is available', () => {
    const snap = new SubscriptionUsageProvider().snapshot(NOW);
    expect(formatStatusBarUsage(snap, NOW)).toBeNull();
  });

  it('joins available windows in the status bar', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStatusLine(
      statusLine({
        five_hour: { used_percentage: 24, resets_at: RESET_5H.toISOString() },
        seven_day: { used_percentage: 41, resets_at: RESET_7D.toISOString() },
      }),
      NOW,
    );
    expect(formatStatusBarUsage(p.snapshot(NOW), NOW)).toBe('5h 24% · 7d 41%');
  });

  it('has an honest label for every unavailable reason', () => {
    for (const r of [
      'no-first-response',
      'window-not-reported',
      'percentage-not-reported',
      'unsupported-provider',
      'unsupported-cli',
      'headless-statusline-unavailable',
      'malformed',
      'stale',
    ] as const) {
      expect(reasonLabel(r).length).toBeGreaterThan(0);
    }
  });

  it('reports the worst severity across a snapshot', () => {
    const p = new SubscriptionUsageProvider();
    p.ingestStatusLine(
      statusLine({
        five_hour: { used_percentage: 30, resets_at: RESET_5H.toISOString() },
        seven_day: { used_percentage: 92, resets_at: RESET_7D.toISOString() },
      }),
      NOW,
    );
    expect(snapshotSeverity(p.snapshot(NOW))).toBe('critical');
  });
});
