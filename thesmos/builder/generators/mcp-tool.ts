// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * MCP tool generator — creates a new Thesmos MCP server tool from wizard answers.
 *
 * Outputs (scaffold mode):
 *   - thesmos/mcp-tools/<name>.ts  — tool implementation
 *
 * Registration: add the tool definition + handler to thesmos/mcp-server.ts
 */

import type { WizardAnswers, WizardContext } from '../wizard.js';
import { makeLogger } from '../../logger.js';

const log = makeLogger('generator:mcp-tool');

export interface McpToolArtifact {
  files: Array<{ path: string; content: string; label: string }>;
  toolName: string;
}

// ── Tool implementation ───────────────────────────────────────────────────────

function buildMcpToolFile(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'custom-tool';
  const job = answers['job'] ?? 'perform a task for AI agents';
  const inputSchema = answers['inputSchema'] ?? 'input: string description of what to process';
  const returns = answers['returns'] ?? 'text';
  const sideEffects = answers['sideEffects'] ?? 'read-only';

  const camelName = name.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
  const PascalName = camelName[0]!.toUpperCase() + camelName.slice(1);

  const returnType = returns === 'findings'
    ? `Array<{ severity: string; file: string; message: string; suggestion?: string }>`
    : returns === 'file-list'
    ? `Array<{ path: string; size: number }>`
    : returns === 'json'
    ? `Record<string, unknown>`
    : `string`;

  const sideEffectsNote = sideEffects === 'read-only'
    ? '// Read-only: this tool does not modify any files or external state.'
    : sideEffects === 'writes-files'
    ? '// Side effect: this tool writes files. Log all writes for audit trail.'
    : '// Side effect: this tool calls an external API. Use BYOK key from env vars only.';

  return `/**
 * ${name} — Thesmos MCP tool
 * Purpose: ${job}
 * Side effects: ${sideEffects}
 *
 * To register, add to thesmos/mcp-server.ts:
 *   1. Import TOOL_DEF and handle${PascalName} from './mcp-tools/${name}.js'
 *   2. Add TOOL_DEF to TOOL_DEFINITIONS array
 *   3. Add case '${name}' to the tools/call switch
 */

import { makeLogger } from '../logger.js';

${sideEffectsNote}

const log = makeLogger('mcp-tool:${name}');

// ── Input schema ──────────────────────────────────────────────────────────────

export const TOOL_DEF = {
  name: '${name}',
  description: '${job}',
  inputSchema: {
    type: 'object' as const,
    properties: {
      // TODO: replace with real parameters based on: ${inputSchema}
      input: {
        type: 'string',
        description: '${inputSchema}',
      },
      options: {
        type: 'object',
        description: 'Optional configuration',
        additionalProperties: true,
      },
    },
    required: ['input'],
  },
};

// ── Handler ───────────────────────────────────────────────────────────────────

export interface ${PascalName}Params {
  input: string;
  options?: Record<string, unknown>;
}

export async function handle${PascalName}(
  params: ${PascalName}Params,
): Promise<${returnType}> {
  const { input, options = {} } = params;

  log.info('${name} invoked', { inputLength: input.length });
  const t0 = Date.now();

  // TODO: implement ${job}
  ${sideEffects === 'calls-external-api'
    ? `// BYOK: load API key from env var, never hardcode
  // const apiKey = process.env.YOUR_API_KEY;
  // if (!apiKey) throw new Error('YOUR_API_KEY env var required. Set in shell profile or CI secrets.');`
    : ''}
  ${returns === 'findings'
    ? `const findings: ${returnType} = [
    // TODO: populate from real analysis
    {
      severity: 'MEDIUM',
      file: input,
      message: '${name} analysis not yet implemented',
      suggestion: 'Implement the ${name} handler',
    },
  ];

  log.info('${name} complete', { durationMs: Date.now() - t0, findings: findings.length });
  return findings;`
    : returns === 'json'
    ? `const result: ${returnType} = {
    tool: '${name}',
    input,
    options,
    // TODO: add real result fields
  };

  log.info('${name} complete', { durationMs: Date.now() - t0 });
  return result;`
    : `const result = \`[TODO: implement ${name}] Received: \${input}\`;
  log.info('${name} complete', { durationMs: Date.now() - t0 });
  return result;`}
}
`;
}

// ── Registration snippet ───────────────────────────────────────────────────────

function buildRegistrationSnippet(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'custom-tool';
  const camelName = name.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
  const PascalName = camelName[0]!.toUpperCase() + camelName.slice(1);

  return `// ── Add to thesmos/mcp-server.ts ──────────────────────────────────────────
