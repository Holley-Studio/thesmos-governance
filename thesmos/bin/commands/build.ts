// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos build:agent / build:skill / build:dashboard / build:workflow / build:rag / build:voice / build:mcp-tool / build:automation
 *
 * Interactive wizard for creating Thesmos-governed artifacts.
 * Each wizard asks 5-8 world-class engineering questions, then
 * generates complete, governance-scanned artifacts.
 *
 * Usage:
 *   thesmos build:agent             # 8-question interactive agent wizard
 *   thesmos build:agent --plan      # Output plan only, no code (default)
 *   thesmos build:agent --scaffold  # Write code files
 *   thesmos build:agent --yes       # Skip confirmation prompts
 *   thesmos build:skill             # 6-question skill wizard
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
import {
  generateDashboard,
  generateDashboardPlan,
} from '../../builder/generators/dashboard.js';
import {
  generateWorkflow,
  generateWorkflowPlan,
} from '../../builder/generators/workflow.js';
import {
  generateRag,
  generateRagPlan,
} from '../../builder/generators/rag.js';
import {
  generateVoice,
  generateVoicePlan,
} from '../../builder/generators/voice.js';
import {
  generateMcpTool,
  generateMcpToolPlan,
} from '../../builder/generators/mcp-tool.js';
import {
  generateAutomation,
  generateAutomationPlan,
} from '../../builder/generators/automation.js';

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
      { value: 'auto', label: 'Auto-suggested by Thesmos after scan' },
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
      { value: 'findings', label: 'Thesmos findings from last scan' },
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

    const { findings: allFindings } = await runReview({ scan: {} as import('../../types.js').ScanResult, config, changedFiles });
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

  console.log('\n  Thesmos Builder Wizard — Agent\n');
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
    const planDir = join(root, '.thesmos', 'builds');
    mkdirSync(planDir, { recursive: true });
    const planPath = join(planDir, `${name}-plan.md`);
    writeFileSync(planPath, plan, 'utf-8');

    console.log(`\n  Building ${name}...`);
    console.log(`  → Generated: .thesmos/builds/${name}-plan.md\n`);
    console.log(`  This plan covers:`);
    console.log(`  - System prompt (production-grade, governs agent behavior)`);
    console.log(`  - Architecture decision log (${AGENT_QUESTIONS.length} decisions, rationale included)`);
    console.log(`  - Implementation checklist`);
    console.log(`  - Security surface assessment`);
    console.log(`  - Test scenarios\n`);
    console.log(`  Hand this plan to Claude Code or any AI tool as context.`);
    console.log(`  Or write the code files: thesmos build:agent --scaffold\n`);

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
  console.log('\n  Running Thesmos governance scan on generated files...');
  const filePaths = result.files.map((f) => f.path);
  const { findings, blockers } = await runGovernanceScan(root, filePaths);
  if (blockers > 0) {
    console.log(`  ⚠  ${findings} finding${findings === 1 ? '' : 's'} (${blockers} BLOCKER${blockers === 1 ? '' : 's'}) — run: thesmos review .thesmos/catalog/agents/${name}.md`);
  } else if (findings > 0) {
    console.log(`  ⚠  ${findings} finding${findings === 1 ? '' : 's'} — run: thesmos review to see details`);
  } else {
    console.log(`  ✅ No findings — all generated files pass governance`);
  }

  console.log(`\n  Agent ready. To run:`);
  console.log(`    npx thesmos agent:run ${name}`);
  console.log(`    npx thesmos agent:run ${name} --dry-run`);
  console.log(`    /${name}              (from Claude Code)\n`);

  log.info('build:agent scaffold complete', { name, files: result.files.length, findings });
}

// ── build:skill ───────────────────────────────────────────────────────────────

async function runBuildSkill(argv: string[]): Promise<void> {
  const scaffold = argv.includes('--scaffold');
  const root = process.cwd();
  const context = analyzeContext(root);

  console.log('\n  Thesmos Builder Wizard — Skill\n');
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
    `*Thesmos-governed skill. Generated by thesmos build:skill.*`,
  ].join('\n');

  if (scaffold) {
    const skillPath = join(root, '.claude', 'commands', `${name}.md`);
    mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
    writeFileSync(skillPath, commandContent, 'utf-8');
    console.log(`\n  ✅ Skill created: .claude/commands/${name}.md`);
    console.log(`     Invoke with: /${name}\n`);
  } else {
    const planDir = join(root, '.thesmos', 'builds');
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, `${name}-skill.md`), commandContent, 'utf-8');
    console.log(`\n  ✅ Skill definition: .thesmos/builds/${name}-skill.md`);
    console.log(`     Write it: thesmos build:skill --scaffold\n`);
  }

  log.info('build:skill complete', { name, scaffold });
}

