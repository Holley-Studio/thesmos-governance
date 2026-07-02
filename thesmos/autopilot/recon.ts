// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Reconnaissance phase — a read-only AI call that reads the codebase
 * before each task executes.
 *
 * A human developer reads existing code before writing new code.
 * This phase does the same: it asks the AI to examine the declared scope,
 * identify existing patterns, and plan its approach — WITHOUT modifying files.
 *
 * The reconnaissance report becomes part of the execution prompt so the AI
 * already knows what it's walking into before it touches anything.
 *
 * This is opt-in via autopilot.reconnaissance: true in config.
 * It doubles the LLM calls per task but significantly improves output quality.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AutopilotTask, AutopilotPlan } from '../types.js';
import type { Adapter, AdapterOptions } from './adapters.js';

// ── File discovery for scope ──────────────────────────────────────────────────

export interface ScopeFile {
  path: string;
  sizeBytes: number;
  isTest: boolean;
}

export function discoverScopeFiles(root: string, scopePaths: string[], maxFiles = 20): ScopeFile[] {
  const found: ScopeFile[] = [];

  for (const scopePath of scopePaths) {
    const abs = join(root, scopePath);
    if (!existsSync(abs)) continue;

    const stat = statSync(abs);
    if (stat.isFile()) {
      found.push({
        path: scopePath,
        sizeBytes: stat.size,
        isTest: /\.test\.|\.spec\./.test(scopePath),
      });
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(abs, root, found, maxFiles);
    }
  }

  return found.slice(0, maxFiles);
}

function walkDir(dir: string, root: string, out: ScopeFile[], max: number): void {
  if (out.length >= max) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= max) break;
    const abs = join(dir, entry);
    try {
      const s = statSync(abs);
      if (s.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
        walkDir(abs, root, out, max);
      } else if (s.isFile() && /\.(ts|tsx|js|jsx|py|go|rs|rb|java|php|css|scss|json|yaml|yml)$/.test(entry)) {
        out.push({
          path: relative(root, abs),
          sizeBytes: s.size,
          isTest: /\.test\.|\.spec\./.test(entry),
        });
      }
    } catch {
      // Skip unreadable entries
    }
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildReconPrompt(task: AutopilotTask, plan: AutopilotPlan, scopeFiles: ScopeFile[]): string {
  const fileList = scopeFiles.map((f) => `  ${f.path} (${Math.round(f.sizeBytes / 1024)}KB${f.isTest ? ', test' : ''})`).join('\n');

  return [
    `READ-ONLY RECONNAISSANCE — do NOT modify any files.`,
    ``,
    `You are preparing to execute a task. Your job right now is ONLY to read and report.`,
    `Do not write, edit, or create any files during this phase.`,
    ``,
    `UPCOMING TASK: ${task.title}`,
    task.context ? `Context: ${task.context}` : '',
    `Scope: ${task.scope?.join(', ') ?? 'unspecified'}`,
    ``,
    `FILES IN SCOPE:`,
    fileList || '  (no existing files in scope — this task creates them from scratch)',
    ``,
    `YOUR RECONNAISSANCE TASKS:`,
    `1. Read the files listed above (if they exist)`,
    `2. Read package.json to identify available libraries`,
    `3. Read 2–3 nearby files outside scope to understand existing patterns`,
    `4. Identify the naming conventions, error handling pattern, and testing approach in use`,
    ``,
    `OUTPUT FORMAT (use these exact headers):`,
    `PATTERNS FOUND:`,
    `[naming conventions, error handling, import style, test structure you observed]`,
    ``,
    `LIBRARIES AVAILABLE:`,
    `[relevant libraries from package.json you would use for this task]`,
    ``,
    `PLANNED APPROACH:`,
    `[your specific plan for implementing this task, given what you found]`,
    ``,
    `CONCERNS:`,
    `[any risks, conflicts with existing code, or ambiguities in the task scope]`,
    ``,
    `Do not output TASK COMPLETE. This is reconnaissance only.`,
    `Do not modify any files.`,
  ].filter(Boolean).join('\n');
}

// ── Parse reconnaissance output ───────────────────────────────────────────────

export interface ReconReport {
  patternsFound: string;
  librariesAvailable: string;
  plannedApproach: string;
  concerns: string;
  rawOutput: string;
  scopeFileCount: number;
}

export function parseReconOutput(rawOutput: string, scopeFileCount: number): ReconReport {
  function extract(header: string): string {
    const re = new RegExp(`${header}\\s*\\n([\\s\\S]*?)(?=\\n[A-Z ]+:|$)`, 'i');
    return re.exec(rawOutput)?.[1]?.trim() ?? '';
  }

  return {
    patternsFound: extract('PATTERNS FOUND:'),
    librariesAvailable: extract('LIBRARIES AVAILABLE:'),
    plannedApproach: extract('PLANNED APPROACH:'),
    concerns: extract('CONCERNS:'),
    rawOutput,
    scopeFileCount,
  };
}

// ── Format recon context for execution prompt ─────────────────────────────────

export function buildReconContext(report: ReconReport): string {
  const lines = [
    `RECONNAISSANCE REPORT (read-only analysis completed before this task):`,
  ];

  if (report.scopeFileCount === 0) {
    lines.push(`  Scope is empty — this task creates files from scratch.`);
  }

  if (report.patternsFound) {
    lines.push(`  Patterns observed:`);
    report.patternsFound.split('\n').forEach((l) => lines.push(`    ${l}`));
  }
  if (report.librariesAvailable) {
    lines.push(`  Libraries available for this task:`);
    report.librariesAvailable.split('\n').slice(0, 5).forEach((l) => lines.push(`    ${l}`));
  }
  if (report.plannedApproach) {
    lines.push(`  Your planned approach (from recon):`);
    report.plannedApproach.split('\n').forEach((l) => lines.push(`    ${l}`));
  }
  if (report.concerns) {
    lines.push(`  ⚠ Concerns identified during recon:`);
    report.concerns.split('\n').forEach((l) => lines.push(`    ${l}`));
  }

  return lines.join('\n');
}

// ── Main recon runner ─────────────────────────────────────────────────────────

export interface ReconOptions {
  timeoutMs: number;
  logPath: string;
  sessionId: string;
  taskIndex: number;
}

export async function runReconnaissance(
  root: string,
  task: AutopilotTask,
  plan: AutopilotPlan,
  adapter: Adapter,
  options: ReconOptions,
): Promise<ReconReport | null> {
  if (!task.scope || task.scope.length === 0) return null;

  const scopeFiles = discoverScopeFiles(root, task.scope);
  const prompt = buildReconPrompt(task, plan, scopeFiles);

  const result = await adapter.execute(prompt, {
    timeoutMs: options.timeoutMs,
    logPath: options.logPath,
    sessionId: options.sessionId,
    taskIndex: options.taskIndex,
  });

  if (!result.success && !result.timedOut) return null;

  // Read the output from the log file
  try {
    const { readFileSync, existsSync: fsExists } = await import('node:fs');
    if (!fsExists(options.logPath)) return null;
    const raw = readFileSync(options.logPath, 'utf8');
    return parseReconOutput(raw, scopeFiles.length);
  } catch {
    return null;
  }
}
