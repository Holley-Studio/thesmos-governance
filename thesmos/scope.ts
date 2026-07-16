// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agent Scope Enforcement — blast radius limiter for Claude Code Auto Mode.
 *
 * Reads .thesmos/scope.json (or defaults) and validates every Write/Edit/Bash
 * tool call against defined workspace boundaries and operation limits.
 *
 * Exit codes (used by the claude:govern PreToolUse hook):
 *   0 — allowed
 *   2 — blocked (scope violation)
 *
 * Scope config is loaded from .thesmos/scope.json. If no file exists, all
 * operations are allowed (safe default: don't block when unconfigured).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import {
  isClaudeAgentsPath,
  isManagedPath,
  loadManagedManifest,
  normalizeRelPath,
} from './agent-ownership.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScopeWorkspace {
  /** Paths the agent may read and write (relative to project root). */
  allowedPaths: string[];
  /** Paths the agent must never touch (relative or absolute). */
  blockedPaths: string[];
  /** Absolute paths that are always blocked regardless of allowedPaths. */
  absoluteBlockPaths: string[];
}

export interface ScopeOperations {
  /** Whether the agent may delete files (rm, unlink). Default: false. */
  allowDelete: boolean;
  /** Whether the agent may push to git. Default: false. */
  allowGitPush: boolean;
  /** Allowed external hostnames for network calls. Empty = all blocked. */
  allowNetworkHosts: string[];
  /** Whether the agent may run database write commands. Default: false. */
  allowDatabaseWrites: boolean;
  /** Commands requiring human confirmation — scope check exits 2 with advisory. */
  requireConfirmation: string[];
}

export interface ScopeConfig {
  version: string;
  workspace: ScopeWorkspace;
  operations: ScopeOperations;
  destructivePatterns: string[];
}

