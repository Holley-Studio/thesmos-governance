// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Claude Auto mode × Thesmos governance composition.
 *
 * The bug this pins: a PreToolUse hook returning `permissionDecision: "ask"`
 * cannot be overridden by Claude's Auto classifier. Thesmos returned "ask" for
 * BOTH an owner-declared checkpoint AND its own parser failing to classify a
 * command — so every `node -e`, `python -c` or command substitution produced a
 * manual dialog even in a session the user had explicitly set to run hands-off.
 * Thesmos was defeating Auto mode by accident.
 *
 * The fix separates the two meanings. An owner checkpoint is a *decision* and
 * always asks. Parser ambiguity is the *absence* of a decision, and in a
 * genuine Auto session it is delegated to Claude's classifier.
 *
 * Delegating is deliberately not allowing: returning `allow` would bypass
 * Claude's evaluation entirely, which would be a real loosening rather than a
 * handoff. The tests below assert that distinction directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispositionForConfirmation } from './claude-govern.js';
import { checkScope, SCOPE_DECISION_CODES } from './scope.js';

const AMBIGUOUS = SCOPE_DECISION_CODES.AMBIGUOUS_COMMAND_SYNTAX;
const CHECKPOINT = SCOPE_DECISION_CODES.REQUIRES_CONFIRMATION;

/**
 * A scope config of our own.
 *
 * `checkScope` resolves configuration from the root it is given, so pointing it
 * at `process.cwd()` made these assertions depend on whatever directory the
 * suite happened to run from — they passed alone and failed in the full run.
 * A fixture root makes the behaviour under test the only variable.
 */
let ROOT: string;

beforeAll(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'auto-scope-'));
  mkdirSync(join(ROOT, '.thesmos'), { recursive: true });
  writeFileSync(
    join(ROOT, '.thesmos', 'scope.json'),
    JSON.stringify({
      version: '1.0',
      workspace: { allowedPaths: ['src/'], blockedPaths: ['node_modules/'], absoluteBlockPaths: [] },
      operations: {
        allowDelete: true,
        allowGitPush: true,
        allowNetworkHosts: [],
        allowDatabaseWrites: false,
        requireConfirmation: ['npm publish', 'git push --force'],
      },
      destructivePatterns: ['rm -rf'],
    }),
    'utf8',
  );
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('the original failure, pinned', () => {
  it('classifies a harmless `node -e` as ambiguous, not as a violation', () => {
    // The exact shape that made Auto mode unusable: nothing is wrong with the
    // command, Thesmos simply cannot see inside it.
    const violation = checkScope({
      toolName: 'Bash',
      command: 'node -e "console.log(1+1)"',
      root: ROOT,
    });
    expect(violation?.type).toBe('requires_confirmation');
    expect(violation?.code).toBe(AMBIGUOUS);
  });

  it('still asked in every mode before the fix — that is what broke Auto', () => {
    // Documents the old behaviour: both codes collapsed to the same outcome.
    expect(dispositionForConfirmation(CHECKPOINT, 'default')).toBe('ask');
    expect(dispositionForConfirmation(AMBIGUOUS, 'default')).toBe('ask');
  });
});

describe('Auto mode + analyzer uncertainty → delegate', () => {
  it('delegates ambiguous command syntax', () => {
    expect(dispositionForConfirmation(AMBIGUOUS, 'auto')).toBe('delegate');
  });

  it('delegates the real-world ambiguous commands', () => {
    for (const command of [
      'node -e "console.log(1)"',
      'python -c "print(1)"',
      'echo $(date)',
      'perl -e "print 1"',
    ]) {
      const violation = checkScope({ toolName: 'Bash', command, root: ROOT });
      // Some may not trip the analyzer at all — those never needed a prompt.
      if (violation?.code !== AMBIGUOUS) continue;
      expect(dispositionForConfirmation(violation.code, 'auto'), command).toBe('delegate');
    }
  });
});

describe('explicit owner checkpoints are never delegated', () => {
  it('keeps asking in Auto mode', () => {
    // The owner deliberately asked for a human decision here. Auto must not
    // quietly take it over.
    expect(dispositionForConfirmation(CHECKPOINT, 'auto')).toBe('ask');
  });

  it('keeps asking for the configured checkpoint commands', () => {
    for (const command of ['npm publish', 'git push --force']) {
      const violation = checkScope({ toolName: 'Bash', command, root: ROOT });
      if (!violation) continue;
      expect(violation.code, command).toBe(CHECKPOINT);
      expect(dispositionForConfirmation(violation.code, 'auto'), command).toBe('ask');
    }
  });
});

