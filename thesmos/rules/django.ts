/**
 * Django Security Rules — DJG_001–020
 *
 * Targets the predictable security failure modes of AI-generated Django code.
 * Covers settings misconfigurations, ORM raw queries, auth decorator gaps,
 * CSRF exemptions, template injection, and serializer over-exposure.
 *
 * AI assistants are consistent in their Django mistakes: they omit
 * `@login_required`, set `ALLOWED_HOSTS = ['*']` for "simplicity", use
 * `.raw()` with f-strings, and strip CSRF protection to make forms "work faster".
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDjango(p: string) { return p.endsWith('.py'); }
function isDjangoSettings(p: string) { return /\bsettings\b.*\.py$/.test(p); }
function isTemplate(p: string) { return /\.html$/.test(p); }
function isTest(p: string) {
  return /(?:^|\/)(?:tests?|conftest|test_|_test)\b/.test(p);
}

function lineOf(content: string, re: RegExp): number | undefined {
  const idx = content.split('\n').findIndex((l) => re.test(l));
  return idx >= 0 ? idx + 1 : undefined;
}

function firstMatchLine(content: string, re: RegExp): number | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) return i + 1;
  }
  return undefined;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const DJANGO_RULES: ThesmosRule[] = [

  // ── DJG_001: DEBUG = True in settings ────────────────────────────────────
  {
    id: 'DJG_001',
    category: 'django_debug_true',
    description: 'DEBUG = True in settings file exposes stack traces and config to end users.',
    severity: 'BLOCKER',
    tags: ['django', 'security', 'settings', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'DEBUG = True makes Django expose full Python stack traces, SQL queries, and local variables in browser error pages. In production this leaks database credentials, secret keys, and internal paths to anyone who triggers a 500 error.',
      commonViolations: [
        'DEBUG = True  # "temporary" left in settings.py',
        'AI-generated settings files that default DEBUG to True',
      ],
      goodExample: 'DEBUG = os.environ.get("DJANGO_DEBUG", "False") == "True"',
      badExample: 'DEBUG = True  # ❌ never in production',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_debug_true', config.severityRules);
      const findings: Finding[] = [];
      const DEBUG_TRUE_RE = /^\s*DEBUG\s*=\s*True\b/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const line = lineOf(content, DEBUG_TRUE_RE);
        if (line !== undefined) {
          findings.push({
            severity: sev, category: 'django_debug_true', file: path, line,
            message: 'DEBUG = True in settings — full stack traces and SQL queries exposed to users in production.',
            suggestion: 'Set DEBUG = os.environ.get("DJANGO_DEBUG", "False") == "True" and ensure it is False in production.',
          });
        }
      }
      return findings;
    },
  },

  // ── DJG_002: ALLOWED_HOSTS = ['*'] ───────────────────────────────────────
  {
    id: 'DJG_002',
    category: 'django_allowed_hosts_wildcard',
    description: 'ALLOWED_HOSTS = ["*"] disables Django\'s Host header validation, enabling header injection attacks.',
    severity: 'HIGH',
    tags: ['django', 'security', 'settings', 'host-header'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Django\'s ALLOWED_HOSTS setting prevents host header injection attacks and DNS rebinding. Setting it to ["*"] defeats this protection entirely. Attackers can send requests with spoofed Host headers that Django will accept, potentially poisoning caches and redirects.',
      commonViolations: [
        'ALLOWED_HOSTS = ["*"]  # "simplest" config AI generates',
        'ALLOWED_HOSTS = [\'*\']  # to "make it work"',
      ],
      goodExample: 'ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost").split(",")',
      badExample: 'ALLOWED_HOSTS = ["*"]  # ❌ disables host validation',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_allowed_hosts_wildcard', config.severityRules);
      const findings: Finding[] = [];
      const WILDCARD_RE = /ALLOWED_HOSTS\s*=\s*\[['"]?\*['"]?\]/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const line = lineOf(content, WILDCARD_RE);
        if (line !== undefined) {
          findings.push({
            severity: sev, category: 'django_allowed_hosts_wildcard', file: path, line,
            message: 'ALLOWED_HOSTS = ["*"] disables host header validation — host injection and DNS rebinding risk.',
            suggestion: 'Set ALLOWED_HOSTS to specific domain names from environment variables.',
          });
        }
      }
      return findings;
    },
  },

  // ── DJG_003: Raw SQL with f-string or % ──────────────────────────────────
  {
    id: 'DJG_003',
    category: 'django_raw_sql_injection',
    description: 'Django .raw() or cursor.execute() called with string formatting — SQL injection risk.',
    severity: 'BLOCKER',
    tags: ['django', 'security', 'sql-injection', 'python'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Django\'s ORM is parameterized by default, but .raw() and cursor.execute() bypass that protection when user input is concatenated directly into the SQL string using f-strings or % formatting. Any user-controlled value can then modify the query structure.',
      commonViolations: [
        'Model.objects.raw(f"SELECT * FROM app_model WHERE name = \'{name}\'")',
        'cursor.execute("DELETE FROM users WHERE id = %s" % user_id)',
        'cursor.execute(f"UPDATE users SET role = \'{role}\' WHERE id = {uid}")',
      ],
      goodExample: 'Model.objects.raw("SELECT * FROM app_model WHERE name = %s", [name])',
      badExample: 'Model.objects.raw(f"SELECT * FROM app_model WHERE name = \'{name}\'")  # ❌ SQLi',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_raw_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      // .raw( with f-string, or .execute( with % operator after closing quote
      const RAW_FSTR_RE = /\.raw\s*\(\s*f['"]/;
      const EXEC_FMT_RE = /\.execute\s*\(\s*f['"]|\.execute\s*\(\s*['"][^'"]*['"]\s*%\s*\w/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if ((RAW_FSTR_RE.test(line) || EXEC_FMT_RE.test(line)) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_raw_sql_injection', file: path, line: i + 1,
              message: 'Raw SQL with string formatting — user input can escape the query and execute arbitrary SQL.',
              suggestion: 'Pass parameters as a list: .raw("SELECT ... WHERE id = %s", [user_id]) or use ORM filters.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_004: @csrf_exempt ─────────────────────────────────────────────────
  {
    id: 'DJG_004',
    category: 'django_csrf_exempt',
    description: '@csrf_exempt disables CSRF protection on a view — vulnerable to cross-site request forgery.',
    severity: 'HIGH',
    tags: ['django', 'security', 'csrf', 'auth'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'CSRF attacks trick authenticated users into making unintended requests to your application. Django\'s built-in CSRF middleware prevents this. @csrf_exempt turns off that protection for a specific view, leaving it open to CSRF for every authenticated user who visits a malicious page.',
      commonViolations: [
        '@csrf_exempt added to "fix" AJAX requests that AI didn\'t set the CSRF token for',
        '@csrf_exempt on API views that handle state-changing operations',
      ],
      goodExample: '# For API endpoints: use DRF\'s SessionAuthentication (includes CSRF)\n# For AJAX: include the csrftoken cookie header in requests',
      badExample: '@csrf_exempt\ndef delete_account(request):  # ❌ any site can trigger this for logged-in users',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_csrf_exempt', config.severityRules);
      const findings: Finding[] = [];
      const CSRF_RE = /@csrf_exempt\b/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (CSRF_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_csrf_exempt', file: path, line: i + 1,
              message: '@csrf_exempt disables CSRF protection — any website can forge authenticated requests to this view.',
              suggestion: 'Remove @csrf_exempt. For AJAX: set X-CSRFToken header from the csrftoken cookie. For APIs: use DRF with proper authentication.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_005: Missing @login_required on POST/state-changing views ─────────
  {
    id: 'DJG_005',
    category: 'django_missing_login_required',
    description: 'View function with state-changing HTTP method handling lacks @login_required or LoginRequiredMixin.',
    severity: 'HIGH',
    tags: ['django', 'security', 'auth', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI-generated Django views frequently handle POST/DELETE/PUT without adding authentication checks. Without @login_required or LoginRequiredMixin, any anonymous user can call the endpoint and modify or delete data.',
      commonViolations: [
        'def delete_post(request, pk): if request.method == "DELETE": ...  (no login check)',
        'def update_profile(request): if request.method == "POST": ...  (no login check)',
      ],
      goodExample: '@login_required\ndef update_profile(request):\n    if request.method == "POST": ...',
      badExample: 'def delete_post(request, pk):\n    if request.method == "DELETE":\n        Post.objects.get(pk=pk).delete()  # ❌ no auth',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_missing_login_required', config.severityRules);
      const findings: Finding[] = [];
      // Detect def <name>(request, ...) that handles POST/DELETE/PUT without @login_required in the preceding lines
      const DEF_VIEW_RE = /^def\s+\w+\s*\(request(?:[,)])/;
      const POST_METHOD_RE = /request\.method\s*(?:==|in)\s*(?:["'](?:POST|DELETE|PUT|PATCH)|(?:\[.*["'](?:POST|DELETE|PUT|PATCH)))/;
      const AUTH_RE = /@login_required|LoginRequiredMixin|request\.user\.is_authenticated|@permission_required|@staff_member_required/;
      const WINDOW = 15;

      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!DEF_VIEW_RE.test(lines[i]!)) continue;
          // Check preceding lines for auth decorator
          const decoratorWindow = lines.slice(Math.max(0, i - 5), i);
          if (decoratorWindow.some((l) => AUTH_RE.test(l))) continue;
          // Check following lines for state-changing method check
          const bodyWindow = lines.slice(i, Math.min(lines.length, i + WINDOW));
          if (!bodyWindow.some((l) => POST_METHOD_RE.test(l))) continue;
          // Check whole function window for inline auth check
          if (bodyWindow.some((l) => AUTH_RE.test(l))) continue;
          findings.push({
            severity: sev, category: 'django_missing_login_required', file: path, line: i + 1,
            message: 'View handles POST/DELETE/PUT without @login_required — unauthenticated users can trigger state changes.',
            suggestion: 'Add @login_required decorator above the function, or use LoginRequiredMixin for class-based views.',
          });
        }
      }
      return findings;
    },
  },

  // ── DJG_006: SECRET_KEY hardcoded ────────────────────────────────────────
  {
    id: 'DJG_006',
    category: 'django_hardcoded_secret_key',
    description: 'Django SECRET_KEY appears to be hardcoded — rotate it and load from environment.',
    severity: 'BLOCKER',
    tags: ['django', 'security', 'secrets', 'settings'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Django\'s SECRET_KEY is used to sign cookies, sessions, CSRF tokens, and password reset links. A leaked SECRET_KEY lets attackers forge session cookies (log in as any user) and bypass CSRF protection. AI tools frequently generate settings files with a real key in the source.',
      commonViolations: [
        'SECRET_KEY = "django-insecure-abc123..."  # copied from Django docs',
        'SECRET_KEY = "my-secret-key-here"  # placeholder AI left in',
      ],
      goodExample: 'SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]',
      badExample: 'SECRET_KEY = "django-insecure-v9r..."  # ❌ committed to git',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_hardcoded_secret_key', config.severityRules);
      const findings: Finding[] = [];
      // Matches SECRET_KEY = "..." or SECRET_KEY = '...' but not os.environ / env(
      const KEY_RE = /^\s*SECRET_KEY\s*=\s*["'][^"']{8,}/;
      const ENV_RE = /os\.environ|env\s*\(|config\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (KEY_RE.test(line) && !ENV_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_hardcoded_secret_key', file: path, line: i + 1,
              message: 'SECRET_KEY appears hardcoded — anyone with repo access can forge session cookies and CSRF tokens.',
              suggestion: 'Load from environment: SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_007: SECURE_SSL_REDIRECT not set ─────────────────────────────────
  {
    id: 'DJG_007',
    category: 'django_no_ssl_redirect',
    description: 'SECURE_SSL_REDIRECT is not enabled in settings — HTTP traffic not redirected to HTTPS.',
    severity: 'MEDIUM',
    tags: ['django', 'security', 'tls', 'settings'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Without SECURE_SSL_REDIRECT = True, Django will serve content over plain HTTP, exposing session cookies and form data to network eavesdroppers. In production this should always redirect HTTP to HTTPS.',
      commonViolations: [
        'settings.py generated by AI without any SECURE_* settings',
      ],
      goodExample: 'SECURE_SSL_REDIRECT = not DEBUG  # True in production, False in dev',
      badExample: '# no SECURE_SSL_REDIRECT in settings.py  # ❌ HTTP allowed in production',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_no_ssl_redirect', config.severityRules);
      const findings: Finding[] = [];
      const HAS_INSTALLED_APPS = /INSTALLED_APPS\s*=/;
      const HAS_SSL = /SECURE_SSL_REDIRECT/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || !isDjangoSettings(path) || isTest(path)) continue;
        if (HAS_INSTALLED_APPS.test(content) && !HAS_SSL.test(content)) {
          findings.push({
            severity: sev, category: 'django_no_ssl_redirect', file: path,
            message: 'Settings file has no SECURE_SSL_REDIRECT — HTTP traffic will not be redirected to HTTPS in production.',
            suggestion: 'Add SECURE_SSL_REDIRECT = not DEBUG to your settings.',
          });
        }
      }
      return findings;
    },
  },

  // ── DJG_008: ModelSerializer with fields = '__all__' ─────────────────────
  {
    id: 'DJG_008',
    category: 'django_serializer_all_fields',
    description: 'DRF ModelSerializer with fields = "__all__" exposes every model field including sensitive ones.',
    severity: 'HIGH',
    tags: ['django', 'security', 'drf', 'api', 'data-exposure'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'When a DRF ModelSerializer exposes all fields with `fields = "__all__"`, it returns every column from the model — including password hashes, internal flags, foreign key IDs, and future fields added by other developers. AI consistently generates this pattern because it requires no thought about what data should be public.',
      commonViolations: [
        'class UserSerializer(ModelSerializer):\n    class Meta:\n        model = User\n        fields = "__all__"  # returns password hash!',
        'class OrderSerializer(ModelSerializer):\n    class Meta:\n        model = Order\n        fields = "__all__"  # returns internal cost fields',
      ],
      goodExample: 'class UserSerializer(ModelSerializer):\n    class Meta:\n        model = User\n        fields = ["id", "email", "display_name", "created_at"]',
      badExample: 'fields = "__all__"  # ❌ exposes password hash, internal flags, FK IDs',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_serializer_all_fields', config.severityRules);
      const findings: Finding[] = [];
      const ALL_FIELDS_RE = /fields\s*=\s*['"]__all__['"]/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (ALL_FIELDS_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_serializer_all_fields', file: path, line: i + 1,
              message: 'ModelSerializer exposes all fields — sensitive columns (passwords, internal flags) will be returned to API consumers.',
              suggestion: 'Explicitly list only the fields consumers should see: fields = ["id", "email", "name"]',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_009: Template auto-escape bypass {{ value|safe }} ────────────────
  {
    id: 'DJG_009',
    category: 'django_template_safe_filter',
    description: '{{ value|safe }} in Django template bypasses auto-escaping — XSS if value is user-controlled.',
    severity: 'HIGH',
    tags: ['django', 'security', 'xss', 'template'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Django templates auto-escape HTML by default, protecting against XSS. The |safe filter tells Django "trust this value, don\'t escape it." If the value comes from user input, database content, or LLM output, an attacker can inject arbitrary HTML and JavaScript.',
      commonViolations: [
        '{{ user.bio|safe }}  # bio is user-editable',
        '{{ llm_response|safe }}  # LLM output rendered unescaped',
        '{{ comment.text|safe }}  # comment from database',
      ],
      goodExample: '{{ user.bio }}  {# auto-escaped — safe by default #}',
      badExample: '{{ user.bio|safe }}  {# ❌ XSS if bio contains <script> #}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_template_safe_filter', config.severityRules);
      const findings: Finding[] = [];
      const SAFE_RE = /\{\{[^}]+\|\s*safe\s*\}\}/;
      for (const { path, content } of changedFiles) {
        if (!isTemplate(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (SAFE_RE.test(line) && !/^\s*{#/.test(line.trim())) {
            findings.push({
              severity: sev, category: 'django_template_safe_filter', file: path, line: i + 1,
              message: '|safe filter bypasses HTML escaping — XSS vulnerability if this value is user-controlled or external.',
              suggestion: 'Remove |safe. If you must render HTML, use bleach.clean() to whitelist allowed tags before storing.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_010: mark_safe() with dynamic content ─────────────────────────────
  {
    id: 'DJG_010',
    category: 'django_mark_safe_dynamic',
    description: 'mark_safe() called with a dynamic/formatted string — XSS if the value is user-controlled.',
    severity: 'HIGH',
    tags: ['django', 'security', 'xss', 'python'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'mark_safe() signals Django\'s template engine that a string is pre-escaped and should not be auto-escaped. When called on f-strings, % formatting, or concatenated values, any user-controlled content in the string bypasses XSS protection.',
      commonViolations: [
        'mark_safe(f"<b>{user.name}</b>")',
        'mark_safe("<a href=\'%s\'>click</a>" % url)',
      ],
      goodExample: 'from django.utils.html import format_html\nformat_html("<b>{}</b>", user.name)  # escapes the variable, not the template',
      badExample: 'mark_safe(f"<b>{user.name}</b>")  # ❌ user.name is not escaped',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_mark_safe_dynamic', config.severityRules);
      const findings: Finding[] = [];
      // mark_safe( with f-string or string concatenation/formatting (not a pure string literal)
      const MARK_SAFE_RE = /\bmark_safe\s*\(\s*(?:f['"]|[^'")\n]*\+|[^'")\n]*%\s*)/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (MARK_SAFE_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_mark_safe_dynamic', file: path, line: i + 1,
              message: 'mark_safe() with dynamic content — any user-controlled value in the string becomes an XSS vector.',
              suggestion: 'Use format_html() instead: format_html("<b>{}</b>", user.name) — it escapes interpolated values.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_011: User.objects.get() without try/except ───────────────────────
  {
    id: 'DJG_011',
    category: 'django_get_or_500',
    description: 'User.objects.get() without try/except raises DoesNotExist and returns 500 instead of 404.',
    severity: 'MEDIUM',
    tags: ['django', 'error-handling', 'python', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Django\'s .get() raises DoesNotExist (an exception subclass) when no record is found and MultipleObjectsReturned when more than one matches. AI-generated views frequently call .get() without handling these exceptions, causing unhandled 500 errors for the user. The fix is get_object_or_404() or a try/except block.',
      commonViolations: [
        'user = User.objects.get(pk=pk)  # 500 if user not found',
        'item = Item.objects.get(slug=slug)  # no try/except',
      ],
      goodExample: 'from django.shortcuts import get_object_or_404\nuser = get_object_or_404(User, pk=pk)',
      badExample: 'user = User.objects.get(pk=pk)  # ❌ raises 500 when user doesn\'t exist',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_get_or_500', config.severityRules);
      const findings: Finding[] = [];
      // .objects.get( on its own line without try on the same or preceding line
      const GET_RE = /\.\s*objects\s*\.\s*get\s*\(/;
      const SAFE_RE = /get_object_or_404|try\s*:|except\s+/;
      const WINDOW = 3;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!GET_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(Math.max(0, i - WINDOW), i + 2).join('\n');
          if (!SAFE_RE.test(ctx)) {
            findings.push({
              severity: sev, category: 'django_get_or_500', file: path, line: i + 1,
              message: '.objects.get() without error handling — DoesNotExist raises a 500 instead of returning 404.',
              suggestion: 'Replace with get_object_or_404(Model, pk=pk) or wrap in try/except Model.DoesNotExist.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DJG_012: Redirect with user-supplied URL ─────────────────────────────
  {
    id: 'DJG_012',
    category: 'django_open_redirect',
    description: 'Django redirect() called with unvalidated user input — open redirect vulnerability.',
    severity: 'HIGH',
    tags: ['django', 'security', 'open-redirect', 'auth'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Open redirects occur when your application redirects the user to a URL supplied in the request without validating it. Attackers use them in phishing campaigns: send a link to your trusted domain that redirects to a malicious site. Common in login/logout flows where `?next=` is used.',
      commonViolations: [
        'return redirect(request.GET.get("next", "/"))',
        'return redirect(request.POST["redirect_url"])',
      ],
      goodExample: '# Validate that next is a safe internal URL\nfrom django.utils.http import url_has_allowed_host_and_scheme\nnext_url = request.GET.get("next", "/")\nif url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}):\n    return redirect(next_url)\nreturn redirect("/")',
      badExample: 'return redirect(request.GET.get("next", "/"))  # ❌ phishing redirect',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_open_redirect', config.severityRules);
      const findings: Finding[] = [];
      const REDIRECT_RE = /\bredirect\s*\(\s*request\.(?:GET|POST|data)/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (REDIRECT_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_open_redirect', file: path, line: i + 1,
              message: 'redirect() with user-supplied URL — open redirect allows phishing attacks via your trusted domain.',
              suggestion: 'Validate with url_has_allowed_host_and_scheme() before redirecting, or only redirect to known safe paths.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_013: File upload without extension validation ────────────────────
  {
    id: 'DJG_013',
    category: 'django_unsafe_file_upload',
    description: 'File upload handler stores the file without validating the extension or content type.',
    severity: 'HIGH',
    tags: ['django', 'security', 'file-upload', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'AI-generated file upload views frequently save request.FILES["file"] directly without checking the extension or MIME type. An attacker can upload a .py or .php file and potentially execute it if the media directory is served through a misconfigured web server.',
      commonViolations: [
        'uploaded = request.FILES["file"]\ndefault_storage.save(uploaded.name, uploaded)',
        'handle_uploaded_file(request.FILES["avatar"])',
      ],
      goodExample: 'ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}\nimport os\next = os.path.splitext(f.name)[1].lower()\nif ext not in ALLOWED_EXTENSIONS:\n    raise ValidationError("File type not allowed")',
      badExample: '# No extension check\ndefault_storage.save(request.FILES["file"].name, request.FILES["file"])  # ❌',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_unsafe_file_upload', config.severityRules);
      const findings: Finding[] = [];
      const FILES_RE = /request\.FILES\s*\[/;
      const VALIDATE_RE = /\.name\.split|os\.path\.splitext|\.content_type|ALLOWED|allowed_ext|validate_file/i;
      const WINDOW = 8;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!FILES_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(i, Math.min(lines.length, i + WINDOW)).join('\n');
          if (!VALIDATE_RE.test(ctx)) {
            findings.push({
              severity: sev, category: 'django_unsafe_file_upload', file: path, line: i + 1,
              message: 'File upload without extension or content-type validation — arbitrary files including executables may be stored.',
              suggestion: 'Validate file extension and content type before saving. Whitelist allowed types, not blacklist.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DJG_014: pickle.loads() / pickle.load() deserialization ──────────────
  {
    id: 'DJG_014',
    category: 'django_pickle_deserialization',
    description: 'pickle.loads() or pickle.load() called — arbitrary code execution if input is attacker-controlled.',
    severity: 'BLOCKER',
    tags: ['django', 'security', 'deserialization', 'rce', 'python'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Python\'s pickle format embeds executable code. Deserializing attacker-controlled pickle data is equivalent to running attacker code on your server — they can get a shell, exfiltrate secrets, or pivot to other systems. Django apps sometimes use pickle to cache model instances or session data.',
      commonViolations: [
        'data = pickle.loads(request.body)',
        'obj = pickle.loads(cache.get(key))',
        'cached = pickle.loads(redis.get("session_data"))',
      ],
      goodExample: 'import json\ndata = json.loads(request.body)  # safe: JSON cannot embed code',
      badExample: 'data = pickle.loads(request.body)  # ❌ RCE if request.body is attacker-controlled',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_pickle_deserialization', config.severityRules);
      const findings: Finding[] = [];
      const PICKLE_RE = /\bpickle\.loads?\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (PICKLE_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_pickle_deserialization', file: path, line: i + 1,
              message: 'pickle deserialization — if the pickled data is attacker-controlled this is remote code execution.',
              suggestion: 'Use JSON (json.loads), msgpack, or orjson instead. Never unpickle data from untrusted sources.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_015: Missing SECURE_HSTS_SECONDS ─────────────────────────────────
  {
    id: 'DJG_015',
    category: 'django_no_hsts',
    description: 'SECURE_HSTS_SECONDS is not set — browsers will not enforce HTTPS-only connections.',
    severity: 'MEDIUM',
    tags: ['django', 'security', 'tls', 'hsts', 'settings'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'HTTP Strict Transport Security (HSTS) tells browsers to always use HTTPS for your domain, preventing protocol downgrade attacks and cookie hijacking on shared networks. Without it, a user on a coffee shop Wi-Fi can have their session stolen even if your server forces TLS at the server level.',
      commonViolations: [
        'settings.py with no SECURE_HSTS_SECONDS',
        'AI-generated settings that set SECURE_SSL_REDIRECT but forget HSTS',
      ],
      goodExample: 'SECURE_HSTS_SECONDS = 31536000  # 1 year\nSECURE_HSTS_INCLUDE_SUBDOMAINS = True\nSECURE_HSTS_PRELOAD = True',
      badExample: '# Missing SECURE_HSTS_SECONDS in production settings',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_no_hsts', config.severityRules);
      const findings: Finding[] = [];
      const HAS_SSL_REDIRECT = /SECURE_SSL_REDIRECT\s*=\s*True/;
      const HAS_HSTS = /SECURE_HSTS_SECONDS/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || !isDjangoSettings(path) || isTest(path)) continue;
        if (HAS_SSL_REDIRECT.test(content) && !HAS_HSTS.test(content)) {
          findings.push({
            severity: sev, category: 'django_no_hsts', file: path,
            message: 'SECURE_SSL_REDIRECT is set but SECURE_HSTS_SECONDS is missing — browsers will not enforce HTTPS, leaving connections vulnerable to downgrade attacks.',
            suggestion: 'Add SECURE_HSTS_SECONDS = 31536000 (and optionally SECURE_HSTS_INCLUDE_SUBDOMAINS = True).',
          });
        }
      }
      return findings;
    },
  },

  // ── DJG_016: User input in shell=True subprocess ─────────────────────────
  {
    id: 'DJG_016',
    category: 'django_shell_injection',
    description: 'subprocess called with shell=True and dynamic string — command injection if user input is included.',
    severity: 'BLOCKER',
    tags: ['django', 'security', 'command-injection', 'python'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'subprocess.run(shell=True) passes the command to the OS shell, which interprets characters like ;, &&, |, and $() as shell operators. If any part of the command string is derived from user input or external data, an attacker can inject additional commands.',
      commonViolations: [
        'subprocess.run(f"convert {filename} output.png", shell=True)',
        'os.system(f"ffmpeg -i {request.FILES[\'video\'].name} ...")',
      ],
      goodExample: 'subprocess.run(["convert", filename, "output.png"])  # list form, no shell',
      badExample: 'subprocess.run(f"convert {filename} output.png", shell=True)  # ❌ shell injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_shell_injection', config.severityRules);
      const findings: Finding[] = [];
      const SHELL_RE = /(?:subprocess\.(?:run|call|check_output|Popen)|os\.system)\s*\(\s*f['"]/;
      const SHELL_FLAG_RE = /shell\s*=\s*True/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if ((SHELL_RE.test(line) || (SHELL_FLAG_RE.test(line) && /f['"]/.test(line))) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_shell_injection', file: path, line: i + 1,
              message: 'subprocess with shell=True and an f-string — command injection if any part of the string is user-controlled.',
              suggestion: 'Pass command as a list instead of a string: subprocess.run(["convert", filename, "output.png"]).',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_017: Hardcoded DATABASE password in settings ─────────────────────
  {
    id: 'DJG_017',
    category: 'django_hardcoded_db_password',
    description: 'DATABASES settings contains a hardcoded PASSWORD — database credentials in source code.',
    severity: 'BLOCKER',
    tags: ['django', 'security', 'secrets', 'database', 'settings'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Hardcoding database credentials in settings.py means anyone with read access to the repository can connect to your database directly. AI assistants commonly generate settings.py examples with real-looking passwords in the DATABASES dict.',
      commonViolations: [
        '"PASSWORD": "mypassword123"',
        '"PASSWORD": "postgres"',
        '"PASSWORD": "supersecret"',
      ],
      goodExample: '"PASSWORD": os.environ.get("DB_PASSWORD", "")',
      badExample: '"PASSWORD": "mypassword123"  # ❌ committed to git',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_hardcoded_db_password', config.severityRules);
      const findings: Finding[] = [];
      const PW_RE = /['"]\s*PASSWORD\s*['"]\s*:\s*['"][^'"]{2,}/;
      const ENV_RE = /os\.environ|env\s*\(|config\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || !isDjangoSettings(path) || isTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (PW_RE.test(line) && !ENV_RE.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'django_hardcoded_db_password', file: path, line: i + 1,
              message: 'Database PASSWORD is hardcoded in settings — anyone with repo access can connect to your database.',
              suggestion: 'Load from environment: "PASSWORD": os.environ["DB_PASSWORD"]',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── DJG_018: Missing SESSION_COOKIE_SECURE ───────────────────────────────
  {
    id: 'DJG_018',
    category: 'django_insecure_session_cookie',
    description: 'SESSION_COOKIE_SECURE = False (or missing) allows session cookies to be sent over HTTP.',
    severity: 'MEDIUM',
    tags: ['django', 'security', 'session', 'cookies', 'settings'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'When SESSION_COOKIE_SECURE is False, Django will send the session cookie over unencrypted HTTP connections. An attacker on the same network can steal the session cookie with a passive eavesdrop and impersonate the user without cracking any encryption.',
      commonViolations: [
        'SESSION_COOKIE_SECURE = False  # "for local dev" left in production',
        'No SESSION_COOKIE_SECURE in production settings (defaults to False)',
      ],
      goodExample: 'SESSION_COOKIE_SECURE = not DEBUG  # True in production',
      badExample: 'SESSION_COOKIE_SECURE = False  # ❌ session hijack over HTTP',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_insecure_session_cookie', config.severityRules);
      const findings: Finding[] = [];
      const COOKIE_FALSE_RE = /SESSION_COOKIE_SECURE\s*=\s*False\b/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || !isDjangoSettings(path) || isTest(path)) continue;
        const line = lineOf(content, COOKIE_FALSE_RE);
        if (line !== undefined) {
          findings.push({
            severity: sev, category: 'django_insecure_session_cookie', file: path, line,
            message: 'SESSION_COOKIE_SECURE = False — session cookies sent over plain HTTP, enabling session hijacking on unencrypted networks.',
            suggestion: 'Set SESSION_COOKIE_SECURE = not DEBUG so it is always True in production.',
          });
        }
      }
      return findings;
    },
  },

  // ── DJG_019: CORS_ALLOW_ALL_ORIGINS = True ───────────────────────────────
  {
    id: 'DJG_019',
    category: 'django_cors_allow_all',
    description: 'CORS_ALLOW_ALL_ORIGINS = True allows any website to make cross-origin requests with credentials.',
    severity: 'HIGH',
    tags: ['django', 'security', 'cors', 'api', 'settings'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'CORS_ALLOW_ALL_ORIGINS = True in django-cors-headers bypasses same-origin policy entirely. Combined with CORS_ALLOW_CREDENTIALS = True, it lets any website on the internet make authenticated API requests on behalf of logged-in users, effectively nullifying CSRF protection.',
      commonViolations: [
        'CORS_ALLOW_ALL_ORIGINS = True  # AI sets this "to make CORS work"',
        'CORS_ORIGIN_ALLOW_ALL = True  # older django-cors-headers key',
      ],
      goodExample: 'CORS_ALLOWED_ORIGINS = [\n    "https://app.example.com",\n    "https://admin.example.com",\n]',
      badExample: 'CORS_ALLOW_ALL_ORIGINS = True  # ❌ any website can make credentialed requests',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_cors_allow_all', config.severityRules);
      const findings: Finding[] = [];
      const CORS_RE = /(?:CORS_ALLOW_ALL_ORIGINS|CORS_ORIGIN_ALLOW_ALL)\s*=\s*True\b/;
      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const line = lineOf(content, CORS_RE);
        if (line !== undefined) {
          findings.push({
            severity: sev, category: 'django_cors_allow_all', file: path, line,
            message: 'CORS_ALLOW_ALL_ORIGINS = True — any website can make cross-origin requests to your API.',
            suggestion: 'Set CORS_ALLOWED_ORIGINS to an explicit list of allowed frontend domains.',
          });
        }
      }
      return findings;
    },
  },

  // ── DJG_020: request.user.is_authenticated not checked before user data ───
  {
    id: 'DJG_020',
    category: 'django_unauthenticated_user_access',
    description: 'request.user attributes accessed without first checking request.user.is_authenticated.',
    severity: 'MEDIUM',
    tags: ['django', 'security', 'auth', 'python', 'vibe-coding'],
    sinceVersion: '1.2.0',
    explain: {
      why: 'Django\'s request.user for anonymous users is an AnonymousUser object. Many attributes like .email, .pk, and .profile raise AttributeError or return empty values, causing 500 errors. AI-generated views frequently access request.user.email or request.user.profile without verifying the user is logged in.',
      commonViolations: [
        'email = request.user.email  # AnonymousUser has no email',
        'profile = request.user.profile  # raises RelatedObjectDoesNotExist',
      ],
      goodExample: 'if not request.user.is_authenticated:\n    return redirect("login")\nemail = request.user.email  # safe — user is logged in',
      badExample: 'def my_view(request):\n    email = request.user.email  # ❌ 500 for anonymous users',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('django_unauthenticated_user_access', config.severityRules);
      const findings: Finding[] = [];
      const USER_ATTR_RE = /request\.user\.(?:email|pk|id|profile|username|first_name|last_name|groups)\b/;
      const AUTH_GUARD_RE = /request\.user\.is_authenticated|@login_required|LoginRequiredMixin|request\.user\.is_anonymous/;
      const WINDOW = 20;

      for (const { path, content } of changedFiles) {
        if (!isDjango(path) || isTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!USER_ATTR_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(Math.max(0, i - WINDOW), i + 1).join('\n');
          if (!AUTH_GUARD_RE.test(ctx)) {
            findings.push({
              severity: sev, category: 'django_unauthenticated_user_access', file: path, line: i + 1,
              message: 'request.user attribute accessed without authentication check — AnonymousUser raises errors on most attributes.',
              suggestion: 'Check request.user.is_authenticated first, or add @login_required to the view.',
            });
          }
        }
      }
      return findings;
    },
  },

];
