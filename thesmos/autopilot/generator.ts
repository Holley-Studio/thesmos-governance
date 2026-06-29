// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Natural language plan generator.
 *
 * Takes a plain English description of what you want to build,
 * reads your codebase to understand the context, asks 3–5 clarifying
 * questions, then generates a validated MASTER_PLAN.md ready to run.
 *
 * Usage:
 *   thesmos autopilot generate "add Stripe checkout to the Express app"
 *   thesmos autopilot generate "add Stripe checkout" --out STRIPE_PLAN.md
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, relative, extname } from 'node:path';
import * as readline from 'node:readline';
import type { Adapter } from './adapters.js';
import { createAdapter } from './adapters.js';
import { parsePlan } from './plan-parser.js';

// ── Codebase snapshot ─────────────────────────────────────────────────────────

export interface CodebaseSnapshot {
  projectName: string;
  description: string;
  mainLanguage: string;
  frameworks: string[];
  testRunner: string;
  hasTypeScript: boolean;
  scripts: Record<string, string>;
  topLevelDirs: string[];
  sampleFiles: string[];
  existingPlans: string[];
}

const FRAMEWORK_MARKERS: Record<string, string[]> = {
  next: ['next', 'nextjs', 'next.js'],
  react: ['react', 'react-dom'],
  vue: ['vue', '@vue/core'],
  express: ['express'],
  fastify: ['fastify'],
  nestjs: ['@nestjs/core'],
  prisma: ['@prisma/client'],
  drizzle: ['drizzle-orm'],
  trpc: ['@trpc/server'],
  stripe: ['stripe'],
  supabase: ['@supabase/supabase-js'],
  vitest: ['vitest'],
  jest: ['jest'],
  playwright: ['playwright', '@playwright/test'],
};

export function snapshotCodebase(root: string): CodebaseSnapshot {
  const pkgPath = join(root, 'package.json');
  let pkg: Record<string, unknown> = {};
  if (existsSync(pkgPath)) {
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { /* ignore */ }
  }

  const deps = {
    ...((pkg['dependencies'] as Record<string, string>) ?? {}),
    ...((pkg['devDependencies'] as Record<string, string>) ?? {}),
  };

  const scripts = (pkg['scripts'] as Record<string, string>) ?? {};
  const projectName = (pkg['name'] as string) ?? 'project';
  const description = (pkg['description'] as string) ?? '';

  // Detect frameworks
  const frameworks: string[] = [];
  for (const [label, markers] of Object.entries(FRAMEWORK_MARKERS)) {
    if (markers.some((m) => m in deps)) frameworks.push(label);
  }

  const hasTypeScript = 'typescript' in deps || existsSync(join(root, 'tsconfig.json'));
  const mainLanguage = hasTypeScript ? 'TypeScript' : 'JavaScript';

  const testRunner = frameworks.includes('vitest')
    ? 'vitest'
    : frameworks.includes('jest')
    ? 'jest'
    : frameworks.includes('playwright')
    ? 'playwright'
    : 'npm test';

  // Top-level dirs (exclude hidden + node_modules)
  let topLevelDirs: string[] = [];
  try {
    topLevelDirs = readdirSync(root)
      .filter((e) => {
        if (e.startsWith('.') || e === 'node_modules') return false;
        try { return statSync(join(root, e)).isDirectory(); } catch { return false; }
      })
      .slice(0, 12);
  } catch { /* ignore */ }

  // Sample source files (up to 20, for AI context)
  const sampleFiles = collectSampleFiles(root, 20);

  // Existing plan files
  const existingPlans = readdirSync(root)
    .filter((f) => f.endsWith('.md') && (f.includes('PLAN') || f.includes('plan')))
    .slice(0, 5);

  return {
    projectName,
    description,
    mainLanguage,
    frameworks,
    testRunner,
    hasTypeScript,
    scripts,
    topLevelDirs,
    sampleFiles,
    existingPlans,
  };
}

function collectSampleFiles(root: string, max: number): string[] {
  const out: string[] = [];
  const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.css', '.scss']);
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

  function walk(dir: string, depth: number): void {
    if (out.length >= max || depth > 4) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (out.length >= max) break;
      if (SKIP_DIRS.has(entry)) continue;
      const abs = join(dir, entry);
      try {
        const s = statSync(abs);
        if (s.isDirectory()) {
          walk(abs, depth + 1);
        } else if (EXTS.has(extname(entry))) {
          out.push(relative(root, abs));
        }
      } catch { /* skip */ }
    }
  }

  walk(root, 0);
  return out;
}

