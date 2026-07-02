// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * VSCode / Claude Code permission profile management.
 *
 * When autopilot starts, it writes a temporary .claude/settings.json that
 * auto-approves all operations needed during the session (Bash, Read, Write, Edit).
 * This eliminates permission prompts while Claude Code is running unattended.
 *
 * On session end (normal, cancel, or crash), the original settings are restored.
 * Crash recovery: if _autopilot_restore is present in settings.json on next run,
 * Thesmos automatically restores the backup before doing anything else.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { extractGovernanceHooks, mergeGovernanceHooks, GOVERNANCE_VERSION } from '../claude-govern.js';

const PERMISSION_ALLOW = [
  'Bash(git *)',
  'Bash(npm *)',
  'Bash(npx *)',
  'Bash(node *)',
  'Bash(claude *)',
  'Bash(thesmos *)',
  'Read(**)',
  'Write(**)',
  'Edit(**)',
];

// ── Settings file location ────────────────────────────────────────────────────

export function findClaudeSettingsPath(root: string): string {
  // Prefer workspace-level .claude/settings.json; fall back to home directory
  const workspace = join(root, '.claude', 'settings.json');
  return workspace;
}

export function findClaudeDir(root: string): string {
  return dirname(findClaudeSettingsPath(root));
}

// ── Write permission profile ──────────────────────────────────────────────────

export interface PermissionProfile {
  sessionId: string;
  settingsPath: string;
  backupPath: string | null;
}

export function writePermissionProfile(root: string, sessionId: string): PermissionProfile {
  const settingsPath = findClaudeSettingsPath(root);
  const claudeDir = dirname(settingsPath);
  const backupPath = join(claudeDir, `.settings-backup-${sessionId}.json`);

  // Create .claude/ dir if it doesn't exist
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  // Backup existing settings
  let actualBackupPath: string | null = null;
  if (existsSync(settingsPath)) {
    copyFileSync(settingsPath, backupPath);
    actualBackupPath = backupPath;
  }

  // Read existing settings to extract governance hooks before overwriting
  const existingSettings = readSettingsJson(settingsPath) ?? {};
  const governanceHooks = extractGovernanceHooks(existingSettings);

  // Write autopilot permission profile — preserving any installed governance hooks
  let profile: Record<string, unknown> = {
    _autopilot_session: sessionId,
    _autopilot_restore: true,
    _autopilot_backup: actualBackupPath,
    permissions: {
      allow: PERMISSION_ALLOW,
      deny: [] as string[],
    },
  };

  if (governanceHooks) {
    profile['hooks'] = governanceHooks;
    profile['_thesmos_governance'] = existingSettings['_thesmos_governance'] ?? GOVERNANCE_VERSION;
  }

  writeFileSync(settingsPath, JSON.stringify(profile, null, 2) + '\n', 'utf8');

  return { sessionId, settingsPath, backupPath: actualBackupPath };
}

// ── Restore original settings ─────────────────────────────────────────────────

export function restorePermissions(root: string, backupPath: string | null): void {
  const settingsPath = findClaudeSettingsPath(root);

  // Capture current governance hooks before restore overwrites them
  const current = readSettingsJson(settingsPath) ?? {};
  const governanceHooks = extractGovernanceHooks(current);

  if (backupPath && existsSync(backupPath)) {
    copyFileSync(backupPath, settingsPath);
    try { unlinkSync(backupPath); } catch { /* best effort */ }
  } else if (existsSync(settingsPath)) {
    // No backup = settings didn't exist before — remove the autopilot profile
    if (current['_autopilot_restore']) {
      unlinkSync(settingsPath);
    }
  }

  // Re-inject governance hooks into the restored settings so they survive the session lifecycle
  if (governanceHooks && existsSync(settingsPath)) {
    const restored = readSettingsJson(settingsPath) ?? {};
    const merged = mergeGovernanceHooks(restored);
    writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  }
}

// ── Crash recovery ────────────────────────────────────────────────────────────

export interface LeftoverSession {
  sessionId: string;
  backupPath: string | null;
}

export function detectLeftoverProfile(root: string): LeftoverSession | null {
  const settingsPath = findClaudeSettingsPath(root);
  if (!existsSync(settingsPath)) return null;

  const settings = readSettingsJson(settingsPath);
  if (!settings?.['_autopilot_restore']) return null;

  return {
    sessionId: String(settings['_autopilot_session'] ?? 'unknown'),
    backupPath: typeof settings['_autopilot_backup'] === 'string' ? settings['_autopilot_backup'] : null,
  };
}

export function recoverLeftoverProfile(root: string): boolean {
  const leftover = detectLeftoverProfile(root);
  if (!leftover) return false;

  process.stderr.write(
    `[thesmos] Detected leftover autopilot permission profile from session ${leftover.sessionId}.\n` +
    `[thesmos] Restoring original settings...\n`
  );

  restorePermissions(root, leftover.backupPath);

  process.stderr.write(`[thesmos] Settings restored.\n`);
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readSettingsJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
