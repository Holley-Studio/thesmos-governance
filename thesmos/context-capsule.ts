// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Context Health + Session Handoff — project context capsule generator.
 *
 * Generates a compact, authoritative `.thesmos/context.md` that seeds the
 * next Claude Code session with the project's stack, established patterns,
 * and active constraints — preventing context rot between sessions.
 *
 * Problems solved:
 *   - Quality degrades at 60% context utilization ("lost-in-the-middle" effect)
 *   - Each session starts from zero — no memory of architectural decisions
 *   - Rules files compete with growing context and are ignored
 *
 * The capsule is concise by design (< 1000 bytes) so it stays in context
 * without crowding out the rules that matter.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextCapsule, ContextHealth } from './types.js';

export type { ContextCapsule, ContextHealth };

const CONTEXT_FILE     = '.thesmos/context.md';
const CONTEXT_META_FILE = '.thesmos/context-meta.json';
const CONFIG_FILE      = '.thesmos/config.json';
const REPORT_FILE      = '.thesmos/report.json';

// ── Stack detection ───────────────────────────────────────────────────────────

function detectStack(root: string): string[] {
  const stack: string[] = [];
  const pkgPath = join(root, 'package.json');

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        engines?: { node?: string };
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps['typescript'])  stack.push('TypeScript');
      if (allDeps['next'])        stack.push(`Next.js ${allDeps['next']?.replace(/[\^~]/, '') ?? ''}`);
      if (allDeps['react'])       stack.push('React');
      if (allDeps['vue'])         stack.push('Vue');
      if (allDeps['svelte'])      stack.push('Svelte');
      if (allDeps['nuxt'])        stack.push('Nuxt');
      if (allDeps['astro'])       stack.push('Astro');
      if (allDeps['remix'])       stack.push('Remix');
      if (allDeps['express'])     stack.push('Express');
      if (allDeps['fastify'])     stack.push('Fastify');
      if (allDeps['hono'])        stack.push('Hono');
      if (allDeps['prisma'])      stack.push('Prisma');
      if (allDeps['drizzle-orm']) stack.push('Drizzle ORM');
      if (allDeps['mongoose'])    stack.push('Mongoose');
      if (allDeps['@supabase/supabase-js']) stack.push('Supabase');
      if (allDeps['zod'])         stack.push('Zod');
      if (allDeps['vitest'])      stack.push('Vitest');
      if (allDeps['jest'])        stack.push('Jest');
      if (allDeps['vite'])        stack.push('Vite');
      if (allDeps['tailwindcss']) stack.push('Tailwind CSS');
      if (allDeps['openai'])      stack.push('OpenAI SDK');
      if (allDeps['@anthropic-ai/sdk']) stack.push('Anthropic SDK');

      if (pkg.engines?.node) stack.push(`Node.js ${pkg.engines.node}`);
    } catch { /* */ }
  }

  // Python
  if (existsSync(join(root, 'requirements.txt')) || existsSync(join(root, 'pyproject.toml'))) {
    stack.push('Python');
    if (existsSync(join(root, 'pyproject.toml'))) {
      try {
        const content = readFileSync(join(root, 'pyproject.toml'), 'utf8');
        if (content.includes('fastapi')) stack.push('FastAPI');
        if (content.includes('django'))  stack.push('Django');
        if (content.includes('flask'))   stack.push('Flask');
      } catch { /* */ }
    }
  }

  // Go
  if (existsSync(join(root, 'go.mod'))) stack.push('Go');

  // Rust
  if (existsSync(join(root, 'Cargo.toml'))) stack.push('Rust');

  // Terraform
  if (existsSync(join(root, 'main.tf')) || existsSync(join(root, 'terraform.tf'))) {
    stack.push('Terraform');
  }

  return [...new Set(stack)];
}

// ── Pattern detection ─────────────────────────────────────────────────────────

