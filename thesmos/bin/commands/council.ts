// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Contract inspection:
 *   thesmos agent:show <agent-id> [--json] [--markdown]
 *   thesmos agent:validate <agent-id> [--json]
 *   thesmos agents:validate [--json] [--role=<role>] [--migration]
 *
 * All three are read-only, so none of them prompts for confirmation.
 *
 * Exit codes:
 *   0 — valid (warnings do not fail a gate)
 *   1 — usage error, or unknown agent
 *   2 — safety-critical contract errors
 *
 * What these commands deliberately do not print: agent prompt bodies. Contract
 * inspection is metadata inspection. Dumping instructions into a terminal is
 * how a roster ends up pasted into a model's context, which is the exact cost
 * Operation Signal removed.
 */

import { createContext } from '../lib/context.ts';
import { flag, flagVal, parseArgs } from '../lib/args.ts';
import {
  findContract,
  loadCouncilContracts,
  type CouncilLoadResult,
} from '../../council/load.ts';
import {
  COUNCIL_PRIMARY_ROLES,
  isCouncilPrimaryRole,
  serializeContract,
  serializeStable,
  type CouncilAgentContract,
  type CouncilPrimaryRole,
} from '../../council/contract.ts';
import { formatValidationResult, validateContract, validateContracts } from '../../council/validate.ts';
import { summarizePolicy } from '../../council/permissions.ts';
import { COUNCIL_ROLE_DEFINITIONS, roleDefinition } from '../../council/roles.ts';

// ── Shared ────────────────────────────────────────────────────────────────────

function load(): CouncilLoadResult & { root: string } {
  const { root } = createContext();
  return { root, ...loadCouncilContracts({ root }) };
}

function fail(message: string, usage: string): never {
  process.stderr.write(`\n  ${message}\n\n  ${usage}\n\n`);
  process.exit(1);
}

// ── agent:show ────────────────────────────────────────────────────────────────

export async function cmdAgentShow(argv: string[]): Promise<void> {
  const { flags, positionals } = parseArgs(argv);
  const agentId = positionals[0];
  if (!agentId) {
    fail('agent:show requires an agent id.', 'thesmos agent:show <agent-id> [--json] [--markdown]');
  }

  const { contracts, notesByAgent } = load();
  const contract = findContract(contracts, agentId);
  if (!contract) {
    fail(
      `Unknown agent "${agentId}".`,
      'Run `thesmos agents:list` to see routable agent ids.'
    );
  }

  const validation = validateContract(contract);

  if (flag(flags, 'json')) {
    process.stdout.write(
      serializeStable(
        {
          contract,
          validation,
          compilationNotes: notesByAgent[contract.identity.id] ?? [],
        },
        2
      ) + '\n'
    );
    return;
  }

  if (flag(flags, 'markdown')) {
    process.stdout.write(renderContractMarkdown(contract, validation.valid) + '\n');
    return;
  }

  const role = roleDefinition(contract.classification.primaryRole);
  const lines: string[] = [
    '',
    `  ${contract.identity.displayName}`,
    `  ${contract.identity.description}`,
    '',
    `  id            ${contract.identity.id}`,
    `  version       ${contract.identity.version}`,
    `  role          ${role.title} (${contract.classification.primaryRole})`,
    `  mode          ${contract.classification.mode}${contract.classification.hidden ? ' · hidden from the role selector' : ''}`,
    ...(contract.identity.mythicIdentity ? [`  mythic        ${contract.identity.mythicIdentity}`] : []),
    `  domains       ${contract.classification.domains.join(', ') || '—'}`,
    `  capabilities  ${contract.classification.capabilities.join(', ') || '—'}`,
    '',
    `  model         ${contract.modelPolicy.preferredProfiles.join(', ') || 'no preference declared'}`,
    ...(contract.modelPolicy.allowedProviders?.length
      ? [`  providers +   ${contract.modelPolicy.allowedProviders.join(', ')}`]
      : []),
    ...(contract.modelPolicy.deniedProviders?.length
      ? [`  providers -   ${contract.modelPolicy.deniedProviders.join(', ')}`]
      : []),
    '',
    '  permissions   (unlisted targets always resolve to ask)',
  ];

  for (const summary of summarizePolicy(contract.permissions)) {
    lines.push(
      `    ${summary.channel.padEnd(8)} allow ${String(summary.allow).padStart(3)} · ask ${String(summary.ask).padStart(3)} · deny ${String(summary.deny).padStart(3)}`
    );
  }

  lines.push(
    '',
    `  writable      ${contract.scope.writablePaths.join(', ') || 'nothing without confirmation'}`,
    `  forbidden     ${contract.scope.forbiddenPaths.length} pattern(s)`,
    '',
    `  limits        ${contract.limits.maximumSteps} steps · ${contract.limits.maximumChildren} children · ${contract.limits.maximumParallelChildren} parallel`,
    `  risk          ${contract.risk.tier}${contract.risk.requiresHumanApproval ? ' · human approval required' : ''}${contract.risk.requiresCheckpoint ? ' · checkpointed' : ''}${contract.risk.requiresFinalReview ? ' · final review' : ''}`,
    '',
    `  evidence      ${contract.evidence.required.join(', ')}`,
    `  handoff       ${contract.handoff.schema} (${contract.handoff.requiredFields.length} required fields)`,
    '',
    `  source        ${contract.provenance.sourcePath}`,
    `  ownership     ${contract.provenance.ownership} · owner ${contract.provenance.owner}`,
    `  hash          ${contract.provenance.contentHash}`,
    `  derivation    ${contract.provenance.derivation}${contract.completeness.complete ? '' : ` (${contract.completeness.derivedFields.length} field(s) from the role baseline)`}`,
    '',
    `  validation    ${validation.valid ? 'valid' : 'INVALID'} — ${validation.issues.length} issue(s)`,
    ''
  );

  process.stdout.write(lines.join('\n'));
}

