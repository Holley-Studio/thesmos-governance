import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverScopeFiles,
  buildReconPrompt,
  parseReconOutput,
  buildReconContext,
} from './recon.js';
import type { AutopilotTask, AutopilotPlan } from '../types.js';

let tmpRoot: string;

function makeTask(overrides: Partial<AutopilotTask> = {}): AutopilotTask {
  return {
    index: 0,
    title: 'Add widget component',
    context: 'Create a reusable Widget',
    scope: ['src/components/'],
    allowedPackages: [],
    dependsOn: [],
    doneCriteria: [{ type: 'file_exists', value: 'src/components/Widget.tsx', raw: 'file:src/components/Widget.tsx' }],
    isCheckpoint: false,
    ...overrides,
  };
}

function makePlan(overrides: Partial<AutopilotPlan> = {}): AutopilotPlan {
  return {
    project: 'Test Project',
    adapter: 'claude',
    gates: ['npm test'],
    commitOnPass: true,
    maxRetries: 2,
    tasks: [],
    rawContent: '',
    ...overrides,
  };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'thesmos-recon-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('discoverScopeFiles', () => {
  it('returns empty array when scope paths do not exist', () => {
    const files = discoverScopeFiles(tmpRoot, ['src/nonexistent/']);
    expect(files).toEqual([]);
  });

  it('discovers files in a directory', () => {
    const dir = join(tmpRoot, 'src', 'components');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Widget.tsx'), 'export const Widget = () => null;');
    writeFileSync(join(dir, 'Widget.test.tsx'), 'test("Widget", () => {});');

    const files = discoverScopeFiles(tmpRoot, ['src/components/']);
    expect(files.length).toBe(2);
    const widgetFile = files.find((f) => f.path.includes('Widget.tsx') && !f.path.includes('test'));
    const testFile = files.find((f) => f.path.includes('test'));
    expect(widgetFile).toBeDefined();
    expect(widgetFile!.isTest).toBe(false);
    expect(testFile!.isTest).toBe(true);
  });

  it('discovers a single file scope', () => {
    mkdirSync(join(tmpRoot, 'src'), { recursive: true });
    writeFileSync(join(tmpRoot, 'src', 'main.ts'), 'export {};');

    const files = discoverScopeFiles(tmpRoot, ['src/main.ts']);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('src/main.ts');
  });

  it('skips node_modules', () => {
    const nm = join(tmpRoot, 'src', 'node_modules', 'pkg');
    mkdirSync(nm, { recursive: true });
    writeFileSync(join(nm, 'index.ts'), 'export {};');

    const files = discoverScopeFiles(tmpRoot, ['src/']);
    expect(files.every((f) => !f.path.includes('node_modules'))).toBe(true);
  });

  it('respects maxFiles limit', () => {
    mkdirSync(join(tmpRoot, 'src'), { recursive: true });
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(tmpRoot, 'src', `file${i}.ts`), '');
    }
    const files = discoverScopeFiles(tmpRoot, ['src/'], 5);
    expect(files.length).toBeLessThanOrEqual(5);
  });
});

describe('buildReconPrompt', () => {
  it('includes task title and scope', () => {
    const task = makeTask();
    const plan = makePlan();
    const prompt = buildReconPrompt(task, plan, []);
    expect(prompt).toContain('Add widget component');
    expect(prompt).toContain('READ-ONLY RECONNAISSANCE');
    expect(prompt).toContain('do NOT modify any files');
  });

  it('lists scope files when provided', () => {
    const task = makeTask();
    const plan = makePlan();
    const prompt = buildReconPrompt(task, plan, [
      { path: 'src/components/Button.tsx', sizeBytes: 1024, isTest: false },
    ]);
    expect(prompt).toContain('Button.tsx');
    expect(prompt).toContain('1KB');
  });

  it('notes empty scope', () => {
    const task = makeTask({ scope: [] });
    const plan = makePlan();
    const prompt = buildReconPrompt(task, plan, []);
    expect(prompt).toContain('creates them from scratch');
  });

  it('includes all four required output headers', () => {
    const prompt = buildReconPrompt(makeTask(), makePlan(), []);
    expect(prompt).toContain('PATTERNS FOUND:');
    expect(prompt).toContain('LIBRARIES AVAILABLE:');
    expect(prompt).toContain('PLANNED APPROACH:');
    expect(prompt).toContain('CONCERNS:');
  });
});

describe('parseReconOutput', () => {
  const rawOutput = `PATTERNS FOUND:
camelCase for variables, PascalCase for classes

LIBRARIES AVAILABLE:
react, zod, vitest

PLANNED APPROACH:
Create Widget.tsx using React.FC pattern

CONCERNS:
Widget name conflicts with existing Widget in utils/`;

  it('extracts all four sections', () => {
    const report = parseReconOutput(rawOutput, 3);
    expect(report.patternsFound).toContain('camelCase');
    expect(report.librariesAvailable).toContain('react');
    expect(report.plannedApproach).toContain('Widget.tsx');
    expect(report.concerns).toContain('conflicts');
    expect(report.scopeFileCount).toBe(3);
    expect(report.rawOutput).toBe(rawOutput);
  });

  it('returns empty strings for missing sections', () => {
    const report = parseReconOutput('Nothing structured here.', 0);
    expect(report.patternsFound).toBe('');
    expect(report.librariesAvailable).toBe('');
  });
});

describe('buildReconContext', () => {
  it('includes all populated sections', () => {
    const report = {
      patternsFound: 'camelCase',
      librariesAvailable: 'react, zod',
      plannedApproach: 'Use React.FC pattern',
      concerns: 'Name conflict in utils',
      rawOutput: '',
      scopeFileCount: 2,
    };
    const ctx = buildReconContext(report);
    expect(ctx).toContain('RECONNAISSANCE REPORT');
    expect(ctx).toContain('camelCase');
    expect(ctx).toContain('react, zod');
    expect(ctx).toContain('React.FC');
    expect(ctx).toContain('Name conflict');
  });

  it('notes empty scope', () => {
    const report = {
      patternsFound: '',
      librariesAvailable: '',
      plannedApproach: '',
      concerns: '',
      rawOutput: '',
      scopeFileCount: 0,
    };
    const ctx = buildReconContext(report);
    expect(ctx).toContain('from scratch');
  });
});
