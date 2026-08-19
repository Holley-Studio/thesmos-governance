// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Regression coverage for the duplicate-response defect.
 *
 * Before the single-finalization protocol, `deltaDone` cleared the only handle
 * to the streamed node, so the `removeLive` that followed could not remove it
 * and the routed card rendered *beneath* the raw streamed text — two cards for
 * one response.
 *
 * These tests drive the real production decision path: `classifyAssistantText`
 * chooses the disposition exactly as `PantheonChatController` does, and
 * `StreamFinalizer` applies it. The surface is a fake log whose semantics
 * mirror the three DOM operations the real adapter performs (append, replace
 * in place, remove). It proves node accounting and the state machine; real
 * browser rendering is verified separately in the Extension Development Host.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StreamFinalizer, type StreamDisposition, type StreamSurface } from '../chat/streamProtocol.js';
import { classifyAssistantText, type RoutedGod, type RoutedItem } from '../chat/assistantRouting.js';

const ARGUS: RoutedGod = { emoji: '👁', name: 'Argus', color: '#c0392b' };
const resolveGod = (route: string): RoutedGod | undefined => (/argus/i.test(route) ? ARGUS : undefined);

type Card =
  | { kind: 'live'; node: FakeNode; text: string }
  | { kind: 'item'; item: RoutedItem };

/** Opaque node identity — the finalizer only ever holds and compares these. */
interface FakeNode {
  id: number;
}

/** A fake log with the same three operations the real DOM adapter performs. */
class FakeLog implements StreamSurface<FakeNode, RoutedItem> {
  readonly cards: Card[] = [];
  announcements = 0;
  lastAnnounced: StreamDisposition<RoutedItem> | undefined;
  private nextId = 1;

  createLiveNode(): FakeNode {
    const node = { id: this.nextId++ };
    this.cards.push({ kind: 'live', node, text: '' });
    return node;
  }

  renderLive(node: FakeNode, text: string): void {
    const card = this.find(node);
    if (!card) throw new Error(`renderLive on a node that is not in the log: ${node.id}`);
    card.text = text;
  }

  removeNode(node: FakeNode): void {
    const idx = this.cards.findIndex((c) => c.kind === 'live' && c.node === node);
    if (idx >= 0) this.cards.splice(idx, 1);
  }

  renderItemReplacing(item: RoutedItem, node: FakeNode): void {
    const idx = this.cards.findIndex((c) => c.kind === 'live' && c.node === node);
    // Mirrors append(): replace in place when the node is still mounted,
    // otherwise append — either way the item appears exactly once.
    if (idx >= 0) this.cards.splice(idx, 1, { kind: 'item', item });
    else this.cards.push({ kind: 'item', item });
  }

  appendItem(item: RoutedItem): void {
    this.cards.push({ kind: 'item', item });
  }

  announceSettled(disposition: StreamDisposition<RoutedItem>): void {
    this.announcements += 1;
    this.lastAnnounced = disposition;
  }

  /** Clear, as `reset`/`history` do to the real log. */
  clear(): void {
    this.cards.length = 0;
  }

  /** What the user actually sees, in order. */
  visibleText(): string[] {
    return this.cards.map((c) => (c.kind === 'live' ? c.text : c.item.text));
  }

  private find(node: FakeNode): Extract<Card, { kind: 'live' }> | undefined {
    return this.cards.find((c): c is Extract<Card, { kind: 'live' }> => c.kind === 'live' && c.node === node);
  }
}

/** The provider's decision, verbatim: keep when the stream already is the card. */
function dispositionFor(text: string): { item: RoutedItem; disposition: StreamDisposition<RoutedItem> } {
  const { item, streamedTextIsFinal } = classifyAssistantText(text, resolveGod);
  return { item, disposition: streamedTextIsFinal ? { kind: 'keep' } : { kind: 'replace', item } };
}

