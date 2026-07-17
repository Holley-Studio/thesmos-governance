// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Cross-platform Thesmos guard resolution.
 *
 * The Node entrypoint (`dist/thesmos-guard.js`) is the source of truth.
 * Shell wrappers (`.sh` / `.cmd`) only forward to that entry — no governance
 * logic lives in them. Application code should invoke Node directly via
 * {@link buildGuardInvocation} rather than routing through a shell wrapper.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform as osPlatform } from 'node:os';

export type GuardSubcommand = 'check' | 'budget-check' | 'drift';

export type GuardResolveFailureCategory =
  | 'entry_missing'
  | 'package_root_unresolved'
  | 'spawn_failed'
  | 'node_unavailable'
  | 'timeout'
  | 'internal';

export interface GuardResolveResult {
  /** Absolute path to the Node guard entry (dist/thesmos-guard.js). */
  entryPath: string;
  /** Package root that owns the entry (directory containing package.json / dist/). */
  packageRoot: string;
  platform: NodeJS.Platform;
  exists: boolean;
  /** Working directory at resolve time (diagnostics only — never secrets). */
  cwd: string;
}

export interface GuardInvocation {
  /** Absolute path to the node binary (process.execPath). */
  nodePath: string;
  entryPath: string;
  packageRoot: string;
  platform: NodeJS.Platform;
  /** Argument vector for spawn/execFile — never pass through a shell. */
  argv: string[];
  /**
   * Single command string suitable for Claude Code `hooks[].command`.
   * Uses quoted absolute paths; no shell metacharacters (`||`, `2>&1`, etc.).
   */
  command: string;
  exists: boolean;
  cwd: string;
}

