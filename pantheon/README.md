# The Thesmos Pantheon

**21 governed AI business agents. Every function. Every platform.**

Named after Greek gods. Built on Thesmos governance. Downloadable for Claude, ChatGPT, Gemini, Cursor, and GitHub Copilot — with no install required.

---

## The Team

| Agent | God | Role |
|---|---|---|
| [`zeus-executive-agent`](exports/claude-code/zeus-executive-agent.md) | Zeus | Executive orchestration |
| [`athena-strategy-agent`](exports/claude-code/athena-strategy-agent.md) | Athena | Business strategy & GTM |
| [`hermes-marketing-agent`](exports/claude-code/hermes-marketing-agent.md) | Hermes | Marketing strategy |
| [`nike-leadgen-agent`](exports/claude-code/nike-leadgen-agent.md) | Nike | Lead generation & pipeline |
| [`ares-sales-agent`](exports/claude-code/ares-sales-agent.md) | Ares | Sales & closing |
| [`apollo-content-agent`](exports/claude-code/apollo-content-agent.md) | Apollo | Content & copywriting |
| [`aphrodite-creative-agent`](exports/claude-code/aphrodite-creative-agent.md) | Aphrodite | Creative direction & brand |
| [`hephaestus-design-agent`](exports/claude-code/hephaestus-design-agent.md) | Hephaestus | UI/UX & design systems |
| [`artemis-photography-agent`](exports/claude-code/artemis-photography-agent.md) | Artemis | Photography direction |
| [`morpheus-animation-agent`](exports/claude-code/morpheus-animation-agent.md) | Morpheus | Animation & motion |
| [`dionysus-video-agent`](exports/claude-code/dionysus-video-agent.md) | Dionysus | Video production |
| [`argus-security-agent`](exports/claude-code/argus-security-agent.md) | Argus | Security & threat modeling |
| [`hestia-cx-agent`](exports/claude-code/hestia-cx-agent.md) | Hestia | Customer experience |
| [`tyche-analytics-agent`](exports/claude-code/tyche-analytics-agent.md) | Tyche | Analytics & KPIs |
| [`mnemosyne-knowledge-agent`](exports/claude-code/mnemosyne-knowledge-agent.md) | Mnemosyne | Knowledge management |
| [`themis-legal-agent`](exports/claude-code/themis-legal-agent.md) | Themis | Legal & contracts |
| [`plutus-finance-agent`](exports/claude-code/plutus-finance-agent.md) | Plutus | Finance & pricing |
| [`pheme-pr-agent`](exports/claude-code/pheme-pr-agent.md) | Pheme | PR & communications |
| [`hera-operations-agent`](exports/claude-code/hera-operations-agent.md) | Hera | Operations & HR |
| [`daedalus-product-agent`](exports/claude-code/daedalus-product-agent.md) | Daedalus | Product management |
| [`heracles-bd-agent`](exports/claude-code/heracles-bd-agent.md) | Heracles | Business development |

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

**Preferred:** install [`pantheon-plugin/`](../pantheon-plugin/) so agents are not copied into every repo. Invoke with scoped names such as `pantheon:hermes-marketing-agent`.

**Fallback:** ownership-aware sync into `.claude/agents/thesmos/` (never overwrites your external agents):

```bash
thesmos pantheon:install --all --write
thesmos adapters
thesmos agents:list --all
claude --agent=hermes-marketing-agent "Write a campaign brief for our product launch"
```

Custom agents under `.claude/agents/` coexist with Pantheon. Thesmos governs tool actions for all of them; it does not require registry membership before an agent can exist.

### Orchestrate the full team

```bash
thesmos pantheon:orchestrate "launch our developer tool to fintech CTOs"
```

Zeus routes to Pantheon specialists and may invoke external project, user, or plugin agents by their exact registered names when available.

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

thesmos/catalog/agents/pantheon/
  *.md                   ← master agent definitions (source of truth)
```

---

## Documentation

- [GUIDE.md](GUIDE.md) — Complete installation guide for all platforms
- [AGENTS.md](AGENTS.md) — Full agent directory, routing table, governance rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to propose and add a new agent

---

Built on [Thesmos](../thesmos/README.md) — the AI code governance package with 911 rules.
