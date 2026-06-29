// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * User-local profile — persistent preferences and learned suppressions.
 *
 * Stored at ~/.thesmos/profile.json. Never transmitted; fully local.
 * The profile applies across all projects on this machine.
 *
 * Shape:
 *   preferences  — explicit user-set overrides (verbosity, default severity filter)
 *   learned      — derived from repeated suppress calls (auto-downgrade)
 *   corrections  — explicit `profile:correct` overrides to learned behavior
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Severity } from './types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProfilePreferences {
  defaultSeverityFilter: Severity | 'none';
  verbosity: 'compact' | 'normal' | 'verbose';
  disabledGlobally: string[];
}

export interface LearnedEntry {
  rule: string;
  suppressCount: number;
  lastSuppressed: string;
  suggestedSeverity: Severity | null;
}

export interface ProfileCorrection {
  rule: string;
  severity: Severity;
  reason?: string;
  ts: string;
}

export interface UserProfile {
  version: 1;
  createdAt: string;
  updatedAt: string;
  preferences: ProfilePreferences;
  learned: Record<string, LearnedEntry>;
  corrections: ProfileCorrection[];
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const PROFILE_DEFAULTS: UserProfile = {
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  preferences: {
    defaultSeverityFilter: 'none',
    verbosity: 'normal',
    disabledGlobally: [],
  },
  learned: {},
  corrections: [],
};

// After this many suppresses across projects, a rule is auto-downgraded
const AUTO_DOWNGRADE_THRESHOLD = 3;

// ── Storage ───────────────────────────────────────────────────────────────────

function profileDir(): string {
  return join(homedir(), '.thesmos');
}

function profilePath(): string {
  return join(profileDir(), 'profile.json');
}

export function loadProfile(): UserProfile {
  const path = profilePath();
  if (!existsSync(path)) return { ...PROFILE_DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as UserProfile;
    return {
      ...PROFILE_DEFAULTS,
      ...raw,
      preferences: { ...PROFILE_DEFAULTS.preferences, ...(raw.preferences ?? {}) },
      learned: raw.learned ?? {},
      corrections: raw.corrections ?? [],
    };
  } catch {
    return { ...PROFILE_DEFAULTS };
  }
}

export function saveProfile(profile: UserProfile): void {
  const dir = profileDir();
  mkdirSync(dir, { recursive: true });
  profile.updatedAt = new Date().toISOString();
  writeFileSync(profilePath(), JSON.stringify(profile, null, 2), 'utf8');
}

// ── Learning ──────────────────────────────────────────────────────────────────

/**
 * Records a suppress event for a rule. Called by thesmos suppress <rule>.
 * After AUTO_DOWNGRADE_THRESHOLD suppressions, the rule is flagged as
 * frequently ignored and its suggested severity is downgraded one level.
 */
export function recordSuppress(rule: string): void {
  const profile = loadProfile();
  const existing = profile.learned[rule] ?? {
    rule,
    suppressCount: 0,
    lastSuppressed: '',
    suggestedSeverity: null,
  };

  existing.suppressCount += 1;
  existing.lastSuppressed = new Date().toISOString();

  // Auto-downgrade logic: every AUTO_DOWNGRADE_THRESHOLD suppressions, step down
  if (existing.suppressCount >= AUTO_DOWNGRADE_THRESHOLD && existing.suggestedSeverity === null) {
    existing.suggestedSeverity = 'LOW';
  }

  profile.learned[rule] = existing;
  saveProfile(profile);
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/** Returns true if a rule has been globally disabled in preferences. */
export function isGloballyDisabled(rule: string): boolean {
  const profile = loadProfile();
  return profile.preferences.disabledGlobally.includes(rule);
}

/** Returns the user-corrected severity for a rule, if one exists (most recent correction). */
export function getCorrectedSeverity(rule: string): Severity | null {
  const profile = loadProfile();
  const matches = profile.corrections.filter((c) => c.rule === rule);
  return matches.length > 0 ? (matches[matches.length - 1]?.severity ?? null) : null;
}

/** Returns all frequently-ignored rule IDs (suppress count ≥ threshold). */
export function getFrequentlyIgnored(): string[] {
  const profile = loadProfile();
  return Object.values(profile.learned)
    .filter((e) => e.suppressCount >= AUTO_DOWNGRADE_THRESHOLD)
    .map((e) => e.rule);
}
