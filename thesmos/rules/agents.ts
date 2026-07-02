// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Agent Governance Rules — AGNT_001–012
 *
 * Detects missing or inadequate governance declarations in AI agent config
 * files (.claude/settings.json, .thesmos/scope.json, CLAUDE.md).
 *
 * All detection is STATIC: rules read config file content passed through
 * changedFiles, or check filesystem existence via existsSync — no network
 * calls, no async operations.
 *
 * These are the first rules to govern the AI agents themselves — not just
 * the code they produce.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Helpers ───────────────────────────────────────────────────────────────────

function f(
  category: string,
  severity: Finding['severity'],
  message: string,
  suggestion: string,
  file: string,
): Finding {
  return { severity, file, category, message, suggestion };
}

function findFile(input: DetectInput, name: string): { path: string; content: string } | null {
  return input.changedFiles?.find((cf) => cf.path === name || cf.path.endsWith('/' + name)) ?? null;
}

function parseJson(content: string): Record<string, unknown> | null {
  try { return JSON.parse(content) as Record<string, unknown>; } catch { return null; }
}

function contentOf(input: DetectInput, name: string): string | null {
  return findFile(input, name)?.content ?? null;
}

// ── Rule: AGNT_001 — no scope file ───────────────────────────────────────────

const AGNT_001: ThesmosRule = {
  id: 'AGNT_001',
  category: 'agent_no_scope_declared',
  severity: 'HIGH',
  description: 'No .thesmos/scope.json found — agent file and network boundaries are undeclared.',
  tags: ['agent', 'governance', 'scope'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without a scope file, AI agents can read and write anywhere in the repo and make arbitrary network calls. This creates a governance blind spot and violates least-privilege.',
    commonViolations: ['Agent has full filesystem access', 'No record of which paths the agent should touch'],
    goodExample: '{"version":"1.0","workspace":{"allowedPaths":["src/","tests/"],"blockedPaths":[".env"]}}',
    badExample: '(no .thesmos/scope.json file exists)',
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    // Only flag in projects that use BOTH Claude Code AND Thesmos (both dirs exist)
    if (!existsSync(join(root, '.claude')) || !existsSync(join(root, '.thesmos'))) return [];
    const scopePath = join(root, '.thesmos', 'scope.json');
    if (existsSync(scopePath)) return [];
    // Also pass if the changedFiles includes scope.json (it's being created)
    if (findFile(input, 'scope.json')) return [];
    return [f('agent_no_scope_declared', 'HIGH',
      'No .thesmos/scope.json found — agent boundaries are undeclared.',
      'Run: thesmos scope:init',
      '.thesmos/scope.json')];
  },
};

// ── Rule: AGNT_002 — no token budget ─────────────────────────────────────────

const AGNT_002: ThesmosRule = {
  id: 'AGNT_002',
  category: 'agent_no_token_budget',
  severity: 'HIGH',
  description: 'No tokenBudget configured — agent sessions have no cost ceiling.',
  tags: ['agent', 'governance', 'tokens'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without a token budget, a runaway autonomous session can consume 10x expected tokens before anyone notices. A budget cap is the only hard protection against this.',
    commonViolations: ['No tokenBudget key in .thesmos/config.json', 'tokenBudget set to 0 or null'],
    goodExample: '{"tokenBudget":{"maxTokensPerSession":50000,"warnAtPercent":80}}',
    badExample: '{"project":"my-app"}',
  },
  detect(input: DetectInput): Finding[] {
    const configContent = contentOf(input, 'config.json');
    if (!configContent) return [];
    if (!configContent.includes('.thesmos')) return [];
    const cfg = parseJson(configContent);
    if (!cfg) return [];
    if (cfg.tokenBudget) return [];
    return [f('agent_no_token_budget', 'HIGH',
      'No tokenBudget in .thesmos/config.json — agent sessions are uncapped.',
      'Add: "tokenBudget": {"maxTokensPerSession": 50000, "warnAtPercent": 80}',
      '.thesmos/config.json')];
  },
};

// ── Rule: AGNT_003 — unrestricted bash ───────────────────────────────────────

const AGNT_003: ThesmosRule = {
  id: 'AGNT_003',
  category: 'agent_unrestricted_bash',
  severity: 'BLOCKER',
  description: '.claude/settings.json has no bash deny patterns — agent can run arbitrary shell commands.',
  tags: ['agent', 'security', 'bash', 'governance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without bash deny patterns, Claude Code in Auto Mode can execute rm -rf, curl to exfiltrate data, or any other shell command without restriction. This is the most critical agent safety gap.',
    commonViolations: ['Empty or missing permissions.deny array', 'No Bash deny rules in settings.json'],
    goodExample: '{"permissions":{"deny":["Bash(rm -rf **)","Bash(curl *:*)","Bash(wget **)"]}}',
    badExample: '{"permissions":{}}',
  },
  detect(input: DetectInput): Finding[] {
    const settingsContent = contentOf(input, 'settings.json');
    if (!settingsContent) return [];
    // Only check .claude/settings.json
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];

    const settings = parseJson(settingsContent);
    if (!settings) return [];

    const permissions = settings.permissions as Record<string, unknown> | undefined;
    const deny = permissions?.deny as unknown[] | undefined;
    if (Array.isArray(deny) && deny.some((d) => typeof d === 'string' && d.startsWith('Bash('))) {
      return [];
    }

    return [f('agent_unrestricted_bash', 'BLOCKER',
      '.claude/settings.json has no Bash deny rules — agent can execute any shell command.',
      'Add: "permissions": {"deny": ["Bash(rm -rf **)", "Bash(curl *:*)"]}',
      '.claude/settings.json')];
  },
};

// ── Rule: AGNT_004 — no hook governance ──────────────────────────────────────

const AGNT_004: ThesmosRule = {
  id: 'AGNT_004',
  category: 'agent_no_hook_governance',
  severity: 'MEDIUM',
  description: 'No PreToolUse hooks installed for Write/Edit operations — agent writes are ungoverned.',
  tags: ['agent', 'governance', 'hooks'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'PreToolUse hooks for Write and Edit are the real-time governance layer. Without them, Thesmos governance only runs after code is written, not before.',
    commonViolations: ['No hooks key in .claude/settings.json', 'hooks array is empty'],
    goodExample: '{"hooks":{"PreToolUse":[{"matcher":"Write","hooks":[{"type":"command": "thesmos claude:govern check"}]}]}}',
    badExample: '{}',
  },
  detect(input: DetectInput): Finding[] {
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];

    const settings = parseJson(settingsFile.content);
    if (!settings) return [];

    const hooks = settings.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) {
      return [f('agent_no_hook_governance', 'MEDIUM',
        'No PreToolUse hooks in .claude/settings.json — Write/Edit operations are ungoverned.',
        'Run: thesmos claude:govern install',
        '.claude/settings.json')];
    }
    const preToolUse = hooks['PreToolUse'] as unknown[] | undefined;
    if (!preToolUse || preToolUse.length === 0) {
      return [f('agent_no_hook_governance', 'MEDIUM',
        'PreToolUse hooks array is empty — Write/Edit operations are ungoverned.',
        'Run: thesmos claude:govern install',
        '.claude/settings.json')];
    }
    return [];
  },
};

// ── Rule: AGNT_005 — MCP server unverified ───────────────────────────────────

