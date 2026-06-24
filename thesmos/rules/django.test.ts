// @vitest-environment node
/**
 * Unit tests for Django security rules (DJG_001–020).
 *
 * Each test exercises ONE rule by passing crafted changedFiles.
 * "detect" pattern tests verify the rule fires on bad code.
 * "safe" tests verify no false positives on correct code.
 */
import { describe, it, expect } from 'vitest';
import { DJANGO_RULES } from './django';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
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

function rule(id: string) {
  const r = DJANGO_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(ruleId).detect(input);
}

// ── DJG_001: DEBUG = True ────────────────────────────────────────────────────

describe('DJG_001 — debug true in settings', () => {
  it('fires when DEBUG = True in settings.py', () => {
    const findings = detect('DJG_001', [
      { path: 'myapp/settings.py', content: 'DEBUG = True\nALLOWED_HOSTS = []' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_debug_true');
    expect(findings[0]!.line).toBe(1);
  });

  it('does not fire on DEBUG = False', () => {
    const findings = detect('DJG_001', [
      { path: 'myapp/settings.py', content: 'DEBUG = False' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on DEBUG from env', () => {
    const findings = detect('DJG_001', [
      { path: 'myapp/settings.py', content: 'DEBUG = os.environ.get("DEBUG", "False") == "True"' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Python files', () => {
    const findings = detect('DJG_001', [
      { path: 'README.md', content: 'DEBUG = True' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_002: ALLOWED_HOSTS wildcard ─────────────────────────────────────────

describe('DJG_002 — ALLOWED_HOSTS wildcard', () => {
  it('fires on ALLOWED_HOSTS = ["*"]', () => {
    const findings = detect('DJG_002', [
      { path: 'settings.py', content: 'ALLOWED_HOSTS = ["*"]' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_allowed_hosts_wildcard');
  });

  it('fires on single-quoted wildcard', () => {
    const findings = detect('DJG_002', [
      { path: 'settings.py', content: "ALLOWED_HOSTS = ['*']" },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on specific domains', () => {
    const findings = detect('DJG_002', [
      { path: 'settings.py', content: 'ALLOWED_HOSTS = ["example.com", "www.example.com"]' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_003: Raw SQL injection ───────────────────────────────────────────────

describe('DJG_003 — raw SQL injection', () => {
  it('fires on .raw() with f-string', () => {
    const findings = detect('DJG_003', [
      { path: 'views.py', content: 'result = Model.objects.raw(f"SELECT * FROM app_model WHERE name = \'{name}\'")\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_raw_sql_injection');
  });

  it('fires on cursor.execute() with % formatting', () => {
    const findings = detect('DJG_003', [
      { path: 'views.py', content: 'cursor.execute("DELETE FROM users WHERE id = %s" % user_id)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on cursor.execute() with f-string', () => {
    const findings = detect('DJG_003', [
      { path: 'views.py', content: 'cursor.execute(f"SELECT * FROM orders WHERE id = {order_id}")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on parameterized .raw()', () => {
    const findings = detect('DJG_003', [
      { path: 'views.py', content: 'result = Model.objects.raw("SELECT * FROM app_model WHERE name = %s", [name])\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on parameterized cursor.execute()', () => {
    const findings = detect('DJG_003', [
      { path: 'views.py', content: 'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_004: @csrf_exempt ────────────────────────────────────────────────────

describe('DJG_004 — @csrf_exempt', () => {
  it('fires on @csrf_exempt decorator', () => {
    const findings = detect('DJG_004', [
      { path: 'views.py', content: '@csrf_exempt\ndef my_view(request):\n    pass\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_csrf_exempt');
    expect(findings[0]!.line).toBe(1);
  });

  it('does not fire when @csrf_exempt is in a comment', () => {
    const findings = detect('DJG_004', [
      { path: 'views.py', content: '# @csrf_exempt\ndef my_view(request):\n    pass\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_005: Missing @login_required ─────────────────────────────────────────

describe('DJG_005 — missing @login_required', () => {
  it('fires when view handles POST without auth decorator', () => {
    const findings = detect('DJG_005', [
      {
        path: 'views.py',
        content: [
          'def delete_item(request, pk):',
          '    if request.method == "DELETE":',
          '        Item.objects.get(pk=pk).delete()',
          '    return JsonResponse({})',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_missing_login_required');
  });

  it('does not fire when @login_required is present', () => {
    const findings = detect('DJG_005', [
      {
        path: 'views.py',
        content: [
          '@login_required',
          'def delete_item(request, pk):',
          '    if request.method == "DELETE":',
          '        Item.objects.get(pk=pk).delete()',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on GET-only views', () => {
    const findings = detect('DJG_005', [
      {
        path: 'views.py',
        content: 'def list_items(request):\n    return JsonResponse({"items": []})\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_006: Hardcoded SECRET_KEY ────────────────────────────────────────────

describe('DJG_006 — hardcoded SECRET_KEY', () => {
  it('fires on hardcoded SECRET_KEY', () => {
    const findings = detect('DJG_006', [
      { path: 'settings.py', content: 'SECRET_KEY = "django-insecure-abc123xyz"\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_hardcoded_secret_key');
  });

  it('does not fire when loaded from env', () => {
    const findings = detect('DJG_006', [
      { path: 'settings.py', content: 'SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when loaded with env()', () => {
    const findings = detect('DJG_006', [
      { path: 'settings.py', content: 'SECRET_KEY = env("SECRET_KEY")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_007: No SSL redirect ─────────────────────────────────────────────────

describe('DJG_007 — missing SECURE_SSL_REDIRECT', () => {
  it('fires when settings has INSTALLED_APPS but no SECURE_SSL_REDIRECT', () => {
    const findings = detect('DJG_007', [
      {
        path: 'settings/production.py',
        content: 'INSTALLED_APPS = ["django.contrib.auth"]\nDEBUG = False\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_no_ssl_redirect');
  });

  it('does not fire when SECURE_SSL_REDIRECT is set', () => {
    const findings = detect('DJG_007', [
      {
        path: 'settings/production.py',
        content: 'INSTALLED_APPS = ["django.contrib.auth"]\nSECURE_SSL_REDIRECT = True\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_008: Serializer __all__ fields ───────────────────────────────────────

describe('DJG_008 — serializer fields = "__all__"', () => {
  it('fires on fields = "__all__"', () => {
    const findings = detect('DJG_008', [
      { path: 'serializers.py', content: 'class UserSerializer(ModelSerializer):\n    class Meta:\n        model = User\n        fields = "__all__"\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_serializer_all_fields');
  });

  it('does not fire on explicit field list', () => {
    const findings = detect('DJG_008', [
      { path: 'serializers.py', content: 'fields = ["id", "email", "name"]\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_009: Template |safe filter ───────────────────────────────────────────

describe('DJG_009 — template safe filter', () => {
  it('fires on {{ value|safe }} in template', () => {
    const findings = detect('DJG_009', [
      { path: 'templates/profile.html', content: '<p>{{ user.bio|safe }}</p>\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_template_safe_filter');
  });

  it('does not fire on {{ value }} without safe', () => {
    const findings = detect('DJG_009', [
      { path: 'templates/profile.html', content: '<p>{{ user.bio }}</p>\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-template files', () => {
    const findings = detect('DJG_009', [
      { path: 'views.py', content: '# {{ user.bio|safe }}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_010: mark_safe() with dynamic content ─────────────────────────────────

describe('DJG_010 — mark_safe with f-string', () => {
  it('fires on mark_safe(f"...")', () => {
    const findings = detect('DJG_010', [
      { path: 'widgets.py', content: 'return mark_safe(f"<b>{user.name}</b>")\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_mark_safe_dynamic');
  });

  it('does not fire on mark_safe with a plain string literal', () => {
    const findings = detect('DJG_010', [
      { path: 'widgets.py', content: 'return mark_safe("<br>")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_011: .objects.get() without try/except ───────────────────────────────

describe('DJG_011 — .objects.get() without error handling', () => {
  it('fires when .objects.get() has no surrounding try/except', () => {
    const findings = detect('DJG_011', [
      { path: 'views.py', content: 'def detail(request, pk):\n    user = User.objects.get(pk=pk)\n    return render(request, "detail.html", {"user": user})\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_get_or_500');
  });

  it('does not fire when get_object_or_404 is used', () => {
    const findings = detect('DJG_011', [
      { path: 'views.py', content: 'user = get_object_or_404(User, pk=pk)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when try/except wraps the call', () => {
    const findings = detect('DJG_011', [
      { path: 'views.py', content: 'try:\n    user = User.objects.get(pk=pk)\nexcept User.DoesNotExist:\n    return HttpResponse(status=404)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_012: Open redirect ───────────────────────────────────────────────────

describe('DJG_012 — open redirect', () => {
  it('fires on redirect() with request.GET value', () => {
    const findings = detect('DJG_012', [
      { path: 'views.py', content: 'return redirect(request.GET.get("next", "/"))\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_open_redirect');
  });

  it('fires on redirect() with request.POST value', () => {
    const findings = detect('DJG_012', [
      { path: 'views.py', content: 'return redirect(request.POST["redirect_url"])\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on redirect to a hardcoded path', () => {
    const findings = detect('DJG_012', [
      { path: 'views.py', content: 'return redirect("/dashboard/")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_013: Unsafe file upload ──────────────────────────────────────────────

describe('DJG_013 — unsafe file upload', () => {
  it('fires when request.FILES used without extension check', () => {
    const findings = detect('DJG_013', [
      { path: 'views.py', content: 'uploaded = request.FILES["file"]\ndefault_storage.save(uploaded.name, uploaded)\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_unsafe_file_upload');
  });

  it('does not fire when extension is validated', () => {
    const findings = detect('DJG_013', [
      { path: 'views.py', content: 'uploaded = request.FILES["file"]\next = os.path.splitext(uploaded.name)[1].lower()\nif ext not in ALLOWED_EXTENSIONS:\n    raise ValidationError("File type not allowed")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_014: pickle.loads ────────────────────────────────────────────────────

describe('DJG_014 — pickle deserialization', () => {
  it('fires on pickle.loads()', () => {
    const findings = detect('DJG_014', [
      { path: 'views.py', content: 'data = pickle.loads(request.body)\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_pickle_deserialization');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on pickle.load()', () => {
    const findings = detect('DJG_014', [
      { path: 'utils.py', content: 'obj = pickle.load(cache_file)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when commented out', () => {
    const findings = detect('DJG_014', [
      { path: 'views.py', content: '# data = pickle.loads(request.body)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_015: Missing HSTS ────────────────────────────────────────────────────

describe('DJG_015 — missing SECURE_HSTS_SECONDS', () => {
  it('fires when SSL redirect is on but HSTS is missing', () => {
    const findings = detect('DJG_015', [
      { path: 'settings/production.py', content: 'SECURE_SSL_REDIRECT = True\nDEBUG = False\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_no_hsts');
  });

  it('does not fire when SECURE_HSTS_SECONDS is set', () => {
    const findings = detect('DJG_015', [
      { path: 'settings/production.py', content: 'SECURE_SSL_REDIRECT = True\nSECURE_HSTS_SECONDS = 31536000\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when SSL redirect is off', () => {
    const findings = detect('DJG_015', [
      { path: 'settings/production.py', content: 'DEBUG = False\nSECURE_SSL_REDIRECT = False\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_016: Shell injection ─────────────────────────────────────────────────

describe('DJG_016 — subprocess shell injection', () => {
  it('fires on subprocess.run with f-string', () => {
    const findings = detect('DJG_016', [
      { path: 'utils.py', content: 'subprocess.run(f"convert {filename} output.png", shell=True)\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_shell_injection');
  });

  it('fires on os.system with f-string', () => {
    const findings = detect('DJG_016', [
      { path: 'utils.py', content: 'os.system(f"ffmpeg -i {input_file} {output_file}")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on subprocess with list args', () => {
    const findings = detect('DJG_016', [
      { path: 'utils.py', content: 'subprocess.run(["convert", filename, "output.png"])\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_017: Hardcoded DB password ───────────────────────────────────────────

describe('DJG_017 — hardcoded DB password', () => {
  it('fires on hardcoded PASSWORD in DATABASES', () => {
    const findings = detect('DJG_017', [
      { path: 'settings/production.py', content: 'DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "PASSWORD": "supersecret"}}\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_hardcoded_db_password');
  });

  it('does not fire when PASSWORD loaded from env', () => {
    const findings = detect('DJG_017', [
      { path: 'settings/production.py', content: '"PASSWORD": os.environ.get("DB_PASSWORD", "")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_018: Insecure session cookie ─────────────────────────────────────────

describe('DJG_018 — SESSION_COOKIE_SECURE = False', () => {
  it('fires on SESSION_COOKIE_SECURE = False in settings', () => {
    const findings = detect('DJG_018', [
      { path: 'settings/production.py', content: 'SESSION_COOKIE_SECURE = False\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_insecure_session_cookie');
  });

  it('does not fire on SESSION_COOKIE_SECURE = True', () => {
    const findings = detect('DJG_018', [
      { path: 'settings/production.py', content: 'SESSION_COOKIE_SECURE = True\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_019: CORS allow all origins ──────────────────────────────────────────

describe('DJG_019 — CORS_ALLOW_ALL_ORIGINS', () => {
  it('fires on CORS_ALLOW_ALL_ORIGINS = True', () => {
    const findings = detect('DJG_019', [
      { path: 'settings.py', content: 'CORS_ALLOW_ALL_ORIGINS = True\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_cors_allow_all');
  });

  it('fires on legacy CORS_ORIGIN_ALLOW_ALL = True', () => {
    const findings = detect('DJG_019', [
      { path: 'settings.py', content: 'CORS_ORIGIN_ALLOW_ALL = True\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on explicit CORS_ALLOWED_ORIGINS list', () => {
    const findings = detect('DJG_019', [
      { path: 'settings.py', content: 'CORS_ALLOWED_ORIGINS = ["https://app.example.com"]\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DJG_020: Unauthenticated user attribute access ───────────────────────────

describe('DJG_020 — unauthenticated user attribute access', () => {
  it('fires when request.user.email accessed without auth check', () => {
    const findings = detect('DJG_020', [
      { path: 'views.py', content: 'def my_view(request):\n    email = request.user.email\n    return JsonResponse({"email": email})\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('django_unauthenticated_user_access');
  });

  it('does not fire when is_authenticated is checked', () => {
    const findings = detect('DJG_020', [
      { path: 'views.py', content: 'def my_view(request):\n    if not request.user.is_authenticated:\n        return redirect("login")\n    email = request.user.email\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when @login_required is present', () => {
    const findings = detect('DJG_020', [
      { path: 'views.py', content: '@login_required\ndef my_view(request):\n    email = request.user.email\n    return JsonResponse({"email": email})\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── Structural validation ─────────────────────────────────────────────────────

describe('DJANGO_RULES structural checks', () => {
  it('has exactly 20 rules', () => {
    expect(DJANGO_RULES).toHaveLength(20);
  });

  it('every rule has a unique ID', () => {
    const ids = DJANGO_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule has an explain block', () => {
    for (const r of DJANGO_RULES) {
      expect(r.explain, `[${r.id}] missing explain`).toBeDefined();
      expect(r.explain!.why.length, `[${r.id}] explain.why empty`).toBeGreaterThan(0);
      expect(Array.isArray(r.explain!.commonViolations), `[${r.id}] commonViolations not array`).toBe(true);
      expect(r.explain!.goodExample.length, `[${r.id}] goodExample empty`).toBeGreaterThan(0);
      expect(r.explain!.badExample.length, `[${r.id}] badExample empty`).toBeGreaterThan(0);
    }
  });

  it('every rule detect() returns an array', () => {
    const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    for (const r of DJANGO_RULES) {
      expect(Array.isArray(r.detect(input)), `[${r.id}] detect() did not return array`).toBe(true);
    }
  });
});
