// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import {
  applyBudget,
  cosineSimilarity,
  deduplicate,
  detectConflicts,
  isVisible,
  lexicalSimilarity,
  rankMemories,
} from './retrieve.js';
import { MEMORY_SCHEMA_VERSION, type MemoryRecord } from './types.js';

let counter = 0;
function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  counter++;
  const now = new Date().toISOString();
  return {
    id: `mem-${String(counter).padStart(3, '0')}`,
    schemaVersion: MEMORY_SCHEMA_VERSION,
    scope: 'repository',
    type: 'architecture-decision',
    status: 'active',
    content: 'Thesmos owns provider orchestration.',
    provenance: { sourceKind: 'user', creator: 'matthew', derivation: 'stated' },
    confidence: 'high',
    sensitivity: 'project',
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

describe('cosineSimilarity', () => {
  it('scores identical vectors as 1', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1);
  });

  it('scores orthogonal vectors as 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('refuses to compare mismatched widths', () => {
    // Different vector spaces would otherwise produce a plausible number.
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for a zero vector rather than NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('scope and project isolation', () => {
  it('hides another repository entirely', () => {
    const other = record({ repoId: 'other-repo' });
    expect(isVisible(other, { text: 'x', repoId: 'mine' })).toBe(false);
  });

  it('keeps repo-agnostic memory visible', () => {
    expect(isVisible(record(), { text: 'x', repoId: 'mine' })).toBe(true);
  });

  it('hides another mission’s private memory', () => {
    const m = record({ scope: 'mission', missionId: 'mission-a' });
    expect(isVisible(m, { text: 'x', missionId: 'mission-b' })).toBe(false);
    expect(isVisible(m, { text: 'x', missionId: 'mission-a' })).toBe(true);
  });

  it('lets a narrow query read wider memory but not the reverse', () => {
    const wide = record({ scope: 'repository' });
    const narrow = record({ scope: 'session' });
    expect(isVisible(wide, { text: 'x', scope: 'session' })).toBe(true);
    expect(isVisible(narrow, { text: 'x', scope: 'repository' })).toBe(false);
  });

  it('excludes cross-project records from ranked output', () => {
    const results = rankMemories(
      [record({ repoId: 'mine', content: 'provider orchestration' }), record({ repoId: 'theirs', content: 'provider orchestration' })],
      { text: 'provider orchestration', repoId: 'mine' },
    );
    expect(results).toHaveLength(1);
    expect(results[0].memory.repoId).toBe('mine');
  });
});

describe('status and expiry', () => {
  it('excludes superseded memory by default', () => {
    const results = rankMemories(
      [record({ status: 'superseded', content: 'ProviderManager owns routing' })],
      { text: 'provider routing' },
    );
    expect(results).toHaveLength(0);
  });

  it('includes superseded memory when asked, but heavily demoted', () => {
    const current = record({ content: 'provider runtime moved into thesmos runtime providers' });
    const old = record({ status: 'superseded', content: 'provider runtime moved into thesmos runtime providers' });
    const results = rankMemories([old, current], {
      text: 'provider runtime providers',
      includeInactive: true,
    });
    expect(results[0].memory.status).toBe('active');
    expect(results[0].relevanceScore).toBeGreaterThan(results[1].relevanceScore);
  });

  it('excludes expired memory', () => {
    const expired = record({
      retention: { expiresAt: new Date(Date.now() - 86_400_000).toISOString() },
    });
    expect(rankMemories([expired], { text: 'provider' })).toHaveLength(0);
  });

  it('keeps memory whose expiry is still in the future', () => {
    const live = record({
      content: 'provider orchestration',
      retention: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(rankMemories([live], { text: 'provider orchestration' })).toHaveLength(1);
  });
});

describe('ranking factors', () => {
  it('ranks a decision above a hypothesis with identical text', () => {
    // An inference must never outrank a stated decision on similarity alone.
    const decision = record({ type: 'user-decision', content: 'never auto-merge production PRs' });
    const guess = record({ type: 'hypothesis', confidence: 'medium', content: 'never auto-merge production PRs' });
    const results = rankMemories([guess, decision], { text: 'auto-merge production' });
    expect(results[0].memory.type).toBe('user-decision');
  });

  it('lets confidence break a tie between same-type records', () => {
    const low = record({ confidence: 'low', content: 'staging migration repair procedure' });
    const verified = record({ confidence: 'verified', content: 'staging migration repair procedure' });
    const results = rankMemories([low, verified], { text: 'staging migration repair' });
    expect(results[0].memory.confidence).toBe('verified');
  });

  it('prefers observed provenance over inferred', () => {
    const inferred = record({
      content: 'ci is green on main',
      provenance: { sourceKind: 'agent', creator: 'a', derivation: 'inferred' },
    });
    const observed = record({
      content: 'ci is green on main',
      provenance: { sourceKind: 'execution-receipt', creator: 'ci', derivation: 'observed', evidenceRef: 'r1' },
    });
    const results = rankMemories([inferred, observed], { text: 'ci green main' });
    expect(results[0].memory.provenance.derivation).toBe('observed');
  });

  it('orders deterministically on a score tie', () => {
    const a = record({ id: 'mem-aaa', content: 'identical content here' });
    const b = record({ id: 'mem-bbb', content: 'identical content here' });
    const first = rankMemories([b, a], { text: 'identical content' }).map((r) => r.memory.id);
    const second = rankMemories([a, b], { text: 'identical content' }).map((r) => r.memory.id);
    expect(first).toEqual(second);
  });

  it('uses vectors when supplied and reports why', () => {
    const target = record({ id: 'mem-vec', content: 'unrelated words entirely' });
    const vectors = new Map([['mem-vec', [1, 0, 0]]]);
    const results = rankMemories(
      [target],
      { text: 'query' },
      (id) => vectors.get(id),
      [1, 0, 0],
    );
    expect(results[0].similarity).toBeCloseTo(1);
    expect(results[0].reasons.join(' ')).toMatch(/semantic similarity/);
  });

  it('falls back lexically for an unembedded record rather than dropping it', () => {
    const results = rankMemories(
      [record({ id: 'mem-none', content: 'staging migration repair' })],
      { text: 'staging migration' },
      () => undefined,
      [1, 0, 0],
    );
    expect(results).toHaveLength(1);
    expect(results[0].reasons.join(' ')).toMatch(/lexical fallback/);
  });

  it('honours the result limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => record({ content: `provider fact number ${i}` }));
    expect(rankMemories(many, { text: 'provider fact', limit: 5 })).toHaveLength(5);
  });
});

describe('deduplication', () => {
  it('collapses near-identical memories', () => {
    const a = record({ content: 'Staging migration repair requires a validated project ref.' });
    const b = record({ content: 'Staging migration repair requires a validated project ref!' });
    const ranked = rankMemories([a, b], { text: 'staging migration repair' });
    expect(deduplicate(ranked)).toHaveLength(1);
  });

  it('keeps genuinely different memories', () => {
    const a = record({ content: 'Staging migration repair requires a validated project ref.' });
    const b = record({ content: 'Homepage hero uses the wide layout variant.' });
    const ranked = rankMemories([a, b], { text: 'staging homepage', minRelevance: 0 });
    expect(deduplicate(ranked).length).toBeGreaterThan(1);
  });
});

describe('conflict detection', () => {
  it('surfaces two active high-confidence decisions that negate each other', () => {
    const a = record({
      type: 'user-decision',
      confidence: 'high',
      content: 'production deployment requires human approval',
    });
    const b = record({
      type: 'user-decision',
      confidence: 'verified',
      content: 'production deployment must not require human approval',
    });
    const conflicts = detectConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
  });

  it('catches opposing phrasings that share a polarity word', () => {
    // Regression: an earlier detector asked "does exactly one contain a
    // negator", which cancelled out because BOTH sentences contain "without",
    // and the shared "without" also inflated the similarity denominator.
    const a = record({
      type: 'user-decision',
      confidence: 'high',
      content: 'Never auto-merge production deployment PRs without human approval.',
    });
    const b = record({
      type: 'user-decision',
      confidence: 'verified',
      content: 'Production deployment PRs may merge automatically without approval.',
    });
    expect(detectConflicts([a, b])).toHaveLength(1);
  });

  it('reads a negated modal as a waiver, not a requirement', () => {
    // "must not require" contains "must" — a naive keyword match calls that a
    // requirement and misses the contradiction entirely.
    const a = record({
      type: 'user-decision',
      confidence: 'high',
      content: 'Production deployment requires human approval.',
    });
    const b = record({
      type: 'user-decision',
      confidence: 'high',
      content: 'Production deployment must not require human approval.',
    });
    expect(detectConflicts([a, b])).toHaveLength(1);
  });

  it('does not flag two records that merely both mention approval', () => {
    // Same vocabulary, same polarity — agreement, not conflict.
    const a = record({ type: 'user-decision', content: 'Production deploys require approval.' });
    const b = record({ type: 'user-decision', content: 'Production deploys require approval from an owner.' });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it('does not flag a resolved supersession as a conflict', () => {
    const a = record({
      id: 'old',
      type: 'user-decision',
      confidence: 'high',
      content: 'production deployment requires human approval',
      supersededBy: ['new'],
      status: 'active',
    });
    const b = record({
      id: 'new',
      type: 'user-decision',
      confidence: 'high',
      content: 'production deployment must not require human approval',
    });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it('stays quiet on unrelated decisions', () => {
    const a = record({ type: 'user-decision', content: 'never auto-merge production PRs' });
    const b = record({ type: 'user-decision', content: 'use the wide hero layout on the homepage' });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it('ignores low-confidence chatter', () => {
    const a = record({ type: 'user-decision', confidence: 'low', content: 'deployment requires approval' });
    const b = record({ type: 'user-decision', confidence: 'low', content: 'deployment must not require approval' });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });
});

describe('budget', () => {
  it('caps record count', () => {
    const many = Array.from({ length: 30 }, (_, i) => record({ content: `provider fact ${i}` }));
    const ranked = rankMemories(many, { text: 'provider fact', limit: 30 });
    expect(applyBudget(ranked, { maxChars: 100_000, maxRecords: 5 }).kept).toHaveLength(5);
  });

  it('caps characters and reports what was dropped', () => {
    const many = Array.from({ length: 10 }, (_, i) => record({ content: `x`.repeat(200) + i }));
    const ranked = rankMemories(many, { text: 'x', limit: 10, minRelevance: 0 });
    const out = applyBudget(ranked, { maxChars: 500, maxRecords: 100 });
    expect(out.chars).toBeLessThanOrEqual(500);
    expect(out.droppedForBudget).toBeGreaterThan(0);
  });
});

describe('lexicalSimilarity', () => {
  it('scores overlap and ignores short noise words', () => {
    expect(lexicalSimilarity('staging migration repair', 'staging migration repair')).toBeCloseTo(1);
    expect(lexicalSimilarity('staging migration', 'homepage design')).toBe(0);
  });
});
