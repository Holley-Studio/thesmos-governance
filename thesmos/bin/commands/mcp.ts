// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos mcp:serve   — start the MCP server (stdio JSON-RPC 2.0)
 * thesmos mcp:install — add thesmos to ~/.claude/settings.json as an MCP server
 * thesmos mcp:status  — show whether MCP server is configured in Claude settings
 *
 * After install, Claude Code automatically spawns the server and exposes
 * scan_file, explain_rule, get_health, lint_commit, and get_context as tools.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { startMcpServer } from '../../mcp-server.ts';

const GLOBAL_SETTINGS = join(homedir(), '.claude', 'settings.json');
const SERVER_NAME = 'thesmos-governance';

function resolveThesmos(): string {
  // Prefer a globally installed binary, fall back to npx
  try {
    const p = execSync('which thesmos', { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch { /* not found globally */ }
  return 'npx thesmos';
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function writeSettings(path: string, data: Record<string, unknown>): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export async function cmdMcp(argv: string[]): Promise<void> {
  const sub = argv[0];
  const root = process.cwd();

  switch (sub) {
    case 'serve': {
      startMcpServer(root);
      break;
    }

    case 'install': {
      const bin = resolveThesmos();
      const settings = readSettings(GLOBAL_SETTINGS);
      const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;

      mcpServers[SERVER_NAME] = {
        command: bin,
        args: ['mcp:serve'],
        env: {},
      };

      settings.mcpServers = mcpServers;
      writeSettings(GLOBAL_SETTINGS, settings);

      process.stdout.write(`\nThesmos MCP Server installed\n\n`);
      process.stdout.write(`  Config:  ${GLOBAL_SETTINGS}\n`);
      process.stdout.write(`  Command: ${bin} mcp:serve\n\n`);
      process.stdout.write(`Claude Code will now call scan_file() before writing or editing files.\n`);
      process.stdout.write(`Restart Claude Code to activate.\n\n`);
      process.stdout.write(`Available MCP tools:\n`);
      process.stdout.write(`  scan_file(path, content)  → governance findings before write\n`);
      process.stdout.write(`  explain_rule(ruleId)       → rule explanation + fix examples\n`);
      process.stdout.write(`  get_health()               → score 0-100 + priority actions\n`);
      process.stdout.write(`  lint_commit(message)       → commit message validation\n`);
      process.stdout.write(`  get_context()              → project governance context\n\n`);
      break;
    }

    case 'uninstall': {
      const settings = readSettings(GLOBAL_SETTINGS);
      const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
      if (SERVER_NAME in mcpServers) {
        delete mcpServers[SERVER_NAME];
        settings.mcpServers = mcpServers;
        writeSettings(GLOBAL_SETTINGS, settings);
        process.stdout.write(`Thesmos MCP Server removed from ${GLOBAL_SETTINGS}\n`);
      } else {
        process.stdout.write(`Thesmos MCP Server is not installed in ${GLOBAL_SETTINGS}\n`);
      }
      break;
    }

    case 'status': {
      const settings = readSettings(GLOBAL_SETTINGS);
      const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
      const installed = SERVER_NAME in mcpServers;
      const entry = mcpServers[SERVER_NAME] as { command?: string } | undefined;

      process.stdout.write(`\nThesmos MCP Server Status\n\n`);
      process.stdout.write(`  Installed:  ${installed ? '✓ yes' : '✗ no'}\n`);
      process.stdout.write(`  Settings:   ${GLOBAL_SETTINGS}\n`);
      if (installed && entry) {
        process.stdout.write(`  Command:    ${entry.command ?? '(unknown)'}\n`);
      }
      if (!installed) {
        process.stdout.write(`\n  Run 'thesmos mcp:install' to enable.\n`);
      }
      process.stdout.write('\n');
      break;
    }

    default: {
      process.stderr.write(`Usage: thesmos mcp:<serve|install|uninstall|status>\n`);
      process.exit(1);
    }
  }
}
