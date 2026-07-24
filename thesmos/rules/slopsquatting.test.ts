// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SLOPSQUATTING_RULES } from './slopsquatting';
import { CONFIG_DEFAULTS } from '../config';
import type { ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function detect(ruleId: string, files: Array<{ path: string; content: string }>, root?: string) {
  const r = SLOPSQUATTING_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files, root });
}

// ── Bug A — workspace-aware manifest resolution (SLOP_002 / SLOP_006) ─────────

describe('SLOP_002 — workspace manifest resolution', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'thesmos-slop002-'));
    // Monorepo: root manifest hoists shared devDeps; workspace declares its own deps.
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'monorepo-root',
      private: true,
      workspaces: ['packages/*'],
      devDependencies: { typescript: '^5.0.0' },
    }));
    mkdirSync(join(root, 'packages', 'app', 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', 'app', 'package.json'), JSON.stringify({
      name: '@acme/app',
      dependencies: { commander: '^12.0.0', zod: '^3.23.0' },
      devDependencies: { esbuild: '^0.21.0' },
    }));
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('does NOT flag a dep declared in the owning workspace package.json (not root)', () => {
    const findings = detect('SLOP_002', [{
      path: 'packages/app/src/index.ts',
      content: 'import { program } from "commander";\nimport { z } from "zod";\nimport { build } from "esbuild";\n',
    }], root);
    expect(findings).toEqual([]);
  });

  it('does NOT flag a dep hoisted to the root manifest for a workspace file', () => {
    const findings = detect('SLOP_002', [{
      path: 'packages/app/src/build.ts',
      content: 'import ts from "typescript";\n',
    }], root);
    expect(findings).toEqual([]);
  });

  it('still flags a dep declared in NO manifest on the walk-up path', () => {
    const findings = detect('SLOP_002', [{
      path: 'packages/app/src/index.ts',
      content: 'import { thing } from "totally-undeclared-pkg";\n',
    }], root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('totally-undeclared-pkg');
  });

  it('does NOT let a sibling workspace manifest satisfy another workspace', () => {
    mkdirSync(join(root, 'packages', 'web', 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', 'web', 'package.json'), JSON.stringify({
      name: '@acme/web', dependencies: {},
    }));
    const findings = detect('SLOP_002', [{
      path: 'packages/web/src/index.ts',
      content: 'import { program } from "commander";\n', // declared only in packages/app
    }], root);
    expect(findings).toHaveLength(1);
  });
});

describe('SLOP_006 — workspace manifest + root lockfile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'thesmos-slop006-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'monorepo-root', private: true, workspaces: ['packages/*'],
    }));
    // One root lockfile (workspaces) — deliberately missing "commander" to prove
    // the workspace manifest declaration alone is enough to clear the rule.
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/typescript': { version: '5.4.0' } },
    }));
    mkdirSync(join(root, 'packages', 'app', 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', 'app', 'package.json'), JSON.stringify({
      name: '@acme/app',
      dependencies: { commander: '^12.0.0' },
    }));
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('does NOT flag a dep declared in the owning workspace manifest', () => {
    const findings = detect('SLOP_006', [{
      path: 'packages/app/src/index.ts',
      content: 'import { program } from "commander";\n',
    }], root);
    expect(findings).toEqual([]);
  });

  it('does NOT flag a package resolved in the root lockfile', () => {
    const findings = detect('SLOP_006', [{
      path: 'packages/app/src/index.ts',
      content: 'import ts from "typescript";\n',
    }], root);
    expect(findings).toEqual([]);
  });

  it('still flags a package in neither manifest chain nor lockfile', () => {
    const findings = detect('SLOP_006', [{
      path: 'packages/app/src/index.ts',
      content: 'import { x } from "never-installed-phantom";\n',
    }], root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('never-installed-phantom');
  });
});

// ── Bug B — typosquat known-package allowlist (SLOP_009) ──────────────────────

describe('SLOP_009 — typosquat candidate', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'thesmos-slop009-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app' }));
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('does NOT flag tsup as a typosquat of tsx — both are well-known packages', () => {
    const findings = detect('SLOP_009', [{
      path: 'src/build.ts',
      content: 'import { build } from "tsup";\n',
    }], root);
    expect(findings).toEqual([]);
  });

  it('does NOT flag other well-known packages near popular names', () => {
    const findings = detect('SLOP_009', [{
      path: 'src/x.ts',
      content: 'import { defineConfig } from "vite";\nimport got from "got";\nimport ora from "ora";\n',
    }], root);
    expect(findings).toEqual([]);
  });

  it('still flags a genuinely suspicious near-miss of a popular package', () => {
    const findings = detect('SLOP_009', [{
      path: 'src/x.ts',
      content: 'import Reakt from "reakt";\n',
    }], root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('react');
  });

  it('still flags a classic typosquat like lodahs', () => {
    const findings = detect('SLOP_009', [{
      path: 'src/x.ts',
      content: 'import _ from "lodahs";\n',
    }], root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('lodash');
  });
});
