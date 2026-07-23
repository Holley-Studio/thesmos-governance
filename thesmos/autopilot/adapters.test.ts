// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  buildClaudeCliArgs,
  createAdapter,
  ClaudeAdapter,
  resolveDangerouslySkipPermissions,
} from './adapters.js';

describe('resolveDangerouslySkipPermissions', () => {
  it('defaults off for undefined and false', () => {
    expect(resolveDangerouslySkipPermissions(undefined)).toBe(false);
    expect(resolveDangerouslySkipPermissions(false)).toBe(false);
  });

  it('enables only for explicit true', () => {
    expect(resolveDangerouslySkipPermissions(true)).toBe(true);
  });
});

describe('buildClaudeCliArgs', () => {
  it('omits --dangerously-skip-permissions by default', () => {
    expect(buildClaudeCliArgs('do the thing')).toEqual(['-p', 'do the thing']);
    expect(buildClaudeCliArgs('do the thing', {})).toEqual(['-p', 'do the thing']);
    expect(buildClaudeCliArgs('do the thing', { dangerouslySkipPermissions: false })).toEqual([
      '-p',
      'do the thing',
    ]);
  });

  it('appends --dangerously-skip-permissions only when opted in', () => {
    expect(
      buildClaudeCliArgs('do the thing', { dangerouslySkipPermissions: true }),
    ).toEqual(['-p', 'do the thing', '--dangerously-skip-permissions']);
  });

  it('never places the skip flag before -p / prompt', () => {
    const args = buildClaudeCliArgs('prompt text', { dangerouslySkipPermissions: true });
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe('prompt text');
    expect(args.indexOf('--dangerously-skip-permissions')).toBe(2);
  });
});

describe('createAdapter (claude safety defaults)', () => {
  it('constructs ClaudeAdapter with skip disabled by default', () => {
    const adapter = createAdapter('claude') as ClaudeAdapter;
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
    expect(adapter.name).toBe('claude');
    // Instance default must not enable skip unless configured
    const args = buildClaudeCliArgs('x', {
      dangerouslySkipPermissions: resolveDangerouslySkipPermissions(undefined),
    });
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('accepts structured options for opt-in skip', () => {
    const adapter = createAdapter('claude', { dangerouslySkipPermissions: true });
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });

  it('still accepts legacy httpUrl string overload', () => {
    const adapter = createAdapter('http', 'https://example.com/llm');
    expect(adapter.name).toBe('http');
  });

  it('requires httpUrl for http adapter', () => {
    expect(() => createAdapter('http')).toThrow(/httpAdapterUrl/);
  });
});
