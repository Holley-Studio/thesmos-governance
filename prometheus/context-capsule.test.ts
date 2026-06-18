// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateContextCapsule,
  saveContextCapsule,
  loadContextCapsule,
  renderContextMd,
} from './context-capsule.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `prometheus-ctx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('renderContextMd', () => {
  const now = '2026-06-18T12:00:00.000Z';

  it('renders heading with project name and date', () => {
    const capsule = {
      project: 'my-app',
      snapshotAt: now,
      stack: [],
      patterns: [],
      constraints: [],
      governance: { ruleCount: 0, lastCleanScan: null, preset: null },
      health: { score: 100, grade: 'A' as const, issues: [], contextAgeHours: null, adaptersFresh: true },
    };
    const md = renderContextMd(capsule);
    expect(md).toContain('# Project Context — my-app — 2026-06-18');
  });

  it('renders stack section when non-empty', () => {
    const capsule = {
      project: 'test',
      snapshotAt: now,
      stack: ['TypeScript', 'Next.js 15'],
      patterns: [],
      constraints: [],
      governance: { ruleCount: 0, lastCleanScan: null, preset: null },
      health: { score: 100, grade: 'A' as const, issues: [], contextAgeHours: null, adaptersFresh: true },
    };
    const md = renderContextMd(capsule);
    expect(md).toContain('## Stack');
    expect(md).toContain('TypeScript, Next.js 15');
  });

  it('omits stack section when empty', () => {
    const capsule = {
      project: 'test',
      snapshotAt: now,
      stack: [],
      patterns: [],
      constraints: [],
      governance: { ruleCount: 0, lastCleanScan: null, preset: null },
      health: { score: 100, grade: 'A' as const, issues: [], contextAgeHours: null, adaptersFresh: true },
    };
    const md = renderContextMd(capsule);
    expect(md).not.toContain('## Stack');
  });

  it('renders patterns as bullet list', () => {
    const capsule = {
      project: 'test',
      snapshotAt: now,
      stack: [],
      patterns: ['Auth: middleware guard', 'State: Zustand stores'],
      constraints: [],
      governance: { ruleCount: 0, lastCleanScan: null, preset: null },
      health: { score: 100, grade: 'A' as const, issues: [], contextAgeHours: null, adaptersFresh: true },
    };
    const md = renderContextMd(capsule);
    expect(md).toContain('## Established Patterns');
    expect(md).toContain('- Auth: middleware guard');
    expect(md).toContain('- State: Zustand stores');
  });

  it('renders governance rule count when non-zero', () => {
    const capsule = {
      project: 'test',
      snapshotAt: now,
      stack: [],
      patterns: [],
      constraints: [],
      governance: { ruleCount: 844, lastCleanScan: '2026-06-18T00:00:00.000Z', preset: 'vibe-coding' },
      health: { score: 100, grade: 'A' as const, issues: [], contextAgeHours: null, adaptersFresh: true },
    };
    const md = renderContextMd(capsule);
    expect(md).toContain('844 active rules');
    expect(md).toContain('Preset: vibe-coding');
    expect(md).toContain('Last clean scan: 2026-06-18');
  });
});

describe('generateContextCapsule', () => {
  let root: string;

  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('returns a capsule with required fields', () => {
    const capsule = generateContextCapsule(root);
    expect(capsule).toHaveProperty('project');
    expect(capsule).toHaveProperty('snapshotAt');
    expect(capsule).toHaveProperty('stack');
    expect(capsule).toHaveProperty('patterns');
    expect(capsule).toHaveProperty('constraints');
    expect(capsule).toHaveProperty('governance');
    expect(capsule).toHaveProperty('health');
    expect(Array.isArray(capsule.stack)).toBe(true);
  });

  it('detects TypeScript from package.json', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'ts-app', dependencies: { typescript: '^5.0.0' } }),
    );
    const capsule = generateContextCapsule(root);
    expect(capsule.stack).toContain('TypeScript');
  });

  it('detects React from package.json', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'react-app', dependencies: { react: '^18.0.0' } }),
    );
    const capsule = generateContextCapsule(root);
    expect(capsule.stack).toContain('React');
  });

  it('detects Python from requirements.txt', () => {
    writeFileSync(join(root, 'requirements.txt'), 'requests==2.31.0\n');
    const capsule = generateContextCapsule(root);
    expect(capsule.stack).toContain('Python');
  });

  it('detects Go from go.mod', () => {
    writeFileSync(join(root, 'go.mod'), 'module example.com/myapp\ngo 1.21\n');
    const capsule = generateContextCapsule(root);
    expect(capsule.stack).toContain('Go');
  });

  it('reads project name from package.json', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'prometheus-helper' }));
    const capsule = generateContextCapsule(root);
    expect(capsule.project).toBe('prometheus-helper');
  });

  it('health score starts below 100 when no governance files exist', () => {
    const capsule = generateContextCapsule(root);
    // Missing .prometheus/config.json, CLAUDE.md, scope.json → deductions expected
    expect(capsule.health.score).toBeLessThan(100);
    expect(capsule.health.issues.length).toBeGreaterThan(0);
  });

  it('health grade maps correctly to score', () => {
    const capsule = generateContextCapsule(root);
    const { score, grade } = capsule.health;
    if (score >= 90) expect(grade).toBe('A');
    else if (score >= 80) expect(grade).toBe('B');
    else if (score >= 70) expect(grade).toBe('C');
    else if (score >= 60) expect(grade).toBe('D');
    else expect(grade).toBe('F');
  });

  it('detects node version from package.json engines', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'app', engines: { node: '>=20' } }),
    );
    const capsule = generateContextCapsule(root);
    expect(capsule.constraints.some((c) => c.includes('Node.js'))).toBe(true);
  });
});

describe('saveContextCapsule / loadContextCapsule', () => {
  let root: string;

  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('saves context.md to .prometheus/', () => {
    const capsule = generateContextCapsule(root);
    saveContextCapsule(root, capsule);
    expect(existsSync(join(root, '.prometheus', 'context.md'))).toBe(true);
  });

  it('saves context-meta.json alongside context.md', () => {
    const capsule = generateContextCapsule(root);
    saveContextCapsule(root, capsule);
    expect(existsSync(join(root, '.prometheus', 'context-meta.json'))).toBe(true);
  });

  it('loadContextCapsule returns null when no context.md exists', () => {
    expect(loadContextCapsule(root)).toBeNull();
  });

  it('loadContextCapsule returns a capsule after save', () => {
    const capsule = generateContextCapsule(root);
    saveContextCapsule(root, capsule);
    const loaded = loadContextCapsule(root);
    expect(loaded).not.toBeNull();
    expect(loaded?.project).toBe(capsule.project);
  });

  it('saved context.md contains the project name', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'my-saved-project' }));
    const capsule = generateContextCapsule(root);
    saveContextCapsule(root, capsule);
    const md = require('node:fs').readFileSync(join(root, '.prometheus', 'context.md'), 'utf8');
    expect(md).toContain('my-saved-project');
  });

  it('context health improves after CLAUDE.md is present', () => {
    // Without CLAUDE.md
    const before = generateContextCapsule(root);

    // Add CLAUDE.md
    writeFileSync(join(root, 'CLAUDE.md'), '# Claude\n');
    const after = generateContextCapsule(root);

    expect(after.health.score).toBeGreaterThan(before.health.score);
    expect(after.health.adaptersFresh).toBe(true);
  });
});
