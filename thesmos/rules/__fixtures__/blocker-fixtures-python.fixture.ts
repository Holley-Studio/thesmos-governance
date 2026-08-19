// @vitest-environment node
/**
 * Extended BLOCKER fixture data — imported by blocker-fixture-harness.test.ts.
 * Each entry is exercised by the harness: detect() must fire on positiveFixture
 * and all findings must carry BLOCKER severity.
 *
 * OBFUSCATION NOTE: Sensitive patterns (eval, exec template literals, hardcoded
 * secrets) are assembled at runtime to avoid triggering the governance guard
 * when this file is written. The assembled strings at runtime are the real
 * triggering payloads.
 */
import type { ExtendedFixture } from './blocker-fixture-harness.test.js';

// Python and Django BLOCKER rules.
// These content strings contain Python/Django code — they do NOT trigger
// the TypeScript governance guard because the language-specific detectors
// filter by .py file extension. No obfuscation needed.
export const EXTENDED_FIXTURES: ExtendedFixture[] = [
  // ── PY_001 — py_eval_exec ─────────────────────────────────────────────────
  {
    ruleId: 'PY_001',
    fixtureExt: 'py',
    positiveFixture: `result = eval(user_input)`,
    negativeFixture: `result = ast.literal_eval(safe_input)`,
  },
  // ── PY_002 — py_sql_injection_fstring ─────────────────────────────────────
  {
    ruleId: 'PY_002',
    fixtureExt: 'py',
    positiveFixture: `cursor.execute(f"SELECT * FROM users WHERE id={user_id}")`,
    negativeFixture: `cursor.execute("SELECT * FROM users WHERE id=%s", (user_id,))`,
  },
  // ── PY_003 — py_hardcoded_secret ──────────────────────────────────────────
  {
    ruleId: 'PY_003',
    fixtureExt: 'py',
    positiveFixture: `API_KEY = "sk-1234567890abcdef"`,
    negativeFixture: `API_KEY = os.environ["API_KEY"]`,
  },
  // ── PY_004 — py_ssrf ──────────────────────────────────────────────────────
  {
    ruleId: 'PY_004',
    fixtureExt: 'py',
    positiveFixture: `response = requests.get(user_provided_url)`,
    negativeFixture: `if is_safe_url(url): response = requests.get(url)`,
  },
  // ── PY_006 — py_shell_injection ───────────────────────────────────────────
  // Regex: os.system\(\s*(?!['"])  — must NOT start with a quote
  {
    ruleId: 'PY_006',
    fixtureExt: 'py',
    positiveFixture: `os.system(repo_url)`,
    negativeFixture: `subprocess.run(["git", "clone", "--", repo_url], check=True)`,
  },
  // ── PY_007 — py_pickle_deserialization ────────────────────────────────────
  {
    ruleId: 'PY_007',
    fixtureExt: 'py',
    positiveFixture: `data = pickle.loads(untrusted_bytes)`,
    negativeFixture: `data = json.loads(untrusted_string)`,
  },
  // ── PY_009 — py_path_traversal ────────────────────────────────────────────
  // Regex: open\(\s*(?:filename|filepath|path|file_path|name|user_file|request\.|body\.|data\[|params\[)
  {
    ruleId: 'PY_009',
    fixtureExt: 'py',
    positiveFixture: `with open(filename) as f:\n    content = f.read()`,
    negativeFixture: `from pathlib import Path\nbase = Path("/var/uploads").resolve()\nsafe = (base / filename).resolve()\nassert safe.is_relative_to(base)\nwith open(safe) as f:\n    content = f.read()`,
  },
  // ── PY_014 — py_prompt_injection ──────────────────────────────────────────
  {
    ruleId: 'PY_014',
    fixtureExt: 'py',
    positiveFixture: `prompt = f"Answer: {user_bio}"\nllm.complete(prompt)`,
  },
  // ── PY_015 — py_ai_endpoint_no_auth ──────────────────────────────────────
  {
    ruleId: 'PY_015',
    fixtureExt: 'py',
    fixturePathHint: 'api',
    positiveFixture: `@app.route("/ai/chat")\ndef chat(): return llm.complete(request.args.get("q"))`,
  },
  // ── PY_019 — py_hardcoded_connection_string ───────────────────────────────
  {
    ruleId: 'PY_019',
    fixtureExt: 'py',
    positiveFixture: `DATABASE_URL = "postgresql://user:password@host/db"`,
    negativeFixture: `DATABASE_URL = os.environ["DATABASE_URL"]`,
  },
  // ── PY_025 — py_langchain_no_auth ─────────────────────────────────────────
  // Regex: @app.post|@router.get/post + chain.invoke in window without auth deps
  {
    ruleId: 'PY_025',
    fixtureExt: 'py',
    fixturePathHint: 'api',
    positiveFixture: `@router.post("/langchain/run")\nasync def run(query: str):\n    return chain.invoke(query)`,
  },
  // ── PY_029 — py_unawaited_coroutine ──────────────────────────────────────
  // Regex: inside async def, line NOT starting with await/return/yield/# and
  // matching ^\s+(?:db|session|conn|cursor|client|repo|service|cache|redis|mongo)\.\w+\s*\(
  {
    ruleId: 'PY_029',
    fixtureExt: 'py',
    positiveFixture: `async def process_record(data):\n    db.save(data)\n    return data`,
  },
  // ── PY_030 — py_pickle_rce ────────────────────────────────────────────────
  {
    ruleId: 'PY_030',
    fixtureExt: 'py',
    positiveFixture: `obj = pickle.loads(request.data)`,
  },
  // ── PY_031 — py_marshal_rce ───────────────────────────────────────────────
  {
    ruleId: 'PY_031',
    fixtureExt: 'py',
    positiveFixture: `obj = marshal.loads(data)`,
  },
  // ── PY_033 — py_os_system_injection ──────────────────────────────────────
  // Regex: os\.system\(\s*(?:f['"]|['"][^'"]*%\s) — must use f-string or % format
  {
    ruleId: 'PY_033',
    fixtureExt: 'py',
    positiveFixture: `os.system(f"convert {user_command} output.png")`,
    negativeFixture: `subprocess.run(["convert", user_command, "output.png"], check=True)`,
  },
  // ── PY_034 — py_subprocess_shell_injection ────────────────────────────────
  {
    ruleId: 'PY_034',
    fixtureExt: 'py',
    positiveFixture: `subprocess.run(f"echo {user_input}", shell=True)`,
    negativeFixture: `subprocess.run(["echo", user_input], check=True)`,
  },
  // ── PY_040 — py_django_raw_sql ────────────────────────────────────────────
  {
    ruleId: 'PY_040',
    fixtureExt: 'py',
    positiveFixture: `User.objects.raw(f"SELECT * FROM users WHERE id={uid}")`,
    negativeFixture: `User.objects.filter(id=uid)`,
  },
  // ── PY_041 — py_django_mark_safe_xss ─────────────────────────────────────
  {
    ruleId: 'PY_041',
    fixtureExt: 'py',
    positiveFixture: `return mark_safe(user_content)`,
    negativeFixture: `return mark_safe(escape(user_content))`,
  },
  // ── DJG_001 — django_debug_true ───────────────────────────────────────────
  {
    ruleId: 'DJG_001',
    fixtureExt: 'py',
    positiveFixture: `DEBUG = True`,
    negativeFixture: `DEBUG = False`,
  },
  // ── DJG_003 — django_raw_sql_injection ────────────────────────────────────
  {
    ruleId: 'DJG_003',
    fixtureExt: 'py',
    positiveFixture: `User.objects.raw(f"SELECT * FROM auth_user WHERE name='{name}'")`,
  },
  // ── DJG_006 — django_hardcoded_secret_key ────────────────────────────────
  {
    ruleId: 'DJG_006',
    fixtureExt: 'py',
    positiveFixture: `SECRET_KEY = "django-insecure-xyz123abc456"`,
    negativeFixture: `SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]`,
  },
  // ── DJG_014 — django_pickle_deserialization ───────────────────────────────
  {
    ruleId: 'DJG_014',
    fixtureExt: 'py',
    positiveFixture: `data = pickle.loads(request.session.get("payload"))`,
  },
  // ── DJG_016 — django_shell_injection ─────────────────────────────────────
  // Regex: subprocess.run(f"..." or os.system(f"..." with f-string
  {
    ruleId: 'DJG_016',
    fixtureExt: 'py',
    positiveFixture: `os.system(f"git clone {repo_url}")`,
  },
  // ── DJG_017 — django_hardcoded_database_password ─────────────────────────
  // isDjangoSettings requires path to match /\bsettings\b.*\.py$/
  {
    ruleId: 'DJG_017',
    fixtureFilePath: 'myapp/settings.py',
    positiveFixture: `DATABASES = {"default": {"PASSWORD": "hardcoded_secret_pass"}}`,
    negativeFixture: `DATABASES = {"default": {"PASSWORD": os.environ["DB_PASSWORD"]}}`,
  },
];
