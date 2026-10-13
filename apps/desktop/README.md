# Pantheon desktop — internal business pilot

The business shell extends the existing Thesmos desktop runtime. It provides persistent assignments, evidence capture, bounded model execution, human review, export packets, and consistent SQLite backups. The original channel and provider modules remain available in core.

## Hermes Today

The Today view combines a bounded, read-only Gmail/primary-calendar snapshot with local project follow-ups. It is not a live Google OAuth client. The authorized Codex bridge follows `docs/hermes-bridge-instructions.md`, stages only metadata, and invokes the bundled `resources/refresh-brief.mjs` writer. The app polls the saved snapshot every minute; Reload does not fetch Google. Failed sources retain their prior verified data and do not advance their successful pull time. Sources older than 90 minutes are labeled stale.

This internal pilot is scoped to Matthew's Holley Studio account and this PC's paths. Monitor state records configuration and whether a scheduled run has succeeded; it cannot query the current Codex scheduler state. First scheduled execution must be verified separately. The cache is unencrypted and never automatically enters model context or registered knowledge. The bridge strips bodies/snippets/attachments/event descriptions/attendees/location/conference details, and all Google actions open fixed official account-specific URLs. It cannot send messages, RSVP or alter events.

`shared/brief.ts` validates the minimal DTO; `sidecar/studio/brief.ts` reads only the fixed bounded cache and rejects junctions; `scripts/refresh-brief.ts` merges independent source failures and writes atomically. The bridge requires Node 24, supplied on the pilot PC; the main runtime remains a sealed executable. Build staging includes the bridge writer and guide. `tests/brief.test.ts` covers redaction, links, bounds, stale/error recovery, all-day dates, overlaps and filesystem containment; native Google URL tests reject arbitrary destinations.

## Plutus Finance

Finance imports user-selected UTF-8 transaction CSVs through the webview's file picker. No filesystem-path read command or accounting credential is exposed to the webview. `shared/finance.ts` parses bounded CSV records and validates explicit column/date/sign/currency mapping; `sidecar/studio/finance.ts` persists normalized account snapshots with atomic replacement, one previous ledger and a content-free import audit. All financial arithmetic uses integer cents. Each currency and account stays separate. Figures are account movement, not profit, a cash balance or a reconciled accounting ledger.

An import requires a preview-bound confirmation. The binding includes the source hash, mapping, account, currency and current ledger revision. Invalid rows block saving; repeated IDs are invalid; repeated-looking rows without IDs require acknowledgement and remain included. Reimporting the same account/source/mapping is idempotent. A new export replaces that account's snapshot instead of appending an overlapping period. Header suggestions do not infer Debit/Credit or Net/Gross meanings. Known unposted statuses can be excluded when mapped; unfamiliar statuses and currencies require attention.

Limits: 1 MB / 10,000 source rows per CSV, 64 columns, 10 account snapshots, 20,000 saved rows and 12 MB saved data. USD/CAD/EUR/GBP/AUD/NZD/CHF use two decimal places; localized decimal commas, financial report subtotals, invoices, ZIP/PDF/XLSX and multi-currency conversions need separate adapters. Raw CSV and unused fields are not retained. Finance is studio-wide, local and unencrypted, and is never automatically passed to AI or Knowledge. It uses no model credits. Imports refresh explicitly; there is no folder watcher or live accounting feed.

Use Finance's local backup action for the normalized JSON ledger. The existing business SQLite backup does not include this separate finance ledger. Copy the finance snapshot to a separate protected backup; restore functionality and encrypted recovery remain broader release work. Original accounting exports remain unchanged. No real accounting CSV was found/imported during this feature's verification; UI and arithmetic checks use explicitly synthetic fixtures.

## Build and verify on Windows

Use Node 24 and the Tauri 2 Windows prerequisites, including Rust, WebView2, and Windows SDK signtool. From this folder:

```text
npm ci
npm run typecheck
npm test
npm audit --audit-level=low
npm run desktop:build -- --bundles nsis
```

Run the repository's governance validation from the repository root. Do not commit or replace unrelated preexisting changes.

