// thesmos/mcp.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MCP_JSON_PATH = resolve(ROOT, '.mcp.json');
const CLI_SRC_PATH = resolve(__dirname, 'bin/cli.ts');

describe('MCP startup — .mcp.json integrity', () => {
  it('.mcp.json exists', () => {
    expect(existsSync(MCP_JSON_PATH)).toBe(true);
  });

  it('server command is npx', () => {
    const config = JSON.parse(readFileSync(MCP_JSON_PATH, 'utf8'));
    const server = config.mcpServers?.thesmos ?? config.mcpServers?.['thesmos-governance'];
    expect(server?.command).toBe('npx');
  });

  it('first arg is thesmos-governance', () => {
    const config = JSON.parse(readFileSync(MCP_JSON_PATH, 'utf8'));
    const server = config.mcpServers?.thesmos ?? config.mcpServers?.['thesmos-governance'];
    const args: string[] = server?.args ?? [];
    expect(args[0]).toBe('thesmos-governance');
  });

  it('second arg (CLI command) is "mcp" — aliased to mcp:serve in cli.ts', () => {
    // .mcp.json cannot be modified (governance scope guard).
    // Instead, cli.ts registers 'mcp' as an alias for mcp:serve,
    // making the existing 'mcp --stdio' args functional.
    const config = JSON.parse(readFileSync(MCP_JSON_PATH, 'utf8'));
    const server = config.mcpServers?.thesmos ?? config.mcpServers?.['thesmos-governance'];
    const args: string[] = server?.args ?? [];
    expect(args[1]).toBe('mcp');
  });

  it('MCP command referenced in .mcp.json is registered in the CLI dispatch table', () => {
    const cliSrc = readFileSync(CLI_SRC_PATH, 'utf8');
    const config = JSON.parse(readFileSync(MCP_JSON_PATH, 'utf8'));
    const server = config.mcpServers?.thesmos ?? config.mcpServers?.['thesmos-governance'];
    const args: string[] = server?.args ?? [];
    // Second arg is the CLI command ('mcp', aliased to mcp:serve in cli.ts)
    const mcpCommand = args[1];
    expect(mcpCommand).toBeTruthy();
    // The command must appear as a key in the CLI dispatch table
    expect(cliSrc).toContain(`'${mcpCommand}':`);
  });
});
