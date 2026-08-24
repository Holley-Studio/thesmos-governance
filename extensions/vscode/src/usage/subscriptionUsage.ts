// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * SubscriptionUsageProvider — a versioned, transport-agnostic abstraction over a
 * coding provider's *subscription plan* usage (Claude's five-hour and seven-day
 * rate-limit windows).
 *
 * This is deliberately kept separate from every other meter the extension shows:
 *   - API token counts            (per-turn input/output tokens)
 *   - context-window utilization  (how full the model's context is)
 *   - estimated API cost          (dollars, from total_cost_usd)
 *   - Thesmos mission budgets      (governed step/agent/spend caps)
 * Those are four different concepts and must never be collapsed into one number.
 *
 * TWO provider contracts feed this one abstraction:
 *
 *  1. `rate_limit_event` — emitted by headless `claude -p --output-format
 *     stream-json`. Carries the window's *status*, *reset time* (unix seconds)
 *     and *overage* flag. It does NOT carry a used-percentage. This is what the
 *     current Pantheon Chat process actually observes, so it is collected for
 *     free from the existing stream — no extra request, no settings file.
 *
 *  2. `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` — the
 *     documented status-line contract (https://code.claude.com/docs). A focused
 *     spike confirmed the status line does NOT fire under headless `-p`, so
 *     `usedPercent` is normally unavailable today. The parser is retained so
 *     that if the status line ever delivers (interactive / future CLI) the same
 *     abstraction reports a real, provider-supplied percentage.
 *
 * Truthfulness rules baked in here:
 *   - `usedPercent` is `null` unless a provider actually reported it. We never
 *     estimate it from token counts or cost.
 *   - Absent windows are independent: one may be present while the other is not.
 *   - Timestamps and bounds are validated; malformed or stale data becomes an
 *     explicit unavailable state, never a silent guess.
 *   - Only normalized display fields are retained. Raw payloads, uuids,
 *     session ids and account/billing detail strings are dropped.
 */

export const SUBSCRIPTION_USAGE_SCHEMA_VERSION = 1 as const;

export type UsageProviderId = 'claude';
export type UsageWindowId = 'five_hour' | 'seven_day';
export const USAGE_WINDOW_IDS: readonly UsageWindowId[] = ['five_hour', 'seven_day'];

/** Where a window's data came from. */
export type UsageSource = 'stream-rate-limit-event' | 'status-line';

/** Provider-reported limit status, normalized to a small closed set. */
export type UsageStatus = 'allowed' | 'warning' | 'rejected';

/**
 * Why a window has nothing trustworthy to show. Each value maps to a specific,
 * honest UI string — we never render a blank or a fabricated number.
 */
export type UsageUnavailableReason =
  | 'no-first-response' // provider has emitted nothing yet
  | 'window-not-reported' // provider reported the sibling window but not this one
  | 'percentage-not-reported' // we have status/reset but the transport gives no %
  | 'unsupported-provider' // configured provider is not Claude
  | 'unsupported-cli' // provider spoke but this CLI version omits rate limits
  | 'headless-statusline-unavailable' // status line cannot deliver under `claude -p`
  | 'malformed' // a value was present but failed validation
  | 'stale'; // last authoritative datum is older than the stale horizon

export interface UsageWindow {
  windowId: UsageWindowId;
  /** True when we hold at least one authoritative, non-stale datum for this window. */
  available: boolean;
  /** Provider-reported percent used (0–100), or null when not reported. */
  usedPercent: number | null;
  /** ISO-8601 UTC reset time, or null. */
  resetsAt: string | null;
  /** Provider-reported limit status, or null. */
  status: UsageStatus | null;
  /** Whether overage billing is currently active, or null. */
  usingOverage: boolean | null;
  /** Transport that supplied the data, or null. */
  source: UsageSource | null;
  /** ISO time we last received authoritative data for this window, or null. */
  updatedAt: string | null;
  /** Why there is nothing (fully) trustworthy to show; null when fully available. */
  reason: UsageUnavailableReason | null;
}

export interface SubscriptionUsageSnapshot {
  schemaVersion: typeof SUBSCRIPTION_USAGE_SCHEMA_VERSION;
  provider: UsageProviderId;
  windows: Record<UsageWindowId, UsageWindow>;
  /** Most recent authoritative update across all windows, or null. */
  updatedAt: string | null;
}

export interface SubscriptionUsageOptions {
  /** The provider whose subscription this represents. Defaults to 'claude'. */
  provider?: string;
  /** ms after which a window's data is considered stale. Default 6h. */
  staleAfterMs?: number;
  /** Reset times beyond now + this many ms are rejected as implausible. Default 60d. */
  maxResetHorizonMs?: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DEFAULT_STALE_AFTER_MS = 6 * HOUR;
const DEFAULT_MAX_RESET_HORIZON_MS = 60 * DAY;

/** Internal per-window record — the normalized values we actually retain. */
interface WindowState {
  usedPercent: number | null;
  resetsAt: string | null;
  status: UsageStatus | null;
  usingOverage: boolean | null;
  source: UsageSource | null;
  updatedAtMs: number | null;
}

function emptyWindowState(): WindowState {
  return { usedPercent: null, resetsAt: null, status: null, usingOverage: null, source: null, updatedAtMs: null };
}

/** Normalize a provider window key to our closed set, or null if unknown. */
export function normalizeWindowId(value: unknown): UsageWindowId | null {
  if (value === 'five_hour' || value === 'seven_day') return value;
  return null;
}

/**
 * Normalize a percentage to a finite number in [0, 100]. Out-of-range or
 * non-finite input returns null — the caller treats that as malformed, never
 * as a clamped guess.
 */
export function normalizePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
}

/**
 * Normalize a reset time to an ISO-8601 UTC string.
 * Accepts a unix epoch in seconds or milliseconds, or an ISO string. Rejects
 * non-finite, non-positive, or implausibly-distant values (returns null).
 */
export function normalizeResetsAt(value: unknown, now: number, maxHorizonMs = DEFAULT_MAX_RESET_HORIZON_MS): string | null {
  let ms: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: values below 1e12 are seconds (year ~33658 in ms), above are ms.
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  // A reset time absurdly far in the future (or long in the past) is not trustworthy.
  if (ms > now + maxHorizonMs) return null;
  if (ms < now - maxHorizonMs) return null;
  return new Date(ms).toISOString();
}

/** Normalize a provider status string to our closed set, or null. */
export function normalizeStatus(value: unknown): UsageStatus | null {
  if (value === 'allowed' || value === 'allowed_warning') return value === 'allowed' ? 'allowed' : 'warning';
  if (value === 'warning') return 'warning';
  if (value === 'rejected' || value === 'blocked') return 'rejected';
  return null;
}

/**
 * A versioned, in-memory subscription-usage accumulator. One instance lives in
 * the extension host and survives child-process restarts, so a respawned
 * Pantheon session simply resumes feeding the same provider.
 */
export class SubscriptionUsageProvider {
  readonly provider: UsageProviderId | string;
  private readonly isClaude: boolean;
  private readonly staleAfterMs: number;
  private readonly maxResetHorizonMs: number;
  private readonly windows: Record<UsageWindowId, WindowState> = {
    five_hour: emptyWindowState(),
    seven_day: emptyWindowState(),
  };
  private ingestedAny = false;
  private headlessStatusLineUnavailable = false;
  private unsupportedCli = false;

  constructor(opts: SubscriptionUsageOptions = {}) {
    this.provider = opts.provider ?? 'claude';
    this.isClaude = this.provider === 'claude';
    this.staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.maxResetHorizonMs = opts.maxResetHorizonMs ?? DEFAULT_MAX_RESET_HORIZON_MS;
  }

  /**
   * Ingest one parsed stream-json event from the live Pantheon process. Only
   * `rate_limit_event` shapes update state; everything else is ignored.
   * Returns true if state changed.
   */
  ingestStreamEvent(raw: unknown, now: Date = new Date()): boolean {
    if (!this.isClaude) return false;
    if (!isRecord(raw) || raw.type !== 'rate_limit_event') return false;
    const info = raw.rate_limit_info;
    if (!isRecord(info)) return false;
    const windowId = normalizeWindowId(info.rateLimitType);
    if (!windowId) return false;

    const nowMs = now.getTime();
    const resetsAt = 'resetsAt' in info ? normalizeResetsAt(info.resetsAt, nowMs, this.maxResetHorizonMs) : null;
    const status = normalizeStatus(info.status);
    const usingOverage = typeof info.isUsingOverage === 'boolean' ? info.isUsingOverage : null;

    // A rate_limit_event with a window key but no usable field is not authoritative.
    if (resetsAt === null && status === null && usingOverage === null) return false;

    const w = this.windows[windowId];
    if (resetsAt !== null) w.resetsAt = resetsAt;
    if (status !== null) w.status = status;
    if (usingOverage !== null) w.usingOverage = usingOverage;
    // This transport never carries a percentage — leave usedPercent as-is (null).
    w.source = 'stream-rate-limit-event';
    w.updatedAtMs = nowMs;
    this.ingestedAny = true;
    return true;
  }

  /**
   * Ingest a documented status-line payload: `{ rate_limits: { five_hour: {
   * used_percentage, resets_at }, seven_day: {...} } }`. Returns true if any
   * window updated. A payload lacking `rate_limits` marks the CLI as one that
   * does not report subscription usage (unsupported-cli).
   */
  ingestStatusLine(raw: unknown, now: Date = new Date()): boolean {
    if (!this.isClaude) return false;
    if (!isRecord(raw)) return false;
    const limits = raw.rate_limits;
    if (!isRecord(limits)) {
      // A valid status-line payload that carries no rate limits ⇒ this CLI does
      // not surface subscription usage.
      this.unsupportedCli = true;
      return false;
    }

    const nowMs = now.getTime();
    let changed = false;
    for (const windowId of USAGE_WINDOW_IDS) {
      const win = limits[windowId];
      if (!isRecord(win)) continue; // window simply not reported — stays independent
      const percent = normalizePercent(win.used_percentage);
      const resetsAt = normalizeResetsAt(win.resets_at, nowMs, this.maxResetHorizonMs);
      // If the window was reported but both fields are invalid, that is malformed.
      const hadPercentField = 'used_percentage' in win;
      const hadResetField = 'resets_at' in win;
      if (hadPercentField && percent === null && hadResetField && resetsAt === null) {
        // Mark malformed by recording a timestamp with no values so snapshot() reports it.
        const w = this.windows[windowId];
        w.usedPercent = null;
        w.resetsAt = null;
        w.status = null;
        w.source = 'status-line';
        w.updatedAtMs = nowMs;
        this.ingestedAny = true;
        changed = true;
        continue;
      }
      const w = this.windows[windowId];
      if (percent !== null) w.usedPercent = percent;
      if (resetsAt !== null) w.resetsAt = resetsAt;
      w.source = 'status-line';
      w.updatedAtMs = nowMs;
      this.ingestedAny = true;
      changed = true;
    }
    return changed;
  }

  /**
   * Ingest a raw stdout line, tolerating non-JSON noise. Convenience for the
   * collector; never throws on malformed JSON.
   */
  ingestStreamLine(line: string, now: Date = new Date()): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    return this.ingestStreamEvent(parsed, now);
  }

  /** Record that the status line cannot deliver under the current headless session. */
  markHeadlessStatusLineUnavailable(): void {
    this.headlessStatusLineUnavailable = true;
  }

  /** Forget all accumulated data (e.g. on provider switch). */
  reset(): void {
    this.windows.five_hour = emptyWindowState();
    this.windows.seven_day = emptyWindowState();
    this.ingestedAny = false;
    this.headlessStatusLineUnavailable = false;
    this.unsupportedCli = false;
  }

  /** The normalized, display-ready snapshot, with staleness applied relative to `now`. */
  snapshot(now: Date = new Date()): SubscriptionUsageSnapshot {
    const nowMs = now.getTime();
    const windows = {
      five_hour: this.projectWindow('five_hour', nowMs),
      seven_day: this.projectWindow('seven_day', nowMs),
    };
    let latest: number | null = null;
    for (const id of USAGE_WINDOW_IDS) {
      const s = this.windows[id];
      if (s.updatedAtMs !== null && windows[id].available) {
        if (latest === null || s.updatedAtMs > latest) latest = s.updatedAtMs;
      }
    }
    return {
      schemaVersion: SUBSCRIPTION_USAGE_SCHEMA_VERSION,
      provider: this.isClaude ? 'claude' : (this.provider as UsageProviderId),
      windows,
      updatedAt: latest === null ? null : new Date(latest).toISOString(),
    };
  }

  private projectWindow(id: UsageWindowId, nowMs: number): UsageWindow {
    const base: UsageWindow = {
      windowId: id,
      available: false,
      usedPercent: null,
      resetsAt: null,
      status: null,
      usingOverage: null,
      source: null,
      updatedAt: null,
      reason: null,
    };

    if (!this.isClaude) return { ...base, reason: 'unsupported-provider' };

    const s = this.windows[id];
    const hasDatum = s.usedPercent !== null || s.resetsAt !== null || s.status !== null;

    if (s.updatedAtMs !== null && !hasDatum) {
      // We recorded an update but every value failed validation.
      return { ...base, source: s.source, updatedAt: new Date(s.updatedAtMs).toISOString(), reason: 'malformed' };
    }

    if (!hasDatum) {
      // Nothing for this window yet — pick the most specific honest reason.
      let reason: UsageUnavailableReason;
      const sibling = id === 'five_hour' ? this.windows.seven_day : this.windows.five_hour;
      const siblingHasDatum = sibling.usedPercent !== null || sibling.resetsAt !== null || sibling.status !== null;
      if (this.unsupportedCli) reason = 'unsupported-cli';
      else if (siblingHasDatum) reason = 'window-not-reported';
      else if (this.headlessStatusLineUnavailable) reason = 'headless-statusline-unavailable';
      else if (!this.ingestedAny) reason = 'no-first-response';
      else reason = 'window-not-reported';
      return { ...base, reason };
    }

    // We have data. Is it stale?
    const stale = s.updatedAtMs !== null && nowMs - s.updatedAtMs > this.staleAfterMs;
    if (stale) {
      return {
        ...base,
        usedPercent: s.usedPercent,
        resetsAt: s.resetsAt,
        status: s.status,
        usingOverage: s.usingOverage,
        source: s.source,
        updatedAt: new Date(s.updatedAtMs as number).toISOString(),
        reason: 'stale',
      };
    }

    // Fresh and present. It is "available"; note if the percentage specifically is missing.
    const reason: UsageUnavailableReason | null = s.usedPercent === null ? 'percentage-not-reported' : null;
    return {
      windowId: id,
      available: true,
      usedPercent: s.usedPercent,
      resetsAt: s.resetsAt,
      status: s.status,
      usingOverage: s.usingOverage,
      source: s.source,
      updatedAt: new Date(s.updatedAtMs as number).toISOString(),
      reason,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
