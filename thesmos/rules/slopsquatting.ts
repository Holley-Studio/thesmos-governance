/**
 * Slopsquatting Rules — SLOP_001–015
 *
 * "Slopsquatting" — AI coding assistants hallucinate package names in import
 * statements. Research shows 19.7% of AI-generated code samples contain at
 * least one hallucinated package name, with 43% of hallucinated names
 * appearing consistently across identical prompts (making them trivially
 * exploitable: publish the fake package to npm and wait for installs).
 *
 * These rules catch phantom imports at the source-code level — before
 * `npm install` ever runs — which no other static analysis tool currently does.
 *
 * Reference: "Slopsquatting: AI Package Hallucination Attacks" (Aikido, 2025)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Known hallucinated package names (documented by security researchers) ──────
// These are packages AI tools consistently invent that do not exist on npm.
// Updated based on Aikido Security, DZone, and Socket.dev research (2025).

export const KNOWN_PHANTOMS = new Set([
  // Express ecosystem hallucinations
  'express-mongoose',
  'express-validator-middleware',
  'express-async-errors',
  'express-request-validator',
  'express-route-handler',
  'express-api-router',
  // React hallucinations
  'react-use-hooks',
  'react-hook-utils',
  'react-form-validator',
  'react-api-client',
  'react-query-utils',
  'react-state-manager',
  // Next.js hallucinations
  'next-auth-utils',
  'next-api-handler',
  'next-middleware-utils',
  'next-route-handler',
  'nextjs-helpers',
  // Database hallucinations
  'prisma-client-utils',
  'drizzle-utils',
  'db-connector',
  'database-utils',
  'mongoose-utils',
  'sequelize-helper',
  // Auth hallucinations
  'auth-helpers',
  'jwt-helper',
  'session-manager',
  'auth-middleware',
  'passport-jwt-helper',
  // Utility hallucinations
  'string-helpers',
  'array-utils',
  'object-helpers',
  'date-helpers',
  'type-helpers',
  'validation-utils',
  'error-handler',
  'logger-utils',
  // AI SDK hallucinations
  'openai-helper',
  'openai-utils',
  'anthropic-helper',
  'claude-sdk',
  'ai-helpers',
  'llm-utils',
  // Generic hallucinations
  'api-client',
  'http-client',
  'fetch-utils',
  'config-loader',
  'env-helper',
  'file-utils',
  'crypto-helper',
  'hash-utils',
]);

// Packages that look like squatting on popular names (common typosquats + AI variants)
export const SUSPICIOUS_PATTERNS = [
  /^(react|next|express|prisma|drizzle|fastify|hono|vue|nuxt|angular)-(helper|util|utils|handler|middleware|wrapper|plugin|kit|tools?|lib|core|base|common|shared|extra|plus)s?$/,
  /^@(ai|llm|gpt|claude|openai|anthropic)\//,  // suspicious AI scopes
  /-(utils|helpers?|tools?)-(utils|helpers?|tools?)$/, // double suffix
];

// Top popular npm packages — used for typosquatting detection (SLOP_009)
const TOP_PACKAGES = [
  'lodash', 'chalk', 'commander', 'yargs', 'minimist', 'dotenv', 'uuid', 'axios',
  'express', 'fastify', 'koa', 'hapi', 'hono',
  'react', 'react-dom', 'vue', 'svelte', 'angular',
  'next', 'nuxt', 'gatsby', 'remix', 'astro',
  'typescript', 'tsx', 'esbuild', 'vite', 'webpack', 'rollup', 'parcel',
  'jest', 'vitest', 'mocha', 'jasmine', 'ava',
  'eslint', 'prettier', 'biome',
  'prisma', 'mongoose', 'sequelize', 'typeorm', 'knex', 'drizzle-orm',
  'passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs',
  'moment', 'date-fns', 'dayjs', 'luxon',
  'zod', 'joi', 'yup', 'ajv',
  'redux', 'zustand', 'recoil', 'mobx', 'jotai', 'pinia',
  'graphql', 'socket.io', 'ioredis', 'redis', 'ws',
  'openai', 'langchain', 'sharp', 'nodemailer', 'stripe',
  'multer', 'helmet', 'cors', 'morgan', 'pino', 'winston',
  'cheerio', 'puppeteer', 'playwright',
  'semver', 'glob', 'chokidar', 'nodemon', 'concurrently',
];

// Legitimate npm organization scopes — unlisted scopes trigger SLOP_010
const KNOWN_SCOPES = new Set([
  '@types', '@angular', '@vue', '@babel', '@jest', '@vitest',
  '@nestjs', '@prisma', '@tanstack', '@radix-ui', '@storybook',
  '@sentry', '@vercel', '@aws-sdk', '@google-cloud',
  '@anthropic-ai', '@openai', '@langchain', '@mistralai', '@cohere-ai',
  '@mui', '@chakra-ui', '@tailwindcss', '@floating-ui', '@headlessui',
  '@emotion', '@mantine', '@dnd-kit', '@tiptap', '@lexical',
  '@trpc', '@hono', '@elysiajs', '@fastify',
  '@typeorm', '@mikro-orm',
  '@graphql-tools', '@apollo', '@urql', '@pothos-graphql',
  '@testing-library', '@playwright',
  '@vitejs', '@sveltejs', '@astrojs', '@solidjs',
  '@remix-run', '@expo', '@react-native-community',
  '@capacitor', '@ionic', '@swc', '@biomejs',
  '@octokit', '@stripe', '@sendgrid',
  '@supabase', '@nhost', '@pocketbase',
  '@auth0', '@clerk', '@nextauth',
  '@upstash', '@planetscale', '@neon',
  '@drizzle-team', '@trufflesuite',
]);

// Levenshtein distance — space-optimised O(min(m,n)) variant
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[n]!;
}

// ── Lockfile package reader — confirms a package has been installed ───────────

export function getLockfilePackages(root: string): Set<string> | null {
  const npmLock = join(root, 'package-lock.json');
  if (existsSync(npmLock)) {
    try {
      const lock = JSON.parse(readFileSync(npmLock, 'utf8')) as {
        packages?: Record<string, unknown>;
        dependencies?: Record<string, unknown>;
      };
      if (lock.packages) {
        return new Set(
          Object.keys(lock.packages)
            .filter((k) => k.startsWith('node_modules/'))
            .map((k) => k.slice('node_modules/'.length)),
        );
      }
      if (lock.dependencies) return new Set(Object.keys(lock.dependencies));
    } catch { /* ignore */ }
  }
  const yarnLock = join(root, 'yarn.lock');
  if (existsSync(yarnLock)) {
    const names = new Set<string>();
    const text = readFileSync(yarnLock, 'utf8');
    const re = /^["']?([^"'@\n,\s][^@\n]*)@/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.add(m[1].trim());
    return names;
  }
  const pnpmLock = join(root, 'pnpm-lock.yaml');
  if (existsSync(pnpmLock)) {
    const names = new Set<string>();
    const text = readFileSync(pnpmLock, 'utf8');
    const re = /^\s+'?([a-z@][^'@\n\s]*)@/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.add(m[1].trim());
    return names;
  }
  return null;
}

