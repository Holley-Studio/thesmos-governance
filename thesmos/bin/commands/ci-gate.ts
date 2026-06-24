/**
 * thesmos ci — single-command CI gate.
 *
 * Runs validate + drift + suppressions audit + health score in one pass.
 * Replaces the common CI pattern of chaining four separate commands.
 *
 * Exit codes:
 *   0   All checks passed (warnings may be present)
 *   1   BLOCKER findings or BLOCKER drift events (must not merge)
 *   2   HIGH findings that break CI via failOnSeverity (optional gate)
 *
 * Flags:
 *   --base=<branch>    diff HEAD against <branch> for validate
 *   --json             machine-readable JSON summary
 *   --markdown         markdown summary
 *   --no-baseline      skip baseline suppression in validate
 *   --health-threshold=<n>  fail if health score drops below n (default: off)
 *
 * CI Example (GitHub Actions):
 *   - run: npx thesmos ci --base=main
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { getChangedFiles } from '../lib/git.ts';
import { runReview } from '../../review.ts';
import { exitCodeFor, shouldWarn, SEVERITY_EMOJI } from '../../severity.ts';
import { loadBaseline, partitionFindings } from '../../baseline.ts';
import { runDriftForRoot } from '../../drift.ts';
import { computeHealthForRoot } from '../../health.ts';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { extractSuppressions, auditSuppressions } from '../../suppress.ts';

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage']);

function walkSources(dir: string, root: string): string[] {
  const files: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return files; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const abs = join(dir, e);
    let s;
    try { s = statSync(abs); } catch { continue; }
    if (s.isDirectory()) files.push(...walkSources(abs, root));
    else if (SOURCE_EXT.test(e)) files.push(abs);
  }
  return files;
}

export async function cmdCiGate(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const noBaseline = flag(flags, 'no-baseline');
  const base = flagVal(flags, 'base');
  const healthThresholdStr = flagVal(flags, 'health-threshold');
  const healthThreshold = healthThresholdStr ? parseInt(healthThresholdStr, 10) : null;

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write(
      'thesmos ci: .thesmos/report.json not found — run thesmos scan first\n'
    );
    process.exit(1);
  }

  const changedFiles = base ? getChangedFiles(root, base) : undefined;
  const allFindings = runReview({ scan, config, changedFiles });

  // Baseline partition
  const baseline = noBaseline ? null : loadBaseline(root);
  const findings = baseline ? partitionFindings(allFindings, baseline).newFindings : allFindings;
  const suppressedCount = allFindings.length - findings.length;

  // Drift
  const driftFindings = runDriftForRoot(root, config);
  const blockerDrift = driftFindings.filter((d) => d.severity === 'BLOCKER');

  // Suppression audit
  const sourceFiles = walkSources(root, root);
  const allSuppressions = sourceFiles.flatMap((abs) => {
    try { return extractSuppressions(readFileSync(abs, 'utf8'), relative(root, abs)); } catch { return []; }
  });
  const supAudit = auditSuppressions({ suppressions: allSuppressions, findings: allFindings, now: new Date() });
  const severeSupIssues = supAudit.filter((f) => f.severity === 'HIGH');

  // Health
  const health = computeHealthForRoot(root, config);

  // Exit code logic
  const validateFails = exitCodeFor(findings, config) === 1;
  const driftBlocks = blockerDrift.length > 0;
  const supBlocks = false; // suppression issues are advisory in CI by default
  const healthBlocks = healthThreshold !== null && health.score < healthThreshold;
  const overallFail = validateFails || driftBlocks || healthBlocks;

  if (json) {
    process.stdout.write(
      JSON.stringify({
        pass: !overallFail,
        validate: { findings: findings.length, suppressed: suppressedCount, fails: validateFails },
        drift: { events: driftFindings.length, blockers: blockerDrift.length, blocks: driftBlocks },
        suppressions: { issues: supAudit.length, severeIssues: severeSupIssues.length },
        health: { score: health.score, grade: health.grade },
      }, null, 2) + '\n'
    );
    process.exit(overallFail ? 1 : 0);
    return;
  }

  if (markdown) {
    const lines: string[] = [];
    lines.push('## Thesmos CI');
    lines.push('');
    lines.push(`| Check | Result |`);
    lines.push(`|---|---|`);
    lines.push(`| Validate | ${validateFails ? '❌ FAIL' : '✅ PASS'} (${findings.length} new findings${suppressedCount > 0 ? `, ${suppressedCount} suppressed` : ''}) |`);
    lines.push(`| Drift | ${blockerDrift.length > 0 ? '❌ BLOCKER' : driftFindings.length > 0 ? '⚠️ WARNING' : '✅ PASS'} (${driftFindings.length} events) |`);
    lines.push(`| Suppressions | ${severeSupIssues.length > 0 ? '⚠️ ' + severeSupIssues.length + ' issues' : '✅ valid'} |`);
    lines.push(`| Health | ${health.grade} ${health.score}/100 |`);
    lines.push('');
    lines.push(overallFail ? '**❌ CI FAILED**' : '**✅ CI PASSED**');
    lines.push('');
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(overallFail ? 1 : 0);
    return;
  }

  // Console output
  const SEP = '═'.repeat(56);
  const lines: string[] = [];
  lines.push('');
  lines.push(`  Thesmos CI — ${config.project}`);
  lines.push(SEP);
  lines.push('');

  // Validate row
  const vIcon = validateFails ? '❌' : findings.length > 0 ? '⚠️ ' : '✅';
  const vNote = suppressedCount > 0 ? ` (${suppressedCount} baselined)` : '';
  lines.push(`  ${vIcon}  Validate      ${findings.length} new finding${findings.length === 1 ? '' : 's'}${vNote}`);

  // Drift row
  const dIcon = blockerDrift.length > 0 ? '❌' : driftFindings.length > 0 ? '⚠️ ' : '✅';
  lines.push(`  ${dIcon}  Drift         ${driftFindings.length} event${driftFindings.length === 1 ? '' : 's'}${blockerDrift.length > 0 ? ` (${blockerDrift.length} BLOCKER)` : ''}`);

  // Suppressions row
  const sIcon = severeSupIssues.length > 0 ? '⚠️ ' : '✅';
  lines.push(`  ${sIcon}  Suppressions  ${supAudit.length === 0 ? 'all valid' : supAudit.length + ' issues'}`);

  // Health row
  const hIcon = health.score >= 75 ? '✅' : health.score >= 50 ? '⚠️ ' : '❌';
  lines.push(`  ${hIcon}  Health        ${health.score}/100  Grade: ${health.grade}`);

  lines.push('');
  lines.push(SEP);
  lines.push('');

  if (overallFail) {
    lines.push(`  ❌  Result: FAIL`);
    if (validateFails) lines.push(`       → ${findings.filter((f) => config.failOnSeverity.includes(f.severity)).length} finding(s) exceed failOnSeverity threshold`);
    if (driftBlocks) lines.push(`       → ${blockerDrift.length} BLOCKER drift event(s) must be resolved`);
    if (healthBlocks) lines.push(`       → Health score ${health.score} is below threshold ${healthThreshold}`);
  } else if (shouldWarn(findings, config) || driftFindings.length > 0 || severeSupIssues.length > 0) {
    lines.push(`  ⚠️   Result: PASS with warnings — review before merging`);
  } else {
    lines.push(`  ✅  Result: PASS — governance is healthy`);
  }

  // Top priority actions from health
  if (health.priorityActions.length > 0 && (overallFail || health.score < 90)) {
    lines.push('');
    lines.push('  Next steps:');
    health.priorityActions.slice(0, 3).forEach((a, i) => {
      lines.push(`    ${i + 1}. ${a}`);
    });
  }

  lines.push('');
  console.log(lines.join('\n'));

  process.exit(overallFail ? 1 : 0);
}