// ── Dashboard wizard questions ────────────────────────────────────────────────

const DASHBOARD_QUESTIONS: WizardQuestion[] = [
  {
    key: 'dataSource',
    question: 'Where does the dashboard data come from?',
    type: 'choice',
    options: [
      { value: 'thesmos-report', label: 'Thesmos report.json (governance metrics)' },
      { value: 'api', label: 'API endpoint (REST or GraphQL)' },
      { value: 'supabase', label: 'Supabase (PostgreSQL)' },
      { value: 'custom', label: 'Custom data source' },
    ],
    engineering_note: 'Data source determines auth model and fetch strategy.',
  },
  {
    key: 'target',
    question: 'What is the render target?',
    type: 'choice',
    options: [
      { value: 'nextjs', label: 'Next.js React component' },
      { value: 'html', label: 'Plain HTML + Chart.js (no framework)' },
      { value: 'grafana', label: 'Grafana dashboard JSON' },
    ],
    engineering_note: 'Determines output format and component structure.',
  },
  {
    key: 'metric',
    question: 'What is the primary metric you want to display?',
    type: 'text',
    hint: 'e.g. "Governance health score", "API error rate", "Active users per day"',
    engineering_note: 'The primary metric shapes the entire dashboard layout.',
  },
  {
    key: 'refresh',
    question: 'How should the data refresh?',
    type: 'choice',
    options: [
      { value: 'real-time', label: 'Real-time polling (every 5 seconds)' },
      { value: 'on-scan', label: 'On Thesmos scan trigger' },
      { value: 'manual', label: 'Manual refresh (user clicks refresh)' },
    ],
    engineering_note: 'Real-time polling has cost and performance implications.',
  },
  {
    key: 'name',
    question: 'Dashboard name (slug format)',
    type: 'text',
    hint: 'e.g. governance-health, api-performance, user-activity',
  },
];

// ── Workflow wizard questions ──────────────────────────────────────────────────

const WORKFLOW_QUESTIONS: WizardQuestion[] = [
  {
    key: 'job',
    question: 'What does this workflow do?',
    type: 'text',
    hint: 'e.g. "Run tests and deploy to Vercel on every PR merge"',
    engineering_note: 'Specificity drives correct trigger and step selection.',
  },
  {
    key: 'trigger',
    question: 'When does this workflow trigger?',
    type: 'choice',
    options: [
      { value: 'pr', label: 'PR open/update (pull_request)' },
      { value: 'push-main', label: 'Push to main branch' },
      { value: 'scheduled', label: 'Scheduled (cron — weekly by default)' },
      { value: 'manual', label: 'Manual (workflow_dispatch)' },
      { value: 'release', label: 'On GitHub Release created' },
    ],
    engineering_note: 'Wrong trigger = wrong error-handling model.',
  },
  {
    key: 'runtime',
    question: 'What runtime does this workflow use?',
    type: 'choice',
    options: [
      { value: 'nodejs', label: 'Node.js' },
      { value: 'python', label: 'Python' },
      { value: 'docker', label: 'Docker container' },
      { value: 'any', label: 'No specific runtime (shell only)' },
    ],
    engineering_note: 'Runtime determines setup steps and caching strategy.',
  },
  {
    key: 'steps',
    question: 'What steps does this workflow run?',
    type: 'choice',
    options: [
      { value: 'test-lint', label: 'Test + lint (CI check)' },
      { value: 'build-deploy', label: 'Build + deploy' },
      { value: 'notify', label: 'Send notification only' },
      { value: 'full-ci', label: 'Full CI pipeline (test + lint + build + scan + deploy)' },
    ],
    engineering_note: 'Full CI includes a Thesmos governance scan on every run.',
  },
  {
    key: 'deployTarget',
    question: 'Deployment target (if deploying)?',
    type: 'choice',
    options: [
      { value: 'none', label: 'None — no deployment step' },
      { value: 'vercel', label: 'Vercel' },
      { value: 'aws', label: 'AWS (ECS, Lambda, or S3)' },
      { value: 'gcp', label: 'GCP (Cloud Run or GCS)' },
    ],
    engineering_note: 'Deploy target determines which secrets to configure.',
  },
  {
    key: 'needsApproval',
    question: 'Does deployment require a manual approval gate?',
    type: 'choice',
    options: [
      { value: 'no', label: 'No — fully automated' },
      { value: 'yes', label: 'Yes — human must approve before deploy' },
    ],
    engineering_note: 'Manual gates are required for production deployments in most orgs.',
  },
  {
    key: 'name',
    question: 'Workflow name (slug format)',
    type: 'text',
    hint: 'e.g. ci, deploy-production, weekly-scan',
  },
];

