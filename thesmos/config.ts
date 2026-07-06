// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { ThesmosConfig } from './types';
import { THESMOS_RULES } from './rules/registry';
import { resolveTier } from './tiers';

// Resolve built-in preset JSON files shipped with the package
const _require = createRequire(import.meta.url ?? 'file://' + __filename);

function resolvePreset(extendsValue: string): Record<string, unknown> {
  // Built-in presets: "thesmos/recommended", "thesmos/ai-strict", "thesmos/vibe-coding"
  const BUILTIN_PRESETS: Record<string, string> = {
    'thesmos/recommended':  join(dirname(fileURLToPath(import.meta.url ?? 'file://' + __filename)), 'presets', 'recommended.json'),
    'thesmos/ai-strict':    join(dirname(fileURLToPath(import.meta.url ?? 'file://' + __filename)), 'presets', 'ai-strict.json'),
    'thesmos/vibe-coding':  join(dirname(fileURLToPath(import.meta.url ?? 'file://' + __filename)), 'presets', 'vibe-coding.json'),
  };

  const builtinPath = BUILTIN_PRESETS[extendsValue];
  if (builtinPath && existsSync(builtinPath)) {
    try { return JSON.parse(readFileSync(builtinPath, 'utf8')) as Record<string, unknown>; } catch { /* fall through */ }
  }

  // Relative or absolute path
  if (extendsValue.startsWith('.') || extendsValue.startsWith('/')) {
    try {
      const abs = resolve(extendsValue);
      if (existsSync(abs)) return JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    } catch { /* fall through */ }
  }

  // npm package (e.g. "@myorg/thesmos-rules")
  try {
    return _require(extendsValue) as Record<string, unknown>;
  } catch { /* fall through */ }

  console.warn(`[thesmos] Warning: could not resolve preset "${extendsValue}" — skipping`);
  return {};
}

export const CONFIG_DEFAULTS: ThesmosConfig = {
  name: 'Thesmos',
  version: '2.0.0',
  project: 'unknown',

  ignoredFolders: ['node_modules', '.next', '.git', 'out', '.vercel'],
  reviewIgnorePaths: [],
  gate: { minConfidence: 'medium' },
  largeFileThreshold: 300,
  criticalLibPaths: [],
  requiredFiles: [
    '.thesmos/README.md',
    '.thesmos/config.json',
    '.thesmos/report.json',
    '.thesmos/GUARDRAILS.md',
    '.thesmos/governance/CODE_REVIEW.md',
    '.thesmos/governance/REVIEW_AGENT.md',
    '.github/workflows/thesmos-review.yml',
  ],

  secretPatterns: [
    'sk-[a-zA-Z0-9-]{20,}',
    'eyJ[a-zA-Z0-9+/]{20,}={0,2}\\.',
    '-----BEGIN[^-]+PRIVATE KEY-----',
    'secret_access_key\\s*[:=]\\s*[A-Za-z0-9/+]{20,}',
    'AAAA[0-9A-Za-z+/]{40,}',
  ],

  failOnSeverity: ['BLOCKER'],
  warnOnSeverity: ['HIGH'],
  severityRules: THESMOS_RULES.map((r) => ({ category: r.category, severity: r.severity })),
  disabledRules: [],

  reportMaxAgeDays: 30,
  protectedBranches: ['main'],

  autoMode: {
    enabled: true,
    strictMode: true,
    // Matches the real-time hook's actual behavior — only BLOCKER findings stop a
    // write by default. Projects opt into stricter gating via autoMode.blockOn.
    blockOn: 'BLOCKER' as const,
    notifyOnBlock: true,
  },

  routing: {
    mode: 'auto',
    councilConfirmThreshold: 4,
  },

  context1M: {
    allow1M: false,
  },

  doctor: {
    reportMaxAgeDays: 7,
    requiredScripts: [
      'thesmos:scan',
      'thesmos:review',
      'thesmos:validate',
      'thesmos:audit',
      'thesmos:doctor',
    ],
    requiredFiles: [
      '.thesmos/README.md',
      '.thesmos/config.json',
      '.thesmos/report.json',
      '.thesmos/GUARDRAILS.md',
      '.thesmos/governance/CODE_REVIEW.md',
      '.thesmos/governance/REVIEW_AGENT.md',
    ],
    requiredIdeDirs: ['.claude', '.cursor', '.codex'],
  },
};

