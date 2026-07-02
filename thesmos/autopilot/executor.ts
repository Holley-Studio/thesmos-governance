// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Autopilot task execution loop.
 *
 * For each task in the plan:
 *  1. Check for cancel sentinel
 *  2. If checkpoint: write journal entry, pause, exit cleanly
 *  3. Stash pre-task state (for clean restart on interruption)
 *  4. [Phase 2] Run reconnaissance (read-only pre-task analysis)
 *  5. Build task prompt with conventions context + recon report
 *  6. Execute via adapter with timeout
 *  7. Run scope audit and package audit
 *  8. Run all gate commands
 *  9. Verify done criteria
 * 10. If all pass: commit, update journal, update session, update conventions
 * 11. If any fail: check for loop, retry with enriched prompt
 * 12. After max retries: mark BLOCKED, pop stash, continue
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutopilotPlan, AutopilotSession, AutopilotTask } from '../types.js';
import {
  stashPreTask,
  popStash,
  dropStash,
  commitTask,
  auditUncommittedPackages,
  getChangedFilesSinceLastCommit,
} from './git-ops.js';
import {
  appendTaskEntry,
  appendCheckpointEntry,
  appendDecisionLogEntry,
  formatTimestamp,
  type GateResult,
  type DoneCriterionResult,
  type JournalTaskEntry,
} from './journal.js';
import {
  isCancelRequested,
  isTaskCompleted,
  markTaskComplete,
  markTaskBlocked,
  addDecision,
  saveSession,
  getTaskLogPath,
} from './session.js';
import { createAdapter } from './adapters.js';
import {
  loadConventions,
  buildConventionContext,
  extractPatternFromDecision,
  mergePatterns,
  updateConventions,
} from './conventions.js';
import {
  runReconnaissance,
  buildReconContext,
  type ReconReport,
} from './recon.js';
import { extractFiredRulesFromJournal } from './calibration.js';

// ── Gate runner ───────────────────────────────────────────────────────────────

function runGate(root: string, gate: string): GateResult {
  try {
    const parts = gate.split(' ');
    const cmd = parts[0]!;
    const args = parts.slice(1);
    execFileSync(cmd, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000 });
    return { gate, passed: true, output: '' };
  } catch (err) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr;
    const stdout = (err as NodeJS.ErrnoException & { stdout?: Buffer }).stdout;
    const output = [stderr?.toString() ?? '', stdout?.toString() ?? ''].filter(Boolean).join('\n');
    return { gate, passed: false, output: output.slice(0, 2000) };
  }
}

// ── Done criteria verifier ────────────────────────────────────────────────────

