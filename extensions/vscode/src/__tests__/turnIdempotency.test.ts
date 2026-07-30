// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Regression coverage for turn-level idempotency — the defect where Pantheon Chat
 * displayed two assistant response cards for a single turn:
 *   1. The partial streamed node (left in the log when the old `deltaDone`/`removeLive` ran)
 *   2. A second card appended by the `assistantText` terminal event
 *
 * The fix introduces `turnAssistantHistoryIdx` + insert-or-update semantics in
 * `settleStream()` (chatViewProvider.ts): the first `assistantText` for a turn
 * pushes to history and records its index; every subsequent one updates history
 * in place rather than appending a second entry.
 *
 * Design contract (important for reading these tests):
 *   - The controller owns HISTORY. `turnAssistantHistoryIdx` guarantees exactly
 *     one history entry per turn regardless of how many `assistantText` events arrive.
 *   - The WEBVIEW DOM is managed by `StreamFinalizer` (tested in streamFinalization.test.ts).
 *   - These tests drive a minimal replica of the controller's state machine that
 *     operates without VS Code's module system. The replica models:
 *       a) the history array and its single-slot guarantee
 *       b) the broadcast sequence (item vs finalizeStream) per event
 *       c) the stream ID lifecycle across a turn
 *
 * Known edge case (out of scope for Phase 4): when a turn emits *multiple streams*
 * (s1 finalized, then s2 starts and is also finalized within the same logical turn),
 * the webview DOM may show multiple cards even though history correctly has one entry.
 * History idempotency is the fix; full DOM deduplication for that edge case is a
 * follow-up.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StreamFinalizer, type StreamDisposition, type StreamSurface } from '../chat/streamProtocol.js';
import { classifyAssistantText, type RoutedGod, type RoutedItem } from '../chat/assistantRouting.js';

// ── Shared test helpers ────────────────────────────────────────────────────────

const ARGUS: RoutedGod = { emoji: '👁', name: 'Argus', color: '#c0392b' };
const resolveGod = (route: string): RoutedGod | undefined => (/argus/i.test(route) ? ARGUS : undefined);

interface FakeNode { id: number }

type BroadcastMsg =
  | { type: 'item'; item: RoutedItem }
  | { type: 'finalizeStream'; streamId: string | null; disposition: StreamDisposition<RoutedItem> };

/**
 * Minimal replica of the turn-idempotency state machine in PantheonChatController.
 * Implements the production `settleStream`/`closeStream` logic extracted from
 * chatViewProvider.ts without requiring the VS Code module.
 *
 * The `log` models the webview DOM. The `history` models the controller's history[].
 * The `broadcasts` records the sequence of messages sent to the webview.
 */
class FakeTurnController implements StreamSurface<FakeNode, RoutedItem> {
  readonly history: RoutedItem[] = [];
  readonly log: Array<{ kind: 'live'; node: FakeNode; text: string } | { kind: 'item'; item: RoutedItem }> = [];
  readonly broadcasts: BroadcastMsg[] = [];

  // Stream-level state (mirrors chatViewProvider.ts: currentStreamId / streamSeq)
  private currentStreamId: string | undefined;
  private streamSeq = 0;
  private readonly streams: StreamFinalizer<FakeNode, RoutedItem>;

  // Turn-level idempotency state
  private turnAssistantHistoryIdx: number | undefined;

  private nodeSeq = 0;

  constructor() {
    this.streams = new StreamFinalizer<FakeNode, RoutedItem>(this);
  }

  // ── StreamSurface implementation (webview DOM proxy) ──────────────────────

  createLiveNode(): FakeNode {
    const node = { id: ++this.nodeSeq };
    this.log.push({ kind: 'live', node, text: '' });
    return node;
  }

  renderLive(node: FakeNode, text: string): void {
    const slot = this.log.find((c): c is Extract<typeof c, { kind: 'live' }> =>
      c.kind === 'live' && c.node === node);
    if (slot) slot.text = text;
  }

  removeNode(node: FakeNode): void {
    const idx = this.log.findIndex((c) => c.kind === 'live' && c.node === node);
    if (idx >= 0) this.log.splice(idx, 1);
  }

