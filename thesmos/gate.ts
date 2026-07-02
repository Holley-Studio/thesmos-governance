// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Shared gate semantics — the ONE place that decides which findings are
 * allowed to fail a pipeline. Every gate (validate, ci, the PR action) must
 * make its exit-code decision through partitionByConfidence so they can
 * never disagree about what blocks.
 *
 * Confidence tiers exist because a regex engine knows the difference between
 * proof and smell: a committed secret is proof (high); an exec() template
 * literal whose interpolants might be constants is a smell (medium). Findings
 * below the configured minConfidence still appear in output — tagged — but
 * never flip the exit code.
 */
import type { Confidence, Finding } from './types.js';

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export interface ConfidencePartition {
  /** Findings whose confidence meets the gate threshold — these may fail a pipeline. */
  gating: Finding[];
  /** Findings below the threshold — report-only, tagged in output. */
  advisory: Finding[];
}

export function partitionByConfidence(
  findings: Finding[],
  minConfidence: Confidence = 'medium',
): ConfidencePartition {
  const threshold = CONFIDENCE_RANK[minConfidence];
  const gating: Finding[] = [];
  const advisory: Finding[] = [];
  for (const f of findings) {
    const rank = CONFIDENCE_RANK[f.confidence ?? 'high'];
    (rank >= threshold ? gating : advisory).push(f);
  }
  return { gating, advisory };
}

/** Output tag for a below-threshold finding, e.g. "[medium-confidence]". */
export function confidenceTag(f: Finding): string {
  const c = f.confidence ?? 'high';
  return c === 'high' ? '' : `[${c}-confidence]`;
}
