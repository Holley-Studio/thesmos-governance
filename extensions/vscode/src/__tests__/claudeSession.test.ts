// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * ClaudeSession stream parsing — focused on the fields the Budget Guardian
 * depends on: the init event's apiKeySource (billing classification) and the
 * result event's total_cost_usd (cumulative API-equivalent estimate).
 */
import { describe, it, expect } from 'vitest';
import { ClaudeSession, type SessionEvent } from '../chat/claudeSession.js';

function parseWith(lines: string[]): SessionEvent[] {
  const events: SessionEvent[] = [];
  const session = new ClaudeSession('/tmp/nowhere', (e) => events.push(e));
  const priv = session as unknown as { parseLine(line: string): void };
  for (const line of lines) priv.parseLine(line);
  return events;
}

describe('ClaudeSession init parsing', () => {
  it('surfaces apiKeySource from the CLI init event', () => {
    const events = parseWith([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-4-8', apiKeySource: 'ANTHROPIC_API_KEY' }),
    ]);
    expect(events[0]).toMatchObject({ kind: 'init', sessionId: 's1', apiKeySource: 'ANTHROPIC_API_KEY' });
  });

  it("surfaces apiKeySource 'none' (OAuth login) verbatim — classification happens elsewhere", () => {
    const events = parseWith([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', apiKeySource: 'none' }),
    ]);
    expect(events[0]).toMatchObject({ kind: 'init', apiKeySource: 'none' });
  });

  it('leaves apiKeySource undefined when the CLI omits it (older versions)', () => {
    const events = parseWith([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm' }),
    ]);
    expect(events[0]).toMatchObject({ kind: 'init' });
    expect((events[0] as { apiKeySource?: string }).apiKeySource).toBeUndefined();
  });

  it('ignores a non-string apiKeySource defensively', () => {
    const events = parseWith([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', apiKeySource: 42 }),
    ]);
    expect((events[0] as { apiKeySource?: string }).apiKeySource).toBeUndefined();
  });
});

describe('ClaudeSession result parsing', () => {
  it('reports cumulative total_cost_usd on turnDone', () => {
    const events = parseWith([JSON.stringify({ type: 'result', total_cost_usd: 30.06, is_error: false })]);
    expect(events[0]).toMatchObject({ kind: 'turnDone', costUsd: 30.06, isError: false });
  });

  it('leaves costUsd undefined when the CLI omits it (e.g. Codex-shaped turns)', () => {
    const events = parseWith([JSON.stringify({ type: 'result', is_error: false })]);
    expect((events[0] as { costUsd?: number }).costUsd).toBeUndefined();
  });

  it('ignores non-JSON noise', () => {
    expect(parseWith(['not json at all'])).toHaveLength(0);
  });
});