const AGNT_005: ThesmosRule = {
  id: 'AGNT_005',
  category: 'agent_mcp_server_unverified',
  severity: 'HIGH',
  description: 'MCP server registered without a pinned version or integrity hash — supply chain risk.',
  tags: ['agent', 'mcp', 'supply-chain', 'security'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'An MCP server runs code with full access to Claude\'s tool system. An unpinned or unhashed server binary can be swapped for a malicious version without detection.',
    commonViolations: ['mcpServers entry uses "npx <package>" without version pin', 'No integrity hash in mcpServers config'],
    goodExample: '{"mcpServers":{"my-tool":{"command":"npx","args":["my-mcp-tool@1.2.3"]}}}',
    badExample: '{"mcpServers":{"my-tool":{"command":"npx","args":["my-mcp-tool"]}}}',
  },
  detect(input: DetectInput): Finding[] {
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];

    const settings = parseJson(settingsFile.content);
    if (!settings) return [];

    const mcpServers = settings.mcpServers as Record<string, { args?: string[] }> | undefined;
    if (!mcpServers || Object.keys(mcpServers).length === 0) return [];

    const unversioned = Object.entries(mcpServers).filter(([, server]) => {
      const args = server.args ?? [];
      return args.some((arg) => typeof arg === 'string' && !arg.includes('@') && !arg.startsWith('/'));
    });

    return unversioned.map(([name]) =>
      f('agent_mcp_server_unverified', 'HIGH',
        `MCP server "${name}" has no pinned version in its args — update to "@version" form.`,
        `Change "args": ["${name}"] to "args": ["${name}@<version>"]`,
        '.claude/settings.json'),
    );
  },
};

// ── Rule: AGNT_006 — tool permissions too broad ───────────────────────────────

const AGNT_006: ThesmosRule = {
  id: 'AGNT_006',
  category: 'agent_tool_permissions_too_broad',
  severity: 'MEDIUM',
  description: 'No tool allow/deny list configured — agent has implicit access to all tools.',
  tags: ['agent', 'governance', 'permissions'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without an explicit allow or deny list, the agent can call any available tool. Least-privilege requires declaring which tools are needed.',
    commonViolations: ['settings.json has no permissions key', 'Empty permissions object with no allow or deny'],
    goodExample: '{"permissions":{"allow":["Read","Write","Edit","Bash(git *)"],"deny":["WebFetch(**)"]}}',
    badExample: '{}',
  },
  detect(input: DetectInput): Finding[] {
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];

    const settings = parseJson(settingsFile.content);
    if (!settings) return [];

    const permissions = settings.permissions as Record<string, unknown[]> | undefined;
    if (!permissions) {
      return [f('agent_tool_permissions_too_broad', 'MEDIUM',
        'No permissions declared in .claude/settings.json — all tools are implicitly allowed.',
        'Add "permissions": {"allow": [...], "deny": [...]} to restrict tool access.',
        '.claude/settings.json')];
    }
    if (
      (!permissions.allow || (permissions.allow as unknown[]).length === 0) &&
      (!permissions.deny || (permissions.deny as unknown[]).length === 0)
    ) {
      return [f('agent_tool_permissions_too_broad', 'MEDIUM',
        'Empty permissions object — no allow or deny list declared.',
        'Add an allow or deny list to enforce least-privilege tool access.',
        '.claude/settings.json')];
    }
    return [];
  },
};

// ── Rule: AGNT_007 — no constraints in CLAUDE.md ─────────────────────────────

const AGNT_007: ThesmosRule = {
  id: 'AGNT_007',
  category: 'agent_prompt_no_constraints',
  severity: 'HIGH',
  description: 'CLAUDE.md has no behavioral constraints section — agent behavior is unconstrained.',
  tags: ['agent', 'governance', 'claude', 'constraints'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'CLAUDE.md is the primary way to declare behavioral rules for Claude Code. Without a constraints section, there is no documented governance, and the agent has no guidance on what it should refuse to do.',
    commonViolations: ['CLAUDE.md exists but contains only project info', 'No "Constraints", "Rules", or "Governance" heading'],
    goodExample: '# Constraints\n- Never delete files without explicit confirmation\n- Never push to main directly',
    badExample: '# My Project\nThis project uses React...',
  },
  detect(input: DetectInput): Finding[] {
    const claudeMd = findFile(input, 'CLAUDE.md');
    if (!claudeMd) return [];

    const content = claudeMd.content.toLowerCase();
    const hasConstraints =
      content.includes('# constraint') ||
      content.includes('## constraint') ||
      content.includes('# rule') ||
      content.includes('## rule') ||
      content.includes('# governance') ||
      content.includes('## governance') ||
      content.includes('# restriction') ||
      content.includes('## restriction') ||
      content.includes('never ') ||
      content.includes('must not ') ||
      content.includes('do not ');

    if (hasConstraints) return [];

    return [f('agent_prompt_no_constraints', 'HIGH',
      'CLAUDE.md has no behavioral constraints section.',
      'Add a "## Constraints" section with explicit rules for what the agent must never do.',
      'CLAUDE.md')];
  },
};

// ── Rule: AGNT_008 — data access unpinned ────────────────────────────────────

const AGNT_008: ThesmosRule = {
  id: 'AGNT_008',
  category: 'agent_data_access_unpinned',
  severity: 'HIGH',
  description: 'scope.json has no allowedPaths — agent can access all files in the repo.',
  tags: ['agent', 'governance', 'scope'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without an allowedPaths constraint, an agent can read secrets, config files, and private data outside its intended scope. allowedPaths is the filesystem least-privilege boundary.',
    commonViolations: ['scope.json exists but workspace.allowedPaths is empty', 'allowedPaths not set'],
    goodExample: '{"workspace":{"allowedPaths":["src/","tests/","package.json"]}}',
    badExample: '{"workspace":{}}',
  },
  detect(input: DetectInput): Finding[] {
    const scopeFile = findFile(input, 'scope.json');
    if (!scopeFile) return [];
    if (!scopeFile.path.includes('.thesmos')) return [];

    const scope = parseJson(scopeFile.content);
    if (!scope) return [];

    const workspace = scope.workspace as { allowedPaths?: string[] } | undefined;
    if (workspace?.allowedPaths && workspace.allowedPaths.length > 0) return [];

    return [f('agent_data_access_unpinned', 'HIGH',
      'scope.json has no allowedPaths — agent has unrestricted file access.',
      'Add: "workspace": {"allowedPaths": ["src/", "tests/"]}',
      '.thesmos/scope.json')];
  },
};

// ── Rule: AGNT_009 — sub-agent ungoverned ────────────────────────────────────

const AGNT_009: ThesmosRule = {
  id: 'AGNT_009',
  category: 'agent_sub_agent_ungoverned',
  severity: 'HIGH',
  description: 'Agent spawning (Agent tool) is not mentioned in governance config — sub-agents are ungoverned.',
  tags: ['agent', 'governance', 'sub-agents'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Sub-agents spawned by the Agent tool inherit no governance from the parent session by default. Without explicit governance declarations, sub-agent actions are invisible to the audit trail.',
    commonViolations: ['CLAUDE.md mentions using Agent tool but no governance rules for it', 'No agent spawn restrictions in scope.json'],
    goodExample: '## Sub-Agent Rules\n- All sub-agents must be spawned with isolation: "worktree"\n- Sub-agents must not have internet access',
    badExample: '(no mention of Agent tool governance in any config file)',
  },
  detect(input: DetectInput): Finding[] {
    const claudeMd = findFile(input, 'CLAUDE.md');
    if (!claudeMd) return [];

    const content = claudeMd.content.toLowerCase();
    // If CLAUDE.md mentions spawning agents but no governance rules
    const mentionsAgents = content.includes('agent tool') || content.includes('spawn') || content.includes('sub-agent') || content.includes('subagent');
    if (!mentionsAgents) return [];

    const hasAgentGovernance =
      content.includes('sub-agent') && (content.includes('must') || content.includes('never') || content.includes('rule') || content.includes('govern'));

    if (hasAgentGovernance) return [];

    return [f('agent_sub_agent_ungoverned', 'HIGH',
      'CLAUDE.md mentions agent spawning but has no sub-agent governance rules.',
      'Add a "## Sub-Agent Rules" section declaring governance constraints for spawned agents.',
      'CLAUDE.md')];
  },
};

// ── Rule: AGNT_010 — no audit trail ──────────────────────────────────────────

