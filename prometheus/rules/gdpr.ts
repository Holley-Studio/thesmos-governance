/**
 * GDPR Compliance Rules — GDPR_001–015
 *
 * Detects common GDPR violations in web application code using file content
 * pattern matching. All detection is static and synchronous — no network,
 * no async, fits detect() perfectly.
 *
 * These rules identify common patterns associated with GDPR compliance
 * requirements. They are not a substitute for a formal compliance audit or
 * legal advice from a qualified attorney.
 *
 * Coverage:
 *   - PII in logs, URLs, localStorage, error responses
 *   - Analytics and third-party scripts without consent
 *   - Missing data deletion endpoint
 *   - Unencrypted PII fields in database schemas
 *   - Missing privacy policy route
 *   - Session without expiry
 *   - Real PII in test fixtures
 *   - IP address storage without consent
 */

import type { PrometheusRule, DetectInput, Finding } from '../types.js';

// ── Patterns ──────────────────────────────────────────────────────────────────

const PII_FIELD_RE = /\b(?:email|phone|phoneNumber|mobile|firstName|lastName|fullName|dateOfBirth|birthDate|ssn|nationalId|address|postcode|zipCode|passportNumber|creditCard|cardNumber|ipAddress|userId|username|bankAccount|routingNumber|accountNumber|creditScore|socialSecurity|taxId|driversLicense|medicalRecord|healthInsurance|salary|compensation|is_admin|isAdmin|permissions|sessionId|session_token|accessToken|refreshToken)\b/i;

