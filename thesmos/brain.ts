// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Thesmos Brain — context that survives Claude Code compaction.
 *
 * Generates `.thesmos/brain.md` — a concise Markdown file optimized for
 * Claude Code's context window that teaches Claude what to care about in
 * this specific repo: active suppressions, known false positives, architecture
 * notes, and open findings.
 *
 * The brain file is written by:
 *   - `thesmos brain:snapshot`  — full snapshot
 *   - `thesmos brain:compact`   — minimal (<500 words) for pre-compaction
 *   - Claude Code Stop hook         — auto-runs brain:compact before compaction
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeLogger } from './logger.js';

const log = makeLogger('brain');

export const BRAIN_FILE = '.thesmos/brain.md';
export const BRAIN_DIR = '.thesmos';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActiveSuppression {
  ruleId: string;
  reason: string;
  file: string;
}

export interface FrequentFinding {
  ruleId: string;
  count: number;
  files: string[];
}

export interface KnownFalsePositive {
  ruleId: string;
  evidence: string;
}

export interface BrainSnapshot {
  generatedAt: string;
  projectName: string;
  healthScore?: number;
  healthGrade?: string;
  activeSuppressions: ActiveSuppression[];
  frequentFindings: FrequentFinding[];
  knownFalsePositives: KnownFalsePositive[];
  architectureNotes: string[];
  openInvestigations: string[];
  customRules: string[];
  detectedStack: string[];
  rulesActive: number;
}

// ── Data readers ──────────────────────────────────────────────────────────────

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function readSuppressionsFile(root: string): ActiveSuppression[] {
  const suppressPath = join(root, '.thesmos', 'suppressions.json');
  const raw = readJsonFile<Record<string, { reason?: string; file?: string } | unknown>>(suppressPath);
  if (!raw || typeof raw !== 'object') return [];
  const results: ActiveSuppression[] = [];
  for (const [ruleId, entry] of Object.entries(raw)) {
    if (entry && typeof entry === 'object') {
      const e = entry as { reason?: string; file?: string };
      results.push({
        ruleId,
        reason: e.reason ?? 'no reason given',
        file: e.file ?? 'unknown',
      });
    }
  }
  return results.slice(0, 20); // cap at 20 to keep brain compact
}

function readReportFile(root: string): { score?: number; grade?: string; findings?: FrequentFinding[] } {
  const reportPath = join(root, '.thesmos', 'report.json');
  const raw = readJsonFile<{
    healthScore?: number;
    grade?: string;
    findings?: Array<{ rule?: string; file?: string }>;
  }>(reportPath);
  if (!raw) return {};

  // Aggregate findings by rule
  const countByRule: Record<string, { count: number; files: Set<string> }> = {};
  for (const f of raw.findings ?? []) {
    const rule = f.rule ?? 'unknown';
    if (!countByRule[rule]) countByRule[rule] = { count: 0, files: new Set() };
    countByRule[rule]!.count++;
    if (f.file) countByRule[rule]!.files.add(f.file);
  }

  const frequent: FrequentFinding[] = Object.entries(countByRule)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([ruleId, { count, files }]) => ({ ruleId, count, files: [...files].slice(0, 3) }));

  return { score: raw.healthScore, grade: raw.grade, findings: frequent };
}

function detectProjectName(root: string): string {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return 'Unknown Project';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
    return pkg.name ?? 'Unknown Project';
  } catch {
    return 'Unknown Project';
  }
}

function detectStack(root: string): string[] {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const stack: string[] = [];
    if (allDeps['next']) stack.push('Next.js');
    if (allDeps['react']) stack.push('React');
    if (allDeps['vue']) stack.push('Vue');
    if (allDeps['svelte']) stack.push('Svelte');
    if (allDeps['express']) stack.push('Express');
    if (allDeps['fastify']) stack.push('Fastify');
    if (allDeps['hono']) stack.push('Hono');
    if (allDeps['prisma']) stack.push('Prisma');
    if (allDeps['drizzle-orm']) stack.push('Drizzle');
    if (allDeps['mongoose']) stack.push('Mongoose');
    if (allDeps['@supabase/supabase-js']) stack.push('Supabase');
    if (allDeps['openai']) stack.push('OpenAI SDK');
    if (allDeps['@anthropic-ai/sdk']) stack.push('Anthropic SDK');
    if (allDeps['typescript']) stack.push('TypeScript');
    if (allDeps['vitest']) stack.push('Vitest');
    return stack;
  } catch {
    return [];
  }
}

