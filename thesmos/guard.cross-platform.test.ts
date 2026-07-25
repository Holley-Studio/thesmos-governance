// @vitest-environment node
/**
 * Cross-platform Thesmos guard tests — Node entry is source of truth.
 * Exercises real spawn of dist/thesmos-guard.js (build before CI on Windows).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  rmSync,
  copyFileSync,
  cpSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import {
  buildGuardInvocation,
  quoteHookArg,
  resolveGuardEntry,
  resolvePackageRoot,
  isThesmosGuardHookCommand,
} from './guard-resolve.js';
import {
  governanceHookCommands,
  installGovernanceHooks,
  getGovernanceHooksStatus,
  mergeGovernanceHooks,
  isFailClosed,
} from './claude-govern.js';
import { CONFIG_DEFAULTS } from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = HERE;
const GUARD_ENTRY = join(PACKAGE_ROOT, 'dist', 'thesmos-guard.js');
const IS_WIN = platform() === 'win32';

/**
 * Hermetic consumer repo for every test that spawns the real guard and
 * asserts on CONTENT-scanning behavior (secret detection, benign
 * pass-through).
 *
 * Why this exists: the guard resolves its config by walking up from `cwd`.
 * Running it with `cwd` inside this repository made it pick up THIS repo's
 * own `.thesmos/scope.json` — an intentionally restrictive dogfooding
 * allowlist — so synthetic fixture paths like `/proj/src/pay.ts` were
 * rejected as *scope* violations before the content scan under test ever
 * ran. That is a real test-isolation defect, not an environmental quirk:
 * the assertions were silently exercising the wrong code path.
 *
 * The fixture below is an isolated temp directory with an explicit,
 * self-contained `.thesmos/` config: no allowedPaths restriction (so path
 * scoping never preempts the content scan) and no destructive-command
 * patterns (irrelevant to Write/Edit content tests). Assertions are
 * unchanged — only the environment they run in is now controlled.
 */
let CONSUMER_ROOT = '';

function makeConsumerRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'thesmos-guard-consumer-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  writeFileSync(
    join(root, '.thesmos', 'config.json'),
    JSON.stringify({ name: 'guard-fixture', version: '1.0.0', project: 'guard-fixture' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(root, '.thesmos', 'scope.json'),
    JSON.stringify(
      {
        version: '1.0',
        workspace: {
          // Empty allowedPaths = no path restriction, so these tests
          // exercise CONTENT scanning rather than path scoping.
          allowedPaths: [],
          blockedPaths: [],
          absoluteBlockPaths: [],
        },
        operations: {
          allowDelete: true,
          allowGitPush: true,
          allowNetworkHosts: [],
          allowDatabaseWrites: true,
          requireConfirmation: [],
        },
        destructivePatterns: [],
      },
      null,
      2,
    ),
    'utf8',
  );
  return root;
}

