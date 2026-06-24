/**
 * Thesmos init — generates and updates the .thesmos/ folder contract.
 *
 * Design rules:
 * 1. Content inside PROMETHEUS:GENERATED markers is always overwritten.
 * 2. Content outside those markers is never touched.
 * 3. Running twice with the same inputs produces byte-for-byte identical output.
 * 4. New files are created with a manual skeleton + injected generated sections.
 * 5. config.json is never overwritten once created (user-editable).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ThesmosConfig, ScanResult } from './types';
import { PROMETHEUS_RULES, getRulesBySeverity, type Rule } from './adapters';
import { injectGeneratedSection } from './output';
import { SEVERITY_EMOJI } from './severity';

// ── Public types ──────────────────────────────────────────────────────────────

export interface InitFileResult {
  path: string;
  created: boolean;
  updated: boolean;
  skipped: boolean;
}

export interface InitOptions {
  /** When true, write nothing to disk — just return what would change. */
  dryRun?: boolean;
}

// ── Shared formatters (pure) ──────────────────────────────────────────────────

function rulesTable(rules: Rule[]): string {
  const header = '| ID | Category | Severity | Description |\n|---|---|---|---|\n';
  const rows = rules
    .map(
      (r) =>
        `| ${r.id} | \`${r.category}\` | ${SEVERITY_EMOJI[r.severity]} ${r.severity} | ${r.description} |`
    )
    .join('\n');
  return header + rows;
}

function detectorSummary(scan: ScanResult): string {
  const d = scan.detector;
  if (!d) return '_Detector data unavailable._';
  return [
    '| Field | Detected |',
    '|---|---|',
    `| Framework | \`${d.framework}\` |`,
    `| Auth | \`${d.auth}\` |`,
    `| Testing | \`${d.testingFramework}\` |`,
    `| Deployment | \`${d.deployment}\` |`,
    `| API convention | \`${d.apiConvention}\` |`,
  ].join('\n');
}

// ── Generated section builders (pure — no Date, no randomness) ───────────────

function genOverview(config: ThesmosConfig): string {
  return [
    `**Project:** ${config.project}  `,
    `**Thesmos:** v${config.version}`,
    '',
    'This `.thesmos/` folder is the governance contract for this repository.',
    'It is read by AI coding assistants, CI pipelines, and human reviewers.',
    '',
    '| Path | Purpose |',
    '|---|---|',
    '| `config.json` | Repo-specific overrides for Thesmos defaults |',
    '| `report.json` | Latest scan output (written by `thesmos scan`) |',
    '| `GUARDRAILS.md` | Active rules enforced during review |',
    '| `RULES.md` | Full rule reference with severity and examples |',
    '| `governance/` | Review process, severity model, AI agent instructions |',
    '| `architecture/` | Detected and documented project structure |',
    '| `playbooks/` | Step-by-step guides for common development tasks |',
  ].join('\n');
}

function genGuardrailsRules(_config: ThesmosConfig): string {
  const blockers = getRulesBySeverity(PROMETHEUS_RULES, 'BLOCKER');
  const highs = getRulesBySeverity(PROMETHEUS_RULES, 'HIGH');
  return [
    '### Active Rules',
    '',
    '**BLOCKER — CI will fail:**',
    '',
    blockers
      .map((r) => `- ${SEVERITY_EMOJI[r.severity]} **[${r.id}]** ${r.description}`)
      .join('\n'),
    '',
    '**HIGH — Must address before merge:**',
    '',
    highs
      .map((r) => `- ${SEVERITY_EMOJI[r.severity]} **[${r.id}]** ${r.description}`)
      .join('\n'),
  ].join('\n');
}