function readArchitectureNotes(root: string): string[] {
  // Read from context-capsule if present
  const capsulePath = join(root, '.thesmos', 'context.md');
  if (!existsSync(capsulePath)) return [];
  try {
    const content = readFileSync(capsulePath, 'utf-8');
    const lines = content.split('\n');
    const notes: string[] = [];
    let inNotes = false;
    for (const line of lines) {
      if (/##\s*arch|##\s*pattern|##\s*convention/i.test(line)) { inNotes = true; continue; }
      if (/^##/.test(line) && inNotes) break;
      if (inNotes && line.trim().startsWith('-')) notes.push(line.trim());
    }
    return notes.slice(0, 8);
  } catch {
    return [];
  }
}

function readOpenInvestigations(root: string): string[] {
  // Read from audit trail or suppression review queue
  const auditPath = join(root, '.thesmos', 'audit.jsonl');
  if (!existsSync(auditPath)) return [];
  try {
    const lines = readFileSync(auditPath, 'utf-8').split('\n').filter(Boolean);
    const recent = lines.slice(-50); // last 50 entries
    const open: string[] = [];
    const seen = new Set<string>();
    for (const line of recent) {
      try {
        const entry = JSON.parse(line) as { status?: string; ruleId?: string; file?: string; ts?: string };
        if (entry.status === 'WARN' && entry.ruleId && !seen.has(entry.ruleId)) {
          seen.add(entry.ruleId);
          open.push(`${entry.ruleId} on ${entry.file ?? 'unknown'}`);
        }
      } catch {
        // ignore malformed lines
      }
    }
    return open.slice(0, 5);
  } catch {
    return [];
  }
}

function readCustomRules(root: string): string[] {
  const customDir = join(root, '.thesmos', 'custom-rules');
  if (!existsSync(customDir)) return [];
  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    return readdirSync(customDir)
      .filter((f: string) => f.endsWith('.ts') || f.endsWith('.js'))
      .map((f: string) => f.replace(/\.(ts|js)$/, ''))
      .slice(0, 10);
  } catch {
    return [];
  }
}

function countActiveRules(): number {
  // Dynamic import to avoid circular dependency
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { THESMOS_RULES } = require('./rules/registry.js') as { THESMOS_RULES: unknown[] };
    return THESMOS_RULES.length;
  } catch {
    return 0;
  }
}

// ── Snapshot generator ────────────────────────────────────────────────────────

export function generateBrainSnapshot(root: string): BrainSnapshot {
  const suppressions = readSuppressionsFile(root);
  const report = readReportFile(root);
  const archNotes = readArchitectureNotes(root);
  const openInvestigations = readOpenInvestigations(root);
  const customRules = readCustomRules(root);
  const stack = detectStack(root);

  return {
    generatedAt: new Date().toISOString(),
    projectName: detectProjectName(root),
    healthScore: report.score,
    healthGrade: report.grade,
    activeSuppressions: suppressions,
    frequentFindings: report.findings ?? [],
    knownFalsePositives: [],
    architectureNotes: archNotes,
    openInvestigations,
    customRules,
    detectedStack: stack,
    rulesActive: countActiveRules(),
  };
}

// ── Brain file writer ─────────────────────────────────────────────────────────

export function saveBrainFile(root: string, snapshot: BrainSnapshot, compact = false): void {
  const dir = join(root, BRAIN_DIR);
  mkdirSync(dir, { recursive: true });
  const content = compact
    ? formatCompactBrain(snapshot)
    : formatFullBrain(snapshot);
  const outPath = join(root, BRAIN_FILE);
  writeFileSync(outPath, content, 'utf-8');
  log.info('brain file written', { path: outPath, compact, words: content.split(/\s+/).length });
}

