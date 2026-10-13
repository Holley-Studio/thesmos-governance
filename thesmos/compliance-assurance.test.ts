// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)));
const CLI = join(PKG_ROOT, 'bin', 'cli.ts');
const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

function runCompliance(
  cwd: string,
  standard = 'gdpr'
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    ['--import', TSX_IMPORT, CLI, 'compliance:report', '--standard', standard],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, THESMOS_TIER: 'premium' },
      timeout: 60000,
      windowsHide: true,
    }
  );
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// This suite launches the full CLI; allow its subprocess deadline plus cleanup
// rather than applying the default five-second unit-test deadline.
describe('compliance:report assurance', { timeout: 65_000 }, () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'thesmos-compliance-'));
    mkdirSync(join(dir, '.thesmos'), { recursive: true });
    writeFileSync(
      join(dir, '.thesmos', 'config.json'),
      JSON.stringify({ project: 'test', version: '2.0.0' }, null, 2)
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('missing report.json → INCOMPLETE and nonzero exit (never 100%)', () => {
    const { status, stdout } = runCompliance(dir, 'soc2');
    expect(stdout).toMatch(/Assurance:\*\* INCOMPLETE|Assurance \| INCOMPLETE/);
    expect(stdout).not.toMatch(/Coverage Score \| 100%/);
    expect(stdout).not.toMatch(/Compliance Score \| 100%/);
    expect(status).not.toBe(0);
  });

  it('malformed report.json → INCOMPLETE', () => {
    writeFileSync(join(dir, '.thesmos', 'report.json'), '{not-json');
    const { status, stdout } = runCompliance(dir, 'gdpr');
    expect(stdout).toMatch(/INCOMPLETE/);
    expect(status).not.toBe(0);
  });
});
