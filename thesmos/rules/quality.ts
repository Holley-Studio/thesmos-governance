// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, isTestPath, isCommentLine } from './helpers';

export const QUALITY_RULES: ThesmosRule[] = [
  // ── Code Quality ──────────────────────────────────────────────────────────

  {
    id: 'QUAL_003',
    category: 'todo_in_production',
    description: 'TODO/FIXME/HACK comments in production code represent unresolved work that should be a tracked issue.',
    severity: 'LOW',
    tags: ['quality', 'tech-debt'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'TODO comments in code are invisible to project managers and not prioritized. They rot unnoticed for years. Create a real issue and reference its ID in the comment so the work is tracked and owned.',
      commonViolations: ['// TODO: add validation', '// FIXME: this crashes with large payloads', '// HACK: temporary workaround'],
      goodExample: "// TODO(#1234): add validation once schema is finalized\n// FIXME(#1235): crashes with payloads > 1MB — tracked in LINEAR-456",
      badExample: "// TODO: handle error case here\nconst result = dangerousOperation();",
      relatedPlaybooks: ['tech-debt.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('todo_in_production', config.severityRules);
      const RE = /\/\/\s*(?:TODO|FIXME|HACK|XXX|TEMP)\b(?!.*#\d{3,})/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (RE.test(line)) {
            findings.push({ severity, category: 'todo_in_production', file: path, line: i + 1, message: 'TODO/FIXME without issue reference.', suggestion: 'Create a tracking issue and reference its ID: // TODO(#123): description.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'QUAL_004',
    category: 'magic_number',
    description: 'Unexplained numeric literals make intent invisible and create maintenance hazards.',
    severity: 'LOW',
    tags: ['quality', 'readability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'When the same number appears in multiple places with no name, changing it requires finding every instance. A named constant documents intent and centralizes the value.',
      commonViolations: ['setTimeout(fn, 86400000)', 'if (items.length > 50)', 'score * 0.15'],
      goodExample: "const ONE_DAY_MS = 24 * 60 * 60 * 1000;\nconst MAX_PAGE_SIZE = 50;\nconst DISCOUNT_RATE = 0.15;",
      badExample: "if (retries > 3) { setTimeout(retry, 5000); }  // what is 3? what is 5000?",
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('magic_number', config.severityRules);
      const MAGIC_RE = /(?<![.\w])(?<!\w)\b(\d{4,})\b(?!\s*[,;)\]}]?\s*(?:\/\/|$))/;
      const CONTEXT_IGNORE = /const\s+\w+\s*=|export\s+const|enum\s+|milliseconds|version/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line) || CONTEXT_IGNORE.test(line)) continue;
          if (MAGIC_RE.test(line)) {
            findings.push({ severity, category: 'magic_number', file: path, line: i + 1, message: 'Magic number without a named constant.', suggestion: 'Extract to a named const at module scope: const MAX_RETRIES = 3;' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'QUAL_005',
    category: 'commented_out_code',
    description: 'Commented-out code blocks should be deleted — version control preserves history.',
    severity: 'LOW',
    tags: ['quality', 'readability', 'tech-debt'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Commented-out code confuses readers (is this intentional? should it be restored?), accumulates over time, and is never actually maintained. Git history preserves every deleted line.',
      commonViolations: ['// const oldImpl = ...', '// return legacyFn(input)'],
      goodExample: "// Delete the code. Use git log or git blame to find old implementations.",
      badExample: "// const result = oldValidation(input);\nconst result = newValidation(input);  // old code still visible",
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commented_out_code', config.severityRules);
      const CODE_COMMENT_RE = /\/\/\s*(?:const|let|var|function|return|import|export|class|if\s*\(|for\s*\(|await\s+\w)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        let consecutive = 0;
        let startLine = 0;
        for (let i = 0; i < lines.length; i++) {
          if (CODE_COMMENT_RE.test(lines[i]!)) {
            if (consecutive === 0) startLine = i + 1;
            consecutive++;
          } else {
            if (consecutive >= 3) {
              findings.push({ severity, category: 'commented_out_code', file: path, line: startLine, message: `${consecutive} consecutive lines of commented-out code.`, suggestion: 'Delete dead code — git history preserves it.' });
            }
            consecutive = 0;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'QUAL_006',
    category: 'long_function',
    description: 'Functions over 80 lines are hard to test, understand, and maintain — break them into focused sub-functions.',
    severity: 'LOW',
    tags: ['quality', 'maintainability', 'tech-debt'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Long functions typically mix multiple responsibilities, have high cyclomatic complexity, and are difficult to unit test. The discipline of keeping functions small forces better decomposition.',
      commonViolations: ['A 200-line export async function that validates, transforms, saves, and notifies'],
      goodExample: "// Each function does one thing:\nasync function validatePayload(raw) { ... }\nasync function persistOrder(order) { ... }\nasync function notifyFulfillment(order) { ... }",
      badExample: "export async function processOrder(req) {\n  // 150 lines of mixed concerns\n}",
      relatedPlaybooks: ['code-quality.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('long_function', config.severityRules);
      const FUNC_START_RE = /(?:^|\s)(?:async\s+)?function\s+\w+\s*\(|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/m;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!FUNC_START_RE.test(lines[i]!)) continue;
          // find matching closing brace
          let depth = 0;
          let end = i;
          for (let j = i; j < lines.length; j++) {
            for (const ch of lines[j]!) {
              if (ch === '{') depth++;
              else if (ch === '}') depth--;
            }
            if (depth === 0 && j > i) { end = j; break; }
          }
          const length = end - i;
          if (length > 80) {
            findings.push({ severity, category: 'long_function', file: path, line: i + 1, message: `Function is ${length} lines — exceeds 80-line guideline.`, suggestion: 'Extract sub-functions for each logical step or responsibility.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'QUAL_007',
    category: 'console_log_production',
    description: '`console.log` in production source files leaks internal state and adds noise to observability pipelines.',
    severity: 'MEDIUM',
    tags: ['quality', 'observability', 'security'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'console.log is synchronous (blocking), not structured, not filterable by level, and often includes sensitive data. Use a structured logger (pino, winston) that supports levels and JSON output.',
      commonViolations: ['console.log("user data:", user)', 'console.log("response:", result)'],
      goodExample: "import { logger } from '@/lib/logger';\nlogger.info({ userId: user.id, action: 'login' });",
      badExample: "console.log('Processing order:', order);  // logs to stdout with no level, structured data",
      relatedPlaybooks: ['logging.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('console_log_production', config.severityRules);
      const RE = /\bconsole\.log\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (/scripts\/|cli\/|bin\/|seed\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'console_log_production', file: path, line: i + 1, message: 'console.log in production code — use a structured logger.', suggestion: "Replace with logger.info/debug from your logging library (pino, winston, etc.)." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'QUAL_008',
    category: 'hardcoded_env_url',
    description: 'Base URLs hardcoded in source should be environment variables so they can change between environments.',
    severity: 'LOW',
    tags: ['quality', 'configuration', 'ops'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Hardcoded production URLs mean dev/staging environments hit production APIs. Environment variables let the same binary work in any environment without code changes.',
      commonViolations: ["fetch('https://api.myapp.com/users')", "const BASE = 'https://api.prod.example.com'"],
      goodExample: "const BASE_URL = process.env.API_BASE_URL;\nfetch(`${BASE_URL}/users`);",
      badExample: "const result = await fetch('https://api.myapp.com/v1/users');  // hardcoded prod URL",
      relatedPlaybooks: ['configuration.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('hardcoded_env_url', config.severityRules);
      const HARDCODED_URL_RE = /['"`]https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[\w.-]+(?:\.com|\.io|\.net|\.org|\.dev)[/\w.-]*['"`]/;
      const CONST_URL_RE = /const\s+\w+\s*=\s*(?:'|"|`)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (HARDCODED_URL_RE.test(line) && !line.includes('process.env') && CONST_URL_RE.test(line)) {
            findings.push({ severity, category: 'hardcoded_env_url', file: path, line: i + 1, message: 'Hardcoded URL should be an environment variable.', suggestion: 'Use process.env.API_BASE_URL and configure per environment in .env files.' });
          }
        }
      }
      return findings;
    },
  },

  // ── Test Quality ───────────────────────────────────────────────────────────

  {
    id: 'TEST_002',
    category: 'test_only_committed',
    description: '`it.only` / `test.only` / `describe.only` committed to the repo skips all other tests in CI.',
    severity: 'HIGH',
    tags: ['testing', 'ci', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: '.only filters cause CI to run only the focused test suite, silently skipping everything else. This creates a false sense of a passing build — the rest of the test suite is not running.',
      commonViolations: ['it.only("should work", () => {', 'test.only("edge case", () => {', 'describe.only("UserService", () => {'],
      goodExample: "it('should work', () => {  // no .only\ntest('edge case', () => {",
      badExample: "it.only('critical path', () => {  // all other tests skipped in CI",
      relatedPlaybooks: ['testing-standards.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('test_only_committed', config.severityRules);
      const RE = /\b(?:it|test|describe)\.only\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isTestPath(path) && !SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'test_only_committed', file: path, line: i + 1, message: '.only committed — other tests are silently skipped in CI.', suggestion: 'Remove .only before committing. Use it locally to debug, but never commit.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TEST_003',
    category: 'test_skip_no_reason',
    description: '`it.skip` / `test.skip` without a comment or issue reference hides forgotten disabled tests.',
    severity: 'MEDIUM',
    tags: ['testing', 'reliability', 'tech-debt'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Skipped tests that have no explanation accumulate and are never re-enabled. Always document why a test is skipped and link to an issue for re-enabling it.',
      commonViolations: ['it.skip("should handle timeout", () => {', 'test.skip("flaky test", () => {'],
      goodExample: "it.skip('should handle timeout — flaky in CI (#456)', () => {  // issue: fix test infrastructure",
      badExample: "it.skip('should authenticate user', () => {  // no reason — was this intentionally disabled?",
      relatedPlaybooks: ['testing-standards.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('test_skip_no_reason', config.severityRules);
      const RE = /\b(?:it|test|describe)\.skip\s*\(/;
      const REASON_RE = /#\d+|issue|flaky|broken|pending|wip|todo/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isTestPath(path) && !/\.(test|spec)\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!RE.test(line)) continue;
          const block = lines.slice(i, Math.min(i + 3, lines.length)).join('\n');
          if (!REASON_RE.test(block)) {
            findings.push({ severity, category: 'test_skip_no_reason', file: path, line: i + 1, message: '.skip without explanation or issue reference.', suggestion: 'Add a comment explaining why it is skipped and link to an issue: it.skip("reason (#123)").' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TEST_004',
    category: 'empty_test_body',
    description: 'Tests with empty bodies always pass — they provide false coverage confidence.',
    severity: 'HIGH',
    tags: ['testing', 'coverage', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'An empty test is counted in coverage and always passes, giving false confidence that a feature is tested. Either implement the test or skip it with a reason.',
      commonViolations: ["it('should return 401 for unauthenticated requests', () => {})", "test('edge case', () => {})"],
      goodExample: "it('returns 401 for unauthenticated requests', async () => {\n  const res = await fetch('/api/protected');\n  expect(res.status).toBe(401);\n});",
      badExample: "test('validates email format', () => {});  // always passes — not a test",
      relatedPlaybooks: ['testing-standards.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('empty_test_body', config.severityRules);
      const RE = /\b(?:it|test)\s*\([^)]+,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isTestPath(path) && !/\.(test|spec)\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (RE.test(line)) {
            findings.push({ severity, category: 'empty_test_body', file: path, line: i + 1, message: 'Empty test body — always passes without verifying anything.', suggestion: 'Implement the test or mark it as it.todo("description") to signal pending work.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TEST_005',
    category: 'no_assertions',
    description: 'Tests with no `expect()` calls pass without validating any behavior.',
    severity: 'HIGH',
    tags: ['testing', 'coverage', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'A test that does not assert anything verifies nothing. It will pass even if the implementation is completely broken. Every test must have at least one expect().',
      commonViolations: ['it("should call save", () => { save(); })', "test('processes payload', async () => { await handler(payload); })"],
      goodExample: "it('calls save exactly once', () => {\n  save();\n  expect(mockSave).toHaveBeenCalledTimes(1);\n});",
      badExample: "test('processes payment', async () => {\n  await processPayment(data);\n  // no expect — cannot fail\n});",
      relatedPlaybooks: ['testing-standards.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('no_assertions', config.severityRules);
      const TEST_START_RE = /\b(?:it|test)\s*\(/;
      const ASSERT_RE = /\b(?:expect|assert|should)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isTestPath(path) && !/\.(test|spec)\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!TEST_START_RE.test(lines[i]!)) continue;
          let depth = 0;
          let hasAssert = false;
          let start = i;
          for (let j = i; j < Math.min(i + 60, lines.length); j++) {
            for (const ch of lines[j]!) {
              if (ch === '{') depth++;
              else if (ch === '}') depth--;
            }
            if (ASSERT_RE.test(lines[j]!)) hasAssert = true;
            if (depth === 0 && j > i) {
              if (!hasAssert) {
                findings.push({ severity, category: 'no_assertions', file: path, line: start + 1, message: 'Test has no assertions — it always passes.', suggestion: 'Add at least one expect() that would fail if the implementation is broken.' });
              }
              break;
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TEST_006',
    category: 'nondeterministic_test_fixture',
    description: '`Math.random()` or `Date.now()` in test fixtures produce different data on every run — tests become flaky.',
    severity: 'MEDIUM',
    tags: ['testing', 'reliability', 'flakiness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Tests must be deterministic. Random values cause tests to pass sometimes and fail other times depending on the generated value. Seed or hardcode test data.',
      commonViolations: ['id: Math.random().toString()', 'createdAt: Date.now()', 'token: crypto.randomUUID()'],
      goodExample: "const FIXED_USER = { id: 'user-123', createdAt: new Date('2024-01-01') };",
      badExample: "const user = { id: Math.random().toString(), token: crypto.randomUUID() };  // different every run",
      relatedPlaybooks: ['testing-standards.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('nondeterministic_test_fixture', config.severityRules);
      const RE = /\b(?:Math\.random|Date\.now|crypto\.randomUUID)\s*\(\)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isTestPath(path) && !/\.(test|spec|fixture|factory|seed)\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'nondeterministic_test_fixture', file: path, line: i + 1, message: 'Nondeterministic value in test fixture — test becomes flaky.', suggestion: 'Use fixed values: id: "user-123", createdAt: new Date("2024-01-01").' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TEST_007',
    category: 'snapshot_only_test',
    description: 'Tests that only assert a snapshot do not describe intent and break on any render change.',
    severity: 'LOW',
    tags: ['testing', 'react', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Snapshot tests break on any UI change (even intentional ones), creating a culture of "update the snapshot" rather than verifying behavior. They do not communicate what is being tested.',
      commonViolations: ['expect(component).toMatchSnapshot()', 'expect(rendered).toMatchInlineSnapshot()'],
      goodExample: "expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();\nexpect(screen.getByText('Error: required')).toBeVisible();",
      badExample: "it('renders correctly', () => {\n  expect(render(<Form />)).toMatchSnapshot();  // no intent, breaks on any change\n});",
      relatedPlaybooks: ['testing-standards.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('snapshot_only_test', config.severityRules);
      const SNAP_RE = /\.toMatch(?:Inline)?Snapshot\s*\(/;
      const OTHER_ASSERT_RE = /\.to(?:Be|Equal|Have|Contain|Throw|Resolve|Reject)\w+\s*\(/;
      const TEST_START_RE = /\b(?:it|test)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isTestPath(path) && !/\.(test|spec)\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!TEST_START_RE.test(lines[i]!)) continue;
          let depth = 0;
          let hasSnap = false;
          let hasOther = false;
          for (let j = i; j < Math.min(i + 40, lines.length); j++) {
            for (const ch of lines[j]!) {
              if (ch === '{') depth++;
              else if (ch === '}') depth--;
            }
            if (SNAP_RE.test(lines[j]!)) hasSnap = true;
            if (OTHER_ASSERT_RE.test(lines[j]!)) hasOther = true;
            if (depth === 0 && j > i) break;
          }
          if (hasSnap && !hasOther) {
            findings.push({ severity, category: 'snapshot_only_test', file: path, line: i + 1, message: 'Test relies only on snapshots — add explicit behavioral assertions.', suggestion: 'Assert specific rendered text or elements rather than relying solely on snapshot comparison.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TEST_008',
    category: 'console_in_test',
    description: '`console.log` in tests adds noise to test output and hides the signal from failures.',
    severity: 'LOW',
    tags: ['testing', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Test output should be clean — only failures. console.log calls in tests pollute the output, making it hard to spot real failures and slowing CI log parsing.',
      commonViolations: ['console.log("result:", result)', 'console.log(JSON.stringify(data, null, 2))'],
      goodExample: "// Remove debug logs before committing\n// If you need to inspect values, use the debugger or a test reporter.",
      badExample: "it('calculates total', () => {\n  const t = calculateTotal(items);\n  console.log('total:', t);  // noise in CI output\n  expect(t).toBe(42);\n});",
      relatedPlaybooks: ['testing-standards.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('console_in_test', config.severityRules);
      const RE = /\bconsole\.(?:log|warn|error|info)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isTestPath(path) && !/\.(test|spec)\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line) && !/mock|spy|jest\.spyOn/.test(line)) {
            findings.push({ severity, category: 'console_in_test', file: path, line: i + 1, message: 'console.log in test — pollutes test output.', suggestion: 'Remove before committing. Use the debugger or a test reporter to inspect values.' });
          }
        }
      }
      return findings;
    },
  },

  // ── Git Hygiene ────────────────────────────────────────────────────────────

  {
    id: 'GIT_001',
    category: 'merge_conflict_markers',
    description: 'Merge conflict markers committed to a file indicate an incomplete conflict resolution.',
    severity: 'BLOCKER',
    tags: ['git', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Committed conflict markers break syntax, cause runtime errors, and indicate the developer did not complete a merge. These must never reach main.',
      commonViolations: ['<<<<<<< HEAD', '=======' , '>>>>>>> feature/branch'],
      goodExample: "// Resolve all conflicts before committing:\n// git diff — shows unresolved markers\n// git mergetool — opens a visual merge tool",
      badExample: "<<<<<<< HEAD\nconst timeout = 3000;\n=======\nconst timeout = 5000;\n>>>>>>> feature/new-timeout",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('merge_conflict_markers', config.severityRules);
      const RE = /^(?:<{7}|>{7}|={7})\s/m;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/^(?:<{7}|>{7}|={7})/.test(lines[i]!)) {
            findings.push({ severity, category: 'merge_conflict_markers', file: path, line: i + 1, message: 'Merge conflict marker in committed file.', suggestion: 'Resolve the conflict and remove all <<<<<, =====, >>>>>> markers before committing.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'GIT_002',
    category: 'env_file_committed',
    description: '`.env` files committed to source control expose secrets to everyone with repository access.',
    severity: 'BLOCKER',
    tags: ['git', 'security', 'secrets'],
    sinceVersion: '2.0.0',
    explain: {
      why: '.env files contain API keys, database credentials, and secrets. Committing them exposes secrets to all repository collaborators (and the public if it is an open repo). Use .gitignore and secret managers instead.',
      commonViolations: ['.env', '.env.local', '.env.production'],
      goodExample: "# .gitignore:\n.env\n.env.*\n!.env.example\n\n# Provide .env.example with placeholder values for documentation.",
      badExample: "# Committed .env file contains real secrets:\nOPENAI_API_KEY=sk-real-key-abc123\nDATABASE_URL=postgres://user:realpassword@host/db",
      relatedPlaybooks: ['secrets-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('env_file_committed', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/(?:^|\/)\.env(?:\.\w+)?$/.test(path)) continue;
        if (/\.example$|\.sample$/.test(path)) continue;
        // Only flag if it has real-looking values (not just commented template)
        if (/^\w+=\S+/m.test(content)) {
          findings.push({ severity, category: 'env_file_committed', file: path, message: '.env file committed to repository — contains secrets.', suggestion: 'Add .env to .gitignore. Use .env.example (with placeholder values) for documentation.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'GIT_003',
    category: 'large_binary_committed',
    description: 'Binary files over 1MB committed to git inflate repository size permanently — git history cannot be efficiently purged.',
    severity: 'MEDIUM',
    tags: ['git', 'performance', 'ops'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Git stores every version of every committed file forever. A 5MB binary committed and then "deleted" still inflates clone time. Use Git LFS or an object store (S3) for binary assets.',
      commonViolations: ['videos committed to /public', 'large PDFs in /docs', 'compiled binaries in /dist committed'],
      goodExample: "# .gitignore:\n*.mp4\n*.pdf\ndist/\npublic/videos/\n\n# Use Git LFS for unavoidable binaries:\ngit lfs track '*.mp4'",
      badExample: "git add public/demo-video.mp4  # 15MB binary in git history",
      relatedPlaybooks: ['git-best-practices.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('large_binary_committed', config.severityRules);
      const BINARY_EXT_RE = /\.(mp4|mov|avi|mkv|webm|pdf|psd|ai|sketch|fig|zip|tar|gz|exe|dmg|pkg|wasm)$/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!BINARY_EXT_RE.test(path)) continue;
        if (content.length > 500_000) {
          findings.push({ severity, category: 'large_binary_committed', file: path, message: `Large binary file (${(content.length / 1024).toFixed(0)}KB) committed to git.`, suggestion: 'Use Git LFS for media files, or store in S3/CDN and reference by URL.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'GIT_004',
    category: 'generated_file_in_source',
    description: 'Generated or compiled files committed alongside source code must be regenerated manually when out of date.',
    severity: 'LOW',
    tags: ['git', 'build', 'dx'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Generated files (graphql types, prisma client, openapi clients) get out of sync with their source of truth. The generator should run in CI — the output should not be committed.',
      commonViolations: ['generated/graphql.ts committed', 'prisma/generated committed', '__generated__ committed'],
      goodExample: "# .gitignore:\nsrc/generated/\n__generated__/\nprisma/generated/\n*.generated.ts",
      badExample: "# Committed generated GraphQL types that are 3 schema versions behind",
      relatedPlaybooks: ['git-best-practices.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('generated_file_in_source', config.severityRules);
      const GENERATED_PATH_RE = /(?:__generated__|\/generated\/|\.generated\.|prisma\/generated)/;
      const GENERATED_HEADER_RE = /DO NOT EDIT|This file was automatically generated|@generated|Code generated by/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (GENERATED_PATH_RE.test(path) || GENERATED_HEADER_RE.test(content.slice(0, 500))) {
          findings.push({ severity, category: 'generated_file_in_source', file: path, message: 'Generated file committed to source control.', suggestion: "Add to .gitignore and run the generator in CI instead of committing the output." });
        }
      }
      return findings;
    },
  },

  // ── Dependency Health ──────────────────────────────────────────────────────

  {
    id: 'DEPS_001',
    category: 'require_in_esm',
    description: '`require()` in an ESM module fails at runtime — use `import` instead.',
    severity: 'HIGH',
    tags: ['dependencies', 'esm', 'nodejs'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Node.js ESM modules (type: "module" in package.json) do not support require(). Calling it throws "ReferenceError: require is not defined". Always use import/import() in ESM.',
      commonViolations: ["const fs = require('fs')", "const { join } = require('path')"],
      goodExample: "import { readFile } from 'node:fs/promises';\nimport { join } from 'node:path';",
      badExample: "// In ESM module:\nconst path = require('path');  // ReferenceError at runtime",
      relatedPlaybooks: ['esm-migration.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('require_in_esm', config.severityRules);
      const RE = /\brequire\s*\(\s*['"`]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(mjs|mts)$/.test(path) && !SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        // Only flag if there are also import statements (likely ESM context)
        if (!content.includes('import ') && !content.includes('export ')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line) && !line.includes('createRequire')) {
            findings.push({ severity, category: 'require_in_esm', file: path, line: i + 1, message: 'require() in ESM module — fails at runtime.', suggestion: "Replace with: import { ... } from 'module-name';" });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEPS_002',
    category: 'node_modules_import',
    description: 'Importing directly from `node_modules/` path is fragile and breaks with package manager changes.',
    severity: 'MEDIUM',
    tags: ['dependencies', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: "Direct node_modules paths bypass package resolution, break with hoisting changes (pnpm, yarn workspaces), and don't work with bundlers that resolve from package.json exports.",
      commonViolations: ["import 'node_modules/some-lib/dist/index.js'", "from '../../node_modules/react'"],
      goodExample: "import React from 'react';\nimport { something } from 'some-lib';",
      badExample: "import { handler } from '../../../node_modules/some-lib/dist/esm/handler.js';",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('node_modules_import', config.severityRules);
      const RE = /from\s+['"`][^'"`]*node_modules[/\\]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'node_modules_import', file: path, line: i + 1, message: 'Direct node_modules import path — use the package name instead.', suggestion: "Replace with the package name: import { ... } from 'package-name'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DEPS_003',
    category: 'barrel_import_server_hot_path',
    description: 'Barrel imports (index.ts re-exports) in server hot paths import every export even if only one is needed.',
    severity: 'LOW',
    tags: ['dependencies', 'performance', 'bundle'],
    sinceVersion: '2.0.0',
    explain: {
      why: "Barrel files work well for client-side tree-shaking, but in server-side Node.js modules, every re-export in the barrel is evaluated at require-time. In hot paths, import directly from the source file.",
      commonViolations: ["import { validateEmail } from '@/utils'  // imports entire utils barrel", "import { db } from '@/lib'  // imports entire lib barrel including heavy dependencies"],
      goodExample: "import { validateEmail } from '@/utils/validation';\nimport { db } from '@/lib/db';",
      badExample: "// route.ts — server hot path\nimport { validateEmail, hashPassword, generateToken } from '@/utils';  // loads entire barrel",
      relatedPlaybooks: ['performance.md', 'bundle-optimization.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('barrel_import_server_hot_path', config.severityRules);
      const BARREL_RE = /from\s+['"`](?:@\/|\.\.\/)+(?:utils|lib|helpers|shared|common)['"`]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/api\/|route\.|server\.|middleware\./.test(path)) continue;
        const lines = content.split('\n');
        let count = 0;
        for (const line of lines) {
          if (!isCommentLine(line) && BARREL_RE.test(line)) count++;
        }
        if (count >= 2) {
          findings.push({ severity, category: 'barrel_import_server_hot_path', file: path, message: `${count} barrel imports in server route — imports entire barrel modules on every cold start.`, suggestion: 'Import directly from the source file: from "@/utils/validation" instead of "@/utils".' });
        }
      }
      return findings;
    },
  },
];
