// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { PermissionBridge, type PermissionRequest } from '../chat/permissionBridge.js';

function connectAndSend(socketPath: string, req: PermissionRequest): Promise<{ decision: string; reason?: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(req)}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      resolve(JSON.parse(buffer.slice(0, newline)));
      socket.end();
    });
    socket.on('error', reject);
  });
}

describe('PermissionBridge', () => {
  let bridge: PermissionBridge | undefined;

  afterEach(() => {
    bridge?.dispose();
    bridge = undefined;
  });

  it('forwards a request and relays the allow decision back to the caller', async () => {
    const nonce = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let captured: PermissionRequest | undefined;
    bridge = new PermissionBridge(nonce, (req) => {
      captured = req;
      bridge!.respond(req.requestId, { decision: 'allow' });
    });
    bridge.start();

    const result = await connectAndSend(bridge.socketPath, {
      requestId: 'r1',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });

    expect(captured?.toolName).toBe('Bash');
    expect(result.decision).toBe('allow');
  });

  it('relays a deny decision with a reason', async () => {
    const nonce = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    bridge = new PermissionBridge(nonce, (req) => {
      bridge!.respond(req.requestId, { decision: 'deny', reason: 'nope' });
    });
    bridge.start();

    const result = await connectAndSend(bridge.socketPath, {
      requestId: 'r2',
      toolName: 'Edit',
      toolInput: {},
    });

    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('nope');
  });

  it('denies all pending requests on dispose', async () => {
    const nonce = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    bridge = new PermissionBridge(nonce, () => {
      // Intentionally never respond — dispose() should resolve it instead.
    });
    bridge.start();

    const pending = connectAndSend(bridge.socketPath, {
      requestId: 'r3',
      toolName: 'WebFetch',
      toolInput: {},
    });
    // Give the connection a tick to register before disposing.
    await new Promise((r) => setTimeout(r, 50));
    bridge.dispose();

    const result = await pending;
    expect(result.decision).toBe('deny');
  });
});
