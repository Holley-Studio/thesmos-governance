// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph inspection:
 *   thesmos mission:plan <spec.json> [--json]
 *   thesmos mission:show <spec.json> [--json] [--markdown]
 *   thesmos mission:validate <spec.json> [--json]
 *
 * All three are read-only and none of them executes a mission. Planning,
 * binding, and the *declared* policies on either side are the whole surface: a
 * mission is shown here, never run. Execution needs a real agent behind the
 * `TaskRunner` seam, which is a later PR, and a command that pretended to
 * execute by driving a stub runner would report work that never happened.
 *
 * These commands deliberately do not report effective authority. A permission
 * decision is resolved per concrete `(channel, target)` from the mission
 * envelope and the agent policy together, so it exists only once an action is
 * actually requested. Counting rules on either side cannot answer it, and a
 * number that looked like an answer would be worse than no number at all.
 *
 * Exit codes:
 *   0 — the mission is valid (warnings do not fail a gate)
 *   1 — usage error, or an unreadable/unparseable spec
 *   2 — the mission is invalid (bad graph, unknown agent, breached ceiling)
 *
 * What these commands deliberately do not print: agent prompt bodies, the
 * roster, or the absolute path of anything. Mission inspection is metadata
 * inspection — the same boundary `agent:show` holds, for the same reason.
 */

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createContext } from '../lib/context.ts';
import { flag, parseArgs } from '../lib/args.ts';
import { loadCouncilContracts } from '../../council/load.ts';
import { serializeStable, type CouncilAgentContract } from '../../council/contract.ts';
import { summarizePolicy } from '../../council/permissions.ts';
import { scrubForOutput, stripControlChars, toProvenancePath } from '../../council/sanitize.ts';
import { createMission } from '../../mission/create.ts';
import { bindMission } from '../../mission/authority.ts';
import {
  hasErrors,
  sortMissionIssues,
  type Mission,
  type MissionIssue,
  type TaskBinding,
} from '../../mission/types.ts';

/**
 * A mission spec is a hand-authored description, not a data feed. Anything
 * larger than this is a mistake worth naming rather than parsing.
 */
export const MAX_SPEC_BYTES = 1_048_576;

// ── Shared ────────────────────────────────────────────────────────────────────

function fail(message: string, usage: string): never {
  process.stderr.write(`\n  ${message}\n\n  ${usage}\n\n`);
  process.exit(1);
}

interface LoadedMission {
  root: string;
  mission?: Mission;
  bindings: TaskBinding[];
  issues: MissionIssue[];
  contracts: readonly CouncilAgentContract[];
  /** Repo-relative, so no machine path reaches output. */
  specPath: string;
}

/**
 * Read a spec, build the mission, and bind it to the roster.
 *
 * Returns issues rather than throwing so every problem with a spec is
 * reportable at once. Only genuinely unusable input — missing file, unreadable
 * file, malformed JSON — exits early, because there is no mission to report on.
 */
function loadMission(specArg: string | undefined, usage: string): LoadedMission {
  if (!specArg) fail('a mission spec path is required.', usage);

  const { root } = createContext();
  const abs = isAbsolute(specArg) ? specArg : resolve(root, specArg);
  const specPath = toProvenancePath(abs, root);

  let raw: string;
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) fail(`"${specPath}" is not a file.`, usage);
    if (stat.size > MAX_SPEC_BYTES) {
      fail(`"${specPath}" is ${stat.size} bytes, over the ${MAX_SPEC_BYTES}-byte limit.`, usage);
    }
    raw = readFileSync(abs, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      fail(`no mission spec at "${specPath}".`, usage);
    }
    fail(`could not read "${specPath}".`, usage);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // V8 quotes a window of the offending input in its message, so spec content
    // reaches stderr and from there a CI log. `scrubForOutput` removes secrets
    // and absolute paths but leaves control bytes intact, and an escape
    // sequence echoed to a terminal is its own problem — so strip those too.
    const detail =
      error instanceof Error
        ? stripControlChars(scrubForOutput(error.message, root))
        : 'invalid JSON';
    fail(`"${specPath}" is not valid JSON — ${detail}`, usage);
  }

  const created = createMission(parsed as Parameters<typeof createMission>[0]);
  const { contracts } = loadCouncilContracts({ root });

  if (!created.mission) {
    return { root, bindings: [], issues: created.issues, contracts, specPath };
  }

  const bound = bindMission(created.mission, contracts);
  return {
    root,
    mission: created.mission,
    bindings: bound.bindings,
    issues: sortMissionIssues([...created.issues, ...bound.issues]),
    contracts,
    specPath,
  };
}

