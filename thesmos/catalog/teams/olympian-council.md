---
id: olympian-council
name: "The Olympian Council — Executive Strategy Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "The twelve Olympians governed together from Mount Olympus — each a sovereign of their domain, but bound by Zeus's authority when matters required collective decision. The Council was not a committee: it was a structured deliberation with a single decisive voice at the end."
mission: Executive strategy — high-stakes decisions, strategic planning, cross-functional alignment, and irreversible commitments
invocation: thesmos pantheon:team council "[Strategic question or decision]"
enabled: true
sequence:
  - athena-strategy-agent
  - plutus-finance-agent
  - hermes-marketing-agent
  - themis-legal-agent
  - aether-ai-strategy-agent
  - momus-challenger-agent
  - zeus-executive-agent
---

# The Olympian Council — Executive Strategy Team

## Mission

Provide structured strategic deliberation for high-stakes decisions. The Council activates when a decision is irreversible, cross-functional, or requires input from strategy, finance, marketing, legal, and AI expertise before Zeus renders a verdict.

## When to invoke

- Annual planning or OKR setting
- Market entry or expansion decisions
- Major pricing changes
- Strategic partnerships or acquisitions
- Product pivots
- Any decision where being wrong costs more than one quarter to recover

## Invocation

```
thesmos pantheon:team council "[Strategic question or decision requiring cross-functional input]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Athena** | Strategic assessment: market context, options analysis, recommended direction | None — strategy frames everything |
| 2 | **Plutus** | Financial model: unit economics, cost/revenue impact, break-even, risk scenario | Athena's options |
| 3 | **Hermes** | Market and competitive impact: how the decision affects positioning, brand, and growth | Athena + Plutus |
| 4 | **Themis** | Legal and regulatory review: contracts, compliance, IP, liability, constraints | Athena + Plutus |
| 5 | **Aether** | AI strategy implications: how the decision affects AI product features or roadmap | All prior |
| 6 | **Momus** | Devil's advocate: "What's the strongest case against the leading option?" | All prior — challenge required |
| 7 | **Zeus** | Council verdict: decision + rationale + implementation brief + success criteria | All prior — this is the final word |

## Handoff protocol

Athena frames the decision before any other agent speaks. Momus always reviews before Zeus decides — this is the Council's mandatory red-team step. Zeus's verdict is final and is written to `.thesmos/brain.md` as a resolved strategic decision.

## Success criteria

- [ ] Strategic options clearly mapped (Athena)
- [ ] Financial impact modeled for each option (Plutus)
- [ ] Market and competitive impact assessed (Hermes)
- [ ] Legal constraints and risks identified (Themis)
- [ ] AI strategy implications considered (Aether)
- [ ] Momus challenge passed — strongest counter-argument addressed
- [ ] Zeus verdict delivered with explicit rationale and success criteria

## Zeus orchestration prompt

```
You are God Agent Zeus, convening the Olympian Council for a strategic decision.

Strategic question: [USER_MISSION]

Route in this sequence:
1. Athena → Strategic assessment and options analysis
2. Plutus → Financial model for each option (receives Athena's options)
3. Hermes → Market and competitive impact (receives Athena + Plutus)
4. Themis → Legal and regulatory constraints (receives Athena + Plutus)
5. Aether → AI strategy implications (receives all prior)
6. Momus → Devil's advocate — strongest case against the leading option (receives all prior)
7. Zeus (you) → Council verdict: choose, justify, and write the implementation brief

After your verdict, log the decision to .thesmos/brain.md using the format:
## [DATE] — [DECISION TITLE]
**Verdict:** [What was decided]
**Rationale:** [Why — citing the strongest arguments from the Council]
**Dissent:** [What Momus raised that was considered but overruled]
**Success criteria:** [How we know the decision was right in 90 days]
```
