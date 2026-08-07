// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { COUNCIL_PERMISSION_CHANNELS, type CouncilPermissionPolicy } from '../council/contract.js';
import {
  assertEgressPermitted,
  authorizeEndpointEgress,
  authorizeToolCall,
  channelForTool,
} from './governance.js';

function policy(overrides: Partial<CouncilPermissionPolicy> = {}): CouncilPermissionPolicy {
  const base = COUNCIL_PERMISSION_CHANNELS.reduce((acc, channel) => {
    acc[channel] = [];
    return acc;
  }, {} as CouncilPermissionPolicy);
  return { ...base, ...overrides };
}

describe('authorizeEndpointEgress', () => {
  it('permits loopback without consulting policy', () => {
    // Nothing leaves the machine, so requiring a grant would be noise that
    // trains users to approve everything.
    const decision = authorizeEndpointEgress('http://127.0.0.1:11434', undefined);
    expect(decision.permitted).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.locality).toBe('local');
  });

  it('does not permit a LAN endpoint by default', () => {
    const decision = authorizeEndpointEgress('http://192.168.1.20:11434', policy());
    expect(decision.locality).toBe('lan');
    expect(decision.permitted).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it('does not permit a remote endpoint by default', () => {
    const decision = authorizeEndpointEgress('https://ollama.example.com', policy());
    expect(decision.locality).toBe('remote');
    expect(decision.permitted).toBe(false);
  });

  it('treats an absent policy as ask, never as allow', () => {
    // Silence must not authorize shipping a repository to an arbitrary host.
    const decision = authorizeEndpointEgress('https://ollama.example.com', undefined);
    expect(decision.permitted).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it('permits a remote endpoint once the web channel grants it', () => {
    const decision = authorizeEndpointEgress(
      'https://ollama.example.com',
      policy({ web: [{ decision: 'allow', patterns: ['https://ollama.example.com'] }] }),
    );
    expect(decision.permitted).toBe(true);
  });

  it('keeps a deny final rather than answerable by approval', () => {
    const decision = authorizeEndpointEgress(
      'https://ollama.example.com',
      policy({ web: [{ decision: 'deny', patterns: ['https://ollama.example.com'] }] }),
    );
    expect(decision.permitted).toBe(false);
    expect(decision.requiresApproval).toBe(false);
  });

  it('refuses a malformed endpoint without asking', () => {
    const decision = authorizeEndpointEgress('file:///etc/passwd', policy());
    expect(decision.permitted).toBe(false);
    expect(decision.requiresApproval).toBe(false);
  });

  it('does not let a loopback-looking hostname masquerade as local', () => {
    const decision = authorizeEndpointEgress('http://127.0.0.1.attacker.com', policy());
    expect(decision.locality).toBe('remote');
    expect(decision.permitted).toBe(false);
  });
});

describe('assertEgressPermitted', () => {
  it('is silent when permitted', () => {
    expect(() =>
      assertEgressPermitted(authorizeEndpointEgress('http://127.0.0.1:11434', undefined)),
    ).not.toThrow();
  });

  it('throws egress_denied for an ungoverned remote endpoint', () => {
    const decision = authorizeEndpointEgress('https://ollama.example.com', policy());
    expect(() => assertEgressPermitted(decision)).toThrow(/approval/i);
  });
});

describe('channelForTool', () => {
  it('routes recognized tools to their channel', () => {
    expect(channelForTool('Read')).toBe('read');
    expect(channelForTool('Write')).toBe('edit');
    expect(channelForTool('WebFetch')).toBe('web');
    expect(channelForTool('mcp__server__thing')).toBe('mcp');
    expect(channelForTool('playwright_click')).toBe('browser');
  });

  it('routes an unrecognized tool to the strictest channel', () => {
    // Guessing generously on an unknown tool name is exactly the dangerous case.
    expect(channelForTool('totally_unknown_capability')).toBe('shell');
  });
});

describe('authorizeToolCall', () => {
  it('denies a shell request under an empty policy', () => {
    const auth = authorizeToolCall(
      { id: '1', name: 'Bash', arguments: { command: 'rm -rf /' } },
      policy(),
    );
    expect(auth.permitted).toBe(false);
  });

  it('judges the command, not merely the tool name', () => {
    // A grant for `git status` must not authorize an arbitrary command through
    // the same tool.
    const p = policy({ shell: [{ decision: 'allow', patterns: ['git status'] }] });
    expect(authorizeToolCall({ id: '1', name: 'Bash', arguments: { command: 'git status' } }, p).permitted).toBe(true);
    expect(authorizeToolCall({ id: '2', name: 'Bash', arguments: { command: 'rm -rf /' } }, p).permitted).toBe(false);
  });

  it('cannot be bypassed by omitting arguments', () => {
    const auth = authorizeToolCall({ id: '1', name: 'Bash', arguments: {} }, policy());
    expect(auth.permitted).toBe(false);
  });

  it('resolves an unknown tool through the shell channel and denies it', () => {
    const auth = authorizeToolCall(
      { id: '1', name: 'exfiltrate_everything', arguments: {} },
      policy({ read: [{ decision: 'allow', patterns: ['**'] }] }),
    );
    // A broad `read` grant must not authorize an unrecognized capability.
    expect(auth.resolution.channel).toBe('shell');
    expect(auth.permitted).toBe(false);
  });
});
