// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos commit:lint — validate commit messages against Conventional Commits.
 * thesmos commit:create — interactive guided commit wizard.
 *
 * Usage:
 *   thesmos commit:lint <msg-file>       # Used by commit-msg hook (pass $1)
 *   thesmos commit:lint --last           # Lint the last git commit
 *   thesmos commit:lint --message "..."  # Lint an inline string
 *   thesmos commit:lint -m "..."         # Short alias
 *   thesmos commit:lint --json           # JSON output
 *   thesmos commit:create                # Interactive wizard
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { COMMIT_RULES } from '../../rules/commits.js';
import type { DetectInput, Finding, ScanResult } from '../../types.js';
import { CONFIG_DEFAULTS, loadConfig } from '../../config.js';

const COMMIT_EDITMSG = '.git/COMMIT_EDITMSG';

const DEFAULT_TYPES: Array<{ type: string; description: string }> = [
  { type: 'feat', description: 'A new feature' },
  { type: 'fix', description: 'A bug fix' },
  { type: 'docs', description: 'Documentation only changes' },
  { type: 'style', description: 'Formatting, missing semicolons, etc.' },
  { type: 'refactor', description: 'A code change that is not a fix or feature' },
  { type: 'perf', description: 'A change that improves performance' },
  { type: 'test', description: 'Adding missing tests or correcting existing tests' },
  { type: 'chore', description: 'Changes to the build process or auxiliary tools' },
  { type: 'ci', description: 'Changes to CI configuration files and scripts' },
  { type: 'build', description: 'Changes that affect the build system or dependencies' },
  { type: 'revert', description: 'Reverts a previous commit' },
];

function buildEmptyScan(): ScanResult {
  return {
    _generatedSections: [],
    generatedAt: new Date().toISOString(),
    scanVersion: '0',
    pages: [],
    apiRoutes: [],
    componentCount: 0,
    sharedUiFiles: [],
    designSystemFiles: [],
    storeFiles: [],
    testFiles: [],
    largeFiles: [],
    riskyFiles: [],
    scriptFiles: [],
    envFiles: [],
    clientBoundaryRisks: [],
    languages: [],
    detectedStacks: [],
  };
}

function lintMessage(message: string, root: string): Finding[] {
  let config = CONFIG_DEFAULTS;
  try {
    config = loadConfig(root);
  } catch {
    /* */
  }

  const detectInput: DetectInput = {
    scan: buildEmptyScan(),
    config,
    changedFiles: [{ path: COMMIT_EDITMSG, content: message }],
  };

  const findings: Finding[] = [];
  for (const rule of COMMIT_RULES) {
    try {
      findings.push(...rule.detect(detectInput));
    } catch {
      /* */
    }
  }
  return findings;
}

