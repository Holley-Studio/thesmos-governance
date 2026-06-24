// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatScanConsole, formatScanMarkdown } from './scan.ts';
import type { ScanResult, ThesmosConfig } from '../../types.ts';
import { CONFIG_DEFAULTS } from '../../config.ts';

const SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  scanVersion: '1',
  pages: [
    { path: '/', file: 'app/page.tsx', desc: '' },
    { path: '/dashboard', file: 'app/dashboard/page.tsx', desc: '' },
  ],
  apiRoutes: [
    { path: '/api/users', file: 'app/api/users/route.ts', methods: ['GET', 'POST'], auth: true, desc: '' },
    { path: '/api/public', file: 'app/api/public/route.ts', methods: ['POST'], auth: false, desc: '' },
  ],
  componentCount: 42,
  sharedUiFiles: ['components/ui/Button.tsx', 'components/ui/Input.tsx'],
  designSystemFiles: ['styles/theme.ts'],
  storeFiles: ['store/userSlice.ts'],
  testFiles: ['__tests__/api.test.ts'],
  largeFiles: [{ file: 'app/api/big/route.ts', lines: 600 }],
  riskyFiles: ['lib/admin.ts'],
  scriptFiles: [],
  envFiles: ['.env.local'],
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
    envVars: ['NEXT_PUBLIC_URL', 'SUPABASE_KEY'],
  },
};

const CONFIG: ThesmosConfig = {
  ...CONFIG_DEFAULTS,
  project: 'TestProject',
};

describe('formatScanConsole', () => {
  it('includes project name', () => {
    const out = formatScanConsole(SCAN, CONFIG);
    expect(out).toContain('TestProject');
  });

  it('shows framework and auth from detector', () => {
    const out = formatScanConsole(SCAN, CONFIG);
    expect(out).toContain('next');
    expect(out).toContain('supabase');
  });

  it('shows page and API route counts', () => {
    const out = formatScanConsole(SCAN, CONFIG);
    expect(out).toContain('2 routes');
    expect(out).toContain('2 ');
    expect(out).toContain('1 authenticated');
    expect(out).toContain('1 unprotected mutations');
  });

  it('shows env var count', () => {
    const out = formatScanConsole(SCAN, CONFIG);
    expect(out).toContain('2');
  });

  it('lists large files', () => {
    const out = formatScanConsole(SCAN, CONFIG);
    expect(out).toContain('app/api/big/route.ts');
    expect(out).toContain('600 lines');
  });

  it('mentions report path', () => {
    const out = formatScanConsole(SCAN, CONFIG);
    expect(out).toContain('report.json');
  });
});

describe('formatScanMarkdown', () => {
  it('includes project name in heading', () => {
    const out = formatScanMarkdown(SCAN, CONFIG);
    expect(out).toContain('## Thesmos Scan — TestProject');
  });

  it('includes stack table', () => {
    const out = formatScanMarkdown(SCAN, CONFIG);
    expect(out).toContain('| Framework |');
    expect(out).toContain('`next`');
  });

  it('includes summary table', () => {
    const out = formatScanMarkdown(SCAN, CONFIG);
    expect(out).toContain('| Pages |');
    expect(out).toContain('| 2 |');
  });
});
