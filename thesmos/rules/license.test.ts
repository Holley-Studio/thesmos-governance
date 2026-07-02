// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LICENSE_RULES } from './license';
import { CONFIG_DEFAULTS } from '../config';
import type { ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
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
};

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const r = LICENSE_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files });
}

// ── LIC_002 — unknown license precision ──────────────────────────────────────

describe('LIC_002 — lic_unknown_license', () => {
  it('does NOT fire on first-party workspace and symlink entries (self-flagging FP)', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'repo-root' },
        // Workspace source entries — first-party, governed by the repo LICENSE
        'thesmos': { name: 'thesmos-governance' },
        'actions/pr-review': { name: '@thesmos-governance/pr-review' },
        // Symlink aliases to workspaces — never carry a license field
        'node_modules/thesmos-governance': { resolved: 'thesmos', link: true },
        'node_modules/@thesmos-governance/pr-review': { resolved: 'actions/pr-review', link: true },
        // A properly licensed third-party dep
        'node_modules/left-pad': { version: '1.3.0', license: 'MIT' },
      },
    });
    const findings = detect('LIC_002', [{ path: 'package-lock.json', content: lock }]);
    expect(findings).toHaveLength(0);
  });

  it('still fires on a third-party node_modules dependency with no license', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'repo-root' },
        'node_modules/sketchy-pkg': { version: '0.0.1' },
      },
    });
    const findings = detect('LIC_002', [{ path: 'package-lock.json', content: lock }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('HIGH');
    expect(findings[0]?.message).toContain('sketchy-pkg');
  });

  it('still fires on UNLICENSED third-party dependencies', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/blocked-pkg': { version: '1.0.0', license: 'UNLICENSED' },
      },
    });
    const findings = detect('LIC_002', [{ path: 'package-lock.json', content: lock }]);
    expect(findings).toHaveLength(1);
  });

  it('supports lockfile v1 (bare-name dependencies map)', () => {
    const lock = JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        'no-license-pkg': { version: '1.0.0' },
      },
    });
    const findings = detect('LIC_002', [{ path: 'package-lock.json', content: lock }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('no-license-pkg');
  });
});
