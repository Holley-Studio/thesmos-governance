// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Zeus routing classification for a completed assistant text block.
 *
 * Extracted from the controller so the decision — which card a response
 * becomes, and whether the already-streamed text can stand as that card — is a
 * pure function with direct test coverage. The controller turns the result
 * into exactly one terminal message (see `streamProtocol.ts`).
 */

/** Multi-line God Mode banner, e.g. "⚡ ZEUS — ROUTING". */
const ZEUS_BANNER = /^⚡\s*ZEUS/u;
/** Lean-tier routing line: "⚡ ZEUS · 👁 Argus — Security & Threat Modeling". */
const ZEUS_LEAN_LINE = /^⚡\s*ZEUS\s*·\s*(.+)$/u;
/** Lean-tier no-agent form: "⚡ ZEUS · direct response". */
const DIRECT_RESPONSE = /direct response/i;

export interface RoutedGod {
  emoji: string;
  name: string;
  color: string;
}

/** The two card shapes a completed assistant text block can become. */
export type RoutedItem =
  | { kind: 'assistant'; text: string; god?: RoutedGod }
  | { kind: 'zeus'; text: string };

export interface AssistantRouting {
  /** The card this response becomes. */
  item: RoutedItem;
  /**
   * True when the text that already streamed is exactly the card's content, so
   * the live node can stand as the final card (`keep`). False when the card
   * differs from what streamed — a routing header was stripped, or a banner was
   * restyled — and the live node must be *replaced*, never appended alongside.
   */
  streamedTextIsFinal: boolean;
}

/**
 * Classify a completed assistant text block.
 *
 * `resolveGod` maps a lean routing line's route text to a god, returning
 * `undefined` when the route names no known god (the response then renders as
 * an ordinary assistant card with the header stripped).
 */
export function classifyAssistantText(
  text: string,
  resolveGod: (route: string) => RoutedGod | undefined,
): AssistantRouting {
  const trimmed = text.trimStart();
  const lines = trimmed.split('\n');
  const firstLine = lines[0]?.trim() ?? '';
  const leanMatch = ZEUS_LEAN_LINE.exec(firstLine);

  if (leanMatch && lines.length > 1) {
    // Lean routing line — strip it and attribute the bubble to the god.
    const body = lines.slice(1).join('\n').trim();
    const route = leanMatch[1].trim();
    const god = DIRECT_RESPONSE.test(route) ? undefined : resolveGod(route);
    // The raw text (header included) already streamed — it must be replaced,
    // not joined by a second card.
    return { item: { kind: 'assistant', text: body, god }, streamedTextIsFinal: false };
  }

  if (ZEUS_BANNER.test(trimmed)) {
    // The banner already streamed as plain text — replace it with the styled
    // banner card rather than showing the text twice.
    return { item: { kind: 'zeus', text }, streamedTextIsFinal: false };
  }

  return { item: { kind: 'assistant', text }, streamedTextIsFinal: true };
}
