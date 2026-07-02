// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Thesmos Suppression System — inline governance exceptions.
 *
 * Supported syntax (on the line BEFORE the violation):
 *   // thesmos-disable-next-line <rule-id> -- reason: <text>
 *   // thesmos-disable-next-line <rule-id> -- reason: <text> -- owner: @alice -- expires: 2026-12-31
 *
 * Every suppression MUST include:
 *   - rule-id   (category name or rule ID, e.g. missing_api_auth or AUTH_001)
 *   - reason    (why the exception is approved)
 *
 * Optional fields:
 *   - owner     (who approved the exception, e.g. @alice)
 *   - expires   (ISO date YYYY-MM-DD — suppression auto-expires after this date)
 *
 * Future syntax (not yet supported, flagged by audit):
 *   // thesmos-disable <rule-id>  (file-scope, no line anchor)
 *
 * Audit categories detected by `thesmos suppressions:audit`:
 *   missing-reason  — suppression comment has no "-- reason:" clause
 *   expired         — expires date is in the past
 *   unused          — suppressed rule produced no finding at the annotated line
 *   blanket         — thesmos-disable-next-line with no rule ID (too broad)
 */

import type { Finding } from './types.js';
import { THESMOS_RULES } from './adapters.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface Suppression {
  ruleId: string;          // category or rule ID as written in the comment
  reason: string | null;   // null → missing-reason audit finding
  owner: string | null;
  expiresAt: string | null; // ISO date string (YYYY-MM-DD), or null
  file: string;
  line: number;            // 1-based line number of the suppression comment
  suppressedLine: number;  // line + 1 (the line the suppression applies to)
}

export type SuppressionAuditType = 'missing-reason' | 'expired' | 'unused' | 'blanket';

export interface SuppressionAuditFinding {
  type: SuppressionAuditType;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  file: string;
  line: number;
  message: string;
  fixSuggestion: string;
}

export interface SuppressionResult {
  /** Findings with NO matching active suppression — shown in "Active Findings". */
  activeFindings: Finding[];
  /** Findings matched by an active suppression — shown in "Suppressed Findings". */
  suppressedFindings: Finding[];
  /** Suppressions that consumed a finding (valid and in use). */
  activeSuppressions: Suppression[];
  /** Suppressions that did not match any finding (potentially unused). */
  unusedSuppressions: Suppression[];
}

export interface SuppressionAuditInput {
  suppressions: Suppression[];
  findings: Finding[];
  now: Date;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

const DISABLE_NEXT_LINE_RE = /^\s*\/\/\s*thesmos-disable-next-line\s*(.*)/i;
const DISABLE_FILE_RE = /^\s*\/\/\s*thesmos-disable\s+(.*)/i;

function parseAttribute(text: string, key: string): string | null {
  // Split on " -- " separators so hyphens in values (e.g. dates) are not consumed
  const segments = text.split(/\s+--\s+/);
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'i');
  for (const seg of segments) {
    const m = re.exec(seg.trim());
    if (m) return m[1]!.trim();
  }
  return null;
}

/**
 * Parse a single line for a suppression comment.
 * Returns null if the line is not a suppression directive.
 */
export function parseSuppression(
  line: string,
  lineNum: number,
  filePath: string
): Suppression | null {
  const m = DISABLE_NEXT_LINE_RE.exec(line) ?? DISABLE_FILE_RE.exec(line);
  if (!m) return null;

  const rest = m[1]!.trim();
  // Extract rule ID (first token before " -- " or end)
  const ruleId = rest.split(/\s+--\s+/)[0]!.trim();
  const reason = parseAttribute(rest, 'reason');
  const owner = parseAttribute(rest, 'owner');
  const expiresAt = parseAttribute(rest, 'expires');

  return {
    ruleId,
    reason,
    owner,
    expiresAt,
    file: filePath,
    line: lineNum,
    suppressedLine: lineNum + 1,
  };
}

/**
 * Extract all suppression comments from a file's content.
 */
export function extractSuppressions(content: string, filePath: string): Suppression[] {
  const lines = content.split('\n');
  const isSuppressionLine = lines.map(
    (l) => DISABLE_NEXT_LINE_RE.test(l) || DISABLE_FILE_RE.test(l)
  );
  const suppressions: Suppression[] = [];
  for (let i = 0; i < lines.length; i++) {
    const s = parseSuppression(lines[i]!, i + 1, filePath);
    if (!s) continue;
    // Consecutive suppression comments chain to the next non-suppression line,
    // so stacked comments can suppress multiple rules on one target line.
    let target = i + 1; // 0-based index of the candidate suppressed line
    while (target < lines.length && isSuppressionLine[target]) target++;
    suppressions.push({ ...s, suppressedLine: target + 1 });
  }
  return suppressions;
}

