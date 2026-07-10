#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Standalone PreToolUse hook, invoked by the `claude` CLI subprocess that
 * Pantheon Chat spawns. Reads the proposed tool call off stdin, asks the
 * extension host (via a local socket) for a human decision, and prints the
 * hook's JSON verdict to stdout. Every failure path denies — the safe
 * direction when we can't reach the UI to ask.
 *
 * Bundled standalone (dist/permissionHook.cjs): the CLI spawns this as its
 * own `node` child process per the PreToolUse hook contract, independent of
 * the extension host's module graph, so it cannot import `vscode`.
 */

import * as net from 'node:net';

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  permission_mode?: string;
}

function emitDecision(decision: 'allow' | 'deny', reason?: string): never {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        ...(reason ? { permissionDecisionReason: reason } : {}),
      },
    }),
  );
  process.exit(0);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const socketPath = process.env.THESMOS_PERM_SOCKET;
  if (!socketPath) emitDecision('deny', 'Pantheon Chat permission socket not configured.');

  let input: HookInput;
  try {
    input = JSON.parse(await readStdin()) as HookInput;
  } catch {
    emitDecision('deny', 'Could not parse the proposed tool call.');
  }

  const toolName = input.tool_name ?? 'unknown';

  // acceptEdits mode auto-approves file edits at the CLI level already —
  // mirror that here so the dialog only interrupts for genuinely risky calls.
  if (input.permission_mode === 'acceptEdits' && ['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
    emitDecision('allow');
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = `${JSON.stringify({ requestId, toolName, toolInput: input.tool_input ?? {} })}\n`;

  try {
    const decision = await new Promise<{ decision: string; reason?: string }>((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(payload));
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        try {
          resolve(JSON.parse(buffer.slice(0, newline)));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
        socket.end();
      });
      socket.on('error', reject);
      socket.setTimeout(175_000, () => {
        socket.destroy();
        reject(new Error('Pantheon Chat did not respond in time.'));
      });
    });

    if (decision.decision === 'allow') emitDecision('allow', decision.reason);
    emitDecision('deny', decision.reason ?? 'Denied in Pantheon Chat.');
  } catch (err) {
    emitDecision('deny', `Could not reach Pantheon Chat: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(2); // non-zero exit is documented to block the tool call — safe default on crash
});
