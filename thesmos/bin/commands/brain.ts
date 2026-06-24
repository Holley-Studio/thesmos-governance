/**
 * thesmos brain:snapshot / brain:compact / brain:hook-install
 *
 * Generates .thesmos/brain.md — context that survives Claude Code
 * compaction so Prometheus remembers the repo between sessions.
 *
 * Usage:
 *   thesmos brain:snapshot        # Full brain snapshot
 *   thesmos brain:compact         # Minimal (<500 words) — for Stop hook
 *   thesmos brain:hook-install    # Install Stop hook in .claude/settings.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeLogger } from '../../logger.js';
import {
  generateBrainSnapshot,
  saveBrainFile,
  injectBrainImportIntoCLAUDEMD,
  installBrainStopHook,
  BRAIN_FILE,
} from '../../brain.js';
import {
  loadBrainStore,
  saveBrainStore,
  observeIntoStore,
  formatBrainReport,
  BRAIN_STORE_PATH,
} from '../../brain-store.js';
import {
  learnFromBrainStore,
  formatDisabledError,
  formatMissingKeyError,
} from '../../brain-learn.js';

const log = makeLogger('brain');

async function runBrainSnapshot(argv: string[]): Promise<void> {
  const compact = argv.includes('--compact');
  const noInject = argv.includes('--no-inject');
  const root = process.cwd();

  console.log(`\n  Thesmos Brain — ${compact ? 'compact snapshot' : 'full snapshot'}\n`);

  try {
    const snapshot = generateBrainSnapshot(root);
    saveBrainFile(root, snapshot, compact);

    console.log(`  ✅ Brain file written: ${BRAIN_FILE}`);
    console.log(`     Project:  ${snapshot.projectName}`);
    if (snapshot.healthScore !== undefined) {
      console.log(`     Health:   ${snapshot.healthScore}/${snapshot.healthGrade ?? '?'}`);
    }
    console.log(`     Stack:    ${snapshot.detectedStack.join(', ') || 'not detected'}`);
    console.log(`     Rules:    ${snapshot.rulesActive} active`);
    if (snapshot.activeSuppressions.length > 0) {
      console.log(`     Suppressions: ${snapshot.activeSuppressions.length}`);
    }
    if (snapshot.openInvestigations.length > 0) {
      console.log(`     Open findings: ${snapshot.openInvestigations.length}`);
    }
    console.log('');

    if (!noInject && !compact) {
      const injected = injectBrainImportIntoCLAUDEMD(root);
      if (injected) {
        console.log('  ✅ Brain import added to CLAUDE.md');
        console.log('     Claude Code will now load the brain file automatically.\n');
      }
    }

    log.info('brain:snapshot complete', {
      compact,
      suppressions: snapshot.activeSuppressions.length,
      stack: snapshot.detectedStack,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ❌ Brain snapshot failed: ${msg}\n`);
    log.error('brain:snapshot failed', { error: msg });
    process.exitCode = 1;
  }
}

async function runBrainCompact(): Promise<void> {
  const root = process.cwd();
  try {
    const snapshot = generateBrainSnapshot(root);
    saveBrainFile(root, snapshot, true);
    // Silent on success — this is called from the Stop hook
    log.info('brain:compact complete', { suppressions: snapshot.activeSuppressions.length });
  } catch (e) {
    log.error('brain:compact failed', { error: e instanceof Error ? e.message : String(e) });
    // Don't exit with error from the Stop hook — it would block Claude Code
  }
}

async function runBrainHookInstall(): Promise<void> {
  const root = process.cwd();

  console.log('\n  Thesmos Brain — Stop Hook Installer\n');

  try {
    const installed = installBrainStopHook(root);
    if (installed) {
      console.log('  ✅ Stop hook installed in .claude/settings.json');
      console.log('');
      console.log('  Effect: Before Claude Code ends each turn, it will run:');
      console.log('    npx thesmos brain:compact');
      console.log('');
      console.log('  This keeps the brain file fresh so it survives context compaction.');
      console.log('  To also load the brain file automatically, run:');
      console.log('    thesmos brain:snapshot  (adds @.thesmos/brain.md to CLAUDE.md)');
    } else {
      console.log('  ℹ  Brain Stop hook is already installed — nothing to do.\n');
    }
    log.info('brain:hook-install complete', { installed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ❌ Hook install failed: ${msg}\n`);
    log.error('brain:hook-install failed', { error: msg });
    process.exitCode = 1;
  }
}

// ── brain:observe ─────────────────────────────────────────────────────────────

async function runBrainObserve(argv: string[]): Promise<void> {
  const root = process.cwd();
  const reportPath = join(root, '.thesmos', 'report.json');
  const suppressionsPath = join(root, '.thesmos', 'suppressions.json');

  console.log('\n  Thesmos Brain — Observing repo...\n');

  let scanFindings: Array<{ rule?: string; file?: string }> = [];
  if (existsSync(reportPath)) {
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as { findings?: typeof scanFindings };
      scanFindings = report.findings ?? [];
    } catch {
      // ignore
    }
  }

  const store = observeIntoStore(root, {
    scanFindings,
    suppressionsFile: existsSync(suppressionsPath) ? suppressionsPath : undefined,
  });

  console.log(`  ✅ brain.json updated: ${BRAIN_STORE_PATH}`);
  console.log(`     Sessions tracked:  ${store.sessions.length}`);
  console.log(`     Rules observed:    ${Object.keys(store.ruleEffectiveness).length}`);
  console.log(`     High-FP rules:     ${store.highSuppressRules.length}`);
  console.log('');

  if (store.highSuppressRules.length > 0) {
    console.log('  High false-positive rules (run brain:learn to get proposals):');
    for (const r of store.highSuppressRules.slice(0, 5)) {
      const eff = store.ruleEffectiveness[r];
      if (eff) {
        console.log(`    ${r} — ${eff.suppressed}/${eff.fires} suppressed`);
      }
    }
    console.log('');
  }

  log.info('brain:observe complete', { sessions: store.sessions.length });
}

// ── brain:learn ───────────────────────────────────────────────────────────────

async function runBrainLearn(argv: string[]): Promise<void> {
  const root = process.cwd();
  const store = loadBrainStore(root);

  // Check enabled
  if (!store.learnEnabled) {
    console.error(formatDisabledError());
    process.exitCode = 1;
    return;
  }

  // Resolve API key (flag > env var)
  const keyFlag = argv.find((a) => a.startsWith('--api-key='))?.split('=')[1];
  const apiKey = keyFlag ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.error(formatMissingKeyError());
    process.exitCode = 1;
    return;
  }

  const dryRun = argv.includes('--dry-run');
  const skipConfirm = argv.includes('--yes');
  const modelFlag = argv.find((a) => a.startsWith('--model='))?.split('=')[1];
  const maxTokensFlag = argv.find((a) => a.startsWith('--max-tokens='))?.split('=')[1];
  const maxCostFlag = argv.find((a) => a.startsWith('--max-cost='))?.split('=')[1];

  const opts = {
    apiKey,
    model: modelFlag ?? store.model,
    maxTokens: maxTokensFlag ? parseInt(maxTokensFlag, 10) : store.maxTokensPerRun,
    maxCostUsd: maxCostFlag ? parseFloat(maxCostFlag) : store.maxCostUsdPerRun,
    dryRun,
    skipConfirm,
  };

  try {
    const result = await learnFromBrainStore(store, opts);

    if (!result.dryRun) {
      // Save proposals to store
      store.proposedRules.push(...result.proposedRules);
      store.proposedAgents.push(...result.proposedAgents);
      saveBrainStore(root, store);

      console.log('\n  Thesmos Brain — Analysis Complete\n');
      console.log(`  Tokens used:  ${result.tokensUsed.toLocaleString()}`);
      console.log(`  Cost:         $${result.estimatedCostUsd.toFixed(4)} USD\n`);

      if (result.insights.length > 0) {
        console.log('  Insights:');
        for (const insight of result.insights) {
          console.log(`    · ${insight}`);
        }
        console.log('');
      }

      if (result.refinements.length > 0) {
        console.log(`  Rule refinement suggestions (${result.refinements.length}):`);
        for (const r of result.refinements) {
          console.log(`    ${r.ruleId}: ${r.suggestion}`);
        }
        console.log('');
      }

      if (result.proposedRules.length > 0) {
        console.log(`  New rule proposals (${result.proposedRules.length}):`);
        for (const r of result.proposedRules) {
          console.log(`    ${r.id}: "${r.name}" — ${r.description.slice(0, 80)}`);
        }
        console.log('');
        console.log(`  Review: thesmos brain:evolve --approve=${result.proposedRules.map((r) => r.id).join(',')}`);
        console.log('');
      }

      if (result.proposedAgents.length > 0) {
        console.log(`  Agent proposals (${result.proposedAgents.length}):`);
        for (const a of result.proposedAgents) {
          console.log(`    "${a.name}" — ${a.purpose.slice(0, 80)}`);
        }
        console.log('');
      }
    }

    log.info('brain:learn complete', {
      dryRun: result.dryRun,
      tokensUsed: result.tokensUsed,
      proposals: result.proposedRules.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n  ❌ brain:learn failed: ${msg}\n`);
    log.error('brain:learn failed', { error: msg });
    process.exitCode = 1;
  }
}

// ── brain:evolve ──────────────────────────────────────────────────────────────

async function runBrainEvolve(argv: string[]): Promise<void> {
  const root = process.cwd();
  const store = loadBrainStore(root);
  const approveFlag = argv.find((a) => a.startsWith('--approve='))?.split('=')[1];
  const rejectFlag = argv.find((a) => a.startsWith('--reject='))?.split('=')[1];

  if (!approveFlag && !rejectFlag) {
    const pending = store.proposedRules.filter((r) => r.status === 'pending');
    if (pending.length === 0) {
      console.log('\n  No pending rule proposals. Run `thesmos brain:learn` first.\n');
    } else {
      console.log(`\n  ${pending.length} pending proposals:\n`);
      for (const r of pending) {
        console.log(`  ${r.id}: "${r.name}"\n  ${r.description}\n  → ${r.rationale}\n`);
      }
      console.log(`  Approve: thesmos brain:evolve --approve=${pending.map((r) => r.id).join(',')}`);
      console.log(`  Reject:  thesmos brain:evolve --reject=${pending[0]?.id ?? 'CUSTOM_001'}\n`);
    }
    return;
  }

  if (approveFlag) {
    const ids = approveFlag.split(',').map((s) => s.trim());
    for (const id of ids) {
      const rule = store.proposedRules.find((r) => r.id === id);
      if (!rule) {
        console.error(`  Unknown proposal ID: ${id}`);
        continue;
      }
      rule.status = 'approved';
      rule.approvedAt = new Date().toISOString();
      console.log(`  ✅ Approved: ${id} — "${rule.name}"`);
    }
  }

  if (rejectFlag) {
    const ids = rejectFlag.split(',').map((s) => s.trim());
    for (const id of ids) {
      const rule = store.proposedRules.find((r) => r.id === id);
      if (!rule) {
        console.error(`  Unknown proposal ID: ${id}`);
        continue;
      }
      rule.status = 'rejected';
      console.log(`  ✗ Rejected: ${id} — "${rule.name}"`);
    }
  }

  saveBrainStore(root, store);
  console.log('');
  log.info('brain:evolve complete');
}

// ── brain:report ──────────────────────────────────────────────────────────────

async function runBrainReport(): Promise<void> {
  const root = process.cwd();
  const store = loadBrainStore(root);
  console.log(formatBrainReport(store));
}

// ── brain:disable / brain:enable ─────────────────────────────────────────────

async function runBrainToggle(enable: boolean): Promise<void> {
  const root = process.cwd();
  const store = loadBrainStore(root);
  store.learnEnabled = enable;
  saveBrainStore(root, store);
  const state = enable ? 'enabled' : 'disabled';
  console.log(`\n  ✅ brain:learn ${state}\n`);
  if (!enable) {
    console.log('  All other Thesmos features work without an API key.');
    console.log('  To re-enable: thesmos brain:enable\n');
  }
  log.info(`brain:learn ${state}`);
}

// ── brain:promote ─────────────────────────────────────────────────────────────

function buildRuleStub(rule: { id: string; name: string; description: string; severity: string; rationale: string }): string {
  const snakeId = rule.id.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const CONST = rule.id.replace(/-/g, '_');
  return `/**
 * ${rule.id} — community rule promoted via brain:promote
 * Name: ${rule.name}
 *
 * Next steps:
 *   1. Replace TODO_REPLACE_WITH_ACTUAL_REGEX with a real pattern
 *   2. Add 2–3 commonViolations examples
 *   3. Fill in goodExample / badExample
 *   4. Set sinceVersion to the next release version
 *   5. Import ${CONST}_RULES in thesmos/rules/registry.ts and push onto PROMETHEUS_RULES
 *   6. Add a test in thesmos/rules/${snakeId}.test.ts
 */

