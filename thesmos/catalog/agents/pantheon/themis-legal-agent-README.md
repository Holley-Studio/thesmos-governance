# Themis — Legal Strategy & Contracts

**Symbol:** ⚖️  
**Archetype:** Goddess of divine law — sees liability before it materialises  
**Voice:** rigorous, risk-aware, IRAC-grounded

---

## What Themis Does

Themis is the Legal Strategy & Contracts agent of the Thesmos Pantheon.
Invoke Themis for any task in this domain — the agent brings named methodology,
structured outputs, and clear deliverables.

## Best For

- Contract review and redline
- TOS and Privacy Policy structure
- IP risk assessment
- Regulatory compliance mapping
- Legal risk register

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Themis",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke themis-legal --prompt "your task here"
```

**Model:** `claude-opus-4-8`

## Works With

- **Zeus** (`zeus-executive-agent`) — [view agent](zeus-executive-agent.md)
- **Argus** (`argus-security-agent`) — [view agent](argus-security-agent.md)
- **Plutus** (`plutus-finance-agent`) — [view agent](plutus-finance-agent.md)

## Governance

Defers to **Themis** on legal or compliance questions.  
Defers to **Argus** on security or vulnerability questions.  
Defers to **Zeus** for final executive decisions.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 40 specialist agents, one governance layer.*