function severityMark(issue: MissionIssue): string {
  return issue.severity === 'error' ? '✖' : '⚠';
}

/** Examples shown before a repeated issue is collapsed to a count. */
const ISSUE_EXAMPLES = 2;

/**
 * Print issues, collapsing repeats.
 *
 * `detectPermissionEscalation` reports per *pattern*, which is right for a
 * validator and unusable for a plan: a three-task mission against the shipped
 * roster produces 84 warnings, one per glob. A surface that prints all of them
 * teaches people to skip warnings, which costs more than the detail is worth.
 *
 * Repeats are grouped by (code, path), a couple of examples are shown, and the
 * remainder becomes a count. `--json` is unaffected and still carries every
 * issue individually.
 */
function printIssues(issues: readonly MissionIssue[], root: string): void {
  if (issues.length === 0) return;

  const groups = new Map<string, MissionIssue[]>();
  for (const issue of issues) {
    // A serialized tuple, not a delimited string — an issue path is arbitrary
    // text and any single-character delimiter could appear inside it.
    const key = JSON.stringify([issue.code, issue.path]);
    const bucket = groups.get(key);
    if (bucket) bucket.push(issue);
    else groups.set(key, [issue]);
  }

  process.stdout.write('\n');
  for (const bucket of groups.values()) {
    const head = bucket[0] as MissionIssue;
    const suffix = bucket.length > 1 ? `  (${bucket.length}×)` : '';
    process.stdout.write(`  ${severityMark(head)} ${head.code}  ${head.path}${suffix}\n`);

    for (const issue of bucket.slice(0, ISSUE_EXAMPLES)) {
      process.stdout.write(`      ${scrubForOutput(issue.message, root)}\n`);
    }
    if (bucket.length > ISSUE_EXAMPLES) {
      process.stdout.write(
        `      … and ${bucket.length - ISSUE_EXAMPLES} more — use --json for the full list\n`
      );
    }
    if (head.remediation) {
      process.stdout.write(`      → ${scrubForOutput(head.remediation, root)}\n`);
    }
  }
}

/** Exit 2 for an invalid mission, 0 otherwise. Warnings never gate. */
function exitForIssues(issues: readonly MissionIssue[]): never {
  process.exit(hasErrors(issues) ? 2 : 0);
}

// ── mission:plan ──────────────────────────────────────────────────────────────

const PLAN_USAGE = 'thesmos mission:plan <spec.json> [--json]';

export async function cmdMissionPlan(argv: string[]): Promise<void> {
  const { flags, positionals } = parseArgs(argv);
  const loaded = loadMission(positionals[0], PLAN_USAGE);
  const { mission, issues, root } = loaded;

  if (flag(flags, 'json')) {
    process.stdout.write(
      serializeStable({
        spec: loaded.specPath,
        missionId: mission?.id ?? null,
        goal: mission?.goal ?? null,
        order: mission?.graph.order ?? [],
        layers: mission?.graph.layers ?? [],
        valid: !hasErrors(issues),
        issues,
      }) + '\n'
    );
    exitForIssues(issues);
  }

  if (!mission) {
    process.stdout.write(`\n  Mission spec ${loaded.specPath} could not be planned.\n`);
    printIssues(issues, root);
    process.stdout.write('\n');
    exitForIssues(issues);
  }

  process.stdout.write(`\n  ⚡ MISSION  ${mission.id}\n`);
  process.stdout.write(`     ${scrubForOutput(mission.goal, root)}\n\n`);
  process.stdout.write(`  order   ${mission.graph.order.join(' → ')}\n`);
  process.stdout.write(
    `  layers  ${mission.graph.layers.map((l) => `[${l.join(' ')}]`).join(' ')}\n`
  );
  process.stdout.write(
    `  tasks   ${mission.graph.tasks.length} · steps ≤ ${mission.limits.maximumSteps} · ` +
      `parallel ≤ ${mission.limits.maximumParallelChildren}\n`
  );

  printIssues(issues, root);
  process.stdout.write('\n');
  exitForIssues(issues);
}

