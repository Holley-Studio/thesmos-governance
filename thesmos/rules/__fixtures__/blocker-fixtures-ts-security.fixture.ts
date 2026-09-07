// @vitest-environment node
/**
 * Extended BLOCKER fixture data — TypeScript/JavaScript security rules.
 * Patterns assembled at runtime to avoid triggering the governance guard.
 * OBFUSCATION is intentional and required — the assembled strings are the
 * real triggering payloads.
 *
 * IMPORTANT: obfuscation must be concatenated at the TypeScript level, OUTSIDE
 * the quotes. Writing "'use cli' + 'ent'" inside a string literal yields the
 * literal text `'use cli' + 'ent'` as fixture content, which no rule matches —
 * that bug silently disabled several fixtures. Use the USE_CLIENT constant.
 */
import type { ExtendedFixture } from './blocker-fixture-harness.test.js';

// Assemble eval: eval
const EVAL_FN = 'ev' + 'al';

// Assemble backtick template interpolation: `...${expr}`
const BT = String.fromCharCode(96);
const INTERP_OPEN = '\x24{';
const INTERP_CLOSE = '}';

// Assembles to the client-component directive without the contiguous literal.
const USE_CLIENT = "'use cli" + "ent';";

export const EXTENDED_FIXTURES: ExtendedFixture[] = [
  // ── SEC_002 — rls_disabled ────────────────────────────────────────────────
  // Fires on SQL migration files that contain ALTER TABLE ... DISABLE ROW LEVEL SECURITY
  {
    ruleId: 'SEC_002',
    fixtureExt: 'sql',
    fixturePathHint: 'migration',
    positiveFixture: 'ALTER TABLE users DISABLE ROW LEVEL SECURITY;',
    negativeFixture: 'ALTER TABLE users ENABLE ROW LEVEL SECURITY;',
  },
  // ── SEC_018 — password_in_url ─────────────────────────────────────────────
  {
    ruleId: 'SEC_018',
    positiveFixture: "fetch('https://api.example.com?api_key=hardcodedkey123');",
    negativeFixture: "fetch('https://api.example.com', { headers: { Authorization: 'Bearer ' + key } });",
  },
  // ── SEC_021 — mass_assignment ─────────────────────────────────────────────
  {
    ruleId: 'SEC_021',
    fixturePathHint: 'api',
    positiveFixture: 'await prisma.user.update({ where: { id }, data: req.body });',
    negativeFixture: 'const { name, bio } = req.body; await prisma.user.update({ where: { id }, data: { name, bio } });',
  },
  // ── SEC_022 — cors_wildcard_header ────────────────────────────────────────
  // NOTE: detect() matches the cors({ origin: '*' }) middleware form. The
  // equivalent res.setHeader('Access-Control-Allow-Origin', '*') form is NOT
  // detected — recorded as a coverage gap in the proof-gate ledger §2.4.
  {
    ruleId: 'SEC_022',
    fixturePathHint: 'api',
    positiveFixture: "app.use(cors({ origin: '*' }));",
    negativeFixture: "app.use(cors({ origin: 'https://myapp.com' }));",
  },
  // ── SEC_024 — insecure_deserialization ────────────────────────────────────
  // Assembled to avoid guard triggering on eval
  {
    ruleId: 'SEC_024',
    positiveFixture: EVAL_FN + '(req.body.code);',
    negativeFixture: 'const handlers = { fn1, fn2 }; handlers[req.body.name]();',
  },
  // ── SEC_025 — file_upload_path_traversal ──────────────────────────────────
  {
    ruleId: 'SEC_025',
    fixturePathHint: 'upload',
    positiveFixture: 'const dest = path.join(uploadDir, req.file.originalname);',
    negativeFixture: 'const dest = path.join(uploadDir, randomUUID() + path.extname(req.file.originalname));',
  },
  // ── SEC_027 — jwt_secret_weak ─────────────────────────────────────────────
  // Assembled: jwt.sign(payload, 'secret') — split the string literal 'secret'
  {
    ruleId: 'SEC_027',
    positiveFixture: "jwt.sign(payload, 'sec' + 'ret');",
    negativeFixture: 'jwt.sign(payload, process.env.JWT_SECRET);',
  },
  // ── SEC_029 — xxe_vulnerability ───────────────────────────────────────────
  {
    ruleId: 'SEC_029',
    positiveFixture: 'xml2js.parseString(userXml);',
    negativeFixture: 'new XMLParser({ processEntities: false }).parse(userXml);',
  },
  // ── SEC_033 — xss_via_href ────────────────────────────────────────────────
  {
    ruleId: 'SEC_033',
    fixtureExt: 'tsx', // JSX content — the rule only scans JSX-capable extensions.
    positiveFixture: '<a href={userInput}>click</a>',
    // NOTE: encodeURIComponent does NOT prevent javascript:-scheme XSS, so the
    // previous negative was an invalid mitigation. A literal https URL is the
    // only form this rule accepts — see the SEC_033 gap in the proof-gate ledger.
    negativeFixture: '<a href={"https://example.com"}>click</a>',
  },
  // ── SEC_035 — password_not_hashed ─────────────────────────────────────────
  // detect() matches direct assignment of a plaintext password field.
  {
    ruleId: 'SEC_035',
    positiveFixture: 'user.password = req.body.password;',
    negativeFixture: 'user.passwordHash = await bcrypt.hash(req.body.password, 12);',
  },
  // ── SEC_037 — prototype_pollution_merge ───────────────────────────────────
  // detect() matches Object.assign with an unvalidated request body.
  {
    ruleId: 'SEC_037',
    positiveFixture: 'Object.assign(options, req.body);',
    negativeFixture: 'const safe = schema.parse(req.body); Object.assign(options, safe);',
  },
  // ── SEC_038 — cors_reflected_origin ───────────────────────────────────────
  {
    ruleId: 'SEC_038',
    fixturePathHint: 'api',
    positiveFixture: "res.setHeader('Access-Control-Allow-Origin', req.headers.origin);",
    negativeFixture: "const allowed = ['https://app.com']; res.setHeader('Access-Control-Allow-Origin', allowed.includes(req.headers.origin) ? req.headers.origin : '');",
  },
  // ── SEC_039 — cors_wildcard_with_credentials ──────────────────────────────
  {
    ruleId: 'SEC_039',
    fixturePathHint: 'api',
    positiveFixture: "app.use(cors({ origin: '*', credentials: true }));",
    negativeFixture: "app.use(cors({ origin: 'https://app.com', credentials: true }));",
  },
  // ── SEC_044 — ssrf_private_ip_range ──────────────────────────────────────
  {
    ruleId: 'SEC_044',
    fixturePathHint: 'api',
    positiveFixture: 'const data = await fetch(req.body.url); return data.json();',
    negativeFixture: 'if (isPrivateIp(new URL(req.body.url).hostname)) throw new Error(); const data = await fetch(req.body.url);',
  },
  // ── SEC_045 — path_traversal_encoding_bypass ─────────────────────────────
  // detect() matches the naive '../' substring check, which is bypassed by
  // percent-encoding (..%2F).
  {
    ruleId: 'SEC_045',
    positiveFixture: "if (filePath.includes('../')) throw new Error('bad path');",
    negativeFixture: "const safe = path.basename(decodeURIComponent(req.params.path));",
  },
  // ── AUTH_007 — missing_auth_middleware ────────────────────────────────────
  {
    ruleId: 'AUTH_007',
    fixturePathHint: 'api-admin',
    positiveFixture: "router.get('/admin/users', listAllUsers);",
    negativeFixture: "router.get('/admin/users', requireAdminRole, listAllUsers);",
  },
  // ── AUTH_008 — auth_client_only_guard ─────────────────────────────────────
  // Canonical definition. (A duplicate previously existed in the ai-agents
  // fixture module; the harness ran both and one rule consumed two slots.)
  {
    ruleId: 'AUTH_008',
    fixtureExt: 'tsx',
    positiveFixture:
      USE_CLIENT + '\nexport default function Dashboard() {\n' +
      '  const { session } = useSession();\n' +
      '  if (!session) return null;\n}',
    negativeFixture: '// Server component — session validated on the server before render',
  },
  // ── GIT_001 — merge_conflict_markers ─────────────────────────────────────
  {
    ruleId: 'GIT_001',
    positiveFixture: '<<<<<<< HEAD\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> feature',
    negativeFixture: 'const x = 1; // resolved',
  },
  // ── GIT_002 — env_file_committed ──────────────────────────────────────────
  {
    ruleId: 'GIT_002',
    fixtureFilePath: '.env',
    positiveFixture: 'DATABASE_URL=postgres://user:pass@host/db',
    negativeFixture: '# Copy from .env.example and fill in values',
  },
  // ── NODE_001 — path_traversal ─────────────────────────────────────────────
  {
    ruleId: 'NODE_001',
    positiveFixture: 'fs.readFile(path.join(BASE_DIR, req.params.filename));',
    negativeFixture: 'fs.readFile(path.join(BASE_DIR, path.basename(req.params.filename)));',
  },
  // ── NODE_004 — prototype_pollution_assign ─────────────────────────────────
  {
    ruleId: 'NODE_004',
    positiveFixture: 'const options = Object.assign({}, req.body);',
    negativeFixture: 'const options = Object.assign({}, schema.parse(req.body));',
  },
  // ── NODE_005 — child_process_shell_injection ──────────────────────────────
  // Template literal exec with user input — assembled to avoid guard
  {
    ruleId: 'NODE_005',
    positiveFixture: BT + 'import { exec } from "child_process";\nexec(' + BT + 'convert ' + INTERP_OPEN + 'req.files[0].path' + INTERP_CLOSE + ' output.png' + BT + ', { shell: true });' + BT,
    negativeFixture: "execFile('convert', [req.files[0].path, 'output.png']);",
  },
  // ── NODE_007 — tls_verification_disabled ──────────────────────────────────
  {
    ruleId: 'NODE_007',
    positiveFixture: 'https.get(url, { rejectUnauthorized: false }, callback);',
    negativeFixture: 'https.get(url, callback);',
  },
  // ── NODE_008 — jwt_algorithm_none ─────────────────────────────────────────
  // NOTE: detect() fires when the `algorithms` option is ABSENT. An explicit
  // `algorithms: ['none']` — the actual alg=none attack — is NOT detected.
  // Recorded as a coverage gap in the proof-gate ledger §2.4.
  {
    ruleId: 'NODE_008',
    positiveFixture: 'jwt.verify(token, secret);',
    negativeFixture: "jwt.verify(token, secret, { algorithms: ['HS256'] });",
  },
  // ── NODE_015 — yaml_unsafe_load ───────────────────────────────────────────
  {
    ruleId: 'NODE_015',
    positiveFixture: 'const data = yaml.load(fs.readFileSync(configFile, "utf8"));',
    negativeFixture: 'const data = yaml.load(content, { schema: yaml.JSON_SCHEMA });',
  },
  // ── NODE_019 — sql_injection ──────────────────────────────────────────────
  // Template string with user input interpolated into a query call — assembled.
  {
    ruleId: 'NODE_019',
    positiveFixture:
      'db.query(' + BT + 'SELECT * FROM users WHERE id = ' + INTERP_OPEN + 'req.params.id' + INTERP_CLOSE + BT + ');',
    negativeFixture: "db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);",
  },
  // ── NODE_023 — env_secret_hardcoded ──────────────────────────────────────
  // Assembled: 'sk_live_' + 'abc123xyz'
  {
    ruleId: 'NODE_023',
    positiveFixture: "const API_KEY = 'sk_live_' + 'abc123xyz';",
    negativeFixture: 'const API_KEY = process.env.API_KEY;',
  },
  // ── NODE_030 — ssrf_unvalidated_url ──────────────────────────────────────
  {
    ruleId: 'NODE_030',
    fixturePathHint: 'api',
    positiveFixture: 'const data = await fetch(req.body.webhookUrl);',
    negativeFixture: 'const url = new URL(req.body.url); if (!isAllowed(url)) throw new Error(); await fetch(url);',
  },
  // ── IMPORT_005 — server_module_in_client ──────────────────────────────────
  // detect() matches node: builtin imports inside a client component.
  {
    ruleId: 'IMPORT_005',
    fixtureExt: 'tsx',
    positiveFixture: USE_CLIENT + "\nimport { readFileSync } from 'node:fs';",
    negativeFixture: "// Server Component — no client directive, server imports are legal here",
  },
  // ── VIBE_020 — vibe_missing_output_encoding ───────────────────────────────
  // detect() matches unescaped interpolation into an HTML template string.
  {
    ruleId: 'VIBE_020',
    positiveFixture:
      'function emailBody(user) {\n  return ' + BT + '<p>Hello ' + INTERP_OPEN + 'user.name' + INTERP_CLOSE + '</p>' + BT + ';\n}',
    // The sanitizer allowlist is exactly: esc( | escape( | encodeHTML( | sanitize(
    negativeFixture:
      'function emailBody(user) {\n  return ' + BT + '<p>Hello ' + INTERP_OPEN + 'sanitize(user.name)' + INTERP_CLOSE + '</p>' + BT + ';\n}',
  },
  // ── API_004 — password_in_api_response ────────────────────────────────────
  {
    ruleId: 'API_004',
    fixturePathHint: 'api',
    positiveFixture: 'return res.json(await db.user.findUnique({ where: { id } }));',
    negativeFixture: 'const { passwordHash, ...safe } = await db.user.findUnique({ where: { id } }); return res.json(safe);',
  },
  // ── API_008 — api_key_in_client_request ───────────────────────────────────
  {
    ruleId: 'API_008',
    fixtureExt: 'tsx',
    positiveFixture:
      USE_CLIENT + '\nconst key = process.env.NEXT_PUBLIC_OPENAI_KEY;\n' +
      "await fetch('/api', { headers: { Authorization: key } });",
  },
];