function genRulesReference(_config: ThesmosConfig): string {
  const blockers = getRulesBySeverity(PROMETHEUS_RULES, 'BLOCKER');
  const highs = getRulesBySeverity(PROMETHEUS_RULES, 'HIGH');
  const rest = PROMETHEUS_RULES.filter(
    (r) => r.severity !== 'BLOCKER' && r.severity !== 'HIGH'
  );

  function ruleBlock(r: Rule): string {
    const lines = [`**[${r.id}] \`${r.category}\`** — ${SEVERITY_EMOJI[r.severity]} ${r.severity}`, '', r.description];
    if (r.example) lines.push('', '```ts', r.example, '```');
    return lines.join('\n');
  }

  return [
    '## All Rules',
    '',
    rulesTable(PROMETHEUS_RULES),
    '',
    '---',
    '',
    '## BLOCKER',
    '',
    blockers.map(ruleBlock).join('\n\n'),
    '',
    '## HIGH',
    '',
    highs.map(ruleBlock).join('\n\n'),
    '',
    '## MEDIUM / LOW / TECH_DEBT',
    '',
    rest.map(ruleBlock).join('\n\n'),
  ].join('\n');
}

function genCodeReviewChecklist(_config: ThesmosConfig): string {
  const blockers = getRulesBySeverity(PROMETHEUS_RULES, 'BLOCKER');
  const highs = getRulesBySeverity(PROMETHEUS_RULES, 'HIGH');
  const rest = PROMETHEUS_RULES.filter(
    (r) => r.severity !== 'BLOCKER' && r.severity !== 'HIGH'
  );
  return [
    '### Automated Checks',
    '',
    '> These are enforced by `thesmos validate` in CI.',
    '',
    '**BLOCKER — must pass:**',
    '',
    blockers.map((r) => `- [ ] ${SEVERITY_EMOJI[r.severity]} **[${r.id}]** ${r.description}`).join('\n'),
    '',
    '**HIGH — should pass:**',
    '',
    highs.map((r) => `- [ ] ${SEVERITY_EMOJI[r.severity]} **[${r.id}]** ${r.description}`).join('\n'),
    '',
    '**Advisory (MEDIUM / LOW / TECH_DEBT):**',
    '',
    rest.map((r) => `- [ ] ${SEVERITY_EMOJI[r.severity]} **[${r.id}]** ${r.description}`).join('\n'),
  ].join('\n');
}

function genReviewAgentInstructions(_config: ThesmosConfig): string {
  const blockers = getRulesBySeverity(PROMETHEUS_RULES, 'BLOCKER');
  const highs = getRulesBySeverity(PROMETHEUS_RULES, 'HIGH');
  return [
    '### Instructions',
    '',
    'When reviewing code in this repository:',
    '1. Check every BLOCKER rule first. Report violations before any other feedback.',
    '2. Flag all HIGH violations before marking a review complete.',
    '3. Include the rule ID (e.g. `[ENV_001]`) in every finding.',
    '',
    '**BLOCKER — report immediately:**',
    '',
    blockers.map((r) => `- **[${r.id}]** ${r.description}`).join('\n'),
    '',
    '**HIGH — flag before completing review:**',
    '',
    highs.map((r) => `- **[${r.id}]** ${r.description}`).join('\n'),
  ].join('\n');
}

function genSeverityTable(_config: ThesmosConfig): string {
  return [
    '### Severity Levels',
    '',
    '| Level | CI Effect | When to Use |',
    '|---|---|---|',
    '| 🔴 BLOCKER | `exit 1` | Security violations, data leaks, broken invariants |',
    '| 🟠 HIGH | Warning | Auth gaps, risky patterns, near-violations |',
    '| 🟡 MEDIUM | Advisory | Type safety, quality, maintainability |',
    '| 🔵 LOW | Advisory | Style, cleanup, minor issues |',
    '| ⚪ TECH_DEBT | Advisory | Complexity, large files, deferred work |',
    '',
    '### Rule Assignments',
    '',
    rulesTable(PROMETHEUS_RULES),
  ].join('\n');
}

