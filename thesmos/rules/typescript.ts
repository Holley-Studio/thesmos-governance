// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, TS_EXT, isTestPath, isCommentLine } from './helpers';

export const TYPESCRIPT_RULES: ThesmosRule[] = [
  {
    id: 'TS_002',
    category: 'ts_ignore_no_comment',
    description: '@ts-ignore suppresses TypeScript errors without explaining why. Always add a justification comment.',
    severity: 'MEDIUM',
    tags: ['typescript', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: '@ts-ignore silently swallows type errors. Without a comment the next reader has no idea if the suppression is intentional, temporary, or a mistake — and TypeScript will not warn when the underlying issue is fixed.',
      commonViolations: ['// @ts-ignore', '// @ts-ignore (on its own line)'],
      goodExample: '// @ts-ignore: third-party type definitions missing optional field (issue #1234)',
      badExample: '// @ts-ignore\nconst x = badlyTyped.field;',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ts_ignore_no_comment', config.severityRules);
      const TS_IGNORE_RE = /\/\/\s*@ts-ignore\s*$/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (TS_IGNORE_RE.test(lines[i]!)) {
            findings.push({ severity, category: 'ts_ignore_no_comment', file: path, line: i + 1, message: '@ts-ignore without explanation comment.', suggestion: 'Add a reason: // @ts-ignore: <why this is necessary>' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_003',
    category: 'ts_expect_error_no_comment',
    description: '@ts-expect-error without an explanation comment obscures intentional type suppressions.',
    severity: 'LOW',
    tags: ['typescript', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: '@ts-expect-error is safer than @ts-ignore (it errors if the suppression is unnecessary) but still needs a comment explaining why the type error is acceptable.',
      commonViolations: ['// @ts-expect-error'],
      goodExample: '// @ts-expect-error: Drizzle ORM overload types not yet updated for v0.29',
      badExample: '// @ts-expect-error\nconst result = legacy.call(this);',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ts_expect_error_no_comment', config.severityRules);
      const RE = /\/\/\s*@ts-expect-error\s*$/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (RE.test(lines[i]!)) {
            findings.push({ severity, category: 'ts_expect_error_no_comment', file: path, line: i + 1, message: '@ts-expect-error without explanation.', suggestion: 'Add a reason: // @ts-expect-error: <why>' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_004',
    category: 'non_null_user_input',
    description: 'Non-null assertion (!) on req.query, req.params, or req.body values hides runtime crashes.',
    severity: 'HIGH',
    tags: ['typescript', 'security', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'req.query and req.params values are string | undefined. Using ! tells TypeScript to treat them as definitely-defined, which crashes with a TypeError when the param is missing — a DoS vector if an attacker deliberately omits it.',
      commonViolations: ['req.query.id!', 'req.params.userId!', 'req.body.name!'],
      goodExample: "const id = req.params.id;\nif (!id) return res.status(400).json({ error: 'id required' });\n// now id is string",
      badExample: 'const user = await db.findById(req.query.id!);  // crashes if id is undefined',
      relatedPlaybooks: ['input-validation.md', 'typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('non_null_user_input', config.severityRules);
      const RE = /req\.(?:query|params|body)\.\w+!/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'non_null_user_input', file: path, line: i + 1, message: 'Non-null assertion on user-supplied request value.', suggestion: 'Guard with an explicit null check and return 400 if missing.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_005',
    category: 'double_cast',
    description: '`as unknown as T` double casts bypass TypeScript\'s type system entirely. This masks type errors.',
    severity: 'MEDIUM',
    tags: ['typescript', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'as unknown as T is the TypeScript equivalent of a C-style forced cast — it tells the compiler to stop checking. This hides bugs that would otherwise be caught at compile time.',
      commonViolations: ['value as unknown as MyType', '(data as unknown as SpecificType)'],
      goodExample: '// Use proper type narrowing with a type guard or parse with zod.',
      badExample: 'const typed = rawValue as unknown as UserProfile;  // unsafe',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: ['zod-schema-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('double_cast', config.severityRules);
      const RE = /\bas\s+unknown\s+as\s+/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'double_cast', file: path, line: i + 1, message: '`as unknown as T` double cast bypasses the type system.', suggestion: 'Use a Zod schema, type guard, or proper type narrowing instead.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_006',
    category: 'function_type',
    description: 'Using `Function` as a type is too broad — it accepts any callable including constructors with wrong signatures.',
    severity: 'LOW',
    tags: ['typescript', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'The `Function` type provides no information about parameters or return value, making the API unusable without reading the source. It also permits calling with the wrong number or type of arguments.',
      commonViolations: ['callback: Function', 'handler: Function'],
      goodExample: 'callback: (event: ClickEvent) => void\nhandler: (req: Request, res: Response) => Promise<void>',
      badExample: 'function register(callback: Function) { ... }  // what args does callback take?',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('function_type', config.severityRules);
      const RE = /:\s*Function\b(?!\s*\.)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'function_type', file: path, line: i + 1, message: 'Broad `Function` type — use a typed function signature instead.', suggestion: 'Replace with an explicit signature: (arg: T) => R' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_007',
    category: 'var_declaration',
    description: '`var` has function scope and hoisting behavior that causes subtle bugs. Use `const` or `let`.',
    severity: 'LOW',
    tags: ['typescript', 'quality', 'es6'],
    sinceVersion: '2.0.0',
    explain: {
      why: '`var` is hoisted to the function scope, not the block. This means variables declared inside loops or conditionals are accessible outside them, leading to subtle reference bugs.',
      commonViolations: ['var count = 0', 'var i = 0; for (var i = ...)'],
      goodExample: 'const items = [];\nfor (let i = 0; i < n; i++) { ... }',
      badExample: 'var result = null;\nfor (var i = 0; i < arr.length; i++) { var result = arr[i]; }  // leaks',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('var_declaration', config.severityRules);
      const RE = /^\s*var\s+/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'var_declaration', file: path, line: i + 1, message: '`var` declaration — use `const` or `let` for block scoping.', suggestion: "Replace `var` with `const` (if not reassigned) or `let`." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_008',
    category: 'empty_catch_block',
    description: 'Empty catch blocks swallow errors silently. At minimum, log the error.',
    severity: 'HIGH',
    tags: ['typescript', 'reliability', 'error-handling'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'An empty catch block means any error — including unexpected ones — is swallowed silently. This makes debugging nearly impossible and can leave systems in inconsistent state.',
      commonViolations: ['catch (e) {}', 'catch (_) { }', 'catch { }'],
      goodExample: "catch (err) {\n  logger.error('failed to process', { err, context });\n  throw err;  // or handle gracefully\n}",
      badExample: "try { await processPayment(); } catch (e) {}  // payment failure is silently ignored",
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('empty_catch_block', config.severityRules);
      const EMPTY_CATCH_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (EMPTY_CATCH_RE.test(line)) {
            findings.push({ severity, category: 'empty_catch_block', file: path, line: i + 1, message: 'Empty catch block — errors are swallowed silently.', suggestion: 'Log the error at minimum: logger.error(err). Re-throw if the caller needs to know.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_009',
    category: 'number_parse_no_validate',
    description: 'Number() and parseInt() on user input return NaN for non-numeric strings. Always validate after parsing.',
    severity: 'MEDIUM',
    tags: ['typescript', 'input-validation', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Number("abc") returns NaN. If you then use that in arithmetic or as a DB query parameter, you get silent corrupt results or unexpected behavior. parseInt without a radix is also a common source of bugs.',
      commonViolations: ['const limit = Number(req.query.limit)', 'parseInt(req.params.page)'],
      goodExample: "const raw = Number(req.query.limit);\nif (isNaN(raw) || raw < 1 || raw > 100) return res.status(400).json({ error: 'invalid limit' });",
      badExample: "const page = parseInt(req.query.page);  // NaN if non-numeric — no check",
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: [],
      relatedSkills: ['zod-schema-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('number_parse_no_validate', config.severityRules);
      const RE = /(?:Number|parseInt|parseFloat)\s*\(\s*req\.\w+/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            const ctx = lines.slice(i, Math.min(i + 3, lines.length)).join('\n');
            if (!/isNaN|isFinite|\.safeParse|zod|schema/.test(ctx)) {
              findings.push({ severity, category: 'number_parse_no_validate', file: path, line: i + 1, message: 'Number parsing on user input without NaN validation.', suggestion: 'Check isNaN() after parsing, or use Zod: z.coerce.number().int().parse(value).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_010',
    category: 'floating_promise',
    description: 'Calling an async function without await or .catch() creates an unhandled promise rejection.',
    severity: 'HIGH',
    tags: ['typescript', 'async', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'An unhandled promise rejection crashes Node.js processes in modern versions and silently loses errors in browsers. Always await, return, or explicitly handle async function calls.',
      commonViolations: ['sendEmail(user.email)', 'db.update(record)  // fire-and-forget'],
      goodExample: "await sendEmail(user.email);\n// or: sendEmail(user.email).catch(err => logger.error('email failed', err));",
      badExample: "// Route handler:\nsendWelcomeEmail(newUser);  // not awaited — failure is invisible",
      relatedPlaybooks: ['async-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('floating_promise', config.severityRules);
      const FLOATING_RE = /^\s*(?!(?:return|await|const|let|var|export|throw|void)\b)[a-zA-Z_$][a-zA-Z0-9_$.]*\s*\([^)]*\)\s*;/;
      const ASYNC_HINT = /(?:Async|async|Email|Notify|Send|emit|publish|enqueue|dispatch|track|log)[A-Z]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (FLOATING_RE.test(line) && ASYNC_HINT.test(line) && !/.catch\(|void /.test(line)) {
            findings.push({ severity, category: 'floating_promise', file: path, line: i + 1, message: 'Likely floating promise — async call without await or .catch().', suggestion: "Add await, or .catch(err => logger.error(err)) if fire-and-forget is intentional." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_011',
    category: 'debugger_statement',
    description: '`debugger` statement committed to source code pauses execution in any environment with dev tools open.',
    severity: 'HIGH',
    tags: ['quality', 'debugging'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'A committed `debugger` statement halts production code execution for any user who has developer tools open. In Node.js, it requires the --inspect flag but signals serious carelessness.',
      commonViolations: ['debugger;', 'debugger  // forgot to remove'],
      goodExample: '// Remove debugger statements before committing. Use IDE breakpoints instead.',
      badExample: 'async function processOrder(id) {\n  debugger;  // forgot to remove before merge\n  const order = await db.findOrder(id);',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('debugger_statement', config.severityRules);
      const RE = /\bdebugger\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'debugger_statement', file: path, line: i + 1, message: '`debugger` statement in committed code.', suggestion: 'Remove the debugger statement. Use IDE breakpoints for debugging.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_012',
    category: 'unhandled_error_in_catch',
    description: 'Using catch(err) with `console.error` only and no re-throw or user notification swallows errors.',
    severity: 'MEDIUM',
    tags: ['typescript', 'error-handling', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Logging an error but not re-throwing or returning an error response means the caller thinks the operation succeeded. This creates data integrity issues and silent failures that are extremely hard to debug.',
      commonViolations: ["catch (err) { console.error(err) }  // returns undefined to caller"],
      goodExample: "catch (err) {\n  logger.error('operation failed', { err });\n  throw err;  // propagate so caller can respond correctly\n}",
      badExample: "try { await saveOrder(order); } catch (err) { console.error(err); }  // caller gets undefined",
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('unhandled_error_in_catch', config.severityRules);
      const CATCH_LOG_RE = /catch\s*\([^)]+\)\s*\{\s*console\.(?:error|warn|log)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (CATCH_LOG_RE.test(line)) {
            const ctx = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
            if (!/throw|return|res\.|status\(|reject/.test(ctx)) {
              findings.push({ severity, category: 'unhandled_error_in_catch', file: path, line: i + 1, message: 'catch block only logs — no re-throw or error response.', suggestion: 'After logging, either re-throw or return an appropriate error response.' });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── Async patterns ─────────────────────────────────────────────────────────

  {
    id: 'ASYNC_001',
    category: 'await_in_foreach',
    description: '`await` inside `.forEach()` does not wait for promises — use `for...of` or `Promise.all` instead.',
    severity: 'HIGH',
    tags: ['async', 'reliability', 'typescript'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Array.forEach() does not await the return value of its callback. Each iteration fires the async function but does not wait for it — the outer await is on the forEach itself (which is synchronous), so all async work runs in parallel and errors are swallowed.',
      commonViolations: ['items.forEach(async (item) => { await processItem(item); })', 'arr.forEach(async item => { await db.update(item); })'],
      goodExample: "for (const item of items) { await processItem(item); }\n// Or parallel: await Promise.all(items.map(item => processItem(item)));",
      badExample: "items.forEach(async (item) => {\n  await saveItem(item);  // not awaited by forEach\n});",
      relatedPlaybooks: ['async-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('await_in_foreach', config.severityRules);
      const FOREACH_ASYNC_RE = /\.forEach\s*\(\s*async/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (FOREACH_ASYNC_RE.test(line)) {
            findings.push({ severity, category: 'await_in_foreach', file: path, line: i + 1, message: 'async callback in .forEach() — await does not work here.', suggestion: 'Use for...of for sequential or Promise.all(items.map(...)) for parallel execution.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ASYNC_002',
    category: 'promise_all_no_catch',
    description: 'Promise.all() rejects immediately when any promise rejects — handle rejections explicitly.',
    severity: 'MEDIUM',
    tags: ['async', 'reliability', 'error-handling'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Promise.all "fail-fast" — if one promise rejects, the entire batch rejects immediately and other in-flight promises are not cancelled. Without error handling, unhandled rejections crash Node.js or silently fail in browsers.',
      commonViolations: ['await Promise.all([fetchUser(), fetchOrders()])', 'Promise.all(ids.map(id => db.find(id)))'],
      goodExample: "const [user, orders] = await Promise.all([fetchUser(), fetchOrders()]).catch(handleError);\n// Or: await Promise.allSettled([...]) for independent operations",
      badExample: "const results = await Promise.all(urls.map(fetch));  // one 404 crashes everything",
      relatedPlaybooks: ['async-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('promise_all_no_catch', config.severityRules);
      const RE = /\bPromise\.all\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 1), Math.min(i + 3, lines.length)).join('\n');
            if (!/.catch\(|try\s*\{|allSettled/.test(ctx)) {
              findings.push({ severity, category: 'promise_all_no_catch', file: path, line: i + 1, message: 'Promise.all() without error handling — one rejection fails all.', suggestion: 'Wrap in try-catch, chain .catch(), or use Promise.allSettled() for independent operations.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ASYNC_003',
    category: 'async_no_try_catch',
    description: 'API route handlers that are async and use await without try-catch let errors crash the process.',
    severity: 'MEDIUM',
    tags: ['async', 'reliability', 'error-handling'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'An unhandled rejection inside an async Express/Next.js handler terminates the Node.js process (Node 15+) or hangs the request indefinitely. Every async handler needs a top-level error boundary.',
      commonViolations: ['export async function POST(req) { const data = await db.query(); return ... }'],
      goodExample: "export async function POST(req: Request) {\n  try {\n    const data = await db.query(...);\n    return Response.json(data);\n  } catch (err) {\n    return Response.json({ error: 'failed' }, { status: 500 });\n  }\n}",
      badExample: "export async function POST(req) {\n  const data = await riskyOperation();  // unhandled rejection\n  return new Response(JSON.stringify(data));\n}",
      relatedPlaybooks: ['async-patterns.md', 'error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('async_no_try_catch', config.severityRules);
      const ASYNC_HANDLER_RE = /export\s+(?:default\s+)?async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|handler)\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!/api|route|handler/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (ASYNC_HANDLER_RE.test(line)) {
            const body = lines.slice(i, Math.min(i + 30, lines.length)).join('\n');
            if (/\bawait\b/.test(body) && !/try\s*\{/.test(body)) {
              findings.push({ severity, category: 'async_no_try_catch', file: path, line: i + 1, message: 'Async route handler with await but no try-catch.', suggestion: 'Wrap handler body in try-catch and return a 500 response on unexpected errors.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ASYNC_004',
    category: 'new_promise_constructor',
    description: '`new Promise()` wrapping an already-async function loses error propagation and adds unnecessary indirection.',
    severity: 'LOW',
    tags: ['async', 'quality', 'typescript'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'new Promise((resolve, reject) => { asyncFn().then(resolve).catch(reject) }) is an anti-pattern — just use await asyncFn() directly. The wrapper hides the async nature, makes error handling harder, and breaks async stack traces.',
      commonViolations: ['new Promise((resolve) => { resolve(asyncFn()) })', 'return new Promise((res, rej) => someAsyncFn().then(res).catch(rej))'],
      goodExample: "const result = await asyncFn();",
      badExample: "return new Promise((resolve, reject) => {\n  fetchData().then(resolve).catch(reject);  // just await fetchData()\n});",
      relatedPlaybooks: ['async-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('new_promise_constructor', config.severityRules);
      const RE = /new\s+Promise\s*\(\s*(?:async\s*)?\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'new_promise_constructor', file: path, line: i + 1, message: 'new Promise() wrapping async code — unnecessary indirection.', suggestion: 'Remove the Promise constructor and use await directly.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ASYNC_005',
    category: 'sequential_await',
    description: 'Multiple sequential awaits for independent operations — use Promise.all for parallel execution.',
    severity: 'LOW',
    tags: ['async', 'performance'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Sequential await adds latency equal to the sum of all operations. Two 200ms operations take 400ms sequentially but only 200ms in parallel via Promise.all.',
      commonViolations: ['const user = await getUser(id);\nconst orders = await getOrders(id);  // could run in parallel'],
      goodExample: "const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);",
      badExample: "const user = await fetchUser(id);\nconst prefs = await fetchPreferences(id);  // 2× the latency unnecessarily",
      relatedPlaybooks: ['async-patterns.md', 'performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sequential_await', config.severityRules);
      const AWAIT_RE = /^\s*(?:const|let|var)\s+\w+\s*=\s*await\s+/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          if (AWAIT_RE.test(lines[i]!) && AWAIT_RE.test(lines[i + 1]!)) {
            const l1 = lines[i]!;
            const l2 = lines[i + 1]!;
            const id1 = l1.match(/const\s+(\w+)/)?.[1];
            const fn1 = l1.match(/await\s+(\w+)\s*\(/)?.[1];
            const fn2 = l2.match(/await\s+(\w+)\s*\(/)?.[1];
            if (fn1 && fn2 && fn1 !== fn2 && id1 && !l2.includes(id1)) {
              findings.push({ severity, category: 'sequential_await', file: path, line: i + 1, message: 'Sequential awaits for independent operations — consider Promise.all.', suggestion: `const [a, b] = await Promise.all([${fn1}(...), ${fn2}(...)]);` });
              i++;
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ASYNC_006',
    category: 'settimeout_zero',
    description: 'setTimeout(fn, 0) is a code smell — it defers execution to next tick to work around a timing bug.',
    severity: 'LOW',
    tags: ['async', 'quality', 'react'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'setTimeout(fn, 0) is almost always masking a real problem: an effect running before state is committed, a missing dependency, or a race condition. Fix the root cause rather than deferring.',
      commonViolations: ['setTimeout(() => setState(val), 0)', 'setTimeout(() => ref.current.focus(), 0)'],
      goodExample: "// For React state: use useEffect with correct deps\n// For focus: use useLayoutEffect\n// For next-tick: consider queueMicrotask()",
      badExample: "setTimeout(() => {\n  setState(computedValue);  // why is this needed?\n}, 0);",
      relatedPlaybooks: ['async-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('settimeout_zero', config.severityRules);
      const RE = /\bsetTimeout\s*\([^,]+,\s*0\s*\)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'settimeout_zero', file: path, line: i + 1, message: 'setTimeout(fn, 0) — usually masking a timing bug.', suggestion: 'Fix the root cause. For React state timing, use useEffect with correct deps or queueMicrotask().' });
          }
        }
      }
      return findings;
    },
  },

  // ── TypeScript type system expansions ─────────────────────────────────────

  {
    id: 'TS_013',
    category: 'type_assertion_double_cast',
    description: "Double type assertion (x as unknown as T) is a red flag that the types are fundamentally incompatible.",
    severity: 'MEDIUM',
    tags: ['typescript', 'type-safety'],
    sinceVersion: '3.0.0',
    explain: {
      why: "x as unknown as SomeType bypasses the TypeScript type checker entirely. It's the same as saying 'trust me, this is T' with no evidence. This pattern almost always hides a bug where the actual type differs from the asserted type.",
      commonViolations: ['(data as unknown) as User', '(response as any) as ApiResponse'],
      goodExample: "// Instead of casting: parse with zod\nconst user = UserSchema.parse(data)  // throws if invalid, correctly types the result",
      badExample: "const user = (data as unknown) as User  // no runtime guarantee this is actually a User",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('type_assertion_double_cast', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/as\s+unknown\s+as\s+|as\s+any\s+as\s+/.test(line)) {
            findings.push({ severity, category: 'type_assertion_double_cast', file: path, line: i + 1, message: 'Double type assertion (as unknown as T) bypasses the type checker entirely.', suggestion: 'Parse and validate at runtime with zod.parse() instead of casting.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_014',
    category: 'missing_return_type',
    description: "Exported functions without explicit return types make API contracts unclear and allow accidental type widening.",
    severity: 'LOW',
    tags: ['typescript', 'quality', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Without an explicit return type, adding a second return path with a different type widens the inferred type silently. An explicit return type acts as a contract: callers can rely on it and the compiler enforces it.",
      commonViolations: ["export function getUser(id: string) { return db.user.findUnique({ where: { id } }) }"],
      goodExample: "export async function getUser(id: string): Promise<User | null> { return db.user.findUnique({ where: { id } }) }",
      badExample: "export function processOrder(id: string) { if (err) return null; return order }  // inferred as Order | null | undefined",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_return_type', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^export\s+(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{/.test(line) && !line.includes(': Promise') && !line.includes('): void') && !line.includes('):')) {
            findings.push({ severity, category: 'missing_return_type', file: path, line: i + 1, message: 'Exported function without explicit return type — callers cannot rely on inferred type.', suggestion: "Add explicit return type: function name(params): ReturnType { ... }" });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_015',
    category: 'generic_constraint_missing',
    description: "Generic type parameters without constraints (<T>) accept any type, defeating the purpose of generics.",
    severity: 'LOW',
    tags: ['typescript', 'type-safety', 'generics'],
    sinceVersion: '3.0.0',
    explain: {
      why: "function process<T>(item: T): T is equivalent to function process(item: unknown): unknown in terms of safety. Add constraints like <T extends object> or <T extends BaseModel> to communicate intent and enable type-safe operations on T.",
      commonViolations: ['function wrap<T>(value: T): { data: T }', 'interface Repository<T> { findById(id: string): T }'],
      goodExample: "function wrap<T extends Record<string, unknown>>(value: T): { data: T }\ninterface Repository<T extends Entity> { findById(id: string): Promise<T | null> }",
      badExample: "function merge<T>(a: T, b: T): T  // T could be anything — no operations allowed on it",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('generic_constraint_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^export\s+(?:function|class|interface|type)\s+\w+<[A-Z](?:,\s*[A-Z])*>/.test(line)) {
            if (!line.includes('extends') && !line.includes('=')) {
              findings.push({ severity, category: 'generic_constraint_missing', file: path, line: i + 1, message: 'Unconstrained generic type parameter — add extends to document the expected shape.', suggestion: "Add constraint: <T extends object> or <T extends BaseType> to make operations on T type-safe." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_016',
    category: 'optional_chain_without_fallback',
    description: "Optional chaining (a?.b) returning undefined in places that expect a value causes silent runtime failures.",
    severity: 'MEDIUM',
    tags: ['typescript', 'correctness', 'null-safety'],
    sinceVersion: '3.0.0',
    explain: {
      why: "a?.b?.c returns undefined if any property is nullish. If this value is passed to a function expecting a string, TypeScript may not catch it if types are loose. Always pair optional chaining with a nullish coalescing fallback: a?.b?.c ?? 'default'.",
      commonViolations: ['const name = user?.profile?.name  // may be undefined', 'const len = arr?.length  // undefined if arr is null'],
      goodExample: "const name = user?.profile?.name ?? 'Anonymous'\nconst len = arr?.length ?? 0",
      badExample: "const title = post?.author?.name  // undefined breaks string concatenation silently",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('optional_chain_without_fallback', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\w+\?\.\w+\?\.\w+/.test(line) && !line.includes('??') && !line.includes('||') && !line.includes('if (')) {
            if (/(?:const|let|return)\s+\w+\s*=\s*\w+\?\./.test(line)) {
              findings.push({ severity, category: 'optional_chain_without_fallback', file: path, line: i + 1, message: 'Deeply optional-chained value without nullish fallback — may be undefined where a value is expected.', suggestion: "Add ?? fallback: a?.b?.c ?? defaultValue to make undefined handling explicit." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_017',
    category: 'non_null_assertion_overuse',
    description: "Excessive non-null assertions (!) hide null-reference errors that would otherwise be caught at compile time.",
    severity: 'MEDIUM',
    tags: ['typescript', 'type-safety', 'null-safety'],
    sinceVersion: '3.0.0',
    explain: {
      why: "The ! operator tells TypeScript 'this is definitely not null/undefined' — if it's wrong, you get a runtime TypeError. More than a few ! in one file suggests nullability is not being properly handled through the type system.",
      commonViolations: ['user!.profile!.name!', 'document.getElementById("app")!'],
      goodExample: "const app = document.getElementById('app')\nif (!app) throw new Error('Missing #app element')\napp.innerHTML = '...'",
      badExample: "const profile = user!.profile!  // crashes at runtime if user or profile is actually null",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('non_null_assertion_overuse', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path) || isTestPath(path)) continue;
        const assertions = (content.match(/\w+!/g) || []).filter(m => !m.endsWith('!!'));
        if (assertions.length > 8) {
          findings.push({ severity, category: 'non_null_assertion_overuse', file: path, message: `${assertions.length} non-null assertions (!) in one file — indicates nullability is not properly typed.`, suggestion: 'Replace ! with proper null checks or narrowing. Use ?? for defaults, if/throw for required values.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_018',
    category: 'discriminated_union_missing',
    description: "Using string/boolean flags to model variants instead of discriminated unions makes impossible states possible.",
    severity: 'LOW',
    tags: ['typescript', 'type-safety', 'design'],
    sinceVersion: '3.0.0',
    explain: {
      why: "{ data: User | null, error: string | null, loading: boolean } has 8 possible combinations but only 3 are valid. A discriminated union makes invalid states unrepresentable: type State = { status: 'idle' } | { status: 'loading' } | { status: 'success', data: User } | { status: 'error', error: string }.",
      commonViolations: ['const [data, setData] = useState<User | null>(null)\nconst [loading, setLoading] = useState(false)\nconst [error, setError] = useState<string | null>(null)'],
      goodExample: "type State = { status: 'idle' } | { status: 'loading' } | { status: 'success', data: User } | { status: 'error', error: string }\nconst [state, setState] = useState<State>({ status: 'idle' })",
      badExample: "// data, loading, error as separate state — 8 combinations, only 3 valid",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('discriminated_union_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const hasLoading = /useState\s*\(\s*false\s*\).*loading|loading.*useState\s*\(\s*false\s*\)/.test(content);
        const hasError = /useState\s*(?:<\w+\s*\|\s*null>)?\s*\(\s*null\s*\).*error|error.*useState\s*\(\s*null\s*\)/.test(content);
        const hasData = /useState\s*(?:<\w+\s*\|\s*null>)?\s*\(\s*null\s*\).*data|data.*useState\s*\(\s*null\s*\)/.test(content);
        if (hasLoading && hasError && hasData) {
          findings.push({ severity, category: 'discriminated_union_missing', file: path, message: 'Separate data/loading/error state — consider a discriminated union type to make invalid states unrepresentable.', suggestion: "Use: type State = { status: 'idle' | 'loading' } | { status: 'success', data: T } | { status: 'error', error: string }." });
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_019',
    category: 'object_destructure_unused',
    description: "Destructuring many properties but using only one is wasteful — destructure only what you need.",
    severity: 'LOW',
    tags: ['typescript', 'dx', 'quality'],
    sinceVersion: '3.0.0',
    explain: {
      why: "const { a, b, c, d, e } = config when only a is used makes it unclear which properties are needed and creates a false impression of the function's dependencies. Destructure only what you actually use.",
      commonViolations: ['const { data, error, loading, refetch, networkStatus } = useQuery(...)  // only data used'],
      goodExample: "const { data } = useQuery(GET_USER)  // only need data",
      badExample: "const { user, session, token, permissions, claims } = await getAuth()  // only user is used",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('object_destructure_unused', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const destructMatch = line.match(/const\s*\{([^}]{80,})\}/);
          if (destructMatch) {
            findings.push({ severity, category: 'object_destructure_unused', file: path, line: i + 1, message: 'Very large destructuring pattern — may include unused properties.', suggestion: "Destructure only the properties you actually use in this scope." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_020',
    category: 'template_literal_type_missing',
    description: "Using string for URL paths, event names, or CSS classes loses IDE autocomplete and typo safety.",
    severity: 'LOW',
    tags: ['typescript', 'dx', 'type-safety'],
    sinceVersion: '3.0.0',
    explain: {
      why: "type Route = '/users' | '/posts' | '/auth/login' means autocomplete helps and typos are caught. type Route = string means neither — you discover the bug at runtime.",
      commonViolations: ['function navigate(path: string) { ... }  // any string allowed'],
      goodExample: "type Route = '/dashboard' | '/settings' | '/profile'\nfunction navigate(path: Route) { router.push(path) }",
      badExample: "navigate('/dashbord')  // typo — only caught at runtime with string type",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('template_literal_type_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/function\s+(?:navigate|redirect|push|emit|dispatch)\s*\(\s*\w+\s*:\s*string\s*\)/.test(line)) {
            findings.push({ severity, category: 'template_literal_type_missing', file: path, line: i + 1, message: "Navigation/event function accepts string — typos only caught at runtime.", suggestion: "Use a union type or template literal type: type Route = '/home' | '/about' | '/users/${string}'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_021',
    category: 'readonly_missing',
    description: "Config objects and DTO props without readonly can be accidentally mutated by consumers.",
    severity: 'LOW',
    tags: ['typescript', 'immutability', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "interface Config { url: string } allows any consumer to do config.url = 'bad'. readonly prevents accidental mutations that can cause hard-to-trace bugs, especially when configs are shared across modules.",
      commonViolations: ['interface AppConfig { apiUrl: string; timeout: number }'],
      goodExample: "interface AppConfig { readonly apiUrl: string; readonly timeout: number }",
      badExample: "type Config = { url: string; key: string }  // consumers can mutate freely",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('readonly_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path) || isTestPath(path)) continue;
        if (!path.includes('config') && !path.includes('Config') && !path.includes('types')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^(?:export\s+)?interface\s+\w+Config\s*\{/.test(line)) {
            const block = lines.slice(i + 1, i + 10).join('\n');
            if (!block.includes('readonly') && block.includes(':')) {
              findings.push({ severity, category: 'readonly_missing', file: path, line: i + 1, message: "Config interface properties without 'readonly' — consumers can accidentally mutate.", suggestion: "Add readonly to all config properties: readonly apiUrl: string." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_022',
    category: 'enum_prefer_const_object',
    description: "TypeScript enums should be replaced with as const objects for better tree-shaking and bundler compatibility.",
    severity: 'LOW',
    tags: ['typescript', 'performance', 'bundler'],
    sinceVersion: '3.0.0',
    explain: {
      why: "TypeScript enums emit JavaScript runtime code (an IIFE that creates an object). const objects with as const are erased at compile time and are tree-shakable. esbuild and bundlers handle const objects better than enums.",
      commonViolations: ['enum Direction { Up, Down, Left, Right }'],
      goodExample: "const Direction = { Up: 'up', Down: 'down', Left: 'left', Right: 'right' } as const\ntype Direction = typeof Direction[keyof typeof Direction]",
      badExample: "enum Status { Active, Inactive, Pending }  // emits runtime IIFE code",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('enum_prefer_const_object', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^(?:export\s+)?(?:const\s+)?enum\s+\w+\s*\{/.test(line) && !line.includes('const enum')) {
            findings.push({ severity, category: 'enum_prefer_const_object', file: path, line: i + 1, message: "TypeScript enum emits runtime code — use 'as const' object for better tree-shaking.", suggestion: "const Status = { Active: 'active' } as const; type Status = typeof Status[keyof typeof Status]." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_023',
    category: 'type_predicate_missing',
    description: "Type narrowing functions without type predicates (x is Type) don't narrow the type in the calling scope.",
    severity: 'MEDIUM',
    tags: ['typescript', 'type-safety', 'narrowing'],
    sinceVersion: '3.0.0',
    explain: {
      why: "function isUser(x: unknown) { return typeof x === 'object' && x !== null && 'id' in x } returns boolean. TypeScript doesn't know the type narrowed inside the if-block. Use: x is User as the return type.",
      commonViolations: ['function isUser(x: unknown): boolean { return "id" in (x as object) }'],
      goodExample: "function isUser(x: unknown): x is User {\n  return typeof x === 'object' && x !== null && 'id' in x\n}",
      badExample: "function isAdmin(user: unknown): boolean { return (user as User).role === 'admin' }  // no narrowing",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('type_predicate_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/function\s+is[A-Z]\w+\s*\([^)]*\)\s*:\s*boolean/.test(line)) {
            findings.push({ severity, category: 'type_predicate_missing', file: path, line: i + 1, message: "Type guard function returns 'boolean' — use 'x is Type' return type to enable type narrowing.", suggestion: "Change return type to: x is User (or the appropriate type) so TypeScript narrows in if-blocks." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_024',
    category: 'satisfies_operator_missing',
    description: "Using as Type instead of satisfies Type loses excess property checking and auto-inference of literal types.",
    severity: 'LOW',
    tags: ['typescript', 'type-safety', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "const config = { url: '...' } as Config widens 'url' and hides excess properties. const config = { url: '...' } satisfies Config checks the shape but preserves the literal type — config.url is still the literal type, not widened string.",
      commonViolations: ['const theme = { colors: { primary: "#1a56db" } } as Theme'],
      goodExample: "const theme = { colors: { primary: '#1a56db' } } satisfies Theme  // type-checked AND narrows colors.primary to literal",
      badExample: "const config = { apiUrl: 'https://api.example.com' } as Config  // excess props silently accepted",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('satisfies_operator_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/=\s*\{[^}]+\}\s+as\s+[A-Z]\w+/.test(line) && !line.includes('as const')) {
            findings.push({ severity, category: 'satisfies_operator_missing', file: path, line: i + 1, message: "Object cast with 'as Type' — use 'satisfies Type' to check shape without widening.", suggestion: "Replace '} as Config' with '} satisfies Config' for better type safety and literal type preservation." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_025',
    category: 'index_signature_unsafe',
    description: "Index signatures (Record<string, T>) skip excess property checking and allow any string key.",
    severity: 'LOW',
    tags: ['typescript', 'type-safety'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Record<string, string> allows any key — config.mistyped doesn't error. Use a mapped type with a union of known keys, or use an interface with specific properties.",
      commonViolations: ["type Config = Record<string, string>  // any key allowed"],
      goodExample: "type Config = Record<'apiUrl' | 'timeout' | 'version', string>  // only known keys\n// Or: interface Config { apiUrl: string; timeout: string }",
      badExample: "const config: { [key: string]: any } = {}  // completely untyped",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('index_signature_unsafe', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\[\s*key\s*:\s*string\s*\]\s*:\s*any/.test(line) || /Record\s*<\s*string\s*,\s*any\s*>/.test(line)) {
            findings.push({ severity, category: 'index_signature_unsafe', file: path, line: i + 1, message: "Index signature with 'any' value type — no type safety on values.", suggestion: "Use a specific value type: Record<string, User> or { [key: string]: ApiResponse }." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_026',
    category: 'mapped_type_opportunity',
    description: "Repeating the same property pattern across multiple types is a signal for a mapped type.",
    severity: 'LOW',
    tags: ['typescript', 'dx', 'maintainability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If you have CreateUser, UpdateUser, DeleteUser all with similar shapes, a mapped type can derive them from a base: type PartialUser = Partial<User>. This ensures changes to the base type propagate automatically.",
      commonViolations: ["interface CreateUser { name: string; email: string }\ninterface UpdateUser { name?: string; email?: string }  // manual copy"],
      goodExample: "interface User { name: string; email: string }\ntype CreateUser = Omit<User, 'id'>\ntype UpdateUser = Partial<Omit<User, 'id'>>",
      badExample: "// Repeating the same fields in Create/Update/Partial interfaces manually",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('mapped_type_opportunity', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const createCount = (content.match(/interface\s+Create\w+/g) || []).length;
        const updateCount = (content.match(/interface\s+Update\w+/g) || []).length;
        const partialCount = (content.match(/interface\s+Partial\w+/g) || []).length;
        if (createCount + updateCount + partialCount >= 3 && !content.includes('Partial<') && !content.includes('Omit<') && !content.includes('Pick<')) {
          findings.push({ severity, category: 'mapped_type_opportunity', file: path, message: 'Multiple Create/Update/Partial interfaces without mapped types — use Partial<T>, Omit<T>, Pick<T> to derive them.', suggestion: "Derive variant types from a base: type CreateUser = Omit<User, 'id'>; type UpdateUser = Partial<CreateUser>." });
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_027',
    category: 'string_union_too_wide',
    description: "String union types with 10+ members become hard to maintain — consider using a const array and typeof.",
    severity: 'LOW',
    tags: ['typescript', 'dx', 'maintainability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "type Permission = 'read' | 'write' | 'admin' | 'super' | 'billing' | 'support' | ... (15 values) is hard to maintain in sync across files. Extract to a const array and derive the type.",
      commonViolations: ["type Role = 'admin' | 'user' | 'moderator' | 'super' | 'billing' | 'support' | 'readonly' | 'editor'"],
      goodExample: "export const ROLES = ['admin', 'user', 'moderator', 'billing'] as const\nexport type Role = typeof ROLES[number]",
      badExample: "type Status = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'  // hard to maintain",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('string_union_too_wide', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/type\s+\w+\s*=\s*'/.test(line)) {
            const pipeCount = (line.match(/\|/g) || []).length;
            if (pipeCount >= 9) {
              findings.push({ severity, category: 'string_union_too_wide', file: path, line: i + 1, message: `String union type with ${pipeCount + 1} members — extract to a const array for easier maintenance.`, suggestion: "const VALUES = ['a', 'b', 'c'] as const; type MyType = typeof VALUES[number]." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_028',
    category: 'infer_keyword_avoid',
    description: "Overusing conditional types with infer makes code unreadable — prefer utility types when possible.",
    severity: 'LOW',
    tags: ['typescript', 'dx', 'maintainability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "type UnwrapPromise<T> = T extends Promise<infer U> ? U : T is fine. But deeply nested conditional types with multiple infer keywords become unreadable. Use Awaited<T>, ReturnType<F>, Parameters<F> from the standard library first.",
      commonViolations: ['type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T'],
      goodExample: "type UserResponse = Awaited<ReturnType<typeof getUser>>  // standard library utility types",
      badExample: "type R<T> = T extends (...args: infer A) => infer R ? R extends Promise<infer U> ? U : R : never  // unreadable",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('infer_keyword_avoid', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const inferCount = (line.match(/\binfer\b/g) || []).length;
          if (inferCount >= 2) {
            findings.push({ severity, category: 'infer_keyword_avoid', file: path, line: i + 1, message: `${inferCount} 'infer' keywords on one line — complex conditional type. Consider using built-in utility types.`, suggestion: "Use Awaited<T>, ReturnType<F>, Parameters<F>, UnpackPromise from TS standard library instead." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_029',
    category: 'namespace_avoid',
    description: "TypeScript namespaces (namespace Foo {}) are legacy — use ES modules (import/export) instead.",
    severity: 'LOW',
    tags: ['typescript', 'modules', 'legacy'],
    sinceVersion: '3.0.0',
    explain: {
      why: "TypeScript namespaces predate ES modules. They don't tree-shake, don't work well with bundlers, and add a nested scope that makes code harder to read. Modern TypeScript code should use ES module exports exclusively.",
      commonViolations: ["namespace Models { export interface User { ... } }"],
      goodExample: "// models/user.ts\nexport interface User { id: string; name: string }",
      badExample: "namespace App { export namespace Models { export interface User { ... } } }  // legacy pattern",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('namespace_avoid', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^(?:export\s+)?namespace\s+\w+\s*\{/.test(line)) {
            findings.push({ severity, category: 'namespace_avoid', file: path, line: i + 1, message: 'TypeScript namespace — use ES module exports instead.', suggestion: "Replace 'namespace Foo { export ... }' with regular ES module exports in separate files." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TS_030',
    category: 'excessive_type_assertion',
    description: "More than 5 type assertions in a single file indicates underlying type errors being suppressed rather than fixed.",
    severity: 'MEDIUM',
    tags: ['typescript', 'type-safety', 'quality'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Each as Type assertion says 'the type system is wrong here'. A file with many assertions is fighting the type system rather than working with it. Fix the root types instead of suppressing errors with assertions.",
      commonViolations: ['// File with 10+ type assertions throughout'],
      goodExample: "// Fix the root type or use zod to validate and properly type at boundaries",
      badExample: "(data as User).profile  // repeated throughout the file with different casts",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('excessive_type_assertion', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path) || isTestPath(path)) continue;
        const assertionCount = (content.match(/\)\s+as\s+[A-Z]\w+|\bas\s+[A-Z]\w+(?:<[^>]+>)?/g) || []).filter(m => !m.includes('as const')).length;
        if (assertionCount > 6) {
          findings.push({ severity, category: 'excessive_type_assertion', file: path, message: `${assertionCount} type assertions in one file — indicates type errors suppressed rather than fixed.`, suggestion: "Fix the root types. Use zod.parse() at data boundaries to properly type untyped data." });
        }
      }
      return findings;
    },
  },
];
