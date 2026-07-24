// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAgentRunPrompt, resolveAgentPath } from './agent-run.js';

describe('resolveAgentPath', () => {
  let root: string;

  afterEach(() => {
    // temp dirs left for OS cleanup; no shared state
  });

  it('finds .thesmos/agents/<name>.md', () => {
    root = mkdtempSync(join(tmpdir(), 'thesmos-agent-run-'));
    const dir = join(root, '.thesmos', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'my-bot.md'), '# My Bot\n\nDo things.\n', 'utf8');
    expect(resolveAgentPath(root, 'my-bot')).toBe(join(dir, 'my-bot.md'));
  });

  it('finds builder catalog path', () => {
    root = mkdtempSync(join(tmpdir(), 'thesmos-agent-run-'));
    const dir = join(root, '.thesmos', 'catalog', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'custom-agent.md'), '---\nid: custom\n---\nBody\n', 'utf8');
    expect(resolveAgentPath(root, 'custom-agent')).toContain('catalog/agents/custom-agent.md');
  });

  it('returns null when missing', () => {
    root = mkdtempSync(join(tmpdir(), 'thesmos-agent-run-'));
    expect(resolveAgentPath(root, 'does-not-exist')).toBeNull();
  });
});

describe('buildAgentRunPrompt', () => {
  it('includes agent body and optional user prompt', () => {
    const prompt = buildAgentRunPrompt('# Agent\n\nBe helpful.', 'Write a haiku');
    expect(prompt).toContain('Be helpful.');
    expect(prompt).toContain('Write a haiku');
    expect(prompt).toContain('TASK COMPLETE—');
  });

  it('strips YAML frontmatter', () => {
    const prompt = buildAgentRunPrompt('---\nid: x\n---\nReal body here', undefined);
    expect(prompt).toContain('Real body here');
    expect(prompt).not.toContain('id: x');
  });
});