import type { ThesmosRule, DetectInput, Finding } from '../../types.js';

const ${CONST}_RE = /TODO_REPLACE_WITH_ACTUAL_REGEX/;

export const ${CONST}_RULES: ThesmosRule[] = [
  {
    id: '${rule.id}',
    category: '${snakeId}',
    description: '${rule.description.replace(/'/g, "\\'")}',
    severity: '${rule.severity}' as const,
    tags: ['custom', 'community'],
    sinceVersion: '0.0.1',
    explain: {
      why: '${rule.rationale.replace(/'/g, "\\'")}',
      commonViolations: [
        // TODO: add 2–3 concrete code examples that trigger this rule
      ],
      goodExample: '// TODO: add a compliant example',
      badExample:  '// TODO: add a non-compliant example',
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        const lines = content.split('\\n');
        for (let i = 0; i < lines.length; i++) {
          if (${CONST}_RE.test(lines[i]!)) {
            findings.push({
              severity: '${rule.severity}' as const,
              category: '${snakeId}',
              file: path,
              line: i + 1,
              message: '${rule.description.replace(/'/g, "\\'")}',
              suggestion: '// TODO: add remediation guidance',
            });
          }
        }
      }
      return findings;
    },
  },
];
`;
}

async function runBrainPromote(argv: string[]): Promise<void> {
  const root = process.cwd();
  const ruleId = argv.find((a) => a.startsWith('--rule='))?.split('=')[1];

  if (!ruleId) {
    console.error('\n  ❌ --rule=<ID> is required\n');
    console.error('  Usage: thesmos brain:promote --rule=CUSTOM_001\n');
    process.exitCode = 1;
    return;
  }

  const store = loadBrainStore(root);
  const proposal = store.proposedRules.find((r) => r.id === ruleId && r.status === 'approved');

  if (!proposal) {
    const exists = store.proposedRules.find((r) => r.id === ruleId);
    if (exists) {
      console.error(`\n  ❌ Rule ${ruleId} exists but is not approved (status: ${exists.status})\n`);
      console.error(`  Approve it first: thesmos brain:evolve --approve=${ruleId}\n`);
    } else {
      console.error(`\n  ❌ Rule ${ruleId} not found in brain.json\n`);
      console.error('  Run: thesmos brain:learn  then  thesmos brain:evolve --approve=<ID>\n');
    }
    process.exitCode = 1;
    return;
  }

  const communityDir = join(root, 'thesmos', 'rules', 'community');
  const outPath = join(communityDir, `${ruleId}.ts`);

  mkdirSync(communityDir, { recursive: true });

  if (existsSync(outPath)) {
    console.error(`\n  ❌ ${outPath} already exists — remove it first if you want to regenerate.\n`);
    process.exitCode = 1;
    return;
  }

  const stub = buildRuleStub(proposal);
  writeFileSync(outPath, stub, 'utf8');

  const snakeId = ruleId.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const CONST = ruleId.replace(/-/g, '_');

  console.log(`\n  ✅ Promoted: ${ruleId} → thesmos/rules/community/${ruleId}.ts\n`);
  console.log('  Next steps to wire into Thesmos core:\n');
  console.log(`  1. Edit the regex — replace TODO_REPLACE_WITH_ACTUAL_REGEX in ${ruleId}.ts`);
  console.log(`  2. Add examples — fill commonViolations, goodExample, badExample`);
  console.log(`  3. Import in thesmos/rules/registry.ts:`);
  console.log(`       import { ${CONST}_RULES } from './community/${ruleId}.js';`);
  console.log(`       PROMETHEUS_RULES.push(...${CONST}_RULES);`);
  console.log(`  4. Write a test: thesmos/rules/${snakeId}.test.ts`);
  console.log(`  5. Set sinceVersion to the upcoming release version`);
  console.log(`  6. Update CHANGELOG.md and bump package.json version\n`);

  log.info('brain:promote complete', { ruleId, outPath });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdBrain(argv: string[]): Promise<void> {
  const subcommand = argv[0];

  switch (subcommand) {
    case 'snapshot':
      return runBrainSnapshot(argv.slice(1));

    case 'compact':
      return runBrainCompact();

    case 'hook-install':
      return runBrainHookInstall();

    case 'observe':
      return runBrainObserve(argv.slice(1));

    case 'learn':
      return runBrainLearn(argv.slice(1));

    case 'evolve':
      return runBrainEvolve(argv.slice(1));

    case 'report':
      return runBrainReport();

    case 'disable':
      return runBrainToggle(false);

    case 'enable':
      return runBrainToggle(true);

    case 'promote':
      return runBrainPromote(argv.slice(1));

    default:
      if (!subcommand) {
        return runBrainSnapshot(argv);
      }
      console.error(`  Unknown brain subcommand: ${subcommand}`);
      console.error('  Usage: thesmos brain:snapshot | brain:compact | brain:hook-install');
      console.error('         thesmos brain:observe | brain:learn | brain:evolve | brain:report');
      console.error('         thesmos brain:disable | brain:enable | brain:promote');
      process.exitCode = 1;
  }
}
