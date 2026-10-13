// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Who responds to a new channel message.
 *
 * Specialists are chosen by the existing Zeus domain router
 * (thesmos/pantheon/router.ts) plus explicit @mentions, intersected with the
 * channel's roster so a channel can never surface an agent it wasn't given.
 *
 * Zeus is resolved separately from the keyword router — he has no entry in
 * `DOMAIN_ROUTING` and isn't meant to. He always takes the last turn, which
 * is a deliberate product rule rather than a routing outcome: he is the
 * standing COO presence in the room, so a message is never met with silence.
 * That matters because `routeTask` is a fixed keyword table and misses real
 * phrasings routinely — "no e2e coverage" does not match its `e2e test`
 * pattern, and a channel that answers a direct question with nothing at all
 * is broken in a way a slightly-off responder never is.
 */

import { routeTask } from '../pantheon/router.js';

export const ZEUS_AGENT_ID = 'zeus-executive-agent';

export interface ResolvedResponders {
  /** Specialists, in the order they should take their turn. */
  specialists: string[];
  /** Whether Zeus closes out this round — true whenever he is in the roster. */
  zeus: boolean;
}

/** The short name a natural "@chiron" mention would use, from a full agent id. */
function shortName(agentId: string): string {
  return agentId.split('-')[0] ?? agentId;
}

function mentionedAgentIds(text: string, roster: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return roster.filter((id) => lower.includes(`@${shortName(id)}`) || lower.includes(`@${id}`));
}

/**
 * Resolve who responds to `text` in a channel whose roster is `agentIds`.
 *
 * `agentIds` is expected to include Zeus alongside the specialists — he is
 * still resolved through his own rule below, never through the keyword table.
 */
export function resolveResponders(text: string, agentIds: readonly string[]): ResolvedResponders {
  const specialistRoster = agentIds.filter((id) => id !== ZEUS_AGENT_ID);

  const mentioned = mentionedAgentIds(text, specialistRoster);
  const routed = routeTask(text).filter((id) => specialistRoster.includes(id));
  const specialists = [...new Set([...mentioned, ...routed])];

  // Unconditional: he closes every round he is rostered for, whether that is
  // synthesizing several specialists or being the only one who answers.
  return { specialists, zeus: agentIds.includes(ZEUS_AGENT_ID) };
}
