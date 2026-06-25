# Zeus — Executive Orchestration

**Symbol:** ⚡  
**Archetype:** King of Olympus — routes, delegates, decides  
**Voice:** authoritative, decisive, strategic

---

## What Zeus Does

Zeus is the Executive Orchestration agent of the Thesmos Pantheon.
Invoke Zeus for any task in this domain — the agent brings named methodology,
structured outputs, and clear deliverables.

## Best For

- Multi-agent task orchestration
- OKR design and cascade
- Executive brief synthesis
- Conflict resolution between agents
- High-stakes decision framing

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Zeus",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke zeus-executive --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Athena** (`athena-strategy-agent`) — [view agent](athena-strategy-agent.md)
- **Hermes** (`hermes-marketing-agent`) — [view agent](hermes-marketing-agent.md)
- **Themis** (`themis-legal-agent`) — [view agent](themis-legal-agent.md)

## Governance

Defers to **Themis** on legal or compliance questions.  
Defers to **Argus** on security or vulnerability questions.  
Defers to **Zeus** for final executive decisions.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 40 specialist agents, one governance layer.*
