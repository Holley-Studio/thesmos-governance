// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * PermissionBridge — local IPC server that the Claude Code subprocess's
 * PreToolUse hook (dist/permissionHook.cjs) connects to when it needs a
 * human decision on a tool call not already covered by the active
 * permission mode. The hook process blocks on this connection; we forward
 * the request to the webview and reply once the user clicks Approve/Deny,
 * or after a timeout, which denies by default (the safe direction).
 *
 * Uses a Unix domain socket (named pipe on Windows) scoped to one chat
 * session — never a shared/predictable path, since anything that can
 * connect to it can approve tool calls for this session.
 */

import * as net from 'node:net';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface PermissionDecision {
  decision: 'allow' | 'deny';
  reason?: string;
}

const REQUEST_TIMEOUT_MS = 170_000; // stay under the hook script's own 175s socket timeout

export class PermissionBridge {
  readonly socketPath: string;
  private server: net.Server | undefined;
  private readonly pending = new Map<
    string,
    { socket: net.Socket; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(sessionNonce: string, private readonly onRequest: (req: PermissionRequest) => void) {
    this.socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\thesmos-pantheon-${sessionNonce}`
        : join(tmpdir(), 'thesmos-pantheon-chat', `perm-${sessionNonce}.sock`);
  }

  start(): void {
    if (this.server) return;

    if (process.platform !== 'win32') {
      const dir = join(tmpdir(), 'thesmos-pantheon-chat');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (existsSync(this.socketPath)) {
        try {
          unlinkSync(this.socketPath);
        } catch {
          /* best effort — a stale socket from a crashed prior run */
        }
      }
    }

    this.server = net.createServer((socket) => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        try {
          const req = JSON.parse(line) as PermissionRequest;
          this.handleRequest(req, socket);
        } catch {
          socket.end(JSON.stringify({ decision: 'deny', reason: 'malformed request' }) + '\n');
        }
      });
      socket.on('error', () => {
        /* peer went away — the pending timeout will clean up if unresolved */
      });
    });
    this.server.listen(this.socketPath);
  }

  private handleRequest(req: PermissionRequest, socket: net.Socket): void {
    const timer = setTimeout(() => {
      this.respond(req.requestId, {
        decision: 'deny',
        reason: 'No response in Pantheon Chat — denied automatically.',
      });
    }, REQUEST_TIMEOUT_MS);
    this.pending.set(req.requestId, { socket, timer });
    this.onRequest(req);
  }

  /** Called by the chat controller once the user (or an always-allow rule) decides. */
  respond(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    try {
      entry.socket.end(JSON.stringify(decision) + '\n');
    } catch {
      /* socket may already be closed */
    }
  }

  dispose(): void {
    for (const [requestId] of this.pending) {
      this.respond(requestId, { decision: 'deny', reason: 'Pantheon Chat session ended.' });
    }
    this.server?.close();
    this.server = undefined;
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        /* best effort */
      }
    }
  }
}