/**
 * Load and merge config.json with defaults.
 * Accepts an optional pre-parsed object (for tests that bypass fs).
 */
export function loadConfig(
  root: string,
  _preloaded?: Record<string, unknown>
): ThesmosConfig {
  let raw: Record<string, unknown> = {};

  if (_preloaded) {
    raw = _preloaded;
  } else {
    const configPath = join(root, '.thesmos', 'config.json');
    if (existsSync(configPath)) {
      try {
        raw = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch {
        console.warn('[thesmos] Warning: could not parse .thesmos/config.json — using defaults');
      }
    }
  }

  // Apply extends preset (shallow merge: preset is the base, local config overrides)
  if (typeof raw.extends === 'string') {
    const preset = resolvePreset(raw.extends);
    const { extends: _ext, ...localOverrides } = raw;
    raw = { ...preset, ...localOverrides };
  }

  // Deep merge: scalars from raw override defaults; arrays from raw replace defaults
  return {
    ...CONFIG_DEFAULTS,
    ...raw,
    doctor: {
      ...CONFIG_DEFAULTS.doctor,
      ...(typeof raw.doctor === 'object' && raw.doctor !== null ? raw.doctor as object : {}),
    },
    // Always normalize arrays — cast from JSON so they're definitely arrays
    failOnSeverity: Array.isArray(raw.failOnSeverity)
      ? (raw.failOnSeverity as (typeof CONFIG_DEFAULTS.failOnSeverity)[number][])
      : CONFIG_DEFAULTS.failOnSeverity,
    warnOnSeverity: Array.isArray(raw.warnOnSeverity)
      ? (raw.warnOnSeverity as (typeof CONFIG_DEFAULTS.warnOnSeverity)[number][])
      : CONFIG_DEFAULTS.warnOnSeverity,
    ignoredFolders: Array.isArray(raw.ignoredFolders)
      ? (raw.ignoredFolders as string[])
      : CONFIG_DEFAULTS.ignoredFolders,
    reviewIgnorePaths: Array.isArray(raw.reviewIgnorePaths)
      ? (raw.reviewIgnorePaths as string[])
      : CONFIG_DEFAULTS.reviewIgnorePaths,
    gate: (() => {
      const g = raw.gate as { minConfidence?: string } | undefined;
      const valid = ['high', 'medium', 'low'];
      return g && typeof g.minConfidence === 'string' && valid.includes(g.minConfidence)
        ? { minConfidence: g.minConfidence as 'high' | 'medium' | 'low' }
        : CONFIG_DEFAULTS.gate;
    })(),
    secretPatterns: Array.isArray(raw.secretPatterns)
      ? (raw.secretPatterns as string[])
      : CONFIG_DEFAULTS.secretPatterns,
    severityRules: Array.isArray(raw.severityRules)
      ? (raw.severityRules as typeof CONFIG_DEFAULTS.severityRules)
      : CONFIG_DEFAULTS.severityRules,
    criticalLibPaths: Array.isArray(raw.criticalLibPaths)
      ? (raw.criticalLibPaths as string[])
      : CONFIG_DEFAULTS.criticalLibPaths,
    requiredFiles: Array.isArray(raw.requiredFiles)
      ? (raw.requiredFiles as string[])
      : CONFIG_DEFAULTS.requiredFiles,
    protectedBranches: Array.isArray(raw.protectedBranches)
      ? (raw.protectedBranches as string[])
      : CONFIG_DEFAULTS.protectedBranches,
    disabledRules: Array.isArray(raw.disabledRules)
      ? (raw.disabledRules as string[])
      : CONFIG_DEFAULTS.disabledRules,
    // Resolve the licensing tier once, here, so the pure review/govern engines
    // can filter by config.tier without touching the filesystem. Precedence:
    // THESMOS_TIER env → explicit config.tier → premium-pack marker → 'free'.
    tier: resolveTier(raw.tier as ('free' | 'premium' | undefined), root),
  } as ThesmosConfig;
}

/** Type guard: minimal required-key check */
export function validateConfig(cfg: unknown): cfg is ThesmosConfig {
  if (typeof cfg !== 'object' || cfg === null) return false;
  const c = cfg as Record<string, unknown>;
  return typeof c.name === 'string' && typeof c.version === 'string';
}
