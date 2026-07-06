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

// ── VIBE_007 — vibe_hardcoded_secret ─────────────────────────────────────────

describe('VIBE_007 — vibe_hardcoded_secret', () => {
  it('does NOT fire on HTML/JSX placeholder attributes', () => {
    const findings = detect('VIBE_007', [
      {
        path: 'src/components/SearchBar.tsx',
        content: [
          '<input placeholder="Search agents..." />',
          '<textarea placeholder="Describe your task"></textarea>',
          '<Input placeholder="you@example.com" />',
          'placeholder={t("form.email")}',
          '<input type="password" placeholder="Password" />',
        ].join('\n'),
      },
    ]);
    expect(findings).toEqual([]);
  });

  it('does NOT fire on uppercase UI constants containing PLACEHOLDER', () => {
    const findings = detect('VIBE_007', [
      {
        path: 'src/constants.ts',
        content: 'const SEARCH_PLACEHOLDER = "Search the Pantheon";',
      },
    ]);
    expect(findings).toEqual([]);
  });

  it('fires on a quoted PLACEHOLDER sentinel secret value', () => {
    const findings = detect('VIBE_007', [
      { path: 'src/config.ts', content: 'const API_KEY = "PLACEHOLDER";' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('vibe_hardcoded_secret');
  });

  it('fires on your-api-key style placeholder values', () => {
    const findings = detect('VIBE_007', [
      { path: 'src/openai.ts', content: 'const client = new OpenAI({ apiKey: "your-api-key-here" });' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on sk-proj- style keys', () => {
    const findings = detect('VIBE_007', [
      { path: 'src/openai.ts', content: 'const key = "sk-proj-abc123def456";' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does NOT fire when the value comes from the environment', () => {
    const findings = detect('VIBE_007', [
      { path: 'src/openai.ts', content: "const apiKey = process['env' as 'env']['OPENAI_API_KEY'];" },
    ]);
    expect(findings).toEqual([]);
  });
});

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
