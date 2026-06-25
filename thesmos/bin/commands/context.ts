// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos context:snapshot  — generate .thesmos/context.md
 * thesmos context:health    — check freshness of context and adapter files
 * thesmos context:compact   — write compressed session summary to .thesmos/session-log.md
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { generateContextCapsule, saveContextCapsule } from '../../context-capsule.js';
import { parseArgs, flagVal, flag } from '../lib/args.ts';

export async function cmdContext(argv: string[]): Promise<void> {
  const sub = argv[0];

  if (!sub || sub === 'snapshot') {
    return runSnapshot(argv.slice(1));
  }
  if (sub === 'health') {
    return runHealth(argv.slice(1));
  }
  if (sub === 'compact') {
    return runCompact(argv.slice(1));
  }

  process.stderr.write(`thesmos context: unknown subcommand "${sub}"\n`);
  process.stderr.write('Usage: thesmos context:snapshot | thesmos context:health | thesmos context:compact\n');
  process.exit(1);
}

async function runSnapshot(argv: string[]): Promise<void> {
  const asJson = argv.includes('--json');
  const root   = process.cwd();

  const capsule = generateContextCapsule(root);
  saveContextCapsule(root, capsule);

  if (asJson) {
    console.log(JSON.stringify(capsule, null, 2));
    return;
  }

  console.log('\nThesmos Context Snapshot\n');
  console.log(`  Project:   ${capsule.project}`);
  console.log(`  Stack:     ${capsule.stack.length > 0 ? capsule.stack.join(', ') : '(none detected)'}`);
  if (capsule.patterns.length > 0) {
    console.log(`  Patterns:  ${capsule.patterns.length} detected`);
    for (const p of capsule.patterns) console.log(`             - ${p}`);
  }
  if (capsule.constraints.length > 0) {
    console.log(`  Constraints: ${capsule.constraints.length} active`);
    for (const c of capsule.constraints) console.log(`             - ${c}`);
  }
  console.log(`\n  Written → .thesmos/context.md\n`);
  console.log(`  Context Health: ${capsule.health.score}/100 (${capsule.health.grade})`);
  if (capsule.health.issues.length > 0) {
    console.log('');
    for (const issue of capsule.health.issues) console.log(`    ⚠ ${issue}`);
  }
  console.log('');
}

async function runHealth(argv: string[]): Promise<void> {
  const asJson   = argv.includes('--json');
  const failFlag = argv.includes('--fail');
  const threshold = (() => {
    const t = argv.find((a) => a.startsWith('--threshold='));
    return t ? parseInt(t.split('=')[1] ?? '60', 10) : 60;
  })();

  const root    = process.cwd();
  const capsule = generateContextCapsule(root);

  if (asJson) {
    console.log(JSON.stringify({ score: capsule.health.score, grade: capsule.health.grade, issues: capsule.health.issues }, null, 2));
    if (failFlag && capsule.health.score < threshold) process.exit(1);
    return;
  }

  const gradeIcon = capsule.health.grade === 'A' ? '✓' : capsule.health.grade === 'B' ? '✓' : '⚠';
  console.log(`\nContext Health: ${capsule.health.score}/100 (${capsule.health.grade})\n`);

  if (capsule.health.issues.length === 0) {
    console.log('  ✓ All context checks passed.\n');
  } else {
    for (const issue of capsule.health.issues) {
      console.log(`  ⚠ ${issue}`);
    }
    console.log('');
  }

  const ageStr = capsule.health.contextAgeHours === null
    ? 'no snapshot'
    : capsule.health.contextAgeHours < 1
      ? 'just now'
      : capsule.health.contextAgeHours < 24
        ? `${capsule.health.contextAgeHours}h ago`
        : `${Math.floor(capsule.health.contextAgeHours / 24)}d ago`;

  console.log(`  context.md:  ${ageStr}`);
  console.log(`  CLAUDE.md:   ${capsule.health.adaptersFresh ? 'present' : 'missing'}`);
  if (capsule.stack.length > 0) {
    console.log(`  Stack:       ${capsule.stack.slice(0, 4).join(', ')}`);
  }
  console.log('');

  if (failFlag && capsule.health.score < threshold) {
    process.stderr.write(`context:health: score ${capsule.health.score} below threshold ${threshold} — exit 1\n`);
    process.exit(1);
  }
}

