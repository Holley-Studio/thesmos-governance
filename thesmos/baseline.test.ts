// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  fingerprintFinding,
  createBaselineEntries,
  createBaseline,
  partitionFindings,
  updateBaseline,
  serializeBaseline,
  parseBaseline,
  formatBaselineConsole,
  formatBaselineMarkdown,
  formatBaselineJson,
  BASELINE_PATH,
  BASELINE_VERSION,
  type BaselineEntry,
  type Baseline,
} from './baseline';
import type { Finding } from './types';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const NOW = new Date('2025-01-15T12:00:00Z');

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'HIGH',
    file: 'src/config.ts',
    category: 'env-security',
    message: 'Potential secret exposed: API_KEY',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<BaselineEntry> = {}): BaselineEntry {
  return {
    fingerprint: 'abc123def456abcd',
    ruleCategory: 'env-security',
    severity: 'HIGH',
    file: 'src/config.ts',
    message: 'Potential secret exposed: API_KEY',
    recordedAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeBaseline(entries: BaselineEntry[] = [], overrides: Partial<Baseline> = {}): Baseline {
  return {
    version: BASELINE_VERSION,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    entries,
    ...overrides,
  };
}

// ── fingerprintFinding ────────────────────────────────────────────────────────

describe('fingerprintFinding', () => {
  it('returns a 16-char hex string', () => {
    const fp = fingerprintFinding(makeFinding());
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic — same input always produces same output', () => {
    const f = makeFinding();
    expect(fingerprintFinding(f)).toBe(fingerprintFinding(f));
    expect(fingerprintFinding(f)).toBe(fingerprintFinding({ ...f }));
  });

  it('differs across different categories', () => {
    const a = fingerprintFinding(makeFinding({ category: 'env-security' }));
    const b = fingerprintFinding(makeFinding({ category: 'auth-security' }));
    expect(a).not.toBe(b);
  });

  it('differs across different files', () => {
    const a = fingerprintFinding(makeFinding({ file: 'src/a.ts' }));
    const b = fingerprintFinding(makeFinding({ file: 'src/b.ts' }));
    expect(a).not.toBe(b);
  });

  it('strips "at line N" so fingerprint survives line-number changes', () => {
    const baseline = fingerprintFinding(makeFinding({ message: 'Secret at line 42' }));
    const shifted = fingerprintFinding(makeFinding({ message: 'Secret at line 99' }));
    expect(baseline).toBe(shifted);
  });

  it('strips bare numeric suffixes like :42', () => {
    const a = fingerprintFinding(makeFinding({ message: 'Found issue: 42' }));
    const b = fingerprintFinding(makeFinding({ message: 'Found issue: 99' }));
    expect(a).toBe(b);
  });

  it('preserves single digits — they are often meaningful', () => {
    // Single-digit numbers (0-9) are NOT normalized so "0" and "3" produce different hashes
    const a = fingerprintFinding(makeFinding({ message: 'Missing 0 auth checks' }));
    const b = fingerprintFinding(makeFinding({ message: 'Missing 3 auth checks' }));
    expect(a).not.toBe(b);
  });

  it('is NOT affected by severity (severity excluded from hash)', () => {
    const a = fingerprintFinding(makeFinding({ severity: 'BLOCKER' }));
    const b = fingerprintFinding(makeFinding({ severity: 'LOW' }));
    expect(a).toBe(b);
  });

  it('is NOT affected by line number field (line excluded from hash)', () => {
    const a = fingerprintFinding(makeFinding({ line: 1 }));
    const b = fingerprintFinding(makeFinding({ line: 999 }));
    expect(a).toBe(b);
  });
});

// ── createBaselineEntries ─────────────────────────────────────────────────────

describe('createBaselineEntries', () => {
  it('returns one entry per finding', () => {
    const findings = [makeFinding(), makeFinding({ file: 'src/other.ts' })];
    const entries = createBaselineEntries(findings, NOW);
    expect(entries).toHaveLength(2);
  });

  it('records category, severity, file, message, and recordedAt', () => {
    const f = makeFinding();
    const [entry] = createBaselineEntries([f], NOW);
    expect(entry!.ruleCategory).toBe(f.category);
    expect(entry!.severity).toBe(f.severity);
    expect(entry!.file).toBe(f.file);
    expect(entry!.message).toBe(f.message);
    expect(entry!.recordedAt).toBe(NOW.toISOString());
  });

  it('assigns unique fingerprints to findings with different messages in same file', () => {
    const findings = [
      makeFinding({ message: 'Secret: KEY_A exposed at line 10' }),
      makeFinding({ message: 'Secret: KEY_B exposed at line 20' }),
    ];
    const entries = createBaselineEntries(findings, NOW);
    expect(entries[0]!.fingerprint).not.toBe(entries[1]!.fingerprint);
  });

  it('disambiguates truly identical normalized fingerprints with :N suffix', () => {
    // Two findings that normalize to the exact same fingerprint
    const findings = [
      makeFinding({ message: 'Secret: KEY exposed at line 10' }),
      makeFinding({ message: 'Secret: KEY exposed at line 99' }),
    ];
    const entries = createBaselineEntries(findings, NOW);
    // First gets base fingerprint, second gets :1 suffix
    expect(entries[0]!.fingerprint).not.toContain(':');
    expect(entries[1]!.fingerprint).toMatch(/:[1-9]/);
  });

  it('returns [] for empty findings', () => {
    expect(createBaselineEntries([], NOW)).toHaveLength(0);
  });
});

// ── createBaseline ────────────────────────────────────────────────────────────

describe('createBaseline', () => {
  it('sets version, createdAt, updatedAt, and entries', () => {
    const findings = [makeFinding()];
    const baseline = createBaseline(findings, NOW);
    expect(baseline.version).toBe(BASELINE_VERSION);
    expect(baseline.createdAt).toBe(NOW.toISOString());
    expect(baseline.updatedAt).toBe(NOW.toISOString());
    expect(baseline.entries).toHaveLength(1);
  });

  it('creates an empty baseline for no findings', () => {
    const baseline = createBaseline([], NOW);
    expect(baseline.entries).toHaveLength(0);
  });
});

// ── partitionFindings ─────────────────────────────────────────────────────────

describe('partitionFindings', () => {
  it('puts all findings in newFindings when baseline is empty', () => {
    const findings = [makeFinding(), makeFinding({ file: 'b.ts' })];
    const { newFindings, baselineFindings } = partitionFindings(findings, makeBaseline([]));
    expect(newFindings).toHaveLength(2);
    expect(baselineFindings).toHaveLength(0);
  });

  it('puts all findings in baselineFindings when all match baseline', () => {
    const findings = [makeFinding()];
    const baseline = createBaseline(findings, NOW);
    const { newFindings, baselineFindings } = partitionFindings(findings, baseline);
    expect(newFindings).toHaveLength(0);
    expect(baselineFindings).toHaveLength(1);
  });

  it('correctly partitions a mix of new and baseline findings', () => {
    const existing = makeFinding({ message: 'Existing violation' });
    const newF = makeFinding({ file: 'src/new.ts', message: 'Brand new violation' });
    const baseline = createBaseline([existing], NOW);
    const { newFindings, baselineFindings } = partitionFindings([existing, newF], baseline);
    expect(newFindings).toHaveLength(1);
    expect(newFindings[0]!.file).toBe('src/new.ts');
    expect(baselineFindings).toHaveLength(1);
    expect(baselineFindings[0]!.message).toBe('Existing violation');
  });

  it('recognizes baseline findings even when line number changes', () => {
    const baselineFinding = makeFinding({ message: 'Secret at line 10', line: 10 });
    const shiftedFinding = makeFinding({ message: 'Secret at line 99', line: 99 });
    const baseline = createBaseline([baselineFinding], NOW);
    const { newFindings, baselineFindings } = partitionFindings([shiftedFinding], baseline);
    expect(newFindings).toHaveLength(0);
    expect(baselineFindings).toHaveLength(1);
  });

  it('identifies resolved entries when a baseline finding no longer appears', () => {
    const f = makeFinding();
    const baseline = createBaseline([f], NOW);
    // Run with no findings — the baseline entry should be resolved
    const { resolvedEntries } = partitionFindings([], baseline);
    expect(resolvedEntries).toHaveLength(1);
  });

  it('handles count-aware matching — 2 baseline, 1 current → 1 resolved, 1 baseline', () => {
    const f1 = makeFinding({ message: 'Secret at line 10' });
    const f2 = makeFinding({ message: 'Secret at line 99' });
    // Both normalize to same fingerprint
    expect(fingerprintFinding(f1)).toBe(fingerprintFinding(f2));
    const baseline = createBaseline([f1, f2], NOW);
    expect(baseline.entries).toHaveLength(2);
    // Only one current finding with same fingerprint
    const { newFindings, baselineFindings, resolvedEntries } = partitionFindings([f1], baseline);
    expect(newFindings).toHaveLength(0);
    expect(baselineFindings).toHaveLength(1);
    expect(resolvedEntries).toHaveLength(1);
  });

  it('treats additional occurrences beyond baseline count as new findings', () => {
    const f = makeFinding();
    const baseline = createBaseline([f], NOW);
    // Same finding appears twice in current run but only once in baseline
    const { newFindings, baselineFindings } = partitionFindings([f, { ...f }], baseline);
    expect(newFindings).toHaveLength(1);
    expect(baselineFindings).toHaveLength(1);
  });

  it('returns empty arrays for empty inputs', () => {
    const { newFindings, baselineFindings, resolvedEntries } = partitionFindings(
      [],
      makeBaseline([])
    );
    expect(newFindings).toHaveLength(0);
    expect(baselineFindings).toHaveLength(0);
    expect(resolvedEntries).toHaveLength(0);
  });
});

// ── updateBaseline ────────────────────────────────────────────────────────────

describe('updateBaseline', () => {
  it('adds new findings to baseline', () => {
    const existing = createBaseline([makeFinding()], NOW);
    const newFinding = makeFinding({ file: 'src/new.ts', message: 'New violation' });
    const later = new Date('2025-02-01T00:00:00Z');
    const { updated, added, resolved } = updateBaseline(existing, [makeFinding(), newFinding], later);
    expect(added).toHaveLength(1);
    expect(added[0]!.file).toBe('src/new.ts');
    expect(resolved).toHaveLength(0);
    expect(updated.entries).toHaveLength(2);
  });

  it('removes resolved findings from baseline', () => {
    const f = makeFinding();
    const existing = createBaseline([f], NOW);
    const later = new Date('2025-02-01T00:00:00Z');
    // Run with no findings — the entry is resolved (fixed)
    const { updated, added, resolved } = updateBaseline(existing, [], later);
    expect(added).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    expect(updated.entries).toHaveLength(0);
  });

  it('updates updatedAt timestamp', () => {
    const existing = createBaseline([makeFinding()], NOW);
    const later = new Date('2025-06-01T00:00:00Z');
    const { updated } = updateBaseline(existing, [makeFinding()], later);
    expect(updated.updatedAt).toBe(later.toISOString());
    expect(updated.createdAt).toBe(NOW.toISOString()); // createdAt unchanged
  });

  it('preserves entries that are still present', () => {
    const f1 = makeFinding({ message: 'Ongoing violation' });
    const f2 = makeFinding({ file: 'other.ts', message: 'Also ongoing' });
    const existing = createBaseline([f1, f2], NOW);
    const later = new Date('2025-02-01');
    const { updated } = updateBaseline(existing, [f1, f2], later);
    expect(updated.entries).toHaveLength(2);
  });

  it('handles adding and removing simultaneously', () => {
    const old = makeFinding({ message: 'Old violation' });
    const ongoing = makeFinding({ file: 'other.ts', message: 'Ongoing' });
    const fresh = makeFinding({ file: 'new.ts', message: 'Brand new' });
    const existing = createBaseline([old, ongoing], NOW);
    const later = new Date('2025-02-01');
    // old is gone (fixed), ongoing remains, fresh is new
    const { updated, added, resolved } = updateBaseline(existing, [ongoing, fresh], later);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.message).toBe('Old violation');
    expect(added).toHaveLength(1);
    expect(added[0]!.file).toBe('new.ts');
    expect(updated.entries).toHaveLength(2); // ongoing + fresh
  });
});

// ── serializeBaseline / parseBaseline ─────────────────────────────────────────

describe('serializeBaseline', () => {
  it('produces valid JSON', () => {
    const baseline = createBaseline([makeFinding()], NOW);
    expect(() => JSON.parse(serializeBaseline(baseline))).not.toThrow();
  });

  it('is deterministic — same input produces same output', () => {
    const baseline = createBaseline([makeFinding(), makeFinding({ file: 'b.ts' })], NOW);
    expect(serializeBaseline(baseline)).toBe(serializeBaseline(baseline));
  });

  it('sorts entries by severity then file for stable diffs', () => {
    const findings = [
      makeFinding({ file: 'z.ts', severity: 'LOW' }),
      makeFinding({ file: 'a.ts', severity: 'BLOCKER' }),
    ];
    const baseline = createBaseline(findings, NOW);
    const serialized = serializeBaseline(baseline);
    const parsed = JSON.parse(serialized) as Baseline;
    expect(parsed.entries[0]!.severity).toBe('BLOCKER');
    expect(parsed.entries[1]!.severity).toBe('LOW');
  });

  it('ends with a newline', () => {
    const baseline = createBaseline([], NOW);
    expect(serializeBaseline(baseline)).toMatch(/\n$/);
  });
});

describe('parseBaseline', () => {
  it('round-trips through serialize/parse', () => {
    const original = createBaseline([makeFinding()], NOW);
    const parsed = parseBaseline(serializeBaseline(original));
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(original.version);
    expect(parsed!.entries).toHaveLength(1);
  });

  it('returns null for malformed JSON', () => {
    expect(parseBaseline('not json')).toBeNull();
    expect(parseBaseline('{}')).toBeNull();
    expect(parseBaseline('{"version":"1"}')).toBeNull(); // missing entries
  });

  it('returns null for empty string', () => {
    expect(parseBaseline('')).toBeNull();
  });

  it('returns null when entries is not an array', () => {
    expect(parseBaseline(JSON.stringify({ version: '1', entries: 'bad' }))).toBeNull();
  });
});

// ── Integration: create → partition → update cycle ────────────────────────────

describe('full lifecycle integration', () => {
  it('finding fixed between create and update is resolved in update', () => {
    const toFix = makeFinding({ message: 'Will be fixed' });
    const ongoing = makeFinding({ file: 'b.ts', message: 'Stays broken' });

    // Day 1: create baseline with both findings
    const baseline = createBaseline([toFix, ongoing], NOW);

    // Day 2: toFix is fixed, ongoing remains
    const later = new Date('2025-02-01');
    const { updated, resolved } = updateBaseline(baseline, [ongoing], later);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.message).toBe('Will be fixed');
    expect(updated.entries).toHaveLength(1);
  });

  it('finding fixed then re-introduced is treated as NEW', () => {
    const f = makeFinding({ message: 'Comes and goes' });

    // Baseline created with finding
    const baseline = createBaseline([f], NOW);

    // Finding is fixed
    const d2 = new Date('2025-02-01');
    const { updated } = updateBaseline(baseline, [], d2);
    expect(updated.entries).toHaveLength(0);

    // Finding reappears — now there's no baseline, so it's NEW
    const { newFindings } = partitionFindings([f], updated);
    expect(newFindings).toHaveLength(1);
  });

  it('baseline survives round-trip through JSON serialization', () => {
    const findings = [
      makeFinding({ message: 'Finding A', severity: 'BLOCKER' }),
      makeFinding({ file: 'b.ts', message: 'Finding B', severity: 'LOW' }),
    ];
    const original = createBaseline(findings, NOW);
    const serialized = serializeBaseline(original);
    const restored = parseBaseline(serialized);

    expect(restored).not.toBeNull();
    const { newFindings, baselineFindings } = partitionFindings(findings, restored!);
    expect(newFindings).toHaveLength(0);
    expect(baselineFindings).toHaveLength(2);
  });
});

