// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Orchestrator tests run against a fake `ModelProvider` — no real `claude`
 * CLI or network call involved — but against the *real* Pantheon catalog on
 * disk (`loadAgentSource` reads real `.md` files, same as production). That
 * makes this closer to an integration test than a pure unit test for the
 * catalog-loading edge, which is the deliberate trade-off flagged in the
 * implementation plan: there is no fixture catalog, and the real one is
 * always present in this repo.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSession, ModelProvider, RuntimeEvent, SessionOptions } from '../runtime/types.js';
import { postMessage, runRound, DEV_TEAM_CHANNEL, type ChannelOrchestratorContext } from './orchestrator.js';
import { readMessages, readMessagesSince } from './store.js';
import { resolveResponders, ZEUS_AGENT_ID } from './responders.js';

type ScriptedTurn =
  | { text: string; isError?: boolean }
  /** Emits streaming deltas *and* a complete block, the way the real Claude CLI does. */
  | { deltas: string[]; block: string }
  | 'hang'
  | 'exitWithoutTurnDone';

function scriptedProvider(script: ScriptedTurn[]): { provider: ModelProvider; disposedCount: number[] } {
  let index = 0;
  const disposedCount = [0];
  const provider: ModelProvider = {
    id: 'fake',
    label: 'Fake',
    kind: 'cli',
    async health() {
      return { available: true, endpoint: 'fake', locality: 'local' as const };
    },
    async listModels() {
      return [];
    },
    createSession(options: SessionOptions): AgentSession {
      const turn = script[index++];
      return {
        id: undefined,
        running: false,
        start() {},
        async send(_text: string) {
          if (turn === 'hang') return;
          if (turn === 'exitWithoutTurnDone') {
            options.onEvent({ kind: 'exit', code: 1 } satisfies RuntimeEvent);
            return;
          }
          if ('deltas' in turn) {
            for (const d of turn.deltas) options.onEvent({ kind: 'textDelta', text: d });
            options.onEvent({ kind: 'assistantText', text: turn.block });
            options.onEvent({ kind: 'turnDone', isError: false } satisfies RuntimeEvent);
            return;
          }
          options.onEvent({ kind: 'textDelta', text: turn.text });
          options.onEvent({ kind: 'turnDone', isError: turn.isError ?? false } satisfies RuntimeEvent);
        },
        stop() {},
        dispose() {
          disposedCount[0]! += 1;
        },
      };
    },
  };
  return { provider, disposedCount };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-orchestrator-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function ctxWith(provider: ModelProvider, overrides: Partial<ChannelOrchestratorContext> = {}): ChannelOrchestratorContext {
  return { root, provider, turnTimeoutMs: 50, ...overrides };
}

describe('runRound — happy path', () => {
  it('runs the matched specialist and closes with Zeus, in order', async () => {
    const { provider } = scriptedProvider([
      { text: 'Looks solid from a QA angle.' },
      { text: 'Agreed — ship it.' },
    ]);
    const ctx = ctxWith(provider);

    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: 'write an e2e test plan for checkout', round: 1 };
    await runRound(DEV_TEAM_CHANNEL, userMessage, ctx);

    const messages = readMessages(root, DEV_TEAM_CHANNEL.id);
    expect(messages.map((m) => m.authorId)).toEqual(['cassandra-qa-agent', ZEUS_AGENT_ID]);
    expect(messages[0]!.text).toBe('Looks solid from a QA angle.');
    expect(messages[1]!.text).toBe('Agreed — ship it.');
    expect(messages.every((m) => m.round === 1)).toBe(true);
  });

  /**
   * Regression, caught against the real Claude CLI: it emits streaming
   * `textDelta` chunks *and* a complete `assistantText` block carrying the
   * same content. Summing both posted every reply twice ("ACK" → "ACKACK").
   */
  it('does not double a reply when a provider emits both deltas and a complete block', async () => {
    const { provider } = scriptedProvider([
      { deltas: ['Looks ', 'good.'], block: 'Looks good.' },
      { deltas: ['Ship ', 'it.'], block: 'Ship it.' },
    ]);
    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: 'write an e2e test plan for checkout', round: 1 };

    await runRound(DEV_TEAM_CHANNEL, userMessage, ctxWith(provider));

    const messages = readMessages(root, DEV_TEAM_CHANNEL.id);
    expect(messages[0]!.text).toBe('Looks good.');
    expect(messages[1]!.text).toBe('Ship it.');
  });

  it('falls back to accumulated deltas for a provider that only streams', async () => {
    // Ollama never emits assistantText — its reply must still survive.
    const { provider } = scriptedProvider([{ text: 'streamed only' }, { text: 'zeus' }]);
    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: 'need an architecture decision on this', round: 1 };

    await runRound(DEV_TEAM_CHANNEL, userMessage, ctxWith(provider));

    expect(readMessages(root, DEV_TEAM_CHANNEL.id)[0]!.text).toBe('streamed only');
  });

  it('still answers via Zeus alone when nothing routes and no one is mentioned', async () => {
    const { provider } = scriptedProvider([{ text: 'Nothing for the team here — what do you need?' }]);
    const ctx = ctxWith(provider);
    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: 'good morning team', round: 1 };

    await runRound(DEV_TEAM_CHANNEL, userMessage, ctx);

    const messages = readMessages(root, DEV_TEAM_CHANNEL.id);
    expect(messages.map((m) => m.authorId)).toEqual([ZEUS_AGENT_ID]);
  });

  it('feeds each specialist the transcript so far, including earlier replies in the same round', async () => {
    const seenPrompts: string[] = [];
    const provider: ModelProvider = {
      id: 'fake',
      label: 'Fake',
      kind: 'cli',
      async health() {
        return { available: true, endpoint: 'fake', locality: 'local' as const };
      },
      async listModels() {
        return [];
      },
      createSession(options: SessionOptions): AgentSession {
        return {
          id: undefined,
          running: false,
          start() {},
          async send(text: string) {
            seenPrompts.push(text);
            options.onEvent({ kind: 'textDelta', text: 'reply' });
            options.onEvent({ kind: 'turnDone', isError: false });
          },
          stop() {},
          dispose() {},
        };
      },
    };
    // "ci/cd" matches devops (kratos, eos) before "e2e test" matches cassandra —
    // table order in thesmos/pantheon/router.ts — so three specialists run in
    // that order, each after the last.
    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: 'e2e test plan for the ci/cd pipeline', round: 1 };
    await runRound(DEV_TEAM_CHANNEL, userMessage, ctxWith(provider));

    const { specialists } = resolveResponders(userMessage.text, DEV_TEAM_CHANNEL.agentIds);
    expect(specialists.length).toBeGreaterThan(1);
    // The last specialist's prompt must contain the first specialist's posted reply.
    expect(seenPrompts.at(-1)).toContain(`[${specialists[0]}]: reply`);
  });
});

