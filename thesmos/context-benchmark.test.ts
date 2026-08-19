// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Context-construction benchmark.
 *
 * The Phase-2 benchmark proved retrieval ranks well. This one asks the question
 * that actually matters: does memory-aware context construction send *less* and
 * *better* than the alternative it replaces?
 *
 * The baseline is deliberately the honest one — carrying prior project history
 * forward as transcript, which is what a session does today when it has no
 * memory. Comparing against "send nothing" would be a rigged comparison.
 *
 * Every number here is asserted, not printed. Figures quoted elsewhere come
 * from this fixture and describe this corpus only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMissionContext, assembleContext } from './context-intelligence.js';
import { estimateTokens } from './token-budget.js';
import { MnemosyneService } from './memory/service.js';
import { CONFIG_DEFAULTS } from './config.js';
import type { MemoryProposal } from './memory/types.js';

let root: string;
let svc: MnemosyneService;

/** Prior history as a session would carry it: everything, in order. */
const transcript: string[] = [];

function remember(content: string, overrides: Partial<MemoryProposal> = {}): string | undefined {
  transcript.push(content);
  return svc.remember({
    scope: 'repository',
    type: 'observation',
    content,
    provenance: { sourceKind: 'user', creator: 'bench', derivation: 'stated' },
    confidence: 'high',
    sensitivity: 'project',
    metadata: {},
    ...overrides,
  }).record?.id;
}

const CURRENT_EVIDENCE =
  'CI run 4821 failed at migration step 3 on staging. Working tree clean at abc123.';
const MISSION = 'Continue fixing the staging migration certification failure.';

/**
 * Facts a correct context must preserve.
 *
 * Matched loosely across the middle of the phrase — the stored wording is
 * "validated Supabase project ref", and an over-tight pattern would fail on
 * phrasing rather than on the property being asserted.
 */
const MUST_KEEP = [/validated\b.*\bproject ref/i, /denylist/i];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ctx-bench-'));
  svc = new MnemosyneService(root, { secretPatterns: CONFIG_DEFAULTS.secretPatterns });
  transcript.length = 0;

  // ── Relevant decisions and procedures ──
  remember('Staging migration repair requires a validated Supabase project ref before replay.', {
    type: 'procedure',
  });
  remember('The production statement denylist blocks destructive DDL during staging replay.', {
    type: 'constraint',
  });
  remember('Staging Supabase topology uses a project ref separate from production.', {
    type: 'architecture-decision',
  });

  // ── A superseded fact ──
  const stale = remember('Staging migrations replay directly against the production ref.', {
    type: 'architecture-decision',
  });
  remember('Staging migrations must never replay against the production ref.', {
    type: 'architecture-decision',
    supersedes: stale ? [stale] : undefined,
  });

  // ── Irrelevant prior missions: the bulk of a real transcript ──
  for (let i = 0; i < 60; i++) {
    remember(
      `Design review ${i}: the homepage hero variant was evaluated against the marketing brief and the wide layout was retained for campaign pages.`,
      { type: 'observation', provenance: { sourceKind: 'agent', creator: 'aphrodite', derivation: 'observed', evidenceRef: `d-${i}` } },
    );
    remember(
      `Newsletter experiment ${i}: subject-line variant B concluded with no significant difference in open rate.`,
      { type: 'summary' },
    );
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** What a memory-less session would send: current evidence plus all history. */
function baselineContext(): string {
  return assembleContext({
    userIntent: MISSION,
    currentEvidence: [CURRENT_EVIDENCE, ...transcript].join('\n'),
  });
}

async function memoryAwareContext(): Promise<{ text: string; included: number; excluded: number; ms: number }> {
  const result = await buildMissionContext({
    root,
    query: MISSION,
    authority: { maxScope: 'repository', repoId: undefined, projectId: 'bench' },
  });
  const text = assembleContext({
    userIntent: MISSION,
    currentEvidence: CURRENT_EVIDENCE,
    memoryCapsule: result.memoryCapsule,
  });
  return {
    text,
    included: result.diagnostics.included,
    excluded: result.diagnostics.excluded.length,
    ms: result.diagnostics.retrievalMs,
  };
}

describe('context construction benchmark', () => {
  it('builds the expected corpus', () => {
    expect(svc.store.all().length).toBe(125);
  });

  it('sends materially less than carrying the transcript forward', async () => {
    const baseline = baselineContext();
    const aware = await memoryAwareContext();

    // Measured on this fixture: ~14.4k chars → ~1.0k.
    expect(aware.text.length).toBeLessThan(baseline.length * 0.25);
    expect(estimateTokens(aware.text)).toBeLessThan(estimateTokens(baseline) * 0.25);
  });

  it('preserves the facts needed to continue the work', async () => {
    // Smaller is only better if the necessary evidence survives.
    const aware = await memoryAwareContext();
    for (const pattern of MUST_KEEP) expect(aware.text).toMatch(pattern);
  });

  it('keeps current evidence, which memory never displaces', async () => {
    const aware = await memoryAwareContext();
    expect(aware.text).toContain('CI run 4821');
    expect(aware.text.indexOf('CI run 4821')).toBeLessThan(aware.text.indexOf('<retrieved-memory>'));
  });

  it('drops the irrelevant history the baseline would have carried', async () => {
    const baseline = baselineContext();
    const aware = await memoryAwareContext();
    expect(baseline).toMatch(/homepage hero/i);
    expect(aware.text).not.toMatch(/homepage hero/i);
    expect(aware.text).not.toMatch(/subject-line variant/i);
  });

  it('excludes the superseded fact while keeping its replacement', async () => {
    const aware = await memoryAwareContext();
    expect(aware.text).not.toMatch(/replay directly against the production ref/i);
    expect(aware.text).toMatch(/must never replay against the production ref/i);
  });

  it('injects only a small fraction of the corpus', async () => {
    // Deliberately measured against the corpus, not against the exclusion
    // count: near-identical noise is collapsed by deduplication *before*
    // relevance filtering, so most of the 125 records never reach the exclusion
    // list at all. Counting exclusions would understate how much was dropped.
    const aware = await memoryAwareContext();
    const corpus = svc.store.all().length;
    expect(aware.included).toBeGreaterThan(0);
    expect(aware.included).toBeLessThan(corpus * 0.05);
  });

  it('retrieves fast enough to sit on the critical path', async () => {
    // Generous ceiling: the assertion is "not pathological", not a perf claim.
    const aware = await memoryAwareContext();
    expect(aware.ms).toBeLessThan(1000);
  });

  it('is deterministic', async () => {
    const a = await memoryAwareContext();
    const b = await memoryAwareContext();
    expect(a.text).toBe(b.text);
  });
});