const AGNT_010: ThesmosRule = {
  id: 'AGNT_010',
  category: 'agent_no_audit_trail',
  severity: 'MEDIUM',
  description: 'No .thesmos/audit.jsonl found — agent actions are not being logged.',
  tags: ['agent', 'audit', 'governance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without an audit trail, there is no record of what an AI agent read, wrote, or executed. This makes incident response impossible and fails most compliance frameworks.',
    commonViolations: ['claude:govern hooks not installed', 'audit.jsonl never created'],
    goodExample: '.thesmos/audit.jsonl with tamper-evident hash chain entries',
    badExample: '(file does not exist)',
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    // Only flag in projects that use BOTH Claude Code AND Thesmos
    if (!existsSync(join(root, '.claude')) || !existsSync(join(root, '.thesmos'))) return [];
    const auditPath = join(root, '.thesmos', 'audit.jsonl');
    // If audit.jsonl is in changedFiles (being created), it passes
    if (findFile(input, 'audit.jsonl')) return [];
    if (existsSync(auditPath)) return [];
    return [f('agent_no_audit_trail', 'MEDIUM',
      'No .thesmos/audit.jsonl — agent actions are not being logged.',
      'Run: thesmos claude:govern install  to enable audit logging.',
      '.thesmos/audit.jsonl')];
  },
};

// ── Rule: AGNT_011 — no session timeout ──────────────────────────────────────

const AGNT_011: ThesmosRule = {
  id: 'AGNT_011',
  category: 'agent_session_timeout_missing',
  severity: 'LOW',
  description: 'No maxSessionMinutes configured — agent sessions can run indefinitely.',
  tags: ['agent', 'governance', 'tokens'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'A stalled or runaway agent session without a timeout continues consuming tokens and potentially writing incorrect code. A session timeout is the last-resort safeguard.',
    commonViolations: ['config.json has tokenBudget but no maxSessionMinutes'],
    goodExample: '{"tokenBudget":{"maxTokensPerSession":50000,"maxSessionMinutes":60}}',
    badExample: '{"tokenBudget":{"maxTokensPerSession":50000}}',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];

    const cfg = parseJson(configFile.content);
    if (!cfg) return [];

    const budget = cfg.tokenBudget as Record<string, unknown> | undefined;
    if (!budget) return []; // AGNT_002 covers the missing budget case
    if (budget.maxSessionMinutes) return [];

    return [f('agent_session_timeout_missing', 'LOW',
      'tokenBudget has no maxSessionMinutes — sessions can run indefinitely.',
      'Add: "maxSessionMinutes": 60 to your tokenBudget config.',
      '.thesmos/config.json')];
  },
};

// ── Rule: AGNT_012 — network unrestricted ────────────────────────────────────

const AGNT_012: ThesmosRule = {
  id: 'AGNT_012',
  category: 'agent_network_unrestricted',
  severity: 'MEDIUM',
  description: 'No allowedNetworkHosts in scope.json — agent can make unrestricted network calls.',
  tags: ['agent', 'governance', 'network', 'scope'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'An agent with unrestricted network access can exfiltrate code, credentials, or data to any external host. allowedNetworkHosts is the network least-privilege boundary.',
    commonViolations: ['scope.json exists but operations.allowNetworkHosts is missing or empty'],
    goodExample: '{"operations":{"allowNetworkHosts":["api.github.com","registry.npmjs.org"]}}',
    badExample: '{"operations":{}}',
  },
  detect(input: DetectInput): Finding[] {
    const scopeFile = findFile(input, 'scope.json');
    if (!scopeFile?.path.includes('.thesmos')) return [];

    const scope = parseJson(scopeFile.content);
    if (!scope) return [];

    const ops = scope.operations as { allowNetworkHosts?: string[] } | undefined;
    if (!ops) {
      return [f('agent_network_unrestricted', 'MEDIUM',
        'scope.json has no operations section — network access is unrestricted.',
        'Add: "operations": {"allowNetworkHosts": ["api.github.com"]}',
        '.thesmos/scope.json')];
    }
    if (ops.allowNetworkHosts && ops.allowNetworkHosts.length > 0) return [];
    return [f('agent_network_unrestricted', 'MEDIUM',
      'scope.json operations.allowNetworkHosts is empty — all network access is blocked or unrestricted.',
      'Declare allowed hosts: "allowNetworkHosts": ["api.github.com", "registry.npmjs.org"]',
      '.thesmos/scope.json')];
  },
};

// ── Rule: AGNT_013 — no hard token cap ───────────────────────────────────────

const AGNT_013: ThesmosRule = {
  id: 'AGNT_013',
  category: 'agent_no_hard_token_cap',
  severity: 'BLOCKER',
  description: 'Agent loop uses alert/warn on token usage but has no hard stop — cost runaway if alert is ignored.',
  tags: ['agent', 'governance', 'tokens', 'cost'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Alert-only token budgets (callbacks that log when 80% is reached) do not stop runaway sessions — the session continues past the threshold. The $47,000 runaway agent incident used monitoring that alerted but never enforced a hard stop.',
    commonViolations: [
      'onTokenUsage: (usage) => { if (usage > WARN_AT) console.warn("High usage"); }  // no stop',
      'tokenBudget with only warnAtPercent — no maxTokensPerSession enforcement that aborts',
    ],
    goodExample: 'onTokenUsage: (usage) => {\n  if (usage > MAX_TOKENS) { agent.abort(); throw new Error("Token budget exceeded"); }\n}',
    badExample: 'onTokenUsage: (usage) => { logger.warn("token usage high:", usage); }  // ❌ no enforcement',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const cfg = parseJson(configFile.content);
    if (!cfg) return [];
    const budget = cfg.tokenBudget as Record<string, unknown> | undefined;
    if (!budget) return [];
    if (budget.maxTokensPerSession && !budget.warnAtPercent) return []; // has hard cap
    if (budget.warnAtPercent && !budget.maxTokensPerSession) {
      return [f('agent_no_hard_token_cap', 'BLOCKER',
        'tokenBudget has warnAtPercent but no maxTokensPerSession — warnings do not stop runaway sessions.',
        'Add "maxTokensPerSession" with enforcement: sessions must be aborted when the cap is reached.',
        '.thesmos/config.json')];
    }
    return [];
  },
};

// ── Rule: AGNT_014 — no iteration limit ──────────────────────────────────────

const AGNT_014: ThesmosRule = {
  id: 'AGNT_014',
  category: 'agent_no_iteration_limit',
  severity: 'BLOCKER',
  description: 'Agent autopilot config has no maxIterationsPerTask — tasks can loop indefinitely.',
  tags: ['agent', 'governance', 'cost', 'safety'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Without a per-task iteration limit, a task that cannot be completed (due to a persistent error or a misunderstood goal) will loop until the session token budget is exhausted or the user notices. Even with a token budget, thousands of iterations can be expensive.',
    commonViolations: [
      'autopilot config with no maxIterationsPerTask or maxRetriesPerTask',
      'Agent task runner with while(true) loop and no iteration counter',
    ],
    goodExample: '{"autopilot":{"maxRetriesPerTask":3,"taskTimeoutMinutes":30}}',
    badExample: '{"autopilot":{"enabled":true}}  // no iteration or retry cap',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const cfg = parseJson(configFile.content);
    if (!cfg) return [];
    const autopilot = cfg.autopilot as Record<string, unknown> | undefined;
    if (!autopilot?.enabled) return [];
    if (autopilot.maxRetriesPerTask || autopilot.taskTimeoutMinutes) return [];
    return [f('agent_no_iteration_limit', 'BLOCKER',
      'Autopilot is enabled but has no maxRetriesPerTask or taskTimeoutMinutes — tasks can loop indefinitely.',
      'Add: "maxRetriesPerTask": 3, "taskTimeoutMinutes": 30 to the autopilot config.',
      '.thesmos/config.json')];
  },
};

// ── Rule: AGNT_015 — no cost cap ─────────────────────────────────────────────

