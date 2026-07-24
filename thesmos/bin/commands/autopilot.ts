// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos autopilot — autonomous plan execution with governance gates.
 *
 * Sub-commands:
 *   validate <plan>          Validate plan file, generate .review.md
 *   start <plan> [--yes]     Run the plan (requires CONFIRMED prompt)
 *   cancel                   Create sentinel file to stop the running session
 *   resume <plan>            Resume from last completed task
 *   revert [session-id]      Delete autopilot branch, archive journal
 *   open-pr [session-id]     Push branch and open a draft PR
 *   status                   Show current session state
 *   --restore-permissions    Recover leftover permission profile (crash recovery)
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createContext } from '../lib/context.js';
import { parsePlanFile } from '../../autopilot/plan-parser.js';
import {
  writePermissionProfile,
  restorePermissions,
  recoverLeftoverProfile,
} from '../../autopilot/permissions.js';
import {
  initJournal,
  appendSessionSummary,
  markPermissionsRestored,
  formatTimestamp,
} from '../../autopilot/journal.js';
import {
  createAutopilotBranch,
  createRestoreTag,
  getCurrentBranch,
  revertSession,
  pushBranch,
  createDraftPR,
  isGitRepo,
} from '../../autopilot/git-ops.js';
import {
  generateSessionId,
  saveSession,
  loadSession,
  clearSession,
  clearCancelSentinel,
  createCancelSentinel,
  isCancelRequested,
  getAutopilotDir,
  getJournalPath,
  isTaskCompleted,
} from '../../autopilot/session.js';
import { displayWarningScreen, requireConfirmation } from '../../autopilot/warnings.js';
import { executeSession } from '../../autopilot/executor.js';
import { displayStats } from '../../autopilot/calibration.js';
import { generatePlan } from '../../autopilot/generator.js';
import { reviewSession } from '../../autopilot/reviewer.js';
import type { AutopilotSession, AutopilotPlan, ParseIssue } from '../../types.js';

const DIVIDER = '━'.repeat(62);

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatIssues(issues: ParseIssue[]): string {
  const errors = issues.filter((i) => i.type === 'error');
  const warnings = issues.filter((i) => i.type === 'warning');
  const lines: string[] = [];

  if (errors.length > 0) {
    lines.push(`\nErrors (must fix before starting):`);
    for (const e of errors) lines.push(`  ✗ ${e.message}`);
  }
  if (warnings.length > 0) {
    lines.push(`\nWarnings (consider fixing):`);
    for (const w of warnings) lines.push(`  ⚠ ${w.message}`);
  }
  return lines.join('\n');
}

function generateReviewFile(planPath: string, issues: ParseIssue[], plan: AutopilotPlan | null): string {
  const lines: string[] = [
    `# MASTER_PLAN Review — Generated ${formatTimestamp()}`,
    ``,
    `Source: ${basename(planPath)}`,
    ``,
  ];

  const errors = issues.filter((i) => i.type === 'error');
  const warnings = issues.filter((i) => i.type === 'warning');

  if (errors.length === 0 && warnings.length === 0) {
    lines.push(`## ✓ Plan is valid — no issues found`);
    if (plan) {
      lines.push(``, `Tasks: ${plan.tasks.filter((t) => !t.isCheckpoint).length}`);
      lines.push(`Adapter: ${plan.adapter}`);
      lines.push(`Gates: ${plan.gates.join(', ')}`);
      lines.push(`Max retries per task: ${plan.maxRetries}`);
    }
    return lines.join('\n');
  }

  if (errors.length > 0) {
    lines.push(`## ✗ Errors — Must Fix Before Running`);
    lines.push(``);
    for (const e of errors) {
      lines.push(`### ${e.field ?? 'Issue'}`);
      lines.push(e.message);
      lines.push(``);
    }
  }

  if (warnings.length > 0) {
    lines.push(`## ⚠ Warnings — Consider Fixing`);
    lines.push(``);
    for (const w of warnings) {
      lines.push(`- ${w.message}`);
    }
    lines.push(``);
  }

  lines.push(`## How to Fix Unverifiable Done Criteria`);
  lines.push(``);
  lines.push(`Replace free-text criteria with verifiable formats:`);
  lines.push(`  ✗ "The feature works end-to-end"`);
  lines.push(`  ✓ file:src/path/to/file.ts`);
  lines.push(`  ✓ command:npm test -- src/path/to/test.ts`);
  lines.push(`  ✓ grep:src/file.ts:export function myFunction`);
  lines.push(`  ✓ no-grep:src/file.ts:localStorage`);
  lines.push(``);
  lines.push(`When all errors are resolved, run:`);
  lines.push(`  thesmos autopilot start ${basename(planPath)} --yes`);

  return lines.join('\n');
}

