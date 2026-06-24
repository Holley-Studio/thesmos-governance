# GitHub Copilot Setup Guide

## Use God Agents with GitHub Copilot

### Option A: Copilot Instructions File (VS Code)

GitHub Copilot in VS Code supports a `.github/copilot-instructions.md` file that shapes all Copilot responses in the workspace.

```bash
# Install a single agent as Copilot instructions
cp copilot/argus-security-agent.md .github/copilot-instructions.md

# Or create a combined file for multiple agents
cat copilot/zeus-executive-agent.md copilot/argus-security-agent.md > .github/copilot-instructions.md
```

### Option B: Copilot Chat System Prompt

In Copilot Chat (VS Code, GitHub.com, JetBrains):

1. Open the kit's `copilot/` folder
2. Copy the agent's `.md` content
3. Paste as the first message in a Copilot Chat session
4. Continue the session — the agent persona is now active

### Option C: GitHub Copilot Extensions (Enterprise)

For GitHub Enterprise users, God Agent instructions can be configured as organization-level Copilot policies. Contact your GitHub Enterprise admin to configure repository-level instructions.

---

## Tips

- The `.github/copilot-instructions.md` approach works best for engineering agents (Chiron, Talos, Kratos, Argus, Cassandra) since they're most relevant in a code editor context
- Business agents (Zeus, Athena, Ares) work better in Copilot Chat sessions
- Copilot instructions persist across VS Code sessions for the workspace

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
