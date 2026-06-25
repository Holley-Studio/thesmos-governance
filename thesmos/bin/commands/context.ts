// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos context:snapshot  — generate .thesmos/context.md
 * thesmos context:health    — check freshness of context and adapter files
 */

import { generateContextCapsule, saveContextCapsule } from '../../context-capsule.js';

export async function cmdContext(argv: string[]): Promise<void> {
  const sub = argv[0];

  if (!sub || sub === 'snapshot') {
    return runSnapshot(argv.slice(1));
  }
  if (sub === 'health') {
    return runHealth(argv.slice(1));
  }

  process.stderr.write(`thesmos context: unknown subcommand "${sub}"\n`);
  process.stderr.write('Usage: thesmos context:snapshot | thesmos context:health\n');
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
