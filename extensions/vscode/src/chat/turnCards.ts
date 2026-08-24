// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Turn-level card identity — the layer *above* `StreamFinalizer`.
 *
 * ## Why this exists
 *
 * `StreamFinalizer` guarantees **one card per stream**. That is not the same as
 * **one card per turn**. A single logical turn (one user dispatch → one
 * `turnDone`) can emit more than one assistant text stream:
 *
 *   - a message with multiple `text` content blocks (`[text, tool_use, text]`)
 *     fires one `assistantText` per block;
 *   - an interleaved tool/god card closes the open stream (`closeStream`) so the
 *     remaining text streams under a *fresh* stream id;
 *   - a provider retry re-streams the answer.
 *
 * Each of those mints a new `streamId`, and each stream settles into its own DOM
 * node. The finalizer, doing its job perfectly, then leaves two settled cards
 * for one turn — which is exactly the "partial card, then the full response
 * appended underneath" duplicate.
 *
 * ## The contract
 *
 * The controller stamps every terminal (`finalizeStream`) and streamed node with
 * the `turnId` minted when the prompt was dispatched. This tracker keeps at most
 * one visible response card per turn: when a *second* stream settles under a
 * turn that already has a card, the earlier (now superseded) card is removed and
 * the later, authoritative one stands. History idempotency (the controller's
 * `turnAssistantHistoryIdx`) and this DOM idempotency together enforce the
 * governing invariant:
 *
 * > One user dispatch → one logical turn → one persisted final response → one
 * > visible response card.
 *
 * The module is DOM-free: the removal surface is injected, so the decision logic
 * is unit-tested without a browser (see `turnCards.test.ts`). Real-DOM wiring is
 * in `webview/chat.ts`.
 */

/** The one operation the tracker needs from the rendering layer. */
export interface TurnCardSurface<TNode> {
  /** Detach a superseded response card from the log. */
  removeNode(node: TNode): void;
}

/** What `onSettled` decided — returned for tests and diagnostics. */
export type TurnCardOutcome =
  /** First card for this turn — recorded, nothing removed. */
  | 'recorded'
  /** A later stream superseded the turn's earlier card — earlier removed. */
  | 'superseded'
  /** Nothing to track (no node, or no turn id). */
  | 'ignored';

/**
 * Tracks the single visible response card for the turn currently rendering.
 *
 * Turns are sequential (one dispatch runs at a time), so exactly one turn is
 * "current" — the tracker holds that turn's id and its card node. A settle for a
 * new turn id simply adopts the new turn; it never removes a prior turn's card,
 * because that card is a legitimate, distinct response.
 */
export class TurnCardTracker<TNode> {
  private turnId: string | null = null;
  private node: TNode | undefined;

  constructor(private readonly surface: TurnCardSurface<TNode>) {}

  /**
   * Record the node a stream just settled into, for a given turn.
   *
   * @param turnId The turn the settled stream belongs to, or null when the
   *   controller could not attribute it (no dedup is attempted in that case).
   * @param node The DOM node the finalizer mounted, or undefined when the
   *   settle produced no card (`discard`, `noop`, `duplicate`).
   */
  onSettled(turnId: string | null, node: TNode | undefined): TurnCardOutcome {
    if (node === undefined || turnId === null) return 'ignored';

    if (this.turnId === turnId && this.node !== undefined && this.node !== node) {
      // A second stream settled under a turn that already has a card. The later
      // settle is authoritative (it carries the complete/updated response); the
      // earlier partial or superseded card is removed so the turn shows once.
      this.surface.removeNode(this.node);
      this.node = node;
      return 'superseded';
    }

    // First card for this turn (or a re-settle of the very same node).
    this.turnId = turnId;
    this.node = node;
    return 'recorded';
  }

  /** Forget the tracked card — called when the log is cleared (reset/history). */
  reset(): void {
    this.turnId = null;
    this.node = undefined;
  }

  /** The turn currently holding the visible card. Diagnostic/test surface. */
  currentTurnId(): string | null {
    return this.turnId;
  }
}
