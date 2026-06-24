// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS } from './config';
import { ADAPTER_OUTPUT_PATHS } from './adapters';
import {
  runDoctor,
  formatDoctorConsole,
  formatDoctorMarkdown,
  formatDoctorJson,
  DOCTOR_GROUPS,
  type DoctorInput,
} from './doctor';
import type { ThesmosConfig } from './types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Build a DoctorInput where every file exists and every script is present. */
function makeFullInput(overrides: Partial<DoctorInput> = {}): DoctorInput {
  const allPaths = new Set<string>([
    // required files
    ...CONFIG_DEFAULTS.doctor.requiredFiles,
    // adapter files
    ...Object.values(ADAPTER_OUTPUT_PATHS),
    // IDE dirs
    ...CONFIG_DEFAULTS.doctor.requiredIdeDirs,
    // GitHub workflow
    '.github/workflows/thesmos-review.yml',
  ]);

  const freshReport = {
    generatedAt: new Date().toISOString(),
    _generatedSections: [],
  };

  const validConfigJson = { name: 'Test', version: '2.0.0' };

  return {
    config: CONFIG_DEFAULTS,
    fileExists: (rel) => allPaths.has(rel),
    readJsonSafe: (rel) => {
      if (rel === '.thesmos/report.json') return freshReport;
      if (rel === '.thesmos/config.json') return validConfigJson;
      return null;
    },
    packageScripts: Object.fromEntries(
      CONFIG_DEFAULTS.doctor.requiredScripts.map((s) => [s, `thesmos ${s.replace('thesmos:', '')}`])
    ),
    now: new Date(),
    ...overrides,
  };
}

/** Build a minimal input where nothing exists and no scripts are present. */
function makeEmptyInput(configOverride?: Partial<ThesmosConfig>): DoctorInput {
  return {
    config: { ...CONFIG_DEFAULTS, ...configOverride },
    fileExists: () => false,
    readJsonSafe: () => null,
    packageScripts: {},
    now: new Date(),
  };
}

// ── runDoctor — all passing ───────────────────────────────────────────────────

describe('runDoctor — all passing', () => {
  it('returns all passing checks when repo is fully configured', () => {
    const checks = runDoctor(makeFullInput());
    const failed = checks.filter((c) => !c.pass);
    expect(failed).toHaveLength(0);
  });

  it('returns checks for all expected groups', () => {
    const checks = runDoctor(makeFullInput());
    const groups = new Set(checks.map((c) => c.group));
    expect(groups).toContain(DOCTOR_GROUPS.FILES);
    expect(groups).toContain(DOCTOR_GROUPS.SCRIPTS);
    expect(groups).toContain(DOCTOR_GROUPS.ADAPTERS);
    expect(groups).toContain(DOCTOR_GROUPS.REPORT);
    expect(groups).toContain(DOCTOR_GROUPS.CONFIG);
    expect(groups).toContain(DOCTOR_GROUPS.IDE);
    expect(groups).toContain(DOCTOR_GROUPS.GITHUB);
  });

  it('every check has a name, group, pass, and message', () => {
    const checks = runDoctor(makeFullInput());
    for (const c of checks) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.group).toBe('string');
      expect(typeof c.pass).toBe('boolean');
      expect(typeof c.message).toBe('string');
    }
  });

  it('passing checks have no fixHint (or undefined)', () => {
    const checks = runDoctor(makeFullInput());
    for (const c of checks.filter((c) => c.pass)) {
      expect(c.fixHint == null || c.fixHint === undefined).toBe(true);
    }
  });
});

// ── Required files check ──────────────────────────────────────────────────────