  renderItemReplacing(item: RoutedItem, node: FakeNode): void {
    const idx = this.log.findIndex((c) => c.kind === 'live' && c.node === node);
    if (idx >= 0) this.log.splice(idx, 1, { kind: 'item', item });
    else this.log.push({ kind: 'item', item });
  }

  appendItem(item: RoutedItem): void {
    this.log.push({ kind: 'item', item });
  }

  announceSettled(disposition: StreamDisposition<RoutedItem>): void {
    void disposition;
  }

  // ── Controller actions ─────────────────────────────────────────────────────

  /** Mint a new turn (mirrors dispatchPrompt). */
  beginTurn(): void {
    this.turnAssistantHistoryIdx = undefined;
    this.currentStreamId = undefined;
  }

  /**
   * Feed a text delta — reuses the current turn's stream ID or mints a new one.
   * In normal operation, a turn has ONE stream: the first delta mints it and all
   * subsequent deltas append to it.
   */
  delta(text: string): void {
    this.currentStreamId ??= `s${++this.streamSeq}`;
    this.streams.delta(this.currentStreamId, text);
    this.streams.flush();
  }

  /**
   * Mirrors `settleStream()` in chatViewProvider.ts.
   *
   * First `assistantText` for a turn: push to history, record `turnAssistantHistoryIdx`.
   * Subsequent ones: update history[idx] in place, broadcast `finalizeStream` with
   * the current stream ID (which is null if no new deltas arrived since last settlement).
   */
  receiveAssistantText(text: string): void {
    const { item, streamedTextIsFinal } = classifyAssistantText(text, resolveGod);
    const disposition: StreamDisposition<RoutedItem> = streamedTextIsFinal
      ? { kind: 'keep' }
      : { kind: 'replace', item };

    const streamId = this.currentStreamId;
    this.currentStreamId = undefined;

    if (this.turnAssistantHistoryIdx !== undefined) {
      this.history[this.turnAssistantHistoryIdx] = item;
      const msg: BroadcastMsg = { type: 'finalizeStream', streamId: streamId ?? null, disposition };
      this.broadcasts.push(msg);
      this.streams.finalize(streamId ?? null, disposition);
    } else {
      this.turnAssistantHistoryIdx = this.history.length;
      this.history.push(item);
      if (streamId === undefined && disposition.kind === 'keep') {
        const msg: BroadcastMsg = { type: 'item', item };
        this.broadcasts.push(msg);
        this.appendItem(item);
      } else {
        const msg: BroadcastMsg = { type: 'finalizeStream', streamId: streamId ?? null, disposition };
        this.broadcasts.push(msg);
        this.streams.finalize(streamId ?? null, disposition);
      }
    }
  }

  /**
   * Mirrors `turnDone` — clears turn identity so the next turn starts fresh.
   * Also closes any still-open stream (cancelled turn).
   */
  endTurn(): void {
    if (this.currentStreamId) {
      this.streams.finalize(this.currentStreamId, { kind: 'keep' });
      this.currentStreamId = undefined;
    }
    this.turnAssistantHistoryIdx = undefined;
  }

  /** Clear history and stream state — mirrors newSession(). */
  reset(): void {
    this.history.length = 0;
    this.log.length = 0;
    this.broadcasts.length = 0;
    this.streams.reset();
    this.turnAssistantHistoryIdx = undefined;
    this.currentStreamId = undefined;
    this.streamSeq = 0;
  }

  visibleText(): string[] {
    return this.log.map((c) => (c.kind === 'live' ? c.text : c.item.text));
  }

