import { describe, it, expect } from 'vitest';
import {
  parsePackManifest,
  validatePack,
  formatPackListConsole,
  formatPackListJson,
  formatPackValidateConsole,
  formatPackValidateJson,
} from './packs.ts';
import type { PackManifest, PackEntry, PackValidationResult } from './packs.ts';
import { join } from 'node:path';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<PackManifest> = {}): PackManifest {
  return {
    id: '@prometheus/web',
    name: 'Prometheus Web Pack',
    version: '1.0.0',
    description: 'Web-specific governance rules and agents.',
    author: 'Prometheus',
    tags: ['web', 'nextjs'],
    provides: { rules: true, agents: true, skills: false, playbooks: false, profiles: false },
    schemaVersion: '1',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PackEntry> = {}): PackEntry {
  return {
    dir: '/tmp/prometheus/packs/web',
    relDir: '.prometheus/packs/web',
    manifest: makeManifest(),
    source: 'local',
    ...overrides,
  };
}

// A "fake" packDir that has no subdirectories (so provides.rules=true triggers a warning)
const EMPTY_DIR = '/tmp/nonexistent-pack-dir-prometheus-test';

// ── parsePackManifest ─────────────────────────────────────────────────────────

describe('parsePackManifest', () => {
  it('parses valid JSON manifest', () => {
    const manifest = makeManifest();
    const parsed = parsePackManifest(JSON.stringify(manifest));
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe('@prometheus/web');
  });

  it('returns null for invalid JSON', () => {
    expect(parsePackManifest('{not-valid-json}')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePackManifest('')).toBeNull();
  });
});

// ── validatePack ──────────────────────────────────────────────────────────────

describe('validatePack', () => {
  it('accepts a valid manifest with no content dirs present (skips dir checks for EMPTY_DIR)', () => {
    // When provides flags are true but dirs don't exist, we get warnings not errors
    const manifest = makeManifest({ provides: { rules: false, agents: false, skills: false, playbooks: false, profiles: false } });
    const result = validatePack(EMPTY_DIR, manifest);
    // provides all false → error "at least one content type"
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('manifest.provides must have at least one content type set to true');
  });

  it('valid manifest with all-false provides fails (must provide something)', () => {
    const manifest = makeManifest({
      provides: { rules: false, agents: false, skills: false, playbooks: false, profiles: false },
    });
    const result = validatePack(EMPTY_DIR, manifest);
    expect(result.valid).toBe(false);
  });

  it('flags missing id', () => {
    const manifest = makeManifest({ id: '' });
    const result = validatePack(EMPTY_DIR, manifest);
    expect(result.errors).toContain('manifest.id is required');
  });

  it('flags non-scoped id', () => {
    const manifest = makeManifest({ id: 'just-name-no-scope' });
    const result = validatePack(EMPTY_DIR, manifest);
    expect(result.errors.some((e) => e.includes('scoped ID'))).toBe(true);
  });

  it('flags missing description', () => {
    const manifest = makeManifest({ description: '' });
    const result = validatePack(EMPTY_DIR, manifest);
    expect(result.errors).toContain('manifest.description is required');
  });

  it('flags missing schemaVersion', () => {
    const manifest = makeManifest({ schemaVersion: undefined as any });
    const result = validatePack(EMPTY_DIR, manifest);
    expect(result.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it('flags unsupported schemaVersion', () => {
    const manifest = makeManifest({ schemaVersion: '2' as any });
    const result = validatePack(EMPTY_DIR, manifest);
    expect(result.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it('warns on missing author', () => {
    const manifest = makeManifest({ author: '' });
    const result = validatePack(EMPTY_DIR, manifest);
    expect(result.warnings.some((w) => w.includes('author'))).toBe(true);
  });

  it('warns on non-semver version', () => {
    const manifest = makeManifest({ version: 'latest' });
    const result = validatePack(EMPTY_DIR, manifest);
    expect(result.warnings.some((w) => w.includes('semver'))).toBe(true);
  });

  it('valid scoped IDs: @prometheus/core, @company/internal', () => {
    for (const id of ['@prometheus/core', '@company/internal', '@proclip/web-builder']) {
      const manifest = makeManifest({ id, provides: { rules: false, agents: false, skills: false, playbooks: false, profiles: true } });
      const result = validatePack(EMPTY_DIR, manifest);
      const idErrors = result.errors.filter((e) => e.includes('scoped'));
      expect(idErrors, `id "${id}" should be valid`).toHaveLength(0);
    }
  });

  it('invalid IDs with uppercase or spaces', () => {
    for (const id of ['@Prometheus/Core', '@foo/Bar Baz', 'prometheus/core']) {
      const manifest = makeManifest({ id });
      const result = validatePack(EMPTY_DIR, manifest);
      const idErrors = result.errors.filter((e) => e.includes('scoped') || e.includes('id is required'));
      expect(idErrors.length, `id "${id}" should be invalid`).toBeGreaterThan(0);
    }
  });

  it('valid manifest (no content dirs required to have warnings)', () => {
    // A minimal valid manifest where provides flags are false for all dir-based content
    // but true for at least one — need to use a manifest where the content dirs DO exist
    // In practice, packs are valid when manifest is correct even if dirs don't exist (warnings only)
    const manifest = makeManifest({
      id: '@test/pack',
      provides: { rules: false, agents: false, skills: false, playbooks: false, profiles: true },
    });
    const result = validatePack(EMPTY_DIR, manifest);
    // warnings: profiles dir doesn't exist (warning only)
    // errors: none (provides.profiles=true, at least one is true)
    expect(result.errors).toHaveLength(0);
  });

  it('is deterministic for same input', () => {
    const manifest = makeManifest();
    const a = validatePack(EMPTY_DIR, manifest);
    const b = validatePack(EMPTY_DIR, manifest);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── formatPackListConsole ─────────────────────────────────────────────────────

describe('formatPackListConsole', () => {
  it('shows "no packs" message for empty list', () => {
    const out = formatPackListConsole([], 'MyRepo');
    expect(out).toContain('No packs installed');
  });

  it('shows pack count', () => {
    const out = formatPackListConsole([makeEntry()], 'MyRepo');
    expect(out).toContain('1 pack installed');
  });

  it('shows pack ID and version', () => {
    const out = formatPackListConsole([makeEntry()], 'MyRepo');
    expect(out).toContain('@prometheus/web');
    expect(out).toContain('v1.0.0');
  });

  it('shows provides summary', () => {
    const out = formatPackListConsole([makeEntry()], 'MyRepo');
    expect(out).toContain('Provides:');
  });

  it('is deterministic', () => {
    const packs = [makeEntry()];
    expect(formatPackListConsole(packs)).toBe(formatPackListConsole(packs));
  });

  it('does not throw when manifest is missing provides or tags', () => {
    const badManifest = { id: '@x/y', version: '1.0.0', description: 'test' } as unknown as PackManifest;
    const entry: PackEntry = { dir: '/tmp', relDir: '.prometheus/packs/x', manifest: badManifest, source: 'local' };
    expect(() => formatPackListConsole([entry])).not.toThrow();
  });
});

// ── formatPackListJson ────────────────────────────────────────────────────────

describe('formatPackListJson', () => {
  it('is valid JSON', () => {
    expect(() => JSON.parse(formatPackListJson([makeEntry()]))).not.toThrow();
  });

  it('includes id, version, source', () => {
    const arr = JSON.parse(formatPackListJson([makeEntry()]));
    expect(arr[0].id).toBe('@prometheus/web');
    expect(arr[0].version).toBe('1.0.0');
    expect(arr[0].source).toBe('local');
  });

  it('returns empty array for no packs', () => {
    expect(JSON.parse(formatPackListJson([]))).toEqual([]);
  });
});

// ── formatPackValidateConsole ─────────────────────────────────────────────────

describe('formatPackValidateConsole', () => {
  it('shows no packs message for empty map', () => {
    const out = formatPackValidateConsole(new Map());
    expect(out).toContain('No packs to validate');
  });

  it('shows valid pack with ✅', () => {
    const results = new Map([
      ['@test/pack', { entry: makeEntry(), result: { valid: true, errors: [], warnings: [] } }],
    ]);
    const out = formatPackValidateConsole(results);
    expect(out).toContain('✅');
    expect(out).toContain('@test/pack');
  });

  it('shows invalid pack with ❌ and errors', () => {
    const results = new Map([
      ['@test/bad', { entry: makeEntry(), result: { valid: false, errors: ['manifest.id is required'], warnings: [] } }],
    ]);
    const out = formatPackValidateConsole(results);
    expect(out).toContain('❌');
    expect(out).toContain('manifest.id is required');
  });

  it('is deterministic', () => {
    const results = new Map([['@test/p', { entry: makeEntry(), result: { valid: true, errors: [], warnings: [] } }]]);
    expect(formatPackValidateConsole(results)).toBe(formatPackValidateConsole(results));
  });
});

// ── formatPackValidateJson ────────────────────────────────────────────────────

describe('formatPackValidateJson', () => {
  it('is valid JSON', () => {
    const results = new Map([['@test/p', { entry: makeEntry(), result: { valid: true, errors: [], warnings: [] } }]]);
    expect(() => JSON.parse(formatPackValidateJson(results))).not.toThrow();
  });

  it('has clean=true when all packs valid', () => {
    const results = new Map([['@test/p', { entry: makeEntry(), result: { valid: true, errors: [], warnings: [] } }]]);
    const obj = JSON.parse(formatPackValidateJson(results));
    expect(obj.clean).toBe(true);
  });

  it('has clean=false when any pack invalid', () => {
    const results = new Map([['@test/p', { entry: makeEntry(), result: { valid: false, errors: ['err'], warnings: [] } }]]);
    const obj = JSON.parse(formatPackValidateJson(results));
    expect(obj.clean).toBe(false);
  });

  it('empty map has clean=true', () => {
    const obj = JSON.parse(formatPackValidateJson(new Map()));
    expect(obj.clean).toBe(true);
    expect(obj.totalPacks).toBe(0);
  });
});
