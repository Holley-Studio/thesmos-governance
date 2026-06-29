# thesmos-governance — Severity Model

<!-- TODO: Document project-specific severity overrides or additional categories. -->


<!-- THESMOS:GENERATED START model -->
### Severity Levels

| Level | CI Effect | When to Use |
|---|---|---|
| 🔴 BLOCKER | `exit 1` | Security violations, data leaks, broken invariants |
| 🟠 HIGH | Warning | Auth gaps, risky patterns, near-violations |
| 🟡 MEDIUM | Advisory | Type safety, quality, maintainability |
| 🔵 LOW | Advisory | Style, cleanup, minor issues |
| ⚪ TECH_DEBT | Advisory | Complexity, large files, deferred work |

### Rule Assignments

| ID | Category | Severity | Description |
|---|---|---|---|
| ENV_001 | `direct_env_access` | 🔴 BLOCKER | Use bracket-notation env access — process['env' as 'env']['VAR'] — never process.env.VAR dot notation. |
| SEC_001 | `admin_client_in_browser` | 🔴 BLOCKER | Never import the Supabase admin client in 'use client' files. Admin clients expose service-role keys to the browser. |
| SEC_002 | `rls_disabled` | 🔴 BLOCKER | Never disable Row Level Security. All Supabase tables must have RLS enabled with explicit policies. |
| SEC_003 | `secret_in_diff` | 🔴 BLOCKER | Never commit secrets, API keys, or private key material in code or config files. |
| AUTH_001 | `missing_api_auth` | 🟠 HIGH | All POST, PATCH, PUT, and DELETE API routes must verify caller identity before executing mutations. |
| TS_001 | `any_type_no_comment` | 🟡 MEDIUM | Avoid TypeScript `any` without an explanatory comment. Use `unknown` and narrow the type instead. |
| QUAL_001 | `console_log` | 🔵 LOW | Remove console.log statements before merging. Use structured logging in production code. |
| QUAL_002 | `large_file` | ⚪ TECH_DEBT | Files exceeding the configured line threshold are tech-debt candidates. Consider splitting into smaller modules. |
| GATE_001 | `monday_write_no_gate` | 🟠 HIGH | Monday.com write mutations must go through the designated gateway module, not scattered across the codebase. |
| TEST_001 | `missing_test_for_risky_change` | 🟡 MEDIUM | Risky file changes (matching riskyFilePatterns) must include a corresponding test file change in the same diff. |
| DS_001 | `design_system_bypass` | 🔵 LOW | Hardcoded colour literals or raw CSS values outside design-system files bypass the design token system. |
| COMP_001 | `duplicate_component_pattern` | ⚪ TECH_DEBT | Creating a component that duplicates an existing shared UI component. Reuse or extend instead. |
| SEC_004 | `eval_usage` | 🔴 BLOCKER | Never use eval() or new Function(string). Both execute arbitrary code and open remote code execution vulnerabilities. |
| SEC_005 | `dangerous_inner_html` | 🟠 HIGH | dangerouslySetInnerHTML with a variable value is an XSS vector. Sanitize with DOMPurify before use. |
| SEC_006 | `sql_injection` | 🔴 BLOCKER | SQL queries built with template literals or string concatenation are vulnerable to injection. Use parameterized queries. |
| SEC_007 | `innerHTML_assignment` | 🟠 HIGH | Direct assignment to .innerHTML with a variable is an XSS vulnerability. Use textContent or sanitize first. |
| SEC_008 | `hardcoded_http_url` | 🟡 MEDIUM | Hardcoded http:// (non-HTTPS) URLs in production code expose data to network interception. |
| SEC_009 | `path_traversal` | 🔴 BLOCKER | path.join / path.resolve with user-controlled input enables directory traversal attacks. |
| SEC_010 | `cors_wildcard` | 🟠 HIGH | CORS wildcard origin (*) allows any website to make credentialed cross-origin requests to your API. |
| SEC_011 | `math_random_crypto` | 🟠 HIGH | Math.random() is not cryptographically secure. Never use it for tokens, passwords, session IDs, or security-sensitive values. |
| SEC_012 | `cookie_no_flags` | 🟠 HIGH | Cookies set without httpOnly, secure, and sameSite flags are vulnerable to XSS theft and CSRF. |
| SEC_013 | `json_parse_user_input` | 🟡 MEDIUM | JSON.parse on user-supplied input without try-catch causes unhandled exceptions on malformed JSON. |
| SEC_014 | `ssrf_fetch` | 🔴 BLOCKER | Server-side fetch with a user-controlled URL enables SSRF — attackers can reach internal services. |
| SEC_015 | `open_redirect` | 🟠 HIGH | redirect() or res.redirect() with user-controlled input enables open redirect attacks. |
| SEC_016 | `shell_injection` | 🔴 BLOCKER | child_process.exec / execSync with template literals or concatenation enables command injection. |
| SEC_017 | `prototype_pollution` | 🟠 HIGH | Object.assign or spread with untrusted input into a shared object enables prototype pollution. |
| SEC_018 | `password_in_url` | 🔴 BLOCKER | Passwords or secrets in URLs appear in server logs, browser history, and Referer headers. |
| SEC_019 | `timing_attack` | 🟠 HIGH | Password or token comparison with == / === is vulnerable to timing attacks. Use a constant-time comparison function. |
| AUTH_002 | `jwt_decode_no_verify` | 🔴 BLOCKER | jwt.decode() decodes without verifying the signature. Use jwt.verify() to authenticate the token. |
| AUTH_003 | `localstorage_token` | 🟠 HIGH | Storing auth tokens in localStorage exposes them to XSS. Use httpOnly cookies managed by the server. |
| AUTH_004 | `user_id_from_body` | 🔴 BLOCKER | Trusting userId from req.body instead of the session allows users to act as any other user. |
| AUTH_005 | `missing_rate_limit` | 🟠 HIGH | Auth endpoints (login, register, password reset) without rate limiting are brute-force targets. |
| AUTH_006 | `hardcoded_credentials` | 🔴 BLOCKER | Hardcoded test credentials or default passwords in non-test files are a persistent security risk. |
| AUTH_007 | `missing_auth_middleware` | 🔴 BLOCKER | Admin or internal routes exposed without authentication middleware are world-accessible. |
| SEC_020 | `open_redirect` | 🟠 HIGH | Redirecting to a URL from user input without validation allows attackers to redirect users to phishing sites. |
| SEC_021 | `mass_assignment` | 🔴 BLOCKER | Spreading user input directly into database operations allows attackers to set fields they shouldn't control. |
| SEC_022 | `cors_wildcard_header` | 🔴 BLOCKER | CORS Access-Control-Allow-Origin: * allows any website to make credentialed requests to your API. |
| SEC_023 | `timing_attack_comparison` | 🟠 HIGH | Comparing secrets with === is vulnerable to timing attacks — use crypto.timingSafeEqual instead. |
| SEC_024 | `insecure_deserialization` | 🔴 BLOCKER | Deserializing untrusted data with eval(), new Function(), or JSON.parse without schema validation is dangerous. |
| SEC_025 | `file_upload_path_traversal` | 🔴 BLOCKER | Using user-provided filenames for file uploads allows path traversal attacks (../../etc/passwd). |
| SEC_026 | `rate_limit_missing_auth` | 🟠 HIGH | Authentication endpoints (login, password reset) without rate limiting are vulnerable to brute force attacks. |
| SEC_027 | `jwt_secret_weak` | 🔴 BLOCKER | Using a short or predictable JWT secret allows attackers to forge tokens via offline brute force. |
| SEC_028 | `session_fixation` | 🟠 HIGH | Not regenerating the session ID after login allows session fixation attacks. |
| SEC_029 | `xxe_vulnerability` | 🔴 BLOCKER | Parsing XML with external entity expansion enabled allows XXE attacks that can read local files. |
| SEC_030 | `insecure_direct_object_ref` | 🟠 HIGH | Using user-provided IDs to fetch resources without verifying ownership enables IDOR attacks. |
| SEC_031 | `http_in_production` | 🟠 HIGH | Hardcoded http:// URLs in production code transmit data unencrypted and break HSTS. |
| SEC_032 | `dependency_confusion` | 🟡 MEDIUM | Private package names without a scope (@org/) are vulnerable to dependency confusion attacks. |
| SEC_033 | `xss_via_href` | 🔴 BLOCKER | Using user-provided URLs in href attributes allows javascript: protocol XSS attacks. |
| SEC_034 | `clickjacking_missing` | 🟡 MEDIUM | Pages without X-Frame-Options or CSP frame-ancestors are vulnerable to clickjacking. |
| SEC_035 | `password_not_hashed` | 🔴 BLOCKER | Storing passwords without hashing exposes all user credentials if the database is breached. |
| SEC_036 | `env_var_logged` | 🟠 HIGH | Logging process.env values risks exposing secret keys in log aggregators. |
| SEC_037 | `prototype_pollution_merge` | 🔴 BLOCKER | Object.assign() or lodash.merge() with user-controlled keys can pollute Object.prototype. |
| SEC_038 | `cors_reflected_origin` | 🔴 BLOCKER | CORS origin reflected from request header without allowlist — any origin can make credentialed cross-origin requests. |
| SEC_039 | `cors_wildcard_with_credentials` | 🔴 BLOCKER | CORS allows wildcard origin (*) combined with credentials:true — credentials are never sent with wildcard but this signals a misconfiguration. |
| SEC_040 | `cors_regex_allowlist` | 🟠 HIGH | CORS allowlist uses regex pattern matching instead of exact string comparison — regex bypass risk. |
| SEC_041 | `cors_null_origin` | 🟠 HIGH | CORS allowlist includes "null" origin — allows requests from file:// and sandboxed iframes. |
| SEC_042 | `cors_in_route_handler` | 🟠 HIGH | CORS headers set inside individual route handlers instead of global middleware — inconsistent coverage. |
| SEC_043 | `cors_long_preflight_cache` | 🟡 MEDIUM | CORS preflight max-age exceeds 1 week — permission changes take days to propagate. |
| SEC_044 | `ssrf_private_ip_range` | 🔴 BLOCKER | HTTP request to a URL that may resolve to a private IP range — SSRF to internal services. |
| SEC_045 | `path_traversal_encoding_bypass` | 🔴 BLOCKER | Path validation uses string comparison without URL-decoding first — encoding bypass (..%2F..%2F). |
| TS_002 | `ts_ignore_no_comment` | 🟡 MEDIUM | @ts-ignore suppresses TypeScript errors without explaining why. Always add a justification comment. |
| TS_003 | `ts_expect_error_no_comment` | 🔵 LOW | @ts-expect-error without an explanation comment obscures intentional type suppressions. |
| TS_004 | `non_null_user_input` | 🟠 HIGH | Non-null assertion (!) on req.query, req.params, or req.body values hides runtime crashes. |
| TS_005 | `double_cast` | 🟡 MEDIUM | `as unknown as T` double casts bypass TypeScript's type system entirely. This masks type errors. |
| TS_006 | `function_type` | 🔵 LOW | Using `Function` as a type is too broad — it accepts any callable including constructors with wrong signatures. |
| TS_007 | `var_declaration` | 🔵 LOW | `var` has function scope and hoisting behavior that causes subtle bugs. Use `const` or `let`. |
| TS_008 | `empty_catch_block` | 🟠 HIGH | Empty catch blocks swallow errors silently. At minimum, log the error. |
| TS_009 | `number_parse_no_validate` | 🟡 MEDIUM | Number() and parseInt() on user input return NaN for non-numeric strings. Always validate after parsing. |
| TS_010 | `floating_promise` | 🟠 HIGH | Calling an async function without await or .catch() creates an unhandled promise rejection. |
| TS_011 | `debugger_statement` | 🟠 HIGH | `debugger` statement committed to source code pauses execution in any environment with dev tools open. |
| TS_012 | `unhandled_error_in_catch` | 🟡 MEDIUM | Using catch(err) with `console.error` only and no re-throw or user notification swallows errors. |
| ASYNC_001 | `await_in_foreach` | 🟠 HIGH | `await` inside `.forEach()` does not wait for promises — use `for...of` or `Promise.all` instead. |
| ASYNC_002 | `promise_all_no_catch` | 🟡 MEDIUM | Promise.all() rejects immediately when any promise rejects — handle rejections explicitly. |
| ASYNC_003 | `async_no_try_catch` | 🟡 MEDIUM | API route handlers that are async and use await without try-catch let errors crash the process. |
| ASYNC_004 | `new_promise_constructor` | 🔵 LOW | `new Promise()` wrapping an already-async function loses error propagation and adds unnecessary indirection. |
| ASYNC_005 | `sequential_await` | 🔵 LOW | Multiple sequential awaits for independent operations — use Promise.all for parallel execution. |
| ASYNC_006 | `settimeout_zero` | 🔵 LOW | setTimeout(fn, 0) is a code smell — it defers execution to next tick to work around a timing bug. |
| TS_013 | `type_assertion_double_cast` | 🟡 MEDIUM | Double type assertion (x as unknown as T) is a red flag that the types are fundamentally incompatible. |
| TS_014 | `missing_return_type` | 🔵 LOW | Exported functions without explicit return types make API contracts unclear and allow accidental type widening. |
| TS_015 | `generic_constraint_missing` | 🔵 LOW | Generic type parameters without constraints (<T>) accept any type, defeating the purpose of generics. |
| TS_016 | `optional_chain_without_fallback` | 🟡 MEDIUM | Optional chaining (a?.b) returning undefined in places that expect a value causes silent runtime failures. |
| TS_017 | `non_null_assertion_overuse` | 🟡 MEDIUM | Excessive non-null assertions (!) hide null-reference errors that would otherwise be caught at compile time. |
| TS_018 | `discriminated_union_missing` | 🔵 LOW | Using string/boolean flags to model variants instead of discriminated unions makes impossible states possible. |
| TS_019 | `object_destructure_unused` | 🔵 LOW | Destructuring many properties but using only one is wasteful — destructure only what you need. |
| TS_020 | `template_literal_type_missing` | 🔵 LOW | Using string for URL paths, event names, or CSS classes loses IDE autocomplete and typo safety. |
| TS_021 | `readonly_missing` | 🔵 LOW | Config objects and DTO props without readonly can be accidentally mutated by consumers. |
| TS_022 | `enum_prefer_const_object` | 🔵 LOW | TypeScript enums should be replaced with as const objects for better tree-shaking and bundler compatibility. |
| TS_023 | `type_predicate_missing` | 🟡 MEDIUM | Type narrowing functions without type predicates (x is Type) don't narrow the type in the calling scope. |
| TS_024 | `satisfies_operator_missing` | 🔵 LOW | Using as Type instead of satisfies Type loses excess property checking and auto-inference of literal types. |
| TS_025 | `index_signature_unsafe` | 🔵 LOW | Index signatures (Record<string, T>) skip excess property checking and allow any string key. |
| TS_026 | `mapped_type_opportunity` | 🔵 LOW | Repeating the same property pattern across multiple types is a signal for a mapped type. |
| TS_027 | `string_union_too_wide` | 🔵 LOW | String union types with 10+ members become hard to maintain — consider using a const array and typeof. |
| TS_028 | `infer_keyword_avoid` | 🔵 LOW | Overusing conditional types with infer makes code unreadable — prefer utility types when possible. |
| TS_029 | `namespace_avoid` | 🔵 LOW | TypeScript namespaces (namespace Foo {}) are legacy — use ES modules (import/export) instead. |
| TS_030 | `excessive_type_assertion` | 🟡 MEDIUM | More than 5 type assertions in a single file indicates underlying type errors being suppressed rather than fixed. |
| REACT_001 | `useeffect_async_callback` | 🟠 HIGH | useEffect does not support async callbacks directly. The cleanup function must be synchronous. |
| REACT_002 | `key_prop_index` | 🟡 MEDIUM | Using array index as React key causes incorrect reconciliation when the list order changes. |
| REACT_003 | `direct_dom_manipulation` | 🟡 MEDIUM | document.getElementById and querySelector in React components bypass the virtual DOM. |
| REACT_004 | `window_ssr_unsafe` | 🟠 HIGH | Accessing `window` at the module or component level breaks server-side rendering. |
| REACT_005 | `state_mutation` | 🟠 HIGH | Mutating state arrays or objects directly (push, splice, sort) bypasses React's change detection. |
| REACT_006 | `react_fc_type` | 🔵 LOW | `React.FC` is discouraged — it implicitly adds children and hides component return type issues. |
| REACT_007 | `inline_object_prop` | 🔵 LOW | Object or array literals in JSX props create a new reference on every render, causing unnecessary re-renders of children. |
| REACT_008 | `missing_error_boundary` | 🟡 MEDIUM | Components that fetch data or render user content should be wrapped in an error boundary. |
| REACT_009 | `uselayouteffect_misuse` | 🔵 LOW | useLayoutEffect runs synchronously after DOM mutations, blocking paint. Use useEffect unless you need DOM measurements. |
| REACT_010 | `prop_spreading_dom` | 🟡 MEDIUM | Spreading unknown props onto DOM elements passes invalid HTML attributes, causing React warnings and potential XSS. |
| REACT_011 | `missing_useeffect_cleanup` | 🟡 MEDIUM | useEffect with subscriptions, timers, or event listeners must return a cleanup function to prevent memory leaks. |
| REACT_012 | `missing_suspense_boundary` | 🟠 HIGH | Components using useSuspense, lazy(), or use() must be wrapped in a <Suspense> boundary. |
| REACT_013 | `react_missing_key` | 🟠 HIGH | List items rendered without a stable key prop cause incorrect reconciliation and DOM mutations. |
| REACT_014 | `react_index_key` | 🟡 MEDIUM | Using array index as React key prop causes incorrect reconciliation when items are added, removed, or reordered. |
| REACT_015 | `use_callback_missing_dep` | 🟠 HIGH | useCallback with missing dependencies will use stale closure values instead of the latest state/props. |
| REACT_016 | `react_memo_overuse` | 🔵 LOW | Wrapping every component in React.memo adds comparison overhead and complexity without benefit when props change often. |
| REACT_017 | `state_update_unmounted` | 🟠 HIGH | Calling setState on an unmounted component causes memory leaks and 'Can\'t perform state update on unmounted component' warnings. |
| REACT_018 | `react_children_prop_type` | 🔵 LOW | Using ReactNode instead of PropsWithChildren<T> or FC<T> for components that accept children is less idiomatic. |
| REACT_019 | `conditional_hook_call` | 🔴 BLOCKER | Hooks called inside conditionals, loops, or early returns violate Rules of Hooks and cause crashes. |
| REACT_020 | `event_handler_async` | 🟠 HIGH | Async event handlers without error handling cause unhandled promise rejections that silently swallow errors. |
| REACT_021 | `prop_drilling_deep` | 🔵 LOW | Passing props through 4+ levels of components (prop drilling) is a strong signal to use Context or a state manager. |
| REACT_022 | `large_component` | 🔵 LOW | Components over 200 lines mix too many concerns — break into smaller focused components. |
| REACT_023 | `usememo_stable_primitive` | 🔵 LOW | Wrapping primitive values in useMemo provides no benefit — only memoize expensive computations or object references. |
| REACT_024 | `fragment_wrapper_unnecessary` | 🔵 LOW | Returning a single element wrapped in <></> or <React.Fragment> is unnecessary boilerplate. |
| REACT_025 | `use_id_for_a11y` | 🟡 MEDIUM | Generating DOM IDs with Math.random() or counters is unstable in SSR and should use React's useId() hook. |
| REACT_026 | `dangerouslysetmlhtml_usage` | 🔴 BLOCKER | dangerouslySetInnerHTML with unescaped user content is a direct XSS vulnerability. |
| REACT_027 | `use_transition_missing` | 🔵 LOW | Expensive state updates that cause UI freezes should use startTransition to keep the UI responsive. |
| REACT_028 | `ref_as_state` | 🟡 MEDIUM | Using useRef to store values that should trigger re-renders misses the purpose of refs vs state. |
| REACT_029 | `portal_missing_container` | 🟡 MEDIUM | ReactDOM.createPortal should render into a DOM container that exists before mount — not document.body directly. |
| REACT_030 | `effect_on_initial_render` | 🟡 MEDIUM | useEffect with an empty dependency array that sets visible state causes a flash of incorrect content (FOIC). |
| REACT_031 | `async_missing_error_boundary` | 🟠 HIGH | Async data-fetching components without an error boundary crash the entire component tree on failure. |
| REACT_032 | `debounce_missing_on_search` | 🟡 MEDIUM | Search/autocomplete inputs without debouncing fire an API request on every keystroke, overloading the server. |
| NEXT_001 | `next_router_in_app` | 🟠 HIGH | `next/router` is for the Pages Router. Use `next/navigation` for the App Router. |
| NEXT_002 | `getserversideprops_in_app` | 🟠 HIGH | `getServerSideProps` is a Pages Router API. In the App Router, data fetching is done in Server Components. |
| NEXT_003 | `cookies_in_client_component` | 🔴 BLOCKER | `cookies()` and `headers()` from next/headers cannot be called in Client Components. |
| NEXT_004 | `params_not_awaited` | 🟠 HIGH | In Next.js 15+, `params` and `searchParams` are Promises and must be awaited before destructuring. |
| NEXT_005 | `server_action_no_directive` | 🟠 HIGH | Server Actions must include the `"use server"` directive to prevent accidental client execution. |
| NEXT_006 | `redirect_in_try_catch` | 🟠 HIGH | `redirect()` from next/navigation throws an error internally — catching it prevents the redirect. |
| NEXT_007 | `nextpublic_env_in_server` | 🟡 MEDIUM | NEXT_PUBLIC_ env vars are embedded in the client bundle. Reading them in server code is misleading and may over-expose values. |
| NEXT_008 | `image_missing_alt` | 🟡 MEDIUM | Next.js <Image> components must include an `alt` prop for accessibility and SEO. |
| NEXT_009 | `missing_revalidate` | 🟡 MEDIUM | Server mutations (create/update/delete) should call revalidatePath or revalidateTag to bust the Next.js cache. |
| NEXT_010 | `usesearchparams_no_suspense` | 🟠 HIGH | `useSearchParams()` must be wrapped in a Suspense boundary or it causes a build-time error in Next.js. |
| NEXT_011 | `fetch_no_cache_directive` | 🔵 LOW | Next.js extends fetch with cache control. Fetches in Server Components without explicit cache directives use the default behavior. |
| NEXT_012 | `server_only_in_client` | 🔴 BLOCKER | Importing 'server-only' packages in Client Components leaks server logic to the browser bundle. |
| NEXT_013 | `missing_loading_boundary` | ⚪ TECH_DEBT | Route segments with async data fetching should have a `loading.tsx` for streaming UX. |
| NEXT_014 | `missing_error_page` | ⚪ TECH_DEBT | App Router route segments without `error.tsx` show a generic unhandled error to users. |
| NEXT_015 | `fetch_in_client_component` | 🟡 MEDIUM | Direct fetch() calls in Client Components bypass Next.js caching, run in the browser, and expose API logic. |
| NEXT_016 | `use_server_top_level_only` | 🟠 HIGH | 'use server' directive must appear at the top of a file or function body — not mid-file. |
| NEXT_017 | `streaming_suspense_missing` | 🟡 MEDIUM | Async Server Components that fetch data should be wrapped in Suspense to enable streaming. |
| NEXT_018 | `metadata_static_missing` | 🔵 LOW | Pages without exported metadata or generateMetadata miss SEO — title, description, og:image are indexed by search engines. |
| NEXT_019 | `client_component_at_root` | 🟡 MEDIUM | Marking an entire page or layout 'use client' when only a small part needs interactivity defeats Server Component benefits. |
| NEXT_020 | `fetch_no_cache` | 🔵 LOW | fetch() in Server Components without a cache option opts into Next.js's default caching which may be stale. |
| NEXT_021 | `error_boundary_missing_page` | 🟠 HIGH | Next.js App Router pages without an error.tsx sibling have no error boundary — unhandled errors crash the entire segment. |
| NEXT_022 | `parallel_routes_loading` | 🔵 LOW | Next.js parallel routes (@slot) should have loading.tsx to avoid blocking the entire layout. |
| NEXT_023 | `redirect_in_server_action` | 🟠 HIGH | redirect() from 'next/navigation' called inside try/catch in a Server Action is swallowed — it throws internally. |
| NEXT_024 | `cookies_in_server_component` | 🔵 LOW | cookies() from 'next/headers' makes a Server Component dynamic — use it only when you need per-request values. |
| NEXT_025 | `image_component_missing` | 🟡 MEDIUM | Using <img> instead of Next.js <Image> skips automatic WebP conversion, lazy loading, and size optimization. |
| NEXT_026 | `link_prefetch_opt_out` | 🔵 LOW | Setting prefetch={false} on <Link> disables route prefetching — use sparingly and only for heavyweight routes. |
| NEXT_027 | `server_action_no_revalidate` | 🟠 HIGH | Server Actions that mutate data should call revalidatePath or revalidateTag to clear stale cache. |
| NEXT_028 | `generate_static_params_missing` | 🔵 LOW | Dynamic routes ([slug]) without generateStaticParams are always server-rendered — missing the SSG optimization. |
| NEXT_029 | `middleware_response_clone` | 🟠 HIGH | Cloning or consuming the request body in Next.js Middleware is not supported in Edge Runtime. |
| NEXT_030 | `use_client_on_layout` | 🟠 HIGH | Marking a layout.tsx as 'use client' prevents Server Component children from fetching data on the server. |
| NEXT_031 | `searchparams_missing_type` | 🟡 MEDIUM | Accessing searchParams without type-safe parsing allows injecting unexpected values through the URL. |
| NEXT_032 | `not_found_trigger` | 🟡 MEDIUM | Returning null or an empty component when an entity is not found should call notFound() instead. |
| NEXT_033 | `dynamic_config_missing` | 🔵 LOW | Pages that call dynamic functions (headers, cookies) without 'export const dynamic' may behave differently in production. |
| NEXT_034 | `api_route_in_app_dir` | 🔵 LOW | Using pages/api/ routes alongside App Router is fine, but Route Handlers (app/api/) are preferred for new routes. |
| NEXT_035 | `loading_ui_granularity` | 🔵 LOW | A single loading.tsx for an entire segment is less optimal than Suspense boundaries around individual data-fetching components. |
| NEXT_036 | `form_action_vs_server_action` | 🔵 LOW | HTML <form action="/api/..."> submits as a full page reload. Use Server Actions for progressive enhancement. |
| NEXT_037 | `font_optimization_missing` | 🟡 MEDIUM | Importing fonts from Google Fonts CDN directly bypasses Next.js font optimization (no layout shift, self-hosting). |
| NEXT_038 | `next_middleware_only_auth` | 🔴 BLOCKER | Authentication enforced only in Next.js middleware — bypassable via x-middleware-subrequest header (CVE-2025-29927, CVSS 9.1). |
| NEXT_039 | `next_middleware_subrequest_not_stripped` | 🔴 BLOCKER | x-middleware-subrequest header not stripped at edge/proxy — CVE-2025-29927 bypass. |
| NEXT_040 | `next_no_security_headers` | 🟠 HIGH | next.config has no security headers — missing X-Frame-Options, HSTS, X-Content-Type-Options. |
| NEXT_041 | `next_server_action_no_csrf` | 🟠 HIGH | Next.js Server Action exposed without CSRF validation. |
| NEXT_042 | `next_revalidate_unprotected` | 🟠 HIGH | revalidatePath or revalidateTag callable from an unauthenticated route. |
| NEXT_043 | `next_route_no_content_type_check` | 🟡 MEDIUM | POST route handler processes body without validating Content-Type header. |
| NEXT_044 | `next_dynamic_route_no_type_coercion` | 🟡 MEDIUM | Dynamic route param used as number/ID without explicit type coercion and validation. |
| NEXT_045 | `next_server_component_cookie_no_boundary` | 🟡 MEDIUM | Server Component reads cookies() without error boundary — unhandled cookie access errors crash the component. |
| NEXT_046 | `next_image_no_domains` | 🟡 MEDIUM | Next.js Image component loads from external src without configuring allowed domains. |
| NEXT_047 | `next_env_public_secret` | 🔴 BLOCKER | Secret or private key stored in NEXT_PUBLIC_ environment variable — exposed to client bundle. |
| AI_001 | `ai_key_in_client` | 🔴 BLOCKER | LLM API keys (OpenAI, Anthropic, Gemini, etc.) must never be loaded in Client Components or browser-visible code. |
| AI_002 | `prompt_injection_risk` | 🟠 HIGH | User input passed directly to LLM messages without sanitization enables prompt injection attacks. |
| AI_003 | `llm_response_as_html` | 🔴 BLOCKER | Rendering raw LLM output as HTML (innerHTML, dangerouslySetInnerHTML) enables XSS via prompt injection. |
| AI_004 | `llm_no_max_tokens` | 🟡 MEDIUM | LLM API calls without max_tokens/maxTokens limits expose you to runaway costs from large completions. |
| AI_005 | `llm_no_timeout` | 🟡 MEDIUM | LLM API calls without a timeout or AbortController signal can hang indefinitely on model overload. |
| AI_006 | `ai_no_rate_limit` | 🟠 HIGH | AI-powered endpoints without rate limiting expose you to cost amplification attacks. |
| AI_007 | `pii_to_external_llm` | 🟠 HIGH | Sending PII (emails, names, SSNs, phone numbers) to external LLM APIs violates data privacy obligations. |
| AI_008 | `streaming_no_error_handler` | 🟡 MEDIUM | LLM streaming responses without error handling leave partial streams unresolved on network errors. |
| AI_009 | `llm_json_parse_unsafe` | 🟠 HIGH | JSON.parse on LLM completion output without try-catch will crash when the model returns non-JSON text. |
| AI_010 | `ai_tool_no_validation` | 🟠 HIGH | AI tool/function call arguments must be validated with a schema before use — the model can hallucinate invalid args. |
| AI_011 | `system_prompt_hardcoded` | 🔵 LOW | System prompts hardcoded in source files are hard to update, version, and audit. |
| AI_012 | `ai_feature_no_fallback` | 🟡 MEDIUM | AI-powered features without a fallback degrade entirely when the LLM API is unavailable. |
| AI_013 | `prompt_injection_user_input` | 🔴 BLOCKER | Interpolating unsanitized user input directly into a system prompt enables prompt injection attacks. |
| AI_014 | `llm_token_limit_unchecked` | 🟠 HIGH | Passing unchecked user content to an LLM can exceed context limits, causing errors or truncated responses. |
| AI_015 | `streaming_not_used` | 🟡 MEDIUM | LLM completions for UI should stream responses to give users immediate feedback instead of waiting for the full response. |
| AI_016 | `ai_output_unvalidated` | 🔴 BLOCKER | LLM output used directly in code execution, SQL queries, or HTML without validation is dangerous. |
| AI_017 | `ai_cost_no_budget` | 🟠 HIGH | LLM API calls without cost budgets or usage tracking can result in runaway cloud bills. |
| AI_018 | `agent_loop_no_max_iterations` | 🟠 HIGH | Agentic LLM loops without a maximum iteration limit can run indefinitely and drain API credits. |
| AI_019 | `system_prompt_leaked` | 🟠 HIGH | System prompts and internal AI instructions exposed via API responses or error messages. |
| AI_020 | `no_content_moderation` | 🟠 HIGH | User-facing AI features without content moderation can generate or relay harmful content. |
| AI_021 | `tool_call_no_confirmation` | 🟠 HIGH | Agentic tool calls that modify state (create, delete, send) should require human-in-the-loop confirmation for high-stakes actions. |
| AI_022 | `rag_no_citation` | 🟡 MEDIUM | RAG-powered answers should cite source documents so users can verify accuracy and avoid hallucination trust. |
| AI_023 | `embedding_pii` | 🟠 HIGH | Embedding documents containing PII in a vector database creates a hard-to-audit data store. |
| AI_024 | `model_hardcoded` | 🔵 LOW | Hardcoding a specific LLM model string prevents easy upgrades and A/B testing. |
| AI_025 | `prompt_version_untracked` | 🟡 MEDIUM | Production prompts without versioning make it impossible to know which prompt was active when a regression occurred. |
| AI_026 | `ai_retry_no_backoff` | 🟡 MEDIUM | LLM API calls without retry/backoff logic will fail immediately on transient rate limit errors. |
| AI_027 | `ai_output_schema_missing` | 🟠 HIGH | LLM outputs used as structured data without schema validation risk runtime errors when the model deviates from expected format. |
| AI_028 | `ai_output_rendered_as_html` | 🔴 BLOCKER | LLM output rendered directly as HTML without sanitization — XSS via AI response. |
| AI_029 | `ai_system_prompt_user_concatenation` | 🔴 BLOCKER | System prompt concatenated directly with user input — adversarial prompt can override system instructions. |
| AI_030 | `ai_output_used_as_command` | 🔴 BLOCKER | LLM output used directly as a shell command or SQL query without validation — command/SQL injection via AI. |
| AI_031 | `ai_training_data_no_sanitization` | 🟠 HIGH | Training data pipeline accepts user-contributed content without sanitization — data poisoning risk (OWASP LLM04). |
| AI_032 | `ai_citation_url_unvalidated` | 🟠 HIGH | AI-generated citation URLs displayed to user without validation — hallucinated or malicious link risk (OWASP LLM09). |
| AI_033 | `ai_system_prompt_client_exposed` | 🟠 HIGH | System prompt stored or transmitted in a client-accessible location — prompt leakage (OWASP LLM07). |
| AI_034 | `ai_no_content_filter` | 🟠 HIGH | LLM response returned to user without content moderation filter — harmful output risk. |
| AI_035 | `ai_generated_code_auto_executed` | 🟠 HIGH | AI-generated code snippets executed without human review gate — supply chain and code injection risk. |
| AI_036 | `ai_hallucination_no_grounding` | 🟡 MEDIUM | LLM used for factual queries without retrieval grounding — misinformation risk (OWASP LLM09). |
| AI_037 | `ai_model_not_pinned` | 🟡 MEDIUM | LLM model string not pinned to a specific version — silent behavioral drift on model updates. |
| PERF_001 | `sync_fs_in_handler` | 🟠 HIGH | `fs.readFileSync` and `fs.writeFileSync` in async request handlers block the Node.js event loop. |
| PERF_002 | `regex_in_function_body` | 🔵 LOW | Regex literals created inside function bodies are recompiled on every call. Move to module scope. |
| PERF_003 | `n_plus_one_query` | 🟠 HIGH | Database query inside a loop causes N+1 queries — one per iteration instead of one batched query. |
| PERF_004 | `select_star` | 🟡 MEDIUM | `SELECT *` fetches all columns including unused ones, wasting bandwidth, memory, and preventing index-only scans. |
| PERF_005 | `large_bundle_import` | 🔵 LOW | Importing an entire package when only one function is needed increases bundle size unnecessarily. |
| PERF_006 | `missing_pagination` | 🟡 MEDIUM | List queries without LIMIT/take/pagination return unbounded result sets that grow with data volume. |
| PERF_007 | `json_in_loop` | 🔵 LOW | `JSON.stringify` or `JSON.parse` inside a loop reserializes data on every iteration — compute once outside. |
| PERF_008 | `missing_db_index` | 🟡 MEDIUM | Querying a column without an index causes a full table scan on every request. |
| A11Y_001 | `img_missing_alt` | 🟠 HIGH | <img> elements must have an `alt` attribute for screen readers and SEO. |
| A11Y_002 | `click_on_noninteractive` | 🟠 HIGH | onClick on non-interactive elements (div, span, p) is inaccessible to keyboard and screen reader users. |
| A11Y_003 | `empty_aria_label` | 🟠 HIGH | aria-label with an empty string provides no accessible name — use a meaningful description or remove it. |
| A11Y_004 | `autofocus_attribute` | 🔵 LOW | autoFocus moves focus on mount without warning, disorienting screen reader and keyboard users. |
| A11Y_005 | `positive_tabindex` | 🟡 MEDIUM | tabIndex > 0 disrupts the natural focus order and is almost always a mistake. |
| A11Y_006 | `form_input_no_label` | 🟠 HIGH | Form inputs without an associated label are inaccessible to screen reader users. |
| A11Y_007 | `link_no_descriptive_text` | 🟡 MEDIUM | Links with text "click here", "read more", or "learn more" provide no context out of screen reader focus. |
| A11Y_008 | `missing_focus_visible` | 🟠 HIGH | Removing focus outlines without providing an alternative makes keyboard navigation invisible. |
| PERF_009 | `bundle_size_moment` | 🟡 MEDIUM | moment.js adds 67KB to the bundle. Migrate to date-fns or dayjs. |
| PERF_010 | `web_vitals_lcp` | 🟡 MEDIUM | Above-the-fold images without priority/preload delay Largest Contentful Paint (LCP) — a Core Web Vital. |
| PERF_011 | `virtualization_missing` | 🟠 HIGH | Rendering large lists (100+ items) without virtualization causes DOM bloat and scroll jank. |
| PERF_012 | `css_in_js_runtime` | 🟡 MEDIUM | Runtime CSS-in-JS (styled-components, emotion) generates styles on every render — prefer Tailwind or CSS modules. |
| PERF_013 | `unoptimized_regex` | 🟡 MEDIUM | Complex regex compiled inside a loop or function body wastes CPU recompiling on every call. |
| PERF_014 | `json_parse_large` | 🟡 MEDIUM | JSON.parse() on large strings blocks the main thread — use streaming or a Web Worker for large payloads. |
| PERF_015 | `event_listener_passive` | 🟡 MEDIUM | Scroll and touch event listeners without { passive: true } block the browser's compositor thread, causing scroll jank. |
| PERF_016 | `intersection_observer_missing` | 🔵 LOW | Using scroll listeners to detect element visibility should use IntersectionObserver instead. |
| PERF_017 | `object_spread_in_render` | 🔵 LOW | Creating new objects with spread ({ ...obj, key: val }) inside render/JSX props triggers unnecessary re-renders. |
| PERF_018 | `unused_dependency_in_package` | 🔵 LOW | Dependencies listed in package.json but not imported in any source file add install time and attack surface. |
| PERF_019 | `waterfall_data_fetch` | 🟡 MEDIUM | Sequential awaits for independent data sources create a waterfall — fetch them in parallel with Promise.all. |
| PERF_020 | `ssr_heavy_computation` | 🟠 HIGH | CPU-intensive computations in Server Components block the response for all concurrent requests. |
| PERF_021 | `prefetch_on_hover` | 🔵 LOW | Preloading route data on route click instead of hover means the user waits during transition. |
| PERF_022 | `layout_thrashing` | 🟠 HIGH | Interleaving reads (getBoundingClientRect) and writes (style.x = ...) in a loop causes layout thrashing. |
| PERF_023 | `service_worker_missing` | 🔵 LOW | Production web apps without a Service Worker miss offline support and asset caching benefits. |
| DB_001 | `drop_table_migration` | 🔴 BLOCKER | `DROP TABLE` in a migration permanently destroys data and is unrecoverable without a backup. |
| DB_002 | `plaintext_password_storage` | 🔴 BLOCKER | Storing passwords in plaintext or with reversible encoding is a critical security vulnerability. |
| DB_003 | `missing_transaction` | 🟠 HIGH | Multi-step writes without a transaction leave the database in a partially-updated state if any step fails. |
| DB_004 | `soft_delete_no_filter` | 🟡 MEDIUM | Querying a soft-delete table without filtering deleted_at returns deleted records as if they were active. |
| DB_005 | `raw_sql_injection` | 🔴 BLOCKER | SQL constructed with template literals and user input is vulnerable to SQL injection. |
| DB_006 | `unlimited_query_result` | 🟡 MEDIUM | Queries returning all rows from a table without LIMIT will degrade as data grows. |
| DB_007 | `migration_no_rollback` | 🔵 LOW | Migrations without a rollback (down migration) cannot be reverted safely in production incidents. |
| DB_008 | `sensitive_data_logged` | 🟠 HIGH | Logging database rows that contain passwords, tokens, or PII creates audit and compliance exposure. |
| API_001 | `error_with_200_status` | 🟠 HIGH | Returning HTTP 200 for error responses breaks API contracts — clients cannot detect errors. |
| API_002 | `sensitive_data_in_query_param` | 🟠 HIGH | Sensitive data in URL query parameters is logged in server access logs, browser history, and referrer headers. |
| API_003 | `missing_request_validation` | 🟠 HIGH | API route handlers that read request body or params without schema validation trust unverified client input. |
| API_004 | `password_in_api_response` | 🔴 BLOCKER | API responses that include the password hash field expose sensitive data to API consumers. |
| API_005 | `cors_dynamic_no_allowlist` | 🟠 HIGH | Setting CORS `origin` to a dynamic request value without an allowlist allows any domain to make credentialed requests. |
| API_006 | `unlimited_file_upload` | 🟠 HIGH | File upload endpoints without size limits allow denial-of-service via large file uploads. |
| API_007 | `missing_idempotency` | 🟡 MEDIUM | Non-idempotent POST endpoints for payments or orders without idempotency key support may cause duplicate charges on retry. |
| API_008 | `api_key_in_client_request` | 🔴 BLOCKER | Making API requests with secret keys from client-side code exposes the key to anyone who inspects network traffic. |
| DB_009 | `n_plus_one_query` | 🟠 HIGH | N+1 query pattern: fetching a list then querying each item individually inside a loop. |
| DB_010 | `prisma_missing_fk_index` | 🟠 HIGH | Prisma schema with a foreign key field but no @@index causes full table scans on related-record lookups. |
| DB_011 | `select_star_prisma` | 🔵 LOW | Selecting all fields with findMany() when only a subset is needed sends excess data over the wire. |
| DB_012 | `transaction_missing` | 🟠 HIGH | Multiple related database writes not wrapped in a transaction risk partial failures leaving data inconsistent. |
| DB_013 | `soft_delete_missing` | 🟡 MEDIUM | Hard-deleting records permanently destroys data — implement soft delete with a deletedAt timestamp. |
| DB_014 | `connection_pool_exhaust` | 🔴 BLOCKER | Creating a new database connection per request instead of using a singleton connection pool will exhaust connections. |
| DB_015 | `migration_without_rollback` | 🟡 MEDIUM | Migrations without a corresponding down/rollback script make production incidents harder to recover from. |
| DB_016 | `query_timeout_missing` | 🟠 HIGH | Database queries without a timeout can block indefinitely, exhausting the connection pool. |
| DB_017 | `pagination_missing` | 🟠 HIGH | Fetching all records without LIMIT/take causes slow queries and huge memory usage as data grows. |
| DB_018 | `optimistic_lock_missing` | 🟡 MEDIUM | Concurrent updates to the same record without optimistic locking cause lost updates. |
| DB_019 | `seed_data_in_migration` | 🟡 MEDIUM | Inserting seed/test data in migrations couples environment-specific data with schema changes. |
| DB_020 | `raw_sql_prisma` | 🟠 HIGH | prisma.$queryRaw with template literals bypasses type safety and may allow SQL injection. |
| DB_021 | `db_call_in_middleware` | 🔴 BLOCKER | Database calls in Next.js middleware run on the Edge Runtime which doesn't support standard TCP connections. |
| DB_022 | `cascade_delete_risk` | 🟠 HIGH | onDelete: Cascade on a parent relation can silently delete thousands of child records. |
| DB_023 | `db_enum_vs_string` | 🔵 LOW | Using String instead of a database enum for finite-state fields loses type safety and allows invalid values. |
| DB_024 | `db_balance_update_no_transaction` | 🔴 BLOCKER | Balance or inventory updated outside a transaction — concurrent requests can produce incorrect totals (TOCTOU). |
| DB_025 | `db_find_then_update_toctou` | 🟠 HIGH | `findFirst` + `update` pattern without `$transaction` — classic TOCTOU race condition. |
| DB_026 | `db_concurrent_upsert_no_unique` | 🟠 HIGH | Concurrent `upsert` calls can create duplicate records if no unique constraint exists on the target field. |
| DB_027 | `db_missing_idempotency_key` | 🟠 HIGH | Mutating API route has no idempotency key — double-submit creates duplicate records. |
| DB_028 | `db_abort_controller_missing` | 🟡 MEDIUM | Sequential async fetch chain without AbortController — stale responses from cancelled requests corrupt state. |
| DB_029 | `db_sequential_await_in_loop` | 🟡 MEDIUM | Sequential `await` in a loop instead of `Promise.all` — unnecessary serialization and potential race-free alternative. |
| DB_030 | `db_ticket_reservation_no_lock` | 🟠 HIGH | Ticket, seat, or appointment reservation without pessimistic lock — overselling under concurrent requests. |
| DB_031 | `db_shared_state_no_atomicity` | 🟡 MEDIUM | Event handler or callback updates shared mutable state without atomicity — lost update under concurrent execution. |
| QUAL_003 | `todo_in_production` | 🔵 LOW | TODO/FIXME/HACK comments in production code represent unresolved work that should be a tracked issue. |
| QUAL_004 | `magic_number` | 🔵 LOW | Unexplained numeric literals make intent invisible and create maintenance hazards. |
| QUAL_005 | `commented_out_code` | 🔵 LOW | Commented-out code blocks should be deleted — version control preserves history. |
| QUAL_006 | `long_function` | 🔵 LOW | Functions over 80 lines are hard to test, understand, and maintain — break them into focused sub-functions. |
| QUAL_007 | `console_log_production` | 🟡 MEDIUM | `console.log` in production source files leaks internal state and adds noise to observability pipelines. |
| QUAL_008 | `hardcoded_env_url` | 🔵 LOW | Base URLs hardcoded in source should be environment variables so they can change between environments. |
| TEST_002 | `test_only_committed` | 🟠 HIGH | `it.only` / `test.only` / `describe.only` committed to the repo skips all other tests in CI. |
| TEST_003 | `test_skip_no_reason` | 🟡 MEDIUM | `it.skip` / `test.skip` without a comment or issue reference hides forgotten disabled tests. |
| TEST_004 | `empty_test_body` | 🟠 HIGH | Tests with empty bodies always pass — they provide false coverage confidence. |
| TEST_005 | `no_assertions` | 🟠 HIGH | Tests with no `expect()` calls pass without validating any behavior. |
| TEST_006 | `nondeterministic_test_fixture` | 🟡 MEDIUM | `Math.random()` or `Date.now()` in test fixtures produce different data on every run — tests become flaky. |
| TEST_007 | `snapshot_only_test` | 🔵 LOW | Tests that only assert a snapshot do not describe intent and break on any render change. |
| TEST_008 | `console_in_test` | 🔵 LOW | `console.log` in tests adds noise to test output and hides the signal from failures. |
| GIT_001 | `merge_conflict_markers` | 🔴 BLOCKER | Merge conflict markers committed to a file indicate an incomplete conflict resolution. |
| GIT_002 | `env_file_committed` | 🔴 BLOCKER | `.env` files committed to source control expose secrets to everyone with repository access. |
| GIT_003 | `large_binary_committed` | 🟡 MEDIUM | Binary files over 1MB committed to git inflate repository size permanently — git history cannot be efficiently purged. |
| GIT_004 | `generated_file_in_source` | 🔵 LOW | Generated or compiled files committed alongside source code must be regenerated manually when out of date. |
| DEPS_001 | `require_in_esm` | 🟠 HIGH | `require()` in an ESM module fails at runtime — use `import` instead. |
| DEPS_002 | `node_modules_import` | 🟡 MEDIUM | Importing directly from `node_modules/` path is fragile and breaks with package manager changes. |
| DEPS_003 | `barrel_import_server_hot_path` | 🔵 LOW | Barrel imports (index.ts re-exports) in server hot paths import every export even if only one is needed. |
| ZOD_001 | `zod_parse_no_catch` | 🟠 HIGH | z.parse() throws a ZodError on invalid input. Uncaught, it becomes an unhandled 500. Use .safeParse() or wrap in try/catch. |
| ZOD_002 | `zod_any_type` | 🟡 MEDIUM | z.any() defeats the purpose of Zod validation. Use a specific schema or z.unknown() with type narrowing. |
| ZOD_003 | `zod_string_max_missing` | 🟡 MEDIUM | String fields without .max() are an unbounded-input DoS risk. Always cap user-supplied strings. |
| ZOD_004 | `zod_passthrough_api` | 🟠 HIGH | .passthrough() in API input schemas silently forwards unknown fields to downstream systems. |
| ZOD_005 | `zod_refine_no_message` | 🔵 LOW | .refine() without a custom error message produces cryptic "Invalid input" errors in API responses. |
| ZOD_006 | `zod_schema_in_component` | 🟡 MEDIUM | Defining Zod schemas inside React components recreates them on every render, wasting CPU and breaking referential equality. |
| ZOD_007 | `zod_email_no_trim` | 🟡 MEDIUM | Email validation without .trim() passes "  user@example.com  " as valid, causing login mismatches. |
| ZOD_008 | `zod_password_no_min` | 🟠 HIGH | Password fields without a minimum length allow trivially weak passwords like "a". |
| ZOD_009 | `zod_url_no_protocol` | 🟠 HIGH | URL fields without protocol enforcement accept javascript:// and data: URIs, creating XSS vectors. |
| ZOD_010 | `zod_array_no_maxlength` | 🟡 MEDIUM | Arrays without .max() allow unbounded-size payloads — memory exhaustion DoS. |
| ZOD_011 | `zod_number_no_max` | 🟠 HIGH | Number fields used for pagination (limit, take, pageSize) without .max() allow full-table reads. |
| ZOD_012 | `zod_uuid_field_missing` | 🟡 MEDIUM | ID fields typed as z.string() instead of z.string().uuid() allow any string to be passed as an identifier. |
| ZOD_013 | `zod_no_infer` | 🔵 LOW | Defining TypeScript types separately from Zod schemas creates drift. Use z.infer<typeof Schema>. |
| ZOD_014 | `zod_enum_not_const` | 🔵 LOW | Inline z.enum(["a","b","c"]) literals should be extracted to a const tuple for reuse in TypeScript. |
| ZOD_015 | `zod_object_strict_missing` | 🟡 MEDIUM | Input schemas that process sensitive operations should use .strict() to reject unknown fields. |
| ZOD_016 | `zod_number_not_int` | 🔵 LOW | Count/quantity/pagination fields should use .int() to reject 1.5 or NaN. |
| ZOD_017 | `zod_coerce_boolean_string` | 🟠 HIGH | z.coerce.boolean() converts any truthy string including "false" to true. Use explicit transformation instead. |
| ZOD_018 | `zod_date_no_range` | 🔵 LOW | Date fields without min/max constraints accept epoch dates or dates far in the future, causing data integrity issues. |
| ZOD_019 | `zod_price_negative_allowed` | 🟠 HIGH | Price/amount fields without .positive() or .min(0) allow negative values that break billing logic. |
| ZOD_020 | `zod_unsafe_html_string` | 🟡 MEDIUM | String fields named "content", "body", or "html" without a sanitization note are potential stored-XSS vectors. |
| ZOD_021 | `zod_transform_loses_type` | 🔵 LOW | .transform() that returns a different type changes the inferred schema output type, causing type surprises downstream. |
| ZOD_022 | `zod_lazy_missing` | 🟠 HIGH | Self-referential schemas without z.lazy() cause infinite recursion at module load time. |
| ZOD_023 | `zod_optional_with_default` | 🔵 LOW | .optional().default(X) chains are confusing — .default(X) already makes the field optional. |
| ZOD_024 | `zod_ip_missing_validation` | 🟡 MEDIUM | IP address fields typed as plain z.string() allow any string. Use .ip() for validation. |
| ZOD_025 | `zod_superrefine_no_ctx` | 🔵 LOW | .superRefine() that calls ctx.addIssue correctly is preferred over plain .refine() for multiple error scenarios. |
| ZOD_026 | `zod_discriminated_union_opportunity` | 🔵 LOW | z.union() where all variants share a discriminant field should use z.discriminatedUnion() for better errors and performance. |
| ZOD_027 | `zod_phone_no_validation` | 🟡 MEDIUM | Phone number fields without format validation accept any string including script tags. |
| ZOD_028 | `zod_credit_card_in_schema` | 🔴 BLOCKER | Schemas accepting credit card numbers must comply with PCI DSS — storing raw PANs requires certification. |
| ZOD_029 | `zod_regex_no_anchors` | 🟠 HIGH | Regex validators without ^ and $ anchors match anywhere in the string, bypassing intended validation. |
| ZOD_030 | `zod_ssn_in_schema` | 🔴 BLOCKER | Schemas accepting Social Security Numbers (SSNs) are subject to CCPA/GDPR special-category data requirements. |
| TRPC_001 | `trpc_no_input_validation` | 🟠 HIGH | tRPC procedures without .input() validation accept any payload — a type-unsafe API boundary. |
| TRPC_002 | `trpc_throw_non_trpc_error` | 🟠 HIGH | Throwing a plain Error instead of TRPCError in a procedure exposes the full error message to the client. |
| TRPC_003 | `trpc_unprotected_mutation` | 🟠 HIGH | Mutations that modify data using publicProcedure should be audited — they require no authentication. |
| TRPC_004 | `trpc_console_in_procedure` | 🟡 MEDIUM | console.log inside tRPC procedures bypasses structured logging and will leak sensitive data in production. |
| TRPC_005 | `trpc_input_spread_to_db` | 🟠 HIGH | Spreading tRPC input directly into database operations is a mass-assignment vulnerability. |
| TRPC_006 | `trpc_ctx_passed_to_service` | 🔵 LOW | Passing the full tRPC ctx to service functions couples your business logic to the tRPC request context. |
| TRPC_007 | `trpc_large_query_no_limit` | 🟠 HIGH | tRPC query procedures that fetch lists without a limit parameter return unbounded results. |
| TRPC_008 | `trpc_no_output_schema` | 🟡 MEDIUM | tRPC procedures without .output() validation can leak fields added to the database model. |
| TRPC_009 | `trpc_any_context` | 🟡 MEDIUM | Using any or unknown for the tRPC context type removes all type safety in procedures. |
| TRPC_010 | `trpc_missing_not_found` | 🟡 MEDIUM | Queries that can return null should throw TRPCError NOT_FOUND instead of returning null to clients. |
| TRPC_011 | `trpc_sequential_awaits` | 🔵 LOW | Sequential independent await calls in tRPC procedures should be parallelized with Promise.all(). |
| TRPC_012 | `trpc_no_rate_limit` | 🟠 HIGH | Public tRPC endpoints without rate limiting are vulnerable to abuse and enumeration attacks. |
| TRPC_013 | `trpc_missing_error_boundary` | 🟡 MEDIUM | tRPC onError handler not configured — unhandled errors emit raw stack traces to server logs. |
| TRPC_014 | `trpc_no_transformer` | 🟡 MEDIUM | tRPC without a data transformer (superjson) cannot serialize Date, Map, Set, or undefined correctly. |
| TRPC_015 | `trpc_procedure_too_long` | 🔵 LOW | Procedure resolvers over 50 lines are doing too much — extract business logic into service functions. |
| TRPC_016 | `trpc_cors_wildcard` | 🔴 BLOCKER | tRPC handler with CORS origin: "*" allows any website to call your API with credentials. |
| TRPC_017 | `trpc_sync_io_in_procedure` | 🟠 HIGH | Synchronous file I/O inside tRPC procedures blocks the Node.js event loop. |
| TRPC_018 | `trpc_no_abort_signal` | 🔵 LOW | Long-running tRPC queries should pass the abort signal from the request to cancellable operations. |
| TRPC_019 | `trpc_secret_in_context` | 🟠 HIGH | Storing raw secrets (tokens, keys) on the tRPC context makes them accessible from all procedures. |
| TRPC_020 | `trpc_missing_auth_check` | 🟠 HIGH | Accessing ctx.session.user without a null check will crash when called by an unauthenticated user. |
| TRPC_021 | `trpc_hardcoded_id` | 🟠 HIGH | Hardcoded IDs or user references in procedures create data isolation bugs in multi-tenant systems. |
| TRPC_022 | `trpc_subscription_no_cleanup` | 🟠 HIGH | tRPC subscriptions without a cleanup function leak memory when clients disconnect. |
| TRPC_023 | `trpc_authorization_by_role_string` | 🟠 HIGH | Role-based authorization using raw string comparison is fragile — a typo silently grants or denies access. |
| TRPC_024 | `trpc_missing_pagination_cursor` | 🟡 MEDIUM | Offset-based pagination (skip/offset) breaks at scale — use cursor-based pagination for reliability. |
| TRPC_025 | `trpc_missing_zod_import` | 🔵 LOW | tRPC files importing validation schemas should import directly from "zod" for tree-shaking. |
| PRISMA_001 | `prisma_findmany_no_limit` | 🟠 HIGH | prisma.findMany() without a take limit returns the full table — catastrophic on large datasets. |
| PRISMA_002 | `prisma_n_plus_one` | 🟠 HIGH | Fetching related records inside a loop is an N+1 query — use include or select to eager-load. |
| PRISMA_003 | `prisma_raw_query_injection` | 🔴 BLOCKER | $queryRaw and $executeRaw with template literals are vulnerable to SQL injection if user input is interpolated. |
| PRISMA_004 | `prisma_multi_op_no_transaction` | 🟠 HIGH | Multiple related Prisma writes without a transaction leave the database in a partial state on failure. |
| PRISMA_005 | `prisma_select_star` | 🟡 MEDIUM | Fetching all fields with findMany/findUnique (no select) returns sensitive fields and wastes bandwidth. |
| PRISMA_006 | `prisma_no_client_singleton` | 🟠 HIGH | Instantiating PrismaClient inside a function creates a new connection pool on every call. |
| PRISMA_007 | `prisma_unique_constraint_unhandled` | 🟠 HIGH | Prisma unique constraint violations (P2002) should be caught and returned as 409 Conflict, not 500. |
| PRISMA_008 | `prisma_soft_delete_missing_filter` | 🟠 HIGH | Queries that do not filter deleted_at IS NULL silently return soft-deleted records. |
| PRISMA_009 | `prisma_updatemany_no_where` | 🔴 BLOCKER | updateMany() and deleteMany() without a restrictive where clause affect the entire table. |
| PRISMA_010 | `prisma_count_no_where` | 🟡 MEDIUM | prisma.model.count() without a where clause runs a full-table count — expensive on large tables. |
| PRISMA_011 | `prisma_expose_password_hash` | 🔴 BLOCKER | Queries on the user model without excluding passwordHash risk exposing the hash in API responses. |
| PRISMA_012 | `prisma_transaction_no_timeout` | 🟠 HIGH | Interactive Prisma transactions without a timeout can hold locks indefinitely, causing database gridlock. |
| PRISMA_013 | `prisma_in_array_unbounded` | 🟡 MEDIUM | WHERE IN queries with a potentially large array can exceed database parameter limits or degrade performance. |
| PRISMA_014 | `prisma_cascade_delete_risk` | 🟠 HIGH | Cascading deletes in migrations require review — accidental parent deletion removes all children. |
| PRISMA_015 | `prisma_upsert_race_condition` | 🟠 HIGH | prisma.upsert() without a unique constraint race condition guard can create duplicate records under concurrent load. |
| PRISMA_016 | `prisma_nested_write_depth` | 🔵 LOW | Deeply nested Prisma writes (3+ levels) are hard to reason about and error-prone in transactions. |
| PRISMA_017 | `prisma_missing_index_hint` | 🟡 MEDIUM | Filtering or ordering by non-indexed columns produces full table scans at scale. |
| PRISMA_018 | `prisma_aggregate_without_scope` | 🟠 HIGH | Aggregate queries (sum, avg, count) without a where clause compute across the entire table. |
| PRISMA_019 | `prisma_date_string_comparison` | 🟠 HIGH | Comparing dates as strings in Prisma where clauses produces incorrect results across timezones. |
| PRISMA_020 | `prisma_createMany_ignore_errors` | 🟡 MEDIUM | createMany with skipDuplicates: true silently swallows all insert errors, not just uniqueness. |
| PRISMA_021 | `prisma_raw_migration_risk` | 🟡 MEDIUM | Raw SQL in migrations without a rollback strategy or comment is a deployment risk. |
| PRISMA_022 | `prisma_connect_vs_set` | 🟠 HIGH | Using connect instead of set for many-to-many updates appends — it does not replace. Use set to replace all. |
| PRISMA_023 | `prisma_missing_created_at_filter` | 🔵 LOW | Time-range queries without an upper bound on createdAt can lock up reporting queries on append-heavy tables. |
| PRISMA_024 | `prisma_select_include_conflict` | 🟠 HIGH | Using both select and include in the same Prisma query causes a runtime error. |
| PRISMA_025 | `prisma_orderby_no_index` | 🟡 MEDIUM | Ordering by a column likely missing an index causes full-table sorts on large datasets. |
| PRISMA_026 | `prisma_schema_no_default_id` | 🟠 HIGH | Models without @id or @default(cuid()/uuid()) produce tables without primary keys. |
| PRISMA_027 | `prisma_json_no_type` | 🟡 MEDIUM | Json fields in Prisma have no runtime type — store typed data as relational columns or validate at application layer. |
| PRISMA_028 | `prisma_middleware_no_error_handling` | 🟡 MEDIUM | Prisma middleware without error handling can silently swallow query failures. |
| PRISMA_029 | `prisma_connection_pool_config` | 🟡 MEDIUM | DATABASE_URL without connection pool sizing parameters may default to too many or too few connections. |
| PRISMA_030 | `prisma_enum_not_in_schema` | 🔵 LOW | String literal unions used for status/type fields should be Prisma enums for DB-level constraint enforcement. |
| NODE_001 | `path_traversal` | 🔴 BLOCKER | File path constructed from user input without sanitization is a path traversal vulnerability. |
| NODE_002 | `insecure_random` | 🟠 HIGH | Math.random() is not cryptographically secure — never use it for tokens, IDs, or security decisions. |
| NODE_003 | `sync_fs_in_handler` | 🟠 HIGH | Synchronous filesystem operations inside request handlers block the Node.js event loop. |
| NODE_004 | `prototype_pollution_assign` | 🔴 BLOCKER | Object.assign or spread of untrusted user input to objects with no prototype guard allows prototype pollution. |
| NODE_005 | `child_process_shell_injection` | 🔴 BLOCKER | child_process with shell: true and user input is a command injection vulnerability. |
| NODE_006 | `missing_request_timeout` | 🟠 HIGH | HTTP server or outbound request without a timeout allows stalled connections to exhaust resources. |
| NODE_007 | `tls_verification_disabled` | 🔴 BLOCKER | rejectUnauthorized: false or NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate validation. |
| NODE_008 | `jwt_algorithm_none` | 🔴 BLOCKER | JWT verification without explicit algorithm restriction allows the "none" algorithm attack. |
| NODE_009 | `cookie_no_secure_flags` | 🟠 HIGH | Cookies set without Secure and HttpOnly flags are accessible to JavaScript and transmitted over HTTP. |
| NODE_010 | `stream_no_error_handler` | 🟠 HIGH | Node.js streams without an "error" event handler cause unhandled exceptions that crash the process. |
| NODE_011 | `event_listener_leak` | 🟠 HIGH | Adding event listeners inside request handlers without removing them is a memory leak. |
| NODE_012 | `process_exit_in_handler` | 🟠 HIGH | process.exit() inside a request handler terminates the server for all concurrent users. |
| NODE_013 | `missing_body_size_limit` | 🟠 HIGH | HTTP servers parsing request bodies without a size limit allow unbounded payload DoS. |
| NODE_014 | `open_redirect` | 🟠 HIGH | Redirecting to a user-supplied URL without validation enables phishing attacks. |
| NODE_015 | `yaml_unsafe_load` | 🔴 BLOCKER | yaml.load() (js-yaml) executes JavaScript functions embedded in YAML — use yaml.safeLoad() or yaml.load() with schema. |
| NODE_016 | `regex_denial_of_service` | 🟠 HIGH | Regex patterns with catastrophic backtracking applied to untrusted input cause ReDoS. |
| NODE_017 | `missing_rate_limit` | 🟠 HIGH | Auth endpoints (login, register, password reset) without rate limiting are vulnerable to brute force. |
| NODE_018 | `helmet_missing` | 🟠 HIGH | Express apps without Helmet are missing security headers (CSP, HSTS, X-Frame-Options). |
| NODE_019 | `sql_injection` | 🔴 BLOCKER | String-concatenated SQL queries with user input are vulnerable to SQL injection. |
| NODE_020 | `sensitive_data_logged` | 🟠 HIGH | Logging objects that may contain passwords, tokens, or keys ships secrets to log aggregators. |
| NODE_021 | `missing_cors_config` | 🟠 HIGH | API without explicit CORS configuration defaults to allowing all origins in some frameworks. |
| NODE_022 | `unhandled_promise_rejection` | 🟠 HIGH | Promises without .catch() or try/catch in async functions cause unhandled rejection crashes in Node.js 15+. |
| NODE_023 | `env_secret_hardcoded` | 🔴 BLOCKER | Hardcoded API keys, tokens, or passwords in source files will be committed to git and leaked. |
| NODE_024 | `deprecation_buffer_constructor` | 🟡 MEDIUM | new Buffer() and Buffer() are deprecated — use Buffer.from(), Buffer.alloc(), or Buffer.allocUnsafe(). |
| NODE_025 | `circular_json_stringify` | 🟡 MEDIUM | JSON.stringify() on objects with circular references throws a TypeError that crashes the process. |
| NODE_026 | `missing_env_validation` | 🟡 MEDIUM | Apps that start without validating required environment variables crash at runtime with confusing errors. |
| NODE_027 | `missing_graceful_shutdown` | 🟡 MEDIUM | HTTP servers without graceful shutdown handling drop in-flight requests on SIGTERM. |
| NODE_028 | `crypto_weak_algorithm` | 🟠 HIGH | MD5 and SHA1 are cryptographically broken — never use them for security-sensitive purposes. |
| NODE_029 | `missing_csp_header` | 🟠 HIGH | Web applications without a Content-Security-Policy header are fully exposed to XSS attacks. |
| NODE_030 | `ssrf_unvalidated_url` | 🔴 BLOCKER | Server-side requests to user-supplied URLs without validation allow SSRF attacks against internal infrastructure. |
| ERR_001 | `empty_catch_block` | 🟠 HIGH | Empty catch blocks silently swallow errors, making debugging impossible and hiding production failures. |
| ERR_002 | `catch_and_ignore` | 🟡 MEDIUM | catch blocks that log but do not re-throw or return allow execution to continue in an invalid state. |
| ERR_003 | `error_type_not_checked` | 🟡 MEDIUM | catch (e) without instanceof checks treats all errors the same, including expected cancellation signals. |
| ERR_004 | `throwing_string` | 🟠 HIGH | throw "error message" throws a string, not an Error. String throws cannot be caught with instanceof Error. |
| ERR_005 | `error_message_exposed` | 🟠 HIGH | Returning err.message directly to API clients leaks internal implementation details. |
| ERR_006 | `error_without_context` | 🔵 LOW | Errors re-thrown without additional context lose the original call site information. |
| ERR_007 | `untyped_error_in_ts` | 🟠 HIGH | TypeScript 4.0+ types catch variables as unknown — accessing .message without a type guard throws at runtime. |
| ERR_008 | `async_error_boundary_missing` | 🟠 HIGH | Async event handlers and callbacks that throw produce unhandled rejections without a top-level error boundary. |
| ERR_009 | `error_code_not_set` | 🔵 LOW | Custom Error classes without a code property make programmatic error handling brittle. |
| ERR_010 | `promise_all_no_error_handling` | 🟠 HIGH | Promise.all() without try/catch causes an unhandled rejection if any promise rejects. |
| ERR_011 | `error_in_finally` | 🟠 HIGH | Throwing inside a finally block swallows the original error from the try or catch block. |
| ERR_012 | `non_error_thrown` | 🟡 MEDIUM | Throwing non-Error values (objects, numbers) prevents stack trace capture and instanceof checks. |
| ERR_013 | `error_boundary_missing_react` | 🟠 HIGH | React component trees without an Error Boundary let rendering errors crash the entire app. |
| ERR_014 | `catch_reassign_error` | 🟡 MEDIUM | Reassigning the catch variable shadows the original error, making stack traces inaccessible. |
| ERR_015 | `error_status_mismatch` | 🟠 HIGH | Returning a 200 OK with an error body is misleading — HTTP clients check status codes, not body shape. |
| ERR_016 | `missing_finally_cleanup` | 🟠 HIGH | Resources (connections, file handles, timers) opened in try blocks must be released in finally. |
| ERR_017 | `sentry_capture_missing` | 🟡 MEDIUM | Production apps without error monitoring (Sentry/Datadog) have no visibility into unhandled exceptions. |
| ERR_018 | `validation_error_generic` | 🟡 MEDIUM | Returning generic "Validation failed" without field-level errors forces clients to guess what went wrong. |
| ERR_019 | `error_swallowed_in_map` | 🟡 MEDIUM | Errors thrown inside .map() callbacks may be swallowed or cause partial results depending on the context. |
| ERR_020 | `uncaught_async_iife` | 🟠 HIGH | Immediately-invoked async functions without .catch() produce unhandled promise rejections. |
| ERR_021 | `error_log_level_mismatch` | 🔵 LOW | Using logger.warn() for errors that should cause an alert trains on-call engineers to ignore warnings. |
| ERR_022 | `unchecked_return_value` | 🟡 MEDIUM | Ignoring return values from operations that signal failure through return (not throw) hides errors. |
| ERR_023 | `error_in_constructor` | 🟡 MEDIUM | Async operations in constructors cannot be awaited, hiding initialization errors. |
| ERR_024 | `missing_error_serialization` | 🟡 MEDIUM | Sending Error objects in JSON responses requires explicit serialization — Error.toJSON() is not automatic. |
| ERR_025 | `missing_global_error_handler` | 🟠 HIGH | Express apps without a global error-handling middleware leave unhandled errors returning raw stack traces. |
| IMPORT_001 | `barrel_import_performance` | 🟡 MEDIUM | Importing from barrel files (index.ts) prevents tree-shaking and inflates bundle size. |
| IMPORT_002 | `circular_import` | 🟠 HIGH | Circular imports (A imports B, B imports A) cause initialization order bugs and are a design smell. |
| IMPORT_003 | `import_side_effects` | 🔵 LOW | Side-effect imports (import './polyfill') without comments are confusing to readers and bundlers. |
| IMPORT_004 | `import_star_namespace` | 🟡 MEDIUM | import * as X prevents tree-shaking and makes it unclear which exports are actually used. |
| IMPORT_005 | `server_module_in_client` | 🔴 BLOCKER | Importing server-only modules (node:fs, node:crypto, prisma) in client-side components leaks them to the browser bundle. |
| IMPORT_006 | `dynamic_require_in_esm` | 🟠 HIGH | require() calls in ES modules are not available at runtime unless using a CJS interop shim. |
| IMPORT_007 | `missing_ts_extension` | 🟠 HIGH | Relative imports without .js extension fail in native ESM Node.js environments. |
| IMPORT_008 | `lodash_full_import` | 🟡 MEDIUM | import _ from 'lodash' loads the entire library. Use lodash-es named imports or per-method packages. |
| IMPORT_009 | `moment_import` | 🟡 MEDIUM | moment.js is 67KB minified and unmaintained. Use date-fns or Temporal instead. |
| IMPORT_010 | `client_env_in_server` | 🟡 MEDIUM | NEXT_PUBLIC_ env vars should not be used in server-side code — they expose client-facing values as server config. |
| IMPORT_011 | `test_lib_in_production` | 🟠 HIGH | Test utilities (vitest, jest, msw) imported in non-test production files inflate the bundle. |
| IMPORT_012 | `type_only_import_missing` | 🔵 LOW | Type-only imports without the 'type' keyword include the module at runtime, bloating the bundle. |
| IMPORT_013 | `deep_relative_import` | 🔵 LOW | Deep relative imports (../../../lib/utils) are brittle and break on file moves. |
| IMPORT_014 | `default_export_large_module` | 🔵 LOW | Default exports from large modules cannot be tree-shaken — use named exports for utility modules. |
| IMPORT_015 | `enum_import_increases_bundle` | 🔵 LOW | TypeScript const enums imported across module boundaries don't inline in all bundlers, causing duplicate code. |
| IMPORT_016 | `crypto_browser_incompatible` | 🟠 HIGH | Importing Node.js 'node:crypto' in code that runs in browsers causes build failures or silent bugs. |
| IMPORT_017 | `json_import_untyped` | 🔵 LOW | import data from './file.json' without 'assert { type: "json" }' may fail in strict ESM environments. |
| IMPORT_018 | `react_import_unnecessary` | 🔵 LOW | import React from 'react' is unnecessary with React 17+ JSX transform. |
| IMPORT_019 | `polyfill_import_scope` | 🟡 MEDIUM | Importing polyfills in shared modules pollutes all consumers. Import them only at the app entry point. |
| IMPORT_020 | `unused_import` | 🔵 LOW | Unused imports add noise, increase parse time, and may cause false positives in dependency analyzers. |
| STATE_001 | `zustand_no_selector` | 🟡 MEDIUM | Selecting the entire Zustand store object causes all components to re-render on any state change. |
| STATE_002 | `zustand_missing_immer` | 🟡 MEDIUM | Mutating nested objects directly in Zustand without Immer requires spreading at every level, causing bugs. |
| STATE_003 | `redux_mutating-state` | 🟠 HIGH | Mutating Redux state outside of a createSlice reducer loses Immer's protection and breaks time-travel debugging. |
| STATE_004 | `context_value_unstable` | 🟠 HIGH | Passing an object or array literal as Context value triggers all consumers to re-render on every parent render. |
| STATE_005 | `context_overuse` | 🟡 MEDIUM | Using Context for high-frequency state (UI, form values, search queries) causes cascading re-renders. |
| STATE_006 | `useselector_no-equality` | 🟡 MEDIUM | useSelector without an equality function re-renders on every dispatch, even if the selected value is unchanged. |
| STATE_007 | `atom_in_component` | 🟠 HIGH | Defining Jotai/Recoil atoms inside a component body recreates them on every render, losing state. |
| STATE_008 | `redux_dispatch_in_render` | 🔴 BLOCKER | Dispatching Redux actions during component render (not in useEffect or event handlers) causes infinite loops. |
| STATE_009 | `usestate_complex-object` | 🟡 MEDIUM | useState with a complex object causes full re-renders when any nested value changes. Prefer useReducer or splitting state. |
| STATE_010 | `usereducer_missing-default` | 🟠 HIGH | useReducer switch statements without a default case cause unhandled actions to return undefined. |
| STATE_011 | `zustand_persist_sensitive` | 🔴 BLOCKER | Persisting sensitive data (tokens, passwords) to localStorage via zustand/persist exposes it to XSS. |
| STATE_012 | `global_state_server_component` | 🔴 BLOCKER | Global mutable state (module-level variables) in Next.js Server Components leaks between requests. |
| STATE_013 | `usestate_stale_closure` | 🟠 HIGH | Updating state based on previous value without the functional form causes stale closure bugs. |
| STATE_014 | `local_storage_in_ssr` | 🟠 HIGH | Accessing localStorage in code that runs during SSR throws 'localStorage is not defined' in Node.js. |
| STATE_015 | `redux_toolkit_createasync-unhandled` | 🟡 MEDIUM | createAsyncThunk results not handled in extraReducers leave loading/error state untracked. |
| STATE_016 | `state_sync_to_url-missing` | 🔵 LOW | Searchable or filterable UI state should be synced to the URL to enable sharing and browser back/forward. |
| STATE_017 | `useeffect_state_sync` | 🟡 MEDIUM | Using useEffect to sync two pieces of state is an anti-pattern that causes double renders and timing bugs. |
| STATE_018 | `context_no-display-name` | 🔵 LOW | Unnamed React contexts show as 'Context.Consumer' in DevTools, making debugging difficult. |
| STATE_019 | `server_action_state-revalidation` | 🟠 HIGH | Next.js Server Actions that mutate data without revalidatePath/revalidateTag leave the cache stale. |
| STATE_020 | `zustand_store-per-feature` | 🔵 LOW | One large Zustand store for the entire app causes cross-feature coupling and makes testing harder. |
| FORM_001 | `form_no_validation` | 🟠 HIGH | Form submission handler without input validation allows empty or malformed data to reach the server. |
| FORM_002 | `form_accessibility_label` | 🟠 HIGH | Form inputs without associated labels are inaccessible to screen readers and fail WCAG 2.1 Level A. |
| FORM_003 | `form_inline_onchange` | 🔵 LOW | Defining onChange handlers inline in JSX recreates the function on every render, hurting performance in large forms. |
| FORM_004 | `form_password_no_autocomplete` | 🟡 MEDIUM | Password inputs without autocomplete="current-password" or "new-password" prevent password managers from working. |
| FORM_005 | `form_uncontrolled_then_controlled` | 🟠 HIGH | Switching a React input from uncontrolled to controlled (or vice versa) logs a React error and causes bugs. |
| FORM_006 | `form_reset_missing` | 🔵 LOW | Forms with a clear/cancel button that doesn't reset validation state leave stale error messages visible. |
| FORM_007 | `form_error_display_missing` | 🟡 MEDIUM | Registered form fields without error display leave users without feedback on validation failures. |
| FORM_008 | `form_button_type_missing` | 🟠 HIGH | Buttons inside a <form> without an explicit type='button' default to type='submit', causing accidental submissions. |
| FORM_009 | `form_csrf_missing` | 🔴 BLOCKER | Forms that POST data without CSRF protection are vulnerable to cross-site request forgery attacks. |
| FORM_010 | `form_file_upload_no_validation` | 🟠 HIGH | File upload inputs without type/size validation allow attackers to upload malicious files. |
| FORM_011 | `form_sensitive_in_url` | 🔴 BLOCKER | Submitting forms with GET method sends sensitive data (passwords, tokens) in the URL query string. |
| FORM_012 | `form_rhf_defaultvalues-async` | 🟡 MEDIUM | react-hook-form useForm defaultValues set asynchronously after initialization don't update the form. |
| FORM_013 | `form_autocomplete_off` | 🟡 MEDIUM | autocomplete='off' is ignored by modern browsers for login fields and harms UX by blocking password managers. |
| FORM_014 | `form_loading_state_missing` | 🟡 MEDIUM | Forms without loading state feedback allow double submissions and leave users confused during async operations. |
| FORM_015 | `form_no_aria_invalid` | 🟡 MEDIUM | Form fields with validation errors should communicate the invalid state to assistive technologies via aria-invalid. |
| FORM_016 | `form_number_input_string` | 🔵 LOW | HTML number inputs always return string values — calling parseInt/Number inside onChange is error-prone. |
| FORM_017 | `form_no_error_role` | 🟡 MEDIUM | Error messages displayed conditionally should have role='alert' so screen readers announce them immediately. |
| FORM_018 | `form_watch_performance` | 🟡 MEDIUM | watch() from react-hook-form without field names watches all fields and triggers re-renders on every keystroke. |
| FORM_019 | `form_required_not_communicated` | 🟡 MEDIUM | Required fields indicated only by asterisks (*) without screen-reader-accessible text fail WCAG 3.3.2. |
| FORM_020 | `form_validation_server_only` | 🟡 MEDIUM | Server-side-only validation without client-side feedback forces a round trip for basic errors like empty fields. |
| LOG_001 | `console_log_production` | 🟡 MEDIUM | console.log() in production code leaks implementation details and degrades performance. |
| LOG_002 | `pii_in_logs` | 🔴 BLOCKER | Logging personally identifiable information (PII) violates GDPR/CCPA and creates security exposure. |
| LOG_003 | `secret_in_logs` | 🔴 BLOCKER | Logging API keys, tokens, or passwords exposes secrets to anyone with log access. |
| LOG_004 | `log_level_mismatch` | 🟡 MEDIUM | Logging errors with logger.info() or warnings with logger.debug() makes alert routing and filtering unreliable. |
| LOG_005 | `unstructured_log_message` | 🔵 LOW | String interpolation in log messages (logger.info(`User ${id} failed`)) prevents machine parsing and log indexing. |
| LOG_006 | `log_without_context` | 🟡 MEDIUM | Log messages without contextual identifiers (requestId, userId, traceId) are impossible to correlate across services. |
| LOG_007 | `console_error_swallowed` | 🟠 HIGH | Catching errors and logging only console.error (without rethrowing or tracking) swallows the error from monitoring. |
| LOG_008 | `log_sensitive_request_body` | 🔴 BLOCKER | Logging full request bodies may capture passwords, credit card numbers, or other sensitive POST data. |
| LOG_009 | `log_circular_reference` | 🟡 MEDIUM | Logging complex objects with circular references throws 'Converting circular structure to JSON' errors. |
| LOG_010 | `log_timing_missing` | 🔵 LOW | Long-running operations (DB queries, external API calls) without duration logging make performance debugging guesswork. |
| LOG_011 | `log_in_tight_loop` | 🟠 HIGH | Logging inside tight loops (forEach, map, for) generates enormous log volume and degrades performance. |
| LOG_012 | `log_stack_trace_missing` | 🟠 HIGH | Logging error.message without the error object itself loses the stack trace, making debugging impossible. |
| LOG_013 | `child_logger_missing` | 🔵 LOW | Creating a new logger per function call instead of using child loggers loses inherited context. |
| LOG_014 | `log_level_not_configurable` | 🟡 MEDIUM | Hardcoded log levels (always debug) in production waste resources; log level should be environment-configurable. |
| LOG_015 | `log_http_responses` | 🟡 MEDIUM | Logging full HTTP response bodies may capture large payloads or sensitive data unexpectedly. |
| LOG_016 | `audit_log_missing` | 🟠 HIGH | Destructive operations (delete, update, transfer) without audit logging make incident investigation impossible. |
| LOG_017 | `log_rate_limit_missing` | 🔵 LOW | Logging every occurrence of a high-frequency event (e.g., cache miss per request) can overwhelm log aggregators. |
| LOG_018 | `log_verbosity_in_serverless` | 🟡 MEDIUM | Verbose logging in serverless functions (Lambda, Edge) increases cold start time and per-invocation cost. |
| LOG_019 | `log_missing_service_name` | 🔵 LOW | Logs without a service name field are hard to filter in multi-service deployments. |
| LOG_020 | `log_health_check_noise` | 🔵 LOW | Logging every health check request (/health, /ping) at INFO level creates noise that buries real events. |
| CSS_001 | `tailwind_arbitrary_value_overuse` | 🔵 LOW | Excessive Tailwind arbitrary values (w-[347px]) bypass the design system and make maintenance harder. |
| CSS_002 | `missing_responsive_breakpoint` | 🟡 MEDIUM | Layouts without responsive breakpoints (sm:, md:, lg:) break on mobile or large screens. |
| CSS_003 | `hardcoded_color_value` | 🟡 MEDIUM | Hardcoded hex colors in Tailwind JSX bypass the design system's color tokens and break dark mode. |
| CSS_004 | `inline_style_overuse` | 🔵 LOW | Excessive inline styles (style={{}}) in React components prevent Tailwind's purge/JIT and make UI inconsistent. |
| CSS_005 | `missing_dark_mode` | 🟡 MEDIUM | Components with hardcoded light-theme colors without dark: variants fail in dark mode. |
| CSS_006 | `css_variable_not_used` | 🔵 LOW | Defining CSS custom properties (--color-primary) but using hardcoded values instead defeats the theming system. |
| CSS_007 | `tailwind_class_explosion` | 🔵 LOW | Elements with 15+ Tailwind classes become impossible to review and should be extracted to a component. |
| CSS_008 | `z_index_magic_number` | 🟡 MEDIUM | Hardcoded z-index values (z-9999) without a defined stacking context cause unpredictable layering. |
| CSS_009 | `missing_focus_visible` | 🟠 HIGH | Removing or overriding focus styles (outline-none without focus-visible:) breaks keyboard navigation — WCAG 2.4.7. |
| CSS_010 | `animation_no_reduce_motion` | 🟠 HIGH | CSS animations without prefers-reduced-motion guards cause nausea in users with vestibular disorders — WCAG 2.3.3. |
| CSS_011 | `font_size_too_small` | 🟡 MEDIUM | Text smaller than 12px is unreadable on most screens and fails WCAG 1.4.4 (Resize Text). |
| CSS_012 | `color_contrast_low` | 🟠 HIGH | Light gray text on white backgrounds fails WCAG 1.4.3 contrast ratio requirements (4.5:1 for normal text). |
| CSS_013 | `tailwind_content_missing` | 🟠 HIGH | Files not covered by tailwind.config.js 'content' glob will have their classes purged in production builds. |
| CSS_014 | `css_specificity_war` | 🔵 LOW | Using !important in CSS (or Tailwind's ! prefix) signals a specificity conflict that should be fixed at the source. |
| CSS_015 | `image_no_aspect_ratio` | 🟡 MEDIUM | Images without explicit width/height or aspect-ratio cause cumulative layout shift (CLS) — a Core Web Vital. |
| CSS_016 | `tailwind_dynamic_class` | 🟠 HIGH | Dynamically constructed Tailwind class names (e.g., `bg-${color}-500`) are purged in production builds. |
| CSS_017 | `global_css_overrides` | 🟡 MEDIUM | Global CSS that overrides framework/component styles (* { margin: 0 } style) causes unexpected style leaks. |
| CSS_018 | `print_styles_missing` | 🔵 LOW | Pages without @media print styles print with dark backgrounds, cut-off content, and navigation visible. |
| CSS_019 | `scroll_restoration_missing` | 🔵 LOW | Single-page navigation without scroll restoration leaves users at random scroll positions on back navigation. |
| CSS_020 | `touch_target_too_small` | 🟡 MEDIUM | Interactive elements smaller than 44×44px fail WCAG 2.5.5 and are unreliable for touch users. |
| VIBE_001 | `vibe_csrf_missing` | 🟠 HIGH | POST/PUT/DELETE handlers in AI-generated code often lack CSRF protection — the #1 vibe-coding gap. |
| VIBE_002 | `vibe_ssrf` | 🔴 BLOCKER | AI tools generate fetch(userInput) patterns that are trivially exploitable as SSRF. |
| VIBE_003 | `vibe_no_rate_limit` | 🟠 HIGH | AI-generated API routes almost never include rate limiting — exposing endpoints to brute force and resource exhaustion. |
| VIBE_004 | `vibe_missing_security_headers` | 🟡 MEDIUM | AI-generated Next.js configs skip security headers — leaving apps vulnerable to clickjacking, MIME sniffing, and XSS. |
| VIBE_005 | `vibe_cors_wildcard` | 🟠 HIGH | AI-generated backends frequently use CORS wildcard (`*`) that allows any origin to make credentialed requests. |
| VIBE_006 | `vibe_missing_input_validation` | 🟠 HIGH | AI-generated API routes accept request bodies without schema validation — the primary source of injection and type confusion bugs. |
| VIBE_007 | `vibe_hardcoded_secret` | 🔴 BLOCKER | AI assistants fill in placeholder secrets (API keys, tokens, passwords) during code generation that get committed. |
| VIBE_008 | `vibe_eval_usage` | 🔴 BLOCKER | eval() and new Function() are AI hallucination favorites for "dynamic" code — they allow arbitrary code execution. |
| VIBE_009 | `vibe_sql_template_injection` | 🔴 BLOCKER | AI-generated SQL using template literals with unescaped interpolation is trivially exploitable. |
| VIBE_010 | `vibe_path_traversal` | 🔴 BLOCKER | AI-generated file-serving code using path.join(userInput) enables directory traversal attacks. |
| VIBE_011 | `vibe_unvalidated_redirect` | 🟠 HIGH | AI-generated redirect(searchParams.get("next")) enables open redirect attacks used for phishing. |
| VIBE_012 | `vibe_insecure_cookie` | 🟠 HIGH | AI-generated cookie-setting code omits httpOnly/secure/sameSite attributes — enabling session theft. |
| VIBE_013 | `vibe_weak_random` | 🟠 HIGH | AI tools use Math.random() for tokens, passwords, and session IDs — it is not cryptographically secure. |
| VIBE_014 | `vibe_error_stack_leak` | 🟡 MEDIUM | AI-generated error handlers return raw Error objects or stack traces to the client — leaking internal structure. |
| VIBE_015 | `vibe_no_request_timeout` | 🟡 MEDIUM | AI-generated server-side fetch and DB calls have no timeout — enabling resource exhaustion via slow or hanging requests. |
| VIBE_016 | `vibe_prototype_pollution` | 🟠 HIGH | AI tools generate Object.assign(target, userInput) and spread patterns that enable prototype pollution. |
| VIBE_017 | `vibe_xss_inner_html` | 🔴 BLOCKER | dangerouslySetInnerHTML with user-controlled content — the React XSS vector AI tools consistently generate. |
| VIBE_018 | `vibe_missing_auth_middleware` | 🟠 HIGH | AI-generated Next.js apps frequently have no middleware.ts — meaning protected routes are accessible without a session. |
| VIBE_019 | `vibe_timing_attack` | 🟠 HIGH | String equality comparison for tokens/passwords is vulnerable to timing attacks — use crypto.timingSafeEqual(). |
| VIBE_020 | `vibe_missing_output_encoding` | 🔴 BLOCKER | AI-generated code concatenating user data into HTML strings without encoding enables server-side XSS. |
| VIBE_021 | `vibe_ai_endpoint_no_auth` | 🔴 BLOCKER | AI inference endpoints generated by AI tools almost never have authentication — your LLM costs are exposed to the internet. |
| VIBE_022 | `vibe_prompt_injection_risk` | 🔴 BLOCKER | Concatenating user input directly into LLM system prompts enables prompt injection attacks. |
| VIBE_023 | `vibe_missing_zod_on_env` | 🟡 MEDIUM | AI-generated Next.js apps skip env variable validation — leading to cryptic runtime crashes in production. |
| VIBE_024 | `vibe_insecure_direct_object` | 🔴 BLOCKER | AI-generated CRUD routes use user-supplied IDs without verifying the caller owns the resource — classic IDOR. |
| VIBE_025 | `vibe_llm_response_unvalidated` | 🟠 HIGH | AI-generated code trusts LLM JSON responses without schema validation — causing runtime crashes when the model hallucinates the shape. |
| VIBE_026 | `vibe_rate_limiter_not_applied` | 🔴 BLOCKER | Rate limiter imported or created but not applied to any route handler — AI generates middleware it never wires up. |
| VIBE_027 | `vibe_payment_route_no_rate_limit` | 🔴 BLOCKER | Payment or subscription API route has no rate limiting — financial abuse via rapid repeated requests. |
| VIBE_028 | `vibe_global_rate_limit_only` | 🟠 HIGH | Rate limit applied globally (all users share one counter) — one user can DoS others by exhausting the shared limit. |
| VIBE_029 | `vibe_file_upload_no_limit` | 🟠 HIGH | File upload endpoint has no size or frequency rate limit — storage exhaustion and DoS. |
| VIBE_030 | `vibe_llm_route_no_rate_limit` | 🟠 HIGH | LLM/AI API call route has no rate limiting — financial exposure from unbounded model usage. |
| VIBE_031 | `vibe_rate_limit_wrong_status` | 🟡 MEDIUM | Rate limiter returns 200 OK or 403 Forbidden instead of RFC 6585 429 Too Many Requests. |
| VIBE_032 | `vibe_sms_no_rate_limit` | 🟠 HIGH | OTP send or password reset endpoint has no rate limiting — SMS pumping and reset enumeration. |
| VIBE_033 | `vibe_websocket_auth_missing` | 🔴 BLOCKER | AI-generated code adds REST auth but skips WebSocket upgrade authentication — universal vibe-coding gap. |
| SLOP_001 | `slop_phantom_import` | 🔴 BLOCKER | Import references a package not listed in package.json — may be an AI-hallucinated phantom dependency. |
| SLOP_002 | `slop_undeclared_import` | 🟠 HIGH | Package imported in source code is not declared in package.json — phantom dependency or missing install. |
| SLOP_003 | `slop_suspicious_package_name` | 🟡 MEDIUM | Package name follows patterns common in AI-hallucinated packages (framework + generic suffix). |
| SLOP_004 | `slop_known_phantom_list` | 🔴 BLOCKER | Import matches a package on the documented list of AI-hallucinated package names from security research. |
| SLOP_005 | `slop_ai_comment_import` | 🟡 MEDIUM | Import immediately following an AI-generated code comment — high likelihood of hallucinated package. |
| SLOP_006 | `slop_not_in_lockfile` | 🟠 HIGH | Package imported in source code is absent from the project lockfile — it has never been installed or audited. |
| SLOP_007 | `slop_install_no_exact` | 🟡 MEDIUM | `npm install <package>` without `--save-exact` in scripts or CI — allows version drift in autonomous agent sessions. |
| SLOP_008 | `slop_wildcard_version` | 🟠 HIGH | Package version set to `latest`, `*`, or `x` in package.json — no version locking, exploitable if the package is squatted. |
| SLOP_009 | `slop_typosquat_candidate` | 🔴 BLOCKER | Package name is within edit-distance 2 of a popular npm package — possible typosquatting attack or AI typo. |
| SLOP_010 | `slop_unknown_scope` | 🟡 MEDIUM | Scoped npm package from an organization not in the known-scope list — verify the org is legitimate. |
| SLOP_011 | `slop_python_unpinned` | 🟡 MEDIUM | Python dependency in requirements.txt without an exact version pin — allows malicious upgrades. |
| SLOP_012 | `slop_phantom_install` | 🟠 HIGH | Suspicious package added to package.json but not imported in any changed source file — possible phantom dependency. |
| SLOP_013 | `slop_git_url_dep` | 🟡 MEDIUM | Package.json dependency using a git URL or tarball — bypasses npm audit and version locking. |
| SLOP_014 | `slop_version_in_name` | 🔵 LOW | Package name contains an embedded version number — a common pattern in AI-hallucinated package names. |
| SLOP_015 | `slop_deep_chain_name` | 🟡 MEDIUM | Package name has 4 or more hyphenated segments starting with a framework name — strong AI hallucination signal. |
| PY_001 | `py_eval_exec` | 🔴 BLOCKER | eval() or exec() called with a non-literal argument — remote code execution risk. |
| PY_002 | `py_sql_injection` | 🔴 BLOCKER | SQL query built with f-string or % formatting — SQL injection risk. |
| PY_003 | `py_hardcoded_secret` | 🔴 BLOCKER | Hardcoded secret, API key, or password found in Python source. |
| PY_004 | `py_ssrf` | 🔴 BLOCKER | requests.get/post called with a variable URL — potential SSRF if user-controlled. |
| PY_005 | `py_missing_auth` | 🟠 HIGH | FastAPI or Flask route decorator with no authentication dependency or login_required. |
| PY_006 | `py_shell_injection` | 🔴 BLOCKER | subprocess or os.system called with a dynamic string — shell injection risk. |
| PY_007 | `py_pickle_deserialization` | 🔴 BLOCKER | pickle.loads() or pickle.load() on data that may come from user input. |
| PY_008 | `py_yaml_load_unsafe` | 🟠 HIGH | yaml.load() without a safe Loader — can execute arbitrary Python via !!python/object. |
| PY_009 | `py_path_traversal` | 🔴 BLOCKER | File opened with a path from request/user input without traversal protection. |
| PY_010 | `py_cors_wildcard` | 🟠 HIGH | CORSMiddleware configured with allow_origins=["*"] — permits any origin. |
| PY_011 | `py_no_request_timeout` | 🟡 MEDIUM | requests.get/post with no timeout — server can hang indefinitely on slow upstream. |
| PY_012 | `py_debug_mode` | 🟠 HIGH | Flask/uvicorn debug=True — exposes interactive debugger and verbose error pages in production. |
| PY_013 | `py_insecure_random` | 🟠 HIGH | random module used for tokens, keys, or passwords — not cryptographically secure. |
| PY_014 | `py_prompt_injection` | 🔴 BLOCKER | LLM prompt built by concatenating or f-stringing user input without sanitization. |
| PY_015 | `py_ai_endpoint_no_auth` | 🔴 BLOCKER | Route calling OpenAI/Anthropic/LangChain with no authentication — unbounded API cost exposure. |
| PY_016 | `py_llm_response_unvalidated` | 🟠 HIGH | LLM response content used directly as code, SQL, or HTML without validation. |
| PY_017 | `py_unvalidated_redirect` | 🟠 HIGH | redirect() called with a URL from request parameters without validation. |
| PY_018 | `py_no_rate_limit` | 🟠 HIGH | FastAPI/Flask app has routes but no rate-limiting middleware. |
| PY_019 | `py_hardcoded_connection_string` | 🔴 BLOCKER | Database connection string with credentials hardcoded in source. |
| PY_020 | `py_bare_except` | 🟡 MEDIUM | Bare except: clause catches SystemExit, KeyboardInterrupt, and hides all errors. |
| PY_021 | `py_error_detail_leak` | 🟡 MEDIUM | Exception message or traceback returned in API response — information disclosure. |
| PY_022 | `py_missing_input_validation` | 🟠 HIGH | FastAPI route reads raw request.json() instead of a typed Pydantic model. |
| PY_023 | `py_timing_attack` | 🟠 HIGH | Secret or token compared with == operator — vulnerable to timing attacks. |
| PY_024 | `py_no_https_redirect` | 🟡 MEDIUM | FastAPI app with no HTTPS redirect or HTTPSRedirectMiddleware. |
| PY_026 | `py_mutable_default_arg` | 🟠 HIGH | Function uses mutable default argument (list or dict) — shared across all calls. |
| PY_028 | `py_blocking_sleep_in_async` | 🟠 HIGH | `time.sleep()` inside an `async def` blocks the entire event loop. |
| PY_029 | `py_unawaited_coroutine` | 🔴 BLOCKER | Coroutine called without `await` — silently no-ops and returns a coroutine object. |
| PY_030 | `py_pickle_rce` | 🔴 BLOCKER | `pickle.loads()` on externally-sourced data — remote code execution vector. |
| PY_031 | `py_marshal_rce` | 🔴 BLOCKER | `marshal.loads()` on external data — same RCE class as pickle. |
| PY_032 | `py_unpinned_requirements` | 🟡 MEDIUM | requirements.txt has unpinned dependencies — supply chain and reproducibility risk. |
| PY_033 | `py_os_system_injection` | 🔴 BLOCKER | `os.system()` with f-string or % formatting — shell injection vector. |
| PY_034 | `py_subprocess_shell_injection` | 🔴 BLOCKER | `subprocess` with `shell=True` and a non-literal command — shell injection risk. |
| PY_035 | `py_fastapi_no_response_model` | 🟡 MEDIUM | FastAPI route decorator missing `response_model` — internal fields may be leaked. |
| PY_036 | `py_global_keyword` | 🟡 MEDIUM | `global` keyword mutates module-level state — implicit shared mutable state. |
| PY_037 | `py_assert_for_validation` | 🟠 HIGH | `assert` used for runtime input validation — stripped by Python `-O` flag. |
| PY_038 | `py_pydantic_v1_api` | 🟠 HIGH | Pydantic v1 `.dict()` or `.json()` method called — these are removed in Pydantic v2. |
| PY_039 | `py_open_without_encoding` | 🔵 LOW | `open()` in text mode without `encoding=` — platform-dependent behaviour. |
| PY_040 | `py_django_raw_sql` | 🔴 BLOCKER | Django `QuerySet.raw()` or `cursor.execute()` with user-supplied data — SQL injection. |
| PY_041 | `py_django_mark_safe_xss` | 🔴 BLOCKER | Django `mark_safe()` called on user-controlled string — XSS vulnerability. |
| PY_042 | `py_wildcard_import` | 🟡 MEDIUM | `from module import *` pollutes namespace and hides dependency origins. |
| PY_043 | `py_async_without_await` | 🔵 LOW | `async def` function body has no `await` — function is synchronous and needlessly async. |
| PY_044 | `py_optional_no_default` | 🔵 LOW | `Optional[X]` parameter without a `None` default — misleading type annotation. |
| PY_045 | `py_print_for_logging` | 🔵 LOW | `print()` used instead of the `logging` module in non-script code. |
| PY_025 | `py_langchain_no_auth` | 🔴 BLOCKER | LangChain agent or chain invoked in a route with no authentication. |
| DJG_001 | `django_debug_true` | 🔴 BLOCKER | DEBUG = True in settings file exposes stack traces and config to end users. |
| DJG_002 | `django_allowed_hosts_wildcard` | 🟠 HIGH | ALLOWED_HOSTS = ["*"] disables Django's Host header validation, enabling header injection attacks. |
| DJG_003 | `django_raw_sql_injection` | 🔴 BLOCKER | Django .raw() or cursor.execute() called with string formatting — SQL injection risk. |
| DJG_004 | `django_csrf_exempt` | 🟠 HIGH | @csrf_exempt disables CSRF protection on a view — vulnerable to cross-site request forgery. |
| DJG_005 | `django_missing_login_required` | 🟠 HIGH | View function with state-changing HTTP method handling lacks @login_required or LoginRequiredMixin. |
| DJG_006 | `django_hardcoded_secret_key` | 🔴 BLOCKER | Django SECRET_KEY appears to be hardcoded — rotate it and load from environment. |
| DJG_007 | `django_no_ssl_redirect` | 🟡 MEDIUM | SECURE_SSL_REDIRECT is not enabled in settings — HTTP traffic not redirected to HTTPS. |
| DJG_008 | `django_serializer_all_fields` | 🟠 HIGH | DRF ModelSerializer with fields = "__all__" exposes every model field including sensitive ones. |
| DJG_009 | `django_template_safe_filter` | 🟠 HIGH | {{ value|safe }} in Django template bypasses auto-escaping — XSS if value is user-controlled. |
| DJG_010 | `django_mark_safe_dynamic` | 🟠 HIGH | mark_safe() called with a dynamic/formatted string — XSS if the value is user-controlled. |
| DJG_011 | `django_get_or_500` | 🟡 MEDIUM | User.objects.get() without try/except raises DoesNotExist and returns 500 instead of 404. |
| DJG_012 | `django_open_redirect` | 🟠 HIGH | Django redirect() called with unvalidated user input — open redirect vulnerability. |
| DJG_013 | `django_unsafe_file_upload` | 🟠 HIGH | File upload handler stores the file without validating the extension or content type. |
| DJG_014 | `django_pickle_deserialization` | 🔴 BLOCKER | pickle.loads() or pickle.load() called — arbitrary code execution if input is attacker-controlled. |
| DJG_015 | `django_no_hsts` | 🟡 MEDIUM | SECURE_HSTS_SECONDS is not set — browsers will not enforce HTTPS-only connections. |
| DJG_016 | `django_shell_injection` | 🔴 BLOCKER | subprocess called with shell=True and dynamic string — command injection if user input is included. |
| DJG_017 | `django_hardcoded_db_password` | 🔴 BLOCKER | DATABASES settings contains a hardcoded PASSWORD — database credentials in source code. |
| DJG_018 | `django_insecure_session_cookie` | 🟡 MEDIUM | SESSION_COOKIE_SECURE = False (or missing) allows session cookies to be sent over HTTP. |
| DJG_019 | `django_cors_allow_all` | 🟠 HIGH | CORS_ALLOW_ALL_ORIGINS = True allows any website to make cross-origin requests with credentials. |
| DJG_020 | `django_unauthenticated_user_access` | 🟡 MEDIUM | request.user attributes accessed without first checking request.user.is_authenticated. |
| GO_001 | `go_sql_injection` | 🔴 BLOCKER | SQL query built with fmt.Sprintf or string concat — SQL injection risk. |
| GO_002 | `go_command_injection` | 🔴 BLOCKER | exec.Command() first arg built with fmt.Sprintf or string concat — command injection risk. |
| GO_003 | `go_ssrf` | 🟠 HIGH | http.Get() or http.Post() with a variable URL — SSRF if user-controlled. |
| GO_004 | `go_weak_random` | 🟠 HIGH | math/rand used near token/secret/key/password — not cryptographically secure. |
| GO_005 | `go_hardcoded_secret` | 🔴 BLOCKER | Variable named password/secret/apiKey/token assigned a string literal. |
| GO_006 | `go_tls_insecure` | 🔴 BLOCKER | InsecureSkipVerify: true in TLS config disables certificate verification. |
| GO_007 | `go_log_sensitive` | 🟠 HIGH | log.Printf/fmt.Printf logging a value named password/secret/token/apiKey. |
| GO_008 | `go_os_setenv_secret` | 🟡 MEDIUM | os.Setenv() with a key containing PASSWORD/SECRET/TOKEN/KEY — leaks into child processes. |
| GO_009 | `go_ignored_error` | 🟠 HIGH | Function return value discarded with _ = — silently ignores errors. |
| GO_010 | `go_panic_in_handler` | 🟠 HIGH | panic() called inside an HTTP handler — crashes the server or goroutine. |
| GO_011 | `go_goroutine_leak` | 🟡 MEDIUM | Goroutine launched without WaitGroup, errgroup, or context cancellation — potential goroutine leak. |
| GO_012 | `go_global_mutable_state` | 🟡 MEDIUM | Package-level var map or slice without sync.Mutex — data race under concurrent access. |
| GO_013 | `go_http_no_timeout` | 🟠 HIGH | http.DefaultClient or &http.Client{} without Timeout — hangs indefinitely on slow upstreams. |
| GO_014 | `go_server_no_timeout` | 🟡 MEDIUM | http.ListenAndServe() called directly — infinite timeouts enable slowloris attacks. |
| GO_015 | `go_missing_input_validation` | 🟡 MEDIUM | HTTP handler reads request input and passes it directly to a DB call without validation. |
| GO_016 | `go_handler_no_auth` | 🟠 HIGH | HTTP handler registration with no visible auth check or middleware in the handler body. |
| GO_017 | `go_path_traversal` | 🔴 BLOCKER | filepath.Join or os.Open/ReadFile called with a request-derived argument — path traversal risk. |
| GO_018 | `go_ioutil_deprecated` | 🔵 LOW | ioutil.ReadFile/WriteFile/ReadAll deprecated since Go 1.16 — use os/io packages instead. |
| GO_019 | `go_context_background_in_handler` | 🟡 MEDIUM | context.Background() inside HTTP handler — use r.Context() to respect request cancellation. |
| GO_020 | `go_time_sleep_in_handler` | 🟡 MEDIUM | time.Sleep() called inside HTTP handler — blocks goroutine and degrades server throughput. |
| RB_001 | `rails_sql_injection` | 🔴 BLOCKER | String interpolation inside ActiveRecord .where()/.find_by()/.order()/.group()/.having()/.joins()/.select() — SQL injection risk. |
| RB_002 | `rails_raw_sql_injection` | 🔴 BLOCKER | ActiveRecord::Base.connection.execute() with string interpolation — SQL injection risk. |
| RB_003 | `rails_missing_authenticate` | 🟠 HIGH | Rails controller with action methods but no before_action :authenticate_user! or equivalent. |
| RB_004 | `rails_skip_before_action_auth` | 🟠 HIGH | skip_before_action :authenticate_user! or :require_login disables authentication for specific actions. |
| RB_005 | `rails_mass_assignment_permit_all` | 🔴 BLOCKER | params.permit! bypasses strong parameters and allows all user input through mass assignment. |
| RB_006 | `rails_unsafe_attributes` | 🟠 HIGH | attr_accessible :admin, :role, or :is_admin exposes privileged fields to mass assignment. |
| RB_007 | `rails_csrf_protect_disabled` | 🟠 HIGH | protect_from_forgery with: :null_session or skip_before_action :verify_authenticity_token disables CSRF protection. |
| RB_008 | `rails_open_redirect` | 🟠 HIGH | redirect_to params[:return_to] or similar user-controlled URL without validation — open redirect. |
| RB_009 | `rails_command_injection` | 🔴 BLOCKER | Shell command with string interpolation — system("#{...}"), backtick interpolation, exec, %x, IO.popen, Open3. |
| RB_010 | `rails_path_traversal` | 🔴 BLOCKER | File.read/File.open/send_file/render file: with params[] — user-controlled file path traversal. |
| RB_011 | `rails_send_file_user_input` | 🔴 BLOCKER | send_file with a variable path argument (not a string literal or Rails.root-based path) — path traversal risk. |
| RB_012 | `rails_hardcoded_secret_key_base` | 🔴 BLOCKER | secret_key_base with a literal string value in a YAML config file — credential in source code. |
| RB_013 | `rails_debug_mode_production` | 🟠 HIGH | config.log_level = :debug or consider_all_requests_local = true in a production config file. |
| RB_014 | `rails_xss_raw` | 🟠 HIGH | raw() or .html_safe called on user-controlled content — XSS vulnerability. |
| RB_015 | `rails_render_inline_xss` | 🟡 MEDIUM | render inline: "..." with string interpolation — ERB in a string bypasses template escaping. |
| RB_016 | `rails_yaml_load_unsafe` | 🔴 BLOCKER | YAML.load() without safe_load — executes arbitrary Ruby code via !!ruby/object tags. |
| RB_017 | `rails_marshal_load` | 🔴 BLOCKER | Marshal.load() or Marshal.restore() deserializes arbitrary Ruby objects — RCE if input is attacker-controlled. |
| RB_018 | `rails_log_sensitive` | 🟡 MEDIUM | Rails.logger or logger logging interpolated strings containing password, token, secret, or api_key. |
| RB_019 | `rails_regex_dos` | 🟡 MEDIUM | Model validation regex uses ^ and $ anchors instead of \A and \z — allows multiline bypass in Ruby. |
| RB_020 | `rails_gem_source_http` | 🟡 MEDIUM | source 'http://' (not HTTPS) in Gemfile — gem installs over HTTP are MITM-vulnerable. |
| PHP_001 | `php_sql_injection` | 🔴 BLOCKER | SQL query built by string concatenation with a variable — SQL injection. |
| PHP_002 | `php_sql_interpolation` | 🔴 BLOCKER | PDO or mysqli query uses PHP variable interpolation inside the SQL string. |
| PHP_003 | `php_xss_echo` | 🔴 BLOCKER | User superglobal ($_GET/$_POST/$_REQUEST) echoed without htmlspecialchars(). |
| PHP_004 | `php_eval_usage` | 🔴 BLOCKER | eval() executes arbitrary PHP — code injection if input is attacker-controlled. |
| PHP_005 | `php_command_injection` | 🔴 BLOCKER | Shell command executed with user-controlled input — command injection. |
| PHP_006 | `php_open_redirect` | 🟠 HIGH | HTTP redirect destination taken directly from user input without validation. |
| PHP_007 | `php_path_traversal` | 🔴 BLOCKER | File path or include built from user input — path traversal / LFI. |
| PHP_008 | `laravel_mass_assignment` | 🔴 BLOCKER | Eloquent model with $guarded = [] allows mass assignment of all attributes. |
| PHP_009 | `laravel_raw_query` | 🔴 BLOCKER | Laravel whereRaw(), selectRaw(), or DB::raw() with PHP variable interpolation. |
| PHP_010 | `laravel_missing_auth_middleware` | 🟠 HIGH | Laravel apiResource/resource route defined without auth middleware in context. |
| PHP_011 | `php_file_upload_no_validation` | 🟠 HIGH | move_uploaded_file() called without MIME type validation in surrounding context. |
| PHP_012 | `php_deserialization` | 🔴 BLOCKER | unserialize() on user-supplied data — PHP object injection / RCE. |
| PHP_013 | `laravel_debug_true` | 🟠 HIGH | APP_DEBUG=true in .env or hardcoded 'debug' => true in config/app.php. |
| PHP_014 | `php_weak_password_hash` | 🟠 HIGH | md5() or sha1() used for password hashing instead of password_hash(). |
| PHP_015 | `laravel_missing_csrf` | 🟠 HIGH | Blade form with POST/PUT/PATCH/DELETE method but no @csrf directive. |
| PHP_016 | `php_extract_superglobal` | 🟠 HIGH | extract() on $_GET/$_POST/$_REQUEST creates arbitrary local variables from user input. |
| PHP_017 | `php_session_fixation` | 🟠 HIGH | session_id() set from user input — session fixation attack. |
| PHP_018 | `php_ssrf` | 🔴 BLOCKER | HTTP request or file fetch with URL from user input — Server-Side Request Forgery. |
| PHP_019 | `php_hardcoded_credentials` | 🟠 HIGH | Password, API key, or secret hardcoded directly in PHP source code. |
| PHP_020 | `laravel_request_all_mass_assign` | 🟠 HIGH | Model::create() or ->update() called with $request->all() — unfiltered mass assignment. |
| JAVA_001 | `java_sql_injection` | 🔴 BLOCKER | JDBC executeQuery/execute with string concatenation — SQL injection risk. |
| JAVA_002 | `java_sql_interpolation` | 🔴 BLOCKER | String.format() used to build a SQL query — SQL injection risk. |
| JAVA_003 | `spring_missing_pre_authorize` | 🟠 HIGH | Spring @RequestMapping/@GetMapping/@PostMapping etc. without @PreAuthorize or @Secured — unauthenticated access possible. |
| JAVA_004 | `java_hardcoded_password` | 🟠 HIGH | String variable named password/secret/apiKey assigned a hardcoded string literal. |
| JAVA_005 | `java_weak_password_hash` | 🟠 HIGH | MessageDigest.getInstance("MD5") or ("SHA-1") — insecure for password hashing. |
| JAVA_006 | `java_xxe_injection` | 🔴 BLOCKER | XMLInputFactory/DocumentBuilderFactory/SAXParserFactory without external entity protection — XXE injection. |
| JAVA_007 | `java_deserialization` | 🔴 BLOCKER | new ObjectInputStream followed by readObject() — arbitrary code execution via unsafe deserialization. |
| JAVA_008 | `java_command_injection` | 🔴 BLOCKER | Runtime.exec() or new ProcessBuilder() with string concatenation — command injection risk. |
| JAVA_009 | `java_path_traversal` | 🔴 BLOCKER | new File() with request.getParameter() or concatenation — path traversal risk. |
| JAVA_010 | `java_open_redirect` | 🟠 HIGH | response.sendRedirect() with request.getParameter() — open redirect vulnerability. |
| JAVA_011 | `spring_csrf_disabled` | 🟠 HIGH | Spring Security .csrf().disable() or csrf(AbstractHttpConfigurer::disable) — CSRF protection removed. |
| JAVA_012 | `spring_cors_wildcard` | 🟠 HIGH | .allowedOrigins("*") in CORS configuration — accepts requests from any origin. |
| JAVA_013 | `spring_actuator_exposed` | 🟠 HIGH | management.endpoints.web.exposure.include=* exposes all Spring Actuator endpoints. |
| JAVA_014 | `spring_h2_console_enabled` | 🟠 HIGH | spring.h2.console.enabled=true in application properties — H2 web console exposed. |
| JAVA_015 | `java_random_not_secure` | 🟠 HIGH | new Random() used near token/password/key/session generation — use SecureRandom instead. |
| JAVA_016 | `java_log_sensitive` | 🟠 HIGH | Logger.info/debug/error/warn with password/token/secret in the message — credential leaked to logs. |
| JAVA_017 | `spring_missing_request_validation` | 🟡 MEDIUM | @RequestBody parameter without @Valid or @Validated — input is not validated. |
| JAVA_018 | `java_hardcoded_secret_key` | 🔴 BLOCKER | new SecretKeySpec() with a hardcoded string or byte literal — cryptographic key in source code. |
| JAVA_019 | `java_reflection_injection` | 🔴 BLOCKER | Class.forName() with a variable argument — dynamic class loading from user-controlled input enables RCE. |
| JAVA_020 | `spring_missing_transaction` | 🟡 MEDIUM | @Repository class with save/update/delete/insert method missing @Transactional. |
| RUST_001 | `rust_unwrap_in_lib` | 🟠 HIGH | .unwrap() in a lib crate (not in tests, not in fn main, not in examples). |
| RUST_002 | `rust_expect_without_message` | 🟡 MEDIUM | .expect("") or .expect("TODO") — empty or placeholder expect message. |
| RUST_003 | `rust_panic_in_lib` | 🟠 HIGH | panic!() macro called in a lib crate (not in tests). |
| RUST_004 | `rust_unsafe_block` | 🟠 HIGH | unsafe { } block without a // SAFETY: comment explaining the invariant. |
| RUST_005 | `rust_integer_overflow_cast` | 🟡 MEDIUM | Unchecked `as u8` or `as i8` cast — silently truncates on overflow. |
| RUST_006 | `rust_clone_on_large_struct` | 🟡 MEDIUM | .clone() on a variable with a data/payload/buffer-like name, or inside a loop. |
| RUST_007 | `rust_string_format_in_loop` | 🟡 MEDIUM | format!() called inside a for/while/loop — allocates a new String every iteration. |
| RUST_008 | `rust_mutex_guard_across_await` | 🔴 BLOCKER | MutexGuard (.lock()) held across an .await point — deadlock risk in async code. |
| RUST_009 | `rust_blocking_call_in_async` | 🟠 HIGH | Blocking I/O (std::fs::read, std::thread::sleep, TcpStream::connect) in an async fn. |
| RUST_010 | `rust_sql_injection` | 🔴 BLOCKER | SQL string built with format!() including a {} placeholder — SQL injection risk. |
| RUST_011 | `rust_hardcoded_secret` | 🟠 HIGH | Hardcoded API key, password, or secret assigned to a sensitive-named variable. |
| RUST_012 | `rust_missing_must_use` | 🟡 MEDIUM | std::fs write/remove/create_dir called as standalone statement — Result discarded. |
| RUST_013 | `rust_use_of_deprecated_try_macro` | 🔵 LOW | Deprecated try!() macro — replaced by the ? operator in Rust 2018+. |
| RUST_014 | `rust_transmute_usage` | 🔴 BLOCKER | std::mem::transmute — extremely unsafe type punning that bypasses all safety guarantees. |
| RUST_015 | `rust_raw_pointer_deref` | 🟠 HIGH | Raw pointer dereference (*raw_ptr/*ptr) without a // SAFETY: comment. |
| RUST_016 | `rust_panic_on_none` | 🟡 MEDIUM | .unwrap() chained on a method that returns Option (find/get/first/last/next/pop). |
| RUST_017 | `rust_vec_collect_in_loop` | 🟡 MEDIUM | .collect::<Vec<_>>() inside a for/while loop — allocates a new Vec every iteration. |
| RUST_018 | `rust_spawn_without_join` | 🟡 MEDIUM | thread::spawn() called without capturing the JoinHandle — fire-and-forget thread. |
| RUST_019 | `rust_env_var_unwrap` | 🟠 HIGH | std::env::var("KEY").unwrap() — panics at startup if the environment variable is missing. |
| RUST_020 | `rust_todo_in_production` | 🟡 MEDIUM | todo!() or unimplemented!() macro in non-test code — always panics at runtime. |
| CS_001 | `csharp_sql_injection` | 🔴 BLOCKER | SQL built by string interpolation or concatenation passed to a database method — SQL injection. |
| CS_002 | `csharp_ef_raw_sql_interpolation` | 🔴 BLOCKER | EF Core FromSqlRaw() called with an interpolated string $"..." — defeats parameterization. |
| CS_003 | `csharp_missing_authorize` | 🟠 HIGH | ASP.NET Core controller action with [Http*] attribute but no [Authorize] or [AllowAnonymous] nearby. |
| CS_004 | `csharp_missing_antiforgery` | 🟠 HIGH | Razor form with POST method missing @Html.AntiForgeryToken() or asp-antiforgery. |
| CS_005 | `csharp_hardcoded_connection_string` | 🟠 HIGH | Connection string with credentials hardcoded in C# source. |
| CS_006 | `csharp_hardcoded_secret_in_config` | 🟠 HIGH | appsettings.json contains a hardcoded API key, password, or secret. |
| CS_007 | `csharp_type_name_handling` | 🔴 BLOCKER | JsonSerializerSettings with TypeNameHandling set to All, Objects, or Auto — RCE via deserialization. |
| CS_008 | `csharp_xml_external_entity` | 🔴 BLOCKER | XmlDocument or XmlReader created without disabling external entity processing — XXE vulnerability. |
| CS_009 | `csharp_debug_in_production` | 🟠 HIGH | app.UseDeveloperExceptionPage() called without an IsDevelopment() guard — leaks stack traces. |
| CS_010 | `csharp_open_redirect` | 🟠 HIGH | Response.Redirect or Redirect() called with a user-supplied URL. |
| CS_011 | `csharp_path_traversal` | 🔴 BLOCKER | File.ReadAllText/Open/ReadAllBytes or Path.Combine used with user-supplied request input. |
| CS_012 | `csharp_command_injection` | 🔴 BLOCKER | Process.Start or ProcessStartInfo used with user-controlled arguments. |
| CS_013 | `csharp_insecure_cookie` | 🟠 HIGH | Cookie created with HttpOnly or Secure explicitly set to false. |
| CS_014 | `csharp_weak_hash_algorithm` | 🟠 HIGH | MD5.Create() or SHA1.Create() used for hashing — not safe for passwords or integrity checks. |
| CS_015 | `csharp_cors_allow_all` | 🟠 HIGH | CORS policy allows all origins — exposes API to any website. |
| CS_016 | `csharp_string_format_logging_sensitive` | 🟠 HIGH | Logger call includes password, secret, token, or API key — sensitive data in logs. |
| CS_017 | `csharp_async_void` | 🟡 MEDIUM | async void method — exceptions are swallowed and cannot be awaited. |
| CS_018 | `csharp_exception_swallowed` | 🟠 HIGH | Empty catch block silently swallows exceptions. |
| CS_019 | `csharp_hardcoded_jwt_secret` | 🔴 BLOCKER | JWT signing key hardcoded as a string literal in SymmetricSecurityKey. |
| CS_020 | `csharp_viewbag_xss` | 🟠 HIGH | Razor view outputs ViewBag or ViewData via @Html.Raw() — unescaped XSS risk. |
| DOCKER_001 | `docker_run_as_root` | 🟠 HIGH | No USER instruction or only USER root — container runs as root. |
| DOCKER_002 | `docker_add_instead_of_copy` | 🟡 MEDIUM | ADD used to copy local files — use COPY instead. |
| DOCKER_003 | `docker_latest_tag` | 🟠 HIGH | FROM uses :latest tag or no tag — image is not pinned. |
| DOCKER_004 | `docker_no_healthcheck` | 🟡 MEDIUM | Runnable image has no HEALTHCHECK instruction. |
| DOCKER_005 | `docker_secret_in_env` | 🔴 BLOCKER | ENV instruction sets a sensitive variable to a literal value. |
| DOCKER_006 | `docker_expose_ssh` | 🟠 HIGH | EXPOSE 22 exposes the SSH port. |
| DOCKER_007 | `docker_curl_pipe_bash` | 🔴 BLOCKER | RUN curl/wget piped to bash/sh — arbitrary remote code execution. |
| DOCKER_008 | `docker_sudo_in_run` | 🟠 HIGH | RUN sudo used inside Dockerfile — redundant and signals running as root. |
| DOCKER_009 | `docker_secret_in_arg` | 🟠 HIGH | ARG with a sensitive name — build-arg values are visible in docker history. |
| DOCKER_010 | `docker_add_url` | 🟡 MEDIUM | ADD downloading from a URL — use curl/wget with checksum verification instead. |
| DOCKER_011 | `docker_apt_no_cleanup` | 🟡 MEDIUM | apt-get install without rm -rf /var/lib/apt/lists/* in the same RUN layer. |
| DOCKER_012 | `docker_mutable_tag` | 🟡 MEDIUM | FROM uses a mutable semver tag without a digest — image can silently change. |
| DOCKER_013 | `docker_copy_chown_separate` | 🟡 MEDIUM | COPY followed by a separate RUN chown/chmod — use COPY --chown= instead. |
| DOCKER_014 | `docker_privileged_port` | 🟡 MEDIUM | EXPOSE of a privileged port below 1024 (other than 80 and 443). |
| DOCKER_015 | `docker_no_entrypoint` | 🔵 LOW | Dockerfile has CMD but no ENTRYPOINT — container behaviour is unpredictable. |
| GHA_001 | `gha_script_injection` | 🔴 BLOCKER | Untrusted GitHub context expression used directly inside a run: step — script injection. |
| GHA_002 | `gha_pull_request_target_checkout` | 🔴 BLOCKER | pull_request_target event combined with actions/checkout at the PR head — privileged workflow runs attacker code. |
| GHA_003 | `gha_write_all_permissions` | 🟠 HIGH | permissions: write-all grants all write permissions to the workflow token. |
| GHA_004 | `gha_unpinned_action` | 🟡 MEDIUM | actions/checkout or third-party action referenced at a branch/tag rather than a full commit SHA. |
| GHA_005 | `gha_secrets_logged` | 🟠 HIGH | Secret value echoed inside a run: step — secrets in logs even with masking. |
| GHA_006 | `gha_self_hosted_runner` | 🟠 HIGH | Self-hosted runner used in a workflow that can be triggered by external contributors. |
| GHA_007 | `gha_env_from_input` | 🟠 HIGH | Workflow dispatch input interpolated directly into a run: command instead of being set as an env var first. |
| GHA_008 | `gha_artifact_path_traversal` | 🟡 MEDIUM | actions/upload-artifact with a path: containing a GitHub context expression — potential path traversal. |
| GHA_009 | `gha_cache_restore_key_mutable` | 🟡 MEDIUM | actions/cache restore-keys: ends with ${{ github.ref }} — mutable cache key enables cache poisoning. |
| GHA_010 | `gha_deprecated_set_env` | 🟠 HIGH | Deprecated ::set-env:: or ::add-path:: workflow commands used — CVE-2020-15228 environment injection. |
| TF_001 | `tf_s3_public_acl` | 🔴 BLOCKER | S3 bucket resource with a public-read or public-read-write ACL — publicly exposes all bucket objects. |
| TF_002 | `tf_sg_open_to_world` | 🔴 BLOCKER | Security group allows inbound traffic from 0.0.0.0/0 on sensitive ports (SSH, database ports). |
| TF_003 | `tf_rds_publicly_accessible` | 🟠 HIGH | RDS instance or cluster with publicly_accessible = true — database is internet-reachable. |
| TF_004 | `tf_rds_no_encryption` | 🟠 HIGH | RDS instance or cluster without storage_encrypted = true — data at rest is unencrypted. |
| TF_005 | `tf_iam_wildcard_action` | 🔴 BLOCKER | IAM policy statement grants all actions ("*") — full AWS admin access. |
| TF_006 | `tf_iam_wildcard_resource` | 🟠 HIGH | IAM policy statement uses resources = ["*"] — policy applies to all AWS resources. |
| TF_007 | `tf_s3_no_versioning` | 🟡 MEDIUM | S3 bucket resource without versioning enabled — objects cannot be recovered after deletion or overwrite. |
| TF_008 | `tf_hardcoded_credentials` | 🔴 BLOCKER | Hardcoded password, secret, or API key found in Terraform configuration. |
| TF_009 | `tf_ec2_imds_v1` | 🟡 MEDIUM | EC2 instance without IMDSv2 enforcement — vulnerable to SSRF-to-metadata attacks. |
| TF_010 | `tf_log_group_no_retention` | 🟡 MEDIUM | CloudWatch log group without retention_in_days — logs are retained indefinitely, increasing cost and compliance risk. |
| TF_011 | `tf_security_group_all_ports` | 🔴 BLOCKER | Security group ingress/egress with from_port = 0 and to_port = 65535 — all TCP/UDP ports open. |
| TF_012 | `tf_unencrypted_ebs` | 🟠 HIGH | EBS volume declared without encrypted = true — data at rest is unencrypted. |
| TF_013 | `tf_iam_sensitive_wildcard_resource` | 🔴 BLOCKER | IAM policy grants sensitive actions with `"Resource": "*"` — overly permissive. |
| TF_014 | `tf_sg_open_ingress` | 🔴 BLOCKER | Security group allows ingress from `0.0.0.0/0` on a non-HTTP/HTTPS port. |
| TF_015 | `tf_no_backend` | 🟠 HIGH | No `terraform { backend }` block — state is stored locally and not shared with the team. |
| TF_016 | `tf_sensitive_var_not_marked` | 🟠 HIGH | Variable with a sensitive name (password, secret, token, key) not marked `sensitive = true`. |
| TF_017 | `tf_unpinned_provider` | 🟡 MEDIUM | `required_providers` missing version constraint — provider may update with breaking changes. |
| TF_018 | `tf_rds_no_deletion_protection` | 🟠 HIGH | RDS instance missing `deletion_protection = true` — can be permanently deleted by terraform destroy. |
| TF_019 | `tf_lambda_no_reserved_concurrency` | 🟡 MEDIUM | Lambda function without `reserved_concurrent_executions` — can consume all account concurrency. |
| TF_020 | `tf_dynamodb_no_pitr` | 🟠 HIGH | DynamoDB table missing Point-In-Time Recovery (PITR) — data loss risk. |
| TF_021 | `tf_kms_no_rotation` | 🟡 MEDIUM | KMS key missing `enable_key_rotation = true` — cryptographic key is never rotated. |
| TF_022 | `tf_secret_in_user_data` | 🔴 BLOCKER | Hardcoded secret or token in EC2 `user_data` — visible in AWS console and instance metadata. |
| TF_023 | `tf_no_prevent_destroy` | 🟠 HIGH | Stateful resource (RDS, S3, DynamoDB) missing `lifecycle { prevent_destroy = true }`. |
| TF_024 | `tf_ec2_public_ip` | 🟠 HIGH | EC2 instance with `associate_public_ip_address = true` — instance directly reachable from internet. |
| TF_025 | `tf_s3_no_versioning` | 🟡 MEDIUM | S3 bucket missing versioning configuration — deleted or overwritten objects cannot be recovered. |
| GQL_001 | `gql_no_depth_limit` | 🟠 HIGH | GraphQL server configured without query depth limiting — DoS via deeply nested queries. |
| GQL_002 | `gql_no_complexity_limit` | 🟠 HIGH | GraphQL server has no query complexity limit — DoS via expensive field combinations. |
| GQL_003 | `gql_resolver_no_auth` | 🔴 BLOCKER | GraphQL resolver accesses data without an authorization check. |
| GQL_004 | `gql_n_plus_one` | 🟠 HIGH | GraphQL resolver calls the database inside a field that returns a list — N+1 query problem. |
| GQL_005 | `gql_introspection_in_prod` | 🟡 MEDIUM | GraphQL introspection not disabled — exposes full schema to attackers in production. |
| GQL_006 | `gql_raw_error_thrown` | 🟡 MEDIUM | Resolver throws a raw `Error` instead of `GraphQLError` — may leak internal stack traces. |
| GQL_007 | `gql_string_for_id` | 🔵 LOW | Schema uses `String` type for ID fields — use the `ID` scalar instead. |
| GQL_008 | `gql_mutation_returns_boolean` | 🔵 LOW | GraphQL mutation returns `Boolean` — use a typed payload for evolvable APIs. |
| GQL_009 | `gql_deprecated_no_reason` | 🔵 LOW | `@deprecated` directive used without a `reason` — clients have no migration guidance. |
| GQL_010 | `gql_subscription_no_auth` | 🔴 BLOCKER | GraphQL subscription handler has no authentication check on the connection context. |
| GQL_011 | `gql_context_user_no_check` | 🟠 HIGH | `context.user` or `ctx.user` accessed without null check — crashes on unauthenticated requests. |
| GQL_012 | `gql_undefined_for_nullable` | 🔵 LOW | GraphQL resolver returns `undefined` for a nullable field — should return `null`. |
| GQL_013 | `gql_missing_resolve_type` | 🟠 HIGH | GraphQL union or interface schema defined but `__resolveType` missing in resolvers. |
| GQL_014 | `gql_console_log_in_resolver` | 🟡 MEDIUM | `console.log` in a GraphQL resolver — leaks query args and user data to server logs. |
| GQL_015 | `gql_no_rate_limit` | 🟠 HIGH | GraphQL endpoint has no rate limiting middleware configured. |
| GQL_016 | `gql_file_upload_no_limit` | 🟠 HIGH | GraphQL file upload configured without a file size limit. |
| GQL_017 | `gql_hardcoded_secret` | 🔴 BLOCKER | Hardcoded API key, token, or secret found in GraphQL resolver. |
| GQL_018 | `gql_offset_pagination_only` | 🔵 LOW | GraphQL list field uses limit/offset pagination only — does not scale at high offsets. |
| GQL_019 | `gql_stitch_no_auth` | 🟠 HIGH | Schema stitching merges a remote schema without forwarding authorization headers. |
| GQL_020 | `gql_implicit_query` | 🔵 LOW | Anonymous GraphQL operation (missing `query` keyword) — breaks persisted queries and APQ. |
| GQL_021 | `gql_input_as_output` | 🟠 HIGH | GraphQL `input` type name used as a field return type — inputs cannot be used as outputs. |
| GQL_022 | `gql_missing_non_null` | 🔵 LOW | Schema fields that are semantically required are nullable (missing `!`). |
| GQL_023 | `gql_error_masking_disabled` | 🟠 HIGH | GraphQL server configured to expose full error details — leaks internals in production. |
| GQL_024 | `gql_unhandled_resolver_error` | 🟠 HIGH | Async GraphQL resolver with no try/catch — unhandled rejections crash the server. |
| GQL_025 | `gql_shared_dataloader` | 🔴 BLOCKER | DataLoader instance created outside request context — shared cache leaks data between users. |
| DESIGN_001 | `design_hardcoded_hex_color` | 🟠 HIGH | Hardcoded hex color in style prop or CSS — bypasses design tokens. |
| DESIGN_002 | `design_tailwind_arbitrary_color` | 🟡 MEDIUM | Tailwind arbitrary color value (e.g. text-[#3B82F6]) bypasses the design token palette. |
| DESIGN_003 | `design_inline_style_spacing` | 🟡 MEDIUM | Inline style with arbitrary px spacing bypasses the spacing scale. |
| DESIGN_004 | `design_hardcoded_font_family` | 🟠 HIGH | Hardcoded font-family bypasses design system typography. |
| DESIGN_005 | `design_hardcoded_font_size` | 🟡 MEDIUM | Hardcoded pixel font size bypasses the typography scale. |
| DESIGN_006 | `design_magic_z_index` | 🟡 MEDIUM | Magic z-index value — use a named token or Tailwind z-* utility. |
| DESIGN_007 | `design_hardcoded_shadow` | 🟡 MEDIUM | Hardcoded box-shadow bypasses the elevation scale. |
| DESIGN_008 | `design_important_override` | 🟠 HIGH | !important overrides fight the design system — fix specificity instead. |
| DESIGN_009 | `design_tailwind_arbitrary_dimension` | 🔵 LOW | Tailwind arbitrary pixel/rem dimension — use a spacing scale value instead. |
| DESIGN_010 | `design_hardcoded_border_radius` | 🔵 LOW | Hardcoded border-radius with off-scale px value. |
| DESIGN_011 | `design_hardcoded_gradient` | 🟡 MEDIUM | Gradient with hardcoded hex values bypasses design token palette. |
| DESIGN_012 | `design_missing_focus_visible` | 🟠 HIGH | outline-none without a focus-visible alternative — keyboard users lose focus indicator. |
| DESIGN_013 | `design_svg_hardcoded_fill` | 🟡 MEDIUM | SVG element with hardcoded fill/stroke color — use currentColor instead. |
| DESIGN_014 | `design_hardcoded_animation` | 🔵 LOW | Arbitrary animation duration — use Tailwind duration utilities for consistent motion timing. |
| DESIGN_015 | `design_raw_form_element` | 🟡 MEDIUM | Raw HTML form element without styling class — use a design system component or add a className. |
| DESIGN_016 | `design_mixed_icon_libraries` | 🟠 HIGH | Multiple icon libraries imported in the same file — pick one for the whole project. |
| DESIGN_017 | `design_color_named_css` | 🟡 MEDIUM | Non-semantic named CSS color bypasses the design palette. |
| DESIGN_018 | `design_hardcoded_opacity` | 🔵 LOW | Off-scale opacity value — use a Tailwind opacity utility for consistent transparency. |
| DESIGN_019 | `design_inline_style_on_component` | 🟡 MEDIUM | Inline style on a design system component bypasses its variant API. |
| DESIGN_020 | `design_hardcoded_line_height` | 🔵 LOW | Pixel line-height bypasses the typography scale. |
| DEBT_001 | `debt_duplicate_function_body` | 🟠 HIGH | Two or more functions in the same file share a highly similar body (≥80%) — AI-generated code duplication. |
| DEBT_002 | `debt_exported_function_no_test` | 🟠 HIGH | New exported function has no corresponding test — AI-generated functions are often untested. |
| DEBT_003 | `debt_file_complexity_spike` | 🟡 MEDIUM | File exceeds 400 lines — AI often generates monolithic files instead of modular code. |
| DEBT_004 | `debt_api_no_error_response_type` | 🟠 HIGH | API route handler returns a response type but no error response type is defined. |
| DEBT_005 | `debt_swallowed_error` | 🟠 HIGH | Error is caught and silently discarded — hidden failure that produces incorrect behavior in production. |
| DEBT_006 | `debt_vague_variable_name` | 🔵 LOW | Production code uses a semantically empty variable name — common in AI-generated code. |
| DEBT_007 | `debt_commented_out_block` | 🟡 MEDIUM | Commented-out code block (5+ consecutive lines) — AI leftover that obscures intent. |
| DEBT_008 | `debt_type_assertion_any` | 🟡 MEDIUM | `as any` or `as unknown as X` type assertion in non-test file — AI bypassing the type system. |
| DEBT_009 | `debt_hardcoded_url` | 🟠 HIGH | Hardcoded URL in business logic — should be an environment variable. |
| DEBT_010 | `debt_console_log_object_dump` | 🟡 MEDIUM | `console.log` dumping an object in production code — debug artifact from AI-generated code. |
| DEBT_011 | `debt_magic_number` | 🔵 LOW | Magic number in business logic — unnamed constant that obscures intent. |
| DEBT_012 | `debt_deep_nesting` | 🟡 MEDIUM | Code has 4+ levels of nesting (if/for/try) — complexity spike common in AI-generated logic. |
| DEBT_013 | `debt_todo_fixme_no_ticket` | 🔵 LOW | TODO/FIXME comment without a ticket reference — AI-generated reminder that will never be addressed. |
| DEBT_014 | `debt_unused_import` | 🔵 LOW | Import statement where the imported name is not used in the file — AI import bloat. |
| DEBT_015 | `debt_missing_finally_resource` | 🟡 MEDIUM | try/catch opens a resource (file, connection, lock) without a finally block — resource leak. |
| DEBT_016 | `debt_exponential_loop` | 🟠 HIGH | Nested loop over the same or similar collections — O(n²) or worse time complexity. |
| DEBT_017 | `debt_dead_code_return` | 🟡 MEDIUM | Code after a return statement in the same block — unreachable AI-generated code. |
| DEBT_018 | `debt_magic_regex` | 🔵 LOW | Complex regex literal with no comment or descriptive variable name explaining its intent. |
| DEBT_019 | `debt_catch_returns_null` | 🟠 HIGH | catch block returns null/undefined instead of handling or rethrowing — silent failure propagation. |
| DEBT_020 | `debt_over_parameterized_function` | 🔵 LOW | Function has 5+ parameters — AI-generated function that should use a config object. |
| COMMIT_001 | `commit_invalid_format` | 🔴 BLOCKER | Commit message first line must match Conventional Commits format: type[(scope)][!]: subject |
| COMMIT_002 | `commit_unknown_type` | 🟠 HIGH | Commit type must be one of the allowed types (feat, fix, docs, etc.) |
| COMMIT_003 | `commit_subject_too_long` | 🟡 MEDIUM | Commit subject line should not exceed 72 characters (configurable via commitLint.maxSubjectLength). |
| COMMIT_004 | `commit_subject_ends_period` | 🔵 LOW | Commit subject must not end with a period. |
| COMMIT_005 | `commit_subject_starts_uppercase` | 🔵 LOW | Commit subject (after 'type: ') must start with a lowercase letter. |
| COMMIT_006 | `commit_wip_message` | 🟠 HIGH | WIP commit messages must not land on protected branches. |
| COMMIT_007 | `commit_scope_uppercase` | 🔵 LOW | Commit scope must be lowercase kebab-case (e.g. auth-flow, not Auth Flow). |
| COMMIT_008 | `commit_breaking_no_footer` | 🔴 BLOCKER | Breaking change indicator (!) requires a BREAKING CHANGE: footer in the commit body. |
| COMMIT_009 | `commit_no_ticket_ref` | 🟡 MEDIUM | When commitLint.requireTicket is true, commit message must reference a ticket number. |
| COMMIT_010 | `commit_merge_commit_raw` | 🟠 HIGH | Raw merge commit messages ('Merge branch X into Y') should be avoided — use squash merge instead. |
| VERCEL_001 | `vercel_secret_in_config` | 🔴 BLOCKER | Never embed literal credential values in vercel.json. Use environment variable references instead. |
| VERCEL_002 | `vercel_server_secret_public_prefix` | 🔴 BLOCKER | Server secrets must never use the NEXT_PUBLIC_ prefix — it ships them to the browser bundle. |
| VERCEL_003 | `vercel_cron_no_secret_check` | 🟠 HIGH | Vercel Cron job route handlers must verify a CRON_SECRET authorization header. |
| VERCEL_004 | `vercel_env_not_in_example` | 🟠 HIGH | Every process.env.VAR_NAME used in source must be documented in .env.example. |
| VERCEL_005 | `vercel_env_example_missing` | 🟠 HIGH | Projects that use process.env variables must have a .env.example file. |
| VERCEL_006 | `vercel_missing_max_duration` | 🟡 MEDIUM | API route functions in vercel.json should declare an explicit maxDuration to prevent runaway costs. |
| VERCEL_007 | `vercel_edge_runtime_missing` | 🟡 MEDIUM | Middleware files (middleware.ts) must export `export const runtime = 'edge'`. |
| VERCEL_008 | `vercel_header_missing_security` | 🟡 MEDIUM | vercel.json headers config should include X-Frame-Options, X-Content-Type-Options, and Content-Security-Policy. |
| VERCEL_009 | `vercel_max_duration_exceeds_plan` | 🔵 LOW | maxDuration in vercel.json must not exceed the plan limit (Hobby: 60s, Pro: 800s). |
| VERCEL_010 | `vercel_open_redirect` | 🟠 HIGH | vercel.json redirect destinations using wildcards must be restricted to the same domain. |
| AGNT_001 | `agent_no_scope_declared` | 🟠 HIGH | No .thesmos/scope.json found — agent file and network boundaries are undeclared. |
| AGNT_002 | `agent_no_token_budget` | 🟠 HIGH | No tokenBudget configured — agent sessions have no cost ceiling. |
| AGNT_003 | `agent_unrestricted_bash` | 🔴 BLOCKER | .claude/settings.json has no bash deny patterns — agent can run arbitrary shell commands. |
| AGNT_004 | `agent_no_hook_governance` | 🟡 MEDIUM | No PreToolUse hooks installed for Write/Edit operations — agent writes are ungoverned. |
| AGNT_005 | `agent_mcp_server_unverified` | 🟠 HIGH | MCP server registered without a pinned version or integrity hash — supply chain risk. |
| AGNT_006 | `agent_tool_permissions_too_broad` | 🟡 MEDIUM | No tool allow/deny list configured — agent has implicit access to all tools. |
| AGNT_007 | `agent_prompt_no_constraints` | 🟠 HIGH | CLAUDE.md has no behavioral constraints section — agent behavior is unconstrained. |
| AGNT_008 | `agent_data_access_unpinned` | 🟠 HIGH | scope.json has no allowedPaths — agent can access all files in the repo. |
| AGNT_009 | `agent_sub_agent_ungoverned` | 🟠 HIGH | Agent spawning (Agent tool) is not mentioned in governance config — sub-agents are ungoverned. |
| AGNT_010 | `agent_no_audit_trail` | 🟡 MEDIUM | No .thesmos/audit.jsonl found — agent actions are not being logged. |
| AGNT_011 | `agent_session_timeout_missing` | 🔵 LOW | No maxSessionMinutes configured — agent sessions can run indefinitely. |
| AGNT_012 | `agent_network_unrestricted` | 🟡 MEDIUM | No allowedNetworkHosts in scope.json — agent can make unrestricted network calls. |
| AGNT_013 | `agent_no_hard_token_cap` | 🔴 BLOCKER | Agent loop uses alert/warn on token usage but has no hard stop — cost runaway if alert is ignored. |
| AGNT_014 | `agent_no_iteration_limit` | 🔴 BLOCKER | Agent autopilot config has no maxIterationsPerTask — tasks can loop indefinitely. |
| AGNT_015 | `agent_no_cost_cap` | 🟠 HIGH | Autopilot config has no maxCostUSD — no financial ceiling on agent sessions. |
| AGNT_016 | `agent_no_abort_controller` | 🟠 HIGH | Agent tool chain has no AbortController — long-running tool calls cannot be cancelled. |
| AGNT_017 | `agent_no_human_approval_gate` | 🟠 HIGH | Agent can perform destructive or high-cost operations without human-in-the-loop approval. |
| AGNT_018 | `agent_sub_agent_budget_not_inherited` | 🟡 MEDIUM | Sub-agent spawn config does not propagate the parent's token/cost budget. |
| AGNT_019 | `agent_no_failure_circuit_breaker` | 🟡 MEDIUM | Agent loop retries failed tool calls without a consecutive failure circuit breaker. |
| AGNT_020 | `agent_no_cost_metrics` | 🟡 MEDIUM | No cost/token metric export configured — agent spend is invisible to monitoring. |
| AGNT_021 | `agent_no_daily_spend_cap` | 🟡 MEDIUM | No daily or weekly spend cap configured — multiple session overruns can compound costs. |
| AGNT_022 | `agent_battery_runaway_risk` | 🔵 LOW | Autopilot can run when the machine is on battery — risks unintended overnight runs. |
| DEP_001 | `dep_critical_cve` | 🔴 BLOCKER | Dependency has a CRITICAL CVE — immediate upgrade required. |
| DEP_002 | `dep_high_cve` | 🟠 HIGH | Dependency has a HIGH severity CVE. |
| DEP_003 | `dep_medium_cve` | 🟡 MEDIUM | Dependency has a MEDIUM severity CVE. |
| DEP_004 | `dep_abandoned_with_cve` | 🟠 HIGH | Dependency not updated in 2+ years AND has a known CVE — no fix expected. |
| DEP_005 | `dep_no_integrity` | 🟡 MEDIUM | package-lock.json entries are missing integrity hashes — supply chain risk. |
| DEP_006 | `dep_git_dependency` | 🟠 HIGH | Dependency points to a git URL instead of a semver version — no integrity guarantee. |
| DEP_007 | `dep_major_version_drift` | 🔵 LOW | Dependency is more than 2 major versions behind latest. |
| DEP_008 | `dep_prerelease_in_prod` | 🟡 MEDIUM | Pre-release (alpha/beta/rc) dependency in production dependencies. |
| DEP_009 | `dep_deprecated_package` | 🟡 MEDIUM | Dependency is npm-deprecated — maintainer recommends replacement. |
| DEP_010 | `dep_cache_stale` | 🔵 LOW | .thesmos/dep-cache.json is older than 24 hours — CVE data may be outdated. |
| LIC_001 | `lic_gpl_in_commercial` | 🔴 BLOCKER | GPL/AGPL dependency found in a project with a commercial or permissive license — copyleft contamination. |
| LIC_002 | `lic_unknown_license` | 🟠 HIGH | Dependency has UNLICENSED or missing license — cannot determine usage rights. |
| LIC_003 | `lic_copyleft_dependency` | 🟡 MEDIUM | LGPL dependency requires attribution and limited linking rules. |
| LIC_004 | `lic_no_project_license` | 🟠 HIGH | No LICENSE file found in project root — open source obligations unclear. |
| LIC_005 | `lic_proprietary_dependency` | 🟠 HIGH | Dependency uses a proprietary or non-open-source license. |
| LIC_006 | `lic_spdx_invalid` | 🔵 LOW | package.json "license" field is not a valid SPDX identifier. |
| LIC_007 | `lic_dual_license_ambiguous` | 🔵 LOW | Dependency uses dual "OR" license without specifying which applies to your project. |
| LIC_008 | `lic_ai_training_restriction` | 🟡 MEDIUM | Dependency license restricts AI training use — conflicts with AI-assisted development. |
| LIC_009 | `lic_license_mismatch` | 🔴 BLOCKER | Project is open source (GPL) but has a permissive dep that conflicts with GPL requirements. |
| LIC_010 | `lic_missing_attribution` | 🔵 LOW | Project uses MIT/BSD dependencies but has no THIRD_PARTY_LICENSES or NOTICE file. |
| GDPR_001 | `gdpr_pii_in_console_log` | 🟠 HIGH | console.log appears to log PII (email/phone/name adjacent variables). |
| GDPR_002 | `gdpr_analytics_no_consent` | 🟠 HIGH | Analytics library initialized without a consent check — GDPR opt-in required. |
| GDPR_003 | `gdpr_cookie_no_banner` | 🟠 HIGH | document.cookie set without adjacent consent check. |
| GDPR_004 | `gdpr_pii_in_url_params` | 🟠 HIGH | PII found in URL query parameters — violates data minimization and logs in server access logs. |
| GDPR_005 | `gdpr_pii_in_localStorage` | 🟠 HIGH | PII stored in localStorage without encryption — accessible to any JavaScript on the page. |
| GDPR_006 | `gdpr_no_data_deletion_endpoint` | 🟡 MEDIUM | No user/account DELETE route found — GDPR Article 17 "right to erasure" may not be implemented. |
| GDPR_007 | `gdpr_pii_in_logs_external` | 🔴 BLOCKER | PII sent to external logging service (Sentry/Datadog/LogRocket) — third-party data transfer. |
| GDPR_008 | `gdpr_pii_unencrypted_db_column` | 🟡 MEDIUM | Prisma/ORM schema has PII fields (email/phone) without encryption annotation. |
| GDPR_009 | `gdpr_no_privacy_policy_link` | 🔵 LOW | No /privacy route or link found in changed pages — GDPR requires accessible privacy policy. |
| GDPR_010 | `gdpr_third_party_no_consent` | 🟠 HIGH | Third-party tracking script loaded without consent wrapper. |
| GDPR_011 | `gdpr_pii_in_error_response` | 🔴 BLOCKER | API error response may include user object fields — PII leak via error messages. |
| GDPR_012 | `gdpr_no_retention_policy` | 🟡 MEDIUM | No data retention policy declaration found in codebase. |
| GDPR_013 | `gdpr_session_no_expiry` | 🟡 MEDIUM | Session cookie configured without maxAge or expires — session may persist indefinitely. |
| GDPR_014 | `gdpr_pii_in_test_fixtures` | 🟠 HIGH | Test fixtures contain real-looking email or phone numbers — use synthetic data. |
| GDPR_015 | `gdpr_ip_stored_without_consent` | 🟡 MEDIUM | IP address stored to database — under GDPR, IP is considered personal data. |
| MCP_001 | `mcp_tool_description_injection` | 🔴 BLOCKER | MCP tool description contains instruction-like patterns — potential tool poisoning (CVE-2025-54136). |
| MCP_002 | `mcp_response_as_instructions` | 🔴 BLOCKER | MCP server response passed directly into a prompt or eval — enables indirect prompt injection. |
| MCP_003 | `mcp_tool_output_exec` | 🔴 BLOCKER | MCP tool output passed directly to exec/eval/spawn — remote code execution if server is compromised. |
| MCP_004 | `mcp_no_server_allowlist` | 🟠 HIGH | MCP server registered from external/untrusted source without an integrity check. |
| MCP_005 | `mcp_destructive_no_gate` | 🟠 HIGH | MCP tool performs a destructive action (delete/drop/truncate/destroy) without a confirmation gate. |
| MCP_006 | `mcp_server_no_auth` | 🟠 HIGH | MCP server implementation exposes tools without authentication. |
| MCP_007 | `mcp_cursor_rules_injection` | 🔴 BLOCKER | .cursor/rules or .cursorrules file contains shell execution or key exfiltration pattern (CVE-2025-54135). |
| MCP_008 | `mcp_cursor_rules_external_url` | 🟠 HIGH | .cursor/rules file fetches instructions from an external URL — enables dynamic instruction injection. |
| MCP_009 | `mcp_no_audit_logging` | 🟡 MEDIUM | MCP tool invocations are not logged — no audit trail for agent actions. |
| MCP_010 | `mcp_tool_path_traversal` | 🟠 HIGH | MCP tool accepts a file path parameter without path sanitization — directory traversal risk. |
| MCP_011 | `mcp_no_call_depth_limit` | 🟡 MEDIUM | Recursive agent tool chain has no call depth limit — infinite loop / runaway cost risk. |
| MCP_012 | `mcp_elevated_credentials` | 🟠 HIGH | MCP server uses service-role or admin credentials — violates least-privilege. |
| MCP_013 | `mcp_no_result_validation` | 🟠 HIGH | MCP tool call result used without schema validation — type confusion and injection risk. |
| MCP_014 | `mcp_user_content_in_context` | 🟡 MEDIUM | User-supplied content concatenated into agent context without explicit data/instruction separation. |
| MCP_015 | `mcp_server_no_tls` | 🟡 MEDIUM | MCP server configured with HTTP (not HTTPS) URL — tool calls sent in plaintext. |
| MCP_016 | `mcp_no_tool_allowlist` | 🟠 HIGH | Agent invokes MCP tools by name from a variable without checking against a permitted allowlist. |
| MCP_017 | `mcp_readme_injection` | 🟠 HIGH | README or source comment contains AI-targeted instructions designed to manipulate coding agents. |
| MCP_018 | `mcp_no_circuit_breaker` | 🟡 MEDIUM | MCP tool call in retry loop without a circuit breaker — retry storm on server failure. |
| MCP_019 | `mcp_param_db_injection` | 🔴 BLOCKER | MCP tool parameter used directly in a database query — SQL/NoSQL injection risk. |
| MCP_020 | `mcp_context_unbounded` | 🟡 MEDIUM | Agent context window populated from external source without size limit — cost runaway risk. |
| RAG_001 | `rag_unsanitized_document_ingest` | 🔴 BLOCKER | Vector store accepts user-submitted documents without content sanitization — RAG poisoning risk. |
| RAG_002 | `rag_retrieved_content_as_instructions` | 🔴 BLOCKER | Retrieved RAG content injected into prompt without data/instruction boundary — indirect prompt injection. |
| RAG_003 | `rag_no_tenant_isolation` | 🟠 HIGH | Vector store query has no metadata filter for tenant/user isolation — cross-tenant data leak. |
| RAG_004 | `rag_no_similarity_threshold` | 🟠 HIGH | Vector retrieval has no similarity threshold — irrelevant or adversarial documents always returned. |
| RAG_005 | `rag_vector_store_public_write` | 🔴 BLOCKER | Vector store write endpoint has no authentication — anyone can poison the knowledge base. |
| RAG_006 | `rag_embedding_unbounded_input` | 🟠 HIGH | Embedding model called with unbounded input length — token exhaustion and cost runaway. |
| RAG_007 | `rag_no_output_validation` | 🟠 HIGH | RAG pipeline output returned to user without validation — hallucination or injected content presented as fact. |
| RAG_008 | `rag_no_rate_limit` | 🟠 HIGH | Vector store query endpoint has no rate limiting — vector DB exhaustion and cost runaway. |
| RAG_009 | `rag_llm_citation_unvalidated` | 🟠 HIGH | LLM-generated citation URLs displayed to users without validation — hallucinated link risk. |
| RAG_010 | `rag_embedding_model_unpinned` | 🟡 MEDIUM | Embedding model not pinned to a specific version — semantic drift on model update breaks retrieval. |
| RAG_011 | `rag_no_document_provenance` | 🟡 MEDIUM | Documents added to vector store without source/provenance metadata — cannot trace or revoke poisoned content. |
| RAG_012 | `rag_user_query_injection` | 🟠 HIGH | User query used directly as vector store filter expression — NoSQL/vector injection risk. |
| RAG_013 | `rag_context_window_unbounded` | 🟠 HIGH | RAG context window not bounded — large retrieval results cause cost runaway and context overflow. |
| RAG_014 | `rag_training_data_no_provenance` | 🟡 MEDIUM | Model fine-tuning or training pipeline accepts documents without provenance validation — OWASP LLM04. |
| RAG_015 | `rag_namespace_missing` | 🟡 MEDIUM | Vector store query missing namespace isolation — production and staging data may intermingle. |
| WS_001 | `ws_no_upgrade_auth` | 🔴 BLOCKER | WebSocket upgrade handler has no authentication check — any client can open a connection. |
| WS_002 | `ws_message_no_auth` | 🔴 BLOCKER | WebSocket message handler processes commands without per-message authorization check. |
| WS_003 | `ws_no_origin_check` | 🟠 HIGH | WebSocket server has no Origin header validation — cross-origin WebSocket hijacking risk. |
| WS_004 | `ws_no_heartbeat_timeout` | 🟠 HIGH | WebSocket connection has no heartbeat/ping or idle timeout — zombie connections exhaust server resources. |
| WS_005 | `ws_message_size_unbounded` | 🟠 HIGH | WebSocket message handler accepts messages without payload size limit — memory exhaustion DoS. |
| WS_006 | `ws_message_no_schema_validation` | 🟠 HIGH | WebSocket message handler parses JSON without schema validation before processing. |
| WS_007 | `ws_token_in_url` | 🟠 HIGH | Authentication token passed in WebSocket URL query string — logged by proxies and web servers. |
| WS_008 | `ws_broadcast_no_room_check` | 🟠 HIGH | WebSocket broadcast sends sensitive data to all connected clients without room/tenant isolation. |
| WS_009 | `ws_error_stack_exposed` | 🟡 MEDIUM | WebSocket error handler sends stack trace or error details to the client. |
| WS_010 | `ws_no_message_rate_limit` | 🟡 MEDIUM | WebSocket message handler has no per-connection rate limiting — message flood DoS. |
| WS_011 | `ws_no_max_connections` | 🟡 MEDIUM | WebSocket server has no maximum concurrent connection limit per user — resource exhaustion. |
| WS_012 | `ws_reconnect_no_backoff` | 🟡 MEDIUM | WebSocket client reconnect logic has no exponential backoff — thundering herd on server restart. |
| PROTO_001 | `prototype_pollution_recursive_merge` | 🔴 BLOCKER | Recursive object merge without __proto__/constructor/prototype key guard — prototype pollution. |
| PROTO_002 | `prototype_pollution_for_in_assign` | 🟠 HIGH | for...in loop over user-supplied object assigns properties to target without key sanitization. |
| PROTO_003 | `prototype_pollution_lodash_merge` | 🟠 HIGH | lodash.merge() called with unvalidated user input — known prototype pollution CVEs. |
| PROTO_004 | `prototype_pollution_defaults_deep` | 🟠 HIGH | lodash.defaultsDeep() with user input — recursive merge prototype pollution. |
| PROTO_005 | `prototype_pollution_json_parse_assign` | 🟠 HIGH | JSON.parse() result used as source in Object.assign without sanitization. |
| PROTO_006 | `prototype_pollution_qs_parse` | 🟡 MEDIUM | qs.parse() with user input and allowDots not disabled — nested object prototype pollution. |
| PROTO_007 | `prototype_pollution_null_prototype_missing` | 🟡 MEDIUM | Object used as a hash map without Object.create(null) — inherits prototype properties. |
| PROTO_008 | `prototype_pollution_express_body_deep` | 🟠 HIGH | Express body-parser with extended: true parses deeply nested objects from user input — pollution vector. |
| PROTO_009 | `prototype_pollution_has_own_missing` | 🟡 MEDIUM | Property access on user-supplied object without hasOwnProperty check — inherited property confusion. |
| PROTO_010 | `prototype_pollution_spread_user` | 🟠 HIGH | Spreading user input directly into an object literal without validation — prototype pollution via __proto__. |
| JWT_001 | `jwt_hardcoded_fallback_secret` | 🔴 BLOCKER | JWT secret has a hardcoded fallback string — any key derived from the fallback is compromised. |
| JWT_002 | `jwt_no_algorithm_pin` | 🔴 BLOCKER | JWT verified without pinning the algorithm — allows alg:none and RS256→HS256 confusion attacks. |
| JWT_003 | `jwt_refresh_token_localstorage` | 🟠 HIGH | Refresh token stored in localStorage — accessible to any JavaScript on the page (XSS theft). |
| JWT_004 | `jwt_no_expiry` | 🟠 HIGH | JWT signed without an expiry (expiresIn) — tokens are valid forever if compromised. |
| JWT_005 | `jwt_oauth_missing_state` | 🟠 HIGH | OAuth callback handler does not validate the state parameter — CSRF on OAuth flow. |
| JWT_006 | `jwt_social_login_no_reauth` | 🟠 HIGH | Social login account linking performed without re-authentication of the existing account. |
| JWT_007 | `jwt_sensitive_payload` | 🟡 MEDIUM | JWT payload includes sensitive data (password, email, SSN, credit card) — tokens are base64 encoded, not encrypted. |
| AUTH_008 | `auth_client_only_guard` | 🔴 BLOCKER | Authentication check exists only in a client component — bypassable with browser dev tools. |
| AUTH_009 | `auth_idor_numeric_id` | 🟠 HIGH | API route exposes sequential numeric ID without ownership verification — IDOR enumeration risk. |
| AUTH_010 | `auth_brute_force_unprotected` | 🟠 HIGH | Login or password-reset endpoint has no rate limiting or brute-force protection. |
| AUTH_011 | `auth_password_reset_reuse` | 🟠 HIGH | Password reset token not deleted after use — allows replay attacks for unlimited resets. |
| AUTH_012 | `auth_session_no_revalidation` | 🟡 MEDIUM | Route handler uses getServerSession() result without re-validating it against the database. |
| AUTH_013 | `auth_uuid_not_used` | 🟠 HIGH | Auto-increment integer ID used as public resource identifier — IDOR enumeration attack surface. |
| SC_001 | `sc_git_dependency_url` | 🟠 HIGH | package.json dependency with git:, github:, or http: URL — unpinned and unaudited source. |
| SC_002 | `sc_missing_lockfile` | 🔴 BLOCKER | package.json present without a lockfile — dependencies are not pinned. |
| SC_003 | `sc_postinstall_network_fetch` | 🔴 BLOCKER | postinstall/preinstall script fetches from network at install time — potential supply-chain attack vector. |
| SC_004 | `sc_npmrc_http_registry` | 🟠 HIGH | .npmrc registry URL uses http:// — package downloads are unencrypted and cannot be verified. |
| SC_005 | `sc_no_engines_field` | 🟡 MEDIUM | package.json missing engines field — any Node.js version is accepted, including insecure EOL versions. |
| SC_006 | `sc_npm_publish_no_provenance` | 🟠 HIGH | CI npm publish step without --provenance flag — package has no cryptographic build attestation. |
| SC_007 | `sc_curl_pipe_bash` | 🟡 MEDIUM | curl | bash or wget | sh pattern — downloads and executes arbitrary code from the internet. |
| SC_008 | `sc_no_files_field` | 🟠 HIGH | package.json has no "files" field — the entire directory (including source, tests, and .env files) is published to npm. |
| SC_009 | `sc_lockfile_non_standard_registry` | 🟠 HIGH | Lockfile contains a "resolved" URL pointing to a non-standard registry. |
| SC_010 | `sc_package_json_git_protocol` | 🟠 HIGH | package.json dependency uses git:// protocol (not git+https://) — unauthenticated and potentially interceptable. |
| DAST_001 | `dast_xml_entity_expansion` | 🔴 BLOCKER | XML parser called without entity expansion protection — vulnerable to XXE and billion-laughs attacks. |
| DAST_002 | `dast_cors_wildcard_with_auth` | 🟠 HIGH | Access-Control-Allow-Origin: * set on a route that also performs authentication — CORS wildcard bypasses same-origin protection. |
| DAST_003 | `dast_missing_helmet` | 🟡 MEDIUM | Express/Fastify app without helmet() middleware — missing default security headers (CSP, HSTS, X-Frame-Options, etc.). |
| DAST_004 | `dast_sensitive_param_in_get` | 🟠 HIGH | Sensitive parameter name (password, token, secret, key, api_key) appears in a GET route path or query handler. |
| DAST_005 | `dast_eval_user_input` | 🔴 BLOCKER | User-controlled input passed to eval(), new Function(), or vm.runInContext() — remote code execution risk. |
| DAST_006 | `dast_no_xframe_options` | 🟡 MEDIUM | Server file sets response headers but does not set X-Frame-Options — clickjacking protection missing. |
| DAST_007 | `dast_method_override` | 🟡 MEDIUM | X-HTTP-Method-Override or _method parameter processed without an authentication check nearby. |
| DAST_008 | `dast_template_injection` | 🔴 BLOCKER | Template engine render called with user-controlled template string — Server-Side Template Injection (SSTI) risk. |
| DAST_009 | `dast_prototype_pollution_express` | 🟠 HIGH | Express body-parser configured with extended: true — enables prototype pollution via qs library. |
| DAST_010 | `dast_http_response_splitting` | 🟠 HIGH | User input used directly in a response header value — HTTP response splitting / header injection risk. |
| K8S_001 | `k8s_no_resource_limits` | 🟠 HIGH | Kubernetes container spec without resources.limits — pod can consume unbounded CPU/memory. |
| K8S_002 | `k8s_run_as_root` | 🟠 HIGH | Kubernetes pod or container securityContext allows running as root. |
| K8S_003 | `k8s_privileged_container` | 🔴 BLOCKER | Kubernetes container runs with privileged: true — equivalent to root access on the host node. |
| K8S_004 | `k8s_host_pid_or_network` | 🟠 HIGH | Pod spec uses hostPID: true or hostNetwork: true — shares host process or network namespace. |
| K8S_005 | `k8s_secret_as_env_literal` | 🔴 BLOCKER | Kubernetes secret value appears as a literal string in env: rather than using secretKeyRef. |
| K8S_006 | `k8s_no_readiness_probe` | 🟡 MEDIUM | Kubernetes Deployment container without a readinessProbe — traffic is sent before the app is ready. |
| K8S_007 | `k8s_image_pull_policy_never` | 🟠 HIGH | Container imagePullPolicy: Never — image won't be refreshed, running stale/vulnerable versions. |
| K8S_008 | `k8s_no_security_context` | 🟡 MEDIUM | Kubernetes container spec with no securityContext block — missing explicit privilege controls. |
| K8S_009 | `k8s_compose_no_healthcheck` | 🟡 MEDIUM | Docker Compose service missing healthcheck — container assumed healthy immediately on start. |
| K8S_010 | `k8s_latest_tag` | 🟠 HIGH | Kubernetes manifest references an image with :latest tag — deployment is not reproducible. |
| SELF_001 | `self_version_behind` | 🟠 HIGH | Installed thesmos-governance is behind the latest npm release by ≥ 1 minor version. |
| SELF_002 | `self_version_patch_behind` | 🟡 MEDIUM | thesmos-governance pinned to an exact version without caret or tilde — patch updates blocked. |
| SELF_003 | `self_broken_hook` | 🟠 HIGH | Git hook installed by Thesmos references thesmos-governance but the package may not be installed. |
| SELF_004 | `self_config_schema_old` | 🟠 HIGH | .thesmos/config.json uses an old schema (missing required fields from the current version). |
| SELF_005 | `self_stale_adapter` | 🟡 MEDIUM | CLAUDE.md or AGENTS.md references a thesmos-governance version that is older than the currently installed version. |
| SELF_006 | `self_stale_context` | 🟡 MEDIUM | .thesmos/context.md (or context snapshot) was generated more than 7 days ago. |
| SELF_007 | `self_stale_brain` | 🟡 MEDIUM | .thesmos/brain.md was generated more than 3 days ago — Thesmos's institutional memory is stale. |
| SELF_008 | `self_ci_pinned_old_version` | 🔵 LOW | GitHub Actions workflow pins thesmos-governance to an old version via npx or npm install. |
| SELF_009 | `self_orphaned_suppression` | 🟡 MEDIUM | Suppression comment references a rule ID that does not exist in the current rule set. |
| SELF_010 | `self_not_in_devdeps` | 🔵 LOW | thesmos-governance is not in devDependencies — it is installed globally, making the version uncontrolled. |
<!-- THESMOS:GENERATED END model -->