function genDetectedStructure(_config: ThesmosConfig, scan?: ScanResult): string {
  if (!scan) {
    return '_Run `thesmos scan` to populate this section._';
  }
  const lines: string[] = [detectorSummary(scan), ''];
  lines.push(`**Components:** ${scan.componentCount}`);
  lines.push(`**Test files:** ${scan.testFiles.length}`);
  lines.push(`**Store files:** ${scan.storeFiles.length}`);
  if (scan.largeFiles.length > 0) {
    lines.push('', '**Large files (above threshold):**');
    for (const f of scan.largeFiles.slice(0, 10)) {
      lines.push(`- \`${f.file}\` — ${f.lines} lines`);
    }
  }
  return lines.join('\n');
}

function genDetectedRoutes(_config: ThesmosConfig, scan?: ScanResult): string {
  if (!scan?.pages?.length) {
    return '_Run `thesmos scan` to populate this section._';
  }
  return [
    '| Route | File |',
    '|---|---|',
    ...scan.pages.map((p) => `| \`${p.path}\` | \`${p.file}\` |`),
  ].join('\n');
}

function genDetectedComponents(_config: ThesmosConfig, scan?: ScanResult): string {
  if (!scan) return '_Run `thesmos scan` to populate this section._';
  const lines = [`**Total component files:** ${scan.componentCount}`];
  if (scan.storeFiles.length > 0) {
    lines.push('', '**Store/state files:**');
    for (const f of scan.storeFiles) lines.push(`- \`${f}\``);
  }
  return lines.join('\n');
}

function genDetectedApi(_config: ThesmosConfig, scan?: ScanResult): string {
  if (!scan?.apiRoutes?.length) {
    return '_Run `thesmos scan` to populate this section._';
  }
  return [
    '| Route | Methods | Auth | File |',
    '|---|---|---|---|',
    ...scan.apiRoutes.map(
      (r) =>
        `| \`${r.path}\` | ${r.methods.join(', ')} | ${r.auth ? '✅' : '❌'} | \`${r.file ?? ''}\` |`
    ),
  ].join('\n');
}

function genDetectedState(_config: ThesmosConfig, scan?: ScanResult): string {
  if (!scan?.storeFiles?.length) {
    return '_Run `thesmos scan` to populate this section._';
  }
  return ['**Store / state files:**', '', ...scan.storeFiles.map((f) => `- \`${f}\``)].join('\n');
}

function genPlaybookContext(config: ThesmosConfig, scan?: ScanResult): string {
  const fw = scan?.detector?.framework ?? 'unknown';
  const auth = scan?.detector?.auth ?? 'unknown';
  const testing = scan?.detector?.testingFramework ?? 'unknown';
  return [
    '| Field | Value |',
    '|---|---|',
    `| Project | ${config.project} |`,
    `| Framework | \`${fw}\` |`,
    `| Auth | \`${auth}\` |`,
    `| Testing | \`${testing}\` |`,
  ].join('\n');
}

// ── File template definitions ─────────────────────────────────────────────────

type SectionBuilder = (config: ThesmosConfig, scan?: ScanResult) => string;

interface MarkdownTemplate {
  path: string;
  sections: Record<string, SectionBuilder>;
  skeleton: (config: ThesmosConfig) => string;
}

interface JsonTemplate {
  path: string;
  content: (config: ThesmosConfig) => string;
  /** When true, an existing file is never overwritten. */
  preserveExisting: boolean;
}

// ── GitHub Actions workflow template (pure, no generated markers) ─────────────

