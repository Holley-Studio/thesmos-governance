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
import { existsSync } from 'node:fs';
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
];
