// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';

describe('codexSession — event contract', () => {
  it('KNOWN_EVENT_TYPES contains the required base set', async () => {
    const { KNOWN_EVENT_TYPES } = await import('../chat/codexSession.js');
    expect(KNOWN_EVENT_TYPES.has('thread.started')).toBe(true);
    expect(KNOWN_EVENT_TYPES.has('item.completed')).toBe(true);
    expect(KNOWN_EVENT_TYPES.has('turn.completed')).toBe(true);
    expect(KNOWN_EVENT_TYPES.has('turn.failed')).toBe(true);
  });

  it('assertKnownEvent throws for unknown type in guarded mode', async () => {
    const { assertKnownEvent } = await import('../chat/codexSession.js');
    expect(() => assertKnownEvent('unknown_future_event', true)).toThrow(
      "Codex emitted unknown event type 'unknown_future_event'",
    );
  });

  it('assertKnownEvent does NOT throw for unknown type in non-guarded mode', async () => {
    const { assertKnownEvent } = await import('../chat/codexSession.js');
    expect(() => assertKnownEvent('unknown_future_event', false)).not.toThrow();
  });

  it('assertKnownEvent does NOT throw for known event types', async () => {
    const { assertKnownEvent } = await import('../chat/codexSession.js');
    expect(() => assertKnownEvent('thread.started', true)).not.toThrow();
    expect(() => assertKnownEvent('item.completed', true)).not.toThrow();
    expect(() => assertKnownEvent('turn.completed', true)).not.toThrow();
    expect(() => assertKnownEvent('turn.failed', true)).not.toThrow();
  });
});
