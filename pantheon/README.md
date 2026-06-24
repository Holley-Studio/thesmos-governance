# The Thesmos Pantheon

**21 governed AI business agents. Every function. Every platform.**

Named after Greek gods. Built on Thesmos governance. Downloadable for Claude, ChatGPT, Gemini, Cursor, and GitHub Copilot — with no install required.

---

## The Team

| Agent | God | Role |
|---|---|---|
| [`zeus-executive-agent`](agents/zeus-executive-agent.md) | Zeus | Executive orchestration |
| [`athena-strategy-agent`](agents/athena-strategy-agent.md) | Athena | Business strategy & GTM |
| [`hermes-marketing-agent`](agents/hermes-marketing-agent.md) | Hermes | Marketing strategy |
| [`nike-leadgen-agent`](agents/nike-leadgen-agent.md) | Nike | Lead generation & pipeline |
| [`ares-sales-agent`](agents/ares-sales-agent.md) | Ares | Sales & closing |
| [`apollo-content-agent`](agents/apollo-content-agent.md) | Apollo | Content & copywriting |
| [`aphrodite-creative-agent`](agents/aphrodite-creative-agent.md) | Aphrodite | Creative direction & brand |
| [`hephaestus-design-agent`](agents/hephaestus-design-agent.md) | Hephaestus | UI/UX & design systems |
| [`iris-photography-agent`](agents/iris-photography-agent.md) | Iris | Photography direction |
| [`morpheus-animation-agent`](agents/morpheus-animation-agent.md) | Morpheus | Animation & motion |
| [`dionysus-video-agent`](agents/dionysus-video-agent.md) | Dionysus | Video production |
| [`argus-security-agent`](agents/argus-security-agent.md) | Argus | Security & threat modeling |
| [`hestia-cx-agent`](agents/hestia-cx-agent.md) | Hestia | Customer experience |
| [`tyche-analytics-agent`](agents/tyche-analytics-agent.md) | Tyche | Analytics & KPIs |
| [`mnemosyne-knowledge-agent`](agents/mnemosyne-knowledge-agent.md) | Mnemosyne | Knowledge management |
| [`themis-legal-agent`](agents/themis-legal-agent.md) | Themis | Legal & contracts |
| [`plutus-finance-agent`](agents/plutus-finance-agent.md) | Plutus | Finance & pricing |
| [`pheme-pr-agent`](agents/pheme-pr-agent.md) | Pheme | PR & communications |
| [`hera-operations-agent`](agents/hera-operations-agent.md) | Hera | Operations & HR |
| [`daedalus-product-agent`](agents/daedalus-product-agent.md) | Daedalus | Product management |
| [`heracles-bd-agent`](agents/heracles-bd-agent.md) | Heracles | Business development |

---

## Quick Start

### Install all 21 agents (developers)

```bash
npm install -g thesmos-governance
thesmos pantheon:install --all
thesmos pantheon:export --target=claude-code
```

### Download without installing

Pick any agent from the platform-specific export directories:

| Platform | Directory |
|---|---|
| Claude Code | [exports/claude-code/](exports/claude-code/) |
| ChatGPT | [exports/chatgpt/](exports/chatgpt/) |
| Cursor | [exports/cursor/](exports/cursor/) |
| Gemini | [exports/gemini/](exports/gemini/) |
| GitHub Copilot | [exports/copilot/](exports/copilot/) |
| OpenAI Assistants API | [exports/openai-assistant/](exports/openai-assistant/) |

### Use Claude Code native agents

```bash
thesmos pantheon:export --target=claude-code
claude --agent=hermes-marketing-agent "Write a campaign brief for our product launch"
```

### Orchestrate the full team

```bash
thesmos pantheon:orchestrate "launch our developer tool to fintech CTOs"
```

Zeus automatically routes the task to the right specialists and outputs a structured brief.

---

## What Makes These Agents Different

**From generic AI prompts:**
- Each agent embeds a real professional methodology (SPIN Selling, MEDDPICC, OWASP Top 10, AIDA, Shape Up, etc.)
- Every agent knows which Thesmos governance rules apply to its domain
- Agents know who to delegate to and who they report to — they are a team
- Persistent memory via `thesmos pantheon:memory` — context survives between sessions

**From GPT Store agents:**
- Single source of truth → 7 platform exports from one file
- Zeus orchestration routes complex multi-domain tasks automatically
- Versioned and upgradeable via `thesmos pantheon:upgrade`
- Every output can be governance-certified via `thesmos certificate:generate`

---

## Zeus Orchestration

`thesmos pantheon:orchestrate` decomposes any business task and routes it to the right agents:

```
$ thesmos pantheon:orchestrate "launch our new developer tool to CTOs at fintech companies"

# Zeus Orchestration Brief
Task: launch our new developer tool to CTOs at fintech companies

## Athena — Strategy Agent
Sub-task: Define GTM positioning and competitive differentiation for fintech CTO audience...

## Hermes — Marketing Agent
Sub-task: Campaign strategy and channel mix for reaching fintech CTOs...

## Apollo — Content Agent
Sub-task: Landing page copy and email sequence targeting fintech CTOs...
```

No LLM call. No API cost. Static routing in under 500ms.

---

## Memory

Agents remember context across sessions:

```bash
thesmos pantheon:memory save --agent hermes "Client prefers direct, no-jargon copy"
thesmos pantheon:memory save --agent ares "Target buyer: VP Engineering, 50-200 person SaaS"
thesmos pantheon:memory show --agent hermes
```

---

## Platform Commands

```bash
thesmos pantheon:list                          # Show all 21 agents
thesmos pantheon:status                        # Show which agents are installed
thesmos pantheon:export --target=all           # Generate exports for all 7 platforms
thesmos pantheon:export --target=claude-code   # Generate .claude/agents/ files only
thesmos pantheon:orchestrate "<task>"          # Zeus routes task to agents
thesmos pantheon:memory save --agent <id> "<note>"
thesmos pantheon:upgrade                       # Check for newer agent versions
```

---

## File Structure

```
pantheon/
  README.md              ← this file
  AGENTS.md              ← full agent directory with routing table
  GUIDE.md               ← installation and usage guide (all platforms)
  CONTRIBUTING.md        ← how to add a new agent
  assets/
    avatars/             ← 21 SVG avatar files
  exports/
    claude-code/         ← 21 .md files for .claude/agents/
    chatgpt/             ← 21 .txt files for ChatGPT Custom GPT
    openai-assistant/    ← 21 .json files for Assistants API
    cursor/              ← 21 .mdc files for .cursor/rules/
    gemini/              ← 21 .txt files for Gemini Gems
    copilot/             ← 21 .instructions.md files
    claude-project/      ← 21 .txt files for Claude Projects

prometheus/catalog/agents/pantheon/
  *.md                   ← master agent definitions (source of truth)
```

---

## Documentation

- [GUIDE.md](GUIDE.md) — Complete installation guide for all platforms
- [AGENTS.md](AGENTS.md) — Full agent directory, routing table, governance rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to propose and add a new agent

---

Built on [Prometheus Governance](../thesmos/README.md) — the AI code governance package with 911 rules.
