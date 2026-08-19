// @vitest-environment node
/**
 * BLOCKER rule detect() fixture harness — Phase 2 proof gate.
 *
 * Data-driven: each fixture file (or extended fixture module) exports RULE_ID +
 * POSITIVE_FIXTURE. This test proves detect() fires on the positive fixture
 * (≥1 finding, 0 engine errors) AND that the finding carries severity BLOCKER.
 *
 * Rules with path filters (e.g. AUTH_004 requires 'api' in path) export an
 * optional FIXTURE_PATH_HINT. Rules that need a non-standard path (e.g. a
 * settings.json at .claude/) export FIXTURE_FILE_PATH to override entirely.
 *
 * COMPLETENESS GATE (last describe block):
 *   Fails if any BLOCKER-severity rule in the registry has no fixture.
 *   Add a fixture file (or an entry to the extended module) and the gate passes.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THESMOS_RULES } from '../registry.js';
import { runReview } from '../../review.js';
import { CONFIG_DEFAULTS } from '../../config.js';
import type { ScanResult } from '../../types.js';

// ── Static fixture imports ────────────────────────────────────────────────────
import * as SEC001 from './SEC_001-admin-client-in-browser.fixture.js';
import * as SEC003 from './SEC_003-secret-in-diff.fixture.js';
import * as SEC004 from './SEC_004-eval-usage.fixture.js';
import * as SEC006 from './SEC_006-sql-injection.fixture.js';
import * as SEC009 from './SEC_009-path-traversal.fixture.js';
import * as SEC014 from './SEC_014-ssrf-fetch.fixture.js';
import * as SEC016 from './SEC_016-shell-injection.fixture.js';
import * as AUTH002 from './AUTH_002-jwt-decode-no-verify.fixture.js';
import * as AUTH004 from './AUTH_004-user-id-from-body.fixture.js';
import * as AUTH006 from './AUTH_006-hardcoded-credentials.fixture.js';

// ── Extended fixture modules (added in Phase 2 — one module per category group)
// Import them here as they are created; the completeness gate picks them up.
import { EXTENDED_FIXTURES as EF_PYTHON } from './blocker-fixtures-python.fixture.js';
import { EXTENDED_FIXTURES as EF_GO_RUBY } from './blocker-fixtures-go-ruby.fixture.js';
import { EXTENDED_FIXTURES as EF_PHP_JAVA } from './blocker-fixtures-php-java.fixture.js';
import { EXTENDED_FIXTURES as EF_RUST_CS } from './blocker-fixtures-rust-cs.fixture.js';
import { EXTENDED_FIXTURES as EF_INFRA } from './blocker-fixtures-infrastructure.fixture.js';
import { EXTENDED_FIXTURES as EF_TS_SEC } from './blocker-fixtures-ts-security.fixture.js';
import { EXTENDED_FIXTURES as EF_FRAMEWORKS } from './blocker-fixtures-frameworks.fixture.js';
import { EXTENDED_FIXTURES as EF_AI_AGENTS } from './blocker-fixtures-ai-agents.fixture.js';
import { EXTENDED_FIXTURES as EF_GOVERNANCE } from './blocker-fixtures-governance.fixture.js';

// ── Harness config ────────────────────────────────────────────────────────────

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

/**
 * KNOWN RULE GAPS — BLOCKER rules that do NOT fire on a correct fixture, and do
 * not fire on their own documented `explain.badExample` / `commonViolations`
 * either. These are scanner defects, NOT fixture defects: each was verified by
 * running the rule against ~80 candidate paths and its own documented
 * violations. See docs/audits/2026-07-25-proof-gate-5.2.md §2.4.
 *
 * This list is a self-healing ledger, not a suppression:
 *   - while a rule is listed, the harness asserts it still does NOT fire;
 *   - the moment someone repairs the rule, that assertion FAILS and tells you
 *     to delete the entry. A gap can never silently persist or silently vanish.
 *
 * Do NOT add an entry here to make a red test green. An entry is only valid
 * when the rule cannot detect its own documented violation.
 */
