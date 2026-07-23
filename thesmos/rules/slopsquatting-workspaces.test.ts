// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * SLOP_002 must see workspace package.json deps (monorepo-aware).
 * Run from repo root — vitest lives in thesmos/package.json, not root.
 */
import { describe, it, expect } from 'vitest';
import { SLOPSQUATTING_RULES } from './slopsquatting.js';
import { CONFIG_DEFAULTS } from '../config.js';
import type { DetectInput, ScanResult } from '../types.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function emptyScan(): ScanResult {
  return {
    _generatedSections: [],
    generatedAt: new Date().toISOString(),
    scanVersion: '0',
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
    languages: [],
    detectedStacks: [],
  };
}

const slop002 = SLOPSQUATTING_RULES.find((r) => r.id === 'SLOP_002')!;

describe('SLOP_002 workspace package resolution', () => {
  it('does not flag vitest when declared in a workspace package.json', () => {
    const root = process.cwd();
    // This test is meaningful when run from the monorepo root.
    if (!existsSync(join(root, 'thesmos', 'package.json'))) {
      return;
    }
    const input: DetectInput = {
      scan: emptyScan(),
      config: CONFIG_DEFAULTS,
      changedFiles: [
        {
          path: 'thesmos/governance-log.test.ts',
          content: "import { describe, it, expect } from 'vitest';\n",
        },
      ],
    };
    const findings = slop002.detect(input);
    expect(findings.filter((f) => f.message.includes('"vitest"'))).toHaveLength(0);
  });
});
