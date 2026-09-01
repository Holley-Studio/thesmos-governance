// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Session-start context rendering.
 *
 * The byte budget is a correctness property, not a preference:
 * `context-capsule.ts` already documents that quality degrades as context
 * fills, so a session-start notice that crowds out the rules it exists to
 * support is a net loss.
 *
 * Degradation drops whole lines in severity order. It never truncates
 * mid-sentence — a half-sentence about a stale baseline is worse than silence,
 * because it reads as a complete claim.
 *
 * Header, the ref-uncertainty caveat, and the footer are not reserved
 * upfront — they are optional tail content admitted opportunistically, after
 * the severity-sorted signal lines, only if they still fit. Reserving their
 * bytes upfront would shrink the budget available to signals and could
 * force a high-severity line out in favor of framing text.
 */

import type { FreshnessReport, FreshnessSignal, SignalSeverity } from './types.js';

export const DEFAULT_MAX_BYTES = 1200;

const HEADER = 'Thesmos — repository state at session start:';
const FOOTER =
  'Address these before relying on repository state. Not automatic — act only if the task needs it.';

const RANK: Record<SignalSeverity, number> = { warn: 0, notice: 1, ok: 2 };

function line(signal: FreshnessSignal): string {
  return signal.remedy
    ? `- ${signal.text}  →  \`${signal.remedy}\``
    : `- ${signal.text}`;
}

function bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function renderSessionContext(
  report: FreshnessReport,
  maxBytes: number = DEFAULT_MAX_BYTES,
): string {
  const actionable = report.signals
    .filter((s) => s.severity !== 'ok')
    .slice()
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  if (actionable.length === 0) return '';

  // Admit the header first and track running bytes as parts are joined
  // with '\n' (each subsequent part costs its own bytes plus one separator).
  const parts: string[] = [HEADER];
  let used = bytes(HEADER);

  // Walk signals in severity order, admitting each while it fits. Break —
  // never continue — on the first that doesn't: the list is already
  // severity-sorted, so skipping past a line that doesn't fit in favor of a
  // smaller, lower-severity one would invert the priority the sort exists
  // to establish.
  let keptAny = false;
  for (const signal of actionable) {
    const candidate = line(signal);
    const cost = bytes(candidate) + 1;
    if (used + cost > maxBytes) break;
    parts.push(candidate);
    used += cost;
    keptAny = true;
  }

  if (!keptAny) return '';

  if (report.refsUncertain) {
    const caveat = 'Remote refs are stale, so branch counts above are approximate.';
    const cost = bytes(caveat) + 1;
    if (used + cost <= maxBytes) {
      parts.push(caveat);
      used += cost;
    }
  }

  const footerCost = bytes(FOOTER) + 1;
  if (used + footerCost <= maxBytes) {
    parts.push(FOOTER);
    used += footerCost;
  }

  return parts.join('\n');
}
