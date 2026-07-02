// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos License System
 *
 * Tiers:
 *   community  — free (MIT), core CLI + 500 rules + 10 agents
 *   pro        — $29/month, all rules + all agents + VS Code Pro + inline PR comments
 *   team       — $99/month/user, everything + agent teams + pantheon:council + shared baseline
 *   enterprise — custom, everything + SSO + compliance export + private MCP
 *
 * Local cache: ~/.thesmos/license.json
 * Validation: Holley Studio API at https://api.holleystudios.com/thesmos/v1/license/validate
 *   - Re-validates every 24h (fails open — offline work is never blocked)
 *   - Telemetry: license key + seat count only. No code, no file paths.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LicenseTier = 'community' | 'pro' | 'team' | 'enterprise';

export interface LicenseInfo {
  tier: LicenseTier;
  key: string | null;
  email: string | null;
  seats: number;
  expiresAt: string | null;     // ISO 8601 or null for perpetual
  validatedAt: string | null;   // ISO 8601 of last successful API check
  offline: boolean;             // true if last validation was skipped (no network)
}

interface LicenseCache {
  version: 1;
  key: string;
  tier: LicenseTier;
  email: string;
  seats: number;
  expiresAt: string | null;
  validatedAt: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const VALIDATION_API = 'https://api.holleystudios.com/thesmos/v1/license/validate';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function thesmosDir(): string {
  return join(homedir(), '.thesmos');
}

function licenseCachePath(): string {
  return join(thesmosDir(), 'license.json');
}

// ── Cache I/O ─────────────────────────────────────────────────────────────────

function readCache(): LicenseCache | null {
  const p = licenseCachePath();
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>)['version'] === 1
    ) {
      return parsed as LicenseCache;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(cache: LicenseCache): void {
  const dir = thesmosDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(licenseCachePath(), JSON.stringify(cache, null, 2), 'utf8');
}

function clearCache(): void {
  const p = licenseCachePath();
  if (existsSync(p)) {
    writeFileSync(p, '', 'utf8');
  }
}

// ── API validation ────────────────────────────────────────────────────────────

interface ApiValidateResponse {
  valid: boolean;
  tier: LicenseTier;
  email: string;
  seats: number;
  expiresAt: string | null;
  message?: string;
}

async function validateWithApi(key: string): Promise<ApiValidateResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(VALIDATION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, clientVersion: '4.3.0' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as ApiValidateResponse;
  } catch {
    return null; // network error → fail open
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

const COMMUNITY: LicenseInfo = {
  tier: 'community',
  key: null,
  email: null,
  seats: 1,
  expiresAt: null,
  validatedAt: null,
  offline: false,
};

/**
 * Returns the current license info.
 * Reads from local cache; re-validates against the API in background if cache is stale.
 * Always returns quickly — never awaits the network call.
 */
export function getLicenseInfo(): LicenseInfo {
  const cache = readCache();
  if (!cache || !cache.key) return COMMUNITY;

  const validatedAt = new Date(cache.validatedAt);
  const stale = Date.now() - validatedAt.getTime() > CACHE_TTL_MS;

  if (stale) {
    // Re-validate in background, fail open
    validateWithApi(cache.key).then((resp) => {
      if (resp && resp.valid) {
        writeCache({
          version: 1,
          key: cache.key,
          tier: resp.tier,
          email: resp.email,
          seats: resp.seats,
          expiresAt: resp.expiresAt,
          validatedAt: new Date().toISOString(),
        });
      }
    }).catch(() => { /* ignore */ });
  }

  const expired = cache.expiresAt ? new Date(cache.expiresAt) < new Date() : false;
  if (expired) return { ...COMMUNITY, offline: false };

  return {
    tier: cache.tier,
    key: cache.key,
    email: cache.email,
    seats: cache.seats,
    expiresAt: cache.expiresAt,
    validatedAt: cache.validatedAt,
    offline: stale,
  };
}

/** Returns the current tier without the full info object. */
export function getLicenseTier(): LicenseTier {
  return getLicenseInfo().tier;
}

const TIER_ORDER: Record<LicenseTier, number> = {
  community: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
};

/**
 * Throws if the current license tier is below `required`.
 * Pass the feature name for a helpful error message.
 */
export function requireTier(required: LicenseTier, featureName?: string): void {
  const current = getLicenseTier();
  if (TIER_ORDER[current] < TIER_ORDER[required]) {
    const feature = featureName ? `"${featureName}"` : 'this feature';
    const upgrade =
      required === 'pro'
        ? 'Upgrade to Thesmos Pro ($29/month) at https://holleystudios.com/thesmos'
        : required === 'team'
        ? 'Upgrade to Thesmos Team ($99/month) at https://holleystudios.com/thesmos'
        : 'Contact sales@holleystudios.com for Enterprise pricing';
    throw new Error(
      `${feature} requires a Thesmos ${required.charAt(0).toUpperCase() + required.slice(1)} license.\n  ${upgrade}`,
    );
  }
}

/**
 * Checks if the current tier meets or exceeds `required`.
 * Use this for conditional behavior rather than hard gates.
 */
export function hasTier(required: LicenseTier): boolean {
  return TIER_ORDER[getLicenseTier()] >= TIER_ORDER[required];
}

// ── Activate / Deactivate ─────────────────────────────────────────────────────

export interface ActivateResult {
  success: boolean;
  tier?: LicenseTier;
  email?: string;
  seats?: number;
  expiresAt?: string | null;
  error?: string;
}

/**
 * Validates the key against the Holley Studio API and caches the result.
 * Must be awaited — this always makes a network call.
 */
export async function activateLicense(key: string): Promise<ActivateResult> {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return { success: false, error: 'License key cannot be empty.' };
  }

  const resp = await validateWithApi(trimmedKey);
  if (!resp) {
    return { success: false, error: 'Could not reach the Holley Studio license server. Check your network and try again.' };
  }
  if (!resp.valid) {
    return { success: false, error: resp.message ?? 'Invalid license key.' };
  }

  writeCache({
    version: 1,
    key: trimmedKey,
    tier: resp.tier,
    email: resp.email,
    seats: resp.seats,
    expiresAt: resp.expiresAt,
    validatedAt: new Date().toISOString(),
  });

  return {
    success: true,
    tier: resp.tier,
    email: resp.email,
    seats: resp.seats,
    expiresAt: resp.expiresAt,
  };
}

/** Removes the license cache, downgrading to community. */
export function deactivateLicense(): void {
  clearCache();
}

// ── Feature gate registry ─────────────────────────────────────────────────────

/**
 * Pro tier features (not available in community):
 *   - All 1,137 rules
 *   - All 54 Pantheon + Specialty agents (community: 10 core agents)
 *   - Inline PR review comments + Checks API
 *   - VS Code inline diagnostics + Fix button
 *   - Token meter + budget alerts
 *   - secrets:vault
 *   - User-local profile memory + learning
 *   - SARIF export + EU AI Act footer
 */
export const PRO_FEATURES = [
  'all-rules',
  'all-agents',
  'pr-inline-comments',
  'vscode-diagnostics',
  'vscode-fix-button',
  'token-meter',
  'secrets-vault',
  'profile-memory',
  'sarif-export',
] as const;

/**
 * Team tier features (require team or enterprise):
 *   - Agent Teams (pantheon:team)
 *   - pantheon:council multi-agent queries
 *   - Shared team governance baseline
 *   - PR trend tracking dashboard
 *   - Slack/webhook notifications
 *   - Admin dashboard
 */
export const TEAM_FEATURES = [
  'agent-teams',
  'pantheon-council',
  'team-baseline',
  'pr-trend-tracking',
  'slack-notifications',
  'admin-dashboard',
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];
export type TeamFeature = (typeof TEAM_FEATURES)[number];
