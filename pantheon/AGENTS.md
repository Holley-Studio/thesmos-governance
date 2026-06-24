# Thesmos Pantheon — Agent Directory

21 governed AI business agents. Every function covered.

---

## Full Agent Table

| Agent | God | Role | Methodology | Model | Color |
|---|---|---|---|---|---|
| `zeus-executive-agent` | **Zeus** | Executive orchestration | RACI + Eisenhower Matrix | Opus | #F5C518 |
| `athena-strategy-agent` | **Athena** | Business strategy & GTM | Porter's Five Forces + OKR | Sonnet | #7BB8D4 |
| `hermes-marketing-agent` | **Hermes** | Marketing strategy | JTBD + Ehrenberg-Bass + 4Ps | Sonnet | #A8D8EA |
| `nike-leadgen-agent` | **Nike** | Lead generation | MEDDPICC + ICP Scoring | Sonnet | #9B59B6 |
| `ares-sales-agent` | **Ares** | Sales & closing | Challenger Sale + SPIN Selling | Sonnet | #C0392B |
| `apollo-content-agent` | **Apollo** | Content & copywriting | AIDA + StoryBrand | Sonnet | #F39C12 |
| `aphrodite-creative-agent` | **Aphrodite** | Creative direction & brand | Brand Archetypes + Emotional Design | Sonnet | #FF6B9D |
| `hephaestus-design-agent` | **Hephaestus** | UI/UX & design systems | Atomic Design + WCAG 2.1 | Sonnet | #B87333 |
| `iris-photography-agent` | **Iris** | Photography direction | Rule of Thirds + Exposure Triangle | Sonnet | #1ABC9C |
| `morpheus-animation-agent` | **Morpheus** | Animation & motion | 12 Disney Principles + Easing Curves | Sonnet | #6C3483 |
| `dionysus-video-agent` | **Dionysus** | Video production | 3-Act Structure + Production Brief | Sonnet | #8E44AD |
| `argus-security-agent` | **Argus** | Security & threat modeling | OWASP Top 10 + STRIDE + CVSSv3 | Opus | #27AE60 |
| `hestia-cx-agent` | **Hestia** | Customer experience | Net Promoter System + CES | Sonnet | #E67E22 |
| `tyche-analytics-agent` | **Tyche** | Analytics & KPIs | North Star + AARRR + OKR Trees | Sonnet | #00BCD4 |
| `mnemosyne-knowledge-agent` | **Mnemosyne** | Knowledge management | Zettelkasten + Progressive Summarisation | Sonnet | #2980B9 |
| `themis-legal-agent` | **Themis** | Legal & contracts | IRAC + Contract Clause Library | Opus | #D4A853 |
| `plutus-finance-agent` | **Plutus** | Finance & pricing | Unit Economics + SaaS Modelling | Sonnet | #2ECC71 |
| `pheme-pr-agent` | **Pheme** | PR & communications | Pyramid Principle + PESO Model | Sonnet | #3498DB |
| `hera-operations-agent` | **Hera** | Operations & HR | OKR Cascade + RACI + Gallup | Sonnet | #7D3C98 |
| `daedalus-product-agent` | **Daedalus** | Product management | Shape Up + User Story Mapping + JTBD | Opus | #E74C3C |
| `heracles-bd-agent` | **Heracles** | Business development | MEDDPICC + Channel Sales Playbook | Sonnet | #E67E22 |

---

## Domain Coverage Map

| Business Function | Primary Agent | Supporting Agents |
|---|---|---|
| Executive & Strategy | Zeus, Athena | — |
| Marketing | Hermes | Apollo, Aphrodite, Nike, Tyche, Pheme |
| Lead Generation | Nike | Hermes, Ares |
| Sales | Ares | Nike, Heracles |
| Business Development | Heracles | Ares, Athena, Themis, Plutus |
| Content & Copy | Apollo | Hermes, Pheme |
| Creative & Brand | Aphrodite | Apollo, Hephaestus, Iris |
| Design & UX | Hephaestus | Aphrodite, Daedalus |
| Photography | Iris | Aphrodite |
| Animation & Motion | Morpheus | Dionysus, Hephaestus |
| Video Production | Dionysus | Apollo, Morpheus, Iris |
| Security | Argus | Themis, Daedalus |
| Customer Experience | Hestia | Hermes, Tyche |
| Analytics & Data | Tyche | Mnemosyne |
| Knowledge & Docs | Mnemosyne | Hera |
| Legal | Themis | Argus, Plutus |
| Finance & Pricing | Plutus | Athena, Themis |
| PR & Communications | Pheme | Apollo, Athena |
| Operations & HR | Hera | Zeus, Mnemosyne |
| Product Management | Daedalus | Hephaestus, Argus, Athena |