// ── Output formatters ─────────────────────────────────────────────────────────

describe('formatBaselineConsole', () => {
  it('shows "No new violations" when partition has no new findings', () => {
    const f = makeFinding();
    const baseline = createBaseline([f], NOW);
    const partition = partitionFindings([f], baseline);
    const out = formatBaselineConsole(partition, baseline, 'test-project');
    expect(out).toContain('No new violations');
    expect(out).toContain('test-project');
  });

  it('reports new violations', () => {
    const existing = makeFinding({ message: 'Old finding' });
    const newF = makeFinding({ file: 'new.ts', message: 'New violation' });
    const baseline = createBaseline([existing], NOW);
    const partition = partitionFindings([existing, newF], baseline);
    const out = formatBaselineConsole(partition, baseline);
    expect(out).toContain('new violation');
    expect(out).toContain('new.ts');
  });

  it('reports resolved entries', () => {
    const f = makeFinding({ message: 'Fixed finding' });
    const baseline = createBaseline([f], NOW);
    const partition = partitionFindings([], baseline);
    const out = formatBaselineConsole(partition, baseline);
    expect(out).toContain('resolved');
  });

  it('shows summary counts', () => {
    const f = makeFinding();
    const baseline = createBaseline([f], NOW);
    const partition = partitionFindings([f], baseline);
    const out = formatBaselineConsole(partition, baseline);
    // Summary line: "N baseline · M new · K resolved"
    expect(out).toMatch(/baseline/);
    expect(out).toMatch(/new/);
    expect(out).toMatch(/resolved/);
  });
});

