// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Comment formatters for the Thesmos Governance PR Review Action.
 *
 * Produces:
 *   - A rich Markdown summary comment (posted/updated on the PR)
 *   - Short inline comments (posted on individual diff lines)
 *
 * Hidden marker <!-- thesmos-governance:summary --> is embedded so the
 * upsert logic can find and update the comment on re-runs.
 */

import type { Finding, InlineComment, Severity } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const SUMMARY_MARKER = '<!-- thesmos-governance:summary -->';

/** If a rule fires on more than this many distinct files, collapse to one row. */
const DEDUP_THRESHOLD = 3;

const SEVERITY_EMOJI: Record<Severity, string> = {
  BLOCKER: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🔵',
  TECH_DEBT: '💡',
};

const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function groupBySeverity(findings: Finding[]): Map<Severity, Finding[]> {
  const map = new Map<Severity, Finding[]>();
  for (const sev of SEVERITY_ORDER) map.set(sev, []);
  for (const f of findings) map.get(f.severity)?.push(f);
  return map;
}

// ── Health score ──────────────────────────────────────────────────────────────

/** Computes a 0–100 PR health score. BLOCKER=-15, HIGH=-3, MEDIUM=-1, floor 0. */
export function computeScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'BLOCKER') score -= 15;
    else if (f.severity === 'HIGH') score -= 3;
    else if (f.severity === 'MEDIUM') score -= 1;
  }
  return Math.max(0, score);
}

function scoreEmoji(score: number): string {
  if (score >= 90) return '🟢';
  if (score >= 70) return '🟡';
  if (score >= 50) return '🟠';
  return '🔴';
}

// ── Dedup rendering ───────────────────────────────────────────────────────────

/**
 * Renders a severity bucket with per-category deduplication.
 * Categories with >DEDUP_THRESHOLD distinct files collapse to a single row.
 */
function renderBucket(group: Finding[]): string {
  const byCategory = new Map<string, Finding[]>();
  for (const f of group) {
    const existing = byCategory.get(f.category) ?? [];
    existing.push(f);
    byCategory.set(f.category, existing);
  }

  const rows: string[] = [];
  for (const [category, catFindings] of byCategory) {
    const uniqueFiles = new Set(catFindings.map((f) => f.file));
    if (uniqueFiles.size > DEDUP_THRESHOLD) {
      const fileList = [...uniqueFiles]
        .slice(0, 5)
        .map((f) => `\`${esc(f)}\``)
        .join(', ');
      const moreFiles = uniqueFiles.size > 5 ? ` +${uniqueFiles.size - 5} more` : '';
      rows.push(
        `- **\`${esc(category)}\`** — ${esc(catFindings[0]?.message ?? '')} ` +
          `(**${plural(uniqueFiles.size, 'file')}**: ${fileList}${moreFiles})\n` +
          `  > 💡 Run \`thesmos fix --rule=${esc(category)}\` to fix all automatically`,
      );
    } else {
      for (const f of catFindings) {
        const loc = f.line ? `:${f.line}` : '';
        const suggestion = f.suggestion ? `\n  > 💡 ${esc(f.suggestion)}` : '';
        rows.push(`- **\`${esc(f.file)}${loc}\`** — ${esc(f.message)} \`${esc(f.category)}\`${suggestion}`);
      }
    }
  }
  return rows.join('\n');
}

/**
 * Renders the collapsed "Pre-existing findings in touched files" section
 * (Task 4a #3) — grouped by severity, reusing the same per-category dedup as
 * the blocking sections, but always collapsed and always labeled non-blocking.
 */
function renderPreExistingSection(findings: Finding[]): string {
  if (findings.length === 0) return '';

  const byGroup = groupBySeverity(findings);
  const body = SEVERITY_ORDER.filter((sev) => (byGroup.get(sev)?.length ?? 0) > 0)
    .map((sev) => {
      const group = byGroup.get(sev) ?? [];
      return `**${SEVERITY_EMOJI[sev]} ${sev}** &nbsp;·&nbsp; ${plural(group.length, 'finding')}\n\n${renderBucket(group)}`;
    })
    .join('\n\n');

  return (
    `<details>\n` +
    `<summary>📋 <strong>Pre-existing findings in touched files</strong> &nbsp;·&nbsp; ` +
    `${plural(findings.length, 'finding')} — not blocking</summary>\n\n` +
    `${body}\n\n` +
    `</details>`
  );
}

