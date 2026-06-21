/**
 * WebSocket Security Rules — WS_001–012
 *
 * Every AI coding agent study confirms the same finding: AI assistants build
 * REST authentication but systematically skip the WebSocket upgrade handler.
 * These rules catch the gaps that every AI-generated WebSocket implementation
 * contains.
 */

import type { PrometheusRule, DetectInput, Finding } from '../types.js';
import { SOURCE_EXT, isTestPath, isCommentLine } from './helpers.js';

export const WEBSOCKET_RULES: PrometheusRule[] = [
  {
    id: 'WS_001',
    category: 'ws_no_upgrade_auth',
    severity: 'BLOCKER',
    description: 'WebSocket upgrade handler has no authentication check — any client can open a connection.',
    tags: ['websocket', 'security', 'auth', 'ai-risk', 'vibe-coding'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'AI coding assistants implement HTTP auth correctly but universally miss the WebSocket upgrade request. The upgrade is a standard HTTP request with an `Upgrade: websocket` header — it must be authenticated before the protocol switch. Without auth on the upgrade, any unauthenticated client can open a persistent connection.',
      commonViolations: [
        'wss.on("connection", (ws) => { // process messages }) — no auth on connection',
        'server.on("upgrade", (req, socket, head) => { wss.handleUpgrade(req, socket, head, (ws) => { ... }) })  // no token check on req',
      ],
      goodExample: 'server.on("upgrade", async (req, socket, head) => {\n  const token = new URL(req.url, "http://x").searchParams.get("token");\n  const session = await verifyToken(token);\n  if (!session) { socket.destroy(); return; }\n  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));\n});',
      badExample: 'wss.on("connection", (ws) => { handleMessages(ws); }); // ❌ no auth on upgrade',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const WS_SERVER_RE = /new\s+WebSocketServer\s*\(|new\s+Server\s*\(\s*\{[^}]*(?:noServer|wss)/i;
      const CONNECTION_RE = /(?:wss|ws|server)\s*\.\s*on\s*\(\s*['"]connection['"]/;
      const AUTH_RE = /verifyToken|getSession|authenticate|bearer|authorization|token\s*=\s*|jwt\.verify|session\s*\?/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!(WS_SERVER_RE.test(content) || CONNECTION_RE.test(content))) continue;
        if (CONNECTION_RE.test(content) && !AUTH_RE.test(content)) {
          findings.push({
            severity: 'BLOCKER', category: 'ws_no_upgrade_auth',
            file: path,
            message: 'WebSocket server accepts connections without authentication check.',
            suggestion: 'Verify a token or session on the upgrade request. Destroy the socket if auth fails.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_002',
    category: 'ws_message_no_auth',
    severity: 'BLOCKER',
    description: 'WebSocket message handler processes commands without per-message authorization check.',
    tags: ['websocket', 'security', 'auth', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Even when upgrade auth is present, WebSocket message handlers often process action-type messages (e.g., { action: "deleteItem", id: ... }) without checking if the connected user has permission to perform that action. This enables privilege escalation via WebSocket.',
      commonViolations: [
        'ws.on("message", (data) => { const msg = JSON.parse(data); if (msg.action === "delete") { db.delete(msg.id); } }) — no authz',
        'Message handler that executes mutations without checking ws.userId matches resource owner',
      ],
      goodExample: 'ws.on("message", async (data) => {\n  const msg = MessageSchema.parse(JSON.parse(data));\n  if (!canPerform(ws.session, msg.action, msg.resourceId)) {\n    ws.send(JSON.stringify({ error: "Forbidden" }));\n    return;\n  }\n  await handleAction(msg);\n});',
      badExample: 'ws.on("message", (data) => { const { action, id } = JSON.parse(data); await db.delete(id); }); // ❌ no authz',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const MSG_HANDLER_RE = /ws\s*\.\s*on\s*\(\s*['"]message['"]/;
      const MUTATION_RE = /db\.|prisma\.|supabase\.|delete|insert|update|remove|create/i;
      const AUTHZ_RE = /canPerform|hasPermission|isOwner|authorize|checkAccess|forbidden|403|ws\.session|ws\.userId|ws\.user/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!MSG_HANDLER_RE.test(content)) continue;
        if (MUTATION_RE.test(content) && !AUTHZ_RE.test(content)) {
          findings.push({
            severity: 'BLOCKER', category: 'ws_message_no_auth',
            file: path,
            message: 'WebSocket message handler performs mutations without visible authorization check.',
            suggestion: 'Check authorization for each message action: canPerform(ws.session, msg.action, msg.resourceId)',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_003',
    category: 'ws_no_origin_check',
    severity: 'HIGH',
    description: 'WebSocket server has no Origin header validation — cross-origin WebSocket hijacking risk.',
    tags: ['websocket', 'security', 'cors', 'csrf'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Browsers automatically send WebSocket upgrade requests from any page (including attacker-controlled sites) with the victim\'s cookies. Without Origin validation on the WebSocket server, an attacker can open a WebSocket connection from their site using the victim\'s session.',
      commonViolations: [
        'new WebSocketServer({ port: 8080 })  // accepts any origin',
        'server.on("upgrade") with no req.headers.origin check',
      ],
      goodExample: 'server.on("upgrade", (req, socket) => {\n  const origin = req.headers.origin;\n  if (!ALLOWED_ORIGINS.has(origin)) { socket.destroy(); return; }\n  ...\n});',
      badExample: 'new WebSocketServer({ port: 8080 }); // ❌ any origin accepted',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const WS_SERVER_RE = /new\s+WebSocketServer\s*\(|new\s+(?:wss|WSS)\s*\(|require\s*\(\s*['"]ws['"]\s*\)/i;
      const ORIGIN_RE = /origin|ALLOWED_ORIGINS|allowedOrigins|req\.headers\.origin/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!WS_SERVER_RE.test(content)) continue;
        if (!ORIGIN_RE.test(content)) {
          findings.push({
            severity: 'HIGH', category: 'ws_no_origin_check',
            file: path,
            message: 'WebSocket server created without Origin header validation.',
            suggestion: 'Check req.headers.origin against an allowlist on the upgrade request.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_004',
    category: 'ws_no_heartbeat_timeout',
    severity: 'HIGH',
    description: 'WebSocket connection has no heartbeat/ping or idle timeout — zombie connections exhaust server resources.',
    tags: ['websocket', 'security', 'reliability', 'dos'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'WebSocket connections without heartbeats accumulate as "zombie" connections when clients disconnect without closing cleanly. Each zombie holds server memory and file descriptors. An attacker can open thousands of connections and never close them, exhausting server resources.',
      commonViolations: [
        'WebSocket server that never pings clients',
        'No timeout to close connections that stop responding to pings',
      ],
      goodExample: 'const interval = setInterval(() => {\n  wss.clients.forEach((ws) => {\n    if (ws.isAlive === false) { ws.terminate(); return; }\n    ws.isAlive = false;\n    ws.ping();\n  });\n}, 30000);',
      badExample: 'wss.on("connection", (ws) => { handleMessages(ws); }); // ❌ no heartbeat',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const WS_SERVER_RE = /new\s+WebSocketServer\s*\(/i;
      const HEARTBEAT_RE = /\.ping\s*\(|heartbeat|isAlive|setInterval\s*\([^)]*ws|ping\s*\/\s*pong/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!WS_SERVER_RE.test(content)) continue;
        if (!HEARTBEAT_RE.test(content)) {
          findings.push({
            severity: 'HIGH', category: 'ws_no_heartbeat_timeout',
            file: path,
            message: 'WebSocket server without ping/heartbeat — zombie connections accumulate.',
            suggestion: 'Implement a heartbeat: ping clients on interval, terminate those that don\'t respond.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_005',
    category: 'ws_message_size_unbounded',
    severity: 'HIGH',
    description: 'WebSocket message handler accepts messages without payload size limit — memory exhaustion DoS.',
    tags: ['websocket', 'security', 'dos', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Without a maximum message size, an attacker can send a single enormous WebSocket message that exhausts server memory. Node.js will attempt to buffer the entire payload before calling the message handler.',
      commonViolations: [
        'new WebSocketServer({ port: 8080 })  // default maxPayload is 100MB',
        'ws.on("message", (data) => JSON.parse(data))  // no size check on data',
      ],
      goodExample: 'new WebSocketServer({ port: 8080, maxPayload: 64 * 1024 });  // 64KB limit',
      badExample: 'new WebSocketServer({ port: 8080 });  // ❌ default 100MB limit',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const WS_NO_PAYLOAD_RE = /new\s+WebSocketServer\s*\(\s*\{[^}]*\}\s*\)/i;
      const MAX_PAYLOAD_RE = /maxPayload/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!WS_NO_PAYLOAD_RE.test(content)) continue;
        if (!MAX_PAYLOAD_RE.test(content)) {
          findings.push({
            severity: 'HIGH', category: 'ws_message_size_unbounded',
            file: path,
            message: 'WebSocketServer created without maxPayload limit — memory DoS risk.',
            suggestion: 'Set maxPayload: new WebSocketServer({ maxPayload: 64 * 1024 }) — 64KB is a reasonable limit.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_006',
    category: 'ws_message_no_schema_validation',
    severity: 'HIGH',
    description: 'WebSocket message handler parses JSON without schema validation before processing.',
    tags: ['websocket', 'security', 'validation', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'AI-generated WebSocket handlers typically call JSON.parse() and immediately destructure the result. Without schema validation, an attacker can send unexpected shapes that cause type errors, bypass business logic, or exploit prototype pollution via {"__proto__": ...} payloads.',
      commonViolations: [
        'ws.on("message", (data) => { const { action, id } = JSON.parse(data); ... })',
        'const msg = JSON.parse(event.data); handleAction(msg.type, msg.payload)',
      ],
      goodExample: 'ws.on("message", (raw) => {\n  const msg = IncomingMessageSchema.safeParse(JSON.parse(raw.toString()));\n  if (!msg.success) { ws.send(JSON.stringify({ error: "Invalid message" })); return; }\n  handleAction(msg.data);\n});',
      badExample: 'ws.on("message", (data) => { const { action, id } = JSON.parse(data); db.run(action, id); }); // ❌ unvalidated',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const MSG_PARSE_RE = /ws\s*\.\s*on\s*\(\s*['"]message['"]\s*,[^)]+\)\s*\{[^}]*JSON\.parse/s;
      const VALIDATE_RE = /\.parse\s*\(|\.safeParse|schema\.|z\.|zod\.|validate\s*\(|Schema\.parse/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!MSG_PARSE_RE.test(content)) continue;
        if (!VALIDATE_RE.test(content)) {
          findings.push({
            severity: 'HIGH', category: 'ws_message_no_schema_validation',
            file: path,
            message: 'WebSocket message parsed without schema validation before processing.',
            suggestion: 'Validate with Zod: const msg = MessageSchema.safeParse(JSON.parse(raw)); if (!msg.success) return;',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_007',
    category: 'ws_token_in_url',
    severity: 'HIGH',
    description: 'Authentication token passed in WebSocket URL query string — logged by proxies and web servers.',
    tags: ['websocket', 'security', 'auth', 'tokens'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'WebSocket connections cannot send custom headers during the browser-initiated handshake. The workaround of putting auth tokens in the URL query string (wss://host/ws?token=xxx) exposes the token in server logs, proxy logs, and browser history. Use a short-lived ticket exchanged via a separate REST endpoint instead.',
      commonViolations: [
        'new WebSocket(`wss://api.example.com/ws?token=${authToken}`)',
        'const ws = new WebSocket(wsUrl + "?auth=" + jwt)',
      ],
      goodExample: '// Step 1: Exchange long-lived token for a short-lived ticket via REST\nconst { ticket } = await fetch("/api/ws-ticket", { method: "POST" }).then(r => r.json());\n// Step 2: Use ticket in URL (it expires in 30s)\nconst ws = new WebSocket(`wss://host/ws?ticket=${ticket}`);',
      badExample: 'new WebSocket(`wss://host/ws?token=${localStorage.getItem("jwt")}`); // ❌ logged',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const TOKEN_IN_URL_RE = /new\s+WebSocket\s*\(\s*[`'"]\s*wss?:\/\/[^`'"]*[?&](?:token|auth|jwt|authorization|key)\s*=/i;
      const TEMPLATE_TOKEN_RE = /new\s+WebSocket\s*\(\s*`[^`]*[?&](?:token|auth|jwt|authorization|key)\s*=\s*\$\{/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (TOKEN_IN_URL_RE.test(line) || TEMPLATE_TOKEN_RE.test(line)) {
            findings.push({
              severity: 'HIGH', category: 'ws_token_in_url',
              file: path, line: i + 1,
              message: 'Auth token in WebSocket URL — will appear in server/proxy logs.',
              suggestion: 'Exchange a short-lived ticket via REST, then use the ticket in the WS URL (ticket expires in 30s).',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_008',
    category: 'ws_broadcast_no_room_check',
    severity: 'HIGH',
    description: 'WebSocket broadcast sends sensitive data to all connected clients without room/tenant isolation.',
    tags: ['websocket', 'security', 'multi-tenant', 'data-leak'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'WebSocket broadcast APIs like `wss.clients.forEach(ws => ws.send(data))` send to every connected client. If those clients belong to different tenants or users, sensitive data leaks across tenant boundaries.',
      commonViolations: [
        'wss.clients.forEach((client) => client.send(JSON.stringify(update)))  // all tenants receive update',
        'io.emit("update", data)  // Socket.IO broadcast to all — no room filter',
      ],
      goodExample: 'wss.clients.forEach((client) => {\n  if (client.readyState === WebSocket.OPEN && client.orgId === session.orgId) {\n    client.send(JSON.stringify(update));\n  }\n});',
      badExample: 'wss.clients.forEach((client) => client.send(JSON.stringify(sensitiveData))); // ❌ all tenants',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const BROADCAST_RE = /wss\.clients\.forEach|io\.emit\s*\(\s*['"][^'"]+['"]\s*,/i;
      const ISOLATION_RE = /orgId|tenantId|userId|roomId|channel|\.readyState\s*===\s*WebSocket\.OPEN\s*&&\s*(?:client|ws)\.\w+/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!BROADCAST_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(i, Math.min(lines.length, i + 6)).join('\n');
          if (!ISOLATION_RE.test(ctx)) {
            findings.push({
              severity: 'HIGH', category: 'ws_broadcast_no_room_check',
              file: path, line: i + 1,
              message: 'WebSocket broadcast to all clients without tenant/room isolation.',
              suggestion: 'Filter by orgId or roomId before sending: client.orgId === session.orgId',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_009',
    category: 'ws_error_stack_exposed',
    severity: 'MEDIUM',
    description: 'WebSocket error handler sends stack trace or error details to the client.',
    tags: ['websocket', 'security', 'info-disclosure'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Sending error stack traces over WebSocket reveals internal implementation details (file paths, library versions, internal function names) that help attackers map the attack surface and exploit other vulnerabilities.',
      commonViolations: [
        'ws.send(JSON.stringify({ error: err.message, stack: err.stack }))',
        'ws.send(err.toString()) — includes stack in some environments',
      ],
      goodExample: 'ws.send(JSON.stringify({ error: "An error occurred" }));\nlogger.error("ws_error", { err, userId: ws.userId });',
      badExample: 'ws.send(JSON.stringify({ error: err.message, stack: err.stack })); // ❌ info disclosure',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const STACK_SEND_RE = /ws\.send\s*\([^)]*(?:err\.stack|err\.message|error\.stack|e\.stack)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (STACK_SEND_RE.test(lines[i]!)) {
            findings.push({
              severity: 'MEDIUM', category: 'ws_error_stack_exposed',
              file: path, line: i + 1,
              message: 'WebSocket sends error details (stack/message) to client — information disclosure.',
              suggestion: 'Send a generic error message to the client; log the full error server-side.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_010',
    category: 'ws_no_message_rate_limit',
    severity: 'MEDIUM',
    description: 'WebSocket message handler has no per-connection rate limiting — message flood DoS.',
    tags: ['websocket', 'security', 'dos', 'rate-limiting'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'A client can send thousands of messages per second over a persistent WebSocket connection. Without rate limiting per connection, a single malicious client can saturate the message handler, causing DoS for all other users.',
      commonViolations: [
        'ws.on("message", async (data) => { await handleMessage(data); }) — no throttle',
        'No message count or rate limiter attached to the WebSocket connection object',
      ],
      goodExample: 'const limiter = new RateLimiter({ maxPerSecond: 10 });\nws.on("message", async (data) => {\n  if (!limiter.tryAcquire()) { ws.send(\'{"error":"Rate limit exceeded"}\'); return; }\n  await handleMessage(data);\n});',
      badExample: 'ws.on("message", async (data) => { await db.query(JSON.parse(data).sql); }); // ❌ no throttle',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const MSG_HANDLER_RE = /ws\s*\.\s*on\s*\(\s*['"]message['"]/;
      const RATE_RE = /rateLimiter|rateLimit|throttle|debounce|maxPerSecond|tokensPerSecond|limiter\./i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!MSG_HANDLER_RE.test(content)) continue;
        if (!RATE_RE.test(content)) {
          findings.push({
            severity: 'MEDIUM', category: 'ws_no_message_rate_limit',
            file: path,
            message: 'WebSocket message handler without per-connection rate limiting.',
            suggestion: 'Add a token bucket or sliding window rate limiter per WebSocket connection.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_011',
    category: 'ws_no_max_connections',
    severity: 'MEDIUM',
    description: 'WebSocket server has no maximum concurrent connection limit per user — resource exhaustion.',
    tags: ['websocket', 'security', 'dos', 'resource-limits'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Without a per-user connection limit, a single authenticated user can open thousands of WebSocket connections, exhausting file descriptors and memory. Each connection holds server-side state (event listeners, buffers, etc.).',
      commonViolations: [
        'wss.on("connection", (ws) => { connectionCount++ }) — no per-user limit',
        'No check on how many connections a userId already has',
      ],
      goodExample: 'const userConnections = new Map<string, number>();\nwss.on("connection", (ws, req) => {\n  const userId = ws.session.userId;\n  const count = userConnections.get(userId) ?? 0;\n  if (count >= MAX_CONNECTIONS_PER_USER) { ws.close(1008, "Too many connections"); return; }\n  userConnections.set(userId, count + 1);\n});',
      badExample: 'wss.on("connection", (ws) => { handleConnection(ws); }); // ❌ no per-user limit',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const WS_SERVER_RE = /new\s+WebSocketServer\s*\(/i;
      const CONN_LIMIT_RE = /MAX_CONNECTIONS|maxConnections|connectionCount|userConnections\.(?:get|set)|connectionsPerUser/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!WS_SERVER_RE.test(content)) continue;
        if (!CONN_LIMIT_RE.test(content)) {
          findings.push({
            severity: 'MEDIUM', category: 'ws_no_max_connections',
            file: path,
            message: 'WebSocket server without per-user connection limit — resource exhaustion risk.',
            suggestion: 'Track connections per userId and close with code 1008 when MAX_CONNECTIONS_PER_USER is exceeded.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'WS_012',
    category: 'ws_reconnect_no_backoff',
    severity: 'MEDIUM',
    description: 'WebSocket client reconnect logic has no exponential backoff — thundering herd on server restart.',
    tags: ['websocket', 'reliability', 'dos'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'When a WebSocket server restarts, all clients that reconnect immediately and continuously create a thundering herd that can prevent the server from recovering. Exponential backoff with jitter is required to allow the server to stabilize.',
      commonViolations: [
        'ws.on("close", () => setTimeout(connect, 1000)) — fixed 1s retry',
        'ws.on("error", () => connect()) — immediate reconnect on error',
      ],
      goodExample: 'let retryDelay = 1000;\nws.on("close", () => {\n  setTimeout(connect, retryDelay + Math.random() * 1000);\n  retryDelay = Math.min(retryDelay * 2, 30000);  // cap at 30s\n});',
      badExample: 'ws.on("close", () => setTimeout(connect, 1000)); // ❌ fixed retry — thundering herd',
      relatedPlaybooks: ['websocket-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [] }: DetectInput): Finding[] {
      const findings: Finding[] = [];
      const RECONNECT_RE = /ws\s*\.\s*on\s*\(\s*['"]close['"]\s*,[^}]*setTimeout\s*\([^,]+,\s*\d+\s*\)/s;
      const BACKOFF_RE = /exponential|backoff|retryDelay\s*\*|Math\.min|jitter|Math\.random/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (RECONNECT_RE.test(content) && !BACKOFF_RE.test(content)) {
          findings.push({
            severity: 'MEDIUM', category: 'ws_reconnect_no_backoff',
            file: path,
            message: 'WebSocket reconnect uses fixed delay without exponential backoff — thundering herd on server restart.',
            suggestion: 'Use exponential backoff: retryDelay = Math.min(retryDelay * 2, 30000) + Math.random() * 1000',
          });
        }
      }
      return findings;
    },
  },
];
