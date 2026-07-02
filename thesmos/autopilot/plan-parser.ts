// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Parses a MASTER_PLAN.md file into a structured AutopilotPlan.
 *
 * Plan format:
 *   --- (YAML frontmatter: project, adapter, gates, commit_on_pass, max_retries)
 *   ## Task N: Title
 *   Context: ...
 *   Scope: src/path/
 *   New packages allowed: pkg@version, pkg2
 *   Depends on: 1, 2
 *   Done when:
 *     - file:src/path/file.ts
 *     - command:npm test -- src/path
 *     - grep:src/file.ts:pattern
 *     - no-grep:src/file.ts:pattern
 *   ---CHECKPOINT---
 */
import { readFileSync, existsSync } from 'node:fs';
import type {
  AutopilotPlan,
  AutopilotTask,
  DoneCriterion,
  ParseIssue,
  PlanParseResult,
} from '../types.js';

const VALID_ADAPTERS = ['claude', 'openai', 'gemini', 'http'] as const;
const CHECKPOINT_MARKER = '---CHECKPOINT---';

// ── Frontmatter parser (no external deps) ────────────────────────────────────

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, unknown> = {};
  let currentListKey: string | null = null;

  for (const line of match[1].split('\n')) {
    const keyVal = /^([\w_]+):\s*(.*)$/.exec(line);
    if (keyVal) {
      const [, key, val] = keyVal;
      const trimmed = val.trim();
      if (trimmed === '') {
        meta[key] = [];
        currentListKey = key;
      } else if (trimmed === 'true') {
        meta[key] = true;
        currentListKey = null;
      } else if (trimmed === 'false') {
        meta[key] = false;
        currentListKey = null;
      } else if (/^\d+$/.test(trimmed)) {
        meta[key] = parseInt(trimmed, 10);
        currentListKey = null;
      } else {
        meta[key] = trimmed;
        currentListKey = null;
      }
    } else if (line.startsWith('  - ') && currentListKey && Array.isArray(meta[currentListKey])) {
      (meta[currentListKey] as string[]).push(line.slice(4).trim());
    }
  }

  return { meta, body: match[2] };
}

// ── Done-criterion parser ─────────────────────────────────────────────────────

export function parseDoneCriterion(raw: string): DoneCriterion | null {
  const t = raw.trim();
  if (t.startsWith('file:')) return { type: 'file_exists', value: t.slice(5).trim(), raw: t };
  if (t.startsWith('command:')) return { type: 'command_passes', value: t.slice(8).trim(), raw: t };
  if (t.startsWith('grep:')) return { type: 'grep_matches', value: t.slice(5).trim(), raw: t };
  if (t.startsWith('no-grep:')) return { type: 'grep_not_matches', value: t.slice(8).trim(), raw: t };
  return null;
}

export function isVerifiableCriterion(raw: string): boolean {
  return parseDoneCriterion(raw) !== null;
}

// ── Task block parser ─────────────────────────────────────────────────────────

