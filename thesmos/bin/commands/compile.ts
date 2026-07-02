// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos compile — multi-model rule compiler
 *
 * Converts Thesmos governance rules to provider-specific instruction formats.
 * Users can govern Claude Code, Cursor (GPT-4), and Gemini CLI from a single config.
 *
 * Usage:
 *   thesmos compile --provider anthropic     System prompt block for Claude / Claude Code
 *   thesmos compile --provider openai        System instructions for GPT-4 / Assistants API
 *   thesmos compile --provider google        System instructions for Gemini / Gemini CLI
 *   thesmos compile --provider all           Generate all three
 *   thesmos compile --out <dir>              Write to directory (default: .thesmos/compiled/)
 *   thesmos compile --categories sec,auth    Only include rules from these categories
 *   thesmos compile --severity BLOCKER       Only include rules at or above severity
 *   thesmos compile --json                   Machine-readable output
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { THESMOS_RULES } from '../../rules/registry.js';
import type { ThesmosRule as Rule } from '../../types.js';

type Provider = 'anthropic' | 'openai' | 'google';
type Severity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

const SEVERITY_ORDER: Record<Severity, number> = { BLOCKER: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };

// ── Rule filtering ─────────────────────────────────────────────────────────────

function filterRules(rules: Rule[], opts: { categories?: string[]; minSeverity?: Severity }): Rule[] {
  return rules.filter((r) => {
    if (opts.categories && opts.categories.length > 0) {
      const cat = (r.category ?? r.id.split('_')[0]).toLowerCase();
      if (!opts.categories.some((c) => cat.startsWith(c.toLowerCase()))) return false;
    }
    if (opts.minSeverity) {
      const rSev = (r.severity as Severity) ?? 'INFO';
      if ((SEVERITY_ORDER[rSev] ?? 0) < (SEVERITY_ORDER[opts.minSeverity] ?? 0)) return false;
    }
    return true;
  });
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function compileAnthropic(rules: Rule[]): string {
  const lines: string[] = [
    '<thesmos_governance>',
    `This project uses Thesmos governance. The following ${rules.length} rules are active.`,
    'Respect all rules before generating or modifying code.',
    '',
  ];

  const byCategory = groupByCategory(rules);
  for (const [cat, catRules] of Object.entries(byCategory)) {
    lines.push(`<!-- Category: ${cat} -->`);
    for (const r of catRules) {
      const sev = r.severity ?? 'MEDIUM';
      lines.push(`- [${sev}] ${r.id}: ${r.description}`);
      if (r.explain?.why) lines.push(`  Why: ${r.explain.why}`);
    }
    lines.push('');
  }

  lines.push('</thesmos_governance>');
  return lines.join('\n');
}

function compileOpenAI(rules: Rule[]): string {
  const lines: string[] = [
    '## Thesmos Governance Rules',
    '',
    `This assistant operates under ${rules.length} active governance rules.`,
    'Always comply with these rules before generating or editing code.',
    '',
  ];

  const byCategory = groupByCategory(rules);
  for (const [cat, catRules] of Object.entries(byCategory)) {
    lines.push(`### ${cat}`);
    lines.push('');
    for (const r of catRules) {
      const sev = r.severity ?? 'MEDIUM';
      lines.push(`**${r.id}** [${sev}]: ${r.description}`);
      if (r.explain?.badExample) {
        lines.push(`- Avoid: \`${r.explain.badExample.split('\n')[0]}\``);
      }
      if (r.explain?.goodExample) {
        lines.push(`- Prefer: \`${r.explain.goodExample.split('\n')[0]}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function compileGoogle(rules: Rule[]): string {
  const lines: string[] = [
    'THESMOS GOVERNANCE',
    `Active rules: ${rules.length}`,
    '',
    'Comply with all rules below when generating, editing, or reviewing code.',
    '',
  ];

  const byCategory = groupByCategory(rules);
  for (const [cat, catRules] of Object.entries(byCategory)) {
    lines.push(`[${cat.toUpperCase()}]`);
    for (const r of catRules) {
      const sev = r.severity ?? 'MEDIUM';
      lines.push(`  ${r.id} (${sev}): ${r.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function groupByCategory(rules: Rule[]): Record<string, Rule[]> {
  const groups: Record<string, Rule[]> = {};
  for (const r of rules) {
    const cat = r.category ?? r.id.split('_')[0] ?? 'General';
    (groups[cat] ??= []).push(r);
  }
  return groups;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdCompile(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);

  const providerFlag = (flagVal(flags, 'provider') ?? 'anthropic') as string;
  const outDir = flagVal(flags, 'out') as string | undefined;
  const json = flag(flags, 'json');
  const categoriesFlag = flagVal(flags, 'categories') as string | undefined;
  const severityFlag = flagVal(flags, 'severity') as Severity | undefined;

  const providers: Provider[] =
    providerFlag === 'all' ? ['anthropic', 'openai', 'google'] : [providerFlag as Provider];

  const validProviders: Provider[] = ['anthropic', 'openai', 'google'];
  for (const p of providers) {
    if (!validProviders.includes(p)) {
      process.stderr.write(`thesmos compile: unknown provider "${p}". Use: anthropic, openai, google, all\n`);
      process.exit(1);
    }
  }

  const cats = categoriesFlag ? categoriesFlag.split(',').map((c) => c.trim()) : undefined;
  const rules = filterRules(THESMOS_RULES as unknown as Rule[], { categories: cats, minSeverity: severityFlag });

  if (rules.length === 0) {
    process.stderr.write('thesmos compile: no rules matched the given filters\n');
    process.exit(1);
  }

  const root = process.cwd();
  const writeDir = outDir ?? join(root, '.thesmos', 'compiled');
  const results: Record<string, string> = {};

  for (const provider of providers) {
    let content: string;
    switch (provider) {
      case 'anthropic': content = compileAnthropic(rules); break;
      case 'openai':    content = compileOpenAI(rules);    break;
      case 'google':    content = compileGoogle(rules);    break;
    }
    results[provider] = content!;
  }

  if (json) {
    process.stdout.write(JSON.stringify({ rules: rules.length, providers: results }, null, 2) + '\n');
    return;
  }

  const writeToFile = providers.length > 1 || outDir;
  if (writeToFile) {
    mkdirSync(writeDir, { recursive: true });
    for (const [p, content] of Object.entries(results)) {
      const filename = `thesmos-rules-${p}.txt`;
      writeFileSync(join(writeDir, filename), content, 'utf8');
      process.stdout.write(`  ✓ ${filename} — ${rules.length} rules\n`);
    }
    process.stdout.write(`\n  Written to: ${writeDir}/\n\n`);
  } else {
    process.stdout.write(Object.values(results)[0]! + '\n');
  }
}