function workflowYaml(config: ThesmosConfig): string {
  // Single-quoted strings used for lines with ${{ }} GH Actions expressions
  // to avoid TypeScript treating ${ as a template literal interpolation.
  return [
    '# Thesmos Code Review — GitHub Actions Workflow',
    '# Generated by thesmos init. Customize as needed.',
    '# Assumed package manager: npm. Adjust install/run commands for yarn / pnpm / bun.',
    '',
    'name: Thesmos Review',
    '',
    'on:',
    '  pull_request:',
    "    branches: ['**']",
    '',
    'jobs:',
    '  thesmos:',
    `    name: Thesmos — ${config.project}`,
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: read',
    '',
    '    steps:',
    '      - name: Checkout',
    '        uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '',
    '      - name: Setup Node.js',
    '        uses: actions/setup-node@v4',
    '        with:',
    "          node-version: '20'",
    "          cache: 'npm'",
    '',
    '      - name: Install dependencies',
    '        run: npm ci',
    '',
    '      - name: Thesmos — scan',
    '        run: npm run thesmos:scan',
    '',
    '      - name: Thesmos — ci-check (adapter freshness + required files)',
    '        run: npm run thesmos:ci-check',
    '',
    '      - name: Thesmos — review',
    '        run: npm run thesmos:review -- --markdown --base=origin/${{ github.base_ref }} > thesmos-review.md',
    '        continue-on-error: true',
    '',
    '      - name: Thesmos — validate (CI gate)',
    '        run: npm run thesmos:validate -- --base=origin/${{ github.base_ref }}',
    '',
    '      - name: Thesmos — doctor',
    '        if: always()',
    '        run: npm run thesmos:doctor -- --markdown >> thesmos-review.md',
    '        continue-on-error: true',
    '',
    '      - name: Upload Thesmos report',
    '        if: always()',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: thesmos-report',
    '          path: |',
    '            thesmos-review.md',
    '            .thesmos/report.json',
    '          if-no-files-found: ignore',
  ].join('\n') + '\n';
}

// ── Static file templates (JSON + YAML) ───────────────────────────────────────
// preserveExisting: true  → write once, never overwrite (user-customizable)
// preserveExisting: false → always overwrite on init

const JSON_TEMPLATES: JsonTemplate[] = [
  {
    path: '.thesmos/config.json',
    preserveExisting: true,
    content: (config) =>
      JSON.stringify(
        {
          name: config.name,
          version: config.version,
          project: config.project,
          ignoredFolders: config.ignoredFolders,
          largeFileThreshold: config.largeFileThreshold,
          criticalLibPaths: [],
          requiredFiles: config.requiredFiles,
          secretPatterns: [],
          failOnSeverity: config.failOnSeverity,
          warnOnSeverity: config.warnOnSeverity,
          severityRules: config.severityRules,
          reportMaxAgeDays: config.reportMaxAgeDays,
          protectedBranches: config.protectedBranches,
        },
        null,
        2
      ) + '\n',
  },
  {
    path: '.thesmos/report.json',
    preserveExisting: false,
    content: () =>
      JSON.stringify(
        {
          _generatedSections: [],
          _manualNote: 'Keys not in _generatedSections are manually curated. Do not overwrite.',
          generatedAt: null,
          scanVersion: null,
        },
        null,
        2
      ) + '\n',
  },
  {
    path: '.thesmos/registry.json',
    preserveExisting: true,
    content: () =>
      JSON.stringify(
        {
          rules: ['@thesmos/core'],
          agents: [],
          skills: [],
          profiles: [],
        },
        null,
        2
      ) + '\n',
  },
  {
    path: '.github/workflows/thesmos-review.yml',
    preserveExisting: true,
    content: workflowYaml,
  },
];

