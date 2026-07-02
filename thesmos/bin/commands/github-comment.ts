// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos github:comment — post or update a governance summary comment on a GitHub PR.
 *
 * Uses GITHUB_TOKEN + native fetch (Node 18+). No @octokit/rest dependency.
 * Idempotent: finds the existing bot comment by marker and patches it rather than
 * posting a duplicate.
 *
 * Flags:
 *   --pr=<number>          Pull request number (required)
 *   --repo=<org/repo>      Repository slug (required, or auto-detected from git remote)
 *   --token=<token>        GitHub token (default: GITHUB_TOKEN env var)
 *   --print-workflow       Print a GitHub Actions workflow snippet and exit
 */
import { execSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import { loadBaseline, partitionFindings } from '../../baseline.ts';
import type { Finding } from '../../types.ts';

const BOT_MARKER = '<!-- thesmos-governance-bot -->';
const GITHUB_API = 'https://api.github.com';

// ── CLI entry ──────────────────────────────────────────────────────────────────

export async function cmdGithubComment(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);

  if (flag(flags, 'print-workflow')) {
    process.stdout.write(WORKFLOW_SNIPPET + '\n');
    return;
  }

  const prStr = flagVal(flags, 'pr');
  if (!prStr) {
    process.stderr.write('thesmos github:comment: --pr=<number> is required\n');
    process.exit(1);
  }
  const pr = parseInt(prStr, 10);
  if (isNaN(pr)) {
    process.stderr.write(`thesmos github:comment: --pr must be a number, got: ${prStr}\n`);
    process.exit(1);
  }

  const repo = flagVal(flags, 'repo') ?? detectRepo();
  if (!repo) {
    process.stderr.write(
      'thesmos github:comment: --repo=<org/repo> is required (could not detect from git remote)\n',
    );
    process.exit(1);
  }

  const token = flagVal(flags, 'token') ?? process.env['GITHUB_TOKEN'];
  if (!token) {
    process.stderr.write(
      'thesmos github:comment: GITHUB_TOKEN env var or --token is required\n',
    );
    process.exit(1);
  }

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write(
      'thesmos github:comment: .thesmos/report.json not found — run thesmos scan first\n',
    );
    process.exit(1);
  }

  const allFindings = runReview({ scan, config });
  const baseline = loadBaseline(root);
  const findings = baseline
    ? partitionFindings(allFindings, baseline).newFindings
    : allFindings;

  const body = BOT_MARKER + '\n' + formatFindingsMarkdown(findings);

  try {
    await postOrUpdateComment({ pr, repo, token }, body);
    const blocker = findings.filter((f) => f.severity === 'BLOCKER').length;
    const high = findings.filter((f) => f.severity === 'HIGH').length;
    process.stdout.write(
      `thesmos github:comment: posted to ${repo}#${pr} — ${findings.length} finding(s) (${blocker} BLOCKER, ${high} HIGH)\n`,
    );
  } catch (err) {
    process.stderr.write(
      `thesmos github:comment: GitHub API error — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

// ── GitHub API helpers ────────────────────────────────────────────────────────

interface CommentOptions {
  pr: number;
  repo: string;
  token: string;
}

interface GitHubComment {
  id: number;
  body: string;
}

async function findExistingComment(opts: CommentOptions): Promise<GitHubComment | null> {
  const headers = githubHeaders(opts.token);
  // GitHub paginates at 30/page; governance bots rarely have > 30 comments so one page is fine
  const res = await fetch(`${GITHUB_API}/repos/${opts.repo}/issues/${opts.pr}/comments?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GET comments: ${res.status} ${res.statusText}`);
  const comments = (await res.json()) as GitHubComment[];
  return comments.find((c) => c.body.startsWith(BOT_MARKER)) ?? null;
}

async function postOrUpdateComment(opts: CommentOptions, body: string): Promise<void> {
  const headers = githubHeaders(opts.token);
  const existing = await findExistingComment(opts);

  if (existing) {
    const res = await fetch(`${GITHUB_API}/repos/${opts.repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`PATCH comment: ${res.status} ${res.statusText}`);
  } else {
    const res = await fetch(`${GITHUB_API}/repos/${opts.repo}/issues/${opts.pr}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`POST comment: ${res.status} ${res.statusText}`);
  }
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatFindingsMarkdown(findings: Finding[]): string {
  const blockers = findings.filter((f) => f.severity === 'BLOCKER');
  const highs = findings.filter((f) => f.severity === 'HIGH');
  const mediums = findings.filter((f) => f.severity === 'MEDIUM');
  const lows = findings.filter((f) => f.severity === 'LOW' || f.severity === 'TECH_DEBT');

  const grade = deriveGrade(findings);
  const lines: string[] = [];

  lines.push(`## Thesmos Governance — ${grade}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No governance violations found.');
    return lines.join('\n');
  }

  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  if (blockers.length) lines.push(`| 🔴 BLOCKER | ${blockers.length} |`);
  if (highs.length)    lines.push(`| 🟠 HIGH    | ${highs.length} |`);
  if (mediums.length)  lines.push(`| 🟡 MEDIUM  | ${mediums.length} |`);
  if (lows.length)     lines.push(`| 🔵 LOW     | ${lows.length} |`);
  lines.push('');

  if (blockers.length > 0) {
    lines.push('### 🔴 Blockers — must fix before merge');
    lines.push('');
    for (const f of blockers.slice(0, 10)) {
      const loc = f.line != null ? `:${f.line}` : '';
      lines.push(`- **\`${f.file}${loc}\`** [${f.category}] — ${f.message}`);
    }
    if (blockers.length > 10) lines.push(`- _… and ${blockers.length - 10} more_`);
    lines.push('');
  }

  if (highs.length > 0) {
    lines.push('### 🟠 High severity');
    lines.push('');
    for (const f of highs.slice(0, 5)) {
      const loc = f.line != null ? `:${f.line}` : '';
      lines.push(`- **\`${f.file}${loc}\`** [${f.category}] — ${f.message}`);
    }
    if (highs.length > 5) lines.push(`- _… and ${highs.length - 5} more_`);
    lines.push('');
  }

  lines.push('> Run `thesmos review` for full details and `thesmos fix --apply` for auto-fixable violations.');

  return lines.join('\n');
}

function deriveGrade(findings: Finding[]): string {
  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const highs = findings.filter((f) => f.severity === 'HIGH').length;
  if (findings.length === 0) return '✅ A+';
  if (blockers > 0) return '❌ F';
  if (highs >= 5) return '⚠️ D';
  if (highs >= 2) return '⚠️ C';
  if (highs === 1) return '🟡 B';
  return '🟢 B+';
}

// ── Git remote detection ──────────────────────────────────────────────────────

function detectRepo(): string | null {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // SSH: git@github.com:org/repo.git
    const sshMatch = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1]!;
    // HTTPS: https://github.com/org/repo.git
    const httpsMatch = remote.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch) return httpsMatch[1]!;
  } catch {
    // not in a git repo or no remote
  }
  return null;
}

// ── GitHub Actions workflow snippet ──────────────────────────────────────────

const WORKFLOW_SNIPPET = `
# Add to .github/workflows/thesmos.yml:
- name: Thesmos PR Comment
  if: github.event_name == 'pull_request'
  run: npx thesmos github:comment --pr=\${{ github.event.pull_request.number }} --repo=\${{ github.repository }}
  env:
    GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`.trim();
