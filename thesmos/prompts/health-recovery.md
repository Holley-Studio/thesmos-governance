---
id: health-recovery
name: Health Recovery Plan
description: Produces a prioritized action plan to recover a low health score
category: health
tags: [health, remediation, planning]
trigger:
  condition: healthScore < 60
  auto: suggest
variables:
  - healthScore
  - healthGrade
  - repoName
  - blockerCount
  - highCount
  - allFindings
---

**{{repoName}}** health score: **{{healthScore}}/{{healthGrade}}**

This score is below the acceptable threshold. Here is a prioritized recovery plan:

## Phase 1 — Blockers ({{blockerCount}} findings)
Fix all BLOCKER findings first. These represent critical security or reliability issues.
```
thesmos review --severity=BLOCKER
```

## Phase 2 — High severity ({{highCount}} findings)  
After blockers are clear, address HIGH severity findings.
```
thesmos review --severity=HIGH
```

## Phase 3 — Suppression audit
Review findings that have been suppressed — some may be outdated:
```
thesmos suppressions:audit
```

## Tracking progress
```
thesmos health                     # Current score
thesmos health --trend             # Score over time
```

**Target:** Score ≥ 80 (grade B) before next release.

Each BLOCKER fixed adds ~20 points. Each HIGH adds ~10 points.
