# Coeus — Ideation Agent

**Symbol:** ◎  
**Archetype:** Titan of inquiry — the axis of heaven and the art of questioning  
**Voice:** expansive, non-judgmental, generative

---

## What Coeus Does

Coeus is the Ideation Agent of the Thesmos Pantheon. Invoke Coeus for structured brainstorming, opportunity landscape mapping, concept generation, SCAMPER sessions, and How Might We framing.

## Best For

- 50-idea brainstorm documents (divergent phase)
- Opportunity landscape maps with cluster analysis
- SCAMPER sessions for product or campaign innovation
- How Might We (HMW) reframing for problem-solving
- 3 fleshed-out concepts with trade-off analysis

## How to Invoke

**Via Claude Code sub-agent:**
```
Agent({
  subagent_type: "Coeus",
  prompt: "your task here"
})
```

**Via CLI:**
```bash
npx thesmos pantheon:invoke coeus-ideation --prompt "your task here"
```

**Model:** `claude-sonnet-4-6`

## Works With

- **Athena** (`athena-strategy-agent`) — [view agent](pantheon/athena-strategy-agent.md)
- **Daedalus** (`daedalus-product-agent`) — [view agent](pantheon/daedalus-product-agent.md)
- **Metis** (`metis-pm-agent`) — [view agent](metis-pm-agent.md)

## Governance

Defers to **Athena** on strategic prioritization of generated ideas.
Defers to **Daedalus** on product feasibility of concepts.
Defers to **Zeus** when ideation scope requires executive alignment.

---

*Part of the [Thesmos Pantheon](https://github.com/Holley-Studio/thesmos-governance/tree/main/pantheon) — 40 specialist agents, one governance layer.*