// ── Summary comment ───────────────────────────────────────────────────────────

/** Options controlling optional summary comment sections (Task 4a/4b). */
export interface SummaryOptions {
  /** Findings pre-dating this PR in touched files — rendered collapsed, non-blocking. */
  preExisting?: Finding[];
  /** Count of findings suppressed because they matched .thesmos/baseline.json (accepted debt). */
  baselinedCount?: number;
  /** Whether to render the pre-existing findings section at all. Default true. */
  reportPreexisting?: boolean;
  /** Governance files (.thesmos/baseline.json, .thesmos/config.json) modified
   *  by THIS PR. The baseline is loaded from the PR's own checkout, so a PR
   *  can add entries that suppress its own findings — this warning puts the
   *  reviewer's eyes on exactly that surface. (Argus ruling, Phase 4b item 3.) */
  governanceFilesModified?: string[];
}

/** Formats the full-PR summary comment (markdown). */
export function formatSummaryComment(
  findings: Finding[],
  repoName: string,
  prNumber: number,
  options: SummaryOptions = {},
): string {
  const {
    preExisting = [],
    baselinedCount = 0,
    reportPreexisting = true,
    governanceFilesModified = [],
  } = options;
  const byGroup = groupBySeverity(findings);

  const blockers = byGroup.get('BLOCKER')?.length ?? 0;
  const highs = byGroup.get('HIGH')?.length ?? 0;
  const score = computeScore(findings);

  const headerLine =
    findings.length === 0
      ? '**✅ All governance checks passed — no findings.**'
      : `**${plural(findings.length, 'finding')} detected** across changed files.`;

  const severityTable = SEVERITY_ORDER.map((sev) => {
    const count = byGroup.get(sev)?.length ?? 0;
    return `| ${SEVERITY_EMOJI[sev]} ${sev} | ${count === 0 ? '—' : `**${count}**`} |`;
  }).join('\n');

  const scoreEmoji_ = scoreEmoji(score);
  const scoreLine = `**PR Score: ${scoreEmoji_} ${score}/100**`;

  const scoreNote =
    blockers > 0
      ? ` — ${plural(blockers, 'blocker')} must be fixed before merge.`
      : highs > 0
        ? ` — ${plural(highs, 'high-severity finding')} should be reviewed.`
        : findings.length === 0
          ? ' — clean.'
          : ` — ${plural(findings.length, 'finding')} noted.`;

  const findingSections =
    findings.length === 0
      ? ''
      : SEVERITY_ORDER.filter((sev) => (byGroup.get(sev)?.length ?? 0) > 0)
          .map((sev) => {
            const group = byGroup.get(sev) ?? [];
            const rows = renderBucket(group);
            // BLOCKER + HIGH expand by default; others collapsed
            const open = sev === 'BLOCKER' || sev === 'HIGH' ? ' open' : '';
            return (
              `<details${open}>\n` +
              `<summary>${SEVERITY_EMOJI[sev]} <strong>${sev}</strong> &nbsp;·&nbsp; ${plural(group.length, 'finding')}</summary>\n\n` +
              `${rows}\n\n` +
              `</details>`
            );
          })
          .join('\n\n');

  const status =
    blockers > 0
      ? `> ⛔ **${plural(blockers, 'blocker')} found** — this PR must address these before merging.`
      : highs > 0
        ? `> ⚠️ **${plural(highs, 'high-severity finding')} found** — please review before merging.`
        : findings.length === 0
          ? `> ✅ No governance violations found.`
          : `> ℹ️ ${plural(findings.length, 'finding')} found — no blockers.`;

  const preExistingSection =
    reportPreexisting && preExisting.length > 0 ? renderPreExistingSection(preExisting) : '';

  const baselineNote =
    baselinedCount > 0
      ? `_${plural(baselinedCount, 'finding')} suppressed as accepted baseline debt — run \`thesmos baseline:report\` for details._`
      : '';

  // Never collapsed, always above the fold: this PR edits the very files that
  // decide what this review suppresses or fails on.
  const governanceWarning =
    governanceFilesModified.length > 0
      ? `> ⚠️ **This PR modifies governance control files:** ${governanceFilesModified
          .map((f) => `\`${f}\``)
          .join(', ')}. Baseline or config changes can suppress this PR's own findings — review those changes deliberately.`
      : '';

  return [
    SUMMARY_MARKER,
    `## 🔱 Thesmos Governance Review`,
    governanceWarning ? `` : undefined,
    governanceWarning || undefined,
    ``,
    status,
    ``,
    headerLine,
    ``,
    `${scoreLine}${scoreNote}`,
    ``,
    `| Severity | Count |`,
    `|----------|-------|`,
    severityTable,
    ``,
    findingSections,
    preExistingSection ? `` : undefined,
    preExistingSection || undefined,
    baselineNote ? `` : undefined,
    baselineNote || undefined,
    ``,
    `---`,
    `<sub>🔱 **Thesmos Governance** by Holley Studio · PR #${prNumber} in \`${repoName}\` · ` +
      `[EU AI Act Art. 12](https://holley.studio/thesmos/compliance) SARIF export: \`thesmos validate --sarif\`</sub>`,
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}

