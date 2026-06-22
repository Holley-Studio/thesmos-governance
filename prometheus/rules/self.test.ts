// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SELF_RULES } from './self';
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
  const r = SELF_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files });
}

// ── SELF_001 — version behind ─────────────────────────────────────────────────

describe('SELF_001 — version behind', () => {
  it('fires on prometheus-governance pinned to old minor without caret', () => {
    const findings = detect('SELF_001', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        devDependencies: { 'prometheus-governance': '2.1.0' },
      }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when using caret range', () => {
    const findings = detect('SELF_001', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        devDependencies: { 'prometheus-governance': '^2.3.1' },
      }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when prometheus-governance is not present', () => {
    const findings = detect('SELF_001', [{
      path: 'package.json',
      content: JSON.stringify({ name: 'my-app', devDependencies: { react: '^18.0.0' } }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_002 — exact version pin ──────────────────────────────────────────────

describe('SELF_002 — exact version pin', () => {
  it('fires on exact semver without caret', () => {
    const findings = detect('SELF_002', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        devDependencies: { 'prometheus-governance': '2.3.0' },
      }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire on caret range', () => {
    const findings = detect('SELF_002', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        devDependencies: { 'prometheus-governance': '^2.3.0' },
      }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_003 — broken hook ────────────────────────────────────────────────────

describe('SELF_003 — broken hook', () => {
  it('fires on git hook with absolute prometheus binary path', () => {
    const findings = detect('SELF_003', [{
      path: '.git/hooks/pre-commit',
      content: '#!/bin/sh\n/home/user/.npm-global/bin/prometheus ci --hook=pre-commit\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on macOS absolute path in husky hook', () => {
    const findings = detect('SELF_003', [{
      path: '.husky/pre-commit',
      content: '#!/bin/sh\n/Users/matt/.nvm/versions/node/v20.0.0/bin/prometheus ci\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on npx prometheus call', () => {
    const findings = detect('SELF_003', [{
      path: '.git/hooks/pre-commit',
      content: '#!/bin/sh\nnpx prometheus ci --hook=pre-commit\n',
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on non-hook files', () => {
    const findings = detect('SELF_003', [{
      path: 'scripts/deploy.sh',
      content: '/usr/local/bin/prometheus ci\n',
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_004 — config schema old ──────────────────────────────────────────────

describe('SELF_004 — config schema old', () => {
  it('fires when config.json has no version field', () => {
    const findings = detect('SELF_004', [{
      path: '.prometheus/config.json',
      content: JSON.stringify({ adapters: ['CLAUDE.md'], rules: {} }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when version field is present', () => {
    const findings = detect('SELF_004', [{
      path: '.prometheus/config.json',
      content: JSON.stringify({ version: '2', rules: { enabled: true }, severityRules: {} }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_005 — stale adapter ──────────────────────────────────────────────────

describe('SELF_005 — stale adapter', () => {
  it('fires on CLAUDE.md referencing old minor version', () => {
    const findings = detect('SELF_005', [{
      path: 'CLAUDE.md',
      content: '# Prometheus Governance\n\nprometheus-governance v2.1.0 — 911 rules active\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when version is current (2.3.x)', () => {
    const findings = detect('SELF_005', [{
      path: 'CLAUDE.md',
      content: '# Prometheus Governance\n\nprometheus-governance v2.3.1 — 1075 rules active\n',
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_006 — stale context snapshot ────────────────────────────────────────

describe('SELF_006 — stale context snapshot', () => {
  it('fires on context.md with generatedAt older than 7 days', () => {
    const findings = detect('SELF_006', [{
      path: '.prometheus/context.md',
      content: '<!-- generatedAt: 2024-01-01T00:00:00Z -->\n# Context\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire on a recent context snapshot', () => {
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const findings = detect('SELF_006', [{
      path: '.prometheus/context.md',
      content: `<!-- generatedAt: ${recent} -->\n# Context\n`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_007 — stale brain ────────────────────────────────────────────────────

describe('SELF_007 — stale brain', () => {
  it('fires on brain.md with generated date older than 3 days', () => {
    const findings = detect('SELF_007', [{
      path: '.prometheus/brain.md',
      content: 'generated: 2024-01-01T00:00:00Z\n# Brain\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire on a fresh brain file', () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const findings = detect('SELF_007', [{
      path: '.prometheus/brain.md',
      content: `generated: ${recent}\n# Brain\n`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_008 — CI pinned old version ─────────────────────────────────────────

describe('SELF_008 — CI pinned old version', () => {
  it('fires on npx prometheus-governance@old-version in CI workflow', () => {
    const findings = detect('SELF_008', [{
      path: '.github/workflows/ci.yml',
      content: 'steps:\n  - run: npx prometheus-governance@2.1.0 ci\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('LOW');
  });

  it('does NOT fire on current version', () => {
    const findings = detect('SELF_008', [{
      path: '.github/workflows/ci.yml',
      content: 'steps:\n  - run: npx prometheus-governance@2.3.1 ci\n',
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_009 — orphaned suppression ──────────────────────────────────────────

describe('SELF_009 — orphaned suppression', () => {
  it('fires on suppression with unknown rule prefix', () => {
    const findings = detect('SELF_009', [{
      path: 'src/api/route.ts',
      content: '// prometheus-ignore: LEGACY_001\nconst x = 1;\n',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire on valid rule prefixes', () => {
    const findings = detect('SELF_009', [{
      path: 'src/api/route.ts',
      content: '// prometheus-ignore: JWT_001\nconst secret = process.env.JWT_SECRET || "fallback";\n',
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on test files', () => {
    const findings = detect('SELF_009', [{
      path: 'src/api/route.test.ts',
      content: '// prometheus-ignore: LEGACY_001\nconst x = 1;\n',
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── SELF_010 — not in devDependencies ────────────────────────────────────────

describe('SELF_010 — not in devDependencies', () => {
  it('fires when prometheus-governance is absent from package.json', () => {
    const findings = detect('SELF_010', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        devDependencies: { typescript: '^5.0.0' },
      }, null, 2),
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('LOW');
  });

  it('does NOT fire when prometheus-governance is in devDependencies', () => {
    const findings = detect('SELF_010', [{
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        devDependencies: { 'prometheus-governance': '^2.3.1' },
      }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on package.json without name or version (workspace root / lib)', () => {
    const findings = detect('SELF_010', [{
      path: 'package.json',
      content: JSON.stringify({ workspaces: ['packages/*'] }, null, 2),
    }]);
    expect(findings).toHaveLength(0);
  });
});
