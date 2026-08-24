// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Packaging license truth.
 *
 * `SEE LICENSE IN LICENSE` — the identifier counsel may choose (decision D2 in
 * docs/legal/LICENSE_REVIEW_REQUIRED.md) — is only meaningful if the consumer
 * actually receives the referenced file. This asserts the published artifact
 * contains it, so that decision rests on a verified fact rather than an
 * assumption about npm's default packing behaviour.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PKG_ROOT = import.meta.dirname;

describe('npm package license truth', () => {
  it('includes the LICENSE file in the published tarball', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: PKG_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    const parsed = JSON.parse(out) as { files: { path: string }[] }[];
    const files = parsed[0]?.files?.map((f) => f.path) ?? [];
    expect(files.length).toBeGreaterThan(0);
    expect(files, 'published tarball must contain LICENSE').toContain('LICENSE');
  }, 120_000);

  it('ships a LICENSE file that exists on disk and is non-empty', () => {
    const p = join(PKG_ROOT, 'LICENSE');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8').trim().length).toBeGreaterThan(100);
  });

  it('records the declared identifier so a change is a deliberate, reviewed act', () => {
    // This test does NOT assert the identifier is correct — it is currently
    // known to mismatch the shipped text (see LICENSE_REVIEW_REQUIRED.md D1/D2).
    // It pins the current value so any change surfaces in review rather than
    // sliding in as an unnoticed edit to a legal representation.
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as { license?: string };
    expect(pkg.license).toBe('FSL-1.1-MIT');
  });
});