// ── Parse package.json for installed packages ─────────────────────────────────

function getInstalledPackages(root: string): Set<string> {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return new Set();
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

// ── Import parser — extract package names from import/require statements ───────

const IMPORT_RE = /^(?:import\s+.*\s+from\s+|import\s+|export\s+.*\s+from\s+|const\s+\w+\s*=\s*require\s*\()\s*['"`]([^'"`./][^'"`]*)['"`]/;
const DYNAMIC_IMPORT_RE = /(?:await\s+)?import\s*\(\s*['"`]([^'"`./][^'"`]*)['"`]\s*\)/;

function extractPackageName(importPath: string): string {
  // Scoped: @scope/name → @scope/name
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return parts.slice(0, 2).join('/');
  }
  // Regular: package/subpath → package
  return importPath.split('/')[0];
}

function parseImports(content: string): Array<{ pkg: string; line: number }> {
  const imports: Array<{ pkg: string; line: number }> = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = IMPORT_RE.exec(line) ?? DYNAMIC_IMPORT_RE.exec(line);
    if (m) {
      imports.push({ pkg: extractPackageName(m[1]), line: i + 1 });
    }
  }
  return imports;
}

// ── Built-in Node.js modules (these are never in package.json) ────────────────

const NODE_BUILTINS = new Set([
  'node:fs', 'node:path', 'node:os', 'node:crypto', 'node:http', 'node:https',
  'node:url', 'node:util', 'node:stream', 'node:events', 'node:child_process',
  'node:buffer', 'node:assert', 'node:net', 'node:dns', 'node:readline',
  'node:vm', 'node:module', 'node:worker_threads', 'node:perf_hooks',
  'node:inspector', 'node:cluster', 'node:zlib', 'node:querystring',
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'stream',
  'events', 'child_process', 'buffer', 'assert', 'net', 'dns', 'readline',
  'vm', 'module', 'worker_threads', 'perf_hooks', 'inspector', 'cluster',
  'zlib', 'querystring', 'string_decoder', 'timers', 'tty', 'v8',
]);

