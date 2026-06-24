---
"thesmos-governance": minor
---

Expand built-in rule registry from 142 to 737 rules, add language packs, IaC security rules, pack authoring toolchain, and HTML report improvements.

**New rules (498 added across 16 domain and language files):**

- `imports.ts` — 20 rules covering barrel file performance, circular imports, side-effect imports, namespace imports, server modules in client code, missing `.js` extensions, lodash/moment bundle size, and more
- `state.ts` — 20 rules covering Zustand selector patterns, Redux mutations, Context instability, atom scope, localStorage in SSR, stale closures, and more
- `forms.ts` — 20 rules covering validation, accessibility (WCAG 1.3.1), CSRF, file upload types, RHF patterns, loading states, `aria-invalid`, and more
- `logging.ts` — 20 rules including PII in logs (BLOCKER), secrets in logs (BLOCKER), unstructured logs, missing context IDs, audit log gaps, and more
- `css.ts` — 20 rules covering Tailwind arbitrary values, missing responsive breakpoints, dark mode, z-index magic numbers, `outline-none` without `focus-visible` (WCAG 2.4.7), `prefers-reduced-motion`, and more
- `nextjs.ts` — expanded from 15 to 37 rules: `use server` placement, missing Suspense, static metadata, `cookies()` forcing dynamic render, raw `<img>`, Server Action revalidation, font optimisation, and more
- `react.ts` — expanded from 12 to 32 rules: missing keys, index keys, stale `useCallback`, `dangerouslySetInnerHTML` (BLOCKER), `useId` for a11y, debounce on search, and more
- `security.ts` — expanded from 22 to 40 rules: open redirect, mass assignment (BLOCKER), timing-safe comparison, JWT weak secret (BLOCKER), session fixation, clickjacking headers, plaintext passwords (BLOCKER), and more
- `typescript.ts` — expanded from 17 to 35 rules: double type assertions, missing return types, `satisfies` operator, `readonly` on config interfaces, excessive non-null assertions, and more
- `performance.ts` — expanded from 16 to 31 rules: LCP hero images, list virtualisation, runtime CSS-in-JS, passive scroll listeners, layout thrashing, waterfall `await` chains, and more
- `database.ts` — expanded from 16 to 31 rules: N+1 queries, missing Prisma FK indexes, transaction gaps, soft-delete patterns, connection pool singleton, cascade delete risk, and more
- `ai.ts` — expanded from 12 to 27 rules: prompt injection (BLOCKER), token limit validation, LLM output execution (BLOCKER), cost budgets, agent loop caps, system prompt leakage, content moderation, RAG citations, and more
- `python.ts` — 20 new rules: SQL injection via f-string, hardcoded secrets, pickle.loads (BLOCKER), eval/exec usage, subprocess shell injection, YAML unsafe load, weak crypto, path traversal, and more
- `django.ts` — 20 new rules: debug mode in production, missing CSRF middleware, raw SQL in ORM, open redirect, missing AUTH_PASSWORD_VALIDATORS, template injection via mark_safe, and more
- `go.ts` — 20 new rules: SQL concat in db.Query, goroutine leak in handlers, ioutil deprecated APIs, weak random, http.ListenAndServe on 0.0.0.0, missing context cancellation, and more
- `ruby.ts` — 20 new rules: ActiveRecord string interpolation (BLOCKER), params.permit! (BLOCKER), YAML.load unsafe (BLOCKER), missing authenticate before_action, skip_before_action auth, open redirect via redirect_to, and more
- `php.ts` — 20 new rules: SQL injection via concatenation/interpolation (BLOCKER), XSS echo without htmlspecialchars (BLOCKER), eval() (BLOCKER), command injection (BLOCKER), path traversal/LFI (BLOCKER), $guarded = [] mass assignment (BLOCKER), whereRaw() interpolation (BLOCKER), SSRF via file_get_contents (BLOCKER), unserialize on user input (BLOCKER), Blade missing @csrf, and more

**Pack runtime loading:**

- `loadPackRulesFromEntry(entry)` — dynamically imports `rules/index.js` from a single pack directory
- `loadPackRules(root)` — discovers all packs under `.thesmos/packs/` and `node_modules/@thesmos/` and loads their rules
- `getActiveRules(root)` — returns built-in rules merged with pack rules; pass to `runReview()` as second argument
- `thesmos review` and `thesmos validate` CLI commands now automatically load pack rules at startup

**Pack authoring toolchain:**

- `thesmos pack:create @scope/name` — scaffolds a complete pack directory with pack.json, rules/index.ts, agents/, skills/
- `thesmos pack:publish @scope/name` — compiles TypeScript rules to JS via tsup, validates pack.json schema, runs npm publish

**HTML report improvements:**

- Language breakdown table showing file counts per detected stack
- Pack inventory section listing active community packs
- Trend sparklines for Blockers, High findings, and Health Score from metrics history

**Multi-language scan:**

- `computeLanguageStats()` — counts files and lines per language/extension
- `detectStacks()` — infers frameworks (Laravel, Django, Rails, Go modules, etc.) from file patterns
- `thesmos scan` now shows a "Languages detected" table and "Detected stacks" in console output