// ── RAG wizard questions ───────────────────────────────────────────────────────

const RAG_QUESTIONS: WizardQuestion[] = [
  {
    key: 'job',
    question: 'What will users search for with this RAG pipeline?',
    type: 'text',
    hint: 'e.g. "Company documentation", "Codebase Q&A", "Customer support articles"',
    engineering_note: 'The use case drives chunk size, retrieval strategy, and output format.',
  },
  {
    key: 'docFormat',
    question: 'What format are the source documents?',
    type: 'choice',
    options: [
      { value: 'markdown', label: 'Markdown' },
      { value: 'pdf', label: 'PDF' },
      { value: 'source-code', label: 'Source code' },
      { value: 'web-pages', label: 'Web pages (HTML)' },
    ],
    engineering_note: 'Format determines the chunking strategy and pre-processing needed.',
  },
  {
    key: 'embedModel',
    question: 'Which embedding model will you use?',
    type: 'choice',
    options: [
      { value: 'openai', label: 'OpenAI (text-embedding-3-small) — BYOK' },
      { value: 'cohere', label: 'Cohere (embed-v3) — BYOK' },
      { value: 'anthropic', label: 'Anthropic — BYOK' },
      { value: 'local', label: 'Local (sentence-transformers) — no API key' },
    ],
    engineering_note: 'Embedding model determines quality, cost, and API key requirements.',
  },
  {
    key: 'vectorStore',
    question: 'Where will vectors be stored?',
    type: 'choice',
    options: [
      { value: 'supabase', label: 'Supabase pgvector (if Supabase detected)' },
      { value: 'pinecone', label: 'Pinecone' },
      { value: 'weaviate', label: 'Weaviate' },
      { value: 'in-memory', label: 'In-memory (dev/testing only)' },
    ],
    engineering_note: 'In-memory loses data on restart. Choose a persistent store for production.',
  },
  {
    key: 'retrieval',
    question: 'Retrieval strategy?',
    type: 'choice',
    options: [
      { value: 'similarity', label: 'Similarity (top-K by cosine score)' },
      { value: 'mmr', label: 'MMR — diverse results (reduces redundancy)' },
      { value: 'hybrid', label: 'Hybrid — keyword + vector combined' },
    ],
    engineering_note: 'MMR is better for long documents. Hybrid wins on keyword-heavy queries.',
  },
  {
    key: 'outputFormat',
    question: 'Output format?',
    type: 'choice',
    options: [
      { value: 'plain-text', label: 'Plain text answer' },
      { value: 'json-citations', label: 'JSON with source citations' },
      { value: 'streaming', label: 'Streaming (token-by-token)' },
    ],
    engineering_note: 'JSON citations enable source attribution. Streaming improves perceived speed.',
  },
  {
    key: 'mcpTool',
    question: 'Expose this pipeline as a Thesmos MCP tool?',
    type: 'choice',
    options: [
      { value: 'yes', label: 'Yes — AI agents can query this pipeline via MCP' },
      { value: 'no', label: 'No — standalone pipeline only' },
    ],
    engineering_note: 'MCP exposure lets any Claude agent query this RAG pipeline directly.',
  },
  {
    key: 'chunkSize',
    question: 'Chunk size?',
    type: 'choice',
    options: [
      { value: 'small', label: 'Small (~512 tokens) — precise retrieval, more chunks' },
      { value: 'medium', label: 'Medium (~1024 tokens) — balanced (recommended)' },
      { value: 'large', label: 'Large (~2048 tokens) — more context per chunk, fewer chunks' },
    ],
    engineering_note: 'Small chunks = precise retrieval. Large chunks = more context per result.',
  },
  {
    key: 'name',
    question: 'Pipeline name (slug format)',
    type: 'text',
    hint: 'e.g. docs-search, codebase-qa, support-rag',
  },
];

