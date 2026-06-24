// @vitest-environment node
/**
 * Unit tests for Python security rules (PY_001–025).
 * Each test verifies that the rule fires on a vulnerable pattern
 * and does NOT fire on a safe equivalent.
 */

import { describe, it, expect } from 'vitest';
import { PYTHON_RULES } from './python';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '1.2.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function detectWith(ruleId: string, path: string, content: string) {
  const rule = PYTHON_RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  const input: DetectInput = {
    scan: EMPTY_SCAN,
    config: CONFIG_DEFAULTS,
    changedFiles: [{ path, content }],
  };
  return rule.detect(input);
}

function expectFires(ruleId: string, path: string, content: string) {
  const findings = detectWith(ruleId, path, content);
  expect(findings.length, `${ruleId} should fire on:\n${content}`).toBeGreaterThan(0);
  return findings;
}

function expectClean(ruleId: string, path: string, content: string) {
  const findings = detectWith(ruleId, path, content);
  expect(findings.length, `${ruleId} should NOT fire on:\n${content}`).toBe(0);
}

// ── PY_001: eval/exec ────────────────────────────────────────────────────────

describe('PY_001: py_eval_exec', () => {
  it('fires on eval(variable)', () => {
    expectFires('PY_001', 'app.py', 'result = eval(user_input)');
  });

  it('fires on exec(dynamic)', () => {
    expectFires('PY_001', 'views.py', 'exec(llm_response)');
  });

  it('does NOT fire on eval with string literal', () => {
    expectClean('PY_001', 'app.py', "x = eval('1 + 1')");
  });

  it('does NOT fire on .py test files', () => {
    expectClean('PY_001', 'tests/test_app.py', 'result = eval(user_input)');
  });

  it('does NOT fire on non-python files', () => {
    expectClean('PY_001', 'app.js', 'eval(userInput)');
  });

  it('reports correct line number', () => {
    const findings = expectFires('PY_001', 'app.py', '# safe\n# safe\neval(user_input)');
    expect(findings[0]!.line).toBe(3);
  });
});

// ── PY_002: SQL injection ────────────────────────────────────────────────────

describe('PY_002: py_sql_injection', () => {
  it('fires on f-string in execute()', () => {
    expectFires('PY_002', 'db.py', 'cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")');
  });

  it('fires on % formatting in execute()', () => {
    expectFires('PY_002', 'db.py', 'cursor.execute("DELETE FROM %s" % table_name)');
  });

  it('fires on text(f-string)', () => {
    expectFires('PY_002', 'models.py', 'session.execute(text(f"SELECT * FROM {table}"))');
  });

  it('does NOT fire on parameterized query', () => {
    expectClean('PY_002', 'db.py', 'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))');
  });
});

// ── PY_003: Hardcoded secrets ────────────────────────────────────────────────

describe('PY_003: py_hardcoded_secret', () => {
  it('fires on hardcoded API key variable', () => {
    expectFires('PY_003', 'config.py', 'api_key = "sk-abc123456789"');
  });

  it('fires on OpenAI key pattern', () => {
    expectFires('PY_003', 'main.py', 'client = OpenAI(api_key="sk-proj-abcdefghijklmnopqrst12345")');
  });

  it('fires on hardcoded password', () => {
    expectFires('PY_003', 'settings.py', 'DATABASE_PASSWORD = "hunter2secure"');
  });

  it('does NOT fire on env var access', () => {
    expectClean('PY_003', 'config.py', 'api_key = os.environ["OPENAI_API_KEY"]');
  });

  it('does NOT fire on short strings', () => {
    expectClean('PY_003', 'config.py', 'api_key = "test"');
  });
});

// ── PY_004: SSRF ─────────────────────────────────────────────────────────────

describe('PY_004: py_ssrf', () => {
  it('fires on requests.get(variable) without URL validation', () => {
    expectFires('PY_004', 'proxy.py', 'url = request.args.get("url")\nresponse = requests.get(url)');
  });

  it('does NOT fire when URL is validated', () => {
    expectClean('PY_004', 'proxy.py', [
      'from urllib.parse import urlparse',
      'url = request.args.get("url")',
      'assert urlparse(url).hostname in ALLOWED_HOSTS',
      'response = requests.get(url)',
    ].join('\n'));
  });
});

