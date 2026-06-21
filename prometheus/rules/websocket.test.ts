// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { WEBSOCKET_RULES } from './websocket';
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

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const r = WEBSOCKET_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files });
}

// ── WS_001 — no upgrade auth ──────────────────────────────────────────────────

describe('WS_001 — WebSocket no upgrade auth', () => {
  it('fires on wss.on("connection") with no auth check', () => {
    const findings = detect('WS_001', [{
      path: 'src/ws-server.ts',
      content: `
        const wss = new WebSocketServer({ port: 8080 });
        wss.on("connection", (ws) => { handleMessages(ws); });
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('does NOT fire when token verification is present', () => {
    const findings = detect('WS_001', [{
      path: 'src/ws-server.ts',
      content: `
        const wss = new WebSocketServer({ port: 8080 });
        wss.on("connection", (ws, req) => {
          const token = new URL(req.url, 'http://x').searchParams.get('token');
          const session = verifyToken(token);
          if (!session) { ws.close(); return; }
          handleMessages(ws);
        });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on test files', () => {
    const findings = detect('WS_001', [{
      path: 'src/ws-server.test.ts',
      content: `const wss = new WebSocketServer({ port: 8080 }); wss.on("connection", (ws) => {})`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_002 — message no auth ──────────────────────────────────────────────────

describe('WS_002 — WebSocket message handler no authorization', () => {
  it('fires on message handler with db mutation and no authz', () => {
    const findings = detect('WS_002', [{
      path: 'src/ws-server.ts',
      content: `
        ws.on("message", async (data) => {
          const { action, id } = JSON.parse(data);
          await db.delete({ where: { id } });
        });
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on Prisma mutation with no canPerform check', () => {
    const findings = detect('WS_002', [{
      path: 'src/ws-handler.ts',
      content: `
        ws.on("message", async (data) => {
          const msg = JSON.parse(data.toString());
          await prisma.order.update({ where: { id: msg.id }, data: { status: msg.status } });
        });
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when canPerform is checked', () => {
    const findings = detect('WS_002', [{
      path: 'src/ws-server.ts',
      content: `
        ws.on("message", async (data) => {
          const msg = JSON.parse(data.toString());
          if (!canPerform(ws.session, msg.action, msg.id)) { ws.send('{"error":"Forbidden"}'); return; }
          await db.delete({ where: { id: msg.id } });
        });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_003 — no origin check ─────────────────────────────────────────────────

describe('WS_003 — WebSocket no origin check', () => {
  it('fires on new WebSocketServer with no origin validation', () => {
    const findings = detect('WS_003', [{
      path: 'src/ws-server.ts',
      content: `const wss = new WebSocketServer({ port: 8080 });`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when origin is checked', () => {
    const findings = detect('WS_003', [{
      path: 'src/ws-server.ts',
      content: `
        const wss = new WebSocketServer({ port: 8080 });
        server.on('upgrade', (req, socket) => {
          const origin = req.headers.origin;
          if (!ALLOWED_ORIGINS.has(origin)) { socket.destroy(); return; }
        });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_004 — no heartbeat timeout ────────────────────────────────────────────

describe('WS_004 — WebSocket no heartbeat', () => {
  it('fires on WebSocketServer with no ping/heartbeat', () => {
    const findings = detect('WS_004', [{
      path: 'src/ws-server.ts',
      content: `
        const wss = new WebSocketServer({ port: 8080 });
        wss.on("connection", (ws) => { handleMessages(ws); });
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when ping/heartbeat is implemented', () => {
    const findings = detect('WS_004', [{
      path: 'src/ws-server.ts',
      content: `
        const wss = new WebSocketServer({ port: 8080 });
        const interval = setInterval(() => {
          wss.clients.forEach((ws) => {
            if (ws.isAlive === false) { ws.terminate(); return; }
            ws.isAlive = false;
            ws.ping();
          });
        }, 30000);
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_005 — message size unbounded ──────────────────────────────────────────

describe('WS_005 — WebSocket message size unbounded', () => {
  it('fires on new WebSocketServer() options object without maxPayload', () => {
    const findings = detect('WS_005', [{
      path: 'src/ws-server.ts',
      content: `const wss = new WebSocketServer({ port: 8080 })`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when maxPayload is set', () => {
    const findings = detect('WS_005', [{
      path: 'src/ws-server.ts',
      content: `const wss = new WebSocketServer({ port: 8080, maxPayload: 64 * 1024 })`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_006 — message no schema validation ────────────────────────────────────

describe('WS_006 — WebSocket message no schema validation', () => {
  it('fires on ws.on("message") with JSON.parse and no schema validate', () => {
    const findings = detect('WS_006', [{
      path: 'src/ws-server.ts',
      content: `ws.on("message", (data) => { const msg = JSON.parse(data); db.run(msg.action); })`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when Zod safeParse is used', () => {
    const findings = detect('WS_006', [{
      path: 'src/ws-server.ts',
      content: `
        ws.on("message", (raw) => {
          const msg = MessageSchema.safeParse(JSON.parse(raw.toString()));
          if (!msg.success) { ws.send('{"error":"Invalid"}'); return; }
          handleAction(msg.data);
        });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when source file is a test', () => {
    const findings = detect('WS_006', [{
      path: 'src/ws-server.test.ts',
      content: `ws.on("message", (data) => { JSON.parse(data); })`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_007 — token in URL ─────────────────────────────────────────────────────

describe('WS_007 — auth token in WebSocket URL', () => {
  it('fires on new WebSocket with ?token= in URL', () => {
    const findings = detect('WS_007', [{
      path: 'src/client.ts',
      content: 'const ws = new WebSocket(`wss://api.example.com/ws?token=${authToken}`)',
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on ?auth= in URL', () => {
    const findings = detect('WS_007', [{
      path: 'src/client.ts',
      content: 'const ws = new WebSocket(`wss://host/ws?auth=${jwt}` )',
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on WebSocket with no auth query param', () => {
    const findings = detect('WS_007', [{
      path: 'src/client.ts',
      content: `const ws = new WebSocket('wss://host/ws?room=general')`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_008 — broadcast no room check ─────────────────────────────────────────

describe('WS_008 — WebSocket broadcast no tenant isolation', () => {
  it('fires on wss.clients.forEach broadcast without isolation', () => {
    const findings = detect('WS_008', [{
      path: 'src/ws-server.ts',
      content: `
        wss.clients.forEach((client) => {
          client.send(JSON.stringify(sensitiveUpdate));
        });
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when orgId isolation is applied', () => {
    const findings = detect('WS_008', [{
      path: 'src/ws-server.ts',
      content: `
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN && client.orgId === session.orgId) {
            client.send(JSON.stringify(update));
          }
        });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_009 — error stack exposed ─────────────────────────────────────────────

describe('WS_009 — WebSocket sends error stack to client', () => {
  it('fires on ws.send with err.stack', () => {
    const findings = detect('WS_009', [{
      path: 'src/ws-server.ts',
      content: `ws.send(JSON.stringify({ error: err.message, stack: err.stack }))`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when generic error is sent', () => {
    const findings = detect('WS_009', [{
      path: 'src/ws-server.ts',
      content: `ws.send(JSON.stringify({ error: "An error occurred" }))`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_010 — no message rate limit ───────────────────────────────────────────

describe('WS_010 — WebSocket no per-connection rate limit', () => {
  it('fires on ws.on("message") with no rate limiter', () => {
    const findings = detect('WS_010', [{
      path: 'src/ws-server.ts',
      content: `
        ws.on("message", async (data) => {
          await handleMessage(JSON.parse(data));
        });
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when rate limiter is present', () => {
    const findings = detect('WS_010', [{
      path: 'src/ws-server.ts',
      content: `
        const rateLimiter = new RateLimiter({ maxPerSecond: 10 });
        ws.on("message", async (data) => {
          if (!rateLimiter.tryAcquire()) { ws.send('{"error":"Rate limit"}'); return; }
          await handleMessage(JSON.parse(data));
        });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_011 — no max connections ──────────────────────────────────────────────

describe('WS_011 — WebSocket no per-user connection limit', () => {
  it('fires on WebSocketServer with no connection limit tracking', () => {
    const findings = detect('WS_011', [{
      path: 'src/ws-server.ts',
      content: `
        const wss = new WebSocketServer({ port: 8080 });
        wss.on("connection", (ws) => { handleConnection(ws); });
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when MAX_CONNECTIONS_PER_USER is tracked', () => {
    const findings = detect('WS_011', [{
      path: 'src/ws-server.ts',
      content: `
        const wss = new WebSocketServer({ port: 8080 });
        const userConnections = new Map();
        wss.on("connection", (ws, req) => {
          const userId = ws.session.userId;
          const count = userConnections.get(userId) ?? 0;
          if (count >= MAX_CONNECTIONS_PER_USER) { ws.close(1008, 'Too many'); return; }
          userConnections.set(userId, count + 1);
        });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── WS_012 — reconnect no backoff ────────────────────────────────────────────

describe('WS_012 — WebSocket reconnect no exponential backoff', () => {
  it('fires on ws.on("close") with fixed setTimeout and no backoff', () => {
    const findings = detect('WS_012', [{
      path: 'src/ws-client.ts',
      content: `ws.on("close", () => setTimeout(connect, 1000))`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when exponential backoff is implemented', () => {
    const findings = detect('WS_012', [{
      path: 'src/ws-client.ts',
      content: `
        let retryDelay = 1000;
        ws.on("close", () => {
          setTimeout(connect, retryDelay + Math.random() * 1000);
          retryDelay = Math.min(retryDelay * 2, 30000);
        });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── Registry contract ──────────────────────────────────────────────────────────

describe('WEBSOCKET_RULES registry contract', () => {
  it('exports exactly 12 rules', () => {
    expect(WEBSOCKET_RULES).toHaveLength(12);
  });

  it('all rule IDs are unique', () => {
    const ids = WEBSOCKET_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all rules have a sinceVersion', () => {
    for (const rule of WEBSOCKET_RULES) {
      expect(typeof rule.sinceVersion, `[${rule.id}] sinceVersion`).toBe('string');
    }
  });

  it('all detect() methods return an array', () => {
    const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    for (const rule of WEBSOCKET_RULES) {
      expect(Array.isArray(rule.detect(input)), `[${rule.id}] returns array`).toBe(true);
    }
  });
});
