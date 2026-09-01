// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { buildSessionStartPayload } from './start.js';

describe('buildSessionStartPayload', () => {
  it('emits the SessionStart hookSpecificOutput envelope', () => {
    const parsed = JSON.parse(buildSessionStartPayload('hello'));
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toBe('hello');
  });

  it('produces valid JSON for context containing quotes and newlines', () => {
    const tricky = 'a "quoted" thing\nand a newline \\ backslash';
    expect(JSON.parse(buildSessionStartPayload(tricky)).hookSpecificOutput.additionalContext)
      .toBe(tricky);
  });
});
