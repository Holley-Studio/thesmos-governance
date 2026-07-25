// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Claude Code governance hooks — intercepts Write/Edit/Bash tool calls in Auto Mode
 * and blocks BLOCKER-severity Thesmos violations before they land on disk.
 *
 * Integration points:
 *   1. `thesmos claude:govern install` — writes hooks to .claude/settings.json
 *   2. `thesmos claude:govern check`   — run by Claude Code as a PreToolUse hook
 *   3. permissions.ts — preserves hooks when autopilot overwrites settings
 *
 * Hook behavior:
 *   - PreToolUse (Write/Edit): blocks if content has any BLOCKER finding → exit 2
 *   - PreToolUse (Bash): blocks npm install / pip install of known phantom packages
 *   - Stop: runs `thesmos drift` to catch adapter drift at session end
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { join, dirname, extname, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { activeRulesForTier } from './rules/registry.js';
import { categoryLabel } from './rule-labels.js';
import { loadConfig, CONFIG_DEFAULTS, ConfigLoadError } from './config.js';
import { classifySeverity, SEVERITY_ORDER } from './severity.js';
import { extractSuppressions, applySuppressions } from './suppress.js';
import { extractInstallPackages, quickPhantomCheck } from './import-scan.js';
import { checkScope, ScopeConfigError, type ScopeCheckInput, type ScopeViolation } from './scope.js';
import { runPostToolBudgetCheck, TOKEN_BUDGET_DEFAULTS } from './token-budget.js';
import {
  buildGuardInvocation,
  isThesmosGuardHookCommand,
  writeFailClosedDiagnostic,
  type GuardResolveFailureCategory,
} from './guard-resolve.js';
import type { ScanResult, DetectInput, Finding, Severity, ThesmosConfig } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const GOVERNANCE_VERSION = '1.0.0';
const GOVERNANCE_MARKER = '_thesmos_governance';

type HookCommandEntry = { type: 'command'; command: string; args?: string[] };
type PreToolUseEntry = { matcher: string; hooks: HookCommandEntry[] };
type SimpleHookEntry = { hooks: HookCommandEntry[] };
type HookRef = { command?: string; args?: string[]; type?: string };

function hookMatches(h: HookRef | undefined, kind: 'check' | 'budget-check' | 'drift'): boolean {
  return isThesmosGuardHookCommand(h?.command, kind, h?.args);
}

/** Resolve Node-direct hook command strings (absolute paths, no shell metacharacters). */
export function governanceHookCommands(): {
  check: string;
  budget: string;
  drift: string;
} {
  return {
    check: buildGuardInvocation('check').command,
    budget: buildGuardInvocation('budget-check').command,
    drift: buildGuardInvocation('drift', ['--quiet']).command,
  };
}

function getGovernanceHooks(cmds = governanceHookCommands()): {
  PreToolUse: PreToolUseEntry[];
  PostToolUse: SimpleHookEntry[];
  Stop: SimpleHookEntry[];
} {
  return {
    PreToolUse: [
      { matcher: 'Write', hooks: [{ type: 'command', command: cmds.check }] },
      { matcher: 'Edit', hooks: [{ type: 'command', command: cmds.check }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: cmds.check }] },
    ],
    PostToolUse: [{ hooks: [{ type: 'command', command: cmds.budget }] }],
    Stop: [{ hooks: [{ type: 'command', command: cmds.drift }] }],
  };
}

function refreshHookCommands(
  hooks: HookRef[] | undefined,
  kind: 'check' | 'budget-check' | 'drift',
  nextCommand: string,
): HookRef[] {
  return (hooks ?? []).map((h) =>
    hookMatches(h, kind) ? { type: 'command', command: nextCommand } : h,
  );
}

// Read-only tool patterns that are safe to auto-approve in any repo.
// Installed alongside governance hooks so every project gets prompt-free
// browser inspection (Playwright MCP) and TypeScript typechecks.
export const GOVERNANCE_PERMISSION_ALLOW = [
  'mcp__plugin_playwright_playwright__browser_navigate',
  'mcp__plugin_playwright_playwright__browser_take_screenshot',
  'mcp__plugin_playwright_playwright__browser_snapshot',
  'mcp__plugin_playwright_playwright__browser_resize',
  'mcp__plugin_playwright_playwright__browser_console_messages',
  'mcp__plugin_playwright_playwright__browser_close',
  'Bash(npx tsc --noEmit)',
];