// ── mission:show ──────────────────────────────────────────────────────────────

const SHOW_USAGE = 'thesmos mission:show <spec.json> [--json] [--markdown]';

/**
 * Per-task view: what a task is bound to, and what its agent *declares*.
 *
 * `agentPolicy` is deliberately named for what it is. It counts the rules in
 * the agent's own contract — not the task's effective authority, which is
 * resolved per concrete `(channel, target)` from the intersection of the
 * mission envelope and the agent policy.
 *
 * The two are routinely different, and the default case is the widest gap:
 * every agent baseline grants `read: allow` over ordinary source, while a
 * mission that declares no permissions resolves every lookup to `ask`. A large
 * agent allow count under a heading like "authority" would therefore assert
 * something the runtime disagrees with.
 *
 * No effective allow count is derived here. Effective permission is
 * target-specific, so no count over abstract glob patterns can answer it, and
 * inventing one would trade a visible unknown for an invisible wrong number.
 */
function taskViews(loaded: LoadedMission): Array<{
  taskId: string;
  agentId: string;
  role: string;
  dependsOn: string[];
  depth: number;
  limits: { maximumSteps: number; maximumChildren: number; maximumParallelChildren: number };
  agentPolicy: ReturnType<typeof summarizePolicy>;
  escalations: number;
}> {
  return loaded.bindings.map((b) => ({
    taskId: b.task.id,
    agentId: b.contract.identity.id,
    role: b.contract.classification.primaryRole,
    dependsOn: b.task.dependsOn,
    depth: b.task.depth,
    limits: {
      maximumSteps: b.limits.maximumSteps,
      maximumChildren: b.limits.maximumChildren,
      maximumParallelChildren: b.limits.maximumParallelChildren,
    },
    agentPolicy: summarizePolicy(b.contract.permissions),
    escalations: b.escalations.length,
  }));
}

/** Rule counts declared by the mission itself — the ceiling, not the result. */
function missionPolicyView(mission: Mission | undefined): ReturnType<typeof summarizePolicy> {
  return mission ? summarizePolicy(mission.permissions) : [];
}

/** `edit(1a/0?/3d)` — a compact rule-count summary, never a decision. */
function formatPolicy(summary: ReturnType<typeof summarizePolicy>): string {
  const declared = summary.filter((c) => c.allow > 0 || c.ask > 0 || c.deny > 0);
  if (declared.length === 0) return 'no declared rules — every target resolves to ask';
  return declared.map((c) => `${c.channel}(${c.allow}a/${c.ask}?/${c.deny}d)`).join(' ');
}

