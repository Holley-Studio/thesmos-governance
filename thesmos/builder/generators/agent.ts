// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agent generator — creates Pantheon-style AI agent artifacts from wizard answers.
 *
 * Outputs:
 *   - .thesmos/catalog/agents/<name>.md  — agent definition + system prompt
 *   - .claude/commands/<name>.md            — Claude Code slash command
 *   - (optional) thesmos/agents/<name>.ts        — TypeScript skeleton
 *   - (optional) thesmos/agents/<name>.test.ts   — test scaffold
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WizardAnswers, WizardContext } from '../wizard.js';
import { makeLogger } from '../../logger.js';

const log = makeLogger('generator:agent');

export interface AgentArtifact {
  files: Array<{ path: string; content: string; label: string }>;
  agentName: string;
  agentSlug: string;
}

// ── System prompt template ────────────────────────────────────────────────────

function buildSystemPrompt(answers: WizardAnswers, context: WizardContext): string {
  const job = answers['job'] ?? 'assist with tasks';
  const trigger = answers['trigger'] ?? 'manual';
  const dataAccess = answers['dataAccess'] ?? 'code';
  const outputType = answers['outputType'] ?? 'report';
  const riskLevel = answers['riskLevel'] ?? 'low';
  const toolAccess = answers['toolAccess'] ?? 'none';
  const performance = answers['performance'] ?? 'background';
  const name = answers['name'] ?? 'custom-agent';
  const stack = context.detectedStack.join(', ') || 'unknown stack';

  const riskGuidance = riskLevel === 'high'
    ? 'CRITICAL: You MUST get explicit human approval before any action that modifies data, sends messages, or has external side effects. State what you plan to do and wait for confirmation.'
    : riskLevel === 'medium'
    ? 'Before taking any action that produces output visible to others, state your plan and give the user a chance to redirect.'
    : 'You are advisory. All output is informational only.';

  const toolGuidance = toolAccess === 'none'
    ? 'You operate on data provided at invocation. Do not attempt to access external systems.'
    : toolAccess === 'readonly'
    ? 'You may use read-only Thesmos tools (scan_file, explain_rule, get_context). Do not write files.'
    : 'You have full tool access. Use the minimum necessary. Prefer read before write.';

  const performanceGuidance = performance === 'interactive'
    ? 'Respond in under 3 seconds. If a task will take longer, return a preliminary answer and ask the user to wait.'
    : performance === 'background'
    ? 'This is a background job. Optimize for completeness, not speed. Show progress.'
    : 'This is a long-running analysis. Show periodic progress updates.';

  return [
    `# ${name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join(' ')} Agent`,
    '',
    `## Role`,
    `You are a specialized agent that: ${job}`,
    '',
    `## Context`,
    `Stack: ${stack}`,
    `Trigger: ${trigger}`,
    `Data access: ${dataAccess}`,
    `Output type: ${outputType}`,
    '',
    `## Operating constraints`,
    '',
    `**Risk level:** ${riskLevel.toUpperCase()}`,
    riskGuidance,
    '',
    `**Tool access:** ${toolAccess}`,
    toolGuidance,
    '',
    `**Performance target:** ${performance}`,
    performanceGuidance,
    '',
    `## What you produce`,
    `Your output is: ${outputType}`,
    '',
    outputType === 'report'
      ? `Format your output as a structured report:\n- Executive summary (1-3 sentences)\n- Key findings (bullet list)\n- Recommended actions (numbered, prioritized)\n- Next steps`
      : outputType === 'code'
      ? `Format output as code with:\n- Clear explanation of what changes are made\n- Before/after if modifying existing code\n- Tests you recommend running`
      : outputType === 'notification'
      ? `Format notifications as:\n- One-line subject\n- Summary paragraph\n- Action required (if any)`
      : `Return structured JSON with a "status" field and relevant data fields.`,
    '',
    `## Governance`,
    `This agent runs under Thesmos governance. Every action is subject to:`,
    `- Thesmos security rules (1,075+ rules active)`,
    `- Audit trail logging`,
    `- Human approval gates where risk level requires`,
    '',
    `If you detect a potential security issue in the data you're processing, report it before proceeding.`,
  ].join('\n');
}

// ── Agent catalog entry ───────────────────────────────────────────────────────