const KNOWN_RULE_GAPS: Record<string, string> = {
  GHA_001: "RUN_RE requires `run:` preceded only by whitespace — the ordinary YAML list-item form `- run: ...` never matches",
  SEC_021: 'mass-assignment shape not matched by detect()',
  SEC_029: 'XXE parser call shape not matched by detect()',
  AUTH_007: 'unprotected admin route shape not matched by detect()',
  API_004: 'password-in-response shape not matched by detect()',
  API_008: 'client-side API key shape not matched by detect()',
  NEXT_038: 'middleware matcher shape not matched by detect()',
  DB_024: 'payment-path query shape not matched by detect()',
  ZOD_028: 'schema validation shape not matched by detect()',
  ZOD_030: 'schema validation shape not matched by detect()',
  PRISMA_003: 'prisma client shape not matched by detect()',
  GQL_017: 'graphql hardcoded secret shape not matched by detect()',
  STATE_008: 'redux dispatch-in-render shape not matched by detect()',
  STATE_011: 'global mutable state shape not matched by detect()',
  LOG_003: 'log PII shape not matched by detect()',
  FORM_009: 'form validation shape not matched by detect()',
  SLOP_001: 'hallucinated-package shape not matched by detect()',
  DEP_001: 'dependency rule shape not matched by detect()',
  AI_013: 'prompt-injection shape not matched by detect()',
  AI_016: 'unvalidated AI output shape not matched by detect()',
  AI_030: 'AI-output-as-command shape not matched by detect()',
  AI_038: 'high-risk-no-oversight shape not matched by detect()',
  AGNT_023: 'privilege over-grant in settings.json not matched by detect()',
  VIBE_033: 'websocket auth shape not matched by detect()',
  LIC_009: 'license rule requires package.json + lockfile correlation not satisfied by probe',
  GDPR_016: 'GDPR rule shape not matched by detect()',
  GDPR_020: 'GDPR rule shape not matched by detect()',
  EU_AI_001: 'EU AI Act rule shape not matched by detect()',
  EU_AI_002: 'EU AI Act rule shape not matched by detect()',
};

/** One row in the fixture harness — either from a static module or an extended module. */
type FixtureEntry = {
  RULE_ID: string;
  POSITIVE_FIXTURE: string;
  NEGATIVE_FIXTURE?: string;
  /** Path fragment appended to the default constructed path (e.g. 'api'). */
  FIXTURE_PATH_HINT?: string;
  /**
   * Override the full changed-file path passed to detect(). Required for rules
   * that check the file path literally (e.g. AGNT_003 needs '.claude/settings.json').
   */
  FIXTURE_FILE_PATH?: string;
  /** File extension for the constructed default path (default: 'ts'). */
  FIXTURE_EXT?: string;
  /**
   * Extra files presented to detect() alongside the fixture. Required by rules
   * that correlate ACROSS files (e.g. LIC_001 needs package.json + a lockfile);
   * a single-file fixture can never exercise those.
   */
  COMPANION_FILES?: { path: string; content: string }[];
};

/** Extended fixture modules export this type. */
export type ExtendedFixture = {
  ruleId: string;
  positiveFixture: string;
  negativeFixture?: string;
  fixturePathHint?: string;
  fixtureFilePath?: string;
  fixtureExt?: string;
  companionFiles?: { path: string; content: string }[];
};

// Map extended module entries to FixtureEntry shape.
function toEntry(e: ExtendedFixture): FixtureEntry {
  return {
    RULE_ID: e.ruleId,
    POSITIVE_FIXTURE: e.positiveFixture,
    NEGATIVE_FIXTURE: e.negativeFixture,
    FIXTURE_PATH_HINT: e.fixturePathHint,
    FIXTURE_FILE_PATH: e.fixtureFilePath,
    FIXTURE_EXT: e.fixtureExt,
    COMPANION_FILES: e.companionFiles,
  };
}

const STATIC_FIXTURES: FixtureEntry[] = [
  SEC001, SEC003, SEC004, SEC006, SEC009,
  SEC014, SEC016, AUTH002, AUTH004, AUTH006,
];

