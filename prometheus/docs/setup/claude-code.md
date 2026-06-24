# Claude Code Setup Guide

## Install a God Agent in Claude Code

Claude Code supports agents via the `.claude/agents/` directory. Each `.md` file in that directory becomes an available agent.

### Step 1: Locate the files

Your kit's `claude-code/` folder contains 34 `.md` files — one per God Agent.

### Step 2: Copy to your project

```bash
# Install all 38 agents
cp -r claude-code/* .claude/agents/

# Or install a single agent
cp claude-code/zeus-executive-agent.md .claude/agents/
```

### Step 3: Invoke an agent in Claude Code

```
# In Claude Code, agents are invoked by name
/agent zeus-executive-agent

# Or use the Task tool with the agent's name
God Agent Zeus, I need to prioritize our Q3 roadmap.
```

### Step 4: Verify the Prometheus governance

If you have `prometheus-governance` installed, every agent output is automatically governed:

```bash
npm install --save-dev prometheus-governance
prometheus adapters
```

## Tips

- Install Zeus first — he orchestrates the other 33 agents
- Read `setup/zeus-orchestration-guide.md` before your first session
- Agents persist across Claude Code sessions once installed
- Use `God Agent [Name]` as the invocation prefix for the best results

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