export interface ScopeViolation {
  type: 'blocked_path' | 'destructive_command' | 'requires_confirmation' | 'absolute_blocked_path';
  message: string;
  suggestion: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const SCOPE_DEFAULTS: ScopeConfig = {
  version: '1.0',
  workspace: {
    allowedPaths: [],
    blockedPaths: ['node_modules/', '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx'],
    absoluteBlockPaths: ['/etc/', '/usr/', '/bin/', '/sbin/', '/System/', '/Library/'],
  },
  operations: {
    allowDelete: false,
    allowGitPush: false,
    allowNetworkHosts: [],
    allowDatabaseWrites: false,
    requireConfirmation: ['git push', 'npm publish', 'db migrate', 'database migrate'],
  },
  destructivePatterns: [
    'rm -rf',
    'rm -r /',
    'DROP TABLE',
    'DELETE FROM',
    'TRUNCATE',
    'truncate -s 0',
    'mkfs',
    '> /dev/',
    'format ',
    ':(){:|:&};:',
    'dd if=',
    'chmod 777 /',
    'chown -R',
  ],
};

const SCOPE_FILE = '.thesmos/scope.json';

// ── Load / save ───────────────────────────────────────────────────────────────

export function loadScopeConfig(root: string): ScopeConfig | null {
  const scopePath = join(root, SCOPE_FILE);
  if (!existsSync(scopePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(scopePath, 'utf8')) as Partial<ScopeConfig>;
    return mergeScopeConfig(raw);
  } catch {
    return null;
  }
}

function mergeScopeConfig(partial: Partial<ScopeConfig>): ScopeConfig {
  return {
    version: partial.version ?? SCOPE_DEFAULTS.version,
    workspace: {
      allowedPaths: partial.workspace?.allowedPaths ?? SCOPE_DEFAULTS.workspace.allowedPaths,
      blockedPaths: partial.workspace?.blockedPaths ?? SCOPE_DEFAULTS.workspace.blockedPaths,
      absoluteBlockPaths: partial.workspace?.absoluteBlockPaths ?? SCOPE_DEFAULTS.workspace.absoluteBlockPaths,
    },
    operations: {
      allowDelete: partial.operations?.allowDelete ?? SCOPE_DEFAULTS.operations.allowDelete,
      allowGitPush: partial.operations?.allowGitPush ?? SCOPE_DEFAULTS.operations.allowGitPush,
      allowNetworkHosts: partial.operations?.allowNetworkHosts ?? SCOPE_DEFAULTS.operations.allowNetworkHosts,
      allowDatabaseWrites: partial.operations?.allowDatabaseWrites ?? SCOPE_DEFAULTS.operations.allowDatabaseWrites,
      requireConfirmation: partial.operations?.requireConfirmation ?? SCOPE_DEFAULTS.operations.requireConfirmation,
    },
    destructivePatterns: partial.destructivePatterns ?? SCOPE_DEFAULTS.destructivePatterns,
  };
}

export function saveScopeConfig(root: string, config: ScopeConfig): void {
  const scopePath = join(root, SCOPE_FILE);
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  writeFileSync(scopePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ── Path matching ─────────────────────────────────────────────────────────────

function isPathAllowed(filePath: string, root: string, config: ScopeConfig): ScopeViolation | null {
  const absPath = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const relPath = relative(root, absPath);
  const relNorm = normalizeRelPath(relPath.replace(/\\/g, '/'));

  // Check absolute block paths first (always blocked, regardless of allow list)
  for (const blocked of config.workspace.absoluteBlockPaths) {
    if (absPath.startsWith(blocked) || absPath === blocked) {
      return {
        type: 'absolute_blocked_path',
        message: `Path "${filePath}" is in an always-blocked system directory "${blocked}".`,
        suggestion: 'This path is outside the project workspace. Confirm this operation is intentional.',
      };
    }
  }

  // Federated agents: Thesmos governs execution, not existence.
  // External agents under .claude/agents/ may be created freely.
  // Only explicitly managed files are write-protected.
  if (isClaudeAgentsPath(relNorm)) {
    let managed = false;
    try {
      const manifest = loadManagedManifest(root);
      managed = isManagedPath(manifest, relNorm);
    } catch {
      managed = false;
    }
    if (managed) {
      return {
        type: 'blocked_path',
        message:
          `Path "${filePath}" is a Thesmos-managed agent file. ` +
          `Direct edits are blocked so adapter sync does not lose ownership metadata.`,
        suggestion:
          `Update the canonical source under .thesmos/agents/ and run \`thesmos adapters\`, ` +
          `or run \`thesmos agent:release <agent-id>\` to stop managing this file before editing it directly.`,
      };
    }
    // Unmanaged / external agent path — allow even when `.claude/` is blocked
    // and even when allowedPaths would otherwise exclude it.
    return null;
  }

  // Check blocked paths (glob-style prefix matching)
  for (const blocked of config.workspace.blockedPaths) {
    const pattern = blocked.replace(/\./g, '\\.').replace(/\*/g, '.*');
    const re = new RegExp(`^${pattern}`);
    if (re.test(relPath) || re.test(filePath) || re.test(relNorm)) {
      // Provide targeted, path-specific guidance for each canonical authoring surface.
      const SKILL_SURFACE   = '.claude/skills/';
      const COMMAND_SURFACE = '.claude/commands/';
      const isSkillPath   = relNorm.startsWith(SKILL_SURFACE)   || filePath.includes(SKILL_SURFACE);
      const isCommandPath = relNorm.startsWith(COMMAND_SURFACE) || filePath.includes(COMMAND_SURFACE);

      let suggestion: string;
      if (isSkillPath) {
        suggestion =
          `Author the skill outside .claude/skills/ and run \`thesmos skill:create\` ` +
          `or \`thesmos adapters\` to synchronize platform skill files.`;
      } else if (isCommandPath) {
        suggestion =
          `There is no Thesmos-managed installer for .claude/commands/ files. ` +
          `Handle this file outside the governed agent session, or add its path to ` +
          `\`allowedPaths\` in .thesmos/scope.json.`;
      } else {
        suggestion =
          `Edit .thesmos/scope.json to allow this path if needed, or handle this file outside the agent session.`;
      }
      return {
        type: 'blocked_path',
        message: `Path "${filePath}" matches blocked pattern "${blocked}".`,
        suggestion,
      };
    }
  }

  // If allowedPaths is non-empty, check the file is within them
  if (config.workspace.allowedPaths.length > 0) {
    const isAllowed = config.workspace.allowedPaths.some((allowed) => {
      const norm = allowed.endsWith('/') ? allowed : allowed + '/';
      return relNorm.startsWith(normalizeRelPath(norm)) || relNorm === normalizeRelPath(allowed) ||
        relPath.startsWith(norm) || relPath === allowed;
    });
    if (!isAllowed) {
      return {
        type: 'blocked_path',
        message: `Path "${filePath}" is outside the allowed workspace paths [${config.workspace.allowedPaths.join(', ')}].`,
        suggestion: `Add "${relPath}" to allowedPaths in .thesmos/scope.json, or restrict the agent's task to files within the allowed scope.`,
      };
    }
  }

  return null;
}

// ── Command checking ──────────────────────────────────────────────────────────

function checkCommand(command: string, config: ScopeConfig): ScopeViolation | null {
  const cmd = command.trim().toLowerCase();

  // Check destructive patterns
  for (const pattern of config.destructivePatterns) {
    if (cmd.includes(pattern.toLowerCase())) {
      return {
        type: 'destructive_command',
        message: `Command contains a destructive pattern "${pattern}".`,
        suggestion: 'Thesmos scope enforcement blocked this command. If this is intentional, run it manually outside the agent session.',
      };
    }
  }

  // Check delete operations
  if (!config.operations.allowDelete) {
    if (/\brm\s+(?:-[a-z]*f[a-z]*\s+)?\S/.test(cmd) && !/\brm\s+--/.test(cmd)) {
      // Allow `rm --help` style, block actual deletion
      const isHelp = cmd.includes('--help') || cmd.includes('-h');
      if (!isHelp) {
        return {
          type: 'destructive_command',
          message: 'File deletion is not allowed in the current scope.',
          suggestion: 'Set operations.allowDelete to true in .thesmos/scope.json to enable file deletion, or delete manually.',
        };
      }
    }
  }

  // Check git push
  if (!config.operations.allowGitPush && /\bgit\s+push\b/.test(cmd)) {
    return {
      type: 'destructive_command',
      message: 'git push is not allowed in the current scope.',
      suggestion: 'Set operations.allowGitPush to true in .thesmos/scope.json, or push manually after reviewing the changes.',
    };
  }

  // Check database writes
  if (!config.operations.allowDatabaseWrites) {
    const dbWritePatterns = [/\bdrop\s+table\b/i, /\bdelete\s+from\b/i, /\btruncate\s+/i, /\balter\s+table\b/i];
    for (const re of dbWritePatterns) {
      if (re.test(command)) {
        return {
          type: 'destructive_command',
          message: 'Database write operation is not allowed in the current scope.',
          suggestion: 'Set operations.allowDatabaseWrites to true in .thesmos/scope.json, or run database commands manually.',
        };
      }
    }
  }

  // Check requireConfirmation list
  for (const pattern of config.operations.requireConfirmation) {
    if (cmd.includes(pattern.toLowerCase())) {
      return {
        type: 'requires_confirmation',
        message: `Command "${pattern}" requires human confirmation before proceeding.`,
        suggestion: 'Run this command manually after reviewing the agent\'s changes, or add it to an exception in .thesmos/scope.json.',
      };
    }
  }

  return null;
}

// ── Main check function ───────────────────────────────────────────────────────

export interface ScopeCheckInput {
  toolName: string;
  filePath?: string;
  command?: string;
  root: string;
}

export function checkScope(input: ScopeCheckInput): ScopeViolation | null {
  const { toolName, filePath, command, root } = input;
  const config = loadScopeConfig(root);

  // No scope config = allow all (safe default)
  if (!config) return null;

  if ((toolName === 'Write' || toolName === 'Edit') && filePath) {
    return isPathAllowed(filePath, root, config);
  }

  if (toolName === 'Bash' && command) {
    // Check path-based concerns in command (heuristic: look for file paths)
    const pathViolation = checkCommand(command, config);
    return pathViolation;
  }

  return null;
}

// ── Status ────────────────────────────────────────────────────────────────────

export interface ScopeStatus {
  configured: boolean;
  scopeFilePath: string;
  config: ScopeConfig | null;
  allowedPaths: string[];
  blockedPaths: string[];
  allowDelete: boolean;
  allowGitPush: boolean;
}

export function getScopeStatus(root: string): ScopeStatus {
  const config = loadScopeConfig(root);
  const scopeFilePath = join(root, SCOPE_FILE);
  return {
    configured: config !== null,
    scopeFilePath,
    config,
    allowedPaths: config?.workspace.allowedPaths ?? [],
    blockedPaths: config?.workspace.blockedPaths ?? [],
    allowDelete: config?.operations.allowDelete ?? false,
    allowGitPush: config?.operations.allowGitPush ?? false,
  };
}
