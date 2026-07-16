# Pantheon Agent Quality Standard (v2)

> Every God Agent must meet this bar before ship. Hermes / Aphrodite / Talos are the reference implementations.

World-class agents are not longer prompts — they are **contracts**. The user should get a specialist who diagnoses before acting, refuses garbage briefs, shows their work once, and hands off cleanly.

## Required sections (catalog source)

| Section | Purpose | Pass criteria |
|---|---|---|
| Frontmatter | Identity + routing metadata | `id`, `god`, `role`, `emoji`, `tags`, `governance.rules`, `platforms.cursor_globs` |
| Identity | Who + years + methodology named | 1 paragraph; methodology frameworks named explicitly |
| Voice & Tone | How they speak | 3+ example lines; explicit never/always |
| Mission | Why they exist | One job, one sentence of success |
| Trigger phrases | When to invoke | ≥8 concrete user phrases |
| Output contract | What "done" looks like | Numbered deliverables; each is checkable |
| Execution path | Pre-work questions | 4–6 diagnostic questions before producing |
| Constraints | Hard boundaries | What they will not do / will not pretend to own |
| Failure modes | How this domain usually fails | ≥4 modes with a diagnostic question each |
| Problem diagnosis | Real problem vs stated problem | ≥3 "before I do X, answer Y" lines |
| Judgment unique | Why this god, not a generic LLM | ≥3 non-obvious domain insights |
| Embedded example | Gold-standard I/O | One realistic input → full contracted output |
| Delegation map | Who owns adjacent work | Named agents + what they receive |
| Reflection protocol | Self-check before send | Domain-specific, not the generic 3-liner alone |
| Response Identity Protocol | Banner + close | Opening banner + closing signature |
| Priority hierarchy | Conflict resolution | Ordered 1–4; safety/accuracy first |

Injected at load time (do not duplicate in catalog): `Operating Doctrine`, `Anti-Drift Protocol`.

## Quality bar vs common agent kits

What makes Thesmos agents 2× better than typical "persona prompts":

1. **Diagnose before deliver** — Problem diagnosis forces the real question.
2. **Checkable output contracts** — not "helpful advice", named artifacts.
3. **Failure modes with diagnostics** — teaches the user the domain failure pattern.
4. **Embedded gold example** — shows the bar; models imitate format.
5. **Delegation, not sprawl** — stays in lane; names the next god.
6. **Governance badges that are honest** — only rules actually assessed.
7. **Team orchestration** — `pantheon:team` sequences for multi-domain work.
8. **Lean power tier** — one specialist by default; councils are intentional.

## Scoring rubric (self-audit)

Score each agent 0–2 per dimension (max 16):

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Output contract | Vague | Present but soft | Every item checkable |
| Diagnosis | None | Generic questions | Domain-specific, would change the plan |
| Failure modes | None | List only | Each has a diagnostic |
| Embedded example | None | Partial | Full contract demonstrated |
| Voice | Generic helpful | Some personality | Unmistakable; never/always clear |
| Delegation | Missing | Names only | Clear handoff artifacts |
| Constraints | Missing | Soft | Hard refusals that protect quality |
| Reflection | Generic copy | Partially domain | Domain-specific pass/fail checks |

**Ship threshold:** ≥12/16 for Pantheon gods. ≥10/16 for platform specialists. Reviewers may be leaner (tools, not gods).

## Anti-patterns (do not ship)

- Same Reflection protocol pasted into every agent with zero domain specifics
- "12+ years experience" with no methodology named
- Output contract that says "helpful recommendations" without artifacts
- Delegation to agents that do not exist (e.g. Iris → Artemis)
- Cursor export without `globs` / stale count in setup docs
- Team sequences that reference wrong agent IDs
- Always-on ceremony for single-domain tasks (violates lean power tier)

## Upgrade checklist for authors

When improving an agent:

1. Read Hermes or Aphrodite end-to-end as the reference.
2. Add missing Failure modes / Problem diagnosis / Judgment / Embedded example.
3. Make Output contract items binary-checkable.
4. Fix any broken `delegates_to` IDs.
5. Bump `version` patch (e.g. 1.0.0 → 1.1.0) when behavior changes.
6. Re-export: `thesmos pantheon:export --target cursor` (and `--all` if shipping a kit).
7. Run `thesmos pantheon:install --all --write --cursor` in a test project.
