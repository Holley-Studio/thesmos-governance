// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadScopeConfig,
  saveScopeConfig,
  checkScope,
  getScopeStatus,
  SCOPE_DEFAULTS,
  type ScopeConfig,
} from './scope.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `prometheus-scope-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeScope(root: string, config: Partial<ScopeConfig>): void {
  mkdirSync(join(root, '.prometheus'), { recursive: true });
  writeFileSync(join(root, '.prometheus', 'scope.json'), JSON.stringify(config, null, 2));
}

describe('loadScopeConfig', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('returns null when no scope.json exists', () => {
    expect(loadScopeConfig(root)).toBeNull();
  });

  it('loads a valid scope.json', () => {
    writeScope(root, { version: '1.0', workspace: { allowedPaths: ['src/'] } });
    const cfg = loadScopeConfig(root);
    expect(cfg).not.toBeNull();
    expect(cfg!.workspace.allowedPaths).toContain('src/');
  });

  it('merges missing fields with defaults', () => {
    writeScope(root, { version: '1.0' });
    const cfg = loadScopeConfig(root);
    expect(cfg!.operations.allowDelete).toBe(false);
    expect(cfg!.operations.allowGitPush).toBe(false);
    expect(cfg!.workspace.blockedPaths).toEqual(SCOPE_DEFAULTS.workspace.blockedPaths);
  });

  it('returns null for invalid JSON', () => {
    mkdirSync(join(root, '.prometheus'), { recursive: true });
    writeFileSync(join(root, '.prometheus', 'scope.json'), 'not-json');
    expect(loadScopeConfig(root)).toBeNull();
  });
});

describe('saveScopeConfig', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('writes scope.json and round-trips', () => {
    const cfg: ScopeConfig = {
      ...SCOPE_DEFAULTS,
      workspace: { ...SCOPE_DEFAULTS.workspace, allowedPaths: ['src/', 'tests/'] },
    };
    saveScopeConfig(root, cfg);
    const loaded = loadScopeConfig(root);
    expect(loaded?.workspace.allowedPaths).toEqual(['src/', 'tests/']);
  });
});

describe('checkScope — no config', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('allows everything when no scope.json exists', () => {
    expect(checkScope({ toolName: 'Write', filePath: '/etc/passwd', root })).toBeNull();
    expect(checkScope({ toolName: 'Bash', command: 'rm -rf /', root })).toBeNull();
  });
});

describe('checkScope — path enforcement', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      workspace: {
        allowedPaths: ['src/'],
        blockedPaths: ['node_modules/', '.env'],
        absoluteBlockPaths: ['/etc/', '/System/'],
      },
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('blocks write to path outside allowedPaths', () => {
    const v = checkScope({ toolName: 'Write', filePath: join(root, 'dist', 'bundle.js'), root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('blocked_path');
  });

  it('allows write inside allowedPaths', () => {
    const v = checkScope({ toolName: 'Write', filePath: join(root, 'src', 'index.ts'), root });
    expect(v).toBeNull();
  });

  it('blocks write to blocked pattern node_modules/', () => {
    const v = checkScope({ toolName: 'Write', filePath: 'node_modules/lodash/index.js', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('blocked_path');
  });

  it('blocks write to absolute blocked path /etc/', () => {
    const v = checkScope({ toolName: 'Write', filePath: '/etc/hosts', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('absolute_blocked_path');
  });

  it('ignores path checks for Read tool', () => {
    // checkScope only enforces Write/Edit/Bash
    const v = checkScope({ toolName: 'Read', filePath: '/etc/passwd', root });
    expect(v).toBeNull();
  });
});

describe('checkScope — command enforcement', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      operations: {
        allowDelete: false,
        allowGitPush: false,
        allowNetworkHosts: [],
        allowDatabaseWrites: false,
        requireConfirmation: ['npm publish'],
      },
      destructivePatterns: ['rm -rf', 'DROP TABLE'],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('blocks rm -rf (destructive pattern)', () => {
    const v = checkScope({ toolName: 'Bash', command: 'rm -rf ./dist', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('destructive_command');
  });

  it('blocks DROP TABLE (destructive pattern)', () => {
    const v = checkScope({ toolName: 'Bash', command: 'psql -c "DROP TABLE users"', root });
    expect(v).not.toBeNull();
  });

  it('blocks git push when allowGitPush is false', () => {
    const v = checkScope({ toolName: 'Bash', command: 'git push origin main', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('destructive_command');
    expect(v!.message).toContain('git push');
  });

  it('blocks rm without -rf when allowDelete is false', () => {
    const v = checkScope({ toolName: 'Bash', command: 'rm somefile.txt', root });
    expect(v).not.toBeNull();
  });

  it('requires confirmation for npm publish', () => {
    const v = checkScope({ toolName: 'Bash', command: 'npm publish --access public', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('requires_confirmation');
  });

  it('allows safe commands', () => {
    expect(checkScope({ toolName: 'Bash', command: 'npm run build', root })).toBeNull();
    expect(checkScope({ toolName: 'Bash', command: 'ls -la', root })).toBeNull();
    expect(checkScope({ toolName: 'Bash', command: 'cat package.json', root })).toBeNull();
  });
});

describe('getScopeStatus', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('reports configured: false when no scope.json', () => {
    const status = getScopeStatus(root);
    expect(status.configured).toBe(false);
    expect(status.config).toBeNull();
    expect(status.allowedPaths).toEqual([]);
    expect(status.blockedPaths).toEqual([]);
  });

  it('reports allowDelete: false when unconfigured', () => {
    expect(getScopeStatus(root).allowDelete).toBe(false);
  });

  it('reports allowGitPush: false when unconfigured', () => {
    expect(getScopeStatus(root).allowGitPush).toBe(false);
  });

  it('returns correct values when scope.json exists', () => {
    writeScope(root, {
      workspace: { allowedPaths: ['src/', 'tests/'] },
      operations: { allowDelete: true, allowGitPush: false },
    });
    const status = getScopeStatus(root);
    expect(status.configured).toBe(true);
    expect(status.allowedPaths).toEqual(['src/', 'tests/']);
    expect(status.allowDelete).toBe(true);
    expect(status.allowGitPush).toBe(false);
  });

  it('scopeFilePath points to .prometheus/scope.json', () => {
    const status = getScopeStatus(root);
    expect(status.scopeFilePath).toContain('.prometheus');
    expect(status.scopeFilePath).toContain('scope.json');
  });
});