// ── Status type ───────────────────────────────────────────────────────────────

export interface GovernanceHookStatus {
  installed: boolean;
  version: string | null;
  preToolUseWrite: boolean;
  preToolUseEdit: boolean;
  preToolUseBash: boolean;
  postToolUseBudget: boolean;
  stopDrift: boolean;
  settingsPath: string;
}

// ── Settings file helpers ─────────────────────────────────────────────────────

function settingsPath(root: string): string {
  return join(root, '.claude', 'settings.json');
}

function readSettings(root: string): Record<string, unknown> {
  const p = settingsPath(root);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(root: string, settings: Record<string, unknown>): void {
  const p = settingsPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// ── Install / uninstall ───────────────────────────────────────────────────────

export function installGovernanceHooks(root: string): void {
  const settings = readSettings(root);
  const merged = mergeGovernanceHooks(settings);
  writeSettings(root, merged);
}

export function uninstallGovernanceHooks(root: string): void {
  const settings = readSettings(root);
  const hooks = settings['hooks'] as Record<string, unknown[]> | undefined;
  if (!hooks) return;

  // Remove only the thesmos entries from PreToolUse
  if (Array.isArray(hooks['PreToolUse'])) {
    hooks['PreToolUse'] = (hooks['PreToolUse'] as unknown[]).filter((entry) => {
      const e = entry as { hooks?: HookRef[] };
      return !e.hooks?.some((h) => hookMatches(h, 'check'));
    });
    if (hooks['PreToolUse'].length === 0) delete hooks['PreToolUse'];
  }

  // Remove only the thesmos budget entry from PostToolUse
  if (Array.isArray(hooks['PostToolUse'])) {
    hooks['PostToolUse'] = (hooks['PostToolUse'] as unknown[]).filter((entry) => {
      const e = entry as { hooks?: HookRef[] };
      return !e.hooks?.some((h) => hookMatches(h, 'budget-check'));
    });
    if (hooks['PostToolUse'].length === 0) delete hooks['PostToolUse'];
  }

  // Remove only the thesmos drift entry from Stop
  if (Array.isArray(hooks['Stop'])) {
    hooks['Stop'] = (hooks['Stop'] as unknown[]).filter((entry) => {
      const e = entry as { hooks?: HookRef[] };
      return !e.hooks?.some((h) => hookMatches(h, 'drift'));
    });
    if (hooks['Stop'].length === 0) delete hooks['Stop'];
  }

  if (Object.keys(hooks).length === 0) delete settings['hooks'];
  delete settings[GOVERNANCE_MARKER];

  // Remove only the thesmos-managed permission entries from permissions.allow
  const perms = settings['permissions'] as Record<string, unknown> | undefined;
  if (perms && Array.isArray(perms['allow'])) {
    const filtered = (perms['allow'] as string[]).filter(
      (p) => !GOVERNANCE_PERMISSION_ALLOW.includes(p),
    );
    if (filtered.length === 0) {
      delete perms['allow'];
    } else {
      perms['allow'] = filtered;
    }
    if (Object.keys(perms).length === 0) delete settings['permissions'];
  }

  writeSettings(root, settings);
}

// ── Status ────────────────────────────────────────────────────────────────────

export function getGovernanceHooksStatus(root: string): GovernanceHookStatus {
  const settings = readSettings(root);
  const hooks = settings['hooks'] as Record<string, unknown[]> | undefined;
  const version = typeof settings[GOVERNANCE_MARKER] === 'string'
    ? settings[GOVERNANCE_MARKER] as string
    : null;

  const preToolUse  = (hooks?.['PreToolUse']  ?? []) as Array<{ matcher?: string; hooks?: HookRef[] }>;
  const postToolUse = (hooks?.['PostToolUse'] ?? []) as Array<{ hooks?: HookRef[] }>;
  const stop        = (hooks?.['Stop']        ?? []) as Array<{ hooks?: HookRef[] }>;

  const hasCheck = (matcher: string) =>
    preToolUse.some(
      (e) => e.matcher === matcher && e.hooks?.some((h) => hookMatches(h, 'check')),
    );

  const hasPostBudget = postToolUse.some((e) =>
    e.hooks?.some((h) => hookMatches(h, 'budget-check')),
  );
  const hasStopDrift = stop.some((e) =>
    e.hooks?.some((h) => hookMatches(h, 'drift')),
  );

  const installed = hasCheck('Write') && hasCheck('Edit') && hasCheck('Bash') && hasStopDrift;

  return {
    installed,
    version,
    preToolUseWrite:   hasCheck('Write'),
    preToolUseEdit:    hasCheck('Edit'),
    preToolUseBash:    hasCheck('Bash'),
    postToolUseBudget: hasPostBudget,
    stopDrift:         hasStopDrift,
    settingsPath:      settingsPath(root),
  };
}

// ── Auto Mode governance info ─────────────────────────────────────────────────

export interface AutoModeGovernanceInfo {
  governed: boolean;
  hooksInstalled: GovernanceHookStatus;
  blockOn: string;
  strictMode: boolean;
  message: string;
}

/**
 * Returns a summary of Auto Mode governance status for MCP / VS Code use.
 * Called by the `get_governance_status` MCP tool and the VS Code autoModeGovernor.
 */
export function getAutoModeGovernanceInfo(root: string, config?: Record<string, unknown>): AutoModeGovernanceInfo {
  const status = getGovernanceHooksStatus(root);
  const autoModeCfg = (config?.['autoMode'] ?? {}) as Record<string, unknown>;
  const enabled    = autoModeCfg['enabled']     !== false;
  const strictMode = autoModeCfg['strictMode']  !== false;
  // Fall back to BLOCKER to match evaluateGovernFindings' real behavior — strictMode
  // is reserved and no longer drives the block threshold. Reporting HIGH here would
  // overstate what the hook actually blocks on.
  const blockOn    = (autoModeCfg['blockOn'] as string | undefined) ?? 'BLOCKER';
  const governed   = enabled && status.installed;

  const message = governed
    ? `Auto Mode is governed — Thesmos blocks ${blockOn}+ violations before every Write/Edit/Bash.`
    : status.installed
      ? 'Hooks installed but autoMode.enabled is false — Auto Mode is not governed.'
      : 'Auto Mode is NOT governed. Run: thesmos claude:govern install';

  return { governed, hooksInstalled: status, blockOn, strictMode, message };
}

// ── Merge / extract (used by permissions.ts to preserve hooks) ────────────────

/**
 * Merges governance hooks into an existing settings object (non-destructive).
 * Called by autopilot's writePermissionProfile to preserve hooks across sessions.
 */
export function mergeGovernanceHooks(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...settings };
  const existing = (result['hooks'] as Record<string, unknown[]> | undefined) ?? {};
  const merged: Record<string, unknown[]> = { ...existing };
  const cmds = governanceHookCommands();
  const governanceHooks = getGovernanceHooks(cmds);

  // Merge PreToolUse — refresh legacy npx commands to Node-direct; dedupe by matcher
  const existingPre = (merged['PreToolUse'] ?? []) as Array<{
    matcher?: string;
    hooks?: HookRef[];
  }>;
  for (const entry of governanceHooks.PreToolUse) {
    const idx = existingPre.findIndex(
      (e) =>
        e.matcher === entry.matcher &&
        e.hooks?.some((h) => hookMatches(h, 'check')),
    );
    if (idx >= 0) {
      existingPre[idx]!.hooks = refreshHookCommands(existingPre[idx]!.hooks, 'check', cmds.check);
    } else {
      existingPre.push(entry);
    }
  }
  merged['PreToolUse'] = existingPre;

  // Merge PostToolUse — refresh or append budget hook
  const existingPost = (merged['PostToolUse'] ?? []) as Array<{
    hooks?: HookRef[];
  }>;
  const postIdx = existingPost.findIndex((e) =>
    e.hooks?.some((h) => hookMatches(h, 'budget-check')),
  );
  if (postIdx >= 0) {
    existingPost[postIdx]!.hooks = refreshHookCommands(
      existingPost[postIdx]!.hooks,
      'budget-check',
      cmds.budget,
    );
  } else {
    existingPost.push(...governanceHooks.PostToolUse);
  }
  merged['PostToolUse'] = existingPost;

  // Merge Stop — refresh or append drift hook (no 2>&1 || true)
  const existingStop = (merged['Stop'] ?? []) as Array<{
    hooks?: HookRef[];
  }>;
  const stopIdx = existingStop.findIndex((e) =>
    e.hooks?.some((h) => hookMatches(h, 'drift')),
  );
  if (stopIdx >= 0) {
    existingStop[stopIdx]!.hooks = refreshHookCommands(
      existingStop[stopIdx]!.hooks,
      'drift',
      cmds.drift,
    );
  } else {
    existingStop.push(...governanceHooks.Stop);
  }
  merged['Stop'] = existingStop;

  result['hooks'] = merged;
  result[GOVERNANCE_MARKER] = GOVERNANCE_VERSION;

  // Merge permissions.allow — add read-only tool patterns, preserving existing entries
  const existingPerms = (result['permissions'] as Record<string, unknown> | undefined) ?? {};
  const existingAllow = (existingPerms['allow'] as string[] | undefined) ?? [];
  const toAdd = GOVERNANCE_PERMISSION_ALLOW.filter((p) => !existingAllow.includes(p));
  if (toAdd.length > 0) {
    result['permissions'] = { ...existingPerms, allow: [...existingAllow, ...toAdd] };
  }

  return result;
}

/**
 * Extracts only the governance-related hooks from a settings object.
 * Returns the hooks sub-object, or null if no governance hooks are present.
 * Used by permissions.ts to pull hooks out of existing settings before overwriting.
 */
export function extractGovernanceHooks(
  settings: Record<string, unknown>,
): Record<string, unknown[]> | null {
  const hooks = settings['hooks'] as Record<string, unknown[]> | undefined;
  if (!hooks) return null;

  const preToolUse = ((hooks['PreToolUse'] ?? []) as Array<{ hooks?: HookRef[] }>).filter((e) =>
    e.hooks?.some((h) => hookMatches(h, 'check')),
  );
  const postToolUse = ((hooks['PostToolUse'] ?? []) as Array<{ hooks?: HookRef[] }>).filter((e) =>
    e.hooks?.some((h) => hookMatches(h, 'budget-check')),
  );
  const stop = ((hooks['Stop'] ?? []) as Array<{ hooks?: HookRef[] }>).filter((e) =>
    e.hooks?.some((h) => hookMatches(h, 'drift')),
  );

  if (preToolUse.length === 0 && postToolUse.length === 0 && stop.length === 0) return null;

  const extracted: Record<string, unknown[]> = {};
  if (preToolUse.length  > 0) extracted['PreToolUse']  = preToolUse;
  if (postToolUse.length > 0) extracted['PostToolUse'] = postToolUse;
  if (stop.length        > 0) extracted['Stop']        = stop;
  return extracted;
}

// ── PreToolUse hook check (stdin → exit 0 or exit 2) ─────────────────────────

/** Minimal ScanResult skeleton — rules read from changedFiles, not scan metadata. */
function emptyScan(): ScanResult {
  return {
    _generatedSections: [],
    generatedAt: new Date().toISOString(),
    scanVersion: '0',
    pages: [],
    apiRoutes: [],
    componentCount: 0,
    sharedUiFiles: [],
    designSystemFiles: [],
    storeFiles: [],
    testFiles: [],
    largeFiles: [],
    riskyFiles: [],
    scriptFiles: [],
    envFiles: [],
    clientBoundaryRisks: [],
    languages: [],
    detectedStacks: [],
  };
}

// ── Write/Edit content evaluation ─────────────────────────────────────────────

/**
 * Evaluate file content against the governance rules and return the findings
 * that should block the write. Pure — no process.exit, no filesystem.
 *
 * Honors the same exception mechanisms as `thesmos review`:
 *   - config.severityRules overrides (a downgraded rule no longer blocks;
 *     an upgraded rule starts blocking)
 *   - inline `// thesmos-disable-next-line <rule> -- reason: ...` suppressions
 *   - config.autoMode.blockOn threshold (default: BLOCKER only)
 */
export function evaluateGovernFindings(input: {
  filePath: string;
  content: string;
  config: ThesmosConfig;
}): Finding[] {
  const { filePath, content, config } = input;

  const blockOn: Severity = config.autoMode?.blockOn ?? 'BLOCKER';
  const threshold = SEVERITY_ORDER.indexOf(blockOn);
  const blocksAt = (sev: Severity): boolean => SEVERITY_ORDER.indexOf(sev) <= threshold;

  // A rule can block if its effective severity (config override, else static)
  // reaches the threshold. Rules that classify their own finding severity are
  // re-checked by the finding-level filter below.
  const rules = activeRulesForTier(config).filter(
    (r) => blocksAt(classifySeverity(r.category, config.severityRules)) || blocksAt(r.severity),
  );

  const detectInput: DetectInput = {
    scan: emptyScan(),
    config,
    changedFiles: [{ path: filePath, content }],
  };

  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      findings.push(...rule.detect(detectInput));
    } catch {
      // rule failed — skip it, never block on error
    }
  }

  // Finding-level severity filter — this is what makes severityRules downgrades stick.
  const blocking = findings.filter((f) => blocksAt(f.severity));

  // Inline suppressions: same syntax and semantics as thesmos review.
  const suppressions = extractSuppressions(content, filePath);
  if (suppressions.length === 0) return blocking;
  return applySuppressions(blocking, suppressions, new Date()).activeFindings;
}

