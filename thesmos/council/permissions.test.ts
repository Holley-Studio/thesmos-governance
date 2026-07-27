// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Permission resolution: most-restrictive-wins, order-independent, fail-closed.
 *
 * The tests that matter most here are the ones that would pass under
 * last-match-wins and must not: a broad `allow` appended after a `deny` cannot
 * be allowed to win, and shuffling a policy cannot change a single decision.
 */

import { describe, expect, it } from 'vitest';
import {
  detectPermissionEscalation,
  isMorePermissive,
  mostRestrictive,
  resolveInheritedPermission,
  resolvePermission,
  summarizePolicy,
  COUNCIL_PERMISSION_ALLOWED,
  COUNCIL_PERMISSION_CONFIRMATION_REQUIRED,
  COUNCIL_PERMISSION_DENIED,
  COUNCIL_PERMISSION_INVALID_PATTERN,
  COUNCIL_PERMISSION_INVALID_TARGET,
  COUNCIL_PERMISSION_UNKNOWN,
} from './permissions.js';
import {
  emptyPermissionPolicy,
  type CouncilPermissionPolicy,
  type CouncilPermissionRule,
} from './contract.js';

function policy(overrides: Partial<CouncilPermissionPolicy>): CouncilPermissionPolicy {
  return { ...emptyPermissionPolicy(), ...overrides };
}

/** Every ordering of a rule list, so "order-independent" is proven, not asserted. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) out.push([items[i]!, ...perm]);
  }
  return out;
}

describe('decision precedence', () => {
  it('ranks deny over ask over allow', () => {
    expect(mostRestrictive('allow', 'ask')).toBe('ask');
    expect(mostRestrictive('ask', 'deny')).toBe('deny');
    expect(mostRestrictive('allow', 'deny')).toBe('deny');
    expect(mostRestrictive('allow', 'allow')).toBe('allow');
    expect(isMorePermissive('allow', 'deny')).toBe(true);
    expect(isMorePermissive('deny', 'allow')).toBe(false);
  });
});

describe('most-restrictive-wins', () => {
  const rules: CouncilPermissionRule[] = [
    { decision: 'allow', patterns: ['src/**'] },
    { decision: 'ask', patterns: ['src/config/**'] },
    { decision: 'deny', patterns: ['src/config/secrets.ts'] },
  ];

  it('lets a deny beat an overlapping allow', () => {
    const result = resolvePermission(policy({ edit: rules }), 'edit', 'src/config/secrets.ts');
    expect(result.decision).toBe('deny');
    expect(result.code).toBe(COUNCIL_PERMISSION_DENIED);
  });

  it('lets an ask beat an overlapping allow', () => {
    const result = resolvePermission(policy({ edit: rules }), 'edit', 'src/config/app.ts');
    expect(result.decision).toBe('ask');
    expect(result.code).toBe(COUNCIL_PERMISSION_CONFIRMATION_REQUIRED);
  });

  it('allows only where nothing more restrictive matches', () => {
    const result = resolvePermission(policy({ edit: rules }), 'edit', 'src/index.ts');
    expect(result.decision).toBe('allow');
    expect(result.code).toBe(COUNCIL_PERMISSION_ALLOWED);
  });

  it('is independent of rule order across every permutation', () => {
    const targets = ['src/config/secrets.ts', 'src/config/app.ts', 'src/index.ts', 'docs/readme.md'];
    for (const target of targets) {
      const decisions = permutations(rules).map(
        (ordered) => resolvePermission(policy({ edit: ordered }), 'edit', target).decision
      );
      expect(new Set(decisions).size, `order changed the decision for ${target}`).toBe(1);
    }
  });

  it('is not last-match-wins — a trailing broad allow cannot revoke a deny', () => {
    const withTrailingAllow = policy({
      edit: [
        { decision: 'deny', patterns: ['**/.env'] },
        { decision: 'allow', patterns: ['**'] },
      ],
    });
    expect(resolvePermission(withTrailingAllow, 'edit', '.env').decision).toBe('deny');
  });

  it('returns a stable matched pattern regardless of ordering', () => {
    const a = resolvePermission(
      policy({ read: [{ decision: 'deny', patterns: ['a/**'] }, { decision: 'deny', patterns: ['**/b.ts'] }] }),
      'read',
      'a/b.ts'
    );
    const b = resolvePermission(
      policy({ read: [{ decision: 'deny', patterns: ['**/b.ts'] }, { decision: 'deny', patterns: ['a/**'] }] }),
      'read',
      'a/b.ts'
    );
    expect(a.matchedPattern).toBe(b.matchedPattern);
  });
});

