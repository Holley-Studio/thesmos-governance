// @vitest-environment node
/**
 * Unit tests for the AI behavior file linter.
 * Tests lint rules, stack detection, and initFromAiConfig output.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverAiConfigFiles,
  lintAiConfigFiles,
  initFromAiConfig,
  formatAiLintConsole,
} from './ai-lint.ts';

// ── Fixture helpers ───────────────────────────────────────────────────────────

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-ai-lint-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relPath: string, content: string): void {
  const abs = join(root, relPath);
  mkdirSync(join(root, relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '.'), {
    recursive: true,
  });
  writeFileSync(abs, content, 'utf8');
}

const GOOD_CLAUDE_MD = `
# Project Rules

## Security
- Always validate user input using zod
- Never store secrets in code — use environment variables
- All API routes require authentication unless explicitly public
- Add CSRF protection to all state-mutating endpoints
- Rate limit all public-facing endpoints

## Architecture
- Next.js 14 app directory structure
- Prisma ORM for database access
- tRPC for type-safe API calls
- React Query for data fetching

## Testing
- Write unit tests for all new functions using vitest
- API routes require integration tests
- Run tests before every commit

## Thesmos Governance
- All code reviewed by Thesmos before merge
- Follow .thesmos/GUARDRAILS.md
`;

// ── Discovery ─────────────────────────────────────────────────────────────────

describe('discoverAiConfigFiles', () => {
  it('returns empty when no AI config files exist', () => {
    expect(discoverAiConfigFiles(root)).toHaveLength(0);
  });

  it('discovers CLAUDE.md', () => {
    write('CLAUDE.md', GOOD_CLAUDE_MD);
    const files = discoverAiConfigFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]!.tool).toBe('claude');
    expect(files[0]!.relPath).toBe('CLAUDE.md');
  });

  it('discovers .cursorrules', () => {
    write('.cursorrules', GOOD_CLAUDE_MD);
    const files = discoverAiConfigFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]!.tool).toBe('cursor');
  });

  it('discovers multiple AI config files', () => {
    write('CLAUDE.md', GOOD_CLAUDE_MD);
    write('GEMINI.md', GOOD_CLAUDE_MD);
    write('.cursorrules', GOOD_CLAUDE_MD);
    expect(discoverAiConfigFiles(root)).toHaveLength(3);
  });

  it('correctly reads file content', () => {
    write('CLAUDE.md', GOOD_CLAUDE_MD);
    const files = discoverAiConfigFiles(root);
    expect(files[0]!.content).toContain('Security');
  });
});

// ── Lint rules ────────────────────────────────────────────────────────────────

describe('lintAiConfigFiles', () => {
  describe('AICFG_001: no AI config files', () => {
    it('fires ai_config_missing when no files found', () => {
      const findings = lintAiConfigFiles(root, []);
      expect(findings.some((f) => f.category === 'ai_config_missing')).toBe(true);
    });

    it('returns early — no other findings when files array is empty', () => {
      const findings = lintAiConfigFiles(root, []);
      expect(findings).toHaveLength(1);
    });
  });

  describe('AICFG_002: placeholder file', () => {
    it('fires ai_config_placeholder when file is < 200 bytes', () => {
      write('CLAUDE.md', '# TODO: add rules here');
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_placeholder')).toBe(true);
    });

    it('does not fire on a substantial file', () => {
      write('CLAUDE.md', GOOD_CLAUDE_MD);
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_placeholder')).toBe(false);
    });
  });

  describe('AICFG_003: no security section', () => {
    it('fires when no security keywords found', () => {
      write('CLAUDE.md', `
# Project Rules
## Architecture
Next.js app with React components and Prisma ORM for database access.
Always write tests using vitest before committing changes.
This is a project with some governance rules.
`.repeat(5));
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_no_security')).toBe(true);
    });

    it('does not fire when security keywords present', () => {
      write('CLAUDE.md', GOOD_CLAUDE_MD);
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_no_security')).toBe(false);
    });
  });

  describe('AICFG_004: discourages tests', () => {
    it('fires when file says "don\'t write tests"', () => {
      write('CLAUDE.md', `
${GOOD_CLAUDE_MD}
Note: don't write tests for utility files, just implement them quickly.
`.repeat(2));
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_discourages_tests')).toBe(true);
    });

    it('does not fire for normal test guidance', () => {
      write('CLAUDE.md', GOOD_CLAUDE_MD);
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_discourages_tests')).toBe(false);
    });
  });

  describe('AICFG_005: permits force push', () => {
    it('fires when force push mentioned without prohibition', () => {
      write('CLAUDE.md', `${GOOD_CLAUDE_MD}\n\nWhen stuck, you can git push --force to resolve.`);
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_permits_force_push')).toBe(true);
    });
  });

  describe('AICFG_007: permits secret commits', () => {
    it('fires on highest severity BLOCKER when secrets mentioned', () => {
      write('CLAUDE.md', `${GOOD_CLAUDE_MD}\n\nIf needed, commit secrets to code temporarily for testing.`);
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      const f = findings.find((x) => x.category === 'ai_config_permits_secrets');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('BLOCKER');
    });
  });

  describe('AICFG_010: not synced with Thesmos', () => {
    it('fires when .thesmos/config.json exists but file has no thesmos mention', () => {
      write('.thesmos/config.json', '{}');
      write('CLAUDE.md', `
# Rules
## Security
Always validate input. Never store secrets. Add auth to all endpoints.
## Testing
Write vitest tests for all features.
`.repeat(5));
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_not_synced')).toBe(true);
    });

    it('does not fire when thesmos is mentioned', () => {
      write('.thesmos/config.json', '{}');
      write('CLAUDE.md', GOOD_CLAUDE_MD);
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      expect(findings.some((f) => f.category === 'ai_config_not_synced')).toBe(false);
    });
  });

  describe('good file passes all checks', () => {
    it('zero findings for a well-configured CLAUDE.md', () => {
      write('CLAUDE.md', GOOD_CLAUDE_MD);
      const files = discoverAiConfigFiles(root);
      const findings = lintAiConfigFiles(root, files);
      // Low-severity architecture check may fire on short files; filter those
      const importantFindings = findings.filter(
        (f) => f.severity !== 'LOW',
      );
      expect(importantFindings).toHaveLength(0);
    });
  });
});

// ── initFromAiConfig ──────────────────────────────────────────────────────────

describe('initFromAiConfig', () => {
  it('reports no files when workspace has no AI config', () => {
    const result = initFromAiConfig(root, true);
    expect(result.filesRead).toHaveLength(0);
    expect(result.configWritten).toBe(false);
  });

  it('detects vibe-coding preset when CLAUDE.md exists', () => {
    write('CLAUDE.md', GOOD_CLAUDE_MD);
    const result = initFromAiConfig(root, true); // dry run
    expect(result.stack.recommendedPreset).toBe('thesmos/vibe-coding');
    expect(result.stack.isAiHeavy).toBe(true);
  });

  it('detects frameworks from AI config content', () => {
    write('CLAUDE.md', GOOD_CLAUDE_MD);
    const result = initFromAiConfig(root, true);
    expect(result.stack.frameworks).toContain('Next.js');
    expect(result.stack.frameworks).toContain('Prisma');
  });

  it('writes config.json when it does not exist (non-dry-run)', () => {
    write('CLAUDE.md', GOOD_CLAUDE_MD);
    const result = initFromAiConfig(root, false);
    expect(result.configWritten).toBe(true);
    expect(result.configAlreadyExisted).toBe(false);
  });

  it('does not overwrite existing config.json', () => {
    write('CLAUDE.md', GOOD_CLAUDE_MD);
    write('.thesmos/config.json', '{"project":"existing"}');
    const result = initFromAiConfig(root, false);
    expect(result.configWritten).toBe(false);
    expect(result.configAlreadyExisted).toBe(true);
  });

  it('dry run does not write config.json', () => {
    write('CLAUDE.md', GOOD_CLAUDE_MD);
    const result = initFromAiConfig(root, true);
    expect(result.configWritten).toBe(false);
  });
});

// ── formatAiLintConsole ───────────────────────────────────────────────────────

describe('formatAiLintConsole', () => {
  it('shows clean message when no findings', () => {
    const out = formatAiLintConsole([], 1, 'TestRepo');
    expect(out).toContain('pass governance checks');
    expect(out).toContain('TestRepo');
  });

  it('includes finding details in output', () => {
    write('CLAUDE.md', '# short');
    const files = discoverAiConfigFiles(root);
    const findings = lintAiConfigFiles(root, files);
    const out = formatAiLintConsole(findings, files.length, 'TestRepo');
    expect(out).toContain('finding');
  });
});