/** True when autoMode.failClosed is enabled (default). Explicit false opts out. */
export function isFailClosed(config: ThesmosConfig = CONFIG_DEFAULTS): boolean {
  return config.autoMode?.failClosed !== false;
}

/**
 * Load project config for guard paths. Malformed config always blocks (cannot
 * trust an opt-out written in a broken file) — except a Write/Edit that repairs
 * the config file itself (see {@link isThesmosConfigRepairTarget}). Missing
 * config → defaults.
 */
function loadGuardConfig(root: string): ThesmosConfig {
  return loadConfig(root, undefined, { strict: true });
}

/** Canonicalize a directory (resolving symlinks). null if it does not exist. */
function realDir(dir: string): string | null {
  try {
    return realpathSync(dir);
  } catch {
    return null;
  }
}

/**
 * Decide whether a Write/Edit targets the broken `.thesmos/config.json` so the
 * agent can self-heal a fail-closed deadlock — WITHOUT opening an arbitrary
 * write path. Only this exact file is ever granted the exception.
 *
 * Threat-modeled comparison (why the final match is safe):
 *  1. Basename must be exactly `config.json` (case-exact). A differently-cased
 *     spelling fails safe (blocks) rather than matching a different real file.
 *  2. The target's PARENT directory and the config's parent directory must
 *     resolve (realpath, so symlinked dirs are canonicalized) to the SAME real
 *     directory — this collapses `..`, `.`, separators and relative/absolute
 *     spellings while refusing paths that merely *look* similar.
 *  3. The config file itself must NOT be a symlink — repairing through a
 *     symlink would follow the link and could clobber a file outside
 *     `.thesmos` (e.g. a planted `config.json → /etc/cron.d/x`).
 *
 * Invalid project `package.json` is unrelated — Guard never fail-closes on it,
 * so it never reaches this helper.
 *
 * @param root project root the guard resolved config from
 * @param filePath the Write/Edit `file_path` (relative or absolute)
 * @param brokenConfigPath the path the ConfigLoadError reported, when known
 */
