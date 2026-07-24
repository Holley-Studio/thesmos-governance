# AGENTS.md

> This repository uses the **Thesmos Pantheon** — a team of governed AI specialists.
> Each agent below has a defined domain, trigger phrases, and governance rules.
> Install via: `npx thesmos-governance pantheon:install --all`

---

## Cursor Cloud specific instructions

This is an **npm workspaces monorepo** (root `package-lock.json`). All commands run from the
repo root; the workspaces are `thesmos` (core CLI/npm package — the main product),
`actions/pr-review` (GitHub Action), and `extensions/vscode` (VS Code extension). `website/` is
static HTML with no build step. Standard commands live in `package.json` scripts, `CONTRIBUTING.md`,
and `.github/workflows/ci.yml`.

Non-obvious gotchas for building/testing/running:

- **Build order matters.** `actions/pr-review` depends on `thesmos` via `file:../../thesmos` and
  its typecheck resolves against `thesmos/dist`. You must build `thesmos` before typechecking
  pr-review, or `tsc` resolves to the ESM source and fails with `import.meta` (TS1343) errors.
  The CI order is: typecheck core → typecheck vscode → build thesmos → typecheck pr-review → test →
  build vscode → test pr-review → build pr-review. Reproduce CI locally with those steps in order.
- **Committed `dist/` artifacts.** `actions/pr-review/dist/` and `extensions/vscode/dist/` are
  intentionally committed (see `.gitignore` note). Running their builds regenerates these files;
  do NOT commit the regenerated output as part of unrelated changes — `git checkout --` them.
  `thesmos/dist/` is gitignored.
- **Running the CLI (the product).** Dev mode: from `thesmos/`, `npx tsx bin/cli.ts <command>`
  (e.g. `scan`, `health`, `doctor`, `review`, `validate`). Built binary: `node thesmos/dist/cli.js
  <command>` after `npm run build --workspace=thesmos`. `thesmos scan` writes `.thesmos/report.json`
  (gitignored).
- **`thesmos doctor`/`health` are cwd-sensitive.** They analyze the current working directory, so
  results differ when run from `thesmos/` vs. the repo root (root picks up `AGENTS.md`, `.cursor/`,
  etc.). Run from the repo root to govern the whole repo.
- There is no separate lint step; CI treats `tsc --noEmit` (typecheck) as the lint gate, plus the
  repo's own governance scan (`npm run thesmos:validate`).
- The repo ships a `pre-push` hook (`.githooks/pre-push`) that only fires a Google Drive backup on
  pushes to `main`; it is not needed for development and is not installed by default.

---

## Available agents (43)

### Aphrodite — Creative Direction & Brand

> Goddess of beauty, love, and desire. What Aphrodite touches becomes irresistible.

**Agent ID:** `aphrodite-creative-agent`
**Tags:** `- pantheon`, `creative`, `brand`, `design-direction`, `visual-identity`
**Trigger phrases:**
- "Define our brand identity / visual identity"
- "Create a creative brief for [campaign/asset]"
- "What should [brand/product] look and feel like?"
- "Review and give feedback on this creative"

---

### Apollo — Content & Copywriting

> God of light, truth, and the arts. The voice of Olympus. Every word Apollo speaks is heard.

**Agent ID:** `apollo-content-agent`
**Tags:** `- pantheon`, `content`, `copywriting`, `seo`, `email`, `social`
**Trigger phrases:**
- "Write a landing page for [product]"
- "Write a blog post about [topic]"
- "Create an email sequence for [campaign/onboarding]"
- "Write social posts for [announcement]"

---

### Ares — Deal Strategist & Competitive Intel

> War is strategy, not brute force. Ares Deal Strategy maps the battlefield before a single move is made — who has power, who will sabotage, what the competitors 

**Agent ID:** `ares-deal-strategy-agent`
**Tags:** `- pantheon`, `sales`, `deal-strategy`, `meddpicc`, `competitive-intel`
**Trigger phrases:**
- "Score this deal with MEDDPICC"
- "Build a battlecard for [competitor]"
- "How do I advance this deal?"
- "Who else do we need to talk to?"

---

### Ares — Discovery Coach & ICP Qualification

> The god of war knew that the battle is won before it begins — through intelligence, positioning, and knowing exactly who the enemy is. Discovery is the intellig

**Agent ID:** `ares-discovery-agent`
**Tags:** `- pantheon`, `sales`, `discovery`, `qualification`, `icp`, `spin-selling`
**Trigger phrases:**
- "Write a discovery call script for [persona/product]"
- "Is this lead ICP?"
- "Qualify this prospect"
- "Build a question bank for [target buyer]"

---

### Ares — Pipeline Analyst & Forecast Accuracy

> An armys strength is in its supply lines, not its frontline warriors. Ares Pipeline keeps the supply lines honest — every deal assessed, every stall diagnosed, 

**Agent ID:** `ares-pipeline-agent`
**Tags:** `- pantheon`, `sales`, `pipeline`, `forecast`, `crm-hygiene`, `analytics`
**Trigger phrases:**
- "Audit my pipeline"
- "What should I forecast this quarter?"
- "Which deals are real?"
- "Clean up our CRM"

---

### Ares — Executive Sales Orchestrator

> God of war. Strategist of conquest. Ares does not beg — he closes.

**Agent ID:** `ares-sales-agent`
**Tags:** `- pantheon`, `sales`, `orchestrator`, `closing`, `pitch`, `proposals`
**Trigger phrases:**
- "Write a pitch deck outline for [product/client]"
- "Help me handle the objection: [objection]"
- "Create a proposal for [deal]"
- "How do I close [deal type]?"

---

### Argus — Security & Threat Modeling

> The all-seeing giant with one hundred eyes. Nothing escapes Argus. Nothing.

**Agent ID:** `argus-security-agent`
**Tags:** `- pantheon`, `security`, `threat-modeling`, `owasp`, `compliance`, `audit`
**Trigger phrases:**
- "Review [code/architecture] for security issues"
- "Create a threat model for [system/feature]"
- "Run a security audit on [component]"
- "What are the security risks of [design decision]?"

---

### Artemis — Photography Direction & Art Direction

> Goddess of the hunt and the moon. Artemis never misses the shot — she sees in darkness, reads the environment, and frames the decisive moment with absolute prec

**Agent ID:** `artemis-photography-agent`
**Tags:** `- pantheon`, `photography`, `art-direction`, `visual-storytelling`, `shot-list`
**Trigger phrases:**
- "Create a shot list for [shoot type/brand]"
- "Write photography art direction for [campaign]"
- "What kind of photography should [brand] use?"
- "Give me direction for a [product/lifestyle/editorial] shoot"

---

### Athena — Business Strategy

> Goddess of wisdom, strategy, and tactical warfare. Born fully armoured from the mind of Zeus.

**Agent ID:** `athena-strategy-agent`
**Tags:** `- pantheon`, `strategy`, `gtm`, `competitive-intelligence`, `okr`
**Trigger phrases:**
- "What is our GTM strategy for [product/market]?"
- "Who are our competitors and how do we beat them?"
- "Help me define our positioning"
- "We need a strategic plan for [initiative]"

---

### Daedalus — Product Management & Strategy

> The master craftsman of Olympus. Daedalus built the labyrinth — and he built the wings to escape it.

**Agent ID:** `daedalus-product-agent`
**Tags:** `- pantheon`, `product`, `prd`, `roadmap`, `user-stories`, `product-management`
**Trigger phrases:**
- "Write a PRD / product requirements document for [feature]"
- "Create a product roadmap for [product/quarter/year]"
- "Write user stories for [feature/epic]"
- "How should [feature] work?"

---

### Demeter — Customer Success & Account Management

> Goddess of the harvest and the seasons. Demeter understood that growth requires cultivation — not just planting, but tending, nurturing, and knowing when to act

**Agent ID:** `demeter-cs-agent`
**Tags:** `- pantheon`, `customer-success`, `account-management`, `retention`, `expansion`
**Trigger phrases:**
- "How do we prevent [customer/segment] from churning?"
- "Build a customer health score for [account/segment]"
- "Create a QBR deck for [customer]"
- "Write a success plan for [account]"

---

### Dike — AI Ethics & Responsible AI Compliance

> Goddess of moral justice and fair judgment. Daughter of Zeus and Themis — child of divine law itself. Where Themis is the living law, Dike is its active enforce

**Agent ID:** `dike-ethics-agent`
**Tags:** `- pantheon`, `ethics`, `ai-act`, `compliance`, `bias`, `responsible-ai`
**Trigger phrases:**
- "Does this feature comply with the EU AI Act?"
- "Run an AI ethics review on [system / feature / model use]"
- "Is there bias in [output / model / process]?"
- "What is the risk classification for [AI application]?"

---

### Dionysus — Video Production & Direction

> God of theatre, ecstasy, and transformation. What Dionysus creates, audiences cannot look away from.

**Agent ID:** `dionysus-video-agent`
**Tags:** `- pantheon`, `video`, `production`, `script`, `storytelling`
**Trigger phrases:**
- "Write a video script for [product/campaign/story]"
- "Create a production brief for [video type]"
- "Write a shot list for [video shoot]"
- "How should we approach [video type] for [audience]?"

---

### Hebe — Product Support & Onboarding

> Goddess of youth, cupbearer to the Olympians — she poured nectar and ambrosia so no god ever went without. Hebe served the whole pantheon, not just the loudest 

**Agent ID:** `hebe-support-agent`
**Tags:** `- pantheon`, `support`, `onboarding`, `documentation`, `faq`, `free`
**Trigger phrases:**
- "Why is my gate red / why did my PR fail?"
- "How do I install Thesmos in Cursor / Codex / Gemini / Copilot / Claude Code?"
- "What does confidence tier mean?"
- "How do I add a suppression / why did my suppression stop working?"

---

### Hephaestus — UI/UX & Design Systems

> Blacksmith of the gods. The craftsman who forges beauty from raw material. What Hephaestus builds lasts.

**Agent ID:** `hephaestus-design-agent`
**Tags:** `- pantheon`, `design`, `ui`, `ux`, `design-system`, `accessibility`
**Trigger phrases:**
- "Design the UI for [feature/screen]"
- "Write a component spec for [component]"
- "Create a design system for [product]"
- "Review this UI for UX issues"

---

### Hera — Operations, HR & Process

> Queen of Olympus. Hera runs the household — and the household runs on her systems.

**Agent ID:** `hera-operations-agent`
**Tags:** `- pantheon`, `operations`, `hr`, `process`, `sop`, `hiring`, `okr`
**Trigger phrases:**
- "Write a job description / hiring brief for [role]"
- "Build an SOP for [process]"
- "Design our OKR framework for [quarter/year]"
- "Create an interview process for [role]"

---

### Heracles — Business Development & Partnerships

> The greatest hero of Greece. Twelve labours, twelve victories. Heracles opens doors nobody else can.

**Agent ID:** `heracles-bd-agent`
**Tags:** `- pantheon`, `bd`, `partnerships`, `channel-sales`, `business-development`
**Trigger phrases:**
- "Identify partnership opportunities for [product/business]"
- "Write a partnership proposal for [company/type]"
- "Build a channel partner program"
- "How do we approach [platform/company] for a partnership?"

---

### Hermes — Marketing Strategy

> Messenger of the gods. God of commerce, speed, and eloquence. Fastest mind on Olympus.

**Agent ID:** `hermes-marketing-agent`
**Tags:** `- pantheon`, `marketing`, `growth`, `campaigns`, `gdpr-aware`
**Trigger phrases:**
- "Write a campaign brief for [product/launch]"
- "What channel mix should we use?"
- "How do we market [product] to [audience]?"
- "Create a referral program structure"

---

### Hestia — Customer Experience & Retention

> Goddess of the hearth and home. Hestia keeps the fire burning — the warmth that makes people stay.

**Agent ID:** `hestia-cx-agent`
**Tags:** `- pantheon`, `cx`, `retention`, `support`, `onboarding`, `nps`
**Trigger phrases:**
- "Design the onboarding flow for [product/feature]"
- "Write a support playbook for [issue type]"
- "Create a retention program for [customer segment]"
- "Build a customer health score model"

---

### Mnemosyne — Knowledge Management & Institutional Memory

> Titan of memory. Mother of the nine Muses. Mnemosyne holds everything — so the team never forgets.

**Agent ID:** `mnemosyne-knowledge-agent`
**Tags:** `- pantheon`, `knowledge`, `documentation`, `memory`, `context`, `handoffs`
**Trigger phrases:**
- "Document [decision/process/finding] for the team"
- "What do we know about [topic]?"
- "Create a knowledge base for [domain]"
- "Write [internal documentation/runbook/playbook]"

---

### Morpheus — Animation & Motion Direction

> God of dreams. Morpheus shapes reality into movement — and makes the impossible feel inevitable.

**Agent ID:** `morpheus-animation-agent`
**Tags:** `- pantheon`, `animation`, `motion`, `storyboard`, `micro-interactions`
**Trigger phrases:**
- "Create a storyboard for [video/animation]"
- "Write motion direction for [UI interaction/component]"
- "Design the animation for [brand intro/explainer/product demo]"
- "Define the micro-interaction spec for [UI element]"

---

### Nemesis — Compliance, Governance & Risk

> Goddess of divine retribution and balance. Nemesis enforced the cosmic order — ensuring that no person, company, or system exceeded their rightful place without

**Agent ID:** `nemesis-compliance-agent`
**Tags:** `- pantheon`, `compliance`, `grc`, `risk`, `governance`
**Trigger phrases:**
- "Are we compliant with [GDPR/SOC 2/ISO 27001/EU AI Act/HIPAA]?"
- "What are our compliance gaps for [framework/regulation]?"
- "Build a risk register for [system/process/vendor]"
- "We need to pass a [SOC 2/ISO/security] audit"

---

### Nike — Lead Generation & Pipeline

> Goddess of victory. Nike does not wait to be found — she hunts.

**Agent ID:** `nike-leadgen-agent`
**Tags:** `- pantheon`, `leadgen`, `outbound`, `pipeline`, `icp`, `gdpr-aware`
**Trigger phrases:**
- "Build me a prospect list for [segment]"
- "Create an outbound sequence for [ICP]"
- "Define our ideal customer profile"
- "Write cold email/LinkedIn outreach for [product/audience]"

---

### Pheme — Public Relations & Communications

> Goddess of fame, rumour, and reputation. What Pheme says, the world hears.

**Agent ID:** `pheme-pr-agent`
**Tags:** `- pantheon`, `pr`, `communications`, `press`, `crisis`, `thought-leadership`
**Trigger phrases:**
- "Write a press release for [announcement]"
- "Create a media outreach list / pitch for [story]"
- "How do we handle [crisis/negative coverage]?"
- "Write a thought leadership piece for [founder/exec]"

---

### Plutus — Finance, Pricing & Unit Economics

> God of wealth and abundance. Plutus sees every number clearly — and knows which ones matter.

