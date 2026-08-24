// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { classifyAssistantText, type RoutedGod } from '../chat/assistantRouting.js';

const ARGUS: RoutedGod = { emoji: '👁', name: 'Argus', color: '#c0392b' };
const resolveArgus = (route: string): RoutedGod | undefined =>
  /argus/i.test(route) ? ARGUS : undefined;

describe('classifyAssistantText', () => {
  it('routes a lean god line to an attributed assistant card and strips the header', () => {
    const { item, streamedTextIsFinal } = classifyAssistantText(
      '⚡ ZEUS · 👁 Argus — Security & Threat Modeling\nYour auth middleware is missing a check.',
      resolveArgus,
    );
    expect(item).toEqual({
      kind: 'assistant',
      text: 'Your auth middleware is missing a check.',
      god: ARGUS,
    });
    // The header streamed but is not in the card — the node must be replaced.
    expect(streamedTextIsFinal).toBe(false);
  });

  it('routes Zeus direct response to an unattributed assistant card', () => {
    const { item, streamedTextIsFinal } = classifyAssistantText(
      '⚡ ZEUS · direct response\nHere is the answer.',
      resolveArgus,
    );
    expect(item).toEqual({ kind: 'assistant', text: 'Here is the answer.', god: undefined });
    expect(streamedTextIsFinal).toBe(false);
  });

  it('leaves the card unattributed when the route names no known god', () => {
    const { item } = classifyAssistantText('⚡ ZEUS · 🐉 Nobody — Nowhere\nBody.', resolveArgus);
    expect(item).toEqual({ kind: 'assistant', text: 'Body.', god: undefined });
  });

  it('treats a multi-line Zeus banner as a zeus card carrying the original text', () => {
    const raw = '⚡ ZEUS — COUNCIL ASSEMBLY\nMulti-domain task · dispatching:\n  👁 Argus → security';
    const { item, streamedTextIsFinal } = classifyAssistantText(raw, resolveArgus);
    expect(item).toEqual({ kind: 'zeus', text: raw });
    expect(streamedTextIsFinal).toBe(false);
  });

  it('treats a lone lean line with no body as a zeus card, not an empty response', () => {
    const raw = '⚡ ZEUS · 👁 Argus — Security';
    const { item } = classifyAssistantText(raw, resolveArgus);
    expect(item).toEqual({ kind: 'zeus', text: raw });
  });

  it('keeps an ordinary response exactly as streamed', () => {
    const raw = 'No routing here.\n\nJust a normal answer.';
    const { item, streamedTextIsFinal } = classifyAssistantText(raw, resolveArgus);
    expect(item).toEqual({ kind: 'assistant', text: raw });
    // Nothing changed, so the streamed node already *is* the card.
    expect(streamedTextIsFinal).toBe(true);
  });

  it('does not treat a mid-text Zeus mention as routing', () => {
    const raw = 'The docs say ⚡ ZEUS · direct response is the lean form.';
    const { item, streamedTextIsFinal } = classifyAssistantText(raw, resolveArgus);
    expect(item.kind).toBe('assistant');
    expect(streamedTextIsFinal).toBe(true);
  });

  it('tolerates leading whitespace before the routing line', () => {
    const { item } = classifyAssistantText('\n\n⚡ ZEUS · 👁 Argus — Security\nBody.', resolveArgus);
    expect(item).toEqual({ kind: 'assistant', text: 'Body.', god: ARGUS });
  });
});