/** Quote a single argument for Claude Code hook command strings (cross-platform). */
export function quoteHookArg(arg: string): string {
  // Always double-quote; escape embedded quotes. Works for cmd.exe and POSIX sh
  // when the whole token is one quoted path — no shell interpolation of $ or %.
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Resolve the thesmos-governance package root from a file URL (defaults to this module).
 * Works for packaged `dist/*.js` and source-tree `tsx` runs.
 */
export function resolvePackageRoot(fromUrl: string = import.meta.url): string {
  const here = dirname(fileURLToPath(fromUrl));

  // Packaged / built: .../thesmos-governance/dist
  if (
    existsSync(join(here, 'thesmos-guard.js')) ||
    existsSync(join(here, 'cli.js')) ||
    existsSync(join(here, 'index.js'))
  ) {
    return dirname(here);
  }

  // Source tree: .../thesmos (package root for this workspace package)
  if (existsSync(join(here, 'package.json')) && existsSync(join(here, 'dist'))) {
    return here;
  }
  if (existsSync(join(here, 'package.json')) && existsSync(join(here, 'tsup.config.ts'))) {
    return here;
  }

  // Walk up a few levels (e.g. thesmos/bin → thesmos)
  let dir = here;
  for (let i = 0; i < 4; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    if (
      existsSync(join(dir, 'package.json')) &&
      (existsSync(join(dir, 'dist', 'thesmos-guard.js')) ||
        existsSync(join(dir, 'tsup.config.ts')) ||
        existsSync(join(dir, 'dist', 'cli.js')))
    ) {
      return dir;
    }
  }

  // Last resort: treat the module directory's parent as package root
  return dirname(here);
}

/**
 * Resolve the cross-platform guard entry path.
 * Prefers `dist/thesmos-guard.js`. Does not invent success when the file is missing.
 */
export function resolveGuardEntry(options?: {
  packageRoot?: string;
  fromUrl?: string;
}): GuardResolveResult {
  const packageRoot = options?.packageRoot
    ? resolve(options.packageRoot)
    : resolvePackageRoot(options?.fromUrl ?? import.meta.url);
  const entryPath = join(packageRoot, 'dist', 'thesmos-guard.js');
  return {
    entryPath,
    packageRoot,
    platform: osPlatform() as NodeJS.Platform,
    exists: existsSync(entryPath),
    cwd: process.cwd(),
  };
}

/**
 * Build a Node-direct invocation for a guard subcommand.
 * Prefer this over shell wrappers whenever Thesmos controls execution.
 */
export function buildGuardInvocation(
  subcommand: GuardSubcommand,
  extraArgs: string[] = [],
  options?: { packageRoot?: string; fromUrl?: string },
): GuardInvocation {
  const resolved = resolveGuardEntry(options);
  const nodePath = process.execPath;
  const argv = [nodePath, resolved.entryPath, subcommand, ...extraArgs];
  const command = [
    quoteHookArg(nodePath),
    quoteHookArg(resolved.entryPath),
    subcommand,
    ...extraArgs.map(quoteHookArg),
  ].join(' ');

  return {
    nodePath,
    entryPath: resolved.entryPath,
    packageRoot: resolved.packageRoot,
    platform: resolved.platform,
    argv,
    command,
    exists: resolved.exists,
    cwd: resolved.cwd,
  };
}

/** Write a fail-closed diagnostic to stderr (no secrets / env dumps). */
export function writeFailClosedDiagnostic(input: {
  what: string;
  guardPath?: string;
  category: GuardResolveFailureCategory;
  hint?: string;
}): void {
  const lines = [
    '🛑 Thesmos guard blocked this operation (failClosed: true)',
    '',
    `  What failed:  ${input.what}`,
    `  Category:     ${input.category}`,
    `  Platform:     ${osPlatform()}`,
    `  CWD:          ${process.cwd()}`,
  ];
  if (input.guardPath) {
    lines.push(`  Guard path:   ${input.guardPath}`);
  }
  lines.push(
    '',
    '  Check:',
    '    1. `npm run build` (or reinstall thesmos-governance) so dist/thesmos-guard.js exists',
    '    2. Node.js ≥20 is on PATH (`node -v`)',
    '    3. `.thesmos/config.json` is valid JSON when present',
    '    4. Re-run `thesmos claude:govern install` to refresh hook commands',
  );
  if (input.hint) {
    lines.push(`    → ${input.hint}`);
  }
  lines.push(
    '',
    '  Execution was blocked because autoMode.failClosed is enabled (secure default).',
    '  To opt out explicitly (not recommended): set "autoMode": { "failClosed": false }.',
  );
  process.stderr.write(lines.join('\n') + '\n');
}

/**
 * True when a Claude Code hook command string refers to the Thesmos guard
 * (new Node entry, bin shim, or legacy `claude:govern` / npx forms).
 *
 * Also accepts exec-form hooks where `command` is `node` and `args` carries
 * the guard path + subcommand (plugin hooks.json / Windows-safe form).
 */
export function isThesmosGuardHookCommand(
  command: string | undefined,
  kind: GuardSubcommand,
  args?: string[] | undefined,
): boolean {
  if (args && args.length > 0) {
    const joined = [command ?? '', ...args].join(' ').replace(/\\/g, '/');
    if (kind === 'check') {
      return /thesmos-guard(?:\.js)?/.test(joined) && /\bcheck(?:\s|$)/.test(joined);
    }
    if (kind === 'budget-check') {
      return /thesmos-guard(?:\.js)?/.test(joined) && /\bbudget-check(?:\s|$)/.test(joined);
    }
    return /thesmos-guard(?:\.js)?/.test(joined) && /\bdrift(?:\s|$)/.test(joined);
  }

  if (!command) return false;
  const normalized = command.replace(/\\/g, '/');

  if (kind === 'check') {
    return (
      /thesmos-guard(?:\.js)?["']?\s+check(?:\s|$)/.test(normalized) ||
      /claude:govern\s+check(?:\s|$)/.test(command) ||
      /thesmos\s+claude:govern\s+check(?:\s|$)/.test(command)
    );
  }
  if (kind === 'budget-check') {
    return (
      /thesmos-guard(?:\.js)?["']?\s+budget-check(?:\s|$)/.test(normalized) ||
      /claude:govern\s+budget-check(?:\s|$)/.test(command) ||
      /thesmos\s+claude:govern\s+budget-check(?:\s|$)/.test(command)
    );
  }
  // drift — match without requiring the old `|| true` / `2>&1` suffix
  return (
    /thesmos-guard(?:\.js)?["']?\s+drift(?:\s|$)/.test(normalized) ||
    /(?:^|[\s"'])thesmos(?:-governance)?\s+drift(?:\s|$)/.test(command) ||
    /\bdrift\s+--quiet\b/.test(command)
  );
}