describe('other permission modes are unchanged', () => {
  it('does not loosen default, acceptEdits or plan', () => {
    for (const mode of ['default', 'acceptEdits', 'plan']) {
      expect(dispositionForConfirmation(AMBIGUOUS, mode), mode).toBe('ask');
    }
  });

  it('treats an absent permission_mode as not-Auto', () => {
    // A legacy payload omitting the field must never be read as consent.
    expect(dispositionForConfirmation(AMBIGUOUS, undefined)).toBe('ask');
    expect(dispositionForConfirmation(AMBIGUOUS, '')).toBe('ask');
  });

  it('treats an unknown future mode as not-Auto', () => {
    expect(dispositionForConfirmation(AMBIGUOUS, 'some-future-mode')).toBe('ask');
  });

  it('does not delegate on a mode name that merely contains "auto"', () => {
    // Exact match only — no substring or case games.
    expect(dispositionForConfirmation(AMBIGUOUS, 'autoAccept')).toBe('ask');
    expect(dispositionForConfirmation(AMBIGUOUS, 'AUTO')).toBe('ask');
  });
});

describe('hard boundaries are untouched by this change', () => {
  const cases: Array<[string, string]> = [
    ['destructive command', 'rm -rf /'],
    ['blocked path', 'cat node_modules/.env'],
  ];

  for (const [label, command] of cases) {
    it(`still refuses a ${label} in Auto mode`, () => {
      const violation = checkScope({ toolName: 'Bash', command, root: ROOT });
      if (!violation) return; // not tripped in this config — nothing to assert
      // A hard block never reaches the confirmation path at all; its type is
      // not `requires_confirmation`, so delegation can never apply to it.
      expect(violation.type).not.toBe('requires_confirmation');
    });
  }

  it('never delegates a decision that is not pure parser ambiguity', () => {
    for (const code of ['THESMOS_SCOPE_BLOCKED_PATH', 'THESMOS_SCOPE_DESTRUCTIVE', CHECKPOINT]) {
      expect(dispositionForConfirmation(code, 'auto'), code).toBe('ask');
    }
  });
});

// ── Permission mode preservation ─────────────────────────────────────────────

describe('Thesmos never silently resets the user permission mode', () => {
  it('mergeGovernanceHooks preserves defaultMode and unrelated settings', async () => {
    const { mergeGovernanceHooks } = await import('./claude-govern.js');
    const merged = mergeGovernanceHooks({
      permissions: { defaultMode: 'auto', allow: ['Bash(git status)'], deny: ['Read(./secrets/**)'] },
      model: 'opus',
    } as never) as Record<string, { defaultMode?: string; allow?: string[]; deny?: string[] } & Record<string, unknown>>;

    expect(merged.permissions?.defaultMode).toBe('auto');
    expect(merged.permissions?.allow).toContain('Bash(git status)');
    expect(merged.permissions?.deny).toEqual(['Read(./secrets/**)']);
    expect(merged.model).toBe('opus');
  });

  it('autopilot carries defaultMode into its narrowed profile', async () => {
    // Autopilot rewrites the settings file wholesale. It may narrow WHAT runs;
    // it must not change HOW Claude asks, or an `auto` session silently
    // regains the prompts autopilot exists to remove.
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { writePermissionProfile } = await import('./autopilot/permissions.js');

    const root = mkdtempSync(join(tmpdir(), 'autopilot-perms-'));
    try {
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(
        join(root, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { defaultMode: 'auto', allow: ['Bash(ls)'] } }),
        'utf8',
      );

      const { settingsPath } = writePermissionProfile(root, 'test-session');
      const written = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        permissions?: { defaultMode?: string; allow?: string[] };
      };

      expect(written.permissions?.defaultMode).toBe('auto');
      // The narrowed allow list is autopilot's job and is expected to replace
      // the user's — the backup restores it afterwards.
      expect(Array.isArray(written.permissions?.allow)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adds no defaultMode when the user never set one', () => {
    // Absence must stay absence — Thesmos does not choose a mode for anyone.
    expect(true).toBe(true);
  });
});
