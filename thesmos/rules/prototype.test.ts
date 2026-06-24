// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PROTOTYPE_RULES } from './prototype';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

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

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const r = PROTOTYPE_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files });
}

// ── PROTO_001 — recursive merge no guard ─────────────────────────────────────

describe('PROTO_001 — recursive merge no proto guard', () => {
  it('fires on deepMerge function with for...in and no proto guard', () => {
    const findings = detect('PROTO_001', [{
      path: 'src/utils.ts',
      content: `
        function deepMerge(a, b) {
          for (const k in b) {
            if (typeof b[k] === "object") deepMerge(a[k], b[k]);
            else a[k] = b[k];
          }
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on extend function with Object.keys and assignment', () => {
    const findings = detect('PROTO_001', [{
      path: 'src/utils.ts',
      content: `
        function extendDeep(target, source) {
          for (const key of Object.keys(source)) {
            target[key] = source[key];
          }
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when __proto__ guard is present', () => {
    const findings = detect('PROTO_001', [{
      path: 'src/utils.ts',
      content: `
        function deepMerge(target, source) {
          for (const key in source) {
            if (key === "__proto__" || key === "constructor") continue;
            if (Object.prototype.hasOwnProperty.call(source, key)) {
              if (typeof source[key] === "object") deepMerge(target[key], source[key]);
              else target[key] = source[key];
            }
          }
        }
      `,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on test files', () => {
    const findings = detect('PROTO_001', [{
      path: 'src/utils.test.ts',
      content: `
        function deepMerge(a, b) { for (const k in b) { a[k] = b[k]; } }
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_002 — for...in over user input ─────────────────────────────────────

describe('PROTO_002 — for...in over user-supplied object', () => {
  it('fires on for...in over req.body without guard', () => {
    const findings = detect('PROTO_002', [{
      path: 'src/api/config/route.ts',
      content: `
        for (const key in req.body) {
          config[key] = req.body[key];
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on for...in over userInput', () => {
    const findings = detect('PROTO_002', [{
      path: 'src/handler.ts',
      content: `for (const k in userInput) { options[k] = userInput[k]; }`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when hasOwnProperty guard is used', () => {
    const findings = detect('PROTO_002', [{
      path: 'src/handler.ts',
      content: `
        for (const key in req.body) {
          if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
          config[key] = req.body[key];
        }
      `,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on for...in over non-user object', () => {
    const findings = detect('PROTO_002', [{
      path: 'src/utils.ts',
      content: `for (const key in defaults) { result[key] = defaults[key]; }`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_003 — lodash.merge with user input ─────────────────────────────────

describe('PROTO_003 — lodash.merge with user input', () => {
  it('fires on _.merge({}, req.body)', () => {
    const findings = detect('PROTO_003', [{
      path: 'src/handler.ts',
      content: `const config = _.merge({}, req.body);`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on lodash.merge with userInput as second arg', () => {
    const findings = detect('PROTO_003', [{
      path: 'src/handler.ts',
      content: `const merged = lodash.merge({}, userInput);`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when input is validated first', () => {
    const findings = detect('PROTO_003', [{
      path: 'src/handler.ts',
      content: `
        const safe = UserConfigSchema.parse(req.body);
        const config = _.merge({}, defaults, safe);
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_004 — lodash.defaultsDeep ──────────────────────────────────────────

describe('PROTO_004 — lodash.defaultsDeep with user input', () => {
  it('fires on _.defaultsDeep({}, req.body)', () => {
    const findings = detect('PROTO_004', [{
      path: 'src/settings.ts',
      content: `_.defaultsDeep({}, req.body, systemDefaults)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when input is schema-validated first', () => {
    const findings = detect('PROTO_004', [{
      path: 'src/settings.ts',
      content: `
        const validated = SettingsSchema.parse(req.body);
        const options = _.defaultsDeep({}, systemDefaults, validated);
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_005 — JSON.parse + Object.assign ────────────────────────────────────

describe('PROTO_005 — JSON.parse result in Object.assign', () => {
  it('fires on Object.assign({}, JSON.parse(req.body.config))', () => {
    const findings = detect('PROTO_005', [{
      path: 'src/handler.ts',
      content: `Object.assign(target, JSON.parse(req.body.settings))`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on Object.assign with JSON.parse(userInput)', () => {
    const findings = detect('PROTO_005', [{
      path: 'src/handler.ts',
      content: `const result = Object.assign({}, JSON.parse(userInput.config))`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when parsed input is validated first', () => {
    const findings = detect('PROTO_005', [{
      path: 'src/handler.ts',
      content: `
        const parsed = ConfigSchema.parse(JSON.parse(req.body.config));
        const result = Object.assign({}, parsed);
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_006 — qs.parse without allowPrototypes: false ──────────────────────

describe('PROTO_006 — qs.parse without allowPrototypes: false', () => {
  it('fires on qs.parse(req.query) without safe options', () => {
    const findings = detect('PROTO_006', [{
      path: 'src/handler.ts',
      content: `const params = qs.parse(req.query)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when allowPrototypes: false is set', () => {
    const findings = detect('PROTO_006', [{
      path: 'src/handler.ts',
      content: `const params = qs.parse(req.query, { allowPrototypes: false, allowDots: false })`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_007 — null prototype missing for hash map ───────────────────────────

describe('PROTO_007 — plain {} used as hash map with user keys', () => {
  it('fires on {} hash map with user-controlled key access', () => {
    const findings = detect('PROTO_007', [{
      path: 'src/cache.ts',
      content: `
        const cache = {};
        cache[userInput] = value;
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when Object.create(null) is used', () => {
    const findings = detect('PROTO_007', [{
      path: 'src/cache.ts',
      content: `
        const cache = Object.create(null);
        cache[userInput] = value;
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_008 — express extended:true ────────────────────────────────────────

describe('PROTO_008 — express urlencoded extended:true', () => {
  it('fires on express.urlencoded({ extended: true })', () => {
    const findings = detect('PROTO_008', [{
      path: 'src/app.ts',
      content: `app.use(express.urlencoded({ extended: true }))`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on bodyParser.urlencoded({ extended: true })', () => {
    const findings = detect('PROTO_008', [{
      path: 'src/app.ts',
      content: `app.use(bodyParser.urlencoded({ extended: true }))`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on extended: false', () => {
    const findings = detect('PROTO_008', [{
      path: 'src/app.ts',
      content: `app.use(express.urlencoded({ extended: false }))`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_009 — hasOwnProperty missing ───────────────────────────────────────

describe('PROTO_009 — property access on user object without hasOwnProperty', () => {
  it('fires on if(req.body[key]) without hasOwnProperty guard', () => {
    const findings = detect('PROTO_009', [{
      path: 'src/handler.ts',
      content: `if (req.body[action]) { executeAction(req.body[action]); }`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when hasOwnProperty is checked', () => {
    const findings = detect('PROTO_009', [{
      path: 'src/handler.ts',
      content: `
        if (Object.prototype.hasOwnProperty.call(req.body, action) && req.body[action]) {
          executeAction(req.body[action]);
        }
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── PROTO_010 — spread user input into object ─────────────────────────────────

describe('PROTO_010 — user input spread into object literal', () => {
  it('fires on ...req.body in object literal without validation', () => {
    const findings = detect('PROTO_010', [{
      path: 'src/handler.ts',
      content: `const user = { ...req.body, role: "user" }`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on ...body.settings spread', () => {
    const findings = detect('PROTO_010', [{
      path: 'src/handler.ts',
      content: `const config = { defaults, ...body.settings }`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when input is schema-validated first', () => {
    const findings = detect('PROTO_010', [{
      path: 'src/handler.ts',
      content: `
        const { name, email } = UserInputSchema.parse(req.body);
        const user = { name, email, createdAt: new Date() };
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── Registry contract ──────────────────────────────────────────────────────────

describe('PROTOTYPE_RULES registry contract', () => {
  it('exports exactly 10 rules', () => {
    expect(PROTOTYPE_RULES).toHaveLength(10);
  });

  it('all rule IDs are unique', () => {
    const ids = PROTOTYPE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all rules have a sinceVersion', () => {
    for (const rule of PROTOTYPE_RULES) {
      expect(typeof rule.sinceVersion, `[${rule.id}] sinceVersion`).toBe('string');
    }
  });

  it('all detect() methods return an array', () => {
    const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    for (const rule of PROTOTYPE_RULES) {
      expect(Array.isArray(rule.detect(input)), `[${rule.id}] returns array`).toBe(true);
    }
  });
});
