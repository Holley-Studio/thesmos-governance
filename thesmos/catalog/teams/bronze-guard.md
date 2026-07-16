---
id: bronze-guard
name: "The Bronze Guard — Web Development Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "Talos was the bronze automaton who circled Crete three times a day — tireless, precise, governed. The Bronze Guard ships web products the same way: requirements, architecture, implementation, design fidelity, tests, and security as a closed loop."
mission: Web development — product requirements, architecture, UI, implementation, QA, and security for Next.js / React products
invocation: thesmos pantheon:team bronze-guard "[Feature, page, or web product to build]"
enabled: true
sequence:
  - daedalus-product-agent
  - chiron-architecture-agent
  - hephaestus-design-agent
  - talos-web-dev-agent
  - cassandra-qa-agent
  - argus-security-agent
  - polyhymnia-docs-agent
---

# The Bronze Guard — Web Development Team

## Mission

Ship a web feature or product end to end with production standards: clear requirements, sound architecture, design fidelity, TypeScript implementation, tests, security review, and docs. Leaner than The Forge (no full DevOps/IaC pass) — use this for product surface work; use The Forge when infrastructure and CI/CD are in scope.

## When to invoke

- Building a new Next.js / React feature or page
- Implementing an API route + UI together
- Porting a design system component to production code
- Fixing a web bug that spans product, UX, and engineering
- Shipping a landing page or app surface with tests and security checks

## Invocation

```
thesmos pantheon:team bronze-guard "[What to build — include stack constraints, auth needs, and acceptance criteria if known]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Daedalus** | PRD slice: user stories, acceptance criteria, edge cases | None — requirements first |
| 2 | **Chiron** | Architecture notes: data model, API shape, Server vs Client boundaries | Daedalus |
| 3 | **Hephaestus** | UI/UX spec: states, a11y, tokens, interaction | Daedalus + brand context |
| 4 | **Talos** | Implementation: TypeScript, RSC defaults, env wiring, test scaffold | Chiron + Hephaestus |
| 5 | **Cassandra** | Test plan: unit/E2E cases, risk matrix | Talos |
| 6 | **Argus** | Security review: auth, injection, XSS, IDOR, secrets | Talos |
| 7 | **Polyhymnia** | Developer / user docs for what shipped | All prior |

## Handoff protocol

No code before Daedalus acceptance criteria. No `'use client'` without Talos justification. Argus is a gate — BLOCKERs return to Talos. Prefer The Forge when Dockerfile, Terraform, or CI pipeline work is required; prefer The Bronze Guard for app-layer shipping speed.

## Success criteria

- [ ] Acceptance criteria written and testable (Daedalus)
- [ ] Architecture decisions documented (Chiron)
- [ ] UI states and a11y covered (Hephaestus)
- [ ] Implementation with Server Component defaults (Talos)
- [ ] Test plan covering happy path + top risks (Cassandra)
- [ ] No BLOCKER security findings (Argus)
- [ ] Docs updated for the change (Polyhymnia)

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Bronze Guard web development team.

Web mission: [USER_MISSION]

Route in this exact sequence:
1. Daedalus → PRD slice and acceptance criteria
2. Chiron → Architecture and Server/Client boundaries
3. Hephaestus → UI/UX spec and accessibility requirements
4. Talos → Implementation (receives Chiron + Hephaestus)
5. Cassandra → Test plan against Daedalus acceptance criteria
6. Argus → Security review — GATE. BLOCKERs return to Talos.
7. Polyhymnia → Docs for what shipped

Deliver a Web Ship Brief: files touched, acceptance criteria status, security status, and remaining risks.
```