function detectPatterns(root: string): string[] {
  const patterns: string[] = [];

  // Auth pattern
  const middlewarePath = join(root, 'src', 'middleware.ts');
  if (existsSync(middlewarePath)) {
    patterns.push('Auth: middleware.ts → auth guard → route handler');
  }

  // Result type pattern
  const resultPath = join(root, 'src', 'lib', 'result.ts');
  if (existsSync(resultPath)) {
    patterns.push('Error handling: Result<T, E> pattern (see src/lib/result.ts)');
  }

  // Zustand stores
  const storesPath = join(root, 'src', 'stores');
  if (existsSync(storesPath)) {
    patterns.push('State: Zustand stores in src/stores/ (no useState for shared state)');
  }

  // Zod validation
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
      if (pkg.dependencies?.['zod']) {
        patterns.push('Validation: Zod schemas before business logic');
      }
    } catch { /* */ }
  }

  // App Router pattern detection
  const appDir = join(root, 'src', 'app');
  const pagesDir = join(root, 'src', 'pages');
  if (existsSync(appDir)) {
    patterns.push('Routing: Next.js App Router (src/app/)');
  } else if (existsSync(pagesDir)) {
    patterns.push('Routing: Next.js Pages Router (src/pages/)');
  }

  // API routes
  if (existsSync(join(root, 'src', 'app', 'api'))) {
    patterns.push('API: Route handlers in src/app/api/ (never bypass auth middleware)');
  } else if (existsSync(join(root, 'src', 'api'))) {
    patterns.push('API: Route handlers in src/api/');
  }

  return patterns;
}

// ── Constraints detection ─────────────────────────────────────────────────────

function detectConstraints(root: string): string[] {
  const constraints: string[] = [];

  // TypeScript strict mode
  const tsConfig = join(root, 'tsconfig.json');
  if (existsSync(tsConfig)) {
    try {
      const ts = JSON.parse(readFileSync(tsConfig, 'utf8')) as {
        compilerOptions?: { strict?: boolean; noImplicitAny?: boolean };
      };
      if (ts.compilerOptions?.strict) {
        constraints.push('TypeScript: strict mode enabled (no implicit any)');
      }
    } catch { /* */ }
  }

  // Node.js version
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { engines?: { node?: string } };
      if (pkg.engines?.node) {
        constraints.push(`Runtime: Node.js ${pkg.engines.node}`);
      }
    } catch { /* */ }
  }

  // .env files present
  if (existsSync(join(root, '.env'))) {
    constraints.push('Config: environment variables in .env (never hardcode URLs or secrets)');
  }

  // Coverage threshold
  const vitestConfig = join(root, 'vitest.config.ts');
  if (existsSync(vitestConfig)) {
    try {
      const content = readFileSync(vitestConfig, 'utf8');
      const m = /threshold.*?(\d+)/s.exec(content);
      if (m) constraints.push(`Testing: coverage threshold ${m[1]}% (enforced in CI)`);
    } catch { /* */ }
  }

  return constraints;
}

// ── Governance metadata ───────────────────────────────────────────────────────

function detectGovernance(root: string): ContextCapsule['governance'] {
  let ruleCount = 0;
  let preset: string | null = null;
  let lastCleanScan: string | null = null;

  try {
    const cfgPath = join(root, CONFIG_FILE);
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
        preset?: string;
        rules?: unknown[];
      };
      preset = cfg.preset ?? null;
    }
  } catch { /* */ }

  try {
    const reportPath = join(root, REPORT_FILE);
    if (existsSync(reportPath)) {
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        generatedAt?: string;
        findings?: Array<{ severity: string }>;
      };
      const hasBlockers = report.findings?.some((f) => f.severity === 'BLOCKER') ?? false;
      if (!hasBlockers) lastCleanScan = report.generatedAt ?? null;
    }
  } catch { /* */ }

  // Count rules from THESMOS_RULES import
  try {
    // We approximate from the report if available
    const reportPath = join(root, REPORT_FILE);
    if (existsSync(reportPath)) {
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { ruleCount?: number };
      ruleCount = report.ruleCount ?? 0;
    }
  } catch { /* */ }

  return { ruleCount, lastCleanScan, preset };
}

// ── Health computation ────────────────────────────────────────────────────────