function buildPRDescription(session: AutopilotSession, plan: AutopilotPlan, journalPath: string): string {
  const completed = session.completedTaskIndexes.length;
  const blocked = session.blockedTasks.length;
  const total = plan.tasks.filter((t) => !t.isCheckpoint).length;

  const taskRows = plan.tasks
    .filter((t) => !t.isCheckpoint)
    .map((t) => {
      if (session.completedTaskIndexes.includes(t.index)) {
        return `| ${t.index + 1} | ${t.title} | ✓ Complete | — |`;
      }
      const block = session.blockedTasks.find((b) => b.index === t.index);
      if (block) return `| ${t.index + 1} | ${t.title} | ✗ Blocked | ${block.reason.slice(0, 60)} |`;
      if (session.timedOutTaskIndexes.includes(t.index)) {
        return `| ${t.index + 1} | ${t.title} | ⏱ Timed Out | — |`;
      }
      return `| ${t.index + 1} | ${t.title} | — Skipped | — |`;
    })
    .join('\n');

  const journal = existsSync(journalPath)
    ? readFileSync(journalPath, 'utf8').split('## Session Decision Log')[1]?.split('---')[0]?.trim() ?? ''
    : '';

  return [
    `## Autopilot Session — ${plan.project}`,
    `**Branch:** ${session.branch}`,
    `**Session:** ${session.id} | **Adapter:** ${session.adapter}`,
    `**Gates:** ${plan.gates.join(' | ')}`,
    ``,
    `---`,
    ``,
    `## Results (${completed}/${total} complete)`,
    ``,
    `| # | Task | Status | Notes |`,
    `|---|---|---|---|`,
    taskRows,
    ``,
    ...(blocked > 0 ? [`## Blocked Tasks (${blocked})`, `See session journal for full context.`, ``] : []),
    ...(journal ? [`## Key Decisions`, `\`\`\``, journal, `\`\`\``, ``] : []),
    `## Reviewer Checklist`,
    `- [ ] I have read the session journal`,
    `- [ ] I have reviewed the full diff`,
    `- [ ] I have tested the branch locally`,
    `- [ ] I have addressed any blocked tasks`,
    `- [ ] I approve merging into main`,
    ``,
    `---`,
    `*Generated by Thesmos Autopilot — this is a DRAFT PR and cannot be merged until the checklist is complete.*`,
  ].join('\n');
}

// ── Sub-command: validate ─────────────────────────────────────────────────────

async function cmdAutopilotValidate(argv: string[]): Promise<void> {
  // --example: print a copyable plan template and exit
  if (argv.includes('--example')) {
    const examplePath = join(dirname(new URL(import.meta.url).pathname), '../../../catalog/autopilot-plan.example.md');
    if (existsSync(examplePath)) {
      process.stdout.write(readFileSync(examplePath, 'utf8'));
    } else {
      process.stdout.write(EXAMPLE_PLAN_TEMPLATE);
    }
    return;
  }

  const planPath = argv[0] ?? 'MASTER_PLAN.md';
  if (!existsSync(planPath)) {
    process.stderr.write(`autopilot validate: file not found: ${planPath}\n`);
    process.exit(1);
  }

  const { plan, issues } = parsePlanFile(planPath);
  const reviewPath = planPath.replace(/\.md$/, '.review.md');

  const reviewContent = generateReviewFile(planPath, issues, plan);
  writeFileSync(reviewPath, reviewContent, 'utf8');

  const errors = issues.filter((i) => i.type === 'error');
  const warnings = issues.filter((i) => i.type === 'warning');

  process.stdout.write(`\nThesmos Autopilot — Plan Validation\n`);
  process.stdout.write(`Source: ${planPath}\n`);
  process.stdout.write(`Review: ${reviewPath}\n\n`);

  if (errors.length === 0 && warnings.length === 0) {
    process.stdout.write(`✓ Plan is valid. ${plan!.tasks.filter((t) => !t.isCheckpoint).length} tasks ready.\n\n`);
    process.stdout.write(`To start: thesmos autopilot start ${planPath} --yes\n`);
    return;
  }

  process.stdout.write(formatIssues(issues));
  process.stdout.write(`\nReview file written to: ${reviewPath}\n`);
  process.stdout.write(`Fix all errors, then run: thesmos autopilot start ${planPath} --yes\n`);

  if (errors.length > 0) process.exit(1);
}

