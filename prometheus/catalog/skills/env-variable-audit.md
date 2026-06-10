---
id: env-variable-audit
name: Environment Variable Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - env
  - security
  - config
  - documentation
enabled: true
---

# Environment Variable Audit

## Purpose

Audits environment variable usage: undocumented variables, variables accessible client-side that should be server-only, direct `process.env` access vs. validated config, and missing examples in `.env.example`.

## When to use

- Before deploying to a new environment
- When a missing env var causes a production error
- Security reviews of credential handling
- Onboarding documentation reviews

## Required inputs

- All source files referencing `process.env`
- `.env.example` for documentation reference
- Prometheus config for allow-listed access patterns

## Workflow steps

1. Run `npm run prometheus:review` to find all `[ENV_001]` findings
2. List all `process.env.X` references across the codebase
3. Cross-check against `.env.example` for documentation completeness
4. Identify `NEXT_PUBLIC_` variables — verify they contain no secrets
5. Identify server-only variables referenced in client components
6. Produce a remediation plan: replace direct access with validated config

## Prometheus commands

```bash
npm run prometheus:review
```

## Expected output

An env variable audit: all variables in use, their documentation status in `.env.example`, access pattern (server-only / public / direct), and a migration plan to replace direct access with validated environment config.

## Related agents

- devops-reviewer
- security-reviewer

## Related rule packs

- @prometheus/core
