import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, TS_EXT, isTestPath, isCommentLine } from './helpers';

export const TYPESCRIPT_RULES: PrometheusRule[] = [
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
];