const AGNT_015: ThesmosRule = {
  id: 'AGNT_015',
  category: 'agent_no_cost_cap',
  severity: 'HIGH',
  description: 'Autopilot config has no maxCostUSD — no financial ceiling on agent sessions.',
  tags: ['agent', 'governance', 'cost', 'safety'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Token budgets cap token count, but not dollar cost — token prices vary by model. A hard dollar cap (maxCostUSD) provides a model-agnostic financial circuit breaker. Documented incidents include $47,000 from a single overnight session.',
    commonViolations: [
      'autopilot config with maxTokensPerSession but no maxCostUSD',
      'No financial ceiling in any governance config',
    ],
    goodExample: '{"autopilot":{"maxCostUSD":5.00},"tokenBudget":{"maxTokensPerSession":100000}}',
    badExample: '{"tokenBudget":{"maxTokensPerSession":1000000}}  // tokens only — no $ cap',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const cfg = parseJson(configFile.content);
    if (!cfg) return [];
    const autopilot = cfg.autopilot as Record<string, unknown> | undefined;
    if (!autopilot?.enabled) return [];
    if (autopilot.maxCostUSD) return [];
    return [f('agent_no_cost_cap', 'HIGH',
      'Autopilot enabled but no maxCostUSD configured — no financial ceiling on agent sessions.',
      'Add: "maxCostUSD": 5.00 to the autopilot config to cap spending per session.',
      '.thesmos/config.json')];
  },
};

// ── Rule: AGNT_016 — no abort controller in agent tool chains ────────────────

const AGNT_016: ThesmosRule = {
  id: 'AGNT_016',
  category: 'agent_no_abort_controller',
  severity: 'HIGH',
  description: 'Agent tool chain has no AbortController — long-running tool calls cannot be cancelled.',
  tags: ['agent', 'governance', 'cost', 'safety'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Without AbortController, a tool call that hangs (e.g., waiting for a slow external API) blocks the entire agent loop indefinitely. The agent continues consuming tokens waiting for the response, and the tool call cannot be externally cancelled.',
    commonViolations: [
      'await callTool(name, args)  // no timeout or abort signal',
      'fetch(url)  // inside agent loop with no signal',
    ],
    goodExample: 'const controller = new AbortController();\nconst timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);\ntry { await callTool(name, args, { signal: controller.signal }); } finally { clearTimeout(timeoutId); }',
    badExample: 'const result = await callTool(name, args);  // ❌ no cancellation path',
  },
  detect(input: DetectInput): Finding[] {
    const AGENT_LOOP_FILES = ['agent.ts', 'agent.js', 'autopilot.ts', 'runner.ts', 'executor.ts'];
    const relevantFiles = (input.changedFiles ?? []).filter(
      (f) => AGENT_LOOP_FILES.some((n) => f.path.endsWith(n)) || /agent.loop|runAgent|executeTask/.test(f.content),
    );
    const findings: Finding[] = [];
    for (const file of relevantFiles) {
      if (file.content.includes('AbortController')) continue;
      if (!/callTool|executeTool|runTool/.test(file.content)) continue;
      findings.push(f('agent_no_abort_controller', 'HIGH',
        'Agent tool chain has no AbortController — tool calls cannot be cancelled on timeout.',
        'Wrap tool calls with AbortController and setTimeout to enforce a per-call deadline.',
        file.path));
    }
    return findings;
  },
};

// ── Rule: AGNT_017 — no human approval gate for high-cost actions ────────────

const AGNT_017: ThesmosRule = {
  id: 'AGNT_017',
  category: 'agent_no_human_approval_gate',
  severity: 'HIGH',
  description: 'Agent can perform destructive or high-cost operations without human-in-the-loop approval.',
  tags: ['agent', 'governance', 'safety', 'human-in-loop'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Irreversible agent actions (data deletion, large API calls, file overwrites, external service mutations) should require human confirmation above a configurable risk threshold. Autonomous agents that skip this gate can cause unrecoverable damage.',
    commonViolations: [
      'Agent that calls DELETE endpoints without human approval in the loop',
      'Autopilot that writes files and commits without a review gate',
    ],
    goodExample: '{"autopilot":{"requireApprovalFor":["delete","drop","truncate","push","deploy"]}}',
    badExample: '{"autopilot":{"enabled":true,"mode":"auto"}}  // ❌ no approval gates',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const cfg = parseJson(configFile.content);
    if (!cfg) return [];
    const autopilot = cfg.autopilot as Record<string, unknown> | undefined;
    if (!autopilot?.enabled) return [];
    const hasGate =
      autopilot.requireApprovalFor ||
      autopilot.humanApproval ||
      autopilot.gates ||
      autopilot.approvalRequired;
    if (hasGate) return [];
    return [f('agent_no_human_approval_gate', 'HIGH',
      'Autopilot enabled with no human approval gate for destructive/high-cost operations.',
      'Add: "requireApprovalFor": ["delete", "push", "deploy"] to the autopilot config.',
      '.thesmos/config.json')];
  },
};

// ── Rule: AGNT_018 — agent can spawn sub-agents without budget inheritance ───

const AGNT_018: ThesmosRule = {
  id: 'AGNT_018',
  category: 'agent_sub_agent_budget_not_inherited',
  severity: 'MEDIUM',
  description: 'Sub-agent spawn config does not propagate the parent\'s token/cost budget.',
  tags: ['agent', 'governance', 'cost', 'sub-agents'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'When a parent agent spawns sub-agents, each sub-agent starts with a fresh (uncapped) budget unless explicitly configured to inherit or share the parent\'s remaining budget. This allows total spend to multiply by the number of sub-agents spawned.',
    commonViolations: [
      'Agent(prompt) called without passing remainingBudget from parent context',
      'Sub-agent spawn with no cost or token ceiling inherited from parent',
    ],
    goodExample: 'Agent({ prompt, maxCostUSD: parentBudget.remaining * 0.5 })  // child gets half remaining',
    badExample: 'Agent({ prompt })  // ❌ fresh uncapped budget for sub-agent',
  },
  detect(input: DetectInput): Finding[] {
    const claudeMd = findFile(input, 'CLAUDE.md');
    if (!claudeMd) return [];
    const content = claudeMd.content.toLowerCase();
    const spawnsAgents = content.includes('agent tool') || content.includes('spawn') || content.includes('sub-agent') || content.includes('subagent');
    if (!spawnsAgents) return [];
    const hasBudgetPolicy = content.includes('budget') && (content.includes('inherit') || content.includes('remaining') || content.includes('sub-agent') && content.includes('cost'));
    if (hasBudgetPolicy) return [];
    return [f('agent_sub_agent_budget_not_inherited', 'MEDIUM',
      'CLAUDE.md allows agent spawning but has no policy on budget inheritance for sub-agents.',
      'Add a budget inheritance rule: sub-agents must receive a fraction of the parent\'s remaining cost budget.',
      'CLAUDE.md')];
  },
};

// ── Rule: AGNT_019 — no circuit breaker on repeated tool failures ─────────────

const AGNT_019: ThesmosRule = {
  id: 'AGNT_019',
  category: 'agent_no_failure_circuit_breaker',
  severity: 'MEDIUM',
  description: 'Agent loop retries failed tool calls without a consecutive failure circuit breaker.',
  tags: ['agent', 'governance', 'cost', 'reliability'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'When a tool fails repeatedly (API down, bad parameters), a naive retry loop will retry forever, burning tokens on each LLM call that decides to retry. A consecutive failure circuit breaker stops the agent after N failures and escalates to the user.',
    commonViolations: [
      'Retry logic that catches errors and always calls the tool again',
      'No consecutiveFailures counter or MAX_CONSECUTIVE_FAILURES constant in agent loop',
    ],
    goodExample: 'if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {\n  throw new Error(`Circuit breaker: ${MAX_CONSECUTIVE_FAILURES} consecutive tool failures`);\n}',
    badExample: 'catch (err) { logger.error(err); continue; }  // ❌ always retries',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const cfg = parseJson(configFile.content);
    if (!cfg) return [];
    const autopilot = cfg.autopilot as Record<string, unknown> | undefined;
    if (!autopilot?.enabled) return [];
    const hasBreaker =
      autopilot.maxConsecutiveFailures ||
      autopilot.circuitBreaker ||
      autopilot.stopOnError;
    if (hasBreaker) return [];
    return [f('agent_no_failure_circuit_breaker', 'MEDIUM',
      'Autopilot has no consecutive failure circuit breaker — retry storm on repeated tool failures.',
      'Add: "maxConsecutiveFailures": 3 to halt the agent after repeated errors.',
      '.thesmos/config.json')];
  },
};

// ── Rule: AGNT_020 — no cost metric export ───────────────────────────────────