function computeHealth(root: string, capsule: Omit<ContextCapsule, 'health'>): ContextHealth {
  const issues: string[] = [];
  let score = 100;

  // Check context age
  const metaPath = join(root, CONTEXT_META_FILE);
  let contextAgeHours: number | null = null;
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { snapshotAt: string };
      const ageMs = Date.now() - new Date(meta.snapshotAt).getTime();
      contextAgeHours = Math.floor(ageMs / 3_600_000);
      if (contextAgeHours > 48) {
        score -= 20;
        issues.push(`context.md is ${contextAgeHours}h old — run \`thesmos context:snapshot\` to refresh`);
      } else if (contextAgeHours > 24) {
        score -= 10;
        issues.push(`context.md is ${contextAgeHours}h old — consider refreshing`);
      }
    } catch { /* */ }
  } else {
    score -= 15;
    issues.push('No context snapshot found — run `thesmos context:snapshot` to create one');
  }

  // Check adapter files
  const claudeMd = join(root, 'CLAUDE.md');
  const adaptersFresh = existsSync(claudeMd);
  if (!adaptersFresh) {
    score -= 20;
    issues.push('CLAUDE.md not found — run `thesmos adapters` to generate it');
  }

  // Check governance config
  if (!existsSync(join(root, CONFIG_FILE))) {
    score -= 15;
    issues.push('.thesmos/config.json not found — run `thesmos init` to set up governance');
  }

  // Check for scope config
  if (!existsSync(join(root, '.thesmos', 'scope.json'))) {
    score -= 5;
    issues.push('No scope.json — run `thesmos scope:init` to define agent boundaries');
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  const g = (clampedScore >= 90 ? 'A' : clampedScore >= 80 ? 'B' : clampedScore >= 70 ? 'C' : clampedScore >= 60 ? 'D' : 'F') as ContextHealth['grade'];

  return {
    score: clampedScore,
    grade: g,
    issues,
    contextAgeHours,
    adaptersFresh,
  };
}

// ── Generate capsule ──────────────────────────────────────────────────────────

export function generateContextCapsule(root: string): ContextCapsule {
  const project = (() => {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string };
      return pkg.name ?? root.split('/').pop() ?? 'project';
    } catch { return root.split('/').pop() ?? 'project'; }
  })();

  const snapshotAt = new Date().toISOString();
  const stack       = detectStack(root);
  const patterns    = detectPatterns(root);
  const constraints = detectConstraints(root);
  const governance  = detectGovernance(root);

  const partial = { project, snapshotAt, stack, patterns, constraints, governance };
  const health  = computeHealth(root, partial);

  return { ...partial, health };
}

// ── Render context.md ─────────────────────────────────────────────────────────

export function renderContextMd(capsule: ContextCapsule): string {
  const date = capsule.snapshotAt.slice(0, 10);
  const lines: string[] = [
    `# Project Context — ${capsule.project} — ${date}`,
    '',
  ];

  if (capsule.stack.length > 0) {
    lines.push('## Stack');
    lines.push(capsule.stack.join(', '));
    lines.push('');
  }

  if (capsule.patterns.length > 0) {
    lines.push('## Established Patterns');
    for (const p of capsule.patterns) lines.push(`- ${p}`);
    lines.push('');
  }

  if (capsule.constraints.length > 0) {
    lines.push('## Active Constraints');
    for (const c of capsule.constraints) lines.push(`- ${c}`);
    lines.push('');
  }

  lines.push('## Thesmos Governance');
  if (capsule.governance.ruleCount > 0) {
    lines.push(`- ${capsule.governance.ruleCount} active rules`);
  }
  if (capsule.governance.preset) lines.push(`- Preset: ${capsule.governance.preset}`);
  if (capsule.governance.lastCleanScan) {
    lines.push(`- Last clean scan: ${capsule.governance.lastCleanScan.slice(0, 10)}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ── Save / load ───────────────────────────────────────────────────────────────

export function saveContextCapsule(root: string, capsule: ContextCapsule): void {
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  const md = renderContextMd(capsule);
  writeFileSync(join(root, CONTEXT_FILE), md, 'utf8');
  writeFileSync(
    join(root, CONTEXT_META_FILE),
    JSON.stringify({ snapshotAt: capsule.snapshotAt, stack: capsule.stack }, null, 2) + '\n',
    'utf8',
  );
}

export function loadContextCapsule(root: string): ContextCapsule | null {
  try {
    const contextPath = join(root, CONTEXT_FILE);
    if (!existsSync(contextPath)) return null;
    // Regenerate on load to get current health status
    return generateContextCapsule(root);
  } catch {
    return null;
  }
}
