# The Council Contract

Every agent Thesmos can route to has a **contract** — a versioned, machine-readable
description of what that agent is, what it may touch, how far it may go, and what it
owes you when it says it is done.

You never write one. Contracts are **compiled** from the agent documents that already
exist. Agent Markdown stays hand-authored and is never rewritten.

---

## Pick a role, not a god

There are eight primary roles:

| Role | Lead | For |
|---|---|---|
| Build | Talos | Implementing features and changes |
| Plan | Metis | Breaking work down and sequencing it |
| Debug | Cassandra | Reproducing and isolating failures |
| Review | Momus | Reviewing changes and governance findings |
| Security | Argus | Threat modeling, audits, proven findings |
| Design | Hephaestus | UI, design systems, accessibility |
| Growth | Hermes | Marketing, acquisition, content |
| Operations | Hera | Process, people, finance, legal |

```bash
thesmos agents:list --primary
```

That is the list you choose from. It does not grow when the Pantheon does.

## Specialists are still there

The rest of the roster — the Figma specialists, the platform experts, the reviewers —
are **specialists**: `mode: subagent`, `hidden: true`. Hidden means *not in the default
selector*. It does not mean hidden from you.

```bash
thesmos agents:list --specialists
thesmos agents:list --specialists --role=security
thesmos agent:show hecate-prompt-injection-agent
```

They remain routable by Zeus and by the primary roles, they keep their names and
mythology, and they appear in execution evidence like anything else.

---

## Inspecting an agent

```bash
thesmos agent:show argus-security-agent
thesmos agent:show argus-security-agent --json
thesmos agent:show argus-security-agent --markdown
```

You get identity, role, mode, domains, capabilities, model policy, a permission
summary, limits, risk, evidence requirements, provenance, and validation status.

You do **not** get the agent's prompt. Contract inspection is metadata inspection —
printing instructions is how a roster ends up pasted into a model's context.

---

## Permissions

Seven channels: `read`, `edit`, `shell`, `web`, `browser`, `mcp`, `task` (delegation).

Two rules govern all of them:

1. **Most restrictive wins.** `deny` beats `ask` beats `allow`.
2. **Order does not matter.** Moving a rule cannot change a decision.

This is deliberately not last-match-wins. Under last-match-wins, appending a broad
`allow **` to the end of a policy silently revokes every deny above it.

Anything a contract does not mention resolves to **ask** — never to allow. An
unparsable restriction fails closed. A child agent may narrow what it inherits from its
mission; it can never widen it.

Path matching is host-independent. `src\config\prod.env`, `SRC/CONFIG/PROD.ENV`, and
`C:\repo\src\config\prod.env` all fold to the same target before any rule is consulted,
so a deny written in POSIX form still holds on Windows.

---

## Evidence

Each role declares what an agent owes you for its work to count as done. The lists are
deliberately different — a security finding without a reproduction and a design change
without a before/after are not the same kind of unproven.

| Role | Required evidence |
|---|---|
| Build | files-changed, commands-run, tests-run, test-results, unresolved-risks |
| Review | files-reviewed, findings, severity, unresolved-risks |
| Security | trust-boundaries, attack-paths, findings, reproduction, mitigation, residual-risk |
| Design | affected-surfaces, before-state, after-state, responsive-verification, accessibility-evidence |
| Growth | source-data, assumptions, recommendations, confidence, measurement-plan |

An agent that reports `complete` without its required evidence is recorded as
**partial**. It cannot mark its own homework by asserting confidently.

---

## Validating contracts

```bash
thesmos agent:validate argus-security-agent
thesmos agents:validate
thesmos agents:validate --role=build --json
```

Exit codes: `0` valid, `1` usage error or unknown agent, `2` safety-critical contract
errors. Warnings never fail a gate.

Every issue carries a stable code (`COUNCIL_PERMISSION_BROAD_WRITE`,
`COUNCIL_MISSING_SAFETY_METADATA`, …), output is ordered deterministically, and secrets
and machine paths are redacted — a validation report is safe to paste into a PR.

---

## Your own agents are yours

An agent Thesmos does not manage is **external**, and external means untouched:

- compiling a contract never rewrites the document,
- never adds it to `.thesmos/managed-agents.json`,
- never adopts it,
- and never lets it claim Thesmos ownership.

A file sitting in the managed namespace but absent from the manifest is still external.
Filename and marker are never proof of ownership. Adoption is explicit, and it is
`thesmos agent:adopt`.

External agents get the conservative baseline: no write access, no delegation, secrets
denied on read and edit.

---

## Compatibility mode

Most agents predate the contract, so their safety-critical fields come from the
conservative role baseline. That is recorded, not hidden:

```bash
thesmos agents:validate --migration
```

shows exactly which agents are on baseline metadata and which fields they would need to
declare. `agent:show` reports the same thing as `derivation: compatibility`.

To declare intent instead, add flat `council_*` keys to the agent's frontmatter:

```yaml
council_role: build
council_mode: subagent
council_risk_tier: medium
council_max_steps: 25
council_max_children: 0
council_max_parallel_children: 0
council_evidence_required:
  - files-changed
  - commands-run
council_edit_ask:
  - src/**
council_edit_deny:
  - "**/.env"
```

Opting in is all-or-nothing for safety-critical fields. Declare `council_*` keys and you
own every one of them — a half-declared contract is a validation error, not a merge with
the baseline. That is the point: a restriction Thesmos chose should never be mistaken for
a permission you granted.
