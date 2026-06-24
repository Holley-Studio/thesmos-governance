// @vitest-environment node
/**
 * Tests for pack:publish command.
 *
 * Strategy:
 * - Create temp directories to simulate real pack structures on disk.
 * - Spy on process.exit and process.stderr/stdout to capture behavior.
 * - Mock child_process.spawnSync to control tsup and npm calls.
 * - Import the pure helper functions (compilePackRules, runNpmPublish) to test
 *   them in isolation, and call cmdPackPublish directly with controlled argv.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal valid pack.json content */
function makePackJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      schemaVersion: '1',
      id: '@test/my-pack',
      name: 'My Pack',
      version: '1.2.3',
      description: 'A test pack.',
      author: 'Test Author',
      tags: ['test'],
      provides: { rules: true, agents: false, skills: false, playbooks: false, profiles: false },
      ...overrides,
    },
    null,
    2,
  );
}

/**
 * Create a temp directory tree that looks like a project root with one local pack.
 *
 * Returns:
 *   root        — project root (.thesmos/packs/<packDirName>/ is inside)
 *   packDir     — absolute path to the pack directory
 *   cleanup()   — removes the temp tree
 */
function makeTempPack(opts: {
  packDirName?: string;
  packJson?: string;
  hasTsSrc?: boolean;
  hasJsOut?: boolean;
  hasPackageJson?: boolean;
  hasRulesDir?: boolean;
} = {}): { root: string; packDir: string; cleanup: () => void } {
  const {
    packDirName = 'my-pack',
    packJson = makePackJson(),
    hasTsSrc = false,
    hasJsOut = false,
    hasPackageJson = true,
    hasRulesDir = true,
  } = opts;

  const root = mkdtempSync(join(tmpdir(), 'prom-pub-test-'));
  const packsDir = join(root, '.thesmos', 'packs');
  const packDir = join(packsDir, packDirName);

  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, 'pack.json'), packJson, 'utf8');

  if (hasRulesDir) mkdirSync(join(packDir, 'rules'), { recursive: true });
  if (hasTsSrc) writeFileSync(join(packDir, 'rules', 'index.ts'), '// stub', 'utf8');
  if (hasJsOut) writeFileSync(join(packDir, 'rules', 'index.js'), '// compiled', 'utf8');
  if (hasPackageJson) {
    writeFileSync(
      join(packDir, 'package.json'),
      JSON.stringify({ name: '@test/my-pack', version: '1.2.3' }),
      'utf8',
    );
  }

  return {
    root,
    packDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ── mock wiring ───────────────────────────────────────────────────────────────

// We mock child_process at the module level so spawnSync is always injectable.
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

// We mock the context module so createContext() returns our temp root.
vi.mock('../lib/context.ts', () => ({
  createContext: vi.fn(),
}));

// ── imports after mocks ───────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { cmdPackPublish, compilePackRules, runNpmPublish } from './pack-publish.ts';

const mockSpawnSync = spawnSync as unknown as MockInstance;
const mockCreateContext = createContext as unknown as MockInstance;

// ── test utilities ────────────────────────────────────────────────────────────

/** Spy on process.exit without actually killing the process. */
function spyOnExit(): MockInstance {
  return vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
    throw new ExitError(_code as number);
  });
}

/** Capture stderr writes */
function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
  return {
    lines,
    restore: () => spy.mockRestore(),
  };
}

/** Capture stdout writes + console.log */
function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const stderrSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  return {
    lines,
    restore: () => {
      stderrSpy.mockRestore();
      consoleSpy.mockRestore();
    },
  };
}

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'ExitError';
  }
}

