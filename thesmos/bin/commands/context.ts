// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos context:snapshot  — generate .thesmos/context.md
 * thesmos context:health    — check freshness of context and adapter files
 * thesmos context:compact   — write compressed session summary to .thesmos/session-log.md
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { buildMissionContext, generateContextCapsule, saveContextCapsule } from '../../context-capsule.js';
import { loadConfig } from '../../config.js';
import { OllamaProvider } from '../../runtime/providers/ollama/provider.js';
import { resolveEmbeddingModel, type EmbeddingContext } from '../../memory/embeddings.js';
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
  if (sub === 'explain') {
    return runExplain(argv.slice(1));
  }

  process.stderr.write(`thesmos context: unknown subcommand "${sub}"\n`);
  process.stderr.write(
    'Usage: thesmos context:snapshot | context:health | context:compact | context:explain "<request>"\n',
  );
  process.exit(1);
}

/**
 * thesmos context:explain "<request>"
 *
 * Shows exactly what governed memory a request would pull in and — more
 * usefully — what it would leave out and why. Context selection that cannot be
 * inspected is indistinguishable from context selection that is wrong.
 */
async function runExplain(argv: string[]): Promise<void> {
  const query = argv.filter((a) => !a.startsWith('--'))[0];
  if (!query) {
    process.stderr.write('Usage: thesmos context:explain "<request>"\n');
    process.exit(1);
  }

  const root = process.cwd();
  const config = loadConfig(root);
  const asJson = argv.includes('--json');

  const providers = (config as { providers?: { ollama?: { enabled?: boolean; baseUrl?: string; embeddingModel?: string } } })
    .providers ?? {};

  // Semantic when a usable embedding model is installed, lexical otherwise —
  // and the output always says which, so a thin result is never a mystery.
  let embedding: EmbeddingContext | undefined;
  let mode = 'lexical (no embedding provider)';
  if (providers.ollama?.enabled !== false) {
    const provider = new OllamaProvider({ baseUrl: providers.ollama?.baseUrl });
    const health = await provider.health();
    if (!health.available) {
      mode = `lexical — Ollama unavailable (${health.errorCode ?? 'unknown'})`;
    } else {
      const resolved = resolveEmbeddingModel(await provider.listModels(), providers.ollama?.embeddingModel);
      if ('error' in resolved) {
        mode = `lexical — ${resolved.error}`;
      } else if (!resolved.model.embeddingDimensions) {
        mode = `lexical — ${resolved.model.id} did not report a vector width`;
      } else {
        embedding = { provider, model: resolved.model.id, dimensions: resolved.model.embeddingDimensions };
        mode = `semantic via ${resolved.model.id} (${resolved.model.embeddingDimensions}d)`;
      }
    }
  }

  const result = await buildMissionContext({
    root,
    query,
    authority: { maxScope: 'repository', repoId: config.project },
    embedding,
  });

  if (asJson) {
    console.log(JSON.stringify({ query, mode, ...result.diagnostics, included: result.memoryIds }, null, 2));
    return;
  }

  const d = result.diagnostics;
  console.log('\n  Context Intelligence\n');
  console.log(`  Request:   ${query}`);
  console.log(`  Repo:      ${config.project ?? '(unidentified)'}`);
  console.log(`  Retrieval: ${mode}`);
  console.log(`  Recall:    ${d.recallAttempted ? 'yes' : 'no'} — ${d.recallReason}\n`);

  if (!d.recallAttempted) {
    console.log('  No memory was retrieved for this request.\n');
    return;
  }

  console.log(`  ${d.candidates} candidates · ${d.included} included · ${d.excluded.length} excluded`);
  console.log(`  ${d.retrievalMs}ms retrieval${d.embeddingMs !== undefined ? ` · ${d.embeddingMs}ms embedding` : ''}\n`);

  if (result.included.length > 0) {
    console.log('  Included:');
    for (const r of result.included) {
      console.log(`    ${r.memory.id.slice(0, 8)}  ${r.memory.type.padEnd(22)} ${r.relevanceScore.toFixed(3)}`);
      console.log(`      ${r.memory.content.replace(/\s+/g, ' ').slice(0, 88)}`);
    }
    console.log('');
  }

  if (d.excluded.length > 0) {
    console.log('  Excluded:');
    // Grouped by reason: a list of 40 identical lines teaches nothing.
    const byReason = d.excluded.reduce<Record<string, number>>((acc, e) => {
      acc[e.reason] = (acc[e.reason] ?? 0) + 1;
      return acc;
    }, {});
    for (const [reason, count] of Object.entries(byReason)) {
      console.log(`    ${String(count).padStart(3)}  ${reason}`);
    }
    console.log('');
  }

  if (d.conflicts.length > 0) {
    console.log(`  ⚠ ${d.conflicts.length} unresolved conflict(s) in the included set.\n`);
  }

  // Labelled an estimate because it is one — see estimateTokens.
  console.log(`  Memory budget: ~${d.memoryTokensEstimate} estimated tokens (${d.memoryChars} chars)\n`);
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