// ── PY_005: Missing auth ─────────────────────────────────────────────────────

describe('PY_005: py_missing_auth', () => {
  it('fires on FastAPI POST with no Depends auth', () => {
    expectFires('PY_005', 'routes.py', [
      '@app.post("/users")',
      'async def create_user(data: dict):',
      '    return db.insert(data)',
    ].join('\n'));
  });

  it('does NOT fire when Depends is used', () => {
    expectClean('PY_005', 'routes.py', [
      '@router.post("/users")',
      'async def create_user(',
      '    data: CreateUser,',
      '    user: User = Depends(get_current_user)',
      '):',
      '    return db.insert(data)',
    ].join('\n'));
  });

  it('does NOT fire on GET routes (read-only)', () => {
    expectClean('PY_005', 'routes.py', [
      '@app.get("/users")',
      'async def list_users():',
      '    return db.query(User).all()',
    ].join('\n'));
  });
});

// ── PY_006: Shell injection ──────────────────────────────────────────────────

describe('PY_006: py_shell_injection', () => {
  it('fires on os.system with variable', () => {
    expectFires('PY_006', 'utils.py', 'os.system(f"convert {filename}")');
  });

  it('fires on subprocess with shell=True', () => {
    expectFires('PY_006', 'worker.py', 'subprocess.call(f"ls {directory}", shell=True)');
  });

  it('does NOT fire on subprocess with list args', () => {
    expectClean('PY_006', 'utils.py', 'subprocess.run(["convert", filename], shell=False)');
  });
});

// ── PY_007: Pickle ───────────────────────────────────────────────────────────

describe('PY_007: py_pickle_deserialization', () => {
  it('fires on pickle.loads()', () => {
    expectFires('PY_007', 'api.py', 'data = pickle.loads(request.body)');
  });

  it('fires on pickle.load()', () => {
    expectFires('PY_007', 'api.py', 'obj = pickle.load(file)');
  });

  it('does NOT fire in test files', () => {
    expectClean('PY_007', 'tests/test_api.py', 'data = pickle.loads(payload)');
  });
});

// ── PY_008: yaml.load unsafe ─────────────────────────────────────────────────

describe('PY_008: py_yaml_load_unsafe', () => {
  it('fires on yaml.load without Loader', () => {
    expectFires('PY_008', 'config.py', 'config = yaml.load(content)');
  });

  it('does NOT fire on yaml.safe_load', () => {
    expectClean('PY_008', 'config.py', 'config = yaml.safe_load(content)');
  });

  it('does NOT fire on yaml.load with SafeLoader', () => {
    expectClean('PY_008', 'config.py', 'config = yaml.load(content, Loader=yaml.SafeLoader)');
  });
});

// ── PY_010: CORS wildcard ────────────────────────────────────────────────────

describe('PY_010: py_cors_wildcard', () => {
  it('fires on allow_origins=["*"]', () => {
    expectFires('PY_010', 'main.py', [
      'app.add_middleware(',
      '    CORSMiddleware,',
      '    allow_origins=["*"],',
      ')',
    ].join('\n'));
  });

  it('does NOT fire on specific origins', () => {
    expectClean('PY_010', 'main.py', [
      'app.add_middleware(',
      '    CORSMiddleware,',
      '    allow_origins=["https://example.com"],',
      ')',
    ].join('\n'));
  });
});

// ── PY_011: Missing request timeout ─────────────────────────────────────────

describe('PY_011: py_no_request_timeout', () => {
  it('fires on requests.get without timeout', () => {
    expectFires('PY_011', 'client.py', 'response = requests.get(url)');
  });

  it('does NOT fire when timeout is set', () => {
    expectClean('PY_011', 'client.py', 'response = requests.get(url, timeout=10)');
  });
});

// ── PY_012: Debug mode ───────────────────────────────────────────────────────

describe('PY_012: py_debug_mode', () => {
  it('fires on app.run(debug=True)', () => {
    expectFires('PY_012', 'main.py', 'app.run(debug=True)');
  });

  it('fires on uvicorn.run with debug=True', () => {
    expectFires('PY_012', 'main.py', 'uvicorn.run(app, host="0.0.0.0", debug=True)');
  });

  it('does NOT fire on debug=False', () => {
    expectClean('PY_012', 'main.py', 'app.run(debug=False)');
  });
});

