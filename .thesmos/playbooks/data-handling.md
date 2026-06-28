# Data Handling Playbook

## When to use
When adding features that collect, process, store, or transmit personal data or PHI.

## GDPR consent lifecycle

### Collecting consent
```typescript
// Record consent at collection time
await consentStore.record({
  userId,
  purpose: 'marketing_emails',
  lawfulBasis: 'consent',  // Art. 6(1)(a)
  timestamp: new Date().toISOString(),
  version: CONSENT_POLICY_VERSION,
});
```

### Revoking consent (Art. 7(3) — must be as easy as granting)
Expose a `POST /api/consent/revoke` endpoint:
```typescript
app.post('/api/consent/revoke', authenticate, async (req, res) => {
  await consentStore.revoke({ userId: req.session.userId, purpose: req.body.purpose });
  await scheduleDeletion(req.session.userId, req.body.purpose);
  res.json({ revoked: true });
});
```

### Data subject rights
| Right | Endpoint | GDPR Article |
|-------|----------|-------------|
| Access | `GET /api/me/data-export` | Art. 15 |
| Erasure | `DELETE /api/me` | Art. 17 |
| Portability | `GET /api/me/export` | Art. 20 |
| Rectification | `PATCH /api/me` | Art. 16 |

## PHI handling (HIPAA)

### Checklist before storing PHI
- [ ] Field-level encryption applied to all PHI columns in Prisma schema
- [ ] `@encrypted` annotation or application-layer cipher documented
- [ ] BAA signed with the database vendor and any LLM providers
- [ ] Audit log records every PHI access (user, timestamp, record ID, action)
- [ ] Session timeout ≤15 minutes for PHI access routes
- [ ] Minimum-necessary `select` clause — no `SELECT *` on PHI tables
- [ ] Backup plan documented in `.thesmos/backup-plan.md`

### Never do this with PHI
```typescript
// BAD — PHI to external LLM without BAA
const summary = await openai.chat({ messages: [{ role: 'user', content: patientRecord }] });

// GOOD — PHI anonymized before LLM, BAA in place
const anonymized = redactPhi(patientRecord);
const summary = await openai.chat({ messages: [{ role: 'user', content: anonymized }] });
// BAA documented: See compliance/baa/azure-openai-baa-2025.pdf
```

## Cross-border transfer checklist (GDPR Art. 44–49)

Before sending personal data to a non-EEA endpoint:
- [ ] Is the destination country on the EU adequacy list? (US — partial via DPF)
- [ ] SCCs (Standard Contractual Clauses) signed with the data importer?
- [ ] Transfer impact assessment completed?
- [ ] Document in `.thesmos/data-governance.md`

## Lawful basis declaration

Every data processing activity must declare a lawful basis. Add to `.thesmos/data-governance.md`:

| Processing activity | Lawful basis (Art. 6) | Retention |
|---------------------|----------------------|-----------|
| User authentication | Legitimate interest 6(1)(f) | Duration of account |
| Marketing emails | Consent 6(1)(a) | Until revoked |
| Payment processing | Contract 6(1)(b) | 7 years (tax law) |

## Verify data compliance

```bash
npx thesmos compliance --standard gdpr
npx thesmos compliance --standard hipaa
```
