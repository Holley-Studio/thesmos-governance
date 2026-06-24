import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, JSX_EXT, SQL_EXT, isTestPath, isCommentLine } from './helpers';

export const PERFORMANCE_RULES: ThesmosRule[] = [
  // ── Performance ───────────────────────────────────────────────────────────

  {
    id: 'PERF_001',
    category: 'sync_fs_in_handler',
    description: '`fs.readFileSync` and `fs.writeFileSync` in async request handlers block the Node.js event loop.',
    severity: 'HIGH',
    tags: ['performance', 'nodejs', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Synchronous fs calls block Node.js\'s single-threaded event loop, preventing any other requests from being processed until the I/O completes. Under load this creates a cascading latency spike.',
      commonViolations: ['const data = fs.readFileSync(filePath, "utf8")', 'fs.writeFileSync(output, JSON.stringify(result))'],
      goodExample: "import { readFile, writeFile } from 'node:fs/promises';\nconst data = await readFile(filePath, 'utf8');\nawait writeFile(output, JSON.stringify(result));",
      badExample: "export async function POST(req: Request) {\n  const template = fs.readFileSync('template.html', 'utf8');  // blocks all requests\n}",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sync_fs_in_handler', config.severityRules);
      const SYNC_FS_RE = /\bfs\.(?:readFileSync|writeFileSync|appendFileSync|existsSync|mkdirSync|rmdirSync|unlinkSync)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/api\/|route\.|handler\.|server\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SYNC_FS_RE.test(line)) {
            findings.push({ severity, category: 'sync_fs_in_handler', file: path, line: i + 1, message: 'Synchronous fs call in async request handler — blocks the event loop.', suggestion: "Use the async fs/promises equivalent: import { readFile } from 'node:fs/promises'; await readFile(...)." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_002',
    category: 'regex_in_function_body',
    description: 'Regex literals created inside function bodies are recompiled on every call. Move to module scope.',
    severity: 'LOW',
    tags: ['performance', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'JavaScript engines must parse and compile regex literals each time they are encountered in a function call. Moving them to module scope compiles once at startup and reuses the compiled pattern on every call.',
      commonViolations: ['function validate(s) { return /^[a-z]+$/.test(s); }', 'emails.filter(e => /@example\\.com$/.test(e))'],
      goodExample: "const EMAIL_DOMAIN_RE = /@example\\.com$/;\nfunction isInternal(email: string) { return EMAIL_DOMAIN_RE.test(email); }",
      badExample: "function isValidSlug(s: string) {\n  return /^[a-z0-9-]+$/.test(s);  // compiled every call\n}",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('regex_in_function_body', config.severityRules);
      const INLINE_REGEX_RE = /\breturn\s+\/[^/\n]{8,}\/[gimsuy]*\.test\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (INLINE_REGEX_RE.test(line)) {
            findings.push({ severity, category: 'regex_in_function_body', file: path, line: i + 1, message: 'Regex created inside function body — move to module scope for reuse.', suggestion: 'Extract regex to a module-level const: const MY_RE = /pattern/g;' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_003',
    category: 'n_plus_one_query',
    description: 'Database query inside a loop causes N+1 queries — one per iteration instead of one batched query.',
    severity: 'HIGH',
    tags: ['performance', 'database', 'query'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'N+1 queries are the most common performance bug in data-heavy apps. Fetching 100 records then making 100 individual DB calls to hydrate related data can be fixed with a single JOIN or batch fetch.',
      commonViolations: ['users.forEach(u => { const posts = await db.query("SELECT * FROM posts WHERE userId = ?", u.id) })', 'for (const id of ids) { await db.findById(id); }'],
      goodExample: "// Batch: one query for all related records\nconst posts = await db.select().from(postsTable).where(inArray(postsTable.userId, userIds));\n// Or: use JOIN / eager loading in ORM",
      badExample: "for (const user of users) {\n  user.posts = await db.query.posts.findMany({ where: eq(posts.userId, user.id) });  // N queries\n}",
      relatedPlaybooks: ['database-patterns.md', 'performance.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: ['batch-query-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('n_plus_one_query', config.severityRules);
      const LOOP_RE = /(?:for\s*\(|\.forEach\s*\(|\.map\s*\()/;
      const DB_RE = /\b(?:findOne|findById|findUnique|findMany|select|query|execute|from\()\s*[\w(]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line) || !LOOP_RE.test(line)) continue;
          const block = lines.slice(i + 1, Math.min(i + 6, lines.length)).join('\n');
          if (DB_RE.test(block) && /\bawait\b/.test(block)) {
            findings.push({ severity, category: 'n_plus_one_query', file: path, line: i + 1, message: 'Database query inside loop — N+1 query pattern.', suggestion: 'Collect IDs, then batch-fetch with inArray() or an ORM include/join.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_004',
    category: 'select_star',
    description: '`SELECT *` fetches all columns including unused ones, wasting bandwidth, memory, and preventing index-only scans.',
    severity: 'MEDIUM',
    tags: ['performance', 'database', 'query'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'SELECT * prevents query-planner optimizations (index-only scans require specific columns), fetches sensitive columns you may not want to expose, and increases memory usage for large rows.',
      commonViolations: ['SELECT * FROM users', 'db.execute("SELECT * FROM orders WHERE user_id = ?")'],
      goodExample: "SELECT id, name, email, created_at FROM users WHERE id = $1;\n// ORM: db.select({ id: users.id, name: users.name }).from(users).where(...)",
      badExample: "SELECT * FROM users WHERE id = $1;  -- fetches password_hash, session_token, etc.",
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('select_star', config.severityRules);
      const SELECT_STAR_RE = /\bSELECT\s+\*/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) && !SQL_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SELECT_STAR_RE.test(line)) {
            findings.push({ severity, category: 'select_star', file: path, line: i + 1, message: 'SELECT * — explicitly name the columns you need.', suggestion: 'Replace with explicit column list: SELECT id, name, email FROM ...' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_005',
    category: 'large_bundle_import',
    description: 'Importing an entire package when only one function is needed increases bundle size unnecessarily.',
    severity: 'LOW',
    tags: ['performance', 'bundle', 'frontend'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Importing the entirety of lodash, moment, or date-fns means bundling hundreds of functions when you use one. Tree-shaking helps but is not reliable for all packages.',
      commonViolations: ["import _ from 'lodash'", "import moment from 'moment'", "import * as R from 'ramda'"],
      goodExample: "import { debounce } from 'lodash-es';\nimport { format } from 'date-fns';",
      badExample: "import _ from 'lodash';  // entire library bundled\nconst result = _.debounce(fn, 300);",
      relatedPlaybooks: ['bundle-optimization.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('large_bundle_import', config.severityRules);
      const BAD_IMPORT_RE = /import\s+(?:_|moment|R)\s+from\s+['"](?:lodash|moment|ramda)['"]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (BAD_IMPORT_RE.test(line)) {
            findings.push({ severity, category: 'large_bundle_import', file: path, line: i + 1, message: 'Importing entire library — use named/subpath imports for better tree-shaking.', suggestion: "import { debounce } from 'lodash-es'  or  import debounce from 'lodash/debounce'" });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_006',
    category: 'missing_pagination',
    description: 'List queries without LIMIT/take/pagination return unbounded result sets that grow with data volume.',
    severity: 'MEDIUM',
    tags: ['performance', 'database', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'A query that returns all records works fine with 100 rows but crashes with 1M rows. Always paginate list endpoints — memory, latency, and bandwidth all scale linearly with row count.',
      commonViolations: ['db.select().from(users)', 'prisma.user.findMany()', 'supabase.from("orders").select("*")'],
      goodExample: "db.select().from(users).limit(50).offset(page * 50);\nprisma.user.findMany({ take: 50, skip: cursor });",
      badExample: "const allUsers = await prisma.user.findMany();  // returns all users — unbounded",
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_pagination', config.severityRules);
      const FIND_ALL_RE = /\b(?:findMany|findAll|select\s*\(\s*\))\s*\(\s*(?:\{\s*\}|)\s*\)/;
      const PAGINATE_RE = /\b(?:take|limit|skip|offset|cursor|page|perPage)\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (FIND_ALL_RE.test(line)) {
            const ctx = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
            if (!PAGINATE_RE.test(ctx)) {
              findings.push({ severity, category: 'missing_pagination', file: path, line: i + 1, message: 'List query without pagination — returns all rows.', suggestion: 'Add take/limit and cursor/offset to paginate results.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_007',
    category: 'json_in_loop',
    description: '`JSON.stringify` or `JSON.parse` inside a loop reserializes data on every iteration — compute once outside.',
    severity: 'LOW',
    tags: ['performance', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'JSON serialization is relatively expensive (especially for large objects). Calling it inside a .map() or for-loop multiplies the cost by the number of iterations.',
      commonViolations: ['items.map(item => JSON.parse(item.metadata))', 'for (const r of rows) { cache.set(key, JSON.stringify(r)); }'],
      goodExample: "// Parse once before the loop:\nconst parsed = JSON.parse(rawData);\nconst results = items.map(item => transform(item, parsed));",
      badExample: "const rendered = items.map(item => {\n  const config = JSON.parse(item.configJson);  // parsed N times\n  return render(item, config);\n});",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('json_in_loop', config.severityRules);
      const LOOP_RE = /\.(?:map|filter|forEach|reduce|flatMap)\s*\(/;
      const JSON_RE = /JSON\.(?:parse|stringify)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!LOOP_RE.test(lines[i]!)) continue;
          const block = lines.slice(i + 1, Math.min(i + 5, lines.length)).join('\n');
          if (JSON_RE.test(block)) {
            findings.push({ severity, category: 'json_in_loop', file: path, line: i + 1, message: 'JSON.parse/stringify inside a loop — move outside to avoid repeated serialization.', suggestion: 'Parse/stringify once before the loop and reference the result inside.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_008',
    category: 'missing_db_index',
    description: 'Querying a column without an index causes a full table scan on every request.',
    severity: 'MEDIUM',
    tags: ['performance', 'database'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'A WHERE clause on an unindexed column forces the database to read every row. This is O(n) per query and becomes the bottleneck as the table grows. Foreign keys and frequently-filtered columns must be indexed.',
      commonViolations: ['WHERE email = $1 on a table where email has no index', 'JOIN on userId without an index on the child table'],
      goodExample: "CREATE INDEX idx_users_email ON users(email);\nCREATE INDEX idx_orders_user_id ON orders(user_id);",
      badExample: "-- No index on orders.user_id\nSELECT * FROM orders WHERE user_id = $1;  -- full table scan",
      relatedPlaybooks: ['database-performance.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_db_index', config.severityRules);
      const CREATE_TABLE_RE = /CREATE\s+TABLE\b/i;
      const FK_COL_RE = /\b\w+_id\b.*(?:REFERENCES|INTEGER|UUID)/i;
      const INDEX_RE = /CREATE\s+INDEX/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SQL_EXT.test(path)) continue;
        if (CREATE_TABLE_RE.test(content) && FK_COL_RE.test(content) && !INDEX_RE.test(content)) {
          findings.push({ severity, category: 'missing_db_index', file: path, message: 'Migration creates table with foreign-key-style columns but no CREATE INDEX.', suggestion: 'Add CREATE INDEX on every column used in WHERE, JOIN, or ORDER BY clauses.' });
        }
      }
      return findings;
    },
  },

  // ── Accessibility ─────────────────────────────────────────────────────────

  {
    id: 'A11Y_001',
    category: 'img_missing_alt',
    description: '<img> elements must have an `alt` attribute for screen readers and SEO.',
    severity: 'HIGH',
    tags: ['accessibility', 'seo', 'html'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Screen readers announce the alt text to blind users. Search engines use alt text for image indexing. Without alt, an image is invisible to assistive technology and unindexable to search engines.',
      commonViolations: ['<img src={photo} />', "<img src='hero.jpg'>"],
      goodExample: '<img src={hero} alt="Team collaborating in office" />\n<img src={icon} alt="" />  // decorative: explicitly empty',
      badExample: '<img src={product.thumbnail} />  // screen reader announces "image"',
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('img_missing_alt', config.severityRules);
      const IMG_RE = /<img\b/i;
      const HAS_ALT_RE = /\balt\s*=/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx?|jsx?|html)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (IMG_RE.test(line)) {
            const block = lines.slice(i, Math.min(i + 4, lines.length)).join(' ');
            if (!HAS_ALT_RE.test(block)) {
              findings.push({ severity, category: 'img_missing_alt', file: path, line: i + 1, message: '<img> without alt attribute.', suggestion: 'Add alt="description". Use alt="" for purely decorative images.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'A11Y_002',
    category: 'click_on_noninteractive',
    description: 'onClick on non-interactive elements (div, span, p) is inaccessible to keyboard and screen reader users.',
    severity: 'HIGH',
    tags: ['accessibility', 'react', 'ux'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Keyboard users navigate with Tab (focuses only interactive elements) and screen readers announce element roles. A div with onClick is invisible to both unless you add role and keyboard handlers.',
      commonViolations: ['<div onClick={handleClick}>', '<span onClick={toggle}>'],
      goodExample: "<button onClick={handleClick} type=\"button\">Click me</button>\n// Or: <div role=\"button\" tabIndex={0} onClick={fn} onKeyDown={e => e.key === 'Enter' && fn()} />",
      badExample: "<div onClick={handleSelect} className=\"option\">{label}</div>  // keyboard inaccessible",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('click_on_noninteractive', config.severityRules);
      const DIV_CLICK_RE = /<(?:div|span|p|li|td|tr|th)\s[^>]*\bonClick\b/;
      const ROLE_RE = /\brole\s*=/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (DIV_CLICK_RE.test(line) && !ROLE_RE.test(line)) {
            findings.push({ severity, category: 'click_on_noninteractive', file: path, line: i + 1, message: 'onClick on non-interactive element — keyboard users cannot trigger this.', suggestion: 'Use <button> instead, or add role="button" tabIndex={0} and an onKeyDown handler.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'A11Y_003',
    category: 'empty_aria_label',
    description: 'aria-label with an empty string provides no accessible name — use a meaningful description or remove it.',
    severity: 'HIGH',
    tags: ['accessibility', 'aria'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'An empty aria-label ("") is worse than no label — it overrides any text content and announces the element with no description to screen readers. Use a meaningful label or use aria-hidden="true" for decorative elements.',
      commonViolations: ['aria-label=""', "aria-label=''"],
      goodExample: '<button aria-label="Close dialog">✕</button>\n<svg aria-hidden="true">...</svg>  // decorative: hidden from AT',
      badExample: '<button aria-label="">✕</button>  // screen reader: "button" — no context',
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('empty_aria_label', config.severityRules);
      const RE = /aria-label\s*=\s*(?:['"]{2}|\{\s*['"]{2}\s*\})/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx?|jsx?|html)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'empty_aria_label', file: path, line: i + 1, message: 'aria-label="" provides no accessible name.', suggestion: 'Add a meaningful description, or use aria-hidden="true" if the element is decorative.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'A11Y_004',
    category: 'autofocus_attribute',
    description: 'autoFocus moves focus on mount without warning, disorienting screen reader and keyboard users.',
    severity: 'LOW',
    tags: ['accessibility', 'ux'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'autoFocus interrupts screen reader reading flow by unexpectedly moving focus. It can also cause issues for users who navigate keyboard-first. Reserve for modal dialogs where focus trapping is intentional.',
      commonViolations: ['<input autoFocus />', '<button autoFocus>Submit</button>'],
      goodExample: "// For modals: use a focus trap library (focus-trap-react)\n// For search: allow users to activate focus naturally",
      badExample: "<input type=\"text\" autoFocus />  // unexpected focus jump for screen reader users",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('autofocus_attribute', config.severityRules);
      const RE = /\bautoFocus\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line) && !/<(?:dialog|Modal)/.test(line)) {
            findings.push({ severity, category: 'autofocus_attribute', file: path, line: i + 1, message: 'autoFocus used outside a dialog/modal — disorienting for screen reader users.', suggestion: 'Remove autoFocus. If needed for a modal, use a focus-trap library.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'A11Y_005',
    category: 'positive_tabindex',
    description: 'tabIndex > 0 disrupts the natural focus order and is almost always a mistake.',
    severity: 'MEDIUM',
    tags: ['accessibility', 'keyboard-navigation'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'tabIndex values greater than 0 create a custom tab order that diverges from the DOM order. This breaks keyboard navigation expectations and makes accessibility audits much harder.',
      commonViolations: ['tabIndex={2}', 'tabIndex={10}'],
      goodExample: "tabIndex={0}  // participates in natural tab order\ntabIndex={-1}  // focusable programmatically only",
      badExample: '<CustomButton tabIndex={5}>  // breaks natural tab flow for keyboard users',
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('positive_tabindex', config.severityRules);
      const RE = /\btabIndex\s*=\s*\{?\s*[1-9]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx?|jsx?|html)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'positive_tabindex', file: path, line: i + 1, message: 'tabIndex > 0 disrupts natural focus order.', suggestion: 'Use tabIndex={0} to participate in natural order, or tabIndex={-1} for programmatic focus only.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'A11Y_006',
    category: 'form_input_no_label',
    description: 'Form inputs without an associated label are inaccessible to screen reader users.',
    severity: 'HIGH',
    tags: ['accessibility', 'forms'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Screen readers announce the associated label when a form field receives focus. Without a label (via htmlFor, aria-label, or aria-labelledby), the user hears only the input type — giving no context for what to enter.',
      commonViolations: ['<input type="text" placeholder="Enter name" />', '<input type="email" />'],
      goodExample: '<label htmlFor="email">Email address</label>\n<input id="email" type="email" />\n// Or: <input type="text" aria-label="Search" />',
      badExample: '<input type="email" placeholder="you@example.com" />  // placeholder disappears on focus',
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_input_no_label', config.severityRules);
      const INPUT_RE = /<input\b(?![^>]*type\s*=\s*['"](?:hidden|submit|reset|button|checkbox|radio|file|image)['"])[^>]*/i;
      const LABEL_RE = /\b(?:aria-label|aria-labelledby|id\s*=)/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (INPUT_RE.test(line) && !LABEL_RE.test(line)) {
            const block = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');
            if (!LABEL_RE.test(block)) {
              findings.push({ severity, category: 'form_input_no_label', file: path, line: i + 1, message: 'Form input without an accessible label.', suggestion: 'Add a <label htmlFor="id"> or aria-label attribute.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'A11Y_007',
    category: 'link_no_descriptive_text',
    description: 'Links with text "click here", "read more", or "learn more" provide no context out of screen reader focus.',
    severity: 'MEDIUM',
    tags: ['accessibility', 'seo', 'ux'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Screen reader users often navigate by listing all links on the page. "Click here" repeated 10 times is useless — they need to know where each link goes without reading surrounding context.',
      commonViolations: ['<a href="/post">Read more</a>', '<a href={url}>Click here</a>'],
      goodExample: '<a href="/post">Read the full article on async patterns</a>\n<a href={docUrl} aria-label={`Read more about ${topic}`}>→</a>',
      badExample: '<a href={nextPage}>Read more</a>  // out of context for screen reader users',
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('link_no_descriptive_text', config.severityRules);
      const VAGUE_LINK_RE = />\s*(?:click here|read more|learn more|see more|more info|details|here)\s*</i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx?|jsx?|html)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (VAGUE_LINK_RE.test(line)) {
            findings.push({ severity, category: 'link_no_descriptive_text', file: path, line: i + 1, message: 'Non-descriptive link text — inaccessible without surrounding context.', suggestion: 'Use descriptive text or add aria-label: <a href={url} aria-label="Read more about {topic}">Read more</a>' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'A11Y_008',
    category: 'missing_focus_visible',
    description: 'Removing focus outlines without providing an alternative makes keyboard navigation invisible.',
    severity: 'HIGH',
    tags: ['accessibility', 'keyboard-navigation', 'css'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'The focus outline shows keyboard users where they are on the page. Removing it with `outline: none` without providing a custom :focus-visible style makes the interface unusable for keyboard navigation.',
      commonViolations: ['outline: none', 'outline: 0', ':focus { outline: none }'],
      goodExample: ":focus-visible {\n  outline: 2px solid var(--color-focus);\n  outline-offset: 2px;\n}",
      badExample: "* { outline: none; }  // removes visible keyboard focus indicator",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_focus_visible', config.severityRules);
      const OUTLINE_NONE_RE = /outline\s*:\s*(?:none|0)\s*[;!]/;
      const FOCUS_CONTEXT_RE = /:focus|focus-within/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(css|scss|sass|module\.css)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (OUTLINE_NONE_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 3), i + 2).join('\n');
            if (FOCUS_CONTEXT_RE.test(ctx) || line.includes('*') || line.includes('a,')) {
              findings.push({ severity, category: 'missing_focus_visible', file: path, line: i + 1, message: 'outline:none removes keyboard focus indicator.', suggestion: 'Remove the rule, or replace with :focus-visible with a visible custom outline.' });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── Performance expansions ────────────────────────────────────────────────

  {
    id: 'PERF_009',
    category: 'bundle_size_moment',
    description: "moment.js adds 67KB to the bundle. Migrate to date-fns or dayjs.",
    severity: 'MEDIUM',
    tags: ['performance', 'bundle-size', 'dependencies'],
    sinceVersion: '3.0.0',
    explain: {
      why: "moment is 67KB minified and unmaintained since 2021. date-fns is tree-shakable (import { format } adds ~2KB). dayjs is 2KB total. The moment team officially recommends migrating.",
      commonViolations: ["import moment from 'moment'"],
      goodExample: "import { format, addDays, differenceInDays } from 'date-fns'",
      badExample: "import moment from 'moment'  // 67KB for a formatting function",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('bundle_size_moment', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (/from\s+['"]moment['"]\s*$|require\(['"]moment['"]\)/.test(content)) {
          findings.push({ severity, category: 'bundle_size_moment', file: path, message: "moment.js imported — 67KB bundle, maintenance mode. Migrate to date-fns or dayjs.", suggestion: "import { format } from 'date-fns' — tree-shakable and actively maintained." });
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_010',
    category: 'web_vitals_lcp',
    description: "Above-the-fold images without priority/preload delay Largest Contentful Paint (LCP) — a Core Web Vital.",
    severity: 'MEDIUM',
    tags: ['performance', 'core-web-vitals', 'lcp'],
    sinceVersion: '3.0.0',
    explain: {
      why: "LCP measures when the largest above-the-fold element is rendered. Hero images without loading='eager' or Next.js priority are lazy-loaded by default — delaying LCP and hurting SEO scores.",
      commonViolations: ["<Image src='/hero.jpg' alt='Hero' />  // no priority"],
      goodExample: "<Image src='/hero.jpg' alt='Hero' priority />  // preloads LCP image",
      badExample: "<Image src={heroImage} alt='...' />  // lazy-loaded — delays LCP",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('web_vitals_lcp', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        if (!path.includes('page.') && !path.includes('layout.') && !path.includes('hero') && !path.includes('hero'.toLowerCase())) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/<Image\s/.test(line) && /src/.test(line) && !line.includes('priority') && !line.includes('loading="eager"')) {
            if (i < 40) {
              findings.push({ severity, category: 'web_vitals_lcp', file: path, line: i + 1, message: 'Above-the-fold <Image> without priority — delays LCP Core Web Vital.', suggestion: "Add priority to the hero/first-view image: <Image src={...} priority />." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_011',
    category: 'virtualization_missing',
    description: "Rendering large lists (100+ items) without virtualization causes DOM bloat and scroll jank.",
    severity: 'HIGH',
    tags: ['performance', 'rendering', 'lists'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Rendering 1000 DOM nodes for a list is expensive — initial paint takes seconds, scroll is janky. Virtualization (react-window, @tanstack/virtual) renders only visible items (~20), keeping the DOM small.",
      commonViolations: ["{posts.map(post => <PostCard key={post.id} post={post} />)}  // 1000 cards in DOM"],
      goodExample: "import { useVirtualizer } from '@tanstack/react-virtual'\n// renders only visible items",
      badExample: "{items.map(item => <Item key={item.id} item={item} />)}  // 10K items in DOM — scroll jank",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('virtualization_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        if (content.includes('useVirtualizer') || content.includes('react-window') || content.includes('FixedSizeList')) return findings;
        if (/\.map\s*\(/.test(content) && (/list|List|feed|Feed|table|Table|grid|Grid/i.test(path) || /(?:data|items|posts|products|users|results)\.map/.test(content))) {
          if (content.includes('pagination') || content.includes('infiniteScroll') || content.includes('useInfiniteQuery')) return findings;
          findings.push({ severity, category: 'virtualization_missing', file: path, message: 'Large list rendered without virtualization — may cause scroll jank with 100+ items.', suggestion: "Use @tanstack/react-virtual or react-window to render only visible items." });
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_012',
    category: 'css_in_js_runtime',
    description: "Runtime CSS-in-JS (styled-components, emotion) generates styles on every render — prefer Tailwind or CSS modules.",
    severity: 'MEDIUM',
    tags: ['performance', 'css', 'rendering'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Runtime CSS-in-JS serializes style strings, injects <style> tags, and uses React context on every render — adding 15-40ms of JS overhead per component. Tailwind (compile-time) and CSS Modules (static) have no runtime cost.",
      commonViolations: ["import styled from 'styled-components'", "import { css } from '@emotion/react'"],
      goodExample: "// Tailwind: className='flex items-center gap-4 bg-white rounded-lg'\n// CSS Modules: import styles from './Card.module.css'",
      badExample: "const Card = styled.div`background: white; padding: 16px`  // style injection on every render",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('css_in_js_runtime', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (/from\s+['"](?:styled-components|@emotion\/react|@emotion\/styled|@stitches\/react)['"]/.test(content)) {
          findings.push({ severity, category: 'css_in_js_runtime', file: path, message: "Runtime CSS-in-JS library detected — adds JavaScript overhead on every render.", suggestion: "Migrate to Tailwind CSS (utility classes) or CSS Modules for zero-runtime styling." });
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_013',
    category: 'unoptimized_regex',
    description: "Complex regex compiled inside a loop or function body wastes CPU recompiling on every call.",
    severity: 'MEDIUM',
    tags: ['performance', 'cpu', 'regex'],
    sinceVersion: '3.0.0',
    explain: {
      why: "new RegExp('pattern') inside a for loop or frequently-called function recompiles the regex on every iteration. Hoist regex to module scope or a const to compile once.",
      commonViolations: ["for (const item of items) { if (new RegExp(pattern).test(item)) ... }"],
      goodExample: "const EMAIL_RE = /^[^@]+@[^@]+\\.[^@]+$/  // compiled once at module scope",
      badExample: "function validate(email: string) { return new RegExp('^[^@]+@[^@]+\\.[^@]+$').test(email) }  // compiled every call",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('unoptimized_regex', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/new\s+RegExp\s*\(/.test(line) && !/module|const\s+\w+\s*=/.test(line)) {
            if (i > 0 && /function|=>|\bfor\b|\bwhile\b/.test(lines.slice(Math.max(0, i - 5), i).join('\n'))) {
              findings.push({ severity, category: 'unoptimized_regex', file: path, line: i + 1, message: 'new RegExp() inside a function or loop — recompiled on every call.', suggestion: 'Hoist to module scope: const MY_RE = /pattern/ compiled once.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_014',
    category: 'json_parse_large',
    description: "JSON.parse() on large strings blocks the main thread — use streaming or a Web Worker for large payloads.",
    severity: 'MEDIUM',
    tags: ['performance', 'cpu', 'main-thread'],
    sinceVersion: '3.0.0',
    explain: {
      why: "JSON.parse is synchronous and blocks the main thread. A 1MB JSON response takes ~10ms to parse on a fast desktop — much longer on mobile. For large payloads, use streaming JSON parsers (oboe.js) or parse in a Web Worker.",
      commonViolations: ["const data = JSON.parse(largeResponseText)  // 1MB+ JSON blocks main thread"],
      goodExample: "// Option 1: Stream with oboe.js for large responses\n// Option 2: Parse in a Web Worker\n// Option 3: Paginate the API to avoid large payloads",
      badExample: "const allUsers = JSON.parse(fs.readFileSync('users.json', 'utf8'))  // potentially huge file, blocks event loop",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('json_parse_large', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/JSON\.parse\s*\(\s*(?:fs\.|readFile|readFileSync|body|text|response)/.test(line)) {
            findings.push({ severity, category: 'json_parse_large', file: path, line: i + 1, message: 'JSON.parse on a potentially large payload — blocks the main thread/event loop.', suggestion: 'Paginate the data, use streaming JSON, or parse in a Worker for large payloads (>100KB).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_015',
    category: 'event_listener_passive',
    description: "Scroll and touch event listeners without { passive: true } block the browser's compositor thread, causing scroll jank.",
    severity: 'MEDIUM',
    tags: ['performance', 'scroll', 'browser'],
    sinceVersion: '3.0.0',
    explain: {
      why: "By default, scroll listeners may call preventDefault(), so the browser must wait for them to finish before scrolling. passive: true tells the browser the listener won't block scrolling — enabling 60fps smooth scroll.",
      commonViolations: ["window.addEventListener('scroll', handler)", "el.addEventListener('touchmove', handler)"],
      goodExample: "window.addEventListener('scroll', handler, { passive: true })\nel.addEventListener('touchmove', handler, { passive: true })",
      badExample: "document.addEventListener('wheel', onWheel)  // browser waits for this to complete before scrolling",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('event_listener_passive', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/addEventListener\s*\(\s*['"](?:scroll|wheel|touchstart|touchmove|touchend)['"]/.test(line) && !line.includes('passive')) {
            findings.push({ severity, category: 'event_listener_passive', file: path, line: i + 1, message: 'Scroll/touch event listener without { passive: true } — blocks compositor thread.', suggestion: "Add passive option: addEventListener('scroll', handler, { passive: true })." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_016',
    category: 'intersection_observer_missing',
    description: "Using scroll listeners to detect element visibility should use IntersectionObserver instead.",
    severity: 'LOW',
    tags: ['performance', 'scroll', 'browser-api'],
    sinceVersion: '3.0.0',
    explain: {
      why: "getBoundingClientRect() inside scroll handlers runs on the main thread and forces layout recalculation on every scroll event. IntersectionObserver is asynchronous and runs off the main thread — much more efficient.",
      commonViolations: ["window.addEventListener('scroll', () => { const rect = el.getBoundingClientRect() })"],
      goodExample: "const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) onVisible() })\nobserver.observe(el)",
      badExample: "window.addEventListener('scroll', () => {\n  const rect = el.getBoundingClientRect()\n  if (rect.top < window.innerHeight) setVisible(true)\n})",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('intersection_observer_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (/addEventListener\s*\(\s*['"]scroll['"]/.test(content) && /getBoundingClientRect/.test(content)) {
          findings.push({ severity, category: 'intersection_observer_missing', file: path, message: 'getBoundingClientRect() in scroll handler — use IntersectionObserver for off-main-thread detection.', suggestion: 'Replace scroll+getBoundingClientRect with new IntersectionObserver(callback).observe(el).' });
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_017',
    category: 'object_spread_in_render',
    description: "Creating new objects with spread ({ ...obj, key: val }) inside render/JSX props triggers unnecessary re-renders.",
    severity: 'LOW',
    tags: ['performance', 'react', 'rendering'],
    sinceVersion: '3.0.0',
    explain: {
      why: "<Component props={{ ...defaults, override: value }} /> creates a new object on every render. Since the reference changes, any memoized child re-renders even if the effective values are identical.",
      commonViolations: ["<Chart config={{ ...baseConfig, color: theme.primary }} />"],
      goodExample: "const chartConfig = useMemo(() => ({ ...baseConfig, color: theme.primary }), [baseConfig, theme.primary])\n<Chart config={chartConfig} />",
      badExample: "<DataGrid columns={{ ...defaultColumns, actions: actionColumn }} />  // new object every render",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('object_spread_in_render', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/=\{\s*\{\s*\.\.\.\w+/.test(line) && !line.includes('useMemo') && !line.includes('//')) {
            findings.push({ severity, category: 'object_spread_in_render', file: path, line: i + 1, message: 'Object spread in JSX prop creates new reference on every render — causes unnecessary child re-renders.', suggestion: 'Memoize with useMemo: const obj = useMemo(() => ({ ...base, extra }), [base, extra]).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_018',
    category: 'unused_dependency_in_package',
    description: "Dependencies listed in package.json but not imported in any source file add install time and attack surface.",
    severity: 'LOW',
    tags: ['performance', 'dependencies', 'maintenance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Unused dependencies slow npm install, add transitive security vulnerabilities, and increase cognitive load. Run npx depcheck or use knip to identify and remove them.",
      commonViolations: ['// package.json lists lodash but codebase uses lodash-es'],
      goodExample: "// Use npx depcheck or knip to find unused deps, then remove from package.json",
      badExample: "// package.json: 'lodash', 'moment', 'axios' all installed but none imported in src/",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('unused_dependency_in_package', config.severityRules);
      const findings: Finding[] = [];
      const packageFile = changedFiles.find(f => f.path === 'package.json' || f.path.endsWith('/package.json'));
      if (!packageFile) return findings;
      try {
        const pkg = JSON.parse(packageFile.content);
        const deps = Object.keys(pkg.dependencies ?? {});
        const allContent = changedFiles.filter(f => SOURCE_EXT.test(f.path)).map(f => f.content).join('\n');
        for (const dep of deps) {
          if (!/react|next|typescript|tailwind|postcss|autoprefixer|eslint|prettier|vitest|jest/.test(dep)) {
            if (!allContent.includes(`'${dep}'`) && !allContent.includes(`"${dep}"`)) {
              findings.push({ severity, category: 'unused_dependency_in_package', file: packageFile.path, message: `Package '${dep}' in package.json not imported in any changed source file.`, suggestion: "Run npx depcheck to identify all unused dependencies and remove them." });
            }
          }
        }
      } catch { /* not valid JSON */ }
      return findings;
    },
  },

  {
    id: 'PERF_019',
    category: 'waterfall_data_fetch',
    description: "Sequential awaits for independent data sources create a waterfall — fetch them in parallel with Promise.all.",
    severity: 'MEDIUM',
    tags: ['performance', 'async', 'latency'],
    sinceVersion: '3.0.0',
    explain: {
      why: "const user = await getUser(); const posts = await getPosts() takes 200ms + 300ms = 500ms total. Promise.all([getUser(), getPosts()]) takes max(200ms, 300ms) = 300ms — 40% faster.",
      commonViolations: ['const user = await getUser(id)\nconst posts = await getPosts(userId)\nconst stats = await getStats(userId)'],
      goodExample: "const [user, posts, stats] = await Promise.all([getUser(id), getPosts(userId), getStats(userId)])",
      badExample: "const profile = await fetchProfile(id)  // 200ms\nconst timeline = await fetchTimeline(id)  // 300ms — sequential = 500ms total",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('waterfall_data_fetch', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        let consecutiveAwaits = 0;
        let firstLine = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*(?:const|let)\s+\w+\s*=\s*await\s+\w+/.test(line)) {
            if (consecutiveAwaits === 0) firstLine = i;
            consecutiveAwaits++;
          } else {
            if (consecutiveAwaits >= 3) {
              findings.push({ severity, category: 'waterfall_data_fetch', file: path, line: firstLine + 1, message: `${consecutiveAwaits} sequential awaits — fetch independent operations in parallel with Promise.all().`, suggestion: "const [a, b, c] = await Promise.all([fetchA(), fetchB(), fetchC()]) — runs concurrently." });
            }
            consecutiveAwaits = 0;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_020',
    category: 'ssr_heavy_computation',
    description: "CPU-intensive computations in Server Components block the response for all concurrent requests.",
    severity: 'HIGH',
    tags: ['performance', 'nextjs', 'server-components'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js handles concurrent requests in a single Node.js process. A CPU-heavy synchronous operation in a Server Component blocks the event loop, delaying ALL concurrent requests until it completes.",
      commonViolations: ['// Server Component that calls a complex sync algorithm on every request'],
      goodExample: "// Cache the result: const result = unstable_cache(heavyCompute)\n// Or: move to a background job if not needed synchronously",
      badExample: "// app/page.tsx (Server Component):\nconst result = computeExpensiveReport(rawData)  // blocks all concurrent requests",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ssr_heavy_computation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || !path.includes('page.')) return findings;
        if (content.includes("'use client'")) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/for\s*\(|while\s*\(|\.reduce\s*\(|\.sort\s*\(/.test(line) && !/async|await/.test(lines.slice(i - 2, i + 2).join(''))) {
            findings.push({ severity, category: 'ssr_heavy_computation', file: path, line: i + 1, message: 'Synchronous computation in a Server Component page — blocks the event loop for all concurrent requests.', suggestion: "Cache with unstable_cache() or move heavy computation to a background job/route." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_021',
    category: 'prefetch_on_hover',
    description: "Preloading route data on route click instead of hover means the user waits during transition.",
    severity: 'LOW',
    tags: ['performance', 'ux', 'navigation'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Hover-to-prefetch starts prefetching 200-300ms before click (hover intent delay). At click time, the data may already be ready. Libraries like @tanstack/router and next/link support this automatically.",
      commonViolations: ["// Only fetching data when navigation actually happens — missing hover preload"],
      goodExample: "<Link href='/product/123' prefetch={true}>  // Next.js auto-prefetches on viewport",
      badExample: "onClick={() => router.push('/product/123')}  // starts loading only after click",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prefetch_on_hover', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*router\.(push|navigate)/.test(line) && !content.includes('onMouseEnter') && !content.includes('prefetch')) {
            findings.push({ severity, category: 'prefetch_on_hover', file: path, line: i + 1, message: 'Navigation only triggered on click — consider prefetching on hover to reduce perceived navigation latency.', suggestion: "Use <Link href='...'> (auto-prefetch) or add onMouseEnter to start prefetch 200ms before click." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_022',
    category: 'layout_thrashing',
    description: "Interleaving reads (getBoundingClientRect) and writes (style.x = ...) in a loop causes layout thrashing.",
    severity: 'HIGH',
    tags: ['performance', 'browser', 'dom'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Reading layout properties (offsetWidth, getBoundingClientRect) after writing style properties forces the browser to recalculate layout synchronously. In a loop, this can cause hundreds of forced reflows per second — known as layout thrashing.",
      commonViolations: ["for (const el of els) { el.style.width = el.offsetWidth + 10 + 'px' }  // read-write in loop"],
      goodExample: "const widths = els.map(el => el.offsetWidth)  // batch reads\nels.forEach((el, i) => el.style.width = widths[i]! + 10 + 'px')  // batch writes",
      badExample: "elements.forEach(el => {\n  const h = el.offsetHeight  // triggers reflow\n  el.style.height = h + 20 + 'px'  // write — next read forces reflow again\n})",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('layout_thrashing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/(?:offsetWidth|offsetHeight|getBoundingClientRect|clientWidth|scrollTop)/.test(line)) {
            const nextLine = lines[i + 1] || '';
            if (/\.style\.\w+\s*=/.test(nextLine)) {
              findings.push({ severity, category: 'layout_thrashing', file: path, line: i + 1, message: 'Layout read immediately followed by style write — causes forced synchronous reflow.', suggestion: 'Batch all reads first, then all writes: const dims = els.map(el => el.offsetWidth); els.forEach((el, i) => el.style.width = dims[i] + "px").' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PERF_023',
    category: 'service_worker_missing',
    description: "Production web apps without a Service Worker miss offline support and asset caching benefits.",
    severity: 'LOW',
    tags: ['performance', 'pwa', 'caching'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A Service Worker can cache static assets, API responses, and fonts — making repeat visits instant and the app usable offline. next-pwa or Workbox can add this with minimal configuration.",
      commonViolations: ["// Production Next.js app with no service worker configuration"],
      goodExample: "// next.config.js\nconst withPWA = require('next-pwa')({ dest: 'public' })\nmodule.exports = withPWA({ ... })",
      badExample: "// No service worker — every visit re-downloads all assets",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('service_worker_missing', config.severityRules);
      const findings: Finding[] = [];
      const isNextConfig = changedFiles.some(f => f.path.includes('next.config'));
      if (!isNextConfig) return findings;
      const nextConfig = changedFiles.find(f => f.path.includes('next.config'));
      if (nextConfig && !nextConfig.content.includes('pwa') && !nextConfig.content.includes('workbox') && !nextConfig.content.includes('service-worker')) {
        findings.push({ severity, category: 'service_worker_missing', file: nextConfig.path, message: "Next.js config without PWA/Service Worker — missing offline support and asset caching.", suggestion: "Add next-pwa: const withPWA = require('next-pwa')({ dest: 'public' }) to enable service worker." });
      }
      return findings;
    },
  },
];
