// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Conservative role baselines used when an agent document predates the Council
 * Contract (Olympus D4).
 *
 * These are not "defaults" in the usual sense. A default fills in what the
 * author probably meant; these fill in the *least* the agent could have meant,
 * and every field they supply is recorded in `completeness.derivedFields` so a
 * derived restriction is never mistaken for a declared intent.
 *
 * The invariants every baseline holds to:
 *   - no `allow` on `edit`, ever — a derived contract can ask, never write freely
 *   - no `allow` on `browser`, `mcp`, or `web`
 *   - secrets are denied on `read` *and* `edit`
 *   - dangerous shell shapes are denied outright
 *   - `task` (delegation) is denied wherever `maximumChildren` is 0
 */

import {
  type CouncilAgentMode,
  type CouncilLimits,
  type CouncilPermissionPolicy,
  type CouncilPrimaryRole,
  type CouncilRisk,
} from './contract.js';

// ── Shared pattern groups ─────────────────────────────────────────────────────

/** Never readable, never writable, in any role. */
export const SECRET_PATTERNS: readonly string[] = [
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/.ssh/**',
  '**/.npmrc',
  '**/.netrc',
  '**/credentials',
  '**/credentials.*',
  '**/secrets/**',
  '**/*.keystore',
];

/** Never writable by a derived contract — repo plumbing and build output. */
export const PROTECTED_WRITE_PATTERNS: readonly string[] = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
];

/** Readable source and documentation shapes. */
const READABLE_SOURCE_PATTERNS: readonly string[] = [
  '**/*.md',
  '**/*.mdx',
  '**/*.txt',
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.json',
  '**/*.yml',
  '**/*.yaml',
  '**/*.css',
  '**/*.scss',
  '**/*.html',
  '**/*.py',
  '**/*.go',
  '**/*.rs',
  '**/*.sql',
];

/** Read-only inspection commands — safe to run without a confirmation prompt. */
const SAFE_COMMAND_PATTERNS: readonly string[] = [
  'git status*',
  'git diff*',
  'git log*',
  'git branch*',
  'git show*',
  'npm run thesmos:*',
  'thesmos *',
  'node --version*',
  'npm --version*',
];

/** Shapes a derived contract refuses outright. Mirrors DANGEROUS_COMMAND_SHAPES. */
const DENIED_COMMAND_PATTERNS: readonly string[] = [
  'rm -rf*',
  'rm -fr*',
  'sudo*',
  'doas*',
  'chmod 777*',
  '* | sh*',
  '* | bash*',
  'curl * | *',
  'wget * | *',
  'git push --force*',
  'git push -f*',
  'dd *',
  'mkfs*',
  'npm publish*',
  'gh release create*',
];

// ── Permission baselines ──────────────────────────────────────────────────────

/**
 * The baseline policy for a role and mode.
 *
 * Reads resolve to `allow` only for ordinary source and docs; everything else
 * (including anything unlisted) resolves to `ask`, and secrets resolve to
 * `deny` no matter which rule also matched — that is most-restrictive-wins
 * doing its job.
 */
export function baselinePermissions(
  role: CouncilPrimaryRole,
  mode: CouncilAgentMode
): CouncilPermissionPolicy {
  const canDelegate = mode === 'primary' || mode === 'all';
  const editAsk = role === 'build' || role === 'debug' || role === 'design';

  return {
    read: [
      { decision: 'deny', patterns: [...SECRET_PATTERNS], reason: 'secrets are never readable' },
      {
        decision: 'allow',
        patterns: [...READABLE_SOURCE_PATTERNS],
        reason: 'ordinary source and documentation',
      },
    ],
    edit: [
      {
        decision: 'deny',
        patterns: [...SECRET_PATTERNS, ...PROTECTED_WRITE_PATTERNS],
        reason: 'secrets, VCS internals, dependencies, and build output are never writable',
      },
      ...(editAsk
        ? [
            {
              decision: 'ask' as const,
              patterns: [...READABLE_SOURCE_PATTERNS],
              reason: 'a derived contract may propose edits, but never writes unattended',
            },
          ]
        : []),
    ],
    shell: [
      {
        decision: 'deny',
        patterns: [...DENIED_COMMAND_PATTERNS],
        reason: 'destructive, privilege-escalating, or publishing commands',
      },
      {
        decision: 'allow',
        patterns: [...SAFE_COMMAND_PATTERNS],
        reason: 'read-only inspection',
      },
    ],
    // Unlisted channels resolve to `ask` on their own — an explicit empty list
    // is the honest representation of "this document said nothing about it".
    web: [],
    browser: [
      {
        decision: 'deny',
        patterns: ['**'],
        reason: 'browser control is not granted by a derived contract',
      },
    ],
    mcp: [],
    task: canDelegate
      ? []
      : [
          {
            decision: 'deny',
            patterns: ['**'],
            reason: 'subagents may not spawn further agents',
          },
        ],
  };
}

// ── Limit baselines ───────────────────────────────────────────────────────────

export function baselineLimits(mode: CouncilAgentMode): CouncilLimits {
  if (mode === 'all') {
    return { maximumSteps: 80, maximumChildren: 8, maximumParallelChildren: 4, timeoutMs: 900_000 };
  }
  if (mode === 'primary') {
    return { maximumSteps: 60, maximumChildren: 6, maximumParallelChildren: 3, timeoutMs: 900_000 };
  }
  return { maximumSteps: 40, maximumChildren: 0, maximumParallelChildren: 0, timeoutMs: 600_000 };
}

// ── Risk baselines ────────────────────────────────────────────────────────────

const ROLE_RISK_TIER: Readonly<Record<CouncilPrimaryRole, CouncilRisk['tier']>> = {
  build: 'medium',
  plan: 'low',
  debug: 'medium',
  review: 'low',
  security: 'high',
  design: 'low',
  growth: 'low',
  operations: 'medium',
};

export function baselineRisk(role: CouncilPrimaryRole, mode: CouncilAgentMode): CouncilRisk {
  const tier = ROLE_RISK_TIER[role];
  const elevated = tier === 'high' || tier === 'critical';
  return {
    tier,
    // Approval tracks the tier, not the role's prestige — a high-tier agent
    // stops for a human before it acts, whatever its name is.
    requiresHumanApproval: elevated,
    requiresCheckpoint: tier !== 'low',
    requiresFinalReview: elevated || mode !== 'subagent',
  };
}
