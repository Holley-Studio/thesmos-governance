// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos MCP Server — JSON-RPC 2.0 over stdio (NDJSON transport).
 *
 * When Thesmos runs as an MCP server, AI assistants call governance tools
 * BEFORE generating or writing code. This shifts governance left: zero correction
 * cycles, 40-60% fewer fix-iteration tokens.
 *
 * Protocol: MCP 1.0 (https://modelcontextprotocol.io)
 * Transport: stdio — each line is a complete JSON-RPC 2.0 message
 *
 * Tools exposed:
 *   scan_file(path, content)     → Finding[] — check before Write/Edit
 *   explain_rule(ruleId)         → rule metadata + examples
 *   get_health()                 → HealthScore
 *   lint_commit(message)         → Finding[] — check before git commit
 *   get_context()                → .thesmos/context.md contents
 *
 * Resources:
 *   thesmos://rules              → full rule catalog
 *   thesmos://health             → current HealthScore
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THESMOS_RULES } from './rules/registry.js';
import { runReview } from './review.js';
import { findRule } from './explain.js';
import { computeHealthForRoot } from './health.js';
import { loadConfig, CONFIG_DEFAULTS } from './config.js';
import { loadReport } from './report.js';
import { COMMIT_RULES } from './rules/commits.js';
import type { Finding, ScanResult, DetectInput } from './types.js';
import { modelFor } from './generated/pantheon-models.js';
import { makeLogger } from './logger.js';
import { buildBudgetReport, getCurrentSessionId, TOKEN_BUDGET_DEFAULTS } from './token-budget.js';
import { logMcpBlock, logMcpPass, logRuleFire } from './governance-log.js';
import { getAutoModeGovernanceInfo } from './claude-govern.js';
import {
  assuranceFromRuleCounts,
  formatAssuranceScore,
} from './assurance.js';
import { loadProductFacts } from './product-facts.js';

const log = makeLogger('mcp');
const PRODUCT_FACTS = loadProductFacts();

// ── Types ─────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Maximum age of a scan before compliance status is NOT_ASSESSED.
const MAX_SCAN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── MCP Protocol constants ────────────────────────────────────────────────────

const SERVER_INFO = {
  name: PRODUCT_FACTS.packageName,
  version: PRODUCT_FACTS.version,
};

const CAPABILITIES = {
  tools: {},
  resources: {},
};

