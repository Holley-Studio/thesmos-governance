# DRAFT REQUIREMENTS — NOT OPERATIVE LEGAL TERMS — ATTORNEY REVIEW REQUIRED

**Subject:** License identifier does not match the shipped license text
**Date:** 2026-08-03
**Prepared by:** Phase 0 engineering remediation
**Status:** Documented, not resolved. **No license text was changed.**

> This document records a factual mismatch found in the repository. It is **not legal advice**,
> and it does **not** select a license on Holley Studio LLC's behalf. Every decision below
> requires counsel.

---

## 1. The mismatch

| | |
|---|---|
| **Declared SPDX identifier** | `FSL-1.1-MIT` — in `package.json` (root), `thesmos/package.json`, `extensions/vscode/package.json`, and `catalog/product-facts.json` |
| **Actual `LICENSE` text** | Modified Functional Source License with a **fixed four-year / 2030** conversion date |
| **Standard `FSL-1.1-MIT`** | Converts **each release on its second anniversary** ([SPDX](https://spdx.org/licenses/FSL-1.1-MIT.html)) |

The declared identifier and the shipped terms describe **different conversion mechanics**:

- **Standard FSL-1.1-MIT:** rolling, per-release, 2 years after each release date.
- **This repository:** a single fixed calendar date (2030) applied globally.

A consumer resolving the SPDX identifier — automated license scanners, procurement review,
dependency policy tooling — will read the *standard* terms, not the terms actually shipped.

## 2. Why this matters beyond tidiness

1. **Package metadata is a representation.** `"license": "FSL-1.1-MIT"` asserts a specific,
   published set of terms. Shipping different terms under that identifier is a factual
   inaccuracy in machine-readable metadata that downstream tooling relies on.
2. **Marketing repeats the identifier.** Public copy referencing "FSL" inherits the same
   inaccuracy.
3. **The direction of the difference is not neutral.** A fixed 2030 date is *more* restrictive
   than a rolling 2-year conversion for any release published after 2028, and *less* restrictive
   for releases published before 2028. Which is intended is a business decision.

## 3. Affected surfaces

| Surface | Current state | Phase 0 action |
|---|---|---|
| `LICENSE` | Modified FSL text, fixed 2030 | **Unchanged** — preserved verbatim for review |
| `package.json` (root) | `"license": "FSL-1.1-MIT"` | **Unchanged** — see §5 |
| `thesmos/package.json` | `"license": "FSL-1.1-MIT"` | **Unchanged** — see §5 |
| `extensions/vscode/package.json` | `"license": "FSL-1.1-MIT"` | **Unchanged** — see §5 |
| `catalog/product-facts.json` | `"license": "FSL-1.1-MIT"` (copied from package.json) | **Unchanged** — derived field |
| Public marketing copy | referred to the license by identifier | Use **"source-available; see LICENSE"** |

## 4. What Phase 0 did and did not do

**Did:**
- Preserved the `LICENSE` text byte-for-byte.
- Stopped describing the license as an unqualified standard FSL in public copy.
- Adopted **"source-available; see LICENSE"** as the public phrasing until reviewed.
- Added a packaging test asserting the published tarball actually contains the `LICENSE` file
  it references.

**Did not:**
- Rewrite, replace, or re-identify the license.
- Choose FSL, BSL, or a custom license.
- Change the SPDX identifier in any manifest. Changing it to `SEE LICENSE IN LICENSE` is
  *conditionally* correct (see §5) but is a legal representation, not an engineering cleanup.
- Describe any release as **open source**. Under either reading — fixed 2030 or rolling 2-year —
  the current release is **source-available**, not OSI open source, until conversion occurs.

## 5. Decisions required from counsel

| # | Decision | Notes |
|---|---|---|
| **D1** | Is the **fixed 2030 / four-year** conversion intended, or should it be the standard rolling 2-year? | Determines whether the text or the identifier is wrong. |
| **D2** | If the fixed date is intended, the SPDX identifier `FSL-1.1-MIT` is inaccurate. Replace with `SEE LICENSE IN LICENSE`, or a custom identifier? | Only apply `SEE LICENSE IN LICENSE` once the published package is confirmed to contain the LICENSE file (Phase 0 added the test; see §6). |
| **D3** | If the standard rolling terms are intended, the `LICENSE` text must be replaced with unmodified FSL-1.1-MIT. | Engineering change, legal decision. |
| **D4** | Approved public phrasing. Phase 0 uses "source-available; see LICENSE". | Confirm or replace. |
| **D5** | Do the VS Code extension and the npm package need **different** licenses? | They currently declare the same identifier but ship through different marketplaces with different terms of service. |
| **D6** | Does the paid agent pack sit under this license or a separate commercial agreement? | The pack is content-gated and sold separately; the repository license may not be the operative instrument. |
| **D7** | Confirm no release has been publicly described as "open source". | If any has, determine remediation. |

## 6. Packaging verification

Phase 0 added a test asserting the npm tarball produced by `npm pack` contains the `LICENSE`
file. This is a prerequisite for D2: `SEE LICENSE IN LICENSE` is only meaningful if the consumer
actually receives the referenced file.

Result at the time of writing is recorded in the Phase 0 verification table.

## 7. References

- SPDX, standard FSL-1.1-MIT: https://spdx.org/licenses/FSL-1.1-MIT.html
- Repository `LICENSE` (unmodified by Phase 0)
- Phase 0 baseline: `docs/audits/PHASE_0_BRAND_LEGAL_BASELINE.md`

---

**DRAFT REQUIREMENTS — NOT OPERATIVE LEGAL TERMS — ATTORNEY REVIEW REQUIRED**
