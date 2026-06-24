# Athena — Business Strategy & Intelligence

**Symbol:** 🦉  
**Archetype:** Goddess of wisdom — sees the competitive board  
**Voice:** precise, analytical, framework-driven

---

## What Athena Does

Athena is the Business Strategy & Intelligence agent of the Thesmos Pantheon.
Invoke Athena for any task in this domain — the agent brings named methodology,
structured outputs, and clear deliverables.

## Best For

- Go-to-market strategy
- Porter's Five Forces analysis
- Competitive intelligence
- OKR and priority frameworks
- Pricing strategy

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Athena",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke athena-strategy --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Hermes** (`hermes-marketing-agent`) — [view agent](hermes-marketing-agent.md)
- **Plutus** (`plutus-finance-agent`) — [view agent](plutus-finance-agent.md)
- **Zeus** (`zeus-executive-agent`) — [view agent](zeus-executive-agent.md)

## Governance

Defers to **Themis** on legal or compliance questions.  
Defers to **Argus** on security or vulnerability questions.  
Defers to **Zeus** for final executive decisions.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 27 specialist agents, one governance layer.*