function runGuard(
  args: string[],
  opts: { cwd?: string; stdin?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [GUARD_ENTRY, ...args], {
    // Default to the hermetic consumer repo, never this repository — see
    // makeConsumerRepo's comment. Tests that need a specific project
    // fixture still pass an explicit cwd.
    cwd: opts.cwd ?? CONSUMER_ROOT,
    input: opts.stdin ?? '',
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    timeout: 60_000,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

beforeAll(() => {
  if (!existsSync(GUARD_ENTRY)) {
    throw new Error(
      `Missing ${GUARD_ENTRY}. Run \`npm run build\` in thesmos/ before these tests.`,
    );
  }
  CONSUMER_ROOT = makeConsumerRepo();
});

afterAll(() => {
  if (CONSUMER_ROOT) rmSync(CONSUMER_ROOT, { recursive: true, force: true });
});

describe('guard-resolve', () => {
  it('resolves package root and packaged entry path', () => {
    const root = resolvePackageRoot(import.meta.url);
    expect(existsSync(join(root, 'package.json'))).toBe(true);
    const resolved = resolveGuardEntry({ packageRoot: root });
    expect(resolved.entryPath).toBe(join(root, 'dist', 'thesmos-guard.js'));
    expect(resolved.exists).toBe(true);
    expect(resolved.cwd).toBeTruthy();
  });

  it('buildGuardInvocation uses process.execPath and no shell metacharacters', () => {
    const inv = buildGuardInvocation('check');
    expect(inv.nodePath).toBe(process.execPath);
    expect(inv.argv[0]).toBe(process.execPath);
    expect(inv.argv[1]).toContain('thesmos-guard.js');
    expect(inv.argv[2]).toBe('check');
    expect(inv.command).not.toMatch(/\|\|/);
    expect(inv.command).not.toMatch(/2>&1/);
    expect(inv.command).toContain(quoteHookArg(process.execPath));
  });

  it('isThesmosGuardHookCommand matches Node-direct, legacy npx, and exec-form args', () => {
    expect(isThesmosGuardHookCommand('node "/x/thesmos-guard.js" check', 'check')).toBe(true);
    expect(
      isThesmosGuardHookCommand('npx --no-install thesmos claude:govern check', 'check'),
    ).toBe(true);
    expect(
      isThesmosGuardHookCommand('npx thesmos-governance drift --quiet 2>&1 || true', 'drift'),
    ).toBe(true);
    expect(
      isThesmosGuardHookCommand('node', 'check', ['thesmos/dist/thesmos-guard.js', 'check']),
    ).toBe(true);
    expect(isThesmosGuardHookCommand('echo hello', 'check')).toBe(false);
  });
});

describe('failClosed defaults', () => {
  it('defaults to true and honors explicit false', () => {
    expect(isFailClosed(CONFIG_DEFAULTS)).toBe(true);
    expect(isFailClosed({ ...CONFIG_DEFAULTS, autoMode: { failClosed: false } })).toBe(false);
  });
});

describe('install wiring — Node-direct hooks', () => {
  it('writes Node-direct commands without Unix-only || true', () => {
    const cmds = governanceHookCommands();
    expect(cmds.check).toMatch(/thesmos-guard\.js/);
    expect(cmds.check).toContain('check');
    expect(cmds.drift).not.toMatch(/\|\|/);
    expect(cmds.drift).not.toMatch(/2>&1/);
    expect(cmds.drift).toContain('--quiet');
  });

  it('install + status round-trip in a temp project', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'thesmos-guard-install-'));
    try {
      mkdirSync(join(tmp, '.claude'), { recursive: true });
      installGovernanceHooks(tmp);
      const status = getGovernanceHooksStatus(tmp);
      expect(status.preToolUseWrite).toBe(true);
      expect(status.preToolUseEdit).toBe(true);
      expect(status.preToolUseBash).toBe(true);
      expect(status.postToolUseBudget).toBe(true);
      expect(status.stopDrift).toBe(true);
      expect(status.installed).toBe(true);

      const settings = JSON.parse(
        readFileSync(join(tmp, '.claude', 'settings.json'), 'utf8'),
      ) as { hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>> };
      const driftCmd = settings.hooks['Stop']?.[0]?.hooks?.[0]?.command ?? '';
      expect(driftCmd).not.toMatch(/\|\|/);
      expect(driftCmd).toMatch(/thesmos-guard\.js/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('merge refreshes legacy npx drift command to Node-direct', () => {
    const merged = mergeGovernanceHooks({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: 'npx --no-install thesmos drift --quiet 2>&1 || true',
              },
            ],
          },
        ],
      },
    });
    const stop = (merged['hooks'] as { Stop: Array<{ hooks: Array<{ command: string }> }> })
      .Stop[0]!.hooks[0]!.command;
    expect(stop).toMatch(/thesmos-guard\.js/);
    expect(stop).not.toMatch(/\|\|/);
  });
});

