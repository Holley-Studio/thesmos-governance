// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Post-session AI diff reviewer.
 *
 * After an autopilot session completes, this reads the full git diff,
 * the session journal, and every gate result, then asks an AI to produce
 * a structured review: summary / concerns / looks-good / manual checks.
 *
 * The human reads 2 pages instead of 400 lines of raw diff.
 *
 * Usage:
 *   thesmos autopilot review [session-id]
 *   thesmos autopilot review               ← uses active session
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AutopilotSession } from '../types.js';
import type { Adapter } from './adapters.js';
import { createAdapter } from './adapters.js';
import { loadSession, getSessionsDir } from './session.js';
import { formatTimestamp } from './journal.js';

// ── Diff reader ───────────────────────────────────────────────────────────────

export function getSessionDiff(root: string, branch: string, baseBranch = 'main'): string {
  try {
    const diff = execFileSync('git', ['diff', `${baseBranch}...${branch}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return diff;
  } catch {
    return '';
  }
}

export function getCommitLog(root: string, branch: string, baseBranch = 'main'): string {
  try {
    return execFileSync('git', ['log', '--oneline', `${baseBranch}..${branch}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
}

// ── Journal reader ────────────────────────────────────────────────────────────

export function extractJournalSections(journalPath: string): {
  decisionLog: string;
  taskSummaries: string;
  blockedTasks: string;
} {
  if (!existsSync(journalPath)) {
    return { decisionLog: '', taskSummaries: '', blockedTasks: '' };
  }

  const content = readFileSync(journalPath, 'utf8');

  function extractSection(header: string): string {
    const re = new RegExp(`## ${header}[\\s\\S]*?(?=\\n## |$)`, 'i');
    return re.exec(content)?.[0]?.trim() ?? '';
  }

  const decisionLog = extractSection('Session Decision Log');
  const taskSummaries = content
    .split(/\n## Task \d+/)
    .slice(1)
    .map((s) => s.split('\n').slice(0, 20).join('\n'))
    .join('\n\n---\n\n')
    .slice(0, 6000);

  const blockedTasks = content
    .split('\n')
    .filter((l) => l.includes('BLOCKED') || l.includes('blocked') || l.includes('✗'))
    .join('\n')
    .slice(0, 2000);

  return { decisionLog, taskSummaries, blockedTasks };
}

// ── Review prompt ─────────────────────────────────────────────────────────────

const MAX_DIFF_CHARS = 40_000;

export function buildReviewPrompt(
  session: AutopilotSession,
  diff: string,
  commitLog: string,
  journal: ReturnType<typeof extractJournalSections>,
): string {
  const truncatedDiff = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + `\n\n[... diff truncated at ${MAX_DIFF_CHARS} chars — review the full diff with: git diff main...${session.branch}]`
    : diff;

  return [
    `You are performing a code review of an AI-generated autopilot session.`,
    `Your job is to help a human developer decide whether to merge this branch.`,
    `Be honest, specific, and direct. Flag real concerns — don't just approve everything.`,
    ``,
    `SESSION METADATA:`,
    `  Branch: ${session.branch}`,
    `  Adapter: ${session.adapter}`,
    `  Completed tasks: ${session.completedTaskIndexes.length}`,
    `  Blocked tasks: ${session.blockedTasks.length}`,
    `  Timed out: ${session.timedOutTaskIndexes.length}`,
    ``,
    `COMMIT HISTORY:`,
    commitLog || '(no commits)',
    ``,
    journal.decisionLog
      ? `KEY DECISIONS MADE DURING SESSION:\n${journal.decisionLog.slice(0, 2000)}`
      : '',
    journal.blockedTasks
      ? `BLOCKED/FAILED ITEMS:\n${journal.blockedTasks}`
      : '',
    ``,
    `FULL DIFF (${session.branch} vs main):`,
    `\`\`\`diff`,
    truncatedDiff || '(empty diff — no changes committed)',
    `\`\`\``,
    ``,
    `REVIEW INSTRUCTIONS:`,
    `Produce a structured review using EXACTLY these sections:`,
    ``,
    `SUMMARY:`,
    `[2–4 sentences. What did the session accomplish? Did it meet the stated goal?`,
    ` Be specific about what changed.]`,
    ``,
    `LOOKS GOOD:`,
    `[Bulleted list. Things that are well-implemented, correct, safe, or idiomatic.]`,
    `[If nothing stands out as good, say so honestly.]`,
    ``,
    `CONCERNS:`,
    `[Bulleted list. Real issues: security problems, logic errors, missing error handling,`,
    ` type unsafety, unhandled edge cases, performance issues, broken patterns.]`,
    `[If no concerns, write "None identified."]`,
    `[Be specific — cite file names and line patterns where relevant.]`,
    ``,
    `MANUAL CHECKS REQUIRED:`,
    `[Bulleted checklist. Things the human MUST verify manually that can't be caught by tests.]`,
    `[e.g. "Verify Stripe webhook secret is set in production env", "Test the error path in..."]`,
    ``,
    `MERGE RECOMMENDATION:`,
    `[One of: APPROVE / APPROVE WITH FIXES / REQUEST CHANGES]`,
    `[Follow with one sentence explaining why.]`,
    ``,
    `Do not pad with filler. If a section is empty, say so briefly.`,
  ].filter(Boolean).join('\n');
}

// ── Parse reviewer output ─────────────────────────────────────────────────────

export interface ReviewReport {
  summary: string;
  looksGood: string;
  concerns: string;
  manualChecks: string;
  mergeRecommendation: string;
  rawOutput: string;
  generatedAt: string;
}

export function parseReviewOutput(raw: string): ReviewReport {
  function extract(header: string): string {
    const re = new RegExp(`${header}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z ]+:|$)`, 'i');
    return re.exec(raw)?.[1]?.trim() ?? '';
  }

  const mergeRaw = extract('MERGE RECOMMENDATION');
  const recommendation = /APPROVE WITH FIXES/i.test(mergeRaw)
    ? 'APPROVE WITH FIXES'
    : /REQUEST CHANGES/i.test(mergeRaw)
    ? 'REQUEST CHANGES'
    : /APPROVE/i.test(mergeRaw)
    ? 'APPROVE'
    : mergeRaw.split('\n')[0]?.trim() ?? 'UNKNOWN';

  return {
    summary: extract('SUMMARY'),
    looksGood: extract('LOOKS GOOD'),
    concerns: extract('CONCERNS'),
    manualChecks: extract('MANUAL CHECKS REQUIRED'),
    mergeRecommendation: recommendation,
    rawOutput: raw,
    generatedAt: formatTimestamp(),
  };
}

// ── Format review as markdown ─────────────────────────────────────────────────

const RECOMMENDATION_EMOJI: Record<string, string> = {
  'APPROVE': '✅',
  'APPROVE WITH FIXES': '⚠️',
  'REQUEST CHANGES': '❌',
};

export function formatReviewMarkdown(
  report: ReviewReport,
  session: AutopilotSession,
): string {
  const emoji = RECOMMENDATION_EMOJI[report.mergeRecommendation] ?? '❓';

  return [
    `# Autopilot Session Review`,
    ``,
    `**Session:** ${session.id}  `,
    `**Branch:** \`${session.branch}\`  `,
    `**Generated:** ${report.generatedAt}  `,
    `**Recommendation:** ${emoji} ${report.mergeRecommendation}`,
    ``,
    `---`,
    ``,
    `## Summary`,
    ``,
    report.summary || '_No summary generated._',
    ``,
    `## ✓ Looks Good`,
    ``,
    report.looksGood || '_No positive observations noted._',
    ``,
    `## ⚠ Concerns`,
    ``,
    report.concerns || '_No concerns identified._',
    ``,
    `## Manual Checks Required`,
    ``,
    report.manualChecks || '_No manual checks identified._',
    ``,
    `---`,
    ``,
    `## Reviewer Checklist`,
    ``,
    `- [ ] I have read the summary and concerns above`,
    `- [ ] I have completed all manual checks listed`,
    `- [ ] I have read the session journal: \`${session.journalPath}\``,
    `- [ ] I have verified the full diff: \`git diff main...${session.branch}\``,
    `- [ ] I approve merging this branch`,
    ``,
    `---`,
    ``,
    `*Generated by Thesmos Autopilot reviewer — this is AI-assisted, not a substitute for human review.*`,
  ].join('\n');
}

// ── Terminal display ──────────────────────────────────────────────────────────

export function displayReview(report: ReviewReport, session: AutopilotSession, reportPath: string): void {
  const DIVIDER = '━'.repeat(62);
  const emoji = RECOMMENDATION_EMOJI[report.mergeRecommendation] ?? '❓';

  process.stdout.write(`\n${DIVIDER}\n`);
  process.stdout.write(`  AUTOPILOT SESSION REVIEW — ${session.id}\n`);
  process.stdout.write(`${DIVIDER}\n\n`);

  process.stdout.write(`  Branch:  ${session.branch}\n`);
  process.stdout.write(`  Tasks:   ${session.completedTaskIndexes.length} complete`);
  if (session.blockedTasks.length > 0) process.stdout.write(`, ${session.blockedTasks.length} blocked`);
  process.stdout.write(`\n\n`);

  process.stdout.write(`SUMMARY\n\n`);
  process.stdout.write(`  ${(report.summary || 'No summary generated.').split('\n').join('\n  ')}\n\n`);

  if (report.looksGood && report.looksGood !== 'None identified.') {
    process.stdout.write(`LOOKS GOOD\n\n`);
    report.looksGood.split('\n').forEach((l) => process.stdout.write(`  ${l}\n`));
    process.stdout.write('\n');
  }

  if (report.concerns) {
    process.stdout.write(`CONCERNS\n\n`);
    report.concerns.split('\n').forEach((l) => process.stdout.write(`  ${l}\n`));
    process.stdout.write('\n');
  }

  if (report.manualChecks) {
    process.stdout.write(`MANUAL CHECKS REQUIRED\n\n`);
    report.manualChecks.split('\n').forEach((l) => process.stdout.write(`  ${l}\n`));
    process.stdout.write('\n');
  }

  process.stdout.write(`${DIVIDER}\n`);
  process.stdout.write(`  ${emoji}  ${report.mergeRecommendation}\n`);
  process.stdout.write(`${DIVIDER}\n\n`);

  process.stdout.write(`Full review: ${reportPath}\n\n`);
  process.stdout.write(`NEXT STEPS\n\n`);
  process.stdout.write(`  Merge:    git checkout main && git merge ${session.branch}\n`);
  process.stdout.write(`  Draft PR: thesmos autopilot open-pr ${session.id}\n`);
  process.stdout.write(`  Discard:  thesmos autopilot revert ${session.id}\n\n`);
}

// ── Main review runner ────────────────────────────────────────────────────────

export async function reviewSession(
  root: string,
  sessionId: string | undefined,
  baseBranch = 'main',
): Promise<void> {
  let session: AutopilotSession | null = null;

  if (sessionId) {
    // Try to find archived session JSON
    const sessionsDir = getSessionsDir(root);
    for (const dir of [sessionsDir, join(sessionsDir, 'archived')]) {
      const p = join(dir, `${sessionId}.json`);
      if (existsSync(p)) {
        try { session = JSON.parse(readFileSync(p, 'utf8')); } catch { /* ignore */ }
        break;
      }
    }
  }

  // Fall back to active session
  if (!session) {
    session = loadSession(root);
  }

  if (!session) {
    process.stderr.write(
      `No session found. Provide a session ID:\n  thesmos autopilot review <session-id>\n` +
      `Or run review immediately after a session completes.\n`,
    );
    process.exit(1);
  }

  const adapterName = session.adapter ?? 'claude';
  const adapter = createAdapter(adapterName) as Adapter;

  process.stdout.write(`\nThesmos Autopilot — Session Reviewer\n`);
  process.stdout.write(`Session: ${session.id}\n`);
  process.stdout.write(`Branch:  ${session.branch}\n\n`);

  process.stdout.write(`Reading diff...\n`);
  const diff = getSessionDiff(root, session.branch, baseBranch);
  const commitLog = getCommitLog(root, session.branch, baseBranch);

  if (!diff && !commitLog) {
    process.stdout.write(`No diff found between ${baseBranch} and ${session.branch}.\n`);
    process.stdout.write(`The branch may not have any commits, or ${baseBranch} may not be the right base.\n`);
    process.stdout.write(`Try: git diff <base>...${session.branch}\n`);
    process.exit(1);
  }

  const journal = extractJournalSections(session.journalPath);

  process.stdout.write(`Generating AI review (this may take 1–2 minutes)...\n`);

  const { tmpdir } = await import('node:os');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const tmpDir = mkdtempSync(join(tmpdir(), 'thesmos-review-'));
  const logPath = join(tmpDir, 'review.log');

  const prompt = buildReviewPrompt(session, diff, commitLog, journal);

  const result = await adapter.execute(prompt, {
    timeoutMs: 5 * 60 * 1000,
    logPath,
    sessionId: session.id,
    taskIndex: -1,
  });

  if (!result.success || !existsSync(logPath)) {
    process.stderr.write(`Review generation failed. Check adapter config and try again.\n`);
    process.exit(1);
  }

  const rawOutput = readFileSync(logPath, 'utf8');
  const report = parseReviewOutput(rawOutput);

  // Write report file
  const reportPath = join(root, `.thesmos/autopilot/${session.id}.review.md`);
  writeFileSync(reportPath, formatReviewMarkdown(report, session), 'utf8');

  // Cleanup tmp
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

  // Display in terminal
  displayReview(report, session, reportPath);
}
