// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Thesmos Explain Engine — makes every rule self-documenting.
 *
 * All explanation content lives in the rule registry (registry.ts).
 * This module provides lookup, formatting, and CLI-ready outputs.
 * No network calls — works fully offline.
 *
 * Lookup modes:
 *   by ID or category  → findRule('ENV_001') / findRule('direct_env_access')
 *   by file            → findRulesForFile('src/api/users/route.ts', findings)
 *   by finding fp      → findRuleForFingerprint('abc123', findings)
 */

import type { ThesmosRule, RuleExplanation } from './types.js';
import type { Finding } from './types.js';
import { THESMOS_RULES } from './adapters.js';
import { SEVERITY_EMOJI } from './severity.js';
import { fingerprintFinding } from './baseline.js';

// ── Lookups ───────────────────────────────────────────────────────────────────

/** Look up a rule by its ID (e.g. "ENV_001") or category (e.g. "direct_env_access"). */
export function findRule(idOrCategory: string): ThesmosRule | null {
  const needle = idOrCategory.trim().toLowerCase();
  return (
    THESMOS_RULES.find(
      (r) => r.id.toLowerCase() === needle || r.category.toLowerCase() === needle
    ) ?? null
  );
}

/** Return the unique set of rules that fired findings for the given file path. */
export function findRulesForFile(file: string, findings: Finding[]): ThesmosRule[] {
  const categories = new Set(
    findings.filter((f) => f.file === file).map((f) => f.category)
  );
  return THESMOS_RULES.filter((r) => categories.has(r.category));
}

/**
 * Find the rule for the finding whose fingerprint starts with the given prefix.
 * Matches the first finding whose 16-hex fingerprint begins with `prefix`.
 */
export function findRuleForFingerprint(prefix: string, findings: Finding[]): ThesmosRule | null {
  const lower = prefix.toLowerCase();
  const match = findings.find((f) => fingerprintFinding(f).startsWith(lower));
  if (!match) return null;
  return findRule(match.category);
}

