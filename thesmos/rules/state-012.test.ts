// @vitest-environment node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * STATE_012 — global mutable state in Next.js Server Components.
 *
 * Two independent defects, both of which silently disable a BLOCKER rule:
 *
 * 1. **Scan abort.** The loop over `changedFiles` used `return findings` where
 *    `continue` was required. One `'use client'` file, or one file outside
 *    `app/`/`server`/`actions`, aborted scanning of *every remaining file in
 *    the diff*. Single-file unit tests cannot see this — it only appears once
 *    a realistic multi-file change puts a skipped file before a violating one.
 *
 * 2. **The rule could not detect its own documented `badExample`.** The
 *    declaration regex required `let x = null` with no type annotation, but
 *    the documented violation is `let currentUser: User | null = null`.
 *
 * Every positive case below is paired with a negative one, so a fix that
 * simply fires more often fails too.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATE_RULES } from './state';
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

let emptyRoot: string;
beforeEach(() => { emptyRoot = mkdtempSync(join(tmpdir(), 'thesmos-state012-')); });
afterEach(() => { rmSync(emptyRoot, { recursive: true, force: true }); });

function detect(files: Array<{ path: string; content: string }>) {
  const rule = STATE_RULES.find((r) => r.id === 'STATE_012');
  if (!rule) throw new Error('STATE_012 not found');
  return rule.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files, root: emptyRoot });
}

const VIOLATION = 'app/lib/context.ts';
/** The rule's own documented badExample, verbatim from `explain.badExample`. */
const BAD_EXAMPLE = "// In lib/context.ts (server)\nlet currentUser: User | null = null  // shared across all HTTP requests!";

describe('STATE_012 — detects its own documented violations', () => {
  it('fires on the rule\'s own badExample (typed declaration)', () => {
    const findings = detect([{ path: VIOLATION, content: BAD_EXAMPLE }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('global_state_server_component');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on the untyped form', () => {
    expect(detect([{ path: VIOLATION, content: 'let currentUser = null' }])).toHaveLength(1);
  });

  it('fires on each documented commonViolation', () => {
    const rule = STATE_RULES.find((r) => r.id === 'STATE_012')!;
    for (const violation of rule.explain!.commonViolations) {
      expect(detect([{ path: VIOLATION, content: violation }]), violation).not.toHaveLength(0);
    }
  });

  it('fires on `var` as well as `let`', () => {
    expect(detect([{ path: 'server/session.ts', content: 'var activeSession: Session | null = null' }])).toHaveLength(1);
  });

  it('reports the correct 1-based line number', () => {
    const content = 'import { db } from "./db"\n\nlet currentUser: User | null = null\n';
    expect(detect([{ path: VIOLATION, content }])[0]!.line).toBe(3);
  });
});

describe('STATE_012 — negative cases (a fix that over-fires fails here)', () => {
  it('does not fire on `const`', () => {
    expect(detect([{ path: VIOLATION, content: 'const currentUser: User | null = null' }])).toHaveLength(0);
  });

  it('does not fire on a non-request-scoped name', () => {
    expect(detect([{ path: VIOLATION, content: 'let cachedTheme: string | null = null' }])).toHaveLength(0);
  });

  it('does not fire in a client component', () => {
    const content = `'use client'\nlet currentUser: User | null = null`;
    expect(detect([{ path: 'app/page.tsx', content }])).toHaveLength(0);
  });

  it('does not fire outside app/, server or actions paths', () => {
    expect(detect([{ path: 'lib/util.ts', content: 'let currentUser: User | null = null' }])).toHaveLength(0);
  });

  it('does not fire on a non-source file', () => {
    expect(detect([{ path: 'app/README.md', content: 'let currentUser: User | null = null' }])).toHaveLength(0);
  });

  it('does not fire on the rule\'s own goodExample', () => {
    const rule = STATE_RULES.find((r) => r.id === 'STATE_012')!;
    expect(detect([{ path: VIOLATION, content: rule.explain!.goodExample }])).toHaveLength(0);
  });
});

describe('STATE_012 — scan abort: a skipped file must not end the scan', () => {
  it('still scans files after a client component', () => {
    const findings = detect([
      { path: 'app/page.tsx', content: `'use client'\nexport default function P() { return null }` },
      { path: VIOLATION, content: 'let currentUser: User | null = null' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe(VIOLATION);
  });

  it('still scans files after one outside app/, server or actions', () => {
    const findings = detect([
      { path: 'lib/util.ts', content: 'export const x = 1' },
      { path: VIOLATION, content: 'let currentUser: User | null = null' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe(VIOLATION);
  });

  it('finds violations in every file of a realistic multi-file diff', () => {
    const findings = detect([
      { path: 'app/components/Button.tsx', content: `'use client'\nexport const Button = () => null` },
      { path: 'app/lib/a.ts', content: 'let currentUser: User | null = null' },
      { path: 'README.md', content: 'docs' },
      { path: 'lib/pure.ts', content: 'export const pure = 1' },
      { path: 'server/b.ts', content: 'let activeSession: Session | null = null' },
      { path: 'app/actions/c.ts', content: 'let requestToken: string | null = null' },
    ]);
    expect(findings.map((f) => f.file).sort()).toEqual(['app/actions/c.ts', 'app/lib/a.ts', 'server/b.ts']);
  });

  it('order of the diff does not change the result', () => {
    const violating = { path: VIOLATION, content: 'let currentUser: User | null = null' };
    const client = { path: 'app/page.tsx', content: `'use client'\nexport default () => null` };
    expect(detect([violating, client])).toHaveLength(1);
    expect(detect([client, violating])).toHaveLength(1);
  });
});
