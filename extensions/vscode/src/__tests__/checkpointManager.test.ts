// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CheckpointManager } from '../chat/checkpointManager.js';

let workspace: string;
let shadow: string;
let manager: CheckpointManager;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'pantheon-ws-'));
  shadow = mkdtempSync(join(tmpdir(), 'pantheon-shadow-'));
  rmSync(shadow, { recursive: true }); // manager creates it itself
  manager = new CheckpointManager(workspace, shadow);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(shadow, { recursive: true, force: true });
});

describe('CheckpointManager', () => {
  it('snapshots and restores modified files', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'original');
    const checkpoint = await manager.snapshot('first');
    expect(checkpoint).toMatch(/^[0-9a-f]{40}$/);

    writeFileSync(join(workspace, 'a.txt'), 'clobbered');
    await manager.restore(checkpoint!);

    expect(readFileSync(join(workspace, 'a.txt'), 'utf-8')).toBe('original');
  });

  it('removes files created after the checkpoint', async () => {
    writeFileSync(join(workspace, 'keep.txt'), 'keep');
    const checkpoint = await manager.snapshot('before');

    writeFileSync(join(workspace, 'created-later.txt'), 'new');
    mkdirSync(join(workspace, 'newdir'));
    writeFileSync(join(workspace, 'newdir', 'nested.txt'), 'nested');
    await manager.restore(checkpoint!);

    expect(existsSync(join(workspace, 'keep.txt'))).toBe(true);
    expect(existsSync(join(workspace, 'created-later.txt'))).toBe(false);
    expect(existsSync(join(workspace, 'newdir'))).toBe(false);
  });

  it('leaves excluded paths alone on restore', async () => {
    writeFileSync(join(workspace, 'tracked.txt'), 'v1');
    mkdirSync(join(workspace, 'node_modules'));
    writeFileSync(join(workspace, 'node_modules', 'dep.js'), 'dep');
    const checkpoint = await manager.snapshot('with-excludes');

    writeFileSync(join(workspace, 'node_modules', 'dep2.js'), 'dep2');
    await manager.restore(checkpoint!);

    // node_modules is excluded from both snapshot and clean.
    expect(existsSync(join(workspace, 'node_modules', 'dep.js'))).toBe(true);
    expect(existsSync(join(workspace, 'node_modules', 'dep2.js'))).toBe(true);
  });

  it('does not touch the workspace real .git directory', async () => {
    mkdirSync(join(workspace, '.git'));
    writeFileSync(join(workspace, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const checkpoint = await manager.snapshot('git-repo');

    writeFileSync(join(workspace, '.git', 'HEAD'), 'ref: refs/heads/feature\n');
    await manager.restore(checkpoint!);

    // The shadow repo excludes .git entirely — user's git state is preserved.
    expect(readFileSync(join(workspace, '.git', 'HEAD'), 'utf-8')).toContain('feature');
  });

  it('reuses the same checkpoint when nothing changed', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'stable');
    const first = await manager.snapshot('one');
    const second = await manager.snapshot('two');
    expect(second).toBe(first);
  });

  it('rejects malformed checkpoint ids', async () => {
    await expect(manager.restore('not-a-hash!')).rejects.toThrow(/Invalid/);
  });

  it('supports restore-then-continue (branching from a checkpoint)', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'v1');
    const cp1 = await manager.snapshot('v1');

    writeFileSync(join(workspace, 'a.txt'), 'v2');
    await manager.snapshot('v2');

    await manager.restore(cp1!);
    writeFileSync(join(workspace, 'a.txt'), 'v3');
    const cp3 = await manager.snapshot('v3');

    expect(cp3).toBeTruthy();
    expect(cp3).not.toBe(cp1);
    await manager.restore(cp1!);
    expect(readFileSync(join(workspace, 'a.txt'), 'utf-8')).toBe('v1');
  });
});