// ── Canonical resolution ──────────────────────────────────────────────────────

/**
 * Resolve a rule ID or category string to a canonical category name.
 * Returns the input unchanged if it doesn't match any known rule.
 */
export function resolveCategory(idOrCategory: string): string {
  const lower = idOrCategory.toLowerCase();
  const match = THESMOS_RULES.find(
    (r) => r.id.toLowerCase() === lower || r.category.toLowerCase() === lower
  );
  return match?.category ?? idOrCategory;
}

// ── Applying suppressions ─────────────────────────────────────────────────────

/**
 * Partition findings into active (unsuppressed) and suppressed.
 * Matching: a suppression at line N suppresses findings in the same file
 * whose category matches the suppression's ruleId AND whose line === N+1.
 * Expired suppressions are NOT applied (treated as inactive).
 */
export function applySuppressions(
  findings: Finding[],
  suppressions: Suppression[],
  now: Date
): SuppressionResult {
  // Only consider suppressions that are not expired
  const activeSups = suppressions.filter((s) => {
    if (!s.expiresAt) return true;
    return new Date(s.expiresAt) >= now;
  });

  const consumed = new Set<number>(); // index into activeSups
  const suppressedFindings: Finding[] = [];
  const activeFindings: Finding[] = [];

  for (const finding of findings) {
    const matchIdx = activeSups.findIndex((s, idx) => {
      if (consumed.has(idx)) return false;
      if (s.file !== finding.file) return false;
      if (finding.line !== undefined && s.suppressedLine !== finding.line) return false;
      const cat = resolveCategory(s.ruleId);
      return cat === finding.category || s.ruleId === finding.category;
    });

    if (matchIdx !== -1) {
      consumed.add(matchIdx);
      suppressedFindings.push(finding);
    } else {
      activeFindings.push(finding);
    }
  }

  const usedSuppressions = activeSups.filter((_, i) => consumed.has(i));
  const unusedSuppressions = activeSups.filter((_, i) => !consumed.has(i));

  return { activeFindings, suppressedFindings, activeSuppressions: usedSuppressions, unusedSuppressions };
}

// ── Audit ─────────────────────────────────────────────────────────────────────

/**
 * Audit a list of suppressions for common problems.
 * Pure — no filesystem access. All data passed in as arguments.
 */
export function auditSuppressions(input: SuppressionAuditInput): SuppressionAuditFinding[] {
  const { suppressions, findings, now } = input;
  const result: SuppressionAuditFinding[] = [];

  // Build a set of (file, line, category) tuples for findings to detect unused suppressions
  const findingKeys = new Set(
    findings
      .filter((f) => f.line !== undefined)
      .map((f) => `${f.file}:${f.line}:${f.category}`)
  );

  for (const s of suppressions) {
    // blanket — no rule ID
    if (!s.ruleId) {
      result.push({
        type: 'blanket',
        severity: 'HIGH',
        file: s.file,
        line: s.line,
        message: 'Blanket suppression with no rule ID — too broad.',
        fixSuggestion: 'Specify a rule ID: thesmos-disable-next-line <rule-id> -- reason: ...',
      });
      continue;
    }

    // missing reason
    if (!s.reason) {
      result.push({
        type: 'missing-reason',
        severity: 'MEDIUM',
        file: s.file,
        line: s.line,
        message: `Suppression for "${s.ruleId}" has no reason — governance requires a justification.`,
        fixSuggestion: `Add: -- reason: <why this exception is approved>`,
      });
    }

    // expired
    if (s.expiresAt) {
      const expiry = new Date(s.expiresAt);
      if (expiry < now) {
        result.push({
          type: 'expired',
          severity: 'HIGH',
          file: s.file,
          line: s.line,
          message: `Suppression for "${s.ruleId}" expired on ${s.expiresAt} — remove or renew.`,
          fixSuggestion: `Remove the suppression or update the expires date if the exception is still needed.`,
        });
      }
    }

    // unused — suppressed rule produced no finding at the annotated line
    const resolvedCat = resolveCategory(s.ruleId);
    const key = `${s.file}:${s.suppressedLine}:${resolvedCat}`;
    if (!findingKeys.has(key)) {
      result.push({
        type: 'unused',
        severity: 'LOW',
        file: s.file,
        line: s.line,
        message: `Suppression for "${s.ruleId}" at line ${s.suppressedLine} matched no finding — may be stale.`,
        fixSuggestion: `Remove the suppression if the violation no longer exists.`,
      });
    }
  }

  return sortAuditFindings(result);
}

