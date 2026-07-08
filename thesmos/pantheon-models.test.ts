import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANTHEON_MODELS, modelFor, DEFAULT_MODEL } from './generated/pantheon-models.ts';

// The catalog (platforms.claude_model) is the single source of truth for an
// agent's Claude model. Every runtime consumer — MCP server, VS Code panel,
// pantheon CLI export — resolves the model through PANTHEON_MODELS, which is
// generated from the catalog. This test fails the moment the generated map
// drifts from the catalog, i.e. someone changed a model but forgot to run
// `npm run agents:export`. That is exactly the drift this map exists to kill.

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CATALOG_DIR = resolve(__dirname, 'catalog/agents');

/** Recursively collect every agent markdown file under the catalog. */
function collectAgentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectAgentFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Pull id + platforms.claude_model straight from the frontmatter. */
function readCatalogModels(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const file of collectAgentFiles(CATALOG_DIR)) {
    const src = readFileSync(file, 'utf-8');
    const id = src.match(/^id:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
    const model = src
      .match(/claude_model:\s*["']?(.+?)["']?\s*$/m)?.[1]
      ?.trim()
      .replace(/\[1m\]/g, '');
    if (id && model) map[id] = model;
  }
  return map;
}

describe('PANTHEON_MODELS generated map', () => {
  const catalog = readCatalogModels();

  it('has at least one agent', () => {
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
  });

  it('matches the catalog exactly (no stale or missing entries)', () => {
    // Sorted for a readable diff when this fails.
    const sorted = (m: Record<string, string>) =>
      Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
    expect(sorted(PANTHEON_MODELS)).toEqual(sorted(catalog));
  });

  it('resolves the three orchestration/security gods to Opus', () => {
    expect(modelFor('zeus-executive-agent')).toBe('claude-opus-4-8');
    expect(modelFor('argus-security-agent')).toBe('claude-opus-4-8');
    expect(modelFor('athena-strategy-agent')).toBe('claude-opus-4-8');
  });

  it('falls back to the baseline tier for an unknown id', () => {
    expect(modelFor('not-a-real-agent')).toBe(DEFAULT_MODEL);
  });
});