function renderContractMarkdown(contract: CouncilAgentContract, valid: boolean): string {
  const role = roleDefinition(contract.classification.primaryRole);
  return [
    `# ${contract.identity.displayName}`,
    '',
    contract.identity.description,
    '',
    `- **Role:** ${role.title} (\`${contract.classification.primaryRole}\`)`,
    `- **Mode:** \`${contract.classification.mode}\`${contract.classification.hidden ? ' (specialist — hidden from the default selector)' : ''}`,
    `- **Risk:** \`${contract.risk.tier}\`${contract.risk.requiresHumanApproval ? ', human approval required' : ''}`,
    `- **Limits:** ${contract.limits.maximumSteps} steps, ${contract.limits.maximumChildren} children (${contract.limits.maximumParallelChildren} parallel)`,
    `- **Evidence required:** ${contract.evidence.required.map((e) => `\`${e}\``).join(', ')}`,
    `- **Source:** \`${contract.provenance.sourcePath}\` (${contract.provenance.ownership})`,
    `- **Contract:** schema ${contract.schemaVersion}, ${contract.provenance.derivation}, ${valid ? 'valid' : 'invalid'}`,
    '',
  ].join('\n');
}

// ── agent:validate ────────────────────────────────────────────────────────────

export async function cmdAgentValidate(argv: string[]): Promise<void> {
  const { flags, positionals } = parseArgs(argv);
  const agentId = positionals[0];
  if (!agentId) {
    fail('agent:validate requires an agent id.', 'thesmos agent:validate <agent-id> [--json]');
  }

  const { contracts } = load();
  const contract = findContract(contracts, agentId);
  if (!contract) {
    fail(`Unknown agent "${agentId}".`, 'Run `thesmos agents:list` to see routable agent ids.');
  }

  const result = validateContract(contract);
  if (flag(flags, 'json')) {
    process.stdout.write(serializeStable({ agentId: contract.identity.id, ...result }, 2) + '\n');
  } else {
    process.stdout.write(`\n${formatValidationResult(result, contract.identity.id)}\n\n`);
  }
  if (!result.valid) process.exit(2);
}

