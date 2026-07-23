// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, expect, it } from 'vitest';
import { MAX_ROUTED_AGENTS, routeTask } from './router.js';

describe('routeTask', () => {
  it('routes security tasks to Argus', () => {
    const ids = routeTask('Review this PR for security vulnerabilities and OWASP risks');
    expect(ids).toContain('argus-security-agent');
  });

  it('routes product/PRD tasks to Daedalus', () => {
    const ids = routeTask('Write a PRD and user stories for the new feature roadmap');
    expect(ids).toContain('daedalus-product-agent');
  });

  it('caps matches at MAX_ROUTED_AGENTS', () => {
    // Broad prompt that hits multiple domain patterns
    const ids = routeTask(
      'sales pitch deal close marketing campaign growth design ui ux security audit',
    );
    expect(ids.length).toBeLessThanOrEqual(MAX_ROUTED_AGENTS);
  });

  it('returns empty when no domain matches', () => {
    expect(routeTask('xyzzy plugh unrelated gibberish 12345')).toEqual([]);
  });

  it('does not match short tokens inside larger words (hr in threat)', () => {
    const ids = routeTask('security threat model for auth');
    expect(ids).toContain('argus-security-agent');
    expect(ids).not.toContain('hera-operations-agent');
  });
});
