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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// thesmos-governance is bundled into dist/index.js by esbuild
import {
  runScanner,
  runReview,
  CONFIG_DEFAULTS,
  loadConfig,
} from 'thesmos-governance';

import type { ActionInputs, Severity } from './types.js';
import {
  formatSummaryComment,
  buildInlineComments,
  shouldFail,
} from './formatter.js';
import {
  getPullRequestContext,
  getChangedFiles,
  upsertSummaryComment,
  postInlineReview,
} from './github.js';

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
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

    core.debug(`Workspace: ${workspace}`);
    core.debug(`Fail on severity: ${inputs.failOnSeverity}`);

    // ── 2. PR context ──────────────────────────────────────────────────────

    const ctx = getPullRequestContext();
    core.info(
      `Reviewing PR #${ctx.pullNumber} in ${ctx.repoName} (head: ${ctx.headSha.slice(0, 7)})`,
    );

    const octokit = gh.getOctokit(inputs.githubToken);

    // ── 3. Changed files ───────────────────────────────────────────────────

    core.info('Fetching changed files from GitHub API…');
    const changedFiles = await getChangedFiles(octokit, ctx, workspace);
    core.info(`Found ${changedFiles.length} changed file(s) to review`);

    if (changedFiles.length === 0) {
      core.info('No reviewable files changed — skipping analysis.');
      core.setOutput('finding-count', '0');
      core.setOutput('blocker-count', '0');
      return;
    }

    // ── 4. Scan workspace ──────────────────────────────────────────────────

    core.info('Scanning workspace…');
    const config = loadThesmosConfig(workspace);
    const scan = runScanner(workspace, config);
    core.debug(`Scan complete: ${scan.componentCount} components, ${scan.apiRoutes.length} API routes`);

    // ── 5. Run review ──────────────────────────────────────────────────────

    core.info('Running governance review…');
    const findings = runReview({ scan, config, changedFiles });
    core.info(
      findings.length === 0
        ? 'All governance checks passed ✅'
        : `Found ${findings.length} finding(s)`,
    );

    // ── 6. Annotate findings in the Actions log ────────────────────────────

    for (const finding of findings) {
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
        findings,
        ctx.repoName,
        ctx.pullNumber,
      );
      await upsertSummaryComment(octokit, ctx, summaryBody);
    }

    // ── 8. Post inline comments ────────────────────────────────────────────

    if (inputs.postInlineComments && findings.length > 0) {
      const changedFilePaths = new Set(changedFiles.map((f) => f.path));
      const inlineComments = buildInlineComments(findings, changedFilePaths);

      if (inlineComments.length > 0) {
        core.info(`Posting ${inlineComments.length} inline comment(s)…`);
        await postInlineReview(octokit, ctx, inlineComments);
      } else {
        core.debug('No findings with line numbers in the diff — skipping inline comments');
      }
    }

    // ── 9. Set outputs ─────────────────────────────────────────────────────

    const blockerCount = findings.filter((f) => f.severity === 'BLOCKER').length;
    core.setOutput('finding-count', String(findings.length));
    core.setOutput('blocker-count', String(blockerCount));

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

    // ── 10. Exit code ──────────────────────────────────────────────────────

    if (shouldFail(findings, inputs.failOnSeverity)) {
      const blockers = findings.filter((f) => f.severity === 'BLOCKER');
      const highs = findings.filter((f) => f.severity === 'HIGH');

      const parts: string[] = [];
      if (blockers.length > 0) parts.push(`${blockers.length} BLOCKER`);
      if (highs.length > 0) parts.push(`${highs.length} HIGH`);
      const rest = findings.length - blockers.length - highs.length;
      if (rest > 0) parts.push(`${rest} other`);

      core.setFailed(
        `🔱 Thesmos Governance: ${parts.join(', ')} finding(s) found. ` +
          `Resolve or baseline these before merging.`,
      );
    } else if (findings.length > 0) {
      core.info(
        `🔱 Thesmos Governance: ${findings.length} finding(s) noted (below fail threshold).`,
      );
    } else {
      core.info('🔱 Thesmos Governance: All checks passed.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(`Thesmos Governance action failed: ${message}`);
  }
}

run();
