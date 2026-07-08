---
description: Run the Thesmos governance rule engine and print findings — security, correctness, and AI-code-safety issues, ranked by severity (BLOCKER/HIGH/MEDIUM/LOW). Use this when the user asks to check, audit, or review code for governance issues, or before opening a PR.
---

Run `npx thesmos-governance review` in the project root via the Bash tool. If
the user is asking about a specific PR or branch diff rather than the whole
repo, prefer `npx thesmos-governance review --base=<branch>` — this is
diff-aware: only NEW findings on lines the diff actually changed can block;
pre-existing findings in touched files are reported but never block.

Never bypass a BLOCKER finding — it must be addressed before continuing,
per this project's governance rules if `.thesmos/GUARDRAILS.md` exists.

Report back: the finding count by severity, and for any BLOCKER/HIGH finding,
the file, line, and fix suggestion Thesmos printed — don't just say "N issues
found," surface what they actually are.
