// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SECURITY_RULES } from './security';
import { CONFIG_DEFAULTS } from '../config';
import type { ScanResult } from '../types';

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
  const r = SECURITY_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({
    scan: EMPTY_SCAN,
    config: CONFIG_DEFAULTS,
    changedFiles: files,
    root: '/nonexistent-thesmos-test-root',
  });
}

// ── SEC_018 — credentials embedded in a URL ──────────────────────────────────

describe('SEC_018 — password_in_url', () => {
  it('fires on a credential-bearing URL in ordinary source', () => {
    const findings = detect('SEC_018', [{
      path: 'src/client.ts',
      content: "const api = 'https://admin:hunter2@api.example.com/v1';",
    }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('password_in_url');
  });

  it('fires on a secret passed as a query parameter in ordinary source', () => {
    const findings = detect('SEC_018', [{
      path: 'src/client.ts',
      content: "fetch('https://api.example.com/v1?api_key=abc123');",
    }]);
    expect(findings).toHaveLength(1);
  });

  // The regression this rule shipped with: a test asserting that credentials are
  // REJECTED contains a credential-bearing URL as its fixture. Flagging it reports
  // a leak in the code that exists to prove there is none — and because SEC_018 is
  // declared BLOCKER, it froze a PR and every PR stacked on it.
  it('does NOT fire on a credential fixture inside a .test.ts path', () => {
    const findings = detect('SEC_018', [{
      path: 'thesmos/runtime/endpoint.test.ts',
      content:
        "it('rejects embedded credentials so no secret can reach a log', () => {\n" +
        "  expect(() => parseEndpoint('http://user:pass@example.com')).toThrow(/credentials/);\n" +
        '});',
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on a credential fixture inside a __tests__ directory', () => {
    const findings = detect('SEC_018', [{
      path: 'src/__tests__/endpoint.ts',
      content: "const bad = 'https://user:pass@example.com';",
    }]);
    expect(findings).toHaveLength(0);
  });

  it('still fires in a source file whose name merely contains the word test', () => {
    const findings = detect('SEC_018', [{
      path: 'src/testHarness.ts',
      content: "const api = 'https://admin:hunter2@api.example.com';",
    }]);
    expect(findings).toHaveLength(1);
  });
});
