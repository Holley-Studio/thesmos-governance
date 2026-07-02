// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * JWT & Auth Hardening Rules — JWT_001–009, AUTH_008–013
 *
 * AI coding assistants generate predictable authentication vulnerabilities:
 * hardcoded JWT fallback secrets, no algorithm pinning, localStorage refresh
 * tokens, client-side auth guards without server validation, and missing
 * OAuth state parameters.
 *
 * These rules close the auth gap that shows up in every vibe-coded app audit.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types.js';
import { SOURCE_EXT, isTestPath, isCommentLine } from './helpers.js';

export const JWT_AUTH_RULES: ThesmosRule[] = [
  {
    id: 'JWT_001',
    category: 'jwt_hardcoded_fallback_secret',
    severity: 'BLOCKER',
    description: 'JWT secret has a hardcoded fallback string — any key derived from the fallback is compromised.',
    tags: ['security', 'jwt', 'auth', 'ai-risk', 'vibe-coding'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'The pattern `process.env.JWT_SECRET || "secret"` means that if the environment variable is unset — as it often is in new deployments, CI, or misconfigured containers — all tokens are signed with "secret" (or whatever the fallback is). Any attacker who knows the fallback can forge tokens for any user.',
      commonViolations: [
        'const secret = process.env.JWT_SECRET || "secret"',
        'const key = process.env.NEXTAUTH_SECRET ?? "fallback-key-change-me"',
        'jwt.sign(payload, process.env.JWT_KEY || "dev-secret")',
      ],
      goodExample: 'const secret = process.env.JWT_SECRET;\nif (!secret) throw new Error("JWT_SECRET environment variable is required");\njwt.sign(payload, secret);',
      badExample: 'jwt.sign(payload, process.env.JWT_SECRET || "mysecret"); // ❌ forgeable fallback',
      relatedPlaybooks: ['jwt-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const FALLBACK_RE = /process\.env\.\w*(?:JWT|SECRET|KEY|AUTH)\w*\s*(?:\|\||\?\?)\s*['"`][^'"`]{1,40}['"`]/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (FALLBACK_RE.test(lines[i]!)) {
            findings.push({
              severity: 'BLOCKER', category: 'jwt_hardcoded_fallback_secret',
              file: path, line: i + 1,
              message: 'JWT/auth secret has a hardcoded fallback — tokens can be forged when env var is unset.',
              suggestion: 'Throw on missing secret: if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET required");',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'JWT_002',
    category: 'jwt_no_algorithm_pin',
    severity: 'BLOCKER',
    description: 'JWT verified without pinning the algorithm — allows alg:none and RS256→HS256 confusion attacks.',
    tags: ['security', 'jwt', 'auth'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Without specifying the expected algorithm in jwt.verify(), an attacker can set the JWT header to alg:"none" to bypass signature verification entirely, or swap RS256 to HS256 and sign with the public key. Always pin the algorithm in the verify() call.',
      commonViolations: [
        'jwt.verify(token, secret)  // no algorithms option',
        'jsonwebtoken.verify(token, publicKey)  // RS256/HS256 confusion possible',
      ],
      goodExample: 'jwt.verify(token, secret, { algorithms: ["HS256"] })',
      badExample: 'jwt.verify(token, secret);  // ❌ accepts any algorithm including "none"',
      relatedPlaybooks: ['jwt-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const VERIFY_NO_ALG_RE = /jwt\s*\.\s*verify\s*\(\s*\w+\s*,\s*\w+\s*\)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (VERIFY_NO_ALG_RE.test(lines[i]!)) {
            findings.push({
              severity: 'BLOCKER', category: 'jwt_no_algorithm_pin',
              file: path, line: i + 1,
              message: 'jwt.verify() without algorithms option — alg:none and algorithm confusion attacks possible.',
              suggestion: 'Pin the algorithm: jwt.verify(token, secret, { algorithms: ["HS256"] })',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'JWT_003',
    category: 'jwt_refresh_token_localstorage',
    severity: 'HIGH',
    description: 'Refresh token stored in localStorage — accessible to any JavaScript on the page (XSS theft).',
    tags: ['security', 'jwt', 'auth', 'xss', 'tokens'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'localStorage is accessible to any JavaScript on the same origin, including injected XSS scripts. Storing a long-lived refresh token in localStorage means a single XSS vulnerability leads to permanent account takeover. Refresh tokens must be stored in httpOnly cookies.',
      commonViolations: [
        'localStorage.setItem("refreshToken", data.refreshToken)',
        'localStorage.setItem("refresh_token", token)',
      ],
      goodExample: '// Server sets the refresh token as an httpOnly, Secure, SameSite=Strict cookie\nres.cookie("refresh_token", token, { httpOnly: true, secure: true, sameSite: "strict" });',
      badExample: 'localStorage.setItem("refreshToken", res.data.refreshToken); // ❌ XSS theft',
      relatedPlaybooks: ['jwt-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const REFRESH_LS_RE = /localStorage\s*\.\s*setItem\s*\(\s*['"`][^'"`]*(?:refresh|refreshToken|refresh_token)[^'"`]*['"`]/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (REFRESH_LS_RE.test(lines[i]!)) {
            findings.push({
              severity: 'HIGH', category: 'jwt_refresh_token_localstorage',
              file: path, line: i + 1,
              message: 'Refresh token stored in localStorage — XSS theft leads to permanent account takeover.',
              suggestion: 'Store refresh tokens in httpOnly, Secure, SameSite=Strict cookies instead.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'JWT_004',
    category: 'jwt_no_expiry',
    severity: 'HIGH',
    description: 'JWT signed without an expiry (expiresIn) — tokens are valid forever if compromised.',
    tags: ['security', 'jwt', 'auth', 'tokens'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'JWTs without an expiry claim cannot be invalidated after issuance. If a token is stolen (via XSS, log exposure, or network capture), an attacker has permanent access. All JWTs must include exp and should expire within a short window.',
      commonViolations: [
        'jwt.sign({ userId }, secret)  // no expiresIn',
        'sign({ sub: user.id, email: user.email }, secret)  // no expiry',
      ],
      goodExample: 'jwt.sign({ userId }, secret, { expiresIn: "15m", algorithm: "HS256" })',
      badExample: 'jwt.sign({ userId: user.id }, secret);  // ❌ no expiry — valid forever',
      relatedPlaybooks: ['jwt-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const SIGN_NO_EXP_RE = /jwt\s*\.\s*sign\s*\(\s*\{[^}]+\}\s*,\s*\w+\s*\)/i;
      const EXP_RE = /expiresIn|exp\s*:/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (!SIGN_NO_EXP_RE.test(lines[i]!)) continue;
          const ctx = lines[i]!;
          if (!EXP_RE.test(ctx)) {
            findings.push({
              severity: 'HIGH', category: 'jwt_no_expiry',
              file: path, line: i + 1,
              message: 'JWT signed without expiresIn — token is valid indefinitely if stolen.',
              suggestion: 'Add expiry: jwt.sign(payload, secret, { expiresIn: "15m" })',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'JWT_005',
    category: 'jwt_oauth_missing_state',
    severity: 'HIGH',
    description: 'OAuth callback handler does not validate the state parameter — CSRF on OAuth flow.',
    tags: ['security', 'jwt', 'oauth', 'csrf', 'auth'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'The OAuth state parameter is a CSRF token for the OAuth flow. Without validating it on the callback, an attacker can initiate an OAuth flow, get the authorization code, and trick the victim into using it — logging the victim into the attacker\'s account or vice versa.',
      commonViolations: [
        'GET /auth/callback that processes code but ignores state param',
        'OAuth callback that calls exchange(code) without comparing state to stored nonce',
      ],
      goodExample: 'const { code, state } = req.query;\nconst storedState = await session.getOAuthState();\nif (state !== storedState) throw new Error("OAuth state mismatch — possible CSRF");\nawait exchangeCode(code);',
      badExample: 'export async function GET(req) { const { code } = req.nextUrl.searchParams; await exchange(code); }  // ❌ no state',
      relatedPlaybooks: ['jwt-security.md', 'oauth-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const OAUTH_CALLBACK_RE = /(?:\/auth\/callback|\/oauth\/callback|\/api\/auth\/\w+\/callback)/i;
      const STATE_CHECK_RE = /state\s*[!=]==?\s*|verifyState|oauthState|checkState|storedState/i;
      const CODE_EXCHANGE_RE = /exchange(?:Code)?|getToken|getAccessToken/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!(OAUTH_CALLBACK_RE.test(path) || OAUTH_CALLBACK_RE.test(content))) continue;
        if (!CODE_EXCHANGE_RE.test(content)) continue;
        if (!STATE_CHECK_RE.test(content)) {
          findings.push({
            severity: 'HIGH', category: 'jwt_oauth_missing_state',
            file: path,
            message: 'OAuth callback exchanges code without validating state parameter — CSRF risk.',
            suggestion: 'Validate state against the value stored in session before exchanging the code.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'JWT_006',
    category: 'jwt_social_login_no_reauth',
    severity: 'HIGH',
    description: 'Social login account linking performed without re-authentication of the existing account.',
    tags: ['security', 'jwt', 'oauth', 'auth', 'account-linking'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'When linking a social provider to an existing account, the current session must be verified to belong to the account owner. Without re-authentication, an attacker can link their Google account to a victim\'s account if they can trigger the link flow with a valid session cookie.',
      commonViolations: [
        'Account linking endpoint that only checks a session cookie without requiring password re-entry',
        'POST /api/auth/link that associates a provider without re-confirming identity',
      ],
      goodExample: '// Require password confirmation or recent auth before linking\nconst lastAuth = session.lastAuthenticatedAt;\nif (Date.now() - lastAuth > REAUTH_WINDOW_MS) return requireReauthentication();',
      badExample: 'await linkProvider(session.userId, provider, providerAccountId);  // ❌ no reauth',
      relatedPlaybooks: ['jwt-security.md', 'oauth-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const LINK_RE = /linkProvider|linkAccount|connectProvider|link(?:Social|OAuth)|addProvider/i;
      const REAUTH_RE = /reauth|requireAuth|lastAuthenticated|confirmPassword|verifyPassword|step-up/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!LINK_RE.test(content)) continue;
        if (!REAUTH_RE.test(content)) {
          findings.push({
            severity: 'HIGH', category: 'jwt_social_login_no_reauth',
            file: path,
            message: 'Social provider linking without re-authentication step — account takeover risk.',
            suggestion: 'Require password confirmation or check lastAuthenticatedAt is recent before linking.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'JWT_007',
    category: 'jwt_sensitive_payload',
    severity: 'MEDIUM',
    description: 'JWT payload includes sensitive data (password, email, SSN, credit card) — tokens are base64 encoded, not encrypted.',
    tags: ['security', 'jwt', 'pii', 'tokens'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'JWTs are base64-encoded, not encrypted. Anyone who intercepts or decodes a JWT can read its payload. Including sensitive data (PII, passwords, financial data) in the payload exposes it in browser storage, logs, and network captures.',
      commonViolations: [
        'jwt.sign({ userId, email, password: hash, ssn }, secret)',
        'jwt.sign({ user: { id, email, creditCard } }, secret)',
      ],
      goodExample: 'jwt.sign({ sub: user.id }, secret, { expiresIn: "15m" });  // only the subject claim',
      badExample: 'jwt.sign({ userId, email, address, phone }, secret);  // ❌ PII in token',
      relatedPlaybooks: ['jwt-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const SIGN_PII_RE = /jwt\s*\.\s*sign\s*\(\s*\{[^}]*(?:email|phone|address|ssn|credit.?card|password|nationalId|dateOfBirth|birthDate)[^}]*\}\s*,/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (isCommentLine(lines[i]!)) continue;
          if (SIGN_PII_RE.test(lines[i]!)) {
            findings.push({
              severity: 'MEDIUM', category: 'jwt_sensitive_payload',
              file: path, line: i + 1,
              message: 'JWT payload contains sensitive/PII data — JWTs are base64, not encrypted.',
              suggestion: 'Store only the user ID (sub claim) in the JWT. Fetch sensitive data server-side per request.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_008',
    category: 'auth_client_only_guard',
    severity: 'BLOCKER',
    description: 'Authentication check exists only in a client component — bypassable with browser dev tools.',
    tags: ['security', 'auth', 'react', 'ai-risk', 'vibe-coding'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Client-side auth guards (useRouter().push("/login") if !session) only protect the UI — a determined user can disable JavaScript, modify the React component tree in DevTools, or call API endpoints directly. Authentication must always be enforced server-side.',
      commonViolations: [
        '"use client"; if (!session) { router.push("/login"); return null; }  // client-only guard',
        'React component that renders nothing if not authenticated — no server-side check',
      ],
      goodExample: '// app/dashboard/page.tsx (Server Component)\nexport default async function DashboardPage() {\n  const session = await getServerSession();\n  if (!session) redirect("/login");\n  return <Dashboard user={session.user} />;\n}',
      badExample: '"use client";\nexport default function Dashboard() {\n  const { session } = useSession();\n  if (!session) return null; // ❌ no server-side enforcement\n}',
      relatedPlaybooks: ['auth-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const USE_CLIENT_RE = /['"]use client['"]/;
      const CLIENT_AUTH_GATE_RE = /if\s*\(\s*!session\s*\)|router\.push\s*\(\s*['"`]\/login['"`]\s*\)\s*;?\s*return\s+null/i;
      const SERVER_AUTH_RE = /getServerSession|auth\(\)|verifySession|middleware|redirect\s*\(\s*['"`]\/login/i;
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx?|jsx?)$/.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!USE_CLIENT_RE.test(content)) continue;
        if (CLIENT_AUTH_GATE_RE.test(content) && !SERVER_AUTH_RE.test(content)) {
          findings.push({
            severity: 'BLOCKER', category: 'auth_client_only_guard',
            file: path,
            message: 'Auth guard in "use client" component with no server-side validation — bypassable.',
            suggestion: 'Move auth check to a Server Component or middleware. Client guards are cosmetic only.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_009',
    category: 'auth_idor_numeric_id',
    severity: 'HIGH',
    description: 'API route exposes sequential numeric ID without ownership verification — IDOR enumeration risk.',
    tags: ['security', 'auth', 'idor', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Sequential numeric IDs (1, 2, 3...) allow attackers to enumerate resources by incrementing the ID. Without checking that the authenticated user owns the requested resource, any user can access any other user\'s data by guessing sequential IDs.',
      commonViolations: [
        'GET /api/orders/[id] — returns order without checking session.userId === order.userId',
        'API that returns user profiles by incrementing /api/users/1, /api/users/2...',
      ],
      goodExample: 'const order = await db.order.findFirst({ where: { id: params.id, userId: session.user.id } });\nif (!order) return notFound();',
      badExample: 'const order = await db.order.findFirst({ where: { id: params.id } }); // ❌ any ID accessible',
      relatedPlaybooks: ['auth-security.md', 'idor.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const NUMERIC_ID_ROUTE_RE = /\[id\]|\[orderId\]|\[userId\]|\[itemId\]/;
      const FIND_NO_USER_RE = /(?:findFirst|findUnique|findMany)\s*\(\s*\{\s*where\s*:\s*\{\s*id\s*:/i;
      const USER_CHECK_RE = /userId\s*:|session\s*\.\s*user|user_id\s*:|ownerId\s*:|createdBy\s*:/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!NUMERIC_ID_ROUTE_RE.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!FIND_NO_USER_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
          if (!USER_CHECK_RE.test(ctx)) {
            findings.push({
              severity: 'HIGH', category: 'auth_idor_numeric_id',
              file: path, line: i + 1,
              message: 'DB query by ID without ownership check — IDOR enumeration risk.',
              suggestion: 'Add userId to the where clause: { where: { id, userId: session.user.id } }',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_010',
    category: 'auth_brute_force_unprotected',
    severity: 'HIGH',
    description: 'Login or password-reset endpoint has no rate limiting or brute-force protection.',
    tags: ['security', 'auth', 'brute-force', 'rate-limiting'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Login endpoints without rate limiting are vulnerable to credential stuffing, password spraying, and brute-force attacks. A typical 4-character PIN can be cracked in under a minute without rate limiting. Password reset endpoints are also targets for account takeover via OTP brute-force.',
      commonViolations: [
        'POST /api/auth/login with no rate limiter',
        'POST /api/auth/reset-password with no attempt counter',
      ],
      goodExample: 'await rateLimiter.check(req.ip, { max: 5, window: "15m" });\nconst user = await verifyCredentials(email, password);',
      badExample: 'export async function POST(req) { const { email, pass } = await req.json(); await login(email, pass); }  // ❌ no brute force protection',
      relatedPlaybooks: ['auth-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const LOGIN_ROUTE_RE = /\/(?:api\/)?auth\/(?:login|signin|sign-in|verify|reset|forgot)/i;
      const RATE_RE = /rateLimit|rateLimiter|throttle|attemptLimit|maxAttempts|upstash|redis.*limit/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!LOGIN_ROUTE_RE.test(path) && !LOGIN_ROUTE_RE.test(content)) continue;
        if (!RATE_RE.test(content)) {
          findings.push({
            severity: 'HIGH', category: 'auth_brute_force_unprotected',
            file: path,
            message: 'Auth endpoint (login/reset) without rate limiting — brute force and credential stuffing risk.',
            suggestion: 'Add rate limiting: max 5 attempts per IP per 15 minutes. Lock account after 10 failures.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_011',
    category: 'auth_password_reset_reuse',
    severity: 'HIGH',
    description: 'Password reset token not deleted after use — allows replay attacks for unlimited resets.',
    tags: ['security', 'auth', 'tokens', 'password-reset'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'If a password reset token is not deleted from the database after it is used, an attacker who observes the token (from email forward, browser history, or logs) can reset the password again after the legitimate user has already used it.',
      commonViolations: [
        'Reset handler that verifies token and updates password without deleting the token record',
        'Token stored with isUsed: true flag instead of being deleted — still queryable',
      ],
      goodExample: '// Verify, update password, then delete token atomically\nawait db.$transaction([\n  db.user.update({ where: { id }, data: { password: hash } }),\n  db.resetToken.delete({ where: { token } }),\n]);',
      badExample: 'await db.user.update({ where: { id }, data: { password: hash } });\n// token remains in DB — replay possible',
      relatedPlaybooks: ['auth-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const RESET_HANDLER_RE = /(?:\/reset|\/confirm|\/verify)[^/]*(?:password|email)/i;
      const PASSWORD_UPDATE_RE = /(?:update|set)\s*\([^)]*password/i;
      const TOKEN_DELETE_RE = /delete\s*\([^)]*token|deleteMany\s*\([^)]*token|token.*delete|remove.*token/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!RESET_HANDLER_RE.test(path) && !RESET_HANDLER_RE.test(content)) continue;
        if (!PASSWORD_UPDATE_RE.test(content)) continue;
        if (!TOKEN_DELETE_RE.test(content)) {
          findings.push({
            severity: 'HIGH', category: 'auth_password_reset_reuse',
            file: path,
            message: 'Password reset handler updates password but does not delete the reset token.',
            suggestion: 'Delete the token atomically with the password update in a transaction.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_012',
    category: 'auth_session_no_revalidation',
    severity: 'MEDIUM',
    description: 'Route handler uses getServerSession() result without re-validating it against the database.',
    tags: ['security', 'auth', 'session', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'getServerSession() decodes a JWT — it does not check if the user still exists, is still active, or has had their session revoked. A deactivated user or an attacker with a stolen token can still access protected routes if the session is not validated against the current DB state.',
      commonViolations: [
        'const session = await getServerSession(); const user = session.user;  // no DB lookup',
        'Using session.user.id to query data without confirming the user record still exists',
      ],
      goodExample: 'const session = await getServerSession();\nconst user = await db.user.findUnique({ where: { id: session?.user?.id } });\nif (!user || user.deletedAt) return unauthorized();',
      badExample: 'const session = await getServerSession();\nconst data = await db.items.findMany({ where: { userId: session.user.id } });  // no user revalidation',
      relatedPlaybooks: ['auth-security.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const SESSION_RE = /(?:const|let)\s+session\s*=\s*await\s+getServerSession\s*\(/;
      const REVALIDATE_RE = /db\.\w+\.findUnique\s*\(\s*\{[^}]*id\s*:\s*session|user\s*=\s*await\s+db\.|findUnique.*userId.*session/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!SESSION_RE.test(content)) continue;
        if (!REVALIDATE_RE.test(content)) {
          findings.push({
            severity: 'MEDIUM', category: 'auth_session_no_revalidation',
            file: path,
            message: 'getServerSession() used without validating user still exists in database.',
            suggestion: 'After getServerSession(), verify the user exists: db.user.findUnique({ where: { id: session.user.id } })',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_013',
    category: 'auth_uuid_not_used',
    severity: 'HIGH',
    description: 'Auto-increment integer ID used as public resource identifier — IDOR enumeration attack surface.',
    tags: ['security', 'auth', 'idor', 'database'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Auto-increment IDs (1, 2, 3...) reveal resource counts and enable enumeration attacks. An attacker can iterate through /api/documents/1, /api/documents/2, etc. to harvest all documents, even with authorization checks — because knowing the IDs provides information. Use UUIDs or cuid2 for public-facing IDs.',
      commonViolations: [
        'id: z.number().int() in public API params',
        'Prisma model with autoincrement() ID exposed in API response',
        'Route /api/users/[id] where id is an integer',
      ],
      goodExample: 'id  String  @id @default(cuid())  // or @default(uuid())',
      badExample: 'id  Int  @id @default(autoincrement())  // ❌ exposed sequential ID',
      relatedPlaybooks: ['auth-security.md', 'idor.md'],
      relatedAgents: ['security-reviewer', 'database-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const AUTOINCREMENT_RE = /\bid\s+Int\s+@id\s+@default\s*\(\s*autoincrement\s*\(\s*\)\s*\)/;
      const PUBLIC_ID_RE = /(?:params\.|searchParams\.|req\.params\.|req\.query\.)id\b|id\s*:\s*z\s*\.\s*(?:number|coerce\.number)\s*\(\s*\)/i;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if ((AUTOINCREMENT_RE.test(line) && path.endsWith('.prisma')) ||
              (PUBLIC_ID_RE.test(line) && SOURCE_EXT.test(path))) {
            findings.push({
              severity: 'HIGH', category: 'auth_uuid_not_used',
              file: path, line: i + 1,
              message: 'Auto-increment integer ID exposed as public resource identifier — IDOR enumeration.',
              suggestion: 'Use UUID or cuid2 for public IDs: @default(cuid()) or @default(uuid())',
            });
          }
        }
      }
      return findings;
    },
  },
];