function buildAgentCatalog(answers: WizardAnswers, context: WizardContext, systemPrompt: string): string {
  const name = answers['name'] ?? 'custom-agent';
  const displayName = name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  const job = answers['job'] ?? 'assist with tasks';
  const trigger = answers['trigger'] ?? 'manual';
  const riskLevel = answers['riskLevel'] ?? 'low';
  const toolAccess = answers['toolAccess'] ?? 'none';

  return [
    '---',
    `id: ${name}`,
    `name: ${displayName}`,
    `type: specialist`,
    `version: 1.0.0`,
    `owner: ${context.projectName}`,
    `enabled: true`,
    '---',
    '',
    `# ${displayName}`,
    '',
    `## Overview`,
    job,
    '',
    `## Metadata`,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Trigger | ${trigger} |`,
    `| Risk level | ${riskLevel} |`,
    `| Tool access | ${toolAccess} |`,
    `| Stack | ${context.detectedStack.join(', ') || 'any'} |`,
    '',
    `## System Prompt`,
    '',
    '```',
    systemPrompt,
    '```',
    '',
    `## Usage`,
    '```bash',
    `# From terminal:`,
    `npx thesmos agent:run ${name}`,
    `npx thesmos agent:run ${name} --dry-run`,
    '',
    `# From Claude Code:`,
    `/${name}`,
    '```',
    '',
    `## Governance`,
    `- Generated by Thesmos Builder Wizard`,
    `- Governed by ${context.detectedStack.join(', ') || 'default'} rules`,
    `- Audit trail: enabled`,
    '',
    `*Generated by thesmos build:agent*`,
  ].join('\n');
}

// ── Claude Code slash command ─────────────────────────────────────────────────

function buildClaudeCommand(answers: WizardAnswers, systemPrompt: string): string {
  const name = answers['name'] ?? 'custom-agent';
  const displayName = name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  const job = answers['job'] ?? 'assist with tasks';

  return [
    `---`,
    `description: ${displayName} — ${job}`,
    `---`,
    '',
    systemPrompt,
    '',
    `---`,
    '',
    `*Thesmos-governed agent. Run \`thesmos self:check\` to verify governance is active.*`,
  ].join('\n');
}

// ── TypeScript skeleton ───────────────────────────────────────────────────────

function buildAgentTypescript(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'custom-agent';
  const camelName = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const PascalName = camelName[0]!.toUpperCase() + camelName.slice(1);
  const dataAccess = answers['dataAccess'] ?? 'code';
  const outputType = answers['outputType'] ?? 'report';

  return [
    `/**`,
    ` * ${PascalName}Agent — ${answers['job'] ?? 'custom agent'}`,
    ` *`,
    ` * Generated by thesmos build:agent`,
    ` * Governance: Thesmos 1,075+ rules active`,
    ` */`,
    '',
    `import { makeLogger } from '../logger.js';`,
    '',
    `const log = makeLogger('${name}');`,
    '',
    `export interface ${PascalName}Input {`,
    dataAccess === 'database' ? '  query?: string;' : '  files?: string[];',
    `  options?: Record<string, unknown>;`,
    `}`,
    '',
    `export interface ${PascalName}Output {`,
    outputType === 'report' ? '  summary: string;\n  findings: string[];\n  actions: string[];' : '  result: unknown;',
    `  agentId: string;`,
    `  timestamp: string;`,
    `}`,
    '',
    `export async function run${PascalName}(input: ${PascalName}Input): Promise<${PascalName}Output> {`,
    `  log.info('${name} started', { input });`,
    `  const t0 = Date.now();`,
    '',
    `  // TODO: implement ${answers['job'] ?? 'agent logic'}`,
    '',
    `  const output: ${PascalName}Output = {`,
    outputType === 'report'
      ? `    summary: 'Analysis complete',\n    findings: [],\n    actions: [],`
      : `    result: null,`,
    `    agentId: '${name}',`,
    `    timestamp: new Date().toISOString(),`,
    `  };`,
    '',
    `  log.info('${name} complete', { durationMs: Date.now() - t0 });`,
    `  return output;`,
    `}`,
  ].join('\n');
}

// ── Test scaffold ─────────────────────────────────────────────────────────────