function sortAuditFindings(findings: SuppressionAuditFinding[]): SuppressionAuditFinding[] {
  const severityOrder = ['HIGH', 'MEDIUM', 'LOW'];
  return [...findings].sort((a, b) => {
    const sa = severityOrder.indexOf(a.severity);
    const sb = severityOrder.indexOf(b.severity);
    if (sa !== sb) return sa - sb;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

const SEVERITY_ICON: Record<SuppressionAuditFinding['severity'], string> = {
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🔵',
};

const TYPE_LABEL: Record<SuppressionAuditType, string> = {
  'missing-reason': 'missing-reason',
  expired: 'expired',
  unused: 'unused',
  blanket: 'blanket',
};

export function formatSuppressionAuditConsole(
  findings: SuppressionAuditFinding[],
  suppressionCount: number,
  projectName = 'Repo'
): string {
  const lines: string[] = [];
  const SEP = '─'.repeat(56);

  lines.push(`Thesmos Suppressions Audit — ${projectName}`);
  lines.push(SEP);
  lines.push(`  ${suppressionCount} suppression${suppressionCount === 1 ? '' : 's'} scanned`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('  ✅  All suppressions are valid.');
    lines.push('');
    lines.push(SEP);
    return lines.join('\n');
  }

  for (const f of findings) {
    lines.push(`  ${SEVERITY_ICON[f.severity]}  [${TYPE_LABEL[f.type]}]  ${f.file}:${f.line}`);
    lines.push(`       ${f.message}`);
    lines.push(`       → ${f.fixSuggestion}`);
    lines.push('');
  }

  lines.push(SEP);
  lines.push(`  ${findings.length} audit finding${findings.length === 1 ? '' : 's'}`);

  return lines.join('\n');
}

export function formatSuppressionAuditMarkdown(
  findings: SuppressionAuditFinding[],
  suppressionCount: number,
  projectName = 'Repo'
): string {
  const lines: string[] = [];
  lines.push(`## Thesmos Suppressions Audit — ${projectName}`);
  lines.push('');
  lines.push(`> ${suppressionCount} suppression${suppressionCount === 1 ? '' : 's'} scanned`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('**✅ All suppressions are valid.**');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`**${findings.length} audit finding${findings.length === 1 ? '' : 's'}**`);
  lines.push('');
  lines.push('| Severity | Type | File | Message |');
  lines.push('|---|---|---|---|');
  for (const f of findings) {
    lines.push(
      `| ${SEVERITY_ICON[f.severity]} **${f.severity}** | \`${TYPE_LABEL[f.type]}\` | \`${f.file}:${f.line}\` | ${f.message} |`
    );
  }
  lines.push('');

  return lines.join('\n');
}

export function formatSuppressionAuditJson(
  findings: SuppressionAuditFinding[],
  suppressionCount: number
): string {
  return JSON.stringify(
    {
      clean: findings.length === 0,
      suppressionCount,
      auditFindings: findings.length,
      findings,
    },
    null,
    2
  );
}

/** Format review output with both suppressed and active sections. */
export function formatReviewWithSuppressions(
  result: SuppressionResult,
  projectName = 'Repo'
): string {
  const { activeFindings, suppressedFindings } = result;
  const lines: string[] = [];
  const SEP = '─'.repeat(56);
  const EMOJI: Record<string, string> = {
    BLOCKER: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵', TECH_DEBT: '⚪',
  };

  lines.push(`Thesmos Review — ${projectName}`);
  lines.push('');

  // Active findings
  if (activeFindings.length === 0) {
    lines.push('  ✅  No active findings.');
  } else {
    lines.push(`  Active Findings (${activeFindings.length})`);
    lines.push('');
    for (const f of activeFindings) {
      const loc = f.line ? `:${f.line}` : '';
      lines.push(`  ${EMOJI[f.severity] ?? '⬜'}  ${f.severity.padEnd(10)}  ${f.category}`);
      lines.push(`       ${f.file}${loc}`);
      lines.push(`       ${f.message}`);
      if (f.suggestion) lines.push(`       → ${f.suggestion}`);
      lines.push('');
    }
  }

  // Suppressed findings
  if (suppressedFindings.length > 0) {
    lines.push(SEP);
    lines.push('');
    lines.push(`  Suppressed Findings (${suppressedFindings.length})`);
    lines.push('');
    for (const f of suppressedFindings) {
      const loc = f.line ? `:${f.line}` : '';
      lines.push(`  ~~${f.category}~~  ${f.file}${loc}  [suppressed]`);
    }
    lines.push('');
  }

  lines.push(SEP);
  lines.push(`  ${activeFindings.length} active  ·  ${suppressedFindings.length} suppressed`);

  return lines.join('\n');
}
