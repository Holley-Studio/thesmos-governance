import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THESMOS_RULES } from './registry';
import { CONFIG_DEFAULTS } from '../config';
import { hasUnsafeSecretComparison } from './helpers';
import type { ChangedFile, ScanResult } from '../types';

const scan: ScanResult = {
  _generatedSections: [],
  generatedAt: '2026-09-30T12:00:00.000Z',
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

const temporaryRoots: string[] = [];
function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'thesmos rule context '));
  temporaryRoots.push(root);
  return root;
}
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function detect(id: string, changedFiles: ChangedFile[]) {
  const rule = THESMOS_RULES.find((candidate) => candidate.id === id);
  if (!rule) throw new Error(`Missing rule ${id}`);
  return rule.detect({ scan, config: CONFIG_DEFAULTS, changedFiles });
}

it('SSRF detection checks the URL argument without confusing serialized request content with a URL', () => {
  expect(detect('SEC_014', [{ path: 'src/local.ts', content: 'fetch(input, {body: JSON.stringify({model: body.model})});' }])).toEqual([]);
  for (const content of ['fetch(req.query.url);', 'fetch(body.url, options);', 'fetch(getUrl(params.url), options);', 'fetch(`${body.url}/api`);']) {
    expect(detect('SEC_014', [{ path: 'src/api.ts', content }])).toHaveLength(1);
  }
});

it('the shared comparison helper distinguishes auth from schema validation', () => {
  expect(hasUnsafeSecretComparison('token === expected')).toBe(true);
  expect(hasUnsafeSecretComparison('token === undefined')).toBe(false);
});
it('credential URLs cannot consume neighboring quoted URL fixtures or a port as a password', () => {
 expect(detect('SEC_018', [{ path: 'src/urls.ts', content: "const links = ['https://example.com/event?eid=x','https://x@example.com/event','https://example.com:444/event'];" }])).toEqual([]);
 for (const content of ["fetch('https://user:pass@example.com');", "fetch('https://api.example.com?q=1&token=secret');", "fetch('https://api.example.com?api_key=secret');"]) expect(detect('SEC_018', [{path:'src/urls.ts',content}])).toHaveLength(1);
});
it('redaction regex dictionaries are not mistaken for special-category data while actual processing remains blocked', () => {
 expect(detect('GDPR_020',[{path:'src/redact.ts',content:"if (/medical record|health data/i.test(subject)) return 'Hidden';"}])).toEqual([]);
 for(const content of ['await processHealthRecord(medicalRecord);',"if (/medical record/i.test(subject)) processHealthData(healthData);", "if (/medical record/i.test(medicalRecord)) return 'Hidden';"]) expect(detect('GDPR_020',[{path:'src/records.ts',content}])).toHaveLength(1);
});
it('a bare PEM boundary marker is not a credential, but actual partial or escaped key material remains blocked', () => {
 expect(detect('SEC_003',[{path:'src/guard.ts',content:"const marker = '-----BEGIN PRIVATE KEY-----';"}])).toEqual([]);
 const payload = 'M'.repeat(64);
 for(const content of [`-----BEGIN PRIVATE KEY-----\n${payload}`,`const key = '-----BEGIN PRIVATE KEY-----\\n${payload}';`]) expect(detect('SEC_003',[{path:'src/key.ts',content}])).toHaveLength(1);
 expect(detect('SEC_003',[{path:'src/key.ts',content:`const key = 'sk-${'a'.repeat(24)}'; const marker = '-----BEGIN PRIVATE KEY-----';`}])).toHaveLength(1);
});

describe.each(['SEC_019', 'SEC_023'])('%s secret comparisons', (id) => {
  it.each([
    'if (token === storedToken) allow();',
    'if (expected === receivedSecret) allow();',
    'if (password != user.password) deny();',
    "if (req.headers['x-api-key'] === process.env.API_KEY) allow();",
    'if (hmac === expected) allow();',
    'if (token === undefined || token === storedToken) allow();',
    "if (typeof token === 'string' && token === expected) allow();",
  ])('retains genuine comparison detection: %s', (content) => {
    expect(detect(id, [{ path: 'src/auth.ts', content }])).toHaveLength(1);
  });

  it.each([
    'value.tokens === undefined || Number.isFinite(value.tokens)',
    "typeof value.password === 'string'",
    'value.secret !== null',
    'undefined === token',
    'record.contentHash === hashContent(record.content)',
    'value.tokensEstimate === undefined',
    "const valid = fields.every(key => value[key] === undefined || typeof value[key] === 'string');",
    'if (timingSafeEqual(token, storedToken)) allow();',
  ])('does not report metadata or schema checks as authentication: %s', (content) => {
    expect(detect(id, [{ path: 'src/store.ts', content }])).toEqual([]);
  });
});

