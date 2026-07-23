// thesmos/manifest.test.ts
// Drift test — fails if product-manifest.json drifts from the catalog sources of truth.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(__dirname, 'catalog/product-manifest.json');
const FREE_AGENTS_PATH = resolve(__dirname, 'catalog/free-agents.json');

describe('product manifest drift', () => {
  it('manifest file exists and is valid JSON', () => {
    const raw = readFileSync(MANIFEST_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('pantheonTotal in free-agents.json matches manifest.catalog.publishedAgentCount', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const free = JSON.parse(readFileSync(FREE_AGENTS_PATH, 'utf8'));
    expect(manifest.catalog.publishedAgentCount).toBe(free.pantheonTotal);
  });

  it('manifest schemaVersion is present', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(typeof manifest.schemaVersion).toBe('string');
    expect(manifest.schemaVersion).toMatch(/^\d+\.\d+$/);
  });

  it('manifest ruleCount is a positive integer', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(Number.isInteger(manifest.governance.ruleCount)).toBe(true);
    expect(manifest.governance.ruleCount).toBeGreaterThan(100);
  });

  it('manifest.governance.blockerRuleCount matches actual BLOCKER rules in registry', async () => {
    const { THESMOS_RULES } = await import('./rules/registry.js');
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const actualBlockers = (THESMOS_RULES as Array<{ severity: string }>).filter(r => r.severity === 'BLOCKER').length;
    expect(Number.isInteger(manifest.governance.blockerRuleCount)).toBe(true);
    expect(manifest.governance.blockerRuleCount).toBeGreaterThan(0);
    expect(manifest.governance.blockerRuleCount).toBe(actualBlockers);
  });

  it('manifest.governance.toolCount is 13 (MCP tool definitions)', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(manifest.governance.toolCount).toBe(13);
  });

  it('manifest.pricing.tiers has essentials (free) and full-pantheon ($24)', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(Array.isArray(manifest.pricing?.tiers)).toBe(true);
    const essentials = manifest.pricing.tiers.find((t: { id: string }) => t.id === 'essentials');
    const fullPantheon = manifest.pricing.tiers.find((t: { id: string }) => t.id === 'full-pantheon');
    expect(essentials?.priceUsd).toBe(0);
    expect(fullPantheon?.priceUsd).toBe(24);
  });
});