const MD_TEMPLATES: MarkdownTemplate[] = [
  {
    path: '.thesmos/README.md',
    sections: { overview: genOverview },
    skeleton: (c) =>
      [
        `# ${c.project} — Thesmos Contract`,
        '',
        '<!-- TODO: Add team-specific setup instructions and repository context. -->',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/GUARDRAILS.md',
    sections: { rules: genGuardrailsRules },
    skeleton: (c) =>
      [
        `# ${c.project} — Guardrails`,
        '',
        '<!-- TODO: Add project-specific exceptions, approved patterns, and team agreements. -->',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/RULES.md',
    sections: { rules: genRulesReference },
    skeleton: () => '# Thesmos Rule Reference\n',
  },
  {
    path: '.thesmos/governance/CODE_REVIEW.md',
    sections: { checklist: genCodeReviewChecklist },
    skeleton: (c) =>
      [
        `# ${c.project} — Code Review`,
        '',
        '## Process',
        '',
        '<!-- TODO: Describe review schedule, required reviewers, and escalation path. -->',
        '',
        '## Checklist',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/governance/REVIEW_AGENT.md',
    sections: { instructions: genReviewAgentInstructions },
    skeleton: (c) =>
      [
        `# ${c.project} — AI Review Agent`,
        '',
        '<!-- TODO: Add project-specific AI agent overrides and context. -->',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/governance/SEVERITY_MODEL.md',
    sections: { model: genSeverityTable },
    skeleton: (c) =>
      [
        `# ${c.project} — Severity Model`,
        '',
        '<!-- TODO: Document project-specific severity overrides or additional categories. -->',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/architecture/STRUCTURE.md',
    sections: { detected: genDetectedStructure },
    skeleton: (c) =>
      [
        `# ${c.project} — Project Structure`,
        '',
        '## Architecture Notes',
        '',
        '<!-- TODO: Describe major architectural decisions, folder conventions, module boundaries. -->',
        '',
        '## Detected',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/architecture/ROUTING.md',
    sections: { routes: genDetectedRoutes },
    skeleton: (c) =>
      [
        `# ${c.project} — Routing`,
        '',
        '## Conventions',
        '',
        '<!-- TODO: Describe routing conventions, patterns, and any special cases. -->',
        '',
        '## Detected Routes',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/architecture/COMPONENTS.md',
    sections: { stats: genDetectedComponents },
    skeleton: (c) =>
      [
        `# ${c.project} — Components`,
        '',
        '## Conventions',
        '',
        '<!-- TODO: Describe component conventions, shared design system, and patterns. -->',
        '',
        '## Detected',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/architecture/API.md',
    sections: { routes: genDetectedApi },
    skeleton: (c) =>
      [
        `# ${c.project} — API`,
        '',
        '## Conventions',
        '',
        '<!-- TODO: Describe API conventions, auth patterns, and error handling. -->',
        '',
        '## Detected API Routes',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/architecture/STATE.md',
    sections: { stores: genDetectedState },
    skeleton: (c) =>
      [
        `# ${c.project} — State Management`,
        '',
        '## Patterns',
        '',
        '<!-- TODO: Describe state management patterns, store conventions, and data flow. -->',
        '',
        '## Detected State Files',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/playbooks/ADD_COMPONENT.md',
    sections: { context: genPlaybookContext },
    skeleton: (c) =>
      [
        `# ${c.project} — Add a Component`,
        '',
        '## Steps',
        '',
        '1. <!-- TODO -->',
        '2. <!-- TODO -->',
        '3. <!-- TODO -->',
        '',
        '## Checklist',
        '',
        '- [ ] <!-- TODO -->',
        '',
        '## Stack Context',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/playbooks/ADD_PAGE.md',
    sections: { context: genPlaybookContext },
    skeleton: (c) =>
      [
        `# ${c.project} — Add a Page`,
        '',
        '## Steps',
        '',
        '1. <!-- TODO -->',
        '2. <!-- TODO -->',
        '3. <!-- TODO -->',
        '',
        '## Checklist',
        '',
        '- [ ] <!-- TODO -->',
        '',
        '## Stack Context',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/playbooks/ADD_API_ROUTE.md',
    sections: { context: genPlaybookContext },
    skeleton: (c) =>
      [
        `# ${c.project} — Add an API Route`,
        '',
        '## Steps',
        '',
        '1. <!-- TODO -->',
        '2. <!-- TODO -->',
        '3. <!-- TODO -->',
        '',
        '## Auth Requirement',
        '',
        '<!-- TODO: Describe the authentication requirement for new API routes. -->',
        '',
        '## Stack Context',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/playbooks/REFACTOR.md',
    sections: { context: genPlaybookContext },
    skeleton: (c) =>
      [
        `# ${c.project} — Refactor`,
        '',
        '## Steps',
        '',
        '1. <!-- TODO -->',
        '2. <!-- TODO -->',
        '3. <!-- TODO -->',
        '',
        '## Stack Context',
        '',
      ].join('\n'),
  },
  {
    path: '.thesmos/playbooks/FIX_BUILD.md',
    sections: { context: genPlaybookContext },
    skeleton: (c) =>
      [
        `# ${c.project} — Fix Build`,
        '',
        '## Steps',
        '',
        '1. <!-- TODO -->',
        '2. <!-- TODO -->',
        '3. <!-- TODO -->',
        '',
        '## Stack Context',
        '',
      ].join('\n'),
  },

  // ── Extension directories — created once, never overwritten ────────────────
  // Sections: {} means no generated content; existing content is always preserved.

  {
    path: '.thesmos/agents/README.md',
    sections: {},
    skeleton: () =>
      [
        '# Thesmos Agents',
        '',
        'Add role-based agent files here. Each agent is a focused lens over Thesmos rules.',
        '',
        '## How to add an agent',
        '',
        '1. Create a Markdown file: `.thesmos/agents/<id>.md`',
        '2. Add the `id` to the `agents` array in `.thesmos/registry.json`',
        '3. Run `thesmos adapters` to inject the agent context into adapter files',
        '',
        '## File format',
        '',
        '```md',
        '# <Agent Name>',
        '',
        '## Purpose',
        '',
        'What this agent focuses on.',
        '',
        '## Rule focus',
        '',
        '- rule_category_one',
        '- rule_category_two',
        '',
        '## Output',
        '',
        'How this agent should format its findings.',
        '```',
        '',
        '## Built-in agents (Phase 3)',
        '',
        'Future releases will ship built-in agents for common review roles.',
        'See the Thesmos documentation for the current list.',
      ].join('\n'),
  },

  {
    path: '.thesmos/skills/README.md',
    sections: {},
    skeleton: () =>
      [
        '# Thesmos Skills',
        '',
        'Add reusable workflow skill files here. Skills guide AI tools through repeatable tasks.',
        '',
        '## How to add a skill',
        '',
        '1. Create a Markdown file: `.thesmos/skills/<id>.md`',
        '2. Add the `id` to the `skills` array in `.thesmos/registry.json`',
        '',
        '## File format',
        '',
        '```md',
        '# <Skill Name>',
        '',
        '## Use when',
        '',
        'Describe the situation where this skill applies.',
        '',
        '## Inputs',
        '',
        '- .thesmos/report.json',
        '- .thesmos/GUARDRAILS.md',
        '',
        '## Process',
        '',
        '1. Step one.',
        '2. Step two.',
        '```',
        '',
        '## Built-in skills (Phase 4)',
        '',
        'Future releases will ship built-in skills for common review workflows.',
      ].join('\n'),
  },

  {
    path: '.thesmos/profiles/README.md',
    sections: {},
    skeleton: () =>
      [
        '# Thesmos Profiles',
        '',
        'Profiles compose rule packs, agents, skills, and adapter targets into a named preset.',
        '',
        '## How to use a profile',
        '',
        '```bash',
        'thesmos init --profile web-builder',
        '```',
        '',
        '## Built-in profiles (Phase 5)',
        '',
        'Future releases will ship built-in profiles.',
        'Current built-in list: base, web, next-supabase, web-builder, design-system.',
        '',
        '## Custom profiles',
        '',
        'Add custom profile JSON files here and reference them in `.thesmos/registry.json`.',
      ].join('\n'),
  },

  {
    path: '.thesmos/rules/README.md',
    sections: {},
    skeleton: () =>
      [
        '# Thesmos Rule Packs',
        '',
        'Add local rule pack definitions here. Rule packs group related rules for installation.',
        '',
        '## How to add a local rule pack',
        '',
        '1. Create a directory: `.thesmos/rules/<pack-id>/`',
        '2. Add a `pack.json` manifest and a `rules.ts` (or `rules.js`) file',
        '3. Reference the pack ID in `.thesmos/registry.json`',
        '',
        '## Built-in packs (Phase 2)',
        '',
        'Future releases will ship built-in rule packs:',
        '',
        '- `@thesmos/core` — fundamental rules (always included)',
        '- `@thesmos/web` — modern web application rules',
        '- `@thesmos/security` — security-focused rules',
        '- `@thesmos/nextjs` — Next.js-specific rules',
        '- `@thesmos/supabase` — Supabase-specific rules',
        '- `@thesmos/design-system` — design token enforcement',
        '- `@thesmos/accessibility` — a11y rules',
        '- `@thesmos/performance` — performance rules',
      ].join('\n'),
  },
];

// ── All file paths exported for use in doctor checks ─────────────────────────

export const INIT_FILE_PATHS: readonly string[] = [
  ...JSON_TEMPLATES.map((t) => t.path),
  ...MD_TEMPLATES.map((t) => t.path),
];

// ── Pure content builder ──────────────────────────────────────────────────────

function buildMarkdownContent(
  template: MarkdownTemplate,
  existing: string,
  config: ThesmosConfig,
  scan?: ScanResult
): string {
  const base = existing.trim() === '' ? template.skeleton(config) : existing;
  let result = base;
  for (const [id, gen] of Object.entries(template.sections)) {
    result = injectGeneratedSection(result, id, gen(config, scan));
  }
  return result;
}

/**
 * Pure function: given existing file contents and config, returns the full
 * desired content for every file. Does not touch the filesystem.
 *
 * @param existingFiles - Map of relative path → current file content.
 *   Absent keys mean the file does not yet exist.
 */
export function buildInitFiles(
  config: ThesmosConfig,
  scan?: ScanResult,
  existingFiles: Readonly<Record<string, string>> = {}
): Record<string, string> {
  const output: Record<string, string> = {};

  for (const tpl of JSON_TEMPLATES) {
    if (tpl.preserveExisting && tpl.path in existingFiles) {
      output[tpl.path] = existingFiles[tpl.path];
    } else {
      output[tpl.path] = tpl.content(config);
    }
  }

  for (const tpl of MD_TEMPLATES) {
    output[tpl.path] = buildMarkdownContent(
      tpl,
      existingFiles[tpl.path] ?? '',
      config,
      scan
    );
  }

  return output;
}

// ── I/O orchestrator ──────────────────────────────────────────────────────────

/**
 * Writes (or updates) every .thesmos/ file under `root`.
 * Only files whose computed content differs from disk are written.
 */
export function writeThesmosDir(
  root: string,
  config: ThesmosConfig,
  scan?: ScanResult,
  options: InitOptions = {}
): InitFileResult[] {
  const existingFiles: Record<string, string> = {};
  for (const relPath of INIT_FILE_PATHS) {
    const abs = join(root, relPath);
    if (existsSync(abs)) {
      existingFiles[relPath] = readFileSync(abs, 'utf8');
    }
  }

  const built = buildInitFiles(config, scan, existingFiles);
  const results: InitFileResult[] = [];

  for (const [relPath, content] of Object.entries(built)) {
    const abs = join(root, relPath);
    const existed = relPath in existingFiles;
    const existingContent = existingFiles[relPath] ?? '';
    const changed = content !== existingContent;

    if (!options.dryRun && (!existed || changed)) {
      const dir = dirname(abs);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }

    results.push({
      path: relPath,
      created: !existed,
      updated: existed && changed,
      skipped: existed && !changed,
    });
  }

  return results;
}
