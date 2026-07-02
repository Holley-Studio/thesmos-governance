// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos CLI execution layer.
 *
 * Discovers the project-local binary (node_modules/.bin/thesmos), falls
 * back to a user-specified override, and exposes typed async wrappers for
 * every CLI command the extension needs.
 *
 * All I/O is isolated here — no vscode imports, fully unit-testable.
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Finding, HealthScore, ReviewOutput } from './types.js';

// VS Code launched from the Dock doesn't inherit nvm/volta PATH — extend it
// so node_modules/.bin scripts can resolve their `node` shebang.
function buildEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';

  // Dynamically scan all installed nvm versions so any patch version works
  const nvmVersionsDir = join(home, '.nvm', 'versions', 'node');
  let nvmPaths: string[] = [];
  try {
    nvmPaths = readdirSync(nvmVersionsDir).map(v => join(nvmVersionsDir, v, 'bin'));
  } catch { /* nvm not installed */ }

  const extra = [
    process.env.NVM_BIN ?? '',          // currently active nvm version (set in shells)
    ...nvmPaths,                         // all installed nvm versions
    join(home, '.volta', 'bin'),
    join(home, '.fnm', 'aliases', 'default', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(Boolean).join(sep);

  return { ...process.env, PATH: `${extra}${sep}${process.env.PATH ?? ''}`, FORCE_COLOR: '0' };
}

export const RUNNER_ENV = buildEnv();

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
  // 1. User override (settings → thesmos.binaryPath)
  if (override && override.trim()) {
    if (existsSync(override.trim())) return override.trim();
    throw new ThesmosNotFoundError(workspaceRoot);
  }

  // 2. Project-local node_modules/.bin/thesmos
  const local = join(workspaceRoot, 'node_modules', '.bin', 'thesmos');
  if (existsSync(local)) return local;

  // 3. Global PATH — catches `npm link`, volta global installs, homebrew, etc.
  //    Uses RUNNER_ENV so nvm-managed node bins are on PATH.
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const found = execFileSync(cmd, ['thesmos'], {
      encoding: 'utf8',
      env: RUNNER_ENV,
      timeout: 3000,
    }).trim().split('\n')[0].trim();
    if (found && existsSync(found)) return found;
  } catch {
    // not on PATH — continue to well-known paths
  }

  // 4. Well-known nvm / volta global bin locations (for VS Code launched from Dock)
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const candidates: string[] = [];
  const nvmVersionsDir = join(home, '.nvm', 'versions', 'node');
  try {
    for (const v of readdirSync(nvmVersionsDir)) {
      candidates.push(join(nvmVersionsDir, v, 'bin', 'thesmos'));
    }
  } catch { /* nvm not installed */ }
  candidates.push(
    join(home, '.volta', 'bin', 'thesmos'),
    join(home, '.fnm', 'aliases', 'default', 'bin', 'thesmos'),
  );
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new ThesmosNotFoundError(workspaceRoot);
}

/**
 * Resolves the absolute path to the thesmos JS entry point (dist/cli.js).
 * Used by the LSP client's NodeModule transport so spawn never depends on PATH.
 * Follows the node_modules/.bin/thesmos symlink to the real .js file, then
 * falls back to a direct package path lookup.
 */
export function resolveServerModule(workspaceRoot: string, override?: string): string {
  // Follow the symlink that resolveBinary returns → real .js path (no shebang lookup)
  try {
    const bin = resolveBinary(workspaceRoot, override);
    const real = realpathSync(bin);
    if (real.endsWith('.js')) return real;
  } catch { /* fall through */ }

  // Direct package path fallback
  const direct = join(workspaceRoot, 'node_modules', 'thesmos-governance', 'dist', 'cli.js');
  if (existsSync(direct)) return direct;

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
