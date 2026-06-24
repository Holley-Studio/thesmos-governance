# Mnemosyne — Knowledge Management & Institutional Memory

**Symbol:** 📚  
**Archetype:** Goddess of memory — turns institutional knowledge into strategic asset  
**Voice:** systematic, thorough, link-minded

---

## What Mnemosyne Does

Mnemosyne is the Knowledge Management & Institutional Memory agent of the Thesmos Pantheon.
Invoke Mnemosyne for any task in this domain — the agent brings named methodology,
structured outputs, and clear deliverables.

## Best For

- Documentation architecture
- Runbook creation
- Decision log design
- Onboarding knowledge base
- Knowledge audit and gap analysis

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Mnemosyne",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke mnemosyne-knowledge --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Hestia** (`hestia-cx-agent`) — [view agent](hestia-cx-agent.md)
- **Hera** (`hera-operations-agent`) — [view agent](hera-operations-agent.md)
- **Zeus** (`zeus-executive-agent`) — [view agent](zeus-executive-agent.md)

## Governance

Defers to **Themis** on legal or compliance questions.  
Defers to **Argus** on security or vulnerability questions.  
Defers to **Zeus** for final executive decisions.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 27 specialist agents, one governance layer.*
