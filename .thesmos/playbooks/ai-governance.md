# AI Governance Playbook

## When to use
Before deploying any LLM integration, fine-tuning pipeline, or AI-driven decision feature.

## Steps

### 1. Create a model card
Create `.thesmos/model-card.md` documenting:
- Model name/version and provider
- Intended use and out-of-scope uses
- Performance metrics and evaluation results
- Known limitations and failure modes
- EU AI Act Art. 13 transparency disclosures (if applicable)

### 2. Classify risk tier
| Tier | Examples | Requirement |
|------|----------|-------------|
| PROHIBITED | Real-time biometric ID in public spaces | Do not build |
| HIGH-RISK | Credit scoring, hiring, medical diagnosis | Conformity assessment + DPIA |
| LIMITED | Chatbots, content generation | Transparency disclosure to users |
| MINIMAL | Spam filters, search ranking | No additional requirements |

### 3. Set up audit logging (HIGH-RISK only)
Every AI decision must produce an immutable audit record:
```typescript
await auditLog.append({
  timestamp: new Date().toISOString(),
  userId,
  modelId: 'claude-sonnet-4-6',
  inputHash: sha256(input),
  output: result,
  decisionType: 'credit_score',
});
```

### 4. Add human-in-the-loop gate (HIGH-RISK only)
```typescript
const aiResult = await llm.complete(prompt);
if (isHighRiskDecision(aiResult)) {
  await humanReviewQueue.enqueue({ aiResult, userId });
  return { status: 'pending_review' };
}
```

### 5. Run governance checks
```bash
npm run thesmos:scan
npx thesmos compliance --standard eu-ai-act
npx thesmos compliance --standard nist-ai-rmf
```

### 6. Remediation checklist
- [ ] model-card.md exists in `.thesmos/`
- [ ] High-risk decisions have audit logging
- [ ] Human review gate implemented for HIGH-RISK tier
- [ ] Content moderation on all user-facing AI outputs
- [ ] Rate limiting on all AI endpoints
- [ ] PII not sent to external LLMs without DPA/BAA
