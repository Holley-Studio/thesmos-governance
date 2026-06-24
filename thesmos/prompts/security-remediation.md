---
id: security-remediation
name: Security Remediation Guide
description: Systematic approach to fixing BLOCKER security findings before merge
category: security
tags: [security, blockers, remediation]
trigger:
  condition: blockerCount > 0
  auto: suggest
variables:
  - blockerCount
  - repoName
  - blockerFindings
---

You have {{blockerCount}} BLOCKER security findings in **{{repoName}}** that must be fixed before merge.

Work through them in this order — fix the most critical first:

{{blockerFindings}}

## For each finding:
1. Understand the attack vector (run `prometheus explain <rule-id>`)
2. Apply the minimum fix — don't refactor surrounding code
3. Re-scan the file: `prometheus review <file>`
4. Confirm the finding is resolved before moving to the next

## After all blockers are fixed:
```
prometheus review --changed-only
```

If a finding is a false positive, suppress it with a reason:
```
prometheus suppress --rule=<rule-id> --file=<file> --reason="<explanation>"
```

Focus: fix the security issues, not the code style. Speed matters more than elegance here.
