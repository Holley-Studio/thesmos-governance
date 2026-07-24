import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, 'free-agents.json'), 'utf8'),
) as { freeAgentIds: string[]; pantheonTotal: number; storeUrl: string; priceUsd: number };

describe('free-agents.json', () => {
  it('declares the 6 canonical free gods', () => {
    expect(manifest.freeAgentIds).toEqual([
      'zeus-executive-agent',
      'athena-strategy-agent',
      'argus-security-agent',
      'apollo-content-agent',
      'hephaestus-design-agent',
      'hebe-support-agent',
    ]);
  });

  it('every free agent ID has a real catalog file', () => {
    for (const id of manifest.freeAgentIds) {
      const path = join(__dirname, 'agents', 'pantheon', `${id}.md`);
      expect(existsSync(path), `missing catalog file for free agent: ${id}`).toBe(true);
    }
  });

  it('carries the pricing facts the CLI and store surfaces read', () => {
    expect(manifest.pantheonTotal).toBe(67);
    expect(manifest.priceUsd).toBe(24);
    expect(manifest.storeUrl).toBe('https://holleystudio.gumroad.com/l/thesmos-pantheon');
  });
});