// ── PY_013: Insecure random ──────────────────────────────────────────────────

describe('PY_013: py_insecure_random', () => {
  it('fires on random.randint for token generation', () => {
    expectFires('PY_013', 'auth.py', [
      '# generate reset token',
      'token = str(random.randint(100000, 999999))',
    ].join('\n'));
  });

  it('does NOT fire on random used without security context', () => {
    expectClean('PY_013', 'game.py', 'roll = random.randint(1, 6)');
  });
});

// ── PY_014: Prompt injection ─────────────────────────────────────────────────

describe('PY_014: py_prompt_injection', () => {
  it('fires on f-string prompt with user input', () => {
    expectFires('PY_014', 'ai.py', [
      'from openai import OpenAI',
      'client = OpenAI()',
      'prompt = f"You are helpful. User: {user_message}"',
      'response = client.chat.completions.create(messages=[{"role": "user", "content": prompt}])',
    ].join('\n'));
  });

  it('does NOT fire without LLM call in file', () => {
    expectClean('PY_014', 'utils.py', 'prompt = f"Hello {user_message}"');
  });
});

// ── PY_015: AI endpoint no auth ──────────────────────────────────────────────

describe('PY_015: py_ai_endpoint_no_auth', () => {
  it('fires on unauthenticated route calling OpenAI', () => {
    expectFires('PY_015', 'routes.py', [
      'from openai import OpenAI',
      'client = OpenAI()',
      '',
      '@app.post("/chat")',
      'async def chat(message: str):',
      '    return client.chat.completions.create(',
      '        model="gpt-4",',
      '        messages=[{"role": "user", "content": message}]',
      '    )',
    ].join('\n'));
  });

  it('does NOT fire when auth dependency is present', () => {
    expectClean('PY_015', 'routes.py', [
      'from openai import OpenAI',
      'client = OpenAI()',
      '',
      '@router.post("/chat")',
      'async def chat(',
      '    message: str,',
      '    user: User = Depends(get_current_user)',
      '):',
      '    return client.chat.completions.create(',
      '        model="gpt-4",',
      '        messages=[{"role": "user", "content": message}]',
      '    )',
    ].join('\n'));
  });
});

// ── PY_018: No rate limiting ─────────────────────────────────────────────────

describe('PY_018: py_no_rate_limit', () => {
  it('fires on FastAPI app with routes but no rate limiter', () => {
    expectFires('PY_018', 'main.py', [
      'app = FastAPI()',
      '',
      '@app.post("/data")',
      'async def create_data(body: dict):',
      '    return db.insert(body)',
    ].join('\n'));
  });

  it('does NOT fire when slowapi is used', () => {
    expectClean('PY_018', 'main.py', [
      'from slowapi import Limiter',
      'app = FastAPI()',
      'limiter = Limiter(key_func=get_remote_address)',
      '',
      '@app.post("/data")',
      '@limiter.limit("10/minute")',
      'async def create_data(body: dict):',
      '    return db.insert(body)',
    ].join('\n'));
  });
});

// ── PY_019: Hardcoded connection string ─────────────────────────────────────

describe('PY_019: py_hardcoded_connection_string', () => {
  it('fires on hardcoded postgres URL with password', () => {
    expectFires('PY_019', 'db.py', 'engine = create_engine("postgresql://admin:secret@localhost/mydb")');
  });

  it('does NOT fire on env var', () => {
    expectClean('PY_019', 'db.py', 'engine = create_engine(os.environ["DATABASE_URL"])');
  });

  it('does NOT fire on connection string with variable interpolation', () => {
    expectClean('PY_019', 'db.py', 'engine = create_engine(f"postgresql://user:{password}@localhost/db")');
  });
});

// ── PY_020: Bare except ──────────────────────────────────────────────────────

