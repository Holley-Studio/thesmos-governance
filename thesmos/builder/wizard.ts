/**
 * Thesmos Builder Wizard — core Q&A engine.
 *
 * Presents an interactive question sequence, collects answers,
 * and dispatches to the appropriate generator.
 *
 * Design constraint: max 8 questions per wizard. Anything that
 * can't be captured in 8 questions needs better question design.
 */

import { createInterface } from 'node:readline';
import { makeLogger } from '../logger.js';

const log = makeLogger('wizard');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WizardOption {
  label: string;
  value: string;
  description?: string;
}

export interface WizardQuestion {
  key: string;
  question: string;
  type: 'text' | 'choice';
  options?: WizardOption[];
  hint?: string;
  engineering_note?: string; // why this question exists
}

export type WizardAnswers = Record<string, string>;

export interface WizardContext {
  detectedStack: string[];
  projectName: string;
  hasExistingAgents: boolean;
}

// ── Question presenter ────────────────────────────────────────────────────────

async function askQuestion(rl: ReturnType<typeof createInterface>, q: WizardQuestion, qNum: number, total: number): Promise<string> {
  return new Promise((resolve) => {
    const prefix = `\n${qNum}/${total}`;

    if (q.type === 'choice' && q.options) {
      const lines = [`${prefix}  ${q.question}`];
      if (q.hint) lines.push(`     (${q.hint})`);
      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i]!;
        lines.push(`     [${i + 1}] ${opt.label}${opt.description ? ' — ' + opt.description : ''}`);
      }
      process.stdout.write(lines.join('\n') + '\n     > ');

      rl.once('line', (answer) => {
        const idx = parseInt(answer.trim(), 10) - 1;
        if (idx >= 0 && idx < q.options!.length) {
          resolve(q.options![idx]!.value);
        } else {
          resolve(q.options![0]!.value); // default to first
        }
      });
    } else {
      process.stdout.write(`\n${prefix}  ${q.question}\n`);
      if (q.hint) process.stdout.write(`     (${q.hint})\n`);
      process.stdout.write('     > ');

      rl.once('line', (answer) => {
        resolve(answer.trim());
      });
    }
  });
}

// ── Wizard runner ─────────────────────────────────────────────────────────────

export async function runWizard(
  questions: WizardQuestion[],
  context: WizardContext,
  prefilledAnswers: Partial<WizardAnswers> = {},
): Promise<WizardAnswers> {
  const answers: WizardAnswers = { ...prefilledAnswers };

  // Filter out pre-answered questions
  const toAsk = questions.filter((q) => !answers[q.key]);

  if (toAsk.length === 0) {
    log.info('wizard: all questions pre-filled from context');
    return answers;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (let i = 0; i < toAsk.length; i++) {
      const q = toAsk[i]!;
      const answer = await askQuestion(rl, q, i + 1, toAsk.length);
      answers[q.key] = answer;
      log.debug('wizard answer', { key: q.key, answer });
    }
  } finally {
    rl.close();
  }

  return answers;
}

// ── Context analyzer ──────────────────────────────────────────────────────────

export function analyzeContext(root: string): WizardContext {
  const { existsSync, readFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');

  let projectName = 'my-project';
  let detectedStack: string[] = [];

  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      projectName = pkg.name ?? 'my-project';
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['next']) detectedStack.push('Next.js');
      if (allDeps['react']) detectedStack.push('React');
      if (allDeps['express']) detectedStack.push('Express');
      if (allDeps['fastify']) detectedStack.push('Fastify');
      if (allDeps['prisma']) detectedStack.push('Prisma');
      if (allDeps['mongoose']) detectedStack.push('Mongoose');
      if (allDeps['openai']) detectedStack.push('OpenAI SDK');
      if (allDeps['@anthropic-ai/sdk']) detectedStack.push('Anthropic SDK');
    } catch {
      // ignore
    }
  }

  // Also check brain.json for already-detected stack
  const brainPath = join(root, '.thesmos', 'brain.json');
  if (existsSync(brainPath)) {
    try {
      const brain = JSON.parse(readFileSync(brainPath, 'utf-8')) as { detectedStack?: string[] };
      if (brain.detectedStack && brain.detectedStack.length > 0) {
        detectedStack = [...new Set([...detectedStack, ...brain.detectedStack])];
      }
    } catch {
      // ignore
    }
  }

  const catalogPath = join(root, '.thesmos', 'catalog', 'agents');
  const hasExistingAgents = existsSync(catalogPath) &&
    (() => {
      try { return readdirSync(catalogPath).length > 0; } catch { return false; }
    })();

  return { projectName, detectedStack, hasExistingAgents };
}

// ── Pre-fill logic ────────────────────────────────────────────────────────────

export function prefilledFromContext(context: WizardContext, builderType: string): Partial<WizardAnswers> {
  const prefilled: Partial<WizardAnswers> = {};

  // Pre-fill data access based on detected stack
  if (builderType === 'agent') {
    if (context.detectedStack.includes('Prisma') || context.detectedStack.includes('Mongoose')) {
      prefilled['dataAccess'] = 'database';
    } else if (context.detectedStack.length === 0) {
      prefilled['dataAccess'] = 'code';
    }

    // Pre-fill performance based on stack
    if (context.detectedStack.includes('Next.js') || context.detectedStack.includes('Express')) {
      prefilled['performance'] = 'interactive';
    }
  }

  return prefilled;
}
