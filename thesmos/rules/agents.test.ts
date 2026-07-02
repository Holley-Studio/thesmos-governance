// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { AGENT_RULES } from './agents';
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
  const r = AGENT_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({
    scan: EMPTY_SCAN,
    config: CONFIG_DEFAULTS,
    changedFiles: files,
    // Hermetic root: no .thesmos/config.json here → allow1M defaults to false.
    root: '/nonexistent-thesmos-test-root',
  });
}

// ── AGNT_037 — 1M context window guard ───────────────────────────────────────

describe('AGNT_037 — agent_context_1m_unguarded', () => {
  it('does NOT fire on a markdown table row documenting the [1m] pattern', () => {
    const findings = detect('AGNT_037', [{
      path: 'CLAUDE.md',
      content: [
        '# Rules',
        '| Rule | Category | Summary |',
        '|---|---|---|',
        '| [AGNT_037] | `agent_context_1m_unguarded` | 1M context window enabled ([1m] model variant or context-1m beta flag) without guard |',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(0);
  });

  it('fires HIGH on a plain [1m] model line in a JSON settings file', () => {
    const findings = detect('AGNT_037', [{
      path: '.claude/settings.json',
      content: [
        '{',
        '  "model": "claude-fable-5[1m]"',
        '}',
      ].join('\n'),
    }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('HIGH');
    expect(findings[0]?.line).toBe(2);
  });

  it('fires on a context-1m beta flag outside a table row', () => {
    const findings = detect('AGNT_037', [{
      path: 'src/client.ts',
      content: "const headers = { 'anthropic-beta': 'context-1m-2025' };",
    }]);
    expect(findings).toHaveLength(1);
  });
});
