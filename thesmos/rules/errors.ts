// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, TS_EXT, isTestPath, isCommentLine } from './helpers';

export const ERROR_RULES: ThesmosRule[] = [
  {
    id: 'ERR_001',
    category: 'empty_catch_block',
    description: 'Empty catch blocks silently swallow errors, making debugging impossible and hiding production failures.',
    severity: 'HIGH',
    tags: ['errors', 'quality', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'An empty catch block is one of the most dangerous patterns in software. Errors vanish without a trace. The application appears to work until a subtle symptom surfaces much later.',
      commonViolations: ['} catch (e) {}', '} catch (_) { /* ignore */ }'],
      goodExample: '} catch (err) { logger.error("Operation failed", { err, context }); throw err; }',
      badExample: 'try { await sendEmail(user) } catch (e) {}  // email fails silently',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('empty_catch_block', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/}\s*catch\s*\([^)]*\)\s*\{/.test(line)) {
            const next = lines[i + 1] ?? '';
            const next2 = lines[i + 2] ?? '';
            if (/^\s*}/.test(next) || (/^\s*\/\//.test(next) && /^\s*}/.test(next2))) {
              findings.push({ severity, category: 'empty_catch_block', file: path, line: i + 1, message: 'Empty catch block silently swallows the error.', suggestion: 'At minimum: logger.error(err). If safe to ignore, add a comment explaining why.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_002',
    category: 'catch_and_ignore',
    description: 'catch blocks that log but do not re-throw or return allow execution to continue in an invalid state.',
    severity: 'MEDIUM',
    tags: ['errors', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Logging an error and continuing execution is usually wrong. The code that follows assumes the try block succeeded. If it failed, downstream code operates on invalid/undefined state.',
      commonViolations: ['} catch (err) { console.error(err); }  // execution continues'],
      goodExample: '} catch (err) { logger.error(err); throw err; }  // or handle and return early',
      badExample: 'try { user = await createUser(data) } catch (e) { console.error(e) }\nawait sendWelcomeEmail(user)  // user is undefined!',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('catch_and_ignore', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/}\s*catch\s*\(/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
            if (/console\.(error|warn|log)\(/.test(block) || /logger\.(error|warn)\(/.test(block)) {
              if (!/\bthrow\b|\breturn\b/.test(block)) {
                findings.push({ severity, category: 'catch_and_ignore', file: path, line: i + 1, message: 'catch block logs error but continues execution — downstream code may operate on invalid state.', suggestion: 'Add throw err to propagate, or return an error response and stop execution.' });
              }
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_003',
    category: 'error_type_not_checked',
    description: 'catch (e) without instanceof checks treats all errors the same, including expected cancellation signals.',
    severity: 'MEDIUM',
    tags: ['errors', 'typescript', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'AbortError, NetworkError, and application errors all land in the same catch block. Rethrowing AbortError crashes the component. Re-throwing a validation error as a server error confuses clients. Check error types.',
      commonViolations: ['catch (e) { throw new Error("Failed") }', 'catch (e) { return null }'],
      goodExample: "catch (err) { if (err instanceof DOMException && err.name === 'AbortError') return; throw err; }",
      badExample: 'catch (e) { throw new Error("Request failed") }  // masks AbortError from cancellation',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_type_not_checked', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/}\s*catch\s*\(\s*(?:e|err|error)\s*\)/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 6)).join('\n');
            if ((block.includes('throw new Error') || block.includes('return null')) && !block.includes('instanceof') && !block.includes('.name ===')) {
              findings.push({ severity, category: 'error_type_not_checked', file: path, line: i + 1, message: 'catch block does not check error type before re-throwing or returning.', suggestion: 'Check instanceof or err.name before deciding how to handle different error types.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_004',
    category: 'throwing_string',
    description: 'throw "error message" throws a string, not an Error. String throws cannot be caught with instanceof Error.',
    severity: 'HIGH',
    tags: ['errors', 'typescript', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Throwing a string produces a value with no stack trace, no type information, and no instanceof Error match. Error monitoring tools (Sentry, Datadog) cannot capture it properly. Always throw an Error instance.',
      commonViolations: ["throw 'invalid input'", 'throw `Missing ${field}`'],
      goodExample: "throw new Error(`Missing required field: ${field}`)",
      badExample: "throw 'User not found'  // no stack trace, not caught by instanceof Error",
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('throwing_string', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bthrow\s+['"`]/.test(line)) {
            findings.push({ severity, category: 'throwing_string', file: path, line: i + 1, message: 'throw string literal — no stack trace, no instanceof Error match.', suggestion: "throw new Error('message') to get a stack trace and proper error typing." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_005',
    category: 'error_message_exposed',
    description: 'Returning err.message directly to API clients leaks internal implementation details.',
    severity: 'HIGH',
    tags: ['errors', 'security', 'api'],
    sinceVersion: '3.0.0',
    explain: {
      why: "err.message from Prisma, PostgreSQL, or AWS SDKs contains database table names, column names, schema details, and stack paths. This information helps attackers probe your system's internals.",
      commonViolations: ['res.json({ error: err.message })', 'return { success: false, error: e.message }'],
      goodExample: "res.status(500).json({ error: 'An unexpected error occurred' });\nlogger.error({ err }, 'Request failed');  // detail only in server logs",
      badExample: "catch (err) { res.status(500).json({ error: err.message }) }  // leaks 'column doesnt exist'",
      relatedPlaybooks: ['api-errors.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_message_exposed', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:res\.json|res\.send|return\s*\{|json\().*\berr(?:or)?\.message\b/.test(line)) {
            findings.push({ severity, category: 'error_message_exposed', file: path, line: i + 1, message: 'err.message returned to API client — leaks internal implementation details.', suggestion: "Return a generic message to clients: { error: 'An error occurred' }. Log err.message server-side." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_006',
    category: 'error_without_context',
    description: 'Errors re-thrown without additional context lose the original call site information.',
    severity: 'LOW',
    tags: ['errors', 'observability', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'When you catch an error and throw new Error("Something failed"), the original stack trace and error details are lost. Wrap errors with context: throw new Error("Creating user failed", { cause: err }).',
      commonViolations: ['catch (err) { throw new Error("Operation failed") }'],
      goodExample: "catch (err) { throw new Error('User creation failed', { cause: err }) }  // ES2022 error cause",
      badExample: 'catch (err) { throw new Error("Failed") }  // original error and stack lost',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_without_context', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/throw\s+new\s+Error\s*\([^)]+\)/.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
            if (/catch\s*\(/.test(ctx) && !line.includes('cause:') && !line.includes('cause :')) {
              findings.push({ severity, category: 'error_without_context', file: path, line: i + 1, message: 'Re-throwing new Error in catch block without { cause: err } — original error lost.', suggestion: "throw new Error('Descriptive message', { cause: err }) to preserve the original error chain." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_007',
    category: 'untyped_error_in_ts',
    description: 'TypeScript 4.0+ types catch variables as unknown — accessing .message without a type guard throws at runtime.',
    severity: 'HIGH',
    tags: ['errors', 'typescript', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "With useUnknownInCatchVariables (TS 4.4+ strict), 'e' is typed as unknown. Accessing e.message without instanceof Error fails with 'Object is of type unknown' at compile time in strict mode, or silently returns undefined otherwise.",
      commonViolations: ['catch (e) { console.error(e.message) }', 'catch (e) { return e.stack }'],
      goodExample: 'catch (err) { if (err instanceof Error) logger.error(err.message); else logger.error(String(err)); }',
      badExample: 'catch (e) { logger.error(e.message) }  // e is unknown — .message is type error',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('untyped_error_in_ts', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/}\s*catch\s*\((?:e|err|error)\)/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
            if (/\b(?:e|err|error)\.(?:message|stack|code|name)\b/.test(block) && !block.includes('instanceof Error') && !block.includes('instanceof')) {
              findings.push({ severity, category: 'untyped_error_in_ts', file: path, line: i + 1, message: 'Accessing .message/.stack on catch variable without instanceof Error guard.', suggestion: 'if (err instanceof Error) use err.message; else use String(err).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_008',
    category: 'async_error_boundary_missing',
    description: 'Async event handlers and callbacks that throw produce unhandled rejections without a top-level error boundary.',
    severity: 'HIGH',
    tags: ['errors', 'reliability', 'async'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'setInterval, setTimeout, and EventEmitter callbacks that are async but throw inside are not caught by surrounding try/catch. The error becomes an unhandled rejection that crashes Node.js 15+.',
      commonViolations: ['setInterval(async () => { await riskyOperation() }, 1000)', 'emitter.on("data", async (d) => { ... })'],
      goodExample: 'setInterval(async () => { try { await riskyOperation() } catch (err) { logger.error(err) } }, 1000)',
      badExample: 'setInterval(async () => { await db.cleanup() }, 60000)  // throw → unhandled rejection',
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('async_error_boundary_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:setInterval|setTimeout|emitter\.on|\.on\()\s*\([^)]*async\s*\(/.test(line) || /(?:setInterval|setTimeout)\s*\(async/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
            if (!block.includes('try {') && !block.includes('.catch(')) {
              findings.push({ severity, category: 'async_error_boundary_missing', file: path, line: i + 1, message: 'Async callback in timer/event without try/catch — unhandled rejection crashes Node.js 15+.', suggestion: 'Wrap the async callback body in try { ... } catch (err) { logger.error(err) }.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_009',
    category: 'error_code_not_set',
    description: 'Custom Error classes without a code property make programmatic error handling brittle.',
    severity: 'LOW',
    tags: ['errors', 'dx', 'typescript'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Checking err.message === 'User not found' is fragile — messages change. A code property (e.g. NOT_FOUND, UNAUTHORIZED) provides a stable string for programmatic handling, i18n, and monitoring dashboards.",
      commonViolations: ['class NotFoundError extends Error { constructor(msg) { super(msg) } }'],
      goodExample: "class NotFoundError extends Error { code = 'NOT_FOUND' as const;\nconstructor(msg = 'Not found') { super(msg); this.name = 'NotFoundError'; } }",
      badExample: "class NotFoundError extends Error {}  // no code — callers check e.message string",
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_code_not_set', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/class\s+\w+Error\s+extends\s+Error\s*\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
            if (!block.includes('code') && !block.includes('statusCode') && !block.includes('httpStatus')) {
              findings.push({ severity, category: 'error_code_not_set', file: path, line: i + 1, message: 'Custom Error class without a code property — callers must compare message strings.', suggestion: "Add code = 'ERROR_CODE' as const to the class for stable programmatic handling." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_010',
    category: 'promise_all_no_error_handling',
    description: 'Promise.all() without try/catch causes an unhandled rejection if any promise rejects.',
    severity: 'HIGH',
    tags: ['errors', 'async', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Promise.all() rejects as soon as any promise rejects. If not wrapped in try/catch, the rejection is unhandled. Use Promise.allSettled() if partial failure is acceptable, or wrap in try/catch.',
      commonViolations: ['const [a, b] = await Promise.all([fetchA(), fetchB()])  // no catch'],
      goodExample: 'try { const [a, b] = await Promise.all([fetchA(), fetchB()]); } catch (err) { ... }',
      badExample: 'const [users, posts] = await Promise.all([db.getUsers(), db.getPosts()])  // fetchUsers fails → unhandled',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('promise_all_no_error_handling', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/await\s+Promise\.all\(/.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
            if (!ctx.includes('try {') && !line.includes('.catch(')) {
              findings.push({ severity, category: 'promise_all_no_error_handling', file: path, line: i + 1, message: 'Promise.all() without try/catch — any rejection becomes unhandled.', suggestion: 'Wrap in try/catch, or use Promise.allSettled() if partial success is acceptable.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_011',
    category: 'error_in_finally',
    description: 'Throwing inside a finally block swallows the original error from the try or catch block.',
    severity: 'HIGH',
    tags: ['errors', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If the try block throws and the finally block also throws, JavaScript discards the original error. The finally block error replaces it. This makes debugging the root cause nearly impossible.',
      commonViolations: ['finally { await cleanup()  // throws if cleanup fails }'],
      goodExample: "finally { try { await cleanup() } catch (cleanupErr) { logger.error('Cleanup failed', cleanupErr) } }",
      badExample: 'finally { connection.close()  // throws → swallows original error',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_in_finally', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bfinally\s*\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
            if (/\bthrow\b/.test(block) && !block.includes('try {')) {
              findings.push({ severity, category: 'error_in_finally', file: path, line: i + 1, message: 'throw inside finally block — swallows the original error from try/catch.', suggestion: 'Wrap risky finally logic in its own try/catch to prevent swallowing the original error.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_012',
    category: 'non_error_thrown',
    description: 'Throwing non-Error values (objects, numbers) prevents stack trace capture and instanceof checks.',
    severity: 'MEDIUM',
    tags: ['errors', 'typescript', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'throw { code: 404, message: "Not found" } is valid JS but cannot be caught with instanceof Error, has no stack trace, and breaks error monitoring tools that expect Error instances.',
      commonViolations: ["throw { code: 404, message: 'Not found' }", 'throw 404'],
      goodExample: "throw new NotFoundError('User not found')  // extends Error — has stack, instanceof",
      badExample: "throw { status: 404, message: 'Not found' }  // no stack, not an Error",
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('non_error_thrown', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bthrow\s+\{/.test(line) || /\bthrow\s+\d+/.test(line)) {
            findings.push({ severity, category: 'non_error_thrown', file: path, line: i + 1, message: 'Non-Error value thrown — no stack trace, no instanceof Error.', suggestion: 'throw new Error(message) or a custom Error subclass that includes the extra fields.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_013',
    category: 'error_boundary_missing_react',
    description: 'React component trees without an Error Boundary let rendering errors crash the entire app.',
    severity: 'HIGH',
    tags: ['errors', 'react', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without an Error Boundary, a JavaScript error in one component unmounts the entire React tree. Users see a blank screen. An Error Boundary catches the error and renders a fallback UI.',
      commonViolations: ['App component without <ErrorBoundary>', 'pages without ErrorBoundary wrapper'],
      goodExample: '<ErrorBoundary fallback={<ErrorPage />}><App /></ErrorBoundary>',
      badExample: '<React.StrictMode><App /></React.StrictMode>  // no error boundary — one throw = blank screen',
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_boundary_missing_react', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        if (!content.includes('ReactDOM.render') && !content.includes('createRoot') && !content.includes('<App')) return findings;
        if (content.includes('ErrorBoundary') || content.includes('componentDidCatch') || content.includes('error-boundary')) return findings;
        if (content.includes('createRoot(') || content.includes('ReactDOM.render(')) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (/createRoot|ReactDOM\.render/.test(lines[i]!)) {
              findings.push({ severity, category: 'error_boundary_missing_react', file: path, line: i + 1, message: 'App root rendered without an ErrorBoundary — render errors produce blank screens.', suggestion: 'Wrap <App /> in <ErrorBoundary fallback={<ErrorPage />}>.' });
              break;
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_014',
    category: 'catch_reassign_error',
    description: 'Reassigning the catch variable shadows the original error, making stack traces inaccessible.',
    severity: 'MEDIUM',
    tags: ['errors', 'quality'],
    sinceVersion: '3.0.0',
    explain: {
      why: "catch (err) { err = 'something went wrong'; throw err } loses the stack trace from the original error. The thrown value is now a string.",
      commonViolations: ['catch (err) { err = new Error("wrapped") }', 'catch (e) { e = formatError(e) }'],
      goodExample: 'catch (err) { const wrappedErr = new Error("Context", { cause: err }); throw wrappedErr; }',
      badExample: 'catch (e) { e = "friendly message"; throw e; }  // original stack lost',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('catch_reassign_error', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/}\s*catch\s*\(\s*(\w+)\s*\)/.test(line)) {
            const varName = line.match(/catch\s*\(\s*(\w+)\s*\)/)?.[1];
            if (varName) {
              const block = lines.slice(i + 1, Math.min(lines.length, i + 8)).join('\n');
              const reassignRe = new RegExp(`\\b${varName}\\s*=`);
              if (reassignRe.test(block)) {
                findings.push({ severity, category: 'catch_reassign_error', file: path, line: i + 1, message: 'catch variable reassigned — original error and stack trace lost.', suggestion: 'Use a new variable: const wrapped = new Error("...", { cause: err }); throw wrapped;' });
              }
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_015',
    category: 'error_status_mismatch',
    description: 'Returning a 200 OK with an error body is misleading — HTTP clients check status codes, not body shape.',
    severity: 'HIGH',
    tags: ['errors', 'api', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "res.status(200).json({ error: 'Not found' }) tells browsers and CDNs the request succeeded. Retry logic, caching, and monitoring all treat it as a success. HTTP status codes must reflect the actual outcome.",
      commonViolations: ["res.status(200).json({ error: 'Not found' })", "res.json({ success: false, error: msg })"],
      goodExample: "res.status(404).json({ error: 'Resource not found' })",
      badExample: "res.status(200).json({ error: 'User not found' })  // CDN caches it, client thinks it's OK",
      relatedPlaybooks: ['api-errors.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_status_mismatch', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/res\.(?:status\(200\)\.)?json\s*\(\s*\{[^}]*(?:\berror\b|\bfailed\b|\bfailure\b)/.test(line) && !line.includes('status(4') && !line.includes('status(5')) {
            findings.push({ severity, category: 'error_status_mismatch', file: path, line: i + 1, message: 'JSON response body contains error key but HTTP status appears to be 200 OK.', suggestion: 'Set an appropriate error status code: res.status(404).json({...}) or res.status(422).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_016',
    category: 'missing_finally_cleanup',
    description: 'Resources (connections, file handles, timers) opened in try blocks must be released in finally.',
    severity: 'HIGH',
    tags: ['errors', 'reliability', 'resources'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If a database connection or file handle is opened in a try block and the code throws, the resource leaks unless explicitly released in a finally block. Over time, leaked connections exhaust the pool.',
      commonViolations: ['const conn = await pool.connect(); try { ... } catch { ... }  // no finally'],
      goodExample: 'const conn = await pool.connect();\ntry { ... } finally { conn.release(); }',
      badExample: 'const client = await db.connect();\nconst result = await client.query(sql);\nawait client.release();  // never called if query throws',
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_finally_cleanup', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/const\s+\w+\s*=\s*await\s+\w+\.connect\(\)/.test(line) || /const\s+\w+\s*=\s*await\s+pool\.getConnection\(\)/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 20)).join('\n');
            if (block.includes('try {') && !block.includes('finally {') && !block.includes('finally{')) {
              findings.push({ severity, category: 'missing_finally_cleanup', file: path, line: i + 1, message: 'Database connection acquired but no finally block — connection leaks on error.', suggestion: 'Wrap usage in try { ... } finally { connection.release() } to ensure cleanup.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_017',
    category: 'sentry_capture_missing',
    description: 'Production apps without error monitoring (Sentry/Datadog) have no visibility into unhandled exceptions.',
    severity: 'MEDIUM',
    tags: ['errors', 'observability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without error monitoring, production crashes are invisible until users complain. Set up Sentry or equivalent to automatically capture unhandled exceptions with stack traces, user context, and breadcrumbs.',
      commonViolations: ['catch (err) { logger.error(err) }  // only visible in logs, not dashboard'],
      goodExample: 'catch (err) { Sentry.captureException(err, { extra: { userId, action } }); throw err; }',
      badExample: 'catch (err) { console.error(err) }  // no alerting, no stack aggregation',
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sentry_capture_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (content.includes('Sentry') || content.includes('captureException') || content.includes('datadogRum') || content.includes('@sentry')) return findings;
        if (!/catch\s*\(/.test(content)) return findings;
        const lines = content.split('\n');
        let catchCount = 0;
        for (const line of lines) {
          if (/}\s*catch\s*\(/.test(line)) catchCount++;
        }
        if (catchCount >= 3) {
          findings.push({ severity, category: 'sentry_capture_missing', file: path, message: 'Multiple catch blocks without error monitoring integration (Sentry/Datadog).', suggestion: 'Integrate Sentry: captureException(err) in global error handlers for production visibility.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_018',
    category: 'validation_error_generic',
    description: 'Returning generic "Validation failed" without field-level errors forces clients to guess what went wrong.',
    severity: 'MEDIUM',
    tags: ['errors', 'api', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'An API that returns { error: "Validation failed" } gives clients no information to render helpful UX. Field-level errors { errors: [{ field: "email", message: "Invalid format" }] } let the UI highlight the exact problem.',
      commonViolations: ['return { error: "Validation failed" }', 'throw new Error("Invalid input")'],
      goodExample: 'return { errors: result.error.flatten().fieldErrors }  // Zod flatten',
      badExample: 'return res.status(422).json({ error: "Validation failed" })  // useless to client forms',
      relatedPlaybooks: ['api-errors.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('validation_error_generic', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/['"](?:Validation failed|Invalid input|Bad request|Validation error)['"]\s*[,})]/.test(line) &&
              !/fieldErrors|flatten\(\)|field.*message|fields/.test(line)) {
            findings.push({ severity, category: 'validation_error_generic', file: path, line: i + 1, message: 'Generic validation error message — clients cannot determine which field failed.', suggestion: 'Return field-level errors: { errors: schema.safeParse(body).error.flatten().fieldErrors }.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_019',
    category: 'error_swallowed_in_map',
    description: 'Errors thrown inside .map() callbacks may be swallowed or cause partial results depending on the context.',
    severity: 'MEDIUM',
    tags: ['errors', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'In async .map() with Promise.all, one rejection rejects the whole array. In non-async .map(), a throw propagates normally but leaves the other map iterations incomplete. Use explicit error handling per item.',
      commonViolations: ['items.map(item => process(item))  // one failure = partial results'],
      goodExample: 'await Promise.allSettled(items.map(item => process(item)))  // collect successes and failures',
      badExample: 'const results = await Promise.all(items.map(processItem))  // one fail = all fail silently',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_swallowed_in_map', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/Promise\.all\s*\(.*\.map\s*\(async/.test(line) || (/Promise\.all\s*\(\s*\w+\.map/.test(line))) {
            if (!line.includes('allSettled') && !line.includes('catch')) {
              findings.push({ severity, category: 'error_swallowed_in_map', file: path, line: i + 1, message: 'Promise.all() over .map() fails entirely on first rejection — use allSettled() for partial success.', suggestion: 'Use Promise.allSettled() to collect both resolved values and rejected reasons.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_020',
    category: 'uncaught_async_iife',
    description: 'Immediately-invoked async functions without .catch() produce unhandled promise rejections.',
    severity: 'HIGH',
    tags: ['errors', 'async', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: '(async () => { await riskyThing() })() runs immediately. If riskyThing() throws, the rejection is unhandled. Always attach .catch() or wrap in a top-level awaited call.',
      commonViolations: ['(async () => { await init() })()', '(async function setup() { await db.connect() })()'],
      goodExample: '(async () => { await init() })().catch(err => { logger.error(err); process.exit(1) })',
      badExample: '(async () => { await connectToDatabase() })()  // rejection → process crash in Node.js 15+',
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('uncaught_async_iife', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\(async\s*(?:function)?\s*\w*\s*\(\s*\)/.test(line) && /\)\s*\(\s*\)/.test(line)) {
            if (!line.includes('.catch(')) {
              const next = lines[i + 1] ?? '';
              if (!next.trimStart().startsWith('.catch(')) {
                findings.push({ severity, category: 'uncaught_async_iife', file: path, line: i + 1, message: 'Async IIFE without .catch() — rejection becomes unhandled promise rejection.', suggestion: 'Add .catch(err => { logger.error(err); process.exit(1) }) to the IIFE.' });
              }
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_021',
    category: 'error_log_level_mismatch',
    description: 'Using logger.warn() for errors that should cause an alert trains on-call engineers to ignore warnings.',
    severity: 'LOW',
    tags: ['errors', 'observability', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Log levels are the contract between your app and your monitoring system. WARN should mean "degraded but functional." ERROR should trigger an alert. Misclassifying errors dilutes signal and creates alert fatigue.',
      commonViolations: ['logger.warn("Database connection failed")', 'logger.info(err)'],
      goodExample: 'logger.error({ err }, "Database connection failed")  // triggers alert\nlogger.warn({ retryCount }, "Retry attempt")  // informational',
      badExample: 'logger.warn("Payment processing failed")  // payment failures should be ERROR',
      relatedPlaybooks: ['observability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_log_level_mismatch', config.severityRules);
      const findings: Finding[] = [];
      const CRITICAL_RE = /(?:failed|exception|crash|fatal|error|corrupt|breach|unauthorized|forbidden)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/logger\.(?:warn|info)\s*\(/.test(line) && CRITICAL_RE.test(line)) {
            findings.push({ severity, category: 'error_log_level_mismatch', file: path, line: i + 1, message: 'Critical event logged at warn/info level — should be logger.error() to trigger alerts.', suggestion: 'Use logger.error() for conditions that represent unexpected failures or security events.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_022',
    category: 'unchecked_return_value',
    description: 'Ignoring return values from operations that signal failure through return (not throw) hides errors.',
    severity: 'MEDIUM',
    tags: ['errors', 'reliability', 'typescript'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Some APIs signal failure via return value (e.g. execSync returning exit code, or Result types). Ignoring the return value of a function that signals errors through its return type hides failures.',
      commonViolations: ['db.exec(sql)  // not awaited, return value not checked'],
      goodExample: 'const result = await db.exec(sql);\nif (!result.ok) throw new Error(result.error);',
      badExample: 'fs.promises.unlink(tempFile)  // rejection ignored — temp file leaks',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('unchecked_return_value', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/^\s+(?:fs\.promises\.\w+|prisma\.\w+\.delete|prisma\.\w+\.deleteMany)\(/.test(line) &&
              !line.includes('await') && !line.includes('return') && !line.includes('void ')) {
            findings.push({ severity, category: 'unchecked_return_value', file: path, line: i + 1, message: 'Async operation called without await — Promise rejected or return value ignored.', suggestion: 'await the operation or use void keyword if intentionally fire-and-forget (add .catch()).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_023',
    category: 'error_in_constructor',
    description: 'Async operations in constructors cannot be awaited, hiding initialization errors.',
    severity: 'MEDIUM',
    tags: ['errors', 'typescript', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Constructors cannot be async. Calling async operations inside them (this.init()) means errors are unhandled unless the caller separately awaits the returned promise. Use a static async factory method instead.",
      commonViolations: ['constructor() { this.connect() }  // connect is async', 'constructor() { db.init() }'],
      goodExample: 'static async create(): Promise<MyClass> { const instance = new MyClass(); await instance.connect(); return instance; }',
      badExample: 'constructor() { this.connect()  // rejection unhandled }',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_in_constructor', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        let inConstructor = false;
        let depth = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s+constructor\s*\(/.test(line)) { inConstructor = true; depth = 0; }
          if (inConstructor) {
            depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            if (depth <= 0 && i > 0) { inConstructor = false; continue; }
            if (/this\.\w+\(\)/.test(line) && !line.includes('super') && !line.includes('await') && !isCommentLine(line)) {
              const methodName = line.match(/this\.(\w+)\(\)/)?.[1];
              if (methodName && content.includes(`async ${methodName}(`)) {
                findings.push({ severity, category: 'error_in_constructor', file: path, line: i + 1, message: 'Async method called in constructor without await — errors are unhandled.', suggestion: 'Use a static async factory: static async create() { const obj = new X(); await obj.init(); return obj; }' });
              }
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_024',
    category: 'missing_error_serialization',
    description: 'Sending Error objects in JSON responses requires explicit serialization — Error.toJSON() is not automatic.',
    severity: 'MEDIUM',
    tags: ['errors', 'api', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'JSON.stringify(new Error("msg")) returns "{}". When you return an Error object in res.json(), the client receives an empty object. Serialize errors explicitly.',
      commonViolations: ['res.json({ error: err })', 'return { success: false, error: error }'],
      goodExample: 'res.json({ error: { message: err.message, code: (err as AppError).code } })',
      badExample: 'res.json({ error })  // JSON.stringify(error) === "{}" — client gets empty object',
      relatedPlaybooks: ['api-errors.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_error_serialization', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/res\.json\s*\(\s*\{[^}]*\berr(?:or)?\b[^}]*\}/.test(line) && !line.includes('.message') && !line.includes('.code') && !line.includes('message:')) {
            findings.push({ severity, category: 'missing_error_serialization', file: path, line: i + 1, message: 'Error object in res.json() — JSON.stringify(err) === "{}". Client receives empty object.', suggestion: 'Serialize explicitly: res.json({ error: { message: err.message, code: err.code } }).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ERR_025',
    category: 'missing_global_error_handler',
    description: 'Express apps without a global error-handling middleware leave unhandled errors returning raw stack traces.',
    severity: 'HIGH',
    tags: ['errors', 'api', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Express error-handling middleware (4-argument) catches all errors passed to next(err). Without it, Express sends a raw HTML error page with a stack trace — leaking file paths, module names, and code structure.',
      commonViolations: ['app.listen(3000)  // no error middleware defined'],
      goodExample: "app.use((err: Error, req: Request, res: Response, next: NextFunction) => { logger.error(err); res.status(500).json({ error: 'Internal server error' }); });",
      badExample: 'app.listen(3000)  // unhandled errors expose stack traces in HTML responses',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_global_error_handler', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('express()') || !content.includes('.listen(')) return findings;
        if (content.includes('err, req, res, next') || content.includes('err: Error') || content.includes('err, _req')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/\.listen\s*\(\d+/.test(lines[i]!)) {
            findings.push({ severity, category: 'missing_global_error_handler', file: path, line: i + 1, message: 'Express app without global error-handling middleware — unhandled errors leak stack traces.', suggestion: 'Add: app.use((err, req, res, next) => { logger.error(err); res.status(500).json({error:"Internal error"}) });' });
            break;
          }
        }
      }
      return findings;
    },
  },
];
