// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos doctor command.
 * Verifies that Thesmos is correctly installed and usable in any repo.
 *
 * All check functions are pure — fs access is injected via DoctorInput
 * so the full suite is testable without touching disk.
 * The only I/O function is runDoctorForRoot().
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorCheck, ThesmosConfig } from './types';
import { ADAPTER_OUTPUT_PATHS, THESMOS_RULES, isAdapterFresh } from './adapters';
import { extractGeneratedSection } from './output';
import { validateConfig } from './config';
import { parseEndpoint } from './runtime/endpoint.js';

/** Generated-section budget (Operation Signal Phase 5). Measured on the
 *  THESMOS:GENERATED span only — pre-existing user-owned content elsewhere
 *  in the file is out of Thesmos's control and not part of this budget. */
const ADAPTER_SIZE_BUDGET_BYTES = 8192;

/** Absolute, host-specific path patterns that must never appear in generated
 *  content — a path baked in from one machine breaks on every other clone. */
const HOST_SPECIFIC_PATH_RE = /(?:\/(?:Users|home)\/[^\s`'")]+|[A-Za-z]:\\[^\s`'")]+)/;

// ── Injectable input ──────────────────────────────────────────────────────────

export interface DoctorInput {
  config: ThesmosConfig;
  /** Returns true when the repo-relative path exists (file or directory). */
  fileExists: (relativePath: string) => boolean;
  /** Parses a repo-relative JSON file; returns null on any error. */
  readJsonSafe: (relativePath: string) => Record<string, unknown> | null;
  /** Reads a repo-relative file as text; returns null on any error. When provided,
   *  adapter checks also verify freshness via embedded THESMOS:META metadata. */
  readFileSafe?: (relativePath: string) => string | null;
  /** Contents of package.json "scripts" block; empty object when absent. */
  packageScripts: Record<string, string>;
  /** Injected current time — lets tests control staleness without mocking Date. */
  now: Date;
}

// ── Check group labels ────────────────────────────────────────────────────────

export const DOCTOR_GROUPS = {
  FILES: 'Thesmos files',
  SCRIPTS: 'Package scripts',
  ADAPTERS: 'AI adapters',
  REPORT: 'Report health',
  CONFIG: 'Configuration',
  IDE: 'IDE integration',
  GITHUB: 'GitHub integration',
} as const;

export type DoctorGroup = (typeof DOCTOR_GROUPS)[keyof typeof DOCTOR_GROUPS];

// ── Individual check functions (pure) ────────────────────────────────────────

/** Check that all required Thesmos governance files are present. */
function checkRequiredFiles(input: DoctorInput): DoctorCheck[] {
  return input.config.doctor.requiredFiles.map((relPath) => {
    const pass = input.fileExists(relPath);
    return {
      name: relPath,
      group: DOCTOR_GROUPS.FILES,
      pass,
      message: pass ? `${relPath} exists` : `${relPath} is missing`,
      fixHint: pass ? undefined : 'Run thesmos init to create missing Thesmos files',
    };
  });
}

/** Check that every required npm script is declared in package.json. */
function checkPackageScripts(input: DoctorInput): DoctorCheck[] {
  return input.config.doctor.requiredScripts.map((scriptName) => {
    const pass = scriptName in input.packageScripts;
    const cmd = scriptName.replace('thesmos:', '');
    return {
      name: `script:${scriptName}`,
      group: DOCTOR_GROUPS.SCRIPTS,
      pass,
      message: pass
        ? `"${scriptName}" is configured in package.json`
        : `"${scriptName}" is missing from package.json scripts`,
      fixHint: pass
        ? undefined
        : `Add "${scriptName}": "thesmos ${cmd}" to your package.json scripts block`,
    };
  });
}

/** Check that every AI adapter output file has been generated — and is fresh when readable. */
function checkAdapterFiles(input: DoctorInput): DoctorCheck[] {
  return Object.entries(ADAPTER_OUTPUT_PATHS).map(([target, relPath]) => {
    const exists = input.fileExists(relPath);
    if (!exists) {
      return {
        name: `adapter:${target}`,
        group: DOCTOR_GROUPS.ADAPTERS,
        pass: false,
        message: `${relPath} is missing — ${target} adapter not generated`,
        fixHint: 'Run thesmos adapters to generate all AI adapter files',
      };
    }
    // When readFileSafe is provided, also verify embedded metadata freshness.
    if (input.readFileSafe) {
      const content = input.readFileSafe(relPath);
      if (content !== null) {
        const { fresh, reason } = isAdapterFresh(content, THESMOS_RULES, input.config);
        return {
          name: `adapter:${target}`,
          group: DOCTOR_GROUPS.ADAPTERS,
          pass: fresh,
          message: fresh
            ? `${relPath} is current (${target})`
            : `${relPath} is stale — ${reason}`,
          fixHint: fresh ? undefined : 'Run thesmos adapters to refresh AI adapter files',
        };
      }
    }
    return {
      name: `adapter:${target}`,
      group: DOCTOR_GROUPS.ADAPTERS,
      pass: true,
      message: `${relPath} exists (${target})`,
    };
  });
}

/**
 * Check the generated section of each adapter for two portability defects
 * that a silent rewrite would hide: an oversized generated section (the
 * Operation Signal Phase 5 regression this doctor check exists to catch),
 * and host-specific absolute paths baked into generated content. Both are
 * reported with a repair hint — never auto-fixed, since the file may also
 * contain user-owned content doctor must not touch.
 */
function checkAdapterPortability(input: DoctorInput): DoctorCheck[] {
  if (!input.readFileSafe) return [];
  const checks: DoctorCheck[] = [];

  for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
    if (!input.fileExists(relPath)) continue;
    const content = input.readFileSafe(relPath);
    if (content === null) continue;
    const section = extractGeneratedSection(content, 'rules');
    if (section === null) continue; // unmanaged — covered by the freshness check above

    const sizeBytes = Buffer.byteLength(section, 'utf8');
    const withinBudget = sizeBytes <= ADAPTER_SIZE_BUDGET_BYTES;
    checks.push({
      name: `adapter:${target}:size`,
      group: DOCTOR_GROUPS.ADAPTERS,
      pass: withinBudget,
      message: withinBudget
        ? `${relPath} generated section is ${sizeBytes}B (budget ${ADAPTER_SIZE_BUDGET_BYTES}B)`
        : `${relPath} generated section is ${sizeBytes}B — exceeds the ${ADAPTER_SIZE_BUDGET_BYTES}B thin-adapter budget`,
      fixHint: withinBudget
        ? undefined
        : 'Run thesmos adapters to regenerate the thin body; if still oversized, review .thesmos/config.json for custom catalog content inflating this target',
    });

    const hostPathMatch = section.match(HOST_SPECIFIC_PATH_RE);
    checks.push({
      name: `adapter:${target}:portable`,
      group: DOCTOR_GROUPS.ADAPTERS,
      pass: !hostPathMatch,
      message: hostPathMatch
        ? `${relPath} generated section embeds a host-specific absolute path (${hostPathMatch[0]}) — will break on other machines/CI`
        : `${relPath} generated section contains no host-specific absolute paths`,
      fixHint: hostPathMatch
        ? 'Run thesmos adapters on a clean checkout; if the path persists, report it — generated content must never embed a machine-specific path'
        : undefined,
    });
  }

  return checks;
}

/**
 * Summary check for partial synchronization: when some adapter targets are
 * fresh and others are stale/missing, that split is the signal worth
 * surfacing on its own — a repo can pass every individual adapter check yet
 * still be inconsistent across targets if one was hand-edited or skipped.
 */
function checkAdapterSyncStatus(input: DoctorInput): DoctorCheck[] {
  type SyncState = 'missing' | 'unknown' | 'fresh' | 'stale';
  const targets = Object.entries(ADAPTER_OUTPUT_PATHS);
  const states: Array<{ target: string; state: SyncState }> = targets.map(([target, relPath]) => {
    if (!input.fileExists(relPath)) return { target, state: 'missing' };
    if (!input.readFileSafe) return { target, state: 'unknown' };
    const content = input.readFileSafe(relPath);
    if (content === null) return { target, state: 'unknown' };
    const { fresh } = isAdapterFresh(content, THESMOS_RULES, input.config);
    return { target, state: fresh ? 'fresh' : 'stale' };
  });

  if (states.some((s) => s.state === 'unknown')) return []; // no readFileSafe — can't assess sync

  const stale = states.filter((s) => s.state === 'stale' || s.state === 'missing');
  const partial = stale.length > 0 && stale.length < states.length;

  return [
    {
      name: 'adapter:sync-status',
      group: DOCTOR_GROUPS.ADAPTERS,
      pass: stale.length === 0,
      message:
        stale.length === 0
          ? `All ${states.length} adapter targets are in sync`
          : partial
            ? `Partial sync: ${states.length - stale.length}/${states.length} targets current — out of date: ${stale.map((s) => s.target).join(', ')}`
            : `All ${states.length} adapter targets are stale or missing`,
      fixHint: stale.length === 0 ? undefined : 'Run thesmos adapters to bring every target back in sync',
    },
  ];
}

/** Check that report.json exists and is within the configured freshness window. */
function checkReportHealth(input: DoctorInput): DoctorCheck[] {
  const reportPath = '.thesmos/report.json';
  const exists = input.fileExists(reportPath);

  const existsCheck: DoctorCheck = {
    name: 'report:exists',
    group: DOCTOR_GROUPS.REPORT,
    pass: exists,
    message: exists ? 'report.json exists' : 'report.json is missing',
    fixHint: exists ? undefined : 'Run thesmos scan to generate the initial scan report',
  };

  if (!exists) return [existsCheck];

  const report = input.readJsonSafe(reportPath);
  const generatedAt = report?.['generatedAt'] as string | undefined;
  const maxDays = input.config.doctor.reportMaxAgeDays;

  let ageDays: number | null = null;
  let stale = true;

  if (generatedAt) {
    const ageMs = input.now.getTime() - new Date(generatedAt).getTime();
    ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    stale = ageDays > maxDays;
  }

  const ageLabel =
    ageDays === null
      ? 'no timestamp'
      : `${ageDays} day${ageDays === 1 ? '' : 's'} old`;

  const freshCheck: DoctorCheck = {
    name: 'report:fresh',
    group: DOCTOR_GROUPS.REPORT,
    pass: !stale,
    message: stale
      ? `report.json is stale (${ageLabel}, limit ${maxDays} days)`
      : `report.json is fresh (${ageLabel})`,
    fixHint: stale ? 'Run thesmos scan to refresh the report' : undefined,
  };

  return [existsCheck, freshCheck];
}

/**
 * Warn when the baseline hasn't been refreshed in over 30 days. A drifted
 * baseline is the main reason "new" findings appear on PRs that didn't
 * introduce them — the debt ledger stops matching reality. Repos without a
 * baseline skip the check entirely (baselining is opt-in).
 */
const BASELINE_MAX_AGE_DAYS = 30;

function checkBaselineFreshness(input: DoctorInput): DoctorCheck[] {
  const baselinePath = '.thesmos/baseline.json';
  if (!input.fileExists(baselinePath)) return [];

  const baseline = input.readJsonSafe(baselinePath);
  const updatedAt = baseline?.['updatedAt'] as string | undefined;

  let ageDays: number | null = null;
  let stale = true;

  if (updatedAt) {
    const ageMs = input.now.getTime() - new Date(updatedAt).getTime();
    ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    stale = ageDays > BASELINE_MAX_AGE_DAYS;
  }

  const ageLabel =
    ageDays === null ? 'no updatedAt timestamp' : `${ageDays} day${ageDays === 1 ? '' : 's'} old`;

  return [
    {
      name: 'baseline:fresh',
      group: DOCTOR_GROUPS.REPORT,
      pass: !stale,
      message: stale
        ? `baseline.json is stale (${ageLabel}, limit ${BASELINE_MAX_AGE_DAYS} days) — drifted baselines resurface accepted findings on unrelated PRs`
        : `baseline.json is fresh (${ageLabel})`,
      fixHint: stale ? 'Run npm run thesmos:baseline:update to re-sync the accepted-debt ledger' : undefined,
    },
  ];
}

/** Check that config.json is present, parseable, and structurally valid. */
function checkConfiguration(input: DoctorInput): DoctorCheck[] {
  const configPath = '.thesmos/config.json';
  const raw = input.readJsonSafe(configPath);
  const configValid = raw !== null && validateConfig(raw);

  const checks: DoctorCheck[] = [
    {
      name: 'config:valid',
      group: DOCTOR_GROUPS.CONFIG,
      pass: configValid,
      message: configValid
        ? 'config.json is present and valid'
        : raw === null
          ? 'config.json is missing or could not be parsed as JSON'
          : 'config.json is missing required fields (name, version)',
      fixHint: configValid
        ? undefined
        : 'Run thesmos init to create a valid config.json, or ensure it contains "name" and "version" string fields',
    },
  ];

  // Provider endpoints are validated here but never dialled: runDoctor is pure
  // and synchronous by design. Live reachability belongs to `providers:doctor`,
  // and an optional provider being switched off must not fail this gate.
  const ollamaUrl = input.config.providers?.ollama?.baseUrl;
  if (ollamaUrl !== undefined) {
    let parsed: ReturnType<typeof parseEndpoint> | undefined;
    let error: string | undefined;
    try {
      parsed = parseEndpoint(ollamaUrl);
    } catch (err) {
      error = err instanceof Error ? err.message : 'invalid endpoint';
    }

    checks.push({
      name: 'config:ollama-endpoint',
      group: DOCTOR_GROUPS.CONFIG,
      pass: parsed !== undefined,
      message: parsed
        ? parsed.locality === 'local'
          ? `Ollama endpoint ${parsed.origin} is loopback — no data egress`
          : `Ollama endpoint ${parsed.origin} is ${parsed.locality} — prompts leave this machine and need a web permission grant`
        : `Ollama endpoint is invalid: ${error}`,
      fixHint: parsed
        ? parsed.locality === 'local'
          ? undefined
          : 'Grant it on the web channel, or set providers.ollama.baseUrl back to http://127.0.0.1:11434'
        : 'Set providers.ollama.baseUrl to an http(s) URL, e.g. http://127.0.0.1:11434',
    });
  }

  const branches = input.config.protectedBranches;
  const hasBranches = Array.isArray(branches) && branches.length > 0;
  checks.push({
    name: 'config:protected-branches',
    group: DOCTOR_GROUPS.CONFIG,
    pass: hasBranches,
    message: hasBranches
      ? `Protected branches: ${branches.join(', ')}`
      : 'No protected branches configured',
    fixHint: hasBranches
      ? undefined
      : 'Add "protectedBranches": ["main"] to .thesmos/config.json',
  });

  return checks;
}

const IDE_FIX_HINTS: Record<string, string> = {
  '.claude':
    'Create a .claude/ directory; run thesmos adapters to generate CLAUDE.md',
  '.cursor':
    'Create a .cursor/rules/ directory; run thesmos adapters to generate thesmos.mdc',
  '.codex':
    'Create a .codex/ directory; run thesmos adapters to generate thesmos.md',
};

/** Check that each required IDE integration directory is present. */
function checkIdeDirs(input: DoctorInput): DoctorCheck[] {
  return input.config.doctor.requiredIdeDirs.map((dir) => {
    const pass = input.fileExists(dir);
    return {
      name: `ide:${dir}`,
      group: DOCTOR_GROUPS.IDE,
      pass,
      message: pass ? `${dir}/ directory exists` : `${dir}/ directory is missing`,
      fixHint: pass ? undefined : (IDE_FIX_HINTS[dir] ?? `Create the ${dir}/ directory`),
    };
  });
}

/** Check GitHub Actions workflow (and optionally remind about required secrets). */
function checkGitHubIntegration(input: DoctorInput): DoctorCheck[] {
  const workflowPath =
    input.config.github?.workflow ?? '.github/workflows/thesmos-review.yml';
  const pass = input.fileExists(workflowPath);

  const checks: DoctorCheck[] = [
    {
      name: 'github:workflow',
      group: DOCTOR_GROUPS.GITHUB,
      pass,
      message: pass
        ? `${workflowPath} exists`
        : `${workflowPath} is missing`,
      fixHint: pass
        ? undefined
        : 'Create the GitHub Actions workflow file or run thesmos init --github',
    },
  ];

  const requiredSecrets = input.config.github?.requiresSecrets;
  if (pass && Array.isArray(requiredSecrets) && requiredSecrets.length > 0) {
    checks.push({
      name: 'github:secrets',
      group: DOCTOR_GROUPS.GITHUB,
      pass: true,
      message: `Required GitHub secrets (verify in repo Settings → Secrets): ${requiredSecrets.join(', ')}`,
    });
  }

  return checks;
}

// ── Aggregator ────────────────────────────────────────────────────────────────

/**
 * Run all doctor checks against the provided injectable input.
 * Returns checks in logical group order.
 */
export function runDoctor(input: DoctorInput): DoctorCheck[] {
  return [
    ...checkRequiredFiles(input),
    ...checkPackageScripts(input),
    ...checkAdapterFiles(input),
    ...checkAdapterPortability(input),
    ...checkAdapterSyncStatus(input),
    ...checkReportHealth(input),
    ...checkBaselineFreshness(input),
    ...checkConfiguration(input),
    ...checkIdeDirs(input),
    ...checkGitHubIntegration(input),
  ];
}

// ── I/O entry point ───────────────────────────────────────────────────────────

/** Run doctor checks against an actual repo on disk. */
export function runDoctorForRoot(root: string, config: ThesmosConfig): DoctorCheck[] {
  let packageScripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    if (typeof pkg['scripts'] === 'object' && pkg['scripts'] !== null) {
      packageScripts = pkg['scripts'] as Record<string, string>;
    }
  } catch {
    // missing or invalid package.json — leave scripts empty
  }

  return runDoctor({
    config,
    fileExists: (rel) => existsSync(join(root, rel)),
    readJsonSafe: (rel) => {
      try {
        return JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    readFileSafe: (rel) => {
      try {
        return readFileSync(join(root, rel), 'utf8');
      } catch {
        return null;
      }
    },
    packageScripts,
    now: new Date(),
  });
}

// ── Output formatters ─────────────────────────────────────────────────────────

const PASS_ICON = '✓';
const FAIL_ICON = '✗';

/** Group checks by their `group` field, preserving order of first appearance. */
function groupChecks(checks: DoctorCheck[]): Map<string, DoctorCheck[]> {
  const map = new Map<string, DoctorCheck[]>();
  for (const c of checks) {
    const key = c.group ?? 'Other';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return map;
}

/**
 * Human-readable console summary grouped by category.
 * Passed checks are shown concisely; failed checks include their fix hint.
 */
export function formatDoctorConsole(
  checks: DoctorCheck[],
  projectName = 'Repo',
  title = 'Thesmos Doctor'
): string {
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;
  const groups = groupChecks(checks);
  const lines: string[] = [];

  lines.push(`${title} — ${projectName}`);
  lines.push('─'.repeat(50));
  lines.push('');

  for (const [groupName, groupChecks] of groups) {
    lines.push(`  ${groupName}`);
    for (const c of groupChecks) {
      const icon = c.pass ? PASS_ICON : FAIL_ICON;
      lines.push(`  ${icon}  ${c.message}`);
      if (!c.pass && c.fixHint) {
        lines.push(`       → ${c.fixHint}`);
      }
    }
    lines.push('');
  }

  lines.push('─'.repeat(50));
  const summary =
    failed === 0
      ? `  ${checks.length} checks — all passed`
      : `  ${checks.length} checks — ${passed} passed, ${failed} failed`;
  lines.push(summary);

  return lines.join('\n');
}

/**
 * Markdown report of all doctor checks, grouped by category.
 */
export function formatDoctorMarkdown(
  checks: DoctorCheck[],
  projectName = 'Repo',
  title = 'Thesmos Doctor'
): string {
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;
  const groups = groupChecks(checks);
  const lines: string[] = [];

  lines.push(`## ${title} — ${projectName}`);
  lines.push('');

  const statusLabel = failed === 0 ? '✅ All checks passed' : `⚠️ ${failed} check${failed === 1 ? '' : 's'} failed`;
  lines.push(`**${statusLabel}** (${passed}/${checks.length})`);
  lines.push('');

  for (const [groupName, groupChecks] of groups) {
    lines.push(`### ${groupName}`);
    lines.push('');
    lines.push('| Status | Check | Message |');
    lines.push('|---|---|---|');
    for (const c of groupChecks) {
      const status = c.pass ? '✓' : '✗';
      const hint = !c.pass && c.fixHint ? ` _Fix: ${c.fixHint}_` : '';
      lines.push(`| ${status} | \`${c.name}\` | ${c.message}${hint} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Machine-readable JSON of all doctor checks with summary counts.
 */
export function formatDoctorJson(checks: DoctorCheck[]): string {
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;
  return JSON.stringify({ pass: failed === 0, total: checks.length, passed, failed, checks }, null, 2);
}