export function isThesmosConfigRepairTarget(
  root: string,
  filePath: string,
  brokenConfigPath?: string,
): boolean {
  if (!filePath || !filePath.trim()) return false;

  const targetAbs = resolve(root, filePath);
  if (basename(targetAbs) !== 'config.json') return false; // (1) exact basename

  const configAbs = brokenConfigPath
    ? resolve(brokenConfigPath)
    : resolve(root, '.thesmos', 'config.json');
  if (basename(configAbs) !== 'config.json') return false;

  // (2) parent directories must be the SAME real directory
  const targetDir = realDir(dirname(targetAbs));
  const configDir = realDir(dirname(configAbs));
  if (targetDir === null || configDir === null) return false;
  if (targetDir !== configDir) return false;

  // (3) refuse to repair through a symlinked config file
  try {
    if (lstatSync(targetAbs).isSymbolicLink()) return false;
  } catch {
    // Target does not exist yet — no link to follow, allowed.
  }
  return true;
}

function exitInfraFailure(
  what: string,
  category: GuardResolveFailureCategory,
  failClosed: boolean,
  guardPath?: string,
): never {
  if (failClosed) {
    writeFailClosedDiagnostic({ what, category, guardPath });
    process.exit(2);
  }
  process.exit(0);
}

/**
 * checkScope() throws ScopeConfigError when `.thesmos/scope.json` EXISTS but
 * fails to parse — a present-but-corrupt scope file must fail closed (an
 * explainable infrastructure error), never silently degrade to "no scope
 * config, allow everything" the way a missing file legitimately does.
 */
