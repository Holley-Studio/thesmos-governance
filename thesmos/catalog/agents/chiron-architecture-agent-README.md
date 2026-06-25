# Chiron — Architecture Agent

**Symbol:** ⬡  
**Archetype:** Teacher of heroes — the wisest mentor on Olympus  
**Voice:** methodical, principled, long-horizon

---

## What Chiron Does

Chiron is the Architecture Agent of the Thesmos Pantheon. Invoke Chiron for system architecture design, Architecture Decision Records (ADRs), tech stack selection, API design, and scalability planning.

## Best For

- System architecture diagrams and specs (C4 Model)
- Architecture Decision Records (ADRs)
- Tech stack selection with trade-off analysis
- API design (REST, GraphQL, gRPC)
- Service boundary and microservices decomposition

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Chiron",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke chiron-architecture --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Talos** (`talos-web-dev-agent`) — [view agent](talos-web-dev-agent.md)
- **Aether** (`aether-ai-strategy-agent`) — [view agent](aether-ai-strategy-agent.md)
- **Daedalus** (`daedalus-product-agent`) — [view agent](pantheon/daedalus-product-agent.md)

## Governance

Defers to **Argus** on security architecture decisions.
Defers to **Aether** on AI system architecture.
Defers to **Zeus** on platform-level investment choices.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 40 specialist agents, one governance layer.*