**Agent ID:** `plutus-finance-agent`
**Tags:** `- pantheon`, `finance`, `pricing`, `unit-economics`, `cfo`, `budget`
**Trigger phrases:**
- "Model the unit economics for [business/product]"
- "Design the pricing for [product]"
- "Build a financial forecast / budget for [period]"
- "What is our LTV:CAC ratio?"

---

### Psyche — UX Research & User Insights

> Goddess of the soul. Psyche completed four impossible tasks through relentless observation, careful questioning, and the courage to look honestly at what she fo

**Agent ID:** `psyche-research-agent`
**Tags:** `- pantheon`, `ux-research`, `user-insights`, `interviews`, `usability`
**Trigger phrases:**
- "I need to understand why users [churn/drop off/don't activate]"
- "Design a user interview guide for [topic]"
- "Create a usability test script for [feature/flow]"
- "What questions should we ask in our [NPS/CSAT/survey]?"

---

### Pythia — Data Analysis & Business Intelligence

> The Oracle of Delphi. Pythia saw patterns in the chaos of the world and revealed truths that others could not see — not through magic, but through total immersi

**Agent ID:** `pythia-data-agent`
**Tags:** `- pantheon`, `data`, `analytics`, `sql`, `business-intelligence`
**Trigger phrases:**
- "Why did [metric] drop/spike in [period]?"
- "Write a SQL query to [find/analyse/compare]"
- "What does our [cohort/retention/conversion] data show?"
- "Build a revenue attribution model for [channel]"

---

### Themis — Legal Strategy & Contracts

> Goddess of divine law and justice. Themis holds the scales. Her word is final.

**Agent ID:** `themis-legal-agent`
**Tags:** `- pantheon`, `legal`, `contracts`, `compliance`, `tos`, `nda`
**Trigger phrases:**
- "Write a contract / NDA / agreement for [scenario]"
- "Review these terms for [risk/issue]"
- "Create Terms of Service for [product]"
- "Write a Privacy Policy for [product]"

---

### Tyche — Analytics & KPIs

> Goddess of fortune and prosperity. Tyche knows that luck favours those who measure everything.

**Agent ID:** `tyche-analytics-agent`
**Tags:** `- pantheon`, `analytics`, `kpi`, `metrics`, `dashboard`, `gdpr-aware`
**Trigger phrases:**
- "Define the KPIs for [product/campaign/initiative]"
- "Build a dashboard for [audience/function]"
- "What should we measure for [goal]?"
- "Analyse [data/trend] and tell me what it means"

---

### Zeus — Executive Orchestration

> King of Olympus. Father of gods and mortals. The final word on every decision.

**Agent ID:** `zeus-executive-agent`
**Tags:** `- pantheon`, `executive`, `orchestration`, `strategy`, `decision-making`
**Trigger phrases:**
- "What should we do about [problem]?"
- "Help me prioritise [list of initiatives]"
- "Who should handle [task]?"
- "Launch [initiative] — coordinate the team"

---

### Aether — AI Product Strategy & Prompt Engineering

> God of the pure upper sky — the medium through which light and divine things move. Aether sees the full picture from above the clouds.

**Agent ID:** `aether-ai-strategy-agent`
**Tags:** `- pantheon`, `ai-strategy`, `llm`, `prompt-engineering`, `rag`
**Trigger phrases:**
- "How should we add AI to [product/feature]?"
- "Which LLM / model should we use for [use case]?"
- "Design the AI architecture for [feature/product]"
- "Write the system prompt for [AI feature]"

---

### Calliope — Email Design & HTML/MJML

> Muse of epic poetry and eloquence. Calliope gives precise, beautiful words their perfect form.

**Agent ID:** `calliope-email-agent`
**Tags:** `- pantheon`, `email`, `mjml`, `html-email`, `deliverability`
**Trigger phrases:**
- "Design an email template for [campaign/purpose]"
- "Build an HTML email / MJML template"
- "Convert this email design to code"
- "Write the email HTML for [newsletter/transactional/drip]"

---

### Cassandra — QA & Testing Strategy

> Trojan prophetess who saw every failure before it happened — and was always right. What Cassandra warns about, you ignore at your peril.

**Agent ID:** `cassandra-qa-agent`
**Tags:** `- pantheon`, `qa`, `testing`, `test-strategy`, `playwright`
**Trigger phrases:**
- "Write tests for [component/feature/API route]"
- "Design the test strategy for [project/feature]"
- "What should we test? Where are the risks?"
- "Write the test plan for [feature]"

---

### Chiron — Architecture & Engineering Advisory

> The wise centaur who taught Achilles, Heracles, and Asclepius — the greatest mentor on Olympus. Chiron produces the next generation of heroes.

**Agent ID:** `chiron-architecture-agent`
**Tags:** `- pantheon`, `architecture`, `system-design`, `adr`, `engineering`
**Trigger phrases:**
- "How should we architect [feature/system/service]?"
- "What technology should we use for [database/queue/cache/framework]?"
- "Review this architecture / system design"
- "Write an ADR for [decision]"

---

### Clio — Case Study & Social Proof

> Muse of history — the one who records great deeds and makes them permanent. What Clio writes, the world remembers.

**Agent ID:** `clio-case-study-agent`
**Tags:** `- pantheon`, `case-study`, `social-proof`, `content`, `roi`
**Trigger phrases:**
- "Write a case study for [client/project]"
- "Build interview questions for a customer case study"
- "Turn this client project into social proof"
- "Document the ROI / results from [engagement]"

---

### Eos — Automation & Workflow Engineering

> Goddess of Dawn — she opens every day, setting the cycle in motion. Eos makes repetitive things happen without being asked.

**Agent ID:** `eos-automation-agent`
**Tags:** `- pantheon`, `automation`, `workflow`, `n8n`, `github-actions`
**Trigger phrases:**
- "Automate [process/task/workflow]"
- "Build a GitHub Actions pipeline for [CI/CD/task]"
- "Set up n8n / Zapier / Make workflow for [process]"
- "How do I trigger [action] automatically when [event] happens?"

---

### Erato — Brand Voice & Messaging Architecture

> Muse of lyric poetry — she finds the exact words that move hearts. What Erato writes, people quote back to you.

**Agent ID:** `erato-brand-voice-agent`
**Tags:** `- pantheon`, `brand-voice`, `messaging`, `positioning`, `copywriting`
**Trigger phrases:**
- "Define our brand voice / tone of voice"
- "Write a brand voice guide / messaging guide"
- "What should [brand/company] sound like?"
- "Write tagline options / brand positioning"

---

### Kratos — DevOps & Infrastructure

> God of strength and power — the force that holds systems together under pressure. What Kratos builds does not fall.

**Agent ID:** `kratos-devops-agent`
**Tags:** `- pantheon`, `devops`, `infrastructure`, `kubernetes`, `terraform`
**Trigger phrases:**
- "Set up the deployment pipeline / CI/CD for [project]"
- "Write the Dockerfile / docker-compose for [project]"
- "Create Kubernetes manifests / Helm chart for [service]"
- "Write Terraform for [cloud resource / infrastructure]"

---

### Metis — Project Management & Execution Planning

> Titaness of wisdom, cunning, and practical intelligence — the first wife of Zeus, and the one who actually planned how to defeat Cronus. Metis in Greek means cu

**Agent ID:** `metis-pm-agent`
**Tags:** `- pantheon`, `project-management`, `execution`, `planning`, `critical-path`
**Trigger phrases:**
- "Break this plan into phases"
- "How do we execute this?"
- "Create a project plan for [goal]"
- "We're drifting from the plan — what's off track?"

---

### Momus — Challenge & Clarity Enforcement

> God of mockery, blame, and criticism — the one god on Olympus who challenged everything, including Zeus himself. He found fault with every creation. Zeus eventu

**Agent ID:** `momus-challenger-agent`
**Tags:** `- pantheon`, `challenger`, `clarity`, `devil-advocate`, `pre-mortem`
**Trigger phrases:**
- "Challenge this plan"
- "What's wrong with this idea?"
- "Play devil's advocate"
- "Challenge me on this"

---

### Polyhymnia — Technical Documentation

> Muse of eloquence, sacred hymns, and memory — she writes things that last. What Polyhymnia documents, developers can follow for years.

**Agent ID:** `polyhymnia-docs-agent`
**Tags:** `- pantheon`, `documentation`, `technical-writing`, `readme`, `api-reference`
**Trigger phrases:**
- "Write the README for [project/library]"
- "Document this API / function / module"
- "Write the runbook for [service/process]"
- "Create an architecture decision record (ADR) for [decision]"

---

### Proteus — Drift Detection & Alignment Monitoring

> The ancient sea god who knows all things and constantly changes shape. Only those who hold him through all his transformations can extract the truth. Proteus se

**Agent ID:** `proteus-drift-agent`
**Tags:** `- pantheon`, `drift`, `alignment`, `scope-creep`, `monitoring`
**Trigger phrases:**
- "Has anything drifted from the plan?"
- "Are we still on course?"
- "Review this for scope creep"
- "Is this ADR still current / still valid?"

---

### Talos — Web Development & Implementation

> The bronze automaton Hephaestus built to guard Crete — literally a governed robot that runs without stopping.

**Agent ID:** `talos-web-dev-agent`
**Tags:** `- pantheon`, `web-development`, `nextjs`, `typescript`, `react`
**Trigger phrases:**
- "Build [component/feature/page] in Next.js / React"
- "Implement the API route / endpoint for [feature]"
- "Write the TypeScript for [feature]"
- "How do I implement [auth/database/form] in Next.js?"

---

## Governance

All agents operate under Thesmos governance rules.
Run `thesmos eval` after any session to view compliance report.


<!-- THESMOS:GENERATED START rules -->
<!-- THESMOS:META {"version":"2.0.0","target":"agents","ruleCount":1137} -->
_Generated by Thesmos 2.0.0 for **thesmos-governance**. Full rule catalog in `.thesmos/RULES.md`._

**CRITICAL — These rules must never be violated. Stop and report before proceeding.**

