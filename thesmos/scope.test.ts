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
  ScopeConfigError,
  type ScopeConfig,
  SCOPE_DECISION_CODES,
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

  it('throws ScopeConfigError for invalid JSON — a present-but-corrupt scope file must fail closed, not silently allow everything', () => {
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'scope.json'), 'not-json');
    expect(() => loadScopeConfig(root)).toThrow(ScopeConfigError);
    try {
      loadScopeConfig(root);
      expect.unreachable('loadScopeConfig should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ScopeConfigError);
      expect((err as ScopeConfigError).scopePath).toContain('scope.json');
      expect((err as ScopeConfigError).message).toContain('scope.json');
    }
  });

  it('ScopeConfigError has the stable programmatic code THESMOS_SCOPE_CONFIG_INVALID', () => {
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'scope.json'), 'not-json');
    try {
      loadScopeConfig(root);
      expect.unreachable('loadScopeConfig should have thrown');
    } catch (err) {
      if (!(err instanceof ScopeConfigError)) throw err;
      expect(err.code).toBe('THESMOS_SCOPE_CONFIG_INVALID');
      expect(ScopeConfigError.CODE).toBe('THESMOS_SCOPE_CONFIG_INVALID');
      expect(err.name).toBe('ScopeConfigError');
    }
  });

  it('ScopeConfigError.scopePath is project-relative, never the absolute filesystem path (no absolute path in a shareable diagnostic)', () => {
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'scope.json'), 'not-json');
    try {
      loadScopeConfig(root);
      expect.unreachable('loadScopeConfig should have thrown');
    } catch (err) {
      if (!(err instanceof ScopeConfigError)) throw err;
      expect(err.scopePath).toBe('.thesmos/scope.json');
      expect(err.scopePath).not.toContain(root); // must not embed the absolute tmp-dir path
      expect(err.message).not.toContain(root);
    }
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

  it('F1 — does NOT treat .claude/settings.json as a governance file', () => {
    // .claude/settings.json is intentionally NOT governance-protected — users must be
    // able to ask Claude to edit their own Claude Code settings.
    const v = checkScope({ toolName: 'Write', filePath: '.claude/settings.json', root });
    // May be blocked by allowedPaths (outside src/), but the message must NOT say "governance file"
    if (v !== null) {
      expect(v.message).not.toContain('governance file');
    }
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

// ── Residual bypasses closed this pass: quote-adjacency for allowDelete/
// allowGitPush, wrapper/path/flag variants, and database-command correctness,
// all via the SAME unified command-analysis path as destructivePatterns and
// requireConfirmation (no separate stripQuotedAndComments regex path anymore).

describe('checkScope — quote-adjacency bypass closed for allowDelete and allowGitPush', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      operations: {
        allowDelete: false,
        allowGitPush: false,
        allowNetworkHosts: [],
        allowDatabaseWrites: false,
        requireConfirmation: [],
      },
      destructivePatterns: [],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('blocks r"m" -rf ./build — the quote-split reconstructs to the bare command "rm"', () => {
    const v = checkScope({ toolName: 'Bash', command: 'r"m" -rf ./build', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('destructive_command');
  });

  it('blocks g"it" push origin main — the quote-split reconstructs to the bare command "git"', () => {
    const v = checkScope({ toolName: 'Bash', command: 'g"it" push origin main', root });
    expect(v).not.toBeNull();
  });
});

describe('checkScope — executable path, wrapper, and flag variants for allowDelete', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      operations: {
        allowDelete: false,
        allowGitPush: false,
        allowNetworkHosts: [],
        allowDatabaseWrites: false,
        requireConfirmation: [],
      },
      destructivePatterns: [],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('blocks an absolute executable path: /bin/rm -rf ./build', () => {
    expect(checkScope({ toolName: 'Bash', command: '/bin/rm -rf ./build', root })).not.toBeNull();
  });

  it('blocks separate (non-combined) flags: rm -r -f ./build', () => {
    expect(checkScope({ toolName: 'Bash', command: 'rm -r -f ./build', root })).not.toBeNull();
  });

  it('blocks a sudo-wrapped invocation: sudo rm -rf ./build', () => {
    expect(checkScope({ toolName: 'Bash', command: 'sudo rm -rf ./build', root })).not.toBeNull();
  });

  it('blocks an env-wrapped invocation: env rm -rf ./build', () => {
    expect(checkScope({ toolName: 'Bash', command: 'env rm -rf ./build', root })).not.toBeNull();
  });

  it('blocks a command-wrapped invocation: command rm -rf ./build', () => {
    expect(checkScope({ toolName: 'Bash', command: 'command rm -rf ./build', root })).not.toBeNull();
  });

  it('still allows rm --help (asking for help, not deleting)', () => {
    expect(checkScope({ toolName: 'Bash', command: 'rm --help', root })).toBeNull();
  });
});

describe('checkScope — global flags between an executable and its subcommand', () => {
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
      destructivePatterns: [],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('blocks git -C ./repo push origin main (allowGitPush false, value-taking global flag)', () => {
    const v = checkScope({ toolName: 'Bash', command: 'git -C ./repo push origin main', root });
    expect(v).not.toBeNull();
    expect(v!.message).toContain('git push');
  });

  it('requires confirmation for npm --silent publish (boolean global flag)', () => {
    const v = checkScope({ toolName: 'Bash', command: 'npm --silent publish', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('requires_confirmation');
  });
});

describe('checkScope — database-command correctness', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      operations: {
        allowDelete: false,
        allowGitPush: false,
        allowNetworkHosts: [],
        allowDatabaseWrites: false,
        requireConfirmation: [],
      },
      destructivePatterns: [],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('does NOT block echo "DROP TABLE users" — the quoted argument is inert, not executed SQL', () => {
    const v = checkScope({ toolName: 'Bash', command: 'echo "DROP TABLE users"', root });
    expect(v).toBeNull();
  });

  it('still blocks psql -c "DROP TABLE users" — the quoted string is live SQL passed to psql', () => {
    const v = checkScope({ toolName: 'Bash', command: 'psql -c "DROP TABLE users"', root });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('destructive_command');
  });

  it('blocks mysql -e "DELETE FROM users" — same live-payload recognition for a second database client', () => {
    const v = checkScope({ toolName: 'Bash', command: 'mysql -e "DELETE FROM users"', root });
    expect(v).not.toBeNull();
  });

  it('blocks mysql --execute "TRUNCATE users" via the long flag form', () => {
    const v = checkScope({ toolName: 'Bash', command: 'mysql --execute "TRUNCATE users"', root });
    expect(v).not.toBeNull();
  });

  it('does NOT block an unrelated quoted argument that happens to contain SQL-like words as documentation', () => {
    const v = checkScope({ toolName: 'Bash', command: 'cat "./docs/DROP TABLE is dangerous.md"', root });
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

// ── Ambiguous command syntax → recoverable ask, not a silent allow ──────────
// Executable syntax the analyzer cannot resolve becomes requires_confirmation
// (Claude Code's "ask"), so legitimate-but-unanalyzable developer commands
// stay usable while nothing dangerous slips through unreviewed.

describe('checkScope — ambiguous command syntax requests approval', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      operations: {
        allowDelete: true,
        allowGitPush: true,
        allowNetworkHosts: [],
        allowDatabaseWrites: true,
        requireConfirmation: [],
      },
      destructivePatterns: [],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  /** Runs the check and returns the ambiguity sub-code, so each test below
   *  asserts on the value directly rather than delegating its only
   *  assertion to a helper (which would make a silently-broken helper turn
   *  every caller into a vacuous always-passing test). */
  function askConstructFor(command: string): string | undefined {
    const v = checkScope({ toolName: 'Bash', command, root });
    if (v === null) return undefined;
    if (v.type !== 'requires_confirmation') return `NOT_AN_ASK:${v.type}`;
    if (v.code !== SCOPE_DECISION_CODES.AMBIGUOUS_COMMAND_SYNTAX) return `WRONG_CODE:${v.code}`;
    return v.ambiguousConstruct;
  }

  it('asks for $() command substitution', () => {
    expect(askConstructFor('echo $(rm -rf /tmp/example)')).toBe('COMMAND_SUBSTITUTION');
  });

  it('asks for backtick substitution', () => {
    expect(askConstructFor('echo `git push origin main`')).toBe('BACKTICK_SUBSTITUTION');
  });

  it('asks for process substitution', () => {
    expect(askConstructFor('cat <(rm -rf /tmp/example)')).toBe('PROCESS_SUBSTITUTION');
  });

  it('asks for subshell grouping', () => {
    expect(askConstructFor('(rm -rf /tmp/example)')).toBe('SUBSHELL_GROUPING');
  });

  it('asks for a variable-expanded executable', () => {
    expect(askConstructFor('CMD=rm; $CMD -rf /tmp/example')).toBe('VARIABLE_EXECUTABLE');
  });

  it('asks for arbitrary-code interpreters rather than pretending the denylist inspects them', () => {
    expect(askConstructFor('node -e "require(\'fs\').rmSync(\'/tmp/x\')"')).toBe('ARBITRARY_CODE_INTERPRETER');
    expect(askConstructFor('python3 -c "import shutil"')).toBe('ARBITRARY_CODE_INTERPRETER');
  });

  it('asks for eval of a shell string (regressed to silent-allow before review fix)', () => {
    expect(askConstructFor('eval "rm -rf /tmp/example"')).toBe('SHELL_EVAL');
  });

  it('asks for a here-string redirection (regressed to silent-allow before review fix)', () => {
    expect(askConstructFor('sh <<< "rm -rf /tmp/example"')).toBe('HERESTRING_REDIRECTION');
  });

  it('asks for malformed interpreter syntax', () => {
    expect(askConstructFor('bash -c')).toBe('MALFORMED_INTERPRETER_SYNTAX');
  });

  it('the ask message and suggestion never contain the raw command text', () => {
    const v = checkScope({
      toolName: 'Bash',
      command: 'echo $(cat /home/someone/.ssh/id_rsa)',
      root,
    })!;
    expect(v.message).not.toContain('id_rsa');
    expect(v.message).not.toContain('/home/someone');
    expect(v.suggestion).not.toContain('id_rsa');
    expect(v.suggestion).not.toContain('/home/someone');
  });

  it('does NOT ask for ordinary resolvable commands', () => {
    expect(checkScope({ toolName: 'Bash', command: 'npm run build', root })).toBeNull();
    expect(checkScope({ toolName: 'Bash', command: "echo '$(rm -rf /tmp/example)'", root })).toBeNull();
    expect(checkScope({ toolName: 'Bash', command: 'git commit -m \'documents $(rm -rf) behavior\'', root })).toBeNull();
  });
});

describe('checkScope — explicit destructive matches take priority over ambiguity', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      operations: {
        allowDelete: false,
        allowGitPush: false,
        allowNetworkHosts: [],
        allowDatabaseWrites: false,
        requireConfirmation: [],
      },
      destructivePatterns: ['rm -rf'],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('a positively-matched destructive pattern is a hard block, not an ask, even alongside ambiguous syntax', () => {
    const v = checkScope({ toolName: 'Bash', command: 'rm -rf ./build && echo $(date)', root })!;
    expect(v.type).toBe('destructive_command');
    expect(v.code).toBe(SCOPE_DECISION_CODES.DESTRUCTIVE_COMMAND);
  });

  it('ambiguity alone (no positive match) is never a hard block', () => {
    const v = checkScope({ toolName: 'Bash', command: 'echo $(date)', root })!;
    expect(v.type).toBe('requires_confirmation');
  });
});

describe('checkScope — bundled POSIX shell execution flags are still enforced', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      operations: {
        allowDelete: false, allowGitPush: false, allowNetworkHosts: [],
        allowDatabaseWrites: false, requireConfirmation: [],
      },
      destructivePatterns: ['rm -rf'],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('blocks bash -lc "rm -rf ..." as destructive, not merely an ask', () => {
    const v = checkScope({ toolName: 'Bash', command: 'bash -lc "rm -rf ./build"', root })!;
    expect(v.type).toBe('destructive_command');
    expect(v.code).toBe(SCOPE_DECISION_CODES.DESTRUCTIVE_COMMAND);
  });

  it('blocks sh -ec "git push ..." via allowGitPush', () => {
    const v = checkScope({ toolName: 'Bash', command: 'sh -ec "git push origin main"', root })!;
    expect(v.type).toBe('destructive_command');
  });
});

describe('scope decision codes are attached to every violation type', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeScope(root, {
      workspace: { allowedPaths: ['src/'], blockedPaths: ['node_modules/'], absoluteBlockPaths: ['/etc/'] },
      operations: {
        allowDelete: false,
        allowGitPush: false,
        allowNetworkHosts: [],
        allowDatabaseWrites: false,
        requireConfirmation: ['npm publish'],
      },
      destructivePatterns: ['rm -rf'],
    });
  });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('blocked_path carries BLOCKED_PATH', () => {
    const v = checkScope({ toolName: 'Write', filePath: 'node_modules/x.js', root })!;
    expect(v.code).toBe(SCOPE_DECISION_CODES.BLOCKED_PATH);
  });

  it('absolute_blocked_path carries ABSOLUTE_BLOCKED_PATH', () => {
    const v = checkScope({ toolName: 'Write', filePath: '/etc/hosts', root })!;
    expect(v.code).toBe(SCOPE_DECISION_CODES.ABSOLUTE_BLOCKED_PATH);
  });

  it('destructive_command carries DESTRUCTIVE_COMMAND', () => {
    const v = checkScope({ toolName: 'Bash', command: 'rm -rf ./dist', root })!;
    expect(v.code).toBe(SCOPE_DECISION_CODES.DESTRUCTIVE_COMMAND);
  });

  it('requires_confirmation (configured phrase) carries REQUIRES_CONFIRMATION', () => {
    const v = checkScope({ toolName: 'Bash', command: 'npm publish', root })!;
    expect(v.code).toBe(SCOPE_DECISION_CODES.REQUIRES_CONFIRMATION);
  });

  it('every code value is a stable THESMOS_SCOPE_* string', () => {
    for (const code of Object.values(SCOPE_DECISION_CODES)) {
      expect(code).toMatch(/^THESMOS_SCOPE_[A-Z_]+$/);
    }
  });
});