// ── agents:validate ───────────────────────────────────────────────────────────

export async function cmdAgentsValidate(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const migration = flag(flags, 'migration');
  const roleFilter = flagVal(flags, 'role');

  if (roleFilter !== undefined && !isCouncilPrimaryRole(roleFilter)) {
    fail(
      `Unknown role "${roleFilter}".`,
      `Roles: ${COUNCIL_PRIMARY_ROLES.join(', ')}`
    );
  }

  const { contracts, unreadable } = load();
  const selected = roleFilter
    ? contracts.filter((c) => c.classification.primaryRole === roleFilter)
    : contracts;

  const result = validateContracts(selected);
  const errors = result.issues.filter((i) => i.severity === 'error');

  if (migration) {
    const report = buildMigrationReport(selected);
    if (json) {
      process.stdout.write(serializeStable({ ...result, migration: report, unreadable }, 2) + '\n');
    } else {
      process.stdout.write(formatMigrationReport(report));
    }
    // A migration report is a plan, not a gate — it never changes the exit code
    // on its own, and it writes nothing.
    if (errors.length > 0) process.exit(2);
    return;
  }

  if (json) {
    process.stdout.write(serializeStable({ ...result, unreadable }, 2) + '\n');
  } else {
    const warnings = result.issues.length - errors.length;
    process.stdout.write(
      [
        '',
        `  ${selected.length} contract(s) validated${roleFilter ? ` in role "${roleFilter}"` : ''}.`,
        `  ${errors.length} error(s), ${warnings} warning(s).`,
        '',
      ].join('\n')
    );
    for (const issue of errors.slice(0, 50)) {
      process.stdout.write(`  ERROR   ${issue.code}\n          ${issue.path}: ${issue.message}\n`);
      if (issue.remediation) process.stdout.write(`          fix: ${issue.remediation}\n`);
    }
    if (errors.length > 50) {
      process.stdout.write(`\n  … ${errors.length - 50} further error(s) — run with --json for the full list.\n`);
    }
    if (unreadable.length > 0) {
      process.stdout.write(`\n  ${unreadable.length} document(s) could not be read.\n`);
    }
    process.stdout.write('\n');
  }

  if (errors.length > 0) process.exit(2);
}

// ── Migration report (read-only) ──────────────────────────────────────────────

export interface CouncilMigrationReport {
  total: number;
  explicit: number;
  compatibility: number;
  /** Agents still on baseline metadata, and which fields they would declare. */
  pending: Array<{ agentId: string; role: CouncilPrimaryRole; derivedFields: string[] }>;
  /** How often each field falls back, so the migration can be batched sensibly. */
  fieldCounts: Array<{ field: string; count: number }>;
}

/**
 * What is left to migrate, computed rather than estimated. Read-only by
 * construction: no writes, no `--dry-run` flag needed, nothing to roll back.
 */
