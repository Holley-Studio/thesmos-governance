import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, TS_EXT, isTestPath, isCommentLine, matchLines, windowMatches } from './helpers';

function isZodFile(content: string): boolean {
  return /from ['"]zod['"]|require\(['"]zod['"]\)/.test(content);
}

export const ZOD_RULES: ThesmosRule[] = [
  {
    id: 'ZOD_001',
    category: 'zod_parse_no_catch',
    description: 'z.parse() throws a ZodError on invalid input. Uncaught, it becomes an unhandled 500. Use .safeParse() or wrap in try/catch.',
    severity: 'HIGH',
    tags: ['zod', 'validation', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'ZodError is a runtime exception. If .parse() is called in an API handler without a try/catch, any malformed request body causes an unhandled 500 that leaks a stack trace to the client. .safeParse() returns { success, data, error } without throwing.',
      commonViolations: [
        'const data = schema.parse(req.body)',
        'const input = InputSchema.parse(event.body)',
      ],
      goodExample: 'const result = schema.safeParse(req.body);\nif (!result.success) return res.status(400).json({ error: result.error.flatten() });',
      badExample: 'const data = schema.parse(req.body);  // throws ZodError → 500 on bad input',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: ['api-reviewer'],
      relatedSkills: ['zod-safe-parse-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_parse_no_catch', config.severityRules);
      const PARSE_RE = /\b\w+Schema\.parse\(|schema\.parse\(|Schema\.parse\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PARSE_RE.test(line) && !line.includes('safeParse')) {
            const window = lines.slice(Math.max(0, i - 5), i + 5).join('\n');
            if (!/try\s*\{|\.catch\(/.test(window)) {
              findings.push({ severity, category: 'zod_parse_no_catch', file: path, line: i + 1, message: '.parse() without try/catch will throw ZodError on bad input.', suggestion: 'Use .safeParse() and check result.success, or wrap in try/catch with error handling.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_002',
    category: 'zod_any_type',
    description: 'z.any() defeats the purpose of Zod validation. Use a specific schema or z.unknown() with type narrowing.',
    severity: 'MEDIUM',
    tags: ['zod', 'typescript', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.any() accepts every value without checks, erasing all runtime safety. Use z.unknown() when the shape is truly unpredictable and add narrowing logic, or define the actual expected shape.',
      commonViolations: ['z.any()', 'z.object({ data: z.any() })'],
      goodExample: 'z.object({ data: z.unknown() })  // then narrow with instanceof / typeof',
      badExample: 'const schema = z.object({ payload: z.any() });  // no validation at all',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_any_type', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bz\.any\(\)/.test(line)) {
            findings.push({ severity, category: 'zod_any_type', file: path, line: i + 1, message: 'z.any() bypasses all runtime validation.', suggestion: 'Use z.unknown() with explicit narrowing, or define the actual expected schema shape.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_003',
    category: 'zod_string_max_missing',
    description: 'String fields without .max() are an unbounded-input DoS risk. Always cap user-supplied strings.',
    severity: 'MEDIUM',
    tags: ['zod', 'security', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without a length cap, an attacker can send multi-megabyte strings that saturate memory, CPU (regex), or database column limits. A .max() sets an explicit contract and lets you return a clean 400.',
      commonViolations: ['z.string()', 'z.string().email()', 'name: z.string().min(1)'],
      goodExample: 'z.string().min(1).max(255)  // explicit upper bound',
      badExample: 'const NameSchema = z.string().min(1);  // no upper limit — 1 MB name crashes the DB',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: ['api-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_string_max_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bz\.string\(\)/.test(line) && !line.includes('.max(') && !line.includes('url()') && !line.includes('uuid()') && !line.includes('cuid()') && !line.includes('email()') && !line.includes('describe(')) {
            findings.push({ severity, category: 'zod_string_max_missing', file: path, line: i + 1, message: 'z.string() without .max() — unbounded input is a DoS vector.', suggestion: 'Add .max(N) appropriate to the field, e.g. .max(255) for names, .max(4096) for descriptions.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_004',
    category: 'zod_passthrough_api',
    description: '.passthrough() in API input schemas silently forwards unknown fields to downstream systems.',
    severity: 'HIGH',
    tags: ['zod', 'security', 'api'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'By default Zod strips unknown keys. .passthrough() disables this, allowing clients to inject fields like __proto__, isAdmin, or billing_override that may be forwarded to the database or downstream services.',
      commonViolations: ['inputSchema.passthrough()', 'z.object({...}).passthrough()'],
      goodExample: 'z.object({ name: z.string() })  // default: unknown keys stripped',
      badExample: 'const body = BodySchema.passthrough().parse(req.body);  // forwards isAdmin:true to DB',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_passthrough_api', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.passthrough\(\)/.test(line)) {
            findings.push({ severity, category: 'zod_passthrough_api', file: path, line: i + 1, message: '.passthrough() lets unknown keys through Zod stripping.', suggestion: 'Remove .passthrough() so Zod strips unexpected fields. Use .strip() explicitly if needed.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_005',
    category: 'zod_refine_no_message',
    description: '.refine() without a custom error message produces cryptic "Invalid input" errors in API responses.',
    severity: 'LOW',
    tags: ['zod', 'dx', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'The default ZodError message for .refine() failures is "Invalid input" — useless to API consumers. Always pass a descriptive message as the second argument so clients can surface actionable errors.',
      commonViolations: ['.refine(val => val > 0)', '.refine(isValidEmail)'],
      goodExample: '.refine(val => val > 0, { message: "Price must be a positive number" })',
      badExample: '.refine(val => val.startsWith("user_"))  // error: "Invalid input"',
      relatedPlaybooks: ['api-errors.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_refine_no_message', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.refine\(/.test(line) && !/message\s*:/.test(line)) {
            const window = lines.slice(i, Math.min(lines.length, i + 4)).join('\n');
            if (!/message\s*:/.test(window)) {
              findings.push({ severity, category: 'zod_refine_no_message', file: path, line: i + 1, message: '.refine() without a custom message — clients see "Invalid input".', suggestion: 'Add { message: "Describe what is wrong" } as the second argument.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_006',
    category: 'zod_schema_in_component',
    description: 'Defining Zod schemas inside React components recreates them on every render, wasting CPU and breaking referential equality.',
    severity: 'MEDIUM',
    tags: ['zod', 'react', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.object({...}) inside a component body runs on every render. This causes react-hook-form and similar libraries to re-register the schema continuously, and prevents memoization of validators that depend on the schema reference.',
      commonViolations: ['function Form() { const schema = z.object({...})', 'const schema = z.object({...}) inside component'],
      goodExample: '// Module-level — created once\nconst schema = z.object({ name: z.string().min(1) });\n\nfunction Form() { ... }',
      badExample: 'function LoginForm() {\n  const schema = z.object({ email: z.string().email() });  // new every render\n}',
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_schema_in_component', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        let insideFunction = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*(?:export\s+)?(?:default\s+)?(?:function|const)\s+[A-Z]/.test(line)) insideFunction = 1;
          if (insideFunction > 0) {
            insideFunction += (line.match(/\{/g) || []).length;
            insideFunction -= (line.match(/\}/g) || []).length;
            if (/const\s+\w+\s*=\s*z\.object\(/.test(line) || /const\s+\w+Schema\s*=\s*z\./.test(line)) {
              findings.push({ severity, category: 'zod_schema_in_component', file: path, line: i + 1, message: 'Zod schema defined inside a component — recreated on every render.', suggestion: 'Move the schema to module scope (outside the component function).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_007',
    category: 'zod_email_no_trim',
    description: 'Email validation without .trim() passes "  user@example.com  " as valid, causing login mismatches.',
    severity: 'MEDIUM',
    tags: ['zod', 'validation', 'auth'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Users copy-paste emails with leading/trailing whitespace. Without .trim(), "user@example.com" and " user@example.com" are different valid emails, causing "email not found" on login despite a successful signup.',
      commonViolations: ['z.string().email()', 'email: z.string().email().toLowerCase()'],
      goodExample: 'z.string().trim().email().toLowerCase()',
      badExample: 'email: z.string().email()  // " user@example.com" passes but won\'t match DB record',
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['auth-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_email_no_trim', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.email\(\)/.test(line) && !line.includes('.trim()') && !line.includes('toLowerCase()')) {
            findings.push({ severity, category: 'zod_email_no_trim', file: path, line: i + 1, message: 'Email schema missing .trim() — whitespace causes login mismatches.', suggestion: 'Use z.string().trim().toLowerCase().email() for consistent email storage.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_008',
    category: 'zod_password_no_min',
    description: 'Password fields without a minimum length allow trivially weak passwords like "a".',
    severity: 'HIGH',
    tags: ['zod', 'security', 'auth'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'NIST SP 800-63B and OWASP recommend a minimum of 8 characters for passwords. Without enforcement at the schema level, weak passwords bypass the UI validation if API is called directly.',
      commonViolations: ['password: z.string()', 'password: z.string().max(100)'],
      goodExample: 'password: z.string().min(8).max(128)',
      badExample: 'const LoginSchema = z.object({ password: z.string() });  // allows 1-char passwords',
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_password_no_min', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/password\s*:\s*z\.string\(\)/.test(line) && !line.includes('.min(')) {
            findings.push({ severity, category: 'zod_password_no_min', file: path, line: i + 1, message: 'Password field has no minimum length requirement.', suggestion: 'Add .min(8).max(128) to enforce NIST baseline password requirements.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_009',
    category: 'zod_url_no_protocol',
    description: 'URL fields without protocol enforcement accept javascript:// and data: URIs, creating XSS vectors.',
    severity: 'HIGH',
    tags: ['zod', 'security', 'xss'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.string().url() validates URL structure but accepts any protocol. javascript:alert(1) and data:text/html are valid URLs. If stored and rendered as href, they execute scripts. Enforce https:// explicitly.',
      commonViolations: ['url: z.string().url()', 'website: z.string().url().optional()'],
      goodExample: "url: z.string().url().refine(u => u.startsWith('https://'), { message: 'Only HTTPS URLs accepted' })",
      badExample: "url: z.string().url()  // accepts javascript:alert(1)",
      relatedPlaybooks: ['xss-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_url_no_protocol', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.url\(\)/.test(line) && !line.includes('startsWith') && !line.includes('https') && !line.includes('refine(')) {
            findings.push({ severity, category: 'zod_url_no_protocol', file: path, line: i + 1, message: 'URL schema accepts any protocol including javascript:// — XSS risk.', suggestion: "Add .refine(u => u.startsWith('https://'), { message: 'HTTPS required' })." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_010',
    category: 'zod_array_no_maxlength',
    description: 'Arrays without .max() allow unbounded-size payloads — memory exhaustion DoS.',
    severity: 'MEDIUM',
    tags: ['zod', 'security', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'An API accepting z.array(ItemSchema) with no limit can be sent an array of millions of items. Even lightweight per-item processing at scale exhausts memory. Always set a reasonable maximum.',
      commonViolations: ['z.array(ItemSchema)', 'tags: z.array(z.string())'],
      goodExample: 'tags: z.array(z.string().max(50)).max(20)',
      badExample: 'const body = z.object({ items: z.array(ItemSchema) });  // no limit — can be millions of items',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: ['api-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_array_no_maxlength', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/z\.array\(/.test(line) && !line.includes('.max(') && !line.includes('.length(')) {
            const next2 = lines.slice(i, Math.min(lines.length, i + 3)).join('');
            if (!next2.includes('.max(')) {
              findings.push({ severity, category: 'zod_array_no_maxlength', file: path, line: i + 1, message: 'z.array() without .max() — unbounded arrays are a DoS risk.', suggestion: 'Add .max(N) appropriate to your use case, e.g. .max(100) for bulk actions.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_011',
    category: 'zod_number_no_max',
    description: 'Number fields used for pagination (limit, take, pageSize) without .max() allow full-table reads.',
    severity: 'HIGH',
    tags: ['zod', 'security', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'A take: z.number() without a cap allows ?limit=9999999. Even if the database has 1000 rows it will try to load all. Set z.number().int().min(1).max(100) for pagination fields.',
      commonViolations: ['limit: z.number()', 'take: z.number().optional()', 'pageSize: z.number().default(10)'],
      goodExample: 'limit: z.number().int().min(1).max(100).default(20)',
      badExample: 'const query = z.object({ limit: z.number() });  // ?limit=1000000 is valid',
      relatedPlaybooks: ['api-design.md'],
      relatedAgents: ['api-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_number_no_max', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path) || !isZodFile(content)) continue;
        const PAGINATION_RE = /(?:limit|take|pageSize|page_size|perPage|per_page|count)\s*:\s*z\.number\(\)/;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PAGINATION_RE.test(line) && !line.includes('.max(')) {
            findings.push({ severity, category: 'zod_number_no_max', file: path, line: i + 1, message: 'Pagination field without .max() allows full-table scan.', suggestion: 'Add .int().min(1).max(100) to cap result set size.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_012',
    category: 'zod_uuid_field_missing',
    description: 'ID fields typed as z.string() instead of z.string().uuid() allow any string to be passed as an identifier.',
    severity: 'MEDIUM',
    tags: ['zod', 'validation', 'api'],
    sinceVersion: '3.0.0',
    explain: {
      why: "ID fields should enforce UUID format so database queries fail with a clean 400 rather than a DB error when a malformed ID is provided. z.string().uuid() rejects 'undefined', '../../etc/passwd', and injection attempts.",
      commonViolations: ['id: z.string()', 'userId: z.string()', 'postId: z.string().optional()'],
      goodExample: 'userId: z.string().uuid()',
      badExample: "userId: z.string()  // accepts '../../etc/passwd' as a valid user ID",
      relatedPlaybooks: ['api-design.md'],
      relatedAgents: ['api-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_uuid_field_missing', config.severityRules);
      const findings: Finding[] = [];
      const ID_FIELD_RE = /\b(?:id|Id|ID|_id)\s*:\s*z\.string\(\)/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (ID_FIELD_RE.test(line) && !line.includes('.uuid()') && !line.includes('.cuid()') && !line.includes('.nanoid()')) {
            findings.push({ severity, category: 'zod_uuid_field_missing', file: path, line: i + 1, message: 'ID field typed as plain z.string() — any string passes.', suggestion: 'Use z.string().uuid() (or .cuid() / .nanoid()) to enforce identifier format.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_013',
    category: 'zod_no_infer',
    description: 'Defining TypeScript types separately from Zod schemas creates drift. Use z.infer<typeof Schema>.',
    severity: 'LOW',
    tags: ['zod', 'typescript', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'When you define a TS type separately from the Zod schema, they can diverge silently — the schema validates one shape while the type declares another. z.infer<typeof Schema> derives the type from the schema automatically.',
      commonViolations: ['type User = { name: string; email: string } // duplicate of UserSchema'],
      goodExample: 'const UserSchema = z.object({ name: z.string(), email: z.string().email() });\ntype User = z.infer<typeof UserSchema>;',
      badExample: 'const UserSchema = z.object({ ... });\ninterface User { name: string; email: string; }  // drifts from schema',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_no_infer', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path) || !isZodFile(content)) continue;
        if (!content.includes('z.object(')) continue;
        if (!content.includes('z.infer<') && !content.includes('z.output<') && !content.includes('z.input<')) {
          findings.push({ severity, category: 'zod_no_infer', file: path, message: 'File defines Zod schemas but does not use z.infer<> to derive TypeScript types.', suggestion: 'Replace manual type definitions with: type MyType = z.infer<typeof MySchema>.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_014',
    category: 'zod_enum_not_const',
    description: 'Inline z.enum(["a","b","c"]) literals should be extracted to a const tuple for reuse in TypeScript.',
    severity: 'LOW',
    tags: ['zod', 'typescript', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.enum([...]) infers a Zod enum but the literal values are not re-exported. Extracting to const VALUES = [...] as const lets you use VALUES[number] as a TypeScript type and iterate over valid values at runtime.',
      commonViolations: ["status: z.enum(['active', 'inactive', 'pending'])"],
      goodExample: "const STATUSES = ['active', 'inactive', 'pending'] as const;\nstatus: z.enum(STATUSES)\ntype Status = typeof STATUSES[number]",
      badExample: "z.enum(['active', 'inactive', 'pending'])  // values not accessible outside schema",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_enum_not_const', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/z\.enum\(\[['"]/.test(line)) {
            findings.push({ severity, category: 'zod_enum_not_const', file: path, line: i + 1, message: 'Inline z.enum() literal — extract to a const tuple for reusability.', suggestion: "const VALUES = ['a','b'] as const; z.enum(VALUES) — then use VALUES[number] as TS type." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_015',
    category: 'zod_object_strict_missing',
    description: 'Input schemas that process sensitive operations should use .strict() to reject unknown fields.',
    severity: 'MEDIUM',
    tags: ['zod', 'security', 'api'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'While Zod strips unknown keys by default, .strict() makes the presence of any extra key a validation error. For privileged operations (role changes, billing), this prevents attackers from probing your schema by sending extra fields.',
      commonViolations: ['z.object({ role: z.string() })', 'AdminActionSchema = z.object({...})'],
      goodExample: 'const AdminActionSchema = z.object({ userId: z.string().uuid(), role: RoleEnum }).strict()',
      badExample: 'z.object({ role: z.string() })  // silently strips isAdmin:true rather than rejecting',
      relatedPlaybooks: ['security-review.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_object_strict_missing', config.severityRules);
      const findings: Finding[] = [];
      const ADMIN_RE = /(?:admin|Admin|privileged|Privileged|billing|Billing|role|Role)Schema\s*=\s*z\.object\(/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (ADMIN_RE.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
            if (!block.includes('.strict()')) {
              findings.push({ severity, category: 'zod_object_strict_missing', file: path, line: i + 1, message: 'Privileged action schema without .strict() — extra fields pass silently.', suggestion: 'Add .strict() to reject any unknown keys in privileged schemas.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_016',
    category: 'zod_number_not_int',
    description: 'Count/quantity/pagination fields should use .int() to reject 1.5 or NaN.',
    severity: 'LOW',
    tags: ['zod', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.number() accepts floats. A count of 2.7 or a page of 1.5 can cause unexpected database behavior or arithmetic bugs downstream. Add .int() for any field that must be a whole number.',
      commonViolations: ['count: z.number().min(0)', 'page: z.number().default(1)'],
      goodExample: 'count: z.number().int().min(0)\npage: z.number().int().min(1)',
      badExample: 'count: z.number().min(0)  // accepts 2.7 as a valid count',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_number_not_int', config.severityRules);
      const findings: Finding[] = [];
      const COUNT_RE = /(?:count|quantity|qty|page|offset|skip|take|limit|total)\s*:\s*z\.number\(\)/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (COUNT_RE.test(line) && !line.includes('.int()')) {
            findings.push({ severity, category: 'zod_number_not_int', file: path, line: i + 1, message: 'Integer field (count/page/limit) without .int() — accepts floats.', suggestion: 'Chain .int() to enforce whole numbers: z.number().int().min(1).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_017',
    category: 'zod_coerce_boolean_string',
    description: 'z.coerce.boolean() converts any truthy string including "false" to true. Use explicit transformation instead.',
    severity: 'HIGH',
    tags: ['zod', 'validation', 'bugs'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.coerce.boolean() uses Boolean() coercion. Boolean("false") === true, meaning the string "false" is treated as truthy. For query params like ?enabled=false this is catastrophically wrong.',
      commonViolations: ['enabled: z.coerce.boolean()', 'active: z.coerce.boolean().default(true)'],
      goodExample: "enabled: z.string().transform(v => v === 'true').pipe(z.boolean())",
      badExample: "enabled: z.coerce.boolean()  // '?enabled=false' becomes true",
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_coerce_boolean_string', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/z\.coerce\.boolean\(\)/.test(line)) {
            findings.push({ severity, category: 'zod_coerce_boolean_string', file: path, line: i + 1, message: "z.coerce.boolean() — the string 'false' coerces to true.", suggestion: "Use z.string().transform(v => v === 'true').pipe(z.boolean()) for query params." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_018',
    category: 'zod_date_no_range',
    description: 'Date fields without min/max constraints accept epoch dates or dates far in the future, causing data integrity issues.',
    severity: 'LOW',
    tags: ['zod', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Accepting any date means "1970-01-01" or "9999-12-31" pass validation. For business dates (appointments, schedules, expiry), bound the acceptable range to prevent garbage data.',
      commonViolations: ['startDate: z.coerce.date()', 'expiresAt: z.date().optional()'],
      goodExample: "startDate: z.coerce.date().min(new Date(), { message: 'Must be a future date' })",
      badExample: "dueDate: z.coerce.date()  // accepts '1970-01-01' and '9999-12-31'",
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_date_no_range', config.severityRules);
      const BUSINESS_DATE_RE = /(?:dueDate|startDate|endDate|expiresAt|scheduledAt|deliveryDate|appointmentDate)\s*:\s*(?:z\.coerce\.date\(\)|z\.date\(\))/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (BUSINESS_DATE_RE.test(line) && !line.includes('.min(') && !line.includes('.max(')) {
            findings.push({ severity, category: 'zod_date_no_range', file: path, line: i + 1, message: 'Business date field without min/max range constraints.', suggestion: 'Add .min(new Date()) for future dates or explicit range for historical data.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_019',
    category: 'zod_price_negative_allowed',
    description: 'Price/amount fields without .positive() or .min(0) allow negative values that break billing logic.',
    severity: 'HIGH',
    tags: ['zod', 'validation', 'billing'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Accepting a negative price can trigger negative charges in payment processors. At minimum it corrupts financial records. Always validate monetary amounts are non-negative.',
      commonViolations: ['price: z.number()', 'amount: z.number().int()', 'total: z.number().optional()'],
      goodExample: 'price: z.number().positive().multipleOf(0.01)  // positive and max 2 decimal places',
      badExample: 'price: z.number()  // accepts -999.99',
      relatedPlaybooks: ['billing.md'],
      relatedAgents: ['billing-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_price_negative_allowed', config.severityRules);
      const PRICE_RE = /(?:price|amount|cost|fee|charge|total|subtotal|discount)\s*:\s*z\.number\(\)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PRICE_RE.test(line) && !line.includes('.positive()') && !line.includes('.min(0') && !line.includes('.nonnegative()')) {
            findings.push({ severity, category: 'zod_price_negative_allowed', file: path, line: i + 1, message: 'Monetary field allows negative values.', suggestion: 'Add .positive() or .nonnegative() to prevent negative price submission.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_020',
    category: 'zod_unsafe_html_string',
    description: 'String fields named "content", "body", or "html" without a sanitization note are potential stored-XSS vectors.',
    severity: 'MEDIUM',
    tags: ['zod', 'security', 'xss'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Zod validates schema shape, not content safety. A z.string() field named "content" or "body" that accepts HTML must be sanitized before rendering. The schema comment/type should flag this requirement.',
      commonViolations: ['content: z.string()', 'body: z.string().max(10000)', 'html: z.string()'],
      goodExample: '// Must be sanitized with DOMPurify before rendering\ncontent: z.string().max(50000).transform(s => s.trim())',
      badExample: 'body: z.string()  // XSS if rendered as innerHTML without sanitization',
      relatedPlaybooks: ['xss-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['sanitize-html-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_unsafe_html_string', config.severityRules);
      const HTML_FIELD_RE = /\b(?:html|innerHTML|content|body|richText|markup)\s*:\s*z\.string\(\)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (HTML_FIELD_RE.test(line) && !line.includes('sanitize') && !line.includes('DOMPurify')) {
            findings.push({ severity, category: 'zod_unsafe_html_string', file: path, line: i + 1, message: 'HTML/content string field without sanitization note — stored XSS risk.', suggestion: 'Add a comment that this field must be sanitized with DOMPurify before rendering.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_021',
    category: 'zod_transform_loses_type',
    description: '.transform() that returns a different type changes the inferred schema output type, causing type surprises downstream.',
    severity: 'LOW',
    tags: ['zod', 'typescript'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.string().transform(Number) changes the output type to number. If callers use ZodInput vs ZodOutput interchangeably they get type errors at runtime. Make the transformation explicit with z.string().pipe(z.coerce.number()) or document clearly.',
      commonViolations: ['z.string().transform(Number)', 'z.string().transform(v => new Date(v))'],
      goodExample: 'z.string().pipe(z.coerce.date())  // explicit conversion with type safety',
      badExample: 'z.string().transform(v => new Date(v))  // output type is Date but looks like string schema',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_transform_loses_type', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/z\.string\(\)\.transform\((?:Number|Boolean|parseInt|parseFloat)/.test(line)) {
            findings.push({ severity, category: 'zod_transform_loses_type', file: path, line: i + 1, message: '.transform() changes the output type — use .pipe(z.coerce.X()) for explicit typed conversion.', suggestion: 'Use z.string().pipe(z.coerce.number()) instead of .transform(Number) for explicit type safety.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_022',
    category: 'zod_lazy_missing',
    description: 'Self-referential schemas without z.lazy() cause infinite recursion at module load time.',
    severity: 'HIGH',
    tags: ['zod', 'validation', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'A schema that references itself (e.g. a comment with replies of type Comment[]) must use z.lazy(() => Schema) to defer evaluation. Without it, the module crashes immediately with a ReferenceError at import time.',
      commonViolations: ['replies: z.array(CommentSchema)', 'children: z.array(NodeSchema)'],
      goodExample: 'type Category = z.infer<typeof CategorySchema>;\nconst CategorySchema: z.ZodType<Category> = z.object({ children: z.lazy(() => z.array(CategorySchema)) });',
      badExample: 'const CommentSchema = z.object({ replies: z.array(CommentSchema) });  // ReferenceError!',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_lazy_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        if (content.includes('z.lazy(')) return findings;
        const SELF_REF_RE = /z\.array\((\w+Schema)\)/g;
        const SCHEMA_DEFS = new Set<string>();
        for (const m of content.matchAll(/const\s+(\w+Schema)\s*=/g)) SCHEMA_DEFS.add(m[1]!);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          let m: RegExpExecArray | null;
          SELF_REF_RE.lastIndex = 0;
          while ((m = SELF_REF_RE.exec(line)) !== null) {
            if (SCHEMA_DEFS.has(m[1]!)) {
              findings.push({ severity, category: 'zod_lazy_missing', file: path, line: i + 1, message: `Self-referential schema (${m[1]}) without z.lazy() — will throw ReferenceError.`, suggestion: 'Wrap with z.lazy(() => z.array(SchemaName)) and add an explicit ZodType annotation.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_023',
    category: 'zod_optional_with_default',
    description: '.optional().default(X) chains are confusing — .default(X) already makes the field optional.',
    severity: 'LOW',
    tags: ['zod', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.string().optional().default("foo") is redundant. .default() makes the field optional in inputs (undefined is replaced). Adding .optional() before .default() wraps the whole thing in ZodOptional unnecessarily.',
      commonViolations: ['z.string().optional().default("")', 'z.number().optional().default(0)'],
      goodExample: 'z.string().default("")  // undefined input → ""',
      badExample: 'z.string().optional().default("")  // redundant — .default() implies optional input',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_optional_with_default', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.optional\(\)\.default\(/.test(line)) {
            findings.push({ severity, category: 'zod_optional_with_default', file: path, line: i + 1, message: '.optional().default() is redundant — .default() already handles undefined.', suggestion: 'Remove .optional() and keep only .default(value).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_024',
    category: 'zod_ip_missing_validation',
    description: 'IP address fields typed as plain z.string() allow any string. Use .ip() for validation.',
    severity: 'MEDIUM',
    tags: ['zod', 'validation', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'IP address fields that store any string can be used to inject newlines (log injection) or bypass IP-based access controls. z.string().ip() validates both IPv4 and IPv6 formats.',
      commonViolations: ['ipAddress: z.string()', 'clientIp: z.string().optional()'],
      goodExample: 'ipAddress: z.string().ip()',
      badExample: "ipAddress: z.string()  // accepts '127.0.0.1\\nX-Forwarded-For: 1.2.3.4'",
      relatedPlaybooks: ['security-review.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_ip_missing_validation', config.severityRules);
      const IP_FIELD_RE = /\b(?:ip|ipAddress|clientIp|remoteIp|sourceIp|ipAddr)\s*:\s*z\.string\(\)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (IP_FIELD_RE.test(line) && !line.includes('.ip()')) {
            findings.push({ severity, category: 'zod_ip_missing_validation', file: path, line: i + 1, message: 'IP address field without .ip() validation.', suggestion: 'Use z.string().ip() to validate IPv4 and IPv6 format.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_025',
    category: 'zod_superrefine_no_ctx',
    description: '.superRefine() that calls ctx.addIssue correctly is preferred over plain .refine() for multiple error scenarios.',
    severity: 'LOW',
    tags: ['zod', 'dx', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: '.refine() can only report one error. .superRefine() with ctx.addIssue() reports multiple independent validation errors in a single pass, giving clients better error detail for complex objects.',
      commonViolations: ['multiple chained .refine() calls on the same object'],
      goodExample: '.superRefine((val, ctx) => { if (!val.start) ctx.addIssue({...}); if (!val.end) ctx.addIssue({...}); })',
      badExample: '.refine(v => v.start < v.end).refine(v => v.start != null).refine(v => v.end != null)  // stops at first failure',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_superrefine_no_ctx', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.refine\(/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 6)).join('\n');
            const refineCount = (block.match(/\.refine\(/g) || []).length;
            if (refineCount >= 3) {
              findings.push({ severity, category: 'zod_superrefine_no_ctx', file: path, line: i + 1, message: 'Three or more chained .refine() calls — use .superRefine() to report all errors at once.', suggestion: 'Replace chains with .superRefine((val, ctx) => { ctx.addIssue({...}) per failure }).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_026',
    category: 'zod_discriminated_union_opportunity',
    description: 'z.union() where all variants share a discriminant field should use z.discriminatedUnion() for better errors and performance.',
    severity: 'LOW',
    tags: ['zod', 'performance', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'z.union() tries all schemas sequentially until one matches. z.discriminatedUnion("type", [...]) does a direct lookup, giving O(1) parsing and much better "Expected X, got Y" error messages.',
      commonViolations: ["z.union([z.object({ type: z.literal('a') }), z.object({ type: z.literal('b') })])"],
      goodExample: "z.discriminatedUnion('type', [z.object({ type: z.literal('a'), ... }), ...])",
      badExample: "z.union([z.object({ type: z.literal('a') }), z.object({ type: z.literal('b') })])  // O(N) lookup",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_discriminated_union_opportunity', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/z\.union\(\[/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 15)).join('\n');
            if (/z\.literal\(/.test(block) && /type\s*:\s*z\.literal\(/.test(block)) {
              findings.push({ severity, category: 'zod_discriminated_union_opportunity', file: path, line: i + 1, message: 'z.union() with type literals — use z.discriminatedUnion() for O(1) matching and better errors.', suggestion: "Replace with z.discriminatedUnion('type', [...]) for each literal variant." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_027',
    category: 'zod_phone_no_validation',
    description: 'Phone number fields without format validation accept any string including script tags.',
    severity: 'MEDIUM',
    tags: ['zod', 'validation', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Phone numbers have well-known formats (E.164: +15551234567). Without validation, callers can submit arbitrary strings that may be rendered as links, stored in logs, or cause downstream SMS gateway errors.',
      commonViolations: ['phone: z.string()', 'phoneNumber: z.string().optional()'],
      goodExample: "phone: z.string().regex(/^\\+[1-9]\\d{1,14}$/, { message: 'E.164 format required: +15551234567' })",
      badExample: "phone: z.string()  // accepts '<script>alert(1)</script>'",
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_phone_no_validation', config.severityRules);
      const PHONE_RE = /\b(?:phone|phoneNumber|phone_number|mobileNumber|mobile)\s*:\s*z\.string\(\)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PHONE_RE.test(line) && !line.includes('.regex(') && !line.includes('regex') && !line.includes('.min(')) {
            findings.push({ severity, category: 'zod_phone_no_validation', file: path, line: i + 1, message: 'Phone number field without format validation.', suggestion: 'Add .regex(/^\\+[1-9]\\d{1,14}$/) for E.164 format, or use a phone-specific validation library.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_028',
    category: 'zod_credit_card_in_schema',
    description: 'Schemas accepting credit card numbers must comply with PCI DSS — storing raw PANs requires certification.',
    severity: 'BLOCKER',
    tags: ['zod', 'security', 'pci', 'compliance'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Storing raw Primary Account Numbers (PANs) makes your system in-scope for PCI DSS Level 1, requiring annual QSA audits. Use a payment processor token (Stripe PaymentMethod ID) instead.',
      commonViolations: ['cardNumber: z.string()', 'creditCard: z.string().regex(...)'],
      goodExample: '// Store Stripe/Braintree token instead\npaymentMethodId: z.string().startsWith("pm_")',
      badExample: 'cardNumber: z.string()  // storing raw PANs = PCI DSS scope',
      relatedPlaybooks: ['payment-security.md'],
      relatedAgents: ['billing-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_credit_card_in_schema', config.severityRules);
      const CC_RE = /\b(?:cardNumber|card_number|creditCard|credit_card|pan|cardNum)\s*:\s*z\.string/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (CC_RE.test(line)) {
            findings.push({ severity, category: 'zod_credit_card_in_schema', file: path, line: i + 1, message: 'Schema accepts a raw credit card number — PCI DSS scope violation.', suggestion: 'Use payment processor tokenization. Store pm_xxx / tok_xxx, never the raw PAN.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_029',
    category: 'zod_regex_no_anchors',
    description: 'Regex validators without ^ and $ anchors match anywhere in the string, bypassing intended validation.',
    severity: 'HIGH',
    tags: ['zod', 'validation', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'A regex like /[A-Z0-9]+/ matches any string containing those characters — "valid123" but also "valid123<script>". Without ^ and $ anchors, the validation intent is broken.',
      commonViolations: ['.regex(/[a-z]+/)', '.regex(/\\d{4}/)'],
      goodExample: '.regex(/^[a-z]{3,20}$/)  // anchored — must be entirely lowercase alpha',
      badExample: '.regex(/[a-z]+/)  // matches anywhere in string — "abc<script>" passes',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_regex_no_anchors', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          const m = line.match(/\.regex\(\/([^/]+)\//);
          if (m) {
            const pattern = m[1]!;
            if (!pattern.startsWith('^') && !pattern.endsWith('$')) {
              findings.push({ severity, category: 'zod_regex_no_anchors', file: path, line: i + 1, message: 'Regex validator missing ^ and $ anchors — matches anywhere in the string.', suggestion: 'Add ^ and $ anchors: .regex(/^YOUR_PATTERN$/).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'ZOD_030',
    category: 'zod_ssn_in_schema',
    description: 'Schemas accepting Social Security Numbers (SSNs) are subject to CCPA/GDPR special-category data requirements.',
    severity: 'BLOCKER',
    tags: ['zod', 'compliance', 'pii', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'SSNs are government-issued identifiers classified as sensitive PII under CCPA, GDPR Article 9, and HIPAA. If collected, they must be encrypted at rest, access-logged, and explicitly consented to. Flag for legal review.',
      commonViolations: ['ssn: z.string()', 'socialSecurityNumber: z.string().regex(...)'],
      goodExample: '// If SSN is necessary: encrypt before storage, add audit log, legal consent required\nssn: z.string().regex(/^\\d{3}-\\d{2}-\\d{4}$/).describe("Requires legal consent and encryption")',
      badExample: 'ssn: z.string()  // PII without encryption/consent requirement',
      relatedPlaybooks: ['privacy-compliance.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zod_ssn_in_schema', config.severityRules);
      const SSN_RE = /\b(?:ssn|SSN|socialSecurityNumber|social_security_number|taxId|tax_id)\s*:\s*z\.string/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isZodFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SSN_RE.test(line)) {
            findings.push({ severity, category: 'zod_ssn_in_schema', file: path, line: i + 1, message: 'Schema collects SSN/tax ID — special-category PII requiring legal review and encryption.', suggestion: 'Consult legal, add encryption, consent flow, and access audit logging before shipping.' });
          }
        }
      }
      return findings;
    },
  },
];