describe('unknown state', () => {
  it('resolves an unmatched target to ask, never allow', () => {
    const result = resolvePermission(policy({ read: [{ decision: 'allow', patterns: ['src/**'] }] }), 'read', 'other/x.ts');
    expect(result.decision).toBe('ask');
    expect(result.code).toBe(COUNCIL_PERMISSION_UNKNOWN);
  });

  it('resolves an entirely empty policy to ask on every channel', () => {
    const empty = emptyPermissionPolicy();
    for (const channel of Object.keys(empty) as Array<keyof CouncilPermissionPolicy>) {
      const result = resolvePermission(empty, channel, channel === 'shell' ? 'git status' : 'src/x.ts');
      expect(result.decision).toBe('ask');
      expect(result.code).toBe(COUNCIL_PERMISSION_UNKNOWN);
    }
  });

  it('resolves a missing channel to ask rather than throwing', () => {
    const partial = { read: [{ decision: 'allow' as const, patterns: ['**/*.ts'] }] } as unknown as CouncilPermissionPolicy;
    expect(resolvePermission(partial, 'edit', 'src/x.ts').decision).toBe('ask');
  });

  it('ignores a rule whose decision is not allow|ask|deny', () => {
    const malformed = policy({
      edit: [{ decision: 'yes' as unknown as 'allow', patterns: ['**'] }],
    });
    expect(resolvePermission(malformed, 'edit', 'src/x.ts').decision).toBe('ask');
  });
});

describe('fail-closed handling', () => {
  it('denies when the target itself cannot be normalized', () => {
    const p = policy({ read: [{ decision: 'allow', patterns: ['**/*.ts'] }] });
    const result = resolvePermission(p, 'read', '../../etc/passwd');
    expect(result.decision).toBe('deny');
    expect(result.code).toBe(COUNCIL_PERMISSION_INVALID_TARGET);
  });

  it('denies when a restriction pattern is unparsable', () => {
    const result = resolvePermission(
      policy({ edit: [{ decision: 'deny', patterns: ['../escape/**'] }] }),
      'edit',
      'src/x.ts'
    );
    expect(result.decision).toBe('deny');
    expect(result.code).toBe(COUNCIL_PERMISSION_INVALID_PATTERN);
  });

  it('never lets an unparsable allow pattern grant anything', () => {
    const result = resolvePermission(
      policy({ edit: [{ decision: 'allow', patterns: ['../escape/**'] }] }),
      'edit',
      'src/x.ts'
    );
    expect(result.decision).toBe('ask');
  });
});

describe('cross-platform path semantics', () => {
  const p = policy({
    edit: [
      { decision: 'deny', patterns: ['src/config/*.env'] },
      { decision: 'allow', patterns: ['src/**/*.ts'] },
    ],
  });

  it('applies a POSIX-written deny to a Windows-written target', () => {
    expect(resolvePermission(p, 'edit', 'src\\config\\prod.env').decision).toBe('deny');
    expect(resolvePermission(p, 'edit', 'C:\\repo\\src\\x.ts').decision).not.toBe('allow');
  });

  it('applies a deny across case-only variation, as a case-insensitive volume would', () => {
    expect(resolvePermission(p, 'edit', 'SRC/CONFIG/PROD.ENV').decision).toBe('deny');
    expect(resolvePermission(p, 'edit', 'Src/Config/Prod.Env').decision).toBe('deny');
  });

  it('does not let case folding widen an allow', () => {
    expect(resolvePermission(p, 'edit', 'src/app/main.ts').decision).toBe('allow');
    // An allow is matched exactly: a differently-cased path is unknown, not granted.
    expect(resolvePermission(p, 'edit', 'SRC/APP/MAIN.TS').decision).toBe('ask');
  });

  it('normalizes UNC and drive-letter forms of the same path identically', () => {
    const denyAbsolute = policy({ read: [{ decision: 'deny', patterns: ['c:/repo/secret/**'] }] });
    for (const target of [
      'C:\\repo\\secret\\key.txt',
      'c:/repo/secret/key.txt',
      '\\\\?\\C:\\repo\\secret\\key.txt',
    ]) {
      expect(resolvePermission(denyAbsolute, 'read', target).decision, target).toBe('deny');
    }
  });
});