describe('required files check', () => {
  it('fails for each missing required file', () => {
    const checks = runDoctor(makeEmptyInput());
    const fileChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.FILES);
    expect(fileChecks.length).toBe(CONFIG_DEFAULTS.doctor.requiredFiles.length);
    expect(fileChecks.every((c) => !c.pass)).toBe(true);
  });

  it('includes a fix hint for missing files', () => {
    const checks = runDoctor(makeEmptyInput());
    const fileChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.FILES && !c.pass);
    for (const c of fileChecks) {
      expect(c.fixHint).toBeTruthy();
    }
  });

  it('passes when files exist', () => {
    const checks = runDoctor(makeFullInput());
    const fileChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.FILES);
    expect(fileChecks.every((c) => c.pass)).toBe(true);
  });

  it('check name matches the file path', () => {
    const checks = runDoctor(makeFullInput());
    const fileChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.FILES);
    for (const c of fileChecks) {
      expect(CONFIG_DEFAULTS.doctor.requiredFiles).toContain(c.name);
    }
  });
});

// ── Package scripts check ─────────────────────────────────────────────────────

describe('package scripts check', () => {
  it('fails for each missing script', () => {
    const checks = runDoctor(makeEmptyInput());
    const scriptChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.SCRIPTS);
    expect(scriptChecks.length).toBe(CONFIG_DEFAULTS.doctor.requiredScripts.length);
    expect(scriptChecks.every((c) => !c.pass)).toBe(true);
  });

  it('passes when all scripts are present', () => {
    const checks = runDoctor(makeFullInput());
    const scriptChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.SCRIPTS);
    expect(scriptChecks.every((c) => c.pass)).toBe(true);
  });

  it('fails for a specific missing script', () => {
    const scripts = Object.fromEntries(
      CONFIG_DEFAULTS.doctor.requiredScripts
        .filter((s) => s !== 'thesmos:doctor')
        .map((s) => [s, `thesmos ${s.replace('thesmos:', '')}`])
    );
    const input = makeFullInput({ packageScripts: scripts });
    const checks = runDoctor(input);
    const doctorScript = checks.find((c) => c.name === 'script:thesmos:doctor');
    expect(doctorScript?.pass).toBe(false);
    expect(doctorScript?.fixHint).toContain('package.json');
  });

  it('fix hint mentions the script name', () => {
    const checks = runDoctor(makeEmptyInput());
    const scriptCheck = checks.find((c) => c.name === 'script:thesmos:scan');
    expect(scriptCheck?.fixHint).toContain('thesmos:scan');
  });
});

// ── Adapter files check ───────────────────────────────────────────────────────

describe('adapter files check', () => {
  it('produces one check per adapter target', () => {
    const checks = runDoctor(makeFullInput());
    const adapterChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.ADAPTERS);
    expect(adapterChecks.length).toBe(Object.keys(ADAPTER_OUTPUT_PATHS).length);
  });

  it('fails when adapter files are missing', () => {
    const checks = runDoctor(makeEmptyInput());
    const adapterChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.ADAPTERS);
    expect(adapterChecks.every((c) => !c.pass)).toBe(true);
  });

  it('passes when adapter files exist', () => {
    const checks = runDoctor(makeFullInput());
    const adapterChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.ADAPTERS);
    expect(adapterChecks.every((c) => c.pass)).toBe(true);
  });

  it('each failing check includes a fix hint', () => {
    const checks = runDoctor(makeEmptyInput());
    const adapterChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.ADAPTERS && !c.pass);
    for (const c of adapterChecks) {
      expect(c.fixHint).toContain('thesmos adapters');
    }
  });

  it('check name includes the target name', () => {
    const checks = runDoctor(makeFullInput());
    const claudeCheck = checks.find((c) => c.name === 'adapter:claude');
    expect(claudeCheck).toBeDefined();
    expect(claudeCheck!.pass).toBe(true);
  });
});

// ── Report health checks ──────────────────────────────────────────────────────

describe('report health — missing report', () => {
  it('fails with a single check when report.json does not exist', () => {
    const checks = runDoctor(makeEmptyInput());
    const reportChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.REPORT);
    expect(reportChecks).toHaveLength(1);
    expect(reportChecks[0].pass).toBe(false);
    expect(reportChecks[0].name).toBe('report:exists');
    expect(reportChecks[0].fixHint).toContain('thesmos scan');
  });
});

