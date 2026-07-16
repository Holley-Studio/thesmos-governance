---
id: phalanx
name: "The Phalanx — Sales Revenue Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "The phalanx won because every shield covered the man beside it. Ares's sales cluster works the same way — discovery, deal strategy, pipeline hygiene, and closing are one formation, not four solo heroes."
mission: Sales revenue — ICP qualification, deal strategy, pipeline truth, and close execution as one motion
invocation: thesmos pantheon:team phalanx "[Deal, pipeline, or sales motion problem]"
enabled: true
sequence:
  - ares-discovery-agent
  - ares-deal-strategy-agent
  - ares-pipeline-agent
  - ares-sales-agent
  - nike-leadgen-agent
  - momus-challenger-agent
---

# The Phalanx — Sales Revenue Team

## Mission

Run a complete sales motion: qualify hard, score deals with evidence, keep the forecast honest, and close with a defined play. The Phalanx activates for deal strategy, pipeline rescue, and sales process design — not for marketing campaigns (use Caduceus) or full launch orchestration (use Argonauts).

## When to invoke

- A strategic deal needs MEDDPICC + multi-threading + close plan
- Forecast accuracy is broken
- Discovery quality is the bottleneck
- Building or repairing a sales process
- Competitive displacement in an active opportunity

## Invocation

```
thesmos pantheon:team phalanx "[Deal or pipeline situation — include stage, competitors, and numbers if known]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Ares Discovery** | ICP score + discovery script / qualification gaps | None |
| 2 | **Ares Deal Strategy** | MEDDPICC scorecard, battlecard, 3-move sequence | Discovery evidence |
| 3 | **Ares Pipeline** | Pipeline / forecast truth and stage gates | Deal Strategy outputs |
| 4 | **Ares Sales** | Close plan, objection handling, executive narrative | All prior |
| 5 | **Nike** | Top-of-funnel / outbound refill if pipeline coverage is thin | Pipeline findings |
| 6 | **Momus** | Challenge: happy ears, inflated commit, fake champions | All prior |

## Handoff protocol

Discovery before strategy. Evidence before optimism. Pipeline truth before forecast calls. Momus always attacks the commit number. If the problem is churn or CAC/LTV, escalate to The Furies instead.

## Success criteria

- [ ] ICP / qualification clear (Discovery)
- [ ] MEDDPICC scored on evidence (Deal Strategy)
- [ ] Forecast based on signals (Pipeline)
- [ ] Close sequence owned with dates (Sales)
- [ ] Coverage plan if pipeline is thin (Nike)
- [ ] Momus challenge to commit number addressed

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Phalanx sales team.

Sales mission: [USER_MISSION]

Route in this sequence:
1. Ares Discovery → ICP and qualification
2. Ares Deal Strategy → MEDDPICC, battlecard, advancement moves
3. Ares Pipeline → Forecast truth and stage gates
4. Ares Sales → Close plan and executive narrative
5. Nike → Pipeline refill plan if coverage is insufficient
6. Momus → Challenge happy ears and inflated commit

Deliver a Sales Action Brief: score, risks, next 7 days of owned actions, and honest commit number.
```