function isExitError(e: unknown): e is ExitError {
  return e instanceof ExitError;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('cmdPackPublish — exits 1 when no pack is found', () => {
  let cleanup: () => void;
  let exitSpy: MockInstance;
  let stderrCapture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    exitSpy = spyOnExit();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrCapture?.restore();
    cleanup?.();
    vi.clearAllMocks();
  });

  it('exits 1 when .thesmos/packs/ directory does not exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prom-empty-'));
    cleanup = () => rmSync(root, { recursive: true, force: true });
    mockCreateContext.mockReturnValue({ root, config: {} });
    stderrCapture = captureStderr();

    await expect(cmdPackPublish([])).rejects.toSatisfy(isExitError);

    const combined = stderrCapture.lines.join('');
    expect(combined).toContain('no packs directory found');
    const exitCall = exitSpy.mock.calls[0]?.[0];
    expect(exitCall).toBe(1);
  });

  it('exits 1 when packs directory exists but is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prom-nopacks-'));
    mkdirSync(join(root, '.thesmos', 'packs'), { recursive: true });
    cleanup = () => rmSync(root, { recursive: true, force: true });
    mockCreateContext.mockReturnValue({ root, config: {} });
    stderrCapture = captureStderr();

    await expect(cmdPackPublish([])).rejects.toSatisfy(isExitError);

    const combined = stderrCapture.lines.join('');
    expect(combined).toContain('no local packs found');
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  it('exits 1 when named pack does not exist', async () => {
    const { root, cleanup: c } = makeTempPack();
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });
    stderrCapture = captureStderr();

    await expect(cmdPackPublish(['nonexistent-pack'])).rejects.toSatisfy(isExitError);

    const combined = stderrCapture.lines.join('');
    expect(combined).toContain('not found');
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  it('exits 1 when multiple packs exist and no name is given', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prom-multi-'));
    const packsDir = join(root, '.thesmos', 'packs');

    // Create two packs
    for (const name of ['pack-a', 'pack-b']) {
      const dir = join(packsDir, name);
      mkdirSync(join(dir, 'rules'), { recursive: true });
      writeFileSync(
        join(dir, 'pack.json'),
        makePackJson({ id: `@test/${name}` }),
        'utf8',
      );
      writeFileSync(join(dir, 'rules', 'index.js'), '// compiled', 'utf8');
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: `@test/${name}` }),
        'utf8',
      );
    }

    cleanup = () => rmSync(root, { recursive: true, force: true });
    mockCreateContext.mockReturnValue({ root, config: {} });
    stderrCapture = captureStderr();

    await expect(cmdPackPublish([])).rejects.toSatisfy(isExitError);

    const combined = stderrCapture.lines.join('');
    expect(combined).toContain('multiple packs found');
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });
});

