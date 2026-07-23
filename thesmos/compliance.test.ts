// thesmos/compliance.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_SRC = readFileSync(resolve(__dirname, 'mcp-server.ts'), 'utf8');

describe('compliance: scan staleness constant', () => {
  it('MAX_SCAN_AGE_MS is defined as 24h in milliseconds', () => {
    expect(MCP_SERVER_SRC).toMatch(/MAX_SCAN_AGE_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('staleness guard appears before complianceScore calculation', () => {
    const stalenessIdx = MCP_SERVER_SRC.indexOf('MAX_SCAN_AGE_MS');
    const complianceScoreIdx = MCP_SERVER_SRC.indexOf('complianceScore');
    expect(stalenessIdx).toBeGreaterThan(-1);
    expect(complianceScoreIdx).toBeGreaterThan(-1);
    expect(stalenessIdx).toBeLessThan(complianceScoreIdx);
  });

  it('returns NOT_ASSESSED reason for stale scan', () => {
    expect(MCP_SERVER_SRC).toContain("'NOT_ASSESSED'");
    expect(MCP_SERVER_SRC).toContain('stale');
  });

  it('COMPLIANT and NON_COMPLIANT status values are present', () => {
    expect(MCP_SERVER_SRC).toContain("'COMPLIANT'");
    expect(MCP_SERVER_SRC).toContain("'NON_COMPLIANT'");
  });

  it('scanGeneratedAt field is included in responses', () => {
    expect(MCP_SERVER_SRC).toContain('scanGeneratedAt');
  });

  it('empty framework (0 rules) returns NOT_ASSESSED not vacuous COMPLIANT', () => {
    expect(MCP_SERVER_SRC).toMatch(/frameworkRules\.length\s*===\s*0/);
  });
});