const TOOL_DEFINITIONS = [
  {
    name: 'scan_file',
    description:
      'Scan file content for governance violations BEFORE writing or editing. Returns an array of findings with severity, message, and fix suggestion.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root (e.g. "src/api/users.ts")' },
        content: { type: 'string', description: 'Full file content to scan' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'explain_rule',
    description: 'Explain a Thesmos governance rule by ID or category name. Returns description, severity, tags, and fix examples.',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: 'Rule ID (e.g. "SEC_001") or category slug (e.g. "sec_hardcoded_secret")' },
      },
      required: ['ruleId'],
    },
  },
  {
    name: 'get_health',
    description: 'Get the current governance health score (0–100) and grade for this project. Run thesmos scan first to get fresh results.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lint_commit',
    description: 'Check if a commit message follows Conventional Commits format and project governance rules.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message to validate' },
      },
      required: ['message'],
    },
  },
  {
    name: 'get_context',
    description: 'Get the project\'s governance context snapshot (.thesmos/context.md). Contains architecture, decisions, and active rules summary.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'debug_finding',
    description: 'Explain a Thesmos finding in context. Returns verdict (true/false positive), exact fix suggestion, and suppression command. Use when you don\'t understand why a rule fired.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: 'Rule ID, e.g. "JWT_001"' },
        file_content: { type: 'string', description: 'Full content of the flagged file' },
        line: { type: 'number', description: 'Line number of the finding (optional)' },
      },
      required: ['rule_id', 'file_content'],
    },
  },
  {
    name: 'get_token_budget',
    description: 'Get the current session, daily, and project token spend vs. configured budgets. Call before spawning large agent chains to check if budget allows it.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'check_model_cost',
    description: 'Compare the estimated cost of Haiku, Sonnet, and Opus for a given token count. Use to decide which model tier to invoke for a task.',
    inputSchema: {
      type: 'object',
      properties: {
        tokens: { type: 'number', description: 'Estimated total token count (input + output combined)' },
      },
      required: ['tokens'],
    },
  },
  {
    name: 'get_governance_status',
    description:
      'Returns current Auto Mode governance status: whether Thesmos hooks are installed, which severity levels are blocked, and a plain-English summary. Call this at the start of any Auto Mode or autonomous agent session to verify governance is active.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_active_agents',
    description:
      `Returns all ${PRODUCT_FACTS.agentCount} Pantheon agents with their domains, roles, mythology, and invocation instructions. Use this to discover which agent to invoke for a given task domain.`,
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Optional domain filter (e.g. "marketing", "security", "finance"). Omit to return all agents.' },
      },
    },
  },
  {
    name: 'check_path',
    description:
      'Validate a file path BEFORE writing, editing, or deleting. Returns { allowed: true } if safe, or { allowed: false, rule, message } if blocked by governance policy. Call this before every file-system mutation. Result is logged to .thesmos/governance.log.jsonl.',
    inputSchema: {
      type: 'object',
      properties: {
        tool:    { type: 'string', description: 'The tool you are about to invoke (e.g. "Write", "Edit", "Bash")' },
        path:    { type: 'string', description: 'Absolute or project-relative path of the target file' },
        session: { type: 'string', description: 'Optional session ID for audit correlation' },
      },
      required: ['tool', 'path'],
    },
  },
  {
    name: 'get_compliance_status',
    description:
      'Returns compliance pass/fail status for a given regulatory framework (GDPR, EU AI Act, HIPAA, DORA, SOC 2, NIST AI RMF). Runs the relevant rule set against the current scan and returns a summary with pass rate, finding counts by severity, and top blockers.',
    inputSchema: {
      type: 'object',
      properties: {
        framework: {
          type: 'string',
          enum: ['gdpr', 'eu-ai-act', 'hipaa', 'dora', 'soc2', 'nist-ai-rmf'],
          description: 'Regulatory framework to evaluate',
        },
        root: { type: 'string', description: 'Workspace root path (defaults to process.cwd())' },
      },
      required: ['framework'],
    },
  },
  {
    name: 'check_framework_coverage',
    description:
      'Lists all Thesmos rules tagged to a given compliance framework and whether each rule is currently passing or failing. Use to identify coverage gaps before a compliance review.',
    inputSchema: {
      type: 'object',
      properties: {
        framework: { type: 'string', description: 'Framework tag to filter on (e.g. "gdpr", "eu-ai-act", "hipaa", "dora", "nist-ai-rmf")' },
        root: { type: 'string', description: 'Workspace root path (defaults to process.cwd())' },
      },
      required: ['framework'],
    },
  },
];

