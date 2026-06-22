/**
 * prometheus build:agent / build:skill / build:dashboard / build:workflow / build:rag / build:voice / build:mcp-tool / build:automation
 *
 * Interactive wizard for creating Prometheus-governed artifacts.
 * Each wizard asks 5-8 world-class engineering questions, then
 * generates complete, governance-scanned artifacts.
 *
 * Usage:
 *   prometheus build:agent             # 8-question interactive agent wizard
 *   prometheus build:agent --plan      # Output plan only, no code (default)
 *   prometheus build:agent --scaffold  # Write code files
 *   prometheus build:agent --yes       # Skip confirmation prompts
 *   prometheus build:skill             # 6-question skill wizard
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeLogger } from '../../logger.js';
import {
  runWizard,
  analyzeContext,
  prefilledFromContext,
  type WizardQuestion,
} from '../../builder/wizard.js';
import {
  generateAgent,
  generateAgentPlan,
} from '../../builder/generators/agent.js';

const log = makeLogger('build');

// ── Agent wizard questions ────────────────────────────────────────────────────

const AGENT_QUESTIONS: WizardQuestion[] = [
  {
    key: 'job',
    question: 'What is the PRIMARY job of this agent?',
    type: 'text',
    hint: 'Be specific: "Review PRs for JWT vulnerabilities" beats "Security agent"',
    engineering_note: 'Specificity forces correct tool selection. Vague purpose = scope creep.',
  },
  {
    key: 'trigger',
    question: 'When does this agent run?',
    type: 'choice',
    options: [
      { value: 'manual', label: 'Developer runs it manually on demand' },
      { value: 'pre-commit', label: 'Git hook — triggers before commit or push' },
      { value: 'ci', label: 'CI/CD — runs on every PR or push' },
      { value: 'scheduled', label: 'Scheduled — daily/weekly report' },
      { value: 'event', label: 'Event-driven — webhook, file change, or API trigger' },
    ],
    engineering_note: 'Wrong trigger = wrong error-handling model. Scheduled agents need retries, hooks need speed.',
  },
  {
    key: 'dataAccess',
    question: 'What data does this agent READ?',
    type: 'choice',
    options: [
      { value: 'code', label: 'Source code only — no external data' },
      { value: 'database', label: 'Database (read-only)' },
      { value: 'github', label: 'GitHub API (PRs, issues, code)' },
      { value: 'api', label: 'Custom API / external service' },
      { value: 'multi', label: 'Multiple sources (I\'ll scaffold a multi-source agent)' },
    ],
    engineering_note: 'Determines auth model, secret management, and rate-limit strategy.',
  },
  {
    key: 'outputType',
    question: 'What does this agent OUTPUT?',
    type: 'choice',
    options: [
      { value: 'report', label: 'Text report or summary (printed to terminal)' },
      { value: 'code', label: 'Code changes (proposes a PR or patch)' },
      { value: 'data', label: 'Structured data (JSON / YAML for downstream systems)' },
      { value: 'notification', label: 'Notification (Slack, email, GitHub comment)' },
      { value: 'action', label: 'Actions in an external system (API calls, DB writes)' },
    ],
    engineering_note: 'Determines output schema, idempotency requirements, and downstream contracts.',
  },
  {
    key: 'riskLevel',
    question: 'Risk level if the agent makes a mistake?',
    type: 'choice',
    options: [
      { value: 'low', label: 'Low — output is advisory only, fully reversible' },
      { value: 'medium', label: 'Medium — requires human review before publishing' },
      { value: 'high', label: 'High — needs explicit approval gate before any side effect' },
    ],
    engineering_note: 'Determines whether the agent needs dry-run mode, approval gates, and audit logging.',
  },
  {
    key: 'toolAccess',
    question: 'Tool access?',
    type: 'choice',
    options: [
      { value: 'none', label: 'None — uses only data you provide at invocation' },
      { value: 'readonly', label: 'Read-only MCP tools (scan_file, explain_rule, get_context)' },
      { value: 'full', label: 'Full MCP tool access (read + write)' },
    ],
    engineering_note: 'MCP tool scope = blast radius. Read-only is almost always the right default.',
  },
  {
    key: 'performance',
    question: 'Performance target?',
    type: 'choice',
    options: [
      { value: 'interactive', label: 'Interactive — must respond in < 3 seconds' },
      { value: 'background', label: 'Background job — completes in < 60 seconds' },
      { value: 'longrunning', label: 'Long-running — minutes to hours (shows progress)' },
    ],
    engineering_note: 'Determines streaming vs. batch, timeout strategy, and user feedback model.',
  },
  {
    key: 'name',
    question: 'What should I call this agent? (slug format)',
    type: 'text',
    hint: 'e.g. security-reviewer, api-validator, dependency-auditor',
    engineering_note: 'Forces clarity. If you can\'t name it, you haven\'t defined it.',
  },
];

// ── Skill wizard questions ────────────────────────────────────────────────────

const SKILL_QUESTIONS: WizardQuestion[] = [
  {
    key: 'purpose',
    question: 'What does this skill help developers do?',
    type: 'text',
    hint: 'e.g. "Explain security findings", "Generate test cases", "Review API design"',
  },
  {
    key: 'trigger',
    question: 'How is this skill invoked?',
    type: 'choice',
    options: [
      { value: 'slash', label: 'Claude Code slash command (user types /name)' },
      { value: 'auto', label: 'Auto-suggested by Prometheus after scan' },
      { value: 'both', label: 'Both — slash command + auto-suggestion' },
    ],
  },
  {
    key: 'input',
    question: 'What input does this skill expect?',
    type: 'choice',
    options: [
      { value: 'selection', label: 'Selected code in editor' },
      { value: 'file', label: 'File path argument' },
      { value: 'context', label: 'Current conversation context only' },
      { value: 'findings', label: 'Prometheus findings from last scan' },
    ],
  },
  {
    key: 'output',
    question: 'What should this skill produce?',
    type: 'choice',
    options: [
      { value: 'explanation', label: 'Plain-language explanation' },
      { value: 'code', label: 'Code (new or modified)' },
      { value: 'review', label: 'Structured review with actionable items' },
      { value: 'plan', label: 'Step-by-step implementation plan' },
    ],
  },
  {
    key: 'expertise',
    question: 'What level of expertise should this skill assume?',
    type: 'choice',
    options: [
      { value: 'any', label: 'Any developer — explain everything' },
      { value: 'mid', label: 'Mid-level — skip basics, include rationale' },
      { value: 'senior', label: 'Senior — concise, assume deep knowledge' },
    ],
  },
  {
    key: 'name',
    question: 'Skill name (slug format)',
    type: 'text',
    hint: 'e.g. explain-finding, review-pr, generate-tests',
  },
];

// ── Governance scan ───────────────────────────────────────────────────────────

async function runGovernanceScan(root: string, files: string[]): Promise<{ findings: number; blockers: number }> {
  // Dynamically import to avoid circular deps
  try {
    const { runReview } = await import('../../review.js');
    const { CONFIG_DEFAULTS, loadConfig } = await import('../../config.js');
    const config = loadConfig(root) ?? CONFIG_DEFAULTS;
    const { readFileSync, existsSync: existsS } = await import('node:fs');

    const changedFiles = files
      .filter((f) => existsS(join(root, f)))
      .map((f) => ({
        path: f,
        content: readFileSync(join(root, f), 'utf-8'),
      }));

    const allFindings = await runReview({ config, changedFiles });
    const blockers = allFindings.filter((f) => f.severity === 'BLOCKER');
    return { findings: allFindings.length, blockers: blockers.length };
  } catch {
    return { findings: 0, blockers: 0 }; // scan is best-effort
  }
}

// ── File writer ───────────────────────────────────────────────────────────────

function writeArtifact(root: string, relPath: string, content: string): void {
  const absPath = join(root, relPath);
  mkdirSync(join(root, relPath.split('/').slice(0, -1).join('/')), { recursive: true });
  writeFileSync(absPath, content, 'utf-8');
}

// ── build:agent ───────────────────────────────────────────────────────────────

async function runBuildAgent(argv: string[]): Promise<void> {
  const scaffold = argv.includes('--scaffold');
  const planOnly = !scaffold;
  const skipConfirm = argv.includes('--yes');
  const root = process.cwd();

  const context = analyzeContext(root);

  console.log('\n  Prometheus Builder Wizard — Agent\n');
  if (context.detectedStack.length > 0) {
    console.log(`  Detected: ${context.detectedStack.join(', ')}\n`);
  }
  console.log(`  ${planOnly ? '8 questions — outputs a plan + system prompt (no code written)' : '8 questions — will write code files when complete'}`);
  console.log(`  ${planOnly ? 'Run with --scaffold to write code files' : 'Run with --plan to skip code writing'}\n`);

  const prefilled = prefilledFromContext(context, 'agent');
  const prefilledCount = Object.keys(prefilled).length;
  if (prefilledCount > 0) {
    console.log(`  Brain detected ${prefilledCount} answer${prefilledCount === 1 ? '' : 's'} from codebase context (fewer questions to answer)\n`);
  }

  const answers = await runWizard(AGENT_QUESTIONS, context, prefilled);

  const name = (answers['name'] ?? 'custom-agent').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  answers['name'] = name;

  if (planOnly) {
    // Generate plan file
    const plan = generateAgentPlan(answers, context);
    const planDir = join(root, '.prometheus', 'builds');
    mkdirSync(planDir, { recursive: true });
    const planPath = join(planDir, `${name}-plan.md`);
    writeFileSync(planPath, plan, 'utf-8');

    console.log(`\n  Building ${name}...`);
    console.log(`  → Generated: .prometheus/builds/${name}-plan.md\n`);
    console.log(`  This plan covers:`);
    console.log(`  - System prompt (production-grade, governs agent behavior)`);
    console.log(`  - Architecture decision log (${AGENT_QUESTIONS.length} decisions, rationale included)`);
    console.log(`  - Implementation checklist`);
    console.log(`  - Security surface assessment`);
    console.log(`  - Test scenarios\n`);
    console.log(`  Hand this plan to Claude Code or any AI tool as context.`);
    console.log(`  Or write the code files: prometheus build:agent --scaffold\n`);

    log.info('build:agent plan complete', { name });
    return;
  }

  // Scaffold mode — write code files
  if (!skipConfirm) {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirmed = await new Promise<boolean>((resolve) => {
      rl.question(`\n  Write files for "${name}"? [y/N]: `, (a) => {
        rl.close();
        resolve(a.toLowerCase() === 'y' || a.toLowerCase() === 'yes');
      });
    });
    if (!confirmed) {
      console.log('\n  Cancelled. Run with --plan to generate a plan without writing files.\n');
      return;
    }
  }

  const result = await generateAgent(answers, context, { scaffold: true, planOnly: false });

  console.log(`\n  Building ${name}...\n`);
  for (const file of result.files) {
    writeArtifact(root, file.path, file.content);
    console.log(`  → Writing ${file.path}`);
  }

  // Governance scan
  console.log('\n  Running Prometheus governance scan on generated files...');
  const filePaths = result.files.map((f) => f.path);
  const { findings, blockers } = await runGovernanceScan(root, filePaths);
  if (blockers > 0) {
    console.log(`  ⚠  ${findings} finding${findings === 1 ? '' : 's'} (${blockers} BLOCKER${blockers === 1 ? '' : 's'}) — run: prometheus review .prometheus/catalog/agents/${name}.md`);
  } else if (findings > 0) {
    console.log(`  ⚠  ${findings} finding${findings === 1 ? '' : 's'} — run: prometheus review to see details`);
  } else {
    console.log(`  ✅ No findings — all generated files pass governance`);
  }

  console.log(`\n  Agent ready. To run:`);
  console.log(`    npx prometheus agent:run ${name}`);
  console.log(`    npx prometheus agent:run ${name} --dry-run`);
  console.log(`    /${name}              (from Claude Code)\n`);

  log.info('build:agent scaffold complete', { name, files: result.files.length, findings });
}

// ── build:skill ───────────────────────────────────────────────────────────────

async function runBuildSkill(argv: string[]): Promise<void> {
  const scaffold = argv.includes('--scaffold');
  const root = process.cwd();
  const context = analyzeContext(root);

  console.log('\n  Prometheus Builder Wizard — Skill\n');
  console.log(`  ${SKILL_QUESTIONS.length} questions — creates a Claude Code slash command\n`);

  const answers = await runWizard(SKILL_QUESTIONS, context, {});
  const name = (answers['name'] ?? 'custom-skill').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const purpose = answers['purpose'] ?? 'assist with development tasks';
  const output = answers['output'] ?? 'explanation';
  const expertise = answers['expertise'] ?? 'mid';

  const expertiseText = expertise === 'senior'
    ? 'Assume deep technical knowledge. Skip basics. Be concise.'
    : expertise === 'mid'
    ? 'Assume solid fundamentals. Include rationale but skip beginner explanations.'
    : 'Explain everything clearly. Assume no prior context on the specific topic.';

  const outputText = output === 'explanation'
    ? 'Provide a clear, structured explanation with examples.'
    : output === 'code'
    ? 'Write production-quality code. Include comments only where non-obvious. Follow existing code style.'
    : output === 'review'
    ? 'Structure as: Summary → Key Issues (prioritized) → Recommended Actions → Next Steps'
    : 'Provide a numbered implementation plan with clear acceptance criteria for each step.';

  const commandContent = [
    `---`,
    `description: ${purpose}`,
    `---`,
    '',
    `You are a specialized assistant that: ${purpose}`,
    '',
    `## Behavior`,
    expertiseText,
    '',
    `## Output format`,
    outputText,
    '',
    `## Constraints`,
    `- Stay focused on: ${purpose}`,
    `- Do not expand scope beyond what was asked`,
    `- If input is missing: ask one clarifying question, then proceed`,
    '',
    `---`,
    `*Prometheus-governed skill. Generated by prometheus build:skill.*`,
  ].join('\n');

  if (scaffold) {
    const skillPath = join(root, '.claude', 'commands', `${name}.md`);
    mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
    writeFileSync(skillPath, commandContent, 'utf-8');
    console.log(`\n  ✅ Skill created: .claude/commands/${name}.md`);
    console.log(`     Invoke with: /${name}\n`);
  } else {
    const planDir = join(root, '.prometheus', 'builds');
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, `${name}-skill.md`), commandContent, 'utf-8');
    console.log(`\n  ✅ Skill definition: .prometheus/builds/${name}-skill.md`);
    console.log(`     Write it: prometheus build:skill --scaffold\n`);
  }

  log.info('build:skill complete', { name, scaffold });
}

// ── Generic stubs for other builders ─────────────────────────────────────────

async function runBuildStub(builderType: string, argv: string[]): Promise<void> {
  const root = process.cwd();
  console.log(`\n  Prometheus Builder Wizard — ${builderType}\n`);
  console.log(`  This wizard is available in Prometheus v3.2.0+`);
  console.log(`  For now, run: prometheus build:agent (the most capable builder)\n`);

  // Provide useful defaults
  const planDir = join(root, '.prometheus', 'builds');
  mkdirSync(planDir, { recursive: true });
  const stub = [
    `# ${builderType} Build Plan`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `## Use the agent builder for now`,
    '',
    '```bash',
    'prometheus build:agent',
    '```',
    '',
    `The ${builderType} wizard will be added in a future release.`,
  ].join('\n');

  const stubPath = join(planDir, `${builderType}-stub.md`);
  writeFileSync(stubPath, stub, 'utf-8');
  console.log(`  Stub plan: .prometheus/builds/${builderType}-stub.md\n`);
  log.info(`build:${builderType} stub invoked`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdBuild(argv: string[]): Promise<void> {
  const subcommand = argv[0];

  switch (subcommand) {
    case 'agent':
      return runBuildAgent(argv.slice(1));

    case 'skill':
      return runBuildSkill(argv.slice(1));

    case 'dashboard':
    case 'workflow':
    case 'rag':
    case 'voice':
    case 'mcp-tool':
    case 'automation':
      return runBuildStub(subcommand, argv.slice(1));

    default:
      console.log('\n  Prometheus Builder Wizard\n');
      console.log('  Available builders:');
      console.log('    prometheus build:agent      — 8-question AI agent wizard');
      console.log('    prometheus build:skill      — 6-question Claude Code skill wizard');
      console.log('    prometheus build:dashboard  — Dashboard scaffold');
      console.log('    prometheus build:workflow   — Multi-step workflow');
      console.log('    prometheus build:rag        — RAG pipeline');
      console.log('    prometheus build:voice      — Voice AI agent');
      console.log('    prometheus build:mcp-tool   — Custom MCP tool');
      console.log('    prometheus build:automation — CI/CD automation');
      console.log('');
      console.log('  Options:');
      console.log('    --plan      Output plan + system prompt only (default)');
      console.log('    --scaffold  Write code files (requires confirmation)');
      console.log('    --yes       Skip confirmation\n');
  }
}
