// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The channel orchestrator — runs one round of agent turns after a user
 * message.
 *
 * `postMessage` appends the user's message and returns immediately; the
 * round itself runs asynchronously afterward. A round can mean several
 * sequential Claude CLI turns, and blocking one IPC call for that long
 * doesn't fit the desktop's request/response transport
 * (apps/desktop/src-tauri/src/runtime.rs) — instead each agent's finished
 * reply lands in the message log as soon as it's ready, and the desktop UI
 * polls for it (see apps/desktop/sidecar/channel.ts).
 *
 * Specialists respond sequentially, not in parallel: each one sees the prior
 * replies already posted in this round, which is what makes it read as a
 * discussion instead of parallel monologues. Zeus, when he's part of the
 * round, always goes last.
 */

import type { ModelProvider, RuntimeEvent } from '../runtime/types.js';
import { loadAgentSource } from '../bin/commands/pantheon.js';
import { appendMessage, ensureChannelDefinition, readMessages } from './store.js';
import { resolveResponders, ZEUS_AGENT_ID } from './responders.js';
import { RoundBudget, DEFAULT_ROUND_CEILING } from './round-budget.js';
import type { ChannelDefinition, ChannelMessage } from './types.js';

/** How many prior messages are folded into an agent's prompt as context. */
const TRANSCRIPT_WINDOW = 30;

/** A hung turn (no `turnDone`/`exit` ever arrives) must not stall the round forever. */
const DEFAULT_TURN_TIMEOUT_MS = 5 * 60 * 1000;

export interface ChannelOrchestratorContext {
  root: string;
  provider: ModelProvider;
  /** Injectable for tests — defaults to DEFAULT_ROUND_CEILING. */
  roundCeiling?: number;
  /** Injectable for tests — defaults to DEFAULT_TURN_TIMEOUT_MS. */
  turnTimeoutMs?: number;
}

export const DEV_TEAM_CHANNEL: ChannelDefinition = {
  id: 'dev-team',
  name: '#dev-team',
  agentIds: [
    'chiron-architecture-agent',
    'cassandra-qa-agent',
    'asclepius-debugging-agent',
    'atlas-integration-agent',
    'kratos-devops-agent',
    'kronos-github-agent',
    'eos-automation-agent',
    ZEUS_AGENT_ID,
  ],
};

export interface PostMessageResult {
  message: ChannelMessage;
  /**
   * Who's expected to respond, in turn order — resolved up front so the UI
   * can show an accurate "chiron is thinking…" indicator rather than
   * guessing the whole roster. Empty when nothing routed and no one was
   * mentioned.
   */
  respondingAgentIds: string[];
}

/**
 * Post a user message and kick off the round. Returns as soon as the
 * message is recorded — the caller (the sidecar's `channel.postMessage`
 * handler) does not await round completion.
 */
export function postMessage(channelId: string, text: string, ctx: ChannelOrchestratorContext): PostMessageResult {
  const definition = ensureChannelDefinition(ctx.root, DEV_TEAM_CHANNEL);
  const userMessage = appendMessage(ctx.root, channelId, {
    authorId: 'user',
    authorType: 'user',
    text,
    round: nextRound(ctx.root, channelId),
  });

  const { specialists, zeus } = resolveResponders(userMessage.text, definition.agentIds);
  const respondingAgentIds = zeus ? [...specialists, ZEUS_AGENT_ID] : specialists;

  // Fire-and-forget: a failure here must become a channel message, not an
  // unhandled rejection that could take down a long-lived sidecar process.
  void runRound(definition, userMessage, ctx).catch((err) => {
    appendMessage(ctx.root, channelId, {
      authorId: ZEUS_AGENT_ID,
      authorType: 'agent',
      text: `A round failed to complete: ${err instanceof Error ? err.message : String(err)}`,
      round: userMessage.round,
    });
  });

  return { message: userMessage, respondingAgentIds };
}

function nextRound(root: string, channelId: string): number {
  const last = readMessages(root, channelId).at(-1);
  return last ? last.round + 1 : 1;
}

