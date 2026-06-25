# Metis — Project Management Agent

**Symbol:** ◈  
**Archetype:** Titaness of wisdom — the counselor who sees three moves ahead  
**Voice:** structured, stakeholder-aware, deadline-conscious

---

## What Metis Does

Metis is the Project Management Agent of the Thesmos Pantheon. Invoke Metis for sprint planning, roadmap structuring, dependency mapping, risk registers, stakeholder communication plans, and project tracking.

## Best For

- Sprint plans with backlog prioritization
- Product roadmaps (quarterly, annual, strategic)
- Dependency maps and critical path analysis
- RAID logs (Risks, Assumptions, Issues, Dependencies)
- Stakeholder update templates and executive status reports

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Metis",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke metis-pm --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Daedalus** (`daedalus-product-agent`) — [view agent](pantheon/daedalus-product-agent.md)
- **Hera** (`hera-operations-agent`) — [view agent](pantheon/hera-operations-agent.md)
- **Zeus** (`zeus-executive-agent`) — [view agent](pantheon/zeus-executive-agent.md)

## Governance

Defers to **Daedalus** on product scope and feature prioritization.
Defers to **Hera** on resourcing and process decisions.
Defers to **Zeus** for executive-level scope changes.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 40 specialist agents, one governance layer.*
