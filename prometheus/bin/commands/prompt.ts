/**
 * prometheus prompt:list / prompt:run / prompt:show / prompt:import / prompt:suggest
 *
 * Manages the built-in and user prompt template library.
 *
 * Usage:
 *   prometheus prompt:list                      # List all templates
 *   prometheus prompt:list --category=security  # Filter by category
 *   prometheus prompt:run <id>                  # Interpolate + print
 *   prometheus prompt:show <id>                 # Print raw template
 *   prometheus prompt:suggest                   # Show triggered prompts
 *   prometheus prompt:import <file>             # Import from HTML/Markdown
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { makeLogger } from '../../logger.js';
import {
  loadAllTemplates,
  interpolate,
  suggestTemplates,
  importFromHtml,
  type PromptTemplate,
  type PromptVariables,
} from '../../prompt-engine.js';

const log = makeLogger('prompt');

// ── Variable builder ──────────────────────────────────────────────────────────

function buildVariables(root: string): PromptVariables {
  const vars: PromptVariables = {};

  // Load from package.json
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string; version?: string };
      vars.repoName = pkg.name ?? 'Unknown Project';
    } catch {
      vars.repoName = 'Unknown Project';
    }
  }

  // Load from brain.json if present
  const brainPath = join(root, '.prometheus', 'brain.json');
  if (existsSync(brainPath)) {
    try {
      const brain = JSON.parse(readFileSync(brainPath, 'utf-8')) as {
        detectedStack?: string[];
        suppressions?: Record<string, { reasons?: string[]; files?: string[] }>;
      };
      vars.detectedStack = brain.detectedStack ?? [];
      vars.activeSuppressions = Object.entries(brain.suppressions ?? {}).map(([ruleId, s]) => ({
        ruleId,
        reason: (s.reasons ?? []).join('; ') || 'no reason given',
        file: (s.files ?? [])[0] ?? 'unknown',
      }));
    } catch {
      // ignore
    }
  }

  // Load from report.json for health score and findings
  const reportPath = join(root, '.prometheus', 'report.json');
  if (existsSync(reportPath)) {
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
        healthScore?: number;
        grade?: string;
        findings?: Array<{ rule?: string; file?: string; line?: number; severity?: string; message?: string; suggestion?: string }>;
        generatedAt?: string;
      };
      vars.healthScore = report.healthScore;
      vars.healthGrade = report.grade;
      vars.lastScanDate = report.generatedAt;

      const findings = report.findings ?? [];
      vars.allFindings = findings.map((f) => ({
        rule: f.rule ?? '',
        file: f.file ?? '',
        severity: f.severity ?? '',
        message: f.message ?? '',
      }));
      vars.blockerFindings = findings
        .filter((f) => f.severity === 'BLOCKER')
        .map((f) => ({
          rule: f.rule ?? '',
          file: f.file ?? '',
          line: f.line,
          message: f.message ?? '',
          suggestion: f.suggestion,
        }));
      vars.highFindings = findings
        .filter((f) => f.severity === 'HIGH')
        .map((f) => ({
          rule: f.rule ?? '',
          file: f.file ?? '',
          line: f.line,
          message: f.message ?? '',
        }));
      vars.blockerCount = vars.blockerFindings.length;
      vars.highCount = vars.highFindings.length;
    } catch {
      // ignore
    }
  }

  // Defaults
  vars.blockerCount = vars.blockerCount ?? 0;
  vars.highCount = vars.highCount ?? 0;
  vars.detectedStack = vars.detectedStack ?? [];
  vars.activeSuppressions = vars.activeSuppressions ?? [];
  vars.rulesVersion = 'prometheus-governance@2.4.0';

  return vars;
}

// ── prompt:list ───────────────────────────────────────────────────────────────

async function runPromptList(argv: string[]): Promise<void> {
  const root = process.cwd();
  const categoryFilter = argv.find((a) => a.startsWith('--category='))?.split('=')[1];
  const sourceFilter = argv.find((a) => a.startsWith('--source='))?.split('=')[1];

  const templates = loadAllTemplates(root);

  let filtered = templates;
  if (categoryFilter) {
    filtered = filtered.filter((t) => t.category === categoryFilter);
  }
  if (sourceFilter === 'imported') {
    filtered = filtered.filter((t) => t.filePath?.includes('imported'));
  } else if (sourceFilter === 'builtin') {
    filtered = filtered.filter((t) => t.source === 'builtin');
  } else if (sourceFilter === 'user') {
    filtered = filtered.filter((t) => t.source === 'user');
  }

  if (filtered.length === 0) {
    console.log('\n  No prompt templates found.\n');
    if (templates.length === 0) {
      console.log('  Install prompts: prometheus prompt:import <file>\n');
    }
    return;
  }

  // Group by category
  const byCategory: Record<string, PromptTemplate[]> = {};
  for (const t of filtered) {
    (byCategory[t.category] ??= []).push(t);
  }

  console.log(`\n  Prometheus Prompt Library (${filtered.length} templates)\n`);
  for (const [cat, prompts] of Object.entries(byCategory)) {
    console.log(`  ── ${cat} ──`);
    for (const t of prompts) {
      const trigger = t.trigger ? ` [auto: ${t.trigger.condition}]` : '';
      const source = t.source === 'user' ? ' (user)' : '';
      console.log(`  ${t.id.padEnd(32)} ${t.name}${trigger}${source}`);
      if (t.description) {
        console.log(`  ${''.padEnd(32)} ${t.description}`);
      }
    }
    console.log('');
  }

  console.log('  Run: prometheus prompt:run <id>\n');
}

// ── prompt:show ───────────────────────────────────────────────────────────────

async function runPromptShow(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) {
    console.error('  Usage: prometheus prompt:show <id>');
    process.exitCode = 1;
    return;
  }

  const root = process.cwd();
  const templates = loadAllTemplates(root);
  const template = templates.find((t) => t.id === id);

  if (!template) {
    console.error(`  Unknown prompt: ${id}`);
    console.error('  Run: prometheus prompt:list');
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ── ${template.name} (${template.id}) ──\n`);
  if (template.filePath) {
    console.log(readFileSync(template.filePath, 'utf-8'));
  } else {
    console.log(template.body);
  }
}

// ── prompt:run ────────────────────────────────────────────────────────────────

async function runPromptRun(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) {
    console.error('  Usage: prometheus prompt:run <id>');
    process.exitCode = 1;
    return;
  }

  const root = process.cwd();
  const templates = loadAllTemplates(root);
  const template = templates.find((t) => t.id === id);

  if (!template) {
    console.error(`  Unknown prompt: ${id}`);
    console.error('  Run: prometheus prompt:list');
    process.exitCode = 1;
    return;
  }

  const vars = buildVariables(root);
  const interpolated = interpolate(template.body, vars);

  console.log(`\n  ── ${template.name} ──\n`);
  console.log(interpolated);

  log.info('prompt:run', { id });
}

// ── prompt:suggest ────────────────────────────────────────────────────────────

async function runPromptSuggest(): Promise<void> {
  const root = process.cwd();
  const templates = loadAllTemplates(root);
  const vars = buildVariables(root);
  const suggestions = suggestTemplates(templates, vars);

  if (suggestions.length === 0) {
    console.log('\n  No prompts match the current repo state.\n');
    console.log('  Run: prometheus prompt:list (to see all available prompts)\n');
    return;
  }

  console.log('\n  Suggested prompts for current repo state:\n');
  for (const t of suggestions) {
    const icon = t.category === 'security' ? '🔴' : t.category === 'health' ? '🟡' : '📋';
    console.log(`  ${icon}  ${t.id.padEnd(32)} ${t.name}`);
    console.log(`     → ${t.description}`);
    console.log(`     run: prometheus prompt:run ${t.id}`);
    console.log('');
  }
}

// ── prompt:import ─────────────────────────────────────────────────────────────

async function runPromptImport(argv: string[]): Promise<void> {
  const filePath = argv[0];
  if (!filePath) {
    console.error('  Usage: prometheus prompt:import <file>');
    console.error('  Supported: .html, .md, .json');
    process.exitCode = 1;
    return;
  }

  const absPath = filePath.startsWith('/') ? filePath : join(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    console.error(`  File not found: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const content = readFileSync(absPath, 'utf-8');
  const outDir = join(process.cwd(), '.prometheus', 'prompts', 'imported');

  console.log(`\n  Importing prompts from ${filePath}...\n`);

  let count = 0;

  if (ext === '.html' || ext === '.htm') {
    count = importFromHtml(content, outDir);
  } else if (ext === '.md') {
    // Import as a single template
    mkdirSync(outDir, { recursive: true });
    const name = filePath.replace(/.*\//, '').replace(/\.md$/, '');
    const outFile = join(outDir, name + '.md');
    writeFileSync(outFile, content, 'utf-8');
    count = 1;
  } else {
    console.error(`  Unsupported file type: ${ext} (use .html or .md)`);
    process.exitCode = 1;
    return;
  }

  if (count > 0) {
    console.log(`  ✅ Imported ${count} prompt template${count === 1 ? '' : 's'}`);
    console.log(`     Saved to: ${outDir}`);
    console.log(`     View: prometheus prompt:list --source=imported\n`);
  } else {
    console.log('  No prompt templates found in the file.');
    console.log('  HTML files need <section class="prompt">, <article class="prompt">, or <h2>+<p> structure.\n');
  }

  log.info('prompt:import complete', { file: filePath, count });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdPrompt(argv: string[]): Promise<void> {
  const subcommand = argv[0];

  switch (subcommand) {
    case 'list':
      return runPromptList(argv.slice(1));

    case 'show':
      return runPromptShow(argv.slice(1));

    case 'run':
      return runPromptRun(argv.slice(1));

    case 'suggest':
      return runPromptSuggest();

    case 'import':
      return runPromptImport(argv.slice(1));

    default:
      if (!subcommand) {
        return runPromptList([]);
      }
      console.error(`  Unknown prompt subcommand: ${subcommand}`);
      console.error('  Usage: prometheus prompt:list | prompt:run <id> | prompt:show <id>');
      console.error('         prometheus prompt:suggest | prompt:import <file>');
      process.exitCode = 1;
  }
}
