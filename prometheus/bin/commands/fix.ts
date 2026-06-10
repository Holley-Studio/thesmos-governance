/**
 * prometheus fix — auto-fix safe violations.
 *
 * Applies in-place fixes for rules that have unambiguous, zero-risk remediation:
 *   - console_log: remove the offending console.* line
 *
 * Dry-run by default. Use --apply to write changes to disk.
 *
 * Flags:
 *   --apply          Write fixes to disk (default: dry-run/preview)
 *   --rule=<id>      Only fix this specific rule ID
 *   --json           Machine-readable summary of applied/skipped fixes
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import { loadBaseline, partitionFindings } from '../../baseline.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Finding } from '../../types.ts';

// ── Fixer registry ─────────────────────────────────────────────────────────────
// Each fixer receives the file content + finding and returns the patched content,
// or null if it cannot safely auto-fix this finding.

type Fixer = (content: string, finding: Finding) => string | null;

const FIXERS: Record<string, Fixer> = {
  console_log: (content, finding) => {
    if (finding.line == null) return null;
    const lines = content.split('\n');
    const idx = finding.line - 1;
    if (idx < 0 || idx >= lines.length) return null;
    const line = lines[idx]!;
    // Only remove if this line is recognisably a console.* call
    if (!/\bconsole\.(log|warn|error|info|debug|trace)\b/.test(line)) return null;
    lines.splice(idx, 1);
    return lines.join('\n');
  },
};

const AUTO_FIXABLE = new Set(Object.keys(FIXERS));

// ── Command ───────────────────────────────────────────────────────────────────

export async function cmdFix(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const apply = flag(flags, 'apply');
  const ruleFilter = flagVal(flags, 'rule')?.toLowerCase();
  const json = flag(flags, 'json');

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write('prometheus fix: .prometheus/report.json not found — run prometheus scan first\n');
    process.exit(1);
  }

  const allFindings = runReview({ scan, config });
  const baseline = loadBaseline(root);
  const findings = baseline ? partitionFindings(allFindings, baseline).newFindings : allFindings;

  // Filter to auto-fixable rules only
  const fixable = findings.filter((f) => {
    const id = f.category.toLowerCase();
    if (!AUTO_FIXABLE.has(id)) return false;
    if (ruleFilter && id !== ruleFilter) return false;
    return true;
  });

  const unfixable = findings.filter((f) => {
    if (!ruleFilter) return !AUTO_FIXABLE.has(f.category.toLowerCase());
    return false;
  });

  if (fixable.length === 0) {
    if (json) {
      process.stdout.write(JSON.stringify({ applied: 0, skipped: 0, unfixable: unfixable.length, fixes: [] }, null, 2) + '\n');
    } else {
      console.log('\n  prometheus fix: no auto-fixable violations found.\n');
      if (unfixable.length > 0) {
        console.log(`  ${unfixable.length} finding${unfixable.length === 1 ? '' : 's'} require manual review (run: prometheus review)\n`);
      }
    }
    return;
  }

  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const f of fixable) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }

  const appliedFixes: Array<{ file: string; line: number | null; rule: string; action: string }> = [];
  const skippedFixes: Array<{ file: string; line: number | null; rule: string; reason: string }> = [];

  for (const [relFile, filefindings] of byFile) {
    const absPath = relFile.startsWith('/') ? relFile : `${root}/${relFile}`;
    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      for (const f of filefindings) {
        skippedFixes.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'file not readable' });
      }
      continue;
    }

    // Apply fixes from bottom to top (line order) to avoid offset drift
    const sorted = [...filefindings].sort((a, b) => (b.line ?? 0) - (a.line ?? 0));
    let patched = content;
    for (const f of sorted) {
      const fixer = FIXERS[f.category.toLowerCase()];
      if (!fixer) {
        skippedFixes.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'no fixer' });
        continue;
      }
      const result = fixer(patched, f);
      if (result === null) {
        skippedFixes.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'fixer could not apply safely' });
        continue;
      }
      patched = result;
      appliedFixes.push({ file: relFile, line: f.line ?? null, rule: f.category, action: 'removed line' });
    }

    if (apply && patched !== content) {
      try {
        writeFileSync(absPath, patched, 'utf8');
      } catch (err) {
        process.stderr.write(`prometheus fix: could not write ${relFile}: ${err instanceof Error ? err.message : err}\n`);
      }
    }
  }

  if (json) {
    process.stdout.write(
      JSON.stringify({
        dryRun: !apply,
        applied: appliedFixes.length,
        skipped: skippedFixes.length,
        unfixable: unfixable.length,
        fixes: appliedFixes,
        skippedList: skippedFixes,
      }, null, 2) + '\n'
    );
    return;
  }

  // Console output
  const lines: string[] = [''];
  const mode = apply ? 'Applied' : 'Would apply (dry-run)';
  lines.push(`  prometheus fix — ${mode}`);
  lines.push('');

  if (appliedFixes.length > 0) {
    for (const f of appliedFixes) {
      const loc = f.line != null ? `:${f.line}` : '';
      lines.push(`  ✅  ${f.file}${loc}  [${f.rule}]  — ${f.action}`);
    }
  }

  if (skippedFixes.length > 0) {
    lines.push('');
    lines.push(`  Skipped (${skippedFixes.length})`);
    for (const f of skippedFixes) {
      const loc = f.line != null ? `:${f.line}` : '';
      lines.push(`  ⏭   ${f.file}${loc}  [${f.rule}]  — ${f.reason}`);
    }
  }

  if (unfixable.length > 0) {
    lines.push('');
    lines.push(`  ${unfixable.length} finding${unfixable.length === 1 ? '' : 's'} require manual remediation  (run: prometheus review)`);
  }

  if (!apply && appliedFixes.length > 0) {
    lines.push('');
    lines.push('  → Run with --apply to write changes to disk');
  }

  lines.push('');
  console.log(lines.join('\n'));
}