const AGNT_020: ThesmosRule = {
  id: 'AGNT_020',
  category: 'agent_no_cost_metrics',
  severity: 'MEDIUM',
  description: 'No cost/token metric export configured — agent spend is invisible to monitoring.',
  tags: ['agent', 'governance', 'observability', 'cost'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Without exporting cost and token usage metrics to a monitoring system, there is no way to detect runaway spending before it becomes catastrophic. Metrics should be emitted per session and per task to enable alerting.',
    commonViolations: [
      '.thesmos/config.json with no metrics or observability section',
      'Agent framework with no token usage callback or cost tracking',
    ],
    goodExample: '{"metrics":{"enabled":true,"exportTo":"datadog","costAlertThresholdUSD":10}}',
    badExample: '{}  // no metrics — spend is invisible',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const cfg = parseJson(configFile.content);
    if (!cfg) return [];
    const autopilot = cfg.autopilot as Record<string, unknown> | undefined;
    if (!autopilot?.enabled) return [];
    const hasMetrics = cfg.metrics || cfg.observability || cfg.telemetry;
    if (hasMetrics) return [];
    return [f('agent_no_cost_metrics', 'MEDIUM',
      'Autopilot enabled but no metrics/observability configured — agent spend is invisible.',
      'Add a "metrics" section to track token and cost usage per session.',
      '.thesmos/config.json')];
  },
};

// ── Rule: AGNT_021 — no daily spend cap ──────────────────────────────────────

const AGNT_021: ThesmosRule = {
  id: 'AGNT_021',
  category: 'agent_no_daily_spend_cap',
  severity: 'MEDIUM',
  description: 'No daily or weekly spend cap configured — multiple session overruns can compound costs.',
  tags: ['agent', 'governance', 'cost'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Per-session caps stop a single runaway session, but multiple sessions each at the cap can still produce unacceptable daily spend. A daily/weekly aggregate cap provides a second layer of financial protection.',
    commonViolations: [
      'maxCostUSD per session but no dailyBudgetUSD or weeklyBudgetUSD',
    ],
    goodExample: '{"autopilot":{"maxCostUSD":5,"dailyBudgetUSD":20,"weeklyBudgetUSD":50}}',
    badExample: '{"autopilot":{"maxCostUSD":5}}  // per-session only — 100 sessions = $500',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const cfg = parseJson(configFile.content);
    if (!cfg) return [];
    const autopilot = cfg.autopilot as Record<string, unknown> | undefined;
    if (!autopilot?.enabled) return [];
    if (!autopilot.maxCostUSD) return []; // AGNT_015 covers this case
    const hasDailyCap = autopilot.dailyBudgetUSD || autopilot.weeklyBudgetUSD || autopilot.monthlyBudgetUSD;
    if (hasDailyCap) return [];
    return [f('agent_no_daily_spend_cap', 'MEDIUM',
      'Only per-session cost cap configured — no daily or weekly aggregate spending limit.',
      'Add "dailyBudgetUSD" or "weeklyBudgetUSD" for aggregate cost protection.',
      '.thesmos/config.json')];
  },
};

// ── Rule: AGNT_022 — no require plugged in ────────────────────────────────────

const AGNT_022: ThesmosRule = {
  id: 'AGNT_022',
  category: 'agent_battery_runaway_risk',
  severity: 'LOW',
  description: 'Autopilot can run when the machine is on battery — risks unintended overnight runs.',
  tags: ['agent', 'governance', 'cost', 'safety'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Long autonomous sessions started on a laptop on battery will continue until the machine suspends or the battery dies. Requiring the machine to be plugged in prevents accidental overnight runs that drain the battery and accumulate unexpected costs.',
    commonViolations: [
      'autopilot config without requirePluggedIn: true',
    ],
    goodExample: '{"autopilot":{"requirePluggedIn":true}}',
    badExample: '{"autopilot":{"enabled":true}}  // runs on battery — overnight risk',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const cfg = parseJson(configFile.content);
    if (!cfg) return [];
    const autopilot = cfg.autopilot as Record<string, unknown> | undefined;
    if (!autopilot?.enabled) return [];
    if (autopilot.requirePluggedIn === true) return [];
    return [f('agent_battery_runaway_risk', 'LOW',
      'Autopilot does not require machine to be plugged in — overnight battery drain and cost risk.',
      'Add: "requirePluggedIn": true to the autopilot config.',
      '.thesmos/config.json')];
  },
};

// ── Phase 2 — AGNT_023–030 ───────────────────────────────────────────────────