export function buildMigrationReport(
  contracts: readonly CouncilAgentContract[]
): CouncilMigrationReport {
  const pending = contracts
    .filter((c) => !c.completeness.complete)
    .map((c) => ({
      agentId: c.identity.id,
      role: c.classification.primaryRole,
      derivedFields: [...c.completeness.derivedFields].sort(),
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  const counts = new Map<string, number>();
  for (const entry of pending) {
    for (const field of entry.derivedFields) {
      counts.set(field, (counts.get(field) ?? 0) + 1);
    }
  }

  return {
    total: contracts.length,
    explicit: contracts.length - pending.length,
    compatibility: pending.length,
    pending,
    fieldCounts: [...counts.entries()]
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field)),
  };
}

function formatMigrationReport(report: CouncilMigrationReport): string {
  const lines = [
    '',
    '  Council Contract migration status',
    '',
    `  ${report.total} contract(s): ${report.explicit} fully declared, ${report.compatibility} on baseline metadata.`,
    '',
  ];
  if (report.fieldCounts.length > 0) {
    lines.push('  Fields still derived from the role baseline:', '');
    for (const { field, count } of report.fieldCounts) {
      lines.push(`    ${String(count).padStart(4)}  ${field}`);
    }
    lines.push('');
    lines.push('  Declare these with `council_*` frontmatter keys to replace the');
    lines.push('  conservative baseline with the author’s intent. Nothing is rewritten');
    lines.push('  automatically — agent documents stay hand-authored.');
    lines.push('');
  }
  return lines.join('\n');
}

// ── Role listings (used by agents:list) ───────────────────────────────────────

export interface PrimaryRoleRow {
  role: CouncilPrimaryRole;
  title: string;
  summary: string;
  leadAgentId: string;
  leadDisplayName: string;
  /** Specialists routable behind this role. */
  specialistCount: number;
  /** False when the lead is not installed in this repo. */
  available: boolean;
}

export function buildPrimaryRoleRows(
  contracts: readonly CouncilAgentContract[]
): PrimaryRoleRow[] {
  return COUNCIL_ROLE_DEFINITIONS.map((definition) => {
    const inRole = contracts.filter((c) => c.classification.primaryRole === definition.role);
    return {
      role: definition.role,
      title: definition.title,
      summary: definition.summary,
      leadAgentId: definition.leadAgentId,
      leadDisplayName: definition.leadDisplayName,
      specialistCount: inRole.filter((c) => c.classification.hidden).length,
      available: contracts.some((c) => c.identity.id === definition.leadAgentId),
    };
  });
}

export function formatPrimaryRoles(rows: readonly PrimaryRoleRow[]): string {
  const lines = ['', '  ROLE         LEAD            SPECIALISTS  SUMMARY', ''];
  for (const row of rows) {
    const lead = row.available ? row.leadDisplayName : `${row.leadDisplayName} (not installed)`;
    lines.push(
      `  ${row.title.padEnd(12)} ${lead.padEnd(15)} ${String(row.specialistCount).padStart(11)}  ${row.summary}`
    );
  }
  lines.push('', '  Pick a role, or name a specialist directly: `thesmos agent:show <agent-id>`.', '');
  return lines.join('\n');
}

export interface SpecialistRow {
  agentId: string;
  displayName: string;
  role: CouncilPrimaryRole;
  mode: string;
  ownership: string;
  riskTier: string;
}

export function buildSpecialistRows(
  contracts: readonly CouncilAgentContract[],
  roleFilter?: CouncilPrimaryRole
): SpecialistRow[] {
  return contracts
    .filter((c) => c.classification.hidden)
    .filter((c) => !roleFilter || c.classification.primaryRole === roleFilter)
    .map((c) => ({
      agentId: c.identity.id,
      displayName: c.identity.displayName,
      role: c.classification.primaryRole,
      mode: c.classification.mode,
      ownership: c.provenance.ownership,
      riskTier: c.risk.tier,
    }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.agentId.localeCompare(b.agentId));
}

export function formatSpecialists(rows: readonly SpecialistRow[]): string {
  const lines = ['', '  AGENT                          ROLE         MODE      OWNERSHIP  RISK', ''];
  for (const row of rows) {
    lines.push(
      `  ${row.agentId.padEnd(30)} ${row.role.padEnd(12)} ${row.mode.padEnd(9)} ${row.ownership.padEnd(10)} ${row.riskTier}`
    );
  }
  lines.push('', `  ${rows.length} specialist(s). Full detail: \`thesmos agent:show <agent-id>\`.`, '');
  return lines.join('\n');
}

/** Contract-shaped JSON for `agents:list --primary|--specialists --json`. */
export function serializeRoleListing(value: unknown): string {
  return serializeStable(value, 2);
}

/** Re-exported so callers do not need a second import path. */
export { serializeContract };
