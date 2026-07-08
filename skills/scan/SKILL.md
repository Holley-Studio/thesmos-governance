---
description: Analyse the repo's structure (routes, API auth gaps, large files, boundary risks) into .thesmos/report.json — run before a review on a repo that hasn't been scanned yet, or when the report looks stale.
---

Run `npx thesmos-governance scan` in the project root via the Bash tool.

This writes `.thesmos/report.json` — a structural snapshot (pages, API routes,
large files, client/server boundary risks) that `review`/`validate`/`ci` and
the MCP server's repo-intelligence tools read from. It does not itself report
governance findings — for that, run the `review` skill after scanning.

Report back: whether the scan succeeded, and a one-line summary of what
`.thesmos/report.json` now contains (route count, large-file count, any
boundary risks flagged).
