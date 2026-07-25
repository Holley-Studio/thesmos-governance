# Claude Code Setup Guide

## Install a God Agent in Claude Code

Claude Code supports agents via the `.claude/agents/` directory. Each `.md` file in that directory becomes an available agent.

### Step 1: Locate the files

Your kit's `claude-code/` folder contains 34 `.md` files — one per God Agent.

### Step 2: Install via Thesmos (recommended)

If you have `thesmos-governance` installed, use the managed install path:

```bash
# Install all agents in a directory (non-recursive, sorted order)
thesmos agent:install claude-code/

# Or install a single agent
thesmos agent:install claude-code/zeus-executive-agent.md
```

This copies each file to `.thesmos/agents/<id>.md` (the canonical source), registers it in `.thesmos/registry.json`, and regenerates platform adapter files — including `.claude/agents/` — automatically.

Preview what would happen without making changes:

```bash
thesmos agent:install claude-code/ --dry-run
```

### Step 2 (alternative): Direct copy — platform-specific fallback

If you are not using `thesmos-governance`, copy files directly:

```bash
# Install all agents (bypasses Thesmos governance)
cp -r claude-code/* .claude/agents/

# Or install a single agent
cp claude-code/zeus-executive-agent.md .claude/agents/
```

> **Note:** Files placed directly in `.claude/agents/` are not tracked by Thesmos and will not appear in governance reports or registry. Use the managed path above when Thesmos is installed.

### Step 3: Invoke an agent in Claude Code

```
# In Claude Code, agents are invoked by name
/agent zeus-executive-agent

# Or use the Task tool with the agent's name
God Agent Zeus, I need to prioritize our Q3 roadmap.
```

### Step 4: Verify the Thesmos governance

```bash
npm install --save-dev thesmos-governance
thesmos adapters
```

> **Recovery:** If adapter synchronization fails after `agent:install` or `agent:create`, the canonical file and registry entry are preserved. Run `thesmos adapters` to retry synchronization.

## Custom Agents

To scaffold your own agent with governance:

```bash
# Creates .thesmos/agents/my-agent.md and registers it
thesmos agent:create "My Agent"

# Install an existing .md file
thesmos agent:install path/to/my-agent.md
```

Edit the generated file in `.thesmos/agents/`, then run `thesmos adapters` to propagate changes to `.claude/agents/` and other platforms.

---

## Governance hooks (cross-platform guard)

```bash
thesmos claude:govern install
thesmos claude:govern status
```

**Source of truth:** `node dist/thesmos-guard.js <check|budget-check|drift>`. Install writes Node-direct commands (quoted `process.execPath` + absolute entry). Thin wrappers `thesmos/bin/thesmos-guard.sh` / `.cmd` only forward to that entry — optional for manual invoke.

| Platform | Needs Bash / WSL? | How hooks run |
|---|---|---|
| Windows | No | Node-direct (or `.cmd` wrapper) |
| macOS / Linux | No for guard | Node-direct (or `.sh` wrapper) |

**`autoMode.failClosed` (default `true`):** malformed hook stdin, unreadable/malformed `.thesmos/config.json`, or internal guard exceptions exit `2` and block the tool call. Diagnose from stderr (resolved path, category, checklist). Explicit opt-out only:

```json
{ "autoMode": { "failClosed": false } }
```

**Config repair escape hatch:** if `.thesmos/config.json` is malformed, Write/Edit of that file alone is still allowed (so the agent can self-heal). Other tools stay blocked until config parses again. Invalid project `package.json` does **not** trigger Guard failClosed — but Node itself may refuse to start tools when the project cwd has a broken `package.json` (`ERR_INVALID_PACKAGE_CONFIG`); fix that file outside the agent if hooks never fire.

Legitimate allows (not infrastructure failures): unknown tool names, empty file content, ignored extensions, empty Bash command, clean findings, Write/Edit repair of a broken `.thesmos/config.json`. Scope `requires_confirmation` violations surface as Claude Code ask decisions (recoverable), not hard exit 2.

**Statusline** (`.claude/statusline-pantheon.sh`) still requires Bash — it is not on the PreToolUse critical path.

## Tips

- Install Zeus first — he orchestrates the other 33 agents
- Read `setup/zeus-orchestration-guide.md` before your first session
- Agents persist across Claude Code sessions once installed
- Use `God Agent [Name]` as the invocation prefix for the best results

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