const RESOURCE_DEFINITIONS = [
  {
    uri: 'thesmos://rules',
    name: 'Governance Rules Catalog',
    description: 'Full list of all active Thesmos governance rules with metadata.',
    mimeType: 'application/json',
  },
  {
    uri: 'thesmos://health',
    name: 'Current Health Report',
    description: 'Live governance health score and priority actions for this project.',
    mimeType: 'application/json',
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

function makeEmptyScan(): ScanResult {
  return {
    _generatedSections: [],
    generatedAt: new Date().toISOString(),
    scanVersion: '0',
    pages: [],
    apiRoutes: [],
    componentCount: 0,
    sharedUiFiles: [],
    designSystemFiles: [],
    storeFiles: [],
    testFiles: [],
    largeFiles: [],
    riskyFiles: [],
    scriptFiles: [],
    envFiles: [],
    clientBoundaryRisks: [],
  };
}

// ── Enforcement: forbidden path patterns ──────────────────────────────────────

interface ForbiddenPattern {
  pattern: RegExp;
  rule: string;
  message: string;
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { pattern: /\.(env|env\..*)$/i,            rule: 'SEC_001', message: 'Writing to .env files risks leaking secrets into AI context or logs.' },
  { pattern: /credentials\.(json|yaml|yml|toml|ini)$/i, rule: 'SEC_001', message: 'Credentials file detected — do not write API keys or secrets here.' },
  { pattern: /\.(pem|key|p12|pfx|crt|cer)$/i, rule: 'SEC_002', message: 'TLS/private key file — writing prohibited to prevent accidental key exposure.' },
  { pattern: /(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i, rule: 'SEC_002', message: 'SSH private key file — writing prohibited.' },
  { pattern: /\.npmrc$/i,                    rule: 'SEC_003', message: '.npmrc may contain registry tokens — writing requires explicit review.' },
  { pattern: /\.pypirc$/i,                   rule: 'SEC_003', message: '.pypirc may contain PyPI credentials.' },
  { pattern: /service[-_]?account(s)?\.json$/i, rule: 'SEC_001', message: 'Service account key file — writing prohibited.' },
  { pattern: /\.git\/config$/i,              rule: 'SC_001',  message: '.git/config may contain embedded credentials — do not modify.' },
  { pattern: /\/\.ssh\//i,                   rule: 'SEC_002', message: 'SSH directory is off-limits for writes.' },
];

function checkPathEnforcement(
  root: string,
  tool: string,
  path: string,
  session?: string,
): { allowed: boolean; rule?: string; message?: string } {
  const normalised = path.replace(/\\/g, '/');

  for (const fp of FORBIDDEN_PATTERNS) {
    if (fp.pattern.test(normalised)) {
      logMcpBlock(root, tool, path, fp.rule, fp.message, session);
      return { allowed: false, rule: fp.rule, message: fp.message };
    }
  }

  logMcpPass(root, tool, path, session);
  return { allowed: true };
}

function handleScanFile(
  root: string,
  params: { path: string; content: string; session?: string },
): { findings: Finding[]; summary: string } {
  const config = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();
  const changedFiles: DetectInput['changedFiles'] = [
    { path: params.path, content: params.content },
  ];

  const { findings } = runReview({ scan: makeEmptyScan(), config, changedFiles });
  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const highs = findings.filter((f) => f.severity === 'HIGH').length;

  for (const f of findings) {
    const outcome = f.severity === 'BLOCKER' ? 'BLOCKED' : f.severity === 'HIGH' ? 'WARN' : 'PASS';
    logRuleFire(root, f.category, params.path, outcome, 'mcp', params.session, f.message);
  }

  const summary =
    findings.length === 0
      ? 'No governance violations found.'
      : `${findings.length} finding(s): ${blockers} BLOCKER, ${highs} HIGH. Fix blockers before proceeding.`;

  return { findings, summary };
}

function handleExplainRule(params: { ruleId: string }): unknown {
  const rule = findRule(params.ruleId);
  if (!rule) {
    return { error: `Rule not found: ${params.ruleId}. Use get_health or thesmos explain --list for available rules.` };
  }
  return {
    id: rule.id,
    category: rule.category,
    severity: rule.severity,
    description: rule.description,
    tags: rule.tags,
    why: rule.explain?.why,
    goodExample: rule.explain?.goodExample,
    badExample: rule.explain?.badExample,
    commonViolations: rule.explain?.commonViolations,
  };
}

function handleGetHealth(root: string): unknown {
  const config = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();
  const health = computeHealthForRoot(root, config);
  return {
    score: health.score,
    grade: health.grade,
    priorityActions: health.priorityActions,
    totals: health.totals,
  };
}

function handleLintCommit(root: string, params: { message: string }): { findings: Finding[]; valid: boolean } {
  const config = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();
  const changedFiles: DetectInput['changedFiles'] = [
    { path: '.git/COMMIT_EDITMSG', content: params.message },
  ];

  const findings = COMMIT_RULES.flatMap((rule) =>
    rule.detect({ scan: makeEmptyScan(), config, changedFiles }),
  );

  return { findings, valid: findings.length === 0 };
}

function handleDebugFinding(
  root: string,
  params: { rule_id: string; file_content: string; line?: number },
): unknown {
  const config = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();
  const rule = THESMOS_RULES.find((r) => r.id === params.rule_id);
  if (!rule) {
    return { error: `Unknown rule: ${params.rule_id}. Use explain_rule to list available rules.` };
  }
  const fakeFile = { path: 'debug-target.ts', content: params.file_content };
  const findings = rule.detect({ scan: makeEmptyScan(), config, changedFiles: [fakeFile] });
  const isTruePositive = params.line !== undefined
    ? findings.some((f) => Math.abs((f.line ?? 0) - params.line!) <= 2)
    : findings.length > 0;
  return {
    rule: { id: rule.id, severity: rule.severity, description: rule.description },
    verdict: isTruePositive ? 'true_positive' : 'likely_false_positive',
    explanation: rule.explain,
    findings,
    fix_suggestion: findings[0]?.suggestion ?? rule.explain?.goodExample ?? 'See rule explanation.',
    suppress_command: `thesmos suppress --rule=${params.rule_id} --file=<your-file>`,
  };
}

function handleGetContext(root: string): unknown {
  const contextPath = join(root, '.thesmos', 'context.md');
  if (!existsSync(contextPath)) {
    return {
      content: null,
      message: 'No context snapshot found. Run `thesmos context:snapshot` to generate one.',
    };
  }
  const content = readFileSync(contextPath, 'utf8');
  return { content, path: contextPath };
}

function handleGetTokenBudget(root: string): unknown {
  const config = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();
  const budgetConfig = (config as unknown as Record<string, unknown>).tokenBudget as typeof TOKEN_BUDGET_DEFAULTS | undefined
    ?? TOKEN_BUDGET_DEFAULTS;
  const sessionId = getCurrentSessionId(root);
  const report = buildBudgetReport(root, budgetConfig, sessionId);
  const lines = [
    `Session: ${report.session.totalTokens.toLocaleString()} tokens · $${report.session.costUSD.toFixed(4)}`,
    `Today:   ${report.today.totalTokens.toLocaleString()} tokens · $${report.today.costUSD.toFixed(4)}`,
    `Project: ${report.project.totalTokens.toLocaleString()} tokens · $${report.project.costUSD.toFixed(4)}`,
  ];
  if (report.alerts.length > 0) lines.push('', 'Alerts:', ...report.alerts.map((a) => `  ⚠ ${a}`));
  if (report.hardStop) lines.push('', `HARD STOP: ${report.hardStopReason}`);
  return { text: lines.join('\n'), report };
}

function handleCheckModelCost(_params: { tokens: number }): unknown {
  return {
    status: 'pricing_not_available',
    message: 'Hardcoded pricing has been removed. Use the Anthropic pricing page for current rates.',
    learnMoreUrl: 'https://www.anthropic.com/pricing',
  };
}

// ── Pantheon agent catalog ────────────────────────────────────────────────────

// id/name/domain/role are curated here; `model` is resolved from the catalog
// (via the generated PANTHEON_MODELS map) so it can never drift. Regenerate the
// map with `npm run agents:export --workspace=thesmos`.
const PANTHEON_AGENTS_RAW = [
  { id: 'zeus-executive-agent',       name: 'Zeus',        domain: 'executive',    role: 'Executive Orchestration' },
  { id: 'athena-strategy-agent',      name: 'Athena',      domain: 'strategy',     role: 'Business Strategy & GTM' },
  { id: 'hermes-marketing-agent',     name: 'Hermes',      domain: 'marketing',    role: 'Marketing Strategy & Growth' },
  { id: 'argus-security-agent',       name: 'Argus',       domain: 'security',     role: 'Security & Threat Modeling' },
  { id: 'ares-sales-agent',           name: 'Ares',        domain: 'sales',        role: 'Sales Strategy & Closing' },
  { id: 'aphrodite-creative-agent',   name: 'Aphrodite',   domain: 'creative',     role: 'Creative Direction & Brand' },
  { id: 'hephaestus-design-agent',    name: 'Hephaestus',  domain: 'design',       role: 'UI/UX & Design Systems' },
  { id: 'themis-legal-agent',         name: 'Themis',      domain: 'legal',        role: 'Legal Strategy & Contracts' },
  { id: 'tyche-analytics-agent',      name: 'Tyche',       domain: 'analytics',    role: 'Analytics & KPIs' },
  { id: 'plutus-finance-agent',       name: 'Plutus',      domain: 'finance',      role: 'Finance, Pricing & Unit Econ' },
  { id: 'pheme-pr-agent',             name: 'Pheme',       domain: 'pr',           role: 'PR & Communications' },
  { id: 'apollo-content-agent',       name: 'Apollo',      domain: 'content',      role: 'Content & Copywriting' },
  { id: 'daedalus-product-agent',     name: 'Daedalus',    domain: 'product',      role: 'Product Management' },
  { id: 'hera-operations-agent',      name: 'Hera',        domain: 'operations',   role: 'Operations & HR' },
  { id: 'nike-leadgen-agent',         name: 'Nike',        domain: 'leadgen',      role: 'Lead Generation & Pipeline' },
  { id: 'heracles-bd-agent',          name: 'Heracles',    domain: 'bd',           role: 'Business Dev & Partnerships' },
  { id: 'mnemosyne-knowledge-agent',  name: 'Mnemosyne',   domain: 'knowledge',    role: 'Knowledge Management' },
  { id: 'hestia-cx-agent',            name: 'Hestia',      domain: 'cx',           role: 'Customer Experience' },
  { id: 'demeter-cs-agent',           name: 'Demeter',     domain: 'cs',           role: 'Customer Success' },
  { id: 'psyche-research-agent',      name: 'Psyche',      domain: 'research',     role: 'UX Research & Insights' },
  { id: 'nemesis-compliance-agent',   name: 'Nemesis',     domain: 'compliance',   role: 'Compliance & GRC' },
  { id: 'pythia-data-agent',          name: 'Pythia',      domain: 'data',         role: 'Data & Business Intelligence' },
  { id: 'dionysus-video-agent',       name: 'Dionysus',    domain: 'video',        role: 'Video Production' },
  { id: 'morpheus-animation-agent',   name: 'Morpheus',    domain: 'animation',    role: 'Animation & Motion' },
  { id: 'artemis-photography-agent',  name: 'Artemis',     domain: 'photography',  role: 'Photography & Art Direction' },
  { id: 'dike-ethics-agent',          name: 'Dike',        domain: 'ethics',       role: 'Ethics & AI Responsibility' },
  { id: 'aether-ai-strategy-agent',   name: 'Aether',      domain: 'ai-strategy',  role: 'AI Strategy & Implementation' },
  { id: 'calliope-email-agent',       name: 'Calliope',    domain: 'email',        role: 'Email & Newsletter' },
  { id: 'cassandra-qa-agent',         name: 'Cassandra',   domain: 'qa',           role: 'QA & Testing' },
  { id: 'chiron-architecture-agent',  name: 'Chiron',      domain: 'architecture', role: 'Software Architecture' },
  { id: 'clio-case-study-agent',      name: 'Clio',        domain: 'case-studies', role: 'Case Studies & Social Proof' },
  { id: 'eos-automation-agent',       name: 'Eos',         domain: 'automation',   role: 'Automation & Workflows' },
  { id: 'erato-brand-voice-agent',    name: 'Erato',       domain: 'brand-voice',  role: 'Brand Voice & Tone' },
  { id: 'kratos-devops-agent',        name: 'Kratos',      domain: 'devops',       role: 'DevOps & Infrastructure' },
  { id: 'metis-pm-agent',             name: 'Metis',       domain: 'pm',           role: 'Project Management' },
  { id: 'momus-challenger-agent',     name: 'Momus',       domain: 'challenger',   role: 'Devil\'s Advocate & Critique' },
  { id: 'polyhymnia-docs-agent',      name: 'Polyhymnia',  domain: 'docs',         role: 'Documentation & Technical Docs' },
  { id: 'proteus-drift-agent',        name: 'Proteus',     domain: 'drift',        role: 'Scope Drift Detection' },
  { id: 'talos-web-dev-agent',        name: 'Talos',       domain: 'web-dev',      role: 'Web Development' },
  { id: 'coeus-ideation-agent',       name: 'Coeus',       domain: 'ideation',     role: 'Ideation & Brainstorming' },
];

const PANTHEON_AGENTS_STATIC = PANTHEON_AGENTS_RAW.map((a) => ({ ...a, model: modelFor(a.id) }));

function handleGetActiveAgents(domainFilter?: string): unknown {
  const agents = domainFilter
    ? PANTHEON_AGENTS_STATIC.filter(a =>
        a.domain.includes(domainFilter) ||
        a.role.toLowerCase().includes(domainFilter) ||
        a.name.toLowerCase().includes(domainFilter))
    : PANTHEON_AGENTS_STATIC;

  return {
    total: PANTHEON_AGENTS_STATIC.length,
    filtered: agents.length,
    agents: agents.map(a => ({
      id: a.id,
      name: a.name,
      domain: a.domain,
      role: a.role,
      model: a.model,
      invoke: `Agent({ subagent_type: "${a.id}", prompt: "<your task>" })`,
    })),
    usage: 'Pass subagent_type to the Agent tool with a task prompt. Use domain filter to narrow by specialty.',
  };
}

// ── Resource handlers ─────────────────────────────────────────────────────────

function handleResourceRead(root: string, uri: string): unknown {
  if (uri === 'thesmos://rules') {
    return THESMOS_RULES.map((r) => ({
      id: r.id,
      category: r.category,
      severity: r.severity,
      description: r.description,
      tags: r.tags,
    }));
  }
  if (uri === 'thesmos://health') {
    return handleGetHealth(root);
  }
  return null;
}

/**
 * Load the cached report.json for the workspace. Returns null if absent or unparseable.
 * Compliance tools use this so they report NOT_ASSESSED instead of silently passing
 * on empty evidence.
 */
function getRealScanOrNull(root: string): ScanResult | null {
  try {
    return loadReport(root);
  } catch {
    return null;
  }
}

function handleGetComplianceStatus(root: string, params: { framework: string }): unknown {
  const config = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();
  const { framework } = params;

  const frameworkRules = THESMOS_RULES.filter((r) =>
    r.frameworks?.includes(framework) || r.id.startsWith(framework.toUpperCase().replace(/-/g, '_') + '_'),
  );

  const scan = getRealScanOrNull(root);
  const evidenceMissing = scan === null;

  // Reject stale scans — compliance evidence must be fresh.
  const scanAge = scan ? Date.now() - new Date(scan.generatedAt).getTime() : null;
  const stale = scanAge !== null && scanAge > MAX_SCAN_AGE_MS;
  const ageHours = scanAge !== null ? Math.round(scanAge / (60 * 60 * 1000)) : null;

  let frameworkFindings: Finding[] = [];
  if (!evidenceMissing && !stale && scan) {
    const { findings: allFindings } = runReview({ scan, config, changedFiles: [] });
    frameworkFindings = allFindings.filter((f) =>
      frameworkRules.some((r) => r.category === f.category),
    );
  }

  const passed = evidenceMissing || stale
    ? 0
    : frameworkRules.filter((r) => !frameworkFindings.some((f) => f.category === r.category)).length;
  const total = frameworkRules.length;
  const assurance = assuranceFromRuleCounts(passed, total, {
    evidenceMissing: evidenceMissing || stale,
    evidenceSource: evidenceMissing || stale ? null : join(root, '.thesmos', 'report.json'),
    reason: evidenceMissing
      ? 'No `.thesmos/report.json` — run `thesmos scan` before claiming compliance'
      : stale
        ? `Scan data is stale (${ageHours}h old) — run \`thesmos scan\` before claiming compliance`
        : undefined,
  });

  const blockers = frameworkFindings.filter((f) => f.severity === 'BLOCKER');
  const highs = frameworkFindings.filter((f) => f.severity === 'HIGH');

  return {
    framework,
    state: assurance.state,
    pass: assurance.state === 'PASS',
    complianceScore: assurance.score,
    rulesEvaluated: assurance.rulesEvaluated,
    rulesPassed: assurance.rulesPassed,
    rulesFailed: assurance.rulesFailed,
    reason: assurance.reason,
    evidenceSource: assurance.evidenceSource,
    scanGeneratedAt: scan?.generatedAt ?? null,
    scanAgeHours: ageHours,
    findings: frameworkFindings,
    topBlockers: blockers.slice(0, 5).map((f) => ({ category: f.category, file: f.file, message: f.message })),
    topHighs: highs.slice(0, 5).map((f) => ({ category: f.category, file: f.file, message: f.message })),
    summary:
      assurance.state === 'INCOMPLETE' || assurance.state === 'ERROR'
        ? `○ ${framework} compliance: ${assurance.state} (${formatAssuranceScore(assurance.score)}) — ${assurance.reason}`
        : assurance.state === 'PASS'
          ? `✅ ${framework} compliance: ${formatAssuranceScore(assurance.score)} (${passed}/${total} rules passed — no violations detected)`
          : `⚠️ ${framework} compliance: ${formatAssuranceScore(assurance.score)} (${passed}/${total} rules passed, ${blockers.length} blockers, ${highs.length} highs)`,
  };
}

function handleCheckFrameworkCoverage(root: string, params: { framework: string }): unknown {
  const config = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();
  const { framework } = params;

  const frameworkRules = THESMOS_RULES.filter((r) => r.frameworks?.includes(framework));
  const scan = getRealScanOrNull(root);
  const scanAge = scan ? Date.now() - new Date(scan.generatedAt).getTime() : null;
  const stale = scanAge !== null && scanAge > MAX_SCAN_AGE_MS;
  const evidenceMissing = scan === null || stale;
  let allFindings: Finding[] = [];
  if (!evidenceMissing && scan) {
    allFindings = runReview({ scan, config, changedFiles: [] }).findings;
  }

  const coverage = frameworkRules.map((r) => {
    const ruleFinding = allFindings.find((f) => f.category === r.category);
    return {
      id: r.id,
      category: r.category,
      severity: r.severity,
      description: r.description,
      status: evidenceMissing ? 'INCOMPLETE' : ruleFinding ? 'FAILING' : 'PASSING',
      finding: ruleFinding ?? null,
    };
  });

  const passing = coverage.filter((c) => c.status === 'PASSING').length;
  const failing = coverage.filter((c) => c.status === 'FAILING').length;
  const assurance = assuranceFromRuleCounts(passing, frameworkRules.length, {
    evidenceMissing,
    evidenceSource: evidenceMissing ? null : join(root, '.thesmos', 'report.json'),
    reason: stale
      ? `Scan data is stale (${Math.round((scanAge ?? 0) / (60 * 60 * 1000))}h old) — run \`thesmos scan\` before claiming compliance`
      : undefined,
  });

  return {
    framework,
    state: assurance.state,
    totalRules: frameworkRules.length,
    passing: assurance.rulesPassed,
    failing: assurance.rulesFailed,
    coveragePercent: assurance.score,
    rules: coverage,
    note: evidenceMissing
      ? (assurance.reason ?? 'No `.thesmos/report.json` — coverage is INCOMPLETE until you run `thesmos scan`.')
      : frameworkRules.length === 0
        ? `No rules explicitly tagged with framework "${framework}". Use get_compliance_status for prefix-based matching.`
        : undefined,
  };
}

// ── JSON-RPC dispatch ─────────────────────────────────────────────────────────

function dispatch(root: string, request: JsonRpcRequest): JsonRpcResponse {
  const respond = (result: unknown): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id: request.id,
    result,
  });

  const error = (code: number, message: string): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id: request.id,
    error: { code, message },
  });

  try {
    switch (request.method) {
      case 'initialize':
        return respond({
          protocolVersion: '2024-11-05',
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
        });

      case 'initialized':
        return respond({});

      case 'tools/list':
        return respond({ tools: TOOL_DEFINITIONS });

      case 'tools/call': {
        const name = request.params?.name as string | undefined;
        const toolInput = (request.params?.arguments ?? {}) as Record<string, string>;
        log.debug('tool call', { tool: name });

        const callConfig = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();
        if ((callConfig as unknown as Record<string, unknown>).disabled === true) {
          return respond({
            content: [{
              type: 'text',
              text: 'Thesmos is paused. Set "disabled": false in .thesmos/config.json to re-enable governance checks.',
            }],
          });
        }

        switch (name) {
          case 'scan_file':
            return respond({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(handleScanFile(root, toolInput as { path: string; content: string; session?: string }), null, 2),
                },
              ],
            });
          case 'explain_rule':
            return respond({
              content: [{ type: 'text', text: JSON.stringify(handleExplainRule(toolInput as { ruleId: string }), null, 2) }],
            });
          case 'get_health':
            return respond({
              content: [{ type: 'text', text: JSON.stringify(handleGetHealth(root), null, 2) }],
            });
          case 'lint_commit':
            return respond({
              content: [{ type: 'text', text: JSON.stringify(handleLintCommit(root, toolInput as { message: string }), null, 2) }],
            });
          case 'get_context':
            return respond({
              content: [{ type: 'text', text: JSON.stringify(handleGetContext(root), null, 2) }],
            });
          case 'debug_finding':
            return respond({
              content: [{ type: 'text', text: JSON.stringify(handleDebugFinding(root, toolInput as unknown as { rule_id: string; file_content: string; line?: number }), null, 2) }],
            });
          case 'get_token_budget':
            return respond({
              content: [{ type: 'text', text: JSON.stringify(handleGetTokenBudget(root), null, 2) }],
            });
          case 'check_model_cost':
            return respond({
              content: [{ type: 'text', text: JSON.stringify(handleCheckModelCost(toolInput as unknown as { tokens: number }), null, 2) }],
            });
          case 'check_path': {
            const cp = toolInput as { tool: string; path: string; session?: string };
            const result = checkPathEnforcement(root, cp.tool, cp.path, cp.session);
            return respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          }
          case 'get_governance_status': {
            const gsConfig = (() => { try { return loadConfig(root) as unknown as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })();
            const status = getAutoModeGovernanceInfo(root, gsConfig);
            return respond({ content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] });
          }
          case 'get_active_agents': {
            const domainFilter = (toolInput['domain'] as string | undefined)?.toLowerCase();
            const result = handleGetActiveAgents(domainFilter);
            return respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          }
          case 'get_compliance_status': {
            const gcRoot = (toolInput['root'] as string | undefined) ?? root;
            const gcFramework = (toolInput['framework'] as string | undefined) ?? '';
            const gcResult = handleGetComplianceStatus(gcRoot, { framework: gcFramework });
            return respond({ content: [{ type: 'text', text: JSON.stringify(gcResult, null, 2) }] });
          }
          case 'check_framework_coverage': {
            const cfRoot = (toolInput['root'] as string | undefined) ?? root;
            const cfFramework = (toolInput['framework'] as string | undefined) ?? '';
            const cfResult = handleCheckFrameworkCoverage(cfRoot, { framework: cfFramework });
            return respond({ content: [{ type: 'text', text: JSON.stringify(cfResult, null, 2) }] });
          }
          default:
            return error(-32601, `Unknown tool: ${name}`);
        }
      }

      case 'resources/list':
        return respond({ resources: RESOURCE_DEFINITIONS });

      case 'resources/read': {
        const uri = request.params?.uri as string | undefined;
        if (!uri) return error(-32602, 'Missing uri parameter');
        const content = handleResourceRead(root, uri);
        if (content === null) return error(-32002, `Resource not found: ${uri}`);
        return respond({
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(content, null, 2) }],
        });
      }

      case 'ping':
        return respond({});

      default:
        return error(-32601, `Method not found: ${request.method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('dispatch threw', {
      method: request.method,
      error: msg,
      stack: e instanceof Error ? e.stack : undefined,
    });
    return error(-32603, `Internal error: ${msg}`);
  }
}

// ── Server entry point ────────────────────────────────────────────────────────

export function startMcpServer(root: string): void {
  const rl = createInterface({ input: process.stdin, terminal: false });

  log.info('server started', { rules: THESMOS_RULES.length });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    const response = dispatch(root, request);

    // Notifications (no id) get no response
    if (request.id !== undefined && request.id !== null) {
      process.stdout.write(JSON.stringify(response) + '\n');
    } else if (request.method !== 'initialized') {
      // Notifications that need a response still need one
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
