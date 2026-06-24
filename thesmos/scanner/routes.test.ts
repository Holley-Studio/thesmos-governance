// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { extractPageRoutes, extractApiRoutes } from './routes';

describe('extractPageRoutes', () => {
  it('returns empty for non-next frameworks', () => {
    expect(extractPageRoutes(['app/page.tsx'], 'vite')).toHaveLength(0);
    expect(extractPageRoutes(['app/page.tsx'], 'remix')).toHaveLength(0);
    expect(extractPageRoutes(['app/page.tsx'], 'unknown')).toHaveLength(0);
  });

  it('extracts app-router root page', () => {
    const routes = extractPageRoutes(['app/page.tsx'], 'next');
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/');
    expect(routes[0].file).toBe('app/page.tsx');
  });

  it('extracts app-router nested page', () => {
    const routes = extractPageRoutes(['app/dashboard/page.tsx'], 'next');
    expect(routes[0].path).toBe('/dashboard');
  });

  it('strips route groups from app-router paths', () => {
    const routes = extractPageRoutes(['app/(dashboard)/settings/page.tsx'], 'next');
    expect(routes[0].path).toBe('/settings');
  });

  it('normalises dynamic segments in app-router paths', () => {
    const routes = extractPageRoutes(['app/posts/[id]/page.tsx'], 'next');
    expect(routes[0].path).toBe('/posts/:id');
  });

  it('extracts pages-router pages', () => {
    const routes = extractPageRoutes(['pages/about.tsx'], 'next');
    expect(routes[0].path).toBe('/about');
  });

  it('skips pages-router _app and _document', () => {
    const routes = extractPageRoutes(['pages/_app.tsx', 'pages/_document.tsx'], 'next');
    expect(routes).toHaveLength(0);
  });

  it('skips pages/api/', () => {
    const routes = extractPageRoutes(['pages/api/users.ts'], 'next');
    expect(routes).toHaveLength(0);
  });

  it('strips index from pages-router paths', () => {
    const routes = extractPageRoutes(['pages/blog/index.tsx'], 'next');
    expect(routes[0].path).toBe('/blog');
  });

  it('sorts results by path', () => {
    const routes = extractPageRoutes(
      ['app/z/page.tsx', 'app/a/page.tsx', 'app/m/page.tsx'],
      'next'
    );
    expect(routes.map((r) => r.path)).toEqual(['/a', '/m', '/z']);
  });

  it('normalises catch-all segments [...slug] to :slug*', () => {
    const routes = extractPageRoutes(['app/blog/[...slug]/page.tsx'], 'next');
    expect(routes[0].path).toBe('/blog/:slug*');
  });

  it('normalises optional catch-all [[...slug]] to :slug?*', () => {
    const routes = extractPageRoutes(['app/docs/[[...slug]]/page.tsx'], 'next');
    expect(routes[0].path).toBe('/docs/:slug?*');
  });

  it('handles multiple dynamic segments in one path', () => {
    const routes = extractPageRoutes(['app/[team]/[project]/page.tsx'], 'next');
    expect(routes[0].path).toBe('/:team/:project');
  });
});

describe('extractApiRoutes', () => {
  it('returns empty for non-next frameworks', () => {
    const files = [{ path: 'app/api/users/route.ts', content: 'export async function GET() {}' }];
    expect(extractApiRoutes(files, 'vite')).toHaveLength(0);
  });

  it('extracts app-router route file', () => {
    const files = [
      {
        path: 'app/api/users/route.ts',
        content: 'export async function GET() { return Response.json([]); }',
      },
    ];
    const routes = extractApiRoutes(files, 'next');
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/users');
    expect(routes[0].methods).toContain('GET');
    expect(routes[0].auth).toBe(false);
  });

  it('detects multiple HTTP methods', () => {
    const files = [
      {
        path: 'app/api/items/route.ts',
        content: `
          export async function GET() {}
          export async function POST() {}
          export async function DELETE() {}
        `,
      },
    ];
    const routes = extractApiRoutes(files, 'next');
    expect(routes[0].methods).toContain('GET');
    expect(routes[0].methods).toContain('POST');
    expect(routes[0].methods).toContain('DELETE');
  });

  it('detects auth when getSession is called', () => {
    const files = [
      {
        path: 'app/api/secure/route.ts',
        content: `
          export async function POST(req: Request) {
            const session = await getSession();
            return Response.json({});
          }
        `,
      },
    ];
    expect(extractApiRoutes(files, 'next')[0].auth).toBe(true);
  });

  it('detects auth when supabase.auth.getUser is called', () => {
    const files = [
      {
        path: 'app/api/profile/route.ts',
        content: `
          export const GET = async () => {
            const { data } = await supabase.auth.getUser();
          };
        `,
      },
    ];
    expect(extractApiRoutes(files, 'next')[0].auth).toBe(true);
  });

  it('detects pages-router API routes', () => {
    const files = [
      {
        path: 'pages/api/hello.ts',
        content: 'export default function handler(req, res) { res.json({}); }',
      },
    ];
    const routes = extractApiRoutes(files, 'next');
    expect(routes[0].path).toBe('/api/hello');
    expect(routes[0].file).toBe('pages/api/hello.ts');
  });

  it('detects const-exported method handlers', () => {
    const files = [
      {
        path: 'app/api/v1/route.ts',
        content: 'export const POST = async (req: Request) => Response.json({});',
      },
    ];
    const routes = extractApiRoutes(files, 'next');
    expect(routes[0].methods).toContain('POST');
  });

  it('skips files that are not route files', () => {
    const files = [
      { path: 'src/lib/utils.ts', content: 'export function GET() {}' },
    ];
    expect(extractApiRoutes(files, 'next')).toHaveLength(0);
  });

  it('sorts results by path', () => {
    const files = [
      { path: 'app/z/route.ts', content: 'export async function GET() {}' },
      { path: 'app/a/route.ts', content: 'export async function GET() {}' },
    ];
    const routes = extractApiRoutes(files, 'next');
    expect(routes[0].path < routes[1].path).toBe(true);
  });

  it('detects auth when getServerSession is called', () => {
    const files = [
      {
        path: 'app/api/me/route.ts',
        content: 'export async function GET() { const s = await getServerSession(); }',
      },
    ];
    expect(extractApiRoutes(files, 'next')[0].auth).toBe(true);
  });

  it('detects auth when auth() helper is called (Next-Auth v5)', () => {
    const files = [
      {
        path: 'app/api/secure/route.ts',
        content: 'export async function POST() { const session = await auth(); }',
      },
    ];
    expect(extractApiRoutes(files, 'next')[0].auth).toBe(true);
  });

  it('detects auth when currentUser (Clerk) is called', () => {
    const files = [
      {
        path: 'app/api/user/route.ts',
        content: 'export async function GET() { const user = await currentUser(); }',
      },
    ];
    expect(extractApiRoutes(files, 'next')[0].auth).toBe(true);
  });

  it('detects auth when validateRequest is called', () => {
    const files = [
      {
        path: 'app/api/data/route.ts',
        content: 'export async function GET() { const { user } = await validateRequest(); }',
      },
    ];
    expect(extractApiRoutes(files, 'next')[0].auth).toBe(true);
  });
});
