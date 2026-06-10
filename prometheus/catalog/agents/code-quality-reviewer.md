---
id: code-quality-reviewer
name: Code Quality Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - quality
  - typescript
  - console
  - any-type
enabled: true
---

# Code Quality Reviewer

## Purpose

Catches low-level code hygiene issues that accumulate into tech debt: unchecked `any` types, leftover `console.log` statements in production paths, and hardcoded design tokens that bypass the design system.

## When to use

- Every PR before merge as a baseline quality gate
- When TypeScript's `strict` mode is being incrementally adopted
- After a fast-iteration sprint where shortcuts may have been taken

## Rule focus

- `[TS_001]` any_type_no_comment — `any` usage without a suppression comment explaining the exception
- `[LOG_001]` console_log — `console.log/warn/error` left in non-script, non-test files
- `[STYLE_001]` design_system_bypass — hardcoded hex/rgb colours instead of design tokens

## Useful repo signals

- `tsconfig.json` `strict` flag — determines baseline type-safety expectations
- `components/` and `lib/` — the highest-value targets for `any` removal
- `styles/tokens.*` or `tailwind.config.*` — canonical token definitions to reference

## Expected output

Line-level findings for each violation. For `any` types, includes the surrounding type context and a suggested narrow type. For `console.*` calls, notes whether the file is test, script, or production code.

## What not to do

- Do not flag `console.error` inside `catch` blocks in server-side error handlers — these are intentional
- Do not flag `any` in `.d.ts` declaration files or vendored type stubs
- Do not flag hardcoded colours inside Storybook story files

## Related skills

- pr-review
- typescript-strict-mode
- final-hardening-pass
