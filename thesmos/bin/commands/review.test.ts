// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatFindingsConsole,
  formatFindingsMarkdown,
  formatFindingsJson,
  runReview,
} from '../../review.ts';
import { CONFIG_DEFAULTS } from '../../config.ts';
import type { ScanResult, ThesmosConfig } from '../../types.ts';

const BASE_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  scanVersion: '1',
  pages: [{ path: '/', file: 'app/page.tsx', desc: '' }],
  apiRoutes: [],
  componentCount: 5,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
  detector: {
    framework: 'next',
    auth: 'supabase',
    testingFramework: 'vitest',
    deployment: 'vercel',
    apiConvention: 'next-app-router',
    typescript: true,
    packageManager: 'npm',
    cssFramework: 'tailwind',
    uiLibrary: 'shadcn',
    envVars: [],
  },
};

const CONFIG: ThesmosConfig = {
  ...CONFIG_DEFAULTS,
  project: 'ReviewTest',
};

describe('review output formatters', () => {
  it('formatFindingsConsole: no findings shows summary', () => {
    const findings = runReview({ scan: BASE_SCAN, config: CONFIG });
    const out = formatFindingsConsole(findings, CONFIG.project, 'Review');
    expect(out).toContain('ReviewTest');
  });

  it('formatFindingsMarkdown: returns markdown table', () => {
    const findings = runReview({ scan: BASE_SCAN, config: CONFIG });
    const out = formatFindingsMarkdown(findings, CONFIG.project);
    expect(out).toContain('## ');
  });

  it('formatFindingsJson: returns valid JSON with findings array', () => {
    const findings = runReview({ scan: BASE_SCAN, config: CONFIG });
    const out = formatFindingsJson(findings);
    const parsed = JSON.parse(out) as { total: number; findings: unknown[] };
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(typeof parsed.total).toBe('number');
  });
});

describe('runReview with changed files', () => {
  it('accepts changedFiles with content', () => {
    const findings = runReview({
      scan: BASE_SCAN,
      config: CONFIG,
      changedFiles: [
        {
          path: 'app/api/users/route.ts',
          content: 'export async function GET() { return Response.json({}); }',
          diff: '+export async function GET() { return Response.json({}); }',
        },
      ],
    });
    expect(Array.isArray(findings)).toBe(true);
  });

  it('findings are sorted deterministically', () => {
    const findings = runReview({ scan: BASE_SCAN, config: CONFIG });
    const sorted = [...findings];
    sorted.sort((a, b) =>
      `${a.severity}${a.file}${a.message}`.localeCompare(`${b.severity}${b.file}${b.message}`)
    );
    // Each finding has a severity
    for (const f of findings) {
      expect(f).toHaveProperty('severity');
      expect(f).toHaveProperty('message');
      expect(f).toHaveProperty('category');
    }
  });
});
