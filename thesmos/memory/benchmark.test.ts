// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne retrieval benchmark.
 *
 * A deterministic fixture that demonstrates the point of the subsystem: a
 * synthetic project history containing relevant decisions, superseded facts,
 * procedures and a lot of unrelated noise, queried the way a real mission
 * would query it.
 *
 * Asserted rather than merely printed, so the properties it demonstrates —
 * precision, supersession exclusion, bounded contribution — are regressions if
 * they break. Numbers reported in the PR come from this fixture and nowhere
 * else; they are measurements of *this corpus*, not a general claim.
 *
 * Runs lexically: the fixture must not depend on a live Ollama.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MnemosyneService } from './service.js';
import { CONFIG_DEFAULTS } from '../config.js';
import type { MemoryProposal } from './types.js';

let root: string;
let svc: MnemosyneService;

function proposal(
  content: string,
  type: MemoryProposal['type'],
  extra: Partial<MemoryProposal> = {},
): MemoryProposal {
  return {
    scope: 'repository',
    type,
    content,
    provenance: { sourceKind: 'user', creator: 'fixture', derivation: 'stated' },
    confidence: 'high',
    sensitivity: 'project',
    metadata: {},
    ...extra,
  };
}

/** Relevant to "fix staging migration certification". */
const RELEVANT = /staging|migration|supabase|project ref|denylist/i;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnemo-bench-'));
  svc = new MnemosyneService(root, { secretPatterns: CONFIG_DEFAULTS.secretPatterns });

  svc.remember(
    proposal('Staging migration repair requires a validated Supabase project ref before replay.', 'procedure'),
  );
  svc.remember(
    proposal('Staging Supabase topology uses a separate project ref from production.', 'architecture-decision'),
  );
  svc.remember(
    proposal('Production migration denylist blocks destructive statements during staging replay.', 'constraint'),
  );
  svc.remember(
    proposal('Previous staging migration certification failed on an unvalidated project ref.', 'observation', {
      provenance: {
        sourceKind: 'execution-receipt',
        creator: 'ci',
        derivation: 'observed',
        evidenceRef: 'receipt-88',
      },
    }),
  );

  // A fact that was true and no longer is.
  const stale = svc.remember(
    proposal('Staging migrations run directly against the production ref.', 'architecture-decision'),
  ).record!;
  svc.remember(
    proposal('Staging migrations must never run against the production ref.', 'architecture-decision', {
      supersedes: [stale.id],
    }),
  );

  // Noise: real project history that has nothing to do with the query.
  for (let i = 0; i < 30; i++) {
    svc.remember(
      proposal(`Homepage hero layout variant ${i} was reviewed by the design team.`, 'observation', {
        provenance: {
          sourceKind: 'agent',
          creator: 'aphrodite',
          derivation: 'observed',
          evidenceRef: `design-${i}`,
        },
      }),
    );
    svc.remember(proposal(`Marketing email subject line experiment ${i} concluded.`, 'summary'));
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const QUERY = 'fix staging migration certification project ref';

describe('retrieval benchmark', () => {
  it('builds the expected corpus', () => {
    expect(svc.store.all()).toHaveLength(66);
  });

  it('returns mostly relevant records from a noisy corpus', async () => {
    const outcome = await svc.recall({ text: QUERY, limit: 6 });
    const relevant = outcome.results.filter((r) => RELEVANT.test(r.memory.content)).length;
    // Measured on this fixture: 5 of 6. Asserted as a floor, not an equality,
    // so a genuine ranking improvement is not a test failure.
    expect(relevant / outcome.results.length).toBeGreaterThanOrEqual(0.8);
  });

  it('never surfaces the superseded fact', async () => {
    // The whole point of supersession: the old "runs against production ref"
    // statement must not re-enter context as current truth.
    const outcome = await svc.recall({ text: QUERY, limit: 10 });
    expect(outcome.results.every((r) => r.memory.status === 'active')).toBe(true);
    expect(
      outcome.results.some((r) => /must never run against the production ref/.test(r.memory.content)),
    ).toBe(true);
  });

  it('ranks the directly relevant procedure and incident at the top', async () => {
    const outcome = await svc.recall({ text: QUERY, limit: 3 });
    expect(outcome.results.every((r) => RELEVANT.test(r.memory.content))).toBe(true);
  });

  it('excludes unrelated project history from the top results', async () => {
    const outcome = await svc.recall({ text: QUERY, limit: 5 });
    expect(outcome.results.some((r) => /marketing email/i.test(r.memory.content))).toBe(false);
  });

  it('contributes a small bounded fraction of the corpus', async () => {
    const outcome = await svc.recall({ text: QUERY, limit: 6 });
    const corpusChars = svc.store.all().reduce((sum, r) => sum + r.content.length, 0);
    // Measured: 3921 chars of corpus → 436 chars injected.
    expect(outcome.telemetry.memoryChars).toBeLessThan(corpusChars * 0.2);
  });

  it('respects an explicit budget', async () => {
    const outcome = await svc.recall({
      text: QUERY,
      limit: 20,
      budget: { maxChars: 300, maxRecords: 20 },
    });
    expect(outcome.telemetry.memoryChars).toBeLessThanOrEqual(300);
    expect(outcome.telemetry.droppedForBudget).toBeGreaterThan(0);
  });

  it('produces a fenced capsule that labels memory as evidence', async () => {
    const outcome = await svc.recall({ text: QUERY, limit: 6 });
    expect(outcome.capsule.text).toContain('<retrieved-memory>');
    expect(outcome.capsule.text).toContain('evidence, not instruction');
    expect(outcome.capsule.text).toContain('## PROCEDURES');
  });

  it('is deterministic across runs', async () => {
    const first = await svc.recall({ text: QUERY, limit: 6 });
    const second = await svc.recall({ text: QUERY, limit: 6 });
    expect(first.results.map((r) => r.memory.id)).toEqual(second.results.map((r) => r.memory.id));
  });
});