describe('thesmos-guard.js — real execution', () => {
  it('allows benign Write content (exit 0)', () => {
    const stdin = JSON.stringify({
      tool_name: 'Write',
      tool_input: {
        file_path: join(CONSUMER_ROOT, 'src', 'SearchBar.tsx'),
        content: '<input placeholder="Search" aria-label="Search" />',
      },
    });
    const result = runGuard(['check'], { stdin });
    expect(result.status).toBe(0);
  });

  it('blocks BLOCKER secret content (exit 2)', () => {
    const secret = `const stripeKey = "${['sk', 'live', 'FAKE'.repeat(6)].join('_')}";`;
    const stdin = JSON.stringify({
      tool_name: 'Write',
      tool_input: {
        file_path: join(CONSUMER_ROOT, 'src', 'pay.ts'),
        content: secret,
      },
    });
    const result = runGuard(['check'], { stdin });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/blocked/i);
  });

  it('blocks malformed stdin JSON when failClosed is default (exit 2)', () => {
    const result = runGuard(['check'], { stdin: '{not-json' });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/failClosed/i);
  });

  it('blocks malformed config when failClosed is default (exit 2)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'thesmos-guard-badcfg-'));
    try {
      mkdirSync(join(tmp, '.thesmos'), { recursive: true });
      writeFileSync(join(tmp, '.thesmos', 'config.json'), '{broken', 'utf8');
      const stdin = JSON.stringify({
        tool_name: 'Write',
        tool_input: {
          file_path: join(tmp, 'src', 'a.ts'),
          content: 'export const x = 1;\n',
        },
      });
      const result = runGuard(['check'], { cwd: tmp, stdin });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/failClosed|Config/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('failClosed: false restores allow-on-error for malformed stdin', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'thesmos-guard-open-'));
    try {
      mkdirSync(join(tmp, '.thesmos'), { recursive: true });
      writeFileSync(
        join(tmp, '.thesmos', 'config.json'),
        JSON.stringify({ autoMode: { failClosed: false } }, null, 2),
        'utf8',
      );
      const result = runGuard(['check'], { cwd: tmp, stdin: '{not-json' });
      expect(result.status).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('works with spaces in the working directory path', () => {
    const base = mkdtempSync(join(tmpdir(), 'thesmos guard spaces '));
    const tmp = join(base, 'project with spaces');
    mkdirSync(tmp, { recursive: true });
    mkdirSync(join(tmp, '.thesmos'), { recursive: true });
    writeFileSync(
      join(tmp, '.thesmos', 'config.json'),
      JSON.stringify({ project: 'space-test' }, null, 2),
      'utf8',
    );
    try {
      const stdin = JSON.stringify({
        tool_name: 'Write',
        tool_input: {
          file_path: join(tmp, 'ok.ts'),
          content: 'export const ok = true;\n',
        },
      });
      const result = runGuard(['check'], { cwd: tmp, stdin });
      expect(result.status).toBe(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('simulated missing entry → blocked when failClosed (resolver exists flag)', () => {
    const missing = resolveGuardEntry({ packageRoot: join(tmpdir(), 'no-such-thesmos-pkg') });
    expect(missing.exists).toBe(false);
    // Install path uses absolute entry; spawn of missing file should be nonzero
    const result = spawnSync(process.execPath, [missing.entryPath, 'check'], {
      encoding: 'utf8',
      input: '{}',
      timeout: 10_000,
      windowsHide: true,
    });
    expect(result.status).not.toBe(0);
  });
});

describe('wrapper parity', () => {
  it('POSIX .sh wrapper matches direct Node exit code (non-Windows)', () => {
    if (IS_WIN) return;
    const sh = join(PACKAGE_ROOT, 'bin', 'thesmos-guard.sh');
    expect(existsSync(sh)).toBe(true);
    try {
      chmodSync(sh, 0o755);
    } catch {
      // ignore
    }
    const stdin = JSON.stringify({
      tool_name: 'Write',
      tool_input: {
        file_path: join(CONSUMER_ROOT, 'src', 'ok.ts'),
        content: 'export const ok = true;\n',
      },
    });
    const direct = runGuard(['check'], { stdin });
    const wrapped = spawnSync(sh, ['check'], {
      // Both sides must resolve config from the SAME hermetic root — this
      // is a parity assertion, so any cwd difference would compare two
      // different configurations rather than two invocation paths.
      cwd: CONSUMER_ROOT,
      encoding: 'utf8',
      input: stdin,
      timeout: 60_000,
    });
    expect(wrapped.status).toBe(direct.status);
    expect(direct.status).toBe(0); // and the shared baseline is a real allow, not a shared failure
  });

  it('Windows .cmd wrapper matches direct Node exit code (Windows)', () => {
    if (!IS_WIN) return;
    const cmd = join(PACKAGE_ROOT, 'bin', 'thesmos-guard.cmd');
    expect(existsSync(cmd)).toBe(true);
    const stdin = JSON.stringify({
      tool_name: 'Write',
      tool_input: {
        file_path: join(CONSUMER_ROOT, 'src', 'ok.ts'),
        content: 'export const ok = true;\n',
      },
    });
    const direct = runGuard(['check'], { stdin });
    const wrapped = spawnSync(cmd, ['check'], {
      // Same hermetic root on both sides — see the POSIX parity test above.
      cwd: CONSUMER_ROOT,
      encoding: 'utf8',
      input: stdin,
      timeout: 60_000,
      shell: true,
      windowsHide: true,
    });
    expect(wrapped.status).toBe(direct.status);
    expect(direct.status).toBe(0);
  });

  it('copies guard into a path with spaces and still runs', () => {
    const base = mkdtempSync(join(tmpdir(), 'guard bin '));
    const spacedDist = join(base, 'pkg with spaces', 'dist');
    mkdirSync(spacedDist, { recursive: true });
    copyFileSync(GUARD_ENTRY, join(spacedDist, 'thesmos-guard.js'));
    // Bundle may import sibling chunks — copy whole dist if needed
    if (existsSync(join(PACKAGE_ROOT, 'dist', 'presets'))) {
      cpSync(join(PACKAGE_ROOT, 'dist', 'presets'), join(spacedDist, 'presets'), {
        recursive: true,
      });
    }
    const entry = join(spacedDist, 'thesmos-guard.js');
    const stdin = JSON.stringify({
      tool_name: 'Edit',
      tool_input: {
        file_path: join(CONSUMER_ROOT, 'x.ts'),
        new_string: 'const a = 1;\n',
      },
    });
    const result = spawnSync(process.execPath, [entry, 'check'], {
      // Hermetic: resolve config from the fixture consumer repo, not from
      // whatever directory the test runner happened to start in (which,
      // inside this repo, is governed by its own restrictive scope.json).
      cwd: CONSUMER_ROOT,
      encoding: 'utf8',
      input: stdin,
      timeout: 60_000,
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    rmSync(base, { recursive: true, force: true });
  });
});

// ── Windows interpreter semantics — executed on the real platform ───────────
//
// The pure-analysis assertions live in shell-command.test.ts and run
// everywhere. This block additionally drives the REAL built guard through
// the same Windows interpreter forms, so the Guard (Windows) CI job
// exercises them on an actual windows-latest runner rather than relying on
// a process.platform mock. The assertions themselves are platform-neutral
// (the analyzer is deterministic on every OS) — the value is that on
// Windows CI they run against genuinely native path/quoting handling.

describe('Windows interpreter forms through the real guard', () => {
  function bashDecision(command: string): { status: number | null; stdout: string; stderr: string } {
    return runGuard(['check'], {
      cwd: WINDOWS_FIXTURE_ROOT,
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    });
  }

  let WINDOWS_FIXTURE_ROOT = '';

  beforeAll(() => {
    WINDOWS_FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'thesmos-guard-wininterp-'));
    mkdirSync(join(WINDOWS_FIXTURE_ROOT, '.thesmos'), { recursive: true });
    writeFileSync(
      join(WINDOWS_FIXTURE_ROOT, '.thesmos', 'scope.json'),
      JSON.stringify({
        version: '1.0',
        workspace: { allowedPaths: [], blockedPaths: [], absoluteBlockPaths: [] },
        operations: {
          allowDelete: true,
          // git push is DISALLOWED here — that's the signal these fixtures assert on.
          allowGitPush: false,
          allowNetworkHosts: [],
          allowDatabaseWrites: true,
          requireConfirmation: [],
        },
        destructivePatterns: [],
      }),
      'utf8',
    );
  });

  afterAll(() => {
    if (WINDOWS_FIXTURE_ROOT) rmSync(WINDOWS_FIXTURE_ROOT, { recursive: true, force: true });
  });

  it('cmd /c with an UNQUOTED git push payload is blocked (exit 2)', () => {
    const result = bashDecision('cmd /c git push origin main');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/git push/i);
  });

  it('cmd.exe /C with a QUOTED git push payload is blocked identically', () => {
    const result = bashDecision('cmd.exe /C "git push origin main"');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/git push/i);
  });

  it('powershell -Command with an UNQUOTED git push payload is blocked', () => {
    const result = bashDecision('powershell -Command git push origin main');
    expect(result.status).toBe(2);
  });

  it('powershell.exe -Command with a QUOTED git push payload is blocked', () => {
    const result = bashDecision('powershell.exe -Command "git push origin main"');
    expect(result.status).toBe(2);
  });

  it('pwsh -Command with an unquoted payload is blocked', () => {
    const result = bashDecision('pwsh -Command git push origin main');
    expect(result.status).toBe(2);
  });

  it('a benign cmd /c payload is allowed (exit 0) — no over-blocking', () => {
    const result = bashDecision('cmd /c dir');
    expect(result.status).toBe(0);
  });

  it('CRLF heredoc body stays inert through the real guard', () => {
    const result = bashDecision('cat <<EOF\r\ngit push origin main\r\nEOF\r\n');
    expect(result.status).toBe(0);
  });

  it('CRLF heredoc with a chained git push on the header line is still blocked', () => {
    const result = bashDecision('cat <<EOF; git push origin main\r\nbody\r\nEOF\r\n');
    expect(result.status).toBe(2);
  });

  it('ambiguous $() syntax surfaces as an ask (exit 0 + ask JSON), not a block', () => {
    const result = bashDecision('echo $(date)');
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe('ask');
  });
});
