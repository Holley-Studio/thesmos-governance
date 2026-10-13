// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Binary resolver tests.
 *
 * Every filesystem/shell touchpoint is injected, so this suite runs
 * identically regardless of the host OS and never touches a real PATH.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveClaudeBinary } from './binary-resolver.js';

describe('resolveClaudeBinary — POSIX', () => {
  it('finds claude on PATH', () => {
    const existsSyncImpl = vi.fn((p: string) => p === '/opt/bin/claude');
    const resolved = resolveClaudeBinary({
      platform: 'linux',
      existsSyncImpl,
      env: { PATH: '/usr/bin:/opt/bin' },
      homeDir: '/home/matthew',
    });
    expect(resolved).toBe('/opt/bin/claude');
  });

  it('falls back to ~/.local/bin, /usr/local/bin, then /opt/homebrew/bin', () => {
    const existsSyncImpl = vi.fn((p: string) => p === '/usr/local/bin/claude');
    const resolved = resolveClaudeBinary({
      platform: 'darwin',
      existsSyncImpl,
      env: { PATH: '/usr/bin' },
      homeDir: '/Users/matthew',
    });
    expect(resolved).toBe('/usr/local/bin/claude');
  });

  it('falls back to a login-shell `command -v` lookup', () => {
    const existsSyncImpl = vi.fn(() => false);
    const execFileSyncImpl = vi.fn(() => '/custom/claude\n') as unknown as typeof import('node:child_process').execFileSync;
    const resolved = resolveClaudeBinary({
      platform: 'linux',
      existsSyncImpl,
      execFileSyncImpl,
      env: { PATH: '', SHELL: '/bin/zsh' },
      homeDir: '/home/matthew',
    });
    expect(resolved).toBe('/custom/claude');
    expect(execFileSyncImpl).toHaveBeenCalledWith('/bin/zsh', ['-lc', 'command -v claude'], expect.anything());
  });

  it('returns the bare name when nothing resolves anywhere', () => {
    const existsSyncImpl = vi.fn(() => false);
    const execFileSyncImpl = vi.fn(() => {
      throw new Error('not found');
    }) as unknown as typeof import('node:child_process').execFileSync;
    const resolved = resolveClaudeBinary({
      platform: 'linux',
      existsSyncImpl,
      execFileSyncImpl,
      env: { PATH: '' },
      homeDir: '/home/matthew',
    });
    expect(resolved).toBe('claude');
  });
});

describe('resolveClaudeBinary — Windows', () => {
  it('prefers claude.exe over claude.cmd on the same PATH entry', () => {
    const existsSyncImpl = vi.fn(
      (p: string) => p === 'C:\\tools\\claude.exe' || p === 'C:\\tools\\claude.cmd',
    );
    const resolved = resolveClaudeBinary({
      platform: 'win32',
      existsSyncImpl,
      env: { PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    });
    expect(resolved).toBe('C:\\tools\\claude.exe');
  });

  it('finds claude.cmd when only the npm shim exists', () => {
    const existsSyncImpl = vi.fn((p: string) => p === 'C:\\Users\\matthew\\AppData\\Roaming\\npm\\claude.cmd');
    const resolved = resolveClaudeBinary({
      platform: 'win32',
      existsSyncImpl,
      env: {
        PATH: 'C:\\Windows\\System32',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        APPDATA: 'C:\\Users\\matthew\\AppData\\Roaming',
      },
    });
    expect(resolved).toBe('C:\\Users\\matthew\\AppData\\Roaming\\npm\\claude.cmd');
  });

  /**
   * Regression: Node throws EINVAL rather than spawning a `.cmd`, so
   * resolving to npm's shim instead of the real binary it wraps made the
   * whole provider dead on Windows. Verified against a live
   * `npm install -g @anthropic-ai/claude-code`.
   */
  it('upgrades an npm .cmd shim to the native claude.exe it wraps', () => {
    const npmDir = 'C:\\Users\\matthew\\AppData\\Roaming\\npm';
    const native = `${npmDir}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    const existsSyncImpl = vi.fn((p: string) => p === `${npmDir}\\claude.cmd` || p === native);
    const resolved = resolveClaudeBinary({
      platform: 'win32',
      existsSyncImpl,
      env: { PATH: npmDir, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    });
    expect(resolved).toBe(native);
  });

  it('keeps the shim when no native peer is installed alongside it', () => {
    const dir = 'C:\\scoop\\shims';
    const existsSyncImpl = vi.fn((p: string) => p === `${dir}\\claude.cmd`);
    const resolved = resolveClaudeBinary({
      platform: 'win32',
      existsSyncImpl,
      env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    });
    expect(resolved).toBe(`${dir}\\claude.cmd`);
  });

  it('falls back to `where claude` as a last resort', () => {
    const existsSyncImpl = vi.fn(() => false);
    const execFileSyncImpl = vi.fn(() => 'C:\\custom\\claude.exe\r\n') as unknown as typeof import('node:child_process').execFileSync;
    const resolved = resolveClaudeBinary({
      platform: 'win32',
      existsSyncImpl,
      execFileSyncImpl,
      env: { PATH: 'C:\\Windows\\System32', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    });
    expect(resolved).toBe('C:\\custom\\claude.exe');
    expect(execFileSyncImpl).toHaveBeenCalledWith('where', ['claude'], expect.anything());
  });

  /**
   * npm installs an extensionless POSIX shim next to the `.cmd`, and `where`
   * lists it first. Windows cannot execute it directly, so it must be skipped.
   */
  it('skips the extensionless POSIX shim that `where` also reports', () => {
    const existsSyncImpl = vi.fn(() => false);
    const execFileSyncImpl = vi.fn(
      () => 'C:\\Users\\matthew\\AppData\\Roaming\\npm\\claude\r\nC:\\Users\\matthew\\AppData\\Roaming\\npm\\claude.cmd\r\n',
    ) as unknown as typeof import('node:child_process').execFileSync;
    const resolved = resolveClaudeBinary({
      platform: 'win32',
      existsSyncImpl,
      execFileSyncImpl,
      env: { PATH: 'C:\\Windows\\System32', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    });
    expect(resolved).toBe('C:\\Users\\matthew\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it('returns the bare name when nothing resolves anywhere', () => {
    const existsSyncImpl = vi.fn(() => false);
    const execFileSyncImpl = vi.fn(() => {
      throw new Error('INFO: could not find files');
    }) as unknown as typeof import('node:child_process').execFileSync;
    const resolved = resolveClaudeBinary({
      platform: 'win32',
      existsSyncImpl,
      execFileSyncImpl,
      env: { PATH: 'C:\\Windows\\System32', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    });
    expect(resolved).toBe('claude');
  });
});

describe('resolveClaudeBinary — caching', () => {
  it('does not cache when called with explicit options, so tests never bleed state', () => {
    const first = resolveClaudeBinary({
      platform: 'linux',
      existsSyncImpl: () => true,
      env: { PATH: '/a' },
      homeDir: '/home/x',
    });
    const second = resolveClaudeBinary({
      platform: 'linux',
      existsSyncImpl: () => false,
      execFileSyncImpl: (() => {
        throw new Error('nope');
      }) as unknown as typeof import('node:child_process').execFileSync,
      env: { PATH: '' },
      homeDir: '/home/x',
    });
    expect(first).not.toBe(second);
    expect(second).toBe('claude');
  });
});
