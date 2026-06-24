// @vitest-environment node
/**
 * Tests for thesmos pack:create command.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cmdPackCreate } from './pack-create.ts';

let tmpRoot: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpRoot = join(tmpdir(), `pack-create-test-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
  process.chdir(tmpRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('pack:create validation', () => {
  it('writes to stderr and calls process.exit(1) when no id given', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(cmdPackCreate([])).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('writes to stderr and calls process.exit(1) when id is not scoped', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(cmdPackCreate(['python'])).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects uppercase in id', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(cmdPackCreate(['@Myorg/Python'])).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('pack:create scaffolding', () => {
  it('creates pack directory with required files', async () => {
    await cmdPackCreate(['@myorg/demo']);
    const packDir = join(tmpRoot, '.thesmos', 'packs', 'demo');
    expect(existsSync(join(packDir, 'pack.json'))).toBe(true);
    expect(existsSync(join(packDir, 'rules', 'index.ts'))).toBe(true);
    expect(existsSync(join(packDir, 'README.md'))).toBe(true);
  });

  it('pack.json has correct structure', async () => {
    await cmdPackCreate(['@myorg/demo']);
    const manifest = JSON.parse(
      readFileSync(
        join(tmpRoot, '.thesmos', 'packs', 'demo', 'pack.json'),
        'utf8',
      ),
    );
    expect(manifest.id).toBe('@myorg/demo');
    expect(manifest.schemaVersion).toBe('1');
    expect(manifest.provides.rules).toBe(true);
    expect(typeof manifest.version).toBe('string');
  });

  it('rules/index.ts exports PACK_RULES', async () => {
    await cmdPackCreate(['@myorg/demo']);
    const content = readFileSync(
      join(tmpRoot, '.thesmos', 'packs', 'demo', 'rules', 'index.ts'),
      'utf8',
    );
    expect(content).toContain('export const PACK_RULES');
    expect(content).toContain('ThesmosRule');
  });

  it('creates agent/skill/playbook/profile stubs', async () => {
    await cmdPackCreate(['@myorg/demo']);
    const packDir = join(tmpRoot, '.thesmos', 'packs', 'demo');
    expect(existsSync(join(packDir, 'agents', '.gitkeep'))).toBe(true);
    expect(existsSync(join(packDir, 'skills', '.gitkeep'))).toBe(true);
    expect(existsSync(join(packDir, 'playbooks', '.gitkeep'))).toBe(true);
    expect(existsSync(join(packDir, 'profiles', '.gitkeep'))).toBe(true);
  });

  it('respects --author flag in pack.json', async () => {
    await cmdPackCreate(['@myorg/demo', '--author=Acme Corp']);
    const manifest = JSON.parse(
      readFileSync(
        join(tmpRoot, '.thesmos', 'packs', 'demo', 'pack.json'),
        'utf8',
      ),
    );
    expect(manifest.author).toBe('Acme Corp');
  });

  it('calls process.exit(1) if pack directory already exists', async () => {
    await cmdPackCreate(['@myorg/demo']);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(cmdPackCreate(['@myorg/demo'])).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('dry-run: does not write any files', async () => {
    await cmdPackCreate(['@myorg/demo', '--dry-run']);
    const packDir = join(tmpRoot, '.thesmos', 'packs', 'demo');
    expect(existsSync(packDir)).toBe(false);
  });
});

describe('pack:create rule ID generation', () => {
  it('uses first 4 chars of pack name as rule ID prefix (python → PYTH)', async () => {
    await cmdPackCreate(['@myorg/python']);
    const content = readFileSync(
      join(tmpRoot, '.thesmos', 'packs', 'python', 'rules', 'index.ts'),
      'utf8',
    );
    expect(content).toContain('PYTH_001');
  });

  it('uses first 4 chars of pack name as rule ID prefix (django → DJAN)', async () => {
    await cmdPackCreate(['@myorg/django']);
    const content = readFileSync(
      join(tmpRoot, '.thesmos', 'packs', 'django', 'rules', 'index.ts'),
      'utf8',
    );
    expect(content).toContain('DJAN_001');
  });
});