// ── Sub-command: start ────────────────────────────────────────────────────────

async function cmdAutopilotStart(planPath: string, argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const yes = argv.includes('--yes');
  const dryRun = argv.includes('--dry-run');
  const verbose = argv.includes('--verbose');
  const reconnaissance = argv.includes('--recon');

  // Feature gate
  if (!config.autopilot?.enabled) {
    process.stderr.write(
      `[autopilot] Autopilot is disabled.\n` +
      `Set "autopilot": { "enabled": true } in .thesmos/config.json to enable it.\n`
    );
    process.exit(1);
  }

  // Recover leftover profile first (crash safety)
  recoverLeftoverProfile(root);

  // Parse and validate plan
  if (!existsSync(planPath)) {
    process.stderr.write(`autopilot start: file not found: ${planPath}\n`);
    process.exit(1);
  }

  const { plan, issues } = parsePlanFile(planPath);
  const errors = issues.filter((i) => i.type === 'error');

  if (errors.length > 0) {
    process.stderr.write(`\nPlan has ${errors.length} error${errors.length > 1 ? 's' : ''} — fix before starting:\n`);
    process.stderr.write(formatIssues(issues) + '\n');
    process.stderr.write(`Run: thesmos autopilot validate ${planPath}\n`);
    process.exit(1);
  }

  if (!isGitRepo(root)) {
    process.stderr.write(`autopilot start: not a git repository. Autopilot requires git.\n`);
    process.exit(1);
  }

  // Warning screen and CONFIRMED gate
  if (!dryRun) {
    const { canProceed } = displayWarningScreen(
      root,
      plan!,
      config.autopilot?.maxCostUSD,
      config.autopilot?.requirePluggedIn ?? false,
      { dangerouslySkipPermissions: config.autopilot?.dangerouslySkipPermissions === true },
    );

    if (!canProceed) {
      process.stdout.write('\nResolve the items above before starting autopilot.\n');
      process.exit(1);
    }

    if (!yes) {
      const confirmed = await requireConfirmation();
      if (!confirmed) {
        process.stdout.write('\nSession cancelled.\n');
        process.exit(0);
      }
    }
  }

  // Set up session
  const sessionId = generateSessionId();
  const baseBranch = getCurrentBranch(root);
  const branch = createAutopilotBranch(root, plan!.project, sessionId);
  const restoreTag = createRestoreTag(root, sessionId);
  const journalPath = getJournalPath(root, sessionId);

  // Write permission profile (eliminates VSCode prompts)
  const permProfile = dryRun ? { backupPath: null } : writePermissionProfile(root, sessionId);

  const session: AutopilotSession = {
    id: sessionId,
    planPath,
    planSlug: plan!.project,
    branch,
    restoreTag,
    startedAt: formatTimestamp(),
    adapter: plan!.adapter,
    completedTaskIndexes: [],
    blockedTasks: [],
    timedOutTaskIndexes: [],
    decisionLog: [],
    journalPath,
    permissionsBackupPath: permProfile.backupPath,
    lastTaskStash: null,
  };

  saveSession(root, session);
  initJournal(session, plan!);

  // Register graceful shutdown handlers
  const cleanup = (signal: string) => {
    process.stdout.write(`\n[autopilot] Received ${signal}. Restoring permissions and saving state...\n`);
    restorePermissions(root, session.permissionsBackupPath);
    markPermissionsRestored(session.journalPath, formatTimestamp());
    process.stdout.write(`[autopilot] Session paused. Resume with:\n  thesmos autopilot resume ${planPath}\n`);
    process.exit(0);
  };
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));

  process.stdout.write(`\n${DIVIDER}\n`);
  process.stdout.write(`Thesmos Autopilot — Session ${sessionId}\n`);
  process.stdout.write(`Branch:  ${branch}\n`);
  process.stdout.write(`Tasks:   ${plan!.tasks.filter((t) => !t.isCheckpoint).length}\n`);
  process.stdout.write(`Adapter: ${plan!.adapter}\n`);
  process.stdout.write(`Journal: ${journalPath}\n`);
  if (!dryRun) process.stdout.write(`Permissions: auto-approved for this session (profile)\n`);
  if (config.autopilot?.dangerouslySkipPermissions === true) {
    process.stdout.write(
      `Claude skip-permissions: ENABLED (dangerouslySkipPermissions=true)\n`,
    );
  } else {
    process.stdout.write(`Claude skip-permissions: off (default)\n`);
  }
  process.stdout.write(`To cancel: touch .thesmos/autopilot/.cancel\n`);
  process.stdout.write(`${DIVIDER}\n`);

  // Execute
  try {
    await executeSession(root, plan!, session, {
      dryRun,
      verbose,
      reconnaissance,
      dangerouslySkipPermissions: config.autopilot?.dangerouslySkipPermissions === true,
      httpAdapterUrl: config.autopilot?.httpAdapterUrl,
    });
  } finally {
    // Always restore permissions
    restorePermissions(root, session.permissionsBackupPath);
    markPermissionsRestored(session.journalPath, formatTimestamp());
    clearCancelSentinel(root);
  }

  // Session complete — print handoff
  const completed = session.completedTaskIndexes.length;
  const blocked = session.blockedTasks.length;
  const timedOut = session.timedOutTaskIndexes.length;
  appendSessionSummary(session.journalPath, completed, blocked, timedOut, formatTimestamp());

  process.stdout.write(`\n${DIVIDER}\n`);
  process.stdout.write(`  AUTOPILOT COMPLETE — YOUR REVIEW IS REQUIRED\n`);
  process.stdout.write(`  Nothing has been pushed. Nothing is live. main is untouched.\n`);
  process.stdout.write(`${DIVIDER}\n\n`);
  process.stdout.write(`Session:   ${sessionId}\n`);
  process.stdout.write(`Branch:    ${branch}\n`);
  process.stdout.write(`Complete:  ${completed} task${completed !== 1 ? 's' : ''}\n`);
  process.stdout.write(`Blocked:   ${blocked} task${blocked !== 1 ? 's' : ''}\n`);
  process.stdout.write(`Timed out: ${timedOut} task${timedOut !== 1 ? 's' : ''}\n`);
  process.stdout.write(`\nYour ${baseBranch} branch is untouched. This branch is local only.\n\n`);
  process.stdout.write(`REVIEW OPTIONS:\n\n`);
  process.stdout.write(`  Full diff:       git diff ${baseBranch}..${branch}\n`);
  process.stdout.write(`  Commit history:  git log ${branch}\n`);
  process.stdout.write(`  Session journal: ${journalPath}\n\n`);
  process.stdout.write(`WHEN READY:\n\n`);
  process.stdout.write(`  Merge:           git checkout ${baseBranch} && git merge ${branch}\n`);
  process.stdout.write(`  Draft PR:        thesmos autopilot open-pr ${sessionId}\n`);
  process.stdout.write(`  Discard all:     thesmos autopilot revert ${sessionId}\n\n`);
  process.stdout.write(`${DIVIDER}\n`);

  clearSession(root);
}

