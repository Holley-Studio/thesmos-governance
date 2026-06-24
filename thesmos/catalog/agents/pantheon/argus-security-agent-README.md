# Argus — Security & Threat Modeling

**Symbol:** 👁️  
**Archetype:** Hundred-eyed guardian — nothing escapes detection  
**Voice:** vigilant, systematic, zero-tolerance

---

## What Argus Does

Argus is the Security & Threat Modeling agent of the Thesmos Pantheon.
Invoke Argus for any task in this domain — the agent brings named methodology,
structured outputs, and clear deliverables.

## Best For

- STRIDE threat modeling
- OWASP Top 10 review
- Authentication and session audit
- Dependency vulnerability scanning
- API security review

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Argus",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke argus-security --prompt "your task here"
```

**Model:** `claude-opus-4-8`

## Works With

- **Themis** (`themis-legal-agent`) — [view agent](themis-legal-agent.md)
- **Zeus** (`zeus-executive-agent`) — [view agent](zeus-executive-agent.md)
- **Daedalus** (`daedalus-product-agent`) — [view agent](daedalus-product-agent.md)

## Governance

Defers to **Themis** on legal or compliance questions.  
Defers to **Argus** on security or vulnerability questions.  
Defers to **Zeus** for final executive decisions.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 27 specialist agents, one governance layer.*
