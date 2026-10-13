# Pantheon ↔ Holley Studio portal handoff

Status: Pantheon side implemented in desktop 0.2.1. Portal side not built yet; this is the contract for it.

## Why files and not an API

The portal's approved Cloudflare plan gives the private workflow service no public route, no generic endpoint and no machine caller: every private read and write needs a fresh human session and authoritative membership. Pantheon's own rule is that it sends nothing by itself. So the link is two small JSON documents that a person carries between the two systems. This needs no credentials, no network path and no change to either trust boundary.

A network transport can replace the carrying later without changing either document. It would need a new, separately approved machine-facing entry point in the portal, authenticated per installation, and it is out of scope here.

| Direction | Document | Carried how |
|---|---|---|
| Portal → Pantheon | `holley.portal.request/1` | Portal offers an accepted request as a download; in Pantheon, Connections → Holley Studio portal → Import a portal request |
| Pantheon → portal | `holley.portal.package/1` | Written as `portal-package.json` in every Pantheon export packet; uploaded in the portal when preparing work |

Pantheon also has an "Open the portal" button. Its destination is fixed in the native shell at `https://portal.holley.studio/portal`.

## `holley.portal.request/1` — an accepted client request

Emit only for a request revision that has been accepted in the portal.

```json
{
  "schema": "holley.portal.request/1",
  "requestId": "REQ-2026-0042",
  "revision": 2,
  "client": "Otter House Wellness",
  "project": "Website",
  "title": "Refresh the services page",
  "scope": "Rewrite the three service descriptions.\nKeep the booking link.",
  "acceptanceCriteria": ["Three services described", "Booking link works"],
  "requestedDate": "2026-11-03",
  "exportedAt": "2026-10-13T19:00:00Z"
}
```

| Field | Rule |
|---|---|
| `schema` | Exactly `holley.portal.request/1` |
| `requestId` | 6–80 characters from `A–Z a–z 0–9 _ -` |
| `revision` | Integer 1–9999 |
| `client`, `project` | 1–120 characters, single line |
| `title` | 1–200 characters, single line |
| `scope` | 1–4000 characters; newlines and tabs allowed |
| `acceptanceCriteria` | 1–20 strings, each 1–500 characters, single line |
| `requestedDate` | Optional, a real calendar date as `YYYY-MM-DD` |
| `exportedAt` | Optional, up to 40 characters |

The file must be UTF-8 JSON of at most 64 KB. No other fields are allowed: Pantheon refuses a request with any key it does not recognise, and any control character outside the newlines and tabs allowed in `scope`.

What Pantheon does with it:

- Creates one **planned** job on the workboard in the open project, with the playbook the user chose. Nothing is started.
- The job ID is derived from request ID, revision, project and playbook, so importing the same file twice returns the same job. A new revision creates a new job; it never rewrites the old one.
- The brief labels the request text as the client's words, not studio instructions. Workers that draft from it have no tools, and a human reviews every deliverable.
- `requestedDate` is written into the brief as "not an agreed date" and is never set as the job's due date.
- The job remembers `{ requestId, revision }` and repeats it in the package it later exports.

Not included, on purpose: client identities or email addresses, attachments, internal staff notes, priorities and grants.

## `holley.portal.package/1` — a reviewed deliverable

Written beside the deliverable in `<data dir>\exports\<job id>\<artifact id>\`.

```json
{
  "schema": "holley.portal.package/1",
  "producer": { "app": "Pantheon", "version": "0.2.1" },
  "createdAt": "2026-10-13T19:30:00.000Z",
  "project": { "name": "otter-house-wellness" },
  "portalRequest": { "requestId": "REQ-2026-0042", "revision": 2 },
  "work": { "jobId": "portal-…", "title": "Content & campaign brief", "playbookId": "content-brief", "owner": "…", "reviewer": "…", "brief": "…" },
  "internalReview": { "state": "accepted", "note": "…", "updatedAt": "…" },
  "artifact": { "id": "…", "title": "…", "sha256": "…", "createdAt": "…", "worker": "claude", "model": "…" },
  "qualityChecks": [{ "name": "Source evidence present", "passed": true }],
  "files": [
    { "name": "deliverable.md", "sha256": "…", "bytes": 4312 },
    { "name": "deliverable.html", "sha256": "…", "bytes": 6120 },
    { "name": "evidence.json", "sha256": "…", "bytes": 20114 }
  ],
  "limits": "Internal Holley Studio review only. …"
}
```

- `portalRequest` is `null` for work that did not start from a portal request.
- `internalReview.state` is `accepted` only when the job was approved in Pantheon with a review note; otherwise `draft`. The portal should refuse to issue a `draft` package for client review.
- `files` lists every other file in the folder with its SHA-256 and byte length. `manifest.json` in the same folder also covers `portal-package.json` itself.

What the portal should do with it:

- Recompute each file's SHA-256 from the uploaded bytes and reject any mismatch. The package describes bytes; it does not vouch for them.
- If `portalRequest` is set, bind the package to that exact request revision. A package for an older revision must not satisfy a newer one.
- Treat it as **prepared work awaiting the portal's own internal review and issue step**. It is not client approval, execution or completion; those stay the portal's separate decisions against these exact hashes. Changed bytes mean a new package and new decisions.
- Never treat `producer`, `owner` or `reviewer` as authority. They are labels. Who may prepare and issue work is decided by the portal's own membership and grants for the signed-in person uploading it.

## Verification

`tests/portal.test.ts` covers strict parsing, the brief, idempotent import, revision handling, and that an exported package matches the exported files byte for byte. The native file picker and the "Open the portal" button are not covered by automated tests.
