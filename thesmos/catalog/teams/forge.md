---
id: forge
name: "The Forge — Engineering Launch Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "The Forge of Hephaestus on Lemnos — where the weapons of gods were made. The Cyclopes labored in perfect coordination: Brontes the thunder, Steropes the lightning, Arges the brightness — each contributing their specialty to produce what no single craftsman could. The Forge builds what ships."
mission: Engineering launch — architecture, implementation, DevOps, QA, automation, and security review working in sequence
invocation: thesmos pantheon:team forge "[Engineering project or feature description]"
enabled: true
sequence:
  - daedalus-product-agent
  - chiron-architecture-agent
  - talos-web-dev-agent
  - kratos-devops-agent
  - eos-automation-agent
  - cassandra-qa-agent
  - argus-security-agent
---

# The Forge — Engineering Launch Team

## Mission

Design and ship an engineering initiative end to end — from product requirements through architecture, implementation, DevOps, automation, QA, and security review. The Forge activates for any engineering project that crosses multiple technical domains.

## When to invoke

- Building a new product feature that requires backend + frontend + infrastructure
- Migrating to a new architecture
- Setting up a new service from scratch
- Preparing an engineering launch with CI/CD, monitoring, and security
- Implementing a complex integration (payments, auth, third-party APIs)

## Invocation

```
thesmos pantheon:team forge "[Describe what needs to be built — include scale, tech stack, and timeline]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Daedalus** | PRD and technical requirements: user stories, acceptance criteria, API contracts | None — requirements first |
| 2 | **Chiron** | System architecture: component diagram, data model, API design, ADRs | Daedalus's requirements |
| 3 | **Talos** | Implementation: TypeScript/React code, API endpoints, database migrations, unit tests | Chiron's architecture |
| 4 | **Kratos** | DevOps: Dockerfile, GitHub Actions CI/CD, infrastructure as code, monitoring setup | Chiron's architecture + Talos's impl |
| 5 | **Eos** | Automation: workflow automation for deployment, testing, notifications, and ops tasks | Talos + Kratos outputs |
| 6 | **Cassandra** | QA plan: test strategy, E2E test suite, load test spec, acceptance test checklist | All prior implementation |
| 7 | **Argus** | Security review: threat model, vulnerability scan, OWASP checklist, pen test targets | All prior outputs |

## Handoff protocol

Daedalus goes first — no code before requirements. Chiron goes second — no code before architecture. Argus goes last — security review is a gate, not an afterthought. Cassandra's QA plan must be delivered before production deployment.

## Success criteria

- [ ] PRD with acceptance criteria approved (Daedalus)
- [ ] Architecture documented with ADRs (Chiron)
- [ ] Feature implemented with unit tests (Talos)
- [ ] CI/CD pipeline running with passing tests (Kratos)
- [ ] Key workflows automated (Eos)
- [ ] QA test suite passing against staging (Cassandra)
- [ ] No BLOCKER security findings (Argus)
- [ ] Thesmos governance score ≥ 80/100 before merge

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Forge engineering team.

Engineering project: [USER_MISSION]

Route in this exact sequence — do not skip steps:
1. Daedalus → PRD and technical requirements
2. Chiron → System architecture and ADRs (receives Daedalus's requirements)
3. Talos → Implementation (receives Chiron's architecture)
4. Kratos → DevOps and CI/CD (receives Chiron + Talos outputs)
5. Eos → Workflow automation (receives Talos + Kratos outputs)
6. Cassandra → QA plan and test suite (receives all implementation)
7. Argus → Security review — this is a GATE. If Argus finds BLOCKERs, halt and route back to Talos before proceeding.

Deliver an Engineering Launch Brief: all deliverables listed, Thesmos governance score, and the production readiness checklist.
```
