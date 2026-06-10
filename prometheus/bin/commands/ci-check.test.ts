// @vitest-environment node
/**
 * I/O integration tests for ci-check using real temp directories.
 * These tests write files to OS tmpdir and call runCiCheckForRoot directly.
 * The library root is never written to.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG_DEFAULTS } from '../../config';
import {
  PROMETHEUS_RULES,
  ADAPTER_OUTPUT_PATHS,
  buildAdapterContent,
  writeAllAdapters,
} from '../../adapters';
import { writePrometheusDir } from '../../init';
import { runCiCheckForRoot } from '../../ci-check';

// ── Temp dir helpers ──────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `prom-ci-check-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

const tmpDirs: string[] = [];
function trackTmp(dir: string): string {
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

/** Write a minimal but complete consumer repo fixture to root. */
function writeFullFixture(root: string): void {
  // .prometheus/ files + GH workflow
  writePrometheusDir(root, CONFIG_DEFAULTS);

  // Adapter files
  writeAllAdapters(root, PROMETHEUS_RULES, CONFIG_DEFAULTS);

  // The workflow file is written by writePrometheusDir (init template)
}

// ── All-pass scenario ─────────────────────────────────────────────────────────

describe('runCiCheckForRoot — all passing', () => {
  it('all checks pass when repo is fully initialised and adapters are fresh', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const failed = checks.filter((c) => !c.pass);
    expect(failed, failed.map((c) => `${c.name}: ${c.message}`).join('\n')).toHaveLength(0);
  });

  it('adapter freshness checks all pass after writeAllAdapters', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const freshChecks = checks.filter((c) => c.name.endsWith(':fresh'));
    expect(freshChecks.every((c) => c.pass)).toBe(true);
  });

  it('marker checks all pass after writeAllAdapters', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const markerChecks = checks.filter((c) => c.name.endsWith(':markers'));
    expect(markerChecks.every((c) => c.pass)).toBe(true);
  });
});

// ── Missing adapter files ─────────────────────────────────────────────────────

describe('runCiCheckForRoot — missing adapter', () => {
  it('fails when CLAUDE.md is missing', () => {
    const root = trackTmp(makeTmpDir());
    // Initialise .prometheus/ + workflow but only write 5 of 6 adapters
    writePrometheusDir(root, CONFIG_DEFAULTS);
    writeAllAdapters(root, PROMETHEUS_RULES, CONFIG_DEFAULTS, ['gemini', 'cursor', 'copilot', 'codex', 'agents']);
    // CLAUDE.md was never written — ci-check should flag it

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const existsCheck = checks.find((c) => c.name === 'adapter:claude:exists');
    expect(existsCheck?.pass).toBe(false);
    expect(existsCheck?.fixHint).toContain('prometheus adapters');
  });
});

// ── Stale adapter files ───────────────────────────────────────────────────────

describe('runCiCheckForRoot — stale adapter', () => {
  it('fails freshness check when adapter was built with fewer rules', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);

    // Overwrite gemini adapter with content built from only 5 rules
    const staleContent = buildAdapterContent('gemini', '', PROMETHEUS_RULES.slice(0, 5), CONFIG_DEFAULTS);
    writeFileSync(join(root, ADAPTER_OUTPUT_PATHS.gemini), staleContent, 'utf8');

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const freshCheck = checks.find((c) => c.name === 'adapter:gemini:fresh');
    expect(freshCheck?.pass).toBe(false);
    expect(freshCheck?.message).toContain('rule count mismatch');
  });

  it('fails freshness check when adapter has no metadata (legacy format)', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);

    // Write a legacy adapter without PROMETHEUS:META comment
    const legacyContent = [
      '# My Project — Codex Instructions',
      '',
      '<!-- PROMETHEUS:GENERATED START rules -->',
      'Some old rules content with no meta comment.',
      '<!-- PROMETHEUS:GENERATED END rules -->',
    ].join('\n');
    writeFileSync(join(root, ADAPTER_OUTPUT_PATHS.codex), legacyContent, 'utf8');

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const freshCheck = checks.find((c) => c.name === 'adapter:codex:fresh');
    expect(freshCheck?.pass).toBe(false);
    expect(freshCheck?.message).toContain('no metadata');
  });

  it('fails marker check when PROMETHEUS:GENERATED markers are stripped', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);

    // Write an agents adapter with markers removed
    const raw = buildAdapterContent('agents', '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
    const noMarkers = raw.replace(/<!-- PROMETHEUS:GENERATED[^>]+-->/g, '');
    writeFileSync(join(root, ADAPTER_OUTPUT_PATHS.agents), noMarkers, 'utf8');

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const markerCheck = checks.find((c) => c.name === 'adapter:agents:markers');
    expect(markerCheck?.pass).toBe(false);
  });
});

// ── Missing governance files ──────────────────────────────────────────────────

describe('runCiCheckForRoot — missing governance files', () => {
  it('fails when .prometheus/ has not been initialised', () => {
    const root = trackTmp(makeTmpDir());
    // Only write adapters — no .prometheus/ or workflow
    writeAllAdapters(root, PROMETHEUS_RULES, CONFIG_DEFAULTS);

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const readmeCheck = checks.find((c) => c.name === '.prometheus/README.md');
    expect(readmeCheck?.pass).toBe(false);
  });

  it('fails when GitHub workflow is missing', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);
    // Remove the workflow (init wrote it)
    rmSync(join(root, '.github/workflows/prometheus-review.yml'), { force: true });

    const checks = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const wfCheck = checks.find((c) => c.name?.includes('prometheus-review.yml'));
    expect(wfCheck?.pass).toBe(false);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('runCiCheckForRoot — idempotency', () => {
  it('two consecutive ci-checks on an unchanged repo produce identical results', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);

    const r1 = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    const r2 = runCiCheckForRoot(root, CONFIG_DEFAULTS);

    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('re-running adapters makes stale checks pass again', () => {
    const root = trackTmp(makeTmpDir());
    writeFullFixture(root);

    // Introduce staleness
    const stale = buildAdapterContent('claude', '', PROMETHEUS_RULES.slice(0, 3), CONFIG_DEFAULTS);
    writeFileSync(join(root, ADAPTER_OUTPUT_PATHS.claude), stale, 'utf8');

    const before = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    expect(before.find((c) => c.name === 'adapter:claude:fresh')?.pass).toBe(false);

    // Fix: re-run adapters
    writeAllAdapters(root, PROMETHEUS_RULES, CONFIG_DEFAULTS, ['claude']);

    const after = runCiCheckForRoot(root, CONFIG_DEFAULTS);
    expect(after.find((c) => c.name === 'adapter:claude:fresh')?.pass).toBe(true);
  });
});