describe('runRound — round budget', () => {
  it('stops once the round budget is exhausted, never reaching Zeus', async () => {
    const { provider } = scriptedProvider([{ text: 'first specialist only' }]);
    const ctx = ctxWith(provider, { roundCeiling: 1 });
    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: 'e2e test plan for the ci/cd pipeline', round: 1 };

    await runRound(DEV_TEAM_CHANNEL, userMessage, ctx);

    const messages = readMessages(root, DEV_TEAM_CHANNEL.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.authorId).not.toBe(ZEUS_AGENT_ID);
  });
});

describe('runRound — resilience', () => {
  it('records a placeholder and continues when an agent cannot be loaded from the catalog', async () => {
    const { provider } = scriptedProvider([{ text: 'zeus synthesis' }]);
    const brokenRoster = { id: 'dev-team', name: '#dev-team', agentIds: ['totally-fake-agent-xyz', ZEUS_AGENT_ID] };
    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: '@totally-fake-agent-xyz help, and @zeus too', round: 1 };

    await runRound(brokenRoster, userMessage, ctxWith(provider));

    const messages = readMessages(root, 'dev-team');
    expect(messages[0]!.text).toMatch(/could not be loaded/i);
    expect(messages[1]!.authorId).toBe(ZEUS_AGENT_ID);
  });

  it('resolves and disposes the session instead of hanging when a turn never completes', async () => {
    // "architecture decision" routes to chiron alone, and Zeus always closes a
    // round with a specialist reply — two turns, so the script needs both.
    const { provider, disposedCount } = scriptedProvider(['hang', { text: 'zeus synthesis' }]);
    const ctx = ctxWith(provider, { turnTimeoutMs: 20 });
    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: 'need an architecture decision on this', round: 1 };

    await runRound(DEV_TEAM_CHANNEL, userMessage, ctx);

    const messages = readMessages(root, DEV_TEAM_CHANNEL.id);
    expect(messages.map((m) => m.authorId)).toEqual(['chiron-architecture-agent', ZEUS_AGENT_ID]);
    expect(messages[0]!.text).toMatch(/had nothing to say/i);
    expect(messages[1]!.text).toBe('zeus synthesis');
    expect(disposedCount[0]).toBeGreaterThan(0);
  });

  it('falls back to an error placeholder when the subprocess exits without a turnDone', async () => {
    const { provider } = scriptedProvider(['exitWithoutTurnDone', { text: 'zeus synthesis' }]);
    const userMessage = { id: 'u1', seq: 0, ts: new Date().toISOString(), authorId: 'user', authorType: 'user' as const, text: 'need an architecture decision on this', round: 1 };

    await runRound(DEV_TEAM_CHANNEL, userMessage, ctxWith(provider));

    const messages = readMessages(root, DEV_TEAM_CHANNEL.id);
    expect(messages[0]!.text).toMatch(/hit an error/i);
  });
});

