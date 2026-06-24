---
id: ai-prompt-review
name: AI Prompt Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - ai
  - prompts
  - llm
  - safety
enabled: true
---

# AI Prompt Review

## Purpose

Reviews LLM prompt definitions for safety, quality, and efficiency: injection vulnerabilities, hallucination-prone patterns, unclear output format constraints, and token efficiency.

## When to use

- When adding or modifying system prompts or prompt templates
- Before deploying an AI-powered feature to production
- AI safety reviews
- Prompt quality improvement sprints

## Required inputs

- System prompt files or inline prompt template strings
- Model configuration (model, temperature, max tokens)
- User input handling in prompt construction

## Workflow steps

1. Review each system prompt for injection vulnerabilities (user input in system role)
2. Check for output format constraints (structured JSON, specific patterns)
3. Identify hallucination-prone instructions ("always", "never", open-ended requests)
4. Review user content handling — is it clearly delimited from instructions?
5. Check temperature settings against the intended use case
6. Estimate token usage and suggest compression for long prompts

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A prompt quality assessment: injection risk score, hallucination risk indicators, output format completeness, delimiter quality, and estimated token usage with compression recommendations.

## Related agents

- prompt-engineering-reviewer
- ai-safety-reviewer

## Related rule packs

- @thesmos/core