/** Return all rules, sorted by severity rank then ID. */
export function listRules(): ThesmosRule[] {
  const severityOrder = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'];
  return [...THESMOS_RULES].sort((a, b) => {
    const sa = severityOrder.indexOf(a.severity);
    const sb = severityOrder.indexOf(b.severity);
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

const MISSING_EXPLANATION = '(no explanation defined for this rule)';

function explainSection(explain: RuleExplanation | undefined): {
  why: string;
  violations: string[];
  good: string;
  bad: string;
  playbooks: string[];
  agents: string[];
  skills: string[];
} {
  return {
    why: explain?.why ?? MISSING_EXPLANATION,
    violations: explain?.commonViolations ?? [],
    good: explain?.goodExample ?? '',
    bad: explain?.badExample ?? '',
    playbooks: explain?.relatedPlaybooks ?? [],
    agents: explain?.relatedAgents ?? [],
    skills: explain?.relatedSkills ?? [],
  };
}

export function formatExplainConsole(rule: ThesmosRule): string {
  const lines: string[] = [];
  const SEP = '─'.repeat(60);
  const ex = explainSection(rule.explain);

  lines.push('');
  lines.push(`  ${SEVERITY_EMOJI[rule.severity]}  ${rule.id} — ${rule.category}`);
  lines.push(`     Severity: ${rule.severity}  |  Tags: ${rule.tags.join(', ')}`);
  lines.push(`     Since: ${rule.sinceVersion}`);
  lines.push('');
  lines.push(SEP);
  lines.push('');
  lines.push('  Description');
  lines.push(`  ${rule.description}`);
  lines.push('');
  lines.push('  Why this rule exists');
  lines.push(`  ${ex.why}`);

  if (ex.violations.length > 0) {
    lines.push('');
    lines.push('  Common violations');
    for (const v of ex.violations) {
      lines.push(`    • ${v}`);
    }
  }

  if (ex.bad) {
    lines.push('');
    lines.push('  ❌ Bad example');
    for (const l of ex.bad.split('\n')) lines.push(`    ${l}`);
  }

  if (ex.good) {
    lines.push('');
    lines.push('  ✅ Good example');
    for (const l of ex.good.split('\n')) lines.push(`    ${l}`);
  }

  if (ex.playbooks.length > 0) {
    lines.push('');
    lines.push(`  Related playbooks:  ${ex.playbooks.join('  ·  ')}`);
  }
  if (ex.agents.length > 0) {
    lines.push(`  Related agents:     ${ex.agents.join('  ·  ')}`);
  }
  if (ex.skills.length > 0) {
    lines.push(`  Related skills:     ${ex.skills.join('  ·  ')}`);
  }

  lines.push('');
  lines.push(SEP);

  return lines.join('\n');
}

export function formatExplainMarkdown(rule: ThesmosRule): string {
  const lines: string[] = [];
  const ex = explainSection(rule.explain);

  lines.push(`## ${rule.id} — \`${rule.category}\``);
  lines.push('');
  lines.push(`**Severity:** ${SEVERITY_EMOJI[rule.severity]} ${rule.severity}  `);
  lines.push(`**Tags:** ${rule.tags.map((t) => `\`${t}\``).join(', ')}  `);
  lines.push(`**Since:** ${rule.sinceVersion}`);
  lines.push('');
  lines.push('### Description');
  lines.push('');
  lines.push(rule.description);
  lines.push('');
  lines.push('### Why this rule exists');
  lines.push('');
  lines.push(ex.why);

  if (ex.violations.length > 0) {
    lines.push('');
    lines.push('### Common violations');
    lines.push('');
    for (const v of ex.violations) {
      lines.push(`- ${v}`);
    }
  }

  if (ex.bad) {
    lines.push('');
    lines.push('### ❌ Bad example');
    lines.push('');
    lines.push('```');
    lines.push(ex.bad);
    lines.push('```');
  }

  if (ex.good) {
    lines.push('');
    lines.push('### ✅ Good example');
    lines.push('');
    lines.push('```');
    lines.push(ex.good);
    lines.push('```');
  }

  if (ex.playbooks.length > 0 || ex.agents.length > 0 || ex.skills.length > 0) {
    lines.push('');
    lines.push('### Related resources');
    lines.push('');
    if (ex.playbooks.length > 0) {
      lines.push(`**Playbooks:** ${ex.playbooks.map((p) => `\`${p}\``).join(', ')}`);
    }
    if (ex.agents.length > 0) {
      lines.push(`**Agents:** ${ex.agents.map((a) => `\`${a}\``).join(', ')}`);
    }
    if (ex.skills.length > 0) {
      lines.push(`**Skills:** ${ex.skills.map((s) => `\`${s}\``).join(', ')}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

export function formatExplainJson(rule: ThesmosRule): string {
  return JSON.stringify(
    {
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      tags: rule.tags,
      description: rule.description,
      sinceVersion: rule.sinceVersion,
      explanation: rule.explain ?? null,
    },
    null,
    2
  );
}

/** Format a brief one-line summary for list views. */
export function formatRuleListLine(rule: ThesmosRule): string {
  return `  ${SEVERITY_EMOJI[rule.severity]}  ${rule.id.padEnd(10)}  ${rule.category.padEnd(30)}  ${rule.severity}`;
}

export function formatExplainListConsole(rules: ThesmosRule[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${'ID'.padEnd(10)}  ${'Category'.padEnd(30)}  Severity`);
  lines.push(`  ${'─'.repeat(10)}  ${'─'.repeat(30)}  ${'─'.repeat(9)}`);
  for (const rule of rules) {
    lines.push(formatRuleListLine(rule));
  }
  lines.push('');
  lines.push(`  ${rules.length} rule${rules.length === 1 ? '' : 's'} total`);
  lines.push('');
  return lines.join('\n');
}