// ── Sub-command: resume ───────────────────────────────────────────────────────

async function cmdAutopilotResume(planPath: string, argv: string[]): Promise<void> {
  const { root, config } = createContext();

  if (!config.autopilot?.enabled) {
    process.stderr.write(`[autopilot] Autopilot is disabled in config.\n`);
    process.exit(1);
  }

  const session = loadSession(root);
  if (!session) {
    process.stderr.write(`No active session found. Start a new session with:\n  thesmos autopilot start ${planPath} --yes\n`);
    process.exit(1);
  }

  const { plan, issues } = parsePlanFile(planPath);
  if (issues.some((i) => i.type === 'error') || !plan) {
    process.stderr.write(`Plan has errors. Run: thesmos autopilot validate ${planPath}\n`);
    process.exit(1);
  }

  process.stdout.write(`\nResuming session ${session.id}\n`);
  process.stdout.write(`Branch: ${session.branch}\n`);
  process.stdout.write(`Completed: ${session.completedTaskIndexes.length} tasks\n\n`);

  // Recover permissions profile
  recoverLeftoverProfile(root);
  const permProfile = writePermissionProfile(root, session.id);
  session.permissionsBackupPath = permProfile.backupPath;
  saveSession(root, session);

  const cleanup = (signal: string) => {
    restorePermissions(root, session.permissionsBackupPath);
    markPermissionsRestored(session.journalPath, formatTimestamp());
    process.stdout.write(`\n[autopilot] ${signal} received. State saved. Resume with:\n  thesmos autopilot resume ${planPath}\n`);
    process.exit(0);
  };
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));

  const dryRun = argv.includes('--dry-run');
  const verbose = argv.includes('--verbose');
  const reconnaissance = argv.includes('--recon');

  try {
    await executeSession(root, plan, session, {
      dryRun,
      verbose,
      reconnaissance,
      dangerouslySkipPermissions: config.autopilot?.dangerouslySkipPermissions === true,
      httpAdapterUrl: config.autopilot?.httpAdapterUrl,
    });
  } finally {
    restorePermissions(root, session.permissionsBackupPath);
    markPermissionsRestored(session.journalPath, formatTimestamp());
    clearCancelSentinel(root);
  }

  const completed = session.completedTaskIndexes.length;
  const blocked = session.blockedTasks.length;
  const timedOut = session.timedOutTaskIndexes.length;
  appendSessionSummary(session.journalPath, completed, blocked, timedOut, formatTimestamp());

  process.stdout.write(`\nSession complete. ${completed} tasks done, ${blocked} blocked.\n`);
  process.stdout.write(`Review: git log ${session.branch}\n`);
  process.stdout.write(`PR: thesmos autopilot open-pr ${session.id}\n`);
  clearSession(root);
}