// ── Slopsquatting Rules ───────────────────────────────────────────────────────

export const SLOPSQUATTING_RULES: ThesmosRule[] = [
  {
    id: 'SLOP_001',
    category: 'slop_phantom_import',
    description: 'Import references a package not listed in package.json — may be an AI-hallucinated phantom dependency.',
    severity: 'BLOCKER',
    tags: ['security', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI coding assistants hallucinate package names in 19.7% of code samples. When a phantom package is published to npm by an attacker before the developer notices, every `npm install` silently installs malicious code. This rule catches the phantom import in source before `npm install` ever runs.',
      commonViolations: [
        'import { Router } from "express-api-router" — does not exist on npm',
        'import { validate } from "react-form-validator" — AI invention',
        'import helpers from "next-middleware-utils" — hallucinated package',
      ],
      goodExample: 'import { Router } from "express"; // real package, in package.json',
      badExample: 'import { validate } from "express-mongoose"; // ❌ does not exist on npm',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ scan, changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_phantom_import', config.severityRules);
      const findings: Finding[] = [];

      // Find the repo root by looking for package.json via scan data
      // We use the riskyFiles / scriptFiles to approximate root, or fall back to cwd
      const installed = getInstalledPackages(process.cwd());
      if (installed.size === 0) return []; // can't check without package.json

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) {
            findings.push({
              severity: sev,
              category: 'slop_phantom_import',
              file: path, line,
              message: `"${pkg}" is not in package.json and matches a known AI-hallucinated package name.`,
              suggestion: `Verify this package exists on npm (https://npmjs.com/package/${encodeURIComponent(pkg)}) and add it to package.json, or remove the import if it was hallucinated.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_002',
    category: 'slop_undeclared_import',
    description: 'Package imported in source code is not declared in package.json — phantom dependency or missing install.',
    severity: 'HIGH',
    tags: ['correctness', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools generate code that imports packages without checking if they\'re installed. Undeclared imports fail at runtime, cause "Module not found" errors in CI, and — if the package name happens to be one an attacker has squatted — silently install malicious code.',
      commonViolations: [
        'import { something } from "a-package-not-in-package-json"',
        'Missing package added to imports but not to dependencies',
        'AI generated a fully working code sample using a package it invented',
      ],
      goodExample: '// Always verify imports against package.json\n// Run: npm ls <package-name> to check it\'s installed',
      badExample: 'import { formatDate } from "date-helpers"; // ❌ not in package.json',
      relatedPlaybooks: ['dependency-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_undeclared_import', config.severityRules);
      const findings: Finding[] = [];
      const installed = getInstalledPackages(process.cwd());
      if (installed.size === 0) return [];

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) continue; // already caught by SLOP_001
          // Flag as undeclared — may be legit (monorepo workspace) or phantom
          findings.push({
            severity: sev,
            category: 'slop_undeclared_import',
            file: path, line,
            message: `"${pkg}" is imported but not found in package.json dependencies.`,
            suggestion: `Run \`npm install ${pkg}\` if this is a real package, or check if it was AI-hallucinated at https://npmjs.com/package/${encodeURIComponent(pkg)}.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_003',
    category: 'slop_suspicious_package_name',
    description: 'Package name follows patterns common in AI-hallucinated packages (framework + generic suffix).',
    severity: 'MEDIUM',
    tags: ['security', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools hallucinate packages with predictable naming patterns: `react-utils`, `express-helper`, `next-api-handler`. These names sound real, exist on npm as unrelated or malicious packages, and get installed without scrutiny. Flagging suspicious patterns prompts manual verification.',
      commonViolations: [
        'react-utils — sounds like a real package, is actually unrelated',
        'express-helper — generic name with no canonical owner',
        'next-api-handler — AI-invented abstraction',
      ],
      goodExample: '// Use specific, well-maintained packages with clear ownership:\nimport { clsx } from "clsx"; // explicit, well-known\nimport type { FC } from "react"; // part of core React types',
      badExample: 'import { formatResponse } from "express-utils"; // ❌ generic name, verify it\'s real',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_suspicious_package_name', config.severityRules);
      const findings: Finding[] = [];
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) continue; // caught by SLOP_001
          if (SUSPICIOUS_PATTERNS.some((re) => re.test(pkg))) {
            findings.push({
              severity: sev,
              category: 'slop_suspicious_package_name',
              file: path, line,
              message: `"${pkg}" has a generic name pattern common in AI-hallucinated packages.`,
              suggestion: `Verify this package is legitimate and maintained at https://npmjs.com/package/${encodeURIComponent(pkg)} before installing.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_004',
    category: 'slop_known_phantom_list',
    description: 'Import matches a package on the documented list of AI-hallucinated package names from security research.',
    severity: 'BLOCKER',
    tags: ['security', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'Security researchers have documented specific package names that AI tools hallucinate repeatedly across millions of code samples. These names have been registered on npm by researchers and attackers alike to prove the attack vector is real. Any occurrence in your codebase is almost certainly an AI hallucination.',
      commonViolations: KNOWN_PHANTOMS.size > 0 ? [...KNOWN_PHANTOMS].slice(0, 3).map((p) => `import ... from "${p}"`) : [],
      goodExample: 'Always verify new package imports against your package.json before committing.',
      badExample: [...KNOWN_PHANTOMS].slice(0, 1).map((p) => `import { foo } from "${p}"; // ❌ documented hallucination`).join('\n'),
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_known_phantom_list', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (KNOWN_PHANTOMS.has(pkg)) {
            findings.push({
              severity: sev,
              category: 'slop_known_phantom_list',
              file: path, line,
              message: `"${pkg}" appears on the documented list of AI-hallucinated package names. This package may not exist or may be malicious.`,
              suggestion: `Remove this import. If you need this functionality, find the real package that provides it (e.g., check npm for the canonical alternative).`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_005',
    category: 'slop_ai_comment_import',
    description: 'Import immediately following an AI-generated code comment — high likelihood of hallucinated package.',
    severity: 'MEDIUM',
    tags: ['security', 'slopsquatting', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools often add their own explanatory comments immediately before generated code blocks. An import following an "// AI generated" or "// Generated by" comment signals the import was written by an AI assistant and may not have been verified against a real package registry.',
      commonViolations: [
        '// Generated by Claude\nimport { something } from "invented-package"',
        '// AI: Using the express-validator-middleware package\nimport { validate } from "express-validator-middleware"',
        '// TODO: install this package\nimport { helper } from "helper-package"',
      ],
      goodExample: '// Verified: clsx is a real, maintained package\nimport { clsx } from "clsx";',
      badExample: '// AI: install this helper package\nimport { formatData } from "data-formatter-utils"; // ❌ verify before committing',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_ai_comment_import', config.severityRules);
      const findings: Finding[] = [];
      const AI_COMMENT = /\/\/\s*(?:AI|Generated by|generated|TODO: install|install this|add this package|requires|needs package)/i;
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          if (!AI_COMMENT.test(lines[i])) continue;
          const nextLine = lines[i + 1];
          const m = IMPORT_RE.exec(nextLine);
          if (!m) continue;
          const pkg = extractPackageName(m[1]);
          if (NODE_BUILTINS.has(pkg) || installed.has(pkg)) continue;
          findings.push({
            severity: sev,
            category: 'slop_ai_comment_import',
            file: path, line: i + 2,
            message: `Import of "${pkg}" follows an AI-generated comment and is not in package.json — verify it exists.`,
            suggestion: `Check https://npmjs.com/package/${encodeURIComponent(pkg)} and run \`npm install ${pkg}\` if it's real, or remove the import if hallucinated.`,
          });
        }
      }
      return findings;
    },
  },

  // ── SLOP_006–015: Extended supply-chain validation ─────────────────────────

  {
    id: 'SLOP_006',
    category: 'slop_not_in_lockfile',
    description: 'Package imported in source code is absent from the project lockfile — it has never been installed or audited.',
    severity: 'HIGH',
    tags: ['security', 'slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'The lockfile is the source of truth for which package versions were installed and audited. A package that appears in imports but not in the lockfile has never been through npm install — it either hasn\'t been installed yet, or is an AI-hallucinated phantom.',
      commonViolations: [
        'import { something } from "package-that-was-never-installed"',
        'AI adds an import without adding the package to package.json',
      ],
      goodExample: '// npm install --save-exact some-package, then import it',
      badExample: 'import { feature } from "uninstalled-pkg"; // ❌ not in lockfile',
      relatedPlaybooks: ['dependency-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_not_in_lockfile', config.severityRules);
      const findings: Finding[] = [];
      const lockfilePackages = getLockfilePackages(process.cwd());
      if (!lockfilePackages) return [];
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (lockfilePackages.has(pkg)) continue;
          findings.push({
            severity: sev,
            category: 'slop_not_in_lockfile',
            file: path, line,
            message: `"${pkg}" is not in the lockfile — it has never been installed. Run \`npm install ${pkg}\` or verify it isn't hallucinated.`,
            suggestion: `Run \`npm ls ${pkg}\` to check if it's installed. If it doesn't exist on npm, it may be an AI-hallucinated package.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_007',
    category: 'slop_install_no_exact',
    description: '`npm install <package>` without `--save-exact` in scripts or CI — allows version drift in autonomous agent sessions.',
    severity: 'MEDIUM',
    tags: ['security', 'slopsquatting', 'ai-risk', 'supply-chain', 'ci'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'When AI agents run `npm install <package>` without `--save-exact`, npm writes a caret range (^x.y.z). An attacker who publishes a malicious patch to a squatted package name can silently deliver malware on the next install.',
      commonViolations: [
        'npm install some-package  # installs ^1.0.0 by default',
        'RUN npm install package-name  # Dockerfile without --save-exact',
      ],
      goodExample: 'npm install --save-exact some-package  # pins to exactly 1.2.3',
      badExample: 'npm install some-package  # ❌ installs ^1.2.3, allows drift',
      relatedPlaybooks: ['dependency-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_install_no_exact', config.severityRules);
      const findings: Finding[] = [];
      const SCRIPT_EXTS = /\.(sh|bash|zsh|fish|ps1|cmd|bat|mk|makefile|dockerfile|yml|yaml)$/i;
      const INSTALL_RE = /\bnpm\s+(?:i|install|add)\s+([^-\s][^\s]*)/;
      const EXACT_FLAG_RE = /--save-exact|-E\b/;

      for (const { path, content } of changedFiles) {
        if (!SCRIPT_EXTS.test(path) && !path.toLowerCase().endsWith('dockerfile')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const m = INSTALL_RE.exec(line);
          if (!m) continue;
          if (EXACT_FLAG_RE.test(line)) continue;
          if (/--global|-g\b/.test(line)) continue;
          const pkg = m[1];
          if (!pkg || pkg.startsWith('-')) continue;
          findings.push({
            severity: sev,
            category: 'slop_install_no_exact',
            file: path, line: i + 1,
            message: `\`npm install ${pkg}\` without \`--save-exact\` allows version drift.`,
            suggestion: 'Add --save-exact (or -E) to pin the exact version: `npm install --save-exact ' + pkg + '`',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_008',
    category: 'slop_wildcard_version',
    description: 'Package version set to `latest`, `*`, or `x` in package.json — no version locking, exploitable if the package is squatted.',
    severity: 'HIGH',
    tags: ['security', 'slopsquatting', 'supply-chain', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: '`"package": "latest"` means every npm install fetches whatever the current version is. If an attacker publishes a malicious version, every future install delivers their payload. AI agents commonly set versions to `latest` or `*` when they don\'t know the current version.',
      commonViolations: [
        '"some-package": "latest"',
        '"some-package": "*"',
        '"some-package": "x"',
      ],
      goodExample: '"some-package": "1.2.3"  // or "^1.2.3" with a lockfile',
      badExample: '"some-package": "latest"  // ❌ no version locking',
      relatedPlaybooks: ['dependency-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_wildcard_version', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('package.json')) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        const depGroups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
        for (const group of depGroups) {
          const deps = pkg[group] as Record<string, string> | undefined;
          if (!deps) continue;
          for (const [name, version] of Object.entries(deps)) {
            if (version === 'latest' || version === '*' || version === 'x') {
              findings.push({
                severity: sev,
                category: 'slop_wildcard_version',
                file: path,
                message: `"${name}" has version "${version}" — no version locking. Specify a semver range or exact version.`,
                suggestion: `Replace "${version}" with a specific version. Run \`npm view ${name} version\` to get the current version.`,
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_009',
    category: 'slop_typosquat_candidate',
    description: 'Package name is within edit-distance 2 of a popular npm package — possible typosquatting attack or AI typo.',
    severity: 'BLOCKER',
    tags: ['security', 'slopsquatting', 'supply-chain', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Typosquatting publishes `lodhash` (typo of `lodash`) with malicious code and waits for developers to mistype. AI coding assistants also generate import names with subtle spelling variations. Levenshtein distance ≤ 2 catches packages one or two characters away from a popular package.',
      commonViolations: [
        'import _ from "lodhash"  // edit distance 2 from lodash',
        'import axios from "axious"  // extra s',
        'import chalk from "chalks"  // extra s',
      ],
      goodExample: 'import _ from "lodash";  // verified correct spelling',
      badExample: 'import _ from "lodahs";  // ❌ edit distance 2 from lodash',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_typosquat_candidate', config.severityRules);
      const findings: Finding[] = [];
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) continue;
          if (pkg.startsWith('@')) continue;
          if (pkg.length < 4) continue; // too short to meaningfully check
          let minDist = 99;
          let closest = '';
          for (const popular of TOP_PACKAGES) {
            if (popular === pkg) { minDist = 0; break; }
            const d = editDistance(pkg, popular);
            if (d < minDist) { minDist = d; closest = popular; }
          }
          if (minDist > 0 && minDist <= 2) {
            findings.push({
              severity: sev,
              category: 'slop_typosquat_candidate',
              file: path, line,
              message: `"${pkg}" is ${minDist} character${minDist > 1 ? 's' : ''} away from the popular package "${closest}" — possible typosquatting or AI typo.`,
              suggestion: `Did you mean "${closest}"? Verify this package at https://npmjs.com/package/${encodeURIComponent(pkg)} and confirm it is not a typosquat.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_010',
    category: 'slop_unknown_scope',
    description: 'Scoped npm package from an organization not in the known-scope list — verify the org is legitimate.',
    severity: 'MEDIUM',
    tags: ['security', 'slopsquatting', 'supply-chain', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools generate imports like `@utils/crypto` or `@helper/auth` that look plausible but reference unknown npm scopes. Scoped packages from unrecognized organizations are harder to validate and may be malicious or non-existent.',
      commonViolations: [
        'import { encrypt } from "@utils/crypto"  // unknown scope',
        'import { validate } from "@helper/schema"  // AI-invented scope',
      ],
      goodExample: 'import { something } from "@anthropic-ai/sdk";  // known org scope',
      badExample: 'import { helper } from "@utils/helpers";  // ❌ unknown scope @utils',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_unknown_scope', config.severityRules);
      const findings: Finding[] = [];
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (!pkg.startsWith('@')) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) continue;
          const scope = pkg.split('/')[0] ?? '';
          if (KNOWN_SCOPES.has(scope)) continue;
          if (SUSPICIOUS_PATTERNS.some((re) => re.test(pkg))) continue;
          findings.push({
            severity: sev,
            category: 'slop_unknown_scope',
            file: path, line,
            message: `"${pkg}" is from an unrecognized npm scope "${scope}" — verify this organization is legitimate.`,
            suggestion: `Check https://www.npmjs.com/org/${scope.slice(1)} to verify the scope owner. If this is a monorepo internal package, use a path alias instead.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_011',
    category: 'slop_python_unpinned',
    description: 'Python dependency in requirements.txt without an exact version pin — allows malicious upgrades.',
    severity: 'MEDIUM',
    tags: ['security', 'slopsquatting', 'supply-chain', 'python', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools generating Python code often write unpinned requirements like `requests` or `fastapi` with no version specifier. Without `==x.y.z`, pip fetches the latest version — creating the same attack surface as npm `latest`. A squatted or compromised package can deliver malware on the next install.',
      commonViolations: [
        'requests  # no version — any version installs',
        'fastapi  # AI omitted the version pin',
        'numpy  # unpinned',
      ],
      goodExample: 'requests==2.31.0\nfastapi==0.110.0',
      badExample: 'requests  # ❌ no version pin',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['python-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_python_unpinned', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('requirements.txt') && !path.endsWith('requirements.in')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = (lines[i] ?? '').trim();
          if (!line || line.startsWith('#') || line.startsWith('-')) continue;
          if (/[=<>!~\[@]/.test(line)) continue;
          findings.push({
            severity: sev,
            category: 'slop_python_unpinned',
            file: path, line: i + 1,
            message: `"${line}" has no version pin — pip will fetch the latest version, which may be malicious.`,
            suggestion: `Pin to an exact version: \`${line}==<version>\`. Run \`pip show ${line}\` to get the current installed version.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_012',
    category: 'slop_phantom_install',
    description: 'Suspicious package added to package.json but not imported in any changed source file — possible phantom dependency.',
    severity: 'HIGH',
    tags: ['security', 'slopsquatting', 'supply-chain', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI agents sometimes add a package to package.json and run npm install without ever using it in code. This phantom install adds untrusted code to the dependency tree with no benefit. It may also indicate the AI invented the package name and added it as a placeholder.',
      commonViolations: [
        'Added "hallucinated-package" to package.json but never imported it',
        'AI added a dependency "just in case" without using it anywhere',
      ],
      goodExample: '// Only add dependencies you immediately import in your code',
      badExample: '// package.json: "phantom-helper": "^1.0.0" — but never imported',
      relatedPlaybooks: ['dependency-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_phantom_install', config.severityRules);
      const findings: Finding[] = [];

      for (const { path, content } of changedFiles) {
        if (!path.endsWith('package.json')) continue;
        let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        try { pkg = JSON.parse(content) as typeof pkg; } catch { continue; }

        const allDeps = new Set([
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        ]);

        const usedPackages = new Set<string>();
        for (const { path: srcPath, content: srcContent } of changedFiles) {
          if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(srcPath)) continue;
          for (const { pkg: importedPkg } of parseImports(srcContent)) {
            usedPackages.add(importedPkg);
          }
        }

        for (const dep of allDeps) {
          if (usedPackages.has(dep)) continue;
          if (NODE_BUILTINS.has(dep)) continue;
          // Only flag known phantoms or suspicious patterns to avoid false positives on build tools
          if (!KNOWN_PHANTOMS.has(dep) && !SUSPICIOUS_PATTERNS.some((re) => re.test(dep))) continue;
          findings.push({
            severity: sev,
            category: 'slop_phantom_install',
            file: path,
            message: `"${dep}" was added to package.json but is not imported in any changed source file — possible phantom dependency.`,
            suggestion: `Remove "${dep}" from package.json if it's not needed, or add the import to the file that uses it.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_013',
    category: 'slop_git_url_dep',
    description: 'Package.json dependency using a git URL or tarball — bypasses npm audit and version locking.',
    severity: 'MEDIUM',
    tags: ['security', 'slopsquatting', 'supply-chain', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI agents sometimes install packages directly from GitHub URLs or tarballs. These bypass `npm audit`, can\'t be verified on the npm registry, and pull live code that may change without a version bump — a documented supply chain attack vector.',
      commonViolations: [
        '"some-pkg": "github:user/repo"',
        '"some-pkg": "git+https://github.com/user/repo.git"',
        '"some-pkg": "https://example.com/pkg.tgz"',
      ],
      goodExample: '"some-pkg": "1.2.3"  // published npm version',
      badExample: '"some-pkg": "github:someuser/somerepo"  // ❌ bypasses audit',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_git_url_dep', config.severityRules);
      const findings: Finding[] = [];
      const GIT_VERSION_RE = /^(?:git\+?https?:\/\/|git:\/\/|github:|gitlab:|bitbucket:|https?:\/\/.+\.(?:tgz|tar\.gz|zip)|file:)/i;

      for (const { path, content } of changedFiles) {
        if (!path.endsWith('package.json')) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as typeof pkg; } catch { continue; }

        const depGroups = ['dependencies', 'devDependencies', 'optionalDependencies'];
        for (const group of depGroups) {
          const deps = pkg[group] as Record<string, string> | undefined;
          if (!deps) continue;
          for (const [name, version] of Object.entries(deps)) {
            if (GIT_VERSION_RE.test(version)) {
              findings.push({
                severity: sev,
                category: 'slop_git_url_dep',
                file: path,
                message: `"${name}" uses a non-registry version "${version}" — bypasses npm audit and registry validation.`,
                suggestion: `Publish "${name}" to npm and use a semver version instead of a direct git/tarball reference.`,
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_014',
    category: 'slop_version_in_name',
    description: 'Package name contains an embedded version number — a common pattern in AI-hallucinated package names.',
    severity: 'LOW',
    tags: ['slopsquatting', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI tools sometimes invent package names like `react-18-utils` or `express4-router` that embed a framework version number. Real packages rarely do this — they use semver. This pattern is a strong signal that the package name was hallucinated.',
      commonViolations: [
        'import { something } from "react-18-utils"',
        'import { Router } from "express4-router"',
        'import { handler } from "next-13-handler"',
      ],
      goodExample: 'import { something } from "react-extra";  // no embedded version',
      badExample: 'import { something } from "react-18-utils";  // ❌ embedded version number',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_version_in_name', config.severityRules);
      const findings: Finding[] = [];
      const VERSION_IN_NAME_RE = /^[a-z][a-z-]*-\d{1,2}(?:-|$)/;
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (pkg.startsWith('@')) continue;
          if (VERSION_IN_NAME_RE.test(pkg)) {
            findings.push({
              severity: sev,
              category: 'slop_version_in_name',
              file: path, line,
              message: `"${pkg}" contains an embedded version number — a common AI hallucination pattern.`,
              suggestion: `Verify this package at https://npmjs.com/package/${encodeURIComponent(pkg)}. Real packages rarely embed version numbers in their names.`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SLOP_015',
    category: 'slop_deep_chain_name',
    description: 'Package name has 4 or more hyphenated segments starting with a framework name — strong AI hallucination signal.',
    severity: 'MEDIUM',
    tags: ['slopsquatting', 'ai-risk', 'supply-chain'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Research shows AI hallucinated packages follow a predictable pattern: they take a known framework name and append multiple descriptive words, producing names like `react-form-validation-utils` or `express-middleware-handler-utils`. Real packages rarely have 4+ hyphenated segments.',
      commonViolations: [
        'import { something } from "react-form-validation-utils"',
        'import { Router } from "express-middleware-api-handler"',
        'import { config } from "next-auth-session-provider-utils"',
      ],
      goodExample: 'import { z } from "zod";  // clean, real package name',
      badExample: 'import { validate } from "react-form-validation-middleware-utils";  // ❌ AI over-description',
      relatedPlaybooks: ['supply-chain-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('slop_deep_chain_name', config.severityRules);
      const findings: Finding[] = [];
      const FRAMEWORK_PREFIXES = new Set([
        'react', 'next', 'express', 'prisma', 'vue', 'nuxt', 'angular',
        'fastify', 'hapi', 'koa', 'nest', 'svelte', 'remix', 'astro',
        'graphql', 'drizzle', 'mongoose', 'sequelize',
      ]);
      const installed = getInstalledPackages(process.cwd());

      for (const { path, content } of changedFiles) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
        const imports = parseImports(content);
        for (const { pkg, line } of imports) {
          if (pkg.startsWith('@')) continue;
          if (NODE_BUILTINS.has(pkg)) continue;
          if (installed.has(pkg)) continue;
          if (KNOWN_PHANTOMS.has(pkg)) continue;
          const parts = pkg.split('-');
          if (parts.length < 4) continue;
          if (!FRAMEWORK_PREFIXES.has(parts[0]!)) continue;
          findings.push({
            severity: sev,
            category: 'slop_deep_chain_name',
            file: path, line,
            message: `"${pkg}" has ${parts.length} hyphenated segments starting with "${parts[0]}" — a strong AI hallucination signal.`,
            suggestion: `Verify this package at https://npmjs.com/package/${encodeURIComponent(pkg)}. Consider if a simpler, real package name achieves the same goal.`,
          });
        }
      }
      return findings;
    },
  },
];
