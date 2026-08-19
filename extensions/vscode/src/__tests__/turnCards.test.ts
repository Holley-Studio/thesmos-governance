// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Turn-level DOM idempotency — the layer above StreamFinalizer.
 *
 * These tests prove the fix for the *real* remaining duplicate: one turn that
 * emits more than one assistant stream must still render one card. Before this
 * tracker, StreamFinalizer settled each stream into its own node and left both
 * visible ("partial card, then the full response appended underneath").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TurnCardTracker, type TurnCardSurface } from '../chat/turnCards.js';

interface FakeNode { id: number }

/** Records removals so tests can assert which cards were detached. */
class FakeSurface implements TurnCardSurface<FakeNode> {
  readonly removed: FakeNode[] = [];
  removeNode(node: FakeNode): void {
    this.removed.push(node);
  }
}

describe('TurnCardTracker', () => {
  let surface: FakeSurface;
  let tracker: TurnCardTracker<FakeNode>;

  beforeEach(() => {
    surface = new FakeSurface();
    tracker = new TurnCardTracker<FakeNode>(surface);
  });

  describe('the core defect: two streams in one turn', () => {
    it('supersedes the earlier card when a second stream settles in the same turn', () => {
      const first = { id: 1 };
      const second = { id: 2 };
      expect(tracker.onSettled('t1', first)).toBe('recorded');
      // Second stream, same turn — the partial/earlier card must be removed.
      expect(tracker.onSettled('t1', second)).toBe('superseded');
      expect(surface.removed).toEqual([first]);
    });

    it('three streams in one turn leave exactly the last card standing', () => {
      const a = { id: 1 }, b = { id: 2 }, c = { id: 3 };
      tracker.onSettled('t1', a);
      tracker.onSettled('t1', b);
      tracker.onSettled('t1', c);
      // a and b were superseded; c stands.
      expect(surface.removed).toEqual([a, b]);
      expect(tracker.currentTurnId()).toBe('t1');
    });
  });

  describe('distinct turns keep distinct cards', () => {
    it('a settle for a new turn never removes the previous turn card', () => {
      const t1card = { id: 1 };
      const t2card = { id: 2 };
      expect(tracker.onSettled('t1', t1card)).toBe('recorded');
      expect(tracker.onSettled('t2', t2card)).toBe('recorded');
      expect(surface.removed).toEqual([]); // both are legitimate, distinct responses
    });

    it('ten sequential turns remove nothing', () => {
      for (let i = 1; i <= 10; i++) {
        expect(tracker.onSettled(`t${i}`, { id: i })).toBe('recorded');
      }
      expect(surface.removed).toEqual([]);
    });
  });

  describe('no-op settles', () => {
    it('ignores an undefined node (discard/noop/duplicate settle produced no card)', () => {
      expect(tracker.onSettled('t1', undefined)).toBe('ignored');
      expect(surface.removed).toEqual([]);
      expect(tracker.currentTurnId()).toBeNull();
    });

    it('ignores a null turn id (unattributable settle) — no dedup attempted', () => {
      expect(tracker.onSettled(null, { id: 1 })).toBe('ignored');
      expect(surface.removed).toEqual([]);
    });

    it('re-recording the identical node for the same turn removes nothing', () => {
      const node = { id: 1 };
      tracker.onSettled('t1', node);
      expect(tracker.onSettled('t1', node)).toBe('recorded');
      expect(surface.removed).toEqual([]);
    });
  });

  describe('reset', () => {
    it('drops tracked identity so a reused turn id starts fresh', () => {
      const a = { id: 1 };
      tracker.onSettled('t1', a);
      tracker.reset();
      expect(tracker.currentTurnId()).toBeNull();
      // After reset (log cleared), a settle for the same turn id must NOT try to
      // remove the old node — it no longer exists in the log.
      const b = { id: 2 };
      expect(tracker.onSettled('t1', b)).toBe('recorded');
      expect(surface.removed).toEqual([]);
    });
  });

  describe('exact reported reproduction shape', () => {
    it('partial header card then full body in the same turn → one card, header card removed', () => {
      // Stream 1: "⚡ ZEUS · direct response\n<partial>" settled (kept) as a card.
      const partialHeaderCard = { id: 100 };
      tracker.onSettled('turn-A', partialHeaderCard);
      // Stream 2: the authoritative full body settles under the same turn.
      const fullBodyCard = { id: 101 };
      const outcome = tracker.onSettled('turn-A', fullBodyCard);
      expect(outcome).toBe('superseded');
      // The duplicate partial header card is gone; only the full body remains.
      expect(surface.removed).toEqual([partialHeaderCard]);
    });
  });
});
