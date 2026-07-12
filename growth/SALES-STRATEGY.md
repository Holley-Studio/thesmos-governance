# Thesmos Sales Strategy

Single reference doc for ICP, positioning, pricing rationale, funnel, and objection handling. Council deliverable: Ares (closing, qualification, objection handling) + Athena (positioning lens). Grounded in `growth/README.md`, `growth/scorecard.md`, `growth/reddit/seeding-guide.md`, `growth/email/upsell-sequence.md`, `docs/gating.md`, `website/vs.html`, `website/pricing.html`, `LICENSE`.

---

## 1. ICP — three personas

**(a) Solo AI-builder / indie hacker.** Shipping AI-assisted code (Cursor, Copilot, Claude Code) alone or near-alone — no second pair of eyes on what the model wrote. **Pain:** doesn't know what a phantom import, hardcoded secret, or SSRF-shaped fetch looks like until it's in prod; the VIBE_* and SLOP_* rule families exist specifically for this failure mode. **Why Thesmos:** the CLI is free forever (`npm install -g thesmos-governance`), runs locally, no LLM call in the core gate — a genuine safety net with zero cost of entry. **Tier fit:** Free Essentials tier — 288 rules (every BLOCKER + the full AI-code net) + 6 starter agents (Zeus, Athena, Argus, Apollo, Hephaestus, Hebe). BANT: Budget Low/Unknown, Authority High (solo decision-maker), Need High, Timeline Now (they're shipping today). This is the free-tier funnel entry point — close on activation, not revenue, and let the email upsell sequence do the paid conversion later.

**(b) Agency lead managing multiple client codebases.** Needs the same governance bar applied consistently across N client repos without re-explaining standards every engagement, plus the creative/production layer (brand, content, campaigns) client work demands. **Pain:** inconsistent review quality across clients erodes trust; no single agent roster covers both code governance and creative delivery. **Why Thesmos:** the CLI's config (`disabledRules`, `reviewIgnorePaths`, baseline) travels with the repo, so the same governance bar ships per-client without re-teaching it; the Full Pantheon ($79, one time — all 67 agents including the content/brand/campaigns specialists) is the vertical answer for the non-code half of the job. **Tier fit:** Full Pantheon ($79) + CLI on every client repo. BANT: Budget Medium (agency has real budget, decision is fast at $79), Authority High (lead is the buyer), Need Medium-High, Timeline Medium (next client onboarding cycle).

**(c) Engineering manager at a small-to-mid team.** Wants PR gating with teeth — but the #1 reason teams rip out SAST/AI-review tools is noise: heuristic rules blocking unrelated legacy debt, false positives eroding trust in the gate. **Pain:** exactly what `docs/gating.md` was built to solve. **Why Thesmos:** the diff-aware gate contract — only NEW findings (on lines this PR actually changed, or files it added) can block; PRE-EXISTING findings report but never block. Confidence tiers (`high`/`medium`/`low`) mean a shape-heuristic rule that might misfire doesn't gate by default (`gate.minConfidence: medium`). This is the literal fix shipped in the Themis Rising work referenced in this repo's own commit history (PR #57–#59). **Tier fit:** Free Essentials CLI + GitHub Action for the gate itself; Full Pantheon ($79, unlocks the full 1,137-rule engine) once the team wants the broader agent roster (Deal Strategy, Pipeline, Themis for contracts, etc.) beyond code review. BANT: Budget Medium, Authority Medium (EM influences, needs buy-in above them for team-wide tool adoption), Need High, Timeline Medium (tied to next sprint's tooling decision).

**Adversarial check:** the assumption that ties all three together — "free CLI adoption converts to paid Pantheon" — is unverified at scale. `growth/scorecard.md` has no filled data yet (template only, zero weeks logged as of this writing). The 10–18% free→paid benchmark in `growth/email/upsell-sequence.md` is stated as a "research benchmark," not this product's own measured conversion. Treat all funnel math below as directional until the scorecard has real weeks in it.

---

## 2. Positioning statement + KSP table

**Positioning statement:** *Thesmos is the governance layer for AI-written code — free, local, and diff-aware, so it catches what your AI assistant got wrong without blocking you on debt it didn't write.*

**The category-defining line (Athena):** Tools like Famous.ai, Lovable, and Bolt write the code — Thesmos governs it. This isn't a competitive claim (see §7) — it's a category-anchor. AI code generators are a wave that makes the governance problem bigger every month; Thesmos rides that wave rather than fighting it.

| Feature | Benefit | Proof |
|---|---|---|
| Diff-aware gating (NEW vs. PRE-EXISTING) | One changed line doesn't block you on legacy debt already in the repo | `docs/gating.md` §5; shipped and dogfooded on this repo's own CI (PR #57–#59, "Themis Rising") |
| Confidence tiers (high/medium/low) | A shape-heuristic rule that *might* misfire doesn't gate your merge by default | `docs/gating.md` §2, §6 — `gate.minConfidence: medium` is the shipped default |
| Smart dedup (per `vs.html`) | 47 files firing the same rule collapse into one grouped finding, not 47 separate alerts | `website/vs.html` differentiator section — stated product behavior |
| 1,137 governance rules, 10 languages | Broad coverage without needing Semgrep's config tuning overhead | `website/vs.html`, `website/pricing.html` — consistent 1,137 figure across both. 288 are free (Essentials tier); the remaining 849 unlock with the $79 Full Pantheon. |
| No LLM call in the core CLI gate | Local regex/AST scan — no code leaves the machine for the free tier's core scan | [ASSUMPTION: inferred from "local-first design" and "no code sent to Holley Studio servers" claims in `vs.html`; the Pantheon *agent personas* are separate — those are prompt-driven and may involve whatever LLM the user's platform runs, which is outside Thesmos's control] |
| One-time pricing, no subscription | Budget certainty — pay once, no renewal risk, no seat-based creep | `website/pricing.html` — Essentials $0 / Full Pantheon $79, one-time |
| FSL-1.1-MIT license | Free for your own use and internal tooling; not free to resell as a competing hosted product | `LICENSE`, `LICENSE-COMMERCIAL.md` |

---

## 3. Pricing rationale

The ladder: **$0 (Essentials — 288 rules, 6 agents) → $79 (Full Pantheon — full 1,137-rule engine, 67 agents)**, one-time, no subscription (`website/pricing.html`).

- **Free tier exists to remove all friction from first activation.** No email, no card (`pricing.html` FAQ: "No account, no email, no credit card"). This is the top of every channel in §4 — the free CLI and free Essentials pack are the thing every piece of content points at.
- **$79 flat pricing vs. competitor subscriptions is a stated, verifiable advantage** — not an assumption: CodeRabbit is $24/user/**month**, Semgrep is $35/contributor/**month** (`website/vs.html` comparison table). A one-time $79 purchase beats a recurring $24–35/month within roughly 3–4 months and never recurs again. This is a real, citable number, not a projection.
- **One-time beats subscription for a content-shaped product** [ASSUMPTION]: the Pantheon is agent persona files, not a hosted service with ongoing compute cost — the economics support one-time pricing the way they wouldn't for a metered API product. This is a reasonable inference from the product's architecture (local files, no server-side inference cost per user) but is not backed by a cited pricing study in this repo.
- **"$47+ signals quality vs. $19 undercutting"** — this specific framing was in the task brief but **could not be located in any file in this repo** (`growth/README.md`, `growth/scorecard.md`, or elsewhere). I'm not asserting it as fact. [ASSUMPTION/UNVERIFIED: flagging rather than fabricating a citation. The actual prices chosen ($49/$79) are consistent with a quality-signaling strategy, but no research artifact backs the specific "$47 threshold" claim in this codebase as of this writing.]
- **Flat pricing vs. competitors' credit-metering** is real and citable: none of Thesmos's tiers meter usage, tokens, or seats the way CodeRabbit/Semgrep do per the same comparison table.

---

## 4. Funnel map

```
Channel (growth/reddit, growth/x-threads, growth/product-hunt, growth/shorts, growth/medium)
  → traffic via website/go/*.html UTM redirects (per-channel attribution, growth/README.md)
  → Free tier: CLI (npm install, 288-rule Essentials) OR Essentials agent zip (6 agents, no email required)
  → Email capture: Essentials pack download on Gumroad triggers the 3-email workflow
    (growth/email/upsell-sequence.md — Day 0 activation, Day 3 "what the full council saw,"
    Day 7 "40% off, 48h" urgency close with code OLYMPUS40)
  → Paid: Full Pantheon ($79, unlocks the full 1,137-rule engine + all 67 agents) via Gumroad
```

Cadence and channel detail live in `growth/README.md` (15 hrs/week: Mon scorecard + X scheduling, Tue/Thu Reddit/Discord, Wed Medium, Fri Shorts, monthly god-drop). Weekly numbers get logged in `growth/scorecard.md` across the same categories this funnel implies: free downloads, email captures, paid sales, revenue, GPT convos, extension installs, top channel. **Do not restate the channel calendar here** — see §6.

**Reddit is the one channel with an actual (if small-n) proof point:** `growth/reddit/seeding-guide.md` cites "one creator drove 102 sales (~$980) in 2 weeks from genuine Reddit participation with zero following." This is a benchmark from someone else's campaign, not Thesmos's own measured result — treat it as a directional target, not a guarantee. [VERIFY: source of this benchmark isn't cited in the seeding guide itself.]

**Conversion assumption to flag:** the email sequence's own header states "10-18% free→paid conversion with this structure" as a "research benchmark" — again, not Thesmos's measured number. `growth/scorecard.md`'s decision rule ("free→paid conversion below 5% after 100 captures → rework the sequence") is the actual trigger to watch — until real weeks are logged, this whole funnel is unvalidated.

---

## 5. Objection handling

1. **"Isn't this just prompts/agent files anyone could write?"** — Acknowledge: yes, the persona markdown is readable and open (source content for every god, and every premium rule, is public on GitHub). Explore: what you're actually paying for isn't the prompt text, it's running the full engine without hand-assembling it — pre-built Zeus orchestrators per platform, platform-native exports for all 10 supported tools, one-click installs, and lifetime updates (`pricing.html` "open-core" explainer). Reframe: the free Essentials tier proves this — if the content alone were the value, we wouldn't give 288 rules and 6 agents away for $0. Close: "Try the free tier first. If the packaging and orchestration don't save you time versus hand-rolling it, don't buy the rest."

2. **"Won't your regex rules just be full of false positives?"** — Acknowledge: yes, that's the #1 reason teams uninstall SAST tools (`vs.html`: "alert fatigue," Semgrep is "notoriously noisy" out of the box). Explore: has a heuristic tool ever blocked your merge on something that turned out to be nothing? Reframe: Thesmos's answer is structural, not a promise — confidence tiers (high/medium/low) mean only `medium`+ findings gate by default, and diff-aware partitioning means only NEW findings (on lines you actually touched) can block at all; pre-existing debt reports but never gates (`docs/gating.md`). Close: "Run `thesmos ci` against your last closed PR and count how many of the reported findings were actually on your changed lines. That's the real number to judge us on."

3. **"Why not just use CodeRabbit/Semgrep?"** — Acknowledge: both are legitimate, mature tools with strong ecosystems. Explore: are you paying per-seat/per-contributor monthly, and does that cost scale with team growth regardless of usage? Reframe: CodeRabbit is $24/user/month with AI-generated (non-auditable) summaries and no agent system; Semgrep is $35/contributor/month with 20,000+ rules but known out-of-box noise (`vs.html` comparison table, verdict language). Thesmos is free at the CLI layer and $79 one-time for the full business-agent layer neither competitor has at all. Close: "If you only need PR summaries, CodeRabbit's simpler onboarding might genuinely be the better fit — I'd rather you know that than not."

4. **"Is this open source or not?"** — Direct answer, no hedging: it's source-available, not open source — the CLI, all 1,137 rules, and every agent's source markdown are public and free to read/use under FSL-1.1-MIT (`LICENSE`), but FSL is not an OSI-approved open-source license. The *restriction* is narrow and specific: you cannot host a competing commercial version of Thesmos itself for resale (`LICENSE-COMMERCIAL.md` — "Competing Use" clause). On June 17, 2030, it converts fully to MIT with zero restrictions. Close: "If you're building internal tooling or your own product on top of it, you're covered. If you're building a hosted governance SaaS to resell, that's the one case you'd need to talk to us first."

5. **"Will this slow down my PRs?"** — Direct answer: no — that's the specific problem diff-aware gating was built to prevent. Only findings on lines/files this PR actually changed can block the merge; everything pre-existing in the touched files is reported in a collapsed summary, never blocking (`docs/gating.md` §5). Files GitHub can't diff (large/binary) fail closed, by design, so nothing silently skips review. Close: "Point it at your PR action config and watch one PR go through — you'll see the NEW/PRE-EXISTING split in the summary comment directly."

6. **"What happens to my code/data?"** — Accurate answer, not oversold: the core CLI scan is local regex/AST analysis — [ASSUMPTION: no LLM call in the base `scan`/`validate`/`ci` path, inferred from the "local-first design" and "no code sent to servers" claims in `vs.html`; I have not personally traced the scan engine's source in this session to confirm zero network calls]. Telemetry is opt-in per `vs.html`. The secrets vault is AES-256-GCM, stored in the system keychain, never transmitted. The Pantheon *agent personas*, separately, are prompts that run inside whatever AI platform you invoke them on (Claude, ChatGPT, Cursor, etc.) — that's your platform's data handling, not an additional Thesmos-side pipeline. Close: "If data residency is a hard requirement, verify the scan engine's network behavior yourself before rollout — I'd rather you check than take my word for it."

7. **"Can I trust a solo/small studio's tool?"** — Acknowledge directly: yes, this is built and maintained by Holley Studio LLC, not a large vendor. Explore: what's actually driving the hesitation — support responsiveness, or long-term maintenance risk? Reframe: the gate is dogfooded live on this repo's own GitHub Actions CI — you can watch it fail its own PRs in public before you ever install it (link-able: `github.com/Holley-Studio/thesmos-governance`). That's a harder trust signal than a logo wall. Close: "Go look at the Actions tab on the repo right now — that's not a slide, that's the tool gating its own commits today."

8. **"What if I need support?"** — Acknowledge: every tier, including free, ships 🏺 Hebe, the dedicated support agent — grounded in `docs/gating.md` and the real per-platform install steps, answers "why is my gate red?" and "how do I install in Cursor/Codex/Gemini?" without inventing behavior Thesmos doesn't have. Explore: beyond Hebe, the repo has a public issue tracker and `SECURITY.md` for anything she can't resolve. Reframe: support that ships in the product costs nothing to reach — no ticket queue, no waiting on a human's timezone. Close: "Ask Hebe first — she's in your free tier right now. If she can't solve it, the issue tracker is one click away." *(Note: Hebe landed mid-session as a parallel workstream — this line was updated post-verification; she's confirmed shipped in `thesmos/catalog/agents/pantheon/hebe-support-agent.md` and included in every tier including Starter.)*

---

## 6. 90-day channel calendar reference

The full 90-day cadence, per-channel content assets, and weekly metrics tracking already exist and should not be duplicated here — see `growth/README.md` for the 15 hrs/week schedule (Mon scorecard fill + X scheduling, Tue/Thu Reddit/Discord value-first participation, Wed Medium publishing from week 3, Fri Shorts recording, monthly god-drop announcements) and `growth/scorecard.md` for the weekly metrics table (free downloads, email captures, paid sales, revenue, GPT convos, extension installs, top channel) plus its kill/double-down decision rules (0 conversions after 3 weeks → cut; >40% of conversions from one channel → double its content volume; <5% free→paid after 100 captures → rework the email sequence).

---

## 7. Competitive appendix

- **God of Prompt / PromptBase** — [VERIFY: no file in this repo currently documents a direct feature comparison against these two by name; `vs.html` covers CodeRabbit, Semgrep, Microsoft AGT, and Knostic but not these two prompt-marketplace competitors]. Directionally, these are prompt/persona *marketplaces*, not governance tools — they don't compete on the CLI/gate layer at all, and any Pantheon-vs-marketplace comparison should be built as a dedicated exercise, not asserted here without a source.
- **CodeRabbit** — $24/user/month, AI-generated PR summaries, no static ruleset, no agent system. Thesmos wins on price (free CLI vs. subscription), rule auditability (1,137 static rules vs. AI-generated), and dedup (grouped vs. raw per-finding). CodeRabbit wins on simplicity of onboarding. (`website/vs.html`)
- **Semgrep** — $35/contributor/month, 20,000+ rules, known out-of-box noise requiring manual tuning. Thesmos wins on price, noise ratio (smart dedup vs. Semgrep's documented false-positive problem), and AI-agent governance (Semgrep has none). Semgrep wins on raw rule count and ecosystem maturity. (`website/vs.html`)
- **famous.ai** (and Lovable/Bolt-class AI code generators) — **not a competitor: upstream/adjacent, informs positioning only.** These tools generate code; Thesmos governs code, regardless of who or what wrote it. The more these tools grow adoption, the larger Thesmos's addressable problem gets — this is the source of the "Famous.ai/Lovable/Bolt write the code — Thesmos governs it" positioning line in §2. No competitive table entry needed; `website/vs.html` doesn't carry a comparison row for these, correctly, since it isn't one.

---

**Thesmos check:** AGNT_001 — no `.thesmos/scope.json` reviewed in this task (out of scope for a sales document); no other rule from the enforced set applies to a markdown strategy doc with no code changes.