  cardCount(): number {
    return this.log.length;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('turn-level idempotency', () => {
  let ctrl: FakeTurnController;

  beforeEach(() => {
    ctrl = new FakeTurnController();
    ctrl.beginTurn();
  });

  describe('core fix: exact Zeus direct-response duplicate reproduction', () => {
    it('streaming then assistantText yields exactly one card', () => {
      // Before the fix (old deltaDone/removeLive protocol):
      //   • delta events streamed into live node s1
      //   • deltaDone cleared the reference to s1 (but left the node in the DOM)
      //   • assistantText appended a SECOND card below it → two visible responses
      //
      // Fix (finalizeStream protocol): one atomic operation replaces s1 in place.
      ctrl.delta('⚡ ZEUS · direct response\n');
      ctrl.delta('Here is the answer.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nHere is the answer.');
      ctrl.endTurn();

      expect(ctrl.cardCount()).toBe(1);
      expect(ctrl.history).toHaveLength(1);
      expect(ctrl.visibleText()).toEqual(['Here is the answer.']);
    });

    it('routed Argus response: one card, not two', () => {
      ctrl.delta('⚡ ZEUS · 👁 Argus — security\n');
      ctrl.delta('Your middleware is missing a check.');
      ctrl.receiveAssistantText('⚡ ZEUS · 👁 Argus — security\nYour middleware is missing a check.');
      ctrl.endTurn();

      expect(ctrl.cardCount()).toBe(1);
      expect(ctrl.history).toHaveLength(1);
      expect(ctrl.history[0].kind).toBe('assistant');
    });

    it('plain (unrouted) response keeps the live node, no new card appended', () => {
      ctrl.delta('This is a direct answer with no routing header.');
      ctrl.receiveAssistantText('This is a direct answer with no routing header.');
      ctrl.endTurn();

      expect(ctrl.cardCount()).toBe(1);
      // The single card is the live node kept in place (not a new item card).
      expect(ctrl.log[0].kind).toBe('live');
      expect(ctrl.history).toHaveLength(1);
    });

    it('Zeus council banner renders as zeus-kind item, not assistant', () => {
      const banner = '⚡ ZEUS — COUNCIL ASSEMBLY\nMulti-domain task · dispatching:\n  👁 Argus → security';
      ctrl.delta(banner);
      ctrl.receiveAssistantText(banner);
      ctrl.endTurn();

      expect(ctrl.cardCount()).toBe(1);
      expect(ctrl.history).toHaveLength(1);
      expect(ctrl.history[0].kind).toBe('zeus');
    });
  });

  describe('history idempotency: multiple assistantText events per turn', () => {
    it('two assistantText events update history in place — one entry, second text wins', () => {
      // The single-stream case: s1 is finalized on first assistantText, then a
      // second assistantText arrives (no new deltas, so streamId is null).
      ctrl.delta('⚡ ZEUS · direct response\nDraft answer.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nDraft answer.');
      // Second terminal — no new stream since currentStreamId was cleared.
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nFinal corrected answer.');
      ctrl.endTurn();

      // History has exactly one entry — the corrected text.
      expect(ctrl.history).toHaveLength(1);
      expect(ctrl.history[0].text).toBe('Final corrected answer.');
      // DOM has one card (from first settlement; second null-stream update is a no-op).
      expect(ctrl.cardCount()).toBe(1);
    });

    it('five assistantText events still leave one history entry', () => {
      ctrl.delta('v1');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nv1');
      for (let i = 2; i <= 5; i++) {
        ctrl.receiveAssistantText(`⚡ ZEUS · direct response\nv${i}`);
      }
      ctrl.endTurn();

      expect(ctrl.history).toHaveLength(1);
      expect(ctrl.history[0].text).toBe('v5');
    });
  });

  describe('turnDone ordering', () => {
    it('a turn stopped before any text emits no card and no history entry', () => {
      ctrl.endTurn();
      expect(ctrl.cardCount()).toBe(0);
      expect(ctrl.history).toHaveLength(0);
    });

    it('a turn stopped mid-stream keeps the partial text; it is NOT in history', () => {
      // endTurn() with no assistantText = cancellation.
      // The partial streamed text stays visible but is not committed to history.
      ctrl.delta('Partial answer that');
      ctrl.endTurn();

      expect(ctrl.cardCount()).toBe(1);
      expect(ctrl.visibleText()).toEqual(['Partial answer that']);
      expect(ctrl.history).toHaveLength(0);
    });

    it('endTurn resets idempotency — the next turn starts a fresh history slot', () => {
      ctrl.delta('Turn 1 answer.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nTurn 1 answer.');
      ctrl.endTurn();

      ctrl.beginTurn();
      ctrl.delta('Turn 2 answer.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nTurn 2 answer.');
      ctrl.endTurn();

      expect(ctrl.cardCount()).toBe(2);
      expect(ctrl.history).toHaveLength(2);
      expect(ctrl.history[0].text).toBe('Turn 1 answer.');
      expect(ctrl.history[1].text).toBe('Turn 2 answer.');
    });

    it('ten consecutive turns produce ten history entries and ten DOM cards', () => {
      for (let i = 1; i <= 10; i++) {
        ctrl.beginTurn();
        ctrl.delta(`Answer ${i}.`);
        ctrl.receiveAssistantText(`⚡ ZEUS · direct response\nAnswer ${i}.`);
        ctrl.endTurn();
      }
      expect(ctrl.history).toHaveLength(10);
      expect(ctrl.cardCount()).toBe(10);
    });
  });

  describe('webview reload / history restoration', () => {
    it('history replay after reset produces one card per completed turn', () => {
      ctrl.delta('Turn 1.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nTurn 1.');
      ctrl.endTurn();
      ctrl.beginTurn();
      ctrl.delta('Turn 2.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nTurn 2.');
      ctrl.endTurn();

      const snapshot = [...ctrl.history];
      ctrl.reset();

      // Replay (mirrors what chatViewProvider does on 'ready' → 'history' broadcast)
      for (const item of snapshot) ctrl.appendItem(item);

      expect(ctrl.cardCount()).toBe(2);
      expect(ctrl.visibleText()).toEqual(['Turn 1.', 'Turn 2.']);
    });

    it('newSession clears idempotency and accepts fresh turns', () => {
      ctrl.delta('Pre-session turn.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nPre-session turn.');
      ctrl.endTurn();
      ctrl.reset(); // newSession()
      ctrl.beginTurn();
      ctrl.delta('Fresh turn.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nFresh turn.');
      ctrl.endTurn();

      expect(ctrl.cardCount()).toBe(1);
      expect(ctrl.history).toHaveLength(1);
      expect(ctrl.history[0].text).toBe('Fresh turn.');
    });
  });

  describe('no-stream path', () => {
    it('plain (unrouted) assistantText without deltas appends once via item broadcast', () => {
      // No deltas, disposition=keep: controller broadcasts {type:'item'}, item IS rendered.
      ctrl.receiveAssistantText('A plain, unrouted answer without a stream.');
      ctrl.endTurn();

      expect(ctrl.cardCount()).toBe(1);
      expect(ctrl.history).toHaveLength(1);
      // It was added via appendItem, so card kind is 'item' (not a live node).
      expect(ctrl.log[0].kind).toBe('item');
    });

    it('two plain no-stream assistantTexts: history has one entry, first card stays visible', () => {
      // First: appends item via item broadcast.
      // Second: turnAssistantHistoryIdx=0, no stream → null streamId → finalizeStream(null) → no-op.
      ctrl.receiveAssistantText('Plain first answer.');
      ctrl.receiveAssistantText('Plain updated answer.');
      ctrl.endTurn();

      expect(ctrl.history).toHaveLength(1);
      expect(ctrl.history[0].text).toBe('Plain updated answer.'); // history updated in place
      // DOM card count: 1 (only the first plain answer was rendered; second null-stream no-ops)
      expect(ctrl.cardCount()).toBe(1);
    });
  });

  describe('broadcast sequence', () => {
    it('streaming routed response emits exactly one finalizeStream broadcast', () => {
      ctrl.delta('⚡ ZEUS · direct response\nAnswer.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nAnswer.');

      expect(ctrl.broadcasts).toHaveLength(1);
      expect(ctrl.broadcasts[0].type).toBe('finalizeStream');
    });

    it('plain no-stream response emits exactly one item broadcast', () => {
      ctrl.receiveAssistantText('A plain answer.');

      expect(ctrl.broadcasts).toHaveLength(1);
      expect(ctrl.broadcasts[0].type).toBe('item');
    });

    it('second assistantText for same turn emits a second finalizeStream, never item', () => {
      ctrl.delta('⚡ ZEUS · direct response\nDraft.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nDraft.');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nFinal.');

      const types = ctrl.broadcasts.map((m) => m.type);
      expect(types).toEqual(['finalizeStream', 'finalizeStream']);
    });

    it('two separate turns each emit exactly one finalizeStream', () => {
      ctrl.delta('T1');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nT1');
      ctrl.endTurn();
      ctrl.beginTurn();
      ctrl.delta('T2');
      ctrl.receiveAssistantText('⚡ ZEUS · direct response\nT2');
      ctrl.endTurn();

      expect(ctrl.broadcasts).toHaveLength(2);
      expect(ctrl.broadcasts.every((m) => m.type === 'finalizeStream')).toBe(true);
    });
  });
});
