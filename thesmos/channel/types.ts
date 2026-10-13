// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The channel — a persistent, multi-agent conversation.
 *
 * Deliberately not the mission/DAG system (thesmos/mission/): a mission is a
 * one-shot task handoff with a defined dependency graph, and this is an
 * open-ended discussion with a fixed cast of participants. See
 * docs/plans/operation-olympus.md, which explicitly scoped "Slack or mobile
 * execution" as a non-goal for Pantheon Chat — the desktop app's channel is a
 * deliberate, separate surface, not an extension of that system.
 */

export interface ChannelMessage {
  id: string;
  /**
   * Monotonic per-channel position, assigned at append time. The polling
   * cursor and the only thing "since" filtering trusts — two messages
   * appended within the same millisecond would tie on `ts`, so ordering
   * never relies on wall-clock time.
   */
  seq: number;
  /** Wall-clock time, for display only — never used to order or filter. */
  ts: string;
  /** `'user'` for the human, otherwise a Pantheon agent id. */
  authorId: string;
  authorType: 'user' | 'agent';
  text: string;
  /** Which round of responses this message belongs to (0 for the user's own post). */
  round: number;
}

export interface ChannelDefinition {
  id: string;
  name: string;
  /** Full roster, including Zeus — see thesmos/channel/responders.ts for how he's resolved. */
  agentIds: string[];
}