// ── context:compact ───────────────────────────────────────────────────────────

function getGitSummary(root: string): { branch: string; lastCommit: string; changedFiles: string[] } {
  let branch = 'unknown';
  let lastCommit = '';
  let changedFiles: string[] = [];
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* not a git repo */ }
  try {
    lastCommit = execSync('git log -1 --pretty=format:"%s"', { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* no commits */ }
  try {
    const status = execSync('git status --short', { cwd: root, encoding: 'utf8' });
    changedFiles = status
      .split('\n')
      .filter(Boolean)
      .map((l) => l.trim().slice(3))
      .filter(Boolean);
  } catch { /* ignore */ }
  return { branch, lastCommit, changedFiles };
}

async function runCompact(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const root = process.cwd();

  // Accept summary as positional args or flags
  const summary = positionals.length > 0
    ? positionals.join(' ')
    : (flagVal(flags, 'summary') ?? '');
  const next = flagVal(flags, 'next') ?? '';
  const blockers = flagVal(flags, 'blockers') ?? '';

  if (!summary) {
    process.stderr.write(
      'Usage: thesmos context:compact "<summary>" [--next="..."] [--blockers="..."]\n' +
      '  or:  thesmos context:compact --summary="..." --next="..." --blockers="..."\n',
    );
    process.exit(1);
  }

  const git = getGitSummary(root);
  const ts = new Date().toISOString();
  const date = ts.split('T')[0] ?? ts;

  // Read active-plan.md if it exists, to embed the most recent task title
  let activePlanTask = '';
  const activePlanPath = join(root, '.thesmos', 'active-plan.md');
  if (existsSync(activePlanPath)) {
    try {
      const activePlanContent = readFileSync(activePlanPath, 'utf8');
      const taskMatch = activePlanContent.match(/\*\*Task:\*\*\s+(.+)/);
      if (taskMatch?.[1]) activePlanTask = taskMatch[1].trim();
    } catch { /* ignore */ }
  }

  // Build the session log entry (Markdown)
  const separator = `\n${'─'.repeat(60)}\n`;
  const entry = [
    `## Session — ${date}`,
    '',
    `**Branch:** ${git.branch}`,
    `**Last commit:** ${git.lastCommit || '(none)'}`,
    ...(activePlanTask ? [`**Council task:** ${activePlanTask}`] : []),
    '',
    `### What changed`,
    summary,
    '',
    ...(git.changedFiles.length > 0
      ? [`**Uncommitted files:** ${git.changedFiles.slice(0, 10).join(', ')}${git.changedFiles.length > 10 ? ` +${git.changedFiles.length - 10} more` : ''}`, '']
      : []),
    ...(next ? [`### What's next`, next, ''] : []),
    ...(blockers ? [`### Blockers`, blockers, ''] : []),
    `*Compacted at ${ts}*`,
  ].join('\n');

  const thesmosDir = join(root, '.thesmos');
  mkdirSync(thesmosDir, { recursive: true });
  const logPath = join(thesmosDir, 'session-log.md');

  const isNew = !existsSync(logPath);
  const prefix = isNew
    ? `# Thesmos Session Log\n\nAuto-generated by \`thesmos context:compact\`. Each entry is a session summary.\n`
    : '';

  appendFileSync(logPath, prefix + separator + entry + '\n', 'utf8');

  if (json) {
    process.stdout.write(JSON.stringify({ ts, branch: git.branch, summary, next, blockers, logPath }) + '\n');
    return;
  }

  console.log(`\n  ✅ Session log updated → .thesmos/session-log.md\n`);
  console.log(`     Branch: ${git.branch}`);
  console.log(`     Summary: ${summary.slice(0, 80)}${summary.length > 80 ? '…' : ''}`);
  if (next) console.log(`     Next: ${next.slice(0, 80)}${next.length > 80 ? '…' : ''}`);
  if (blockers) console.log(`     Blockers: ${blockers.slice(0, 80)}${blockers.length > 80 ? '…' : ''}`);
  console.log('');
}
