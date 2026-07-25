// @vitest-environment node
/**
 * Direct unit tests for the config-repair path helper
 * (`isThesmosConfigRepairTarget`). This is the security-sensitive gate that
 * decides whether a Write/Edit is allowed through while `.thesmos/config.json`
 * is malformed (the fail-closed self-heal hatch). A wrong answer here either
 * re-deadlocks the agent (false negative) or opens an arbitrary-write escape
 * (false positive), so the comparison is threat-modeled and exercised directly.
 *
 * Policy proven here:
 *  - Exact canonical match of `<root>/.thesmos/config.json` (via the captured
 *    broken-config path) is the ONLY thing granted the exception.
 *  - Basename must be exactly `config.json` (case-exact — a differently-cased
 *    spelling fails safe / blocks).
 *  - `..` traversal never broadens the exception.
 *  - Similar filenames (config.jsonx, config.json.bak, config-json) are denied.
 *  - A symlinked config file is NOT repaired through (would follow the link
 *    and clobber a file outside `.thesmos`).
 *  - Empty / whitespace file paths are denied.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { platform } from 'node:os';
import { isThesmosConfigRepairTarget } from './claude-govern.js';

let root = '';
let configPath = '';

beforeEach(() => {
  // realpathSync so macOS /var → /private/var symlink is already resolved in
  // the fixture root; the helper must still behave identically either way.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'thesmos-repair-')));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  configPath = join(root, '.thesmos', 'config.json');
  writeFileSync(configPath, '{broken', 'utf8'); // malformed on purpose
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('isThesmosConfigRepairTarget — positive', () => {
  it('allows the exact broken config path (absolute)', () => {
    expect(isThesmosConfigRepairTarget(root, configPath, configPath)).toBe(true);
  });

  it('allows the config path expressed relative to root', () => {
    expect(
      isThesmosConfigRepairTarget(root, join('.thesmos', 'config.json'), configPath),
    ).toBe(true);
  });

  it('allows a redundant-but-canonical path (a/../.thesmos/config.json)', () => {
    expect(
      isThesmosConfigRepairTarget(root, join('a', '..', '.thesmos', 'config.json'), configPath),
    ).toBe(true);
  });

  it('falls back to <root>/.thesmos/config.json when no broken path is supplied', () => {
    expect(isThesmosConfigRepairTarget(root, join('.thesmos', 'config.json'))).toBe(true);
  });
});

describe('isThesmosConfigRepairTarget — negative (must stay blocked)', () => {
  it('denies empty and whitespace file paths', () => {
    expect(isThesmosConfigRepairTarget(root, '', configPath)).toBe(false);
    expect(isThesmosConfigRepairTarget(root, '   ', configPath)).toBe(false);
  });

  it('denies a sibling source file', () => {
    expect(
      isThesmosConfigRepairTarget(root, join('src', 'index.ts'), configPath),
    ).toBe(false);
  });

  it('denies similar filenames (config.jsonx, .bak, config-json)', () => {
    for (const name of ['config.jsonx', 'config.json.bak', 'config-json', 'config.JSON']) {
      expect(
        isThesmosConfigRepairTarget(root, join('.thesmos', name), configPath),
      ).toBe(false);
    }
  });

  it('denies a config.json in a different directory', () => {
    expect(isThesmosConfigRepairTarget(root, 'config.json', configPath)).toBe(false);
    expect(
      isThesmosConfigRepairTarget(root, join('nested', 'config.json'), configPath),
    ).toBe(false);
  });

  it('does not let `..` traversal escape to a config.json outside .thesmos', () => {
    expect(
      isThesmosConfigRepairTarget(root, join('.thesmos', '..', 'config.json'), configPath),
    ).toBe(false);
  });

  it('does not let `..` traversal reach a config.json above the repo root', () => {
    expect(
      isThesmosConfigRepairTarget(root, join('..', 'config.json'), configPath),
    ).toBe(false);
  });

  it('refuses to repair through a symlinked config file (no link-follow write)', () => {
    // Replace the broken config with a symlink pointing outside .thesmos.
    const outside = join(root, 'evil-target.json');
    writeFileSync(outside, 'sentinel', 'utf8');
    rmSync(configPath, { force: true });
    if (platform() === 'win32') return; // symlink creation is privileged on Windows
    symlinkSync(outside, configPath);
    expect(isThesmosConfigRepairTarget(root, configPath, configPath)).toBe(false);
  });
});
