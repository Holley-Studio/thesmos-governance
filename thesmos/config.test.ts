// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { loadConfig, validateConfig, CONFIG_DEFAULTS } from './config';

describe('validateConfig', () => {
  it('returns false for null', () => {
    expect(validateConfig(null)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(validateConfig({})).toBe(false);
  });

  it('returns false when required keys are missing', () => {
    expect(validateConfig({ name: 'Thesmos' })).toBe(false);
  });

  it('returns true for a minimal valid shape', () => {
    expect(validateConfig({ name: 'Thesmos', version: '2.0.0' })).toBe(true);
  });

  it('returns false for a string', () => {
    expect(validateConfig('not an object')).toBe(false);
  });
});

describe('loadConfig with preloaded data', () => {
  it('applies defaults when preloaded is empty', () => {
    const cfg = loadConfig('/any/path', {});
    expect(cfg.failOnSeverity).toEqual(CONFIG_DEFAULTS.failOnSeverity);
    expect(cfg.warnOnSeverity).toEqual(CONFIG_DEFAULTS.warnOnSeverity);
    expect(cfg.ignoredFolders).toEqual(CONFIG_DEFAULTS.ignoredFolders);
  });

  it('overrides failOnSeverity from preloaded data', () => {
    const cfg = loadConfig('/any/path', { failOnSeverity: ['BLOCKER', 'HIGH'] });
    expect(cfg.failOnSeverity).toEqual(['BLOCKER', 'HIGH']);
  });

  it('overrides reportMaxAgeDays from preloaded data', () => {
    const cfg = loadConfig('/any/path', { reportMaxAgeDays: 7 });
    expect(cfg.reportMaxAgeDays).toBe(7);
  });

  it('preserves default criticalLibPaths when not overridden', () => {
    const cfg = loadConfig('/any/path', { name: 'test', version: '1.0' });
    expect(cfg.criticalLibPaths).toEqual(CONFIG_DEFAULTS.criticalLibPaths);
  });

  it('merges doctor defaults when only partial doctor config provided', () => {
    const cfg = loadConfig('/any/path', {
      doctor: { reportMaxAgeDays: 14 },
    });
    expect(cfg.doctor.reportMaxAgeDays).toBe(14);
    expect(cfg.doctor.requiredScripts).toEqual(CONFIG_DEFAULTS.doctor.requiredScripts);
  });

  it('returns defaults for secretPatterns when not specified', () => {
    const cfg = loadConfig('/any/path', {});
    expect(Array.isArray(cfg.secretPatterns)).toBe(true);
    expect(cfg.secretPatterns.length).toBeGreaterThan(0);
  });
});

describe('CONFIG_DEFAULTS', () => {
  it('has BLOCKER in failOnSeverity by default', () => {
    expect(CONFIG_DEFAULTS.failOnSeverity).toContain('BLOCKER');
  });

  it('has HIGH in warnOnSeverity by default', () => {
    expect(CONFIG_DEFAULTS.warnOnSeverity).toContain('HIGH');
  });

  it('protects main branch by default', () => {
    expect(CONFIG_DEFAULTS.protectedBranches).toContain('main');
  });
});