describe('postMessage', () => {
  it('appends the user message synchronously, reports the expected responders, and lets the round run after returning', async () => {
    const { provider } = scriptedProvider([{ text: 'synthesis' }]);
    const posted = postMessage(DEV_TEAM_CHANNEL.id, '@zeus what should we prioritize?', ctxWith(provider));

    expect(posted.message.authorId).toBe('user');
    expect(posted.respondingAgentIds).toEqual([ZEUS_AGENT_ID]);
    expect(readMessages(root, DEV_TEAM_CHANNEL.id).map((m) => m.id)).toEqual([posted.message.id]);

    // Let the fire-and-forget round complete.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const messages = readMessages(root, DEV_TEAM_CHANNEL.id);
    expect(messages.map((m) => m.authorId)).toEqual(['user', ZEUS_AGENT_ID]);
  });

  it('reports Zeus as the responder when nothing routes, so the UI never shows an unanswered post', () => {
    const { provider } = scriptedProvider([{ text: 'ack' }]);
    const posted = postMessage(DEV_TEAM_CHANNEL.id, 'good morning team', ctxWith(provider));
    expect(posted.respondingAgentIds).toEqual([ZEUS_AGENT_ID]);
  });
});

/**
 * The seam the desktop actually runs through, which every other test skips by
 * awaiting `runRound` directly: `postMessage` returns *before* the round
 * exists, and the UI then discovers replies by re-polling `readMessagesSince`
 * with an advancing cursor. The fire-and-forget handoff and the cursor have to
 * be correct *together* — a cursor that is off by one either replays a message
 * the user already sees or drops one entirely, and neither shows up when the
 * round is awaited synchronously.
 */
describe('post-then-poll, the way the desktop drives it', () => {
  it('delivers every message exactly once across polls, in order, Zeus last', async () => {
    const { provider } = scriptedProvider([
      { deltas: ['QA ', 'view.'], block: 'QA view.' },
      { deltas: ['Ship ', 'it.'], block: 'Ship it.' },
    ]);
    const ctx = ctxWith(provider);

    const { message, respondingAgentIds } = postMessage(
      DEV_TEAM_CHANNEL.id,
      'write an e2e test plan for checkout',
      ctx,
    );

    // The round must not have run yet — that is the whole point of the handoff.
    expect(readMessages(root, DEV_TEAM_CHANNEL.id)).toHaveLength(1);
    expect(respondingAgentIds).toEqual(['cassandra-qa-agent', ZEUS_AGENT_ID]);

    // Drain exactly as the UI does: seed the cursor from the posted message,
    // then advance it by the last seq each poll returns.
    const drained: string[] = [];
    let cursor = message.seq;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const batch = readMessagesSince(root, DEV_TEAM_CHANNEL.id, cursor);
      if (batch.length > 0) {
        cursor = batch[batch.length - 1]!.seq;
        drained.push(...batch.map((m) => m.authorId));
      }
      if (respondingAgentIds.every((id) => drained.includes(id))) break;
      await new Promise((r) => setTimeout(r, 5));
    }

    // Exactly once each, in turn order, with Zeus closing.
    expect(drained).toEqual(['cassandra-qa-agent', ZEUS_AGENT_ID]);

    // And the polled stream plus the posted message reconstructs the log with
    // nothing duplicated and nothing missed.
    const log = readMessages(root, DEV_TEAM_CHANNEL.id);
    expect([message.authorId, ...drained]).toEqual(log.map((m) => m.authorId));
    expect(log.map((m) => m.seq)).toEqual([0, 1, 2]);
    expect(log[1]!.text).toBe('QA view.');
  });

  it('returns nothing further once the round is drained, so polling stays idle', async () => {
    const { provider } = scriptedProvider([{ text: 'only zeus' }]);
    const ctx = ctxWith(provider);
    const { message } = postMessage(DEV_TEAM_CHANNEL.id, 'good morning team', ctx);

    await new Promise((r) => setTimeout(r, 100));

    const first = readMessagesSince(root, DEV_TEAM_CHANNEL.id, message.seq);
    expect(first.map((m) => m.authorId)).toEqual([ZEUS_AGENT_ID]);

    const cursor = first[first.length - 1]!.seq;
    expect(readMessagesSince(root, DEV_TEAM_CHANNEL.id, cursor)).toEqual([]);
  });
});
