// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG_DEFAULTS } from './config';
import { THESMOS_RULES } from './adapters';
import {
  buildInitFiles,
  writeThesmosDir,
  INIT_FILE_PATHS,
  type InitFileResult,
} from './init';
import type { ScanResult } from './types';

const CONFIG = CONFIG_DEFAULTS;

const MOCK_SCAN: ScanResult = {
  _generatedSections: ['scan', 'routes'],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [
    { path: '/', file: 'app/page.tsx', desc: '' },
    { path: '/about', file: 'app/about/page.tsx', desc: '' },
  ],
  apiRoutes: [
    {
      path: '/api/users',
      file: 'app/api/users/route.ts',
      methods: ['GET', 'POST'],
      auth: true,
      desc: '',
    },
  ],
  componentCount: 12,
  sharedUiFiles: ['components/ui/Button.tsx'],
  designSystemFiles: ['styles/theme.ts'],
  storeFiles: ['stores/auth.ts'],
  testFiles: ['src/auth.test.ts'],
  largeFiles: [{ file: 'lib/big.ts', lines: 450 }],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: ['.env.local'],
  clientBoundaryRisks: [],
  detector: {
    framework: 'next',
    auth: 'supabase',
    envVars: ['NEXT_PUBLIC_URL'],
    testingFramework: 'vitest',
    deployment: 'vercel',
    apiConvention: 'next-app-router',
    typescript: true,
    packageManager: 'npm',
    cssFramework: 'tailwind',
    uiLibrary: 'shadcn',
  },
};

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `prom-init-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── INIT_FILE_PATHS ───────────────────────────────────────────────────────────

describe('INIT_FILE_PATHS', () => {
  it('includes all 24 expected paths (including GH workflow and registry)', () => {
    expect(INIT_FILE_PATHS).toHaveLength(24);
  });

  it('includes the GitHub Actions workflow template', () => {
    expect(INIT_FILE_PATHS).toContain('.github/workflows/thesmos-review.yml');
  });

  it('includes config.json', () => {
    expect(INIT_FILE_PATHS).toContain('.thesmos/config.json');
  });

  it('includes report.json', () => {
    expect(INIT_FILE_PATHS).toContain('.thesmos/report.json');
  });

  it('includes registry.json', () => {
    expect(INIT_FILE_PATHS).toContain('.thesmos/registry.json');
  });

  it('includes extension directory READMEs', () => {
    const dirs = [
      '.thesmos/agents/README.md',
      '.thesmos/skills/README.md',
      '.thesmos/profiles/README.md',
      '.thesmos/rules/README.md',
    ];
    for (const p of dirs) {
      expect(INIT_FILE_PATHS).toContain(p);
    }
  });

  it('includes all five playbooks', () => {
    const playbooks = [
      '.thesmos/playbooks/ADD_COMPONENT.md',
      '.thesmos/playbooks/ADD_PAGE.md',
      '.thesmos/playbooks/ADD_API_ROUTE.md',
      '.thesmos/playbooks/REFACTOR.md',
      '.thesmos/playbooks/FIX_BUILD.md',
    ];
    for (const p of playbooks) {
      expect(INIT_FILE_PATHS).toContain(p);
    }
  });

  it('includes all five architecture files', () => {
    const arch = [
      '.thesmos/architecture/STRUCTURE.md',
      '.thesmos/architecture/ROUTING.md',
      '.thesmos/architecture/COMPONENTS.md',
      '.thesmos/architecture/API.md',
      '.thesmos/architecture/STATE.md',
    ];
    for (const p of arch) {
      expect(INIT_FILE_PATHS).toContain(p);
    }
  });
});

// ── buildInitFiles — output shape ─────────────────────────────────────────────

describe('buildInitFiles output shape', () => {
  it('returns an entry for every path in INIT_FILE_PATHS', () => {
    const result = buildInitFiles(CONFIG);
    for (const p of INIT_FILE_PATHS) {
      expect(result).toHaveProperty(p);
    }
  });

  it('returns exactly 24 files (including GH workflow and registry)', () => {
    expect(Object.keys(buildInitFiles(CONFIG))).toHaveLength(24);
  });

  it('config.json is valid JSON', () => {
    const result = buildInitFiles(CONFIG);
    expect(() => JSON.parse(result['.thesmos/config.json'])).not.toThrow();
  });

  it('report.json is valid JSON with _generatedSections', () => {
    const result = buildInitFiles(CONFIG);
    const report = JSON.parse(result['.thesmos/report.json']) as Record<string, unknown>;
    expect(Array.isArray(report['_generatedSections'])).toBe(true);
  });

  it('every dynamic markdown file has THESMOS:GENERATED markers', () => {
    // Static directory READMEs (agents/, skills/, profiles/, rules/) have no
    // generated sections — they are documentation stubs, not generated files.
    const STATIC_READMES = new Set([
      '.thesmos/agents/README.md',
      '.thesmos/skills/README.md',
      '.thesmos/profiles/README.md',
      '.thesmos/rules/README.md',
    ]);
    const result = buildInitFiles(CONFIG);
    const mdPaths = Object.keys(result).filter((p) => p.endsWith('.md') && !STATIC_READMES.has(p));
    for (const p of mdPaths) {
      expect(result[p], `${p} should have markers`).toContain('THESMOS:GENERATED');
    }
  });
});

// ── buildInitFiles — generated content ───────────────────────────────────────

describe('buildInitFiles generated content', () => {
  it('README.md overview section contains project name', () => {
    const result = buildInitFiles(CONFIG);
    expect(result['.thesmos/README.md']).toContain(CONFIG.project);
  });

  it('RULES.md contains all rule IDs', () => {
    const result = buildInitFiles(CONFIG);
    for (const rule of THESMOS_RULES) {
      expect(result['.thesmos/RULES.md']).toContain(rule.id);
    }
  });

  it('GUARDRAILS.md contains BLOCKER label', () => {
    const result = buildInitFiles(CONFIG);
    expect(result['.thesmos/GUARDRAILS.md']).toContain('BLOCKER');
  });

  it('CODE_REVIEW.md has a checklist', () => {
    const result = buildInitFiles(CONFIG);
    expect(result['.thesmos/governance/CODE_REVIEW.md']).toContain('- [ ]');
  });

  it('REVIEW_AGENT.md has agent instructions', () => {
    const result = buildInitFiles(CONFIG);
    expect(result['.thesmos/governance/REVIEW_AGENT.md']).toContain('[ENV_001]');
  });

  it('SEVERITY_MODEL.md has a severity table', () => {
    const result = buildInitFiles(CONFIG);
    expect(result['.thesmos/governance/SEVERITY_MODEL.md']).toContain('BLOCKER');
    expect(result['.thesmos/governance/SEVERITY_MODEL.md']).toContain('TECH_DEBT');
  });

  it('playbooks contain TODO placeholders', () => {
    const result = buildInitFiles(CONFIG);
    const playbookPaths = Object.keys(result).filter((p) => p.includes('playbooks/'));
    for (const p of playbookPaths) {
      expect(result[p], `${p} should have TODO`).toContain('TODO');
    }
  });
});

// ── buildInitFiles — scan data ────────────────────────────────────────────────

describe('buildInitFiles with scan data', () => {
  it('STRUCTURE.md includes detected framework', () => {
    const result = buildInitFiles(CONFIG, MOCK_SCAN);
    expect(result['.thesmos/architecture/STRUCTURE.md']).toContain('next');
  });

  it('ROUTING.md includes detected page routes', () => {
    const result = buildInitFiles(CONFIG, MOCK_SCAN);
    expect(result['.thesmos/architecture/ROUTING.md']).toContain('/about');
  });

  it('API.md includes detected API routes', () => {
    const result = buildInitFiles(CONFIG, MOCK_SCAN);
    expect(result['.thesmos/architecture/API.md']).toContain('/api/users');
  });

  it('STATE.md includes detected store files', () => {
    const result = buildInitFiles(CONFIG, MOCK_SCAN);
    expect(result['.thesmos/architecture/STATE.md']).toContain('stores/auth.ts');
  });

  it('playbooks include stack context from scan', () => {
    const result = buildInitFiles(CONFIG, MOCK_SCAN);
    expect(result['.thesmos/playbooks/ADD_PAGE.md']).toContain('next');
  });

  it('architecture files show placeholder when scan is undefined', () => {
    const result = buildInitFiles(CONFIG, undefined);
    expect(result['.thesmos/architecture/STRUCTURE.md']).toContain('thesmos scan');
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('buildInitFiles idempotency', () => {
  it('without scan — applying output as input produces identical output', () => {
    const first = buildInitFiles(CONFIG, undefined);
    const second = buildInitFiles(CONFIG, undefined, first);
    for (const path of Object.keys(first)) {
      expect(second[path], `${path} should be identical on second run`).toBe(first[path]);
    }
  });

  it('with scan — applying output as input produces identical output', () => {
    const first = buildInitFiles(CONFIG, MOCK_SCAN);
    const second = buildInitFiles(CONFIG, MOCK_SCAN, first);
    for (const path of Object.keys(first)) {
      expect(second[path], `${path} should be identical on second run with scan`).toBe(first[path]);
    }
  });

  it('config.json is preserved when already present', () => {
    const customConfig = '{"project":"custom-override"}\n';
    const existing = { '.thesmos/config.json': customConfig };
    const result = buildInitFiles(CONFIG, undefined, existing);
    expect(result['.thesmos/config.json']).toBe(customConfig);
  });

  it('report.json is regenerated (not preserved)', () => {
    const oldReport = '{"_generatedSections":["old"]}\n';
    const existing = { '.thesmos/report.json': oldReport };
    const result = buildInitFiles(CONFIG, undefined, existing);
    // report.json has preserveExisting: false, so it should be the fresh stub
    expect(result['.thesmos/report.json']).not.toBe(oldReport);
  });

  it('manual content outside markers is preserved on subsequent runs', () => {
    // Simulate user adding manual text to README between the markers and end of file
    const first = buildInitFiles(CONFIG);
    const withManual: Record<string, string> = {
      ...first,
      '.thesmos/README.md':
        first['.thesmos/README.md'] + '\n\n## My Manual Section\n\nHand-written content.\n',
    };
    const second = buildInitFiles(CONFIG, undefined, withManual);
    expect(second['.thesmos/README.md']).toContain('My Manual Section');
    expect(second['.thesmos/README.md']).toContain('Hand-written content.');
  });
});

// ── writeThesmosDir ────────────────────────────────────────────────────────

describe('writeThesmosDir', () => {
  it('creates all 24 files in a fresh directory', () => {
    const root = makeTmpDir();
    const results = writeThesmosDir(root, CONFIG);
    expect(results).toHaveLength(24);
    expect(results.every((r) => r.created)).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('creates nested directories automatically', () => {
    const root = makeTmpDir();
    writeThesmosDir(root, CONFIG);
    expect(existsSync(join(root, '.thesmos/governance'))).toBe(true);
    expect(existsSync(join(root, '.thesmos/architecture'))).toBe(true);
    expect(existsSync(join(root, '.thesmos/playbooks'))).toBe(true);
    expect(existsSync(join(root, '.thesmos/agents'))).toBe(true);
    expect(existsSync(join(root, '.thesmos/skills'))).toBe(true);
    expect(existsSync(join(root, '.thesmos/profiles'))).toBe(true);
    expect(existsSync(join(root, '.thesmos/rules'))).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('creates registry.json with default content', () => {
    const root = makeTmpDir();
    writeThesmosDir(root, CONFIG);
    const registryPath = join(root, '.thesmos/registry.json');
    expect(existsSync(registryPath)).toBe(true);
    const content = JSON.parse(readFileSync(registryPath, 'utf8'));
    expect(content.rules).toContain('@thesmos/core');
    expect(Array.isArray(content.agents)).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('preserves registry.json user edits on second run', () => {
    const root = makeTmpDir();
    writeThesmosDir(root, CONFIG);
    const registryPath = join(root, '.thesmos/registry.json');
    const edited = JSON.stringify({ rules: ['@thesmos/core', '@my-org/custom'], agents: ['my-agent'] }, null, 2) + '\n';
    writeFileSync(registryPath, edited, 'utf8');
    writeThesmosDir(root, CONFIG);
    expect(readFileSync(registryPath, 'utf8')).toBe(edited);
    rmSync(root, { recursive: true });
  });

  it('skips files that have not changed on a second run', () => {
    const root = makeTmpDir();
    writeThesmosDir(root, CONFIG);
    const results2 = writeThesmosDir(root, CONFIG);
    const skipped = results2.filter((r: InitFileResult) => r.skipped);
    // Most files should be skipped since nothing changed
    expect(skipped.length).toBeGreaterThan(0);
    rmSync(root, { recursive: true });
  });

  it('preserves config.json user edits on second run', () => {
    const root = makeTmpDir();
    writeThesmosDir(root, CONFIG);
    const configPath = join(root, '.thesmos/config.json');
    writeFileSync(configPath, '{"project":"user-edited"}\n', 'utf8');
    writeThesmosDir(root, CONFIG);
    expect(readFileSync(configPath, 'utf8')).toBe('{"project":"user-edited"}\n');
    rmSync(root, { recursive: true });
  });

  it('dryRun produces results without writing files', () => {
    const root = makeTmpDir();
    const results = writeThesmosDir(root, CONFIG, undefined, { dryRun: true });
    expect(results).toHaveLength(24);
    expect(existsSync(join(root, '.thesmos/config.json'))).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('updates a markdown file when generated content changes', () => {
    const root = makeTmpDir();
    writeThesmosDir(root, CONFIG);
    // Simulate run with scan data — architecture files should change
    const results2 = writeThesmosDir(root, CONFIG, MOCK_SCAN);
    const updated = results2.filter((r: InitFileResult) => r.updated);
    // Architecture files with real scan data should differ from placeholder
    expect(updated.some((r: InitFileResult) => r.path.includes('architecture/'))).toBe(true);
    rmSync(root, { recursive: true });
  });
});