describe('single-finalization protocol', () => {
  let log: FakeLog;
  let streams: StreamFinalizer<FakeNode, RoutedItem>;
  /** History as the controller records it — one entry per settled response. */
  let history: RoutedItem[];

  beforeEach(() => {
    log = new FakeLog();
    streams = new StreamFinalizer<FakeNode, RoutedItem>(log);
    history = [];
  });

  /** Stream `text` in chunks, then settle it exactly as the controller does. */
  function streamTurn(streamId: string, text: string, chunkSize = 8): void {
    for (let i = 0; i < text.length; i += chunkSize) {
      streams.delta(streamId, text.slice(i, i + chunkSize));
    }
    streams.flush(); // the rAF frame
    const { item, disposition } = dispositionFor(text);
    history.push(item);
    streams.finalize(streamId, disposition);
  }

  describe('one response renders exactly one card', () => {
    it('Zeus direct-response routing', () => {
      streamTurn('s1', '⚡ ZEUS · direct response\nHere is the answer.');
      expect(log.cards).toHaveLength(1);
      expect(log.visibleText()).toEqual(['Here is the answer.']);
      expect(history).toHaveLength(1);
    });

    it('another god-routed response', () => {
      streamTurn('s1', '⚡ ZEUS · 👁 Argus — Security\nYour auth middleware is missing a check.');
      expect(log.cards).toHaveLength(1);
      const card = log.cards[0];
      expect(card.kind).toBe('item');
      expect(card.kind === 'item' && card.item.kind === 'assistant' && card.item.god).toEqual(ARGUS);
      // The streamed header is gone, not stacked above the routed card.
      expect(log.visibleText()).toEqual(['Your auth middleware is missing a check.']);
      expect(history).toHaveLength(1);
    });

    it('Zeus banner handling', () => {
      const banner = '⚡ ZEUS — COUNCIL ASSEMBLY\nMulti-domain task · dispatching:\n  👁 Argus → security';
      streamTurn('s1', banner);
      expect(log.cards).toHaveLength(1);
      expect(log.cards[0]).toEqual({ kind: 'item', item: { kind: 'zeus', text: banner } });
      expect(history).toHaveLength(1);
    });

    it('an ordinary streamed assistant response keeps the streamed node', () => {
      streamTurn('s1', 'Just a normal answer with no routing line.');
      expect(log.cards).toHaveLength(1);
      expect(log.cards[0].kind).toBe('live'); // kept, never re-rendered as a new card
      expect(log.visibleText()).toEqual(['Just a normal answer with no routing line.']);
      expect(history).toHaveLength(1);
    });

    it('renders once even when nothing streamed before the terminal', () => {
      // A webview that attached mid-turn, or a non-streaming provider.
      const { item, disposition } = dispositionFor('⚡ ZEUS · 👁 Argus — Security\nBody.');
      expect(streams.finalize('s1', disposition)).toBe('appended');
      expect(log.cards).toHaveLength(1);
      expect(log.cards[0]).toEqual({ kind: 'item', item });
    });
  });

  describe('terminal events are idempotent', () => {
    it('a duplicated terminal cannot render a second card', () => {
      const text = '⚡ ZEUS · 👁 Argus — Security\nBody.';
      streamTurn('s1', text);
      const { disposition } = dispositionFor(text);

      expect(streams.finalize('s1', disposition)).toBe('duplicate');
      expect(streams.finalize('s1', disposition)).toBe('duplicate');
      expect(log.cards).toHaveLength(1);
      expect(log.announcements).toBe(1);
    });

    it('a duplicated terminal with a different disposition is still ignored', () => {
      streamTurn('s1', 'Ordinary answer.');
      expect(streams.finalize('s1', { kind: 'discard' })).toBe('duplicate');
      // The first disposition stands — a late contradicting terminal cannot
      // delete a response the user has already been shown.
      expect(log.cards).toHaveLength(1);
      expect(log.visibleText()).toEqual(['Ordinary answer.']);
    });

    it('a duplicated terminal announces only once', () => {
      streamTurn('s1', 'Ordinary answer.');
      expect(log.announcements).toBe(1);
      streams.finalize('s1', { kind: 'keep' });
      streams.finalize('s1', { kind: 'keep' });
      expect(log.announcements).toBe(1);
    });
  });

  describe('out-of-order terminals', () => {
    it('deltas arriving after the terminal cannot resurrect the response', () => {
      streamTurn('s1', 'Ordinary answer.');
      expect(streams.delta('s1', ' …and more')).toBe(false);
      streams.flush();
      expect(log.cards).toHaveLength(1);
      expect(log.visibleText()).toEqual(['Ordinary answer.']);
    });

    it('a terminal that precedes its own deltas still yields one card', () => {
      const { item, disposition } = dispositionFor('⚡ ZEUS · 👁 Argus — Security\nBody.');
      expect(streams.finalize('s2', disposition)).toBe('appended');
      streams.delta('s2', 'late text');
      streams.flush();
      expect(log.cards).toHaveLength(1);
      expect(log.cards[0]).toEqual({ kind: 'item', item });
    });

    it('interleaved streams settle independently', () => {
      streams.delta('s1', 'first');
      streams.delta('s2', 'second');
      streams.flush();
      expect(log.cards).toHaveLength(2);
      streams.finalize('s2', { kind: 'keep' });
      streams.finalize('s1', { kind: 'keep' });
      expect(log.visibleText()).toEqual(['first', 'second']);
      expect(log.announcements).toBe(2);
    });

    it('replacement lands in the streamed node position, not at the end', () => {
      streams.delta('s1', 'routed turn');
      streams.flush();
      log.appendItem({ kind: 'assistant', text: 'a later card' });
      streams.finalize('s1', { kind: 'replace', item: { kind: 'zeus', text: 'banner' } });
      expect(log.visibleText()).toEqual(['banner', 'a later card']);
    });
  });

  describe('cancellation and error finalization', () => {
    it('cancellation keeps the partial text as the single card', () => {
      streams.delta('s1', 'Partial answer that stops');
      streams.flush();
      expect(streams.finalize('s1', { kind: 'keep' })).toBe('kept');
      expect(log.cards).toHaveLength(1);
      expect(log.visibleText()).toEqual(['Partial answer that stops']);
    });

    it('a keep terminal lands text that arrived after the last frame flush', () => {
      streams.delta('s1', 'first half ');
      streams.flush();
      streams.delta('s1', 'second half'); // no flush — the turn ended first
      streams.finalize('s1', { kind: 'keep' });
      expect(log.visibleText()).toEqual(['first half second half']);
    });

    it('a discard terminal removes the streamed node and adds nothing', () => {
      streams.delta('s1', 'text that should vanish');
      streams.flush();
      expect(streams.finalize('s1', { kind: 'discard' })).toBe('discarded');
      expect(log.cards).toHaveLength(0);
      expect(log.announcements).toBe(0); // nothing was shown, so nothing is announced
    });

    it('a keep terminal for a stream that never streamed does nothing', () => {
      expect(streams.finalize('s1', { kind: 'keep' })).toBe('noop');
      expect(log.cards).toHaveLength(0);
      expect(log.announcements).toBe(0);
    });

    it('a null streamId is a no-op terminal', () => {
      expect(streams.finalize(null, { kind: 'keep' })).toBe('noop');
      expect(log.cards).toHaveLength(0);
    });

    it('an error card after a settled stream does not disturb it', () => {
      streamTurn('s1', 'Ordinary answer.');
      log.appendItem({ kind: 'assistant', text: '⛔ session budget reached' });
      expect(log.cards).toHaveLength(2);
      expect(log.visibleText()).toEqual(['Ordinary answer.', '⛔ session budget reached']);
    });
  });

  describe('history restore and reload', () => {
    it('re-rendering history after a reset yields one card per response', () => {
      streamTurn('s1', '⚡ ZEUS · 👁 Argus — Security\nBody.');
      streamTurn('s2', 'Ordinary answer.');
      expect(log.cards).toHaveLength(2);
      expect(history).toHaveLength(2);

      // reset/history: the log is cleared and identity is dropped.
      log.clear();
      streams.reset();
      for (const item of history) log.appendItem(item);

      expect(log.cards).toHaveLength(2);
      expect(log.visibleText()).toEqual(['Body.', 'Ordinary answer.']);
    });

    it('a stream id reused after reset streams into a fresh node', () => {
      streamTurn('s1', 'Ordinary answer.');
      log.clear();
      streams.reset();
      expect(streams.delta('s1', 'a new session')).toBe(true);
      streams.flush();
      expect(log.cards).toHaveLength(1);
      expect(log.visibleText()).toEqual(['a new session']);
    });

    it('a terminal arriving after reset cannot re-add the old card', () => {
      streams.delta('s1', 'pre-reset text');
      streams.flush();
      log.clear();
      streams.reset();
      // Its node is gone; a stale replace appends once rather than throwing.
      streams.finalize('s1', { kind: 'replace', item: { kind: 'zeus', text: 'banner' } });
      expect(log.cards).toHaveLength(1);
    });
  });

  describe('accounting', () => {
    it('an empty delta never mounts a bubble', () => {
      streams.delta('s1', '');
      streams.flush();
      expect(log.cards).toHaveLength(0);
      expect(streams.openStreamIds()).toEqual(['s1']);
    });

    it('settling removes the stream from the open set and marks it settled', () => {
      streams.delta('s1', 'text');
      streams.flush();
      expect(streams.openStreamIds()).toEqual(['s1']);
      streams.finalize('s1', { kind: 'keep' });
      expect(streams.openStreamIds()).toEqual([]);
      expect(streams.isSettled('s1')).toBe(true);
    });

    it('ten routed turns produce exactly ten cards and ten history entries', () => {
      for (let i = 0; i < 10; i++) {
        streamTurn(`s${i}`, `⚡ ZEUS · 👁 Argus — Security\nFinding ${i}.`);
      }
      expect(log.cards).toHaveLength(10);
      expect(history).toHaveLength(10);
      expect(log.announcements).toBe(10);
    });
  });
});
