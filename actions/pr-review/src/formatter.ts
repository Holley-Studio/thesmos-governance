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

const SEVERITY_EMOJI: Record<Severity, string> = {
  BLOCKER: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🔵',
  TECH_DEBT: '💡',
};

const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'];

// Rules firing on >DEDUP_THRESHOLD distinct files are collapsed to a single summary item.
const DEDUP_THRESHOLD = 3;

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

/** Computes a 0-100 PR health score. */
function computeScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'BLOCKER') score -= 15;
    else if (f.severity === 'HIGH') score -= 3;
    else if (f.severity === 'MEDIUM') score -= 1;
  }
  return Math.max(0, score);
}

/**
 * Renders one severity bucket's findings with deduplication.
 *
 * Same rule firing on >DEDUP_THRESHOLD distinct files → one collapsed item
 * showing a count and a bulk-fix command. Individual findings below the
 * threshold are shown per-file as before.
 */
function renderBucket(sev: Severity, group: Finding[]): string {
  // Group by category
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
      // Collapsed summary for high-occurrence rules
      const fileList = [...uniqueFiles].slice(0, 5).map((f) => `\`${esc(f)}\``).join(', ');
      const moreFiles = uniqueFiles.size > 5 ? ` +${uniqueFiles.size - 5} more` : '';
      const exampleMsg = catFindings[0]?.message ?? '';
      rows.push(
        `- **\`${esc(category)}\`** — ${esc(exampleMsg)} ` +
        `(**${plural(uniqueFiles.size, 'file')}**: ${fileList}${moreFiles})\n` +
        `  > 💡 Run \`thesmos fix --rule=${esc(category)}\` to fix all automatically`,
      );
    } else {
      // Individual findings for low-occurrence rules
      for (const f of catFindings) {
        const loc = f.line ? `:${f.line}` : '';
        const suggestion = f.suggestion ? `\n  > 💡 ${esc(f.suggestion)}` : '';
        rows.push(
          `- **\`${esc(f.file)}${loc}\`** — ${esc(f.message)} \`${esc(f.category)}\`${suggestion}`,
        );
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
  const scoreEmoji = score >= 90 ? '🟢' : score >= 70 ? '🟡' : score >= 50 ? '🟠' : '🔴';

  const headerLine =
    findings.length === 0
      ? '**✅ All governance checks passed — no findings.**'
      : `**${plural(findings.length, 'finding')} detected** across changed files.`;

  const severityTable = SEVERITY_ORDER.map((sev) => {
    const count = byGroup.get(sev)?.length ?? 0;
    return `| ${SEVERITY_EMOJI[sev]} ${sev} | ${count === 0 ? '—' : `**${count}**`} |`;
  }).join('\n');

  const findingSections =
    findings.length === 0
      ? ''
      : SEVERITY_ORDER.filter((sev) => (byGroup.get(sev)?.length ?? 0) > 0)
          .map((sev) => {
            const group = byGroup.get(sev) ?? [];
            const rows = renderBucket(sev, group);

            // BLOCKER and HIGH are expanded by default; others collapsed.
            const isExpanded = sev === 'BLOCKER' || sev === 'HIGH';
            const openAttr = isExpanded ? ' open' : '';

            return (
              `<details${openAttr}>\n` +
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

  const scoreSection =
    findings.length === 0
      ? ''
      : `\n**PR Score: ${scoreEmoji} ${score}/100**\n`;

  return [
    SUMMARY_MARKER,
    `## 🔱 Thesmos Governance Review`,
    ``,
    status,
    scoreSection,
    headerLine,
    ``,
    `| Severity | Count |`,
    `|----------|-------|`,
    severityTable,
    ``,
    findingSections,
    ``,
    `---`,
    `<sub>🔱 **Thesmos Governance** by Holley Studios · PR #${prNumber} in \`${repoName}\` · [SARIF audit trail](https://docs.github.com/en/code-security/code-scanning) available via \`thesmos validate --sarif\` (EU AI Act Art. 12)</sub>`,
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
 *   3. Come from a rule that fires on ≤DEDUP_THRESHOLD files (bulk rules
 *      are surfaced in the summary comment instead of flooding the diff view)
 *
 * Files and line numbers outside the diff will cause a 422 from GitHub.
 * We return comments for changed files only; the caller wraps the API
 * call in a try/catch to handle any remaining misses gracefully.
 */
export function buildInlineComments(
  findings: Finding[],
  changedFilePaths: Set<string>,
): InlineComment[] {
  // Identify bulk rules (firing on too many files) — inline comments for
  // these would overwhelm the diff view; they appear in the summary instead.
  const fileCountByCategory = new Map<string, Set<string>>();
  for (const f of findings) {
    const files = fileCountByCategory.get(f.category) ?? new Set<string>();
    files.add(f.file);
    fileCountByCategory.set(f.category, files);
  }
  const bulkCategories = new Set(
    [...fileCountByCategory.entries()]
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
