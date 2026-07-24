// thesmos/build-commands.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, 'bin/commands/build.ts'), 'utf8');

describe('build.ts truthfulness invariants', () => {
  it('does NOT output nonexistent agent:run command', () => {
    expect(SRC).not.toContain('agent:run');
  });

  it('does NOT offer anthropic as embedding option (no Anthropic embeddings API)', () => {
    expect(SRC).not.toContain("value: 'anthropic'");
  });

  it('generated skill frontmatter includes name: field', () => {
    // The template literal for commandContent must include name: ${name}
    expect(SRC).toMatch(/`name: \$\{name\}`/);
  });
});
