# The Thesmos Pantheon — Complete Guide

**21 governed AI business agents. Every platform. Zero install required.**

---

## What is the Thesmos Pantheon?

The Thesmos Pantheon is a team of 21 AI business agents named after Greek gods — one for every major business function. They are built into the Thesmos governance package and designed to be used across Claude, ChatGPT, Gemini, Cursor, and GitHub Copilot.

Unlike generic AI prompts, Pantheon agents are:
- **Governed** — each agent knows which Thesmos rules apply to its outputs
- **Team-aware** — agents know who to delegate to and who they report to
- **Versioned** — agent personas have version numbers and can be upgraded
- **Memory-capable** — persistent context via Mnemosyne memory store
- **Orchestrated** — Zeus routes complex tasks across the right specialists automatically

---

## The Team — 21 Agents at a Glance

| Agent | God | Role | Methodology |
|---|---|---|---|
| `zeus-executive-agent` | **Zeus** | Executive orchestration | RACI + Eisenhower Matrix |
| `athena-strategy-agent` | **Athena** | Business strategy & GTM | Porter's Five Forces + OKR |
| `hermes-marketing-agent` | **Hermes** | Marketing strategy | Jobs-to-be-Done + Ehrenberg-Bass |
| `nike-leadgen-agent` | **Nike** | Lead generation & pipeline | MEDDPICC + ICP Scoring |
| `ares-sales-agent` | **Ares** | Sales & closing | Challenger Sale + SPIN Selling |
| `apollo-content-agent` | **Apollo** | Content & copywriting | AIDA + StoryBrand |
| `aphrodite-creative-agent` | **Aphrodite** | Creative direction & brand | Brand Archetypes + Emotional Design |
| `hephaestus-design-agent` | **Hephaestus** | UI/UX & design systems | Atomic Design + WCAG 2.1 |
| `artemis-photography-agent` | **Artemis** | Photography direction | Rule of Thirds + Exposure Triangle |
| `morpheus-animation-agent` | **Morpheus** | Animation & motion | 12 Disney Principles + Easing Curves |
| `dionysus-video-agent` | **Dionysus** | Video production | 3-Act Structure + Production Brief |
| `argus-security-agent` | **Argus** | Security & threat modeling | OWASP Top 10 + STRIDE + CVSSv3 |
| `hestia-cx-agent` | **Hestia** | Customer experience | Net Promoter System + CES |
| `tyche-analytics-agent` | **Tyche** | Analytics & KPIs | North Star + AARRR + OKR Trees |
| `mnemosyne-knowledge-agent` | **Mnemosyne** | Knowledge management | Zettelkasten + Progressive Summarisation |
| `themis-legal-agent` | **Themis** | Legal & contracts | IRAC + Contract Clause Library |
| `plutus-finance-agent` | **Plutus** | Finance & pricing | Unit Economics + SaaS Modelling |
| `pheme-pr-agent` | **Pheme** | PR & communications | Pyramid Principle + PESO Model |
| `hera-operations-agent` | **Hera** | Operations & HR | OKR Cascade + RACI + Gallup |
| `daedalus-product-agent` | **Daedalus** | Product management | Shape Up + User Story Mapping |
| `heracles-bd-agent` | **Heracles** | Business development | MEDDPICC + Channel Sales Playbook |

---

## Quick Start — Under 5 Minutes

### Option 1: Install via npm (developers)

```bash
# Install thesmos-governance globally
npm install -g thesmos-governance

# Install all 21 Pantheon agents to your project
thesmos pantheon:install --all

# Export all agents to Claude Code native format
thesmos pantheon:export --target=claude-code

# Launch any agent
claude --agent=hermes-marketing-agent "Write a campaign brief for our product launch"
```

### Option 2: Download directly (no install required)

Browse [pantheon/exports/](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon/exports) and download the file for your platform. No npm install, no configuration.

---

## Platform Installation Guides

### Claude Code — Native Sub-Agents (Best Experience)

Claude Code natively supports custom agents via `.claude/agents/*.md`, user agents under `~/.claude/agents/`, and plugins. Thesmos does not claim ownership of every file in those directories.

**Preferred: Pantheon plugin** (no per-repo copy):