function buildAgentTest(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'custom-agent';
  const camelName = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const PascalName = camelName[0]!.toUpperCase() + camelName.slice(1);

  return [
    `// @vitest-environment node`,
    `import { describe, it, expect } from 'vitest';`,
    `import { run${PascalName} } from './${name}.js';`,
    '',
    `describe('${name}', () => {`,
    `  it('runs without throwing', async () => {`,
    `    const output = await run${PascalName}({});`,
    `    expect(output).toBeDefined();`,
    `    expect(output.agentId).toBe('${name}');`,
    `    expect(output.timestamp).toBeDefined();`,
    `  });`,
    '',
    `  it('handles empty input gracefully', async () => {`,
    `    const output = await run${PascalName}({ options: {} });`,
    `    expect(output).toBeDefined();`,
    `  });`,
    `});`,
  ].join('\n');
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateAgent(
  answers: WizardAnswers,
  context: WizardContext,
  opts: { scaffold: boolean; planOnly: boolean },
): Promise<AgentArtifact> {
  const name = (answers['name'] ?? 'custom-agent').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  answers['name'] = name;

  const systemPrompt = buildSystemPrompt(answers, context);
  const catalogContent = buildAgentCatalog(answers, context, systemPrompt);
  const commandContent = buildClaudeCommand(answers, systemPrompt);

  const files: AgentArtifact['files'] = [
    {
      path: `.thesmos/catalog/agents/${name}.md`,
      content: catalogContent,
      label: 'Agent definition',
    },
    {
      path: `.claude/commands/${name}.md`,
      content: commandContent,
      label: 'Claude Code slash command',
    },
  ];

  if (opts.scaffold) {
    files.push({
      path: `thesmos/agents/${name}.ts`,
      content: buildAgentTypescript(answers),
      label: 'TypeScript implementation skeleton',
    });
    files.push({
      path: `thesmos/agents/${name}.test.ts`,
      content: buildAgentTest(answers),
      label: 'Test scaffold',
    });
  }

  log.info('agent generator complete', { name, files: files.length });
  return { files, agentName: name, agentSlug: name };
}

// ── Plan generator (--plan mode) ──────────────────────────────────────────────

export function generateAgentPlan(answers: WizardAnswers, context: WizardContext): string {
  const name = answers['name'] ?? 'custom-agent';
  const systemPrompt = buildSystemPrompt(answers, context);
  const job = answers['job'] ?? 'assist';
  const trigger = answers['trigger'] ?? 'manual';
  const riskLevel = answers['riskLevel'] ?? 'low';
  const outputType = answers['outputType'] ?? 'report';

  return [
    `# ${name} — Implementation Plan`,
    '',
    `## Agent purpose`,
    job,
    '',
    `## Architecture decisions`,
    '',
    `| Decision | Choice | Rationale |`,
    `|----------|--------|-----------|`,
    `| Trigger model | ${trigger} | Matches the stated run cadence |`,
    `| Risk level | ${riskLevel} | Determines approval gate requirements |`,
    `| Output format | ${outputType} | Matches downstream consumer needs |`,
    `| Tool access | ${answers['toolAccess'] ?? 'none'} | Minimum necessary for the job |`,
    `| Performance | ${answers['performance'] ?? 'background'} | Matches latency requirements |`,
    '',
    `## System Prompt`,
    '',
    systemPrompt,
    '',
    `## Implementation checklist`,
    '',
    `- [ ] Create .thesmos/catalog/agents/${name}.md`,
    `- [ ] Create .claude/commands/${name}.md`,
    `- [ ] Implement core logic in thesmos/agents/${name}.ts`,
    `- [ ] Write tests in thesmos/agents/${name}.test.ts`,
    `- [ ] Run governance scan: thesmos review thesmos/agents/${name}.ts`,
    `- [ ] Add to CI: thesmos agent:audit:log ${name}`,
    '',
    `## Security surface`,
    '',
    `Risk level: ${riskLevel.toUpperCase()}`,
    riskLevel === 'high' ? '⚠ REQUIRES explicit approval gate before any side effect.' : '',
    `- Scope all data access to read-only where possible`,
    `- Log all decisions to Thesmos audit trail`,
    `- Never store API keys or credentials in agent files`,
    '',
    `## Test scenarios`,
    '',
    `1. Happy path: ${job} with valid input`,
    `2. Empty input: agent handles gracefully`,
    `3. Invalid input: clear error message`,
    `4. ${riskLevel === 'high' ? 'Approval gate: confirm gate blocks without explicit approval' : 'Dry-run: --dry-run produces same output without side effects'}`,
    '',
    `---`,
    `*Generated by thesmos build:agent --plan*`,
    `*Run: thesmos build:agent --scaffold to write code files*`,
  ].join('\n');
}
