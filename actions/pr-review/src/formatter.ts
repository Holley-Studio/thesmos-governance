// Copyright (c) 2026 Holley Studios. All rights reserved.
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

// ── Summary comment ───────────────────────────────────────────────────────────

/** Formats the full-PR summary comment (markdown). */
export function formatSummaryComment(
  findings: Finding[],
  repoName: string,
  prNumber: number,
): string {
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

  return [
    SUMMARY_MARKER,
    `## 🔱 Thesmos Governance Review`,
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
    ``,
    `---`,
    `<sub>🔱 **Thesmos Governance** by Holley Studios · PR #${prNumber} in \`${repoName}\` · ` +
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
    `<sub>🔱 Thesmos Governance by Holley Studios</sub>`,
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
): boolean {
  if (threshold === 'none') return false;
  const rank = SEVERITY_RANK[threshold];
  return findings.some((f) => SEVERITY_RANK[f.severity] >= rank);
}
