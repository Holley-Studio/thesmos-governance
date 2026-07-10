// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { formatOracleVerdict, mythicBanner } from './oracle.ts';

describe('oracle verdict', () => {
  it('renders grade, score, and the top finding', () => {
    const out = formatOracleVerdict({
      grade: 'B', score: 78,
      topFinding: { severity: 'HIGH', category: 'missing_api_auth', file: 'app/api/route.ts' },
    });
    expect(out).toContain('B');
    expect(out).toContain('78');
    expect(out).toContain('missing_api_auth');
    expect(out).toContain('app/api/route.ts');
    expect(out).toContain('ORACLE');
  });

  it('renders a clean verdict with no findings', () => {
    const out = formatOracleVerdict({ grade: 'A+', score: 98 });
    expect(out).toContain('A+');
    expect(out).not.toContain('undefined');
  });

  it('banner mentions Thesmos and contains no ANSI escapes', () => {
    const b = mythicBanner();
    expect(b.toUpperCase()).toContain('T H E S M O S');
    expect(b).not.toContain('[');
  });
});
