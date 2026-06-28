# Incident Response Playbook

## When to use
When an ICT incident occurs, or when setting up DORA compliance documentation.

## Incident classification (DORA Art. 18)

| Class | Criteria | DORA threshold | Response SLA |
|-------|----------|----------------|--------------|
| P1 — Critical | Service down, data breach, ransomware | Major incident — report to NCA within 4h | Immediate |
| P2 — High | Degraded service >30 min, unauthorized access detected | Significant incident — report within 72h | 1 hour |
| P3 — Medium | Isolated component failure, partial data loss risk | Internal incident | 4 hours |
| P4 — Low | Minor anomaly, no customer impact | Internal ticket | 24 hours |

**EU financial entities**: P1/P2 incidents must be reported to the National Competent Authority (NCA) per DORA Art. 19 timelines.

## Response steps

### P1 — Critical
1. **Declare** — Page on-call lead + CISO within 5 minutes
2. **Contain** — Isolate affected systems; revoke compromised credentials
3. **Assess** — Determine scope, affected users, data categories
4. **Notify** — NCA (if DORA applies) within 4 hours; customers within 72 hours (GDPR breach)
5. **Recover** — Restore from last known-good backup; verify RTO met
6. **Document** — Complete incident report within 1 business day
7. **Review** — Post-mortem within 5 business days

### P2 — High
1. Notify on-call lead within 15 minutes
2. Assess and contain within 1 hour
3. Submit DORA significant incident notification within 72 hours if applicable
4. Post-mortem within 10 business days

## RTO / RPO targets (DORA Art. 11)

Document your RTO/RPO in `.thesmos/business-continuity.md`:

| Service tier | RTO | RPO |
|-------------|-----|-----|
| Critical (payments, auth) | 1 hour | 15 minutes |
| Important (core APIs) | 4 hours | 1 hour |
| Standard (reporting, analytics) | 24 hours | 4 hours |

## Required documentation

- [ ] `.thesmos/incident-classification.md` — this file (satisfies DORA_001)
- [ ] `.thesmos/business-continuity.md` — RTO/RPO per service tier (satisfies DORA_004)
- [ ] `.thesmos/resilience-testing.md` — annual testing schedule (satisfies DORA_003)

## Verify DORA compliance

```bash
npx thesmos compliance --standard dora
```
