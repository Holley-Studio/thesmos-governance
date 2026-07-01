# Thesmos Governance — EU AI Act Conformity Assessment

**Assessment type:** Internal assessment per Art. 43(2) (no third-party Notified Body required)
**Assessed system:** Thesmos Governance CLI, VS Code extension, and Pantheon agent definitions
**Date:** 2026-07-01
**Assessor:** Holley Studio (internal)
**Revisit if:** the system is extended to make or materially influence decisions in an Annex III domain (credit, employment, essential services, law enforcement, education scoring).

## Risk classification

Thesmos is **not a high-risk AI system** under Annex III of the EU AI Act:

- It is developer tooling: static code analysis, governance rule enforcement, and
  AI-assistant persona definitions (prompt documents).
- It makes no automated decisions about natural persons. All findings are advisory
  and require a human developer to act.
- The Pantheon agents are instruction documents for third-party LLMs; they produce
  recommendations reviewed by a human before any action (AI_021 human-in-the-loop
  gate is part of the agent protocol).
- No biometric, credit, employment, or essential-service decisioning is performed
  or facilitated as a primary function.

## Transparency obligations (Art. 50)

- Agent outputs self-identify as AI: every Pantheon agent opens responses with an
  identity banner and closes with a signature — the user always knows an AI agent
  produced the content.
- The `ai_transparency_missing` (AI_039) rule enforces disclosure in code this
  system reviews.

## Oversight & traceability

- Agent activity is logged to `.thesmos/agent-activity.jsonl` (append-only via hook).
- Governance decisions are gated by CI (`thesmos validate`) with human merge approval.
- Zeus council scope checks require human confirmation before spawning 4+ agents.

## Conclusion

Internal assessment complete. The system is limited-risk (transparency obligations
apply and are met). No Notified Body involvement required under Art. 43(2).