describe('cmdPackPublish — exits 1 when manifest is invalid', () => {
  let cleanup: () => void;
  let exitSpy: MockInstance;
  let stderrCapture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    exitSpy = spyOnExit();
    stderrCapture = captureStderr();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrCapture.restore();
    cleanup?.();
    vi.clearAllMocks();
  });

  it('exits 1 when required fields are missing', async () => {
    const { root, cleanup: c } = makeTempPack({
      packJson: JSON.stringify({
        schemaVersion: '1',
        // id is missing
        name: 'Broken Pack',
        version: '1.0.0',
        description: '',
        // description is empty — would cause error
        author: 'Author',
        tags: [],
        provides: { rules: false, agents: false, skills: false, playbooks: false, profiles: false },
      }),
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    await expect(cmdPackPublish([])).rejects.toSatisfy(isExitError);

    const combined = stderrCapture.lines.join('');
    expect(combined).toContain('manifest validation failed');
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  it('includes the specific missing field in the error output', async () => {
    const { root, cleanup: c } = makeTempPack({
      packJson: JSON.stringify({
        schemaVersion: '1',
        // no id field
        name: 'Pack Without ID',
        version: '1.0.0',
        description: 'desc',
        author: 'Author',
        tags: [],
        provides: { rules: true, agents: false, skills: false, playbooks: false, profiles: false },
      }),
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    await expect(cmdPackPublish([])).rejects.toSatisfy(isExitError);

    const combined = stderrCapture.lines.join('');
    expect(combined).toContain('manifest.id is required');
  });
});

describe('cmdPackPublish — dry-run', () => {
  let cleanup: () => void;
  let exitSpy: MockInstance;
  let stdoutCapture: ReturnType<typeof captureStdout>;
  let stderrCapture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    exitSpy = spyOnExit();
    stdoutCapture = captureStdout();
    stderrCapture = captureStderr();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutCapture.restore();
    stderrCapture.restore();
    cleanup?.();
    vi.clearAllMocks();
  });

  it('prints summary and does NOT call npm publish', async () => {
    const { root, cleanup: c } = makeTempPack({
      hasTsSrc: false,
      hasJsOut: true, // compiled already
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    await cmdPackPublish(['--dry-run']);

    // Should not have called spawnSync (no npm, no tsup)
    expect(mockSpawnSync).not.toHaveBeenCalled();

    const out = stdoutCapture.lines.join('');
    expect(out).toContain('dry-run');
    expect(out).toContain('@test/my-pack');
    expect(out).toContain('1.2.3');
    expect(out).toContain('npm publish');
  });

  it('dry-run with --json outputs machine-readable JSON', async () => {
    const { root, cleanup: c } = makeTempPack({ hasJsOut: true });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    await cmdPackPublish(['--dry-run', '--json']);

    expect(mockSpawnSync).not.toHaveBeenCalled();

    const out = stdoutCapture.lines.join('');
    const parsed = JSON.parse(out) as {
      dryRun: boolean;
      pack: string;
      version: string;
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.pack).toBe('@test/my-pack');
    expect(parsed.version).toBe('1.2.3');
  });

  it('dry-run does not exit 1 on default version warning', async () => {
    const { root, cleanup: c } = makeTempPack({
      packJson: makePackJson({ version: '1.0.0' }),
      hasJsOut: true,
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    // Should complete successfully (no exit 1) despite default version
    await expect(cmdPackPublish(['--dry-run'])).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();

    const errOut = stderrCapture.lines.join('');
    expect(errOut).toContain('1.0.0');
  });
});

describe('cmdPackPublish — uncompiled rules warning', () => {
  let cleanup: () => void;
  let exitSpy: MockInstance;
  let stderrCapture: ReturnType<typeof captureStderr>;
  let stdoutCapture: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    exitSpy = spyOnExit();
    stderrCapture = captureStderr();
    stdoutCapture = captureStdout();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrCapture.restore();
    stdoutCapture.restore();
    cleanup?.();
    vi.clearAllMocks();
  });

  it('warns (but does not exit 1) when provides.rules=true and index.js is missing', async () => {
    const { root, cleanup: c } = makeTempPack({
      hasTsSrc: true,
      hasJsOut: false, // not compiled
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    // Mock npm publish to succeed so we don't block on publish itself
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    // Should NOT exit 1 — just warn
    await cmdPackPublish([]);

    expect(exitSpy).not.toHaveBeenCalledWith(1);

    const errOut = stderrCapture.lines.join('');
    expect(errOut).toContain('rules/index.js does not exist');
    expect(errOut).toContain('--compile');
  });

  it('warns about missing index.js and mentions --compile flag', async () => {
    const { root, cleanup: c } = makeTempPack({
      hasTsSrc: true,
      hasJsOut: false,
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'published', stderr: '' });

    await cmdPackPublish([]);

    const errOut = stderrCapture.lines.join('');
    expect(errOut).toContain('thesmos pack:publish --compile');
  });
});

describe('cmdPackPublish — --compile flag', () => {
  let cleanup: () => void;
  let exitSpy: MockInstance;
  let stdoutCapture: ReturnType<typeof captureStdout>;
  let stderrCapture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    exitSpy = spyOnExit();
    stdoutCapture = captureStdout();
    stderrCapture = captureStderr();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutCapture.restore();
    stderrCapture.restore();
    cleanup?.();
    vi.clearAllMocks();
  });

  it('runs tsup when --compile is given and index.js is missing', async () => {
    const { root, cleanup: c } = makeTempPack({
      hasTsSrc: true,
      hasJsOut: false,
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    // First spawnSync call = tsup (compile), second = npm publish
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'compiled ok', stderr: '' })  // tsup
      .mockReturnValueOnce({ status: 0, stdout: '+ @test/my-pack@1.2.3', stderr: '' }); // npm

    await cmdPackPublish(['--compile']);

    // Verify tsup was invoked
    const firstCall = mockSpawnSync.mock.calls[0] as [string, string[], unknown];
    expect(firstCall[0]).toBe('npx');
    expect(firstCall[1]).toContain('tsup');
    expect(firstCall[1]).toContain('rules/index.ts');

    // Should not have exited 1
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('exits 1 when tsup fails', async () => {
    const { root, cleanup: c } = makeTempPack({
      hasTsSrc: true,
      hasJsOut: false,
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    // tsup fails
    mockSpawnSync.mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: 'error TS2345: Type error in rules/index.ts',
    });

    await expect(cmdPackPublish(['--compile'])).rejects.toSatisfy(isExitError);

    const errOut = stderrCapture.lines.join('');
    expect(errOut).toContain('compilation failed');
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  it('skips tsup when provides.rules=false', async () => {
    const { root, cleanup: c } = makeTempPack({
      packJson: makePackJson({
        provides: { rules: false, agents: true, skills: false, playbooks: false, profiles: false },
      }),
      hasTsSrc: true,
      hasJsOut: false,
    });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });

    // Only one spawnSync call expected — the npm publish
    mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'published', stderr: '' });

    await cmdPackPublish(['--compile']);

    const calls = mockSpawnSync.mock.calls as Array<[string, string[], unknown]>;
    expect(calls.length).toBe(1);
    // The single call should be npm, not npx tsup
    expect(calls[0]![0]).toBe('npm');
  });
});

describe('cmdPackPublish — npm publish success', () => {
  let cleanup: () => void;
  let exitSpy: MockInstance;
  let stdoutCapture: ReturnType<typeof captureStdout>;
  let stderrCapture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    exitSpy = spyOnExit();
    stdoutCapture = captureStdout();
    stderrCapture = captureStderr();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutCapture.restore();
    stderrCapture.restore();
    cleanup?.();
    vi.clearAllMocks();
  });

  it('prints post-publish hint on success', async () => {
    const { root, cleanup: c } = makeTempPack({ hasJsOut: true });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '+ @test/my-pack@1.2.3', stderr: '' });

    await cmdPackPublish([]);

    const out = stdoutCapture.lines.join('');
    expect(out).toContain('Published @test/my-pack@1.2.3');
    expect(out).toContain('npm install @test/my-pack');
    expect(out).toContain('node_modules/@thesmos/');
  });

  it('exits 1 when npm publish returns non-zero', async () => {
    const { root, cleanup: c } = makeTempPack({ hasJsOut: true });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'npm ERR! 403 Forbidden',
    });

    await expect(cmdPackPublish([])).rejects.toSatisfy(isExitError);

    const errOut = stderrCapture.lines.join('');
    expect(errOut).toContain('npm publish failed');
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  it('passes --tag through to npm publish', async () => {
    const { root, cleanup: c } = makeTempPack({ hasJsOut: true });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });
    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'published', stderr: '' });

    await cmdPackPublish(['--tag=beta']);

    const npmCall = mockSpawnSync.mock.calls[0] as [string, string[], unknown];
    expect(npmCall[1]).toContain('--tag');
    expect(npmCall[1]).toContain('beta');
  });

  it('passes --access through to npm publish', async () => {
    const { root, cleanup: c } = makeTempPack({ hasJsOut: true });
    cleanup = c;
    mockCreateContext.mockReturnValue({ root, config: {} });
    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'published', stderr: '' });

    await cmdPackPublish(['--access=restricted']);

    const npmCall = mockSpawnSync.mock.calls[0] as [string, string[], unknown];
    expect(npmCall[1]).toContain('--access');
    expect(npmCall[1]).toContain('restricted');
  });
});

