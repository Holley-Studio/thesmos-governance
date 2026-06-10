import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PrometheusConfig } from './types';
import { PROMETHEUS_RULES } from './rules/registry';

export const CONFIG_DEFAULTS: PrometheusConfig = {
  name: 'Prometheus',
  version: '2.0.0',
  project: 'unknown',

  ignoredFolders: ['node_modules', '.next', '.git', 'out', '.vercel'],
  largeFileThreshold: 300,
  criticalLibPaths: [],
  requiredFiles: [
    '.prometheus/README.md',
    '.prometheus/config.json',
    '.prometheus/report.json',
    '.prometheus/GUARDRAILS.md',
    '.prometheus/governance/CODE_REVIEW.md',
    '.prometheus/governance/REVIEW_AGENT.md',
    '.github/workflows/prometheus-review.yml',
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
  severityRules: PROMETHEUS_RULES.map((r) => ({ category: r.category, severity: r.severity })),
  disabledRules: [],

  reportMaxAgeDays: 30,
  protectedBranches: ['main'],

  doctor: {
    reportMaxAgeDays: 7,
    requiredScripts: [
      'prometheus:scan',
      'prometheus:review',
      'prometheus:validate',
      'prometheus:audit',
      'prometheus:doctor',
    ],
    requiredFiles: [
      '.prometheus/README.md',
      '.prometheus/config.json',
      '.prometheus/report.json',
      '.prometheus/GUARDRAILS.md',
      '.prometheus/governance/CODE_REVIEW.md',
      '.prometheus/governance/REVIEW_AGENT.md',
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
): PrometheusConfig {
  let raw: Record<string, unknown> = {};

  if (_preloaded) {
    raw = _preloaded;
  } else {
    const configPath = join(root, '.prometheus', 'config.json');
    if (existsSync(configPath)) {
      try {
        raw = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch {
        console.error('[prometheus] Warning: could not parse .prometheus/config.json — using defaults');
      }
    }
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
  } as PrometheusConfig;
}

/** Type guard: minimal required-key check */
export function validateConfig(cfg: unknown): cfg is PrometheusConfig {
  if (typeof cfg !== 'object' || cfg === null) return false;
  const c = cfg as Record<string, unknown>;
  return typeof c.name === 'string' && typeof c.version === 'string';
}
