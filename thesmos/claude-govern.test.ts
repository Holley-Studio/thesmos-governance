// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { evaluateGovernFindings } from './claude-govern';
import { CONFIG_DEFAULTS } from './config';
import type { ThesmosConfig } from './types';

// Assembled at runtime so secret scanners (GitHub push protection, SEC_003)
// never see a key-shaped literal in this source file — the rule engine under
// test still receives the exact fixture string.
const SECRET_LINE = `const stripeKey = "${['sk', 'live', 'FAKE'.repeat(6)].join('_')}";`;

function withConfig(overrides: Partial<ThesmosConfig>): ThesmosConfig {
  return { ...CONFIG_DEFAULTS, ...overrides };
}

describe('evaluateGovernFindings — real-time govern check', () => {
  it('blocks a genuine BLOCKER finding with default config', () => {
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/pay.ts',
      content: SECRET_LINE,
      config: CONFIG_DEFAULTS,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it('returns no findings for benign UI code', () => {
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/SearchBar.tsx',
      content: '<input placeholder="Search agents..." aria-label="Search" />',
      config: CONFIG_DEFAULTS,
    });
    expect(findings).toEqual([]);
  });

  it('honors a config severityRules downgrade — the option the tool itself offers', () => {
    const config = withConfig({
      severityRules: [
        ...CONFIG_DEFAULTS.severityRules.filter((r) => r.category !== 'vibe_hardcoded_secret'),
        { category: 'vibe_hardcoded_secret', severity: 'LOW' },
      ],
    });
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/config.ts',
      content: 'const API_KEY = "PLACEHOLDER";',
      config,
    });
    expect(findings.filter((f) => f.category === 'vibe_hardcoded_secret')).toEqual([]);
  });

  it('honors an inline thesmos-disable-next-line suppression', () => {
    const content = [
      '// thesmos-disable-next-line vibe_hardcoded_secret -- reason: fixture value for docs',
      'const API_KEY = "PLACEHOLDER";',
    ].join('\n');
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/example.ts',
      content,
      config: CONFIG_DEFAULTS,
    });
    expect(findings.filter((f) => f.category === 'vibe_hardcoded_secret')).toEqual([]);
  });

  it('an inline suppression only silences its own rule, not others on the same line', () => {
    const content = [
      '// thesmos-disable-next-line vibe_hardcoded_secret -- reason: testing',
      SECRET_LINE,
    ].join('\n');
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/pay.ts',
      content,
      config: CONFIG_DEFAULTS,
    });
    // Other secret rules (e.g. env_secret_hardcoded) must still fire
    expect(findings.some((f) => f.category !== 'vibe_hardcoded_secret')).toBe(true);
    expect(findings.filter((f) => f.category === 'vibe_hardcoded_secret')).toEqual([]);
  });

  it('honors autoMode.blockOn = HIGH by also blocking HIGH findings', () => {
    const config = withConfig({ autoMode: { blockOn: 'HIGH' } });
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/app.ts',
      content: 'function run() {\n  debugger;\n}',
      config,
    });
    expect(findings.some((f) => f.category === 'debugger_statement')).toBe(true);
  });

  it('defaults to blocking only BLOCKER findings (HIGH passes through)', () => {
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/app.ts',
      content: 'function run() {\n  debugger;\n}',
      config: CONFIG_DEFAULTS,
    });
    expect(findings).toEqual([]);
  });

  it('honors a severityRules upgrade of a lower rule to BLOCKER', () => {
    const config = withConfig({
      severityRules: [
        ...CONFIG_DEFAULTS.severityRules.filter((r) => r.category !== 'debugger_statement'),
        { category: 'debugger_statement', severity: 'BLOCKER' },
      ],
    });
    const findings = evaluateGovernFindings({
      filePath: '/proj/src/app.ts',
      content: 'function run() {\n  debugger;\n}',
      config,
    });
    expect(findings.some((f) => f.category === 'debugger_statement')).toBe(true);
  });
});
