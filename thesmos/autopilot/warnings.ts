// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pre-flight warning system for autopilot sessions.
 *
 * Runs live checks (disk, battery, internet, adapter, baseline gates) and
 * displays a structured warning screen. The user must type "CONFIRMED" to proceed.
 * Every circumstance that could interrupt an unattended session is documented here.
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import * as readline from 'node:readline';
import type { AutopilotPlan } from '../types.js';
import { detectPreCommitHooks } from './git-ops.js';

const DIVIDER = '━'.repeat(62);
const MIN_DISK_GB = 2;

// ── Individual checks ─────────────────────────────────────────────────────────

export interface CheckResult {
  label: string;
  passed: boolean;
  value: string;
  isHardStop: boolean;
  hint?: string;
}

export function checkDiskSpace(root: string): CheckResult {
  // statfsSync added in Node 19 — fall back to df on Node 18
  try {
    const stats = statfsSync(root);
    const freeBytes = stats.bavail * stats.bsize;
    const freeGB = freeBytes / 1e9;
    const passed = freeGB >= MIN_DISK_GB;
    return {
      label: 'Disk space',
      passed,
      value: `${freeGB.toFixed(1)} GB free`,
      isHardStop: !passed,
      hint: passed ? undefined : `Free at least ${MIN_DISK_GB} GB before starting.`,
    };
  } catch {
    // Fallback: parse df output
    try {
      const out = execSync('df -k .', { encoding: 'utf8', cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
      const line = out.split('\n')[1] ?? '';
      const parts = line.trim().split(/\s+/);
      const freeKB = parseInt(parts[3] ?? '0', 10);
      const freeGB = freeKB / 1e6;
      const passed = freeGB >= MIN_DISK_GB;
      return {
        label: 'Disk space',
        passed,
        value: `${freeGB.toFixed(1)} GB free`,
        isHardStop: !passed,
        hint: passed ? undefined : `Free at least ${MIN_DISK_GB} GB before starting.`,
      };
    } catch {
      return { label: 'Disk space', passed: true, value: 'could not check', isHardStop: false };
    }
  }
}

export function checkBattery(requirePluggedIn: boolean): CheckResult {
  try {
    if (process.platform === 'darwin') {
      const out = execSync('pmset -g batt', { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
      const plugged = out.includes('AC Power') || out.includes('charged');
      const pctMatch = /(\d+)%/.exec(out);
      const pct = pctMatch ? pctMatch[1] : '?';
      const value = plugged ? `plugged in (${pct}%)` : `ON BATTERY — ${pct}%`;
      return {
        label: 'Battery',
        passed: plugged,
        value,
        isHardStop: !plugged && requirePluggedIn,
        hint: plugged ? undefined : 'Plug in your power adapter to prevent session interruption.',
      };
    }
    if (process.platform === 'linux') {
      const acPath = '/sys/class/power_supply/AC/online';
      if (existsSync(acPath)) {
        // Read sysfs directly — no shell (SEC_016 / NODE_005).
        const plugged = readFileSync(acPath, 'utf8').trim() === '1';
        return {
          label: 'Battery',
          passed: plugged,
          value: plugged ? 'plugged in' : 'ON BATTERY',
          isHardStop: !plugged && requirePluggedIn,
          hint: plugged ? undefined : 'Plug in your power adapter.',
        };
      }
    }
    return { label: 'Battery', passed: true, value: 'desktop / N/A', isHardStop: false };
  } catch {
    return { label: 'Battery', passed: true, value: 'could not check', isHardStop: false };
  }
}

export function checkInternet(): CheckResult {
  try {
    execFileSync('curl', ['-sf', '--max-time', '5', 'https://api.anthropic.com'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { label: 'Internet', passed: true, value: 'API endpoint reachable', isHardStop: false };
  } catch {
    // curl not available or endpoint unreachable
    return {
      label: 'Internet',
      passed: false,
      value: 'API endpoint unreachable',
      isHardStop: false,
      hint: 'Check your internet connection and VPN configuration.',
    };
  }
}

export function checkAdapter(adapter: string): CheckResult {
  if (adapter === 'claude') {
    const result = spawnSync('claude', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
    const version = result.stdout?.trim() ?? '';
    const found = result.status === 0;
    return {
      label: 'Adapter (claude)',
      passed: found,
      value: found ? version || 'found' : 'not found in PATH',
      isHardStop: !found,
      hint: found ? undefined : 'Install Claude Code: npm install -g @anthropic-ai/claude-code',
    };
  }
  // Generic adapters — just report configured
  return { label: `Adapter (${adapter})`, passed: true, value: 'configured', isHardStop: false };
}

export function checkSystemSleep(): CheckResult {
  try {
    if (process.platform === 'darwin') {
      const out = execSync('pmset -g | grep " sleep"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const match = /^\s*sleep\s+(\d+)/m.exec(out);
      const minutes = match ? parseInt(match[1], 10) : null;
      if (minutes === 0) {
        return { label: 'System sleep', passed: true, value: 'set to Never', isHardStop: false };
      }
      return {
        label: 'System sleep',
        passed: false,
        value: minutes ? `sleeps after ${minutes} min` : 'unknown setting',
        isHardStop: false,
        hint: 'Set System Preferences → Battery → "Prevent automatic sleeping" or run: sudo pmset sleep 0',
      };
    }
    return { label: 'System sleep', passed: true, value: 'manual check required', isHardStop: false };
  } catch {
    return { label: 'System sleep', passed: true, value: 'could not check', isHardStop: false };
  }
}

export function checkCostCeiling(maxCostUSD: number | undefined): CheckResult {
  const set = typeof maxCostUSD === 'number' && maxCostUSD > 0;
  return {
    label: 'Cost ceiling',
    passed: set,
    value: set ? `$${maxCostUSD!.toFixed(2)} limit` : 'not set — unlimited spend',
    isHardStop: false,
    hint: set ? undefined : 'Set autopilot.maxCostUSD in .thesmos/config.json to cap spending.',
  };
}

export function runBaselineGates(root: string, gates: string[]): CheckResult[] {
  return gates.map((gate) => {
    try {
      const parts = gate.split(' ');
      const cmd = parts[0]!;
      const args = parts.slice(1);
      execFileSync(cmd, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000 });
      return { label: `Gate: ${gate}`, passed: true, value: 'PASS', isHardStop: false };
    } catch (err) {
      const output = err instanceof Error && 'stderr' in err ? String((err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? '') : '';
      return {
        label: `Gate: ${gate}`,
        passed: false,
        value: 'FAIL',
        isHardStop: true,
        hint: `Fix gate failures before starting autopilot:\n  ${output.split('\n').slice(0, 3).join('\n  ')}`,
      };
    }
  });
}

// ── Warning display ───────────────────────────────────────────────────────────

function tick(passed: boolean): string {
  return passed ? '✓' : '✗';
}

export interface WarningScreenOptions {
  /** When true, surface an elevated warning that Claude skip-permissions is enabled. */
  dangerouslySkipPermissions?: boolean;
}

export function displayWarningScreen(
  root: string,
  plan: AutopilotPlan,
  maxCostUSD: number | undefined,
  requirePluggedIn: boolean,
  options: WarningScreenOptions = {},
): { checks: CheckResult[]; canProceed: boolean } {
  const diskCheck = checkDiskSpace(root);
  const batteryCheck = checkBattery(requirePluggedIn);
  const internetCheck = checkInternet();
  const adapterCheck = checkAdapter(plan.adapter);
  const sleepCheck = checkSystemSleep();
  const costCheck = checkCostCeiling(maxCostUSD);
  const hooks = detectPreCommitHooks(root);
  const skipPermissions = options.dangerouslySkipPermissions === true;

  process.stdout.write('\n' + DIVIDER + '\n');
  process.stdout.write('  ⚠  THESMOS AUTOPILOT — PRE-FLIGHT WARNING\n');
  process.stdout.write('  Read every item. This session will run unattended.\n');
  process.stdout.write(DIVIDER + '\n\n');

  // Live checks
  process.stdout.write('LIVE CHECKS (verified right now)\n');
  const liveChecks = [diskCheck, batteryCheck, internetCheck, adapterCheck, sleepCheck, costCheck];
  for (const c of liveChecks) {
    process.stdout.write(`  ${tick(c.passed)}  ${c.label.padEnd(20)} ${c.value}\n`);
  }

  // Baseline gates
  process.stdout.write('\n  Running baseline gates...\n');
  const gateChecks = runBaselineGates(root, plan.gates);
  for (const g of gateChecks) {
    process.stdout.write(`  ${tick(g.passed)}  ${g.label.padEnd(20)} ${g.value}\n`);
  }

  const allChecks = [...liveChecks, ...gateChecks];
  const hardStops = allChecks.filter((c) => c.isHardStop);

  process.stdout.write('\nWARNINGS — things Thesmos cannot prevent\n\n');

  // Print battery/power hint if failed
  if (!batteryCheck.passed) {
    process.stdout.write(`  ⚠  BATTERY / POWER\n`);
    process.stdout.write(`     You are on battery. If your machine loses power mid-task,\n`);
    process.stdout.write(`     the subprocess dies with no graceful shutdown.\n`);
    process.stdout.write(`     → ${batteryCheck.hint}\n\n`);
  }

  const warnings = [
    ...(skipPermissions
      ? [
          {
            title: 'DANGEROUSLY SKIP PERMISSIONS (ENABLED)',
            body: [
              'autopilot.dangerouslySkipPermissions=true — Claude CLI will run with',
              '--dangerously-skip-permissions, bypassing Claude Code permission prompts.',
              'Prefer the Thesmos permission profile + claude:govern hooks (default).',
              '→ Set dangerouslySkipPermissions to false (or omit it) unless you accept this risk.',
            ],
          },
        ]
      : []),
    {
      title: 'API CREDITS',
      body: [
        'If you run out of API credits mid-session, the adapter call fails',
        'hard. Thesmos marks the task TIMED_OUT and stops the session.',
        '→ Check your credit balance before starting.',
        `→ Set autopilot.maxCostUSD in config to cap spend.`,
      ],
    },
    {
      title: 'RATE LIMITS',
      body: [
        'Sustained usage may hit per-minute API rate limits.',
        'Thesmos retries with backoff: 10s → 30s → 90s.',
        'After 3 retries, the task is marked TIMED_OUT and the session continues.',
      ],
    },
    {
      title: 'COMPUTER SLEEP / SCREEN LOCK',
      body: [
        'If your OS sleeps the system (not just display), background',
        'subprocesses are killed without notice.',
        sleepCheck.hint ? `→ ${sleepCheck.hint}` : '→ System sleep is disabled ✓',
      ],
    },
    {
      title: 'VS CODE CLOSED / CRASHED',
      body: [
        'Closing VS Code may kill subprocess groups depending on your OS.',
        'The session log is preserved but the running task is interrupted.',
        '→ Resume with: thesmos autopilot resume [PLAN_FILE]',
        '→ Interrupted tasks restart from scratch (committed tasks are safe).',
      ],
    },
    {
      title: 'INTERNET DISCONNECTED',
      body: [
        'API calls fail if your internet drops. Thesmos retries 3× with backoff.',
        'After that, the task is marked TIMED_OUT and the session continues.',
        '→ VPN users: VPN auto-disconnect on sleep compounds this risk.',
      ],
    },
    {
      title: `PRE-COMMIT HOOKS${hooks.length > 0 ? ` (${hooks.length} found)` : ' (none found)'}`,
      body:
        hooks.length > 0
          ? [
              ...hooks.map((h) => `  ${h}`),
              'If a hook rejects a commit, Thesmos cannot bypass it.',
              'The task will be marked BLOCKED and the session continues.',
              '→ Run your hooks manually now to verify they pass.',
            ]
          : ['No pre-commit hooks detected.'],
    },
    {
      title: 'DISK FILLS UP MID-SESSION',
      body: [
        'File writes and git commits fail if disk fills during execution.',
        `→ Maintain at least ${MIN_DISK_GB} GB of free space throughout.`,
      ],
    },
    {
      title: 'CONCURRENT REPO CHANGES',
      body: [
        'If another developer pushes to the autopilot branch while the session runs,',
        'the next git commit will fail with a conflict.',
        '→ Inform your team this branch is reserved during the session.',
      ],
    },
    {
      title: 'OS UPDATE / SYSTEM RESTART',
      body: [
        'A scheduled OS restart kills the session without cleanup.',
        'Permissions may remain elevated — recover with:',
        '  thesmos autopilot --restore-permissions',
        '→ Defer system updates until after the session.',
      ],
    },
    {
      title: 'TASK TIMEOUT',
      body: [
        'Each task has a max runtime (default 30 minutes).',
        'If the AI does not complete within that window, the task is marked',
        'TIMED_OUT and the session moves to the next task.',
        'Partial changes from a timed-out task are NOT committed.',
      ],
    },
  ];

  for (const w of warnings) {
    process.stdout.write(`  ⚠  ${w.title}\n`);
    for (const line of w.body) {
      process.stdout.write(`     ${line}\n`);
    }
    process.stdout.write('\n');
  }

  // Cost estimate
  const taskCount = plan.tasks.filter((t) => !t.isCheckpoint).length;
  process.stdout.write(`  COST ESTIMATE\n`);
  if (typeof maxCostUSD === 'number') {
    process.stdout.write(`     Ceiling set: $${maxCostUSD.toFixed(2)}\n`);
  } else {
    process.stdout.write(`     No ceiling set.\n`);
  }
  process.stdout.write(`     Best case  (1 call/task):  ~$${(taskCount * 0.05).toFixed(2)}\n`);
  process.stdout.write(`     With retries (3×):         ~$${(taskCount * 0.15).toFixed(2)}\n`);
  process.stdout.write(`     Worst case (5× retries):   ~$${(taskCount * 0.25).toFixed(2)}\n\n`);

  process.stdout.write(`IF THE SESSION IS INTERRUPTED FOR ANY REASON\n`);
  process.stdout.write(`  Resume from last completed task:\n`);
  process.stdout.write(`    thesmos autopilot resume [PLAN_FILE]\n\n`);
  process.stdout.write(`TO CANCEL WHILE THE SESSION RUNS\n`);
  process.stdout.write(`  touch .thesmos/autopilot/.cancel\n`);
  process.stdout.write(`  — or — thesmos autopilot cancel\n\n`);

  process.stdout.write(DIVIDER + '\n');

  if (hardStops.length > 0) {
    process.stdout.write(`  ${hardStops.length} item${hardStops.length > 1 ? 's' : ''} must be resolved before starting:\n`);
    for (const s of hardStops) {
      process.stdout.write(`    ✗  ${s.label}: ${s.value}\n`);
      if (s.hint) process.stdout.write(`       ${s.hint.split('\n')[0]}\n`);
    }
    process.stdout.write(DIVIDER + '\n\n');
  }

  return { checks: allChecks, canProceed: hardStops.length === 0 };
}

// ── CONFIRMED gate ────────────────────────────────────────────────────────────

export async function requireConfirmation(): Promise<boolean> {
  process.stdout.write('  To acknowledge all risks and start, type: CONFIRMED\n');
  process.stdout.write('  To cancel: Ctrl+C\n');
  process.stdout.write(DIVIDER + '\n> ');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise<boolean>((resolve) => {
    rl.once('line', (answer) => {
      rl.close();
      resolve(answer.trim() === 'CONFIRMED');
    });
    rl.once('close', () => resolve(false));
  });
}
