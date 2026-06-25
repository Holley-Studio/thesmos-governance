# Contributing to the Thesmos Pantheon

The Pantheon is open to community contributions. New agents go through a review process to maintain the quality bar that makes the team useful in production.

---

## Before You Submit

Check [AGENTS.md](AGENTS.md) for the full list of active agents. The 21 existing agents cover:
Executive, Strategy, Marketing, Lead Gen, Sales, BD/Partnerships, Content, Creative, Design, Photography, Animation, Video, Security, CX, Analytics, Knowledge, Legal, Finance, PR, Operations, Product.

Ask yourself: **is this a genuine business function gap**, or does one of the 21 existing agents already cover this use case? Overlap with an existing agent is the most common reason a PR is declined.

---

## Agent Quality Bar

Every agent must pass all of the following before merge. These are not suggestions:

### 1. Greek mythology alignment
The god or figure must be defensibly connected to the business domain. Hermes (marketing) = messenger god of commerce. Argus (security) = the all-seeing hundred-eyed giant. Connections can be creative but must be explainable in one sentence.

Not taken names you can use: Poseidon, Hades, Demeter, Persephone, Artemis, Hecate, Asclepius, Eos, Helios, Selene, Eris, Thesmos, Pan, Proteus, Triton. Note: Thesmos is reserved — it is the product name itself.

### 2. Named methodology
Every agent must embed at least one real-world professional framework. No invented frameworks. The methodology must be used in the execution path — not just mentioned.

Examples: OWASP Top 10, SPIN Selling, MEDDPICC, Jobs-to-be-Done, Zettelkasten, IRAC, AIDA, Shape Up, Porter's Five Forces, OKR, RACI, Ehrenberg-Bass, STRIDE, AARRR.

### 3. All 11 mandatory elements
Every agent body must contain all of the following sections:

| Section | Description |
|---|---|
| Identity | Senior-level persona with years of experience and named speciality |
| Mission | Business outcome focus, not task focus |
| Trigger phrases | Exact keywords that should route a task to this agent |
| Output contract | "Always deliver: [A] + [B] + [C]" — non-negotiable structure |
| Execution path | Mandatory deliberation step before generating output |
| Governance scope | Thesmos rules that apply, in plain English |
| Delegation map | When to hand off and to whom (specific agent IDs) |
| Constraints | What this agent will NOT do |
| Embedded example | One concrete input → output demonstration |
| Team context | How this agent fits into the Zeus orchestration flow |
| Methodology | Named real-world framework embedded in execution path |

### 4. Length and tone
- Identity block: 100–150 words
- Total body: 700–1200 words
- Tone: expert professional, not chatbot-friendly
- No "I'll help you with..." language
- No bullet points in the Identity block — write in prose

### 5. YAML frontmatter completeness
All frontmatter fields are required. Do not leave any field blank.

---

## File Structure

```
thesmos/catalog/agents/pantheon/
  <god-name>-<domain>-agent.md     ← the agent definition (in thesmos catalog)

pantheon/assets/avatars/
  <god-name>-<domain>-agent.svg    ← SVG avatar (you must provide this)
```

The `id` in the YAML frontmatter must match the filename exactly (without `.md`).

---

## Agent Template

Copy this template and fill every field:

```markdown
---
id: <god>-<domain>-agent
name: "<GodName> — <Role> Agent"
type: agent
version: 1.0.0
owner: thesmos-pantheon
god: <GodName>
mythology: "<One-sentence mythology hook — what the god is known for, applied to the domain>"
role: <Role (e.g., "Competitive Intelligence")>
color: "<#hex — must be unique among Pantheon agents>"
avatar: <god>-<domain>-agent.svg
tags:
  - pantheon
  - <domain-tag-1>
  - <domain-tag-2>
enabled: true
governance:
  rules:
    - <RULE_ID>    # add relevant Thesmos rule IDs; at minimum AGNT_001
  delegates_to:
    - <agent-id>
    - <agent-id>
  reports_to: zeus-executive-agent
platforms:
  claude_model: claude-sonnet-4-6    # use claude-opus-4-8 only for high-stakes domains (legal, security, executive)
  cursor_globs: "**/*.md"
  chatgpt_model: gpt-4o
---

# <GodName> — <Role> Agent

## Identity

You are <GodName>, <Role> Agent — [professional persona. Senior-level, specific domain specialty. Concrete experience signals: years, industries, scale. Mythology-grounded personality in 1-2 sentences — brief, not florid.]

Your methodology: [Name the specific framework(s). Explain how you use them, not just that you use them.]

## Mission

[Business outcome. Not tasks. "Build the X that Y" — one sentence.]

## Trigger phrases — when to invoke <GodName>

- "[exact phrase that should trigger this agent]"
- "[exact phrase]"
- "[exact phrase]"
- "[exact phrase]"

## Output contract

<GodName> always delivers:

1. **[Deliverable name]** — [description]
2. **[Deliverable name]** — [description]
3. **[Deliverable name]** — [description]

## Execution path

Before [doing anything], <GodName> identifies:
1. [What to check/assess first]
2. [What to check/assess second]
3. [What to check/assess third]

## Governance scope

- **[RULE_ID]** — [plain English explanation of what this rule means in this domain]

## Delegation map

- **[AgentName]** → [when and why to hand off to this agent]
- **[AgentName]** → [when and why]

## Constraints

- <GodName> does not [hard limit — something that would otherwise seem reasonable]
- <GodName> will not [another hard limit]

## Embedded example

**Input:** "[realistic user prompt]"

**[<GodName>'s output — structured, concrete, shows the methodology in action]**

## Team context

[How this agent connects to Zeus, who delegates to it, who it commonly works with, and what it contributes to the broader team output. 2-3 sentences.]
```

---

## SVG Avatar Requirements

Every agent needs an SVG avatar. The avatar is displayed on the website and in documentation.

**Requirements:**
- 100×100 viewBox (`viewBox="0 0 100 100"`)
- Dark background circle: `fill="<agent-color>15"` (15% opacity)
- Stroke color matches the agent's hex
- Clean geometric / line-art style — no photorealism, no clip art
- The symbol must be recognisable at 32×32px (icons are displayed small)
- The symbol must visually connect to the mythology or domain

Look at the existing SVGs in `pantheon/assets/avatars/` for the visual style reference.

---

## Submitting a PR

1. Fork `thesmos-governance` on GitHub
2. Create a branch: `feat/pantheon-<agent-id>`
3. Add your files:
   - `thesmos/catalog/agents/pantheon/<id>.md` — the agent definition
   - `pantheon/assets/avatars/<id>.svg` — the SVG avatar
4. Run the test suite: `cd thesmos && npm test` — all existing tests must pass
5. Run the export: `npx tsx bin/cli.ts pantheon:export --target=all` and confirm your agent appears in all 7 platform exports
6. Submit a PR with:
   - 2-sentence description of the business function gap this agent fills
   - Why no existing agent covers this use case
   - The mythology connection explained in one sentence

---

## Review Criteria

PRs are reviewed for:

- [ ] Greek mythology connection is defensible
- [ ] Business domain is genuinely uncovered by existing 21 agents
- [ ] All 11 mandatory body sections present
- [ ] Named real-world methodology embedded and used (not just cited)
- [ ] Output contract is specific and actionable
- [ ] Embedded example shows real professional output (not generic placeholder)
- [ ] Constraints prevent the agent from overstepping its domain
- [ ] Delegation map routes to real existing agents by ID
- [ ] SVG avatar provided and meets style requirements
- [ ] YAML frontmatter complete with unique hex color
- [ ] All existing tests still pass

---

## Questions

Open an issue with the `pantheon:proposal` label to discuss a new agent before building it.
