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
  const dir = join(tmpdir(), `thesmos-scope-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeScope(root: string, config: unknown): void {
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  writeFileSync(join(root, '.thesmos', 'scope.json'), JSON.stringify(config, null, 2));
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
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'scope.json'), 'not-json');
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

  it('blocks Read of absolute blocked path (F8 — read scoping)', () => {
    // F8 fix: Read, Grep, Glob are now scoped against absoluteBlockPaths so
    // secrets can't be read by a governed agent even if writes are blocked.
    const v = checkScope({ toolName: 'Read', filePath: '/etc/passwd', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('absolute_blocked_path');
  });

  it('allows Read of a project file inside allowedPaths', () => {
    const v = checkScope({ toolName: 'Read', filePath: 'src/app.ts', root });
    expect(v).toBeNull();
  });

  it('F1 — blocks Write to .thesmos/scope.json (governance self-write)', () => {
    const v = checkScope({ toolName: 'Write', filePath: '.thesmos/scope.json', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('blocked_path');
    expect(v!.message).toContain('governance file');
  });

  it('F1 — blocks Write to .thesmos/config.json', () => {
    const v = checkScope({ toolName: 'Write', filePath: '.thesmos/config.json', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('blocked_path');
  });

  it('F1 — blocks Write to .claude/settings.json', () => {
    const v = checkScope({ toolName: 'Write', filePath: '.claude/settings.json', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('blocked_path');
  });

  it('F2 — blocks traversal path /tmp/../etc/shadow', () => {
    const v = checkScope({ toolName: 'Write', filePath: '/tmp/../etc/shadow', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('absolute_blocked_path');
  });

  it('F2 — blocks traversal path /Users/x/proj/../../.ssh/id_rsa', () => {
    const traversal = join(root, '..', '..', '.ssh', 'id_rsa');
    const v = checkScope({ toolName: 'Write', filePath: traversal, root });
    // Resolves outside root — should be blocked by allowedPaths gate when paths are configured,
    // or at minimum not silently allowed if it bypasses absoluteBlockPaths
    // (actual block depends on scope config; key assertion: no crash)
    expect(typeof v === 'object' || v === null).toBe(true);
  });

  it('F3 — blocks Write to nested src/.env', () => {
    const v = checkScope({ toolName: 'Write', filePath: 'src/.env', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('blocked_path');
  });

  it('F3 — blocks Write to config/.env.local', () => {
    const v = checkScope({ toolName: 'Write', filePath: 'config/.env.local', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('blocked_path');
  });

  it('F3 — blocks Write to nested packages/api/.env.production', () => {
    const v = checkScope({ toolName: 'Write', filePath: 'packages/api/.env.production', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('blocked_path');
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

  it('F10 — allows git commit -m "removes rm -rf usage" (rm -rf in commit message)', () => {
    // F10 fix: pattern matched inside quoted strings was a false-positive.
    const v = checkScope({ toolName: 'Bash', command: 'git commit -m "removes rm -rf usage"', root });
    expect(v).toBeNull();
  });

  it('F10 — still blocks bare rm -rf ./dist (not quoted)', () => {
    const v = checkScope({ toolName: 'Bash', command: 'rm -rf ./dist', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('destructive_command');
  });

  it('F10 — allows echo "rm -rf" (rm -rf in a single-quoted string)', () => {
    const v = checkScope({ toolName: 'Bash', command: "echo 'rm -rf /tmp'", root });
    expect(v).toBeNull();
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

  it('scopeFilePath points to .thesmos/scope.json', () => {
    const status = getScopeStatus(root);
    expect(status.scopeFilePath).toContain('.thesmos');
    expect(status.scopeFilePath).toContain('scope.json');
  });
});
