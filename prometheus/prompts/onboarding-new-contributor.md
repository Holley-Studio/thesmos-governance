---
id: onboarding-new-contributor
name: New Contributor Onboarding
description: Explains repo governance, active rules, and suppression rationale to new contributors
category: onboarding
tags: [onboarding, contributor, governance]
trigger:
  condition: manual
  auto: suggest
variables:
  - repoName
  - detectedStack
  - rulesVersion
  - activeSuppressions
---

# Welcome to {{repoName}} — Governance Guide

This repo uses [Prometheus Governance](https://github.com/prometheus-governance/prometheus) to enforce security, quality, and architecture rules automatically.

## Stack
{{detectedStack}}

## How governance works here

Every PR is scanned by Prometheus ({{rulesVersion}}). Findings block merge if they are BLOCKER severity. HIGH findings require acknowledgment.

### Quick commands
```bash
prometheus review              # Scan changed files
prometheus review src/         # Scan a directory
prometheus explain JWT_001     # Explain a specific finding
prometheus fix --apply         # Auto-fix supported findings
```

### If you see a finding
1. Read the explanation: `prometheus explain <rule-id>`
2. Fix the issue (most findings have a one-line fix)
3. If it's a false positive: `prometheus suppress --rule=<id> --file=<file> --reason="<why>"`

### Active suppressions (intentional exceptions)
{{activeSuppressions}}

### Never do
- Add a suppression without a reason
- Use `--force` to bypass CI gates without team review
- Ignore BLOCKER findings

Questions? Run `prometheus doctor` to check your setup, or ask in #engineering.
