// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, 'adapters.ts'), 'utf8');

describe('ClaudeAdapter security invariants', () => {
  it('does NOT pass --dangerously-skip-permissions to the subprocess', () => {
    expect(SRC).not.toContain('--dangerously-skip-permissions');
  });

  it('spawn args include -p flag for non-interactive Claude invocation', () => {
    expect(SRC).toContain("'-p'");
  });
});
