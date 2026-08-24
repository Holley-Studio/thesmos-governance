# ADR: Thesmos Pro pricing — $79 one-time

**Date:** 2026-08-04
**Status:** Accepted (owner decision)
**Decider:** Holley Studio LLC (repository owner)
**Scope:** Repository truth only. **Does not change any external checkout.**

---

## Decision

`Thesmos Pro` is **$79 USD**, **one-time purchase**.

This is recorded as canonical repository truth and is the only price permitted
on public surfaces in this repository.

## Context

Phase 0 found **two live prices** on public surfaces:

| Price | Where |
|---|---|
| `$79` | `CHANGELOG.md`, `growth/SALES-STRATEGY.md` |
| `$24` | `website/index.html` (×8 CTAs), `website/pricing.html`, `catalog/free-agents.json` |

A product cannot have two prices. Phase 0 recorded price as `unverified` and
refused to invent one, because the authoritative commercial source (Gumroad) is
external and the brief forbids contacting third parties.

The owner has now supplied the decision: **$79 one-time**.

## Consequences

- All public repository surfaces now state `$79`. 58 `$24` occurrences were
  migrated.
- `claims-registry.json` records `CLM_PRO_PRICE` as **qualified**, with `$24`
  and `lifetime updates` as prohibited wording, enforced by `claims:lint`.
- The product-facts artifact carries `priceUsd: 79` with
  `priceStatus: owner_approved_repository_truth`.

## ⚠️ External launch blocker — NOT resolved by this ADR

**The Gumroad checkout still shows `$24`.** This repository cannot change it,
and this ADR does not claim it is aligned.

| | |
|---|---|
| Repository truth | `$79` one-time |
| External checkout (Gumroad) | `$24` — **observed conflicting price** |
| Status | `requires_alignment` |
| Blocking | **Any deployment of the website or public pricing copy** |

Shipping `$79` copy while checkout charges `$24` is a live pricing
inconsistency visible to customers. Alignment is a **manual, external action**
by the owner and must happen **before** any deploy.

## Explicitly not decided here

- **"Lifetime updates."** Prohibited wording until the commercial terms define
  exactly what updates a purchase includes. The current phrasing is
  "updates as described in the commercial terms."
- **Renewal semantics** beyond "one-time purchase".
- **Refund policy** — see `docs/legal/` requirement specs.
- Whether the paid pack sits under the repository LICENSE or a separate
  commercial agreement — see `LICENSE_REVIEW_REQUIRED.md` decision D6.

## References

- `docs/audits/PHASE_0_BRAND_LEGAL_BASELINE.md`
- `thesmos/catalog/claims-registry.json` → `CLM_PRO_PRICE`