function safeCheckScope(input: ScopeCheckInput, failClosed: boolean): ScopeViolation | null {
  try {
    return checkScope(input);
  } catch (err) {
    if (err instanceof ScopeConfigError) {
      exitInfraFailure(err.message, 'internal', failClosed, err.scopePath);
    }
    throw err;
  }
}

/**
 * Short correlation id for tying a hook's stdout decision to whatever this
 * same invocation writes to a debug log or reports back to the user — the
 * PreToolUse JSON schema has no dedicated correlation field (verified
 * against the current protocol; see module doc below), so it's embedded in
 * the human-readable reason text instead of invented as a fake schema
 * field. Uses crypto.randomUUID(), matching this codebase's own convention
 * for every other generated id (see agent-lifecycle.ts, execution-receipt.ts).
 */
function makeCorrelationId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Surface a scope violation to Claude Code as a real "ask" decision — the CLI
 * prompts the user to approve or deny, and either answer is recoverable —
 * instead of exit(2), which Claude Code treats identically to a hard BLOCKER
 * (no distinction between "needs a human nod" and "forbidden outright").
 *
 * Verified against the current PreToolUse hook JSON schema
 * (https://code.claude.com/docs/en/hooks, `docs.claude.com` redirects there):
 * only `hookSpecificOutput.{hookEventName,permissionDecision,
 * permissionDecisionReason,updatedInput,additionalContext}` are recognized
 * for PreToolUse; there is no dedicated correlation-id field, so one is
 * embedded in `permissionDecisionReason` instead (see makeCorrelationId).
 *
 * Exit-code discipline per the same doc: "exit 0 and print JSON" and "use
 * exit codes alone" are two DIFFERENT signaling modes that must not be
 * mixed — exit 2 makes Claude Code ignore stdout (and any JSON in it)
 * entirely, so every hard-block path in this file (still) uses exit(2) +
 * stderr, and only this "ask" path uses exit 0 + stdout JSON.
 *
 * Does NOT call process.exit() itself — on POSIX, stdout writes to a pipe
 * (which is what a hook's stdout is, from Claude Code's perspective) are
 * ASYNCHRONOUS, so an immediate process.exit() after write() can truncate
 * the JSON before it's flushed, corrupting the hook's own output. Callers
 * must `return` immediately after invoking this so the process exits
 * naturally (via `exitCode`) once the event loop drains and the write
 * actually completes — never call process.exit() after this returns.
 */
function emitAskDecision(reason: string): void {
  const correlationId = makeCorrelationId();
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'ask' as const,
      permissionDecisionReason: `${reason} [ref: ${correlationId}]`,
    },
  };
  // Exactly one write, and nothing else touches stdout in this code path —
  // any other output here would risk corrupting the JSON Claude Code parses.
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exitCode = 0;
}

