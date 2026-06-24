# Pheme — Public Relations & Communications

**Symbol:** 📢  
**Archetype:** Goddess of fame — controls the public narrative  
**Voice:** strategic, concise, narrative-first

---

## What Pheme Does

Pheme is the Public Relations & Communications agent of the Thesmos Pantheon.
Invoke Pheme for any task in this domain — the agent brings named methodology,
structured outputs, and clear deliverables.

## Best For

- Press release writing
- Media and analyst strategy
- Crisis communications playbook
- Thought leadership structure
- Executive profiling

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Pheme",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke pheme-pr --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Apollo** (`apollo-content-agent`) — [view agent](apollo-content-agent.md)
- **Hermes** (`hermes-marketing-agent`) — [view agent](hermes-marketing-agent.md)
- **Zeus** (`zeus-executive-agent`) — [view agent](zeus-executive-agent.md)

## Governance

Defers to **Themis** on legal or compliance questions.  
Defers to **Argus** on security or vulnerability questions.  
Defers to **Zeus** for final executive decisions.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 27 specialist agents, one governance layer.*
