// @vitest-environment node
/**
 * Cross-platform Thesmos guard tests — Node entry is source of truth.
 * Exercises real spawn of dist/thesmos-guard.js (build before CI on Windows).
 */
import { describe, it, expect, beforeAll } from 'vitest';
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

function runGuard(
  args: string[],
  opts: { cwd?: string; stdin?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [GUARD_ENTRY, ...args], {
    cwd: opts.cwd ?? PACKAGE_ROOT,
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
        file_path: '/proj/src/SearchBar.tsx',
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
        file_path: '/proj/src/pay.ts',
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
        file_path: '/proj/src/ok.ts',
        content: 'export const ok = true;\n',
      },
    });
    const direct = runGuard(['check'], { stdin });
    const wrapped = spawnSync(sh, ['check'], {
      encoding: 'utf8',
      input: stdin,
      timeout: 60_000,
    });
    expect(wrapped.status).toBe(direct.status);
  });

  it('Windows .cmd wrapper matches direct Node exit code (Windows)', () => {
    if (!IS_WIN) return;
    const cmd = join(PACKAGE_ROOT, 'bin', 'thesmos-guard.cmd');
    expect(existsSync(cmd)).toBe(true);
    const stdin = JSON.stringify({
      tool_name: 'Write',
      tool_input: {
        file_path: '/proj/src/ok.ts',
        content: 'export const ok = true;\n',
      },
    });
    const direct = runGuard(['check'], { stdin });
    const wrapped = spawnSync(cmd, ['check'], {
      encoding: 'utf8',
      input: stdin,
      timeout: 60_000,
      shell: true,
      windowsHide: true,
    });
    expect(wrapped.status).toBe(direct.status);
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
      tool_input: { file_path: '/x.ts', new_string: 'const a = 1;\n' },
    });
    const result = spawnSync(process.execPath, [entry, 'check'], {
      encoding: 'utf8',
      input: stdin,
      timeout: 60_000,
      windowsHide: true,
    });
    expect(result.status).toBe(0);
    rmSync(base, { recursive: true, force: true });
  });
});