// ── Sub-command: cancel ───────────────────────────────────────────────────────

function cmdAutopilotCancel(): void {
  const { root } = createContext();
  createCancelSentinel(root);
  process.stdout.write(`Cancel sentinel created. The running session will stop after the current task.\n`);
  process.stdout.write(`Check status with: thesmos autopilot status\n`);
}

// ── Sub-command: revert ───────────────────────────────────────────────────────

function cmdAutopilotRevert(sessionIdArg: string | undefined): void {
  const { root } = createContext();
  const session = sessionIdArg ? null : loadSession(root);
  const sessionId = sessionIdArg ?? session?.id;

  if (!sessionId) {
    process.stderr.write(`No session ID provided and no active session found.\n`);
    process.stderr.write(`Usage: thesmos autopilot revert <session-id>\n`);
    process.exit(1);
  }

  const s = session ?? loadSession(root);
  const branch = s?.branch ?? `autopilot/*-${sessionId}`;
  const baseBranch = s ? getCurrentBranch(root) : 'main';

  process.stdout.write(`Reverting session ${sessionId}...\n`);
  try {
    revertSession(root, branch, sessionId, baseBranch);
    restorePermissions(root, s?.permissionsBackupPath ?? null);
    clearSession(root);
    clearCancelSentinel(root);
    process.stdout.write(`✓ Session reverted. Branch deleted. main is unchanged.\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Revert error: ${msg}\n`);
    process.exit(1);
  }
}

// ── Sub-command: open-pr ──────────────────────────────────────────────────────

