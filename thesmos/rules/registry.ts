/**
 * Canonical rule registry — single source of truth for all Prometheus rules.
 *
 * Each rule carries its own metadata AND detection logic (detect()).
 * All downstream consumers derive from this registry:
 *   - config.ts       → severityRules (category→severity mapping)
 *   - review.ts       → REVIEW_CATEGORIES, runReview loop
 *   - adapters.ts     → AI adapter content generation
 *   - doctor/ci-check → rule count for adapter freshness
 *
 * Adding a new rule: add ONE entry here. Everything else propagates automatically.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import {
  isDirectEnvAccess,
  hasAdminClientInClientFile,
  hasRlsDisable,
  matchesSecretPattern,
  hasMondayWriteOutsideGateway,
} from '../secrets';
import { classifySeverity } from '../severity';
import { SECURITY_RULES } from './security';
import { TYPESCRIPT_RULES } from './typescript';
import { REACT_RULES } from './react';
import { NEXTJS_RULES } from './nextjs';
import { AI_RULES } from './ai';
import { PERFORMANCE_RULES } from './performance';
import { DATABASE_RULES } from './database';
import { QUALITY_RULES } from './quality';
import { ZOD_RULES } from './zod';
import { TRPC_RULES } from './trpc';
import { PRISMA_RULES } from './prisma';
import { NODE_RULES } from './node';
import { ERROR_RULES } from './errors';
import { IMPORT_RULES } from './imports';
import { STATE_RULES } from './state';
import { FORM_RULES } from './forms';
import { LOG_RULES } from './logging';
import { CSS_RULES } from './css';
import { VIBE_CODING_RULES } from './vibe-coding';
import { SLOPSQUATTING_RULES } from './slopsquatting';
import { PYTHON_RULES } from './python';
import { DJANGO_RULES } from './django';
import { GO_RULES } from './go';
import { RUBY_RULES } from './ruby';
import { PHP_RULES } from './php';
import { JAVA_RULES } from './java';
import { RUST_RULES } from './rust';
import { CSHARP_RULES } from './csharp';
import { DOCKERFILE_RULES } from './dockerfile';
import { GITHUB_ACTIONS_RULES } from './github-actions';
import { TERRAFORM_RULES } from './terraform';
import { GRAPHQL_RULES } from './graphql';
import { DESIGN_RULES } from './design';
import { DEBT_RULES } from './debt';
import { COMMIT_RULES } from './commits';
import { VERCEL_RULES } from './vercel';
import { AGENT_RULES } from './agents';
import { DEP_RULES } from './deps';
import { LICENSE_RULES } from './license';
import { GDPR_RULES } from './gdpr';
import { MCP_RULES } from './mcp';
import { RAG_RULES } from './rag';
import { WEBSOCKET_RULES } from './websocket';
import { PROTOTYPE_RULES } from './prototype';
import { JWT_AUTH_RULES } from './jwt';
import { SUPPLY_CHAIN_RULES } from './supply-chain';
import { DAST_RULES } from './dast';
import { K8S_RULES } from './k8s';
import { SELF_RULES } from './self';

// ── Local helpers (used inside detect() methods) ──────────────────────────────

function isTestPath(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path) || /(^|\/)__tests__\//.test(path);
}

function isRiskyPath(path: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    try {
      return new RegExp(p).test(path);
    } catch {
      return false;
    }
  });
}

const CONSOLE_RE = /console\.(log|warn|error|debug|info)\s*\(/;

// Matches hardcoded hex colours or direct color/background CSS properties with literal values.
const HARDCODED_COLOR_RE =
  /#[0-9a-fA-F]{3,8}\b|(?:color|background(?:-color)?|fill|stroke)\s*[:=]\s*['"]\s*(?!var\()[a-z]{3,}/;

// Flags `: any` or `as any` without an inline `//` explanation on the same line.
const ANY_TYPE_RE = /(?::|\bas\b)\s+any\b/;

// ── Rule registry ─────────────────────────────────────────────────────────────

export const PROMETHEUS_RULES: ThesmosRule[] = [
  {
    id: 'ENV_001',
    category: 'direct_env_access',
    description:
      "Use bracket-notation env access — process['env' as 'env']['VAR'] — never process.env.VAR dot notation.",
    severity: 'BLOCKER',
    tags: ['security', 'env'],
    example:
      "// BAD:  const url = process.env.MY_VAR;\n// GOOD: const url = process['env' as 'env']['MY_VAR'];",
    sinceVersion: '1.0.0',
    explain: {
      why: "Dot-notation env access (process.env.VAR) is trivially searchable and frequently flagged by linters as a direct string. The bracket notation forces an explicit type cast, making mass-scraping of env var names harder and signalling intentional access to reviewers.",
      commonViolations: [
        'const url = process.env.DATABASE_URL',
        'const key = process.env.NEXT_PUBLIC_API_KEY',
        'if (process.env.NODE_ENV === "production")',
      ],
      goodExample: "const url = process['env' as 'env']['DATABASE_URL'];",
      badExample: 'const url = process.env.DATABASE_URL;',
      relatedPlaybooks: ['env-access.md'],
      relatedAgents: ['env-guard'],
      relatedSkills: ['env-var-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('direct_env_access', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (/^scripts\//.test(path)) continue; // operator tooling — exempt
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = isDirectEnvAccess(lines[i]);
          if (match) {
            findings.push({
              severity,
              category: 'direct_env_access',
              file: path,
              line: i + 1,
              message: `Direct process.env.${match[1]} access — use the bracket-notation env helper.`,
              suggestion: `Replace with process['env' as 'env']['${match[1]}']`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_001',
    category: 'admin_client_in_browser',
    description:
      "Never import the Supabase admin client in 'use client' files. Admin clients expose service-role keys to the browser.",
    severity: 'BLOCKER',
    tags: ['security', 'supabase', 'client'],
    sinceVersion: '1.0.0',
    explain: {
      why: "Supabase admin clients use a service-role key that bypasses Row Level Security. If this client is imported in a 'use client' file, the service-role key ships to the browser in the JS bundle, giving any user full database access.",
      commonViolations: [
        "'use client' file importing createClient from @supabase/supabase-js with service-role key",
        "supabaseAdmin imported at top of a Client Component",
        "shared lib that initialises admin client with SUPABASE_SERVICE_ROLE_KEY imported in browser code",
      ],
      goodExample: "// server-only Server Action:\nexport async function deleteUser(id: string) {\n  const admin = createAdminClient(); // server-only module\n  await admin.auth.admin.deleteUser(id);\n}",
      badExample: "'use client';\nimport { supabaseAdmin } from '@/lib/supabase-admin'; // ❌ leaks service-role key",
      relatedPlaybooks: ['supabase-security.md'],
      relatedAgents: ['supabase-guard', 'security-reviewer'],
      relatedSkills: ['supabase-rls-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('admin_client_in_browser', config.severityRules);
      return changedFiles
        .filter(({ content }) => hasAdminClientInClientFile(content))
        .map(({ path }) => ({
          severity,
          category: 'admin_client_in_browser' as const,
          file: path,
          message:
            'Admin/service-role Supabase client imported inside a "use client" component. This exposes privileged credentials to the browser.',
          suggestion: 'Move all admin operations to a Server Action or API route handler.',
        }));
    },
  },

  {
    id: 'SEC_002',
    category: 'rls_disabled',
    description:
      'Never disable Row Level Security. All Supabase tables must have RLS enabled with explicit policies.',
    severity: 'BLOCKER',
    tags: ['security', 'supabase', 'database'],
    sinceVersion: '1.0.0',
    explain: {
      why: "Row Level Security (RLS) is Supabase's primary mechanism to prevent one user from reading or writing another user's data. Disabling it makes every row in the table accessible to any authenticated user, regardless of their role or permissions.",
      commonViolations: [
        'ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;',
        'CREATE FUNCTION ... SECURITY DEFINER without strict policy',
        'New migration file missing ENABLE ROW LEVEL SECURITY',
      ],
      goodExample: "ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;\nCREATE POLICY \"users can read own profile\"\n  ON profiles FOR SELECT\n  USING (auth.uid() = user_id);",
      badExample: 'ALTER TABLE profiles DISABLE ROW LEVEL SECURITY; -- ❌ anyone can read all rows',
      relatedPlaybooks: ['supabase-security.md', 'database-migrations.md'],
      relatedAgents: ['supabase-guard', 'migration-reviewer'],
      relatedSkills: ['rls-policy-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('rls_disabled', config.severityRules);
      return changedFiles
        .filter(({ path }) => /\.(sql)$/.test(path))
        .filter(({ content }) => hasRlsDisable(content))
        .map(({ path }) => ({
          severity,
          category: 'rls_disabled' as const,
          file: path,
          message:
            'Row Level Security disabled or SECURITY DEFINER function detected in migration.',
          suggestion:
            'Ensure RLS is enabled and every table has an appropriate policy for user-facing access.',
        }));
    },
  },

  {
    id: 'SEC_003',
    category: 'secret_in_diff',
    description:
      'Never commit secrets, API keys, or private key material in code or config files.',
    severity: 'BLOCKER',
    tags: ['security', 'secrets'],
    sinceVersion: '1.0.0',
    explain: {
      why: "Once a secret is committed to git history, it is permanently exposed — even if deleted in a later commit. Automated scanners, git forks, and CI log dumps can capture it. Rotating credentials is expensive and often delayed, leaving systems vulnerable.",
      commonViolations: [
        'Hardcoded API key: const API_KEY = "sk-abc123..."',
        'Committed .env file with real credentials',
        'Test fixture with a real token embedded',
        'Private key PEM block checked in directly',
      ],
      goodExample: "const apiKey = process['env' as 'env']['OPENAI_API_KEY'];\n// .env.local is in .gitignore",
      badExample: "const OPENAI_KEY = 'sk-abc123xyz...'; // ❌ never commit real keys",
      relatedPlaybooks: ['secret-management.md'],
      relatedAgents: ['secret-scanner', 'security-reviewer'],
      relatedSkills: ['env-var-helper', 'git-ignore-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('secret_in_diff', config.severityRules);
      const findings: Finding[] = [];
      const patterns = config.secretPatterns;
      for (const { path, content, diff } of changedFiles) {
        const source = diff ?? content;
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (matchesSecretPattern(lines[i], patterns)) {
            findings.push({
              severity,
              category: 'secret_in_diff',
              file: path,
              line: i + 1,
              message: 'Potential secret or credential pattern detected.',
              suggestion:
                'Remove from source and rotate the credential immediately if already committed.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_001',
    category: 'missing_api_auth',
    description:
      'All POST, PATCH, PUT, and DELETE API routes must verify caller identity before executing mutations.',
    severity: 'HIGH',
    tags: ['security', 'auth', 'api'],
    example:
      '// Every mutating handler must call getSession() or getCallerProfile() first.',
    sinceVersion: '1.0.0',
    explain: {
      why: "Mutating API routes without an auth check are callable by any unauthenticated user on the internet. This enables account takeover, data corruption, privilege escalation, and resource exhaustion attacks.",
      commonViolations: [
        'Route handler calls db.insert() before checking getSession()',
        'DELETE route that accepts an ID without verifying the caller owns the resource',
        'Middleware that only checks auth for GET but not POST on the same path',
      ],
      goodExample: "export async function POST(req: Request) {\n  const session = await getSession();\n  if (!session) return new Response('Unauthorized', { status: 401 });\n  // safe to proceed\n}",
      badExample: "export async function POST(req: Request) {\n  const body = await req.json();\n  await db.insert(orders, body); // ❌ no auth check\n}",
      relatedPlaybooks: ['api-auth.md', 'session-management.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: ['auth-check-helper', 'session-helper'],
    },
    detect({ scan, config }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_api_auth', config.severityRules);
      return scan.apiRoutes
        .filter(
          (r) =>
            !r.auth && r.methods.some((m) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m))
        )
        .map((r) => ({
          severity,
          category: 'missing_api_auth' as const,
          file: r.file ?? r.path,
          message: `API route ${r.path} (${r.methods.join(', ')}) has no visible auth check.`,
          suggestion: 'Add a session/auth guard before executing any mutation.',
        }));
    },
  },

  {
    id: 'TS_001',
    category: 'any_type_no_comment',
    description:
      'Avoid TypeScript `any` without an explanatory comment. Use `unknown` and narrow the type instead.',
    severity: 'MEDIUM',
    tags: ['typescript', 'quality'],
    sinceVersion: '1.0.0',
    explain: {
      why: "Using `any` silently disables TypeScript's type checker for that value and everything derived from it. Undocumented `any` usage hides bugs at compile time that surface as runtime errors in production. A comment signals the usage is intentional and explains the constraint.",
      commonViolations: [
        'const data: any = await fetchUserData()',
        '(event as any).target.value',
        'function transform(input: any): any { ... }',
        'JSON.parse result assigned to an `any`-typed variable',
      ],
      goodExample: "// reason: third-party SDK returns untyped shape, validated by zod below\nconst raw: unknown = await externalSdk.getData();\nconst data = UserSchema.parse(raw);",
      badExample: 'const data: any = await fetchUserData(); // ❌ type checker disabled',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: ['zod-schema-helper', 'typescript-narrowing'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('any_type_no_comment', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (ANY_TYPE_RE.test(line) && !/\/\//.test(line)) {
            findings.push({
              severity,
              category: 'any_type_no_comment',
              file: path,
              line: i + 1,
              message: '`any` type used without an inline comment explaining why.',
              suggestion:
                'Replace with a specific type, or add `// reason: <explanation>` on the same line.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'QUAL_001',
    category: 'console_log',
    description:
      'Remove console.log statements before merging. Use structured logging in production code.',
    severity: 'LOW',
    tags: ['quality', 'logging'],
    sinceVersion: '1.0.0',
    explain: {
      why: "console.log pollutes production logs, can leak sensitive runtime values (user data, tokens, PII), and creates noise that makes real errors harder to find. Structured loggers add severity, correlation IDs, and context that make production debugging tractable.",
      commonViolations: [
        'console.log("user data:", userData) — may leak PII',
        'console.error(err) in a catch block instead of logger.error',
        'console.warn("TODO: remove this") committed accidentally',
      ],
      goodExample: "logger.info('user updated', { userId: user.id, fields: changedFields });",
      badExample: 'console.log("user updated:", user); // ❌ logs full user object including sensitive fields',
      relatedPlaybooks: ['logging-conventions.md'],
      relatedAgents: ['logging-reviewer'],
      relatedSkills: ['structured-logger-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('console_log', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const m = CONSOLE_RE.exec(lines[i]);
          if (m) {
            findings.push({
              severity,
              category: 'console_log',
              file: path,
              line: i + 1,
              message: `console.${m[1]}() left in production code.`,
              suggestion: 'Remove or replace with a structured logger.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'QUAL_002',
    category: 'large_file',
    description:
      'Files exceeding the configured line threshold are tech-debt candidates. Consider splitting into smaller modules.',
    severity: 'TECH_DEBT',
    tags: ['quality', 'maintainability'],
    sinceVersion: '1.0.0',
    explain: {
      why: "Large files mix concerns, have longer review cycles, higher merge-conflict rates, and are harder to test in isolation. The threshold is a team-configured proxy for the point at which a file has too many responsibilities.",
      commonViolations: [
        'API route file that also contains business logic, validation, and email sending',
        'God-component file with embedded state, effects, and child components',
        '600-line utility file with unrelated helpers grouped by convenience',
      ],
      goodExample: "// Split: userRouter.ts (routing) + userService.ts (business logic) + userSchema.ts (validation)",
      badExample: '// A single api/users.ts that is 800 lines mixing routing, DB calls, email, and formatting',
      relatedPlaybooks: ['module-decomposition.md'],
      relatedAgents: ['architecture-reviewer'],
      relatedSkills: ['module-splitter'],
    },
    detect({ scan, config }: DetectInput): Finding[] {
      const severity = classifySeverity('large_file', config.severityRules);
      return scan.largeFiles.map((lf) => ({
        severity,
        category: 'large_file' as const,
        file: lf.file,
        message: `File has ${lf.lines} lines (threshold: ${config.largeFileThreshold}).`,
        suggestion: 'Consider splitting into smaller, single-responsibility modules.',
      }));
    },
  },

  {
    id: 'GATE_001',
    category: 'monday_write_no_gate',
    description:
      'Monday.com write mutations must go through the designated gateway module, not scattered across the codebase.',
    severity: 'HIGH',
    tags: ['quality', 'architecture', 'monday'],
    sinceVersion: '1.0.0',
    explain: {
      why: "Scattered Monday.com write calls bypass centralised rate limiting, error handling, retry logic, and audit logging. The gateway is the single place to add observability, circuit breaking, and permission checks — direct calls evade all of that.",
      commonViolations: [
        'mondayClient.create() called directly in a feature file',
        'mondayClient.update() in a background job that bypasses the gateway',
        'Inline GraphQL mutation strings for Monday writes in component files',
      ],
      goodExample: "import { mondayGateway } from '@/lib/monday';\nawait mondayGateway.createItem({ boardId, columnValues }); // rate-limited + logged",
      badExample: "import { mondayClient } from '@/lib/monday-raw';\nawait mondayClient.create({ ... }); // ❌ bypasses gateway",
      relatedPlaybooks: ['monday-gateway.md', 'external-api-patterns.md'],
      relatedAgents: ['architecture-reviewer', 'integration-reviewer'],
      relatedSkills: ['monday-gateway-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('monday_write_no_gate', config.severityRules);
      return changedFiles
        .filter(({ path, content }) => hasMondayWriteOutsideGateway(content, path))
        .map(({ path }) => ({
          severity,
          category: 'monday_write_no_gate' as const,
          file: path,
          message:
            'Monday.com write mutation found outside the approved intake/requests gateway path.',
          suggestion: 'Route all Monday writes through the designated gateway module.',
        }));
    },
  },

  {
    id: 'TEST_001',
    category: 'missing_test_for_risky_change',
    description:
      'Risky file changes (matching riskyFilePatterns) must include a corresponding test file change in the same diff.',
    severity: 'MEDIUM',
    tags: ['quality', 'testing'],
    sinceVersion: '1.0.0',
    explain: {
      why: "High-risk code (auth, payments, data migrations) is the most likely to cause production incidents if it regresses. Requiring a test file change in the same diff ensures the author thought about test coverage and reduces the chance of shipping a silent regression.",
      commonViolations: [
        'Changing auth/session.ts without touching auth/session.test.ts',
        'Updating payment processing logic without test coverage for the new path',
        'Modifying a critical utility function without corresponding test update',
      ],
      goodExample: "// PR diff includes both:\n// ✅ src/lib/auth.ts (changed)\n// ✅ src/lib/auth.test.ts (updated to cover the new code path)",
      badExample: "// PR diff includes only:\n// ❌ src/lib/auth.ts (changed)\n// No test file changes",
      relatedPlaybooks: ['testing-standards.md'],
      relatedAgents: ['test-coverage-reviewer'],
      relatedSkills: ['test-generator', 'coverage-analyzer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_test_for_risky_change', config.severityRules);
      const patterns = config.scan?.riskyFilePatterns ?? [];
      if (patterns.length === 0 || changedFiles.length === 0) return [];

      const changedPaths = changedFiles.map((f) => f.path);
      const riskyChanged = changedPaths.filter((p) => isRiskyPath(p, patterns));
      if (riskyChanged.length === 0) return [];
      if (changedPaths.some(isTestPath)) return [];

      return riskyChanged.map((path) => ({
        severity,
        category: 'missing_test_for_risky_change' as const,
        file: path,
        message: 'Risky file changed without any corresponding test file in this diff.',
        suggestion: 'Add or update tests that cover the changed logic before merging.',
      }));
    },
  },

  {
    id: 'DS_001',
    category: 'design_system_bypass',
    description:
      'Hardcoded colour literals or raw CSS values outside design-system files bypass the design token system.',
    severity: 'LOW',
    tags: ['quality', 'design-system', 'css'],
    sinceVersion: '1.0.0',
    explain: {
      why: "Hardcoded color values fork the design system. When brand colors change or a dark mode is added, hardcoded values won't update — creating visual inconsistency and requiring manual search-and-replace across the codebase.",
      commonViolations: [
        "style={{ color: '#3b82f6' }} — hardcoded hex color",
        "background: 'red' — hardcoded named color in JSX",
        ".button { color: #1e293b } — raw color in CSS/SCSS outside design tokens",
      ],
      goodExample: "// Tailwind token: className=\"text-blue-500\"\n// CSS variable: color: var(--color-primary)\n// Design token: color: theme('colors.brand.500')",
      badExample: "style={{ color: '#3b82f6', background: 'white' }} // ❌ hardcoded values",
      relatedPlaybooks: ['design-system.md', 'tailwind-conventions.md'],
      relatedAgents: ['design-system-reviewer'],
      relatedSkills: ['token-migration-helper'],
    },
    detect({ scan, config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('design_system_bypass', config.severityRules);
      const findings: Finding[] = [];
      const designFiles = new Set(scan.designSystemFiles);

      for (const { path, content } of changedFiles) {
        if (designFiles.has(path)) continue; // design files may define raw values
        if (!/\.(tsx?|jsx?|css|scss)$/.test(path)) continue;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
          if (HARDCODED_COLOR_RE.test(lines[i])) {
            findings.push({
              severity,
              category: 'design_system_bypass',
              file: path,
              line: i + 1,
              message: 'Hardcoded colour or design value found outside design-system files.',
              suggestion:
                'Use a design token or Tailwind config alias instead of a literal value.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'COMP_001',
    category: 'duplicate_component_pattern',
    description:
      'Creating a component that duplicates an existing shared UI component. Reuse or extend instead.',
    severity: 'TECH_DEBT',
    tags: ['quality', 'maintainability', 'components'],
    sinceVersion: '1.0.0',
    explain: {
      why: "Duplicate components diverge over time — each receives slightly different bug fixes, accessibility improvements, and API changes. This fragments the UI, doubles the maintenance burden, and causes inconsistent UX. The shared component is the single source of truth.",
      commonViolations: [
        "Creating components/Button.tsx when components/ui/Button.tsx already exists",
        "New Modal.tsx in a feature folder that duplicates shared ui/Modal.tsx",
        "Custom Table component that mirrors the design system Table without extending it",
      ],
      goodExample: "import { Button } from '@/components/ui/Button';\n// Extend with a wrapper if needed:\nexport function DangerButton(props) {\n  return <Button {...props} variant=\"danger\" />;\n}",
      badExample: "// components/Button.tsx — re-implements shared button from scratch\nexport function Button({ children, onClick }) {\n  return <button className=\"btn\" onClick={onClick}>{children}</button>; // ❌ duplicates ui/Button",
      relatedPlaybooks: ['component-reuse.md'],
      relatedAgents: ['component-reviewer', 'design-system-reviewer'],
      relatedSkills: ['component-finder'],
    },
    detect({ scan, config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('duplicate_component_pattern', config.severityRules);
      const sharedNames = new Set(
        scan.sharedUiFiles.map(
          (f) => f.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '').toLowerCase() ?? ''
        )
      );

      const findings: Finding[] = [];
      for (const { path } of changedFiles) {
        // Only flag new components directly in components/ (not in components/ui/)
        if (!/^(?:src\/)?components\/[^/]+\.(tsx?|jsx?)$/.test(path)) continue;
        if (/\/ui\//.test(path)) continue;

        const name =
          path.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '').toLowerCase() ?? '';
        if (sharedNames.has(name)) {
          const existing = scan.sharedUiFiles.find(
            (f) =>
              f.toLowerCase().endsWith(`/${name}.tsx`) ||
              f.toLowerCase().endsWith(`/${name}.ts`)
          );
          findings.push({
            severity,
            category: 'duplicate_component_pattern',
            file: path,
            message: `Component "${name}" duplicates an existing shared UI component.`,
            suggestion: existing
              ? `Use or extend the existing shared component at ${existing}.`
              : 'Use or extend the existing shared UI component instead of duplicating.',
          });
        }
      }
      return findings;
    },
  },

  // ── Domain rule packs ─────────────────────────────────────────────────────
  ...SECURITY_RULES,
  ...TYPESCRIPT_RULES,
  ...REACT_RULES,
  ...NEXTJS_RULES,
  ...AI_RULES,
  ...PERFORMANCE_RULES,
  ...DATABASE_RULES,
  ...QUALITY_RULES,
  ...ZOD_RULES,
  ...TRPC_RULES,
  ...PRISMA_RULES,
  ...NODE_RULES,
  ...ERROR_RULES,
  ...IMPORT_RULES,
  ...STATE_RULES,
  ...FORM_RULES,
  ...LOG_RULES,
  ...CSS_RULES,
  // ── AI-era additions ──────────────────────────────────────────────────────
  ...VIBE_CODING_RULES,
  ...SLOPSQUATTING_RULES,
  // ── Language packs ────────────────────────────────────────────────────────
  ...PYTHON_RULES,
  ...DJANGO_RULES,
  ...GO_RULES,
  ...RUBY_RULES,
  ...PHP_RULES,
  ...JAVA_RULES,
  ...RUST_RULES,
  ...CSHARP_RULES,
  ...DOCKERFILE_RULES,
  ...GITHUB_ACTIONS_RULES,
  ...TERRAFORM_RULES,
  ...GRAPHQL_RULES,
  ...DESIGN_RULES,
  ...DEBT_RULES,
  // ── Commit + Deployment governance ───────────────────────────────────────────
  ...COMMIT_RULES,
  ...VERCEL_RULES,
  // ── Agent Governance ─────────────────────────────────────────────────────────
  ...AGENT_RULES,
  // ── Dependency Security ───────────────────────────────────────────────────────
  ...DEP_RULES,
  // ── License Compliance ────────────────────────────────────────────────────────
  ...LICENSE_RULES,
  // ── GDPR Compliance ───────────────────────────────────────────────────────────
  ...GDPR_RULES,
  // ── AI-era attack surfaces (v2.1.0) ──────────────────────────────────────────
  ...MCP_RULES,
  ...RAG_RULES,
  ...WEBSOCKET_RULES,
  ...PROTOTYPE_RULES,
  ...JWT_AUTH_RULES,
  // ── Observable repos + security expansion (v2.3.0) ───────────────────────────
  ...SUPPLY_CHAIN_RULES,
  ...DAST_RULES,
  ...K8S_RULES,
  // ── Self-governance (v2.3.1) ─────────────────────────────────────────────────
  ...SELF_RULES,
];
