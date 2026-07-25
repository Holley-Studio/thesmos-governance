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

## Governance hooks & fail-closed recovery

`autoMode.failClosed` (default `true`) makes the PreToolUse guard exit `2` and
block the tool call on malformed hook stdin, an unreadable/malformed
`.thesmos/config.json`, or an internal guard exception. Diagnose from stderr
(it prints the resolved path, category, and a checklist).

**Config repair escape hatch.** If `.thesmos/config.json` becomes malformed, the
guard would otherwise deadlock — every tool blocked, including the Write that
would fix the file. To avoid that, a `Write` or `Edit` of **that exact file** is
still allowed while config is broken; all other tools stay blocked until it
parses again. The exception is deliberately narrow and does **not** weaken
security:

- Only `.thesmos/config.json` itself qualifies — look-alike names
  (`config.json.bak`, `config-json`) and `..` traversal never do.
- A `config.json` reached through a **symlink** is refused (no link-follow
  write).
- The content scan still runs on the repair payload, so a "repair" that carries
  a secret or another BLOCKER is still rejected.

Invalid project `package.json` does **not** trigger this fail-closed path — but
Node itself may refuse to launch tools when the project cwd has a broken
`package.json` (`ERR_INVALID_PACKAGE_CONFIG`); fix that file outside the agent
if hooks never fire.

## Tips

- Install Zeus first — he orchestrates the other 33 agents
- Read `setup/zeus-orchestration-guide.md` before your first session
- Agents persist across Claude Code sessions once installed
- Use `God Agent [Name]` as the invocation prefix for the best results

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
