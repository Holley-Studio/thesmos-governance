// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agent credential lint (WS7).
 *
 * An agent is a reasoning profile, not a person. It has no employment history,
 * no tenure, and no track record. Writing "20+ years of experience" or
 * "generated 400 qualified leads a month" into an agent persona invents a
 * professional biography for software — which is both false and, on a
 * commercial surface, an unsubstantiated performance claim.
 *
 * This lint replaces that with what is actually true and useful: domain scope,
 * methodologies, decision frameworks, evidence expectations and limitations.
 *
 * A clean run means no *detected* fabricated-credential pattern remains. It is
 * not a guarantee that every sentence is substantiated — patterns catch shapes,
 * not meaning.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type CredentialSeverity = 'error' | 'warn';

export interface CredentialRule {
  id: string;
  severity: CredentialSeverity;
  pattern: RegExp;
  message: string;
  guidance: string;
}

/**
 * Deliberately narrow patterns. A broad ban on digits would flag legitimate
 * technical statements ("WCAG 2.2 AA", "1,137 rules") and train authors to
 * work around the lint rather than fix the claim.
 */
export const CREDENTIAL_RULES: readonly CredentialRule[] = [
  {
    id: 'CRED_YEARS_EXPERIENCE',
    severity: 'error',
    /**
     * Fires only on a tenure claim ABOUT THE AGENT, not on every number of
     * years in the document.
     *
     * Agents legitimately emit domain content containing durations — an NDA
     * clause ("2 years from the Effective Date"), a job description the agent
     * drafts ("4+ years in B2B SaaS marketing"), a payback period. Flagging
     * those is a false positive that teaches authors to route around the lint.
     * The résumé shape is first-person or copular: "You have N years…",
     * "with N+ years of experience", "N years building…".
     */
    pattern:
      /\b(?:you (?:have|bring|possess)|i (?:have|bring)|with|over|more than)\s+\d+\+?\s*years?\b|\b\d+\+?\s*years?\s+of\s+(?:hands-on\s+)?experience\b/gi,
    message: 'Claims a tenure. An agent has no employment history.',
    guidance: 'State the domain and methodology instead: "A specialist reasoning profile informed by <frameworks>."',
  },
  {
    id: 'CRED_EMPLOYER_CLAIM',
    severity: 'error',
    pattern: /\b(Fortune\s*(100|500)|FAANG|worked (?:at|for)|ex-(?:Google|Amazon|Meta|Apple|Microsoft|Netflix))\b/gi,
    message: 'Claims employment or client history that did not occur.',
    guidance: 'Remove. Describe the domain and decision framework instead.',
  },
  {
    id: 'CRED_OUTCOME_METRIC',
    severity: 'error',
    /**
     * A claimed BUSINESS OUTCOME the agent supposedly achieved — first person,
     * past tense, with a business-domain unit.
     *
     * Requires an explicit business noun. A bare verb + percentage matches
     * ordinary domain content ("decorative fills at reduced opacity (50%)"),
     * and flagging that trains authors to ignore the lint.
     */
    pattern:
      /\b(?:you|i|we)\s+(?:have\s+)?(?:generated|delivered|drove|driven|grew|grown|reduced|increased|improved|saved|closed|scaled)\b[^.\n]{0,70}?\b\d[\d,]*\+?\s*(?:%|percent)?\s*(?:qualified\s+)?(?:leads|customers|users|followers|deals|subscribers|revenue|ARR|MRR|pipeline)\b/gi,
    message: 'Claims a measured business outcome the agent did not achieve.',
    guidance: 'Remove the number, or move the claim to the claims registry with evidence.',
  },
  {
    id: 'CRED_CREDENTIALS',
    severity: 'error',
    /**
     * Requires a HOLDING context. Bare initialisms are ambiguous in this
     * domain — "JD" is a job description far more often than a Juris Doctor,
     * and "CPA" appears in accounting content the agent legitimately discusses.
     */
    pattern:
      /\b(?:you|i)\s+(?:are|hold|have)\s+(?:a|an)\s+(?:MBA|PhD|CPA|JD|licen[cs]ed)\b|\bboard-certified\b|\blicen[cs]ed\s+(?:attorney|physician|accountant|therapist)\b|\b(?:you|i)\s+am?\s+certified\s+in\b/gi,
    message: 'Claims a professional credential or licence.',
    guidance: 'An AI tool holds no licence. Remove, and add the required human-review limitation.',
  },
  {
    id: 'CRED_AWARDS',
    severity: 'warn',
    pattern: /\b(award-winning|industry-leading|world-class|best-in-class)\b/gi,
    message: 'Unsubstantiated superlative.',
    guidance: 'Describe the actual capability instead.',
  },
];