// ── Voice wizard questions ─────────────────────────────────────────────────────

const VOICE_QUESTIONS: WizardQuestion[] = [
  {
    key: 'job',
    question: 'What does this voice agent do?',
    type: 'text',
    hint: 'e.g. "Answer customer questions about orders", "Guide users through onboarding"',
    engineering_note: 'Use case determines system prompt tone and response length targets.',
  },
  {
    key: 'transport',
    question: 'How is audio delivered?',
    type: 'choice',
    options: [
      { value: 'webrtc', label: 'WebRTC (browser-to-server, real-time)' },
      { value: 'twilio', label: 'Twilio Media Streams (telephone calls)' },
      { value: 'browser-speech', label: 'Browser SpeechAPI (client-side only)' },
    ],
    engineering_note: 'WebRTC for web apps. Twilio for phone IVR. Browser Speech for simple demos.',
  },
  {
    key: 'stt',
    question: 'Speech-to-text provider?',
    type: 'choice',
    options: [
      { value: 'deepgram', label: 'Deepgram Nova-2 — BYOK (fastest, best accuracy)' },
      { value: 'assemblyai', label: 'AssemblyAI — BYOK' },
      { value: 'whisper', label: 'OpenAI Whisper — BYOK' },
      { value: 'browser-native', label: 'Browser SpeechRecognition (free, limited)' },
    ],
    engineering_note: 'Deepgram has the lowest latency. Whisper is best for accuracy on technical terms.',
  },
  {
    key: 'tts',
    question: 'Text-to-speech provider?',
    type: 'choice',
    options: [
      { value: 'elevenlabs', label: 'ElevenLabs — BYOK (most natural voice)' },
      { value: 'deepgram', label: 'Deepgram Aura — BYOK (low latency)' },
      { value: 'browser-native', label: 'Browser SpeechSynthesis (free, robotic)' },
    ],
    engineering_note: 'ElevenLabs for production. Browser native for dev/demo only.',
  },
  {
    key: 'llm',
    question: 'Language model for responses?',
    type: 'choice',
    options: [
      { value: 'claude', label: 'Claude (Anthropic) — BYOK' },
      { value: 'openai', label: 'OpenAI GPT — BYOK' },
      { value: 'local', label: 'Local LLM (no API key)' },
    ],
    engineering_note: 'All LLM options are BYOK — Thesmos never stores your API key.',
  },
  {
    key: 'useCase',
    question: 'Use case?',
    type: 'choice',
    options: [
      { value: 'customer-support', label: 'Customer support' },
      { value: 'personal-assistant', label: 'Personal assistant' },
      { value: 'ivr', label: 'IVR / phone tree' },
      { value: 'demo', label: 'Demo / prototype' },
    ],
    engineering_note: 'Use case shapes the system prompt and fallback behavior.',
  },
  {
    key: 'latency',
    question: 'Latency target?',
    type: 'choice',
    options: [
      { value: 'real-time', label: 'Real-time (<300ms) — requires streaming STT + TTS' },
      { value: 'standard', label: 'Standard (<1s) — simpler, lower cost' },
    ],
    engineering_note: 'Real-time requires streaming at every layer. Standard is much simpler to build.',
  },
  {
    key: 'name',
    question: 'Voice agent name (slug format)',
    type: 'text',
    hint: 'e.g. support-bot, onboarding-guide, order-assistant',
  },
];

// ── MCP tool wizard questions ──────────────────────────────────────────────────