const EXTENDED: FixtureEntry[] = [
  ...EF_PYTHON, ...EF_GO_RUBY, ...EF_PHP_JAVA, ...EF_RUST_CS, ...EF_INFRA,
  ...EF_TS_SEC, ...EF_FRAMEWORKS, ...EF_AI_AGENTS, ...EF_GOVERNANCE,
].map(toEntry);

const ALL_FIXTURES: FixtureEntry[] = [...STATIC_FIXTURES, ...EXTENDED];

// ── Collect all covered rule IDs (for completeness gate) ─────────────────────

function getFixtureFileRuleIds(): Set<string> {
  const dir = dirname(fileURLToPath(import.meta.url));
  const ids = new Set<string>();
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.fixture.ts') && !f.endsWith('.fixture.js')) continue;
      const m = f.match(/^([A-Z]+_\d+)-/);
      if (m?.[1]) ids.add(m[1]);
    }
  } catch { /* ignore */ }
  return ids;
}

// ── Harness ───────────────────────────────────────────────────────────────────

describe('BLOCKER rule detect() fixture harness', () => {
  for (const fixture of ALL_FIXTURES) {
    const { RULE_ID, POSITIVE_FIXTURE, NEGATIVE_FIXTURE, FIXTURE_PATH_HINT, FIXTURE_FILE_PATH, FIXTURE_EXT, COMPANION_FILES } = fixture;
    const rule = THESMOS_RULES.find(r => r.id === RULE_ID);

    const ext = FIXTURE_EXT ?? 'ts';
    const pathSuffix = FIXTURE_PATH_HINT ? `-${FIXTURE_PATH_HINT}` : '';
    const fixturePath = FIXTURE_FILE_PATH ?? `src/fixture-${RULE_ID}${pathSuffix}.${ext}`;
    const knownGap = KNOWN_RULE_GAPS[RULE_ID];

    const title = knownGap
      ? `${RULE_ID} — KNOWN GAP: still does NOT fire (remove from KNOWN_RULE_GAPS when fixed)`
      : `${RULE_ID} — POSITIVE fixture fires detect() at BLOCKER severity`;

    it(title, () => {
      if (!rule) {
        console.warn(`Rule ${RULE_ID} not found in registry — skipping`);
        return;
      }

      const result = runReview(
        {
          scan: EMPTY_SCAN,
          config: CONFIG_DEFAULTS,
          changedFiles: [
            { path: fixturePath, content: POSITIVE_FIXTURE },
            ...(COMPANION_FILES ?? []),
          ],
          root: '/nonexistent-fixture-root',
        },
        [rule],
      );

      expect(
        result.engineErrors,
        `Rule ${RULE_ID} crashed during detect(): ${result.engineErrors.map(e => e.error).join(', ')}`,
      ).toHaveLength(0);

      if (knownGap) {
        // Self-healing ledger: assert the gap is STILL present. If this fails,
        // the rule was repaired — delete its KNOWN_RULE_GAPS entry so the real
        // positive assertion below starts protecting it.
        expect(
          result.findings.length,
          `Rule ${RULE_ID} NOW FIRES on its fixture — the scanner gap appears fixed.\n` +
          `Recorded gap: ${knownGap}\n` +
          `Action: remove '${RULE_ID}' from KNOWN_RULE_GAPS in this file.`,
        ).toBe(0);
        return;
      }

      expect(
        result.findings.length,
        `Rule ${RULE_ID} did not fire on its positive fixture.\nPath: ${fixturePath}\nContent:\n${POSITIVE_FIXTURE}`,
      ).toBeGreaterThan(0);

      // Every finding from this rule must carry BLOCKER severity (the mission
      // requirement: effective severity without config overrides is BLOCKER).
      const nonBlocker = result.findings.filter(f => f.severity !== 'BLOCKER');
      expect(
        nonBlocker,
        `Rule ${RULE_ID} fired but produced a non-BLOCKER finding: ${JSON.stringify(nonBlocker)}`,
      ).toHaveLength(0);
    });

    if (NEGATIVE_FIXTURE && !knownGap) {
      it(`${RULE_ID} — NEGATIVE fixture does NOT fire detect()`, () => {
        if (!rule) return;

        const negPath = FIXTURE_FILE_PATH
          ? FIXTURE_FILE_PATH.replace(/(\.[^.]+)$/, '-negative$1')
          : `src/fixture-${RULE_ID}${pathSuffix}-negative.${ext}`;

        const result = runReview(
          {
            scan: EMPTY_SCAN,
            config: CONFIG_DEFAULTS,
            changedFiles: [{ path: negPath, content: NEGATIVE_FIXTURE! }],
            root: '/nonexistent-fixture-root',
          },
          [rule],
        );

        expect(
          result.engineErrors,
          `Rule ${RULE_ID} crashed on NEGATIVE fixture`,
        ).toHaveLength(0);

        const thisRuleFindings = result.findings.filter(f => f.category === rule.category);
        expect(
          thisRuleFindings,
          `Rule ${RULE_ID} fired on its NEGATIVE fixture — tighten the fixture or detect() pattern.\nContent:\n${NEGATIVE_FIXTURE}`,
        ).toHaveLength(0);
      });
    }
  }
});