// ── Clarifying questions ──────────────────────────────────────────────────────

export interface ClarifyingQuestion {
  id: string;
  question: string;
  hint?: string;
}

export function buildClarifyingPrompt(
  goal: string,
  snapshot: CodebaseSnapshot,
): string {
  return [
    `You are helping generate a Thesmos Autopilot plan for a software project.`,
    ``,
    `PROJECT CONTEXT:`,
    `  Name: ${snapshot.projectName}`,
    `  Language: ${snapshot.mainLanguage}`,
    `  Frameworks: ${snapshot.frameworks.join(', ') || 'none detected'}`,
    `  Test runner: ${snapshot.testRunner}`,
    `  Top-level dirs: ${snapshot.topLevelDirs.join(', ')}`,
    `  Source files (sample): ${snapshot.sampleFiles.slice(0, 10).join(', ')}`,
    snapshot.description ? `  Description: ${snapshot.description}` : '',
    ``,
    `GOAL: "${goal}"`,
    ``,
    `Generate exactly 3 to 5 clarifying questions that would help you write a precise`,
    `implementation plan. Focus on ambiguities about:`,
    `  - Which specific files or directories should be modified`,
    `  - What existing patterns to follow or avoid`,
    `  - Whether new packages are needed`,
    `  - The expected scope and boundaries of the change`,
    `  - Edge cases or constraints the developer cares about`,
    ``,
    `Output format — use these exact headers for each question, nothing else:`,
    `QUESTION 1: [the question]`,
    `HINT 1: [a short example answer or guidance]`,
    `QUESTION 2: [the question]`,
    `HINT 2: [a short example answer or guidance]`,
    `(continue to 3–5 questions)`,
  ].filter(Boolean).join('\n');
}

export function parseClarifyingQuestions(raw: string): ClarifyingQuestion[] {
  const questions: ClarifyingQuestion[] = [];
  const questionRe = /QUESTION (\d+):\s*(.+)/gi;
  const hintRe = /HINT (\d+):\s*(.+)/gi;

  const hints = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = hintRe.exec(raw)) !== null) {
    hints.set(m[1]!, m[2]!.trim());
  }

  while ((m = questionRe.exec(raw)) !== null) {
    questions.push({
      id: m[1]!,
      question: m[2]!.trim(),
      hint: hints.get(m[1]!) ?? undefined,
    });
  }

  return questions;
}

export async function askClarifyingQuestions(
  questions: ClarifyingQuestion[],
): Promise<Record<string, string>> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers: Record<string, string> = {};

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  process.stdout.write(`\n${'─'.repeat(62)}\n`);
  process.stdout.write(`A few questions before generating the plan:\n`);
  process.stdout.write(`(Press Enter to accept the hint, or type your answer)\n`);
  process.stdout.write(`${'─'.repeat(62)}\n\n`);

  for (const q of questions) {
    if (q.hint) {
      process.stdout.write(`${q.question}\n`);
      const answer = await ask(`  [${q.hint}] → `);
      answers[q.id] = answer.trim() || q.hint;
    } else {
      const answer = await ask(`${q.question}\n→ `);
      answers[q.id] = answer.trim();
    }
    process.stdout.write('\n');
  }

  rl.close();
  return answers;
}

// ── Plan generation prompt ────────────────────────────────────────────────────