describe('report health — fresh report', () => {
  it('passes both existence and freshness when report is new', () => {
    const checks = runDoctor(makeFullInput());
    const reportChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.REPORT);
    expect(reportChecks).toHaveLength(2);
    expect(reportChecks.every((c) => c.pass)).toBe(true);
  });

  it('fresh check message includes day count', () => {
    const checks = runDoctor(makeFullInput());
    const freshCheck = checks.find((c) => c.name === 'report:fresh');
    expect(freshCheck?.message).toMatch(/\d+ day/);
  });
});

describe('report health — stale report', () => {
  it('fails freshness check when report is older than maxAgeDays', () => {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - (CONFIG_DEFAULTS.doctor.reportMaxAgeDays + 2));

    const input = makeFullInput({
      readJsonSafe: (rel) => {
        if (rel === '.thesmos/report.json') {
          return { generatedAt: staleDate.toISOString(), _generatedSections: [] };
        }
        if (rel === '.thesmos/config.json') return { name: 'Test', version: '2.0.0' };
        return null;
      },
    });

    const checks = runDoctor(input);
    const freshCheck = checks.find((c) => c.name === 'report:fresh');
    expect(freshCheck?.pass).toBe(false);
    expect(freshCheck?.fixHint).toContain('thesmos scan');
    expect(freshCheck?.message).toContain('stale');
  });

  it('fails freshness when generatedAt is missing', () => {
    const input = makeFullInput({
      readJsonSafe: (rel) => {
        if (rel === '.thesmos/report.json') return { _generatedSections: [] };
        if (rel === '.thesmos/config.json') return { name: 'Test', version: '2.0.0' };
        return null;
      },
    });

    const checks = runDoctor(input);
    const freshCheck = checks.find((c) => c.name === 'report:fresh');
    expect(freshCheck?.pass).toBe(false);
    expect(freshCheck?.message).toContain('no timestamp');
  });
});

// ── Configuration checks ──────────────────────────────────────────────────────

describe('configuration — config.json', () => {
  it('fails when config.json is missing', () => {
    const checks = runDoctor(makeEmptyInput());
    const configCheck = checks.find((c) => c.name === 'config:valid');
    expect(configCheck?.pass).toBe(false);
    expect(configCheck?.message).toContain('missing or could not be parsed');
  });

  it('fails when config.json is missing required fields', () => {
    const input = makeFullInput({
      readJsonSafe: (rel) => {
        if (rel === '.thesmos/config.json') return { project: 'test' }; // missing name+version
        if (rel === '.thesmos/report.json')
          return { generatedAt: new Date().toISOString(), _generatedSections: [] };
        return null;
      },
    });
    const checks = runDoctor(input);
    const configCheck = checks.find((c) => c.name === 'config:valid');
    expect(configCheck?.pass).toBe(false);
    expect(configCheck?.fixHint).toBeTruthy();
  });

  it('passes when config.json has name and version', () => {
    const checks = runDoctor(makeFullInput());
    const configCheck = checks.find((c) => c.name === 'config:valid');
    expect(configCheck?.pass).toBe(true);
  });
});

describe('configuration — protected branches', () => {
  it('passes when protectedBranches is non-empty', () => {
    const checks = runDoctor(makeFullInput());
    const branchCheck = checks.find((c) => c.name === 'config:protected-branches');
    expect(branchCheck?.pass).toBe(true);
    expect(branchCheck?.message).toContain('main');
  });

  it('fails when protectedBranches is empty', () => {
    const input = makeFullInput({
      config: { ...CONFIG_DEFAULTS, protectedBranches: [] },
    });
    const checks = runDoctor(input);
    const branchCheck = checks.find((c) => c.name === 'config:protected-branches');
    expect(branchCheck?.pass).toBe(false);
    expect(branchCheck?.fixHint).toContain('"protectedBranches"');
  });
});

