// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Complexity rubric and cost tiers (WS4).
 *
 * ── Why a numeric score ─────────────────────────────────────────────────────
 * The Fable gate needs a threshold that can be argued with. "Feels complex" is
 * not auditable; a score of 92 built from named, weighted signals is. Every
 * contribution is recorded, so a decision can be re-derived months later.
 *
 * ── The rule that matters ───────────────────────────────────────────────────
 * Task LENGTH alone can never reach the Fable threshold. Length is capped at a
 * deliberately sub-threshold contribution, so a long-but-simple job — a
 * thousand mechanical renames — scores low no matter how long it runs.
 */

import type { RoutingSignals } from './routing.js';

export type ComplexityBand = 'routine' | 'substantive' | 'high_judgment' | 'exceptional';
export type CostTier = 'local' | 'efficient' | 'premium' | 'exceptional';

/**
 * Minimum complexity score for the frontier tier.
 *
 * 90 sits at the bottom of the `exceptional` band. Reaching it requires several
 * independent high-weight signals — no single dimension can get there alone.
 */
export const FABLE_MIN_COMPLEXITY_SCORE = 90;

/** Maximum score reachable from task length alone. Deliberately < 90. */
export const MAX_SCORE_FROM_LENGTH = 20;

export interface ComplexityContribution {
  signal: string;
  points: number;
  note?: string;
}

export interface ComplexityAssessment {
  score: number;
  band: ComplexityBand;
  contributions: ComplexityContribution[];
  /** True when at least one non-length signal is in the exceptional class. */
  hasExceptionalReasonBeyondLength: boolean;
  /** True when the work spans multiple domains or a long horizon. */
  hasMultiDomainOrLongHorizonEvidence: boolean;
}

/**
 * Weighted, deterministic rubric.
 *
 * Bands: 0–29 routine · 30–69 substantive · 70–89 high judgment ·
 * 90–100 exceptional.
 */
export function assessComplexity(s: RoutingSignals): ComplexityAssessment {
  const c: ComplexityContribution[] = [];

  // ── Consequence signals (high weight) ─────────────────────────────────────
  // Calibrated so that ONE consequence signal plus modest breadth lands in
  // `high_judgment` (>=70), and reaching `exceptional` (>=90) needs several
  // independent signals — no single dimension can get there alone.
  if (s.architecturalImpact) c.push({ signal: 'architectural-impact', points: 34 });
  if (s.securitySensitive) c.push({ signal: 'security-sensitive', points: 34 });
  if (s.releaseSensitive) c.push({ signal: 'release-sensitive', points: 28 });
  if (s.riskTier === 'critical') c.push({ signal: 'risk-critical', points: 26 });
  else if (s.riskTier === 'high') c.push({ signal: 'risk-high', points: 20 });
  else if (s.riskTier === 'medium') c.push({ signal: 'risk-medium', points: 12 });

  // ── Breadth signals ───────────────────────────────────────────────────────
  const subsystems = s.affectedSubsystems ?? 0;
  if (subsystems >= 5) c.push({ signal: 'cross-subsystem-wide', points: 22 });
  else if (subsystems >= 3) c.push({ signal: 'cross-subsystem', points: 16 });
  else if (subsystems === 2) c.push({ signal: 'two-subsystems', points: 8 });

  const depth = s.dependencyDepth ?? 0;
  if (depth >= 6) c.push({ signal: 'deep-dependency-graph', points: 14 });
  else if (depth >= 4) c.push({ signal: 'moderate-dependency-graph', points: 8 });

  // ── Uncertainty ───────────────────────────────────────────────────────────
  if (s.ambiguity === 'high') c.push({ signal: 'high-ambiguity', points: 16 });
  else if (s.ambiguity === 'medium') c.push({ signal: 'medium-ambiguity', points: 8 });

  if (s.evidenceRequired) c.push({ signal: 'evidence-required', points: 6 });

  // ── Length — CAPPED ───────────────────────────────────────────────────────
  // A long task is not thereby a hard one. This contribution can never on its
  // own reach FABLE_MIN_COMPLEXITY_SCORE.
  const steps = s.expectedSteps ?? 0;
  const lengthPoints = steps >= 200 ? 20 : steps >= 80 ? 14 : steps >= 40 ? 9 : steps >= 15 ? 4 : 0;
  if (lengthPoints > 0) {
    c.push({
      signal: 'task-length',
      points: Math.min(lengthPoints, MAX_SCORE_FROM_LENGTH),
      note: `capped at ${MAX_SCORE_FROM_LENGTH} — length alone can never reach the frontier threshold`,
    });
  }

  // Bounded mechanical work is explicitly low-consequence.
  if (s.boundedMechanical) c.push({ signal: 'bounded-mechanical', points: -15 });

  const raw = c.reduce((n, x) => n + x.points, 0);
  const score = Math.max(0, Math.min(100, raw));

  const band: ComplexityBand =
    score >= 90 ? 'exceptional' : score >= 70 ? 'high_judgment' : score >= 30 ? 'substantive' : 'routine';

  // "Exceptional beyond length" means a consequence/uncertainty signal, not
  // breadth-by-itself and never the length contribution.
  const exceptionalSignals = new Set([
    'architectural-impact',
    'security-sensitive',
    'release-sensitive',
    'risk-critical',
    'high-ambiguity',
  ]);
  const hasExceptionalReasonBeyondLength = c.some(
    (x) => exceptionalSignals.has(x.signal) && x.points > 0,
  );

  const hasMultiDomainOrLongHorizonEvidence = subsystems >= 3 || steps >= 40;

  return { score, band, contributions: c, hasExceptionalReasonBeyondLength, hasMultiDomainOrLongHorizonEvidence };
}

/**
 * Cost tier for a resolved profile.
 *
 * A relative class, never a dollar estimate — provider pricing is verified for
 * Anthropic only, and inventing a figure for an unverified provider is exactly
 * the fabrication the model registry exists to prevent.
 */
export function costTierFor(profile: string): CostTier {
  switch (profile) {
    case 'fast-mechanical':
      return 'efficient';
    case 'balanced-agentic':
      return 'efficient';
    case 'deep-reasoning':
      return 'premium';
    case 'frontier-long-horizon':
      return 'exceptional';
    default:
      return 'efficient';
  }
}

/** Deterministic work that needs no model at all. */
export function isModelFreeWork(s: RoutingSignals): boolean {
  return (
    s.boundedMechanical === true &&
    !s.architecturalImpact &&
    !s.securitySensitive &&
    !s.releaseSensitive &&
    (s.riskTier === undefined || s.riskTier === 'low') &&
    (s.ambiguity === undefined || s.ambiguity === 'low')
  );
}
