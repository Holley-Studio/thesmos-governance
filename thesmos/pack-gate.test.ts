import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const manifest = JSON.parse(
  readFileSync(join(__dirname, 'catalog', 'free-agents.json'), 'utf8'),
) as { freeAgentIds: string[] };

let packedFiles: string[] = [];

beforeAll(() => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: __dirname,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  packedFiles = parsed[0]!.files.map((f) => f.path);
}, 60_000);

describe('npm tarball content gate', () => {
  it('ships every free god (the free tier must actually work)', () => {
    for (const id of manifest.freeAgentIds) {
      expect(packedFiles).toContain(`catalog/agents/pantheon/${id}.md`);
    }
  });

  it('ships the manifests the CLI needs for counts and upsell', () => {
    expect(packedFiles).toContain('catalog/free-agents.json');
    expect(packedFiles).toContain('catalog/pantheon-map.json');
  });

  it('ships ZERO premium agents — the content gate is physical', () => {
    const freeSet = new Set(manifest.freeAgentIds.flatMap((id) => [
      `catalog/agents/pantheon/${id}.md`,
      `catalog/agents/pantheon/${id}-README.md`,
    ]));
    const leaked = packedFiles.filter(
      (p) =>
        (p.startsWith('catalog/agents/pantheon/') ||
         p.startsWith('catalog/agents/figma/') ||
         /^catalog\/agents\/[^/]+\.md$/.test(p)) &&
        !freeSet.has(p),
    );
    expect(leaked, `premium agents leaked into the tarball: ${leaked.join(', ')}`).toEqual([]);
  });
});