const AGNT_023: ThesmosRule = {
  id: 'AGNT_023',
  category: 'agent_privilege_over_grant',
  severity: 'BLOCKER',
  description: 'Agent bash/edit tool granted without path restrictions — full filesystem access.',
  tags: ['agent', 'security', 'privilege'],
  frameworks: ['eu-ai-act', 'nist-ai-rmf'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Granting unrestricted Bash access to an agent gives it the same filesystem permissions as the user running it — including the ability to read secrets, modify system files, or delete the entire repository. Path-scoped Bash permissions limit the blast radius if the agent misbehaves or is prompt-injected.',
    commonViolations: [
      '{ "permissions": { "allow": ["Bash"] } }  // no path restriction — full filesystem access',
      '{ "permissions": { "allow": ["Bash", "Edit"] } }  // unrestricted edit anywhere',
    ],
    goodExample: '{ "permissions": { "allow": ["Bash(path:/workspace/myrepo/**)", "Edit(path:/workspace/myrepo/src/**)"] } }',
    badExample: '{ "permissions": { "allow": ["Bash"] } }  // agent can run any command on the full filesystem',
    relatedPlaybooks: ['agent-security.md'],
    relatedAgents: ['security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const settingsContent = contentOf(input, 'settings.json');
    if (!settingsContent) return [];
    const settingsFile = findFile(input, 'settings.json');
    if (!settingsFile?.path.includes('.claude')) return [];
    const settings = parseJson(settingsContent);
    if (!settings) return [];
    const permissions = settings.permissions as Record<string, unknown> | undefined;
    const allow = permissions?.allow as string[] | undefined;
    if (!allow) return [];
    if (allow.includes('Bash') && !allow.some((r) => r.startsWith('Bash('))) {
      return [f('agent_privilege_over_grant', 'BLOCKER',
        'Bash allowed without path restrictions in .claude/settings.json',
        'Add Bash(path:/your/repo/**) pattern to restrict scope',
        '.claude/settings.json')];
    }
    return [];
  },
};

const AGNT_024: ThesmosRule = {
  id: 'AGNT_024',
  category: 'agent_consent_lifecycle_missing',
  severity: 'HIGH',
  description: 'Agent scope declares PII categories but has no consent lifecycle hook.',
  tags: ['agent', 'gdpr', 'consent', 'pii'],
  frameworks: ['gdpr', 'eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'GDPR Art. 7 requires that consent is specific, informed, and freely given — and can be withdrawn at any time. If an agent processes PII categories without a consent lifecycle hook, there is no mechanism to check, record, or revoke consent before processing begins.',
    commonViolations: [
      '{ "piiCategories": ["email", "phone"] }  // no consentHook in scope.json',
      '{ "piiCategories": ["health"], "consentHook": "" }  // empty consentHook',
    ],
    goodExample: '{ "piiCategories": ["email", "phone"], "consentHook": "hooks/check-consent.ts" }',
    badExample: '{ "piiCategories": ["email", "financial"] }  // agent processes PII with no consent check',
    relatedPlaybooks: ['gdpr.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const scopeContent = contentOf(input, 'scope.json');
    if (!scopeContent) return [];
    const scope = parseJson(scopeContent);
    if (!scope) return [];
    const piiCategories = scope.piiCategories as string[] | undefined;
    if (!piiCategories || piiCategories.length === 0) return [];
    const consentHook = scope.consentHook as string | undefined;
    if (!consentHook) {
      return [f('agent_consent_lifecycle_missing', 'HIGH',
        'scope.json declares piiCategories but has no consentHook — no consent lifecycle enforced',
        'Add consentHook field to .thesmos/scope.json pointing to your consent-check function',
        '.thesmos/scope.json')];
    }
    return [];
  },
};

const AGNT_025: ThesmosRule = {
  id: 'AGNT_025',
  category: 'agent_dpia_missing',
  severity: 'HIGH',
  description: 'Agent processes high-risk data categories with no DPIA reference in scope.json.',
  tags: ['agent', 'gdpr', 'dpia', 'compliance'],
  frameworks: ['gdpr', 'eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'GDPR Art. 35 mandates a Data Protection Impact Assessment before processing high-risk data (health, financial, biometric, criminal, children). Without a DPIA reference, you cannot demonstrate that risks were identified and mitigated before the agent went live.',
    commonViolations: [
      '{ "piiCategories": ["health", "biometric"] }  // no dpia field in scope.json',
      '{ "piiCategories": ["children"], "dpia": "" }  // empty DPIA reference',
    ],
    goodExample: '{ "piiCategories": ["health"], "dpia": "docs/dpia-health-agent-2024.pdf", "consentHook": "hooks/consent.ts" }',
    badExample: '{ "piiCategories": ["financial", "biometric"] }  // processes high-risk data with no impact assessment',
    relatedPlaybooks: ['gdpr.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const scopeContent = contentOf(input, 'scope.json');
    if (!scopeContent) return [];
    const scope = parseJson(scopeContent);
    if (!scope) return [];
    const HIGH_RISK = ['health', 'financial', 'biometric', 'criminal', 'children'];
    const categories = scope.piiCategories as string[] | undefined;
    const hasHighRisk = categories?.some((c) =>
      HIGH_RISK.some((h) => c.toLowerCase().includes(h)),
    );
    if (!hasHighRisk) return [];
    const dpia = scope.dpia as string | undefined;
    if (!dpia) {
      return [f('agent_dpia_missing', 'HIGH',
        'scope.json includes high-risk data categories but no DPIA reference — GDPR Art. 35 / EU AI Act Art. 9',
        'Add dpia field to .thesmos/scope.json referencing your Data Protection Impact Assessment',
        '.thesmos/scope.json')];
    }
    return [];
  },
};

const AGNT_026: ThesmosRule = {
  id: 'AGNT_026',
  category: 'agent_model_card_missing',
  severity: 'HIGH',
  description: 'No .thesmos/model-card.md found — EU AI Act Art. 13 transparency requirement.',
  tags: ['agent', 'transparency', 'eu-ai-act', 'documentation'],
  frameworks: ['eu-ai-act', 'nist-ai-rmf'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 13 requires that high-risk AI systems provide users with sufficient information about capabilities, limitations, and intended use. A model card codifies this — without one, stakeholders cannot make informed decisions about when to trust or override the agent.',
    commonViolations: [
      '// No .thesmos/model-card.md file exists — agent deployed with no transparency documentation',
      '// model-card.md exists but is empty or only has a title',
    ],
    goodExample: '# Model Card\n## Intended Use\nCode review assistant for TypeScript monorepos.\n## Limitations\nMay miss domain-specific patterns. Always requires human sign-off on security findings.\n## Risk Mitigations\nBLOCKER findings escalated to human; no auto-merge without approval.',
    badExample: '// Deploy agent with .thesmos/ config but no model-card.md — no documented limitations or oversight path',
    relatedPlaybooks: ['ai-governance.md', 'eu-ai-act.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    if (!existsSync(join(root, '.claude')) || !existsSync(join(root, '.thesmos'))) return [];
    if (!existsSync(join(root, '.thesmos', 'model-card.md'))) {
      return [f('agent_model_card_missing', 'HIGH',
        'No .thesmos/model-card.md found — EU AI Act Art. 13 requires AI system transparency documentation',
        'Create .thesmos/model-card.md with model details, intended use, limitations, and risk mitigations',
        '.thesmos/model-card.md')];
    }
    return [];
  },
};

const AGNT_027: ThesmosRule = {
  id: 'AGNT_027',
  category: 'agent_audit_trail_immutable',
  severity: 'HIGH',
  description: '.thesmos/audit.jsonl is being modified by the agent — audit trail must be append-only.',
  tags: ['agent', 'audit', 'compliance', 'integrity'],
  frameworks: ['eu-ai-act', 'hipaa', 'dora'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 12, HIPAA §164.312(b), and DORA require tamper-evident audit logs. If an agent can modify or overwrite audit.jsonl, there is no reliable record of what the agent did — making incident reconstruction, compliance audits, and legal discovery impossible.',
    commonViolations: [
      '// Agent has Edit permission on .thesmos/audit.jsonl — can overwrite past entries',
      '// audit.jsonl in changedFiles means the agent rewrote it rather than appending',
    ],
    goodExample: '// Use a write-protected append-only logging service or restrict audit.jsonl to append-only OS permissions\n// Agent only calls auditLog.append() — never writes directly to the file',
    badExample: 'fs.writeFileSync(".thesmos/audit.jsonl", JSON.stringify(entries));  // overwrites entire log',
    relatedPlaybooks: ['ai-governance.md', 'hipaa.md'],
    relatedAgents: ['compliance-reviewer', 'security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const auditFile = findFile(input, 'audit.jsonl');
    if (auditFile) {
      return [f('agent_audit_trail_immutable', 'HIGH',
        '.thesmos/audit.jsonl is in changedFiles — audit trail must be append-only and not directly writable by agent',
        'Restrict write access to audit.jsonl; use a write-protected append-only logging service',
        auditFile.path)];
    }
    return [];
  },
};

const AGNT_028: ThesmosRule = {
  id: 'AGNT_028',
  category: 'agent_cross_agent_auth_missing',
  severity: 'HIGH',
  description: 'Sub-agent spawned without forwarding parent session token — auth gap in agent chain.',
  tags: ['agent', 'auth', 'security', 'sub-agent'],
  frameworks: ['nist-ai-rmf', 'eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'When a parent agent spawns a sub-agent without forwarding the session token, the sub-agent operates without the auth context established by the user. This breaks auditability (actions cannot be attributed to the originating user) and may allow the sub-agent to escalate privileges or bypass per-user rate limits.',
    commonViolations: [
      'Agent({ prompt: "review this file" })  // no sessionToken or authToken passed',
      'spawnSubAgent({ task, model })  // session context not forwarded',
    ],
    goodExample: 'Agent({ prompt: "review this file", sessionToken: ctx.sessionToken, userId: ctx.userId })',
    badExample: 'Agent({ prompt: subTask })  // sub-agent acts without user auth context — actions unattributable',
    relatedPlaybooks: ['agent-security.md'],
    relatedAgents: ['security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of input.changedFiles ?? []) {
      if (!/\.(ts|tsx|js|jsx)$/.test(cf.path)) continue;
      const lines = cf.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bAgent\s*\(\s*\{/.test(line) && !/sessionToken|authToken|Authorization|token/.test(line)) {
          findings.push(f('agent_cross_agent_auth_missing', 'HIGH',
            'Sub-agent spawned without session token forwarding — creates auth gap in agent chain',
            'Pass sessionToken or Authorization context when spawning sub-agents',
            cf.path));
          break;
        }
      }
    }
    return findings;
  },
};

const AGNT_029: ThesmosRule = {
  id: 'AGNT_029',
  category: 'agent_pii_in_context_window',
  severity: 'MEDIUM',
  description: 'Agent context assembler may concatenate raw PII fields into the context window.',
  tags: ['agent', 'pii', 'gdpr', 'privacy'],
  frameworks: ['gdpr', 'hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Raw PII included in an LLM context window is transmitted to the model provider and may appear in training data, logs, or debug outputs. GDPR Art. 5(1)(c) data minimisation and HIPAA minimum necessary rules require that only necessary data is disclosed — redact before including in context.',
    commonViolations: [
      'const ctx = `User: ${user.email}, Phone: ${user.phone}`;  // raw PII in context string',
      'messages.push({ role: "user", content: `Patient DOB: ${patient.dateOfBirth}` })',
    ],
    goodExample: 'const ctx = `User ID: ${user.id}`;  // reference by ID, not PII fields\nconst ctx2 = `User: ${redact(user.email)}`;  // or redact',
    badExample: 'const prompt = `${user.firstName} ${user.lastName} ${user.ssn} — should I approve the loan?`;',
    relatedPlaybooks: ['gdpr.md', 'hipaa.md'],
    relatedAgents: ['security-reviewer', 'compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    const PII_FIELDS_RE = /\b(email|phone|ssn|dateOfBirth|creditCard|password|address)\s*[+:]/i;
    for (const cf of input.changedFiles ?? []) {
      if (!/\.(ts|tsx|js|jsx)$/.test(cf.path)) continue;
      if (!/(context|prompt|message)\s*[+=]/.test(cf.content)) continue;
      if (PII_FIELDS_RE.test(cf.content)) {
        findings.push(f('agent_pii_in_context_window', 'MEDIUM',
          'Agent context assembler concatenates raw PII fields — data leaks into LLM context window',
          'Redact or mask PII fields (email, phone, SSN, etc.) before including in agent context',
          cf.path));
      }
    }
    return findings;
  },
};

const AGNT_030: ThesmosRule = {
  id: 'AGNT_030',
  category: 'agent_no_rollback_plan',
  severity: 'MEDIUM',
  description: 'Autopilot config has no rollbackStrategy — no recovery path if agent breaks production.',
  tags: ['agent', 'autopilot', 'resilience', 'dora'],
  frameworks: ['dora', 'nist-ai-rmf'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'DORA requires that automated change processes include recovery mechanisms. An agent operating in autopilot mode with no rollbackStrategy has no defined path to undo harmful changes — a single bad commit or deploy can leave production in an unknown state with no recovery plan.',
    commonViolations: [
      '{ "autopilot": { "enabled": true } }  // no rollbackStrategy defined',
      '{ "autopilot": { "enabled": true, "rollbackStrategy": "" } }  // empty rollback',
    ],
    goodExample: '{ "autopilot": { "enabled": true, "rollbackStrategy": "git-revert", "maxChangesPerRun": 3, "requiresApproval": true } }',
    badExample: '{ "autopilot": { "enabled": true, "autoMerge": true } }  // auto-merges with no rollback or approval gate',
    relatedPlaybooks: ['agent-security.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const configContent = contentOf(input, 'config.json');
    if (!configContent) return [];
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const config = parseJson(configContent);
    if (!config) return [];
    const autopilot = config.autopilot as Record<string, unknown> | undefined;
    if (!autopilot) return [];
    if (!autopilot.rollbackStrategy) {
      return [f('agent_no_rollback_plan', 'MEDIUM',
        'Autopilot config has no rollbackStrategy — no recovery path if agent breaks production',
        'Add "rollbackStrategy": "git-revert" (or "branch-delete" | "manual") to autopilot config',
        configFile.path)];
    }
    return [];
  },
};

// ── Rule: AGNT_031 — model/task-depth mismatch ────────────────────────────────

const AGNT_031: ThesmosRule = {
  id: 'AGNT_031',
  category: 'agent_model_task_depth_mismatch',
  severity: 'MEDIUM',
  description: 'Agent model tier does not match task depth — orchestrators need high-reasoning models; bulk/routine agents must not burn premium models.',
  tags: ['agent', 'pantheon', 'cost', 'routing'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Overusing deep-reasoning models increases spend without improving simple task outcomes; underpowering an orchestrator degrades every downstream routing decision. Model selection must match task depth.',
    commonViolations: [
      'Orchestrator agent pinned to a haiku-class model',
      'Bulk-processing agent pinned to a fable/opus-class model',
    ],
    goodExample: 'platforms:\n  claude_model: claude-fable-5   # orchestration agent\n---\nplatforms:\n  claude_model: claude-sonnet-5  # implementation agent',
    badExample: 'platforms:\n  claude_model: claude-haiku-4-5 # on a Zeus-style orchestrator',
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of input.changedFiles ?? []) {
      if (!cf.path.includes('catalog/agents') || !cf.path.endsWith('.md')) continue;
      const model = cf.content.match(/claude_model:\s*(\S+)/)?.[1] ?? '';
      const isOrchestrator = /tags:[\s\S]{0,200}?-\s*(orchestration|executive)/.test(cf.content);
      const isBulk = /tags:[\s\S]{0,200}?-\s*(bulk|batch|throughput)/.test(cf.content);
      if (isOrchestrator && model.includes('haiku')) {
        findings.push(f('agent_model_task_depth_mismatch', 'MEDIUM',
          'Orchestration agent pinned to a haiku-class model — routing quality degrades',
          'Use claude-fable-5 or claude-opus-class for orchestration/planning agents',
          cf.path));
      }
      if (isBulk && (model.includes('fable') || model.includes('opus'))) {
        findings.push(f('agent_model_task_depth_mismatch', 'MEDIUM',
          'Bulk-processing agent pinned to a premium reasoning model — cost without benefit',
          'Use claude-sonnet-5 or claude-haiku-4-5 for bulk/routine agents',
          cf.path));
      }
    }
    return findings;
  },
};

// ── Rule: AGNT_032 — routing doctrine missing tier rules ──────────────────────

const AGNT_032: ThesmosRule = {
  id: 'AGNT_032',
  category: 'agent_routing_no_tier_doctrine',
  severity: 'MEDIUM',
  description: 'Agent routing table exists but no tier doctrine — single-domain tasks may over-spawn councils.',
  tags: ['agent', 'pantheon', 'routing', 'cost'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Without an explicit tier doctrine (most tasks → one specialist; councils are the exception), an orchestrating assistant defaults to spawning multiple agents per prompt — cost and latency multiply with no quality gain on single-domain tasks.',
    commonViolations: ['CLAUDE.md has an agent routing table but no single-vs-council rules'],
    goodExample: '**Tier doctrine:** most tasks belong to ONE specialist... Councils are the exception.',
    badExample: '(routing table present, no doctrine about when NOT to spawn)',
  },
  detect(input: DetectInput): Finding[] {
    const claudeMd = input.changedFiles?.find((cf) => cf.path === 'CLAUDE.md' || cf.path.endsWith('/CLAUDE.md'));
    if (!claudeMd) return [];
    const hasRoutingTable = /Auto-invoke|Automatic Agent Routing/i.test(claudeMd.content);
    if (!hasRoutingTable) return [];
    const hasTierDoctrine = /ONE specialist|single-domain task|councils are the exception/i.test(claudeMd.content);
    if (!hasTierDoctrine) {
      return [f('agent_routing_no_tier_doctrine', 'MEDIUM',
        'Agent routing table present but no tier doctrine — councils may spawn for single-domain tasks',
        'Add tier doctrine: most tasks route to ONE specialist; councils only for genuinely cross-domain work',
        claudeMd.path)];
    }
    return [];
  },
};

// ── Rule: AGNT_033 — full council has no intent gate ──────────────────────────

const AGNT_033: ThesmosRule = {
  id: 'AGNT_033',
  category: 'agent_full_council_no_intent_gate',
  severity: 'MEDIUM',
  description: 'Routing config has no councilConfirmThreshold — mass agent spawns need explicit user intent.',
  tags: ['agent', 'pantheon', 'routing', 'cost'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'A full council (4+ agents) multiplies token cost per prompt. Without a confirmation threshold, an ambiguous prompt can silently fan out to the whole pantheon.',
    commonViolations: ['{ "routing": { "mode": "auto" } }  // no councilConfirmThreshold'],
    goodExample: '{ "routing": { "mode": "auto", "councilConfirmThreshold": 4 } }',
    badExample: '{ "routing": { "mode": "auto" } }',
  },
  detect(input: DetectInput): Finding[] {
    const configFile = findFile(input, 'config.json');
    if (!configFile?.path.includes('.thesmos')) return [];
    const config = parseJson(configFile.content);
    if (!config) return [];
    const routing = config.routing as Record<string, unknown> | undefined;
    if (!routing) return [];
    if (typeof routing.councilConfirmThreshold !== 'number') {
      return [f('agent_full_council_no_intent_gate', 'MEDIUM',
        'routing config has no councilConfirmThreshold — full councils can spawn without user confirmation',
        'Add "councilConfirmThreshold": 4 to the routing block',
        configFile.path)];
    }
    return [];
  },
};

// ── Rule: AGNT_034 — planning/execution model split undocumented ──────────────

const AGNT_034: ThesmosRule = {
  id: 'AGNT_034',
  category: 'agent_planning_execution_split_missing',
  severity: 'MEDIUM',
  description: 'Governance docs do not document the planning-vs-execution model split — deep models produce specs, fast models produce changes.',
  tags: ['agent', 'pantheon', 'cost', 'doctrine'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Teams that document "planning uses deep models, execution uses fast models" consistently avoid the two failure modes: premium models grinding through mechanical edits, and fast models making architectural calls.',
    commonViolations: ['GUARDRAILS.md or CLAUDE.md never mentions model selection doctrine'],
    goodExample: 'Use Fable for system planning; use Sonnet for implementation.',
    badExample: '(no model-selection guidance anywhere in governance docs)',
  },
  detect(input: DetectInput): Finding[] {
    const guardrails = input.changedFiles?.find((cf) => cf.path.endsWith('GUARDRAILS.md'));
    if (!guardrails) return [];
    const hasDoctrine = /planning.*model|model.*task depth|deep model|reasoning model/i.test(guardrails.content);
    if (!hasDoctrine) {
      return [f('agent_planning_execution_split_missing', 'MEDIUM',
        'GUARDRAILS.md has no model-selection doctrine — planning/execution model split undocumented',
        'Document: high-reasoning models for planning/orchestration; fast models for implementation and bulk work',
        guardrails.path)];
    }
    return [];
  },
};

// ── Rule: AGNT_035 — bulk processing on premium model ─────────────────────────

const AGNT_035: ThesmosRule = {
  id: 'AGNT_035',
  category: 'agent_bulk_on_premium_model',
  severity: 'MEDIUM',
  description: 'Batch/bulk processing code pins a premium reasoning model — throughput work belongs on fast models.',
  tags: ['agent', 'cost', 'models'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Bulk pipelines multiply per-call cost by volume. A premium reasoning model on a classification or extraction loop can cost 10x a fast model with no measurable quality gain.',
    commonViolations: ["for (const item of items) { await llm.complete({ model: 'claude-fable-5', ... }) }"],
    goodExample: "model: 'claude-haiku-4-5'  // bulk classification loop",
    badExample: "model: 'claude-fable-5'    // inside a 10,000-item batch loop",
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of input.changedFiles ?? []) {
      if (!/\.(ts|js|py)$/.test(cf.path)) continue;
      const lines = cf.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/(model['"]?\s*[:=]\s*['"])(claude-fable|claude-opus|gpt-5\.5-pro)/.test(line)) continue;
        const context = lines.slice(Math.max(0, i - 10), i).join('\n');
        if (/\bfor\s*\(|\.map\s*\(|\bwhile\s*\(|batch|bulk/i.test(context)) {
          findings.push({ ...f('agent_bulk_on_premium_model', 'MEDIUM',
            'Premium reasoning model pinned inside a loop/batch context — throughput work belongs on fast models',
            'Use a fast model (haiku/sonnet-class) for bulk processing; reserve premium models for planning',
            cf.path), line: i + 1 });
        }
      }
    }
    return findings;
  },
};

// ── Rule: AGNT_036 — agent output has no ownership declaration ────────────────

const AGNT_036: ThesmosRule = {
  id: 'AGNT_036',
  category: 'agent_output_no_ownership',
  severity: 'MEDIUM',
  description: 'Agent definition missing identity/ownership protocol — every agent must declare who speaks, its scope, and its signature.',
  tags: ['agent', 'pantheon', 'governance', 'identity'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Auditable multi-agent systems require every output to name its owner and scope. An agent definition without a Response Identity Protocol produces anonymous work that cannot be attributed or audited in a council.',
    commonViolations: ['Agent .md file with no Response Identity Protocol section'],
    goodExample: '## Response Identity Protocol\nOpen every response with your banner; close with your signature.',
    badExample: '(agent definition with methodology but no identity protocol)',
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of input.changedFiles ?? []) {
      if (!cf.path.includes('catalog/agents') || !cf.path.endsWith('.md') || cf.path.includes('README')) continue;
      if (!/Response Identity Protocol|Anti-Drift Protocol/.test(cf.content)) {
        findings.push(f('agent_output_no_ownership', 'MEDIUM',
          'Agent definition has no Response Identity Protocol — outputs cannot be attributed in a council',
          'Add the Response Identity Protocol (banner + signature) or regenerate via the export pipeline which injects it',
          cf.path));
      }
    }
    return findings;
  },
};

// ── Rule: AGNT_037 — 1M context window guard ──────────────────────────────────

const AGNT_037: ThesmosRule = {
  id: 'AGNT_037',
  category: 'agent_context_1m_unguarded',
  severity: 'HIGH',
  description: '1M context window enabled ([1m] model variant or context-1m beta flag) without context1M.allow1M — premium long-context pricing; cost runaway risk.',
  tags: ['agent', 'cost', 'models', 'context'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Long-context requests above the standard window bill at premium rates. The 1M window must be a deliberate, visible choice — set context1M.allow1M in .thesmos/config.json — never a silent default in an agent file or settings.',
    commonViolations: [
      "model: claude-fable-5[1m]  // in agent frontmatter or settings",
      "'anthropic-beta': 'context-1m-2025-08-07'",
    ],
    goodExample: '{ "context1M": { "allow1M": true } }  // deliberate opt-in in .thesmos/config.json',
    badExample: 'claude-fable-5[1m] with no context1M block in config',
  },
  detect(input: DetectInput): Finding[] {
    // Read the toggle from the live config (root), falling back to changedFiles.
    let allow1M = false;
    const cfgFile = findFile(input, 'config.json');
    if (cfgFile?.path.includes('.thesmos')) {
      const cfg = parseJson(cfgFile.content);
      allow1M = Boolean((cfg?.context1M as Record<string, unknown> | undefined)?.allow1M);
    } else {
      const root = input.root ?? process.cwd();
      const p = join(root, '.thesmos', 'config.json');
      if (existsSync(p)) {
        try {
          const cfg = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
          allow1M = Boolean((cfg.context1M as Record<string, unknown> | undefined)?.allow1M);
        } catch { /* default false */ }
      }
    }

    const severity: Finding['severity'] = allow1M ? 'LOW' : 'HIGH';
    const findings: Finding[] = [];
    for (const cf of input.changedFiles ?? []) {
      if (!/\.(md|json|ts|js|jsonc|yaml|yml)$/.test(cf.path)) continue;
      const lines = cf.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\[1m\]|context-1m-\d{4}/.test(lines[i])) {
          findings.push({ ...f('agent_context_1m_unguarded', severity,
            allow1M
              ? '1M context window in use (context1M.allow1M is enabled — informational)'
              : '1M context window enabled without context1M.allow1M — premium long-context pricing',
            allow1M
              ? 'Intentional per config — monitor spend via thesmos tokens report'
              : 'Remove the [1m] suffix / context-1m flag, or deliberately enable via "context1M": { "allow1M": true } in .thesmos/config.json',
            cf.path), line: i + 1 });
        }
      }
    }
    return findings;
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const AGENT_RULES: ThesmosRule[] = [
  AGNT_001,
  AGNT_002,
  AGNT_003,
  AGNT_004,
  AGNT_005,
  AGNT_006,
  AGNT_007,
  AGNT_008,
  AGNT_009,
  AGNT_010,
  AGNT_011,
  AGNT_012,
  AGNT_013,
  AGNT_014,
  AGNT_015,
  AGNT_016,
  AGNT_017,
  AGNT_018,
  AGNT_019,
  AGNT_020,
  AGNT_021,
  AGNT_022,
  AGNT_023,
  AGNT_024,
  AGNT_025,
  AGNT_026,
  AGNT_027,
  AGNT_028,
  AGNT_029,
  AGNT_030,
  AGNT_031,
  AGNT_032,
  AGNT_033,
  AGNT_034,
  AGNT_035,
  AGNT_036,
  AGNT_037,
];