The SEA build bundles core into a self-contained Node executable, removes the copied Node binary's signature before injection, and fails the build if sealing fails. Internal releases remain unsigned unless a business signing certificate is configured. Core's import.meta fallbacks produce known CommonJS bundling warnings; packaged catalog and runtime behavior must be tested explicitly.

## Ownership and boundaries

- `shared/studio.ts`: wire data only; no native or model imports in the frontend.
- `sidecar/studio/store.ts`: schema version, WAL transactions, idempotent creation, one active attempt, crash recovery, immutable artifact versions, review state, checksums, and consistent backup.
- `sidecar/studio/evidence.ts`: curated local website sources, bounded reads, canonical-path containment and source hashes. The OHW-specific demo checks are not a general live-site audit.
- `sidecar/studio/workers.ts`: official native subscription workers; prompts through stdin; inherited API billing overrides removed; bounded local requests reuse core's Ollama provider and governance.
- `sidecar/studio/service.ts`: explicit job orchestration and export packets. No automatic paid fallback, external actions, or inference after restart.
- `src-tauri/src`: narrow IPC allowlist, native project grants, official login launcher, process supervision, and single-instance ownership.
- `src/shell/StudioApp.tsx`, `src/features/StudioDialogs.tsx`, `src/design/studio.css`: business interface, accessible native dialogs, responsive layouts and semantic appearance tokens.

App data is resolved by Tauri under identifier `studio.holley.thesmos`. The installed Windows pilot uses `%LOCALAPPDATA%\studio.holley.thesmos`. Its database is not encrypted. It is not appropriate for patient information.

## Subscription policy

This is a local internal app using provider-managed official CLI login. App installation or desktop sign-in is not proof of inference entitlement. Model Ready state means login/service detection; successful use is established by a completed job. Gmail/Calendar Ready means a recently verified local briefing snapshot, not imported Google credentials. Subscription balance is not measured. Gemini, Grok, direct Google OAuth in Pantheon, other business connectors, distributed workers and actual Figma editing remain planned and explicitly labeled.

## Acceptance model

Every output is a draft until a human records a review note. Automated checks establish only their stated properties. Named reviewers are assigned responsibilities, not a claim that another model ran. Internal acceptance does not authorize publication, client delivery, purchases, or deployment.

The source directory is read only by business workflows. Exports include status, model/worker, evidence capture timestamps, original-source hashes, and checksums. New evidence-backed findings must be revalidated against the intended environment: the OHW demo repository and the current live website are distinct.

## Chat with the Gods

The council chamber keeps exploratory conversations separate from accepted workboard jobs. Choose a catalog god or the Zeus/Athena/Apollo council. Council responses are perspectives from one selected model, not independently verified reviews. Threads stay in the active project's local SQLite database and its normal backups. Older turns remain saved while a bounded recent conversation is sent to the model.

Local chat uses loopback Ollama, preferring Qwen 3.5 4B, with no cloud fallback or API charges. The optional official ChatGPT worker requires explicit cloud sharing and uses the existing Work/Codex plan allowance; it does not use the regular Chat allowance. Workers have no tools and run from an empty app-owned directory. No private knowledge files are attached automatically. Cancelled and failed turns remain visible, and interrupted turns never restart automatically.

ChatGPT Chat and Work cards prepare an editable prompt, then copy it and open the official ChatGPT website. Paste and select Chat or Work there; replies remain in ChatGPT. This release does not embed the ChatGPT interface, import browser credentials, or synchronize ChatGPT history. Current official documentation distinguishes [Chat and Work](https://learn.chatgpt.com/docs/get-started-with-work); [app plan usage](https://learn.chatgpt.com/docs/sign-in-with-chatgpt) shares the Work/Codex allowance and adds no new quota. Open-source/local [Sign in with ChatGPT integration](https://developers.openai.com/siwc/token-sharing-open-source) is a possible future route, requiring its own registration and consent. It does not provide unlimited regular Chat usage inside Pantheon.

## Remaining product work

Add representative task evaluation before widening autonomy; connect approved Drive/Figma resources; implement independent specialist review; add authenticated remote workers and signed updates; establish separate encrypted backup coverage and a restore drill. Do not cloud-sync the live SQLite database or credential stores. Full screen-reader testing and accessibility certification have not been completed.
