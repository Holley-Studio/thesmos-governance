// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendMessage,
  ensureChannelDefinition,
  readChannelDefinition,
  readMessages,
  readMessagesSince,
  writeChannelDefinition,
} from './store.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-channel-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('channel definition', () => {
  it('returns undefined for a channel that has never been created', () => {
    expect(readChannelDefinition(root, 'dev-team')).toBeUndefined();
  });

  it('round-trips a written definition', () => {
    writeChannelDefinition(root, { id: 'dev-team', name: '#dev-team', agentIds: ['chiron-architecture-agent'] });
    expect(readChannelDefinition(root, 'dev-team')).toEqual({
      id: 'dev-team',
      name: '#dev-team',
      agentIds: ['chiron-architecture-agent'],
    });
  });

  it('ensureChannelDefinition creates the fallback on first use and is idempotent after', () => {
    const fallback = { id: 'dev-team', name: '#dev-team', agentIds: ['chiron-architecture-agent'] };
    const first = ensureChannelDefinition(root, fallback);
    expect(first).toEqual(fallback);

    // A later call with a different fallback must not overwrite what's on disk —
    // "first open" provisions it, it isn't re-provisioned on every open.
    const second = ensureChannelDefinition(root, { id: 'dev-team', name: '#renamed', agentIds: [] });
    expect(second).toEqual(fallback);
  });
});

describe('messages', () => {
  it('returns an empty list for a channel with no messages yet', () => {
    expect(readMessages(root, 'dev-team')).toEqual([]);
  });

  it('appends and reads back messages in order, assigning id and ts', () => {
    const first = appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'hi', round: 0 });
    const second = appendMessage(root, 'dev-team', {
      authorId: 'chiron-architecture-agent',
      authorType: 'agent',
      text: 'looking at it',
      round: 1,
    });

    expect(first.id).toBeTruthy();
    expect(first.ts).toBeTruthy();

    const all = readMessages(root, 'dev-team');
    expect(all.map((m) => m.id)).toEqual([first.id, second.id]);
    expect(all.map((m) => m.text)).toEqual(['hi', 'looking at it']);
  });

  it('persists as one JSON object per line', () => {
    appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'a', round: 0 });
    appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'b', round: 0 });
    const raw = readFileSync(join(root, '.thesmos', 'channels', 'dev-team', 'messages.jsonl'), 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });

  it('skips a corrupt line rather than failing the whole read', () => {
    appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'good', round: 0 });
    const path = join(root, '.thesmos', 'channels', 'dev-team', 'messages.jsonl');
    appendFileSync(path, 'not json at all\n');

    const messages = readMessages(root, 'dev-team');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe('good');
  });

  it('assigns a monotonic seq per message, never relying on wall-clock time', () => {
    const first = appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'a', round: 0 });
    const second = appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'b', round: 0 });
    const third = appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'c', round: 0 });
    expect([first.seq, second.seq, third.seq]).toEqual([0, 1, 2]);
  });

  it('readMessagesSince returns everything when sinceSeq is absent', () => {
    appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'a', round: 0 });
    expect(readMessagesSince(root, 'dev-team', undefined)).toHaveLength(1);
  });

  it('readMessagesSince returns only messages strictly after the given seq', () => {
    const first = appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'a', round: 0 });
    const second = appendMessage(root, 'dev-team', { authorId: 'user', authorType: 'user', text: 'b', round: 0 });

    const since = readMessagesSince(root, 'dev-team', first.seq);
    expect(since.map((m) => m.id)).toEqual([second.id]);
  });
});