async function cmdAutopilotOpenPR(sessionIdArg: string | undefined): Promise<void> {
  const { root } = createContext();
  const session = loadSession(root);
  const sessionId = sessionIdArg ?? session?.id;

  if (!session || !sessionId) {
    process.stderr.write(`No session found. Provide session ID: thesmos autopilot open-pr <session-id>\n`);
    process.exit(1);
  }

  const { plan } = parsePlanFile(session.planPath);
  if (!plan) {
    process.stderr.write(`Could not parse plan file: ${session.planPath}\n`);
    process.exit(1);
  }

  process.stdout.write(`\nThis will:\n`);
  process.stdout.write(`  Push   ${session.branch} → origin\n`);
  process.stdout.write(`  Create a DRAFT pull request targeting main\n`);
  process.stdout.write(`  NOT merge anything — you control the merge\n\n`);
  process.stdout.write(`Proceed? [y/N] `);

  const answer = await new Promise<string>((resolve) => {
    process.stdin.once('data', (d) => resolve(d.toString().trim()));
  });

  if (answer.toLowerCase() !== 'y') {
    process.stdout.write('Cancelled.\n');
    return;
  }

  process.stdout.write(`Pushing ${session.branch}...\n`);
  pushBranch(root, session.branch);

  const description = buildPRDescription(session, plan, session.journalPath);
  const prUrl = createDraftPR(root, session.branch, `Autopilot: ${plan.project} (${session.id})`, description);
  process.stdout.write(`\n✓ Draft PR created: ${prUrl}\n`);
  process.stdout.write(`The PR is a DRAFT and cannot be merged until you mark it ready and approve it.\n`);
}

// ── Sub-command: status ───────────────────────────────────────────────────────

function cmdAutopilotStatus(): void {
  const { root } = createContext();
  const session = loadSession(root);

  if (!session) {
    process.stdout.write(`No active autopilot session.\n`);
    return;
  }

  const cancelled = isCancelRequested(root);
  process.stdout.write(`\nActive session: ${session.id}\n`);
  process.stdout.write(`Branch:     ${session.branch}\n`);
  process.stdout.write(`Started:    ${session.startedAt}\n`);
  process.stdout.write(`Completed:  ${session.completedTaskIndexes.length} tasks\n`);
  process.stdout.write(`Blocked:    ${session.blockedTasks.length} tasks\n`);
  if (cancelled) process.stdout.write(`Status:     CANCEL PENDING (will stop after current task)\n`);
  process.stdout.write(`Journal:    ${session.journalPath}\n`);
}

// ── Sub-command: generate ─────────────────────────────────────────────────────

