// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { NODE_RULES } from './node.js';
import { TYPESCRIPT_RULES } from './typescript.js';
import { CONFIG_DEFAULTS } from '../config.js';
import type { DetectInput, ScanResult } from '../types.js';

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

function input(path: string, content: string): DetectInput {
  return {
    scan: emptyScan(),
    config: CONFIG_DEFAULTS,
    changedFiles: [{ path, content }],
  };
}

const floating = TYPESCRIPT_RULES.find((r) => r.id === 'TS_010')!;
const unhandled = NODE_RULES.find((r) => r.id === 'NODE_022')!;

describe('TS_010 / NODE_022 async call hints', () => {
  it('flags fire-and-forget enqueueJob / fetchUserAsync without await', () => {
    const src = `
async function handler() {
  enqueueJob(payload);
  fetchUserAsync(id);
}
`;
    expect(floating.detect(input('src/a.ts', src)).length).toBeGreaterThan(0);
    expect(unhandled.detect(input('src/a.ts', src)).length).toBeGreaterThan(0);
  });

  it('does not flag sync governance helpers named logReviewFindings', () => {
    const src = `
export async function cmdReview() {
  logReviewFindings(root, findings, { source: 'scan', action: 'review' });
}
`;
    expect(floating.detect(input('src/review.ts', src))).toHaveLength(0);
    expect(unhandled.detect(input('src/review.ts', src))).toHaveLength(0);
  });

  it('does not flag every bare call merely because the file has async function', () => {
    const src = `
async function run() {
  partitionFindings(all, baseline);
  computeHealthForRoot(root, config);
}
`;
    expect(unhandled.detect(input('src/ci.ts', src))).toHaveLength(0);
  });
});
