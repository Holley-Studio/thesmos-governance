// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Thesmos CLI execution layer.
 *
 * Discovers the project-local binary (node_modules/.bin/thesmos), falls
 * back to a user-specified override, and exposes typed async wrappers for
 * every CLI command the extension needs.
 *
 * All I/O is isolated here — no vscode imports, fully unit-testable.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Finding, HealthScore, ReviewOutput } from './types.js';

// VS Code launched from the Dock doesn't inherit nvm/volta PATH — extend it
// so node_modules/.bin scripts can resolve their `node` shebang.
function buildEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const extra = [
    `${home}/.nvm/versions/node/v20.20.2/bin`,
    `${home}/.nvm/versions/node/v22.0.0/bin`,
    `${home}/.nvm/versions/node/v24.0.0/bin`,
    `${home}/.nvm/versions/node/v18.0.0/bin`,
    `${home}/.volta/bin`,
    `${home}/.fnm/aliases/default/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].join(sep);
  return { ...process.env, PATH: `${extra}${sep}${process.env.PATH ?? ''}`, FORCE_COLOR: '0' };
}

const RUNNER_ENV = buildEnv();

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 45_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

// ── Error types ───────────────────────────────────────────────────────────────

export class ThesmosNotFoundError extends Error {
  constructor(root: string) {
    super(
      `thesmos-governance not found in ${root}/node_modules/.bin/thesmos.\n` +
        `Run: npm install --save-dev thesmos-governance`,
    );
    this.name = 'ThesmosNotFoundError';
  }
}

export class ThesmosReportMissingError extends Error {
  constructor() {
    super(
      `.thesmos/report.json not found — run "Thesmos: Scan Repository" first.`,
    );
    this.name = 'ThesmosReportMissingError';
  }
}

export class ThesmosParseError extends Error {
  constructor(command: string, raw: string) {
    super(`Failed to parse JSON from 'thesmos ${command}':\n${raw.slice(0, 300)}`);
    this.name = 'ThesmosParseError';
  }
}

// ── Binary resolution ─────────────────────────────────────────────────────────

/**
 * Returns the path to the thesmos binary for a given workspace root.
 * Checks:
 *   1. User override (settings → thesmos.binaryPath)
 *   2. project-local node_modules/.bin/thesmos
 *
 * Throws ThesmosNotFoundError if neither is available.
 */
export function resolveBinary(workspaceRoot: string, override?: string): string {
  if (override && override.trim()) {
    if (existsSync(override.trim())) return override.trim();
    throw new ThesmosNotFoundError(workspaceRoot);
  }

  const local = join(workspaceRoot, 'node_modules', '.bin', 'thesmos');
  if (existsSync(local)) return local;

  throw new ThesmosNotFoundError(workspaceRoot);
}

/** Returns true if thesmos-governance is installed in the given workspace. */
export function isInstalled(workspaceRoot: string, override?: string): boolean {
  try {
    resolveBinary(workspaceRoot, override);
    return true;
  } catch {
    return false;
  }
}

/** Returns true if .thesmos/report.json exists. */
export function hasReport(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, '.thesmos', 'report.json'));
}

// ── CLI wrappers ──────────────────────────────────────────────────────────────

async function exec(
  bin: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await execFileAsync(bin, args, {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: RUNNER_ENV,
  });
  return stdout;
}

/**
 * Runs `thesmos review --json [files...]` and returns typed output.
 *
 * Passing no files runs scan-based checks only.
 * Passing one or more relative paths also runs content-based rule checks.
 */
export async function runReview(
  workspaceRoot: string,
  binaryOverride: string | undefined,
  relativeFiles: string[] = [],
): Promise<ReviewOutput> {
  const bin = resolveBinary(workspaceRoot, binaryOverride);
  const args = ['review', '--json', ...relativeFiles];

  let stdout: string;
  try {
    stdout = await exec(bin, args, workspaceRoot);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    // `thesmos review` exits 0. Any non-zero exit is a hard error.
    if (e.stderr?.includes('report.json not found')) {
      throw new ThesmosReportMissingError();
    }
    throw err;
  }

  try {
    return JSON.parse(stdout) as ReviewOutput;
  } catch {
    throw new ThesmosParseError('review', stdout);
  }
}

/**
 * Runs `thesmos health --json` and returns a typed HealthScore.
 */
export async function runHealth(
  workspaceRoot: string,
  binaryOverride: string | undefined,
): Promise<HealthScore> {
  const bin = resolveBinary(workspaceRoot, binaryOverride);

  let stdout: string;
  try {
    stdout = await exec(bin, ['health', '--json'], workspaceRoot);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.stderr?.includes('report.json not found')) {
      throw new ThesmosReportMissingError();
    }
    throw err;
  }

  try {
    return JSON.parse(stdout) as HealthScore;
  } catch {
    throw new ThesmosParseError('health', stdout);
  }
}

/**
 * Runs `thesmos scan` (no JSON output — writes report.json to disk).
 * Progress is communicated via the returned Promise.
 */
export async function runScan(
  workspaceRoot: string,
  binaryOverride: string | undefined,
): Promise<void> {
  const bin = resolveBinary(workspaceRoot, binaryOverride);
  await exec(bin, ['scan'], workspaceRoot);
}

/**
 * Runs `thesmos adapters` to regenerate all AI adapter files.
 */
export async function runAdapters(
  workspaceRoot: string,
  binaryOverride: string | undefined,
): Promise<void> {
  const bin = resolveBinary(workspaceRoot, binaryOverride);
  await exec(bin, ['adapters'], workspaceRoot);
}

/**
 * Runs `thesmos fix --apply [--rule=<category>]`.
 * Returns human-readable stdout showing what was changed.
 * A "no changes" result is a valid exit 0 — never throws for that case.
 */
export async function runFix(
  workspaceRoot: string,
  binaryOverride: string | undefined,
  ruleCategory?: string,
): Promise<string> {
  const bin = resolveBinary(workspaceRoot, binaryOverride);
  const args = ['fix', '--apply'];
  if (ruleCategory) args.push(`--rule=${ruleCategory}`);
  return exec(bin, args, workspaceRoot);
}

/**
 * Generic CLI runner for autopilot subcommands (revert, open-pr, etc.).
 * Resolves the binary from the workspace, passes arbitrary args.
 */
export async function runThesmos(
  workspaceRoot: string,
  args: string[],
  binaryOverride?: string,
): Promise<string> {
  const bin = resolveBinary(workspaceRoot, binaryOverride);
  return exec(bin, args, workspaceRoot);
}

export interface TokenReport {
  sessionCostUSD: number;
  todayCostUSD: number;
  projectCostUSD: number;
}

/**
 * Runs `thesmos tokens:report --json` and returns a parsed cost summary.
 * Returns null if token tracking has no data yet (first run, no events file).
 */
export async function runTokensReport(
  workspaceRoot: string,
  binaryOverride?: string,
): Promise<TokenReport | null> {
  const bin = resolveBinary(workspaceRoot, binaryOverride);
  try {
    const stdout = await exec(bin, ['tokens:report', '--json'], workspaceRoot);
    const data = JSON.parse(stdout) as {
      session?: { cost?: number };
      today?: { cost?: number };
      project?: { cost?: number };
    };
    return {
      sessionCostUSD: data.session?.cost ?? 0,
      todayCostUSD: data.today?.cost ?? 0,
      projectCostUSD: data.project?.cost ?? 0,
    };
  } catch {
    return null;
  }
}