Install from [`pantheon-plugin/`](../pantheon-plugin/). Scoped names: `pantheon:hermes-marketing-agent`, `pantheon:zeus-executive-agent`.

**Fallback: ownership-aware managed copies** under `.claude/agents/thesmos/` (or `~/.claude/agents/thesmos/`):

```bash
thesmos pantheon:install --all --write
thesmos adapters
# or user-level:
npm run agents:install:local -- --dry-run
npm run agents:install:local
```

**Export only (kit / packaging):**
```bash
thesmos pantheon:export --target=claude-code
thesmos pantheon:export --target=claude-code --agent=hermes-marketing-agent
```

**Launch an agent:**
```bash
claude --agent=hermes-marketing-agent "Write a campaign brief for our B2B SaaS launch"
claude --agent=ares-sales-agent "Help me handle the objection: we already have a process"
claude --agent=zeus-executive-agent "Orchestrate a product launch for Thesmos v4.0"
```

Project agents you create under `.claude/agents/` remain external. They shadow Pantheon names when they collide; use `pantheon:<id>` or `thesmos agents:conflicts` to see what is active.

**Global user-level fallback:**
```bash
npm run agents:install:local
# writes only ~/.claude/agents/thesmos/<id>.md — never overwrites untracked files
```

---

### Claude Projects (No Code Required)