describe('PY_020: py_bare_except', () => {
  it('fires on bare except:', () => {
    expectFires('PY_020', 'handler.py', 'try:\n    do_thing()\nexcept:\n    pass');
  });

  it('does NOT fire on except Exception:', () => {
    expectClean('PY_020', 'handler.py', 'try:\n    do_thing()\nexcept Exception:\n    pass');
  });

  it('does NOT fire on typed except:', () => {
    expectClean('PY_020', 'handler.py', 'try:\n    parse(x)\nexcept (ValueError, KeyError) as e:\n    log(e)');
  });
});

// ── PY_021: Error detail leak ────────────────────────────────────────────────

describe('PY_021: py_error_detail_leak', () => {
  it('fires on returning str(e) in jsonify', () => {
    expectFires('PY_021', 'api.py', 'return jsonify({"error": str(e)})');
  });

  it('fires on raising HTTPException with traceback', () => {
    expectFires('PY_021', 'api.py', 'raise HTTPException(detail=traceback.format_exc())');
  });

  it('does NOT fire on generic error message', () => {
    expectClean('PY_021', 'api.py', 'raise HTTPException(status_code=500, detail="Internal server error")');
  });
});

// ── PY_022: Missing input validation ─────────────────────────────────────────

describe('PY_022: py_missing_input_validation', () => {
  it('fires on raw request.json() without Pydantic', () => {
    expectFires('PY_022', 'routes.py', [
      '@app.post("/users")',
      'async def create_user(request: Request):',
      '    data = await request.json()',
      '    name = data["name"]',
    ].join('\n'));
  });

  it('does NOT fire when Pydantic is imported', () => {
    expectClean('PY_022', 'routes.py', [
      'from pydantic import BaseModel',
      '',
      'class CreateUser(BaseModel):',
      '    name: str',
      '',
      '@app.post("/users")',
      'async def create_user(data: CreateUser):',
      '    return data',
    ].join('\n'));
  });
});

// ── PY_023: Timing attack ────────────────────────────────────────────────────

describe('PY_023: py_timing_attack', () => {
  it('fires on token == stored_token', () => {
    expectFires('PY_023', 'auth.py', 'if token == stored_token:\n    authenticate()');
  });

  it('does NOT fire when hmac.compare_digest is used', () => {
    expectClean('PY_023', 'auth.py', 'if hmac.compare_digest(token, stored_token):\n    authenticate()');
  });
});

// ── PY_025: LangChain no auth ────────────────────────────────────────────────

describe('PY_025: py_langchain_no_auth', () => {
  it('fires on unauthenticated route with agent.run()', () => {
    expectFires('PY_025', 'routes.py', [
      'from langchain.agents import AgentExecutor',
      '',
      '@app.post("/agent")',
      'async def run_agent(query: str):',
      '    return agent.run(query)',
    ].join('\n'));
  });

  it('does NOT fire when Depends auth is present', () => {
    expectClean('PY_025', 'routes.py', [
      'from langchain.agents import AgentExecutor',
      '',
      '@router.post("/agent")',
      'async def run_agent(',
      '    query: str,',
      '    user: User = Depends(get_current_user)',
      '):',
      '    return agent.run(query)',
    ].join('\n'));
  });
});

// ── Registry contract ─────────────────────────────────────────────────────────

describe('PYTHON_RULES registry contract', () => {
  it('has exactly 25 rules', () => {
    expect(PYTHON_RULES).toHaveLength(44);
  });

  it('every rule has a unique ID with PY_ prefix', () => {
    const ids = PYTHON_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('PY_'))).toBe(true);
  });

  it('every rule has detect() returning an array', () => {
    for (const rule of PYTHON_RULES) {
      const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
      const result = rule.detect(input);
      expect(Array.isArray(result), `${rule.id} detect() must return array`).toBe(true);
    }
  });

  it('every rule has a non-empty explain block', () => {
    for (const rule of PYTHON_RULES) {
      expect(rule.explain, `${rule.id} missing explain`).toBeDefined();
      expect(rule.explain?.why.length, `${rule.id} why is empty`).toBeGreaterThan(0);
      expect(rule.explain?.goodExample.length, `${rule.id} goodExample is empty`).toBeGreaterThan(0);
      expect(rule.explain?.badExample.length, `${rule.id} badExample is empty`).toBeGreaterThan(0);
    }
  });
});
