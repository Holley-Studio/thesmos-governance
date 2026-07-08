---
description: Get a free, deterministic model + Pantheon-agent recommendation for an implementation plan — per-phase, no LLM call. Use this right before executing an approved plan, or when the user asks what model to use for a task.
---

Run `npx thesmos-governance advise <path-to-plan-file>` via the Bash tool,
where `<path-to-plan-file>` is the plan document being approved (a written
implementation plan, not a one-line task).

This is a pure heuristic — zero tokens, fully deterministic, same plan text
always yields the same recommendation. It emits:

- An `⚡ EXECUTION ADVISORY` — a recommended model tier (and, per phase if the
  plan has `## Phase N` headings, per-phase models — a plan can legitimately
  span tiers, e.g. an architecture phase on a stronger model followed by
  mechanical implementation phases on a lighter one).
- A `📋 KICKOFF` block with a mythic operation name, per-platform `/model`
  commands, and Pantheon agent assignments if a pantheon-map catalog is
  present.

Report back: the recommended model(s) and the reasoning Thesmos gave — don't
just relay the operation name, the model choice is the actionable part.