//
// 1. Import at the top:
//    import { TOOL_DEF as ${camelName}ToolDef, handle${PascalName} } from './mcp-tools/${name}.js';
//
// 2. Add to TOOL_DEFINITIONS array:
//    ${camelName}ToolDef,
//
// 3. Add to the tools/call switch:
//    case '${name}': {
//      const result = await handle${PascalName}(params as ${PascalName}Params);
//      return respond({ content: [{ type: 'text', text: JSON.stringify(result) }] }, req.id);
//    }
`;
}

// ── Plan generator ────────────────────────────────────────────────────────────

export function generateMcpToolPlan(answers: WizardAnswers, context: WizardContext): string {
  const name = answers['name'] ?? 'custom-tool';
  const displayName = name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  const job = answers['job'] ?? 'perform a task for AI agents';
  const inputSchema = answers['inputSchema'] ?? 'input string';
  const returns = answers['returns'] ?? 'text';
  const sideEffects = answers['sideEffects'] ?? 'read-only';

  return [
    `# ${displayName} — MCP Tool Implementation Plan`,
    '',
    `## Purpose`,
    `This MCP tool enables AI agents to: ${job}`,
    '',
    `## Architecture decisions`,
    '',
    `| Decision | Choice | Rationale |`,
    `|----------|--------|-----------|`,
    `| Input | ${inputSchema} | What AI agents pass in |`,
    `| Returns | ${returns} | What AI agents receive back |`,
    `| Side effects | ${sideEffects} | Determines blast radius and audit requirements |`,
    '',
    `## Files to create`,
    '',
    `- \`thesmos/mcp-tools/${name}.ts\` — tool implementation`,
    '',
    `## Registration steps`,
    '',
    `After creating the file, register in \`thesmos/mcp-server.ts\`:`,
    `1. Import \`TOOL_DEF\` and \`handle${name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join('')}\``,
    `2. Add \`TOOL_DEF\` to \`TOOL_DEFINITIONS\` array`,
    `3. Add \`case '${name}'\` to the \`tools/call\` switch`,
    '',
    `## Security considerations`,
    '',
    sideEffects === 'read-only'
      ? `- Read-only: minimal blast radius. Still validate and sanitize all inputs.`
      : sideEffects === 'writes-files'
      ? `- **File writes**: Log all writes to audit trail. Restrict to allowed directories only.`
      : `- **External API calls**: Use BYOK API keys from env vars only. Never hardcode.`,
    `- All inputs from AI agents are untrusted — validate before use`,
    `- Rate-limit tool calls in the MCP server to prevent runaway usage`,
    `- Log all invocations with makeLogger for audit trail`,
    '',
    `## Test scenarios`,
    '',
    `1. Happy path: valid input → expected output type (${returns})`,
    `2. Empty input: graceful error, not a crash`,
    `3. Invalid input type: clear error message`,
    sideEffects !== 'read-only' ? `4. Side effect failure: partial failure handled, no silent data corruption` : '',
    '',
    `---`,
    `*Generated by thesmos build:mcp-tool --plan*`,
    `*Run: thesmos build:mcp-tool --scaffold to write code files*`,
  ].filter((l) => l !== '').join('\n');
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateMcpTool(
  answers: WizardAnswers,
  context: WizardContext,
  opts: { scaffold: boolean; planOnly: boolean },
): Promise<McpToolArtifact> {
  const name = (answers['name'] ?? 'custom-tool').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  answers['name'] = name;

  const files: McpToolArtifact['files'] = [];

  if (opts.scaffold) {
    files.push({
      path: `thesmos/mcp-tools/${name}.ts`,
      content: buildMcpToolFile(answers),
      label: 'MCP tool implementation',
    });
    // Write registration snippet as a separate reference file
    files.push({
      path: `thesmos/mcp-tools/${name}-registration.md`,
      content: buildRegistrationSnippet(answers),
      label: 'Registration instructions for mcp-server.ts',
    });
  }

  log.info('mcp-tool generator complete', { name, files: files.length });
  return { files, toolName: name };
}