async function cmdAutopilotGenerate(argv: string[]): Promise<void> {
  const { root, config } = createContext();

  if (!config.autopilot?.enabled) {
    process.stderr.write(
      `[autopilot] Autopilot is disabled.\n` +
      `Set "autopilot": { "enabled": true } in .thesmos/config.json to enable it.\n`,
    );
    process.exit(1);
  }

  // Goal is everything that isn't a flag
  const goalParts = argv.filter((a) => !a.startsWith('--'));
  const goal = goalParts.join(' ').trim();

  if (!goal) {
    process.stderr.write(
      `Usage: thesmos autopilot generate "describe what you want to build"\n` +
      `Example: thesmos autopilot generate "add Stripe checkout to the Express app"\n`,
    );
    process.exit(1);
  }

  const outFlag = argv.find((a) => a.startsWith('--out='));
  const outputPath = outFlag ? outFlag.slice(6) : undefined;

  try {
    await generatePlan(root, goal, {
      outputPath,
      adapter: config.autopilot?.adapter ?? 'claude',
      verbose: argv.includes('--verbose'),
      dangerouslySkipPermissions: config.autopilot?.dangerouslySkipPermissions === true,
      httpAdapterUrl: config.autopilot?.httpAdapterUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Plan generation failed: ${msg}\n`);
    process.exit(1);
  }
}

// ── Sub-command: review ───────────────────────────────────────────────────────

async function cmdAutopilotReview(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const sessionId = argv.find((a) => !a.startsWith('--'));
  const base = argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'main';

  try {
    await reviewSession(root, sessionId, base, {
      dangerouslySkipPermissions: config.autopilot?.dangerouslySkipPermissions === true,
      httpAdapterUrl: config.autopilot?.httpAdapterUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Review failed: ${msg}\n`);
    process.exit(1);
  }
}

// ── Sub-command: stats ────────────────────────────────────────────────────────

function cmdAutopilotStats(): void {
  const { root } = createContext();
  displayStats(root);
}

// ── Sub-command: restore-permissions ─────────────────────────────────────────

function cmdRestorePermissions(): void {
  const { root } = createContext();
  const recovered = recoverLeftoverProfile(root);
  if (!recovered) {
    process.stdout.write(`No leftover autopilot permission profile found.\n`);
  }
}

// ── Example plan template (fallback when catalog file not present) ────────────

const EXAMPLE_PLAN_TEMPLATE = `---
project: My Project
adapter: claude
gates:
  - npm test
  - npm run typecheck
max_retries: 2
commit_on_pass: true
---

## Task 1: Add error boundary component

Context: The app currently crashes when child components throw. We need a reusable ErrorBoundary.
Scope: src/components/ErrorBoundary.tsx, src/components/ErrorBoundary.test.tsx
New packages allowed: none
Depends on: none
Done when:
  - file:src/components/ErrorBoundary.tsx
  - file:src/components/ErrorBoundary.test.tsx
  - command:npm test -- src/components/ErrorBoundary.test.tsx
  - grep:src/components/ErrorBoundary.tsx:componentDidCatch

---CHECKPOINT---

## Task 2: Wrap app root with ErrorBoundary

Context: Now that ErrorBoundary exists, wrap the app root so all unhandled errors are caught.
Scope: src/main.tsx
Depends on: 1
Done when:
  - grep:src/main.tsx:ErrorBoundary
  - command:npm run typecheck
`;

// ── Main dispatch ─────────────────────────────────────────────────────────────

export async function cmdAutopilot(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);

  switch (sub) {
    case 'validate':
      await cmdAutopilotValidate(rest);
      break;
    case 'start':
      await cmdAutopilotStart(rest[0] ?? 'MASTER_PLAN.md', rest.slice(1));
      break;
    case 'resume':
      await cmdAutopilotResume(rest[0] ?? 'MASTER_PLAN.md', rest.slice(1));
      break;
    case 'cancel':
      cmdAutopilotCancel();
      break;
    case 'revert':
      cmdAutopilotRevert(rest[0]);
      break;
    case 'open-pr':
      await cmdAutopilotOpenPR(rest[0]);
      break;
    case 'status':
      cmdAutopilotStatus();
      break;
    case 'stats':
      cmdAutopilotStats();
      break;
    case 'generate':
      await cmdAutopilotGenerate(rest);
      break;
    case 'review':
      await cmdAutopilotReview(rest);
      break;
    case '--restore-permissions':
      cmdRestorePermissions();
      break;
    default:
      process.stdout.write(`
Thesmos Autopilot — Autonomous Plan Execution

  DISABLED BY DEFAULT. Enable in .thesmos/config.json:
    { "autopilot": { "enabled": true } }

COMMANDS
  autopilot generate "goal"      Generate a MASTER_PLAN.md from plain English
    --out=FILENAME.md              Output path (default: MASTER_PLAN.md)
  autopilot validate <plan>      Validate plan file, generate .review.md
    --example                      Print a copyable MASTER_PLAN.md template
  autopilot start <plan>         Run the plan (prompts for CONFIRMED)
    --yes                          Skip confirmation prompt (still shows warnings)
    --dry-run                      Parse and display plan without executing
    --recon                        Enable read-only reconnaissance before each task
  autopilot resume <plan>        Resume from last completed task
    --recon                        Re-enable reconnaissance on resume
  autopilot review [session-id]  AI-generated review of the session diff
    --base=<branch>                Base branch to diff against (default: main)
  autopilot cancel               Stop the running session after current task
  autopilot status               Show current session state
  autopilot stats                Show cross-session statistics and cost calibration
  autopilot revert [session-id]  Delete autopilot branch, archive journal
  autopilot open-pr [session-id] Push branch and create a draft PR
  autopilot --restore-permissions  Recover leftover permission profile

PLAN FORMAT
  thesmos autopilot validate --example
  thesmos autopilot generate "describe what you want to build"

SAFETY GUARANTEES
  • All work happens on an isolation branch (never main)
  • Nothing is pushed without explicit human action
  • One-command revert: thesmos autopilot revert [session-id]
  • Permission prompts auto-approved during session, restored on exit
  • Session state preserved for resume if interrupted
  • Per-repo convention learning improves every session
`);
  }
}
