// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Thesmos Governance PR Review — GitHub Action entry point.
 * by Holley Studios
 *
 * Flow:
 *   1. Parse action inputs
 *   2. Validate we're on a pull_request event
 *   3. Get list of changed files from GitHub API (with content + diff)
 *   4. Scan the workspace to detect framework, routes, etc.
 *   5. Run governance review against changed files
 *   6. Post/update summary comment on the PR
 *   7. Post inline review comments on the diff (best-effort)
 *   8. Set action outputs and exit code
 */

import * as core from '@actions/core';
import * as gh from '@actions/github';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// thesmos-governance is bundled into dist/index.js by esbuild
import {
  runScanner,
  runReview,
  CONFIG_DEFAULTS,
  loadConfig,
  loadBaseline,
  partitionFindings,
} from 'thesmos-governance';

import type { ActionInputs, Severity, ChangedFile } from './types.js';
import {
  formatSummaryComment,
  buildInlineComments,
  shouldFail,
  computeScore,
} from './formatter.js';
import {
  getPullRequestContext,
  getChangedFiles,
  upsertSummaryComment,
  postInlineReview,
} from './github.js';
import { partitionNewVsPreExisting, type FileDiffInfo } from './partition.js';

// ── Input parsing ─────────────────────────────────────────────────────────────

const VALID_SEVERITIES = new Set<string>([
  'BLOCKER',
  'HIGH',
  'MEDIUM',
  'LOW',
  'TECH_DEBT',
  'none',
]);

function parseInputs(): ActionInputs {
  const raw = core.getInput('fail-on-severity').trim().toUpperCase() || 'BLOCKER';
  const failOnSeverity = VALID_SEVERITIES.has(raw)
    ? (raw as Severity | 'none')
    : 'BLOCKER';

  if (!VALID_SEVERITIES.has(raw)) {
    core.warning(
      `Invalid fail-on-severity value "${raw}". Defaulting to BLOCKER.`,
    );
  }

  return {
    githubToken: core.getInput('github-token', { required: true }),
    failOnSeverity,
    postInlineComments: core.getInput('post-inline-comments') !== 'false',
    updateSummary: core.getInput('update-summary') !== 'false',
    reportPreexisting: core.getInput('report-preexisting') !== 'false',
  };
}

// ── Config loading ────────────────────────────────────────────────────────────

