// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pure presentation helpers for subscription usage. No VS Code imports so the
 * whole layer is unit-testable. Every string here is honest: an unavailable
 * window says *why* it is unavailable, and a percentage is only shown when a
 * provider actually reported one.
 */

import type {
  SubscriptionUsageSnapshot,
  UsageUnavailableReason,
  UsageWindow,
  UsageWindowId,
} from './subscriptionUsage.js';

export const WINDOW_LABEL: Record<UsageWindowId, string> = {
  five_hour: '5h',
  seven_day: '7d',
};

export const WINDOW_LONG_LABEL: Record<UsageWindowId, string> = {
  five_hour: '5-hour plan',
  seven_day: '7-day plan',
};

/** A short, honest human string for each unavailable reason. */
export function reasonLabel(reason: UsageUnavailableReason): string {
  switch (reason) {
    case 'no-first-response':
      return 'No response yet';
    case 'window-not-reported':
      return 'Not reported';
    case 'percentage-not-reported':
      return 'Percentage not reported by CLI';
    case 'unsupported-provider':
      return 'Unsupported provider';
    case 'unsupported-cli':
      return 'Unsupported CLI version';
    case 'headless-statusline-unavailable':
      return 'Headless status line unavailable';
    case 'malformed':
      return 'Unavailable (invalid data)';
    case 'stale':
      return 'Unavailable (stale)';
  }
}

export type UsageSeverity = 'ok' | 'warning' | 'critical';

export interface UsageThresholds {
  /** Percent at/above which a window is a warning. Default 75. */
  warning: number;
  /** Percent at/above which a window is critical. Default 90. */
  critical: number;
}

export const DEFAULT_THRESHOLDS: UsageThresholds = { warning: 75, critical: 90 };

/**
 * Classify a window's severity. Severity is only ever driven by a real,
 * provider-reported percentage — a window with no percentage is never a
 * warning or error, because we have no basis to claim one.
 */
export function windowSeverity(window: UsageWindow, thresholds: UsageThresholds = DEFAULT_THRESHOLDS): UsageSeverity {
  if (!window.available || window.usedPercent === null) return 'ok';
  if (window.usedPercent >= thresholds.critical) return 'critical';
  if (window.usedPercent >= thresholds.warning) return 'warning';
  return 'ok';
}

/** The most severe window severity across a snapshot. */
export function snapshotSeverity(
  snapshot: SubscriptionUsageSnapshot,
  thresholds: UsageThresholds = DEFAULT_THRESHOLDS,
): UsageSeverity {
  const order: UsageSeverity[] = ['ok', 'warning', 'critical'];
  let worst: UsageSeverity = 'ok';
  for (const id of Object.keys(snapshot.windows) as UsageWindowId[]) {
    const sev = windowSeverity(snapshot.windows[id], thresholds);
    if (order.indexOf(sev) > order.indexOf(worst)) worst = sev;
  }
  return worst;
}

/**
 * Compact single-window string for a status bar or secondary row.
 * Examples: "5h 24%", "5h ok · resets 2h", "5h —" (unavailable).
 * `now` lets callers render a relative reset ("resets 2h") deterministically.
 */
export function formatWindowShort(window: UsageWindow, now: Date = new Date()): string {
  const label = WINDOW_LABEL[window.windowId];
  if (window.available && window.usedPercent !== null) {
    return `${label} ${Math.round(window.usedPercent)}%`;
  }
  if (window.available && window.resetsAt) {
    const rel = relativeReset(window.resetsAt, now);
    const status = window.status && window.status !== 'allowed' ? `${window.status} · ` : '';
    return rel ? `${label} ${status}resets ${rel}` : `${label} ${status || 'ok'}`.trim();
  }
  return `${label} —`;
}

/** A full accessible description of a window for tooltips / screen readers. */
export function describeWindow(window: UsageWindow, now: Date = new Date()): string {
  const long = WINDOW_LONG_LABEL[window.windowId];
  if (window.available && window.usedPercent !== null) {
    const reset = window.resetsAt ? `, resets ${relativeReset(window.resetsAt, now) ?? window.resetsAt}` : '';
    return `${long}: ${Math.round(window.usedPercent)}% used${reset}`;
  }
  if (window.available && window.resetsAt) {
    const rel = relativeReset(window.resetsAt, now) ?? window.resetsAt;
    const status = window.status ? `${window.status}, ` : '';
    return `${long}: ${status}resets ${rel} (percentage not reported by this CLI)`;
  }
  return `${long}: ${reasonLabel(window.reason ?? 'no-first-response')}`;
}

/**
 * A compact, adaptive status-bar summary. Returns null when there is nothing
 * honest to show (so the caller can omit the segment entirely rather than
 * render a misleading placeholder).
 */
export function formatStatusBarUsage(snapshot: SubscriptionUsageSnapshot, now: Date = new Date()): string | null {
  const parts: string[] = [];
  for (const id of Object.keys(snapshot.windows) as UsageWindowId[]) {
    const w = snapshot.windows[id];
    if (w.available && (w.usedPercent !== null || w.resetsAt)) {
      parts.push(formatWindowShort(w, now));
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Human relative time until a reset ISO string, or null if already passed / invalid. */
export function relativeReset(resetsAtIso: string, now: Date = new Date()): string | null {
  const ms = Date.parse(resetsAtIso) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