// ── Unit tests for exported helpers ──────────────────────────────────────────

describe('compilePackRules (unit)', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns success=true when spawnSync exits 0', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'ok', stderr: '' });
    const result = compilePackRules('/some/pack');
    expect(result.success).toBe(true);
    expect(result.output).toContain('ok');
  });

  it('returns success=false when spawnSync exits non-zero', () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'TS error' });
    const result = compilePackRules('/some/pack');
    expect(result.success).toBe(false);
    expect(result.output).toContain('TS error');
  });

  it('calls npx tsup with the right arguments', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    compilePackRules('/some/pack');
    const call = mockSpawnSync.mock.calls[0] as [string, string[], { cwd: string }];
    expect(call[0]).toBe('npx');
    expect(call[1]).toEqual([
      'tsup',
      'rules/index.ts',
      '--format',
      'esm',
      '--outDir',
      'rules',
      '--no-splitting',
    ]);
    expect(call[2]).toMatchObject({ cwd: '/some/pack' });
  });
});

describe('runNpmPublish (unit)', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns success=true when npm exits 0', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '+ pkg@1.0.0', stderr: '' });
    const result = runNpmPublish('/pack', {});
    expect(result.success).toBe(true);
  });

  it('returns success=false when npm exits non-zero', () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'npm ERR!' });
    const result = runNpmPublish('/pack', {});
    expect(result.success).toBe(false);
  });

  it('includes --access public by default', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    runNpmPublish('/pack', {});
    const call = mockSpawnSync.mock.calls[0] as [string, string[]];
    expect(call[1]).toContain('--access');
    expect(call[1]).toContain('public');
  });

  it('includes --tag when provided', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    runNpmPublish('/pack', { tag: 'beta' });
    const call = mockSpawnSync.mock.calls[0] as [string, string[]];
    expect(call[1]).toContain('--tag');
    expect(call[1]).toContain('beta');
  });

  it('uses provided access level', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    runNpmPublish('/pack', { access: 'restricted' });
    const call = mockSpawnSync.mock.calls[0] as [string, string[]];
    expect(call[1]).toContain('restricted');
  });
});