function formatFullBrain(s: BrainSnapshot): string {
  const health = s.healthScore !== undefined
    ? `${s.healthScore}/${s.healthGrade ?? '?'}`
    : 'unknown';

  const lines: string[] = [
    '---',
    'thesmos-brain: true',
    `generated: ${s.generatedAt}`,
    `health: ${health}`,
    '---',
    '',
    `# Thesmos Brain — ${s.projectName}`,
    '',
    `> Generated ${new Date(s.generatedAt).toLocaleDateString()}  ·  ${s.rulesActive} rules active`,
    '',
  ];

  if (s.detectedStack.length > 0) {
    lines.push('## Stack');
    lines.push(s.detectedStack.join(', '));
    lines.push('');
  }

  if (s.activeSuppressions.length > 0) {
    lines.push('## Active Suppressions (intentional)');
    for (const sup of s.activeSuppressions) {
      lines.push(`- **${sup.ruleId}** on \`${sup.file}\` — ${sup.reason}`);
    }
    lines.push('');
  }

  if (s.knownFalsePositives.length > 0) {
    lines.push('## Known False Positives');
    for (const fp of s.knownFalsePositives) {
      lines.push(`- **${fp.ruleId}** — ${fp.evidence}`);
    }
    lines.push('');
  }

  if (s.frequentFindings.length > 0) {
    lines.push('## Frequent Findings (most common)');
    for (const f of s.frequentFindings.slice(0, 5)) {
      const files = f.files.length > 0 ? ` (${f.files[0]}…)` : '';
      lines.push(`- **${f.ruleId}** × ${f.count}${files}`);
    }
    lines.push('');
  }

  if (s.openInvestigations.length > 0) {
    lines.push('## Open Investigations (not yet fixed or suppressed)');
    for (const inv of s.openInvestigations) {
      lines.push(`- ${inv}`);
    }
    lines.push('');
  }

  if (s.architectureNotes.length > 0) {
    lines.push('## Architecture Notes');
    for (const note of s.architectureNotes) {
      lines.push(note);
    }
    lines.push('');
  }

  if (s.customRules.length > 0) {
    lines.push('## Custom Rules Active');
    for (const rule of s.customRules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  lines.push('## Quick Commands');
  lines.push('```');
  lines.push('thesmos scan              # Re-scan the repo');
  lines.push('thesmos self:check        # Check Thesmos health');
  lines.push('thesmos brain:snapshot    # Refresh this brain file');
  lines.push('thesmos explain <rule>    # Explain any finding');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function formatCompactBrain(s: BrainSnapshot): string {
  const health = s.healthScore !== undefined ? `${s.healthScore}/${s.healthGrade ?? '?'}` : '?';
  const lines: string[] = [
    '---',
    'thesmos-brain: true',
    `generated: ${s.generatedAt}`,
    '---',
    '',
    `**${s.projectName}** · health ${health} · ${s.rulesActive} rules · ${s.detectedStack.join(', ')}`,
    '',
  ];

  if (s.activeSuppressions.length > 0) {
    lines.push('**Suppressions:** ' + s.activeSuppressions.map((s) => `${s.ruleId}(${s.file})`).join(', '));
    lines.push('');
  }

  if (s.openInvestigations.length > 0) {
    lines.push('**Open:** ' + s.openInvestigations.join(' | '));
    lines.push('');
  }

  return lines.join('\n');
}

// ── CLAUDE.md integration ─────────────────────────────────────────────────────

export function injectBrainImportIntoCLAUDEMD(root: string): boolean {
  const claudePath = join(root, 'CLAUDE.md');
  if (!existsSync(claudePath)) return false;

  const content = readFileSync(claudePath, 'utf-8');
  if (content.includes('thesmos-brain-import')) return false; // already injected

  const injection = [
    '',
    '## Thesmos Governance Brain',
    '<!-- thesmos-brain-import -->',
    '@.thesmos/brain.md',
    '<!-- /thesmos-brain-import -->',
    '',
  ].join('\n');

  writeFileSync(claudePath, content + injection, 'utf-8');
  log.info('brain import injected into CLAUDE.md', { path: claudePath });
  return true;
}

// ── Stop hook installer ───────────────────────────────────────────────────────

export function installBrainStopHook(root: string): boolean {
  const settingsPath = join(root, '.claude', 'settings.json');
  const settingsDir = join(root, '.claude');

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // start fresh
    }
  } else {
    mkdirSync(settingsDir, { recursive: true });
  }

  const hookCmd = 'npx thesmos brain:compact 2>/dev/null || true';

  // Check if hook already installed
  const existing = settings['hooks'] as Record<string, unknown[]> | undefined;
  const stopHooks = (existing?.['Stop'] ?? []) as Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>;
  const alreadyInstalled = stopHooks.some((h) =>
    h.hooks?.some((hook) => hook.command === hookCmd),
  );
  if (alreadyInstalled) return false;

  // Add the Stop hook
  const newStopHook = {
    matcher: '',
    hooks: [{ type: 'command', command: hookCmd }],
  };

  settings['hooks'] = {
    ...(existing ?? {}),
    Stop: [...stopHooks, newStopHook],
  };

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  log.info('brain Stop hook installed', { path: settingsPath });
  return true;
}