function getLastCommitMessage(root: string): string {
  return execFileSync('git', ['log', '-1', '--format=%B'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

/** Parse exactly one source; values remain literal even when they start with -. */
export function parseCommitLintArgs(argv: string[]): {
  json: boolean;
  last: boolean;
  message?: string;
  file?: string;
} {
  const parsed: { json: boolean; last: boolean; message?: string; file?: string } = {
    json: false,
    last: false,
  };
  let sources = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') parsed.json = true;
    else if (arg === '--last') {
      parsed.last = true;
      sources++;
    } else if (arg === '--message' || arg === '-m') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a message`);
      parsed.message = value;
      sources++;
    } else if (arg.startsWith('--message=')) {
      parsed.message = arg.slice('--message='.length);
      sources++;
    } else if (arg === '--') {
      const remaining = argv.slice(i + 1);
      if (remaining.length !== 1) throw new Error('Provide exactly one message file after --');
      parsed.file = remaining[0];
      sources++;
      break;
    } else if (arg.startsWith('-')) throw new Error(`Unknown commit:lint option: ${arg}`);
    else {
      parsed.file = arg;
      sources++;
    }
  }
  if (sources > 1)
    throw new Error('Choose one commit message source: a file, -m/--message, or --last');
  return parsed;
}

export async function cmdCommitLint(argv: string[]): Promise<void> {
  const root = process.cwd();
  let parsed: ReturnType<typeof parseCommitLintArgs>;
  let message: string | undefined;
  try {
    parsed = parseCommitLintArgs(argv);
    message = parsed.last
      ? getLastCommitMessage(root)
      : parsed.file !== undefined
        ? readFileSync(parsed.file, 'utf8')
        : parsed.message;
  } catch (error) {
    process.stderr.write(
      `commit:lint: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
    return;
  }

  if (!message) {
    process.stderr.write(
      'commit:lint: provide a message file, -m/--message "...", or --last\n\n' +
        'Examples:\n' +
        '  thesmos commit:lint "$1"          # from commit-msg hook\n' +
        '  thesmos commit:lint --last        # lint most recent commit\n' +
        '  thesmos commit:lint --message "feat: add login"\n'
    );
    process.exitCode = 1;
    return;
  }

  const findings = lintMessage(message, root);
  const blockers = findings.filter((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH');

  if (parsed.json) {
    process.stdout.write(
      JSON.stringify(
        {
          message: message.split('\n')[0],
          valid: blockers.length === 0,
          findings,
        },
        null,
        2
      ) + '\n'
    );
    process.exitCode = blockers.length > 0 ? 1 : 0;
    return;
  }

  if (findings.length === 0) {
    console.log('\n✓ Commit message is valid.\n');
    return;
  }

  console.log('\nThesmos Commit Lint\n');
  const ICON: Record<string, string> = { BLOCKER: '🚫', HIGH: '🔴', MEDIUM: '🟡', LOW: '⚪' };
  for (const f of findings) {
    const icon = ICON[f.severity] ?? '⚪';
    console.log(`  ${icon} [${f.category}] ${f.message}`);
    if (f.suggestion) console.log(`     → ${f.suggestion}`);
  }
  console.log('');

  if (blockers.length > 0) {
    process.stderr.write(
      `commit:lint: ${blockers.length} blocking finding(s) — commit rejected.\n`
    );
    process.exitCode = 1;
  }
}

// ── Interactive wizard ─────────────────────────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function askWithMenu(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  choices: Array<{ label: string; description: string }>
): Promise<string> {
  console.log(`\n${prompt}`);
  choices.forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${c.label.padEnd(12)} ${c.description}`);
  });
  while (true) {
    const raw = (await ask(rl, `\n  Enter number or type [1-${choices.length}]: `)).trim();
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= choices.length) return choices[n - 1]!.label;
    // Allow typing the value directly
    const direct = choices.find((c) => c.label === raw);
    if (direct) return direct.label;
    console.log(`  Please enter a number between 1 and ${choices.length}, or the type name.`);
  }
}

export async function cmdCommitCreate(argv: string[]): Promise<void> {
  const doCommit = argv.includes('--commit');
  const root = process.cwd();

  let config = CONFIG_DEFAULTS;
  try {
    config = loadConfig(root);
  } catch {
    /* */
  }

  const allowedTypes = (config.commitLint?.types ?? DEFAULT_TYPES.map((t) => t.type)).map((t) => {
    const found = DEFAULT_TYPES.find((d) => d.type === t);
    return { label: t, description: found?.description ?? '' };
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  Thesmos Commit Wizard\n  ─────────────────────────');

  try {
    // 1. Type
    const type = await askWithMenu(rl, 'Select a commit type:', allowedTypes);

    // 2. Scope (optional)
    const scopeInput = (
      await ask(rl, '\n  Scope (optional, e.g. "auth", press Enter to skip): ')
    ).trim();
    const scope = scopeInput ? `(${scopeInput.toLowerCase().replace(/\s+/g, '-')})` : '';

    // 3. Breaking change
    const breakingAnswer = (await ask(rl, '  Breaking change? (y/N): ')).trim().toLowerCase();
    const isBreaking = breakingAnswer === 'y' || breakingAnswer === 'yes';
    const bang = isBreaking ? '!' : '';

    // 4. Subject
    let subject = '';
    const maxLen = config.commitLint?.maxSubjectLength ?? 72;
    while (true) {
      subject = (await ask(rl, '  Subject (imperative, no period): ')).trim();
      if (!subject) {
        console.log('  Subject is required.');
        continue;
      }
      const prefix = `${type}${scope}${bang}: `;
      if ((prefix + subject).length > maxLen) {
        console.log(
          `  Subject is ${(prefix + subject).length} chars (max ${maxLen}). Please shorten.`
        );
        continue;
      }
      break;
    }

    // 5. Body (optional)
    console.log('  Body (optional, press Enter twice when done):');
    const bodyLines: string[] = [];
    while (true) {
      const line = await ask(rl, '  ');
      if (line === '' && bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') break;
      bodyLines.push(line);
    }
    const body = bodyLines.join('\n').trim();

    // 6. Breaking change footer
    let footer = '';
    if (isBreaking) {
      const desc = (await ask(rl, '  BREAKING CHANGE description: ')).trim();
      if (desc) footer = `BREAKING CHANGE: ${desc}`;
    }

    // Build message
    const firstLine = `${type}${scope}${bang}: ${subject}`;
    const parts = [firstLine];
    if (body) {
      parts.push('');
      parts.push(body);
    }
    if (footer) {
      parts.push('');
      parts.push(footer);
    }
    const commitMsg = parts.join('\n');

    console.log('\n  ─────────────────────────');
    console.log('  Generated commit message:\n');
    console.log(
      commitMsg
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
    );
    console.log('\n  ─────────────────────────');

    // Validate before committing
    const findings = lintMessage(commitMsg, root);
    if (findings.length > 0) {
      console.log('\n  Lint warnings:');
      for (const f of findings) {
        console.log(`  ⚠ [${f.severity}] ${f.message}`);
      }
    }
    if (doCommit && findings.some((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH')) {
      process.stderr.write('commit:create: resolve blocking findings before committing.\n');
      process.exitCode = 1;
      return;
    }

    if (doCommit) {
      const confirm = (await ask(rl, '\n  Commit now? (Y/n): ')).trim().toLowerCase();
      if (confirm === '' || confirm === 'y' || confirm === 'yes') {
        try {
          // No shell and no .git directory assumption: linked worktrees use a file.
          execFileSync('git', ['commit', '--file=-'], {
            cwd: root,
            input: commitMsg,
            encoding: 'utf8',
            stdio: ['pipe', 'inherit', 'inherit'],
            windowsHide: true,
          });
        } catch {
          process.stderr.write('commit:create: git commit failed.\n');
          process.exitCode = 1;
          return;
        }
      }
    } else {
      console.log('\n  To commit, run:');
      console.log('  git commit');
      if (body || footer) {
        console.log('\n  Or copy the full message above into your editor with:');
        console.log('  git commit');
      }
    }
  } finally {
    rl.close();
  }
}