/** Run one full round of agent turns for `userMessage`. Exported so tests can await it directly. */
export async function runRound(
  definition: ChannelDefinition,
  userMessage: ChannelMessage,
  ctx: ChannelOrchestratorContext,
): Promise<void> {
  const { specialists, zeus } = resolveResponders(userMessage.text, definition.agentIds);
  const budget = new RoundBudget(ctx.roundCeiling ?? DEFAULT_ROUND_CEILING);

  for (const agentId of specialists) {
    if (!budget.charge()) return;
    await runAgentTurn(definition.id, agentId, userMessage.round, ctx);
  }

  if (zeus) {
    if (!budget.charge()) return;
    await runAgentTurn(definition.id, ZEUS_AGENT_ID, userMessage.round, ctx);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAgentTurn(
  channelId: string,
  agentId: string,
  round: number,
  ctx: ChannelOrchestratorContext,
): Promise<void> {
  const source = loadAgentSource(agentId);
  if (!source) {
    appendMessage(ctx.root, channelId, {
      authorId: agentId,
      authorType: 'agent',
      text: `(${agentId} could not be loaded from the catalog — skipped this round.)`,
      round,
    });
    return;
  }

  const transcript = formatTranscript(readMessages(ctx.root, channelId).slice(-TRANSCRIPT_WINDOW));
  const prompt = buildGroupPrompt(source.content, transcript);

  // Two independent renderings of the same reply, and they must never be
  // concatenated. A streaming provider emits `textDelta` chunks; the Claude
  // CLI emits those *and* a complete `assistantText` block for the same
  // content, so summing both yields every reply twice over (caught against
  // the real CLI: "ACK" came back as "ACKACK"). Prefer the complete block,
  // fall back to the deltas for a provider that only streams (Ollama).
  let deltaText = '';
  let blockText = '';
  let sawError = false;
  const { promise: turnDone, resolve: resolveTurnDone } = deferred();

  const session = ctx.provider.createSession({
    workspaceRoot: ctx.root,
    onEvent: (event: RuntimeEvent) => {
      if (event.kind === 'textDelta') {
        deltaText += event.text;
      } else if (event.kind === 'assistantText') {
        blockText += event.text;
      } else if (event.kind === 'turnDone') {
        sawError = event.isError;
        resolveTurnDone();
      } else if (event.kind === 'exit' && event.code !== 0) {
        // The subprocess died without ever emitting turnDone (e.g. launch
        // failure) — resolve anyway so the round doesn't hang on it.
        sawError = true;
        resolveTurnDone();
      }
    },
  });

  try {
    // AgentSession.send() is `void | Promise<void>` — for a `cli` provider it
    // resolves as soon as stdin is written, long before the reply is ready.
    // The real completion signal is the `turnDone` event above, so both are
    // awaited: the send() call itself (in case a provider's send genuinely is
    // the full turn, like Ollama's), and the event, guarded by a timeout so a
    // provider that never emits either can't stall the round forever.
    await session.send(prompt);
    await Promise.race([turnDone, delay(ctx.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS)]);
  } finally {
    session.dispose();
  }

  const reply = (blockText || deltaText).trim();
  const fallback = sawError
    ? `(${agentId} hit an error and had nothing to say.)`
    : `(${agentId} had nothing to say.)`;
  appendMessage(ctx.root, channelId, {
    authorId: agentId,
    authorType: 'agent',
    text: reply || fallback,
    round,
  });
}

function formatTranscript(messages: ChannelMessage[]): string {
  return messages.map((m) => `[${m.authorId}]: ${m.text}`).join('\n');
}

function buildGroupPrompt(personaSource: string, transcript: string): string {
  return [
    'You are one participant in a shared team channel, not a solo report writer.',
    "Below is your persona/role definition, followed by the channel's transcript so far.",
    'Address the user directly, and you may refer to other participants by name — this is a',
    'discussion, not a formal handoff document. Keep your reply conversational and to the point.',
    '',
    '--- Your persona ---',
    personaSource,
    '',
    '--- Channel transcript ---',
    transcript,
  ].join('\n');
}