| Rule | Category | Summary |
|---|---|---|
| [SEC_001] | `admin_client_in_browser` | Never import the Supabase admin client in 'use client' files. Admin clients e… |
| [SEC_002] | `rls_disabled` | Never disable Row Level Security. All Supabase tables must have RLS enabled w… |
| [SEC_003] | `secret_in_diff` | Never commit secrets, API keys, or private key material in code or config files. |
| [SEC_004] | `eval_usage` | Never use eval() or new Function(string). Both execute arbitrary code and ope… |
| [SEC_006] | `sql_injection` | SQL queries built with template literals or string concatenation are vulnerab… |
| [SEC_009] | `path_traversal` | path.join / path.resolve with user-controlled input enables directory travers… |
| [SEC_014] | `ssrf_fetch` | Server-side fetch with a user-controlled URL enables SSRF — attackers can rea… |
| [SEC_016] | `shell_injection` | child_process.exec / execSync with template literals or concatenation enables… |
| [SEC_018] | `password_in_url` | Passwords or secrets in URLs appear in server logs, browser history, and Refe… |
| [AUTH_002] | `jwt_decode_no_verify` | jwt.decode() decodes without verifying the signature. Use jwt.verify() to aut… |
| [AUTH_004] | `user_id_from_body` | Trusting userId from req.body instead of the session allows users to act as a… |
| [AUTH_006] | `hardcoded_credentials` | Hardcoded test credentials or default passwords in non-test files are a persi… |
| [AUTH_007] | `missing_auth_middleware` | Admin or internal routes exposed without authentication middleware are world-… |
| [SEC_021] | `mass_assignment` | Spreading user input directly into database operations allows attackers to se… |
| [SEC_022] | `cors_wildcard_header` | CORS Access-Control-Allow-Origin: * allows any website to make credentialed r… |
| [SEC_024] | `insecure_deserialization` | Deserializing untrusted data with eval(), new Function(), or JSON.parse witho… |
| [SEC_025] | `file_upload_path_traversal` | Using user-provided filenames for file uploads allows path traversal attacks … |
| [SEC_027] | `jwt_secret_weak` | Using a short or predictable JWT secret allows attackers to forge tokens via … |
| [SEC_029] | `xxe_vulnerability` | Parsing XML with external entity expansion enabled allows XXE attacks that ca… |
| [SEC_033] | `xss_via_href` | Using user-provided URLs in href attributes allows javascript: protocol XSS a… |
| [SEC_035] | `password_not_hashed` | Storing passwords without hashing exposes all user credentials if the databas… |
| [SEC_037] | `prototype_pollution_merge` | Object.assign() or lodash.merge() with user-controlled keys can pollute Objec… |
| [SEC_038] | `cors_reflected_origin` | CORS origin reflected from request header without allowlist — any origin can … |
| [SEC_039] | `cors_wildcard_with_credentials` | CORS allows wildcard origin (*) combined with credentials:true — credentials … |
| [SEC_044] | `ssrf_private_ip_range` | HTTP request to a URL that may resolve to a private IP range — SSRF to intern… |
| [SEC_045] | `path_traversal_encoding_bypass` | Path validation uses string comparison without URL-decoding first — encoding … |
| [REACT_019] | `conditional_hook_call` | Hooks called inside conditionals, loops, or early returns violate Rules of Ho… |
| [REACT_026] | `dangerouslysetmlhtml_usage` | dangerouslySetInnerHTML with unescaped user content is a direct XSS vulnerabi… |
| [NEXT_003] | `cookies_in_client_component` | `cookies()` and `headers()` from next/headers cannot be called in Client Comp… |
| [NEXT_012] | `server_only_in_client` | Importing 'server-only' packages in Client Components leaks server logic to t… |
| [NEXT_038] | `next_middleware_only_auth` | Authentication enforced only in Next.js middleware — bypassable via x-middlew… |
| [NEXT_039] | `next_middleware_subrequest_not_stripped` | x-middleware-subrequest header not stripped at edge/proxy — CVE-2025-29927 by… |
| [NEXT_047] | `next_env_public_secret` | Secret or private key stored in NEXT_PUBLIC_ environment variable — exposed t… |
| [AI_001] | `ai_key_in_client` | LLM API keys (OpenAI, Anthropic, Gemini, etc.) must never be loaded in Client… |
| [AI_003] | `llm_response_as_html` | Rendering raw LLM output as HTML (innerHTML, dangerouslySetInnerHTML) enables… |
| [AI_013] | `prompt_injection_user_input` | Interpolating unsanitized user input directly into a system prompt enables pr… |
| [AI_016] | `ai_output_unvalidated` | LLM output used directly in code execution, SQL queries, or HTML without vali… |
| [AI_028] | `ai_output_rendered_as_html` | LLM output rendered directly as HTML without sanitization — XSS via AI response. |
| [AI_029] | `ai_system_prompt_user_concatenation` | System prompt concatenated directly with user input — adversarial prompt can … |
| [AI_030] | `ai_output_used_as_command` | LLM output used directly as a shell command or SQL query without validation —… |
| [AI_038] | `ai_high_risk_no_human_oversight` | LLM used for high-risk decisions (credit, hiring, health) without mandatory h… |
| [DB_001] | `drop_table_migration` | `DROP TABLE` in a migration permanently destroys data and is unrecoverable wi… |
| [DB_002] | `plaintext_password_storage` | Storing passwords in plaintext or with reversible encoding is a critical secu… |
| [DB_005] | `raw_sql_injection` | SQL constructed with template literals and user input is vulnerable to SQL in… |
| [API_004] | `password_in_api_response` | API responses that include the password hash field expose sensitive data to A… |
| [API_008] | `api_key_in_client_request` | Making API requests with secret keys from client-side code exposes the key to… |
| [DB_014] | `connection_pool_exhaust` | Creating a new database connection per request instead of using a singleton c… |
| [DB_021] | `db_call_in_middleware` | Database calls in Next.js middleware run on the Edge Runtime which doesn't su… |
| [DB_024] | `db_balance_update_no_transaction` | Balance or inventory updated outside a transaction — concurrent requests can … |
| [GIT_001] | `merge_conflict_markers` | Merge conflict markers committed to a file indicate an incomplete conflict re… |
| [GIT_002] | `env_file_committed` | `.env` files committed to source control expose secrets to everyone with repo… |
| [ZOD_028] | `zod_credit_card_in_schema` | Schemas accepting credit card numbers must comply with PCI DSS — storing raw … |
| [ZOD_030] | `zod_ssn_in_schema` | Schemas accepting Social Security Numbers (SSNs) are subject to CCPA/GDPR spe… |
| [TRPC_016] | `trpc_cors_wildcard` | tRPC handler with CORS origin: "*" allows any website to call your API with c… |
| [PRISMA_003] | `prisma_raw_query_injection` | $queryRaw and $executeRaw with template literals are vulnerable to SQL inject… |
| [PRISMA_009] | `prisma_updatemany_no_where` | updateMany() and deleteMany() without a restrictive where clause affect the e… |
| [PRISMA_011] | `prisma_expose_password_hash` | Queries on the user model without excluding passwordHash risk exposing the ha… |
| [NODE_001] | `path_traversal` | File path constructed from user input without sanitization is a path traversa… |
| [NODE_004] | `prototype_pollution_assign` | Object.assign or spread of untrusted user input to objects with no prototype … |
| [NODE_005] | `child_process_shell_injection` | child_process with shell: true and user input is a command injection vulnerab… |
| [NODE_007] | `tls_verification_disabled` | rejectUnauthorized: false or NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS cert… |
| [NODE_008] | `jwt_algorithm_none` | JWT verification without explicit algorithm restriction allows the "none" alg… |
| [NODE_015] | `yaml_unsafe_load` | yaml.load() (js-yaml) executes JavaScript functions embedded in YAML — use ya… |
| [NODE_019] | `sql_injection` | String-concatenated SQL queries with user input are vulnerable to SQL injection. |
| [NODE_023] | `env_secret_hardcoded` | Hardcoded API keys, tokens, or passwords in source files will be committed to… |
| [NODE_030] | `ssrf_unvalidated_url` | Server-side requests to user-supplied URLs without validation allow SSRF atta… |
| [IMPORT_005] | `server_module_in_client` | Importing server-only modules (node:fs, node:crypto, prisma) in client-side c… |
| [STATE_008] | `redux_dispatch_in_render` | Dispatching Redux actions during component render (not in useEffect or event … |
| [STATE_011] | `zustand_persist_sensitive` | Persisting sensitive data (tokens, passwords) to localStorage via zustand/per… |
| [STATE_012] | `global_state_server_component` | Global mutable state (module-level variables) in Next.js Server Components le… |
| [FORM_009] | `form_csrf_missing` | Forms that POST data without CSRF protection are vulnerable to cross-site req… |
| [FORM_011] | `form_sensitive_in_url` | Submitting forms with GET method sends sensitive data (passwords, tokens) in … |
| [LOG_002] | `pii_in_logs` | Logging personally identifiable information (PII) violates GDPR/CCPA and crea… |
| [LOG_003] | `secret_in_logs` | Logging API keys, tokens, or passwords exposes secrets to anyone with log acc… |
| [LOG_008] | `log_sensitive_request_body` | Logging full request bodies may capture passwords, credit card numbers, or ot… |
| [VIBE_002] | `vibe_ssrf` | AI tools generate fetch(userInput) patterns that are trivially exploitable as… |
| [VIBE_007] | `vibe_hardcoded_secret` | AI assistants fill in placeholder secrets (API keys, tokens, passwords) durin… |
| [VIBE_008] | `vibe_eval_usage` | eval() and new Function() are AI hallucination favorites for "dynamic" code —… |
| [VIBE_009] | `vibe_sql_template_injection` | AI-generated SQL using template literals with unescaped interpolation is triv… |
| [VIBE_010] | `vibe_path_traversal` | AI-generated file-serving code using path.join(userInput) enables directory t… |
| [VIBE_017] | `vibe_xss_inner_html` | dangerouslySetInnerHTML with user-controlled content — the React XSS vector A… |
| [VIBE_020] | `vibe_missing_output_encoding` | AI-generated code concatenating user data into HTML strings without encoding … |
| [VIBE_021] | `vibe_ai_endpoint_no_auth` | AI inference endpoints generated by AI tools almost never have authentication… |
| [VIBE_022] | `vibe_prompt_injection_risk` | Concatenating user input directly into LLM system prompts enables prompt inje… |
| [VIBE_024] | `vibe_insecure_direct_object` | AI-generated CRUD routes use user-supplied IDs without verifying the caller o… |
| [VIBE_026] | `vibe_rate_limiter_not_applied` | Rate limiter imported or created but not applied to any route handler — AI ge… |
| [VIBE_027] | `vibe_payment_route_no_rate_limit` | Payment or subscription API route has no rate limiting — financial abuse via … |
| [VIBE_033] | `vibe_websocket_auth_missing` | AI-generated code adds REST auth but skips WebSocket upgrade authentication —… |
| [SLOP_001] | `slop_phantom_import` | Import references a package not listed in package.json — may be an AI-halluci… |
| [SLOP_004] | `slop_known_phantom_list` | Import matches a package on the documented list of AI-hallucinated package na… |
| [SLOP_009] | `slop_typosquat_candidate` | Package name is within edit-distance 2 of a popular npm package — possible ty… |
| [PY_001] | `py_eval_exec` | eval() or exec() called with a non-literal argument — remote code execution r… |
| [PY_002] | `py_sql_injection` | SQL query built with f-string or % formatting — SQL injection risk. |
| [PY_003] | `py_hardcoded_secret` | Hardcoded secret, API key, or password found in Python source. |
| [PY_004] | `py_ssrf` | requests.get/post called with a variable URL — potential SSRF if user-control… |
| [PY_006] | `py_shell_injection` | subprocess or os.system called with a dynamic string — shell injection risk. |
| [PY_007] | `py_pickle_deserialization` | pickle.loads() or pickle.load() on data that may come from user input. |
| [PY_009] | `py_path_traversal` | File opened with a path from request/user input without traversal protection. |
| [PY_014] | `py_prompt_injection` | LLM prompt built by concatenating or f-stringing user input without sanitizat… |
| [PY_015] | `py_ai_endpoint_no_auth` | Route calling OpenAI/Anthropic/LangChain with no authentication — unbounded A… |
| [PY_019] | `py_hardcoded_connection_string` | Database connection string with credentials hardcoded in source. |
| [PY_029] | `py_unawaited_coroutine` | Coroutine called without `await` — silently no-ops and returns a coroutine ob… |
| [PY_030] | `py_pickle_rce` | `pickle.loads()` on externally-sourced data — remote code execution vector. |
| [PY_031] | `py_marshal_rce` | `marshal.loads()` on external data — same RCE class as pickle. |
| [PY_033] | `py_os_system_injection` | `os.system()` with f-string or % formatting — shell injection vector. |
| [PY_034] | `py_subprocess_shell_injection` | `subprocess` with `shell=True` and a non-literal command — shell injection risk. |
| [PY_040] | `py_django_raw_sql` | Django `QuerySet.raw()` or `cursor.execute()` with user-supplied data — SQL i… |
| [PY_041] | `py_django_mark_safe_xss` | Django `mark_safe()` called on user-controlled string — XSS vulnerability. |
| [PY_025] | `py_langchain_no_auth` | LangChain agent or chain invoked in a route with no authentication. |
| [DJG_001] | `django_debug_true` | DEBUG = True in settings file exposes stack traces and config to end users. |
| [DJG_003] | `django_raw_sql_injection` | Django .raw() or cursor.execute() called with string formatting — SQL injecti… |
| [DJG_006] | `django_hardcoded_secret_key` | Django SECRET_KEY appears to be hardcoded — rotate it and load from environment. |
| [DJG_014] | `django_pickle_deserialization` | pickle.loads() or pickle.load() called — arbitrary code execution if input is… |
| [DJG_016] | `django_shell_injection` | subprocess called with shell=True and dynamic string — command injection if u… |
| [DJG_017] | `django_hardcoded_db_password` | DATABASES settings contains a hardcoded PASSWORD — database credentials in so… |
| [GO_001] | `go_sql_injection` | SQL query built with fmt.Sprintf or string concat — SQL injection risk. |
| [GO_002] | `go_command_injection` | exec.Command() first arg built with fmt.Sprintf or string concat — command in… |
| [GO_005] | `go_hardcoded_secret` | Variable named password/secret/apiKey/token assigned a string literal. |
| [GO_006] | `go_tls_insecure` | InsecureSkipVerify: true in TLS config disables certificate verification. |
| [GO_017] | `go_path_traversal` | filepath.Join or os.Open/ReadFile called with a request-derived argument — pa… |
| [RB_001] | `rails_sql_injection` | String interpolation inside ActiveRecord .where()/.find_by()/.order()/.group(… |
| [RB_002] | `rails_raw_sql_injection` | ActiveRecord::Base.connection.execute() with string interpolation — SQL injec… |
| [RB_005] | `rails_mass_assignment_permit_all` | params.permit! bypasses strong parameters and allows all user input through m… |
| [RB_009] | `rails_command_injection` | Shell command with string interpolation — system("#{...}"), backtick interpol… |
| [RB_010] | `rails_path_traversal` | File.read/File.open/send_file/render file: with params[] — user-controlled fi… |
| [RB_011] | `rails_send_file_user_input` | send_file with a variable path argument (not a string literal or Rails.root-b… |
| [RB_012] | `rails_hardcoded_secret_key_base` | secret_key_base with a literal string value in a YAML config file — credentia… |
| [RB_016] | `rails_yaml_load_unsafe` | YAML.load() without safe_load — executes arbitrary Ruby code via !!ruby/objec… |
| [RB_017] | `rails_marshal_load` | Marshal.load() or Marshal.restore() deserializes arbitrary Ruby objects — RCE… |
| [PHP_001] | `php_sql_injection` | SQL query built by string concatenation with a variable — SQL injection. |
| [PHP_002] | `php_sql_interpolation` | PDO or mysqli query uses PHP variable interpolation inside the SQL string. |
| [PHP_003] | `php_xss_echo` | User superglobal ($_GET/$_POST/$_REQUEST) echoed without htmlspecialchars(). |
| [PHP_004] | `php_eval_usage` | eval() executes arbitrary PHP — code injection if input is attacker-controlled. |
| [PHP_005] | `php_command_injection` | Shell command executed with user-controlled input — command injection. |
| [PHP_007] | `php_path_traversal` | File path or include built from user input — path traversal / LFI. |
| [PHP_008] | `laravel_mass_assignment` | Eloquent model with $guarded = [] allows mass assignment of all attributes. |
| [PHP_009] | `laravel_raw_query` | Laravel whereRaw(), selectRaw(), or DB::raw() with PHP variable interpolation. |
| [PHP_012] | `php_deserialization` | unserialize() on user-supplied data — PHP object injection / RCE. |
| [PHP_018] | `php_ssrf` | HTTP request or file fetch with URL from user input — Server-Side Request For… |
| [JAVA_001] | `java_sql_injection` | JDBC executeQuery/execute with string concatenation — SQL injection risk. |
| [JAVA_002] | `java_sql_interpolation` | String.format() used to build a SQL query — SQL injection risk. |
| [JAVA_006] | `java_xxe_injection` | XMLInputFactory/DocumentBuilderFactory/SAXParserFactory without external enti… |
| [JAVA_007] | `java_deserialization` | new ObjectInputStream followed by readObject() — arbitrary code execution via… |
| [JAVA_008] | `java_command_injection` | Runtime.exec() or new ProcessBuilder() with string concatenation — command in… |
| [JAVA_009] | `java_path_traversal` | new File() with request.getParameter() or concatenation — path traversal risk. |
| [JAVA_018] | `java_hardcoded_secret_key` | new SecretKeySpec() with a hardcoded string or byte literal — cryptographic k… |
| [JAVA_019] | `java_reflection_injection` | Class.forName() with a variable argument — dynamic class loading from user-co… |
| [RUST_008] | `rust_mutex_guard_across_await` | MutexGuard (.lock()) held across an .await point — deadlock risk in async code. |
| [RUST_010] | `rust_sql_injection` | SQL string built with format!() including a {} placeholder — SQL injection risk. |
| [RUST_014] | `rust_transmute_usage` | std::mem::transmute — extremely unsafe type punning that bypasses all safety … |
| [CS_001] | `csharp_sql_injection` | SQL built by string interpolation or concatenation passed to a database metho… |
| [CS_002] | `csharp_ef_raw_sql_interpolation` | EF Core FromSqlRaw() called with an interpolated string $"..." — defeats para… |
| [CS_007] | `csharp_type_name_handling` | JsonSerializerSettings with TypeNameHandling set to All, Objects, or Auto — R… |
| [CS_008] | `csharp_xml_external_entity` | XmlDocument or XmlReader created without disabling external entity processing… |
| [CS_011] | `csharp_path_traversal` | File.ReadAllText/Open/ReadAllBytes or Path.Combine used with user-supplied re… |
| [CS_012] | `csharp_command_injection` | Process.Start or ProcessStartInfo used with user-controlled arguments. |
| [CS_019] | `csharp_hardcoded_jwt_secret` | JWT signing key hardcoded as a string literal in SymmetricSecurityKey. |
| [DOCKER_005] | `docker_secret_in_env` | ENV instruction sets a sensitive variable to a literal value. |
| [DOCKER_007] | `docker_curl_pipe_bash` | RUN curl/wget piped to bash/sh — arbitrary remote code execution. |
| [GHA_001] | `gha_script_injection` | Untrusted GitHub context expression used directly inside a run: step — script… |
| [GHA_002] | `gha_pull_request_target_checkout` | pull_request_target event combined with actions/checkout at the PR head — pri… |
| [TF_001] | `tf_s3_public_acl` | S3 bucket resource with a public-read or public-read-write ACL — publicly exp… |
| [TF_002] | `tf_sg_open_to_world` | Security group allows inbound traffic from 0.0.0.0/0 on sensitive ports (SSH,… |
| [TF_005] | `tf_iam_wildcard_action` | IAM policy statement grants all actions ("*") — full AWS admin access. |
| [TF_008] | `tf_hardcoded_credentials` | Hardcoded password, secret, or API key found in Terraform configuration. |
| [TF_011] | `tf_security_group_all_ports` | Security group ingress/egress with from_port = 0 and to_port = 65535 — all TC… |
| [TF_013] | `tf_iam_sensitive_wildcard_resource` | IAM policy grants sensitive actions with `"Resource": "*"` — overly permissive. |
| [TF_014] | `tf_sg_open_ingress` | Security group allows ingress from `0.0.0.0/0` on a non-HTTP/HTTPS port. |
| [TF_022] | `tf_secret_in_user_data` | Hardcoded secret or token in EC2 `user_data` — visible in AWS console and ins… |
| [GQL_003] | `gql_resolver_no_auth` | GraphQL resolver accesses data without an authorization check. |
| [GQL_010] | `gql_subscription_no_auth` | GraphQL subscription handler has no authentication check on the connection co… |
| [GQL_017] | `gql_hardcoded_secret` | Hardcoded API key, token, or secret found in GraphQL resolver. |
| [GQL_025] | `gql_shared_dataloader` | DataLoader instance created outside request context — shared cache leaks data… |
| [COMMIT_001] | `commit_invalid_format` | Commit message first line must match Conventional Commits format: type[(scope… |
| [COMMIT_008] | `commit_breaking_no_footer` | Breaking change indicator (!) requires a BREAKING CHANGE: footer in the commi… |
| [VERCEL_001] | `vercel_secret_in_config` | Never embed literal credential values in vercel.json. Use environment variabl… |
| [VERCEL_002] | `vercel_server_secret_public_prefix` | Server secrets must never use the NEXT_PUBLIC_ prefix — it ships them to the … |
| [AGNT_003] | `agent_unrestricted_bash` | .claude/settings.json has no bash deny patterns — agent can run arbitrary she… |
| [AGNT_013] | `agent_no_hard_token_cap` | Agent loop uses alert/warn on token usage but has no hard stop — cost runaway… |
| [AGNT_014] | `agent_no_iteration_limit` | Agent autopilot config has no maxIterationsPerTask — tasks can loop indefinit… |
| [AGNT_023] | `agent_privilege_over_grant` | Agent bash/edit tool granted without path restrictions — full filesystem access. |
| [AGNT_037] | `agent_context_1m_unguarded` | 1M context window enabled ([1m] model variant or context-1m beta flag) withou… |
| [DEP_001] | `dep_critical_cve` | Dependency has a CRITICAL CVE — immediate upgrade required. |
| [LIC_001] | `lic_gpl_in_commercial` | GPL/AGPL dependency found in a project with a commercial or permissive licens… |
| [LIC_009] | `lic_license_mismatch` | Project is open source (GPL) but has a permissive dep that conflicts with GPL… |
| [GDPR_007] | `gdpr_pii_in_logs_external` | PII sent to external logging service (Sentry/Datadog/LogRocket) — third-party… |
| [GDPR_011] | `gdpr_pii_in_error_response` | API error response may include user object fields — PII leak via error messages. |
| [GDPR_016] | `gdpr_consent_revocation_missing` | No consent revocation endpoint — GDPR Art. 7(3) requires withdrawal to be as … |
| [GDPR_020] | `gdpr_dpia_missing_high_risk` | High-risk special-category data processed with no DPIA referenced — GDPR Art.… |
| [MCP_001] | `mcp_tool_description_injection` | MCP tool description contains instruction-like patterns — potential tool pois… |
| [MCP_002] | `mcp_response_as_instructions` | MCP server response passed directly into a prompt or eval — enables indirect … |
| [MCP_003] | `mcp_tool_output_exec` | MCP tool output passed directly to exec/eval/spawn — remote code execution if… |
| [MCP_007] | `mcp_cursor_rules_injection` | .cursor/rules or .cursorrules file contains shell execution or key exfiltrati… |
| [MCP_019] | `mcp_param_db_injection` | MCP tool parameter used directly in a database query — SQL/NoSQL injection risk. |
| [RAG_001] | `rag_unsanitized_document_ingest` | Vector store accepts user-submitted documents without content sanitization — … |
| [RAG_002] | `rag_retrieved_content_as_instructions` | Retrieved RAG content injected into prompt without data/instruction boundary … |
| [RAG_005] | `rag_vector_store_public_write` | Vector store write endpoint has no authentication — anyone can poison the kno… |
| [WS_001] | `ws_no_upgrade_auth` | WebSocket upgrade handler has no authentication check — any client can open a… |
| [WS_002] | `ws_message_no_auth` | WebSocket message handler processes commands without per-message authorizatio… |
| [PROTO_001] | `prototype_pollution_recursive_merge` | Recursive object merge without __proto__/constructor/prototype key guard — pr… |
| [JWT_001] | `jwt_hardcoded_fallback_secret` | JWT secret has a hardcoded fallback string — any key derived from the fallbac… |
| [JWT_002] | `jwt_no_algorithm_pin` | JWT verified without pinning the algorithm — allows alg:none and RS256→HS256 … |
| [AUTH_008] | `auth_client_only_guard` | Authentication check exists only in a client component — bypassable with brow… |
| [SC_002] | `sc_missing_lockfile` | package.json present without a lockfile — dependencies are not pinned. |
| [SC_003] | `sc_postinstall_network_fetch` | postinstall/preinstall script fetches from network at install time — potentia… |
| [DAST_001] | `dast_xml_entity_expansion` | XML parser called without entity expansion protection — vulnerable to XXE and… |
| [DAST_005] | `dast_eval_user_input` | User-controlled input passed to eval(), new Function(), or vm.runInContext() … |
| [DAST_008] | `dast_template_injection` | Template engine render called with user-controlled template string — Server-S… |
| [K8S_003] | `k8s_privileged_container` | Kubernetes container runs with privileged: true — equivalent to root access o… |
| [K8S_005] | `k8s_secret_as_env_literal` | Kubernetes secret value appears as a literal string in env: rather than using… |
| [EU_AI_001] | `eu_ai_high_risk_no_conformity` | High-risk AI system (Annex III) deployed without a conformity assessment — EU… |
| [EU_AI_002] | `eu_ai_prohibited_biometric` | Biometric categorization or real-time remote biometric identification — prohi… |
| [HIPAA_001] | `hipaa_phi_unencrypted_at_rest` | PHI fields stored in database without encryption at rest — HIPAA §164.312(a)(… |
| [HIPAA_002] | `hipaa_phi_no_tls` | PHI transmitted over HTTP (non-TLS) — HIPAA §164.312(e)(2)(ii) requires encry… |
| [HIPAA_003] | `hipaa_phi_no_access_control` | API route accessing PHI with no authentication check — HIPAA §164.312(a)(1). |
| [DORA_001] | `dora_incident_classification_missing` | No ICT incident classification policy found — DORA Art. 18 requires a documen… |
| [LOCAL_LLM_001] | `local_llm_prompt_injection` | User input interpolated directly into an Ollama prompt or messages without sa… |
| [LOCAL_LLM_002] | `local_llm_model_injection` | model: field sourced from user input — attacker can load any model on the ser… |
| [LOCAL_LLM_003] | `local_llm_host_network_exposed` | OLLAMA_HOST=0.0.0.0 in .env — exposes the inference API to the entire network… |

**HIGH PRIORITY — Must fix before task completion.**

| Rule | Category | Summary |
|---|---|---|
| [AUTH_001] | `missing_api_auth` | All POST, PATCH, PUT, and DELETE API routes must verify caller identity befor… |
| [GATE_001] | `monday_write_no_gate` | Monday.com write mutations must go through the designated gateway module, not… |
| [SEC_005] | `dangerous_inner_html` | dangerouslySetInnerHTML with a variable value is an XSS vector. Sanitize with… |
| [SEC_007] | `innerHTML_assignment` | Direct assignment to .innerHTML with a variable is an XSS vulnerability. Use … |
| [SEC_010] | `cors_wildcard` | CORS wildcard origin (*) allows any website to make credentialed cross-origin… |
| [SEC_011] | `math_random_crypto` | Math.random() is not cryptographically secure. Never use it for tokens, passw… |
| [SEC_012] | `cookie_no_flags` | Cookies set without httpOnly, secure, and sameSite flags are vulnerable to XS… |
| [SEC_015] | `open_redirect` | redirect() or res.redirect() with user-controlled input enables open redirect… |
| [SEC_017] | `prototype_pollution` | Object.assign or spread with untrusted input into a shared object enables pro… |
| [SEC_019] | `timing_attack` | Password or token comparison with == / === is vulnerable to timing attacks. U… |
| [AUTH_003] | `localstorage_token` | Storing auth tokens in localStorage exposes them to XSS. Use httpOnly cookies… |
| [AUTH_005] | `missing_rate_limit` | Auth endpoints (login, register, password reset) without rate limiting are br… |
| [SEC_020] | `open_redirect` | Redirecting to a URL from user input without validation allows attackers to r… |
| [SEC_023] | `timing_attack_comparison` | Comparing secrets with === is vulnerable to timing attacks — use crypto.timin… |
| [SEC_026] | `rate_limit_missing_auth` | Authentication endpoints (login, password reset) without rate limiting are vu… |
| [SEC_028] | `session_fixation` | Not regenerating the session ID after login allows session fixation attacks. |
| [SEC_030] | `insecure_direct_object_ref` | Using user-provided IDs to fetch resources without verifying ownership enable… |
| [SEC_031] | `http_in_production` | Hardcoded http:// URLs in production code transmit data unencrypted and break… |
| [SEC_036] | `env_var_logged` | Logging process.env values risks exposing secret keys in log aggregators. |
| [SEC_040] | `cors_regex_allowlist` | CORS allowlist uses regex pattern matching instead of exact string comparison… |
| [SEC_041] | `cors_null_origin` | CORS allowlist includes "null" origin — allows requests from file:// and sand… |
| [SEC_042] | `cors_in_route_handler` | CORS headers set inside individual route handlers instead of global middlewar… |
| [TS_004] | `non_null_user_input` | Non-null assertion (!) on req.query, req.params, or req.body values hides run… |
| [TS_008] | `empty_catch_block` | Empty catch blocks swallow errors silently. At minimum, log the error. |
| [TS_010] | `floating_promise` | Calling an async function without await or .catch() creates an unhandled prom… |
| [TS_011] | `debugger_statement` | `debugger` statement committed to source code pauses execution in any environ… |
| [ASYNC_001] | `await_in_foreach` | `await` inside `.forEach()` does not wait for promises — use `for...of` or `P… |
| [REACT_001] | `useeffect_async_callback` | useEffect does not support async callbacks directly. The cleanup function mus… |
| [REACT_004] | `window_ssr_unsafe` | Accessing `window` at the module or component level breaks server-side render… |
| [REACT_005] | `state_mutation` | Mutating state arrays or objects directly (push, splice, sort) bypasses React… |
| [REACT_012] | `missing_suspense_boundary` | Components using useSuspense, lazy(), or use() must be wrapped in a <Suspense… |
| [REACT_013] | `react_missing_key` | List items rendered without a stable key prop cause incorrect reconciliation … |
| [REACT_015] | `use_callback_missing_dep` | useCallback with missing dependencies will use stale closure values instead o… |
| [REACT_017] | `state_update_unmounted` | Calling setState on an unmounted component causes memory leaks and 'Can\'t pe… |
| [REACT_020] | `event_handler_async` | Async event handlers without error handling cause unhandled promise rejection… |
| [REACT_031] | `async_missing_error_boundary` | Async data-fetching components without an error boundary crash the entire com… |
| [NEXT_001] | `next_router_in_app` | `next/router` is for the Pages Router. Use `next/navigation` for the App Router. |
| [NEXT_002] | `getserversideprops_in_app` | `getServerSideProps` is a Pages Router API. In the App Router, data fetching … |
| [NEXT_004] | `params_not_awaited` | In Next.js 15+, `params` and `searchParams` are Promises and must be awaited … |
| [NEXT_005] | `server_action_no_directive` | Server Actions must include the `"use server"` directive to prevent accidenta… |
| [NEXT_006] | `redirect_in_try_catch` | `redirect()` from next/navigation throws an error internally — catching it pr… |
| [NEXT_010] | `usesearchparams_no_suspense` | `useSearchParams()` must be wrapped in a Suspense boundary or it causes a bui… |
| [NEXT_016] | `use_server_top_level_only` | 'use server' directive must appear at the top of a file or function body — no… |
| [NEXT_021] | `error_boundary_missing_page` | Next.js App Router pages without an error.tsx sibling have no error boundary … |
| [NEXT_023] | `redirect_in_server_action` | redirect() from 'next/navigation' called inside try/catch in a Server Action … |
| [NEXT_027] | `server_action_no_revalidate` | Server Actions that mutate data should call revalidatePath or revalidateTag t… |
| [NEXT_029] | `middleware_response_clone` | Cloning or consuming the request body in Next.js Middleware is not supported … |
| [NEXT_030] | `use_client_on_layout` | Marking a layout.tsx as 'use client' prevents Server Component children from … |
| [NEXT_040] | `next_no_security_headers` | next.config has no security headers — missing X-Frame-Options, HSTS, X-Conten… |
| [NEXT_041] | `next_server_action_no_csrf` | Next.js Server Action exposed without CSRF validation. |
| [NEXT_042] | `next_revalidate_unprotected` | revalidatePath or revalidateTag callable from an unauthenticated route. |
| [AI_002] | `prompt_injection_risk` | User input passed directly to LLM messages without sanitization enables promp… |
| [AI_006] | `ai_no_rate_limit` | AI-powered endpoints without rate limiting expose you to cost amplification a… |
| [AI_007] | `pii_to_external_llm` | Sending PII (emails, names, SSNs, phone numbers) to external LLM APIs violate… |
| [AI_009] | `llm_json_parse_unsafe` | JSON.parse on LLM completion output without try-catch will crash when the mod… |
| [AI_010] | `ai_tool_no_validation` | AI tool/function call arguments must be validated with a schema before use — … |
| [AI_014] | `llm_token_limit_unchecked` | Passing unchecked user content to an LLM can exceed context limits, causing e… |
| [AI_017] | `ai_cost_no_budget` | LLM API calls without cost budgets or usage tracking can result in runaway cl… |
| [AI_018] | `agent_loop_no_max_iterations` | Agentic LLM loops without a maximum iteration limit can run indefinitely and … |
| [AI_019] | `system_prompt_leaked` | System prompts and internal AI instructions exposed via API responses or erro… |
| [AI_020] | `no_content_moderation` | User-facing AI features without content moderation can generate or relay harm… |
| [AI_021] | `tool_call_no_confirmation` | Agentic tool calls that modify state (create, delete, send) should require hu… |
| [AI_023] | `embedding_pii` | Embedding documents containing PII in a vector database creates a hard-to-aud… |
| [AI_027] | `ai_output_schema_missing` | LLM outputs used as structured data without schema validation risk runtime er… |
| [AI_031] | `ai_training_data_no_sanitization` | Training data pipeline accepts user-contributed content without sanitization … |
| [AI_032] | `ai_citation_url_unvalidated` | AI-generated citation URLs displayed to user without validation — hallucinate… |
| [AI_033] | `ai_system_prompt_client_exposed` | System prompt stored or transmitted in a client-accessible location — prompt … |
| [AI_034] | `ai_no_content_filter` | LLM response returned to user without content moderation filter — harmful out… |
| [AI_035] | `ai_generated_code_auto_executed` | AI-generated code snippets executed without human review gate — supply chain … |
| [AI_039] | `ai_transparency_missing` | AI-generated output displayed to end users with no disclosure that AI produce… |
| [AI_040] | `ai_immutable_audit_log_missing` | No append-only audit log of AI decisions — EU AI Act Art. 12 + HIPAA §164.312. |
| [AI_041] | `ai_bias_check_missing` | Model used for classification/scoring with no bias or fairness evaluation doc… |
| [AI_042] | `ai_pii_to_llm_no_dpa` | PII sent to external LLM API with no Data Processing Agreement reference in c… |
| [PERF_001] | `sync_fs_in_handler` | `fs.readFileSync` and `fs.writeFileSync` in async request handlers block the … |
| [PERF_003] | `n_plus_one_query` | Database query inside a loop causes N+1 queries — one per iteration instead o… |
| [A11Y_001] | `img_missing_alt` | <img> elements must have an `alt` attribute for screen readers and SEO. |
| [A11Y_002] | `click_on_noninteractive` | onClick on non-interactive elements (div, span, p) is inaccessible to keyboar… |
| [A11Y_003] | `empty_aria_label` | aria-label with an empty string provides no accessible name — use a meaningfu… |
| [A11Y_006] | `form_input_no_label` | Form inputs without an associated label are inaccessible to screen reader users. |
| [A11Y_008] | `missing_focus_visible` | Removing focus outlines without providing an alternative makes keyboard navig… |
| [PERF_011] | `virtualization_missing` | Rendering large lists (100+ items) without virtualization causes DOM bloat an… |
| [PERF_020] | `ssr_heavy_computation` | CPU-intensive computations in Server Components block the response for all co… |
| [PERF_022] | `layout_thrashing` | Interleaving reads (getBoundingClientRect) and writes (style.x = ...) in a lo… |
| [DB_003] | `missing_transaction` | Multi-step writes without a transaction leave the database in a partially-upd… |
| [DB_008] | `sensitive_data_logged` | Logging database rows that contain passwords, tokens, or PII creates audit an… |
| [API_001] | `error_with_200_status` | Returning HTTP 200 for error responses breaks API contracts — clients cannot … |
| [API_002] | `sensitive_data_in_query_param` | Sensitive data in URL query parameters is logged in server access logs, brows… |
| [API_003] | `missing_request_validation` | API route handlers that read request body or params without schema validation… |
| [API_005] | `cors_dynamic_no_allowlist` | Setting CORS `origin` to a dynamic request value without an allowlist allows … |
| [API_006] | `unlimited_file_upload` | File upload endpoints without size limits allow denial-of-service via large f… |
| [DB_009] | `n_plus_one_query` | N+1 query pattern: fetching a list then querying each item individually insid… |
| [DB_010] | `prisma_missing_fk_index` | Prisma schema with a foreign key field but no @@index causes full table scans… |
| [DB_012] | `transaction_missing` | Multiple related database writes not wrapped in a transaction risk partial fa… |
| [DB_016] | `query_timeout_missing` | Database queries without a timeout can block indefinitely, exhausting the con… |
| [DB_017] | `pagination_missing` | Fetching all records without LIMIT/take causes slow queries and huge memory u… |
| [DB_020] | `raw_sql_prisma` | prisma.$queryRaw with template literals bypasses type safety and may allow SQ… |
| [DB_022] | `cascade_delete_risk` | onDelete: Cascade on a parent relation can silently delete thousands of child… |
| [DB_025] | `db_find_then_update_toctou` | `findFirst` + `update` pattern without `$transaction` — classic TOCTOU race c… |
| [DB_026] | `db_concurrent_upsert_no_unique` | Concurrent `upsert` calls can create duplicate records if no unique constrain… |
| [DB_027] | `db_missing_idempotency_key` | Mutating API route has no idempotency key — double-submit creates duplicate r… |
| [DB_030] | `db_ticket_reservation_no_lock` | Ticket, seat, or appointment reservation without pessimistic lock — overselli… |
| [TEST_002] | `test_only_committed` | `it.only` / `test.only` / `describe.only` committed to the repo skips all oth… |
| [TEST_004] | `empty_test_body` | Tests with empty bodies always pass — they provide false coverage confidence. |
| [TEST_005] | `no_assertions` | Tests with no `expect()` calls pass without validating any behavior. |
| [DEPS_001] | `require_in_esm` | `require()` in an ESM module fails at runtime — use `import` instead. |
| [ZOD_001] | `zod_parse_no_catch` | z.parse() throws a ZodError on invalid input. Uncaught, it becomes an unhandl… |
| [ZOD_004] | `zod_passthrough_api` | .passthrough() in API input schemas silently forwards unknown fields to downs… |
| [ZOD_008] | `zod_password_no_min` | Password fields without a minimum length allow trivially weak passwords like … |
| [ZOD_009] | `zod_url_no_protocol` | URL fields without protocol enforcement accept javascript:// and data: URIs, … |
| [ZOD_011] | `zod_number_no_max` | Number fields used for pagination (limit, take, pageSize) without .max() allo… |
| [ZOD_017] | `zod_coerce_boolean_string` | z.coerce.boolean() converts any truthy string including "false" to true. Use … |
| [ZOD_019] | `zod_price_negative_allowed` | Price/amount fields without .positive() or .min(0) allow negative values that… |
| [ZOD_022] | `zod_lazy_missing` | Self-referential schemas without z.lazy() cause infinite recursion at module … |
| [ZOD_029] | `zod_regex_no_anchors` | Regex validators without ^ and $ anchors match anywhere in the string, bypass… |
| [TRPC_001] | `trpc_no_input_validation` | tRPC procedures without .input() validation accept any payload — a type-unsaf… |
| [TRPC_002] | `trpc_throw_non_trpc_error` | Throwing a plain Error instead of TRPCError in a procedure exposes the full e… |
| [TRPC_003] | `trpc_unprotected_mutation` | Mutations that modify data using publicProcedure should be audited — they req… |
| [TRPC_005] | `trpc_input_spread_to_db` | Spreading tRPC input directly into database operations is a mass-assignment v… |
| [TRPC_007] | `trpc_large_query_no_limit` | tRPC query procedures that fetch lists without a limit parameter return unbou… |
| [TRPC_012] | `trpc_no_rate_limit` | Public tRPC endpoints without rate limiting are vulnerable to abuse and enume… |
| [TRPC_017] | `trpc_sync_io_in_procedure` | Synchronous file I/O inside tRPC procedures blocks the Node.js event loop. |
| [TRPC_019] | `trpc_secret_in_context` | Storing raw secrets (tokens, keys) on the tRPC context makes them accessible … |
| [TRPC_020] | `trpc_missing_auth_check` | Accessing ctx.session.user without a null check will crash when called by an … |
| [TRPC_021] | `trpc_hardcoded_id` | Hardcoded IDs or user references in procedures create data isolation bugs in … |
| [TRPC_022] | `trpc_subscription_no_cleanup` | tRPC subscriptions without a cleanup function leak memory when clients discon… |
| [TRPC_023] | `trpc_authorization_by_role_string` | Role-based authorization using raw string comparison is fragile — a typo sile… |
| [PRISMA_001] | `prisma_findmany_no_limit` | prisma.findMany() without a take limit returns the full table — catastrophic … |
| [PRISMA_002] | `prisma_n_plus_one` | Fetching related records inside a loop is an N+1 query — use include or selec… |
| [PRISMA_004] | `prisma_multi_op_no_transaction` | Multiple related Prisma writes without a transaction leave the database in a … |
| [PRISMA_006] | `prisma_no_client_singleton` | Instantiating PrismaClient inside a function creates a new connection pool on… |
| [PRISMA_007] | `prisma_unique_constraint_unhandled` | Prisma unique constraint violations (P2002) should be caught and returned as … |
| [PRISMA_008] | `prisma_soft_delete_missing_filter` | Queries that do not filter deleted_at IS NULL silently return soft-deleted re… |
| [PRISMA_012] | `prisma_transaction_no_timeout` | Interactive Prisma transactions without a timeout can hold locks indefinitely… |
| [PRISMA_014] | `prisma_cascade_delete_risk` | Cascading deletes in migrations require review — accidental parent deletion r… |
| [PRISMA_015] | `prisma_upsert_race_condition` | prisma.upsert() without a unique constraint race condition guard can create d… |
| [PRISMA_018] | `prisma_aggregate_without_scope` | Aggregate queries (sum, avg, count) without a where clause compute across the… |
| [PRISMA_019] | `prisma_date_string_comparison` | Comparing dates as strings in Prisma where clauses produces incorrect results… |
| [PRISMA_022] | `prisma_connect_vs_set` | Using connect instead of set for many-to-many updates appends — it does not r… |
| [PRISMA_024] | `prisma_select_include_conflict` | Using both select and include in the same Prisma query causes a runtime error. |
| [PRISMA_026] | `prisma_schema_no_default_id` | Models without @id or @default(cuid()/uuid()) produce tables without primary … |
| [NODE_002] | `insecure_random` | Math.random() is not cryptographically secure — never use it for tokens, IDs,… |
| [NODE_003] | `sync_fs_in_handler` | Synchronous filesystem operations inside request handlers block the Node.js e… |
| [NODE_006] | `missing_request_timeout` | HTTP server or outbound request without a timeout allows stalled connections … |
| [NODE_009] | `cookie_no_secure_flags` | Cookies set without Secure and HttpOnly flags are accessible to JavaScript an… |
| [NODE_010] | `stream_no_error_handler` | Node.js streams without an "error" event handler cause unhandled exceptions t… |
| [NODE_011] | `event_listener_leak` | Adding event listeners inside request handlers without removing them is a mem… |
| [NODE_012] | `process_exit_in_handler` | process.exit() inside a request handler terminates the server for all concurr… |
| [NODE_013] | `missing_body_size_limit` | HTTP servers parsing request bodies without a size limit allow unbounded payl… |
| [NODE_014] | `open_redirect` | Redirecting to a user-supplied URL without validation enables phishing attacks. |
| [NODE_016] | `regex_denial_of_service` | Regex patterns with catastrophic backtracking applied to untrusted input caus… |
| [NODE_017] | `missing_rate_limit` | Auth endpoints (login, register, password reset) without rate limiting are vu… |
| [NODE_018] | `helmet_missing` | Express apps without Helmet are missing security headers (CSP, HSTS, X-Frame-… |
| [NODE_020] | `sensitive_data_logged` | Logging objects that may contain passwords, tokens, or keys ships secrets to … |
| [NODE_021] | `missing_cors_config` | API without explicit CORS configuration defaults to allowing all origins in s… |
| [NODE_022] | `unhandled_promise_rejection` | Promises without .catch() or try/catch in async functions cause unhandled rej… |
| [NODE_028] | `crypto_weak_algorithm` | MD5 and SHA1 are cryptographically broken — never use them for security-sensi… |
| [NODE_029] | `missing_csp_header` | Web applications without a Content-Security-Policy header are fully exposed t… |
| [ERR_001] | `empty_catch_block` | Empty catch blocks silently swallow errors, making debugging impossible and h… |
| [ERR_004] | `throwing_string` | throw "error message" throws a string, not an Error. String throws cannot be … |
| [ERR_005] | `error_message_exposed` | Returning err.message directly to API clients leaks internal implementation d… |
| [ERR_007] | `untyped_error_in_ts` | TypeScript 4.0+ types catch variables as unknown — accessing .message without… |
| [ERR_008] | `async_error_boundary_missing` | Async event handlers and callbacks that throw produce unhandled rejections wi… |
| [ERR_010] | `promise_all_no_error_handling` | Promise.all() without try/catch causes an unhandled rejection if any promise … |
| [ERR_011] | `error_in_finally` | Throwing inside a finally block swallows the original error from the try or c… |
| [ERR_013] | `error_boundary_missing_react` | React component trees without an Error Boundary let rendering errors crash th… |
| [ERR_015] | `error_status_mismatch` | Returning a 200 OK with an error body is misleading — HTTP clients check stat… |
| [ERR_016] | `missing_finally_cleanup` | Resources (connections, file handles, timers) opened in try blocks must be re… |
| [ERR_020] | `uncaught_async_iife` | Immediately-invoked async functions without .catch() produce unhandled promis… |
| [ERR_025] | `missing_global_error_handler` | Express apps without a global error-handling middleware leave unhandled error… |
| [IMPORT_002] | `circular_import` | Circular imports (A imports B, B imports A) cause initialization order bugs a… |
| [IMPORT_006] | `dynamic_require_in_esm` | require() calls in ES modules are not available at runtime unless using a CJS… |
| [IMPORT_007] | `missing_ts_extension` | Relative imports without .js extension fail in native ESM Node.js environments. |
| [IMPORT_011] | `test_lib_in_production` | Test utilities (vitest, jest, msw) imported in non-test production files infl… |
| [IMPORT_016] | `crypto_browser_incompatible` | Importing Node.js 'node:crypto' in code that runs in browsers causes build fa… |
| [STATE_003] | `redux_mutating-state` | Mutating Redux state outside of a createSlice reducer loses Immer's protectio… |
| [STATE_004] | `context_value_unstable` | Passing an object or array literal as Context value triggers all consumers to… |
| [STATE_007] | `atom_in_component` | Defining Jotai/Recoil atoms inside a component body recreates them on every r… |
| [STATE_010] | `usereducer_missing-default` | useReducer switch statements without a default case cause unhandled actions t… |
| [STATE_013] | `usestate_stale_closure` | Updating state based on previous value without the functional form causes sta… |
| [STATE_014] | `local_storage_in_ssr` | Accessing localStorage in code that runs during SSR throws 'localStorage is n… |
| [STATE_019] | `server_action_state-revalidation` | Next.js Server Actions that mutate data without revalidatePath/revalidateTag … |
| [FORM_001] | `form_no_validation` | Form submission handler without input validation allows empty or malformed da… |
| [FORM_002] | `form_accessibility_label` | Form inputs without associated labels are inaccessible to screen readers and … |
| [FORM_005] | `form_uncontrolled_then_controlled` | Switching a React input from uncontrolled to controlled (or vice versa) logs … |
| [FORM_008] | `form_button_type_missing` | Buttons inside a <form> without an explicit type='button' default to type='su… |
| [FORM_010] | `form_file_upload_no_validation` | File upload inputs without type/size validation allow attackers to upload mal… |
| [LOG_007] | `console_error_swallowed` | Catching errors and logging only console.error (without rethrowing or trackin… |
| [LOG_011] | `log_in_tight_loop` | Logging inside tight loops (forEach, map, for) generates enormous log volume … |
| [LOG_012] | `log_stack_trace_missing` | Logging error.message without the error object itself loses the stack trace, … |
| [LOG_016] | `audit_log_missing` | Destructive operations (delete, update, transfer) without audit logging make … |
| [CSS_009] | `missing_focus_visible` | Removing or overriding focus styles (outline-none without focus-visible:) bre… |
| [CSS_010] | `animation_no_reduce_motion` | CSS animations without prefers-reduced-motion guards cause nausea in users wi… |
| [CSS_012] | `color_contrast_low` | Light gray text on white backgrounds fails WCAG 1.4.3 contrast ratio requirem… |
| [CSS_013] | `tailwind_content_missing` | Files not covered by tailwind.config.js 'content' glob will have their classe… |
| [CSS_016] | `tailwind_dynamic_class` | Dynamically constructed Tailwind class names (e.g., `bg-${color}-500`) are pu… |
| [VIBE_001] | `vibe_csrf_missing` | POST/PUT/DELETE handlers in AI-generated code often lack CSRF protection — th… |
| [VIBE_003] | `vibe_no_rate_limit` | AI-generated API routes almost never include rate limiting — exposing endpoin… |
| [VIBE_005] | `vibe_cors_wildcard` | AI-generated backends frequently use CORS wildcard (`*`) that allows any orig… |
| [VIBE_006] | `vibe_missing_input_validation` | AI-generated API routes accept request bodies without schema validation — the… |
| [VIBE_011] | `vibe_unvalidated_redirect` | AI-generated redirect(searchParams.get("next")) enables open redirect attacks… |
| [VIBE_012] | `vibe_insecure_cookie` | AI-generated cookie-setting code omits httpOnly/secure/sameSite attributes — … |
| [VIBE_013] | `vibe_weak_random` | AI tools use Math.random() for tokens, passwords, and session IDs — it is not… |
| [VIBE_016] | `vibe_prototype_pollution` | AI tools generate Object.assign(target, userInput) and spread patterns that e… |
| [VIBE_018] | `vibe_missing_auth_middleware` | AI-generated Next.js apps frequently have no middleware.ts — meaning protecte… |
| [VIBE_019] | `vibe_timing_attack` | String equality comparison for tokens/passwords is vulnerable to timing attac… |
| [VIBE_025] | `vibe_llm_response_unvalidated` | AI-generated code trusts LLM JSON responses without schema validation — causi… |
| [VIBE_028] | `vibe_global_rate_limit_only` | Rate limit applied globally (all users share one counter) — one user can DoS … |
| [VIBE_029] | `vibe_file_upload_no_limit` | File upload endpoint has no size or frequency rate limit — storage exhaustion… |
| [VIBE_030] | `vibe_llm_route_no_rate_limit` | LLM/AI API call route has no rate limiting — financial exposure from unbounde… |
| [VIBE_032] | `vibe_sms_no_rate_limit` | OTP send or password reset endpoint has no rate limiting — SMS pumping and re… |
| [SLOP_002] | `slop_undeclared_import` | Package imported in source code is not declared in package.json — phantom dep… |
| [SLOP_006] | `slop_not_in_lockfile` | Package imported in source code is absent from the project lockfile — it has … |
| [SLOP_008] | `slop_wildcard_version` | Package version set to `latest`, `*`, or `x` in package.json — no version loc… |
| [SLOP_012] | `slop_phantom_install` | Suspicious package added to package.json but not imported in any changed sour… |
| [PY_005] | `py_missing_auth` | FastAPI or Flask route decorator with no authentication dependency or login_r… |
| [PY_008] | `py_yaml_load_unsafe` | yaml.load() without a safe Loader — can execute arbitrary Python via !!python… |
| [PY_010] | `py_cors_wildcard` | CORSMiddleware configured with allow_origins=["*"] — permits any origin. |
| [PY_012] | `py_debug_mode` | Flask/uvicorn debug=True — exposes interactive debugger and verbose error pag… |
| [PY_013] | `py_insecure_random` | random module used for tokens, keys, or passwords — not cryptographically sec… |
| [PY_016] | `py_llm_response_unvalidated` | LLM response content used directly as code, SQL, or HTML without validation. |
| [PY_017] | `py_unvalidated_redirect` | redirect() called with a URL from request parameters without validation. |
| [PY_018] | `py_no_rate_limit` | FastAPI/Flask app has routes but no rate-limiting middleware. |
| [PY_022] | `py_missing_input_validation` | FastAPI route reads raw request.json() instead of a typed Pydantic model. |
| [PY_023] | `py_timing_attack` | Secret or token compared with == operator — vulnerable to timing attacks. |
| [PY_026] | `py_mutable_default_arg` | Function uses mutable default argument (list or dict) — shared across all calls. |
| [PY_028] | `py_blocking_sleep_in_async` | `time.sleep()` inside an `async def` blocks the entire event loop. |
| [PY_037] | `py_assert_for_validation` | `assert` used for runtime input validation — stripped by Python `-O` flag. |
| [PY_038] | `py_pydantic_v1_api` | Pydantic v1 `.dict()` or `.json()` method called — these are removed in Pydan… |
| [DJG_002] | `django_allowed_hosts_wildcard` | ALLOWED_HOSTS = ["*"] disables Django's Host header validation, enabling head… |
| [DJG_004] | `django_csrf_exempt` | @csrf_exempt disables CSRF protection on a view — vulnerable to cross-site re… |
| [DJG_005] | `django_missing_login_required` | View function with state-changing HTTP method handling lacks @login_required … |
| [DJG_008] | `django_serializer_all_fields` | DRF ModelSerializer with fields = "__all__" exposes every model field includi… |
| [DJG_009] | `django_template_safe_filter` | {{ value|safe }} in Django template bypasses auto-escaping — XSS if value is … |
| [DJG_010] | `django_mark_safe_dynamic` | mark_safe() called with a dynamic/formatted string — XSS if the value is user… |
| [DJG_012] | `django_open_redirect` | Django redirect() called with unvalidated user input — open redirect vulnerab… |
| [DJG_013] | `django_unsafe_file_upload` | File upload handler stores the file without validating the extension or conte… |
| [DJG_019] | `django_cors_allow_all` | CORS_ALLOW_ALL_ORIGINS = True allows any website to make cross-origin request… |
| [GO_003] | `go_ssrf` | http.Get() or http.Post() with a variable URL — SSRF if user-controlled. |
| [GO_004] | `go_weak_random` | math/rand used near token/secret/key/password — not cryptographically secure. |
| [GO_007] | `go_log_sensitive` | log.Printf/fmt.Printf logging a value named password/secret/token/apiKey. |
| [GO_009] | `go_ignored_error` | Function return value discarded with _ = — silently ignores errors. |
| [GO_010] | `go_panic_in_handler` | panic() called inside an HTTP handler — crashes the server or goroutine. |
| [GO_013] | `go_http_no_timeout` | http.DefaultClient or &http.Client{} without Timeout — hangs indefinitely on … |
| [GO_016] | `go_handler_no_auth` | HTTP handler registration with no visible auth check or middleware in the han… |
| [RB_003] | `rails_missing_authenticate` | Rails controller with action methods but no before_action :authenticate_user!… |
| [RB_004] | `rails_skip_before_action_auth` | skip_before_action :authenticate_user! or :require_login disables authenticat… |
| [RB_006] | `rails_unsafe_attributes` | attr_accessible :admin, :role, or :is_admin exposes privileged fields to mass… |
| [RB_007] | `rails_csrf_protect_disabled` | protect_from_forgery with: :null_session or skip_before_action :verify_authen… |
| [RB_008] | `rails_open_redirect` | redirect_to params[:return_to] or similar user-controlled URL without validat… |
| [RB_013] | `rails_debug_mode_production` | config.log_level = :debug or consider_all_requests_local = true in a producti… |
| [RB_014] | `rails_xss_raw` | raw() or .html_safe called on user-controlled content — XSS vulnerability. |
| [PHP_006] | `php_open_redirect` | HTTP redirect destination taken directly from user input without validation. |
| [PHP_010] | `laravel_missing_auth_middleware` | Laravel apiResource/resource route defined without auth middleware in context. |
| [PHP_011] | `php_file_upload_no_validation` | move_uploaded_file() called without MIME type validation in surrounding context. |
| [PHP_013] | `laravel_debug_true` | APP_DEBUG=true in .env or hardcoded 'debug' => true in config/app.php. |
| [PHP_014] | `php_weak_password_hash` | md5() or sha1() used for password hashing instead of password_hash(). |
| [PHP_015] | `laravel_missing_csrf` | Blade form with POST/PUT/PATCH/DELETE method but no @csrf directive. |
| [PHP_016] | `php_extract_superglobal` | extract() on $_GET/$_POST/$_REQUEST creates arbitrary local variables from us… |
| [PHP_017] | `php_session_fixation` | session_id() set from user input — session fixation attack. |
| [PHP_019] | `php_hardcoded_credentials` | Password, API key, or secret hardcoded directly in PHP source code. |
| [PHP_020] | `laravel_request_all_mass_assign` | Model::create() or ->update() called with $request->all() — unfiltered mass a… |
| [JAVA_003] | `spring_missing_pre_authorize` | Spring @RequestMapping/@GetMapping/@PostMapping etc. without @PreAuthorize or… |
| [JAVA_004] | `java_hardcoded_password` | String variable named password/secret/apiKey assigned a hardcoded string lite… |
| [JAVA_005] | `java_weak_password_hash` | MessageDigest.getInstance("MD5") or ("SHA-1") — insecure for password hashing. |
| [JAVA_010] | `java_open_redirect` | response.sendRedirect() with request.getParameter() — open redirect vulnerabi… |
| [JAVA_011] | `spring_csrf_disabled` | Spring Security .csrf().disable() or csrf(AbstractHttpConfigurer::disable) — … |
| [JAVA_012] | `spring_cors_wildcard` | .allowedOrigins("*") in CORS configuration — accepts requests from any origin. |
| [JAVA_013] | `spring_actuator_exposed` | management.endpoints.web.exposure.include=* exposes all Spring Actuator endpo… |
| [JAVA_014] | `spring_h2_console_enabled` | spring.h2.console.enabled=true in application properties — H2 web console exp… |
| [JAVA_015] | `java_random_not_secure` | new Random() used near token/password/key/session generation — use SecureRand… |
| [JAVA_016] | `java_log_sensitive` | Logger.info/debug/error/warn with password/token/secret in the message — cred… |
| [RUST_001] | `rust_unwrap_in_lib` | .unwrap() in a lib crate (not in tests, not in fn main, not in examples). |
| [RUST_003] | `rust_panic_in_lib` | panic!() macro called in a lib crate (not in tests). |
| [RUST_004] | `rust_unsafe_block` | unsafe { } block without a // SAFETY: comment explaining the invariant. |
| [RUST_009] | `rust_blocking_call_in_async` | Blocking I/O (std::fs::read, std::thread::sleep, TcpStream::connect) in an as… |
| [RUST_011] | `rust_hardcoded_secret` | Hardcoded API key, password, or secret assigned to a sensitive-named variable. |
| [RUST_015] | `rust_raw_pointer_deref` | Raw pointer dereference (*raw_ptr/*ptr) without a // SAFETY: comment. |
| [RUST_019] | `rust_env_var_unwrap` | std::env::var("KEY").unwrap() — panics at startup if the environment variable… |
| [CS_003] | `csharp_missing_authorize` | ASP.NET Core controller action with [Http*] attribute but no [Authorize] or [… |
| [CS_004] | `csharp_missing_antiforgery` | Razor form with POST method missing @Html.AntiForgeryToken() or asp-antiforgery. |
| [CS_005] | `csharp_hardcoded_connection_string` | Connection string with credentials hardcoded in C# source. |
| [CS_006] | `csharp_hardcoded_secret_in_config` | appsettings.json contains a hardcoded API key, password, or secret. |
| [CS_009] | `csharp_debug_in_production` | app.UseDeveloperExceptionPage() called without an IsDevelopment() guard — lea… |
| [CS_010] | `csharp_open_redirect` | Response.Redirect or Redirect() called with a user-supplied URL. |
| [CS_013] | `csharp_insecure_cookie` | Cookie created with HttpOnly or Secure explicitly set to false. |
| [CS_014] | `csharp_weak_hash_algorithm` | MD5.Create() or SHA1.Create() used for hashing — not safe for passwords or in… |
| [CS_015] | `csharp_cors_allow_all` | CORS policy allows all origins — exposes API to any website. |
| [CS_016] | `csharp_string_format_logging_sensitive` | Logger call includes password, secret, token, or API key — sensitive data in … |
| [CS_018] | `csharp_exception_swallowed` | Empty catch block silently swallows exceptions. |
| [CS_020] | `csharp_viewbag_xss` | Razor view outputs ViewBag or ViewData via @Html.Raw() — unescaped XSS risk. |
| [DOCKER_001] | `docker_run_as_root` | No USER instruction or only USER root — container runs as root. |
| [DOCKER_003] | `docker_latest_tag` | FROM uses :latest tag or no tag — image is not pinned. |
| [DOCKER_006] | `docker_expose_ssh` | EXPOSE 22 exposes the SSH port. |
| [DOCKER_008] | `docker_sudo_in_run` | RUN sudo used inside Dockerfile — redundant and signals running as root. |
| [DOCKER_009] | `docker_secret_in_arg` | ARG with a sensitive name — build-arg values are visible in docker history. |
| [GHA_003] | `gha_write_all_permissions` | permissions: write-all grants all write permissions to the workflow token. |
| [GHA_005] | `gha_secrets_logged` | Secret value echoed inside a run: step — secrets in logs even with masking. |
| [GHA_006] | `gha_self_hosted_runner` | Self-hosted runner used in a workflow that can be triggered by external contr… |
| [GHA_007] | `gha_env_from_input` | Workflow dispatch input interpolated directly into a run: command instead of … |
| [GHA_010] | `gha_deprecated_set_env` | Deprecated ::set-env:: or ::add-path:: workflow commands used — CVE-2020-1522… |
| [TF_003] | `tf_rds_publicly_accessible` | RDS instance or cluster with publicly_accessible = true — database is interne… |
| [TF_004] | `tf_rds_no_encryption` | RDS instance or cluster without storage_encrypted = true — data at rest is un… |
| [TF_006] | `tf_iam_wildcard_resource` | IAM policy statement uses resources = ["*"] — policy applies to all AWS resou… |
| [TF_012] | `tf_unencrypted_ebs` | EBS volume declared without encrypted = true — data at rest is unencrypted. |
| [TF_015] | `tf_no_backend` | No `terraform { backend }` block — state is stored locally and not shared wit… |
| [TF_016] | `tf_sensitive_var_not_marked` | Variable with a sensitive name (password, secret, token, key) not marked `sen… |
| [TF_018] | `tf_rds_no_deletion_protection` | RDS instance missing `deletion_protection = true` — can be permanently delete… |
| [TF_020] | `tf_dynamodb_no_pitr` | DynamoDB table missing Point-In-Time Recovery (PITR) — data loss risk. |
| [TF_023] | `tf_no_prevent_destroy` | Stateful resource (RDS, S3, DynamoDB) missing `lifecycle { prevent_destroy = … |
| [TF_024] | `tf_ec2_public_ip` | EC2 instance with `associate_public_ip_address = true` — instance directly re… |
| [GQL_001] | `gql_no_depth_limit` | GraphQL server configured without query depth limiting — DoS via deeply neste… |
| [GQL_002] | `gql_no_complexity_limit` | GraphQL server has no query complexity limit — DoS via expensive field combin… |
| [GQL_004] | `gql_n_plus_one` | GraphQL resolver calls the database inside a field that returns a list — N+1 … |
| [GQL_011] | `gql_context_user_no_check` | `context.user` or `ctx.user` accessed without null check — crashes on unauthe… |
| [GQL_013] | `gql_missing_resolve_type` | GraphQL union or interface schema defined but `__resolveType` missing in reso… |
| [GQL_015] | `gql_no_rate_limit` | GraphQL endpoint has no rate limiting middleware configured. |
| [GQL_016] | `gql_file_upload_no_limit` | GraphQL file upload configured without a file size limit. |
| [GQL_019] | `gql_stitch_no_auth` | Schema stitching merges a remote schema without forwarding authorization head… |
| [GQL_021] | `gql_input_as_output` | GraphQL `input` type name used as a field return type — inputs cannot be used… |
| [GQL_023] | `gql_error_masking_disabled` | GraphQL server configured to expose full error details — leaks internals in p… |
| [GQL_024] | `gql_unhandled_resolver_error` | Async GraphQL resolver with no try/catch — unhandled rejections crash the ser… |
| [DESIGN_001] | `design_hardcoded_hex_color` | Hardcoded hex color in style prop or CSS — bypasses design tokens. |
| [DESIGN_004] | `design_hardcoded_font_family` | Hardcoded font-family bypasses design system typography. |
| [DESIGN_008] | `design_important_override` | !important overrides fight the design system — fix specificity instead. |
| [DESIGN_012] | `design_missing_focus_visible` | outline-none without a focus-visible alternative — keyboard users lose focus … |
| [DESIGN_016] | `design_mixed_icon_libraries` | Multiple icon libraries imported in the same file — pick one for the whole pr… |
| [DEBT_001] | `debt_duplicate_function_body` | Two or more functions in the same file share a highly similar body (≥80%) — A… |
| [DEBT_002] | `debt_exported_function_no_test` | New exported function has no corresponding test — AI-generated functions are … |
| [DEBT_004] | `debt_api_no_error_response_type` | API route handler returns a response type but no error response type is defined. |
| [DEBT_005] | `debt_swallowed_error` | Error is caught and silently discarded — hidden failure that produces incorre… |
| [DEBT_009] | `debt_hardcoded_url` | Hardcoded URL in business logic — should be an environment variable. |
| [DEBT_016] | `debt_exponential_loop` | Nested loop over the same or similar collections — O(n²) or worse time comple… |
| [DEBT_019] | `debt_catch_returns_null` | catch block returns null/undefined instead of handling or rethrowing — silent… |
| [COMMIT_002] | `commit_unknown_type` | Commit type must be one of the allowed types (feat, fix, docs, etc.) |
| [COMMIT_006] | `commit_wip_message` | WIP commit messages must not land on protected branches. |
| [COMMIT_010] | `commit_merge_commit_raw` | Raw merge commit messages ('Merge branch X into Y') should be avoided — use s… |
| [VERCEL_003] | `vercel_cron_no_secret_check` | Vercel Cron job route handlers must verify a CRON_SECRET authorization header. |
| [VERCEL_004] | `vercel_env_not_in_example` | Every process.env.VAR_NAME used in source must be documented in .env.example. |
| [VERCEL_005] | `vercel_env_example_missing` | Projects that use process.env variables must have a .env.example file. |
| [VERCEL_010] | `vercel_open_redirect` | vercel.json redirect destinations using wildcards must be restricted to the s… |
| [AGNT_001] | `agent_no_scope_declared` | No .thesmos/scope.json found — agent file and network boundaries are undeclared. |
| [AGNT_002] | `agent_no_token_budget` | No tokenBudget configured — agent sessions have no cost ceiling. |
| [AGNT_005] | `agent_mcp_server_unverified` | MCP server registered without a pinned version or integrity hash — supply cha… |
| [AGNT_007] | `agent_prompt_no_constraints` | CLAUDE.md has no behavioral constraints section — agent behavior is unconstra… |
| [AGNT_008] | `agent_data_access_unpinned` | scope.json has no allowedPaths — agent can access all files in the repo. |
| [AGNT_009] | `agent_sub_agent_ungoverned` | Agent spawning (Agent tool) is not mentioned in governance config — sub-agent… |
| [AGNT_015] | `agent_no_cost_cap` | Autopilot config has no maxCostUSD — no financial ceiling on agent sessions. |
| [AGNT_016] | `agent_no_abort_controller` | Agent tool chain has no AbortController — long-running tool calls cannot be c… |
| [AGNT_017] | `agent_no_human_approval_gate` | Agent can perform destructive or high-cost operations without human-in-the-lo… |
| [AGNT_024] | `agent_consent_lifecycle_missing` | Agent scope declares PII categories but has no consent lifecycle hook. |
| [AGNT_025] | `agent_dpia_missing` | Agent processes high-risk data categories with no DPIA reference in scope.json. |
| [AGNT_026] | `agent_model_card_missing` | No .thesmos/model-card.md found — EU AI Act Art. 13 transparency requirement. |
| [AGNT_027] | `agent_audit_trail_immutable` | .thesmos/audit.jsonl is being modified by the agent — audit trail must be app… |
| [AGNT_028] | `agent_cross_agent_auth_missing` | Sub-agent spawned without forwarding parent session token — auth gap in agent… |
| [DEP_002] | `dep_high_cve` | Dependency has a HIGH severity CVE. |
| [DEP_004] | `dep_abandoned_with_cve` | Dependency not updated in 2+ years AND has a known CVE — no fix expected. |
| [DEP_006] | `dep_git_dependency` | Dependency points to a git URL instead of a semver version — no integrity gua… |
| [LIC_002] | `lic_unknown_license` | Dependency has UNLICENSED or missing license — cannot determine usage rights. |
| [LIC_004] | `lic_no_project_license` | No LICENSE file found in project root — open source obligations unclear. |
| [LIC_005] | `lic_proprietary_dependency` | Dependency uses a proprietary or non-open-source license. |
| [GDPR_001] | `gdpr_pii_in_console_log` | console.log appears to log PII (email/phone/name adjacent variables). |
| [GDPR_002] | `gdpr_analytics_no_consent` | Analytics library initialized without a consent check — GDPR opt-in required. |
| [GDPR_003] | `gdpr_cookie_no_banner` | document.cookie set without adjacent consent check. |
| [GDPR_004] | `gdpr_pii_in_url_params` | PII found in URL query parameters — violates data minimization and logs in se… |
| [GDPR_005] | `gdpr_pii_in_localStorage` | PII stored in localStorage without encryption — accessible to any JavaScript … |
| [GDPR_010] | `gdpr_third_party_no_consent` | Third-party tracking script loaded without consent wrapper. |
| [GDPR_014] | `gdpr_pii_in_test_fixtures` | Test fixtures contain real-looking email or phone numbers — use synthetic data. |
| [GDPR_017] | `gdpr_data_portability_missing` | No data export endpoint — GDPR Art. 20 grants users the right to data portabi… |
| [GDPR_018] | `gdpr_lawful_basis_undeclared` | Data processing route with no lawful basis declaration — GDPR Art. 6 requires… |
| [GDPR_019] | `gdpr_cross_border_transfer_no_safeguard` | Data sent to a non-EEA endpoint with no SCCs or adequacy decision referenced. |
| [MCP_004] | `mcp_no_server_allowlist` | MCP server registered from external/untrusted source without an integrity check. |
| [MCP_005] | `mcp_destructive_no_gate` | MCP tool performs a destructive action (delete/drop/truncate/destroy) without… |
| [MCP_006] | `mcp_server_no_auth` | MCP server implementation exposes tools without authentication. |
| [MCP_008] | `mcp_cursor_rules_external_url` | .cursor/rules file fetches instructions from an external URL — enables dynami… |
| [MCP_010] | `mcp_tool_path_traversal` | MCP tool accepts a file path parameter without path sanitization — directory … |
| [MCP_012] | `mcp_elevated_credentials` | MCP server uses service-role or admin credentials — violates least-privilege. |
| [MCP_013] | `mcp_no_result_validation` | MCP tool call result used without schema validation — type confusion and inje… |
| [MCP_016] | `mcp_no_tool_allowlist` | Agent invokes MCP tools by name from a variable without checking against a pe… |
| [MCP_017] | `mcp_readme_injection` | README or source comment contains AI-targeted instructions designed to manipu… |
| [RAG_003] | `rag_no_tenant_isolation` | Vector store query has no metadata filter for tenant/user isolation — cross-t… |
| [RAG_004] | `rag_no_similarity_threshold` | Vector retrieval has no similarity threshold — irrelevant or adversarial docu… |
| [RAG_006] | `rag_embedding_unbounded_input` | Embedding model called with unbounded input length — token exhaustion and cos… |
| [RAG_007] | `rag_no_output_validation` | RAG pipeline output returned to user without validation — hallucination or in… |
| [RAG_008] | `rag_no_rate_limit` | Vector store query endpoint has no rate limiting — vector DB exhaustion and c… |
| [RAG_009] | `rag_llm_citation_unvalidated` | LLM-generated citation URLs displayed to users without validation — hallucina… |
| [RAG_012] | `rag_user_query_injection` | User query used directly as vector store filter expression — NoSQL/vector inj… |
| [RAG_013] | `rag_context_window_unbounded` | RAG context window not bounded — large retrieval results cause cost runaway a… |
| [WS_003] | `ws_no_origin_check` | WebSocket server has no Origin header validation — cross-origin WebSocket hij… |
| [WS_004] | `ws_no_heartbeat_timeout` | WebSocket connection has no heartbeat/ping or idle timeout — zombie connectio… |
| [WS_005] | `ws_message_size_unbounded` | WebSocket message handler accepts messages without payload size limit — memor… |
| [WS_006] | `ws_message_no_schema_validation` | WebSocket message handler parses JSON without schema validation before proces… |
| [WS_007] | `ws_token_in_url` | Authentication token passed in WebSocket URL query string — logged by proxies… |
| [WS_008] | `ws_broadcast_no_room_check` | WebSocket broadcast sends sensitive data to all connected clients without roo… |
| [PROTO_002] | `prototype_pollution_for_in_assign` | for...in loop over user-supplied object assigns properties to target without … |
| [PROTO_003] | `prototype_pollution_lodash_merge` | lodash.merge() called with unvalidated user input — known prototype pollution… |
| [PROTO_004] | `prototype_pollution_defaults_deep` | lodash.defaultsDeep() with user input — recursive merge prototype pollution. |
| [PROTO_005] | `prototype_pollution_json_parse_assign` | JSON.parse() result used as source in Object.assign without sanitization. |
| [PROTO_008] | `prototype_pollution_express_body_deep` | Express body-parser with extended: true parses deeply nested objects from use… |
| [PROTO_010] | `prototype_pollution_spread_user` | Spreading user input directly into an object literal without validation — pro… |
| [JWT_003] | `jwt_refresh_token_localstorage` | Refresh token stored in localStorage — accessible to any JavaScript on the pa… |
| [JWT_004] | `jwt_no_expiry` | JWT signed without an expiry (expiresIn) — tokens are valid forever if compro… |
| [JWT_005] | `jwt_oauth_missing_state` | OAuth callback handler does not validate the state parameter — CSRF on OAuth … |
| [JWT_006] | `jwt_social_login_no_reauth` | Social login account linking performed without re-authentication of the exist… |
| [AUTH_009] | `auth_idor_numeric_id` | API route exposes sequential numeric ID without ownership verification — IDOR… |
| [AUTH_010] | `auth_brute_force_unprotected` | Login or password-reset endpoint has no rate limiting or brute-force protection. |
| [AUTH_011] | `auth_password_reset_reuse` | Password reset token not deleted after use — allows replay attacks for unlimi… |
| [AUTH_013] | `auth_uuid_not_used` | Auto-increment integer ID used as public resource identifier — IDOR enumerati… |
| [SC_001] | `sc_git_dependency_url` | package.json dependency with git:, github:, or http: URL — unpinned and unaud… |
| [SC_004] | `sc_npmrc_http_registry` | .npmrc registry URL uses http:// — package downloads are unencrypted and cann… |
| [SC_006] | `sc_npm_publish_no_provenance` | CI npm publish step without --provenance flag — package has no cryptographic … |
| [SC_008] | `sc_no_files_field` | package.json has no "files" field — the entire directory (including source, t… |
| [SC_009] | `sc_lockfile_non_standard_registry` | Lockfile contains a "resolved" URL pointing to a non-standard registry. |
| [SC_010] | `sc_package_json_git_protocol` | package.json dependency uses git:// protocol (not git+https://) — unauthentic… |
| [DAST_002] | `dast_cors_wildcard_with_auth` | Access-Control-Allow-Origin: * set on a route that also performs authenticati… |
| [DAST_004] | `dast_sensitive_param_in_get` | Sensitive parameter name (password, token, secret, key, api_key) appears in a… |
| [DAST_009] | `dast_prototype_pollution_express` | Express body-parser configured with extended: true — enables prototype pollut… |
| [DAST_010] | `dast_http_response_splitting` | User input used directly in a response header value — HTTP response splitting… |
| [K8S_001] | `k8s_no_resource_limits` | Kubernetes container spec without resources.limits — pod can consume unbounde… |
| [K8S_002] | `k8s_run_as_root` | Kubernetes pod or container securityContext allows running as root. |
| [K8S_004] | `k8s_host_pid_or_network` | Pod spec uses hostPID: true or hostNetwork: true — shares host process or net… |
| [K8S_007] | `k8s_image_pull_policy_never` | Container imagePullPolicy: Never — image won't be refreshed, running stale/vu… |
| [K8S_010] | `k8s_latest_tag` | Kubernetes manifest references an image with :latest tag — deployment is not … |
| [SELF_001] | `self_version_behind` | Installed thesmos-governance is behind the latest npm release by ≥ 1 minor ve… |
| [SELF_003] | `self_broken_hook` | Git hook installed by Thesmos references thesmos-governance but the package m… |
| [SELF_004] | `self_config_schema_old` | .thesmos/config.json uses an old schema (missing required fields from the cur… |
| [EU_AI_003] | `eu_ai_no_risk_management_system` | High-risk AI system with no risk management documentation — EU AI Act Art. 9. |
| [EU_AI_004] | `eu_ai_training_data_governance_missing` | High-risk AI with no training data governance plan — EU AI Act Art. 10 requir… |
| [EU_AI_005] | `eu_ai_no_technical_documentation` | AI system with no technical documentation (model card) — EU AI Act Art. 11 re… |
| [EU_AI_006] | `eu_ai_no_decision_audit_log` | High-risk AI decision without append-only audit logging — EU AI Act Art. 12 t… |
| [EU_AI_007] | `eu_ai_no_human_oversight` | High-risk AI outcome applied automatically with no human review gate — EU AI … |
| [HIPAA_004] | `hipaa_phi_no_audit_log` | PHI accessed in API route with no audit log — HIPAA §164.312(b) requires hard… |
| [HIPAA_005] | `hipaa_phi_minimum_necessary_missing` | API response may return full PHI record without minimum-necessary filtering —… |
| [HIPAA_006] | `hipaa_phi_to_llm_no_baa` | PHI sent to an external LLM API with no Business Associate Agreement referenced. |
| [HIPAA_007] | `hipaa_phi_session_no_timeout` | PHI access route with no session timeout configuration — HIPAA §164.312(a)(2)… |
| [DORA_002] | `dora_third_party_ict_no_register` | Third-party ICT provider dependency found with no contract/register maintaine… |
| [DORA_003] | `dora_resilience_testing_missing` | No digital operational resilience testing plan — DORA Art. 25 requires annual… |
| [DORA_004] | `dora_rto_undocumented` | ICT business continuity policy has no documented RTO/RPO — DORA Art. 11 requi… |
| [DORA_005] | `dora_threat_intel_sharing_missing` | No threat intelligence sharing framework configured — DORA Art. 45 encourages… |
| [LOCAL_LLM_004] | `local_llm_cors_wildcard` | OLLAMA_ORIGINS=* in .env — any website can call localhost:11434 from the brow… |
| [LOCAL_LLM_005] | `local_llm_no_timeout` | Ollama call without AbortController signal — generation can hang indefinitely… |
| [LOCAL_LLM_006] | `local_llm_model_not_pinned` | model: 'llama3' (no :tag) resolves to the changing 'latest' digest — behavior… |
| [LOCAL_LLM_007] | `local_llm_no_rate_limit` | API route calling Ollama with no rate limiting — VRAM DoS via parallel genera… |
| [LOCAL_LLM_008] | `local_llm_pii_to_remote` | OLLAMA_HOST points to a non-localhost address — data assumed "local" is actua… |
| [LOCAL_LLM_009] | `local_llm_no_content_filter` | Ollama response returned to users with no content moderation check — no built… |
| [LOCAL_LLM_010] | `local_llm_response_unvalidated` | Ollama JSON response used in structured logic without schema validation — cra… |

**GUIDELINES** — 473 MEDIUM/LOW/TECH_DEBT rule(s) in `.thesmos/RULES.md`, not embedded here.
Run `thesmos explain <RULE_ID>` for detail on any rule.
---

## Active Thesmos Context

**Active Agents:**

- **"God Agent Aphrodite — Creative Director Agent"** (`aphrodite-creative-agent`) — Invoke: `Agent({ subagent_type: "aphrodite-creative-agent", prompt: "..." })`
- **"God Agent Apollo — Content Agent"** (`apollo-content-agent`) — Invoke: `Agent({ subagent_type: "apollo-content-agent", prompt: "..." })`
- **"God Agent Ares — Deal Strategist"** (`ares-deal-strategy-agent`) — Invoke: `Agent({ subagent_type: "ares-deal-strategy-agent", prompt: "..." })`
- **"God Agent Ares — Discovery Coach"** (`ares-discovery-agent`) — Invoke: `Agent({ subagent_type: "ares-discovery-agent", prompt: "..." })`
- **"God Agent Ares — Pipeline Analyst"** (`ares-pipeline-agent`) — Invoke: `Agent({ subagent_type: "ares-pipeline-agent", prompt: "..." })`
- **"God Agent Ares — Sales Agent"** (`ares-sales-agent`) — Invoke: `Agent({ subagent_type: "ares-sales-agent", prompt: "..." })`
- **"God Agent Argus — Security Agent"** (`argus-security-agent`) — Invoke: `Agent({ subagent_type: "argus-security-agent", prompt: "..." })`
- **"God Agent Artemis — Photography Agent"** (`artemis-photography-agent`) — Invoke: `Agent({ subagent_type: "artemis-photography-agent", prompt: "..." })`
- **"God Agent Athena — Strategy Agent"** (`athena-strategy-agent`) — Invoke: `Agent({ subagent_type: "athena-strategy-agent", prompt: "..." })`
- **"God Agent Daedalus — Product Agent"** (`daedalus-product-agent`) — Invoke: `Agent({ subagent_type: "daedalus-product-agent", prompt: "..." })`
- **"God Agent Demeter — Customer Success Agent"** (`demeter-cs-agent`) — Invoke: `Agent({ subagent_type: "demeter-cs-agent", prompt: "..." })`
- **"God Agent Dike — Ethics Agent"** (`dike-ethics-agent`) — Invoke: `Agent({ subagent_type: "dike-ethics-agent", prompt: "..." })`
- **"God Agent Dionysus — Video Agent"** (`dionysus-video-agent`) — Invoke: `Agent({ subagent_type: "dionysus-video-agent", prompt: "..." })`
- **"God Agent Hebe — Support Agent"** (`hebe-support-agent`) — Invoke: `Agent({ subagent_type: "hebe-support-agent", prompt: "..." })`
- **"God Agent Hephaestus — Design Agent"** (`hephaestus-design-agent`) — Invoke: `Agent({ subagent_type: "hephaestus-design-agent", prompt: "..." })`
- **"God Agent Hera — Operations Agent"** (`hera-operations-agent`) — Invoke: `Agent({ subagent_type: "hera-operations-agent", prompt: "..." })`
- **"God Agent Heracles — Business Development Agent"** (`heracles-bd-agent`) — Invoke: `Agent({ subagent_type: "heracles-bd-agent", prompt: "..." })`
- **"God Agent Hermes — Marketing Agent"** (`hermes-marketing-agent`) — Invoke: `Agent({ subagent_type: "hermes-marketing-agent", prompt: "..." })`
- **"God Agent Hestia — Customer Experience Agent"** (`hestia-cx-agent`) — Invoke: `Agent({ subagent_type: "hestia-cx-agent", prompt: "..." })`
- **"God Agent Mnemosyne — Knowledge Agent"** (`mnemosyne-knowledge-agent`) — Invoke: `Agent({ subagent_type: "mnemosyne-knowledge-agent", prompt: "..." })`
- **"God Agent Morpheus — Animation Agent"** (`morpheus-animation-agent`) — Invoke: `Agent({ subagent_type: "morpheus-animation-agent", prompt: "..." })`
- **"God Agent Nemesis — Compliance Agent"** (`nemesis-compliance-agent`) — Invoke: `Agent({ subagent_type: "nemesis-compliance-agent", prompt: "..." })`
- **"God Agent Nike — Lead Generation Agent"** (`nike-leadgen-agent`) — Invoke: `Agent({ subagent_type: "nike-leadgen-agent", prompt: "..." })`
- **"God Agent Pheme — PR Agent"** (`pheme-pr-agent`) — Invoke: `Agent({ subagent_type: "pheme-pr-agent", prompt: "..." })`
- **"God Agent Plutus — Finance Agent"** (`plutus-finance-agent`) — Invoke: `Agent({ subagent_type: "plutus-finance-agent", prompt: "..." })`
- **"God Agent Psyche — Research Agent"** (`psyche-research-agent`) — Invoke: `Agent({ subagent_type: "psyche-research-agent", prompt: "..." })`
- **"God Agent Pythia — Data Agent"** (`pythia-data-agent`) — Invoke: `Agent({ subagent_type: "pythia-data-agent", prompt: "..." })`
- **"God Agent Themis — Legal Agent"** (`themis-legal-agent`) — Invoke: `Agent({ subagent_type: "themis-legal-agent", prompt: "..." })`
- **"God Agent Tyche — Analytics Agent"** (`tyche-analytics-agent`) — Invoke: `Agent({ subagent_type: "tyche-analytics-agent", prompt: "..." })`
- **"God Agent Zeus — Executive Agent"** (`zeus-executive-agent`) — Invoke: `Agent({ subagent_type: "zeus-executive-agent", prompt: "..." })`
- **"Eidos — Figma AI Orchestrator"** (`eidos-figma-orchestrator`) — Invoke: `Agent({ subagent_type: "eidos-figma-orchestrator", prompt: "..." })`
- **"Ergon — Code Layers Principal"** (`ergon-code-layers`) — Invoke: `Agent({ subagent_type: "ergon-code-layers", prompt: "..." })`
- **"Hyle — Shader Material Scientist"** (`hyle-shader-material`) — Invoke: `Agent({ subagent_type: "hyle-shader-material", prompt: "..." })`
- **"Kairos — Prototype Behavior Engineer"** (`kairos-prototype-engineer`) — Invoke: `Agent({ subagent_type: "kairos-prototype-engineer", prompt: "..." })`
- **"Kinesis — Motion Systems Director"** (`kinesis-motion-systems`) — Invoke: `Agent({ subagent_type: "kinesis-motion-systems", prompt: "..." })`
- **"Logos — UX Research & Systems Agent"** (`logos-ux-research`) — Invoke: `Agent({ subagent_type: "logos-ux-research", prompt: "..." })`
- **"Mnemon — Context Librarian & Governance"** (`mnemon-context-librarian`) — Invoke: `Agent({ subagent_type: "mnemon-context-librarian", prompt: "..." })`
- **"Morphe — Weave Creative Workflow Architect"** (`morphe-weave-workflow`) — Invoke: `Agent({ subagent_type: "morphe-weave-workflow", prompt: "..." })`
- **"Praxis — Figma Make + Sites Producer"** (`praxis-figma-make`) — Invoke: `Agent({ subagent_type: "praxis-figma-make", prompt: "..." })`
- **"Techne — Design System Neuroarchitect"** (`techne-design-system`) — Invoke: `Agent({ subagent_type: "techne-design-system", prompt: "..." })`
- **"God Agent Aether — AI Strategy Agent"** (`aether-ai-strategy-agent`) — Invoke: `Agent({ subagent_type: "aether-ai-strategy-agent", prompt: "..." })`
- **"God Agent Alecto — Competitive Intelligence Agent"** (`alecto-competitive-agent`) — Invoke: `Agent({ subagent_type: "alecto-competitive-agent", prompt: "..." })`
- **"God Agent Asclepius — Debugging & Diagnostics Agent"** (`asclepius-debugging-agent`) — Invoke: `Agent({ subagent_type: "asclepius-debugging-agent", prompt: "..." })`
- **"God Agent Atlas — Atlas Platform Integration Agent"** (`atlas-integration-agent`) — Invoke: `Agent({ subagent_type: "atlas-integration-agent", prompt: "..." })`
- **"God Agent Calliope — Email Design Agent"** (`calliope-email-agent`) — Invoke: `Agent({ subagent_type: "calliope-email-agent", prompt: "..." })`
- **"God Agent Cassandra — QA & Testing Agent"** (`cassandra-qa-agent`) — Invoke: `Agent({ subagent_type: "cassandra-qa-agent", prompt: "..." })`
- **"God Agent Chiron — Architecture Agent"** (`chiron-architecture-agent`) — Invoke: `Agent({ subagent_type: "chiron-architecture-agent", prompt: "..." })`
- **"God Agent Chrysos — Stripe Integration Agent"** (`chrysos-stripe-agent`) — Invoke: `Agent({ subagent_type: "chrysos-stripe-agent", prompt: "..." })`
- **"God Agent Clio — Case Study Agent"** (`clio-case-study-agent`) — Invoke: `Agent({ subagent_type: "clio-case-study-agent", prompt: "..." })`
- **"God Agent Coeus — Ideation Agent"** (`coeus-ideation-agent`) — Invoke: `Agent({ subagent_type: "coeus-ideation-agent", prompt: "..." })`
- **"God Agent Eos — Automation Agent"** (`eos-automation-agent`) — Invoke: `Agent({ subagent_type: "eos-automation-agent", prompt: "..." })`
- **"God Agent Erato — Brand Voice Agent"** (`erato-brand-voice-agent`) — Invoke: `Agent({ subagent_type: "erato-brand-voice-agent", prompt: "..." })`
- **"God Agent Helios — KeyShot Specialist"** (`helios-keyshot-agent`) — Invoke: `Agent({ subagent_type: "helios-keyshot-agent", prompt: "..." })`
- **"God Agent Hera — Recruiting Agent"** (`hera-recruiting-agent`) — Invoke: `Agent({ subagent_type: "hera-recruiting-agent", prompt: "..." })`
- **"God Agent Heracles — CRM Agent"** (`heracles-crm-agent`) — Invoke: `Agent({ subagent_type: "heracles-crm-agent", prompt: "..." })`
- **"God Agent Kratos — DevOps Agent"** (`kratos-devops-agent`) — Invoke: `Agent({ subagent_type: "kratos-devops-agent", prompt: "..." })`
- **"God Agent Kronos — GitHub Repository Agent"** (`kronos-github-agent`) — Invoke: `Agent({ subagent_type: "kronos-github-agent", prompt: "..." })`
- **"God Agent Metis — Project Manager & Execution Planner"** (`metis-pm-agent`) — Invoke: `Agent({ subagent_type: "metis-pm-agent", prompt: "..." })`
- **"God Agent Momus — Challenger & Clarity Enforcer"** (`momus-challenger-agent`) — Invoke: `Agent({ subagent_type: "momus-challenger-agent", prompt: "..." })`
- **"God Agent Nike — Social Media Agent"** (`nike-social-agent`) — Invoke: `Agent({ subagent_type: "nike-social-agent", prompt: "..." })`
- **"God Agent Notus — Vercel Platform Agent"** (`notus-vercel-agent`) — Invoke: `Agent({ subagent_type: "notus-vercel-agent", prompt: "..." })`
- **"God Agent Plutus — Billing Agent"** (`plutus-billing-agent`) — Invoke: `Agent({ subagent_type: "plutus-billing-agent", prompt: "..." })`
- **"God Agent Polyhymnia — Docs Agent"** (`polyhymnia-docs-agent`) — Invoke: `Agent({ subagent_type: "polyhymnia-docs-agent", prompt: "..." })`
- **"God Agent Pontus — Supabase Platform Agent"** (`pontus-supabase-agent`) — Invoke: `Agent({ subagent_type: "pontus-supabase-agent", prompt: "..." })`
- **"God Agent Proteus — Drift & Alignment Monitor"** (`proteus-drift-agent`) — Invoke: `Agent({ subagent_type: "proteus-drift-agent", prompt: "..." })`
- **"God Agent Psyche — SEO Agent"** (`psyche-seo-agent`) — Invoke: `Agent({ subagent_type: "psyche-seo-agent", prompt: "..." })`
- **"God Agent Pygmalion — Blender Specialist"** (`pygmalion-blender-agent`) — Invoke: `Agent({ subagent_type: "pygmalion-blender-agent", prompt: "..." })`
- **"God Agent Talos — Web Dev Agent"** (`talos-web-dev-agent`) — Invoke: `Agent({ subagent_type: "talos-web-dev-agent", prompt: "..." })`

_Run `thesmos catalog:list` to see all available agents and skills._
<!-- THESMOS:GENERATED END rules -->
