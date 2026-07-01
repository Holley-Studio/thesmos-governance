# Workflow: Product Feature Launch

> **When to use:** Launching a new product or major feature that requires coordinated strategy, design, security review, content, and marketing output.
>
> **Trigger phrase to Zeus:** `"We're launching [feature/product] in [timeframe] — orchestrate the launch."`
>
> **Agents involved:** Zeus → Athena → Daedalus → Argus → Hermes → Apollo → Tyche
>
> **Estimated sessions:** 3–5 working sessions across the phases below.

---

## Phase 1 — Strategy & Product Foundation

### Step 1: Zeus receives the launch request

Zeus assesses the task before routing.

```
⚡ ZEUS — EXECUTIVE ORCHESTRATION

Situation: Launching [feature] in [timeframe]. Requires market positioning, a product spec,
security clearance, go-to-market planning, and launch copy — in that dependency order.

Routing:
  • God Agent Athena → Map the market, define positioning, and produce the OKR cascade for this launch
  • God Agent Daedalus → PRD based on Athena's positioning (depends on Athena first)
  • God Agent Argus → Security review of the feature (can run parallel to Daedalus)

Dependency order:
  1. Athena: positioning and OKRs (Day 1 — all copy and GTM work depends on this)
  2. Daedalus: PRD (Day 2–3, after Athena delivers)
  3. Argus: security review (Day 2–3, parallel with Daedalus)

Success criteria:
  [ ] Athena delivers: Porter's Five Forces, positioning choice, OKR cascade
  [ ] Daedalus delivers: PRD with acceptance criteria and RICE scores
  [ ] Argus delivers: threat model with 0 BLOCKERs or BLOCKER list for resolution

— Zeus | Executive Orchestration
Thesmos check: AGNT_001 ✅ | AGNT_006 ✅
```

---

### Step 2: Athena — Market & Positioning

**Trigger:** "Athena, map the competitive landscape for [feature] and define our positioning."

**Athena delivers:**
- Porter's Five Forces analysis for the target market segment
- Explicit "where NOT to compete" choices (as important as where to play)
- Positioning statement: one sentence capturing the specific claim we own
- OKR cascade: 1 Objective, 3–5 Key Results with lead/lag distinction
- Every unvalidated market assumption tagged `[ASSUMPTION]`

**Quality gate before proceeding:** Positioning must state explicitly who this is for, what it does, and who it is NOT for. Vague positioning (e.g., "for teams that care about quality") fails the gate.

**Athena handoff to Daedalus:** Pass the positioning statement, the target user definition from the OKRs, and the "not for" list. Daedalus writes to this spec — not to a blank page.

---

### Step 3: Daedalus — Product Requirements

**Trigger:** "Daedalus, write the PRD for [feature] based on Athena's positioning. Target user: [Athena's definition]."

**Daedalus delivers:**
- Problem statement (one paragraph, specific)
- User stories in format: "As a [user], I want [action] so that [outcome]"
- Acceptance criteria (binary pass/fail — no "good enough" criteria)
- RICE score for this feature vs. the next 3 alternatives
- Non-goals: explicitly what this feature does NOT do
- Edge cases, error states, and empty states for every interaction
- Success metric tied to an Athena OKR

**Quality gate before proceeding:** Every acceptance criterion must be binary. "Users find it intuitive" fails. "User completes the primary action in under 3 clicks without documentation" passes.

---

### Step 4: Argus — Security Review (parallel with Daedalus)

**Trigger:** "Argus, security-review [feature description]. Threat-model it before we build."

**Argus delivers:**
- STRIDE threat model across all 6 categories
- CVSS-scored findings (Critical/High/Medium/Low)
- Exploitation scenario for every Critical and High finding
- Copy-paste-ready remediation for each finding
- Residual risk statement (even if findings are zero)

**Hard stop:** If Argus returns any BLOCKER finding, Phase 2 (build) does not start until the finding is resolved. This is not negotiable — Argus holds the security veto.

**If BLOCKERs are found:**

```
⚡ ZEUS — BLOCKER HOLD

Argus has returned [N] BLOCKER findings. Phase 2 is paused.

Routing to resolve:
  • God Agent Argus → [specific remediation for each BLOCKER]

Phase 2 resumes when Argus confirms: 0 BLOCKERs remaining.

— Zeus | Executive Orchestration
```