export async function cmdMissionShow(argv: string[]): Promise<void> {
  const { flags, positionals } = parseArgs(argv);
  const loaded = loadMission(positionals[0], SHOW_USAGE);
  const { mission, issues, root } = loaded;
  const views = taskViews(loaded);

  if (flag(flags, 'json')) {
    process.stdout.write(
      serializeStable({
        spec: loaded.specPath,
        missionId: mission?.id ?? null,
        goal: mission?.goal ?? null,
        order: mission?.graph.order ?? [],
        layers: mission?.graph.layers ?? [],
        // Declared rule counts, kept apart on purpose. Neither is a resolved
        // decision; effective authority is per concrete (channel, target).
        missionPolicy: missionPolicyView(mission),
        tasks: views,
        valid: !hasErrors(issues),
        issues,
      }) + '\n'
    );
    exitForIssues(issues);
  }

  if (flag(flags, 'markdown')) {
    process.stdout.write(`# Mission — ${mission ? scrubForOutput(mission.goal, root) : 'invalid'}\n\n`);
    if (mission) {
      process.stdout.write(`**Id:** \`${mission.id}\`\n\n`);
      process.stdout.write(`**Order:** ${mission.graph.order.join(' → ')}\n\n`);
      process.stdout.write(`**Mission envelope:** ${formatPolicy(missionPolicyView(mission))}\n\n`);
      process.stdout.write(
        '_Declared rules only. Effective authority is resolved per concrete action._\n\n'
      );
      process.stdout.write('| Task | Agent | Role | Steps | Children | Agent policy | Escalations |\n');
      process.stdout.write('|---|---|---|---|---|---|---|\n');
      for (const v of views) {
        process.stdout.write(
          `| ${v.taskId} | ${v.agentId} | ${v.role} | ${v.limits.maximumSteps} | ` +
            `${v.limits.maximumChildren} | ${formatPolicy(v.agentPolicy)} | ${v.escalations} |\n`
        );
      }
    }
    printIssues(issues, root);
    process.stdout.write('\n');
    exitForIssues(issues);
  }

  if (!mission) {
    process.stdout.write(`\n  Mission spec ${loaded.specPath} could not be planned.\n`);
    printIssues(issues, root);
    process.stdout.write('\n');
    exitForIssues(issues);
  }

  process.stdout.write(`\n  ⚡ MISSION  ${mission.id}\n`);
  process.stdout.write(`     ${scrubForOutput(mission.goal, root)}\n\n`);
  process.stdout.write(`  order   ${mission.graph.order.join(' → ')}\n`);
  process.stdout.write(`  mission envelope  ${formatPolicy(missionPolicyView(mission))}\n\n`);

  for (const v of views) {
    process.stdout.write(`  ▸ ${v.taskId}  →  ${v.agentId}  (${v.role})\n`);
    process.stdout.write(
      `      depends ${v.dependsOn.length > 0 ? v.dependsOn.join(', ') : '—'}` +
        `  ·  depth ${v.depth}\n`
    );
    process.stdout.write(
      `      limits  steps ≤ ${v.limits.maximumSteps}` +
        `  ·  children ≤ ${v.limits.maximumChildren}\n`
    );
    process.stdout.write(`      agent policy  ${formatPolicy(v.agentPolicy)}\n`);
    if (v.escalations > 0) {
      process.stdout.write(`      ⚠ ${v.escalations} rule(s) claim more than the mission grants\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(
    `  Counts above are declared rules, not decisions. Effective authority is\n` +
      `  resolved per concrete action from the mission envelope and the agent\n` +
      `  policy together, so no action shown here has been authorized yet.\n` +
      `  Run \`thesmos mission:validate\` to gate on the mission itself.\n`
  );

  printIssues(issues, root);
  process.stdout.write('\n');
  exitForIssues(issues);
}

// ── mission:validate ──────────────────────────────────────────────────────────

const VALIDATE_USAGE = 'thesmos mission:validate <spec.json> [--json]';

export async function cmdMissionValidate(argv: string[]): Promise<void> {
  const { flags, positionals } = parseArgs(argv);
  const loaded = loadMission(positionals[0], VALIDATE_USAGE);
  const { mission, issues, root } = loaded;
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (flag(flags, 'json')) {
    process.stdout.write(
      serializeStable({
        spec: loaded.specPath,
        missionId: mission?.id ?? null,
        valid: errors.length === 0,
        errors: errors.length,
        warnings: warnings.length,
        issues,
      }) + '\n'
    );
    exitForIssues(issues);
  }

  process.stdout.write(
    `\n  ${loaded.specPath} — ${errors.length === 0 ? 'valid' : 'invalid'}` +
      `  (${errors.length} error${errors.length === 1 ? '' : 's'}, ` +
      `${warnings.length} warning${warnings.length === 1 ? '' : 's'})\n`
  );
  printIssues(issues, root);
  process.stdout.write('\n');
  exitForIssues(issues);
}
