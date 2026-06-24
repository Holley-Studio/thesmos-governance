import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, JSX_EXT, isTestPath, isCommentLine } from './helpers';

export const NEXTJS_RULES: ThesmosRule[] = [
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

  // ── App Router / Server Components expansions ─────────────────────────────

  {
    id: 'NEXT_016',
    category: 'use_server_top_level_only',
    description: "'use server' directive must appear at the top of a file or function body — not mid-file.",
    severity: 'HIGH',
    tags: ['nextjs', 'server-actions', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "'use server' placed after imports or in the middle of a file may be silently ignored or cause the entire module to behave unexpectedly. Always place it as the first statement.",
      commonViolations: ["// imports here\nimport { db } from '@/lib/db'\n'use server'  // too late"],
      goodExample: "'use server'\nimport { db } from '@/lib/db'\nexport async function createPost(data: FormData) { ... }",
      badExample: "import { db } from '@/lib/db'\n'use server'  // directive after imports — may be ignored",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('use_server_top_level_only', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        let firstNonComment = -1;
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i]!.trim();
          if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
          firstNonComment = i;
          break;
        }
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if ((/['"]use server['"]/.test(line)) && i > firstNonComment + 2) {
            if (lines.slice(0, i).some(l => /^import\s/.test(l))) {
              findings.push({ severity, category: 'use_server_top_level_only', file: path, line: i + 1, message: "'use server' appears after import statements — directive may be ignored.", suggestion: "Move 'use server' to the very top of the file, before any imports." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_017',
    category: 'streaming_suspense_missing',
    description: 'Async Server Components that fetch data should be wrapped in Suspense to enable streaming.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'performance', 'streaming', 'suspense'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Without Suspense, an async Server Component blocks the entire page render until data is ready. Suspense lets Next.js stream the HTML shell immediately and fill in the data when it arrives.",
      commonViolations: ["// Page that renders <UserProfile /> (async component) without Suspense"],
      goodExample: "<Suspense fallback={<UserProfileSkeleton />}>\n  <UserProfile userId={id} />\n</Suspense>",
      badExample: "// page.tsx\nexport default async function Page({ params }) {\n  return <UserProfile userId={params.id} />  // blocks entire render until profile loads\n}",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('streaming_suspense_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || !path.includes('page.')) continue;
        if (!content.includes('async function') && !content.includes('async (')) continue;
        if (!content.includes('await ')) continue;
        if (!content.includes('Suspense')) {
          findings.push({ severity, category: 'streaming_suspense_missing', file: path, message: 'Page with async data fetching without Suspense — blocks entire render until all data is ready.', suggestion: 'Wrap async data components in <Suspense fallback={<Skeleton />}> to enable streaming.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_018',
    category: 'metadata_static_missing',
    description: "Pages without exported metadata or generateMetadata miss SEO — title, description, og:image are indexed by search engines.",
    severity: 'LOW',
    tags: ['nextjs', 'seo', 'metadata'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Google uses the <title> and <meta description> from your metadata export for search listings. Missing metadata = no SEO, poor click-through rate, and unfriendly link previews on Slack/Twitter.",
      commonViolations: ["// page.tsx with no 'export const metadata' or 'export async function generateMetadata'"],
      goodExample: "export const metadata: Metadata = { title: 'Dashboard | Acme', description: 'Manage your ...' }",
      badExample: "// page.tsx — no metadata export — page appears as URL in search results",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('metadata_static_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || !path.includes('page.')) continue;
        if (!content.includes('export default')) return findings;
        if (!content.includes('metadata') && !content.includes('generateMetadata')) {
          findings.push({ severity, category: 'metadata_static_missing', file: path, message: 'Page without metadata export — missing title/description for SEO and social previews.', suggestion: "Export metadata: Metadata = { title: '...', description: '...' } from this page." });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_019',
    category: 'client_component_at_root',
    description: "Marking an entire page or layout 'use client' when only a small part needs interactivity defeats Server Component benefits.",
    severity: 'MEDIUM',
    tags: ['nextjs', 'performance', 'server-components'],
    sinceVersion: '3.0.0',
    explain: {
      why: "'use client' at the top of page.tsx turns the entire route into a Client Component and ships all its imports to the browser bundle. Instead, push interactivity down to leaf components — keep the page as a Server Component.",
      commonViolations: ["'use client'\n// Entire 200-line page just because it has one useState"],
      goodExample: "// page.tsx — Server Component\nimport { SearchInput } from './SearchInput'  // SearchInput has 'use client'\nexport default function Page() { return <SearchInput /> }",
      badExample: "'use client'\n// page.tsx — entire page is a client component for one button onClick",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('client_component_at_root', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        if (!path.includes('page.') && !path.includes('layout.')) continue;
        if (!content.includes("'use client'") && !content.includes('"use client"')) return findings;
        const lineCount = content.split('\n').length;
        if (lineCount > 60) {
          findings.push({ severity, category: 'client_component_at_root', file: path, message: `Large page/layout (${lineCount} lines) marked 'use client' — ships entire module to browser bundle.`, suggestion: "Extract interactive parts into leaf 'use client' components. Keep page.tsx as a Server Component." });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_020',
    category: 'fetch_no_cache',
    description: "fetch() in Server Components without a cache option opts into Next.js's default caching which may be stale.",
    severity: 'LOW',
    tags: ['nextjs', 'performance', 'caching'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js extends fetch() with caching. By default, fetch results are cached indefinitely (static). On dynamic routes you may want { cache: 'no-store' } (always fresh) or { next: { revalidate: 60 } } (ISR). Not specifying = unpredictable behavior.",
      commonViolations: ["const data = await fetch('https://api.example.com/posts')  // cache behavior unclear"],
      goodExample: "const data = await fetch(url, { next: { revalidate: 60 } })  // ISR every 60s\nconst data = await fetch(url, { cache: 'no-store' })  // always fresh",
      badExample: "const data = await fetch(apiUrl)  // default cache: 'force-cache' — may be months stale",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('fetch_no_cache', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (content.includes("'use client'") || content.includes('"use client"')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/await\s+fetch\s*\(\s*['"`]/.test(line) && !line.includes('cache') && !line.includes('revalidate')) {
            const next2 = lines.slice(i, i + 2).join('\n');
            if (!next2.includes('cache') && !next2.includes('revalidate')) {
              findings.push({ severity, category: 'fetch_no_cache', file: path, line: i + 1, message: "Server Component fetch() without cache option — Next.js caching behavior is implicit.", suggestion: "Specify: { cache: 'no-store' } for dynamic, or { next: { revalidate: 60 } } for ISR." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_021',
    category: 'error_boundary_missing_page',
    description: "Next.js App Router pages without an error.tsx sibling have no error boundary — unhandled errors crash the entire segment.",
    severity: 'HIGH',
    tags: ['nextjs', 'error-handling', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Without error.tsx in an App Router segment, any thrown error propagates to the nearest parent error boundary (or the global error.tsx at the root). This may crash large sections of the UI. Add error.tsx per route segment.",
      commonViolations: ["// app/dashboard/page.tsx with no app/dashboard/error.tsx"],
      goodExample: "// app/dashboard/error.tsx\n'use client'\nexport default function Error({ error, reset }) {\n  return <div><h2>Something went wrong</h2><button onClick={reset}>Retry</button></div>\n}",
      badExample: "// app/dashboard/page.tsx — no error.tsx — any error crashes the whole dashboard",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_boundary_missing_page', config.severityRules);
      const findings: Finding[] = [];
      const changedPagePaths = changedFiles
        .filter(f => /\/page\.(tsx|jsx|ts|js)$/.test(f.path))
        .map(f => f.path);
      const allPaths = new Set(changedFiles.map(f => f.path));
      for (const pagePath of changedPagePaths) {
        const dir = pagePath.replace(/\/page\.[^/]+$/, '');
        const hasError = [...allPaths].some(p => p.startsWith(dir + '/error.'));
        if (!hasError) {
          findings.push({ severity, category: 'error_boundary_missing_page', file: pagePath, message: 'Page without a sibling error.tsx — unhandled errors will crash the route segment.', suggestion: "Add app/[route]/error.tsx with 'use client' and an Error component that receives { error, reset }." });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_022',
    category: 'parallel_routes_loading',
    description: "Next.js parallel routes (@slot) should have loading.tsx to avoid blocking the entire layout.",
    severity: 'LOW',
    tags: ['nextjs', 'performance', 'parallel-routes'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Parallel routes (@feed, @sidebar) share a layout. If one slow slot has no loading.tsx, the layout blocks until all slots resolve. Add loading.tsx per slot for independent streaming.",
      commonViolations: ["// app/@modal/page.tsx without app/@modal/loading.tsx"],
      goodExample: "// app/@modal/loading.tsx\nexport default function Loading() { return <ModalSkeleton /> }",
      badExample: "// app/@sidebar/page.tsx — no loading.tsx — sidebar blocks the entire layout render",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('parallel_routes_loading', config.severityRules);
      const findings: Finding[] = [];
      for (const { path } of changedFiles) {
        if (!/@[\w-]+\/page\.(tsx|jsx)$/.test(path)) continue;
        const slotDir = path.replace(/\/page\.[^/]+$/, '');
        const hasLoading = changedFiles.some(f => f.path.startsWith(slotDir + '/loading.'));
        if (!hasLoading) {
          findings.push({ severity, category: 'parallel_routes_loading', file: path, message: 'Parallel route (@slot) without loading.tsx — blocks layout render while this slot fetches data.', suggestion: 'Add loading.tsx in the same @slot directory to enable independent streaming.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_023',
    category: 'redirect_in_server_action',
    description: "redirect() from 'next/navigation' called inside try/catch in a Server Action is swallowed — it throws internally.",
    severity: 'HIGH',
    tags: ['nextjs', 'server-actions', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js implements redirect() by throwing a special error. If you call redirect() inside a try block, the catch handler swallows the redirect and the user is never redirected — a silent bug.",
      commonViolations: ["try { ... redirect('/success') } catch(e) { ... }"],
      goodExample: "// Success path\nawait processPayment(data)\n// Redirect outside the try/catch:\nredirect('/success')",
      badExample: "try {\n  await processPayment(data)\n  redirect('/success')  // redirect() throws internally — caught by catch!\n} catch(e) { console.error(e) }",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('redirect_in_server_action', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes("'use server'") && !content.includes('"use server"')) return findings;
        const lines = content.split('\n');
        let inTry = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\btry\s*\{/.test(line)) inTry = true;
          if (inTry && /\bcatch\s*\(/.test(line)) inTry = false;
          if (inTry && /\bredirect\s*\(/.test(line)) {
            findings.push({ severity, category: 'redirect_in_server_action', file: path, line: i + 1, message: "redirect() called inside try block — it throws internally and will be caught, silently failing.", suggestion: "Move redirect() outside the try/catch block, after the operation succeeds." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_024',
    category: 'cookies_in_server_component',
    description: "cookies() from 'next/headers' makes a Server Component dynamic — use it only when you need per-request values.",
    severity: 'LOW',
    tags: ['nextjs', 'performance', 'caching'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Calling cookies() or headers() opts the entire route out of static rendering and into dynamic rendering (per-request). If you can derive the data statically, avoid these calls to keep the route cacheable.",
      commonViolations: ["// Server Component that calls cookies() to get a language preference that never changes"],
      goodExample: "// Only call cookies() when you genuinely need per-request data (auth, locale from cookie)",
      badExample: "const cookieStore = cookies()  // in a component that only reads a config cookie — forces dynamic render",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cookies_in_server_component', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        if (content.includes("'use client'") || content.includes('"use client"')) return findings;
        if (/from\s+['"]next\/headers['"]/.test(content) && /\bcookies\s*\(\)/.test(content)) {
          if (!content.includes('auth') && !content.includes('session') && !content.includes('token')) {
            findings.push({ severity, category: 'cookies_in_server_component', file: path, message: "cookies() called in Server Component — opts out of static rendering. Ensure this is necessary.", suggestion: "Only call cookies() when you need request-specific per-user data (auth, dynamic locale, A/B flags)." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_025',
    category: 'image_component_missing',
    description: "Using <img> instead of Next.js <Image> skips automatic WebP conversion, lazy loading, and size optimization.",
    severity: 'MEDIUM',
    tags: ['nextjs', 'performance', 'images'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js <Image> automatically serves WebP/AVIF, adds native lazy loading, prevents CLS with layout reservation, and resizes images to the requested display size. Raw <img> skips all of this — serving oversized PNGs and JPEGs.",
      commonViolations: ["<img src='/hero.jpg' alt='Hero' />  // in a Next.js app"],
      goodExample: "import Image from 'next/image'\n<Image src='/hero.jpg' alt='Hero' width={1200} height={630} priority />",
      badExample: "<img src='/hero.jpg' />  // 2MB PNG served to mobile clients — use next/image",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('image_component_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/<img\s/.test(line) && !/isCommentLine/.test(line)) {
            findings.push({ severity, category: 'image_component_missing', file: path, line: i + 1, message: 'Raw <img> element in Next.js — use <Image> from next/image for automatic optimization.', suggestion: "import Image from 'next/image' and replace <img> with <Image width={...} height={...} />." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_026',
    category: 'link_prefetch_opt_out',
    description: "Setting prefetch={false} on <Link> disables route prefetching — use sparingly and only for heavyweight routes.",
    severity: 'LOW',
    tags: ['nextjs', 'performance', 'navigation'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js prefetches routes when <Link> enters the viewport, making navigation feel instant. prefetch={false} trades UX speed for bandwidth. Only use it if a route is extremely expensive (large JS bundle, huge DB query at prefetch time).",
      commonViolations: ["<Link href='/dashboard' prefetch={false}>Dashboard</Link>"],
      goodExample: "<Link href='/dashboard'>Dashboard</Link>  // let Next.js prefetch for instant navigation",
      badExample: "<Link href='/home' prefetch={false}>Home</Link>  // slows navigation to one of the most-visited routes",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('link_prefetch_opt_out', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/prefetch\s*=\s*\{?\s*false\s*\}?/.test(line) && /Link/.test(content.slice(0, 500))) {
            findings.push({ severity, category: 'link_prefetch_opt_out', file: path, line: i + 1, message: "Next.js <Link> with prefetch={false} — disables route prefetching and slows navigation.", suggestion: "Remove prefetch={false} unless this route is extremely expensive to prefetch." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_027',
    category: 'server_action_no_revalidate',
    description: 'Server Actions that mutate data should call revalidatePath or revalidateTag to clear stale cache.',
    severity: 'HIGH',
    tags: ['nextjs', 'server-actions', 'caching'],
    sinceVersion: '3.0.0',
    explain: {
      why: "After a mutation Server Action runs, Next.js continues serving old cached data to users until you explicitly revalidate. Always call revalidatePath('/affected-path') or revalidateTag('data-tag') after mutations.",
      commonViolations: ["'use server'\nexport async function createPost(data) { await db.insert(posts, data) }  // no revalidation"],
      goodExample: "'use server'\nexport async function createPost(data: FormData) {\n  await db.insert(posts, data)\n  revalidatePath('/posts')\n}",
      badExample: "export async function deleteUser(id: string) { await prisma.user.delete({ where: { id } }) }  // stale cache",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('server_action_no_revalidate', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes("'use server'") && !content.includes('"use server"')) return findings;
        if (content.includes('revalidatePath') || content.includes('revalidateTag')) return findings;
        const MUTATING = /(?:insert|create|update|delete|upsert|remove|patch|save)\w*\s*\(/i;
        if (MUTATING.test(content)) {
          findings.push({ severity, category: 'server_action_no_revalidate', file: path, message: 'Server Action with mutations but no revalidatePath/revalidateTag — users see stale data.', suggestion: "Add revalidatePath('/path') or revalidateTag('tag') after any data mutations." });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_028',
    category: 'generate_static_params_missing',
    description: "Dynamic routes ([slug]) without generateStaticParams are always server-rendered — missing the SSG optimization.",
    severity: 'LOW',
    tags: ['nextjs', 'performance', 'ssg'],
    sinceVersion: '3.0.0',
    explain: {
      why: "For blog posts, product pages, and other content that changes infrequently, generateStaticParams pre-renders all pages at build time. Without it, each request hits the server — slower and more expensive.",
      commonViolations: ["// app/blog/[slug]/page.tsx with no generateStaticParams export"],
      goodExample: "export async function generateStaticParams() {\n  const posts = await db.post.findMany({ select: { slug: true } })\n  return posts.map(p => ({ slug: p.slug }))\n}",
      badExample: "// app/products/[id]/page.tsx — no generateStaticParams — each visit hits the server",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('generate_static_params_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || !/\[[^\]]+\]\/page\./.test(path)) continue;
        if (!content.includes('generateStaticParams')) {
          findings.push({ severity, category: 'generate_static_params_missing', file: path, message: 'Dynamic route without generateStaticParams — always server-rendered per request.', suggestion: "Export generateStaticParams() to pre-render known paths at build time (SSG)." });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_029',
    category: 'middleware_response_clone',
    description: "Cloning or consuming the request body in Next.js Middleware is not supported in Edge Runtime.",
    severity: 'HIGH',
    tags: ['nextjs', 'middleware', 'edge', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js Middleware runs in the Edge Runtime where request.body is locked. Calling request.json() or request.text() throws 'Body unusable'. Middleware is for routing/redirects/headers — not request body parsing.",
      commonViolations: ['const body = await request.json()  // in middleware.ts'],
      goodExample: "// middleware.ts: only read headers, cookies, search params\nconst token = request.cookies.get('token')\n// Move body parsing to API routes or Server Actions",
      badExample: "// middleware.ts\nconst { userId } = await request.json()  // throws: Body unusable in Edge Runtime",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('middleware_response_clone', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('middleware.')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/request\.(json|text|formData|arrayBuffer)\s*\(\)/.test(line) || /req\.(json|text|formData)\s*\(\)/.test(line)) {
            findings.push({ severity, category: 'middleware_response_clone', file: path, line: i + 1, message: 'Request body parsed in Middleware — Edge Runtime does not support reading the request body.', suggestion: 'Move body parsing to an API Route or Server Action. Middleware should only read headers/cookies/params.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_030',
    category: 'use_client_on_layout',
    description: "Marking a layout.tsx as 'use client' prevents Server Component children from fetching data on the server.",
    severity: 'HIGH',
    tags: ['nextjs', 'performance', 'server-components'],
    sinceVersion: '3.0.0',
    explain: {
      why: "When a layout is a Client Component, its children can only be Client Components too. This breaks the ability to pass async Server Components as children, losing RSC data-fetching benefits for the entire subtree.",
      commonViolations: ["'use client'\n// layout.tsx — forces all pages in this route to be client components"],
      goodExample: "// layout.tsx — Server Component (no 'use client')\n// Import interactive parts as children: <InteractiveHeader />",
      badExample: "'use client'\nexport default function Layout({ children }) { ... }  // all children forced to be client components",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('use_client_on_layout', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('layout.')) continue;
        if (content.includes("'use client'") || content.includes('"use client"')) {
          findings.push({ severity, category: 'use_client_on_layout', file: path, message: "layout.tsx marked 'use client' — prevents Server Component children from using server-side data fetching.", suggestion: "Keep layout.tsx as a Server Component. Extract interactive parts (navbar, sidebar) into child 'use client' components." });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_031',
    category: 'searchparams_missing_type',
    description: "Accessing searchParams without type-safe parsing allows injecting unexpected values through the URL.",
    severity: 'MEDIUM',
    tags: ['nextjs', 'security', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: "searchParams in App Router are untyped Record<string, string | string[] | undefined>. Accessing searchParams.page directly may be a string[] or undefined. Always parse and validate with zod or parseInt with a fallback.",
      commonViolations: ['const page = searchParams.page  // may be undefined or string[]'],
      goodExample: "const rawPage = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page\nconst page = Math.max(1, parseInt(rawPage ?? '1', 10))",
      badExample: "const page = parseInt(searchParams.page)  // NaN if undefined, no bounds check",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('searchparams_missing_type', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/parseInt\s*\(\s*searchParams\.\w+\s*\)/.test(line) || /searchParams\.\w+\s*as\s+string/.test(line)) {
            findings.push({ severity, category: 'searchparams_missing_type', file: path, line: i + 1, message: 'Unsafe searchParams access — may be string[], undefined, or injection attempt.', suggestion: 'Validate with: const val = z.string().optional().parse(searchParams.key) or use Array.isArray guard.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_032',
    category: 'not_found_trigger',
    description: "Returning null or an empty component when an entity is not found should call notFound() instead.",
    severity: 'MEDIUM',
    tags: ['nextjs', 'correctness', 'ux'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Returning <div /> or null when a post/product doesn't exist returns HTTP 200, confusing crawlers and caching. next/navigation's notFound() returns HTTP 404 and renders the not-found.tsx boundary.",
      commonViolations: ["if (!post) return null  // HTTP 200 with empty body"],
      goodExample: "import { notFound } from 'next/navigation'\nif (!post) notFound()  // HTTP 404 + renders not-found.tsx",
      badExample: "if (!product) return <div>Product not found</div>  // HTTP 200 — crawlers treat as found",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('not_found_trigger', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || !path.includes('page.')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/if\s*\(!\w+\)\s*return\s*null/.test(line) || /if\s*\(!\w+\)\s*return\s*</.test(line)) {
            if (!content.includes('notFound()')) {
              findings.push({ severity, category: 'not_found_trigger', file: path, line: i + 1, message: "Returning null or empty JSX for missing entity — use notFound() for proper HTTP 404.", suggestion: "import { notFound } from 'next/navigation' and call notFound() when the entity doesn't exist." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_033',
    category: 'dynamic_config_missing',
    description: "Pages that call dynamic functions (headers, cookies) without 'export const dynamic' may behave differently in production.",
    severity: 'LOW',
    tags: ['nextjs', 'performance', 'configuration'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js auto-detects dynamic rendering when you use cookies() or headers(), but being explicit with export const dynamic = 'force-dynamic' or 'force-static' makes the intent clear and prevents surprises when the heuristic changes.",
      commonViolations: ["// page.tsx that uses cookies() without setting dynamic config"],
      goodExample: "export const dynamic = 'force-dynamic'\nexport default async function Page() { const store = cookies() ... }",
      badExample: "// page.tsx implicitly dynamic due to cookies() — dynamic setting unclear",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('dynamic_config_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || !path.includes('page.')) continue;
        if (!content.includes('cookies()') && !content.includes('headers()')) return findings;
        if (!content.includes("export const dynamic") && !content.includes("export const revalidate")) {
          findings.push({ severity, category: 'dynamic_config_missing', file: path, message: "Page uses cookies()/headers() without explicit 'export const dynamic' config — rendering behavior is implicit.", suggestion: "Add: export const dynamic = 'force-dynamic' to make rendering intent explicit." });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_034',
    category: 'api_route_in_app_dir',
    description: "Using pages/api/ routes alongside App Router is fine, but Route Handlers (app/api/) are preferred for new routes.",
    severity: 'LOW',
    tags: ['nextjs', 'architecture', 'migration'],
    sinceVersion: '3.0.0',
    explain: {
      why: "pages/api/ handlers don't support Streaming, Edge Runtime, Web APIs, or Server Actions calling patterns. App Router Route Handlers (route.ts) support all of these. Prefer route.ts for new routes.",
      commonViolations: ['// Adding pages/api/new-feature.ts in an App Router project'],
      goodExample: "// app/api/new-feature/route.ts\nexport async function POST(request: Request) { ... }",
      badExample: "// pages/api/new-feature.ts — in a project using App Router",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('api_route_in_app_dir', config.severityRules);
      const findings: Finding[] = [];
      for (const { path } of changedFiles) {
        if (/pages\/api\//.test(path) && SOURCE_EXT.test(path)) {
          findings.push({ severity, category: 'api_route_in_app_dir', file: path, message: "New pages/api/ route in an App Router project — consider using Route Handlers in app/api/.", suggestion: "Create app/api/[name]/route.ts with export async function GET/POST(request: Request) instead." });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_035',
    category: 'loading_ui_granularity',
    description: "A single loading.tsx for an entire segment is less optimal than Suspense boundaries around individual data-fetching components.",
    severity: 'LOW',
    tags: ['nextjs', 'performance', 'ux'],
    sinceVersion: '3.0.0',
    explain: {
      why: "loading.tsx shows the entire segment skeleton until all data is ready. Wrapping individual async components in Suspense lets parts of the page render immediately while slower parts load independently.",
      commonViolations: ['// loading.tsx that shows full page skeleton — blocks all sub-component content'],
      goodExample: "<div>\n  <QuickStats />  {/* renders immediately — static */}\n  <Suspense fallback={<FeedSkeleton />}><Feed /></Suspense>  {/* streams when ready */}\n</div>",
      badExample: "// loading.tsx: entire page shows skeleton until slowest component finishes",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('loading_ui_granularity', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/loading\.(tsx|jsx)$/.test(path)) continue;
        const lineCount = content.split('\n').length;
        if (lineCount > 40) {
          findings.push({ severity, category: 'loading_ui_granularity', file: path, message: 'Complex loading.tsx — consider using granular Suspense boundaries for individual components instead.', suggestion: 'Wrap specific async components in <Suspense fallback={<PartialSkeleton />}> for finer loading states.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_036',
    category: 'form_action_vs_server_action',
    description: 'HTML <form action="/api/..."> submits as a full page reload. Use Server Actions for progressive enhancement.',
    severity: 'LOW',
    tags: ['nextjs', 'server-actions', 'ux'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Traditional <form action='/api/...'> causes a full page navigation on submit. Server Actions (action={serverActionFn}) work without JavaScript (progressive enhancement), enable optimistic updates, and integrate with React's transition API.",
      commonViolations: ["<form method='post' action='/api/subscribe'>"],
      goodExample: "<form action={subscribe}>  // Server Action — works without JS, no page reload",
      badExample: "<form method='post' action='/api/newsletter'>  // full page reload on submit",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_action_vs_server_action', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/<form[^>]+action\s*=\s*['"]\/api\//.test(line)) {
            findings.push({ severity, category: 'form_action_vs_server_action', file: path, line: i + 1, message: "form action='/api/...' causes full page reload — use a Server Action for progressive enhancement.", suggestion: "Create a Server Action function and pass it: <form action={serverActionFn}>." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_037',
    category: 'font_optimization_missing',
    description: "Importing fonts from Google Fonts CDN directly bypasses Next.js font optimization (no layout shift, self-hosting).",
    severity: 'MEDIUM',
    tags: ['nextjs', 'performance', 'fonts', 'privacy'],
    sinceVersion: '3.0.0',
    explain: {
      why: "next/font downloads and self-hosts Google Fonts at build time — eliminating external CDN requests (GDPR-friendly), adding font-display: optional, and reserving space to prevent CLS. Loading from CDN skips all this.",
      commonViolations: ["<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Inter'>"],
      goodExample: "import { Inter } from 'next/font/google'\nconst inter = Inter({ subsets: ['latin'] })\n// In layout: className={inter.className}",
      badExample: "<link href='https://fonts.googleapis.com/...' />  // CDN request, no CLS prevention, not GDPR-friendly",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('font_optimization_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) && !path.includes('layout.') && !path.endsWith('.html')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(line)) {
            findings.push({ severity, category: 'font_optimization_missing', file: path, line: i + 1, message: "Google Fonts loaded from CDN — bypasses Next.js font optimization and sends user IPs to Google.", suggestion: "Use next/font/google for self-hosted, CLS-free fonts: import { Inter } from 'next/font/google'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_038',
    category: 'next_middleware_only_auth',
    description: 'Authentication enforced only in Next.js middleware — bypassable via x-middleware-subrequest header (CVE-2025-29927, CVSS 9.1).',
    severity: 'BLOCKER',
    tags: ['nextjs', 'security', 'auth', 'cve', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'CVE-2025-29927 (CVSS 9.1): The x-middleware-subrequest header allows requests to skip Next.js middleware entirely. Any authentication logic placed only in middleware can be bypassed by sending this header. Auth must be enforced in the route handler itself.',
      commonViolations: [
        'middleware.ts that redirects to /login if !session — but route handlers have no auth check',
        'Relying solely on matcher config in middleware for auth protection',
      ],
      goodExample: '// route handler ALSO checks auth:\nexport async function GET() {\n  const session = await getServerSession();\n  if (!session) return new Response("Unauthorized", { status: 401 });\n  ...\n}',
      badExample: '// middleware.ts handles ALL auth — route handler has no check\n// ❌ CVE-2025-29927: x-middleware-subrequest bypasses this',
      relatedPlaybooks: ['nextjs-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_middleware_only_auth', config.severityRules);
      const findings: Finding[] = [];
      const middlewareFile = changedFiles.find((f) => /(?:^|\/)middleware\.(ts|js)$/.test(f.path));
      if (!middlewareFile) return [];
      const AUTH_IN_MIDDLEWARE = /getSession|getServerSession|auth\(\)|verifyToken|session\s*\?|NextResponse\.redirect/i;
      if (!AUTH_IN_MIDDLEWARE.test(middlewareFile.content)) return [];
      // Check if any route handlers in the diff also have auth
      const routeFiles = changedFiles.filter((f) => /route\.(ts|js)$/.test(f.path) || /\/(api|pages\/api)\//.test(f.path));
      if (routeFiles.length === 0) return [];
      for (const rf of routeFiles) {
        if (!/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)/.test(rf.content)) continue;
        if (!/getSession|getServerSession|auth\(\)|verifyToken|session\s*\?/.test(rf.content)) {
          findings.push({ severity, category: 'next_middleware_only_auth', file: rf.path, message: 'Route handler has no auth check — relies solely on middleware (bypassable via CVE-2025-29927).', suggestion: 'Add auth check in route handler: const session = await getServerSession(); if (!session) return unauthorized();' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_039',
    category: 'next_middleware_subrequest_not_stripped',
    description: 'x-middleware-subrequest header not stripped at edge/proxy — CVE-2025-29927 bypass.',
    severity: 'BLOCKER',
    tags: ['nextjs', 'security', 'cve', 'headers'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'CVE-2025-29927: Requests with x-middleware-subrequest header skip Next.js middleware. This header must be stripped by your edge/proxy/CDN before it reaches the Next.js process. If next.config includes security headers but not this one, the bypass remains possible.',
      commonViolations: [
        'next.config.js with headers() function that omits x-middleware-subrequest removal',
        'Vercel config without header stripping for x-middleware-subrequest',
      ],
      goodExample: "// next.config.js headers()\n{ key: 'x-middleware-subrequest', value: '' }  // strip before routing\n// Or vercel.json: { \"headers\": [{ \"source\": \"/(.*)\", \"headers\": [{ \"key\": \"x-middleware-subrequest\", \"value\": \"\" }] }] }",
      badExample: '// next.config.js has no stripping of x-middleware-subrequest  // ❌ CVE-2025-29927',
      relatedPlaybooks: ['nextjs-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_middleware_subrequest_not_stripped', config.severityRules);
      const findings: Finding[] = [];
      const configFiles = changedFiles.filter((f) => /next\.config\.(js|ts|mjs)$/.test(f.path) || /vercel\.json$/.test(f.path));
      for (const { path, content } of configFiles) {
        if (/headers\s*\(/.test(content) && !/x-middleware-subrequest/i.test(content)) {
          findings.push({ severity, category: 'next_middleware_subrequest_not_stripped', file: path, message: 'Security headers configured but x-middleware-subrequest not stripped — CVE-2025-29927 bypass.', suggestion: 'Add header stripping: { key: "x-middleware-subrequest", value: "" } in your headers() config.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_040',
    category: 'next_no_security_headers',
    description: 'next.config has no security headers — missing X-Frame-Options, HSTS, X-Content-Type-Options.',
    severity: 'HIGH',
    tags: ['nextjs', 'security', 'headers'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Security headers prevent a class of attacks: X-Frame-Options blocks clickjacking, Strict-Transport-Security enforces HTTPS, X-Content-Type-Options prevents MIME sniffing. AI-generated Next.js configs almost never include these.',
      commonViolations: ['next.config.js with no headers() function', 'headers() defined but only adds cache-control'],
      goodExample: "headers: async () => [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Strict-Transport-Security', value: 'max-age=63072000' }] }]",
      badExample: 'module.exports = { reactStrictMode: true }  // ❌ no security headers',
      relatedPlaybooks: ['nextjs-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_no_security_headers', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/next\.config\.(js|ts|mjs)$/.test(path)) continue;
        const SECURITY_HEADER_RE = /X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security|Content-Security-Policy/i;
        if (!SECURITY_HEADER_RE.test(content)) {
          findings.push({ severity, category: 'next_no_security_headers', file: path, message: 'next.config has no security headers — missing clickjacking, MIME, and HSTS protections.', suggestion: 'Add a headers() function with X-Frame-Options, X-Content-Type-Options, and Strict-Transport-Security.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_041',
    category: 'next_server_action_no_csrf',
    description: 'Next.js Server Action exposed without CSRF validation.',
    severity: 'HIGH',
    tags: ['nextjs', 'security', 'csrf', 'server-actions'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Next.js 14+ Server Actions are POST requests. While Next.js adds Origin validation in newer versions, older versions and custom implementations may not enforce CSRF tokens. Server Actions that mutate data should verify the Origin header matches the expected host.',
      commonViolations: [
        '"use server" functions with mutations and no origin check',
        'Server Action called from form without CSRF token in older Next.js versions',
      ],
      goodExample: '"use server";\nexport async function updateUser(formData) {\n  const session = await getServerSession();\n  if (!session) throw new Error("Unauthorized");\n  // Next.js 14.2+ validates Origin automatically — keep up to date\n}',
      badExample: '"use server";\nexport async function deleteItem(id) { await db.delete(id); }  // no session check',
      relatedPlaybooks: ['nextjs-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_server_action_no_csrf', config.severityRules);
      const findings: Finding[] = [];
      const USE_SERVER_RE = /['"]use server['"]/;
      const MUTATION_RE = /await\s+(?:db\.|prisma\.|supabase\.).*(?:delete|update|insert|create|upsert)/i;
      const AUTH_RE = /getServerSession|auth\(\)|session\s*\?|getSession|requireAuth/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!USE_SERVER_RE.test(content)) continue;
        if (MUTATION_RE.test(content) && !AUTH_RE.test(content)) {
          findings.push({ severity, category: 'next_server_action_no_csrf', file: path, message: 'Server Action performs mutation without session/auth check.', suggestion: 'Add auth check at the top of Server Actions: const session = await getServerSession(); if (!session) throw unauthorized();' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_042',
    category: 'next_revalidate_unprotected',
    description: 'revalidatePath or revalidateTag callable from an unauthenticated route.',
    severity: 'HIGH',
    tags: ['nextjs', 'security', 'cache', 'auth'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'revalidatePath() and revalidateTag() trigger cache purges that can be computationally expensive and cause serve-origin fallthrough for every user. An unauthenticated route that exposes revalidation enables a cache-busting DoS attack.',
      commonViolations: [
        'POST /api/revalidate with no auth check — webhook caller can purge cache',
        'Server Action calling revalidatePath without auth gate',
      ],
      goodExample: 'const secret = req.headers.get("x-revalidate-secret");\nif (secret !== process.env.REVALIDATE_SECRET) return unauthorized();\nrevalidatePath("/");',
      badExample: 'export async function POST() { revalidatePath("/blog"); return ok(); }  // ❌ public',
      relatedPlaybooks: ['nextjs-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_revalidate_unprotected', config.severityRules);
      const findings: Finding[] = [];
      const REVALIDATE_RE = /revalidatePath\s*\(|revalidateTag\s*\(/;
      const AUTH_RE = /getServerSession|auth\(\)|secret\s*!==|REVALIDATE_SECRET|verifyToken|requireAuth/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!REVALIDATE_RE.test(content)) continue;
        if (!AUTH_RE.test(content)) {
          findings.push({ severity, category: 'next_revalidate_unprotected', file: path, message: 'revalidatePath/revalidateTag used in route without auth protection — cache DoS risk.', suggestion: 'Protect revalidation with a secret header or session check.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_043',
    category: 'next_route_no_content_type_check',
    description: 'POST route handler processes body without validating Content-Type header.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'security', 'validation'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Without Content-Type validation, a route handler that calls req.json() can receive application/x-www-form-urlencoded or multipart bodies — causing unexpected parsing behavior or bypassing JSON-specific sanitization logic.',
      commonViolations: [
        'export async function POST(req) { const body = await req.json(); ... }  // no Content-Type check',
      ],
      goodExample: "if (req.headers.get('content-type') !== 'application/json') return new Response('Unsupported Media Type', { status: 415 });",
      badExample: 'export async function POST(req) { const body = await req.json(); }  // ❌ any content type',
      relatedPlaybooks: ['nextjs-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_route_no_content_type_check', config.severityRules);
      const findings: Finding[] = [];
      const POST_HANDLER_RE = /export\s+async\s+function\s+POST\s*\(/;
      const JSON_RE = /await\s+req\.json\s*\(\s*\)/;
      const CONTENT_TYPE_RE = /content-type|contentType|headers\.get\s*\(\s*['"]content/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!POST_HANDLER_RE.test(content) || !JSON_RE.test(content)) continue;
        if (!CONTENT_TYPE_RE.test(content)) {
          findings.push({ severity, category: 'next_route_no_content_type_check', file: path, message: 'POST route handler calls req.json() without Content-Type header validation.', suggestion: "Validate: if (req.headers.get('content-type') !== 'application/json') return new Response('', { status: 415 });" });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_044',
    category: 'next_dynamic_route_no_type_coercion',
    description: 'Dynamic route param used as number/ID without explicit type coercion and validation.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'security', 'validation', 'injection'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Next.js dynamic route params are always strings. Using params.id directly in a Prisma query (where: { id: params.id }) when the schema expects an integer silently coerces or fails. An attacker can send "1 OR 1=1" — validate and coerce explicitly.',
      commonViolations: [
        'db.user.findUnique({ where: { id: params.id } })  // id is a string, schema expects Int',
        'prisma.order.findFirst({ where: { id: Number(params.id) } })  // NaN if non-numeric',
      ],
      goodExample: 'const id = z.coerce.number().int().positive().parse(params.id);\nconst item = await db.item.findUnique({ where: { id } });',
      badExample: 'const item = await db.item.findUnique({ where: { id: params.id } });  // ❌ string vs number',
      relatedPlaybooks: ['nextjs-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_dynamic_route_no_type_coercion', config.severityRules);
      const findings: Finding[] = [];
      const PARAM_ID_RE = /params\.id\b(?!\s*\.\s*toString)/;
      const COERCE_RE = /z\s*\.\s*coerce|parseInt\s*\(|Number\s*\(|parseFloat\s*\(|\.parse\s*\(|isNaN\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!PARAM_ID_RE.test(content)) continue;
        if (!COERCE_RE.test(content)) {
          findings.push({ severity, category: 'next_dynamic_route_no_type_coercion', file: path, message: 'Dynamic route param used without type coercion/validation.', suggestion: 'Coerce and validate: const id = z.coerce.number().int().parse(params.id);' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_045',
    category: 'next_server_component_cookie_no_boundary',
    description: 'Server Component reads cookies() without error boundary — unhandled cookie access errors crash the component.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'reliability', 'server-components'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'cookies() and headers() in Server Components throw if called in contexts where they are unavailable (e.g., during static rendering or in certain edge cases). Without an error boundary or try/catch, this crashes the component tree and returns a 500 error to users.',
      commonViolations: [
        'const token = cookies().get("auth")?.value  // no boundary if cookies() throws',
        'Server Component that reads headers() without error handling',
      ],
      goodExample: "// Wrap in try/catch or use a Suspense boundary\ntry {\n  const token = cookies().get('auth')?.value;\n} catch {\n  return null;  // or redirect('/login')\n}",
      badExample: "const token = cookies().get('auth').value;  // ❌ crashes if cookie absent or API unavailable",
      relatedPlaybooks: ['nextjs-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_server_component_cookie_no_boundary', config.severityRules);
      const findings: Finding[] = [];
      const COOKIE_RE = /\bcookies\s*\(\s*\)\s*\.\s*get\s*\([^)]+\)\s*\.value\b/i;
      const SAFE_RE = /try\s*\{|ErrorBoundary|Suspense/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (/'use client'/.test(content)) continue;
        if (!COOKIE_RE.test(content)) continue;
        if (!SAFE_RE.test(content)) {
          findings.push({ severity, category: 'next_server_component_cookie_no_boundary', file: path, message: 'cookies().get().value accessed without optional chaining or error boundary.', suggestion: 'Use optional chaining: cookies().get("auth")?.value  or wrap in try/catch.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_046',
    category: 'next_image_no_domains',
    description: 'Next.js Image component loads from external src without configuring allowed domains.',
    severity: 'MEDIUM',
    tags: ['nextjs', 'security', 'ssrf'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'The Next.js Image optimization endpoint acts as a server-side proxy for external images. Without a domains or remotePatterns allowlist, it becomes an open SSRF proxy — attackers can use it to make requests to internal services via the image URL parameter.',
      commonViolations: [
        '<Image src={user.avatarUrl} />  // external URL without next.config domains',
        'next.config with no remotePatterns for Image component',
      ],
      goodExample: "// next.config.js\nimages: { remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }] }",
      badExample: '<Image src={externalUrl} />  // ❌ SSRF if next.config has no remotePatterns',
      relatedPlaybooks: ['nextjs-security.md', 'ssrf-prevention.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_image_no_domains', config.severityRules);
      const findings: Finding[] = [];
      const DYNAMIC_IMG_RE = /(?:next\/image|Image)\b[^}]*src\s*=\s*\{(?!['"])/i;
      const CONFIG_FILES = changedFiles.filter((f) => /next\.config\.(js|ts|mjs)$/.test(f.path));
      const hasDomains = CONFIG_FILES.some((f) => /remotePatterns|domains\s*:/i.test(f.content));
      if (hasDomains) return [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (DYNAMIC_IMG_RE.test(content)) {
          findings.push({ severity, category: 'next_image_no_domains', file: path, message: 'Next.js Image with dynamic external src and no remotePatterns in next.config — SSRF risk.', suggestion: 'Add remotePatterns to next.config for all allowed external image hosts.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NEXT_047',
    category: 'next_env_public_secret',
    description: 'Secret or private key stored in NEXT_PUBLIC_ environment variable — exposed to client bundle.',
    severity: 'BLOCKER',
    tags: ['nextjs', 'security', 'secrets', 'env'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'NEXT_PUBLIC_ variables are embedded in the client-side JavaScript bundle at build time. Any variable prefixed with NEXT_PUBLIC_ is readable by anyone who inspects the browser bundle — including secrets, API keys, and private configuration.',
      commonViolations: [
        'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=...',
        'NEXT_PUBLIC_API_SECRET=...',
        'NEXT_PUBLIC_STRIPE_SECRET_KEY=...',
      ],
      goodExample: 'NEXT_PUBLIC_SUPABASE_URL=...  # public\nSUPABASE_SERVICE_ROLE_KEY=...  # private, no prefix',
      badExample: 'NEXT_PUBLIC_API_SECRET=sk-...  // ❌ shipped to browser',
      relatedPlaybooks: ['nextjs-security.md', 'secret-management.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('next_env_public_secret', config.severityRules);
      const findings: Finding[] = [];
      const PUBLIC_SECRET_RE = /NEXT_PUBLIC_\w*(?:SECRET|KEY|PRIVATE|SERVICE_ROLE|STRIPE_SECRET|OPENAI_API|ANTHROPIC|PASSWORD|TOKEN_SECRET)\w*/i;
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('.env') && !path.endsWith('.env.local') && !path.endsWith('.env.example') && !path.endsWith('.env.production')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PUBLIC_SECRET_RE.test(line)) {
            findings.push({ severity, category: 'next_env_public_secret', file: path, line: i + 1, message: 'Secret key stored with NEXT_PUBLIC_ prefix — exposed to client bundle.', suggestion: 'Remove NEXT_PUBLIC_ prefix. Access the secret only in Server Components, Server Actions, or API routes.' });
          }
        }
      }
      return findings;
    },
  },
];
