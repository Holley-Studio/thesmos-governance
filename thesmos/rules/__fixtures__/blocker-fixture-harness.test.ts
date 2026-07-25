// @vitest-environment node
/**
 * BLOCKER rule detect() fixture harness.
 *
 * Data-driven: each fixture file exports RULE_ID + POSITIVE_FIXTURE.
 * This test proves detect() fires on the positive fixture (≥1 finding, 0 engine errors).
 *
 * Rules with path filters (e.g. AUTH_004 requires 'api' in path) export an
 * optional FIXTURE_PATH_HINT. When present, the changedFile path includes it.
 */
import { describe, it, expect } from 'vitest';
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

type FixtureModule = {
  RULE_ID: string;
  POSITIVE_FIXTURE: string;
  NEGATIVE_FIXTURE?: string;
  /** Path fragment the rule's detect() requires in the file path (e.g. 'api'). */
  FIXTURE_PATH_HINT?: string;
};

const FIXTURES: FixtureModule[] = [
  SEC001, SEC003, SEC004, SEC006, SEC009,
  SEC014, SEC016, AUTH002, AUTH004, AUTH006,
];

// ── Harness ───────────────────────────────────────────────────────────────────

describe('BLOCKER rule detect() fixture harness', () => {
  for (const fixture of FIXTURES) {
    const { RULE_ID, POSITIVE_FIXTURE, NEGATIVE_FIXTURE, FIXTURE_PATH_HINT } = fixture;
    const rule = THESMOS_RULES.find(r => r.id === RULE_ID);

    // Build a file path that satisfies any path filter the rule requires.
    // SEC_016 skips test paths — use a plain .ts extension (not .test.ts).
    // AUTH_004 requires 'api|route|handler|controller' in the path.
    const pathSuffix = FIXTURE_PATH_HINT ? `-${FIXTURE_PATH_HINT}` : '';
    const fixturePath = `src/fixture-${RULE_ID}${pathSuffix}.ts`;

    it(`${RULE_ID} — POSITIVE fixture fires detect()`, () => {
      if (!rule) {
        console.warn(`Rule ${RULE_ID} not found in registry — skipping`);
        return;
      }

      const result = runReview(
        {
          scan: EMPTY_SCAN,
          config: CONFIG_DEFAULTS,
          changedFiles: [{ path: fixturePath, content: POSITIVE_FIXTURE }],
          root: '/nonexistent-fixture-root',
        },
        [rule],
      );

      expect(
        result.engineErrors,
        `Rule ${RULE_ID} crashed during detect(): ${result.engineErrors.map(e => e.error).join(', ')}`,
      ).toHaveLength(0);

      expect(
        result.findings.length,
        `Rule ${RULE_ID} did not fire on its positive fixture.\nPath: ${fixturePath}\nContent: ${POSITIVE_FIXTURE}`,
      ).toBeGreaterThan(0);
    });

    if (NEGATIVE_FIXTURE) {
      it(`${RULE_ID} — NEGATIVE fixture does NOT fire detect()`, () => {
        if (!rule) return; // already warned above

        const negPath = `src/fixture-${RULE_ID}${pathSuffix}-negative.ts`;
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

        // Only check that THIS specific rule did not fire.
        const thisRuleFindings = result.findings.filter(
          f => f.category === rule.category,
        );
        expect(
          thisRuleFindings,
          `Rule ${RULE_ID} fired on its NEGATIVE fixture — tighten the fixture or the detect() pattern.\nContent: ${NEGATIVE_FIXTURE}`,
        ).toHaveLength(0);
      });
    }
  }
});