const CONSOLE_LOG_RE = /console\.(log|error|warn|info|debug)\s*\(/;
const URL_PARAMS_RE = /[?&](?:email|phone|user_id|userId|name|fullname|address)=/i;
const LOCAL_STORAGE_SET_RE = /localStorage\.setItem\s*\(\s*["'](?:[^"']*(?:email|phone|user|profile|pii|personal)[^"']*)?["']\s*,/i;
const SENTRY_LOG_RE = /(?:Sentry\.captureException|Sentry\.captureMessage|datadogLogs\.logger|LogRocket\.log|analytics\.track)\s*\([^)]*(?:user|email|phone|name)/i;
const SESSION_NO_EXPIRY_RE = /(?:maxAge|expires)\s*[:=]/;
const IP_STORE_RE = /(?:req\.ip|request\.ip|headers\[['"]x-forwarded-for['"]\])\s*(?:=|,\s*(?:ip|ipAddress)\s*[:=])/i;

// Analytics loaders
const ANALYTICS_SCRIPT_RE = /(?:gtag\s*\(|_gaq\.push|ga\s*\(|mixpanel\.init|analytics\.load|amplitude\.getInstance|segment\.load|posthog\.init)\s*\(/;
const CONSENT_CHECK_RE = /(?:hasConsent|cookieConsent|consentGiven|gdpr|consent\.get|acceptedCookies|userConsented|consentManager)/i;

// Cookie without banner
const COOKIE_SET_RE = /document\.cookie\s*=/;
const THIRD_PARTY_SCRIPT_RE = /<script[^>]+src=["'][^"']*(?:facebook\.com|twitter\.com|doubleclick\.net|googletagmanager\.com|hotjar\.com|fullstory\.com|clarity\.ms)[^"']*["']/i;

// Real-looking PII in tests
const REAL_EMAIL_RE = /["'][a-zA-Z0-9._%+\-]{2,}@[a-zA-Z0-9.\-]{2,}\.[a-zA-Z]{2,}["']/;
const REAL_PHONE_RE = /["']\+?[0-9]{1,3}[\s\-.]?\(?[0-9]{2,4}\)?[\s\-.]?[0-9]{3,4}[\s\-.]?[0-9]{3,4}["']/;

// Prisma/Drizzle/TypeORM PII field patterns
const PRISMA_PII_RE = /^\s+(?:email|phone|firstName|lastName|fullName|dateOfBirth|ssn|address)\s+String/m;

// Data deletion route patterns
const DELETE_ROUTE_RE = /(?:router\.|app\.)?delete\s*\(\s*["'][^"']*(?:\/user|\/account|\/me|\/profile)[^"']*["']/i;
const NEXT_DELETE_RE = /export\s+(?:async\s+)?function\s+DELETE\s*\(/;

// Privacy policy route
const PRIVACY_ROUTE_RE = /(?:href|to|path|route)\s*=\s*["'][^"']*\/privacy[^"']*["']|['"]\/privacy(?:-policy)?['"]/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function f(
  category: string,
  severity: Finding['severity'],
  message: string,
  suggestion: string,
  file: string,
  line?: number,
): Finding {
  return { severity, file, line, category, message, suggestion };
}

function isSourceFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(path) && !path.endsWith('.d.ts');
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$|__tests__|fixtures|__mocks__/.test(path);
}

function isPrismaSchema(path: string): boolean {
  return /schema\.prisma$/.test(path);
}

function isHtmlOrTemplate(path: string): boolean {
  return /\.(html|htm|njk|ejs|hbs|pug)$/.test(path);
}

function isApiRoute(path: string): boolean {
  return /(?:api|routes?|handlers?|controllers?)/.test(path) && isSourceFile(path);
}

function findLineNumber(content: string, searchStr: string): number | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(searchStr)) return i + 1;
  }
  return undefined;
}

// ── Rule: GDPR_001 — PII in console.log ──────────────────────────────────────

const GDPR_001: PrometheusRule = {
  id: 'GDPR_001',
  category: 'gdpr_pii_in_console_log',
  severity: 'HIGH',
  description: 'console.log appears to log PII (email/phone/name adjacent variables).',
  tags: ['gdpr', 'pii', 'logging'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Logging PII to the console means it ends up in server logs, browser devtools, and potentially monitoring systems that store logs. GDPR Article 5 requires data minimization in processing.',
    commonViolations: ['console.log(user) which includes email/phone', 'Debug logs with full user objects'],
    goodExample: 'console.log(`User ${user.id} logged in`)',
    badExample: 'console.log("User data:", user.email, user.phone)',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path))
      .flatMap((cf) => {
        const lines = cf.content.split('\n');
        return lines.flatMap((line, idx) => {
          if (!CONSOLE_LOG_RE.test(line)) return [];
          if (!PII_FIELD_RE.test(line)) return [];
          return [f('gdpr_pii_in_console_log', 'HIGH',
            `console.log may expose PII — found PII field reference adjacent.`,
            'Remove PII from logs or use a structured logger that redacts sensitive fields.',
            cf.path, idx + 1)];
        });
      });
  },
};

// ── Rule: GDPR_002 — Analytics without consent ───────────────────────────────

const GDPR_002: PrometheusRule = {
  id: 'GDPR_002',
  category: 'gdpr_analytics_no_consent',
  severity: 'HIGH',
  description: 'Analytics library initialized without a consent check — GDPR opt-in required.',
  tags: ['gdpr', 'analytics', 'consent'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'GDPR Article 6 requires a lawful basis for processing personal data. Analytics tracking without prior consent violates the opt-in requirement for non-essential cookies.',
    commonViolations: ['gtag or mixpanel.init called at module level without checking consent', 'Analytics SDK initialized in useEffect without consent state check'],
    goodExample: 'if (hasConsent("analytics")) { mixpanel.init(...) }',
    badExample: 'mixpanel.init(MIXPANEL_TOKEN)',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isSourceFile(cf.path))
      .flatMap((cf) => {
        const lines = cf.content.split('\n');
        return lines.flatMap((line, idx) => {
          if (!ANALYTICS_SCRIPT_RE.test(line)) return [];
          // Check surrounding context (±10 lines) for consent check
          const contextStart = Math.max(0, idx - 10);
          const contextEnd = Math.min(lines.length, idx + 10);
          const context = lines.slice(contextStart, contextEnd).join('\n');
          if (CONSENT_CHECK_RE.test(context)) return [];
          return [f('gdpr_analytics_no_consent', 'HIGH',
            'Analytics initialized without consent check.',
            'Wrap analytics initialization in a consent check: if (hasConsent("analytics")) { ... }',
            cf.path, idx + 1)];
        });
      });
  },
};

// ── Rule: GDPR_003 — Cookie set without consent ───────────────────────────────

const GDPR_003: PrometheusRule = {
  id: 'GDPR_003',
  category: 'gdpr_cookie_no_banner',
  severity: 'HIGH',
  description: 'document.cookie set without adjacent consent check.',
  tags: ['gdpr', 'cookie', 'consent'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Non-essential cookies require prior informed consent under GDPR. Setting cookies without checking consent state violates the ePrivacy Directive and GDPR.',
    commonViolations: ['document.cookie = ... called directly in component mount', 'Cookie set for analytics before consent banner shown'],
    goodExample: 'if (consentGiven) { document.cookie = "analytics=1;..." }',
    badExample: 'document.cookie = "tracking_id=abc123"',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isSourceFile(cf.path))
      .flatMap((cf) => {
        const lines = cf.content.split('\n');
        return lines.flatMap((line, idx) => {
          if (!COOKIE_SET_RE.test(line)) return [];
          const contextStart = Math.max(0, idx - 5);
          const contextEnd = Math.min(lines.length, idx + 5);
          const context = lines.slice(contextStart, contextEnd).join('\n');
          if (CONSENT_CHECK_RE.test(context)) return [];
          return [f('gdpr_cookie_no_banner', 'HIGH',
            'document.cookie set without consent check.',
            'Add consent gate: if (consentGiven) { document.cookie = ... }',
            cf.path, idx + 1)];
        });
      });
  },
};

// ── Rule: GDPR_004 — PII in URL params ───────────────────────────────────────

const GDPR_004: PrometheusRule = {
  id: 'GDPR_004',
  category: 'gdpr_pii_in_url_params',
  severity: 'HIGH',
  description: 'PII found in URL query parameters — violates data minimization and logs in server access logs.',
  tags: ['gdpr', 'pii', 'url'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'PII in URLs appears in server access logs, browser history, referrer headers, and CDN logs. This creates uncontrolled copies of personal data across many systems.',
    commonViolations: ['/reset?email=user@example.com', '/invite?phone=+1234567890'],
    goodExample: 'Use POST body or tokens: /reset?token=<secure-token>',
    badExample: '/invite?email=user@example.com&name=John',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isSourceFile(cf.path) || isHtmlOrTemplate(cf.path))
      .flatMap((cf) => {
        const matches = [...cf.content.matchAll(new RegExp(URL_PARAMS_RE, 'gi'))];
        if (matches.length === 0) return [];
        const line = findLineNumber(cf.content, matches[0]![0]);
        return [f('gdpr_pii_in_url_params', 'HIGH',
          'PII field name found in URL query parameter.',
          'Pass PII in request body (POST) or use opaque tokens instead of raw PII in URLs.',
          cf.path, line)];
      });
  },
};

// ── Rule: GDPR_005 — PII in localStorage ─────────────────────────────────────

const GDPR_005: PrometheusRule = {
  id: 'GDPR_005',
  category: 'gdpr_pii_in_localStorage',
  severity: 'HIGH',
  description: 'PII stored in localStorage without encryption — accessible to any JavaScript on the page.',
  tags: ['gdpr', 'pii', 'localStorage'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'localStorage is not encrypted and is accessible to any JavaScript running on the same origin, including third-party scripts. Storing PII there violates data security principles.',
    commonViolations: ['localStorage.setItem("user", JSON.stringify({email, phone}))', 'Caching full user profile in localStorage'],
    goodExample: 'Store only non-sensitive session tokens. Keep PII server-side.',
    badExample: 'localStorage.setItem("profile", JSON.stringify({ email: user.email }))',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isSourceFile(cf.path))
      .flatMap((cf) => {
        const lines = cf.content.split('\n');
        return lines.flatMap((line, idx) => {
          if (!LOCAL_STORAGE_SET_RE.test(line)) return [];
          // Check for PII field in nearby context
          const contextStart = Math.max(0, idx - 3);
          const contextEnd = Math.min(lines.length, idx + 3);
          const context = lines.slice(contextStart, contextEnd).join('\n');
          if (!PII_FIELD_RE.test(context)) return [];
          return [f('gdpr_pii_in_localStorage', 'HIGH',
            'PII may be stored in localStorage — accessible to all scripts on this origin.',
            'Store only session tokens in localStorage. Keep PII in encrypted server-side sessions.',
            cf.path, idx + 1)];
        });
      });
  },
};

// ── Rule: GDPR_006 — No data deletion endpoint ────────────────────────────────

const GDPR_006: PrometheusRule = {
  id: 'GDPR_006',
  category: 'gdpr_no_data_deletion_endpoint',
  severity: 'MEDIUM',
  description: 'No user/account DELETE route found — GDPR Article 17 "right to erasure" may not be implemented.',
  tags: ['gdpr', 'right-to-erasure', 'api'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'GDPR Article 17 grants users the right to have their personal data deleted. Applications that store user data must implement a deletion endpoint.',
    commonViolations: ['Application stores user data but provides no DELETE /user or DELETE /account route'],
    goodExample: 'DELETE /api/user/:id route that removes all PII and queues account deletion.',
    badExample: '(no DELETE route for user/account data)',
  },
  detect(input: DetectInput): Finding[] {
    if (!input.changedFiles) return [];
    const apiFiles = input.changedFiles.filter((cf) => isApiRoute(cf.path));
    if (apiFiles.length === 0) return [];

    const hasDeletion = apiFiles.some((cf) =>
      DELETE_ROUTE_RE.test(cf.content) || NEXT_DELETE_RE.test(cf.content),
    );

    if (hasDeletion) return [];

    // Only flag if we see user creation/storage routes to indicate this is a user-data app
    const hasUserData = apiFiles.some((cf) =>
      /(?:router\.|app\.)?(?:post|put)\s*\(\s*["'][^"']*(?:\/user|\/account|\/register|\/signup)/i.test(cf.content),
    );
    if (!hasUserData) return [];

    return [f('gdpr_no_data_deletion_endpoint', 'MEDIUM',
      'No DELETE endpoint found for user/account data — GDPR right to erasure may not be implemented.',
      'Add DELETE /api/user/:id or DELETE /api/account endpoint.',
      apiFiles[0]!.path)];
  },
};

// ── Rule: GDPR_007 — PII in external error logging ───────────────────────────

const GDPR_007: PrometheusRule = {
  id: 'GDPR_007',
  category: 'gdpr_pii_in_logs_external',
  severity: 'BLOCKER',
  description: 'PII sent to external logging service (Sentry/Datadog/LogRocket) — third-party data transfer.',
  tags: ['gdpr', 'pii', 'third-party', 'logging'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Sending PII to third-party services constitutes a cross-border data transfer requiring a Data Processing Agreement (DPA). Without a DPA and consent, this violates GDPR Article 44.',
    commonViolations: ['Sentry.captureException(error, {user: {email}}) without data scrubbing', 'LogRocket recording with no PII redaction'],
    goodExample: 'Configure beforeSend scrubbing: Sentry.init({ beforeSend(event) { delete event.user.email; return event; } })',
    badExample: 'Sentry.captureException(e, { extra: { user: { email, phone } } })',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isSourceFile(cf.path))
      .flatMap((cf) => {
        const lines = cf.content.split('\n');
        return lines.flatMap((line, idx) => {
          if (!SENTRY_LOG_RE.test(line)) return [];
          return [f('gdpr_pii_in_logs_external', 'BLOCKER',
            'PII may be sent to external logging service — ensure DPA and data scrubbing are in place.',
            'Configure PII scrubbing (beforeSend in Sentry, privacy settings in LogRocket/Datadog).',
            cf.path, idx + 1)];
        });
      });
  },
};

// ── Rule: GDPR_008 — Unencrypted PII in database schema ──────────────────────

const GDPR_008: PrometheusRule = {
  id: 'GDPR_008',
  category: 'gdpr_pii_unencrypted_db_column',
  severity: 'MEDIUM',
  description: 'Prisma/ORM schema has PII fields (email/phone) without encryption annotation.',
  tags: ['gdpr', 'pii', 'database', 'encryption'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'GDPR Article 32 requires appropriate security measures including encryption. Storing PII in plaintext database columns creates risk of exposure in data breaches.',
    commonViolations: ['email String in Prisma schema with no @encrypt annotation', 'phone String stored in plaintext'],
    goodExample: 'Use application-level encryption for PII fields or a Prisma encryption extension.',
    badExample: 'email    String  // stored plaintext',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isPrismaSchema(cf.path))
      .flatMap((cf) => {
        const matches = cf.content.match(PRISMA_PII_RE);
        if (!matches) return [];
        // Check if any encryption annotation exists anywhere in the schema
        if (/(?:@encrypt|@Encrypt|encryption|@db\.Bytea|Bytes\s*\/\*.*encrypted)/i.test(cf.content)) return [];
        const line = findLineNumber(cf.content, matches[0]!);
        return [f('gdpr_pii_unencrypted_db_column', 'MEDIUM',
          'PII field in database schema without encryption annotation.',
          'Use application-level encryption for PII fields (e.g., prisma-field-encryption extension).',
          cf.path, line)];
      });
  },
};

// ── Rule: GDPR_009 — No privacy policy route ─────────────────────────────────

const GDPR_009: PrometheusRule = {
  id: 'GDPR_009',
  category: 'gdpr_no_privacy_policy_link',
  severity: 'LOW',
  description: 'No /privacy route or link found in changed pages — GDPR requires accessible privacy policy.',
  tags: ['gdpr', 'privacy-policy'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'GDPR Article 13 requires clear and accessible privacy information. All web applications must link to a privacy policy that explains data collection and processing.',
    commonViolations: ['Registration pages without privacy policy link', 'Footer without /privacy link'],
    goodExample: '<a href="/privacy">Privacy Policy</a> in footer or registration form.',
    badExample: '(sign-up form with no link to privacy policy)',
  },
  detect(input: DetectInput): Finding[] {
    const uiFiles = (input.changedFiles ?? []).filter(
      (cf) => /(?:page|layout|app|index|home|register|signup)\.(tsx?|jsx?|html?)$/.test(cf.path),
    );
    if (uiFiles.length === 0) return [];

    const hasPrivacyLink = uiFiles.some((cf) => PRIVACY_ROUTE_RE.test(cf.content));
    if (hasPrivacyLink) return [];

    // Only flag if the page looks like it has a form
    const formsPresent = uiFiles.some((cf) => /<form|<input|onSubmit|handleSubmit/i.test(cf.content));
    if (!formsPresent) return [];

    return [f('gdpr_no_privacy_policy_link', 'LOW',
      'Form page has no link to privacy policy — GDPR requires privacy information access.',
      'Add a link to /privacy in your form or footer.',
      uiFiles[0]!.path)];
  },
};

// ── Rule: GDPR_010 — Third-party script without consent ──────────────────────

const GDPR_010: PrometheusRule = {
  id: 'GDPR_010',
  category: 'gdpr_third_party_no_consent',
  severity: 'HIGH',
  description: 'Third-party tracking script loaded without consent wrapper.',
  tags: ['gdpr', 'consent', 'third-party'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Third-party scripts from ad/tracking networks set cookies and collect user data. Loading them without consent violates GDPR opt-in requirements.',
    commonViolations: ['Facebook Pixel script in <head> without consent check', 'Google Tag Manager loaded unconditionally'],
    goodExample: 'Conditionally load: {hasConsent && <Script src="https://connect.facebook.net/..." />}',
    badExample: '<script src="https://connect.facebook.net/en_US/fbevents.js"></script>',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isSourceFile(cf.path) || isHtmlOrTemplate(cf.path))
      .flatMap((cf) => {
        const matches = [...cf.content.matchAll(new RegExp(THIRD_PARTY_SCRIPT_RE, 'gi'))];
        if (matches.length === 0) return [];
        const contextStart = Math.max(0, cf.content.indexOf(matches[0]![0]) - 200);
        const context = cf.content.slice(contextStart, cf.content.indexOf(matches[0]![0]) + 200);
        if (CONSENT_CHECK_RE.test(context)) return [];
        const line = findLineNumber(cf.content, matches[0]![0]);
        return [f('gdpr_third_party_no_consent', 'HIGH',
          'Third-party tracking script loaded without consent check.',
          'Wrap third-party scripts in a consent gate: {hasConsent && <Script src="..." />}',
          cf.path, line)];
      });
  },
};

// ── Rule: GDPR_011 — PII in error response ───────────────────────────────────

const GDPR_011: PrometheusRule = {
  id: 'GDPR_011',
  category: 'gdpr_pii_in_error_response',
  severity: 'BLOCKER',
  description: 'API error response may include user object fields — PII leak via error messages.',
  tags: ['gdpr', 'pii', 'api', 'error-handling'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Error responses that include user objects or PII fields can expose personal data to clients and may be logged by API gateways. GDPR requires PII to be protected even in error paths.',
    commonViolations: ['res.status(400).json({error, user})', 'Return error with full user context'],
    goodExample: 'res.status(400).json({ error: "Invalid request", code: "VALIDATION_ERROR" })',
    badExample: 'res.status(400).json({ error: err.message, user: req.user })',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isApiRoute(cf.path))
      .flatMap((cf) => {
        const lines = cf.content.split('\n');
        return lines.flatMap((line, idx) => {
          if (!/(?:res\.(?:status|json)|NextResponse\.json)\s*\(/.test(line)) return [];
          if (!PII_FIELD_RE.test(line)) return [];
          if (/\/\/|\/\*/.test(line.slice(0, line.search(/\S/)))) return []; // skip comments
          return [f('gdpr_pii_in_error_response', 'BLOCKER',
            'API response may include PII fields.',
            'Return only error codes and safe messages. Strip PII from response objects.',
            cf.path, idx + 1)];
        });
      });
  },
};

// ── Rule: GDPR_012 — No retention policy ─────────────────────────────────────

const GDPR_012: PrometheusRule = {
  id: 'GDPR_012',
  category: 'gdpr_no_retention_policy',
  severity: 'MEDIUM',
  description: 'No data retention policy declaration found in codebase.',
  tags: ['gdpr', 'data-retention'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'GDPR Article 5(1)(e) requires data to be kept "no longer than is necessary." Without a documented retention policy, you cannot demonstrate compliance with this principle.',
    commonViolations: ['Data stored indefinitely with no scheduled deletion or archival', 'No retention comment or config'],
    goodExample: '// GDPR retention: 90 days, purge via cronjob at purge-user-data.ts',
    badExample: '(user data stored with no deletion mechanism or retention documentation)',
  },
  detect(input: DetectInput): Finding[] {
    if (!input.changedFiles) return [];
    const hasPiiStorage = input.changedFiles.some((cf) =>
      isApiRoute(cf.path) && PII_FIELD_RE.test(cf.content) && /(?:insert|create|save|prisma\.\w+\.create)/i.test(cf.content),
    );
    if (!hasPiiStorage) return [];

    const hasRetentionDecl = input.changedFiles.some((cf) =>
      /(?:retention|purge|expire|ttl|deleteAfter|archiveAfter)/i.test(cf.content),
    );
    if (hasRetentionDecl) return [];

    return [f('gdpr_no_retention_policy', 'MEDIUM',
      'PII stored but no retention policy declared.',
      'Add a retention policy comment or config: how long is data kept, when is it purged?',
      'README.md')];
  },
};

// ── Rule: GDPR_013 — Session no expiry ───────────────────────────────────────

const GDPR_013: PrometheusRule = {
  id: 'GDPR_013',
  category: 'gdpr_session_no_expiry',
  severity: 'MEDIUM',
  description: 'Session cookie configured without maxAge or expires — session may persist indefinitely.',
  tags: ['gdpr', 'session', 'cookies'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'GDPR principle of data minimization (Article 5) applies to session duration. Sessions that never expire give attackers a permanent window if a session is stolen.',
    commonViolations: ['Session middleware configured with no maxAge', 'NextAuth session with no maxAge'],
    goodExample: 'session({ secret: SECRET, cookie: { maxAge: 86400 } })',
    badExample: 'session({ secret: SECRET, cookie: {} })',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isSourceFile(cf.path))
      .flatMap((cf) => {
        if (!/session\s*\(|NextAuth\s*\(|iron-session|cookie-session/i.test(cf.content)) return [];
        if (SESSION_NO_EXPIRY_RE.test(cf.content)) return [];
        const line = cf.content.split('\n').findIndex((l) => /session\s*\(|NextAuth\s*\(/.test(l));
        return [f('gdpr_session_no_expiry', 'MEDIUM',
          'Session configured without maxAge or expires — may persist indefinitely.',
          'Set cookie maxAge: session({ cookie: { maxAge: 86400 } }) — 24h is a common baseline.',
          cf.path, line >= 0 ? line + 1 : undefined)];
      });
  },
};

// ── Rule: GDPR_014 — Real PII in test fixtures ───────────────────────────────

const GDPR_014: PrometheusRule = {
  id: 'GDPR_014',
  category: 'gdpr_pii_in_test_fixtures',
  severity: 'HIGH',
  description: 'Test fixtures contain real-looking email or phone numbers — use synthetic data.',
  tags: ['gdpr', 'pii', 'testing'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Real PII in test fixtures violates GDPR even if the data is "fake-looking." If fixtures are copied from production data, or even if users recognize their data, this is a violation.',
    commonViolations: ['Production data snapshot used as test fixtures', 'Real-looking email addresses hard-coded in tests'],
    goodExample: 'Use @example.com, 555-0100 (reserved for fictional use), or faker.js.',
    badExample: '"email": "john.smith@gmail.com" in test fixture file',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isTestFile(cf.path) || /fixtures?|seeds?|mock/i.test(cf.path))
      .flatMap((cf) => {
        const hasRealEmail = REAL_EMAIL_RE.test(cf.content) &&
          !/@example\.com|@test\.com|@mock\.com|@fake\.com/.test(cf.content);
        const hasRealPhone = REAL_PHONE_RE.test(cf.content) &&
          !/555-?01\d{2}|555-?00/.test(cf.content); // reserved fictional numbers
        if (!hasRealEmail && !hasRealPhone) return [];
        const line = findLineNumber(cf.content, hasRealEmail ? '@' : '+');
        return [f('gdpr_pii_in_test_fixtures', 'HIGH',
          'Test fixture contains real-looking PII (email or phone).',
          'Replace with synthetic data: use @example.com emails and 555-0100 phone numbers.',
          cf.path, line)];
      });
  },
};

// ── Rule: GDPR_015 — IP stored without consent ───────────────────────────────

const GDPR_015: PrometheusRule = {
  id: 'GDPR_015',
  category: 'gdpr_ip_stored_without_consent',
  severity: 'MEDIUM',
  description: 'IP address stored to database — under GDPR, IP is considered personal data.',
  tags: ['gdpr', 'ip-address', 'pii'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'The CJEU ruled that IP addresses constitute personal data. Storing them requires a lawful basis (e.g., legitimate interest) and must be documented in your privacy policy.',
    commonViolations: ['Storing req.ip in a database column for "security purposes" without consent or DPA', 'Logging IP addresses to analytics without basis'],
    goodExample: 'Store hashed IP for rate limiting. Document in privacy policy if storing raw IPs.',
    badExample: 'await db.insert({ ipAddress: req.ip, userId }) without consent basis',
  },
  detect(input: DetectInput): Finding[] {
    return (input.changedFiles ?? [])
      .filter((cf) => isApiRoute(cf.path))
      .flatMap((cf) => {
        const lines = cf.content.split('\n');
        return lines.flatMap((line, idx) => {
          if (!IP_STORE_RE.test(line)) return [];
          if (/hash|anonymize|pseudo/i.test(line)) return [];
          return [f('gdpr_ip_stored_without_consent', 'MEDIUM',
            'IP address stored to database — document lawful basis under GDPR.',
            'Hash or anonymize IP before storage, or document the legitimate interest basis in your privacy policy.',
            cf.path, idx + 1)];
        });
      });
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const GDPR_RULES: PrometheusRule[] = [
  GDPR_001,
  GDPR_002,
  GDPR_003,
  GDPR_004,
  GDPR_005,
  GDPR_006,
  GDPR_007,
  GDPR_008,
  GDPR_009,
  GDPR_010,
  GDPR_011,
  GDPR_012,
  GDPR_013,
  GDPR_014,
  GDPR_015,
];
