// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * AI Debt Fingerprinting Rules — DEBT_001–020
 *
 * Detects structural debt patterns that AI-generated code commonly introduces:
 * duplication, missing tests, silenced errors, vague names, complexity spikes.
 * These patterns pass linters and compile cleanly but accumulate invisible
 * maintenance cost — GitClear 2025 found 8x code duplication and 41% complexity
 * increase in AI-assisted projects.
 *
 * These rules complement traditional linting by catching the *shape* of AI output,
 * not just style violations.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path) ||
    /\/__tests__\//.test(path) ||
    /\/test\//.test(path);
}

function isSourceFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path);
}

/** Extract normalized function/method body for similarity comparison. */
function normalizeFunctionBody(body: string): string {
  return body
    .replace(/\/\/[^\n]*/g, '') // strip comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

/** Simple body-line extraction for functions. Returns content between first { and matching }. */
function extractFunctionBodies(content: string): Array<{ name: string; body: string; line: number }> {
  const bodies: Array<{ name: string; body: string; line: number }> = [];
  const lines = content.split('\n');

  const FUNC_RE = /(?:(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\()/;

  for (let i = 0; i < lines.length; i++) {
    const m = FUNC_RE.exec(lines[i]!);
    if (!m) continue;
    const name = m[1] ?? m[2] ?? 'anonymous';

    // Find opening brace
    let startLine = i;
    let braceIdx = lines[i]!.indexOf('{');
    if (braceIdx === -1) {
      // Look ahead a few lines
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        braceIdx = lines[j]!.indexOf('{');
        if (braceIdx !== -1) { startLine = j; break; }
      }
    }
    if (braceIdx === -1) continue;

    // Collect body until matching closing brace
    let depth = 0;
    const bodyLines: string[] = [];
    for (let k = startLine; k < lines.length; k++) {
      const line = lines[k]!;
      for (const ch of line) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      bodyLines.push(line);
      if (depth === 0 && bodyLines.length > 1) break;
      if (bodyLines.length > 300) break; // skip huge functions
    }

    if (bodyLines.length >= 10) {
      bodies.push({ name, body: normalizeFunctionBody(bodyLines.join('\n')), line: i + 1 });
    }
  }

  return bodies;
}

/** Approximate similarity ratio between two strings (0–1). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const minLen = Math.min(a.length, b.length);
  if (minLen === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  // Count matching characters in a sliding window
  let matches = 0;
  const step = Math.max(1, Math.floor(minLen / 50));
  for (let i = 0; i < minLen; i += step) {
    if (a[i] === b[i]) matches++;
  }
  const samples = Math.ceil(minLen / step);
  return (matches / samples) * (minLen / maxLen);
}

export const DEBT_RULES: ThesmosRule[] = [
  {
    id: 'DEBT_001',
    category: 'debt_duplicate_function_body',
    description: 'Two or more functions in the same file share a highly similar body (≥80%) — AI-generated code duplication.',
    severity: 'HIGH',
    tags: ['ai-debt', 'duplication', 'maintainability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools routinely copy-paste function logic with minor variations. GitClear 2025 found 8x more duplicated code in AI-assisted projects. Duplicated logic means bugs must be fixed in multiple places and understanding the code requires reading all copies.',
      commonViolations: [
        'createUser() and registerUser() with 90% identical bodies',
        'validateInput() and sanitizeInput() that do the same thing',
      ],
      goodExample: 'Extract shared logic into a named helper function and call it from both places.',
      badExample: '// Two functions with identical validation logic',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_duplicate_function_body', config.severityRules);
      const findings: Finding[] = [];

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        const bodies = extractFunctionBodies(content);
        if (bodies.length < 2) continue;

        const reported = new Set<string>();
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i]!, b = bodies[j]!;
            if (a.body.length < 200) continue; // too short to matter
            const sim = similarity(a.body, b.body);
            if (sim >= 0.80) {
              const key = `${a.name}:${b.name}`;
              if (reported.has(key)) continue;
              reported.add(key);
              findings.push({
                severity: sev,
                category: 'debt_duplicate_function_body',
                file: path, line: a.line,
                message: `"${a.name}" and "${b.name}" have ~${Math.round(sim * 100)}% similar bodies — extract shared logic into a helper.`,
                suggestion: 'Refactor the shared logic into a single function. Duplication is a common AI-generation artifact.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_002',
    category: 'debt_exported_function_no_test',
    description: 'New exported function has no corresponding test — AI-generated functions are often untested.',
    severity: 'HIGH',
    tags: ['ai-debt', 'testing', 'coverage'],
    sinceVersion: '1.2.0',
    explain: {
      why: '76% of developers report generating code they don\'t fully understand. Untested exported functions are black boxes — they may look correct but fail on edge cases. AI tools often forget to generate tests alongside the code they produce.',
      commonViolations: [
        'export function parseUserData() — no parseUserData.test.ts',
        'export const validateSchema = () => ... — no test file references it',
      ],
      goodExample: '// Always generate tests alongside exported functions',
      badExample: 'export function processPayment() {} // ❌ no test file',
      relatedPlaybooks: ['testing.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_exported_function_no_test', config.severityRules);
      const findings: Finding[] = [];
      const EXPORT_FUNC_RE = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
      const EXPORT_CONST_FUNC_RE = /^export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/gm;

      // Collect all test file content in one pass
      const testContent = changedFiles
        .filter((f) => isTestFile(f.path))
        .map((f) => f.content)
        .join('\n');

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;

        const exportedFns: Array<{ name: string; line: number }> = [];
        let m: RegExpExecArray | null;

        const re1 = new RegExp(EXPORT_FUNC_RE.source, 'gm');
        while ((m = re1.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          exportedFns.push({ name: m[1]!, line: lineNum });
        }

        const re2 = new RegExp(EXPORT_CONST_FUNC_RE.source, 'gm');
        while ((m = re2.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          exportedFns.push({ name: m[1]!, line: lineNum });
        }

        for (const { name, line } of exportedFns) {
          // Skip very short or common framework-pattern names
          if (name.length < 4) continue;
          if (/^(default|App|Page|Layout|Component|Provider|Context)$/i.test(name)) continue;
          if (!testContent.includes(name)) {
            findings.push({
              severity: sev,
              category: 'debt_exported_function_no_test',
              file: path, line,
              message: `Exported function "${name}" has no test coverage in changed files.`,
              suggestion: `Add tests for "${name}" in a *.test.ts file. AI-generated functions are commonly exported but never tested.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_003',
    category: 'debt_file_complexity_spike',
    description: 'File exceeds 400 lines — AI often generates monolithic files instead of modular code.',
    severity: 'MEDIUM',
    tags: ['ai-debt', 'complexity', 'maintainability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI models have a context window bias toward generating complete solutions in one place. This produces files that are too large to understand, review, or safely modify. The 400-line threshold identifies files where a human review becomes impractical.',
      commonViolations: [
        'A 600-line auth.ts containing routes, validation, DB calls, and error handling',
        'A single component file with 500+ lines of JSX and business logic',
      ],
      goodExample: '// Split into: auth-routes.ts, auth-service.ts, auth-validation.ts',
      badExample: '// auth.ts — 600 lines doing everything',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_file_complexity_spike', config.severityRules);
      const findings: Finding[] = [];
      const THRESHOLD = 400;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        const lineCount = content.split('\n').length;
        if (lineCount > THRESHOLD) {
          findings.push({
            severity: sev,
            category: 'debt_file_complexity_spike',
            file: path,
            message: `File has ${lineCount} lines — exceeds the ${THRESHOLD}-line maintainability threshold.`,
            suggestion: `Split "${path}" into smaller, focused modules. AI often generates monolithic files — refactor into separate concerns.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_004',
    category: 'debt_api_no_error_response_type',
    description: 'API route handler returns a response type but no error response type is defined.',
    severity: 'HIGH',
    tags: ['ai-debt', 'api', 'typing'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI-generated API handlers often define happy-path response types but omit error response types. This means clients have no way to handle errors correctly, and TypeScript won\'t catch missing error cases.',
      commonViolations: [
        'async function getUser(): Promise<User> — no | ErrorResponse',
        'NextResponse.json(data) — no NextResponse.json({ error: ... })',
      ],
      goodExample: 'async function getUser(): Promise<User | ApiError>',
      badExample: 'async function getUser(): Promise<User>  // ❌ no error type',
      relatedPlaybooks: ['api-design.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_api_no_error_response_type', config.severityRules);
      const findings: Finding[] = [];
      const ROUTE_RE = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s*\(/gm;
      const RETURN_TYPE_RE = /:\s*Promise<([^>]+)>/;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path)) continue;
        if (!/\/(?:api|routes?|handlers?)\//i.test(path) && !path.includes('route.ts')) continue;

        let m: RegExpExecArray | null;
        const re = new RegExp(ROUTE_RE.source, 'gm');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          const snippet = content.slice(m.index, m.index + 200);
          const typeMatch = RETURN_TYPE_RE.exec(snippet);
          if (typeMatch) {
            const returnType = typeMatch[1]!;
            if (!returnType.includes('Error') && !returnType.includes('| ') && returnType !== 'void' && returnType !== 'Response') {
              findings.push({
                severity: sev,
                category: 'debt_api_no_error_response_type',
                file: path, line: lineNum,
                message: `Route handler "${m[1]}" returns \`${returnType}\` with no error response type.`,
                suggestion: `Add an error response type: \`Promise<${returnType} | ApiError>\` and handle error cases explicitly.`,
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_005',
    category: 'debt_swallowed_error',
    description: 'Error is caught and silently discarded — hidden failure that produces incorrect behavior in production.',
    severity: 'HIGH',
    tags: ['ai-debt', 'error-handling', 'reliability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools frequently generate `catch(e) {}` or `catch(_) {}` to suppress TypeScript errors without actually handling them. These silent failures hide bugs in production and make debugging impossible.',
      commonViolations: [
        'catch(e) {}  // ❌ completely swallows the error',
        'catch(_err) { return null; }  // ❌ hides the failure',
        '.catch(() => {})  // ❌ promise error discarded',
      ],
      goodExample: 'catch(error) {\n  logger.error("Operation failed", { error });\n  throw error;\n}',
      badExample: 'catch(e) {} // ❌ silently swallowed',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_swallowed_error', config.severityRules);
      const findings: Finding[] = [];
      const SWALLOW_RE = /\}\s*catch\s*\(\s*(?:e|_|_e|_err|_error|err|error)?\s*\)\s*\{\s*\}/g;
      const PROMISE_SWALLOW_RE = /\.catch\s*\(\s*\(\s*(?:e|_|_e|_err)?\s*\)\s*=>\s*\{\s*\}\s*\)/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path)) continue;
        let m: RegExpExecArray | null;

        const re1 = new RegExp(SWALLOW_RE.source, 'g');
        while ((m = re1.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          findings.push({
            severity: sev,
            category: 'debt_swallowed_error',
            file: path, line: lineNum,
            message: 'Error caught and silently discarded — this hides failures in production.',
            suggestion: 'At minimum log the error: `catch(error) { logger.error("...", { error }); }` or re-throw it.',
          });
        }

        const re2 = new RegExp(PROMISE_SWALLOW_RE.source, 'g');
        while ((m = re2.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          findings.push({
            severity: sev,
            category: 'debt_swallowed_error',
            file: path, line: lineNum,
            message: 'Promise rejection caught and silently discarded.',
            suggestion: 'Handle the rejection: `.catch((error) => { logger.error(error); })` or remove `.catch` if the caller handles it.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_006',
    category: 'debt_vague_variable_name',
    description: 'Production code uses a semantically empty variable name — common in AI-generated code.',
    severity: 'LOW',
    tags: ['ai-debt', 'readability', 'maintainability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools often generate placeholder variable names like `data`, `result`, `response`, `temp`, or `item` in business logic. These names convey no information about the variable\'s purpose and make code harder to understand and maintain.',
      commonViolations: [
        'const result = await fetchUser(id);',
        'const data = response.json();',
        'const item = items[0];',
      ],
      goodExample: 'const user = await fetchUser(id);\nconst parsedResponse = response.json();',
      badExample: 'const result = await fetchUser(id); // ❌ vague name',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_vague_variable_name', config.severityRules);
      const findings: Finding[] = [];
      const VAGUE_RE = /\b(?:const|let|var)\s+(result|data|response|temp|item|val|value|obj|arr|ret)\s*=/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(VAGUE_RE.source, 'g');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          findings.push({
            severity: sev,
            category: 'debt_vague_variable_name',
            file: path, line: lineNum,
            message: `Variable named "${m[1]}" in production code — use a name that describes the value's meaning.`,
            suggestion: `Replace "${m[1]}" with a descriptive name (e.g., \`user\`, \`apiResponse\`, \`parsedConfig\`).`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_007',
    category: 'debt_commented_out_block',
    description: 'Commented-out code block (5+ consecutive lines) — AI leftover that obscures intent.',
    severity: 'MEDIUM',
    tags: ['ai-debt', 'readability', 'maintainability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools often leave large commented-out code blocks as "alternatives" or "old versions". These blocks obscure the file structure, may contain outdated or incorrect implementations, and create confusion about what the active code actually does.',
      commonViolations: [
        '// Old implementation:\n// const user = ...\n// await user.save();\n// ...',
        '/* Previous approach — keeping for reference */\n// function oldAuth() { ... }',
      ],
      goodExample: 'Delete dead code. Use git history to recover it if needed.',
      badExample: '// Old approach:\n// const x = ...\n// ...\n// (6 more lines)\n// Keep for reference',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_commented_out_block', config.severityRules);
      const findings: Finding[] = [];

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path)) continue;
        const lines = content.split('\n');
        let commentRunStart = -1;
        let commentRunLen = 0;
        let isJsDocBlock = false;

        const emitCommentBlock = (startLine: number, len: number) => {
          if (len < 5) return;
          // Skip JSDoc blocks (/** ... */) — they legitimately contain @example code snippets
          if (isJsDocBlock) return;
          const block = lines.slice(startLine, startLine + len).join('\n');
          if (/(?:const|let|var|function|return|await|if\s*\(|for\s*\()/.test(block)) {
            findings.push({
              severity: sev,
              category: 'debt_commented_out_block',
              file: path, line: startLine + 1,
              message: `${len}-line commented-out code block — likely an AI leftover or dead code.`,
              suggestion: 'Remove commented-out code blocks. Use git history or branches to preserve old implementations.',
            });
          }
        };

        for (let i = 0; i < lines.length; i++) {
          const trimmed = (lines[i] ?? '').trim();
          const isCommentLine = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
          if (isCommentLine) {
            if (commentRunStart === -1) {
              commentRunStart = i;
              isJsDocBlock = trimmed.startsWith('/**');
            }
            commentRunLen++;
          } else {
            emitCommentBlock(commentRunStart, commentRunLen);
            commentRunStart = -1;
            commentRunLen = 0;
            isJsDocBlock = false;
          }
        }
        // Catch blocks that run to end of file
        emitCommentBlock(commentRunStart, commentRunLen);
      }
      return findings;
    },
  },

  {
    id: 'DEBT_008',
    category: 'debt_type_assertion_any',
    description: '`as any` or `as unknown as X` type assertion in non-test file — AI bypassing the type system.',
    severity: 'MEDIUM',
    tags: ['ai-debt', 'typescript', 'type-safety'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools use `as any` as an escape hatch when they can\'t satisfy TypeScript. These assertions defeat the type system and hide bugs that TypeScript would otherwise catch. Each `as any` is a place where the type contract is silently broken.',
      commonViolations: [
        'const user = response as any;',
        'return data as unknown as User;',
        '(callback as any)()',
      ],
      goodExample: 'Use proper typing, generics, or type guards instead of assertions.',
      badExample: 'const user = response as any; // ❌ bypasses type system',
      relatedPlaybooks: ['typescript.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_type_assertion_any', config.severityRules);
      const findings: Finding[] = [];
      const AS_ANY_RE = /\bas\s+any\b|\bas\s+unknown\s+as\b/g;

      for (const { path, content } of changedFiles) {
        if (!/\.tsx?$/.test(path)) continue;
        if (isTestFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(AS_ANY_RE.source, 'g');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          findings.push({
            severity: sev,
            category: 'debt_type_assertion_any',
            file: path, line: lineNum,
            message: `Type assertion \`${m[0]}\` bypasses the TypeScript type system.`,
            suggestion: 'Use proper typing, generics, or a type guard instead. If unavoidable, add a comment explaining why.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_009',
    category: 'debt_hardcoded_url',
    description: 'Hardcoded URL in business logic — should be an environment variable.',
    severity: 'HIGH',
    tags: ['ai-debt', 'configuration', 'security'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools often hardcode URLs like `http://localhost:3000/api` or `https://api.example.com/v1` directly in source. These URLs change between environments, get committed to git (exposing internal architecture), and require code changes instead of config changes to deploy.',
      commonViolations: [
        'fetch("http://localhost:3000/api/users")',
        'const API_URL = "https://api.example.com/v1"',
        'axios.get("https://auth.service.internal/token")',
      ],
      goodExample: 'fetch(process.env.API_BASE_URL + "/users")',
      badExample: 'fetch("http://localhost:3000/api/users") // ❌ hardcoded URL',
      relatedPlaybooks: ['configuration.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_hardcoded_url', config.severityRules);
      const findings: Finding[] = [];
      // Match hardcoded http/https URLs that aren't in comments or import statements
      const URL_RE = /(?<![/\s*])["'`](https?:\/\/(?!schemas\.|json-schema\.|w3\.org)[^"'`\s]{5,})["'`]/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(URL_RE.source, 'g');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          const lineContent = content.split('\n')[lineNum - 1] ?? '';
          // Skip comment lines
          if (lineContent.trim().startsWith('//') || lineContent.trim().startsWith('*')) continue;
          // Skip schema URLs, documentation URLs
          const url = m[1] ?? '';
          if (/schema|documentation|example\.com|placeholder|your-domain/i.test(url)) continue;
          findings.push({
            severity: sev,
            category: 'debt_hardcoded_url',
            file: path, line: lineNum,
            message: `Hardcoded URL "${url}" in source — use an environment variable instead.`,
            suggestion: `Replace with \`process.env.API_BASE_URL\` or similar env var. Store the URL in .env files.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_010',
    category: 'debt_console_log_object_dump',
    description: '`console.log` dumping an object in production code — debug artifact from AI-generated code.',
    severity: 'MEDIUM',
    tags: ['ai-debt', 'logging', 'debug'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools add `console.log(someObject)` or `console.log("Debug:", data)` as debugging aids during generation. These log statements survive code review because they\'re syntactically valid, but they leak implementation details and pollute production logs.',
      commonViolations: [
        'console.log("user data:", userData)',
        'console.log({ token, expiresAt })',
        'console.log("DEBUG:", response)',
      ],
      goodExample: '// Use a structured logger: logger.debug("user loaded", { userId })',
      badExample: 'console.log("DEBUG:", userData) // ❌ debug artifact',
      relatedPlaybooks: ['logging.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_console_log_object_dump', config.severityRules);
      const findings: Finding[] = [];
      const CONSOLE_OBJ_RE = /console\.(?:log|debug|info|warn)\s*\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`)?\s*,?\s*(?:\{|\w+(?:\.\w+)+|\w+)\s*\)/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(CONSOLE_OBJ_RE.source, 'g');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          findings.push({
            severity: sev,
            category: 'debt_console_log_object_dump',
            file: path, line: lineNum,
            message: 'Object dumped with console.log in production code — use a structured logger or remove.',
            suggestion: 'Replace with a structured logger call or delete. console.log leaks implementation details in production.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_011',
    category: 'debt_magic_number',
    description: 'Magic number in business logic — unnamed constant that obscures intent.',
    severity: 'LOW',
    tags: ['ai-debt', 'readability', 'maintainability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools insert magic numbers (like `3600`, `86400`, `255`, `1024`) without naming them. These numbers have no self-documenting meaning and make the code fragile — if the value needs to change, it\'s unclear where all instances are.',
      commonViolations: [
        'if (age > 18) return true;',
        'const expires = Date.now() + 3600000;',
        'if (password.length < 8) throw new Error(...);',
      ],
      goodExample: 'const SESSION_EXPIRY_MS = 60 * 60 * 1000;\nconst expires = Date.now() + SESSION_EXPIRY_MS;',
      badExample: 'const expires = Date.now() + 3600000; // ❌ magic number',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_magic_number', config.severityRules);
      const findings: Finding[] = [];
      // Match large numbers (>= 100) that appear in comparisons or arithmetic, not in array access
      const MAGIC_RE = /(?:[+\-*\/]|[<>=!]=?|return)\s*((?:\d{3,}|\d+\.\d+))\b(?!\s*[,\]]\s*)/g;
      const SAFE_NUMBERS = new Set(['100', '200', '201', '204', '400', '401', '403', '404', '500', '1000', '1024']);

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(MAGIC_RE.source, 'g');
        while ((m = re.exec(content)) !== null) {
          const num = m[1]!;
          if (SAFE_NUMBERS.has(num)) continue;
          if (/^[01]$/.test(num)) continue; // 0 and 1 are not magic
          const lineNum = content.slice(0, m.index).split('\n').length;
          const line = content.split('\n')[lineNum - 1] ?? '';
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
          // Skip UPPER_SNAKE_CASE constant definitions — naming the constant IS the fix
          if (/\bconst\s+[A-Z][A-Z0-9_]+\s*=/.test(line)) continue;
          findings.push({
            severity: sev,
            category: 'debt_magic_number',
            file: path, line: lineNum,
            message: `Magic number ${num} — define it as a named constant.`,
            suggestion: `Replace ${num} with a named constant: \`const THRESHOLD = ${num};\``,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_012',
    category: 'debt_deep_nesting',
    description: 'Code has 4+ levels of nesting (if/for/try) — complexity spike common in AI-generated logic.',
    severity: 'MEDIUM',
    tags: ['ai-debt', 'complexity', 'readability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI models generate deeply nested control flow when handling multiple conditions inline. Code with 4+ nesting levels is hard to follow, hard to test, and hard to refactor. The fix is usually early returns, guard clauses, or extracted functions.',
      commonViolations: [
        'if (user) { if (user.profile) { if (user.profile.settings) { ... } } }',
        'for (const x of items) { for (const y of x.children) { if (y.active) { try { ... } } } }',
      ],
      goodExample: '// Use early returns and guard clauses instead of deep nesting',
      badExample: 'if (a) { if (b) { if (c) { if (d) { doSomething(); } } } } // ❌ 4+ levels',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_deep_nesting', config.severityRules);
      const findings: Finding[] = [];
      const MAX_DEPTH = 4;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        const lines = content.split('\n');
        let depth = 0;
        let deepStart = -1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const opens  = (line.match(/\{/g) ?? []).length;
          const closes = (line.match(/\}/g) ?? []).length;
          const oldDepth = depth;
          depth += opens - closes;

          if (oldDepth < MAX_DEPTH && depth >= MAX_DEPTH && deepStart === -1) {
            deepStart = i + 1;
          }
          if (depth < MAX_DEPTH && deepStart !== -1) {
            findings.push({
              severity: sev,
              category: 'debt_deep_nesting',
              file: path, line: deepStart,
              message: `Code reaches ${MAX_DEPTH}+ nesting levels — consider early returns or extracted functions.`,
              suggestion: 'Flatten with guard clauses: `if (!condition) return;` instead of nesting inside the condition.',
            });
            deepStart = -1;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_013',
    category: 'debt_todo_fixme_no_ticket',
    description: 'TODO/FIXME comment without a ticket reference — AI-generated reminder that will never be addressed.',
    severity: 'LOW',
    tags: ['ai-debt', 'maintainability', 'tracking'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools add TODO and FIXME comments as placeholders when they\'re uncertain about an implementation. Without a ticket reference, these comments have no owner, no deadline, and no tracking. They accumulate over time and are never resolved.',
      commonViolations: [
        '// TODO: handle error case',
        '// FIXME: this is broken',
        '// TODO: add validation',
      ],
      goodExample: '// TODO(JIRA-1234): handle the case where token is expired',
      badExample: '// TODO: handle error case  // ❌ no ticket, no owner',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_todo_fixme_no_ticket', config.severityRules);
      const findings: Finding[] = [];
      const TODO_RE = /\/\/\s*(?:TODO|FIXME|HACK|XXX)\s*(?!\([^)]+\):)(.{0,60})/gi;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(TODO_RE.source, 'gi');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          findings.push({
            severity: sev,
            category: 'debt_todo_fixme_no_ticket',
            file: path, line: lineNum,
            message: `TODO/FIXME without a ticket reference: "${m[0].trim()}"`,
            suggestion: 'Add a ticket reference: `// TODO(TICKET-123): description` so this has an owner and deadline.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_014',
    category: 'debt_unused_import',
    description: 'Import statement where the imported name is not used in the file — AI import bloat.',
    severity: 'LOW',
    tags: ['ai-debt', 'cleanup', 'maintainability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools frequently import more than they use — they import the whole module or multiple named exports but only reference some. Unused imports increase bundle size, confuse readers, and slow TypeScript compilation.',
      commonViolations: [
        'import { useState, useEffect, useCallback } from "react"  // only useState used',
        'import _ from "lodash"  // never referenced in file',
      ],
      goodExample: 'Import only what you use.',
      badExample: 'import { a, b, c } from "module";  // only a is used',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_unused_import', config.severityRules);
      const findings: Finding[] = [];
      const NAMED_IMPORT_RE = /^import\s*\{([^}]+)\}\s*from\s*['"`][^'"`]+['"`]/gm;

      for (const { path, content } of changedFiles) {
        if (!/\.tsx?$/.test(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(NAMED_IMPORT_RE.source, 'gm');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          const imports = (m[1] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/).pop()?.trim() ?? '').filter(Boolean);
          // Remove the import statement itself from the content being searched
          const bodyStart = m.index + m[0].length;
          const body = content.slice(bodyStart);
          for (const name of imports) {
            if (!name || name.length < 2) continue;
            // Skip type-only imports (commonly unused in JS but needed for TS)
            const re2 = new RegExp(`\\b${name}\\b`);
            if (!re2.test(body)) {
              findings.push({
                severity: sev,
                category: 'debt_unused_import',
                file: path, line: lineNum,
                message: `"${name}" is imported but not used in this file.`,
                suggestion: `Remove "${name}" from the import statement, or use it.`,
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_015',
    category: 'debt_missing_finally_resource',
    description: 'try/catch opens a resource (file, connection, lock) without a finally block — resource leak.',
    severity: 'MEDIUM',
    tags: ['ai-debt', 'reliability', 'resource-management'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools generate try/catch blocks for resource operations but frequently omit the finally clause needed to release the resource on both success and failure paths. This causes file handles, database connections, or locks to leak.',
      commonViolations: [
        'const file = fs.openSync(path); try { ... } catch (e) { ... }  // ❌ no finally',
        'await db.connect(); try { ... } catch { ... }  // ❌ connection never released',
      ],
      goodExample: 'try { ... } catch { ... } finally { file.close(); }',
      badExample: 'const conn = await db.connect();\ntry { ... }\ncatch { ... }\n// ❌ conn never closed',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_missing_finally_resource', config.severityRules);
      const findings: Finding[] = [];
      const RESOURCE_OPEN_RE = /(?:open(?:Sync)?|connect|createConnection|createPool|lock|acquire)\s*\(/;
      const TRY_BLOCK_RE = /\btry\s*\{/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(TRY_BLOCK_RE.source, 'g');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          // Look at 5 lines before the try to find a resource open
          const before = content.slice(Math.max(0, m.index - 300), m.index);
          if (!RESOURCE_OPEN_RE.test(before)) continue;
          // Check if there's a finally after this try block
          const after = content.slice(m.index, m.index + 500);
          if (!after.includes('finally')) {
            findings.push({
              severity: sev,
              category: 'debt_missing_finally_resource',
              file: path, line: lineNum,
              message: 'try/catch block near resource acquisition has no finally — resource may leak on error.',
              suggestion: 'Add a finally block: `finally { resource.close(); }` to ensure cleanup on both success and failure paths.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_016',
    category: 'debt_exponential_loop',
    description: 'Nested loop over the same or similar collections — O(n²) or worse time complexity.',
    severity: 'HIGH',
    tags: ['ai-debt', 'performance', 'complexity'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools generate nested loops as the "obvious" solution to many problems. For small datasets this works, but in production with larger inputs it causes exponential slowdowns. A nested for-of loop is the most common O(n²) pattern in AI-generated code.',
      commonViolations: [
        'for (const a of items) { for (const b of items) { ... } }',
        'for (let i = 0; i < arr.length; i++) { for (let j = 0; j < arr.length; j++) { ... } }',
      ],
      goodExample: '// Use a Map or Set for O(n) lookup instead of nested loops',
      badExample: 'for (const a of users) { for (const b of users) { ... } } // ❌ O(n²)',
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_exponential_loop', config.severityRules);
      const findings: Finding[] = [];
      const FOR_OF_RE = /\bfor\s*\((?:const|let|var)\s+\w+\s+of\s+(\w+)\)/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;

        // Check for nested for-of loops
        const forOfPositions: Array<{ pos: number; collection: string; line: number }> = [];
        const re1 = new RegExp(FOR_OF_RE.source, 'g');
        while ((m = re1.exec(content)) !== null) {
          forOfPositions.push({
            pos: m.index,
            collection: m[1]!,
            line: content.slice(0, m.index).split('\n').length,
          });
        }

        for (let i = 0; i < forOfPositions.length - 1; i++) {
          const outer = forOfPositions[i]!;
          const inner = forOfPositions[i + 1]!;
          // If the inner loop starts within 300 chars of the outer loop
          if (inner.pos - outer.pos < 300) {
            findings.push({
              severity: sev,
              category: 'debt_exponential_loop',
              file: path, line: outer.line,
              message: `Nested for-of loops over "${outer.collection}" — likely O(n²) time complexity.`,
              suggestion: 'Use a Map or Set for O(1) lookup instead of a nested loop. Example: build a Set first, then do set.has(item).',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_017',
    category: 'debt_dead_code_return',
    description: 'Code after a return statement in the same block — unreachable AI-generated code.',
    severity: 'MEDIUM',
    tags: ['ai-debt', 'correctness', 'cleanup'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools sometimes generate code that continues after a return statement — often an alternate implementation or forgotten removal. This dead code creates confusion about what the function actually does.',
      commonViolations: [
        'return user;\nconst processed = transform(user);  // never reached',
        'return res.json(data);\nres.status(200).json(data);  // never reached',
      ],
      goodExample: '// Remove all code after a return statement',
      badExample: 'return result;\nconst extra = process(result); // ❌ unreachable',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_dead_code_return', config.severityRules);
      const findings: Finding[] = [];
      const RETURN_RE = /^\s*return\s+.+;/;
      const CODE_RE   = /^\s*(?:const|let|var|if|for|while|throw|await|[a-zA-Z_$])\b/;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          if (!RETURN_RE.test(lines[i]!)) continue;
          const next = (lines[i + 1] ?? '').trim();
          if (next && CODE_RE.test(lines[i + 1]!)) {
            findings.push({
              severity: sev,
              category: 'debt_dead_code_return',
              file: path, line: i + 2,
              message: 'Unreachable code after return statement — AI-generated dead code.',
              suggestion: 'Remove the unreachable code or move it before the return statement.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_018',
    category: 'debt_magic_regex',
    description: 'Complex regex literal with no comment or descriptive variable name explaining its intent.',
    severity: 'LOW',
    tags: ['ai-debt', 'readability', 'maintainability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools generate complex regex patterns inline without any explanation of what they match. Unnamedregexes are nearly impossible to maintain, modify, or verify for correctness.',
      commonViolations: [
        '/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(email)',
        'str.replace(/[\\u0000-\\u001F\\u007F-\\u009F]/g, "")',
      ],
      goodExample: 'const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;  // RFC 5322',
      badExample: '/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(v) // ❌ no explanation',
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_magic_regex', config.severityRules);
      const findings: Finding[] = [];
      // Match regex literals with 15+ chars (complex) that are used directly (not in a named const)
      const INLINE_REGEX_RE = /(?<!\w\s*=\s*)\/([^/\n]{15,})\/[gimsuy]*/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(INLINE_REGEX_RE.source, 'g');
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          const lineContent = content.split('\n')[lineNum - 1] ?? '';
          // Skip if the line is a const/let assignment (regex is named)
          if (/(?:const|let|var)\s+\w+\s*=\s*\//.test(lineContent)) continue;
          // Skip if there's a comment on the same line
          if (/\/\//.test(lineContent.slice(lineContent.indexOf(m[0])))) continue;
          findings.push({
            severity: sev,
            category: 'debt_magic_regex',
            file: path, line: lineNum,
            message: 'Complex regex used inline without explanation — extract to a named constant with a comment.',
            suggestion: `Extract: \`const PATTERN = /${m[1]}/;  // describe what this matches\``,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_019',
    category: 'debt_catch_returns_null',
    description: 'catch block returns null/undefined instead of handling or rethrowing — silent failure propagation.',
    severity: 'HIGH',
    tags: ['ai-debt', 'error-handling', 'reliability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'A step beyond swallowed errors: `catch { return null }` is a common AI pattern that silently converts exceptions into null values. The caller then needs to null-check everything and can never know if null means "not found" or "something failed".',
      commonViolations: [
        'catch(e) { return null; }',
        'catch(err) { return undefined; }',
        '.catch(() => null)',
      ],
      goodExample: 'catch(error) {\n  if (error instanceof NotFoundError) return null;\n  throw error;  // re-throw unexpected errors\n}',
      badExample: 'catch(e) { return null; } // ❌ converts all errors to null',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_catch_returns_null', config.severityRules);
      const findings: Finding[] = [];
      const CATCH_NULL_RE = /\}\s*catch\s*\([^)]*\)\s*\{\s*return\s+(?:null|undefined|false|0)\s*;\s*\}/g;
      const PROMISE_NULL_RE = /\.catch\s*\(\s*(?:\([^)]*\)|[^=])\s*=>\s*(?:null|undefined|false)\s*\)/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;

        const re1 = new RegExp(CATCH_NULL_RE.source, 'g');
        while ((m = re1.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          findings.push({
            severity: sev,
            category: 'debt_catch_returns_null',
            file: path, line: lineNum,
            message: 'catch block returns null — converts all errors to null, hiding the failure from callers.',
            suggestion: 'Only return null for expected "not found" cases; rethrow unexpected errors: `if (error instanceof NotFoundError) return null; throw error;`',
          });
        }

        const re2 = new RegExp(PROMISE_NULL_RE.source, 'g');
        while ((m = re2.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          findings.push({
            severity: sev,
            category: 'debt_catch_returns_null',
            file: path, line: lineNum,
            message: 'Promise rejection mapped to null — swallows the error from the promise chain.',
            suggestion: 'Remove `.catch(() => null)` and let the caller handle the rejection, or handle specific error types.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'DEBT_020',
    category: 'debt_over_parameterized_function',
    description: 'Function has 5+ parameters — AI-generated function that should use a config object.',
    severity: 'LOW',
    tags: ['ai-debt', 'api-design', 'maintainability'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools generate functions with long parameter lists when they don\'t know the codebase\'s conventions. Functions with 5+ positional parameters are difficult to call correctly, impossible to extend without breaking callers, and a maintenance burden.',
      commonViolations: [
        'function createUser(name, email, role, org, permissions, createdAt)',
        'function fetchData(url, method, body, headers, timeout, retries)',
      ],
      goodExample: 'function createUser(options: CreateUserOptions)',
      badExample: 'function createUser(name, email, role, org, permissions, createdAt) // ❌ 6 params',
      relatedPlaybooks: ['api-design.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('debt_over_parameterized_function', config.severityRules);
      const findings: Finding[] = [];
      const FUNC_PARAMS_RE = /(?:(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\()\s*([^)]{50,})\)/g;

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) || isTestFile(path)) continue;
        let m: RegExpExecArray | null;
        const re = new RegExp(FUNC_PARAMS_RE.source, 'g');
        while ((m = re.exec(content)) !== null) {
          const name = m[1] ?? m[2] ?? 'anonymous';
          const paramStr = m[3] ?? '';
          // Count parameters (rough heuristic: count commas not inside brackets)
          let depth = 0;
          let commas = 0;
          for (const ch of paramStr) {
            if ('<({['.includes(ch)) depth++;
            if ('>)}]'.includes(ch)) depth--;
            if (ch === ',' && depth === 0) commas++;
          }
          const paramCount = commas + 1;
          if (paramCount >= 5) {
            const lineNum = content.slice(0, m.index).split('\n').length;
            findings.push({
              severity: sev,
              category: 'debt_over_parameterized_function',
              file: path, line: lineNum,
              message: `"${name}" has ${paramCount} parameters — refactor to accept a config object.`,
              suggestion: `Replace positional parameters with \`options: ${name.charAt(0).toUpperCase() + name.slice(1)}Options\`. This allows adding future params without breaking callers.`,
            });
          }
        }
      }
      return findings;
    },
  },
];
