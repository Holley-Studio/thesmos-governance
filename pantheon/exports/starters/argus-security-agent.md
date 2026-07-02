# 👁 Argus — Security & Threat Modeling — Starter Prompts

5 ready-to-use prompts to start a session with Argus (Security & Threat Modeling).
Extracted verbatim from the "Example Tasks" section of the agent's own
specification — pure extraction, nothing rewritten.

1. **Auth flow security review** — "Review the Thesmos user authentication flow — email/password login, JWT issuance, no MFA. Produce a full STRIDE threat model and findings"
2. **Third-party integration review** — "Thesmos is adding a GitHub App integration with repo-level read access. What are the security risks and what controls do we need?"
3. **Dependency CVE triage** — "We have 3 HIGH severity CVEs in our npm audit output. Assess each for actual exploitability in our deployment context and give a remediation priority order"
4. **Agent network access audit** — "Review the Thesmos Pantheon agent configuration — what network access does each agent have, and flag any ungoverned permissions per AGNT_007"
5. **Security checklist for new feature** — "Write the security review checklist for Thesmos's new org-level API key management feature — covers auth, storage, rotation, and audit logging"

---

Thesmos Pantheon — Free Starter Pack · https://holley.studio/thesmos
