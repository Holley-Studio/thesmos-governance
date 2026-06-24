# Cursor Setup Guide

## Install God Agents as Cursor Rules

Cursor supports AI rules via `.cursor/rules/` — project-level `.mdc` files that shape every AI response.

### Step 1: Locate the files

Your kit's `cursor/` folder contains 34 `.mdc` files.

### Step 2: Copy to your project

```bash
# Install all 38 agents as Cursor rules
cp -r cursor/* .cursor/rules/

# Or install a single agent
cp cursor/zeus-executive-agent.mdc .cursor/rules/
```

### Step 3: Enable in Cursor

1. Open Cursor Settings → Rules
2. Rules in `.cursor/rules/` are automatically detected
3. You can enable/disable individual rules from the panel

### Step 4: Invoke an agent

In Cursor's chat, reference the agent by name:
```
Using the Argus security agent rules, review this API route for OWASP vulnerabilities.
```

Or simply start a chat — if Zeus is installed, he will route to the right agent.

---

## Cursor-Specific Tips

- `.mdc` format supports frontmatter for rule metadata — all 38 files are pre-configured
- Agent rules persist across Cursor sessions once installed in `.cursor/rules/`
- Commit `.cursor/rules/` to your repo to share the Pantheon with your team (requires team licenses for all users)
- The `prometheus adapters` command can auto-sync rules: `prometheus adapters --targets cursor`

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
