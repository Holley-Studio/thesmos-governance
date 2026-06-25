// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Thesmos ci-check — fast CI-critical health check.
 *
 * Verifies:
 *   1. Required Thesmos governance files exist
 *   2. GitHub Actions workflow file exists
 *   3. All adapter files exist and carry current metadata (ruleCount + version)
 *   4. Generated section markers are present in each adapter
 *   5. .thesmos/config.json is valid
 *
 * Does NOT run a full repo scan. Designed to be fast (~ms) and safe to run
 * as an early CI gate before thesmos validate.
 *
 * All check functions are pure — fs access is injected via CiCheckInput
 * so the full suite is testable without touching disk.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorCheck, ThesmosConfig } from './types';
import { ADAPTER_OUTPUT_PATHS, THESMOS_RULES, isAdapterFresh, type Rule } from './adapters';
import { validateConfig } from './config';
import {
  formatDoctorConsole,
  formatDoctorMarkdown,
  formatDoctorJson,
} from './doctor';

// ── Injectable input ──────────────────────────────────────────────────────────

export interface CiCheckInput {
  config: ThesmosConfig;
  /** Canonical rule list — injectable for tests to simulate drift. */
  rules: Rule[];
  fileExists: (relativePath: string) => boolean;
  readFileSafe: (relativePath: string) => string | null;
  readJsonSafe: (relativePath: string) => Record<string, unknown> | null;
}

// ── Check group labels ────────────────────────────────────────────────────────

export const CI_CHECK_GROUPS = {
  CI_FILES: 'CI files',
  ADAPTERS: 'AI adapters',
  CONFIG: 'Configuration',
} as const;

// ── Check functions (pure) ────────────────────────────────────────────────────

const THESMOS_REQUIRED_FILES = [
  '.thesmos/README.md',
  '.thesmos/config.json',
  '.thesmos/GUARDRAILS.md',
  '.thesmos/governance/CODE_REVIEW.md',
  '.thesmos/governance/REVIEW_AGENT.md',
  '.thesmos/report.json',
];

function checkCiFiles(input: CiCheckInput): DoctorCheck[] {
  const workflowPath =
    input.config.github?.workflow ?? '.github/workflows/thesmos-review.yml';
  const ciFiles = [...THESMOS_REQUIRED_FILES, workflowPath];

  return ciFiles.map((relPath) => {
    const pass = input.fileExists(relPath);
    return {
      name: relPath,
      group: CI_CHECK_GROUPS.CI_FILES,
      pass,
      message: pass ? `${relPath} exists` : `${relPath} is missing`,
      fixHint: pass
        ? undefined
        : relPath.startsWith('.github/')
          ? 'Run thesmos init to generate the GitHub Actions workflow'
          : 'Run thesmos init to create missing Thesmos governance files',
    };
  });
}

function checkAdapters(input: CiCheckInput): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
    if (!input.fileExists(relPath)) {
      checks.push({
        name: `adapter:${target}:exists`,
        group: CI_CHECK_GROUPS.ADAPTERS,
        pass: false,
        message: `${relPath} is missing — ${target} adapter not generated`,
        fixHint: 'Run thesmos adapters to generate all AI adapter files',
      });
      continue;
    }

    const content = input.readFileSafe(relPath);
    if (content === null) {
      checks.push({
        name: `adapter:${target}:read`,
        group: CI_CHECK_GROUPS.ADAPTERS,
        pass: false,
        message: `${relPath} could not be read`,
        fixHint: 'Check file permissions or regenerate with thesmos adapters',
      });
      continue;
    }

    // Freshness: embedded ruleCount + version must match the canonical registry
    const { fresh, reason } = isAdapterFresh(content, input.rules, input.config);
    checks.push({
      name: `adapter:${target}:fresh`,
      group: CI_CHECK_GROUPS.ADAPTERS,
      pass: fresh,
      message: fresh
        ? `${relPath} is current (${target})`
        : `${relPath} is stale — ${reason}`,
      fixHint: fresh ? undefined : 'Run thesmos adapters to refresh AI adapter files',
    });

    // Markers: THESMOS:GENERATED boundaries must still be present
    const hasMarkers = content.includes('<!-- THESMOS:GENERATED START rules -->');
    checks.push({
      name: `adapter:${target}:markers`,
      group: CI_CHECK_GROUPS.ADAPTERS,
      pass: hasMarkers,
      message: hasMarkers
        ? `${relPath} has generated section markers`
        : `${relPath} is missing THESMOS:GENERATED markers — manual edit may have overwritten the generated section`,
      fixHint: hasMarkers
        ? undefined
        : 'Run thesmos adapters to regenerate the file with proper section markers',
    });
  }

  return checks;
}

function checkCiConfig(input: CiCheckInput): DoctorCheck[] {
  const configPath = '.thesmos/config.json';
  const raw = input.readJsonSafe(configPath);
  const valid = raw !== null && validateConfig(raw);
  return [
    {
      name: 'config:valid',
      group: CI_CHECK_GROUPS.CONFIG,
      pass: valid,
      message: valid
        ? 'config.json is present and valid'
        : raw === null
          ? 'config.json is missing or could not be parsed'
          : 'config.json is missing required fields (name, version)',
      fixHint: valid ? undefined : 'Run thesmos init to create a valid config.json',
    },
  ];
}

// ── Aggregator ────────────────────────────────────────────────────────────────

export function runCiCheck(input: CiCheckInput): DoctorCheck[] {
  return [
    ...checkCiFiles(input),
    ...checkAdapters(input),
    ...checkCiConfig(input),
  ];
}

// ── Output formatters (thin wrappers reusing doctor formatters) ───────────────

const CI_TITLE = 'Thesmos CI Check';

export function formatCiCheckConsole(checks: DoctorCheck[], projectName = 'Repo'): string {
  return formatDoctorConsole(checks, projectName, CI_TITLE);
}

export function formatCiCheckMarkdown(checks: DoctorCheck[], projectName = 'Repo'): string {
  return formatDoctorMarkdown(checks, projectName, CI_TITLE);
}

export function formatCiCheckJson(checks: DoctorCheck[]): string {
  return formatDoctorJson(checks);
}

// ── I/O entry point ───────────────────────────────────────────────────────────

export function runCiCheckForRoot(root: string, config: ThesmosConfig): DoctorCheck[] {
  return runCiCheck({
    config,
    rules: THESMOS_RULES,
    fileExists: (rel) => existsSync(join(root, rel)),
    readFileSafe: (rel) => {
      try {
        return readFileSync(join(root, rel), 'utf8');
      } catch {
        return null;
      }
    },
    readJsonSafe: (rel) => {
      try {
        return JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  });
}