1. Go to [claude.ai](https://claude.ai) → Projects → Create Project
2. Click "Set Instructions"
3. Download the agent file from [pantheon/exports/claude-project/](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon/exports/claude-project)
4. Paste the contents into Project Instructions
5. Every conversation in this project now has that agent's persona

**Or via CLI:**
```bash
thesmos pantheon:export --target=claude-project --agent=hermes-marketing-agent
# Outputs: hermes-marketing-agent-claude-project.txt
# Paste into Claude.ai Project Instructions
```

---

### ChatGPT Custom GPT

1. Go to [chatgpt.com](https://chatgpt.com) → Explore GPTs → Create a GPT
2. Click "Configure" → "Instructions"
3. Download your agent from [pantheon/exports/chatgpt/](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon/exports/chatgpt)
4. Paste the contents into the Instructions field
5. Save as private or share with your team

**Or via CLI:**
```bash
thesmos pantheon:export --target=chatgpt --agent=ares-sales-agent
# Outputs: ares-sales-agent-chatgpt.txt
```

> Note: ChatGPT Custom GPT instructions have an ~8,000 character limit. The exports are optimised for this limit. For the full agent persona (no truncation), use the OpenAI Assistants API format.

**OpenAI Assistants API (no character limit):**
```bash
thesmos pantheon:export --target=openai-assistant --agent=zeus-executive-agent
# Outputs: zeus-executive-agent-openai-assistant.json
# Use with the Assistants API instructions field
```

---

### Gemini Gems

1. Go to [gemini.google.com](https://gemini.google.com) → Gems → New Gem
2. Download your agent from [pantheon/exports/gemini/](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon/exports/gemini)
3. Paste contents into the Gem instructions field
4. Save and use

```bash
thesmos pantheon:export --target=gemini --agent=apollo-content-agent
# Outputs: apollo-content-agent-gemini.txt
```

---

### Cursor

Thesmos exports Cursor-compatible `.mdc` files with the correct YAML frontmatter.

```bash
thesmos pantheon:export --target=cursor
# Creates: .cursor/rules/hermes-marketing-agent.mdc (and 20 more)
```

Cursor will automatically offer the agent when your prompt matches the agent's description. Or download directly from [pantheon/exports/cursor/](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon/exports/cursor).

---

### GitHub Copilot

```bash
thesmos pantheon:export --target=copilot
# Creates: .github/instructions/hermes-marketing-agent.instructions.md (and 20 more)
```

Or download from [pantheon/exports/copilot/](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon/exports/copilot).

---

### Direct API Usage

Each Pantheon agent's body is a complete system prompt. Use it directly in any AI API:

**Claude API:**
```python
import anthropic

with open("pantheon/agents/hermes-marketing-agent.md") as f:
    agent_prompt = f.read().split("---\n", 2)[2]  # strip YAML frontmatter

client = anthropic.Anthropic()
response = client.messages.create(
    model="claude-sonnet-4-6",
    system=agent_prompt,
    messages=[{"role": "user", "content": "Write a campaign brief for our B2B SaaS launch"}],
    max_tokens=2000
)
```

**OpenAI API:**
```python
from openai import OpenAI
import json

with open("pantheon/exports/openai-assistants/hermes-marketing-agent-openai-assistant.json") as f:
    config = json.load(f)

client = OpenAI()
assistant = client.beta.assistants.create(
    name=config["name"],
    instructions=config["instructions"],
    model=config["model"]
)
```

---

## Zeus Orchestration

Zeus automatically routes complex multi-domain tasks to the right team of specialists.

```bash
thesmos pantheon:orchestrate "launch our new developer tool to CTOs at fintech companies"
```

Zeus will output a structured brief like:

```markdown
# Zeus Orchestration Brief
Task: launch our new developer tool to CTOs at fintech companies

## Athena — Strategy Agent
Sub-task: Define GTM positioning and competitive differentiation for fintech CTO audience...

## Hermes — Marketing Agent
Sub-task: Campaign strategy and channel mix for reaching fintech CTOs...

## Apollo — Content Agent
Sub-task: Landing page copy and email sequence targeting fintech CTOs...
```

**Save the brief to a file:**
```bash
thesmos pantheon:orchestrate "launch new feature X" --out=launch-brief.md
```

---

## Mnemosyne Memory — Persistent Context

Agents remember context across sessions when you use the memory system.

```bash
# Save a preference for Hermes
thesmos pantheon:memory save --agent hermes "Client prefers bold, direct copy. Avoid corporate language."

# Save target audience context
thesmos pantheon:memory save --agent ares "Deal target is VP Engineering at 50-200 person B2B SaaS company."

# Review what Hermes remembers
thesmos pantheon:memory show --agent hermes

# Clear stale memory
thesmos pantheon:memory clear --agent hermes
```

Memory files are stored at `.thesmos/pantheon/memory/<agent-id>.md` and read automatically when an agent is invoked via Claude Code.

For ChatGPT/Gemini, paste the memory file content at the start of your conversation:
> "Before we begin, here is my context for you: [paste memory file]"

---

## Governance Integration

Every Pantheon agent output can be validated with Thesmos governance rules:

```bash
# After receiving output from Hermes on a campaign:
echo "campaign brief content here" > campaign-brief.md
thesmos validate campaign-brief.md
# Checks: GDPR_002 (analytics consent), GDPR_004 (PII in URLs), etc.

# Generate a governance certificate for the output
thesmos certificate:generate
```

Each agent's `## Governance scope` section tells you exactly which Thesmos rules apply to that agent's domain.

---

## Agent Reference

### Zeus — Executive Agent

**Role:** Executive orchestration — routes tasks, resolves conflicts, approves strategy
**Invoke when:** Multi-domain tasks, priority decisions, team coordination
**Example prompts:**
- "What should we focus on this quarter?"
- "Orchestrate a product launch"
- "Help me prioritise these 5 initiatives"
- "Who should handle [task]?"

**Do NOT use Zeus for:** Writing copy (Apollo), designing (Hephaestus), writing code (Thesmos rules already cover this)

---

### Athena — Strategy Agent

**Role:** Business strategy, GTM, competitive intelligence, OKRs
**Invoke when:** Positioning decisions, market entry, competitive analysis, quarterly planning
**Example prompts:**
- "Define our positioning against [competitor]"
- "Write our GTM strategy for [product]"
- "What should our OKRs be for Q3?"
- "Should we enter [market]?"

---

### Hermes — Marketing Agent

**Role:** Campaign strategy, channel mix, growth marketing
**Invoke when:** Campaign planning, channel decisions, growth strategy, referral programs
**Example prompts:**
- "Write a campaign brief for [product launch]"
- "Suggest a channel mix for a $10K/month budget"
- "Design a referral program for [product]"
- "Build our Jobs-to-be-Done analysis for [audience]"

---

### Nike — Lead Generation Agent

**Role:** ICP definition, outbound sequences, pipeline building
**Invoke when:** Building outbound programs, defining ICP, writing prospecting sequences
**Example prompts:**
- "Build an outbound sequence for [ICP]"
- "Define our ideal customer profile"
- "Write a 5-touch cold email cadence for [product/audience]"
- "Create a lead scoring model"

---

### Ares — Sales Agent

**Role:** Pitch decks, objection handling, deal strategy, proposals
**Invoke when:** Preparing for sales calls, handling objections, writing proposals, deal strategy
**Example prompts:**
- "Help me handle the objection: [objection text]"
- "Write a pitch deck outline for [audience]"
- "What's my deal strategy for [prospect type]?"
- "Write discovery questions for [buyer persona]"

---

### Apollo — Content Agent

**Role:** Copywriting, blog posts, emails, social content, scripts
**Invoke when:** Writing any content — landing pages, emails, blog, social, video scripts
**Example prompts:**
- "Write a landing page for [product]"
- "Write a 3-email onboarding sequence for [use case]"
- "Write a blog post about [topic] for [audience]"
- "Improve this copy: [paste text]"

---

### Aphrodite — Creative Director Agent

**Role:** Brand identity, visual direction, creative briefs
**Invoke when:** Defining visual identity, creating campaign creative briefs, brand decisions
**Example prompts:**
- "Define the brand identity for [company/product]"
- "Write a creative brief for [campaign type]"
- "What aesthetic should [brand] use?"
- "Review this creative and give direction"

---

### Hephaestus — Design Agent

**Role:** UI/UX specs, design systems, component briefs, accessibility
**Invoke when:** Specifying UI components, designing flows, design system work
**Example prompts:**
- "Spec the [component name] component"
- "Design the [feature] user flow"
- "Write an accessibility checklist for [component]"
- "Define design tokens for [product]"

---

### Artemis — Photography Agent

**Role:** Shot lists, photography art direction, editing briefs
**Invoke when:** Planning a photo shoot, briefing a photographer, art directing imagery
**Example prompts:**
- "Create a shot list for a brand photo shoot"
- "Write photography direction for [campaign]"
- "Brief a photographer for a product shoot"
- "What photography style should [brand] use?"

---

### Morpheus — Animation Agent

**Role:** Motion briefs, storyboards, micro-interaction specs
**Invoke when:** Specifying animations, UI micro-interactions, motion design briefs
**Example prompts:**
- "Write micro-interaction specs for [UI component]"
- "Storyboard the [animation type]"
- "Write a motion brief for [brand/project]"
- "How should [element] animate?"

---

### Dionysus — Video Agent

**Role:** Video scripts, production briefs, shot lists
**Invoke when:** Writing video scripts, planning video shoots, production briefs
**Example prompts:**
- "Write a 60-second product demo script for [platform]"
- "Write a brand story video script"
- "Create a production brief for [video type]"
- "Write a social video script for [campaign]"

---

### Argus — Security Agent

**Role:** Threat modeling, security audits, OWASP reviews
**Invoke when:** Security reviews, threat modeling, compliance checks, hardening
**Example prompts:**
- "Review this [code/architecture] for security issues"
- "Create a threat model for [system/feature]"
- "What are the OWASP risks in [design]?"
- "Write a security checklist for [feature type]"

---

### Hestia — Customer Experience Agent

**Role:** Onboarding flows, support playbooks, retention programs, NPS
**Invoke when:** Designing onboarding, writing support playbooks, retention strategy
**Example prompts:**
- "Design the onboarding flow for [product]"
- "Write a support playbook for [issue type]"
- "How do we reduce churn in [segment]?"
- "Build a customer health score model"

---

### Tyche — Analytics Agent

**Role:** KPIs, dashboard design, data interpretation, metrics frameworks
**Invoke when:** Defining metrics, designing dashboards, interpreting data, analytics strategy
**Example prompts:**
- "Define the KPI framework for [initiative]"
- "What is our North Star metric?"
- "Design a launch dashboard for [product]"
- "Interpret this data: [paste data]"

---

### Mnemosyne — Knowledge Agent

**Role:** Knowledge base, documentation, institutional memory, context handoffs
**Invoke when:** Documenting decisions, organising knowledge, creating runbooks
**Example prompts:**
- "Document [decision/process] for the team"
- "Create a knowledge base structure for [domain]"
- "Write a runbook for [process]"
- "Create a context handoff document for [project]"

---

### Themis — Legal Agent

**Role:** Contract frameworks, TOS, NDAs, legal risk analysis
**Invoke when:** Any legal document need — contracts, privacy policies, NDAs, legal risk
**Example prompts:**
- "Write an NDA for [scenario]"
- "Create Terms of Service for [product]"
- "Review this clause for risk: [paste clause]"
- "What are the legal risks of [decision]?"

> **Important:** Themis produces frameworks for attorney review, not legal advice. All outputs should be reviewed by a qualified attorney before execution.

---

### Plutus — Finance Agent

**Role:** Pricing strategy, unit economics, financial models, budgets
**Invoke when:** Pricing decisions, financial modelling, unit economics analysis, budget planning
**Example prompts:**
- "Design the pricing for [product]"
- "Model the unit economics for [business]"
- "What should we charge for [offering]?"
- "Build a financial forecast framework"

---

### Pheme — PR Agent

**Role:** Press releases, media strategy, crisis comms, thought leadership
**Invoke when:** Press announcements, media outreach, crisis situations, thought leadership
**Example prompts:**
- "Write a press release for [announcement]"
- "Create a media outreach strategy for [story]"
- "How do we handle [crisis/negative coverage]?"
- "Write a thought leadership piece for [topic]"

---

### Hera — Operations Agent

**Role:** SOPs, hiring briefs, OKR cascades, HR frameworks, process design
**Invoke when:** Process design, hiring, OKR setting, operational frameworks
**Example prompts:**
- "Write a job description for [role]"
- "Build an SOP for [process]"
- "Design an interview process for [role]"
- "Create our OKR framework for [quarter]"

---

### Daedalus — Product Agent

**Role:** PRDs, product roadmaps, user stories, feature specs, MVP definition
**Invoke when:** Product feature specs, roadmap planning, user story writing, PRDs
**Example prompts:**
- "Write a PRD for [feature]"
- "Shape [initiative] for the engineering team"
- "Write user stories for [feature]"
- "Define the MVP for [product/feature]"

---

### Heracles — Business Development Agent

**Role:** Partnership strategy, BD outreach, reseller programs, alliance building
**Invoke when:** Partnership opportunities, BD strategy, reseller programs, ecosystem building
**Example prompts:**
- "What partnership opportunities should we pursue?"
- "Write a partnership proposal for [company type]"
- "Build a reseller/agency partner program"
- "Qualify this potential partner: [description]"

---

## Updating Agents

```bash
# Check for newer agent versions
thesmos pantheon:upgrade

# Update the npm package to get new agent versions
npm update -g thesmos-governance

# Re-export after updating
thesmos pantheon:export --target=claude-code
```

---

## Customising an Agent

1. Find the master agent file: `thesmos/catalog/agents/pantheon/<id>.md`
2. Edit the body (below the `---` YAML frontmatter)
3. Re-run the export: `thesmos pantheon:export --target=claude-code --agent=<id>`
4. Your customised version is now live

> Note: Customised agents will be overwritten by `thesmos pantheon:upgrade` if you run it. Copy customised agents to `.thesmos/agents/` to preserve them through upgrades.

---

## Contributing New Agents

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose a new Greek-god-named agent to the Pantheon.

---

## FAQ

**Q: Do I need to pay for Thesmos to use the agents?**
A: The agent `.md` files are free and open source. Download them directly from the GitHub repo — no npm install required.

**Q: Can I use multiple agents in the same session?**
A: Yes. In Claude Code, you can switch agents per message or run `thesmos pantheon:orchestrate` to have Zeus coordinate multiple agents on a single task.

**Q: My agent output doesn't sound right — how do I customise the persona?**
A: Edit the agent's `.md` file body section. The YAML frontmatter stays the same; the personality and instructions are in the Markdown body below.

**Q: Can I use these agents for client work?**
A: Yes. The agents are licensed under the same terms as Thesmos (MIT). You can use them in client projects, include them in agency deliverables, and build on top of them.

**Q: The ChatGPT agent got truncated — how do I get the full version?**
A: Use the OpenAI Assistants API format instead of the Custom GPT format. The Assistants API supports 256,000 characters vs. the ~8,000 character limit in the GPT Builder UI.

**Q: How do I know which agent to use?**
A: Run `thesmos pantheon:orchestrate "[your task]"` and Zeus will route it for you. Or check the Agent Reference section above for each agent's trigger phrases.
