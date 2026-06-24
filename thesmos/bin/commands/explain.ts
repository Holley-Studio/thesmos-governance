/**
 * thesmos explain — make every rule self-documenting.
 *
 * Usage:
 *   thesmos explain <rule-id|category>     explain a specific rule
 *   thesmos explain file <path>            explain all rules active on a file
 *   thesmos explain finding <fingerprint>  explain the rule for a finding
 *   thesmos explain --list                 list all rules
 *
 * Flags:
 *   --json       machine-readable JSON
 *   --markdown   markdown output
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import {
  findRule,
  findRulesForFile,
  findRuleForFingerprint,
  listRules,
  formatExplainConsole,
  formatExplainMarkdown,
  formatExplainJson,
  formatExplainListConsole,
} from '../../explain.ts';
import type { ThesmosRule } from '../../types.ts';

export async function cmdExplain(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags, positionals } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const list = flag(flags, 'list');

  if (list || positionals.length === 0) {
    const rules = listRules();
    if (json) {
      const out = rules.map((r) => ({
        id: r.id,
        category: r.category,
        severity: r.severity,
        description: r.description,
      }));
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }
    process.stdout.write(formatExplainListConsole(rules));
    return;
  }

  const [subOrTarget, ...rest] = positionals;

  // thesmos explain file <path>
  if (subOrTarget === 'file') {
    const filePath = rest[0];
    if (!filePath) {
      process.stderr.write('thesmos explain file: path required\n');
      process.exit(1);
    }
    const findings = loadAndReview(root, config);
    if (!findings) return;
    const rules = findRulesForFile(filePath, findings);
    if (rules.length === 0) {
      process.stdout.write(`No findings for file: ${filePath}\n`);
      return;
    }
    outputRules(rules, json, markdown);
    return;
  }

  // thesmos explain finding <fingerprint>
  if (subOrTarget === 'finding') {
    const fp = rest[0];
    if (!fp) {
      process.stderr.write('thesmos explain finding: fingerprint prefix required\n');
      process.exit(1);
    }
    const findings = loadAndReview(root, config);
    if (!findings) return;
    const rule = findRuleForFingerprint(fp, findings);
    if (!rule) {
      process.stderr.write(`No finding matches fingerprint prefix: ${fp}\n`);
      process.exit(1);
    }
    outputRules([rule], json, markdown);
    return;
  }

  // thesmos explain <rule-id|category>
  const rule = findRule(subOrTarget);
  if (!rule) {
    process.stderr.write(
      `thesmos explain: unknown rule or category "${subOrTarget}"\n` +
        `  Run: thesmos explain --list  to see all rules\n`
    );
    process.exit(1);
  }

  // Load live violations from current scan (best-effort — no failure if no report)
  const scan = loadReport(root);
  const liveViolations = scan
    ? runReview({ scan, config }).filter(
        (f) => f.category === rule.category || f.category === rule.id
      )
    : null;

  outputRules([rule], json, markdown, liveViolations ?? undefined);
}

function loadAndReview(
  root: string,
  config: ReturnType<typeof import('../lib/context.ts').createContext>['config']
) {
  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write('thesmos explain: .thesmos/report.json not found — run thesmos scan first\n');
    process.exit(1);
  }
  return runReview({ scan, config });
}

import type { Finding } from '../../types.ts';

function formatLiveViolations(violations: Finding[]): string {
  if (violations.length === 0) return '  ✅  No current violations\n';
  const lines = [`  ${violations.length} current violation${violations.length === 1 ? '' : 's'}:\n`];
  for (const v of violations.slice(0, 10)) {
    const loc = v.line ? `:${v.line}` : '';
    lines.push(`    • ${v.file}${loc}`);
    lines.push(`      ${v.message}`);
    if (v.suggestion) lines.push(`      → ${v.suggestion}`);
  }
  if (violations.length > 10) lines.push(`    … and ${violations.length - 10} more`);
  return lines.join('\n') + '\n';
}

function outputRules(rules: ThesmosRule[], json: boolean, markdown: boolean, liveViolations?: Finding[]): void {
  if (json) {
    const out = rules.map((r) => ({
      ...JSON.parse(formatExplainJson(r)),
      liveViolations: liveViolations ?? null,
    }));
    process.stdout.write(JSON.stringify(rules.length === 1 ? out[0] : out, null, 2) + '\n');
    return;
  }
  for (const rule of rules) {
    if (markdown) {
      let md = formatExplainMarkdown(rule);
      if (liveViolations !== undefined) {
        if (liveViolations.length > 0) {
          md += `\n### Current Violations (${liveViolations.length})\n\n`;
          for (const v of liveViolations.slice(0, 10)) {
            const loc = v.line ? `:${v.line}` : '';
            md += `- \`${v.file}${loc}\` — ${v.message}\n`;
          }
          if (liveViolations.length > 10) md += `- … and ${liveViolations.length - 10} more\n`;
        } else {
          md += '\n### Current Violations\n\n✅ No current violations\n';
        }
      }
      process.stdout.write(md + '\n');
    } else {
      process.stdout.write(formatExplainConsole(rule));
      if (liveViolations !== undefined) {
        process.stdout.write('\n  Live violations in current scan:\n');
        process.stdout.write(formatLiveViolations(liveViolations));
      }
      process.stdout.write('\n');
    }
  }
}