function loadThesmosConfig(workspace: string) {
  const configPath = join(workspace, '.thesmos', 'config.json');
  if (existsSync(configPath)) {
    try {
      return loadConfig(workspace);
    } catch {
      core.warning(
        '.thesmos/config.json found but could not be parsed — using defaults.',
      );
    }
  }
  return CONFIG_DEFAULTS;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  try {
    core.info('🔱 Thesmos Governance PR Review — by Holley Studios');

    // ── 1. Inputs ──────────────────────────────────────────────────────────

    const inputs = parseInputs();
    const workspace = process['env']['GITHUB_WORKSPACE'] ?? process.cwd();

    core.debug(`Workspace: ${workspace}`);
    core.debug(`Fail on severity: ${inputs.failOnSeverity}`);

    // ── 2. PR context ──────────────────────────────────────────────────────

    const ctx = getPullRequestContext();
    core.info(
      `Reviewing PR #${ctx.pullNumber} in ${ctx.repoName} (head: ${ctx.headSha.slice(0, 7)})`,
    );

    const octokit = gh.getOctokit(inputs.githubToken);

    // ── 3. Changed files ───────────────────────────────────────────────────
    // Config loads before file collection so the repo's reviewIgnorePaths
    // (e.g. rule-definition sources that intentionally contain the patterns
    // they detect) are honored by the action, not just the CLI gates.
    const config = loadThesmosConfig(workspace);

    core.info('Fetching changed files from GitHub API…');
    const { files: changedFiles, governanceFilesModified } = await getChangedFiles(
      octokit,
      ctx,
      workspace,
      config.reviewIgnorePaths ?? [],
    );
    core.info(`Found ${changedFiles.length} changed file(s) to review`);
    if (governanceFilesModified.length > 0) {
      // Baseline trust boundary (Argus, Phase 4b item 3): this PR edits the
      // very files this review loads its suppressions/config from.
      core.warning(
        `PR modifies governance control file(s): ${governanceFilesModified.join(', ')} — ` +
          `baseline/config changes can suppress this PR's own findings; review them deliberately.`,
      );
    }

    if (changedFiles.length === 0) {
      core.info('No reviewable files changed — skipping analysis.');
      core.setOutput('finding-count', '0');
      core.setOutput('blocker-count', '0');
      return;
    }

    // ── 4. Scan workspace ──────────────────────────────────────────────────

    core.info('Scanning workspace…');
    const scan = runScanner(workspace, config);
    core.debug(`Scan complete: ${scan.componentCount} components, ${scan.apiRoutes.length} API routes`);

    // ── 5. Run review ──────────────────────────────────────────────────────
    // runReview scans FULL file content (not just the diff) — a one-line fix
    // in a legacy file re-reports every pre-existing finding in it. Steps 5a-5b
    // below narrow that down to what this PR actually introduced.

    core.info('Running governance review…');
    const allFindings = runReview({ scan, config, changedFiles });
    core.info(
      allFindings.length === 0
        ? 'All governance checks passed ✅'
        : `Found ${allFindings.length} finding(s) across full file content`,
    );

    // ── 5a. Baseline suppression (Task 4b) ──────────────────────────────────
    // Applied BEFORE the NEW/PRE-EXISTING split — baselined (accepted) debt
    // vanishes from both buckets. The pre-existing section is for UNaccepted
    // debt in touched files; already-accepted debt shouldn't reappear there.

    const baseline = loadBaseline(workspace);
    const unbaselinedFindings = baseline
      ? partitionFindings(allFindings, baseline).newFindings
      : allFindings;
    const baselinedCount = allFindings.length - unbaselinedFindings.length;
    if (baselinedCount > 0) {
      core.info(`${baselinedCount} finding(s) suppressed — matched .thesmos/baseline.json (accepted debt)`);
    }

    // ── 5b. NEW vs PRE-EXISTING partition (Task 4a) ─────────────────────────
    // NEW: on a line this PR added/modified, or in a brand-new file — this is
    // what gates the merge. PRE-EXISTING: everything else in a touched file —
    // reported for visibility, never blocks. See partition.ts for full rules.

    const filesByPath = new Map<string, FileDiffInfo>(
      changedFiles.map((f: ChangedFile) => [f.path, { status: f.status, changedLines: f.changedLines }]),
    );
    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(
      unbaselinedFindings,
      filesByPath,
      // Unknown-file split (Argus, Phase 4a item 2): findings attached to
      // files that don't exist in the workspace are missing-artifact findings
      // (e.g. EU_AI_001 → '.thesmos/conformity-assessment.md') provoked by
      // this PR's content — they gate. Findings on real untouched files are
      // pre-existing scan debt — they don't.
      { fileExists: (p: string) => existsSync(join(workspace, p)) },
    );
    core.info(
      `${newFindings.length} new finding(s) (gate on these) · ` +
        `${preExistingFindings.length} pre-existing in touched files (informational)`,
    );

    // ── 6. Annotate findings in the Actions log ────────────────────────────
    // Only NEW findings are annotated — pre-existing debt in a touched file
    // is not something this PR introduced and should not clutter the PR's
    // Files-changed annotations.

    for (const finding of newFindings) {
      const annotationProps = {
        file: finding.file,
        startLine: finding.line,
        title: `[${finding.severity}] ${finding.category}`,
      };

      if (finding.severity === 'BLOCKER' || finding.severity === 'HIGH') {
        core.error(finding.message, annotationProps);
      } else if (finding.severity === 'MEDIUM') {
        core.warning(finding.message, annotationProps);
      } else {
        core.notice(finding.message, annotationProps);
      }
    }

    // ── 7. Post summary comment ────────────────────────────────────────────

    if (inputs.updateSummary) {
      core.info('Posting summary comment…');
      const summaryBody = formatSummaryComment(
        newFindings,
        ctx.repoName,
        ctx.pullNumber,
        {
          preExisting: preExistingFindings,
          baselinedCount,
          reportPreexisting: inputs.reportPreexisting,
          governanceFilesModified,
        },
      );
      await upsertSummaryComment(octokit, ctx, summaryBody);
    }

    // ── 8. Record PR score in history ─────────────────────────────────────
    // Score reflects only what this PR introduced (newFindings) — pre-existing
    // debt in a touched file should not move a PR's own health score.

    const prScore = computeScore(newFindings);
    core.setOutput('health-score', String(prScore));

    try {
      const thesmosDir = join(workspace, '.thesmos');
      mkdirSync(thesmosDir, { recursive: true });
      const historyPath = join(thesmosDir, 'pr-history.jsonl');
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        repo: ctx.repoName,
        pr: ctx.pullNumber,
        sha: ctx.headSha,
        score: prScore,
        findings: newFindings.length,
        blockers: newFindings.filter((f) => f.severity === 'BLOCKER').length,
        highs: newFindings.filter((f) => f.severity === 'HIGH').length,
        preExisting: preExistingFindings.length,
        baselined: baselinedCount,
      });
      appendFileSync(historyPath, entry + '\n', 'utf8');
      core.debug(`PR score ${prScore}/100 appended to .thesmos/pr-history.jsonl`);
    } catch (err) {
      core.debug(`Could not write PR history: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── 9. Post inline comments ────────────────────────────────────────────
    // NEW findings only — they are guaranteed to be on a diff line (or in a
    // brand-new file), so the 422-retry fallback in postInlineReview should
    // now almost never trigger.

    if (inputs.postInlineComments && newFindings.length > 0) {
      const changedFilePaths = new Set(changedFiles.map((f) => f.path));
      const inlineComments = buildInlineComments(newFindings, changedFilePaths);

      if (inlineComments.length > 0) {
        core.info(`Posting ${inlineComments.length} inline comment(s)…`);
        await postInlineReview(octokit, ctx, inlineComments);
      } else {
        core.debug('No findings with line numbers in the diff — skipping inline comments');
      }
    }

    // ── 10. Set outputs ────────────────────────────────────────────────────
    // finding-count / blocker-count reflect the NEW bucket — what this PR
    // introduced and what gates it. Pre-existing/baselined counts are exposed
    // separately so downstream steps can report on them without conflating
    // "introduced by this PR" with "already existed".

    const blockerCount = newFindings.filter((f) => f.severity === 'BLOCKER').length;
    core.setOutput('finding-count', String(newFindings.length));
    core.setOutput('blocker-count', String(blockerCount));
    core.setOutput('preexisting-finding-count', String(preExistingFindings.length));
    core.setOutput('baselined-finding-count', String(baselinedCount));

    // Try to read health grade from report.json if it exists
    const reportPath = join(workspace, '.thesmos', 'report.json');
    if (existsSync(reportPath)) {
      try {
        const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
        if (typeof report.grade === 'string') {
          core.setOutput('health-grade', report.grade);
        }
      } catch {
        // Health grade output is optional
      }
    }

    // ── 11. Exit code ──────────────────────────────────────────────────────
    // Gate semantics: shouldFail() evaluates ONLY the NEW bucket — a PR is
    // never blocked by debt it didn't introduce.

    if (shouldFail(newFindings, inputs.failOnSeverity)) {
      const blockers = newFindings.filter((f) => f.severity === 'BLOCKER');
      const highs = newFindings.filter((f) => f.severity === 'HIGH');

      const parts: string[] = [];
      if (blockers.length > 0) parts.push(`${blockers.length} BLOCKER`);
      if (highs.length > 0) parts.push(`${highs.length} HIGH`);
      const rest = newFindings.length - blockers.length - highs.length;
      if (rest > 0) parts.push(`${rest} other`);

      core.setFailed(
        `🔱 Thesmos Governance: ${parts.join(', ')} finding(s) introduced by this PR. ` +
          `Resolve or baseline these before merging.`,
      );
    } else if (newFindings.length > 0) {
      core.info(
        `🔱 Thesmos Governance: ${newFindings.length} finding(s) noted (below fail threshold).`,
      );
    } else {
      core.info('🔱 Thesmos Governance: All checks passed on new/modified code.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(`Thesmos Governance action failed: ${message}`);
  }
}

run();