function verifyDoneCriteria(root: string, task: AutopilotTask): DoneCriterionResult[] {
  return task.doneCriteria.map((criterion) => {
    try {
      switch (criterion.type) {
        case 'file_exists': {
          const passed = existsSync(join(root, criterion.value));
          return { criterion: criterion.raw, passed };
        }
        case 'command_passes': {
          const parts = criterion.value.split(' ');
          execFileSync(parts[0]!, parts.slice(1), { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
          return { criterion: criterion.raw, passed: true };
        }
        case 'grep_matches': {
          const [filePath, ...patternParts] = criterion.value.split(':');
          const pattern = patternParts.join(':');
          const content = readFileSync(join(root, filePath!.trim()), 'utf8');
          const passed = content.includes(pattern.trim());
          return { criterion: criterion.raw, passed };
        }
        case 'grep_not_matches': {
          const [filePath, ...patternParts] = criterion.value.split(':');
          const pattern = patternParts.join(':');
          const content = readFileSync(join(root, filePath!.trim()), 'utf8');
          const passed = !content.includes(pattern.trim());
          return { criterion: criterion.raw, passed };
        }
        default:
          return { criterion: criterion.raw, passed: false };
      }
    } catch {
      return { criterion: criterion.raw, passed: false };
    }
  });
}

// ── Loop detection ────────────────────────────────────────────────────────────

interface RetryState {
  previousGateOutput: string;
  previousChangedFiles: string[];
  loopCount: number;
}

function detectLoop(currentGateOutput: string, currentFiles: string[], state: RetryState): boolean {
  if (state.previousGateOutput === '' && state.previousChangedFiles.length === 0) return false;
  const sameOutput = currentGateOutput === state.previousGateOutput && currentGateOutput !== '';
  const sameFiles =
    state.previousChangedFiles.length > 0 &&
    currentFiles.length === state.previousChangedFiles.length &&
    currentFiles.every((f) => state.previousChangedFiles.includes(f));
  return sameOutput && sameFiles;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildTaskPrompt(
  task: AutopilotTask,
  plan: AutopilotPlan,
  session: AutopilotSession,
  conventionContext: string,
  reconReport: ReconReport | null,
  retryContext?: { gateResults: GateResult[]; loopDetected: boolean; previousSummary?: string },
): string {
  const taskNum = task.index + 1;
  const totalTasks = plan.tasks.filter((t) => !t.isCheckpoint).length;

  const parts: string[] = [
    `You are executing task ${taskNum} of ${totalTasks} in a Thesmos Autopilot session for "${plan.project}".`,
    ``,
    `HARD CONSTRAINTS (non-negotiable):`,
    `- Only modify files within declared Scope. Do not touch files outside scope.`,
    `- Do NOT run git commit or git push — the orchestrator handles commits.`,
    `- Do NOT modify test gate files: ${plan.gates.map((g) => g.split(' ')[0]).join(', ')}`,
    `- Write tests for any new code you produce.`,
    `- Do NOT install packages not listed in "New packages allowed".`,
    `- If you encounter a decision point, make the most reasonable default choice`,
    `  aligned with the codebase's existing patterns, and document your decision.`,
    `- When complete, output exactly: TASK COMPLETE — [one sentence summary of what you changed]`,
    ``,
  ];

  // Per-repo conventions (learned across sessions)
  if (conventionContext) {
    parts.push(conventionContext);
    parts.push(``);
  }

  // Reconnaissance report (read-only pre-task analysis)
  if (reconReport) {
    parts.push(buildReconContext(reconReport));
    parts.push(``);
  }

  // Session Decision Log (cross-task memory)
  if (session.decisionLog.length > 0) {
    parts.push(`DECISIONS MADE IN THIS SESSION — read before acting:`);
    for (const d of session.decisionLog) parts.push(`  - ${d}`);
    parts.push(``);
  }

  // Task definition
  parts.push(`TASK ${taskNum}: ${task.title}`);
  if (task.context) parts.push(`Context: ${task.context}`);
  parts.push(`Scope: ${task.scope?.join(', ') ?? 'unspecified'}`);

  if (task.allowedPackages && task.allowedPackages.length > 0) {
    parts.push(`New packages allowed: ${task.allowedPackages.join(', ')}`);
  } else {
    parts.push(`New packages allowed: NONE — only use packages already in package.json`);
  }

  if (task.dependsOn && task.dependsOn.length > 0) {
    parts.push(`Depends on: Task ${task.dependsOn.join(', Task ')}`);
  }

  parts.push(``);
  parts.push(`DONE CRITERIA (all must be true before you consider this task complete):`);
  for (const c of task.doneCriteria) parts.push(`  - ${c.raw}`);
  parts.push(``);

  // Retry context with gate failures
  if (retryContext) {
    const failedGates = retryContext.gateResults.filter((g) => !g.passed);
    if (failedGates.length > 0) {
      parts.push(`PREVIOUS ATTEMPT FAILED — fix these specific failures:`);
      for (const g of failedGates) {
        parts.push(`  Gate: ${g.gate}`);
        if (g.output) {
          parts.push(`  Output:`);
          g.output.split('\n').slice(0, 15).forEach((l) => parts.push(`    ${l}`));
        }
      }
      parts.push(``);
    }

    if (retryContext.loopDetected) {
      parts.push(`⚠ LOOP DETECTED: Your last two attempts produced the same failure.`);
      parts.push(`  Stop using the same approach. Read the existing code more carefully,`);
      parts.push(`  then choose a completely different strategy.`);
      if (retryContext.previousSummary) {
        parts.push(`  What you tried last time: ${retryContext.previousSummary}`);
      }
      parts.push(``);
    }

    parts.push(`CONSTRAINTS ON THIS RETRY:`);
    parts.push(`  - Only modify files you already changed in the previous attempt.`);
    parts.push(`  - Do not make unrelated changes while fixing the failure.`);
    parts.push(``);
  }

  parts.push(
    `After completing the task, output exactly:`,
    `TASK COMPLETE — [what you changed]`,
    `DECISIONS — [significant choices you made and why]`,
    `ALTERNATIVES REJECTED — [what you considered and ruled out]`,
    `CONCERNS — [any concerns about this implementation future tasks should know]`,
  );

  return parts.join('\n');
}

// ── Main execution loop ───────────────────────────────────────────────────────

export interface ExecutorOptions {
  dryRun: boolean;
  verbose: boolean;
  reconnaissance: boolean;
}

export async function executeSession(
  root: string,
  plan: AutopilotPlan,
  session: AutopilotSession,
  options: ExecutorOptions,
): Promise<void> {
  const adapter = createAdapter(plan.adapter);
  const timeoutMs = 30 * 60 * 1000; // 30 minutes per task

  // Load per-repo conventions (empty on first session, richer on repeat runs)
  const conventions = loadConventions(root);
  const conventionContext = buildConventionContext(conventions);

  // Track session-level metrics for convention update after session
  let sessionLlmCalls = 0;
  const sessionNewDecisions: string[] = [];
  const sessionBlockedPackages: string[] = [];

  for (const task of plan.tasks) {
    // Cancel check before every task
    if (isCancelRequested(root)) {
      process.stdout.write(`\n[autopilot] Cancel sentinel detected. Stopping after current task.\n`);
      break;
    }

    // Skip already-completed tasks (for --resume)
    if (isTaskCompleted(session, task.index)) {
      process.stdout.write(`  [skip] Task ${task.index + 1}: ${task.title} (already complete)\n`);
      continue;
    }

    // Checkpoint handling
    if (task.isCheckpoint) {
      const now = formatTimestamp();
      appendCheckpointEntry(session.journalPath, task.index, now);
      process.stdout.write('\n' + '─'.repeat(62) + '\n');
      process.stdout.write(`CHECKPOINT reached after task ${task.index}.\n\n`);
      process.stdout.write(`Session is paused. Review the branch:\n`);
      process.stdout.write(`  git log ${session.branch}\n\n`);
      process.stdout.write(`Session journal: ${session.journalPath}\n\n`);
      process.stdout.write(`To continue: thesmos autopilot resume [PLAN_FILE]\n`);
      process.stdout.write(`To abort:    thesmos autopilot cancel\n`);
      process.stdout.write('─'.repeat(62) + '\n');
      return;
    }

    process.stdout.write(`\n${'─'.repeat(62)}\n`);
    process.stdout.write(`Task ${task.index + 1}/${plan.tasks.filter((t) => !t.isCheckpoint).length}: ${task.title}\n`);
    process.stdout.write(`Scope: ${task.scope?.join(', ') ?? 'unspecified'}\n`);

    if (options.dryRun) {
      process.stdout.write(`[dry-run] Would execute task — skipping adapter call\n`);
      continue;
    }

    // Phase 2: Reconnaissance (read-only pre-task analysis, opt-in)
    let reconReport: ReconReport | null = null;
    if (options.reconnaissance) {
      process.stdout.write(`  Reconnaissance...\n`);
      const reconLogPath = getTaskLogPath(root, session.id, task.index).replace('.log', '-recon.log');
      reconReport = await runReconnaissance(root, task, plan, adapter, {
        timeoutMs: Math.min(timeoutMs, 10 * 60 * 1000), // cap recon at 10 min
        logPath: reconLogPath,
        sessionId: session.id,
        taskIndex: task.index,
      });
      sessionLlmCalls += 1;
      if (reconReport) {
        process.stdout.write(`  Recon complete (${reconReport.scopeFileCount} files in scope)\n`);
      }
    }

    const startedAt = formatTimestamp();
    const retryState: RetryState = { previousGateOutput: '', previousChangedFiles: [], loopCount: 0 };
    let succeeded = false;
    let finalEntry: JournalTaskEntry | null = null;
    let retries = 0;
    let lastSummary: string | undefined;

    for (let attempt = 0; attempt <= plan.maxRetries; attempt++) {
      if (attempt > 0) {
        process.stdout.write(`  Retry ${attempt}/${plan.maxRetries}...\n`);
        retries = attempt;
      }

      // Stash pre-task state so --resume restarts clean
      const stashRef = stashPreTask(root, session.id, task.index);
      session.lastTaskStash = stashRef;
      saveSession(root, session);

      // Build and execute prompt
      const isRetry = attempt > 0;
      const loopDetected = isRetry && detectLoop(
        retryState.previousGateOutput,
        getChangedFilesSinceLastCommit(root),
        retryState,
      );

      const prompt = buildTaskPrompt(
        task,
        plan,
        session,
        conventionContext,
        reconReport,
        isRetry
          ? {
              gateResults: finalEntry?.gateResults ?? [],
              loopDetected,
              previousSummary: lastSummary,
            }
          : undefined,
      );

      process.stdout.write(`  Executing via ${adapter.name}...\n`);
      const logPath = getTaskLogPath(root, session.id, task.index);
      const result = await adapter.execute(prompt, {
        timeoutMs,
        logPath,
        sessionId: session.id,
        taskIndex: task.index,
      });
      sessionLlmCalls += 1;
      lastSummary = result.summary ?? undefined;

      if (result.timedOut) {
        process.stdout.write(`  Task timed out after ${timeoutMs / 60000} minutes.\n`);
        // Pop stash — timed-out tasks should not leave partial changes
        if (stashRef) popStash(root, stashRef);
        session.lastTaskStash = null;
        session.timedOutTaskIndexes.push(task.index);
        saveSession(root, session);

        finalEntry = {
          index: task.index,
          title: task.title,
          status: 'timed_out',
          filesChanged: [],
          gateResults: [],
          doneCriteriaResults: [],
          scopeAudit: { outOfScopeFiles: [], unauthorizedPackages: [] },
          retries,
          blockReason: `Timed out after ${timeoutMs / 60000} minutes`,
          startedAt,
          completedAt: formatTimestamp(),
        };
        break;
      }

      if (!result.success) {
        process.stdout.write(`  Adapter returned non-zero exit code.\n`);
      }

      // Scope and package audits (before committing)
      const changedFiles = getChangedFilesSinceLastCommit(root);
      const outOfScopeFiles = task.scope
        ? changedFiles.filter((f) => !task.scope!.some((s) => f.startsWith(s)))
        : [];
      const unauthorizedPackages = auditUncommittedPackages(root, task.allowedPackages ?? []);

      if (outOfScopeFiles.length > 0) {
        process.stdout.write(`  ⚠ Out-of-scope files detected: ${outOfScopeFiles.join(', ')}\n`);
      }
      if (unauthorizedPackages.length > 0) {
        process.stdout.write(`  ⚠ Unauthorized packages detected: ${unauthorizedPackages.join(', ')}\n`);
        sessionBlockedPackages.push(...unauthorizedPackages);
      }

      // Run gates
      process.stdout.write(`  Running gates...\n`);
      const gateResults = plan.gates.map((g) => runGate(root, g));
      const allGatesPassed = gateResults.every((g) => g.passed);

      for (const g of gateResults) {
        process.stdout.write(`    ${g.passed ? '✓' : '✗'}  ${g.gate}\n`);
      }

      // Verify done criteria
      const doneCriteriaResults = verifyDoneCriteria(root, task);
      const allCriteriaMet = doneCriteriaResults.every((d) => d.passed);

      for (const d of doneCriteriaResults) {
        process.stdout.write(`    ${d.passed ? '✓' : '✗'}  ${d.criterion}\n`);
      }

      const gateOutput = gateResults.map((g) => g.output).join('\n');

      if (allGatesPassed && allCriteriaMet && outOfScopeFiles.length === 0 && unauthorizedPackages.length === 0) {
        // Commit
        const commitHash = commitTask(root, task.title, task.index);
        if (stashRef) dropStash(root, stashRef);

        process.stdout.write(`  ✓ Task complete. Commit: ${commitHash}\n`);

        addDecision(session, `Task ${task.index + 1} (${task.title}): ${result.summary ?? 'completed'}`);
        appendDecisionLogEntry(session.journalPath, task.index, task.title, result.summary ?? 'completed');

        // Track decisions for convention learning; extract observable patterns
        if (result.summary) {
          sessionNewDecisions.push(`Task ${task.index + 1}: ${result.summary}`);
          const extractedPatterns = extractPatternFromDecision(result.summary);
          if (Object.keys(extractedPatterns).length > 0) {
            mergePatterns(root, extractedPatterns);
          }
        }

        finalEntry = {
          index: task.index,
          title: task.title,
          status: 'complete',
          commitHash,
          filesChanged: changedFiles,
          gateResults,
          doneCriteriaResults,
          scopeAudit: { outOfScopeFiles, unauthorizedPackages },
          aiSummary: result.summary ?? undefined,
          retries,
          startedAt,
          completedAt: formatTimestamp(),
        };

        markTaskComplete(session, task.index);
        session.lastTaskStash = null;
        saveSession(root, session);
        succeeded = true;
        break;
      }

      // Gate failed — update retry state for loop detection
      retryState.previousGateOutput = gateOutput;
      retryState.previousChangedFiles = changedFiles;
      if (loopDetected) retryState.loopCount++;

      // Pop stash to reset to pre-task clean state for next retry
      if (stashRef) popStash(root, stashRef);
      session.lastTaskStash = null;

      if (attempt >= plan.maxRetries) {
        const reason = allGatesPassed
          ? `Done criteria not met: ${doneCriteriaResults.filter((d) => !d.passed).map((d) => d.criterion).join(', ')}`
          : `Gate failure after ${plan.maxRetries + 1} attempts: ${gateResults.filter((g) => !g.passed).map((g) => g.gate).join(', ')}`;

        process.stdout.write(`  ✗ Task BLOCKED: ${reason}\n`);
        markTaskBlocked(session, task.index, reason);
        saveSession(root, session);

        finalEntry = {
          index: task.index,
          title: task.title,
          status: 'blocked',
          filesChanged: [],
          gateResults,
          doneCriteriaResults,
          scopeAudit: { outOfScopeFiles, unauthorizedPackages },
          retries,
          blockReason: reason,
          startedAt,
          completedAt: formatTimestamp(),
        };
      }
    }

    if (finalEntry) {
      appendTaskEntry(session.journalPath, finalEntry);
    }

    if (!succeeded && !session.timedOutTaskIndexes.includes(task.index)) {
      process.stdout.write(`  Moving to next task...\n`);
    }
  }

  // Update per-repo conventions so future sessions benefit from what was learned
  updateConventions(root, {
    sessionId: session.id,
    date: new Date().toISOString().slice(0, 10),
    completedTaskCount: session.completedTaskIndexes.length,
    blockedTaskCount: session.blockedTasks.length,
    llmCalls: sessionLlmCalls,
    firedRules: extractFiredRulesFromJournal(session.journalPath),
    blockedPackages: [...new Set(sessionBlockedPackages)],
    newDecisions: sessionNewDecisions,
    changedFiles: [],
  });
}