/**
 * Run by Claude Code as a PreToolUse hook.
 * Reads tool input from stdin, scans file content for BLOCKER violations.
 * Exits 2 (block) if any found; exits 0 (allow) otherwise.
 * Infrastructure failures exit 2 when autoMode.failClosed is true (default).
 */
export async function runPreToolCheck(root: string): Promise<void> {
  let failClosed = isFailClosed(CONFIG_DEFAULTS);
  let config = CONFIG_DEFAULTS;
  /**
   * When set, `.thesmos/config.json` is malformed — everything blocks EXCEPT a
   * Write/Edit that repairs this exact file (fail-closed self-heal hatch).
   * Deferred (not exited immediately) so we can inspect the tool payload.
   */
  let brokenConfigPath: string | undefined;
  try {
    // Load config early so failClosed:false can opt out of infra blocks
    // (malformed stdin, etc.). Broken config blocks everything except a
    // Write/Edit repair of `.thesmos/config.json` itself.
    try {
      config = loadGuardConfig(root);
      failClosed = isFailClosed(config);
    } catch (err) {
      if (err instanceof ConfigLoadError) {
        // Defer the block: capture the broken path, keep fail-closed defaults,
        // and decide below once we know whether this is a repair Write/Edit.
        brokenConfigPath = err.configPath;
        config = CONFIG_DEFAULTS;
        failClosed = true;
      } else {
        exitInfraFailure(
          `Config load failed: ${err instanceof Error ? err.message : String(err)}`,
          'internal',
          failClosed,
        );
      }
    }

    let raw = '';
    try {
      raw = await readStdin();
    } catch (err) {
      exitInfraFailure(
        `Could not read hook stdin: ${err instanceof Error ? err.message : String(err)}`,
        'internal',
        failClosed,
      );
    }

    // Empty / TTY stdin: no tool payload — allow (not an infrastructure failure)
    if (!raw.trim()) process.exit(0);

    let input: { tool_name?: string; tool_input?: Record<string, unknown> };
    try {
      input = JSON.parse(raw) as typeof input;
    } catch {
      exitInfraFailure(
        'Hook stdin was not valid JSON (unparseable PreToolUse payload)',
        'internal',
        failClosed,
      );
    }

    const toolName = input.tool_name;
    const toolInput = input.tool_input ?? {};
    const filePathEarly =
      typeof toolInput['file_path'] === 'string' ? toolInput['file_path'] : '';

    // Broken `.thesmos/config.json`: allow ONLY a Write/Edit that repairs that
    // exact file so the agent can self-heal. Everything else stays blocked.
    // The repair still falls through to the content scan below (via
    // CONFIG_DEFAULTS), so a malicious "repair" payload carrying a secret or
    // other BLOCKER is still rejected. Invalid project package.json never
    // reaches here — Guard does not fail-closed on it.
    if (brokenConfigPath) {
      const repairing =
        (toolName === 'Write' || toolName === 'Edit') &&
        isThesmosConfigRepairTarget(root, filePathEarly, brokenConfigPath);
      if (!repairing) {
        exitInfraFailure(
          `Config unreadable or malformed: ${brokenConfigPath}. ` +
            `Repair path: Write/Edit that file is allowed; other tools stay blocked. ` +
            `(Invalid project package.json does not cause this — fix .thesmos/config.json.)`,
          'internal',
          true,
        );
      }
      // Fall through — content scan still runs so secrets/BLOCKERs in the
      // "repair" payload are caught even while config is broken.
    }

    // ── Bash hook: scope check + phantom package detection ──────────────────────
    if (toolName === 'Bash') {
      const command = typeof toolInput['command'] === 'string' ? toolInput['command'] : '';
      if (!command.trim()) process.exit(0);

      // Scope enforcement first
      const scopeViolation = safeCheckScope({ toolName: 'Bash', command, root }, failClosed);
      if (scopeViolation) {
        if (scopeViolation.type === 'requires_confirmation') {
          emitAskDecision(`${scopeViolation.message} ${scopeViolation.suggestion}`);
          return;
        }
        const lines: string[] = ['🛑 Thesmos scope violation:\n'];
        lines.push(`  ${scopeViolation.message}`);
        lines.push(`  → ${scopeViolation.suggestion}`);
        // Claude Code only surfaces stderr for blocking hooks (exit 2)
        process.stderr.write(lines.join('\n') + '\n');
        process.exit(2);
      }

      // Phantom package check for npm/pip installs
      const packages = extractInstallPackages(command);
      if (packages.length > 0) {
        const phantomFindings = quickPhantomCheck(packages);
        if (phantomFindings.length > 0) {
          const lines: string[] = ['🚫 Thesmos blocked this install — phantom package detected:\n'];
          for (const f of phantomFindings) {
            lines.push(`  [${f.severity}] ${f.reason}`);
            lines.push(`  Fix:  ${f.suggestion}`);
            lines.push('');
          }
          lines.push('Run `thesmos import:scan` to validate all package imports.');
          process.stderr.write(lines.join('\n'));
          process.exit(2);
        }
      }

      process.exit(0);
    }

    // Unknown tool names are not infrastructure failures — allow
    if (toolName !== 'Write' && toolName !== 'Edit') process.exit(0);

    const filePath = filePathEarly;
    if (!filePath) process.exit(0);

    // Scope enforcement for Write/Edit. Skipped during config repair so a
    // locked-down scope.json cannot re-deadlock the only recovery path — the
    // content scan below still runs on the repair payload.
    if (!brokenConfigPath) {
      const writeScopeViolation = safeCheckScope({ toolName, filePath, root }, failClosed);
      if (writeScopeViolation) {
        if (writeScopeViolation.type === 'requires_confirmation') {
          emitAskDecision(`${writeScopeViolation.message} ${writeScopeViolation.suggestion}`);
          return;
        }
        const lines: string[] = ['🛑 Thesmos scope violation:\n'];
        lines.push(`  ${writeScopeViolation.message}`);
        lines.push(`  → ${writeScopeViolation.suggestion}`);
        process.stderr.write(lines.join('\n') + '\n');
        process.exit(2);
      }
    }

    // For Write: scan full content. For Edit: scan only the new_string being introduced.
    const content =
      toolName === 'Write'
        ? (typeof toolInput['content'] === 'string' ? toolInput['content'] : '')
        : (typeof toolInput['new_string'] === 'string' ? toolInput['new_string'] : '');

    if (!content.trim()) process.exit(0);

    // Ignore unrecognized file types (binary, lock files, etc.)
    const ext = extname(filePath).toLowerCase();
    const KNOWN_EXTS = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.go', '.rb', '.rs', '.java', '.kt', '.swift',
      '.graphql', '.gql', '.tf', '.tfvars',
      '.vue', '.svelte', '.astro',
      '.json', '.yaml', '.yml', '.toml',
      '.sh', '.bash', '.zsh',
      '.env', '.env.local', '.env.production',
    ]);
    if (ext && !KNOWN_EXTS.has(ext)) process.exit(0);

    const findings = evaluateGovernFindings({ filePath, content, config });

    if (findings.length === 0) process.exit(0);

    // Format block message for Claude Code to show to the user
    const lines: string[] = ['🚫 Thesmos blocked this write — BLOCKER violation(s) found:\n'];
    for (const f of findings) {
      lines.push(`  [${categoryLabel(f.category)}]`);
      lines.push(`  ${f.message}`);
      if (f.line) lines.push(`  File: ${f.file}:${f.line}`);
      if (f.suggestion) lines.push(`  Fix:  ${f.suggestion}`);
      lines.push('');
    }
    lines.push('Resolve the violation(s) above before writing this file.');

    process.stderr.write(lines.join('\n'));
    process.exit(2);
  } catch (err) {
    exitInfraFailure(
      `Internal guard exception: ${err instanceof Error ? err.message : String(err)}`,
      'internal',
      failClosed,
    );
  }
}