export interface CredentialFinding {
  ruleId: string;
  severity: CredentialSeverity;
  file: string;
  line: number;
  excerpt: string;
  message: string;
  guidance: string;
}

/**
 * Path-scoped exceptions, each with a stated reason.
 *
 * Broad globs are refused by `validateExceptions` — an exception that hides a
 * whole tree is how a lint quietly stops working.
 */
export const CREDENTIAL_EXCEPTIONS: readonly { path: string; reason: string }[] = [
  { path: 'credentials.ts', reason: 'the linter necessarily contains the patterns' },
  { path: 'credentials.test.ts', reason: 'tests assert on the patterns' },
  { path: 'catalog/AGENT_QUALITY_STANDARD.md', reason: 'the standard quotes prohibited examples to forbid them' },
];

export function validateExceptions(
  exceptions: readonly { path: string; reason: string }[] = CREDENTIAL_EXCEPTIONS,
): void {
  for (const e of exceptions) {
    if (!e.reason?.trim()) throw new Error(`credential exception "${e.path}" has no reason`);
    if (e.path === '**' || e.path === '*' || e.path.endsWith('/**') || e.path === '') {
      throw new Error(`credential exception "${e.path}" is a broad glob — exceptions must be path-scoped`);
    }
  }
}

export function isCredentialExempt(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  return CREDENTIAL_EXCEPTIONS.some((e) => p.endsWith(e.path) || p.includes(e.path));
}

/**
 * A line that TELLS the user to seek professional help is the opposite of a
 * credential claim — it is the required limitation. Flagging an agent's own
 * disclaimer would push authors to delete exactly the sentence that should
 * stay.
 */
const DISCLAIMER_CONTEXT =
  /\b(disclaimer|not (?:a substitute|legal advice|financial advice|medical advice)|consult|seek|qualified (?:legal|professional|medical|financial)|does not (?:constitute|establish)|review by)\b/i;

export function lintCredentialContent(content: string, rel: string): CredentialFinding[] {
  const out: CredentialFinding[] = [];
  const lines = content.split('\n');
  for (const rule of CREDENTIAL_RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (rule.id === 'CRED_CREDENTIALS' && DISCLAIMER_CONTEXT.test(line)) continue;
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(line)) continue;
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        file: rel,
        line: i + 1,
        excerpt: line.trim().slice(0, 160),
        message: rule.message,
        guidance: rule.guidance,
      });
    }
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

export interface CredentialLintResult {
  findings: CredentialFinding[];
  filesScanned: number;
  errors: number;
  warnings: number;
}

/**
 * Scan every canonical agent plus the generated plugin copies. Both are
 * customer-visible surfaces, so both must be clean.
 */
export function runCredentialLint(pkgRoot: string, repoRoot: string): CredentialLintResult {
  validateExceptions();
  const roots = [join(pkgRoot, 'catalog', 'agents'), join(repoRoot, 'pantheon-plugin', 'agents')];

  const findings: CredentialFinding[] = [];
  let filesScanned = 0;
  for (const root of roots) {
    for (const full of walk(root)) {
      const rel = relative(repoRoot, full).replace(/\\/g, '/');
      if (isCredentialExempt(rel)) continue;
      filesScanned++;
      findings.push(...lintCredentialContent(readFileSync(full, 'utf8'), rel));
    }
  }
  return {
    findings,
    filesScanned,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
  };
}

export function formatCredentialLint(result: CredentialLintResult): string {
  const lines: string[] = [];
  lines.push(`Credential lint — ${result.filesScanned} agent file(s) scanned`);
  if (result.findings.length === 0) {
    lines.push('No fabricated-credential patterns detected.');
    lines.push('');
    lines.push('Note: patterns catch shapes, not meaning. A clean run is not a guarantee');
    lines.push('that every sentence is substantiated.');
    return lines.join('\n');
  }
  lines.push(`${result.errors} error(s), ${result.warnings} warning(s)`);
  lines.push('');
  for (const f of result.findings.slice(0, 200)) {
    lines.push(`${f.file}:${f.line}  [${f.severity}] ${f.ruleId}`);
    lines.push(`  ${f.message}`);
    lines.push(`  > ${f.excerpt}`);
    lines.push(`  fix: ${f.guidance}`);
    lines.push('');
  }
  if (result.findings.length > 200) lines.push(`… ${result.findings.length - 200} more`);
  return lines.join('\n');
}