// ── COMPLETENESS GATE ─────────────────────────────────────────────────────────
// This test MUST fail when any BLOCKER rule in the registry has no fixture.
// Fix: add a fixture file (RULE_ID-description.fixture.ts) or an entry to one
// of the EXTENDED_FIXTURES modules imported above.

describe('BLOCKER fixture registry integrity', () => {
  it('no rule is defined by more than one fixture', () => {
    const seen = new Map<string, number>();
    for (const f of ALL_FIXTURES) seen.set(f.RULE_ID, (seen.get(f.RULE_ID) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);

    expect(
      dupes,
      `Duplicate fixture definitions: ${dupes.map(([id, n]) => `${id} (x${n})`).join(', ')}.\n` +
      `A rule defined in two modules consumes two harness slots and hides disagreement\n` +
      `between the two shapes. Keep exactly one canonical fixture per rule.`,
    ).toHaveLength(0);
  });

  it('every KNOWN_RULE_GAPS entry refers to a real BLOCKER rule that has a fixture', () => {
    const blockerIds = new Set(THESMOS_RULES.filter(r => r.severity === 'BLOCKER').map(r => r.id));
    const fixtured = new Set(ALL_FIXTURES.map(f => f.RULE_ID));
    const stale = Object.keys(KNOWN_RULE_GAPS)
      .filter(id => !blockerIds.has(id) || !fixtured.has(id));

    expect(
      stale,
      `Stale KNOWN_RULE_GAPS entries (rule removed, downgraded, or fixture deleted): ${stale.join(', ')}.\n` +
      `Remove them so the gap ledger cannot drift from the registry.`,
    ).toHaveLength(0);
  });
});

describe('BLOCKER fixture completeness gate', () => {
  it('every BLOCKER-severity rule has a detect() fixture — add one when this fails', () => {
    const coveredByHarness = new Set(ALL_FIXTURES.map(f => f.RULE_ID));
    const coveredByFiles = getFixtureFileRuleIds();
    const allCovered = new Set([...coveredByHarness, ...coveredByFiles]);

    const blockers = THESMOS_RULES.filter(r => r.severity === 'BLOCKER');
    const missing = blockers.filter(r => !allCovered.has(r.id));

    if (missing.length > 0) {
      const list = missing.map(r => `  ${r.id} — ${r.category} (${r.description.slice(0, 60)}...)`).join('\n');
      throw new Error(
        `${missing.length} / ${blockers.length} BLOCKER rules have no detect() fixture:\n${list}\n\n` +
        `Fix: add rules/__fixtures__/RULE_ID-description.fixture.ts exporting RULE_ID + POSITIVE_FIXTURE,\n` +
        `or add an entry to one of the EXTENDED_FIXTURES modules imported in blocker-fixture-harness.test.ts.`,
      );
    }
  });
});