export function buildPlanGenerationPrompt(
  goal: string,
  snapshot: CodebaseSnapshot,
  questions: ClarifyingQuestion[],
  answers: Record<string, string>,
): string {
  const qa = questions
    .map((q) => `Q: ${q.question}\nA: ${answers[q.id] ?? '(no answer)'}`)
    .join('\n\n');

  const gateCommand = snapshot.scripts['test']
    ? 'npm test'
    : snapshot.scripts['typecheck'] || snapshot.scripts['type-check']
    ? 'npm run typecheck'
    : 'npm test';

  const typecheckCmd = snapshot.scripts['typecheck']
    ? 'npm run typecheck'
    : snapshot.scripts['type-check']
    ? 'npm run type-check'
    : snapshot.hasTypeScript
    ? 'npm run typecheck'
    : '';

  return [
    `You are generating a Thesmos Autopilot MASTER_PLAN.md for a software project.`,
    ``,
    `PROJECT CONTEXT:`,
    `  Name: ${snapshot.projectName}`,
    `  Language: ${snapshot.mainLanguage}`,
    `  Frameworks: ${snapshot.frameworks.join(', ') || 'none detected'}`,
    `  Test runner: ${snapshot.testRunner}`,
    `  Scripts: ${Object.entries(snapshot.scripts).slice(0, 8).map(([k, v]) => `${k}: "${v}"`).join(', ')}`,
    `  Source file structure: ${snapshot.sampleFiles.slice(0, 15).join(', ')}`,
    ``,
    `GOAL: "${goal}"`,
    ``,
    `CLARIFYING Q&A:`,
    qa,
    ``,
    `PLAN FORMAT — follow this exactly:`,
    ``,
    `---`,
    `project: [descriptive name]`,
    `adapter: claude`,
    `gates:`,
    `  - ${gateCommand}`,
    typecheckCmd ? `  - ${typecheckCmd}` : '',
    `max_retries: 2`,
    `commit_on_pass: true`,
    `---`,
    ``,
    `## Task 1: [clear imperative title]`,
    ``,
    `Context: [why this task exists, what it should accomplish, what to be careful about]`,
    `Scope: [comma-separated file paths and/or directories that ONLY this task touches]`,
    `New packages allowed: [pkg@version, or "none"]`,
    `Depends on: [task numbers, or "none"]`,
    `Done when:`,
    `  - file:src/path/to/file.ts`,
    `  - command:npm test -- src/path`,
    `  - grep:src/file.ts:export function name`,
    `  - no-grep:src/file.ts:TODO`,
    ``,
    `(repeat for each task)`,
    ``,
    `---CHECKPOINT--- [insert between logical phases if the plan has 4+ tasks]`,
    ``,
    `RULES FOR A GOOD PLAN:`,
    `1. Each task must have a unique, non-overlapping Scope. No two tasks modify the same file unless the later one declares Depends on the earlier.`,
    `2. Done criteria must use only: file:, command:, grep:, no-grep: prefixes. No free text.`,
    `3. Tasks should be small enough to complete in under 30 minutes. Split large tasks.`,
    `4. The first task should set up shared types/interfaces that later tasks depend on.`,
    `5. The last task should verify the full system works end-to-end (npm test, etc.).`,
    `6. Write Context as if briefing a developer who has never seen this codebase.`,
    `7. Use the actual file paths from the project's file structure above.`,
    `8. Include a checkpoint after 3–4 tasks so the human can review progress mid-session.`,
    ``,
    `Generate the complete MASTER_PLAN.md now. Output ONLY the plan, no preamble.`,
  ].filter((l) => l !== null).join('\n');
}

// ── Post-generation validation report ────────────────────────────────────────

export function buildGenerationReport(
  goal: string,
  planContent: string,
  outputPath: string,
): string {
  const { plan, issues } = parsePlan(planContent);
  const errors = issues.filter((i) => i.type === 'error');
  const warnings = issues.filter((i) => i.type === 'warning');
  const taskCount = plan?.tasks.filter((t) => !t.isCheckpoint).length ?? 0;

  const lines: string[] = [
    `${'─'.repeat(62)}`,
    `  PLAN GENERATED`,
    `${'─'.repeat(62)}`,
    ``,
    `  Goal:   "${goal}"`,
    `  Output: ${outputPath}`,
    `  Tasks:  ${taskCount}`,
    ``,
  ];

  if (errors.length > 0) {
    lines.push(`  ✗ ${errors.length} issue${errors.length !== 1 ? 's' : ''} found — auto-correcting where possible:`);
    for (const e of errors) lines.push(`    - ${e.message.split('\n')[0]}`);
    lines.push(`    → Run: thesmos autopilot validate ${outputPath}`);
  } else {
    lines.push(`  ✓ Plan validated — no errors`);
  }

  if (warnings.length > 0) {
    lines.push(`  ⚠ ${warnings.length} warning${warnings.length !== 1 ? 's' : ''} (review before running):`);
    for (const w of warnings) lines.push(`    - ${w.message.split('\n')[0]}`);
  }

  lines.push(
    ``,
    `NEXT STEPS`,
    ``,
    `  1. Review the plan:`,
    `       cat ${outputPath}`,
    ``,
    `  2. Validate (full check + .review.md):`,
    `       thesmos autopilot validate ${outputPath}`,
    ``,
    `  3. When ready, run:`,
    `       thesmos autopilot start ${outputPath}`,
    ``,
    `${'─'.repeat(62)}`,
  );

  return lines.join('\n');
}