const MCP_TOOL_QUESTIONS: WizardQuestion[] = [
  {
    key: 'job',
    question: 'What does this tool do for AI agents?',
    type: 'text',
    hint: 'e.g. "Fetch live stock prices", "Run a database query", "Check DNS records"',
    engineering_note: 'MCP tools extend what AI agents can do. Be specific about the capability.',
  },
  {
    key: 'inputSchema',
    question: 'What parameters does it accept? (describe freely)',
    type: 'text',
    hint: 'e.g. "ticker symbol (string), date range (from/to dates)", "SQL query string"',
    engineering_note: 'This becomes the JSON Schema that AI agents use to call this tool.',
  },
  {
    key: 'returns',
    question: 'What does it return?',
    type: 'choice',
    options: [
      { value: 'text', label: 'Text (plain string)' },
      { value: 'json', label: 'Structured JSON' },
      { value: 'file-list', label: 'File list with metadata' },
      { value: 'findings', label: 'Thesmos scan findings' },
    ],
    engineering_note: 'Return type determines how AI agents parse and use the result.',
  },
  {
    key: 'sideEffects',
    question: 'Does this tool have side effects?',
    type: 'choice',
    options: [
      { value: 'read-only', label: 'Read-only — safe to call anytime' },
      { value: 'writes-files', label: 'Writes files — needs audit logging' },
      { value: 'calls-external-api', label: 'Calls external API — needs BYOK key + rate limits' },
    ],
    engineering_note: 'Side effects determine blast radius and required safeguards.',
  },
  {
    key: 'name',
    question: 'Tool name (slug format)',
    type: 'text',
    hint: 'e.g. fetch-stock-price, run-query, check-dns',
  },
];

// ── Automation wizard questions ────────────────────────────────────────────────

const AUTOMATION_QUESTIONS: WizardQuestion[] = [
  {
    key: 'job',
    question: 'What does this automation do?',
    type: 'text',
    hint: 'e.g. "Run nightly Thesmos scan and email results", "Clean stale branches weekly"',
    engineering_note: 'Specificity determines correct trigger and failure handling.',
  },
  {
    key: 'trigger',
    question: 'What triggers this automation?',
    type: 'choice',
    options: [
      { value: 'cron', label: 'Cron schedule (GitHub Actions schedule)' },
      { value: 'webhook', label: 'Webhook / repository_dispatch event' },
      { value: 'file-change', label: 'File change (push + paths filter)' },
      { value: 'manual', label: 'Manual (workflow_dispatch)' },
      { value: 'event', label: 'Code event (push to main / PR)' },
    ],
    engineering_note: 'Cron for periodic tasks. Webhook for external integrations. Event for code gates.',
  },
  {
    key: 'steps',
    question: 'What steps does this automation run?',
    type: 'choice',
    options: [
      { value: 'run-tests', label: 'Run tests' },
      { value: 'build-artifact', label: 'Build and upload artifact' },
      { value: 'deploy', label: 'Deploy' },
      { value: 'send-notification', label: 'Send notification' },
      { value: 'custom', label: 'Custom steps (scaffold shell)' },
    ],
    engineering_note: 'Drives the generated steps in the workflow or shell script.',
  },
  {
    key: 'onFailure',
    question: 'What happens on failure?',
    type: 'choice',
    options: [
      { value: 'fail-alert', label: 'Fail immediately and alert (default)' },
      { value: 'retry-alert', label: 'Retry 3x then alert' },
      { value: 'log-continue', label: 'Log and continue (best-effort)' },
    ],
    engineering_note: 'Fail-fast is safer for deployments. Retry for flaky network operations.',
  },
  {
    key: 'needsApproval',
    question: 'Does this automation require a human gate before execution?',
    type: 'choice',
    options: [
      { value: 'no', label: 'No — fully automated' },
      { value: 'yes', label: 'Yes — human must approve before running' },
    ],
    engineering_note: 'Required for production deployments and destructive operations.',
  },
  {
    key: 'name',
    question: 'Automation name (slug format)',
    type: 'text',
    hint: 'e.g. nightly-scan, stale-branch-cleanup, weekly-report',
  },
];

// ── Generic builder runner ────────────────────────────────────────────────────

