# Thesmos MCP Server Setup

Thesmos ships a built-in MCP (Model Context Protocol) server that exposes governance tools directly to AI assistants. When wired up, the AI checks rules **before** writing or editing code — eliminating fix cycles and reducing token spend 40–60%.

## Tools Exposed

| Tool | Description |
|------|-------------|
| `scan_file(path, content)` | Check a file against all 1,075+ rules before Write/Edit |
| `explain_rule(ruleId)` | Get rule metadata, rationale, and code examples |
| `get_health()` | Fetch the current repo health score (0–100) |
| `lint_commit(message)` | Validate a commit message before committing |
| `get_context()` | Read `.thesmos/context.md` for project background |
| `debug_finding(findingId)` | Detailed trace of why a rule fired |
| `get_token_budget()` | Check remaining Claude Code token budget |
| `check_model_cost(tokens)` | Estimate cost for a given token count |
| `check_path(path)` | Verify a path is within the agent's allowed scope |

## Setup by Platform

### Claude Code (Recommended)

Run the built-in install command — it writes to `.claude/settings.json` automatically:

```bash
npx thesmos claude:govern install
```

To verify:
```bash
npx thesmos claude:govern status
```

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thesmos": {
      "command": "npx",
      "args": ["-y", "thesmos-governance", "mcp", "--stdio"],
      "description": "Repo governance: scan files, explain rules, check health"
    }
  }
}
```

Restart Claude Desktop to activate.

### Cursor

Add to `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "thesmos": {
      "command": "npx",
      "args": ["-y", "thesmos-governance", "mcp", "--stdio"]
    }
  }
}
```

Restart Cursor to activate.

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "thesmos": {
      "command": "npx",
      "args": ["-y", "thesmos-governance", "mcp", "--stdio"]
    }
  }
}
```

### VS Code (via extension)

Install the [Thesmos Governance VS Code extension](https://marketplace.visualstudio.com/items?itemName=holley-studios.thesmos-governance-vscode) — it handles MCP wiring automatically.

## Using a Local Install (Faster Startup)

If you have thesmos installed locally (`npm install --save-dev thesmos-governance`), use the local binary for faster startup:

```json
{
  "mcpServers": {
    "thesmos": {
      "command": "node",
      "args": ["./node_modules/thesmos-governance/dist/mcp-server.js"]
    }
  }
}
```

## Verifying the Connection

Once connected, ask your AI assistant:

> "Run `get_health()` and tell me my repo's governance score."

A healthy response looks like:
```json
{
  "score": 87,
  "grade": "B+",
  "findings": { "BLOCKER": 0, "HIGH": 2, "MEDIUM": 5, "LOW": 11 }
}
```

## Submitting to MCP Directories

To get listed in MCP discovery tools, submit a PR or listing to:

- **Official registry:** [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- **MCPFind:** [mcpfind.org](https://mcpfind.org) (auto-indexes npm packages with `mcp-server` keyword)
- **MCP Directory:** [mcpdirectory.app](https://mcpdirectory.app)
- **Smithery:** [smithery.ai](https://smithery.ai)
