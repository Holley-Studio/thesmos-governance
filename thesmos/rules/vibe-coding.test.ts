// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { VIBE_CODING_RULES } from './vibe-coding';
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
  const r = VIBE_CODING_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({
    scan: EMPTY_SCAN,
    config: CONFIG_DEFAULTS,
    changedFiles: files,
    root: '/nonexistent-thesmos-test-root',
  });
}

// ── VIBE_009 — vibe_sql_template_injection ───────────────────────────────────

describe('VIBE_009 — vibe_sql_template_injection', () => {
  it('does NOT fire on identifiers that merely contain SQL keywords (createTerminal, updateConfig)', () => {
    const findings = detect('VIBE_009', [
      {
        path: 'src/extension.ts',
        content: [
          'const terminal = vscode.window.createTerminal(`${agent.name} — Thesmos`);',
          'const cfg = updateConfig(`${key}`);',
          'const item = dropdownItem(`${label}`);',
        ].join('\n'),
      },
    ]);
    expect(findings).toEqual([]);
  });

  it('fires on real SQL built with template-literal interpolation', () => {
    const findings = detect('VIBE_009', [
      {
        path: 'src/db.ts',
        content: 'db.execute(`SELECT * FROM users WHERE email = \'${email}\'`);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('vibe_sql_template_injection');
    expect(findings[0].line).toBe(1);
  });

  it('fires on CREATE used as a real SQL keyword', () => {
    const findings = detect('VIBE_009', [
      {
        path: 'src/migrate.ts',
        content: 'db.run(`CREATE TABLE ${tableName} (id INT)`);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('skips test files', () => {
    const findings = detect('VIBE_009', [
      {
        path: 'src/db.test.ts',
        content: 'db.execute(`SELECT * FROM users WHERE id = ${id}`);',
      },
    ]);
    expect(findings).toEqual([]);
  });
});
