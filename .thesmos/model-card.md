# Thesmos Governance — Model Card

## System Overview

**Name:** Thesmos Governance Framework  
**Version:** 2.0.0  
**Type:** Static-analysis / code-review governance tool (not a regulated AI system)  
**Developer:** Holley Studios

## Intended Use

Thesmos is a developer tool that provides static code analysis, governance rule enforcement,
and AI-powered code review for software projects. It does **not** make autonomous decisions
affecting individuals — it produces advisory findings for human review.

## Capabilities

- Static analysis of source code against security, quality, and compliance rules
- Pull-request governance review with inline annotations
- Adapter generation for AI coding assistants (Claude, Gemini, Cursor, etc.)
- Agent catalog for Pantheon review agents

## Limitations

- Findings are advisory; human engineers make all final decisions
- Pattern-matching rules may produce false positives on obfuscated or generated code
- No training on user data; all analysis is deterministic rule evaluation

## Risk Classification

**EU AI Act:** This tool does not fall under Annex III high-risk AI systems. It is a
developer productivity tool with human oversight at every step.

**HIPAA:** This tool does not process Protected Health Information (PHI).

**DORA:** This tool is not a financial entity and is not subject to DORA obligations.

## Human Oversight

All Thesmos findings require human review before action. No automated enforcement
occurs without explicit CI configuration by the project owner.

## Contact

Holley Studios — <https://holley.studio>