describe('IMPORT_016 browser crypto context', () => {
  it('continues checking client files after a server file', () => {
    const findings = detect('IMPORT_016', [
      { path: 'src/server/hash.ts', content: "import { createHash } from 'node:crypto';" },
      {
        path: 'src/client/hash.ts',
        content: "'use client';\nimport { createHash } from 'node:crypto';",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('src/client/hash.ts');
  });

  it('recognizes a Node-only storage module', () => {
    expect(
      detect('IMPORT_016', [
        {
          path: 'src/store.ts',
          content:
            "import { readFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';",
        },
      ])
    ).toEqual([]);
  });

  it('still flags a client module that also imports Node fs', () => {
    expect(
      detect('IMPORT_016', [
        {
          path: 'src/client/store.ts',
          content:
            "'use client';\nimport { readFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';",
        },
      ])
    ).toHaveLength(1);
  });

  it('recognizes Windows server paths without skipping later files', () => {
    const findings = detect('IMPORT_016', [
      { path: 'src\\server\\hash.ts', content: "import { createHash } from 'node:crypto';" },
      {
        path: 'src\\client\\hash.ts',
        content: "'use client';\nimport { createHash } from 'node:crypto';",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('src\\client\\hash.ts');
  });
});

describe('DEBT_002 existing test references', () => {
  const rule = THESMOS_RULES.find((candidate) => candidate.id === 'DEBT_002')!;
  it('retains the finding when a provided workspace is unavailable', () => {
    const root = join(temporaryRoot(), 'absent');
    expect(rule.detect({ root, config: CONFIG_DEFAULTS, scan: { ...scan, testFiles: ['feature.test.ts'] }, changedFiles: [{ path: 'feature.ts', content: 'export function unavailableFeature() { return true; }' }] })).toHaveLength(1);
  });
  it('uses an existing unchanged test from the scanned workspace', () => {
    const root = temporaryRoot();
    writeFileSync(join(root, 'feature.test.ts'), 'expect(existingFeature()).toBe(true);', 'utf8');
    expect(
      rule.detect({
        root,
        config: CONFIG_DEFAULTS,
        scan: { ...scan, testFiles: ['feature.test.ts'] },
        changedFiles: [
          { path: 'feature.ts', content: 'export function existingFeature() { return true; }' },
        ],
      })
    ).toEqual([]);
  });

  it('uses changed test content instead of its stale workspace version', () => {
    const root = temporaryRoot();
    writeFileSync(join(root, 'feature.test.ts'), 'expect(existingFeature()).toBe(true);', 'utf8');
    expect(
      rule.detect({
        root,
        config: CONFIG_DEFAULTS,
        scan: { ...scan, testFiles: ['feature.test.ts'] },
        changedFiles: [
          { path: 'feature.ts', content: 'export function existingFeature() { return true; }' },
          { path: 'feature.test.ts', content: 'expect(otherFeature()).toBe(true);' },
        ],
      })
    ).toHaveLength(1);
  });

  it('does not read a scanned test path outside the workspace', () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    const outsideTest = join(outside, 'feature.test.ts');
    writeFileSync(outsideTest, 'expect(existingFeature()).toBe(true);', 'utf8');
    expect(
      rule.detect({
        root,
        config: CONFIG_DEFAULTS,
        scan: { ...scan, testFiles: [outsideTest] },
        changedFiles: [
          { path: 'feature.ts', content: 'export function existingFeature() { return true; }' },
        ],
      })
    ).toHaveLength(1);
  });
});

describe('reliability rule precision', () => {
  it('does not treat a regex test() method as an assertionless test case', () => {
    const content = "it('filters correctly', () => {\n  const found = rows.filter(row =>\n    /^item/.test(row)\n  );\n  expect(found).toEqual(['item']);\n});";
    expect(detect('TEST_005', [{ path: 'filter.test.ts', content }])).toEqual([]);
    expect(detect('TEST_005', [{ path: 'filter.test.ts', content: "it('missing check', () => {\n  run();\n});" }])).toHaveLength(1);
  });
  it('does not treat a warning about training as a model training pipeline', () => {
    expect(detect('EU_AI_004', [{ path: 'src/notes.ts', content: '// Repeated alerts train people to ignore them.\nexport const quiet = true;' }])).toEqual([]);
    expect(detect('EU_AI_004', [{ path: 'src/pipeline.ts', content: 'await model.train(trainingData);' }])).toHaveLength(1);
    expect(detect('EU_AI_004', [{ path: 'src/pipeline.ts', content: '/* training label */ await model.train(trainingData);' }])).toHaveLength(1);
  });
  it('distinguishes synchronous APIs and Promise callbacks from unhandled async calls', () => {
    const synchronous = "async function main() {\n  execFileSync('git', ['status']);\n}";
    const executor = 'async function main() {\n  return new Promise((resolve, reject) => {\n    resolve();\n    reject(new Error());\n  });\n}';
    expect(detect('NODE_022', [{ path: 'src/node.ts', content: synchronous }])).toEqual([]);
    expect(detect('NODE_022', [{ path: 'src/node.ts', content: executor }])).toEqual([]);
    expect(detect('NODE_022', [{ path: 'src/node.ts', content: 'async function main() {\n  saveAsync();\n}' }])).toHaveLength(1);
  });
});
