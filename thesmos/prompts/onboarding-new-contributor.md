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

This repo uses [Thesmos](https://github.com/thesmos-governance/thesmos) to enforce security, quality, and architecture rules automatically.

## Stack
{{detectedStack}}

## How governance works here

Every PR is scanned by Thesmos ({{rulesVersion}}). Findings block merge if they are BLOCKER severity. HIGH findings require acknowledgment.

### Quick commands
```bash
thesmos review              # Scan changed files
thesmos review src/         # Scan a directory
thesmos explain JWT_001     # Explain a specific finding
thesmos fix --apply         # Auto-fix supported findings
```

### If you see a finding
1. Read the explanation: `thesmos explain <rule-id>`
2. Fix the issue (most findings have a one-line fix)
3. If it's a false positive: `thesmos suppress --rule=<id> --file=<file> --reason="<why>"`

### Active suppressions (intentional exceptions)
{{activeSuppressions}}

### Never do
- Add a suppression without a reason
- Use `--force` to bypass CI gates without team review
- Ignore BLOCKER findings

Questions? Run `thesmos doctor` to check your setup, or ask in #engineering.
