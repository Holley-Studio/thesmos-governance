/**
 * Vercel Deployment Governance Rules — VERCEL_001–010
 *
 * Catches misconfigured Vercel deployments, insecure environment variable
 * patterns, missing cron authentication, and deployment config mistakes
 * that cause silent failures or security vulnerabilities.
 *
 * Rules use the standard detect() interface. Rules that need to read the
 * filesystem (e.g. checking .env.example) call existsSync/readFileSync
 * directly inside detect() — established precedent in debt.ts and scope.ts.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface VercelConfig {
  enabled?: boolean;
  requiredEnvVars?: string[];
  plan?: 'hobby' | 'pro' | 'enterprise';
  requireCronAuth?: boolean;
}

// Hobby plan: 60s, Pro plan: 800s
const PLAN_MAX_DURATION: Record<string, number> = {
  hobby: 60,
  pro: 800,
  enterprise: 900,
};

function isVercelJson(path: string): boolean {
  return path === 'vercel.json' || path.endsWith('/vercel.json');
}

function isSourceFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs)$/.test(path) && !path.endsWith('.d.ts');
}

function isCronRoute(path: string): boolean {
  return /\bapi\b.*\bcron\b|\bcrons?\b.*\bapi\b/i.test(path) ||
    /\/cron\//.test(path) ||
    /cron[-_.]?route\.(ts|js)/.test(path);
}

function parseVercelJson(content: string): Record<string, unknown> | null {
  try { return JSON.parse(content) as Record<string, unknown>; } catch { return null; }
}

const SECRET_VALUE_RE = /(?:sk-|AIza|ya29\.|ghp_|ghs_|glpat-|xox[baprs]-|SG\.|AAAA[A-Za-z0-9]{6}|ey[A-Za-z0-9]{10,})[A-Za-z0-9._\-]{8,}/;

export const VERCEL_RULES: ThesmosRule[] = [
  {
    id: 'VERCEL_001',
    category: 'vercel_secret_in_config',
    description: "Never embed literal credential values in vercel.json. Use environment variable references instead.",
    severity: 'BLOCKER',
    tags: ['vercel', 'security', 'secrets'],
    sinceVersion: '1.3.0',
    explain: {
      why: "vercel.json is committed to git. Any literal API key, token, or credential value in this file is permanently exposed in the repository history, accessible to anyone with read access. Vercel supports @env-var-name references for all config values.",
      commonViolations: [
        '"env": { "DATABASE_URL": "postgres://user:realpassword@host/db" }',
        '"headers": [{ "value": "Bearer sk-abc123..." }]',
      ],
      goodExample: '"env": { "DATABASE_URL": "@database-url" }',
      badExample: '"env": { "DATABASE_URL": "postgres://user:pass@host/db" }',
      relatedPlaybooks: ['vercel-deployment.md', 'secret-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['env-var-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_secret_in_config', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isVercelJson(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SECRET_VALUE_RE.test(lines[i]!)) {
            findings.push({
              severity,
              category: 'vercel_secret_in_config',
              file: path,
              line: i + 1,
              message: 'Literal credential or token value detected in vercel.json.',
              suggestion: 'Use Vercel environment variable references: "@my-secret-name" instead of the raw value.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_002',
    category: 'vercel_server_secret_public_prefix',
    description: "Server secrets must never use the NEXT_PUBLIC_ prefix — it ships them to the browser bundle.",
    severity: 'BLOCKER',
    tags: ['vercel', 'nextjs', 'security', 'env'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Next.js inlines any NEXT_PUBLIC_ variable into the client-side JavaScript bundle at build time. If a secret (database URL, API key, service password) uses this prefix, every visitor to your site can read it in the page source.",
      commonViolations: [
        'NEXT_PUBLIC_DATABASE_URL="postgres://..."',
        'NEXT_PUBLIC_API_SECRET="sk-abc..."',
        'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY="..."',
      ],
      goodExample: 'DATABASE_URL="postgres://..."  # server-only, no NEXT_PUBLIC_ prefix',
      badExample: 'NEXT_PUBLIC_DATABASE_URL="postgres://..."  # ❌ ships to browser',
      relatedPlaybooks: ['nextjs-env-vars.md', 'secret-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['env-var-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_server_secret_public_prefix', config.severityRules);
      const SENSITIVE_PUBLIC_RE = /NEXT_PUBLIC_(?:[A-Z_]*(?:SECRET|KEY|PASSWORD|TOKEN|DATABASE|SERVICE_ROLE|PRIVATE)[A-Z_]*)/g;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path) && !path.includes('.env')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          SENSITIVE_PUBLIC_RE.lastIndex = 0;
          const m = SENSITIVE_PUBLIC_RE.exec(lines[i]!);
          if (m) {
            findings.push({
              severity,
              category: 'vercel_server_secret_public_prefix',
              file: path,
              line: i + 1,
              message: `Server secret "${m[0]}" uses NEXT_PUBLIC_ prefix — this ships the value to the browser bundle.`,
              suggestion: `Remove the NEXT_PUBLIC_ prefix. Server-only env vars don't need it.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_003',
    category: 'vercel_cron_no_secret_check',
    description: "Vercel Cron job route handlers must verify a CRON_SECRET authorization header.",
    severity: 'HIGH',
    tags: ['vercel', 'security', 'cron'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Vercel Cron routes are publicly accessible HTTP endpoints. Without checking the Authorization: Bearer $CRON_SECRET header, anyone on the internet can trigger your scheduled jobs — running expensive operations, sending emails to all users, or triggering data mutations on demand.",
      commonViolations: [
        '/api/cron/send-emails route that reads all users and sends without auth check',
        '/api/cron/process-queue that calls expensive AI operations without verifying caller',
      ],
      goodExample: "const authHeader = request.headers.get('authorization');\nif (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', { status: 401 });",
      badExample: "export async function GET() {\n  await sendEmailsToAllUsers(); // ❌ no auth check\n}",
      relatedPlaybooks: ['vercel-cron.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['cron-auth-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      if (config.vercel?.requireCronAuth === false) return [];
      const severity = classifySeverity('vercel_cron_no_secret_check', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isCronRoute(path)) continue;
        if (!isSourceFile(path)) continue;
        const hasCronCheck = /CRON_SECRET|cron[_-]?secret|x-cron-key/i.test(content);
        if (!hasCronCheck) {
          findings.push({
            severity,
            category: 'vercel_cron_no_secret_check',
            file: path,
            line: 1,
            message: 'Cron route handler does not check CRON_SECRET authorization.',
            suggestion: 'Add: if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return 401',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_004',
    category: 'vercel_env_not_in_example',
    description: "Every process.env.VAR_NAME used in source must be documented in .env.example.",
    severity: 'HIGH',
    tags: ['vercel', 'env', 'documentation'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Missing .env.example entries cause new team members and CI environments to break silently — the code runs but crashes at runtime because a required variable was never documented. .env.example is the contract between code and deployment.",
      commonViolations: [
        'process.env.STRIPE_WEBHOOK_SECRET used in source but absent from .env.example',
        'New env var added to Vercel dashboard but never added to .env.example for other developers',
      ],
      goodExample: '# .env.example\nSTRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here',
      badExample: '// source uses process.env.STRIPE_WEBHOOK_SECRET but .env.example has no entry for it',
      relatedPlaybooks: ['vercel-deployment.md'],
      relatedAgents: ['env-reviewer'],
      relatedSkills: ['env-var-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_env_not_in_example', config.severityRules);
      const findings: Finding[] = [];

      const root = process.cwd();
      const examplePath = join(root, '.env.example');
      if (!existsSync(examplePath)) return []; // VERCEL_005 handles missing file

      let exampleContent = '';
      try { exampleContent = readFileSync(examplePath, 'utf8'); } catch { return []; }

      const ENV_USE_RE = /process\.env\.([A-Z][A-Z0-9_]{2,})/g;
      const SKIP_VARS = new Set(['NODE_ENV', 'PORT', 'CI', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL']);

      for (const { path, content } of changedFiles) {
        if (!isSourceFile(path)) continue;
        if (/\.test\.|\.spec\./.test(path)) continue;

        ENV_USE_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = ENV_USE_RE.exec(content)) !== null) {
          const varName = m[1]!;
          if (SKIP_VARS.has(varName)) continue;
          if (!exampleContent.includes(varName)) {
            findings.push({
              severity,
              category: 'vercel_env_not_in_example',
              file: path,
              line: content.substring(0, m.index).split('\n').length,
              message: `Environment variable "${varName}" is used but not documented in .env.example.`,
              suggestion: `Add "${varName}=your_value_here" to .env.example`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_005',
    category: 'vercel_env_example_missing',
    description: "Projects that use process.env variables must have a .env.example file.",
    severity: 'HIGH',
    tags: ['vercel', 'env', 'documentation'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Without a .env.example file, there is no documented contract for what environment variables the application needs. New developers and CI environments cannot know what to configure, leading to mysterious runtime failures.",
      commonViolations: [
        'Project with 10+ env var usages but no .env.example at the repo root',
      ],
      goodExample: '# .env.example\nDATABASE_URL=postgres://localhost/myapp\nNEXT_PUBLIC_SITE_URL=http://localhost:3000',
      badExample: 'No .env.example file while source code uses process.env.DATABASE_URL',
      relatedPlaybooks: ['vercel-deployment.md'],
      relatedAgents: ['env-reviewer'],
      relatedSkills: ['env-var-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_env_example_missing', config.severityRules);
      const findings: Finding[] = [];

      const root = process.cwd();
      if (existsSync(join(root, '.env.example'))) return [];

      const ENV_USE_RE = /process\.env\.[A-Z][A-Z0-9_]{2,}/;
      const sourceWithEnv = changedFiles.find(
        ({ path, content }) => isSourceFile(path) && ENV_USE_RE.test(content)
      );

      if (sourceWithEnv) {
        findings.push({
          severity,
          category: 'vercel_env_example_missing',
          file: sourceWithEnv.path,
          message: 'Project uses environment variables but has no .env.example file.',
          suggestion: 'Create .env.example documenting every required environment variable with a placeholder value.',
        });
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_006',
    category: 'vercel_missing_max_duration',
    description: "API route functions in vercel.json should declare an explicit maxDuration to prevent runaway costs.",
    severity: 'MEDIUM',
    tags: ['vercel', 'performance', 'cost'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Without maxDuration, Vercel uses the plan default (10s on Hobby, 15s on Pro). Long-running operations like AI calls, report generation, or data exports will silently time out and return 504. Explicit maxDuration prevents surprises and documents intent.",
      commonViolations: [
        'vercel.json functions config without maxDuration for AI route handlers',
        'Export endpoint that takes 30s but has no maxDuration set',
      ],
      goodExample: '"functions": { "app/api/ai/route.ts": { "maxDuration": 60 } }',
      badExample: '"functions": { "app/api/ai/route.ts": {} }  // no maxDuration',
      relatedPlaybooks: ['vercel-deployment.md'],
      relatedAgents: ['performance-reviewer'],
      relatedSkills: ['vercel-config-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_missing_max_duration', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isVercelJson(path)) continue;
        const json = parseVercelJson(content);
        if (!json) continue;
        const functions = json['functions'] as Record<string, Record<string, unknown>> | undefined;
        if (!functions) continue;
        for (const [fnPath, fnConfig] of Object.entries(functions)) {
          if (!fnConfig['maxDuration']) {
            findings.push({
              severity,
              category: 'vercel_missing_max_duration',
              file: path,
              message: `Function "${fnPath}" has no maxDuration in vercel.json.`,
              suggestion: 'Add "maxDuration": 30 (or appropriate value) to avoid unexpected timeouts.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_007',
    category: 'vercel_edge_runtime_missing',
    description: "Middleware files (middleware.ts) must export `export const runtime = 'edge'`.",
    severity: 'MEDIUM',
    tags: ['vercel', 'nextjs', 'edge-runtime'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Next.js middleware runs on the Edge runtime by default in newer versions, but without an explicit export it can accidentally run on Node.js runtime, losing global CDN distribution and adding cold start latency. Making the runtime explicit ensures consistent behavior.",
      commonViolations: [
        'middleware.ts without runtime export — behavior depends on Next.js version',
      ],
      goodExample: "export const runtime = 'edge';\nexport function middleware(request: NextRequest) { ... }",
      badExample: "// middleware.ts — no runtime export, may fall back to Node.js",
      relatedPlaybooks: ['nextjs-middleware.md'],
      relatedAgents: ['performance-reviewer'],
      relatedSkills: ['edge-runtime-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_edge_runtime_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/(?:^|\/)middleware\.(ts|js)$/.test(path)) continue;
        if (!/export\s+const\s+runtime/.test(content)) {
          findings.push({
            severity,
            category: 'vercel_edge_runtime_missing',
            file: path,
            message: 'middleware.ts is missing an explicit runtime export.',
            suggestion: "Add: export const runtime = 'edge'; at the top of the file.",
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_008',
    category: 'vercel_header_missing_security',
    description: "vercel.json headers config should include X-Frame-Options, X-Content-Type-Options, and Content-Security-Policy.",
    severity: 'MEDIUM',
    tags: ['vercel', 'security', 'headers'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Missing security headers leave the application vulnerable to clickjacking (X-Frame-Options), MIME sniffing attacks (X-Content-Type-Options), and XSS (Content-Security-Policy). These are trivial to add and required by most security audits and compliance frameworks.",
      commonViolations: [
        'vercel.json with custom headers but no security headers defined',
        'Headers config that only sets Cache-Control but misses security headers',
      ],
      goodExample: '"headers": [{ "source": "/(.*)", "headers": [{ "key": "X-Frame-Options", "value": "DENY" }, { "key": "X-Content-Type-Options", "value": "nosniff" }] }]',
      badExample: '"headers": [{ "source": "/(.*)", "headers": [{ "key": "Cache-Control", "value": "max-age=3600" }] }]',
      relatedPlaybooks: ['security-headers.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['security-headers-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_header_missing_security', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isVercelJson(path)) continue;
        const json = parseVercelJson(content);
        if (!json) continue;
        const headers = json['headers'] as Array<{ source?: string; headers?: Array<{ key?: string }> }> | undefined;
        if (!headers || headers.length === 0) continue;

        const allHeaderKeys = headers
          .flatMap((h) => h.headers ?? [])
          .map((h) => (h.key ?? '').toLowerCase());

        const missing: string[] = [];
        if (!allHeaderKeys.some((k) => k === 'x-frame-options')) missing.push('X-Frame-Options');
        if (!allHeaderKeys.some((k) => k === 'x-content-type-options')) missing.push('X-Content-Type-Options');
        if (!allHeaderKeys.some((k) => k === 'content-security-policy')) missing.push('Content-Security-Policy');

        if (missing.length > 0) {
          findings.push({
            severity,
            category: 'vercel_header_missing_security',
            file: path,
            message: `vercel.json headers config is missing security headers: ${missing.join(', ')}`,
            suggestion: 'Add these security headers to the global headers source pattern "/(.*)".',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_009',
    category: 'vercel_max_duration_exceeds_plan',
    description: "maxDuration in vercel.json must not exceed the plan limit (Hobby: 60s, Pro: 800s).",
    severity: 'LOW',
    tags: ['vercel', 'configuration'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Vercel silently ignores maxDuration values that exceed the plan limit — the function runs for the plan maximum, not the configured value. This creates a false sense of security and hides misconfiguration that will cause unexpected timeouts in production.",
      commonViolations: [
        '"maxDuration": 300 on a Hobby plan project (max is 60)',
        '"maxDuration": 900 on a Pro plan project (max is 800)',
      ],
      goodExample: '"maxDuration": 60  // within Hobby plan limit',
      badExample: '"maxDuration": 300  // silently capped at 60 on Hobby plan',
      relatedPlaybooks: ['vercel-deployment.md'],
      relatedAgents: ['configuration-reviewer'],
      relatedSkills: ['vercel-config-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_max_duration_exceeds_plan', config.severityRules);
      const plan = config.vercel?.plan ?? 'pro';
      const planMax = PLAN_MAX_DURATION[plan] ?? 800;
      const findings: Finding[] = [];

      for (const { path, content } of changedFiles) {
        if (!isVercelJson(path)) continue;
        const json = parseVercelJson(content);
        if (!json) continue;
        const functions = json['functions'] as Record<string, Record<string, unknown>> | undefined;
        if (!functions) continue;
        for (const [fnPath, fnConfig] of Object.entries(functions)) {
          const maxDuration = fnConfig['maxDuration'];
          if (typeof maxDuration === 'number' && maxDuration > planMax) {
            findings.push({
              severity,
              category: 'vercel_max_duration_exceeds_plan',
              file: path,
              message: `Function "${fnPath}" has maxDuration: ${maxDuration} which exceeds the ${plan} plan limit of ${planMax}s. Vercel will silently cap it.`,
              suggestion: `Set maxDuration to ${planMax} or less, or upgrade your plan.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VERCEL_010',
    category: 'vercel_open_redirect',
    description: "vercel.json redirect destinations using wildcards must be restricted to the same domain.",
    severity: 'HIGH',
    tags: ['vercel', 'security', 'redirects'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Open redirect vulnerabilities allow attackers to craft URLs that appear to be from your trusted domain but redirect users to phishing sites. Vercel wildcard redirects with $1 placeholders in the destination must include an explicit domain to prevent this.",
      commonViolations: [
        '{ "source": "/go/:path", "destination": "/:path" } — redirects to any path including external URLs',
        '{ "source": "/r/(.*)", "destination": "$1" } — completely open redirect',
      ],
      goodExample: '{ "source": "/app/:path*", "destination": "https://app.example.com/:path*" }',
      badExample: '{ "source": "/r/(.*)", "destination": "$1" }  // ❌ open redirect',
      relatedPlaybooks: ['security-headers.md', 'vercel-deployment.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['redirect-validator'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('vercel_open_redirect', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isVercelJson(path)) continue;
        const json = parseVercelJson(content);
        if (!json) continue;
        const redirects = json['redirects'] as Array<{ source?: string; destination?: string }> | undefined;
        if (!redirects) continue;
        for (const redirect of redirects) {
          const dest = redirect.destination ?? '';
          // Warn if destination uses $1 or wildcard without a leading https:// or same-domain /
          if ((/\$\d+/.test(dest) || /\*/.test(dest)) && !/^https?:\/\//.test(dest) && !/^\/[^/]/.test(dest)) {
            findings.push({
              severity,
              category: 'vercel_open_redirect',
              file: path,
              message: `Redirect destination "${dest}" uses a wildcard/capture group without a fixed domain — potential open redirect.`,
              suggestion: 'Prefix the destination with your domain (e.g. "https://example.com/$1") to prevent open redirect.',
            });
          }
        }
      }
      return findings;
    },
  },
];
