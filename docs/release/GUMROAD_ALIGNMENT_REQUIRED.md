# EXTERNAL LAUNCH BLOCKER — Gumroad checkout price alignment

**Status:** 🔴 **OPEN — BLOCKS DEPLOYMENT**
**Observed:** 2026-08-04
**Owner:** Holley Studio LLC
**Resolvable by:** Manual action outside this repository

---

## The conflict

| | Value | Source |
|---|---|---|
| **Repository truth** | **$79 USD, one-time** | `docs/adr/2026-08-04-thesmos-pro-pricing.md` (owner decision) · `thesmos/catalog/product-facts.json` → `products.pro.priceUsd` |
| **External checkout** | **$24 USD** | Gumroad product page (observed 2026-08-04) |

**Checkout URL:** `https://holleystudio.gumroad.com/l/thesmos-pantheon`

The repository now states `$79` on every public surface. The checkout still
charges `$24`. **These disagree.**

## Why this blocks deployment

Deploying the current website would show a customer `$79`, send them to a
checkout charging `$24`, and take a different amount than advertised. That is a
customer-visible pricing inconsistency regardless of which direction the gap
runs, and it is not something a code change can resolve.

**Do not deploy the website or any `$79` copy until this is closed.**

## Required manual action (owner)

1. Open the Gumroad product page for `thesmos-pantheon`.
2. Set the price to **$79 USD**, one-time.
3. Confirm the product is still a one-time purchase, not a subscription.
4. Confirm what the purchase includes, so the commercial terms can describe it
   accurately. **"Lifetime updates" remains prohibited wording** until those
   terms are defined — see `docs/legal/`.
5. Save and load the public product URL in a logged-out browser.

## Required verification evidence

Record all of the following before marking this closed:

- [ ] Date and time of the change.
- [ ] Screenshot of the Gumroad product settings showing `$79`.
- [ ] Screenshot of the **public, logged-out** product page showing `$79`.
- [ ] Confirmation the billing type is one-time.
- [ ] A test purchase or Gumroad preview confirming the charged amount.
- [ ] Name of the person who made the change.

A Gumroad admin screenshot alone is **not sufficient** — the public page is what
customers see, and caching can differ.

## Rollback plan

If the owner chooses a price other than `$79`:

1. **Do not** hand-edit prices across public files. They are lint-enforced.
2. Update `docs/adr/2026-08-04-thesmos-pro-pricing.md` with a new dated decision.
3. Update `products.pro.priceUsd` in the product-facts source.
4. Update `CLM_PRO_PRICE` in `thesmos/catalog/claims-registry.json`, moving the
   old price into `prohibitedWording`.
5. Re-run `product-facts:generate`, then `claims:lint` and
   `product-facts:lint`. Both must exit 0.
6. Update this document with the new target and re-open verification.

If Gumroad cannot be changed, the **repository** must move back to the
checkout's price by the same route. The two must agree; which one moves is a
business decision.

## Confirmation

**This pull request did not change Gumroad.** No external service was
contacted, modified, or configured. The repository records `$79` as internal
truth and records `externalCheckoutStatus: "requires_alignment"` in
`product-facts.json` precisely so that no reader mistakes repository truth for
a live, aligned checkout.

This blocker is **not resolved** by any commit in this branch.

## Related

- `docs/adr/2026-08-04-thesmos-pro-pricing.md`
- `docs/audits/PHASE_0_BRAND_LEGAL_BASELINE.md`
- `thesmos/catalog/claims-registry.json` → `CLM_PRO_PRICE`
