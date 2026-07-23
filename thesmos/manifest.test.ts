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
});
