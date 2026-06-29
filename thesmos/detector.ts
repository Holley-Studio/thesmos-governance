// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Repo-specific intelligence detection.
 * All functions are pure (take data, return data) — fs access only in runDetector().
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractAllEnvVars } from './secrets';
import type { DetectorResult } from './types';

type PackageJson = Record<string, unknown>;

/** Merge dependencies, devDependencies, and peerDependencies into one flat map. */
function allDeps(pkg: PackageJson): Record<string, string> {
  return {
    ...(pkg['dependencies'] as Record<string, string> | undefined ?? {}),
    ...(pkg['devDependencies'] as Record<string, string> | undefined ?? {}),
    ...(pkg['peerDependencies'] as Record<string, string> | undefined ?? {}),
  };
}

/** Detect the frontend framework from package.json dependencies. */
export function detectFramework(pkg: PackageJson): DetectorResult['framework'] {
  const deps = allDeps(pkg);
  if ('next' in deps) return 'next';
  if ('nuxt' in deps || 'nuxt3' in deps) return 'nuxt';
  if ('astro' in deps) return 'astro';
  if ('@sveltejs/kit' in deps) return 'sveltekit';
  if ('remix' in deps || '@remix-run/react' in deps || '@remix-run/node' in deps) return 'remix';
  if ('vite' in deps && ('react' in deps || 'vue' in deps)) return 'vite';
  if ('express' in deps) return 'express';
  return 'unknown';
}

/** Detect the auth provider from dependencies, then fall back to file heuristics. */
export function detectAuth(pkg: PackageJson, fileList: string[]): DetectorResult['auth'] {
  const deps = allDeps(pkg);
  if ('@supabase/supabase-js' in deps || '@supabase/ssr' in deps) return 'supabase';
  if ('next-auth' in deps || '@auth/core' in deps || '@auth/nextjs' in deps) return 'next-auth';
  if ('@clerk/nextjs' in deps || '@clerk/clerk-react' in deps || '@clerk/backend' in deps) return 'clerk';
  if ('@auth0/nextjs-auth0' in deps || 'auth0' in deps) return 'auth0';
  if ('lucia' in deps) return 'lucia';
  if ('better-auth' in deps) return 'better-auth';
  // File-based fallback
  if (fileList.some((f) => /\bauth0\b/.test(f))) return 'auth0';
  if (fileList.some((f) => /\bclerk\b/.test(f))) return 'clerk';
  return 'none';
}

/** Detect the primary testing framework from devDependencies. */
export function detectTestingFramework(pkg: PackageJson): DetectorResult['testingFramework'] {
  const deps = allDeps(pkg);
  if ('vitest' in deps) return 'vitest';
  if ('jest' in deps || '@jest/core' in deps) return 'jest';
  if ('@playwright/test' in deps || 'playwright' in deps) return 'playwright';
  return 'none';
}

/** Detect the deployment provider from config files present in the repo. */
export function detectDeployment(fileList: string[]): DetectorResult['deployment'] {
  if (fileList.some((f) => f === 'vercel.json' || f.startsWith('.vercel/'))) return 'vercel';
  if (fileList.some((f) => f === 'netlify.toml' || f.startsWith('.netlify/'))) return 'netlify';
  if (fileList.some((f) => f === 'railway.json' || f === 'railway.toml')) return 'railway';
  if (fileList.some((f) => f === 'fly.toml')) return 'fly';
  if (fileList.some((f) => f === 'Dockerfile' || f === 'docker-compose.yml' || f === 'docker-compose.yaml')) return 'other';
  return 'unknown';
}

/** Detect API routing convention from file paths. */
export function detectApiConvention(fileList: string[]): DetectorResult['apiConvention'] {
  if (fileList.some((f) => /^app\/.*\/route\.(ts|js)$/.test(f))) return 'next-app-router';
  if (fileList.some((f) => /^pages\/api\/.+\.(ts|js)$/.test(f))) return 'next-pages-router';
  return 'unknown';
}

/** Returns true when the project uses TypeScript. */
export function detectTypeScript(pkg: PackageJson, fileList: string[]): boolean {
  const deps = allDeps(pkg);
  return (
    'typescript' in deps ||
    fileList.some((f) => f === 'tsconfig.json' || f.endsWith('/tsconfig.json'))
  );
}

/** Detect package manager from lock files. */
export function detectPackageManager(fileList: string[]): DetectorResult['packageManager'] {
  if (fileList.some((f) => f === 'bun.lockb' || f === 'bun.lock')) return 'bun';
  if (fileList.some((f) => f === 'pnpm-lock.yaml')) return 'pnpm';
  if (fileList.some((f) => f === 'yarn.lock')) return 'yarn';
  if (fileList.some((f) => f === 'package-lock.json')) return 'npm';
  return 'unknown';
}