// ── IDE integration checks ────────────────────────────────────────────────────

describe('IDE integration checks', () => {
  it('fails for each missing IDE directory', () => {
    const checks = runDoctor(makeEmptyInput());
    const ideChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.IDE);
    expect(ideChecks.length).toBe(CONFIG_DEFAULTS.doctor.requiredIdeDirs.length);
    expect(ideChecks.every((c) => !c.pass)).toBe(true);
  });

  it('passes when IDE directories exist', () => {
    const checks = runDoctor(makeFullInput());
    const ideChecks = checks.filter((c) => c.group === DOCTOR_GROUPS.IDE);
    expect(ideChecks.every((c) => c.pass)).toBe(true);
  });

  it('fix hint for .cursor mentions thesmos adapters', () => {
    const checks = runDoctor(makeEmptyInput());
    const cursorCheck = checks.find((c) => c.name === 'ide:.cursor');
    expect(cursorCheck?.fixHint).toContain('thesmos adapters');
  });

  it('fix hint for .claude mentions CLAUDE.md', () => {
    const checks = runDoctor(makeEmptyInput());
    const claudeCheck = checks.find((c) => c.name === 'ide:.claude');
    expect(claudeCheck?.fixHint).toContain('CLAUDE.md');
  });
});

// ── GitHub integration checks ─────────────────────────────────────────────────

describe('GitHub integration checks', () => {
  it('fails when workflow file is missing', () => {
    const checks = runDoctor(makeEmptyInput());
    const ghCheck = checks.find((c) => c.name === 'github:workflow');
    expect(ghCheck?.pass).toBe(false);
    expect(ghCheck?.fixHint).toBeTruthy();
  });

  it('passes when default workflow path exists', () => {
    const checks = runDoctor(makeFullInput());
    const ghCheck = checks.find((c) => c.name === 'github:workflow');
    expect(ghCheck?.pass).toBe(true);
  });

  it('uses custom workflow path from config.github.workflow', () => {
    const customPath = '.github/workflows/custom.yml';
    const input = makeFullInput({
      config: {
        ...CONFIG_DEFAULTS,
        github: { workflow: customPath },
      },
      fileExists: (rel) => rel === customPath,
    });
    const checks = runDoctor(input);
    const ghCheck = checks.find((c) => c.name === 'github:workflow');
    expect(ghCheck?.pass).toBe(true);
    expect(ghCheck?.message).toContain(customPath);
  });

  it('adds an informational secrets reminder when requiresSecrets is set and workflow exists', () => {
    const input = makeFullInput({
      config: {
        ...CONFIG_DEFAULTS,
        github: {
          workflow: '.github/workflows/thesmos-review.yml',
          requiresSecrets: ['SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY'],
        },
      },
    });
    const checks = runDoctor(input);
    const secretsCheck = checks.find((c) => c.name === 'github:secrets');
    expect(secretsCheck).toBeDefined();
    expect(secretsCheck!.pass).toBe(true);
    expect(secretsCheck!.message).toContain('SUPABASE_SERVICE_KEY');
  });

  it('does not add secrets reminder when workflow is missing', () => {
    const input = makeEmptyInput();
    const checks = runDoctor({
      ...input,
      config: {
        ...CONFIG_DEFAULTS,
        github: { requiresSecrets: ['SOME_SECRET'] },
      },
    });
    expect(checks.find((c) => c.name === 'github:secrets')).toBeUndefined();
  });
});

// ── formatDoctorConsole ───────────────────────────────────────────────────────

