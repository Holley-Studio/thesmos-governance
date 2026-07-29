// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Single-finalization protocol for streamed assistant responses.
 *
 * ## The defect this replaces
 *
 * The previous protocol used three unrelated messages — `delta`, `deltaDone`,
 * `removeLive` — against one mutable module-global (`liveBubble`) that served
 * *both* as the render target for deltas *and* as the only handle for terminal
 * disposition. `deltaDone` was implemented as "drop the handle", so every
 * terminal instruction that arrived afterwards (`removeLive`, or a `zeus` item
 * that wanted to replace the streamed text) was unaddressable. "Replace"
 * silently degraded to "append", and one logical response rendered two cards.
 *
 * ## The contract
 *
 * A *stream* is one contiguous run of assistant text deltas. It has a stable
 * `streamId` minted by the provider, and it ends exactly once, with an explicit
 * disposition:
 *
 * - `keep`    — the streamed node *is* the final card. Nothing is appended.
 * - `replace` — atomically swap the streamed node for a rendered item, in place.
 * - `discard` — remove the streamed node; no card takes its place.
 *
 * Invariants this module enforces, and which its tests assert:
 *
 * 1. **Exactly one card per stream.** A settled stream can never produce a
 *    second visible node, whatever arrives afterwards.
 * 2. **Idempotent terminals.** A duplicated `finalizeStream` is a no-op.
 * 3. **Ordering-tolerant.** A terminal for a stream that never streamed still
 *    renders its item exactly once; deltas that arrive *after* a terminal are
 *    dropped rather than resurrecting a settled node.
 * 4. **Exactly one announcement.** `announceSettled` fires once per stream.
 *
 * The module is deliberately DOM-free and dependency-free: the surface is
 * injected, so the state machine is testable without a browser. Real-DOM
 * behaviour is supplied by the adapter in `webview/chat.ts`.
 */

export type StreamId = string;

/** What should become of a stream's node when the stream ends. */
export type StreamDisposition<TItem> =
  /** The streamed node stands as the final card. */
  | { kind: 'keep' }
  /** Swap the streamed node for this item, in place. */
  | { kind: 'replace'; item: TItem }
  /** Remove the streamed node; render nothing in its place. */
  | { kind: 'discard' };

/**
 * The one terminal message. `streamId: null` means "no stream was open" — the
 * webview still runs its end-of-turn cleanup (deliberation, thinking gap) but
 * has no node to dispose of.
 */
export interface FinalizeStreamMessage<TItem> {
  type: 'finalizeStream';
  streamId: StreamId | null;
  disposition: StreamDisposition<TItem>;
}

/** Everything the finalizer needs from the rendering layer. */
export interface StreamSurface<TNode, TItem> {
  /** Create and mount an empty live bubble at the end of the log. */
  createLiveNode(): TNode;
  /** Render accumulated markdown into a live bubble. */
  renderLive(node: TNode, text: string): void;
  /** Detach a live bubble from the log. */
  removeNode(node: TNode): void;
  /** Render `item` *in the position of* `node`, replacing it atomically. */
  renderItemReplacing(item: TItem, node: TNode): void;
  /** Render `item` at the end of the log. */
  appendItem(item: TItem): void;
  /** Announce a settled response to assistive technology. Called at most once per stream. */
  announceSettled(disposition: StreamDisposition<TItem>): void;
}

/** What `finalize()` actually did — returned for tests and diagnostics. */
export type FinalizeOutcome =
  /** The streamed node became the final card. */
  | 'kept'
  /** The streamed node was swapped for the item, in place. */
  | 'replaced'
  /** No node existed, so the item was appended instead. */
  | 'appended'
  /** The streamed node was removed and nothing replaced it. */
  | 'discarded'
  /** Nothing to do — no node and nothing to render. */
  | 'noop'
  /** This stream was already settled; ignored. */
  | 'duplicate';

interface OpenStream<TNode> {
  node: TNode | undefined;
  text: string;
  dirty: boolean;
}

/**
 * Owns live-stream identity and terminal disposition.
 *
 * Memory: `settled` grows by one short string per assistant stream and is
 * cleared by `reset()` (new session, history reload). A long session holds a
 * few thousand short strings — deliberately unbounded rather than evicted,
 * because evicting an id would reopen the duplicate-terminal window it exists
 * to close.
 */
export class StreamFinalizer<TNode, TItem> {
  private readonly open = new Map<StreamId, OpenStream<TNode>>();
  private readonly settled = new Set<StreamId>();

  constructor(private readonly surface: StreamSurface<TNode, TItem>) {}

  /**
   * Accumulate a text delta. Deltas for an already-settled stream are dropped:
   * a late or reordered delta must never resurrect a finalized response.
   * Returns true when a render is pending (the caller batches per frame).
   */
  delta(streamId: StreamId, text: string): boolean {
    if (this.settled.has(streamId)) return false;
    const entry = this.open.get(streamId) ?? { node: undefined, text: '', dirty: false };
    entry.text += text;
    entry.dirty = true;
    this.open.set(streamId, entry);
    return true;
  }

  /**
   * Render pending text for every open stream. The node is created lazily here
   * so a stream that only ever carried empty deltas never mounts a bubble.
   */
  flush(): void {
    for (const entry of this.open.values()) {
      if (!entry.dirty || entry.text === '') continue;
      entry.node ??= this.surface.createLiveNode();
      this.surface.renderLive(entry.node, entry.text);
      entry.dirty = false;
    }
  }

  /** True when this stream has already been settled. */
  isSettled(streamId: StreamId): boolean {
    return this.settled.has(streamId);
  }

  /** Ids of streams still awaiting a terminal. Diagnostic/test surface. */
  openStreamIds(): StreamId[] {
    return [...this.open.keys()];
  }

  /**
   * End a stream exactly once. Safe to call with a duplicate, a reordered, or
   * an unknown `streamId`; safe to call with `null` when no stream was open.
   */
  finalize(streamId: StreamId | null, disposition: StreamDisposition<TItem>): FinalizeOutcome {
    if (streamId === null) return 'noop';
    if (this.settled.has(streamId)) return 'duplicate';
    this.settled.add(streamId);

    const entry = this.open.get(streamId);
    this.open.delete(streamId);
    const node = entry?.node;

    switch (disposition.kind) {
      case 'keep': {
        if (node === undefined) return 'noop';
        // Land any delta that arrived after the last frame flush, so the kept
        // card is never a truncated view of what the model actually sent.
        if (entry?.dirty && entry.text !== '') this.surface.renderLive(node, entry.text);
        this.surface.announceSettled(disposition);
        return 'kept';
      }
      case 'replace': {
        if (node === undefined) {
          this.surface.appendItem(disposition.item);
          this.surface.announceSettled(disposition);
          return 'appended';
        }
        this.surface.renderItemReplacing(disposition.item, node);
        this.surface.announceSettled(disposition);
        return 'replaced';
      }
      case 'discard': {
        if (node === undefined) return 'noop';
        this.surface.removeNode(node);
        return 'discarded';
      }
    }
  }

  /**
   * Forget every stream. Called when the log is cleared (new session, history
   * reload) — the caller is responsible for the DOM; this drops identity only.
   */
  reset(): void {
    this.open.clear();
    this.settled.clear();
  }
}
