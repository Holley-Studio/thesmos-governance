// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { classifyResult, type RegistryResult } from './import-scan.js';

// Unit-only: tests classifyResult() and related pure functions.
// Network calls (checkNpm, checkPypi, scanImports) are not tested here
// as they require live registry access. Mock those in integration tests.

function npmResult(overrides: Partial<RegistryResult> = {}): RegistryResult {
  return {
    name: 'some-package',
    ecosystem: 'npm',
    exists: true,
    ageInDays: 365,
    hasReadme: true,
    ...overrides,
  };
}

function pypiResult(overrides: Partial<RegistryResult> = {}): RegistryResult {
  return {
    name: 'some-package',
    ecosystem: 'pypi',
    exists: true,
    ageInDays: 365,
    hasReadme: true,
    ...overrides,
  };
}

describe('classifyResult — OFFLINE', () => {
  it('returns OFFLINE finding when exists is null', () => {
    const r = classifyResult(npmResult({ exists: null }), false);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('OFFLINE');
    expect(r!.reason).toContain('network unavailable');
  });

  it('includes npm manual verify URL in suggestion', () => {
    const r = classifyResult(npmResult({ name: 'mylib', exists: null }), false);
    expect(r!.suggestion).toContain('npmjs.com/package/mylib');
  });

  it('includes pypi manual verify URL in suggestion', () => {
    const r = classifyResult(pypiResult({ name: 'mylib', exists: null }), false);
    expect(r!.suggestion).toContain('pypi.org/project/mylib');
  });
});

describe('classifyResult — BLOCKER (package does not exist)', () => {
  it('returns BLOCKER for npm 404', () => {
    const r = classifyResult(npmResult({ exists: false }), false);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('BLOCKER');
    expect(r!.reason).toContain('does not exist on the npm registry');
  });

  it('returns BLOCKER for pypi 404', () => {
    const r = classifyResult(pypiResult({ exists: false }), false);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('BLOCKER');
    expect(r!.reason).toContain('does not exist on the pypi registry');
  });

  it('suggests removing the import on BLOCKER', () => {
    const r = classifyResult(npmResult({ exists: false }), false);
    expect(r!.suggestion).toContain('Remove this import');
  });
});

describe('classifyResult — OK (well-established package)', () => {
  it('returns null for a healthy established package in normal mode', () => {
    const r = classifyResult(npmResult(), false);
    expect(r).toBeNull();
  });

  it('returns null for a healthy established package in strict mode', () => {
    const r = classifyResult(npmResult({ ageInDays: 100, hasReadme: true }), true);
    expect(r).toBeNull();
  });
});

describe('classifyResult — strict mode: new packages', () => {
  it('returns HIGH for package < 30 days old in strict mode', () => {
    const r = classifyResult(npmResult({ ageInDays: 5 }), true);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('HIGH');
    expect(r!.reason).toContain('5 days ago');
  });

  it('returns HIGH for 1-day-old package (singular "day")', () => {
    const r = classifyResult(npmResult({ ageInDays: 1 }), true);
    expect(r!.reason).toContain('1 day ago');
    expect(r!.reason).not.toContain('1 days ago');
  });

  it('does NOT flag new packages in non-strict mode', () => {
    const r = classifyResult(npmResult({ ageInDays: 5 }), false);
    expect(r).toBeNull();
  });

  it('does NOT flag packages exactly 30+ days old in strict mode', () => {
    const r = classifyResult(npmResult({ ageInDays: 30 }), true);
    expect(r).toBeNull();
  });

  it('returns null for package with unknown age in strict mode', () => {
    const r = classifyResult(npmResult({ ageInDays: null }), true);
    // age is unknown — strict check skipped for age
    // hasReadme is true, so no MEDIUM finding either
    expect(r).toBeNull();
  });
});

describe('classifyResult — strict mode: no README', () => {
  it('returns MEDIUM for package with no README/description in strict mode', () => {
    const r = classifyResult(npmResult({ hasReadme: false, ageInDays: 365 }), true);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('MEDIUM');
    expect(r!.reason).toContain('no description');
  });

  it('does NOT flag missing README in non-strict mode', () => {
    const r = classifyResult(npmResult({ hasReadme: false, ageInDays: 365 }), false);
    expect(r).toBeNull();
  });

  it('age check takes precedence over no-readme check in strict mode', () => {
    // A new package with no readme: age fires first
    const r = classifyResult(npmResult({ ageInDays: 5, hasReadme: false }), true);
    expect(r!.severity).toBe('HIGH'); // age-based finding, not MEDIUM
  });
});

describe('classifyResult — finding fields', () => {
  it('finding includes package name', () => {
    const r = classifyResult(npmResult({ name: 'acme-utils', exists: false }), false);
    expect(r!.name).toBe('acme-utils');
  });

  it('finding includes ecosystem', () => {
    const r = classifyResult(npmResult({ name: 'acme-utils', exists: false }), false);
    expect(r!.ecosystem).toBe('npm');
  });

  it('pypi finding includes ecosystem', () => {
    const r = classifyResult(pypiResult({ name: 'acme-lib', exists: false }), false);
    expect(r!.ecosystem).toBe('pypi');
  });
});