// ── Main generate function ────────────────────────────────────────────────────

export interface GenerateOptions {
  outputPath?: string;
  adapter?: string;
  verbose?: boolean;
}

export async function generatePlan(
  root: string,
  goal: string,
  options: GenerateOptions = {},
): Promise<string> {
  const outputPath = options.outputPath ?? join(root, 'MASTER_PLAN.md');
  const adapterName = options.adapter ?? 'claude';
  const adapter = createAdapter(adapterName) as Adapter;

  process.stdout.write(`\nThesmos Autopilot — Plan Generator\n`);
  process.stdout.write(`Reading codebase...\n`);

  const snapshot = snapshotCodebase(root);

  process.stdout.write(`  Project: ${snapshot.projectName} (${snapshot.mainLanguage})\n`);
  if (snapshot.frameworks.length > 0) {
    process.stdout.write(`  Frameworks: ${snapshot.frameworks.join(', ')}\n`);
  }
  process.stdout.write(`  Files scanned: ${snapshot.sampleFiles.length}\n\n`);

  // Step 1: Generate clarifying questions
  process.stdout.write(`Generating clarifying questions...\n`);
  const clarifyPrompt = buildClarifyingPrompt(goal, snapshot);

  const { tmpdir } = await import('node:os');
  const { mkdtempSync } = await import('node:fs');
  const tmpDir = mkdtempSync(join(tmpdir(), 'thesmos-gen-'));
  const clarifyLogPath = join(tmpDir, 'clarify.log');

  const clarifyResult = await adapter.execute(clarifyPrompt, {
    timeoutMs: 2 * 60 * 1000,
    logPath: clarifyLogPath,
    sessionId: 'generate',
    taskIndex: 0,
  });

  let questions: ClarifyingQuestion[] = [];
  if (clarifyResult.success && existsSync(clarifyLogPath)) {
    const raw = readFileSync(clarifyLogPath, 'utf8');
    questions = parseClarifyingQuestions(raw);
  }

  if (questions.length === 0) {
    // Fallback generic questions if AI call fails
    questions = [
      { id: '1', question: 'Which files or directories should be created or modified?', hint: 'e.g. src/routes/checkout.ts, src/services/stripe.ts' },
      { id: '2', question: 'Are there any new npm packages needed?', hint: 'e.g. stripe@14.x, or "none"' },
      { id: '3', question: 'What existing patterns should the new code follow?', hint: 'e.g. same structure as src/routes/auth.ts' },
    ];
  }

  // Step 2: Ask clarifying questions
  const answers = await askClarifyingQuestions(questions);

  // Step 3: Generate the plan
  process.stdout.write(`Generating plan...\n`);
  const planPrompt = buildPlanGenerationPrompt(goal, snapshot, questions, answers);
  const planLogPath = join(tmpDir, 'plan.log');

  const planResult = await adapter.execute(planPrompt, {
    timeoutMs: 5 * 60 * 1000,
    logPath: planLogPath,
    sessionId: 'generate',
    taskIndex: 1,
  });

  if (!planResult.success || !existsSync(planLogPath)) {
    throw new Error(`Plan generation failed. Check adapter configuration.`);
  }

  let planContent = readFileSync(planLogPath, 'utf8').trim();

  // Strip any AI preamble before the YAML frontmatter
  const fmStart = planContent.indexOf('---');
  if (fmStart > 0) planContent = planContent.slice(fmStart);

  // Keep everything from the first --- to end
  planContent = planContent.trim();

  // Write the plan
  writeFileSync(outputPath, planContent + '\n', 'utf8');

  // Cleanup tmp
  try {
    const { rmSync } = await import('node:fs');
    rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  // Print report
  process.stdout.write(buildGenerationReport(goal, planContent, outputPath));

  return outputPath;
}
