/**
 * Thesmos MCP Server — JSON-RPC 2.0 over stdio (NDJSON transport).
 *
 * When Prometheus runs as an MCP server, AI assistants call governance tools
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
 *   prometheus://rules           → full rule catalog
 *   prometheus://health          → current HealthScore
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMETHEUS_RULES } from './rules/registry.js';
import { runReview } from './review.js';
import { findRule } from './explain.js';
import { computeHealthForRoot } from './health.js';
import { loadConfig, CONFIG_DEFAULTS } from './config.js';
import { COMMIT_RULES } from './rules/commits.js';
import type { Finding, ScanResult, DetectInput } from './types.js';
import { makeLogger } from './logger.js';
import { buildBudgetReport, calcCost, getCurrentSessionId, TOKEN_BUDGET_DEFAULTS } from './token-budget.js';
import { logMcpBlock, logMcpPass, logRuleFire } from './governance-log.js';

const log = makeLogger('mcp');

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

// ── MCP Protocol constants ────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'thesmos-governance',
  version: '1.0.0',
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

  const findings = runReview({ scan: makeEmptyScan(), config, changedFiles });
  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const highs = findings.filter((f) => f.severity === 'HIGH').length;

  for (const f of findings) {
    const outcome = f.severity === 'BLOCKER' ? 'BLOCKED' : f.severity === 'HIGH' ? 'WARN' : 'PASS';
    logRuleFire(root, f.rule ?? f.category, params.path, outcome, 'mcp', params.session, f.message);
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
  const rule = PROMETHEUS_RULES.find((r) => r.id === params.rule_id);
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

function handleCheckModelCost(params: { tokens: number }): unknown {
  const t = Math.max(0, params.tokens);
  const half = Math.round(t / 2);
  const models = [
    { name: 'Haiku (claude-haiku-4-5-20251001)', input: 0.25, output: 1.25 },
    { name: 'Sonnet (claude-sonnet-4-6)', input: 3.00, output: 15.00 },
    { name: 'Opus (claude-opus-4-8)', input: 15.00, output: 75.00 },
  ];
  const rows = models.map((m) => {
    const cost = calcCost(m.name.split(' ')[0].toLowerCase(), half, half, {
      haiku:  { inputPer1M: 0.25, outputPer1M: 1.25 },
      sonnet: { inputPer1M: 3.00, outputPer1M: 15.00 },
      opus:   { inputPer1M: 15.00, outputPer1M: 75.00 },
    }) || (half * m.input + half * m.output) / 1_000_000;
    return `${m.name.padEnd(42)} $${cost.toFixed(4)}`;
  });
  return { text: [`Estimated cost for ${t.toLocaleString()} tokens:`, ...rows].join('\n') };
}

// ── Resource handlers ─────────────────────────────────────────────────────────

function handleResourceRead(root: string, uri: string): unknown {
  if (uri === 'thesmos://rules') {
    return PROMETHEUS_RULES.map((r) => ({
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

  log.info('server started', { rules: PROMETHEUS_RULES.length });

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