function parseTaskBlock(block: string, index: number): AutopilotTask | null {
  const lines = block.split('\n');
  if (!lines[0]?.startsWith('## ')) return null;

  const title = lines[0].slice(3).trim();
  let context: string | undefined;
  const scopeParts: string[] = [];
  const allowedPackages: string[] = [];
  const dependsOn: number[] = [];
  const doneCriteria: DoneCriterion[] = [];

  type Section = 'none' | 'context' | 'done';
  let section: Section = 'none';

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.trimStart().toLowerCase();

    if (/^context:\s*/i.test(line)) {
      section = 'context';
      const inline = line.replace(/^context:\s*/i, '').trim();
      if (inline) context = inline;
      continue;
    }
    if (/^scope:\s*/i.test(line)) {
      section = 'none';
      const val = line.replace(/^scope:\s*/i, '').trim();
      scopeParts.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (/^new packages allowed:\s*/i.test(line)) {
      section = 'none';
      const val = line.replace(/^new packages allowed:\s*/i, '').trim();
      allowedPackages.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (/^depends on:\s*/i.test(line)) {
      section = 'none';
      const val = line.replace(/^depends on:\s*/i, '').trim();
      if (val && val.toLowerCase() !== 'none') {
        for (const part of val.split(',')) {
          const n = parseInt(part.trim(), 10);
          if (!isNaN(n)) dependsOn.push(n);
        }
      }
      continue;
    }
    if (/^done when:\s*$/i.test(line.trim())) {
      section = 'done';
      continue;
    }

    if (section === 'done' && line.startsWith('  - ')) {
      const criterion = parseDoneCriterion(line.slice(4));
      if (criterion) doneCriteria.push(criterion);
      continue;
    }

    // Continuation of context paragraph (indented or blank)
    if (section === 'context' && !lower.match(/^\w[\w ]*:/)) {
      if (line.trim()) context = ((context ?? '') + ' ' + line.trim()).trim();
    }

    // Any top-level field header breaks context section
    if (line.match(/^\w/) && line.includes(':') && !line.startsWith('  ')) {
      if (section === 'context') section = 'none';
    }
  }

  return {
    index,
    title,
    context: context || undefined,
    scope: scopeParts.length > 0 ? scopeParts : undefined,
    allowedPackages: allowedPackages.length > 0 ? allowedPackages : undefined,
    dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    doneCriteria,
    isCheckpoint: false,
  };
}

// ── Cross-task analysis ───────────────────────────────────────────────────────

function detectScopeOverlap(tasks: AutopilotTask[]): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const scopeMap = new Map<string, number[]>();

  for (const task of tasks.filter((t) => !t.isCheckpoint && t.scope)) {
    for (const s of task.scope!) {
      const existing = scopeMap.get(s) ?? [];
      existing.push(task.index + 1);
      scopeMap.set(s, existing);
    }
  }

  const realTasks = tasks.filter((t) => !t.isCheckpoint);
  for (const [scope, taskNums] of scopeMap) {
    if (taskNums.length > 1) {
      // Only warn if the overlap isn't covered by an explicit Depends on
      const uncovered = taskNums.filter((num, i) => {
        if (i === 0) return false;
        const task = realTasks.find((t) => t.index + 1 === num);
        const earlier = taskNums.slice(0, i);
        const covered = task?.dependsOn?.some((d) => earlier.includes(d)) ?? false;
        return !covered;
      });
      if (uncovered.length > 0) {
        issues.push({
          type: 'warning',
          message: `Tasks ${taskNums.join(' and ')} share scope "${scope}". If later tasks build on earlier ones, add "Depends on" to enforce ordering. Otherwise they may produce conflicting changes.`,
          field: 'scope_overlap',
        });
      }
    }
  }

  return issues;
}

function validateDependencyOrdering(tasks: AutopilotTask[]): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const realTasks = tasks.filter((t) => !t.isCheckpoint);
  const validTaskNums = new Set(realTasks.map((t) => t.index + 1));

  for (const task of realTasks) {
    if (!task.dependsOn || task.dependsOn.length === 0) continue;
    const taskNum = task.index + 1;

    for (const dep of task.dependsOn) {
      if (!validTaskNums.has(dep)) {
        issues.push({
          type: 'error',
          message: `Task ${taskNum} "${task.title}" depends on Task ${dep} which does not exist in this plan.`,
          field: `task.${task.index}.dependsOn`,
        });
        continue;
      }
      if (dep >= taskNum) {
        issues.push({
          type: 'error',
          message: `Task ${taskNum} "${task.title}" depends on Task ${dep}, but Task ${dep} comes after it. Dependencies must be earlier tasks.`,
          field: `task.${task.index}.dependsOn`,
        });
      }
      if (dep === taskNum) {
        issues.push({
          type: 'error',
          message: `Task ${taskNum} "${task.title}" depends on itself.`,
          field: `task.${task.index}.dependsOn`,
        });
      }
    }
  }

  return issues;
}

function detectCircularDependencies(tasks: AutopilotTask[]): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const realTasks = tasks.filter((t) => !t.isCheckpoint);
  const depMap = new Map<number, number[]>();

  for (const t of realTasks) depMap.set(t.index + 1, t.dependsOn ?? []);

  function hasCycle(start: number, current: number, seen: Set<number>): boolean {
    for (const dep of depMap.get(current) ?? []) {
      if (dep === start) return true;
      if (!seen.has(dep)) {
        seen.add(dep);
        if (hasCycle(start, dep, seen)) return true;
      }
    }
    return false;
  }

  const reported = new Set<string>();
  for (const taskNum of depMap.keys()) {
    if (hasCycle(taskNum, taskNum, new Set())) {
      const key = String(taskNum);
      if (!reported.has(key)) {
        reported.add(key);
        issues.push({
          type: 'error',
          message: `Circular dependency detected involving Task ${taskNum}. Check "Depends on" fields for cycles.`,
          field: `task.${taskNum - 1}.dependsOn`,
        });
      }
    }
  }

  return issues;
}