/** Detect the primary CSS/styling approach. */
export function detectCssFramework(pkg: PackageJson, fileList: string[]): DetectorResult['cssFramework'] {
  const deps = allDeps(pkg);
  if ('tailwindcss' in deps || fileList.some((f) => /^tailwind\.config\.(ts|js|cjs|mjs)$/.test(f))) return 'tailwind';
  if ('styled-components' in deps) return 'styled-components';
  if ('@emotion/react' in deps || '@emotion/styled' in deps) return 'emotion';
  if ('sass' in deps || 'node-sass' in deps) return 'sass';
  if (fileList.some((f) => /\.module\.(css|scss|sass)$/.test(f))) return 'css-modules';
  return 'none';
}

/**
 * Detect the primary UI component library.
 * shadcn is identified by @radix-ui + class-variance-authority (it ships no npm package itself).
 */
export function detectUiLibrary(pkg: PackageJson): DetectorResult['uiLibrary'] {
  const deps = allDeps(pkg);
  const hasRadix = '@radix-ui/react-dialog' in deps || '@radix-ui/react-slot' in deps || '@radix-ui/react-label' in deps;
  if (hasRadix) {
    if ('class-variance-authority' in deps || 'clsx' in deps) return 'shadcn';
    return 'radix';
  }
  if ('@chakra-ui/react' in deps) return 'chakra';
  if ('@mantine/core' in deps) return 'mantine';
  if ('@headlessui/react' in deps) return 'headless-ui';
  if ('antd' in deps) return 'antd';
  if ('@mui/material' in deps) return 'mui';
  return 'none';
}

/**
 * Extract env var names from source files — covers bracket notation,
 * dot notation, and Vite import.meta.env.
 */
export function detectEnvVars(
  sourceFiles: ReadonlyArray<{ path: string; content: string }>
): string[] {
  const vars = new Set<string>();
  for (const { content } of sourceFiles) {
    for (const v of extractAllEnvVars(content)) {
      vars.add(v);
    }
  }
  return [...vars].sort();
}

// ── Internal fs helpers ───────────────────────────────────────────────────────

function listFilesShallow(dir: string, depth = 0, max = 5): string[] {
  if (depth > max || !existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      out.push(join(dir, entry.name));
      if (entry.isDirectory()) {
        out.push(...listFilesShallow(join(dir, entry.name), depth + 1, max));
      }
    }
  } catch {
    // skip permission errors
  }
  return out;
}

function readPackageJsonSafe(root: string): PackageJson {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function sampleSourceFiles(
  root: string,
  sampleCount = 200
): Array<{ path: string; content: string }> {
  const dirs = ['lib', 'app', 'src', 'stores', 'components', 'pages', 'hooks', 'utils'];
  const files: Array<{ path: string; content: string }> = [];
  const perDir = Math.ceil(sampleCount / dirs.length);

  for (const dir of dirs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    try {
      const entries = listFilesShallow(abs, 0, 4).filter(
        (f) => f.endsWith('.ts') || f.endsWith('.tsx')
      );
      for (const f of entries.slice(0, perDir)) {
        try {
          files.push({ path: f, content: readFileSync(f, 'utf8') });
        } catch {
          // skip unreadable
        }
      }
    } catch {
      // skip
    }
  }

  return files;
}

/**
 * Full detector — orchestrates all pure detectors using fs reads.
 * Accepts optional pre-computed file lists from the scanner to avoid double-walking.
 */
export function runDetector(
  root: string,
  precomputedPaths?: string[],
  precomputedSourceFiles?: ReadonlyArray<{ path: string; content: string }>
): DetectorResult {
  const pkg = readPackageJsonSafe(root);
  const allFiles =
    precomputedPaths ??
    listFilesShallow(root, 0, 4).map((f) =>
      f.startsWith(root) ? f.slice(root.length + 1) : f
    );
  const sourceFiles = precomputedSourceFiles ?? sampleSourceFiles(root);

  return {
    framework: detectFramework(pkg),
    auth: detectAuth(pkg, allFiles),
    envVars: detectEnvVars(sourceFiles),
    testingFramework: detectTestingFramework(pkg),
    deployment: detectDeployment(allFiles),
    apiConvention: detectApiConvention(allFiles),
    typescript: detectTypeScript(pkg, allFiles),
    packageManager: detectPackageManager(allFiles),
    cssFramework: detectCssFramework(pkg, allFiles),
    uiLibrary: detectUiLibrary(pkg),
  };
}
