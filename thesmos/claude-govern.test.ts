// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { evaluateGovernFindings } from './claude-govern';
import { CONFIG_DEFAULTS } from './config';
import type { ThesmosConfig } from './types';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(HERE, 'bin', 'cli.ts');
// tsx is hoisted to the workspace root's node_modules (npm workspaces) — resolve
// its real CLI entry explicitly so this works regardless of the spawned
// process's cwd (which must be the fixture project root, not this package).
const TSX_ENTRY = join(HERE, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runPreToolHook(root: string, stdin: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX_ENTRY, CLI_ENTRY, 'claude:govern', 'check'], {
    cwd: root,
    input: stdin,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function makeScopeFixture(requireConfirmation: string[], destructivePatterns: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'thesmos-claude-govern-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  writeFileSync(
    join(root, '.thesmos', 'scope.json'),
    JSON.stringify({
      version: '1.0',
      workspace: { allowedPaths: [], blockedPaths: [], absoluteBlockPaths: [] },
      operations: {
        allowDelete: true,
        allowGitPush: true,
        allowNetworkHosts: [],
        allowDatabaseWrites: true,
        requireConfirmation,
      },
      destructivePatterns,
    }),
    'utf-8',
  );
  return root;
}

// Assembled at runtime so secret scanners (GitHub push protection, SEC_003)
// never see a key-shaped literal in this source file — the rule engine under
// test still receives the exact fixture string.
const SECRET_LINE = `const stripeKey = "${['sk', 'live', 'FAKE'.repeat(6)].join('_')}";`;

function withConfig(overrides: Partial<ThesmosConfig>): ThesmosConfig {
  return { ...CONFIG_DEFAULTS, ...overrides };
}

describe('evaluateGovernFindings — real-time govern check', () => {
  it('blocks a genuine BLOCKER finding with default config', () => {
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/pay.ts',
      content: SECRET_LINE,
      config: CONFIG_DEFAULTS,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it('returns no findings for benign UI code', () => {
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/SearchBar.tsx',
      content: '<input placeholder="Search agents..." aria-label="Search" />',
      config: CONFIG_DEFAULTS,
    });
    expect(findings).toEqual([]);
  });

  it('honors a config severityRules downgrade — the option the tool itself offers', () => {
    const config = withConfig({
      severityRules: [
        ...CONFIG_DEFAULTS.severityRules.filter((r) => r.category !== 'vibe_hardcoded_secret'),
        { category: 'vibe_hardcoded_secret', severity: 'LOW' },
      ],
    });
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/config.ts',
      content: 'const API_KEY = "PLACEHOLDER";',
      config,
    });
    expect(findings.filter((f) => f.category === 'vibe_hardcoded_secret')).toEqual([]);
  });

  it('honors an inline thesmos-disable-next-line suppression', () => {
    const content = [
      '// thesmos-disable-next-line vibe_hardcoded_secret -- reason: fixture value for docs',
      'const API_KEY = "PLACEHOLDER";',
    ].join('\n');
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/example.ts',
      content,
      config: CONFIG_DEFAULTS,
    });
    expect(findings.filter((f) => f.category === 'vibe_hardcoded_secret')).toEqual([]);
  });

  it('an inline suppression only silences its own rule, not others on the same line', () => {
    const content = [
      '// thesmos-disable-next-line vibe_hardcoded_secret -- reason: testing',
      SECRET_LINE,
    ].join('\n');
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/pay.ts',
      content,
      config: CONFIG_DEFAULTS,
    });
    // Other secret rules (e.g. env_secret_hardcoded) must still fire
    expect(findings.some((f) => f.category !== 'vibe_hardcoded_secret')).toBe(true);
    expect(findings.filter((f) => f.category === 'vibe_hardcoded_secret')).toEqual([]);
  });

  it('honors autoMode.blockOn = HIGH by also blocking HIGH findings', () => {
    const config = withConfig({ autoMode: { blockOn: 'HIGH' } });
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/app.ts',
      content: 'function run() {\n  debugger;\n}',
      config,
    });
    expect(findings.some((f) => f.category === 'debugger_statement')).toBe(true);
  });

  it('defaults to blocking only BLOCKER findings (HIGH passes through)', () => {
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/app.ts',
      content: 'function run() {\n  debugger;\n}',
      config: CONFIG_DEFAULTS,
    });
    expect(findings).toEqual([]);
  });

  it('honors a severityRules upgrade of a lower rule to BLOCKER', () => {
    const config = withConfig({
      severityRules: [
        ...CONFIG_DEFAULTS.severityRules.filter((r) => r.category !== 'debugger_statement'),
        { category: 'debugger_statement', severity: 'BLOCKER' },
      ],
    });
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/app.ts',
      content: 'function run() {\n  debugger;\n}',
      config,
    });
    expect(findings.some((f) => f.category === 'debugger_statement')).toBe(true);
  });
});

// ── runPreToolCheck (PreToolUse hook) — real subprocess, real stdin/exit ──────
//
// Regression coverage for a verified bug (Operation Signal Phase 2/7): a
// `requires_confirmation` scope violation used to be indistinguishable from a
// hard BLOCKER — both exited 2, so Claude Code denied the action outright with
// no way to actually confirm. This must now surface as a real "ask" decision
// (exit 0 + hookSpecificOutput JSON) that Claude Code's own permission UI can
// resolve, while genuine hard blocks keep exiting 2.