// ── Inline comment ────────────────────────────────────────────────────────────

/** Formats a single inline diff comment for one finding. */
export function formatInlineComment(finding: Finding): string {
  const lines: string[] = [
    `**${SEVERITY_EMOJI[finding.severity]} ${finding.severity}** &nbsp;·&nbsp; \`${finding.category}\``,
    ``,
    finding.message,
  ];

  if (finding.suggestion) {
    lines.push(``, `> 💡 **Suggestion:** ${finding.suggestion}`);
  }

  lines.push(
    ``,
    `<sub>🔱 Thesmos Governance by Holley Studio</sub>`,
  );

  return lines.join('\n');
}

// ── Build inline comment list ─────────────────────────────────────────────────

/**
 * Builds the list of inline comments to pass to the GitHub review API.
 * Only includes findings that:
 *   1. Have a line number
 *   2. Are in a file that was part of the PR diff
 *   3. Are NOT in a category that spans >DEDUP_THRESHOLD files (bulk noise suppressed)
 *
 * Files and line numbers outside the diff will cause a 422 from GitHub.
 * We return comments for changed files only; the caller wraps the API
 * call in a try/catch to handle any remaining misses gracefully.
 */
export function buildInlineComments(
  findings: Finding[],
  changedFilePaths: Set<string>,
): InlineComment[] {
  // Identify categories that are bulk (suppress from inline diff view)
  const categoryFileCounts = new Map<string, Set<string>>();
  for (const f of findings) {
    const set = categoryFileCounts.get(f.category) ?? new Set();
    set.add(f.file);
    categoryFileCounts.set(f.category, set);
  }
  const bulkCategories = new Set(
    [...categoryFileCounts.entries()]
      .filter(([, files]) => files.size > DEDUP_THRESHOLD)
      .map(([cat]) => cat),
  );

  return findings
    .filter(
      (f) =>
        f.line !== undefined &&
        changedFilePaths.has(f.file) &&
        !bulkCategories.has(f.category),
    )
    .map((f) => ({
      path: f.file,
      line: f.line as number,
      body: formatInlineComment(f),
    }));
}

// ── Severity gate ─────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<Severity, number> = {
  BLOCKER: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  TECH_DEBT: 1,
};

/** Returns true if any finding meets or exceeds the configured fail threshold. */
export function shouldFail(
  findings: Finding[],
  threshold: Severity | 'none',
  minConfidence: 'high' | 'medium' | 'low' = 'medium',
): boolean {
  if (threshold === 'none') return false;
  const rank = SEVERITY_RANK[threshold];
  // Gate semantics match the CLI (thesmos/gate.ts): findings below the
  // repo's gate.minConfidence report but never block.
  const confRank = { low: 0, medium: 1, high: 2 } as const;
  const minRank = confRank[minConfidence];
  return findings.some(
    (f) =>
      SEVERITY_RANK[f.severity] >= rank &&
      confRank[(f as Finding & { confidence?: 'high' | 'medium' | 'low' }).confidence ?? 'high'] >= minRank,
  );
}
