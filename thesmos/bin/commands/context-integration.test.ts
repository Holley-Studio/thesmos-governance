import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { ScanResult } from '../../types.js';

const roots: string[] = [];
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thesmos command context '));
  roots.push(root);
  mkdirSync(join(root, '.thesmos'));
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function run(root: string, module: string, invocation: string) {
  return spawnSync(process.execPath, ['--import', loader, '--input-type=module', '--eval', `import {${module}} from ${JSON.stringify(new URL(module === 'cmdValidate' ? './validate.ts' : './memory.ts', import.meta.url).href)}; await ${invocation};`], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 12000 });
}

// A case can launch two CLI subprocesses, each with a 12-second deadline.
describe('command workspace integration', { timeout: 30_000 }, () => {
  it('cmdValidate passes its workspace root to existing-test detection', () => {
    const root = fixture();
    const scan: ScanResult = { _generatedSections: [], generatedAt: '2026-09-30T12:00:00Z', scanVersion: '2.0.0', pages: [], apiRoutes: [], componentCount: 0, sharedUiFiles: [], designSystemFiles: [], storeFiles: [], testFiles: ['feature.test.ts'], largeFiles: [], riskyFiles: [], scriptFiles: [], envFiles: [], clientBoundaryRisks: [] };
    writeFileSync(join(root, '.thesmos', 'report.json'), JSON.stringify(scan), 'utf8');
    writeFileSync(join(root, 'feature.ts'), 'export function testedFeature() { return true; }\nexport function untestedFeature() { return false; }', 'utf8');
    writeFileSync(join(root, 'feature.test.ts'), 'expect(testedFeature()).toBe(true);', 'utf8');
    const result = run(root, 'cmdValidate', "cmdValidate(['feature.ts','--json'])");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const review = JSON.parse(result.stdout) as { findings: Array<{ category: string; message: string }> };
    const debt = review.findings.filter(finding => finding.category === 'debt_exported_function_no_test');
    expect(debt).toHaveLength(1);
    expect(debt[0]?.message).toContain('untestedFeature');
  });
  it('cmdMemory doctor reports a held writer lock and leaves it intact', () => {
    const root = fixture();
    const before = run(root, 'cmdMemory', "cmdMemory('doctor', [])");
    expect(before.status, before.stderr).toBe(0);
    mkdirSync(join(root, '.thesmos', 'memory', '.write.lock'), { recursive: true });
    const after = run(root, 'cmdMemory', "cmdMemory('doctor', [])");
    expect(after.status, after.stderr).toBe(1);
    expect(after.stdout).toContain('✗  writer lock absent');
    expect(after.stdout).toContain('inspect ownership');
  });
});