describe('formatDoctorConsole', () => {
  it('includes the project name', () => {
    const checks = runDoctor(makeFullInput());
    const out = formatDoctorConsole(checks, 'MyProject');
    expect(out).toContain('MyProject');
  });

  it('shows all checks passed when no failures', () => {
    const checks = runDoctor(makeFullInput());
    const out = formatDoctorConsole(checks);
    expect(out).toContain('all passed');
    expect(out).not.toContain('failed');
  });

  it('shows failure count when checks fail', () => {
    const checks = runDoctor(makeEmptyInput());
    const out = formatDoctorConsole(checks);
    expect(out).toMatch(/\d+ failed/);
  });

  it('includes fix hints for failed checks', () => {
    const checks = runDoctor(makeEmptyInput());
    const out = formatDoctorConsole(checks);
    expect(out).toContain('→');
  });

  it('uses ✓ for passing and ✗ for failing checks', () => {
    const allPassChecks = runDoctor(makeFullInput());
    const passOut = formatDoctorConsole(allPassChecks);
    expect(passOut).toContain('✓');

    const allFailChecks = runDoctor(makeEmptyInput());
    const failOut = formatDoctorConsole(allFailChecks);
    expect(failOut).toContain('✗');
  });

  it('groups checks by category', () => {
    const checks = runDoctor(makeFullInput());
    const out = formatDoctorConsole(checks);
    expect(out).toContain('Thesmos files');
    expect(out).toContain('Package scripts');
    expect(out).toContain('AI adapters');
  });
});

// ── formatDoctorMarkdown ──────────────────────────────────────────────────────

describe('formatDoctorMarkdown', () => {
  it('includes a markdown heading', () => {
    const checks = runDoctor(makeFullInput());
    const md = formatDoctorMarkdown(checks, 'MyProject');
    expect(md).toContain('## Thesmos Doctor');
    expect(md).toContain('MyProject');
  });

  it('includes a markdown table per group', () => {
    const checks = runDoctor(makeFullInput());
    const md = formatDoctorMarkdown(checks);
    expect(md).toContain('| Status |');
    expect(md).toContain('|---|---|---|');
  });

  it('shows all passed summary when no failures', () => {
    const checks = runDoctor(makeFullInput());
    const md = formatDoctorMarkdown(checks);
    expect(md).toContain('All checks passed');
  });

  it('shows failure count in summary when checks fail', () => {
    const checks = runDoctor(makeEmptyInput());
    const md = formatDoctorMarkdown(checks);
    expect(md).toMatch(/\d+ check.* failed/);
  });

  it('includes fix hint in table for failed checks', () => {
    const checks = runDoctor(makeEmptyInput());
    const md = formatDoctorMarkdown(checks);
    expect(md).toContain('_Fix:');
  });
});

// ── formatDoctorJson ──────────────────────────────────────────────────────────

describe('formatDoctorJson', () => {
  it('returns valid JSON', () => {
    const checks = runDoctor(makeFullInput());
    expect(() => JSON.parse(formatDoctorJson(checks))).not.toThrow();
  });

  it('sets pass: true when all checks pass', () => {
    const checks = runDoctor(makeFullInput());
    const json = JSON.parse(formatDoctorJson(checks)) as {
      pass: boolean;
      total: number;
      passed: number;
      failed: number;
    };
    expect(json.pass).toBe(true);
    expect(json.failed).toBe(0);
    expect(json.passed).toBe(json.total);
  });

  it('sets pass: false when any check fails', () => {
    const checks = runDoctor(makeEmptyInput());
    const json = JSON.parse(formatDoctorJson(checks)) as { pass: boolean; failed: number };
    expect(json.pass).toBe(false);
    expect(json.failed).toBeGreaterThan(0);
  });

  it('includes total, passed, failed counts', () => {
    const checks = runDoctor(makeFullInput());
    const json = JSON.parse(formatDoctorJson(checks)) as {
      total: number;
      passed: number;
      failed: number;
    };
    expect(json.total).toBe(checks.length);
    expect(json.passed + json.failed).toBe(json.total);
  });

  it('includes all checks in the checks array', () => {
    const checks = runDoctor(makeFullInput());
    const json = JSON.parse(formatDoctorJson(checks)) as { checks: unknown[] };
    expect(json.checks).toHaveLength(checks.length);
  });
});
