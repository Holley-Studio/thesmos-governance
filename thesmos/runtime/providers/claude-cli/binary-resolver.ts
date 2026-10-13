// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Claude CLI binary resolution — Windows and POSIX.
 *
 * A fresh implementation rather than an import of
 * `extensions/vscode/src/chat/binaryResolver.ts`: that module lives in the VS
 * Code extension, which depends on `thesmos/runtime`, never the reverse (see
 * docs/runtime-providers.md). The POSIX path below mirrors its logic; the
 * Windows path is new, since the extension's resolver has never run there.
 *
 * Fully injectable so this can be unit-tested without touching a real
 * filesystem, a real PATH, or a real Windows machine.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix as posixPath, win32 as win32Path } from 'node:path';

export interface ResolveClaudeBinaryOptions {
  existsSyncImpl?: (path: string) => boolean;
  execFileSyncImpl?: typeof execFileSync;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

const cache = new Map<string, string>();

/**
 * Resolve an absolute path to the `claude` binary, falling back to the bare
 * name when nothing was found — matching the VS Code resolver's contract, so
 * `spawn('claude', ...)` still works if it happens to be on the OS's own
 * subprocess search path even though nothing here could locate it.
 *
 * Only cached when called with no overrides — an injected option set is
 * always a test, and tests must never see a previous test's cached result.
 */
export function resolveClaudeBinary(opts: ResolveClaudeBinaryOptions = {}): string {
  const useCache = Object.keys(opts).length === 0;
  if (useCache) {
    const cached = cache.get('claude');
    if (cached) return cached;
  }

  const existsSyncImpl = opts.existsSyncImpl ?? existsSync;
  const execFileSyncImpl = opts.execFileSyncImpl ?? execFileSync;
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.homeDir ?? homedir();

  const resolved =
    platform === 'win32'
      ? resolveWindows(existsSyncImpl, execFileSyncImpl, env)
      : resolvePosix(existsSyncImpl, execFileSyncImpl, env, home);

  if (useCache) cache.set('claude', resolved);
  return resolved;
}

function resolvePosix(
  existsSyncImpl: (path: string) => boolean,
  execFileSyncImpl: typeof execFileSync,
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  const name = 'claude';

  for (const dir of (env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const candidate = posixPath.join(dir, name);
    if (existsSyncImpl(candidate)) return candidate;
  }

  const candidates = [
    posixPath.join(home, '.local', 'bin', name),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    posixPath.join(home, '.claude', 'local', 'claude'),
  ];
  for (const candidate of candidates) {
    if (existsSyncImpl(candidate)) return candidate;
  }

  try {
    const shell = env.SHELL || '/bin/zsh';
    const found = execFileSyncImpl(shell, ['-lc', `command -v ${name}`], {
      encoding: 'utf8',
      timeout: 5000,
    })
      .trim()
      .split('\n')[0];
    if (found) return found;
  } catch {
    // Shell lookup failed — fall through to the bare name.
  }

  return name;
}

/** `.exe`/`.cmd`/`.bat` first, since that's what a real install actually ships. */
const PREFERRED_EXTENSIONS = ['.exe', '.cmd', '.bat'];

/** True for a batch shim, which Node refuses to spawn without a shell. */
export function isBatchShim(binaryPath: string): boolean {
  const lower = binaryPath.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat');
}

/**
 * Upgrade an npm `.cmd` shim to the native executable it wraps.
 *
 * This matters more than it looks. Node refuses to spawn a `.cmd`/`.bat`
 * without `shell: true` (the CVE-2024-27980 mitigation) — it throws
 * `EINVAL` — and going through `shell: true` would then run our arguments
 * through `cmd.exe`'s tokenizer, which Node does not escape for us. The npm
 * shim is only a two-line wrapper around a real `claude.exe`, so resolving
 * to that directly sidesteps both problems: a native binary spawns with no
 * shell and no tokenizer between us and it.
 *
 * Returns the shim unchanged when no native peer is found, so an install
 * shape that genuinely ships only a batch file still resolves (the spawn
 * side falls back to `shell: true` for that case).
 */
function preferNativeExe(shimPath: string, existsSyncImpl: (path: string) => boolean): string {
  if (!isBatchShim(shimPath)) return shimPath;
  const native = win32Path.join(
    win32Path.dirname(shimPath),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe',
  );
  return existsSyncImpl(native) ? native : shimPath;
}

function resolveWindows(
  existsSyncImpl: (path: string) => boolean,
  execFileSyncImpl: typeof execFileSync,
  env: NodeJS.ProcessEnv,
): string {
  const name = 'claude';
  // Lowercased throughout: Windows path lookups are case-insensitive, and a
  // consistent case keeps candidate paths matching real install conventions
  // (npm's shim is `claude.cmd`, not `claude.CMD`).
  const declaredExtensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  const orderedExtensions = [
    ...PREFERRED_EXTENSIONS.filter((ext) => declaredExtensions.includes(ext)),
    ...declaredExtensions.filter((ext) => !PREFERRED_EXTENSIONS.includes(ext)),
  ];

  for (const dir of (env.PATH ?? '').split(';')) {
    if (!dir) continue;
    for (const ext of orderedExtensions) {
      const candidate = win32Path.join(dir, `${name}${ext}`);
      if (existsSyncImpl(candidate)) return preferNativeExe(candidate, existsSyncImpl);
    }
  }

  // Best-guess npm-global fallback — the shim location a plain
  // `npm install -g` lands on. nvm-windows/volta/scoop installs diverge from
  // this and are not covered; verify against a real install before relying on it.
  if (env.APPDATA) {
    const npmGlobal = win32Path.join(env.APPDATA, 'npm', `${name}.cmd`);
    if (existsSyncImpl(npmGlobal)) return preferNativeExe(npmGlobal, existsSyncImpl);
  }

  // Last resort — the Windows analog of POSIX `command -v`. where.exe lives in
  // System32, so it is reliably on PATH even when claude itself is not.
  // `where` prints every match; skip the extensionless shim npm also installs
  // for POSIX shells, which Windows cannot execute directly.
  try {
    const matches = execFileSyncImpl('where', [name], { encoding: 'utf8', timeout: 5000 })
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const executable = matches.find((m) => /\.(exe|cmd|bat)$/i.test(m));
    if (executable) return preferNativeExe(executable, existsSyncImpl);
  } catch {
    // `where` found nothing — fall through to the bare name.
  }

  return name;
}