---

## Phase 2 — Build & GTM Planning (parallel)

Once Argus confirms 0 BLOCKERs and Daedalus delivers the PRD, Phase 2 runs in parallel.

### Step 5A: Hermes — Go-to-Market Plan

**Trigger:** "Hermes, build the GTM plan for [feature] using Athena's positioning: [paste positioning statement]."

**Hermes delivers:**
- Channel selection with CAC/LTV assumption per channel `[ASSUMPTION tagged if unvalidated]`
- Campaign brief: audience segment, channel, message, CTA, success metric, test hypothesis
- Growth loop identified: what drives re-engagement and referral in this launch
- Launch timeline: channel activation sequence with owner and date for each
- Measurement plan: what signal at what cadence confirms the GTM is working

---

### Step 5B: Apollo — Launch Copy

**Trigger:** "Apollo, write launch copy for [feature]: landing page headline and subhead, 3-email launch sequence, and social proof framing. Brand voice: [paste brand voice brief or reference Erato's guide]."

**Apollo delivers:**
- 3 headline variants (the first one is the recommendation)
- Landing page: headline, subhead, 3 benefit bullets, CTA
- Email 1 (launch announcement): subject line, body, CTA
- Email 2 (use case / proof): subject line, body, CTA
- Email 3 (urgency / last call): subject line, body, CTA
- Social proof framing: how to present customer evidence without fabricating
- Every piece tagged with the primary CTA and measurable conversion intent

**Apollo quality gate:** No filler words ("amazing", "powerful", "revolutionary") in final copy. Headlines tested against: clarity, curiosity, urgency, specificity — at least 2 of 4 must be present.

---

## Phase 3 — Measurement & Launch Readiness

### Step 6: Tyche — KPI Framework

**Trigger:** "Tyche, build the launch KPI framework for [feature] using Athena's OKRs: [paste OKRs]."

**Tyche delivers:**
- North Star metric: one number that tells us if the launch worked
- Dashboard metrics: each with name, definition, data source, calculation, owner, and what decision it informs
- AARRR funnel mapped to this launch: where the feature touches acquisition, activation, retention, referral, revenue
- Data quality checklist: what instrumentation must be confirmed before launch day
- Baseline established: current state of each metric before launch so we can measure delta

---

## Zeus Council Report (Final)

After all agents deliver, Zeus produces the council report:

```
⚡ ZEUS — COUNCIL REPORT

🦉 Athena has delivered: Positioning for [feature] — [one-sentence positioning statement].
   OKRs: [Objective], [N] Key Results defined.

🏗️ Daedalus has delivered: PRD with [N] user stories, acceptance criteria, and RICE score [X].

👁 Argus has delivered: Security review complete. 0 BLOCKERs. [N] HIGH findings
   remediated. Residual risk: [Low/Medium].

🚀 Hermes has delivered: GTM plan — [primary channel], [N]-week campaign, launch date [date].

✍️ Apollo has delivered: Landing page copy + 3-email sequence. Headline recommendation: "[headline]".

📊 Tyche has delivered: KPI framework. North Star: [metric]. Dashboard live date: [date].

All quality gates cleared. Launch is GO.

Dependency chain complete:
  ✅ Positioning defined (Athena)
  ✅ PRD finalized (Daedalus)
  ✅ Security cleared (Argus)
  ✅ GTM plan ready (Hermes)
  ✅ Copy approved (Apollo)
  ✅ Measurement live (Tyche)

— Zeus | Executive Orchestration
Thesmos check: AGNT_001 ✅ | AGNT_006 ✅
```

---

## Variations

**Smaller launch (no new code, copy + GTM only):**
Skip Daedalus and Argus. Athena → Hermes + Apollo in parallel → Tyche.

**Security-only review (no launch):**
See `workflow-security-audit.md`.

**Design-first launch (Figma handoff required):**
Add Hephaestus after Daedalus for design spec, then route through Figma workflow. See `workflow-figma-to-ship.md`.

**Legal review required (enterprise or regulated market):**
Add Themis parallel with Argus: "Themis, review [feature] for [GDPR/SOC2/HIPAA] implications."