describe('formatBaselineMarkdown', () => {
  it('renders clean state when no new violations', () => {
    const f = makeFinding();
    const baseline = createBaseline([f], NOW);
    const partition = partitionFindings([f], baseline);
    const out = formatBaselineMarkdown(partition, baseline, 'my-project');
    expect(out).toContain('No new violations');
    expect(out).toContain('my-project');
  });

  it('renders a table for new violations', () => {
    const baseline = createBaseline([], NOW);
    const partition = partitionFindings([makeFinding()], baseline);
    const out = formatBaselineMarkdown(partition, baseline);
    expect(out).toContain('| Severity | Category | File | Message |');
    expect(out).toContain('🚨');
  });

  it('renders baseline debt table', () => {
    const f = makeFinding();
    const baseline = createBaseline([f], NOW);
    const partition = partitionFindings([f], baseline);
    const out = formatBaselineMarkdown(partition, baseline);
    expect(out).toContain('Baseline Debt');
    expect(out).toContain('| Severity | Category | File | Recorded |');
  });
});

describe('formatBaselineJson', () => {
  it('returns valid JSON with clean:true when no new findings', () => {
    const f = makeFinding();
    const baseline = createBaseline([f], NOW);
    const partition = partitionFindings([f], baseline);
    const out = JSON.parse(formatBaselineJson(partition, baseline)) as Record<string, unknown>;
    expect(out['clean']).toBe(true);
    expect(out['newViolations']).toBe(0);
  });

  it('returns clean:false with newViolations count when there are new findings', () => {
    const baseline = createBaseline([], NOW);
    const partition = partitionFindings([makeFinding()], baseline);
    const out = JSON.parse(formatBaselineJson(partition, baseline)) as Record<string, unknown>;
    expect(out['clean']).toBe(false);
    expect(out['newViolations']).toBe(1);
  });

  it('is deterministic (no timestamps or random values)', () => {
    const baseline = createBaseline([makeFinding()], NOW);
    const partition = partitionFindings([makeFinding()], baseline);
    expect(formatBaselineJson(partition, baseline)).toBe(
      formatBaselineJson(partition, baseline)
    );
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('BASELINE_PATH points to .thesmos/baseline.json', () => {
    expect(BASELINE_PATH).toBe('.thesmos/baseline.json');
  });

  it('BASELINE_VERSION is "1"', () => {
    expect(BASELINE_VERSION).toBe('1');
  });
});