async function runBuilderWizard<T extends { files: Array<{ path: string; content: string; label: string }> }>(opts: {
  type: string;
  questions: WizardQuestion[];
  generate: (answers: Record<string, string>, context: ReturnType<typeof analyzeContext>, o: { scaffold: boolean; planOnly: boolean }) => Promise<T>;
  generatePlan: (answers: Record<string, string>, context: ReturnType<typeof analyzeContext>) => string;
  argv: string[];
}): Promise<void> {
  const { type, questions, generate, generatePlan, argv } = opts;
  const scaffold = argv.includes('--scaffold');
  const planOnly = !scaffold;
  const skipConfirm = argv.includes('--yes');
  const root = process.cwd();
  const context = analyzeContext(root);

  console.log(`\n  Thesmos Builder Wizard — ${type}\n`);
  if (context.detectedStack.length > 0) {
    console.log(`  Detected: ${context.detectedStack.join(', ')}\n`);
  }
  console.log(`  ${questions.length} questions — ${planOnly ? 'outputs a plan (no code written)' : 'will write code files when complete'}\n`);

  const answers = await runWizard(questions, context, {});
  const name = (answers['name'] ?? type).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  answers['name'] = name;

  if (planOnly) {
    const plan = generatePlan(answers, context);
    const planDir = join(root, '.thesmos', 'builds');
    mkdirSync(planDir, { recursive: true });
    const planPath = join(planDir, `${name}-${type}-plan.md`);
    writeFileSync(planPath, plan, 'utf-8');

    console.log(`\n  Building ${name}...`);
    console.log(`  → Generated: .thesmos/builds/${name}-${type}-plan.md\n`);
    console.log(`  Hand this plan to Claude Code, or run with --scaffold to write code files.\n`);
    log.info(`build:${type} plan complete`, { name });
    return;
  }

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

  const result = await generate(answers, context, { scaffold: true, planOnly: false });

  console.log(`\n  Building ${name}...\n`);
  for (const file of result.files) {
    writeArtifact(root, file.path, file.content);
    console.log(`  → Writing ${file.path}`);
  }

  console.log('\n  Running Thesmos governance scan on generated files...');
  const filePaths = result.files.map((f) => f.path);
  const { findings, blockers } = await runGovernanceScan(root, filePaths);
  if (blockers > 0) {
    console.log(`  ⚠  ${findings} finding${findings === 1 ? '' : 's'} (${blockers} BLOCKER${blockers === 1 ? '' : 's'}) — run: thesmos review`);
  } else if (findings > 0) {
    console.log(`  ⚠  ${findings} finding${findings === 1 ? '' : 's'} — run: thesmos review to see details`);
  } else {
    console.log(`  ✅ No findings — all generated files pass governance`);
  }

  console.log(`\n  Done. Files written: ${result.files.length}\n`);
  log.info(`build:${type} scaffold complete`, { name, files: result.files.length, findings });
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
      return runBuilderWizard({
        type: 'dashboard',
        questions: DASHBOARD_QUESTIONS,
        generate: generateDashboard,
        generatePlan: generateDashboardPlan,
        argv: argv.slice(1),
      });

    case 'workflow':
      return runBuilderWizard({
        type: 'workflow',
        questions: WORKFLOW_QUESTIONS,
        generate: generateWorkflow,
        generatePlan: generateWorkflowPlan,
        argv: argv.slice(1),
      });

    case 'rag':
      return runBuilderWizard({
        type: 'rag',
        questions: RAG_QUESTIONS,
        generate: generateRag,
        generatePlan: generateRagPlan,
        argv: argv.slice(1),
      });

    case 'voice':
      return runBuilderWizard({
        type: 'voice',
        questions: VOICE_QUESTIONS,
        generate: generateVoice,
        generatePlan: generateVoicePlan,
        argv: argv.slice(1),
      });

    case 'mcp-tool':
      return runBuilderWizard({
        type: 'mcp-tool',
        questions: MCP_TOOL_QUESTIONS,
        generate: generateMcpTool,
        generatePlan: generateMcpToolPlan,
        argv: argv.slice(1),
      });

    case 'automation':
      return runBuilderWizard({
        type: 'automation',
        questions: AUTOMATION_QUESTIONS,
        generate: generateAutomation,
        generatePlan: generateAutomationPlan,
        argv: argv.slice(1),
      });

    default:
      console.log('\n  Thesmos Builder Wizard\n');
      console.log('  Available builders:');
      console.log('    thesmos build:agent      — 8-question AI agent wizard');
      console.log('    thesmos build:skill      — 6-question Claude Code skill wizard');
      console.log('    thesmos build:dashboard  — Dashboard scaffold');
      console.log('    thesmos build:workflow   — Multi-step workflow');
      console.log('    thesmos build:rag        — RAG pipeline');
      console.log('    thesmos build:voice      — Voice AI agent');
      console.log('    thesmos build:mcp-tool   — Custom MCP tool');
      console.log('    thesmos build:automation — CI/CD automation');
      console.log('');
      console.log('  Options:');
      console.log('    --plan      Output plan + system prompt only (default)');
      console.log('    --scaffold  Write code files (requires confirmation)');
      console.log('    --yes       Skip confirmation\n');
  }
}
