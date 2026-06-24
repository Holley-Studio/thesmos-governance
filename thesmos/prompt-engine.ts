/**
 * Thesmos Prompt Engine — template interpolation and trigger evaluation.
 *
 * Manages a catalog of prompt templates (built-in + user-loaded).
 * Each template is a YAML frontmatter + Markdown body with {{variable}} interpolation.
 *
 * Zero-dependency: all interpolation done with regex replace.
 * Templates stored in: thesmos/prompts/ (built-ins) + .thesmos/prompts/ (user)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogger } from './logger.js';

const log = makeLogger('prompt-engine');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PromptTrigger {
  condition: string;   // e.g. "blockers > 0", "manual"
  auto: 'suggest' | 'run';
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  trigger?: PromptTrigger;
  variables?: string[];
  body: string;
  source: 'builtin' | 'user';
  filePath?: string;
}

export interface PromptVariables {
  repoName?: string;
  healthScore?: number;
  healthGrade?: string;
  blockerCount?: number;
  highCount?: number;
  blockerFindings?: Array<{ rule: string; file: string; line?: number; message: string; suggestion?: string }>;
  highFindings?: Array<{ rule: string; file: string; line?: number; message: string }>;
  allFindings?: Array<{ rule: string; file: string; severity: string; message: string }>;
  detectedStack?: string[];
  activeSuppressions?: Array<{ ruleId: string; reason: string; file: string }>;
  lastScanDate?: string;
  rulesVersion?: string;
  [key: string]: unknown;
}

// ── YAML frontmatter parser (zero-dependency) ─────────────────────────────────

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  if (!content.startsWith('---')) return { meta: {}, body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: content };

  const yamlBlock = content.slice(4, end);
  const body = content.slice(end + 4).trimStart();

  const meta: Record<string, unknown> = {};
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    // Simple value parsing: arrays (comma-separated or yaml list), numbers, strings
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/['"]/g, ''));
    } else if (/^\d+$/.test(val)) {
      meta[key] = parseInt(val, 10);
    } else {
      meta[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }

  // Handle multi-line list values for tags
  const tagsMatch = /^tags:\s*\n((?:\s+-\s+.+\n?)+)/m.exec(yamlBlock);
  if (tagsMatch) {
    meta['tags'] = tagsMatch[1]!.split('\n')
      .filter((l) => /\s+-\s+/.test(l))
      .map((l) => l.replace(/\s+-\s+/, '').trim());
  }

  return { meta, body };
}

// ── Template file parser ──────────────────────────────────────────────────────

function parseTemplateFile(filePath: string, source: 'builtin' | 'user'): PromptTemplate | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(content);

    const id = (meta['id'] as string) ?? filePath.replace(/.*\//, '').replace(/\.md$/, '');
    if (!id) return null;

    const trigger = meta['trigger'] as { condition?: string; auto?: 'suggest' | 'run' } | undefined;

    return {
      id,
      name: (meta['name'] as string) ?? id,
      description: (meta['description'] as string) ?? '',
      category: (meta['category'] as string) ?? 'general',
      tags: (meta['tags'] as string[]) ?? [],
      trigger: trigger ? {
        condition: trigger.condition ?? 'manual',
        auto: trigger.auto ?? 'suggest',
      } : undefined,
      variables: (meta['variables'] as string[]) ?? [],
      body,
      source,
      filePath,
    };
  } catch (e) {
    log.warn('prompt template parse failed', { file: filePath, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

// ── Catalog loader ────────────────────────────────────────────────────────────

function loadTemplatesFromDir(dir: string, source: 'builtin' | 'user'): PromptTemplate[] {
  if (!existsSync(dir)) return [];
  const templates: PromptTemplate[] = [];
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const template = parseTemplateFile(join(dir, file), source);
      if (template) templates.push(template);
    }
  } catch {
    // ignore directory errors
  }
  return templates;
}

export function loadAllTemplates(root: string): PromptTemplate[] {
  // Built-in catalog: relative to this file
  const builtinDir = join(dirname(fileURLToPath(import.meta.url)), 'prompts');
  const builtins = loadTemplatesFromDir(builtinDir, 'builtin');

  // User catalog: .thesmos/prompts/
  const userDir = join(root, '.thesmos', 'prompts');
  const userTemplates = loadTemplatesFromDir(userDir, 'user');

  // User-imported catalog: .thesmos/prompts/imported/
  const importedDir = join(root, '.thesmos', 'prompts', 'imported');
  const imported = loadTemplatesFromDir(importedDir, 'user');

  return [...builtins, ...userTemplates, ...imported];
}

// ── Interpolation ─────────────────────────────────────────────────────────────

export function interpolate(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key as string];
    if (val === undefined || val === null) return `{{${key}}}`;
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  });
}

// ── Trigger evaluation ────────────────────────────────────────────────────────

export function evaluateTrigger(trigger: PromptTrigger, vars: PromptVariables): boolean {
  const condition = trigger.condition;
  if (!condition || condition === 'manual') return false;

  // Simple expression evaluation for common patterns
  const simpleMatch = /^(\w+)\s*(>|<|>=|<=|==|!=)\s*(\d+)$/.exec(condition);
  if (simpleMatch) {
    const [, varName, op, rhs] = simpleMatch;
    const lhs = vars[varName!];
    const numLhs = typeof lhs === 'number' ? lhs : (Array.isArray(lhs) ? lhs.length : 0);
    const numRhs = parseInt(rhs!, 10);
    switch (op) {
      case '>': return numLhs > numRhs;
      case '<': return numLhs < numRhs;
      case '>=': return numLhs >= numRhs;
      case '<=': return numLhs <= numRhs;
      case '==': return numLhs === numRhs;
      case '!=': return numLhs !== numRhs;
    }
  }

  return false;
}

// ── Suggest matching templates ────────────────────────────────────────────────

export function suggestTemplates(templates: PromptTemplate[], vars: PromptVariables): PromptTemplate[] {
  return templates.filter((t) =>
    t.trigger &&
    t.trigger.condition !== 'manual' &&
    evaluateTrigger(t.trigger, vars),
  );
}

// ── Import from HTML ──────────────────────────────────────────────────────────

export function importFromHtml(htmlContent: string, outDir: string): number {
  mkdirSync(outDir, { recursive: true });
  let count = 0;

  // Extract prompt blocks from HTML — look for <section>, <article>, <div class="prompt"> patterns
  const SECTION_RE = /<(?:section|article|div)[^>]*class="[^"]*prompt[^"]*"[^>]*>([\s\S]*?)<\/(?:section|article|div)>/gi;
  const H2_RE = /<h[23][^>]*>([^<]+)<\/h[23]>/i;
  const P_RE = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const STRIP_TAGS_RE = /<[^>]+>/g;

  let sectionMatch;
  let sectionIdx = 0;
  while ((sectionMatch = SECTION_RE.exec(htmlContent)) !== null) {
    const sectionHtml = sectionMatch[1] ?? '';
    const titleMatch = H2_RE.exec(sectionHtml);
    const title = titleMatch
      ? titleMatch[1]!.replace(STRIP_TAGS_RE, '').trim()
      : `Imported Prompt ${sectionIdx + 1}`;

    const id = `imported-${sectionIdx + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
    const paragraphs: string[] = [];
    let pMatch;
    while ((pMatch = P_RE.exec(sectionHtml)) !== null) {
      const text = (pMatch[1] ?? '').replace(STRIP_TAGS_RE, '').trim();
      if (text) paragraphs.push(text);
    }

    if (paragraphs.length === 0) { sectionIdx++; continue; }

    const template = [
      '---',
      `id: ${id}`,
      `name: ${title}`,
      `description: Imported from HTML document`,
      `category: imported`,
      `tags: [imported]`,
      '---',
      '',
      ...paragraphs,
    ].join('\n');

    writeFileSync(join(outDir, `${id}.md`), template, 'utf-8');
    count++;
    sectionIdx++;
  }

  // If no sections found, try extracting h2+p pairs from the full document
  if (count === 0) {
    const H2_GLOBAL_RE = /<h2[^>]*>([^<]+)<\/h2>\s*([\s\S]*?)(?=<h2|$)/gi;
    let h2Match;
    let idx = 0;
    while ((h2Match = H2_GLOBAL_RE.exec(htmlContent)) !== null) {
      const title = (h2Match[1] ?? '').replace(STRIP_TAGS_RE, '').trim();
      const content = (h2Match[2] ?? '').replace(STRIP_TAGS_RE, '').replace(/\s+/g, ' ').trim();
      if (!content || content.length < 20) { idx++; continue; }

      const id = `imported-${idx + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
      const template = [
        '---',
        `id: ${id}`,
        `name: ${title}`,
        'description: Imported from HTML document',
        'category: imported',
        'tags: [imported]',
        '---',
        '',
        content,
      ].join('\n');

      writeFileSync(join(outDir, `${id}.md`), template, 'utf-8');
      count++;
      idx++;
    }
  }

  log.info('prompt:import complete', { count, outDir });
  return count;
}