describe('command rules', () => {
  const p = policy({
    shell: [
      { decision: 'deny', patterns: ['rm -rf*', 'sudo*'] },
      { decision: 'allow', patterns: ['git status*', 'npm test*'] },
      { decision: 'ask', patterns: ['git push*'] },
    ],
  });

  it('matches commands as text without invoking a shell', () => {
    expect(resolvePermission(p, 'shell', 'git status --short').decision).toBe('allow');
    expect(resolvePermission(p, 'shell', 'git push origin main').decision).toBe('ask');
    expect(resolvePermission(p, 'shell', 'rm -rf /').decision).toBe('deny');
    expect(resolvePermission(p, 'shell', 'echo hi').decision).toBe('ask');
  });

  it('applies a deny across case variation', () => {
    expect(resolvePermission(p, 'shell', 'SUDO reboot').decision).toBe('deny');
  });

  it('collapses whitespace rather than parsing operators', () => {
    expect(resolvePermission(p, 'shell', '  git   status  ').decision).toBe('allow');
  });
});

describe('inheritance', () => {
  const parent = policy({
    edit: [
      { decision: 'allow', patterns: ['src/**'] },
      { decision: 'deny', patterns: ['src/secrets/**'] },
    ],
  });

  it('lets a child narrow what it inherited', () => {
    const child = policy({ edit: [{ decision: 'deny', patterns: ['src/**'] }] });
    expect(resolveInheritedPermission(parent, child, 'edit', 'src/app.ts').decision).toBe('deny');
  });

  it('does not let a child widen what it inherited', () => {
    const child = policy({ edit: [{ decision: 'allow', patterns: ['src/secrets/**'] }] });
    const result = resolveInheritedPermission(parent, child, 'edit', 'src/secrets/key.ts');
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/bounded by parent mission/);
  });

  it('does not let a child reach outside the parent policy at all', () => {
    const child = policy({ edit: [{ decision: 'allow', patterns: ['infra/**'] }] });
    // The parent never mentions infra/, so the parent resolves it to ask.
    expect(resolveInheritedPermission(parent, child, 'edit', 'infra/main.tf').decision).toBe('ask');
  });

  it('reports every attempted expansion with a stable code', () => {
    const child = policy({
      edit: [{ decision: 'allow', patterns: ['src/secrets/**'] }],
      shell: [{ decision: 'allow', patterns: ['rm -rf*'] }],
    });
    const escalations = detectPermissionEscalation(parent, child);
    expect(escalations.length).toBeGreaterThanOrEqual(2);
    expect(escalations.every((e) => e.code === 'COUNCIL_PERMISSION_ESCALATION')).toBe(true);
    expect(escalations.map((e) => e.channel)).toEqual([...escalations.map((e) => e.channel)].sort());
  });

  it('reports nothing when a child only restricts', () => {
    const child = policy({ edit: [{ decision: 'deny', patterns: ['**'] }] });
    expect(detectPermissionEscalation(parent, child)).toEqual([]);
  });
});

describe('summaries', () => {
  it('always reports ask as the fallback for an unlisted target', () => {
    const summary = summarizePolicy(policy({ read: [{ decision: 'allow', patterns: ['a', 'b'] }] }));
    const read = summary.find((s) => s.channel === 'read')!;
    expect(read.allow).toBe(2);
    expect(read.fallback).toBe('ask');
  });
});
