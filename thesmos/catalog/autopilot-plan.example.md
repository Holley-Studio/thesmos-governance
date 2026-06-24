---
project: My Feature Build
adapter: claude
gates:
  - npm test
  - npm run typecheck
max_retries: 2
commit_on_pass: true
---

# Autopilot Plan — My Feature Build

This file is a MASTER_PLAN.md template. Copy it, rename it, and fill in your own tasks.
Delete this line and the block above the first `## Task` once you're ready.

---

## Task 1: Create the data model

Context: We need a TypeScript interface and Zod schema for the Widget entity before
  any other code can be written. No UI yet — just the shape and validation.
Scope: src/types/widget.ts, src/schemas/widget.ts, src/schemas/widget.test.ts
New packages allowed: zod
Depends on: none
Done when:
  - file:src/types/widget.ts
  - file:src/schemas/widget.ts
  - file:src/schemas/widget.test.ts
  - grep:src/types/widget.ts:export interface Widget
  - command:npm test -- src/schemas/widget.test.ts

---CHECKPOINT---

## Task 2: Implement the repository layer

Context: Add a WidgetRepository class that wraps the DB client. Use the Widget type
  from Task 1. Tests should mock the DB client, not hit a real database.
Scope: src/repositories/widget-repository.ts, src/repositories/widget-repository.test.ts
Depends on: 1
Done when:
  - file:src/repositories/widget-repository.ts
  - file:src/repositories/widget-repository.test.ts
  - grep:src/repositories/widget-repository.ts:export class WidgetRepository
  - command:npm test -- src/repositories/widget-repository.test.ts

## Task 3: Add the API route

Context: Expose GET /widgets and POST /widgets endpoints. Use the repository from Task 2.
  Return 400 with Zod validation errors on bad input.
Scope: src/routes/widgets.ts, src/routes/widgets.test.ts
Depends on: 1, 2
Done when:
  - file:src/routes/widgets.ts
  - grep:src/routes/widgets.ts:router.get
  - grep:src/routes/widgets.ts:router.post
  - command:npm test -- src/routes/widgets.test.ts
  - command:npm run typecheck

---CHECKPOINT---

## Task 4: Wire route into Express app

Context: Register the widgets router in src/app.ts. Keep the change minimal — just
  import and app.use(). Do not touch anything else in app.ts.
Scope: src/app.ts
Depends on: 3
Done when:
  - grep:src/app.ts:widgetsRouter
  - command:npm test
  - no-grep:src/app.ts:TODO

---

# MASTER_PLAN.md Reference

## Frontmatter fields

| Field           | Default    | Description |
|-----------------|------------|-------------|
| project         | "Project"  | Human name for the PR and journal headers |
| adapter         | "claude"   | AI adapter: claude \| openai \| gemini \| http |
| gates           | [npm test] | Commands that must pass after every task |
| max_retries     | 2          | Retry attempts per task on gate failure |
| commit_on_pass  | true       | Auto-commit after every passing task |

## Task block fields

| Field                | Required | Description |
|----------------------|----------|-------------|
| Scope:               | Yes      | Comma-separated file paths or directories |
| Context:             | No       | Why this task exists, what it should accomplish |
| New packages allowed:| No       | npm packages the AI may install. Omit = none |
| Depends on:          | No       | Task numbers this task must run after |
| Done when:           | Yes      | Verifiable completion criteria (see below) |

## Done criteria formats

```
file:src/path/to/file.ts          # File must exist
command:npm test -- src/path      # Command must exit 0
grep:src/file.ts:pattern          # File must contain pattern
no-grep:src/file.ts:pattern       # File must NOT contain pattern
```

## Special markers

```
---CHECKPOINT---
```

Pauses the session. Prometheus prints the branch and journal, then exits cleanly.
Resume with: `prometheus autopilot resume MASTER_PLAN.md`

## Adapter options

```json
{
  "autopilot": {
    "enabled": true,
    "adapter": "claude",
    "maxCostUSD": 5.00,
    "taskTimeoutMinutes": 30,
    "maxRetriesPerTask": 2,
    "requirePluggedIn": true,
    "stopOnCreditFailure": true
  }
}
```

Set in `.thesmos/config.json`.

## Cancel while running

```sh
touch .thesmos/autopilot/.cancel
# or
prometheus autopilot cancel
```

The session stops cleanly after the current task completes.
Nothing is pushed. Branch is preserved for review or revert.
