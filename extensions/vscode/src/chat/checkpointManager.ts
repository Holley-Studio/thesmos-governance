// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * CheckpointManager — workspace snapshots for Pantheon Chat, one per user
 * message, restorable with one click ("Kronos turns back time").
 *
 * Uses a SHADOW git repository: a separate --git-dir living under the
 * extension's storage directory with its work-tree pointed at the workspace.
 * The user's real repo is never touched — not its index, HEAD, stashes, or
 * history — because `.git` is excluded from the shadow repo entirely and all
 * shadow commands name their git-dir explicitly.
 *
 * snapshot(): `add -A` + `commit` in the shadow repo → checkpoint hash.
 * restore(): `checkout -f <hash> -- .` + `clean -fd` → work tree matches the
 * checkpoint exactly (files created after it are removed; the exclude list
 * protects node_modules, .git, and friends from both snapshot and clean).
 */

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Never snapshotted, never cleaned. */
const EXCLUDES = [
  '.git/',
  'node_modules/',
  '.DS_Store',
  '*.vsix',
  '.venv/',
  '__pycache__/',
  '.next/',
  '.turbo/',
];

const GIT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 32 * 1024 * 1024;

export class CheckpointManager {
  private initialized = false;
  private available: boolean | undefined;

  constructor(
    private readonly workspaceRoot: string,
    private readonly shadowDir: string,
  ) {}

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(
      'git',
      [`--git-dir=${this.shadowDir}`, `--work-tree=${this.workspaceRoot}`, ...args],
      { cwd: this.workspaceRoot, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
    );
    return stdout.trim();
  }

  /** One-time shadow repo setup. Returns false when git isn't installed. */
  private async ensureInit(): Promise<boolean> {
    if (this.initialized) return true;
    if (this.available === false) return false;
    try {
      mkdirSync(this.shadowDir, { recursive: true });
      if (!existsSync(join(this.shadowDir, 'HEAD'))) {
        await execFileAsync('git', ['init', '--quiet', '--bare', this.shadowDir], {
          timeout: GIT_TIMEOUT_MS,
        });
      }
      // A bare git-dir + explicit --work-tree is the shadow-repo pattern, but
      // some git commands refuse to run when core.bare is literally true.
      await this.git('config', 'core.bare', 'false');
      // Commit identity is required; keep it local to the shadow repo.
      await this.git('config', 'user.name', 'Pantheon Chat');
      await this.git('config', 'user.email', 'pantheon-chat@thesmos.local');
      await this.git('config', 'core.autocrlf', 'false');
      mkdirSync(join(this.shadowDir, 'info'), { recursive: true });
      writeFileSync(join(this.shadowDir, 'info', 'exclude'), EXCLUDES.join('\n') + '\n', 'utf-8');
      this.initialized = true;
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  /**
   * Snapshot the workspace. Returns the checkpoint hash, or undefined when
   * checkpoints are unavailable (no git) — callers degrade gracefully.
   */
  async snapshot(label: string): Promise<string | undefined> {
    if (!(await this.ensureInit())) return undefined;
    try {
      await this.git('add', '-A');
      const hadHead = await this.git('rev-parse', '--verify', '--quiet', 'HEAD').then(
        () => true,
        () => false,
      );
      try {
        await this.git('commit', '--quiet', '-m', label.slice(0, 80) || 'checkpoint');
      } catch {
        // Nothing changed — reuse HEAD, unless there is no root commit yet
        // (workspace had only excluded files), in which case make an empty one.
        if (!hadHead) {
          await this.git('commit', '--quiet', '--allow-empty', '-m', label.slice(0, 80) || 'checkpoint');
        }
      }
      return await this.git('rev-parse', 'HEAD');
    } catch {
      return undefined;
    }
  }

  /**
   * Unified diff between a checkpoint and the current working tree — shown
   * before restoring so the user knows exactly what will be undone. Neither
   * Cursor nor Windsurf offer this pre-restore preview; their restores are
   * one-shot and, by their own users' reports, effectively irreversible.
   */
  async diffSince(hash: string): Promise<string> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) return '';
    if (!(await this.ensureInit())) return '';
    try {
      return await this.git('diff', hash, '--', '.');
    } catch {
      return '';
    }
  }

  /**
   * Restore the work tree to a checkpoint. Destructive for changes made after
   * the checkpoint — callers must confirm with the user first.
   */
  async restore(hash: string): Promise<void> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error('Invalid checkpoint id.');
    if (!(await this.ensureInit())) throw new Error('Checkpoints unavailable (git not found).');
    // reset --hard restores index + tracked files to the checkpoint and moves
    // the shadow branch there, so the timeline naturally branches from this
    // point. clean then removes files created after the checkpoint — they are
    // untracked relative to the reset index (excluded paths are protected).
    await this.git('reset', '--hard', hash);
    await this.git('clean', '-fd');
  }
}
