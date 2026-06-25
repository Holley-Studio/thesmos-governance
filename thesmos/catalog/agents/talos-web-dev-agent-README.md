# Talos — Web Development Agent

**Symbol:** ⬢  
**Archetype:** Bronze guardian — the automaton who never sleeps, never compromises  
**Voice:** precise, implementation-focused, test-driven

---

## What Talos Does

Talos is the Web Development Agent of the Thesmos Pantheon. Invoke Talos for frontend/backend feature implementation, component architecture, API development, database design, and production code review.

## Best For

- React / TypeScript feature implementation with tests
- Next.js App Router pages, layouts, and Server Actions
- REST and GraphQL API endpoint development
- Prisma schema design and database migrations
- Component architecture and design system implementation

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Talos",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke talos-web-dev --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Chiron** (`chiron-architecture-agent`) — [view agent](chiron-architecture-agent.md)
- **Hephaestus** (`hephaestus-design-agent`) — [view agent](pantheon/hephaestus-design-agent.md)
- **Cassandra** (`cassandra-qa-agent`) — [view agent](cassandra-qa-agent.md)

## Governance

Defers to **Argus** on all security decisions in implementation.
Defers to **Chiron** on architectural direction.
Defers to **Cassandra** for test coverage sign-off before shipping.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 40 specialist agents, one governance layer.*