describe('runPreToolCheck — requires_confirmation vs. hard block (Bash)', () => {
  it('requires_confirmation emits an "ask" decision (exit 0), not a hard block', () => {
    const root = makeScopeFixture(['zzz-test-risky-op']);
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'zzz-test-risky-op --now' } }),
    );
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('zzz-test-risky-op');
    // A correlation id is embedded in the reason text -- the PreToolUse
    // schema has no dedicated field for one (verified against the current
    // protocol), so this is the documented "where supported" answer.
    expect(output.hookSpecificOutput.permissionDecisionReason).toMatch(/\[ref: [a-z0-9]+\]/);
    rmSync(root, { recursive: true, force: true });
  });

  it('stdout contains exactly one JSON object and nothing else (no corruption risk)', () => {
    const root = makeScopeFixture(['zzz-test-risky-op']);
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'zzz-test-risky-op --now' } }),
    );
    const lines = result.stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it('a genuine destructive_command still hard-blocks (exit 2, stderr)', () => {
    const root = makeScopeFixture([], ['zzz-test-destructive-pattern']);
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'zzz-test-destructive-pattern now' } }),
    );
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe('');
    expect(result.stderr).toMatch(/destructive pattern/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('a benign command is allowed (exit 0, no decision JSON)', () => {
    const root = makeScopeFixture(['zzz-test-risky-op']);
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hello' } }),
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
    rmSync(root, { recursive: true, force: true });
  });

  it('a confirm-required phrase appearing only in a quoted echo string is allowed, not asked', () => {
    // The requireConfirmation matcher now uses the same quote-aware
    // tokenizer as destructivePatterns -- decorative mentions must not
    // trigger the confirmation flow at all.
    const root = makeScopeFixture(['zzz-test-risky-op']);
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo "zzz-test-risky-op is dangerous"' } }),
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
    rmSync(root, { recursive: true, force: true });
  });

  it('closes the quote-adjacency bypass end-to-end: a split-quoted destructive command still hard-blocks', () => {
    const root = makeScopeFixture([], ['zzz-rf']);
    // "zz"z"-rf" reconstructs to the bare token "zzz-rf" once quotes are
    // resolved -- previously, blanking the whole quoted span broke this
    // apart and let it through undetected.
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'z"z"z-rf /tmp/x' } }),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/destructive pattern/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('malformed .thesmos/scope.json produces a typed, explainable infrastructure failure (fails closed)', () => {
    const root = mkdtempSync(join(tmpdir(), 'thesmos-claude-govern-'));
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'scope.json'), '{ not valid json', 'utf-8');
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hello' } }),
    );
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe('');
    expect(result.stderr).toMatch(/scope\.json/i);
    // The diagnostic's "Guard path" must be the relative scope.json path
    // (never the absolute filesystem path of this real tmpdir joined onto
    // it) — this stderr output is a shareable diagnostic (hook transcripts,
    // bug reports), and an absolute path here would leak the machine's
    // directory layout for no benefit over the relative one. (The separate
    // "CWD:" line legitimately does show the absolute cwd — that's an
    // existing, unrelated diagnostic field, not part of this fix.)
    expect(result.stderr).not.toContain(join(root, '.thesmos', 'scope.json'));
    rmSync(root, { recursive: true, force: true });
  });
});

// ── Ambiguous command syntax surfaces as a real, recoverable "ask" ──────────
// End-to-end through the real spawned hook: unresolvable executable syntax
// must reach Claude Code as a permission request, never a silent allow and
// never an unrecoverable hard block.

describe('runPreToolCheck — ambiguous command syntax (end-to-end)', () => {
  it('$() command substitution emits an "ask" decision (exit 0), not a hard block', () => {
    const root = makeScopeFixture([]);
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo $(rm -rf /tmp/example)' } }),
    );
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(output.hookSpecificOutput.permissionDecisionReason).toMatch(/command substitution/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('an arbitrary-code interpreter payload asks rather than pretending to inspect it', () => {
    const root = makeScopeFixture([]);
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'node -e "console.log(1)"' } }),
    );
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(output.hookSpecificOutput.permissionDecisionReason).toMatch(/interpreter/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('the ask reason never leaks the raw command text (no paths, no payload contents)', () => {
    const root = makeScopeFixture([]);
    const result = runPreToolHook(
      root,
      JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'echo $(cat /home/someone/.ssh/id_rsa)' },
      }),
    );
    expect(result.status).toBe(0);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string;
    expect(reason).not.toContain('id_rsa');
    expect(reason).not.toContain('/home/someone');
    rmSync(root, { recursive: true, force: true });
  });

  it('an ordinary resolvable command is still allowed outright (no spurious ask)', () => {
    const root = makeScopeFixture([]);
    const result = runPreToolHook(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm run build' } }),
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
    rmSync(root, { recursive: true, force: true });
  });

  it('a genuine destructive match still hard-blocks even when ambiguous syntax is also present', () => {
    const root = makeScopeFixture([], ['zzz-test-destructive-pattern']);
    const result = runPreToolHook(
      root,
      JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'zzz-test-destructive-pattern && echo $(date)' },
      }),
    );
    expect(result.status).toBe(2);
    rmSync(root, { recursive: true, force: true });
  });
});
