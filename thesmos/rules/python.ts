/**
 * Python Security Rules — PY_001–025
 *
 * Targets the predictable security failure modes of AI-generated Python code.
 * Covers FastAPI, Flask, Django, LangChain, and the OpenAI/Anthropic SDK.
 *
 * Research basis: same vibe-coding failure patterns as JavaScript — eval(), no
 * auth, SSRF, SQL injection — but expressed in Python idioms. AI assistants
 * generate functionally-correct Python but consistently skip rate limiting,
 * input validation, auth middleware, and safe deserialization.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPyFile(p: string) { return p.endsWith('.py'); }
function isPyTest(p: string) { return /(?:^|\/)(?:tests?|conftest|test_|_test)\b/.test(p); }

function lineOf(content: string, re: RegExp): number | undefined {
  const idx = content.split('\n').findIndex((l) => re.test(l));
  return idx >= 0 ? idx + 1 : undefined;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const PYTHON_RULES: ThesmosRule[] = [

  // ── PY_001: eval() / exec() ──────────────────────────────────────────────
  {
    id: 'PY_001',
    category: 'py_eval_exec',
    description: 'eval() or exec() called with a non-literal argument — remote code execution risk.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'rce', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'eval() and exec() execute arbitrary Python code at runtime. When the argument is user-controlled or LLM-generated, an attacker can run any Python on the server — read secrets, spawn shells, or pivot to other systems. AI assistants frequently use eval() to "parse" JSON or expressions.',
      commonViolations: [
        'eval(request.json()["formula"])',
        'exec(llm_response.content)',
        'result = eval(f"calculate({user_input})")',
      ],
      goodExample: 'import ast\nresult = ast.literal_eval(user_input)  # safe: only literals',
      badExample: 'result = eval(user_input)  # ❌ RCE if user_input is malicious',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_eval_exec', config.severityRules);
      const findings: Finding[] = [];
      const EVAL_RE = /\b(?:eval|exec)\s*\(\s*(?!['"](?:[^'"\\]|\\.)*['"])/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (EVAL_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'py_eval_exec', file: path, line: i + 1,
              message: 'eval() or exec() called with a dynamic argument — potential RCE if user-controlled.',
              suggestion: 'Remove eval/exec. Use ast.literal_eval() for safe literal parsing or structured data models.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_002: SQL injection via f-string / % formatting ────────────────────
  {
    id: 'PY_002',
    category: 'py_sql_injection',
    description: 'SQL query built with f-string or % formatting — SQL injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Building SQL queries with f-strings or % string formatting allows attackers to escape the query context and run arbitrary SQL. AI assistants generate f-string SQL routinely because it reads naturally — but it is the #1 Python injection pattern.',
      commonViolations: [
        'cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")',
        'db.execute("SELECT * FROM %s" % table_name)',
        'session.execute(text(f"DELETE FROM {table} WHERE id = {row_id}"))',
      ],
      goodExample: 'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))',
      badExample: 'cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")  # ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      // f-string in execute() OR string followed by % operator (string % variable)
      const SQL_RE = /\.execute\s*\(\s*f['"]|\.execute\s*\(\s*['"][^'"]*['"]\s*%\s*\w/;
      const RAW_RE = /(?:text|raw)\s*\(\s*f['"]/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if ((SQL_RE.test(line) || RAW_RE.test(line)) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'py_sql_injection', file: path, line: i + 1,
              message: 'SQL query built with f-string or % formatting — vulnerable to SQL injection.',
              suggestion: 'Use parameterized queries: cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_003: Hardcoded secrets ─────────────────────────────────────────────
  {
    id: 'PY_003',
    category: 'py_hardcoded_secret',
    description: 'Hardcoded secret, API key, or password found in Python source.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'secrets', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Hardcoded credentials are permanently in git history even after deletion. They are extracted by automated scanners, leaked in CI logs, and shared in forks. AI assistants generate placeholder values like api_key = "sk-test-..." that users often ship unchanged.',
      commonViolations: [
        'OPENAI_API_KEY = "sk-abc123..."',
        'DATABASE_PASSWORD = "hunter2"',
        'client = OpenAI(api_key="sk-...")',
      ],
      goodExample: 'import os\nclient = OpenAI(api_key=os.environ["OPENAI_API_KEY"])',
      badExample: 'OPENAI_API_KEY = "sk-proj-abc123..."  # ❌ hardcoded credential',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_hardcoded_secret', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_VAR = /(?:api_?key|secret|password|passwd|token|credential|private_?key)\s*=\s*['"][^'"]{6,}['"]/i;
      const OPENAI_KEY = /sk-[a-zA-Z0-9]{20,}/;
      const ANTHROPIC_KEY = /sk-ant-[a-zA-Z0-9-]{20,}/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (SECRET_VAR.test(line) || OPENAI_KEY.test(line) || ANTHROPIC_KEY.test(line)) {
            findings.push({
              severity: sev, category: 'py_hardcoded_secret', file: path, line: i + 1,
              message: 'Hardcoded secret or API key detected.',
              suggestion: 'Use os.environ.get("API_KEY") or a secrets manager. Never commit credentials.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_004: SSRF via requests with user-controlled URL ───────────────────
  {
    id: 'PY_004',
    category: 'py_ssrf',
    description: 'requests.get/post called with a variable URL — potential SSRF if user-controlled.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'ssrf', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Server-Side Request Forgery lets attackers redirect server HTTP requests to internal services, the AWS metadata endpoint (169.254.169.254), or private networks. AI assistants generate proxy/fetch patterns like requests.get(url) where url comes from user input without destination validation.',
      commonViolations: [
        'url = request.args.get("url"); requests.get(url)',
        'response = httpx.get(body["webhook_url"])',
        'aiohttp.ClientSession().get(user_provided_endpoint)',
      ],
      goodExample: 'from urllib.parse import urlparse\nif urlparse(url).hostname not in ALLOWED_HOSTS:\n    raise ValueError("Disallowed host")\nrequests.get(url, timeout=10)',
      badExample: 'url = request.args.get("url")\nrequests.get(url)  # ❌ SSRF',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_ssrf', config.severityRules);
      const findings: Finding[] = [];
      const SSRF_RE = /(?:requests|httpx|aiohttp\.ClientSession\(\))\s*\.(?:get|post|put|delete|request|fetch)\s*\(\s*(?!['"](?:https?:\/\/(?:api\.|cdn\.|static\.)))/;
      const URL_VALIDATE = /urlparse|validate_url|allowed_domains|is_safe_url|urllib\.parse/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        if (!SSRF_RE.test(content)) continue;
        if (URL_VALIDATE.test(content)) continue;
        const line = lineOf(content, SSRF_RE);
        findings.push({
          severity: sev, category: 'py_ssrf', file: path, line,
          message: 'HTTP request with potentially user-controlled URL — validate and allowlist destinations before making requests.',
          suggestion: 'Validate URLs against an allowlist: urllib.parse.urlparse(url).hostname in ALLOWED_HOSTS',
        });
      }
      return findings;
    },
  },

  // ── PY_005: FastAPI/Flask route with no auth ─────────────────────────────
  {
    id: 'PY_005',
    category: 'py_missing_auth',
    description: 'FastAPI or Flask route decorator with no authentication dependency or login_required.',
    severity: 'HIGH',
    tags: ['security', 'python', 'auth', 'fastapi', 'flask', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI assistants generate route handlers that implement the happy path (accept data, process it) but forget the auth check. Mutating endpoints (POST/PUT/PATCH/DELETE) without authentication allow any anonymous caller on the internet to modify data.',
      commonViolations: [
        '@app.post("/users") async def create_user(data: CreateUser): ...',
        '@router.delete("/items/{id}") async def delete_item(id: int): ...',
        '@app.put("/profile") async def update_profile(body: dict): ...',
      ],
      goodExample: '@router.post("/users")\nasync def create_user(\n    data: CreateUser,\n    current_user: User = Depends(get_current_user)\n): ...',
      badExample: '@app.post("/users")\nasync def create_user(data: CreateUser):  # ❌ no auth\n    await db.insert(data)',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_missing_auth', config.severityRules);
      const findings: Finding[] = [];
      const ROUTE_RE = /(?:@app|@router|@blueprint)\s*\.\s*(?:post|put|patch|delete)\s*\(/;
      const AUTH_RE = /Depends\s*\(|login_required|require_auth|current_user|get_current_user|authenticate|security|HTTPBearer|OAuth2/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!ROUTE_RE.test(lines[i]!)) continue;
          const window = lines.slice(i, i + 10).join('\n');
          if (!AUTH_RE.test(window)) {
            findings.push({
              severity: sev, category: 'py_missing_auth', file: path, line: i + 1,
              message: 'Mutating route (POST/PUT/PATCH/DELETE) has no visible authentication.',
              suggestion: 'Add: async def handler(current_user: User = Depends(get_current_user)) — or use @login_required in Flask.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PY_006: Shell injection via subprocess / os.system ───────────────────
  {
    id: 'PY_006',
    category: 'py_shell_injection',
    description: 'subprocess or os.system called with a dynamic string — shell injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'shell-injection', 'rce'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Passing user input to shell commands via os.system() or subprocess with shell=True allows attackers to inject shell metacharacters (;, |, &, $()) and execute arbitrary commands on the host. This is a full server takeover vector.',
      commonViolations: [
        'os.system(f"ffmpeg -i {filename} output.mp4")',
        'subprocess.call(f"convert {user_file}", shell=True)',
        'os.popen(f"identify {path}").read()',
      ],
      goodExample: 'subprocess.run(["ffmpeg", "-i", filename, "output.mp4"], shell=False)',
      badExample: 'os.system(f"ffmpeg -i {filename} output.mp4")  # ❌ shell injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_shell_injection', config.severityRules);
      const findings: Finding[] = [];
      const SHELL_RE = /(?:subprocess\.(?:call|run|Popen|check_output|check_call)\s*\([^)]*shell\s*=\s*True|os\.system\s*\(\s*(?!['"]))/;
      const OS_POPEN = /os\.popen\s*\(\s*(?!['"])/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (SHELL_RE.test(line) || OS_POPEN.test(line)) {
            findings.push({
              severity: sev, category: 'py_shell_injection', file: path, line: i + 1,
              message: 'subprocess/os.system with shell=True or dynamic argument — potential shell injection.',
              suggestion: 'Use subprocess.run(["cmd", arg1, arg2], shell=False) with a list of arguments.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_007: Pickle deserialization of untrusted data ─────────────────────
  {
    id: 'PY_007',
    category: 'py_pickle_deserialization',
    description: 'pickle.loads() or pickle.load() on data that may come from user input.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'deserialization', 'rce'],
    sinceVersion: '1.2.0',
    explain: {
      why: "pickle.loads() executes arbitrary Python code embedded in the serialized payload. Malicious pickle data can run shell commands, read files, and exfiltrate data. Even trusted-looking sources (S3, Redis) can be poisoned upstream — never unpickle data you didn't serialize yourself in the same process.",
      commonViolations: [
        'model = pickle.loads(request.body)',
        'obj = pickle.load(open(uploaded_file, "rb"))',
        'data = pickle.loads(redis_client.get(key))',
      ],
      goodExample: '# Use JSON or msgpack for data exchange\nimport json\ndata = json.loads(request.body)',
      badExample: 'data = pickle.loads(request.body)  # ❌ RCE if body is malicious',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_pickle_deserialization', config.severityRules);
      const findings: Finding[] = [];
      const PICKLE_RE = /pickle\.loads?\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (PICKLE_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'py_pickle_deserialization', file: path, line: i + 1,
              message: 'pickle.loads() can execute arbitrary code — never deserialize untrusted data with pickle.',
              suggestion: 'Use json.loads(), msgpack, or a schema-validated format (Pydantic). Sign payloads if you must use pickle.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_008: yaml.load() without safe Loader ──────────────────────────────
  {
    id: 'PY_008',
    category: 'py_yaml_load_unsafe',
    description: 'yaml.load() without a safe Loader — can execute arbitrary Python via !!python/object.',
    severity: 'HIGH',
    tags: ['security', 'python', 'deserialization'],
    sinceVersion: '1.2.0',
    explain: {
      why: "yaml.load() without Loader=yaml.SafeLoader supports the !!python/object YAML tag, which can instantiate arbitrary Python classes and execute code. The PyYAML docs explicitly warn against this. AI assistants use yaml.load() because it reads naturally.",
      commonViolations: [
        'config = yaml.load(open("config.yaml"))',
        'data = yaml.load(request.data)',
        'obj = yaml.load(content)',
      ],
      goodExample: 'config = yaml.safe_load(open("config.yaml"))',
      badExample: 'config = yaml.load(content)  # ❌ can execute !!python/object payloads',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_yaml_load_unsafe', config.severityRules);
      const findings: Finding[] = [];
      const YAML_RE = /\byaml\.load\s*\(/;
      const SAFE_LOADER = /Loader\s*=\s*yaml\.(?:Safe|Base)Loader/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (YAML_RE.test(line) && !SAFE_LOADER.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'py_yaml_load_unsafe', file: path, line: i + 1,
              message: 'yaml.load() without Loader=yaml.SafeLoader can execute arbitrary Python objects.',
              suggestion: 'Replace with yaml.safe_load(data) or yaml.load(data, Loader=yaml.SafeLoader).',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_009: Path traversal ────────────────────────────────────────────────
  {
    id: 'PY_009',
    category: 'py_path_traversal',
    description: 'File opened with a path from request/user input without traversal protection.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'path-traversal', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Path traversal (../../../etc/passwd) lets attackers read or write arbitrary files on the server. AI-generated file-serving endpoints pass user-supplied filenames directly to open() without checking that the resolved path stays inside the intended directory.',
      commonViolations: [
        'open(request.args.get("file"))',
        'with open(filename) as f:  # filename from query param',
        'Path(base_dir) / user_path  # no resolution check',
      ],
      goodExample: 'from pathlib import Path\nbase = Path("/var/uploads").resolve()\nsafe = (base / user_path).resolve()\nassert safe.is_relative_to(base)\nwith open(safe) as f: ...',
      badExample: 'with open(filename) as f:  # ❌ path traversal if filename is "../../../etc/passwd"',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const OPEN_VAR = /\bopen\s*\(\s*(?:filename|filepath|path|file_path|name|user_file|request\.|body\.|data\[|params\[)/;
      const TRAVERSAL_GUARD = /\.resolve\(\)|\.is_relative_to\(|os\.path\.abspath|startswith\(/;
      for (const { path: filePath, content } of changedFiles) {
        if (!isPyFile(filePath) || isPyTest(filePath)) continue;
        if (!OPEN_VAR.test(content)) continue;
        if (TRAVERSAL_GUARD.test(content)) continue;
        const line = lineOf(content, OPEN_VAR);
        findings.push({
          severity: sev, category: 'py_path_traversal', file: filePath, line,
          message: 'File opened with a user-controlled path without traversal protection.',
          suggestion: 'Use pathlib: safe_path = (base_dir / user_path).resolve(); assert safe_path.is_relative_to(base_dir)',
        });
      }
      return findings;
    },
  },

  // ── PY_010: CORS wildcard in FastAPI ─────────────────────────────────────
  {
    id: 'PY_010',
    category: 'py_cors_wildcard',
    description: 'CORSMiddleware configured with allow_origins=["*"] — permits any origin.',
    severity: 'HIGH',
    tags: ['security', 'python', 'cors', 'fastapi', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'A CORS wildcard allows any website to make cross-origin requests to your API from a browser. Combined with credentials (cookies, auth headers), this can enable CSRF-like attacks where a malicious site reads protected data from authenticated users.',
      commonViolations: [
        'app.add_middleware(CORSMiddleware, allow_origins=["*"])',
        'origins = ["*"]; app.add_middleware(CORSMiddleware, allow_origins=origins)',
      ],
      goodExample: 'app.add_middleware(CORSMiddleware, allow_origins=["https://yourdomain.com"])',
      badExample: 'app.add_middleware(CORSMiddleware, allow_origins=["*"])  # ❌ CORS wildcard',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_cors_wildcard', config.severityRules);
      const findings: Finding[] = [];
      const CORS_RE = /CORSMiddleware|add_middleware.*CORS/;
      const WILDCARD_RE = /allow_origins\s*=\s*\[\s*['"][*]['"]|allow_origins\s*=\s*\[\s*"[*]"/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        if (!CORS_RE.test(content) || !WILDCARD_RE.test(content)) continue;
        const line = lineOf(content, WILDCARD_RE);
        findings.push({
          severity: sev, category: 'py_cors_wildcard', file: path, line,
          message: 'CORS wildcard (allow_origins=["*"]) allows any domain to make cross-origin requests.',
          suggestion: 'Specify explicit origins: allow_origins=["https://yourdomain.com"]',
        });
      }
      return findings;
    },
  },

  // ── PY_011: Missing request timeout on HTTP calls ─────────────────────────
  {
    id: 'PY_011',
    category: 'py_no_request_timeout',
    description: 'requests.get/post with no timeout — server can hang indefinitely on slow upstream.',
    severity: 'MEDIUM',
    tags: ['reliability', 'python', 'availability'],
    sinceVersion: '1.2.0',
    explain: {
      why: "HTTP requests without a timeout block the worker thread indefinitely if the upstream server is slow or unresponsive. In production, this exhausts the thread pool and causes cascading failures across the entire application.",
      commonViolations: [
        'response = requests.get(url)',
        'data = requests.post(api_url, json=payload)',
        'r = httpx.get(endpoint)',
      ],
      goodExample: 'response = requests.get(url, timeout=10)',
      badExample: 'response = requests.get(url)  # ❌ hangs indefinitely',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_no_request_timeout', config.severityRules);
      const findings: Finding[] = [];
      const TIMEOUT_RE = /timeout\s*=/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (/\brequests\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(/.test(line) && !TIMEOUT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'py_no_request_timeout', file: path, line: i + 1,
              message: 'HTTP request without timeout — will block indefinitely if upstream is slow.',
              suggestion: 'Add timeout: requests.get(url, timeout=10)',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_012: Debug mode left on in Flask/FastAPI ───────────────────────────
  {
    id: 'PY_012',
    category: 'py_debug_mode',
    description: 'Flask/uvicorn debug=True — exposes interactive debugger and verbose error pages in production.',
    severity: 'HIGH',
    tags: ['security', 'python', 'flask', 'fastapi', 'configuration'],
    sinceVersion: '1.2.0',
    explain: {
      why: "Flask's Werkzeug debugger exposes an interactive Python console in the browser when debug=True. Any error page becomes a remote code execution surface — attackers can run arbitrary Python in the process by triggering any exception.",
      commonViolations: [
        'app.run(debug=True)',
        'uvicorn.run(app, host="0.0.0.0", debug=True)',
        'app.run(host="0.0.0.0", port=8000, debug=True)',
      ],
      goodExample: 'debug = os.environ.get("DEBUG", "false").lower() == "true"\napp.run(debug=debug)',
      badExample: 'app.run(debug=True)  # ❌ never in production',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_debug_mode', config.severityRules);
      const findings: Finding[] = [];
      const DEBUG_RE = /(?:app\.run|uvicorn\.run|hypercorn\.run)\s*\([^)]*debug\s*=\s*True/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const line = lineOf(content, DEBUG_RE);
        if (line !== undefined) {
          findings.push({
            severity: sev, category: 'py_debug_mode', file: path, line,
            message: 'debug=True left on — never run with debug mode in production.',
            suggestion: 'Use: debug=os.environ.get("DEBUG", "false").lower() == "true"',
          });
        }
      }
      return findings;
    },
  },

  // ── PY_013: Insecure random for security-sensitive values ─────────────────
  {
    id: 'PY_013',
    category: 'py_insecure_random',
    description: 'random module used for tokens, keys, or passwords — not cryptographically secure.',
    severity: 'HIGH',
    tags: ['security', 'python', 'cryptography'],
    sinceVersion: '1.2.0',
    explain: {
      why: "Python's random module uses a Mersenne Twister PRNG that is not cryptographically secure. Its output is predictable if an attacker observes enough values. Tokens, session IDs, passwords, and OTPs generated with random can be forged.",
      commonViolations: [
        'token = str(random.randint(100000, 999999))',
        'session_id = random.choices(string.ascii_letters, k=32)',
        'reset_key = "".join(random.choice(chars) for _ in range(32))',
      ],
      goodExample: 'import secrets\ntoken = secrets.token_urlsafe(32)',
      badExample: 'token = str(random.randint(100000, 999999))  # ❌ predictable',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_insecure_random', config.severityRules);
      const findings: Finding[] = [];
      const INSEC_RE = /\brandom\s*\.\s*(?:random|randint|randrange|choice|choices|shuffle)\s*\(/;
      const SEC_CONTEXT = /token|key|secret|password|salt|nonce|otp|csrf|session/i;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*#/.test(line) || !INSEC_RE.test(line)) continue;
          const ctx = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
          if (SEC_CONTEXT.test(ctx)) {
            findings.push({
              severity: sev, category: 'py_insecure_random', file: path, line: i + 1,
              message: 'random module used in security-sensitive context — use secrets module instead.',
              suggestion: 'import secrets; token = secrets.token_urlsafe(32)',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PY_014: LLM prompt injection risk ────────────────────────────────────
  {
    id: 'PY_014',
    category: 'py_prompt_injection',
    description: 'LLM prompt built by concatenating or f-stringing user input without sanitization.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'llm', 'prompt-injection', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Prompt injection allows attackers to override the system instructions embedded in your LLM prompt by crafting user input that escapes the intended context. When user_message is included directly in a system prompt f-string, an attacker can say "Ignore all previous instructions and..." — overriding your guardrails.',
      commonViolations: [
        'prompt = f"You are an assistant. User: {user_message}"',
        'messages = [{"role": "system", "content": f"Help with: {user_input}"}]',
        'chain.run(f"Translate this: {request_body}")',
      ],
      goodExample: '# Keep system prompt static; pass user content as a separate user message\nmessages = [\n    {"role": "system", "content": STATIC_SYSTEM_PROMPT},\n    {"role": "user", "content": user_message},\n]',
      badExample: 'prompt = f"System: You are helpful. User: {user_message}"  # ❌ prompt injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_prompt_injection', config.severityRules);
      const findings: Finding[] = [];
      const PROMPT_FSTR = /prompt\s*=\s*f['"].*\{(?:user|message|input|body|request|query|data)/i;
      const CHAT_MSG_FSTR = /["']content['"]\s*:\s*f['"].*\{(?:user|message|input|body)/i;
      const LLM_CALL = /openai\.|anthropic\.|groq\.|langchain\.|llm\.|chat\.completions/i;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!LLM_CALL.test(content)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (PROMPT_FSTR.test(line) || CHAT_MSG_FSTR.test(line)) {
            findings.push({
              severity: sev, category: 'py_prompt_injection', file: path, line: i + 1,
              message: 'LLM prompt includes raw user input — vulnerable to prompt injection attacks.',
              suggestion: 'Keep system prompt static. Pass user content only in the "user" role message, never the "system" role.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_015: AI endpoint with no auth ─────────────────────────────────────
  {
    id: 'PY_015',
    category: 'py_ai_endpoint_no_auth',
    description: 'Route calling OpenAI/Anthropic/LangChain with no authentication — unbounded API cost exposure.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'llm', 'auth', 'ai-risk', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: "Unauthenticated AI endpoints let anyone trigger paid API calls. A single script can exhaust a month's OpenAI budget in minutes. AI assistants build the LLM integration first and defer auth — leaving a period where the endpoint is publicly exploitable.",
      commonViolations: [
        '@app.post("/chat") async def chat(message: str): response = client.chat.completions.create(...)',
        '@router.get("/generate") async def generate(prompt: str): return llm.invoke(prompt)',
      ],
      goodExample: '@router.post("/chat")\nasync def chat(\n    message: str,\n    user: User = Depends(get_current_user)\n):\n    return client.chat.completions.create(...)',
      badExample: '@app.post("/chat")\nasync def chat(message: str):  # ❌ no auth — anyone can call this\n    return client.chat.completions.create(...)',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_ai_endpoint_no_auth', config.severityRules);
      const findings: Finding[] = [];
      const LLM_CALL = /openai\.|anthropic\.|groq\.|langchain\.|llm\.|chat\.completions\.|generate_content/;
      const AUTH_RE = /Depends\s*\(|login_required|require_auth|current_user|get_current_user|authenticate|HTTPBearer|OAuth2|api_key_header/i;
      const ROUTE_RE = /(?:@app|@router|@blueprint)\s*\.\s*(?:get|post|put|patch|delete|route)\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!LLM_CALL.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!ROUTE_RE.test(lines[i]!)) continue;
          const window = lines.slice(i, i + 15).join('\n');
          if (LLM_CALL.test(window) && !AUTH_RE.test(window)) {
            findings.push({
              severity: sev, category: 'py_ai_endpoint_no_auth', file: path, line: i + 1,
              message: 'Route calls an LLM API with no authentication — anyone can trigger paid API calls.',
              suggestion: 'Add authentication: async def handler(user: User = Depends(get_current_user))',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PY_016: Unvalidated LLM response used directly ───────────────────────
  {
    id: 'PY_016',
    category: 'py_llm_response_unvalidated',
    description: 'LLM response content used directly as code, SQL, or HTML without validation.',
    severity: 'HIGH',
    tags: ['security', 'python', 'llm', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'LLM outputs are unreliable and can be manipulated via prompt injection. Using LLM-generated content directly in eval(), exec(), or SQL queries creates a secondary injection vector — the AI becomes an attack surface amplifier.',
      commonViolations: [
        'exec(llm.invoke(prompt).content)',
        'cursor.execute(gpt_response.choices[0].message.content)',
        'render_template_string(ai_output)',
      ],
      goodExample: '# Parse structured output; never execute raw LLM text\nimport json\nresult = json.loads(llm_response.content)  # validate schema with Pydantic',
      badExample: 'exec(llm_response.choices[0].message.content)  # ❌ LLM-generated RCE',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_llm_response_unvalidated', config.severityRules);
      const findings: Finding[] = [];
      const LLM_EXTRACT = /\.choices\[0\]\.message\.content|\.content\[0\]\.text|result\.text|response\.text/;
      const DANGER_USE = /\beval\s*\(|exec\s*\(|cursor\.execute\s*\(|render_template_string\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!LLM_EXTRACT.test(content) || !DANGER_USE.test(content)) continue;
        const line = lineOf(content, DANGER_USE);
        findings.push({
          severity: sev, category: 'py_llm_response_unvalidated', file: path, line,
          message: 'LLM response used directly in eval/exec/SQL/template — validate and sanitize before use.',
          suggestion: 'Parse LLM output as structured data (JSON schema, Pydantic) before using. Never exec() LLM-generated code.',
        });
      }
      return findings;
    },
  },

  // ── PY_017: Unvalidated redirect ─────────────────────────────────────────
  {
    id: 'PY_017',
    category: 'py_unvalidated_redirect',
    description: 'redirect() called with a URL from request parameters without validation.',
    severity: 'HIGH',
    tags: ['security', 'python', 'redirect', 'flask', 'fastapi'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Open redirect vulnerabilities allow attackers to craft URLs on your trusted domain (https://yoursite.com/login?next=https://evil.com) that redirect users to phishing pages. Users trust links to your domain and will not notice the redirect.',
      commonViolations: [
        'return redirect(request.args.get("next", "/"))',
        'return RedirectResponse(url=request.query_params.get("redirect"))',
        'return redirect(body.get("return_to"))',
      ],
      goodExample: 'next_url = request.args.get("next", "/")\nif not next_url.startswith("/") or next_url.startswith("//"):\n    next_url = "/"\nreturn redirect(next_url)',
      badExample: 'return redirect(request.args.get("next"))  # ❌ open redirect',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_unvalidated_redirect', config.severityRules);
      const findings: Finding[] = [];
      const REDIRECT_RE = /(?:redirect|RedirectResponse)\s*\(\s*(?:url\s*=\s*)?(?:request\.|url|next|target|dest|location)/;
      const URL_VALIDATE = /is_safe_url|urlparse|allowed_urls|startswith\(['"]http|startswith\(['"]\/'\)/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!REDIRECT_RE.test(content)) continue;
        if (URL_VALIDATE.test(content)) continue;
        const line = lineOf(content, REDIRECT_RE);
        findings.push({
          severity: sev, category: 'py_unvalidated_redirect', file: path, line,
          message: 'Redirect target comes from request without validation — open redirect vulnerability.',
          suggestion: 'Validate redirect targets: only allow relative paths or pre-approved absolute domains.',
        });
      }
      return findings;
    },
  },

  // ── PY_018: No rate limiting on public endpoints ──────────────────────────
  {
    id: 'PY_018',
    category: 'py_no_rate_limit',
    description: 'FastAPI/Flask app has routes but no rate-limiting middleware.',
    severity: 'HIGH',
    tags: ['security', 'python', 'rate-limiting', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Without rate limiting, any endpoint can be called thousands of times per second by a single attacker — enabling credential stuffing, API scraping, DoS, and exhaustion of paid third-party API quotas. This is consistently missing in AI-generated Python APIs.',
      commonViolations: [
        'app = FastAPI() with @app.post routes and no Limiter',
        'Flask app with no flask_limiter configuration',
        'Multiple @router.post handlers with no slowapi integration',
      ],
      goodExample: 'from slowapi import Limiter\nfrom slowapi.util import get_remote_address\nlimiter = Limiter(key_func=get_remote_address)\napp.state.limiter = limiter\n\n@router.post("/chat")\n@limiter.limit("10/minute")\nasync def chat(...): ...',
      badExample: 'app = FastAPI()\n@app.post("/chat")\nasync def chat(message: str): ...  # ❌ no rate limit',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_no_rate_limit', config.severityRules);
      const findings: Finding[] = [];
      const HAS_APP = /app\s*=\s*(?:FastAPI|Flask|APIRouter)\s*\(/;
      const HAS_ROUTES = /(?:@app|@router)\s*\.\s*(?:post|put|delete|get)\s*\(/;
      const HAS_RATE_LIMIT = /slowapi|flask_limiter|Limiter|RateLimiter|rate_limit|@limiter/i;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!HAS_APP.test(content) || !HAS_ROUTES.test(content)) continue;
        if (HAS_RATE_LIMIT.test(content)) continue;
        const line = lineOf(content, HAS_APP);
        findings.push({
          severity: sev, category: 'py_no_rate_limit', file: path, line,
          message: 'FastAPI/Flask app has no rate-limiting middleware — endpoints are open to abuse and DoS.',
          suggestion: 'Add slowapi (FastAPI) or Flask-Limiter: from slowapi import Limiter; limiter = Limiter(key_func=get_remote_address)',
        });
      }
      return findings;
    },
  },

  // ── PY_019: Hardcoded database connection string ──────────────────────────
  {
    id: 'PY_019',
    category: 'py_hardcoded_connection_string',
    description: 'Database connection string with credentials hardcoded in source.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'secrets', 'database'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Connection strings with embedded passwords are a common source of credential leaks. They end up in git history, CI logs, Docker image layers, and error messages. AI assistants fill in example credentials that developers leave in production code.',
      commonViolations: [
        'engine = create_engine("postgresql://admin:password@localhost/mydb")',
        'client = MongoClient("mongodb://user:secret@host:27017/db")',
        'redis = Redis.from_url("redis://:password@host:6379/0")',
      ],
      goodExample: 'engine = create_engine(os.environ["DATABASE_URL"])',
      badExample: 'engine = create_engine("postgresql://user:password@host/db")  # ❌ hardcoded credentials',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_hardcoded_connection_string', config.severityRules);
      const findings: Finding[] = [];
      const CONN_RE = /(?:postgresql|mysql|mongodb|redis|sqlite)\+?:\/\/[^{}\s'"]+:[^{}\s'"@]+@/i;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (CONN_RE.test(line) && !/{[^}]+}/.test(line)) {
            findings.push({
              severity: sev, category: 'py_hardcoded_connection_string', file: path, line: i + 1,
              message: 'Database connection string with credentials hardcoded.',
              suggestion: 'Use: os.environ.get("DATABASE_URL") or a secrets manager.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_020: Bare except clause ────────────────────────────────────────────
  {
    id: 'PY_020',
    category: 'py_bare_except',
    description: 'Bare except: clause catches SystemExit, KeyboardInterrupt, and hides all errors.',
    severity: 'MEDIUM',
    tags: ['quality', 'python', 'error-handling'],
    sinceVersion: '1.2.0',
    explain: {
      why: "A bare except: clause catches BaseException, including SystemExit and KeyboardInterrupt — making your process impossible to stop cleanly. It also hides bugs by silently swallowing unexpected exceptions, causing hard-to-debug silent failures.",
      commonViolations: [
        'try:\n    do_thing()\nexcept:\n    pass',
        'try:\n    result = parse(data)\nexcept:\n    result = None',
      ],
      goodExample: 'try:\n    result = parse(data)\nexcept (ValueError, KeyError) as e:\n    logger.error("parse failed", exc_info=e)\n    result = None',
      badExample: 'try:\n    result = parse(data)\nexcept:  # ❌ catches everything including SystemExit\n    result = None',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_bare_except', config.severityRules);
      const findings: Finding[] = [];
      const BARE_EXCEPT = /^\s*except\s*:/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (BARE_EXCEPT.test(line)) {
            findings.push({
              severity: sev, category: 'py_bare_except', file: path, line: i + 1,
              message: 'Bare except: catches everything including SystemExit and KeyboardInterrupt.',
              suggestion: 'Catch specific exceptions: except (ValueError, KeyError) as e: — or at minimum: except Exception as e:',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_021: Error details returned to client ──────────────────────────────
  {
    id: 'PY_021',
    category: 'py_error_detail_leak',
    description: 'Exception message or traceback returned in API response — information disclosure.',
    severity: 'MEDIUM',
    tags: ['security', 'python', 'error-handling', 'information-disclosure'],
    sinceVersion: '1.2.0',
    explain: {
      why: "Returning exception messages or tracebacks to API callers reveals internal implementation details: file paths, library versions, SQL table names, and error context that attackers use to craft more targeted exploits.",
      commonViolations: [
        'return jsonify({"error": str(e)})',
        'raise HTTPException(detail=traceback.format_exc())',
        'return {"message": exception.args[0]}',
      ],
      goodExample: 'logger.error("database error", exc_info=e)\nraise HTTPException(status_code=500, detail="Internal server error")',
      badExample: 'return jsonify({"error": str(e), "traceback": traceback.format_exc()})  # ❌ leaks internals',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_error_detail_leak', config.severityRules);
      const findings: Finding[] = [];
      const LEAK_RE = /(?:return|jsonify|JSONResponse|raise HTTPException)\s*\([^)]*(?:str\s*\(\s*e\)|traceback\.format_exc\(\)|exception\.args)/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (LEAK_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'py_error_detail_leak', file: path, line: i + 1,
              message: 'Exception details or traceback returned to API caller — leaks internal implementation.',
              suggestion: 'Log the exception server-side and return a generic error message to clients.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_022: Missing input validation on POST body ─────────────────────────
  {
    id: 'PY_022',
    category: 'py_missing_input_validation',
    description: 'FastAPI route reads raw request.json() instead of a typed Pydantic model.',
    severity: 'HIGH',
    tags: ['security', 'python', 'validation', 'fastapi', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: "Reading raw request.json() or request.form[] skips type validation, coercion, and field presence checks. This allows attackers to pass unexpected types (None, objects, very large strings) that cause crashes, type errors, or unexpected behavior in business logic.",
      commonViolations: [
        'data = await request.json(); name = data["name"]',
        'body = request.get_json(); user_id = body["user_id"]',
        'form = request.form["email"]',
      ],
      goodExample: 'class CreateUser(BaseModel):\n    name: str\n    email: EmailStr\n\n@app.post("/users")\nasync def create_user(data: CreateUser): ...',
      badExample: 'data = await request.json()\nname = data["name"]  # ❌ no type or presence validation',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_missing_input_validation', config.severityRules);
      const findings: Finding[] = [];
      const RAW_JSON = /await\s+request\.json\(\)|request\.get_json\(\)|request\.form\[/;
      const HAS_PYDANTIC = /BaseModel|from\s+pydantic/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!RAW_JSON.test(content) || HAS_PYDANTIC.test(content)) continue;
        const line = lineOf(content, RAW_JSON);
        findings.push({
          severity: sev, category: 'py_missing_input_validation', file: path, line,
          message: 'Request body read as raw dict without Pydantic validation — missing type safety and input validation.',
          suggestion: 'Define a Pydantic model and use it as the route parameter type.',
        });
      }
      return findings;
    },
  },

  // ── PY_023: Timing attack in secret comparison ────────────────────────────
  {
    id: 'PY_023',
    category: 'py_timing_attack',
    description: 'Secret or token compared with == operator — vulnerable to timing attacks.',
    severity: 'HIGH',
    tags: ['security', 'python', 'cryptography', 'timing-attack'],
    sinceVersion: '1.2.0',
    explain: {
      why: "Python's == operator short-circuits on the first differing byte. By measuring response time, an attacker can determine matching bytes one at a time, eventually recovering the correct token without brute force. hmac.compare_digest() takes constant time regardless of match position.",
      commonViolations: [
        'if token == stored_token: authenticate()',
        'if api_key == os.environ["API_KEY"]: allow()',
        'if provided_signature == expected_signature: proceed()',
      ],
      goodExample: 'import hmac\nif hmac.compare_digest(provided_token, stored_token):\n    authenticate()',
      badExample: 'if token == stored_token:  # ❌ timing attack\n    authenticate()',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_timing_attack', config.severityRules);
      const findings: Finding[] = [];
      const TIMING_RE = /(?:token|secret|key|password|api_key|signature)\s*==\s*|==\s*(?:token|secret|key|password|api_key|signature)/i;
      const SAFE_COMPARE = /hmac\.compare_digest|secrets\.compare_digest/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!TIMING_RE.test(content) || SAFE_COMPARE.test(content)) continue;
        const line = lineOf(content, TIMING_RE);
        findings.push({
          severity: sev, category: 'py_timing_attack', file: path, line,
          message: 'Secret compared with == operator — use hmac.compare_digest() to prevent timing attacks.',
          suggestion: 'import hmac; hmac.compare_digest(provided_token, stored_token)',
        });
      }
      return findings;
    },
  },

  // ── PY_024: Missing HTTPS enforcement ────────────────────────────────────
  {
    id: 'PY_024',
    category: 'py_no_https_redirect',
    description: 'FastAPI app with no HTTPS redirect or HTTPSRedirectMiddleware.',
    severity: 'MEDIUM',
    tags: ['security', 'python', 'https', 'fastapi'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Without HTTPS enforcement, tokens and session cookies can be intercepted in plaintext by network attackers (coffee shop Wi-Fi, ISPs). HTTPSRedirectMiddleware ensures HTTP requests are permanently redirected to HTTPS before any sensitive data is transmitted.',
      commonViolations: [
        'app = FastAPI() with no middleware for HTTPS',
        'Missing talisman or flask-talisman in Flask',
      ],
      goodExample: 'from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware\napp.add_middleware(HTTPSRedirectMiddleware)',
      badExample: 'app = FastAPI()  # ❌ no HTTPS redirect in production code',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_no_https_redirect', config.severityRules);
      const findings: Finding[] = [];
      const HAS_APP = /app\s*=\s*FastAPI\s*\(/;
      const HTTPS_REDIRECT = /HTTPSRedirectMiddleware|talisman|force_https|PREFERRED_URL_SCHEME/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!HAS_APP.test(content) || HTTPS_REDIRECT.test(content)) continue;
        if (/127\.0\.0\.1|localhost|0\.0\.0\.0/.test(content)) continue;
        const line = lineOf(content, HAS_APP);
        findings.push({
          severity: sev, category: 'py_no_https_redirect', file: path, line,
          message: 'FastAPI app has no HTTPS redirect middleware — HTTP traffic is unencrypted.',
          suggestion: 'Add: from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware; app.add_middleware(HTTPSRedirectMiddleware)',
        });
      }
      return findings;
    },
  },

  // ── PY_026: Mutable default argument ─────────────────────────────────────
  {
    id: 'PY_026',
    category: 'py_mutable_default_arg',
    description: 'Function uses mutable default argument (list or dict) — shared across all calls.',
    severity: 'HIGH',
    tags: ['python', 'bugs', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'In Python, default argument values are evaluated once when the function is defined, not each time it is called. A mutable default (list, dict, set) is shared across every call that does not pass that argument — mutations in one call leak into subsequent calls, causing subtle data corruption bugs that are extremely hard to trace.',
      commonViolations: ['def add_item(item, items=[]):', 'def merge(data, result={}):', 'async def process(tasks=[]):'],
      goodExample: 'def add_item(item, items=None):\n    if items is None:\n        items = []\n    items.append(item)\n    return items',
      badExample: 'def add_item(item, items=[]):  # ❌ list shared across all calls\n    items.append(item)\n    return items',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_mutable_default_arg', config.severityRules);
      const findings: Finding[] = [];
      const MUTABLE_DEFAULT = /^\s*(?:async\s+)?def\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\}|\[\s*[^\]]+\]|\{\s*[^}]+\})/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (MUTABLE_DEFAULT.test(line)) {
            findings.push({
              severity: sev, category: 'py_mutable_default_arg', file: path, line: i + 1,
              message: 'Mutable default argument — the list or dict is shared across all calls, causing cross-call state leakage.',
              suggestion: 'Use None as default and initialise inside the function: def fn(items=None): if items is None: items = []',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_028: time.sleep inside async function ──────────────────────────────
  {
    id: 'PY_028',
    category: 'py_blocking_sleep_in_async',
    description: '`time.sleep()` inside an `async def` blocks the entire event loop.',
    severity: 'HIGH',
    tags: ['python', 'async', 'performance', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'time.sleep() is a blocking call. Inside an async function it freezes the entire event loop for the sleep duration, preventing any other coroutines from running. This defeats the purpose of async and causes hard-to-diagnose latency spikes under concurrent load.',
      commonViolations: ['async def handler(): time.sleep(1)', 'async def retry(): time.sleep(delay)'],
      goodExample: 'async def handler():\n    await asyncio.sleep(1)',
      badExample: 'async def handler():\n    time.sleep(1)  # ❌ blocks the event loop',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_blocking_sleep_in_async', config.severityRules);
      const findings: Finding[] = [];
      const ASYNC_DEF = /^\s*async\s+def\s+/;
      const BLOCKING_SLEEP = /\btime\.sleep\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        let insideAsync = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (ASYNC_DEF.test(line)) { insideAsync = true; continue; }
          if (insideAsync && /^\s*(?:def |class )\b/.test(line)) insideAsync = false;
          if (insideAsync && BLOCKING_SLEEP.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'py_blocking_sleep_in_async', file: path, line: i + 1,
              message: 'time.sleep() inside async function blocks the event loop — use `await asyncio.sleep()` instead.',
              suggestion: 'Replace time.sleep(n) with await asyncio.sleep(n)',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PY_029: Missing await on coroutine ────────────────────────────────────
  {
    id: 'PY_029',
    category: 'py_unawaited_coroutine',
    description: 'Coroutine called without `await` — silently no-ops and returns a coroutine object.',
    severity: 'BLOCKER',
    tags: ['python', 'async', 'bugs', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Calling an async function without await does not execute it — it returns a coroutine object that is immediately discarded. The function body never runs. This is one of the most common AI-generated Python bugs because the code looks correct but does nothing.',
      commonViolations: ['db.save(record)  # forgot await', 'send_email(user)  # forgot await'],
      goodExample: 'await db.save(record)\nresult = await send_email(user)',
      badExample: 'db.save(record)  # ❌ coroutine object created and discarded',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_unawaited_coroutine', config.severityRules);
      const findings: Finding[] = [];
      // Common async DB/IO patterns assigned without await
      const UNAWAITED = /^\s+(?!await\s|return\s|yield\s|#)(?:db|session|conn|cursor|client|repo|service|cache|redis|mongo)\.\w+\s*\(/;
      const ASYNC_CONTEXT = /^\s*async\s+def\s+/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        let insideAsync = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (ASYNC_CONTEXT.test(line)) { insideAsync = true; continue; }
          if (insideAsync && /^(?:def |class )\b/.test(line.trimStart())) insideAsync = false;
          if (insideAsync && UNAWAITED.test(line)) {
            findings.push({
              severity: sev, category: 'py_unawaited_coroutine', file: path, line: i + 1,
              message: 'Possible unawaited coroutine — async DB/IO call without `await` silently no-ops.',
              suggestion: 'Add `await` before the call: `await db.save(record)`',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PY_030: pickle.loads on untrusted data ────────────────────────────────
  {
    id: 'PY_030',
    category: 'py_pickle_rce',
    description: '`pickle.loads()` on externally-sourced data — remote code execution vector.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'rce', 'deserialization'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Python pickle can execute arbitrary code during deserialization via __reduce__. Loading pickled data from user input, network sockets, or external files allows attackers to run any system command with your process privileges. This is a critical, well-known RCE vector.',
      commonViolations: ['pickle.loads(request.data)', 'pickle.load(open(user_file, "rb"))'],
      goodExample: 'import json\ndata = json.loads(request.data)  # safe structured format',
      badExample: 'data = pickle.loads(request.body)  # ❌ RCE if attacker controls input',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_pickle_rce', config.severityRules);
      const findings: Finding[] = [];
      const PICKLE_RE = /\bpickle\.loads?\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (PICKLE_RE.test(line)) {
            findings.push({
              severity: sev, category: 'py_pickle_rce', file: path, line: i + 1,
              message: 'pickle.loads/load() is an RCE vector — never deserialize untrusted pickle data.',
              suggestion: 'Use JSON, MessagePack, or a schema-validated format instead. If pickle is unavoidable, sign the payload and verify the signature before loading.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_031: marshal.loads on external data ────────────────────────────────
  {
    id: 'PY_031',
    category: 'py_marshal_rce',
    description: '`marshal.loads()` on external data — same RCE class as pickle.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'rce', 'deserialization'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'marshal is intended only for internal CPython use (e.g., .pyc files). Like pickle, it can execute code during deserialization. Loading marshal data from external sources is a critical RCE vulnerability.',
      commonViolations: ['marshal.loads(data)', 'code = marshal.load(f)'],
      goodExample: 'Use json.loads() or msgpack.unpackb() for external data exchange.',
      badExample: 'code = marshal.loads(socket.recv(1024))  # ❌ RCE',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_marshal_rce', config.severityRules);
      const findings: Finding[] = [];
      const MARSHAL_RE = /\bmarshal\.loads?\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (MARSHAL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'py_marshal_rce', file: path, line: i + 1,
              message: 'marshal.loads() is an RCE vector — do not use with externally-sourced data.',
              suggestion: 'Use JSON or another safe serialization format for data interchange.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_032: unpinned requirements.txt ────────────────────────────────────
  {
    id: 'PY_032',
    category: 'py_unpinned_requirements',
    description: 'requirements.txt has unpinned dependencies — supply chain and reproducibility risk.',
    severity: 'MEDIUM',
    tags: ['python', 'security', 'supply-chain', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'AI agents routinely generate requirements.txt with bare package names like `requests` or `flask` and no version pins. Unpinned dependencies allow pip to install the latest version at build time, which can break your app with breaking changes or, worse, install a maliciously updated package in a supply chain attack.',
      commonViolations: ['requests', 'flask', 'sqlalchemy  # no version'],
      goodExample: 'requests==2.32.3\nflask==3.0.3\nsqlalchemy==2.0.30',
      badExample: 'requests\nflask\nsqlalchemy  # ❌ unpinned',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_unpinned_requirements', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('requirements.txt') && !path.match(/requirements[\w-]*\.txt$/)) continue;
        const lines = content.split('\n');
        const unpinned: number[] = [];
        lines.forEach((line, i) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) return;
          // Unpinned: package name with no ==, >=, <=, ~=, !=
          if (/^[a-zA-Z0-9_-]+(\[[\w,]+\])?$/.test(trimmed)) unpinned.push(i + 1);
        });
        if (unpinned.length > 0) {
          findings.push({
            severity: sev, category: 'py_unpinned_requirements', file: path, line: unpinned[0],
            message: `${unpinned.length} unpinned package(s) in requirements.txt — pin versions for reproducible builds and supply chain safety.`,
            suggestion: 'Run `pip freeze > requirements.txt` to pin all current versions, or use `pip-tools` / `poetry` for managed pinning.',
          });
        }
      }
      return findings;
    },
  },

  // ── PY_033: os.system with string interpolation ───────────────────────────
  {
    id: 'PY_033',
    category: 'py_os_system_injection',
    description: '`os.system()` with f-string or % formatting — shell injection vector.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'injection', 'shell'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'os.system() passes its argument directly to the shell. When the argument is built with f-strings or % formatting using external data, an attacker can inject shell metacharacters (`;`, `&&`, `|`, `$(...)`) to run arbitrary commands.',
      commonViolations: ['os.system(f"convert {filename} output.png")', 'os.system("ping %s" % host)'],
      goodExample: 'subprocess.run(["convert", filename, "output.png"], check=True)',
      badExample: 'os.system(f"convert {filename} output.png")  # ❌ shell injection if filename contains ;',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_os_system_injection', config.severityRules);
      const findings: Finding[] = [];
      const OS_SYSTEM_INTERP = /\bos\.system\s*\(\s*(?:f['""]|['""][^'"]*%\s)/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (OS_SYSTEM_INTERP.test(line)) {
            findings.push({
              severity: sev, category: 'py_os_system_injection', file: path, line: i + 1,
              message: 'os.system() with string interpolation — shell injection if any variable contains metacharacters.',
              suggestion: 'Use subprocess.run(["cmd", arg1, arg2], check=True) with a list of arguments — no shell, no injection.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_034: subprocess with shell=True and variable ──────────────────────
  {
    id: 'PY_034',
    category: 'py_subprocess_shell_injection',
    description: '`subprocess` with `shell=True` and a non-literal command — shell injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'injection', 'shell'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'subprocess.run/call/Popen with shell=True passes the command to /bin/sh. Combined with variable interpolation, this is identical to os.system() injection. The safe alternative is to pass a list of arguments without shell=True.',
      commonViolations: ['subprocess.run(f"grep {pattern} {file}", shell=True)', 'subprocess.call(cmd, shell=True)'],
      goodExample: 'subprocess.run(["grep", pattern, file], check=True)',
      badExample: 'subprocess.run(f"grep {pattern} {file}", shell=True)  # ❌ injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_subprocess_shell_injection', config.severityRules);
      const findings: Finding[] = [];
      const SHELL_TRUE = /\bsubprocess\.(?:run|call|check_call|check_output|Popen)\s*\([^)]*shell\s*=\s*True/;
      const HAS_INTERP = /f['""]|%\s*(?:s|d)|\.format\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (SHELL_TRUE.test(line) && HAS_INTERP.test(line)) {
            findings.push({
              severity: sev, category: 'py_subprocess_shell_injection', file: path, line: i + 1,
              message: 'subprocess with shell=True and string interpolation — shell injection if variables contain metacharacters.',
              suggestion: 'Pass a list of arguments without shell=True: subprocess.run(["cmd", arg1, arg2])',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_035: FastAPI route missing response_model ──────────────────────────
  {
    id: 'PY_035',
    category: 'py_fastapi_no_response_model',
    description: 'FastAPI route decorator missing `response_model` — internal fields may be leaked.',
    severity: 'MEDIUM',
    tags: ['security', 'python', 'fastapi', 'data-exposure'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Without response_model, FastAPI serializes the entire return value — including internal fields like password_hash, secret_key, or is_admin. A response_model explicitly allow-lists the fields returned to clients, preventing accidental data exposure.',
      commonViolations: ['@app.get("/users/{id}")', '@router.post("/profile")'],
      goodExample: '@router.get("/users/{id}", response_model=UserPublic)\nasync def get_user(id: int): ...',
      badExample: '@app.get("/users/{id}")  # ❌ no response_model — may leak internal fields\nasync def get_user(id: int): return await db.get(User, id)',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_fastapi_no_response_model', config.severityRules);
      const findings: Finding[] = [];
      const ROUTE_RE = /^\s*@(?:app|router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(/;
      const HAS_RESPONSE_MODEL = /response_model\s*=/;
      const RETURNS_MODEL = /JSONResponse|Response\s*\(|FileResponse|StreamingResponse/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!ROUTE_RE.test(line)) continue;
          // Collect the full decorator (may span multiple lines)
          const window = lines.slice(i, i + 5).join('\n');
          if (!HAS_RESPONSE_MODEL.test(window) && !RETURNS_MODEL.test(window)) {
            findings.push({
              severity: sev, category: 'py_fastapi_no_response_model', file: path, line: i + 1,
              message: 'FastAPI route without response_model — internal model fields may be serialized and leaked to clients.',
              suggestion: 'Add response_model=YourResponseSchema to the route decorator to explicitly control which fields are returned.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PY_036: global keyword in function ───────────────────────────────────
  {
    id: 'PY_036',
    category: 'py_global_keyword',
    description: '`global` keyword mutates module-level state — implicit shared mutable state.',
    severity: 'MEDIUM',
    tags: ['python', 'quality', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'The `global` keyword creates implicit shared mutable state between function calls, making code hard to reason about, test, and use concurrently. AI agents frequently use global counters, caches, or config dicts as a shortcut instead of proper dependency injection or class encapsulation.',
      commonViolations: ['def increment(): global count; count += 1', 'def set_config(cfg): global CONFIG; CONFIG = cfg'],
      goodExample: 'class Counter:\n    def __init__(self): self.count = 0\n    def increment(self): self.count += 1',
      badExample: 'count = 0\ndef increment():\n    global count  # ❌ implicit shared mutable state\n    count += 1',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_global_keyword', config.severityRules);
      const findings: Finding[] = [];
      const GLOBAL_RE = /^\s+global\s+\w/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (GLOBAL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'py_global_keyword', file: path, line: i + 1,
              message: '`global` keyword introduces implicit shared mutable state — use a class, dataclass, or pass state explicitly.',
              suggestion: 'Encapsulate state in a class or pass as a parameter. For read-only config, use module-level constants or dependency injection.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_037: assert used for runtime validation ────────────────────────────
  {
    id: 'PY_037',
    category: 'py_assert_for_validation',
    description: '`assert` used for runtime input validation — stripped by Python `-O` flag.',
    severity: 'HIGH',
    tags: ['python', 'security', 'bugs', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Python\'s assert statement is removed entirely when the interpreter runs with the -O (optimize) flag, which is common in production deployments. Using assert for input validation means your security checks are silently disabled in optimized builds.',
      commonViolations: ['assert user_id > 0, "Invalid user"', 'assert token is not None, "Auth required"'],
      goodExample: 'if user_id <= 0:\n    raise ValueError("Invalid user ID")',
      badExample: 'assert user_id > 0  # ❌ removed at runtime with -O flag',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_assert_for_validation', config.severityRules);
      const findings: Finding[] = [];
      // assert with user/auth/id/token/request signals — not pure logic assertions
      const ASSERT_VALIDATION = /^\s+assert\s+.+(?:user|token|auth|id|request|input|param|key|secret|password|role|perm)/i;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (ASSERT_VALIDATION.test(line)) {
            findings.push({
              severity: sev, category: 'py_assert_for_validation', file: path, line: i + 1,
              message: '`assert` used for runtime validation — silently disabled when Python runs with -O flag.',
              suggestion: 'Use explicit if/raise: `if not condition: raise ValueError("message")`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_038: Pydantic v1 .dict()/.json() on v2 model ──────────────────────
  {
    id: 'PY_038',
    category: 'py_pydantic_v1_api',
    description: 'Pydantic v1 `.dict()` or `.json()` method called — these are removed in Pydantic v2.',
    severity: 'HIGH',
    tags: ['python', 'pydantic', 'bugs', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Pydantic v2 (released 2023) replaced .dict() with .model_dump() and .json() with .model_dump_json(). AI agents trained on pre-v2 examples regularly generate the old API. These calls raise AttributeError at runtime if the installed Pydantic version is v2.',
      commonViolations: ['user.dict()', 'response.json()', 'model.dict(exclude={"password"})'],
      goodExample: 'user.model_dump()\nuser.model_dump_json()\nuser.model_dump(exclude={"password"})',
      badExample: 'user.dict()  # ❌ removed in Pydantic v2\nuser.json()  # ❌ removed in Pydantic v2',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_pydantic_v1_api', config.severityRules);
      const findings: Finding[] = [];
      const V1_API = /\b\w+\.(?:dict|json)\s*\(\s*(?:exclude|include|by_alias|exclude_unset|exclude_none)?/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        // Only flag if pydantic is imported
        if (!/\bpydantic\b/.test(content) && !/BaseModel/.test(content)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (V1_API.test(line) && !/(?:response|res|resp|request|req)\.json\s*\(\s*\)/.test(line)) {
            findings.push({
              severity: sev, category: 'py_pydantic_v1_api', file: path, line: i + 1,
              message: 'Pydantic v1 `.dict()` / `.json()` API — use `.model_dump()` / `.model_dump_json()` for Pydantic v2 compatibility.',
              suggestion: 'Replace .dict() → .model_dump() and .json() → .model_dump_json()',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_039: open() without explicit encoding ──────────────────────────────
  {
    id: 'PY_039',
    category: 'py_open_without_encoding',
    description: '`open()` in text mode without `encoding=` — platform-dependent behaviour.',
    severity: 'LOW',
    tags: ['python', 'quality', 'portability'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Without an explicit encoding argument, Python uses the platform\'s default encoding (UTF-8 on Linux/macOS, but often cp1252 on Windows). Files written on one platform may fail to read on another. Explicitly specifying encoding="utf-8" ensures consistent behaviour across environments.',
      commonViolations: ['open("file.txt", "r")', 'open(path, "w")'],
      goodExample: 'open("file.txt", "r", encoding="utf-8")',
      badExample: 'open("file.txt", "r")  # ❌ uses platform default encoding',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_open_without_encoding', config.severityRules);
      const findings: Finding[] = [];
      // open() in text mode (r, w, a, r+) without encoding=
      const OPEN_NO_ENC = /\bopen\s*\([^)]+['"]\s*(?:r|w|a|r\+|w\+|a\+)['"]\s*(?:,(?![^)]*encoding\s*=))?[^)]*\)/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (/\bopen\s*\(/.test(line) && !/encoding\s*=/.test(line) && /['"]\s*[rwa]/.test(line) && !/['"]\s*[rwa]b/.test(line)) {
            findings.push({
              severity: sev, category: 'py_open_without_encoding', file: path, line: i + 1,
              message: 'open() without explicit encoding — defaults to platform encoding which differs between macOS/Linux and Windows.',
              suggestion: 'Add encoding="utf-8": open(path, "r", encoding="utf-8")',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_040: Django QuerySet.raw() with user input ─────────────────────────
  {
    id: 'PY_040',
    category: 'py_django_raw_sql',
    description: 'Django `QuerySet.raw()` or `cursor.execute()` with user-supplied data — SQL injection.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'django', 'sql-injection'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Django\'s ORM is safe, but raw() and cursor.execute() bypass it. When user-supplied values are interpolated into the SQL string (via f-strings or %), attackers can manipulate the query to extract, modify, or delete data.',
      commonViolations: ['Model.objects.raw(f"SELECT * FROM table WHERE id={user_id}")', 'cursor.execute("SELECT * FROM users WHERE name=\'%s\'" % name)'],
      goodExample: 'Model.objects.raw("SELECT * FROM table WHERE id=%s", [user_id])\ncursor.execute("SELECT * FROM users WHERE name=%s", [name])',
      badExample: 'Model.objects.raw(f"SELECT * FROM users WHERE id={id}")  # ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_django_raw_sql', config.severityRules);
      const findings: Finding[] = [];
      const RAW_INTERP = /\.raw\s*\(\s*f['""]|\.raw\s*\([^)]*%|cursor\.execute\s*\(\s*f['""]|cursor\.execute\s*\([^)]*%\s+/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (RAW_INTERP.test(line)) {
            findings.push({
              severity: sev, category: 'py_django_raw_sql', file: path, line: i + 1,
              message: 'Django raw SQL with string interpolation — SQL injection vulnerability.',
              suggestion: 'Use parameterized queries: Model.objects.raw("SELECT ... WHERE id=%s", [user_id])',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_041: Django mark_safe on user input ────────────────────────────────
  {
    id: 'PY_041',
    category: 'py_django_mark_safe_xss',
    description: 'Django `mark_safe()` called on user-controlled string — XSS vulnerability.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'django', 'xss'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'mark_safe() tells Django\'s template engine to bypass HTML escaping for the given string. When called on user-supplied content, it allows attackers to inject arbitrary HTML and JavaScript into the page, leading to stored or reflected XSS.',
      commonViolations: ['mark_safe(user.bio)', 'mark_safe(request.POST["comment"])', 'format_html("<b>{}</b>".format(user_input))'],
      goodExample: 'from django.utils.html import escape\nmark_safe("<b>" + escape(user.bio) + "</b>")',
      badExample: 'mark_safe(user.bio)  # ❌ XSS if bio contains <script>',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_django_mark_safe_xss', config.severityRules);
      const findings: Finding[] = [];
      const MARK_SAFE_VAR = /\bmark_safe\s*\(\s*(?!["']|escape\s*\(|format_html\s*\()/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (MARK_SAFE_VAR.test(line)) {
            findings.push({
              severity: sev, category: 'py_django_mark_safe_xss', file: path, line: i + 1,
              message: 'mark_safe() on a variable — XSS if the value contains user-controlled HTML.',
              suggestion: 'Escape first: mark_safe("<b>" + escape(user_value) + "</b>") or use format_html("<b>{}</b>", user_value)',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_042: wildcard import ────────────────────────────────────────────────
  {
    id: 'PY_042',
    category: 'py_wildcard_import',
    description: '`from module import *` pollutes namespace and hides dependency origins.',
    severity: 'MEDIUM',
    tags: ['python', 'quality', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Wildcard imports make it impossible to determine where a name comes from without checking every imported module. They can silently overwrite local names, cause subtle bugs when modules add new exports, and make static analysis and refactoring unreliable.',
      commonViolations: ['from os.path import *', 'from models import *', 'from utils import *'],
      goodExample: 'from os.path import join, exists, dirname',
      badExample: 'from os.path import *  # ❌ pollutes namespace',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_wildcard_import', config.severityRules);
      const findings: Finding[] = [];
      const WILDCARD = /^\s*from\s+\S+\s+import\s+\*/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        // Allow in __init__.py re-export files
        if (path.endsWith('__init__.py')) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (WILDCARD.test(line)) {
            findings.push({
              severity: sev, category: 'py_wildcard_import', file: path, line: i + 1,
              message: 'Wildcard import (`from X import *`) pollutes the namespace and hides where names come from.',
              suggestion: 'Import only what you need: `from module import SpecificClass, specific_function`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_043: async def without any await ───────────────────────────────────
  {
    id: 'PY_043',
    category: 'py_async_without_await',
    description: '`async def` function body has no `await` — function is synchronous and needlessly async.',
    severity: 'LOW',
    tags: ['python', 'async', 'quality', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'An async function with no await calls is equivalent to a regular function but incurs coroutine overhead and misleads readers into thinking it performs I/O. This is a common AI-codegen pattern where `async` is added reflexively. If the function genuinely becomes async later this is fine, but it should be intentional.',
      commonViolations: ['async def get_name(user): return user.name', 'async def format_date(dt): return dt.strftime(...)'],
      goodExample: 'def get_name(user): return user.name',
      badExample: 'async def get_name(user):\n    return user.name  # ❌ no await — this is just a regular function',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_async_without_await', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!/^\s*async\s+def\s+/.test(lines[i]!)) continue;
          // Scan function body until next same-indent def/class or end of file
          const indent = (lines[i]!.match(/^(\s*)/) || ['', ''])[1]!.length;
          let j = i + 1;
          let hasAwait = false;
          while (j < lines.length) {
            const bodyLine = lines[j]!;
            const bodyIndent = (bodyLine.match(/^(\s*)/) || ['', ''])[1]!.length;
            if (bodyLine.trim() && bodyIndent <= indent) break;
            if (/\bawait\b/.test(bodyLine) || /\bAsync(?:Generator|Iterator)\b/.test(bodyLine)) { hasAwait = true; break; }
            j++;
          }
          if (!hasAwait) {
            findings.push({
              severity: sev, category: 'py_async_without_await', file: path, line: i + 1,
              message: '`async def` with no `await` — consider making this a regular `def` unless async is intentional.',
              suggestion: 'Remove `async` if the function performs no I/O: `def get_name(user): return user.name`',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PY_044: Optional type hint without None default ───────────────────────
  {
    id: 'PY_044',
    category: 'py_optional_no_default',
    description: '`Optional[X]` parameter without a `None` default — misleading type annotation.',
    severity: 'LOW',
    tags: ['python', 'type-hints', 'quality'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Optional[X] means "X or None", implying the caller may omit the value. But without a default of None, the parameter is still required. This contradicts user expectations and is a common pattern in AI-generated code that copies Optional from return types into required parameters.',
      commonViolations: ['def fn(x: Optional[str]):', 'def fn(user: Optional[User]):'],
      goodExample: 'def fn(x: Optional[str] = None):\ndef fn(x: str | None = None):',
      badExample: 'def fn(x: Optional[str]):  # ❌ Optional but no default — still required',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_optional_no_default', config.severityRules);
      const findings: Finding[] = [];
      // Matches param: Optional[X] not followed by = in the same param slot
      const OPT_NO_DEFAULT = /\(\s*\w+\s*:\s*Optional\[[\w\[\], ]+\](?!\s*=)/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (/\bOptional\[/.test(line) && OPT_NO_DEFAULT.test(line)) {
            findings.push({
              severity: sev, category: 'py_optional_no_default', file: path, line: i + 1,
              message: 'Optional[X] parameter with no `= None` default — parameter is required but type says optional.',
              suggestion: 'Add a default: `def fn(x: Optional[str] = None):`',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_045: print() used for logging in production code ───────────────────
  {
    id: 'PY_045',
    category: 'py_print_for_logging',
    description: '`print()` used instead of the `logging` module in non-script code.',
    severity: 'LOW',
    tags: ['python', 'quality', 'observability', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'print() writes to stdout with no timestamp, level, logger name, or structured format. In production, log aggregators (CloudWatch, Datadog, ELK) expect structured log entries. AI agents heavily prefer print() for debug output that never gets cleaned up before shipping.',
      commonViolations: ['print(f"Error: {e}")', 'print("Processing request", user_id)', 'print(f"DB result: {result}")'],
      goodExample: 'import logging\nlogger = logging.getLogger(__name__)\nlogger.error("DB error: %s", e)',
      badExample: 'print(f"Error: {e}")  # ❌ use logging.error() in production code',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_print_for_logging', config.severityRules);
      const findings: Finding[] = [];
      const PRINT_LOG = /^\s+print\s*\(\s*f?['""](?:error|warning|warn|info|debug|exception|fail|critical)/i;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        // Only flag in non-script files (files with classes/functions, not top-level scripts)
        if (!/^\s*(?:def |class |async def )/m.test(content)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (PRINT_LOG.test(line)) {
            findings.push({
              severity: sev, category: 'py_print_for_logging', file: path, line: i + 1,
              message: 'print() used for logging — use the `logging` module for structured, level-aware output.',
              suggestion: 'Replace with: logging.error("...", exc_info=True) or logger.warning("...")',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── PY_025: Missing auth on LangChain agent endpoint ─────────────────────
  {
    id: 'PY_025',
    category: 'py_langchain_no_auth',
    description: 'LangChain agent or chain invoked in a route with no authentication.',
    severity: 'BLOCKER',
    tags: ['security', 'python', 'langchain', 'llm', 'auth', 'ai-risk'],
    sinceVersion: '1.2.0',
    explain: {
      why: "LangChain agents can browse the web, execute code, query databases, and call external APIs on behalf of whoever invokes them. Without authentication, any anonymous user can trigger your agent — causing unbounded API costs, data exfiltration, and potential tool misuse.",
      commonViolations: [
        '@app.post("/agent") async def run_agent(query: str): return agent.run(query)',
        '@router.get("/chain") async def chain(prompt: str): return chain.invoke(prompt)',
      ],
      goodExample: '@router.post("/agent")\nasync def run_agent(\n    query: str,\n    user: User = Depends(get_current_user)\n):\n    return agent.run(query)',
      badExample: '@app.post("/agent")\nasync def run_agent(query: str):  # ❌ unauthenticated LangChain agent\n    return agent.run(query)',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('py_langchain_no_auth', config.severityRules);
      const findings: Finding[] = [];
      const LANGCHAIN_RE = /(?:agent\.run|chain\.invoke|chain\.run|agent_executor\.invoke|llm_chain\.predict|ConversationChain|AgentExecutor)/;
      const AUTH_RE = /Depends\s*\(|login_required|require_auth|current_user|get_current_user|Bearer|api_key/i;
      const ROUTE_RE = /(?:@app|@router)\s*\.\s*(?:post|get|put)\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPyFile(path) || isPyTest(path)) continue;
        if (!LANGCHAIN_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!ROUTE_RE.test(lines[i]!)) continue;
          const window = lines.slice(i, i + 15).join('\n');
          if (LANGCHAIN_RE.test(window) && !AUTH_RE.test(window)) {
            findings.push({
              severity: sev, category: 'py_langchain_no_auth', file: path, line: i + 1,
              message: 'LangChain agent or chain is called from an unauthenticated route — unlimited free access to your AI agent.',
              suggestion: 'Add authentication: async def handler(user: User = Depends(get_current_user))',
            });
          }
        }
      }
      return findings;
    },
  },

];
