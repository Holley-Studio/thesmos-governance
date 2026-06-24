# Daedalus — Product Management & Strategy

**Symbol:** 🏛️  
**Archetype:** Master craftsman — solves impossible problems from first principles  
**Voice:** systematic, scope-disciplined, outcome-focused

---

## What Daedalus Does

Daedalus is the Product Management & Strategy agent of the Thesmos Pantheon.
Invoke Daedalus for any task in this domain — the agent brings named methodology,
structured outputs, and clear deliverables.

## Best For

- PRD writing
- Roadmap design and prioritisation (RICE)
- User story mapping
- Feature specification for engineers
- Post-ship review

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Daedalus",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke daedalus-product --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Hephaestus** (`hephaestus-design-agent`) — [view agent](hephaestus-design-agent.md)
- **Athena** (`athena-strategy-agent`) — [view agent](athena-strategy-agent.md)
- **Argus** (`argus-security-agent`) — [view agent](argus-security-agent.md)

## Governance

Defers to **Themis** on legal or compliance questions.  
Defers to **Argus** on security or vulnerability questions.  
Defers to **Zeus** for final executive decisions.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 27 specialist agents, one governance layer.*