function detectImpliedDependencies(tasks: AutopilotTask[]): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const realTasks = tasks.filter((t) => !t.isCheckpoint && t.scope && t.scope.length > 0);

  for (let i = 1; i < realTasks.length; i++) {
    const later = realTasks[i]!;
    for (let j = 0; j < i; j++) {
      const earlier = realTasks[j]!;

      const overlaps = later.scope!.some((ls) =>
        earlier.scope!.some((es) => ls.startsWith(es) || es.startsWith(ls) || ls === es),
      );

      if (!overlaps) continue;

      const declared = later.dependsOn?.includes(earlier.index + 1) ?? false;
      if (!declared) {
        issues.push({
          type: 'warning',
          message: `Task ${later.index + 1} "${later.title}" has scope that overlaps with Task ${earlier.index + 1} "${earlier.title}" but does not declare "Depends on: ${earlier.index + 1}". If Task ${later.index + 1} builds on Task ${earlier.index + 1}'s output, add this dependency.`,
          field: `task.${later.index}.dependsOn`,
        });
      }
    }
  }

  return issues;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parsePlan(content: string): PlanParseResult {
  const issues: ParseIssue[] = [];
  const { meta, body } = parseFrontmatter(content);

  // Validate adapter
  const rawAdapter = (meta['adapter'] as string | undefined) ?? 'claude';
  if (!VALID_ADAPTERS.includes(rawAdapter as (typeof VALID_ADAPTERS)[number])) {
    issues.push({
      type: 'error',
      message: `Unknown adapter "${rawAdapter}". Must be one of: ${VALID_ADAPTERS.join(', ')}`,
      field: 'adapter',
    });
  }
  const adapter = VALID_ADAPTERS.includes(rawAdapter as (typeof VALID_ADAPTERS)[number])
    ? (rawAdapter as AutopilotPlan['adapter'])
    : 'claude';

  // Gates
  const gates = Array.isArray(meta['gates'])
    ? (meta['gates'] as string[])
    : ['npm test'];
  if (gates.length === 0) {
    issues.push({ type: 'warning', message: 'No gates defined. At least "npm test" is recommended.', field: 'gates' });
  }

  const maxRetries = typeof meta['max_retries'] === 'number' ? meta['max_retries'] : 2;
  const commitOnPass = meta['commit_on_pass'] !== false;

  // Split body on task headings and checkpoint markers
  const segments = body.split(/(?=^## |\n---CHECKPOINT---)/m).map((s) => s.trim()).filter(Boolean);

  const tasks: AutopilotTask[] = [];
  let taskIndex = 0;

  for (const seg of segments) {
    if (seg === CHECKPOINT_MARKER || seg.endsWith(CHECKPOINT_MARKER)) {
      tasks.push({ index: taskIndex++, title: 'CHECKPOINT', doneCriteria: [], isCheckpoint: true });
      continue;
    }

    if (!seg.startsWith('## ')) continue;

    const task = parseTaskBlock(seg, taskIndex++);
    if (!task) continue;

    // Validate each task
    if (!task.scope || task.scope.length === 0) {
      issues.push({
        type: 'error',
        message: `Task ${task.index + 1} "${task.title}" has no Scope defined. Add: Scope: src/your-path/`,
        field: `task.${task.index}.scope`,
      });
    }

    if (task.doneCriteria.length === 0) {
      issues.push({
        type: 'error',
        message: `Task ${task.index + 1} "${task.title}" has no Done criteria. Add verifiable criteria:\n  Done when:\n    - file:src/path/file.ts\n    - command:npm test`,
        field: `task.${task.index}.doneCriteria`,
      });
    }

    tasks.push(task);
  }

  if (tasks.filter((t) => !t.isCheckpoint).length === 0) {
    issues.push({ type: 'error', message: 'No tasks found. Add task sections starting with "## Task N: Title"', field: 'tasks' });
  }

  // Cross-task checks
  issues.push(...validateDependencyOrdering(tasks));
  issues.push(...detectCircularDependencies(tasks));
  issues.push(...detectScopeOverlap(tasks));
  issues.push(...detectImpliedDependencies(tasks));

  const hasErrors = issues.some((i) => i.type === 'error');

  return {
    plan: hasErrors
      ? null
      : {
          project: (meta['project'] as string | undefined) ?? 'Project',
          adapter,
          gates,
          commitOnPass,
          maxRetries,
          branchPrefix: meta['branch'] as string | undefined,
          tasks,
          rawContent: content,
        },
    issues,
  };
}

export function parsePlanFile(filePath: string): PlanParseResult {
  if (!existsSync(filePath)) {
    return { plan: null, issues: [{ type: 'error', message: `Plan file not found: ${filePath}` }] };
  }
  try {
    return parsePlan(readFileSync(filePath, 'utf8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { plan: null, issues: [{ type: 'error', message: `Could not read plan file: ${msg}` }] };
  }
}

export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
