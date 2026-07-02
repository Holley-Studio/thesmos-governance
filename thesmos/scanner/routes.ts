// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pure route extractors — no fs access. Callers supply pre-read file paths
 * and (for API routes) pre-read file content.
 */

import type { ApiRoute, DetectorResult, PageRoute } from '../types';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const AUTH_PATTERN =
  /getSession\s*\(|getCallerProfile\s*\(|createRouteHandlerClient\s*\(|supabase\.auth\.getUser\s*\(|getServerSession\s*\(|getToken\s*\(|(?<!\w)auth\s*\(\s*\)|currentUser\s*\(|clerkClient\s*\(|validateRequest\s*\(|requireAuth\s*\(|verifyToken\s*\(/;

function detectMethods(content: string): string[] {
  return HTTP_METHODS.filter(
    (m) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(content) ||
      new RegExp(`export\\s+const\\s+${m}\\s*=`).test(content)
  );
}

/**
 * Extract page routes from a list of relative file paths.
 * Supports Next.js app-router (app/[seg]/page.tsx) and pages-router
 * (pages/[slug].tsx, excluding _app, _document, and api/).
 */
export function extractPageRoutes(
  paths: string[],
  framework: DetectorResult['framework']
): PageRoute[] {
  if (framework !== 'next') return [];

  const routes: PageRoute[] = [];

  for (const p of paths) {
    // App router
    const appMatch = /^app(\/.*)?\/page\.(tsx?|jsx?)$/.exec(p);
    if (appMatch) {
      const segment = (appMatch[1] ?? '')
        .replace(/\/\([^)]+\)/g, '')              // strip route groups like (dashboard)
        .replace(/\[\[\.\.\.([^\]]+)\]\]/g, ':$1?*') // optional catch-all [[...slug]] → :slug?*
        .replace(/\[\.\.\.([^\]]+)\]/g, ':$1*')   // catch-all [...slug] → :slug*
        .replace(/\[([^\]]+)\]/g, ':$1');          // dynamic [id] → :id
      routes.push({ path: segment || '/', file: p, desc: '' });
      continue;
    }

    // Pages router — skip _app, _document, api/*
    const pagesMatch = /^pages\/(.+)\.(tsx?|jsx?)$/.exec(p);
    if (
      pagesMatch &&
      !pagesMatch[1].startsWith('_') &&
      !pagesMatch[1].startsWith('api/')
    ) {
      const route = '/' + pagesMatch[1].replace(/\/index$/, '').replace(/^index$/, '');
      routes.push({ path: route || '/', file: p, desc: '' });
    }
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Extract API routes from pre-read route files.
 * Supports Next.js app-router (app/[seg]/route.ts) and pages-router
 * (pages/api/[slug].ts). Content is inspected for HTTP methods and auth.
 */
export function extractApiRoutes(
  files: ReadonlyArray<{ path: string; content: string }>,
  framework: DetectorResult['framework']
): ApiRoute[] {
  if (framework !== 'next') return [];

  const routes: ApiRoute[] = [];

  for (const { path: p, content } of files) {
    let apiPath: string | null = null;

    const appMatch = /^app(\/.*)?\/route\.(ts|js)$/.exec(p);
    if (appMatch) {
      apiPath = (appMatch[1] ?? '') || '/';
    }

    const pagesMatch = /^pages\/api\/(.+)\.(ts|js)$/.exec(p);
    if (pagesMatch) {
      apiPath = '/api/' + pagesMatch[1];
    }

    if (apiPath === null) continue;

    routes.push({
      path: apiPath,
      file: p,
      methods: detectMethods(content),
      auth: AUTH_PATTERN.test(content),
      desc: '',
    });
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}
