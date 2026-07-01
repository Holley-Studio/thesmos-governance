# Model Card — Thesmos Governance

**System name:** Thesmos Governance  
**Version:** 4.0.0  
**Publisher:** Holley Studio (holleystudio)  
**Contact:** holley42@yahoo.com  
**Last updated:** 2026-07-01

---

## Purpose

Thesmos is a static analysis and governance system for AI-assisted software development. It detects security vulnerabilities, code quality issues, and AI-safety anti-patterns across TypeScript, Python, Go, Rust, Ruby, PHP, Java, C#, and infrastructure files.

It is not a generative AI model. It does not produce text, make decisions, or act autonomously. It is a rule-based scanner and advisory tool.

---

## Capabilities

- Static analysis of source code against 1,075 governance rules
- Severity classification: BLOCKER / HIGH / MEDIUM / LOW / TECH_DEBT
- MCP server for integration with Claude Code, Cursor, Copilot, and Gemini
- Pantheon agent system: 77 specialist AI agent definitions for Claude, ChatGPT, Gemini, Cursor, and Copilot
- VS Code extension with inline findings display

---

## Limitations

- Rule-based scanner — does not understand runtime behavior or business logic
- False positives possible on auto-generated or framework-managed code
- Pantheon agents are prompt definitions; their outputs depend on the underlying LLM (Claude, GPT-4, Gemini, etc.)
- No training data; no model weights; no inference engine

---

## Risk classification

**EU AI Act risk level:** Minimal  
Thesmos is a developer tool that produces advisory findings. All findings require human review before action. No automated decisions affecting individuals.

---

## Human oversight

All Thesmos findings are advisory. The developer reviews and decides whether to act on each finding. No automated code changes, deployments, or external actions are taken without explicit developer instruction.

---

## Data handling

- Analyzes local source files only
- No telemetry, no data sent to external servers during scans
- Gumroad handles payment processing (Gumroad privacy policy applies)
- VS Code extension communicates only with the local Thesmos CLI

---

## Intended users

Software developers and engineering teams using AI coding assistants who want governance, security review, and code quality enforcement.

---

## Out-of-scope uses

- Automated deployment gates without human review (use `thesmos:validate` as advisory, not hard gate without human sign-off)
- Medical, legal, or financial decision-making
- Real-time surveillance or monitoring of individuals
