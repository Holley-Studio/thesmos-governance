// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

describe('Zeus external agent orchestration', () => {
  it('catalog Zeus includes External Agent Interoperability', () => {
    const path = join(ROOT, 'thesmos/catalog/agents/pantheon/zeus-executive-agent.md');
    const body = readFileSync(path, 'utf8');
    expect(body).toContain('## External Agent Interoperability');
    expect(body).toContain('Do not require an agent to be registered with Thesmos');
    expect(body).toContain('exact registered name');
  });

  it('claude-code Zeus export has unrestricted Agent tool', () => {
    const path = join(ROOT, 'pantheon/exports/claude-code/zeus-executive-agent.md');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf8');
    expect(body).toMatch(/tools:\s*\n(?:\s*-\s*\w+\n)*\s*-\s*Agent/m);
    expect(body).not.toMatch(/Agent\([^)]+\)/);
    expect(body).toContain('## External Agent Interoperability');
    expect(body).toContain('silently substituting');
  });

  it('pantheon-plugin packages Zeus with Agent tool', () => {
    const path = join(ROOT, 'pantheon-plugin/agents/zeus-executive-agent.md');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf8');
    expect(body).toContain('- Agent');
    expect(body).toContain('THESMOS:MANAGED');
  });
});
