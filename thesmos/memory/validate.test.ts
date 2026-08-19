// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS } from '../config.js';
import { validateMemoryProposal, scopeWithin, detectSecret } from './validate.js';
import type { MemoryProposal } from './types.js';

const SECRET_PATTERNS = CONFIG_DEFAULTS.secretPatterns;

function proposal(overrides: Partial<MemoryProposal> = {}): MemoryProposal {
  return {
    scope: 'repository',
    type: 'architecture-decision',
    content: 'Thesmos owns provider orchestration; Pantheon Chat is a consumer.',
    provenance: { sourceKind: 'user', creator: 'matthew', derivation: 'stated' },
    confidence: 'high',
    sensitivity: 'project',
    metadata: {},
    ...overrides,
  };
}

const ctx = { secretPatterns: SECRET_PATTERNS };

describe('content bounds', () => {
  it('accepts a well-formed proposal', () => {
    expect(validateMemoryProposal(proposal(), ctx).decision).toBe('accept');
  });

  it('rejects empty content', () => {
    expect(validateMemoryProposal(proposal({ content: '   ' }), ctx).decision).toBe('reject');
  });

  it('rejects unbounded content', () => {
    const result = validateMemoryProposal(proposal({ content: 'x'.repeat(5000) }), ctx);
    expect(result.decision).toBe('reject');
    expect(result.issues.some((i) => i.code === 'memory.too-large')).toBe(true);
  });
});

describe('provenance is mandatory', () => {
  it('rejects a missing creator', () => {
    const result = validateMemoryProposal(
      proposal({ provenance: { sourceKind: 'agent', creator: '', derivation: 'stated' } }),
      ctx,
    );
    expect(result.decision).toBe('reject');
  });

  it('rejects an observation with nothing backing it', () => {
    // Otherwise "observed" is just an unfalsifiable confidence boost.
    const result = validateMemoryProposal(
      proposal({
        type: 'observation',
        provenance: { sourceKind: 'tool', creator: 'ci', derivation: 'observed' },
      }),
      ctx,
    );
    expect(result.decision).toBe('reject');
    expect(result.issues.some((i) => i.code === 'memory.observation-unbacked')).toBe(true);
  });

  it('accepts an observation backed by evidence', () => {
    const result = validateMemoryProposal(
      proposal({
        type: 'observation',
        provenance: {
          sourceKind: 'execution-receipt',
          creator: 'ci',
          derivation: 'observed',
          evidenceRef: 'receipt-abc123',
        },
      }),
      ctx,
    );
    expect(result.decision).toBe('accept');
  });

  it('rejects a consolidation with no source records', () => {
    const result = validateMemoryProposal(
      proposal({
        type: 'summary',
        provenance: { sourceKind: 'generated-summary', creator: 'mnemosyne', derivation: 'consolidated' },
      }),
      ctx,
    );
    expect(result.decision).toBe('reject');
  });
});

describe('inference cannot become fact', () => {
  it('rejects a hypothesis stored as verified', () => {
    const result = validateMemoryProposal(
      proposal({ type: 'hypothesis', confidence: 'verified' }),
      ctx,
    );
    expect(result.decision).toBe('reject');
    expect(result.issues.some((i) => i.code === 'memory.hypothesis-verified')).toBe(true);
  });

  it('allows a hypothesis at lower confidence', () => {
    expect(
      validateMemoryProposal(proposal({ type: 'hypothesis', confidence: 'medium' }), ctx).decision,
    ).toBe('accept');
  });
});

describe('scope authority', () => {
  it('permits writing at or inside the ceiling', () => {
    expect(scopeWithin('mission', 'repository')).toBe(true);
    expect(scopeWithin('repository', 'repository')).toBe(true);
  });

  it('refuses to widen beyond the ceiling', () => {
    expect(scopeWithin('global', 'repository')).toBe(false);
  });

  it('rejects a child task writing wider than its mission', () => {
    // The containment rule: a session must not rewrite project-wide truth.
    const result = validateMemoryProposal(proposal({ scope: 'global' }), {
      ...ctx,
      maxScope: 'session',
    });
    expect(result.decision).toBe('reject');
    expect(result.issues.some((i) => i.code === 'memory.scope-escalation')).toBe(true);
  });

  it('rejects an unknown scope', () => {
    const result = validateMemoryProposal(
      proposal({ scope: 'universe' as never }),
      ctx,
    );
    expect(result.decision).toBe('reject');
  });
});

describe('cross-project isolation', () => {
  it('rejects a write targeting a different repo', () => {
    const result = validateMemoryProposal(proposal({ repoId: 'other-repo' }), {
      ...ctx,
      repoId: 'thesmos-governance',
    });
    expect(result.decision).toBe('reject');
    expect(result.issues.some((i) => i.code === 'memory.cross-project')).toBe(true);
  });

  it('allows a matching repo', () => {
    const result = validateMemoryProposal(proposal({ repoId: 'thesmos-governance' }), {
      ...ctx,
      repoId: 'thesmos-governance',
    });
    expect(result.decision).toBe('accept');
  });
});

/**
 * Credential-shaped fixtures, assembled at runtime.
 *
 * Written as literals these are themselves the patterns under test, so
 * Thesmos' own `secret_in_diff` rule flags the file as a BLOCKER — correctly,
 * since a credential shape should never sit in committed source even as a
 * dummy. Assembling them keeps the detection path identical while leaving no
 * matchable literal behind.
 */
const FAKE_API_KEY = ['sk', 'ant', 'api03', 'A'.repeat(20)].join('-');
const FAKE_AWS_ASSIGNMENT = ['AWS', 'SECRET', 'ACCESS', 'KEY'].join('_') + '=' + 'A1b2C3d4E5f6G7h8I9j0K1l2';

describe('secret handling', () => {
  it('detects a credential in content', () => {
    expect(detectSecret(`const k = "${FAKE_API_KEY}"`, SECRET_PATTERNS)).toBeTruthy();
  });

  it('rejects a memory containing a secret', () => {
    const result = validateMemoryProposal(proposal({ content: FAKE_AWS_ASSIGNMENT }), ctx);
    expect(result.decision).toBe('reject');
    expect(result.effectiveSensitivity).toBe('secret');
  });

  it('marks a secret as non-embeddable regardless of the proposed label', () => {
    // Embedding does not launder sensitivity.
    const result = validateMemoryProposal(
      proposal({
        sensitivity: 'public',
        content: FAKE_AWS_ASSIGNMENT,
      }),
      ctx,
    );
    expect(result.embeddable).toBe(false);
  });

  it('stores but never embeds sensitive-class content', () => {
    const result = validateMemoryProposal(proposal({ sensitivity: 'sensitive' }), ctx);
    expect(result.decision).toBe('accept');
    expect(result.embeddable).toBe(false);
  });

  it('embeds ordinary project content', () => {
    expect(validateMemoryProposal(proposal(), ctx).embeddable).toBe(true);
  });
});

describe('malformed metadata', () => {
  it('rejects a non-ISO expiry', () => {
    const result = validateMemoryProposal(
      proposal({ retention: { expiresAt: 'next tuesday' } }),
      ctx,
    );
    expect(result.decision).toBe('reject');
  });

  it('rejects an empty supersedes id', () => {
    expect(validateMemoryProposal(proposal({ supersedes: [''] }), ctx).decision).toBe('reject');
  });
});