// ── PostToolUse hook: token budget enforcement ────────────────────────────────

/**
 * Run by Claude Code as a PostToolUse hook.
 * Reads tool response from stdin, logs token usage, checks budgets.
 * Exits 2 (hard stop) when any budget is exhausted.
 * Infrastructure failures exit 2 when autoMode.failClosed is true (default).
 */
export async function runPostToolBudgetHook(root: string): Promise<void> {
  let failClosed = isFailClosed(CONFIG_DEFAULTS);
  let budgetConfig = TOKEN_BUDGET_DEFAULTS;

  try {
    try {
      const projectConfig = loadGuardConfig(root);
      failClosed = isFailClosed(projectConfig);
      if (projectConfig.tokenBudget) {
        budgetConfig = { ...TOKEN_BUDGET_DEFAULTS, ...projectConfig.tokenBudget };
      }
    } catch (err) {
      if (err instanceof ConfigLoadError) {
        exitInfraFailure(
          `Config unreadable or malformed: ${err.configPath}`,
          'internal',
          true,
        );
      }
      exitInfraFailure(
        `Config load failed: ${err instanceof Error ? err.message : String(err)}`,
        'internal',
        failClosed,
      );
    }

    await runPostToolBudgetCheck(root, budgetConfig);
  } catch (err) {
    exitInfraFailure(
      `Budget gate failed: ${err instanceof Error ? err.message : String(err)}`,
      'internal',
      failClosed,
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
