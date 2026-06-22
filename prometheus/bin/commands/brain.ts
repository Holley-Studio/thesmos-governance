/**
 * prometheus brain:snapshot / brain:compact / brain:hook-install
 *
 * Generates .prometheus/brain.md — context that survives Claude Code
 * compaction so Prometheus remembers the repo between sessions.
 *
 * Usage:
 *   prometheus brain:snapshot        # Full brain snapshot
 *   prometheus brain:compact         # Minimal (<500 words) — for Stop hook
 *   prometheus brain:hook-install    # Install Stop hook in .claude/settings.json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

  console.log(`\n  Prometheus Brain — ${compact ? 'compact snapshot' : 'full snapshot'}\n`);

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

  console.log('\n  Prometheus Brain — Stop Hook Installer\n');

  try {
    const installed = installBrainStopHook(root);
    if (installed) {
      console.log('  ✅ Stop hook installed in .claude/settings.json');
      console.log('');
      console.log('  Effect: Before Claude Code ends each turn, it will run:');
      console.log('    npx prometheus brain:compact');
      console.log('');
      console.log('  This keeps the brain file fresh so it survives context compaction.');
      console.log('  To also load the brain file automatically, run:');
      console.log('    prometheus brain:snapshot  (adds @.prometheus/brain.md to CLAUDE.md)');
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
  const reportPath = join(root, '.prometheus', 'report.json');
  const suppressionsPath = join(root, '.prometheus', 'suppressions.json');

  console.log('\n  Prometheus Brain — Observing repo...\n');

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

      console.log('\n  Prometheus Brain — Analysis Complete\n');
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
        console.log(`  Review: prometheus brain:evolve --approve=${result.proposedRules.map((r) => r.id).join(',')}`);
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
      console.log('\n  No pending rule proposals. Run `prometheus brain:learn` first.\n');
    } else {
      console.log(`\n  ${pending.length} pending proposals:\n`);
      for (const r of pending) {
        console.log(`  ${r.id}: "${r.name}"\n  ${r.description}\n  → ${r.rationale}\n`);
      }
      console.log(`  Approve: prometheus brain:evolve --approve=${pending.map((r) => r.id).join(',')}`);
      console.log(`  Reject:  prometheus brain:evolve --reject=${pending[0]?.id ?? 'CUSTOM_001'}\n`);
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
    console.log('  All other Prometheus features work without an API key.');
    console.log('  To re-enable: prometheus brain:enable\n');
  }
  log.info(`brain:learn ${state}`);
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

    default:
      if (!subcommand) {
        return runBrainSnapshot(argv);
      }
      console.error(`  Unknown brain subcommand: ${subcommand}`);
      console.error('  Usage: prometheus brain:snapshot | brain:compact | brain:hook-install');
      console.error('         prometheus brain:observe | brain:learn | brain:evolve | brain:report');
      console.error('         prometheus brain:disable | brain:enable');
      process.exitCode = 1;
  }
}