---

## Governance Rules by Agent

| Agent | Primary Rules |
|---|---|
| Zeus | AGNT_001, AGNT_006 |
| Athena | AGNT_001 |
| Hermes | GDPR_002, GDPR_004, GDPR_009 |
| Nike | GDPR_002, GDPR_004 |
| Ares | AGNT_001 |
| Apollo | GDPR_004, LIC_001 |
| Aphrodite | LIC_001, LIC_008 |
| Hephaestus | AGNT_001 |
| Iris | LIC_008 |
| Morpheus | LIC_001 |
| Dionysus | LIC_001 |
| Argus | SEC_001, SEC_002, GDPR_002, AGNT_007 |
| Hestia | GDPR_001, GDPR_002 |
| Tyche | GDPR_002, GDPR_004 |
| Mnemosyne | GDPR_001 |
| Themis | GDPR_001, GDPR_007, LIC_001 |
| Plutus | AGNT_001 |
| Pheme | AGNT_001 |
| Hera | GDPR_001, AGNT_001 |
| Daedalus | AGNT_001 |
| Heracles | AGNT_001 |

---

## Zeus Routing Table

When you run `thesmos pantheon:orchestrate "<task>"`, Zeus uses this routing table to assign work:

| Task keywords | Primary agents |
|---|---|
| marketing, campaign, growth, channel, brand awareness | Hermes, Apollo, Aphrodite |
| sales, pitch, deal, close, proposal, objection, demo | Ares, Nike |
| product, prd, feature, roadmap, user story, mvp | Daedalus |
| partnership, bd, reseller, channel partner, alliance | Heracles |
| content, copy, blog, seo, email, post | Apollo |
| design, ui, ux, component, wireframe, layout | Hephaestus |
| analytics, kpi, metrics, dashboard, north star | Tyche |
| security, threat, audit, vulnerability, owasp | Argus |
| legal, contract, tos, nda, terms, liability | Themis |
| finance, pricing, unit economics, cac, ltv, budget | Plutus |
| pr, press, media, crisis, announcement, coverage | Pheme, Apollo |
| operations, sop, hiring, hr, onboarding, process | Hera |
| strategy, gtm, competitive, okr, positioning | Athena |
| leads, pipeline, prospecting, outbound, icp | Nike |
| video, script, production, shoot, edit | Dionysus |
| animation, motion, storyboard, micro-interaction | Morpheus |
| photo, shot list, photography, art direction | Iris |
| creative, brand, visual identity, aesthetic | Aphrodite |
| customer, cx, retention, churn, nps, onboarding | Hestia |
| knowledge, documentation, runbook, context, wiki | Mnemosyne |

---

## Platform Export Availability

All 21 agents are exported for all 7 platforms in [exports/](exports/):

| Platform | Directory | File extension | Notes |
|---|---|---|---|
| Claude Code | `exports/claude-code/` | `.md` | YAML frontmatter, native sub-agents |
| Claude Projects | `exports/claude-project/` | `-claude-project.txt` | Plain text, paste into Project Instructions |
| ChatGPT Custom GPT | `exports/chatgpt/` | `-chatgpt.txt` | ≤8K chars, paste into GPT Builder |
| OpenAI Assistants API | `exports/openai-assistant/` | `-openai-assistant.json` | JSON with `instructions`, `model`, `metadata` |
| Cursor | `exports/cursor/` | `.mdc` | YAML frontmatter, `.cursor/rules/` |
| GitHub Copilot | `exports/copilot/` | `.instructions.md` | Markdown, `.github/instructions/` |
| Gemini Gems | `exports/gemini/` | `-gemini.txt` | Plain text, paste into Gem instructions |

---

## Agent Files

All 21 master agent definitions live in `thesmos/catalog/agents/pantheon/`:

```
zeus-executive-agent.md
athena-strategy-agent.md
hermes-marketing-agent.md
nike-leadgen-agent.md
ares-sales-agent.md
apollo-content-agent.md
aphrodite-creative-agent.md
hephaestus-design-agent.md
iris-photography-agent.md
morpheus-animation-agent.md
dionysus-video-agent.md
argus-security-agent.md
hestia-cx-agent.md
tyche-analytics-agent.md
mnemosyne-knowledge-agent.md
themis-legal-agent.md
plutus-finance-agent.md
pheme-pr-agent.md
hera-operations-agent.md
daedalus-product-agent.md
heracles-bd-agent.md
```

SVG avatars in `pantheon/assets/avatars/` — one file per agent, named to match.

---

See [GUIDE.md](GUIDE.md) for installation instructions and [CONTRIBUTING.md](CONTRIBUTING.md) to add a new agent.
