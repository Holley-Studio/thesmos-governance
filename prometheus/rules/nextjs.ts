import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, JSX_EXT, isTestPath, isCommentLine } from './helpers';

export const NEXTJS_RULES: PrometheusRule[] = [
  {
    id: 'NEXT_001',
    category: 'next_router_in_app',
    description: '`next/router` is for the Pages Router. Use `next/navigation` for the App Router.',
    severity: 'HIGH',
    tags: ['nextjs', 'app-router', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'next/router (useRouter from Pages Router) does not work in App Router Server or Client Components — it throws or returns stale data. next/navigation provides useRouter, usePathname, and useSearchParams for the App Router.',
      commonViolations: ["import { useRouter } from 'next/router'", "import Router from 'next/router'"],
      goodExample: "import { useRouter, usePathname, useSearchParams } from 'next/navigation';",
      badExample: "import { useRouter } from 'next/router';  // App Router — use next/navigation",
      relatedPlaybooks: ['nextjs-app-router.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_router_in_app', config.severityRules);
      const RE = /from\s+['"]next\/router['"]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (/pages\//.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (RE.test(lines[i]!)) {
            findings.push({ severity, category: 'next_router_in_app', file: path, line: i + 1, message: "next/router imported in App Router file — use next/navigation instead.", suggestion: "import { useRouter } from 'next/navigation';" });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_002',
    category: 'getserversideprops_in_app',
    description: '`getServerSideProps` is a Pages Router API. In the App Router, data fetching is done in Server Components.',
    severity: 'HIGH',
    tags: ['nextjs', 'app-router', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'getServerSideProps is silently ignored in App Router — the page will render without server data, showing undefined values or hydration errors. Use async Server Components to fetch data directly.',
      commonViolations: ['export async function getServerSideProps() { ... }'],
      goodExample: "// App Router: fetch directly in the Server Component\nexport default async function Page({ params }: { params: { id: string } }) {\n  const data = await fetchData(params.id);\n  return <View data={data} />;\n}",
      badExample: "export async function getServerSideProps() {\n  return { props: { data: await fetchData() } };\n}  // ignored in App Router",
      relatedPlaybooks: ['nextjs-app-router.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('getserversideprops_in_app', config.severityRules);
      const RE = /export\s+(?:async\s+)?function\s+getServerSideProps\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (/pages\//.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (RE.test(lines[i]!)) {
            findings.push({ severity, category: 'getserversideprops_in_app', file: path, line: i + 1, message: 'getServerSideProps is a Pages Router API — not used in App Router.', suggestion: 'Fetch data directly in the async Server Component function body.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_003',
    category: 'cookies_in_client_component',
    description: '`cookies()` and `headers()` from next/headers cannot be called in Client Components.',
    severity: 'BLOCKER',
    tags: ['nextjs', 'server-components', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'cookies() and headers() are server-only APIs that read HTTP request context. Calling them in a Client Component (marked "use client") throws an error during rendering.',
      commonViolations: ["'use client'\nimport { cookies } from 'next/headers'", "'use client'\nconst cookieStore = cookies()"],
      goodExample: "// Server Component:\nimport { cookies } from 'next/headers';\nconst cookieStore = cookies();\n\n// Pass the value down as a prop to the Client Component.",
      badExample: "'use client';\nimport { cookies } from 'next/headers';\nconst token = cookies().get('auth');  // runtime error",
      relatedPlaybooks: ['nextjs-server-components.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cookies_in_client_component', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const isClient = /'use client'|"use client"/.test(content.slice(0, 500));
        if (!isClient) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/from\s+['"]next\/headers['"]|(?:cookies|headers)\s*\(\s*\)/.test(lines[i]!)) {
            findings.push({ severity, category: 'cookies_in_client_component', file: path, line: i + 1, message: 'cookies() or headers() used in a Client Component — server-only API.', suggestion: 'Read cookies/headers in a Server Component and pass values as props.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_004',
    category: 'params_not_awaited',
    description: 'In Next.js 15+, `params` and `searchParams` are Promises and must be awaited before destructuring.',
    severity: 'HIGH',
    tags: ['nextjs', 'correctness', 'nextjs-15'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Next.js 15 changed params and searchParams from sync objects to async Promises. Synchronously destructuring them (without await) returns undefined for all values.',
      commonViolations: ['const { id } = params;  // params is now a Promise', "export default function Page({ params: { slug } })"],
      goodExample: "export default async function Page({ params }: { params: Promise<{ id: string }> }) {\n  const { id } = await params;\n  ...\n}",
      badExample: "export default function Page({ params }) {\n  const { id } = params;  // undefined in Next.js 15\n}",
      relatedPlaybooks: ['nextjs-app-router.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('params_not_awaited', config.severityRules);
      const SYNC_PARAMS_RE = /(?:const|let|var)\s+\{[^}]*\}\s*=\s*params\s*(?!\.then|;.*await)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/page\.|layout\.|route\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SYNC_PARAMS_RE.test(line) && !/await/.test(line)) {
            findings.push({ severity, category: 'params_not_awaited', file: path, line: i + 1, message: 'params destructured without await — will be undefined in Next.js 15.', suggestion: 'Add await: const { id } = await params;  and mark the function async.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_005',
    category: 'server_action_no_directive',
    description: 'Server Actions must include the `"use server"` directive to prevent accidental client execution.',
    severity: 'HIGH',
    tags: ['nextjs', 'server-actions', 'security'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without "use server", a function that looks like a Server Action is actually a Client Component function. This means it runs in the browser, can expose server-side logic client-side, and the Next.js serialization/deserialization pipeline is bypassed.',
      commonViolations: ["export async function createUserAction(data: FormData) { await db.insert(...) }  // no 'use server'"],
      goodExample: "'use server';\nexport async function createUser(data: FormData) {\n  await db.insert(users, parse(data));\n}",
      badExample: "// actions.ts — missing 'use server'\nexport async function deleteAccount(userId: string) {\n  await db.delete(users, { id: userId });  // runs client-side!\n}",
      relatedPlaybooks: ['nextjs-server-actions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('server_action_no_directive', config.severityRules);
      const ACTION_FILE_RE = /actions?\.(ts|tsx|js|jsx)$/;
      const HAS_DIRECTIVE_RE = /['"]use server['"]/;
      const EXPORT_ASYNC_RE = /export\s+(?:async\s+)?function\s+\w+(?:Action|action)\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!ACTION_FILE_RE.test(path)) continue;
        if (HAS_DIRECTIVE_RE.test(content.slice(0, 300))) continue;
        if (!EXPORT_ASYNC_RE.test(content)) continue;
        findings.push({ severity, category: 'server_action_no_directive', file: path, message: "Actions file is missing 'use server' directive.", suggestion: "Add 'use server'; at the top of the file." });
      }
      return findings;
    },
  },

  {
    id: 'NEXT_006',
    category: 'redirect_in_try_catch',
    description: '`redirect()` from next/navigation throws an error internally — catching it prevents the redirect.',
    severity: 'HIGH',
    tags: ['nextjs', 'correctness', 'app-router'],
    sinceVersion: '2.0.0',
    explain: {
      why: "Next.js's redirect() signals the redirect by throwing a special NEXT_REDIRECT error. If you wrap it in try-catch, the catch block intercepts the throw and the redirect never happens — the function falls through silently.",
      commonViolations: ['try { ... redirect("/login"); } catch (e) { ... }'],
      goodExample: "// Perform validation inside try-catch, then redirect AFTER the try-catch block:\ntry {\n  await validateUser(session);\n} catch {\n  return { error: 'invalid' };\n}\nredirect('/dashboard');  // outside try-catch",
      badExample: "try {\n  await doWork();\n  redirect('/success');  // redirect is caught by the catch!\n} catch (err) {\n  handleError(err);\n}",
      relatedPlaybooks: ['nextjs-app-router.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('redirect_in_try_catch', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!content.includes('redirect(')) continue;
        const TRY_RE = /\btry\s*\{/g;
        let m: RegExpExecArray | null;
        const lines = content.split('\n');
        while ((m = TRY_RE.exec(content)) !== null) {
          const start = content.lastIndexOf('\n', m.index) + 1;
          const lineNum = content.slice(0, m.index).split('\n').length;
          const block = content.slice(m.index, m.index + 500);
          if (/\bredirect\s*\(/.test(block) && /\}\s*catch/.test(block)) {
            findings.push({ severity, category: 'redirect_in_try_catch', file: path, line: lineNum, message: 'redirect() inside try-catch — the redirect exception will be swallowed.', suggestion: 'Move redirect() outside the try-catch block, after the guarded operations.' });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_007',
    category: 'nextpublic_env_in_server',
    description: 'NEXT_PUBLIC_ env vars are embedded in the client bundle. Reading them in server code is misleading and may over-expose values.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'security', 'env'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'NEXT_PUBLIC_ vars are replaced at build time and shipped to every client. Using them in server-only code gives a false sense of security — the values are already public. Use non-public vars for server-side secrets.',
      commonViolations: ["process.env.NEXT_PUBLIC_API_KEY  // in a Server Action or API route"],
      goodExample: "// For server-only secrets, omit the NEXT_PUBLIC_ prefix:\nconst secretKey = process['env' as 'env']['API_SECRET'];",
      badExample: "// In Server Action:\nconst key = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;  // name implies it's server-only, but it's bundled",
      relatedPlaybooks: ['nextjs-env-vars.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('nextpublic_env_in_server', config.severityRules);
      const RE = /process\.env\.NEXT_PUBLIC_\w+/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (/page\.|layout\.|loading\.|error\./.test(path)) continue;
        if (/'use client'|"use client"/.test(content.slice(0, 500))) continue;
        if (!/api\/|actions?\/|actions?\.|server/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'nextpublic_env_in_server', file: path, line: i + 1, message: 'NEXT_PUBLIC_ env var used in server code — value is publicly bundled.', suggestion: 'Use a non-NEXT_PUBLIC_ env var for server-side secrets.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_008',
    category: 'image_missing_alt',
    description: 'Next.js <Image> components must include an `alt` prop for accessibility and SEO.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'accessibility', 'seo'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'The alt attribute provides text alternatives for screen readers and appears when the image fails to load. Google uses it for image indexing. Next.js <Image> with an empty alt must be intentional (decorative image) — omitting it entirely is always wrong.',
      commonViolations: ['<Image src={hero} width={800} height={400} />', '<Image src={user.avatar} />'],
      goodExample: '<Image src={hero} alt="Team working in office" width={800} height={400} />\n<Image src={decoration} alt="" width={40} height={40} />  // intentionally empty for decorative',
      badExample: '<Image src={product.image} width={300} height={300} />  // missing alt',
      relatedPlaybooks: ['accessibility.md', 'seo.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('image_missing_alt', config.severityRules);
      const IMG_RE = /<Image\b/;
      const HAS_ALT_RE = /\balt\s*=/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (IMG_RE.test(line)) {
            const block = lines.slice(i, Math.min(i + 5, lines.length)).join(' ');
            if (!HAS_ALT_RE.test(block)) {
              findings.push({ severity, category: 'image_missing_alt', file: path, line: i + 1, message: '<Image> missing alt prop.', suggestion: 'Add alt="description" for meaningful images, or alt="" for decorative ones.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_009',
    category: 'missing_revalidate',
    description: 'Server mutations (create/update/delete) should call revalidatePath or revalidateTag to bust the Next.js cache.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'caching', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Next.js caches Server Component renders aggressively. Without revalidation after a mutation, users see stale data until the next revalidation period — which can be hours or indefinitely.',
      commonViolations: ['Server Action that inserts/updates a record without revalidatePath', 'API route that deletes a record without clearing the cache'],
      goodExample: "export async function createPost(data: FormData) {\n  'use server';\n  await db.insert(posts, ...);\n  revalidatePath('/posts');\n}",
      badExample: "export async function deletePost(id: string) {\n  'use server';\n  await db.delete(posts, { id });  // cache still shows deleted post\n}",
      relatedPlaybooks: ['nextjs-caching.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_revalidate', config.severityRules);
      const MUTATION_RE = /\b(?:db|supabase|prisma|drizzle)\.(?:insert|update|delete|upsert|create|remove)\s*\(/i;
      const REVALIDATE_RE = /revalidatePath|revalidateTag/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/'use server'|"use server"/.test(content)) continue;
        if (MUTATION_RE.test(content) && !REVALIDATE_RE.test(content)) {
          findings.push({ severity, category: 'missing_revalidate', file: path, message: 'Server Action with DB mutation but no revalidatePath/revalidateTag call.', suggestion: 'Call revalidatePath("/affected-route") after the mutation to bust the cache.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_010',
    category: 'usesearchparams_no_suspense',
    description: '`useSearchParams()` must be wrapped in a Suspense boundary or it causes a build-time error in Next.js.',
    severity: 'HIGH',
    tags: ['nextjs', 'app-router', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Next.js requires components using useSearchParams() to be wrapped in Suspense during static generation. Without it, the page cannot be statically exported and emits a build-time error.',
      commonViolations: ['export default function Page() { const params = useSearchParams(); }'],
      goodExample: "function SearchContent() {\n  const params = useSearchParams();\n  return <div>{params.get('q')}</div>;\n}\n\nexport default function Page() {\n  return <Suspense><SearchContent /></Suspense>;\n}",
      badExample: "export default function SearchPage() {\n  const params = useSearchParams();  // build error without Suspense\n  return <Results query={params.get('q')} />;\n}",
      relatedPlaybooks: ['nextjs-app-router.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('usesearchparams_no_suspense', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        if (!content.includes('useSearchParams')) continue;
        if (content.includes('Suspense')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/useSearchParams\s*\(\s*\)/.test(lines[i]!)) {
            findings.push({ severity, category: 'usesearchparams_no_suspense', file: path, line: i + 1, message: 'useSearchParams() used without a <Suspense> boundary.', suggestion: 'Wrap the component in <Suspense fallback={...}> or move useSearchParams into a child component wrapped in Suspense.' });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_011',
    category: 'fetch_no_cache_directive',
    description: 'Next.js extends fetch with cache control. Fetches in Server Components without explicit cache directives use the default behavior.',
    severity: 'LOW',
    tags: ['nextjs', 'caching', 'performance'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'By default Next.js 15 fetches are uncached (no-store). Being explicit about caching intent prevents accidental stale data or unnecessary re-fetches, and helps reviewers understand the data freshness requirements.',
      commonViolations: ['fetch("https://api.example.com/data")', 'const res = await fetch(url)'],
      goodExample: "fetch(url, { next: { revalidate: 3600 } })  // revalidate hourly\nfetch(url, { cache: 'no-store' })  // always fresh (intentional)",
      badExample: "const data = await fetch(url).then(r => r.json());  // cache intent unclear",
      relatedPlaybooks: ['nextjs-caching.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('fetch_no_cache_directive', config.severityRules);
      const FETCH_RE = /\bfetch\s*\(\s*(?:url|'|")/;
      const CACHE_RE = /cache\s*:|revalidate\s*:|no-store|force-cache/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (/'use client'|"use client"/.test(content.slice(0, 500))) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (FETCH_RE.test(line) && !CACHE_RE.test(line)) {
            const block = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');
            if (!CACHE_RE.test(block)) {
              findings.push({ severity, category: 'fetch_no_cache_directive', file: path, line: i + 1, message: 'fetch() in Server Component without explicit cache directive.', suggestion: "Add { cache: 'no-store' } or { next: { revalidate: N } } to make caching intent explicit." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_012',
    category: 'server_only_in_client',
    description: "Importing 'server-only' packages in Client Components leaks server logic to the browser bundle.",
    severity: 'BLOCKER',
    tags: ['nextjs', 'server-components', 'security', 'bundle'],
    sinceVersion: '2.0.0',
    explain: {
      why: "The 'server-only' package throws at runtime if imported in a client context. But you may have server logic (DB access, secret reading) in a file without the guard. Client Components importing such files ship your DB queries to the browser.",
      commonViolations: ["'use client'; import { db } from '@/lib/db'", "'use client'; import { getUser } from '@/lib/auth'  // auth reads cookies"],
      goodExample: "// Move DB calls to Server Components or Server Actions.\n// Mark shared server utilities with import 'server-only';",
      badExample: "'use client';\nimport { prisma } from '@/lib/prisma';  // DB client in browser bundle",
      relatedPlaybooks: ['nextjs-server-components.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('server_only_in_client', config.severityRules);
      const SERVER_IMPORT_RE = /from\s+['"](?:@\/lib\/(?:db|prisma|drizzle|auth|supabase-admin|server)|drizzle-orm|better-auth\/server)['"]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!/'use client'|"use client"/.test(content.slice(0, 500))) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SERVER_IMPORT_RE.test(lines[i]!)) {
            findings.push({ severity, category: 'server_only_in_client', file: path, line: i + 1, message: 'Server-only import in a Client Component — leaks to browser bundle.', suggestion: 'Move data fetching to a Server Component or Server Action, and pass results as props.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_013',
    category: 'missing_loading_boundary',
    description: 'Route segments with async data fetching should have a `loading.tsx` for streaming UX.',
    severity: 'TECH_DEBT',
    tags: ['nextjs', 'ux', 'streaming'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without loading.tsx, users see a blank screen while Server Components fetch data. loading.tsx enables React Streaming and shows an instant loading skeleton, dramatically improving perceived performance.',
      commonViolations: ['App Router page with await fetch() but no sibling loading.tsx'],
      goodExample: "// loading.tsx in the same route segment:\nexport default function Loading() {\n  return <Skeleton />;\n}",
      badExample: "// app/dashboard/page.tsx has await db.query(...) but no app/dashboard/loading.tsx",
      relatedPlaybooks: ['nextjs-streaming.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, scan }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_loading_boundary', config.severityRules);
      const asyncPages = scan.pages.filter(p => p.file && /app\//.test(p.file));
      if (asyncPages.length === 0) return [];
      const loadingFiles = new Set(
        scan.pages.map(p => p.file ?? '').filter(f => f.endsWith('loading.tsx') || f.endsWith('loading.jsx'))
      );
      if (loadingFiles.size === 0 && asyncPages.length > 3) {
        return [{
          severity,
          category: 'missing_loading_boundary',
          file: 'app/',
          message: `${asyncPages.length} App Router pages found but no loading.tsx files detected.`,
          suggestion: 'Add loading.tsx in route segments with async data fetching for streaming UX.',
        }];
      }
      return [];
    },
  },

  {
    id: 'NEXT_014',
    category: 'missing_error_page',
    description: 'App Router route segments without `error.tsx` show a generic unhandled error to users.',
    severity: 'TECH_DEBT',
    tags: ['nextjs', 'ux', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without error.tsx, runtime errors in Server Components propagate to the nearest error boundary — which defaults to a full-page crash with no recovery path. error.tsx provides a reset() function and a branded error UI.',
      commonViolations: ['App with multiple routes but no error.tsx at app/ root or in major segments'],
      goodExample: "// app/error.tsx:\n'use client';\nexport default function Error({ error, reset }) {\n  return <div><button onClick={reset}>Try again</button></div>;\n}",
      badExample: "// No error.tsx anywhere — users see a white page on any Server Component error",
      relatedPlaybooks: ['nextjs-error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, scan }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_error_page', config.severityRules);
      const hasErrorPage = scan.pages.some(p => p.file && /error\.(tsx?|jsx?)$/.test(p.file));
      if (hasErrorPage || scan.pages.length < 3) return [];
      return [{
        severity,
        category: 'missing_error_page',
        file: 'app/',
        message: 'No error.tsx found in App Router — server errors show a blank page.',
        suggestion: "Create app/error.tsx with a 'use client' directive and a reset() handler.",
      }];
    },
  },

  {
    id: 'NEXT_015',
    category: 'fetch_in_client_component',
    description: 'Direct fetch() calls in Client Components bypass Next.js caching, run in the browser, and expose API logic.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'performance', 'architecture'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Fetching in Client Components means the data is always fetched on the client (never cached by Next.js), the API endpoint and logic are visible in the browser, and there is no way to use server-side secrets for auth.',
      commonViolations: ["'use client'; const res = await fetch('/api/users')", "'use client'; useEffect(() => { fetch(url).then(...) })"],
      goodExample: "// Fetch in a Server Component, pass data as props:\nasync function UserList() {\n  const users = await db.select(...);\n  return <ClientTable data={users} />;\n}",
      badExample: "'use client';\nfunction UserList() {\n  useEffect(() => { fetch('/api/users').then(r => r.json()).then(setUsers); }, []);",
      relatedPlaybooks: ['nextjs-data-fetching.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('fetch_in_client_component', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/'use client'|"use client"/.test(content.slice(0, 500))) continue;
        const FETCH_RE = /\bfetch\s*\(\s*['"`\/]/;
        const QUERY_RE = /useQuery|useSWR|useFetch/;
        if (FETCH_RE.test(content) && !QUERY_RE.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (isCommentLine(line)) continue;
            if (FETCH_RE.test(line)) {
              findings.push({ severity, category: 'fetch_in_client_component', file: path, line: i + 1, message: 'Direct fetch() in Client Component — use SWR/React Query or move to Server Component.', suggestion: 'Move data fetching to a Server Component, or use SWR/React Query for client-side fetching.' });
              break;
            }
          }
        }
      }
      return findings;
    },
  },
];
