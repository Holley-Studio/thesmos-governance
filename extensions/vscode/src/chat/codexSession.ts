// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * CodexSession — drives OpenAI's `codex` CLI as a subprocess-per-turn and
 * emits the same SessionEvent shape ClaudeSession does, so the chat
 * controller's event-shaping logic (god bubbles, diff cards, turn footers)
 * works unmodified for either provider.
 *
 * Uses the user's own ChatGPT/Codex subscription login (`codex login`) —
 * same subprocess-wrapping posture as ClaudeSession, no API key involved.
 *
 * Architecturally different from Claude: `codex exec` is one-shot per
 * invocation (spawn, run one turn, exit), not a long-lived process fed via
 * stdin. Continuity across turns comes from `codex exec resume <thread-id>`,
 * so `send()` spawns a fresh process each time and threads the id through.
 *
 * The exact JSONL event schema below is pieced together from Codex CLI docs
 * and community references, not verified against a live binary in this
 * environment — every field access is defensive and unknown events/fields
 * are ignored, matching the posture already used for Claude's stream-json.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { resolveBinary } from './binaryResolver.js';
import type { SessionEvent } from './claudeSession.js';

export function resolveCodexBinary(): string {
  return resolveBinary('codex');
}

interface CodexItem {
  id?: string;
  type?: string;
  status?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  changes?: Array<{ path?: string; kind?: string }>;
}

export class CodexSession {
  private proc: ChildProcessByStdio<null, Readable, Readable> | undefined;
  private stdoutBuffer = '';
  private threadId: string | undefined;
  private turnStartedAt = 0;
  private disposed = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly onEvent: (event: SessionEvent) => void,
    resumeThreadId?: string,
    private readonly modelConfig?: { model?: string },
  ) {
    this.threadId = resumeThreadId;
  }

  get id(): string | undefined {
    return this.threadId;
  }

  get running(): boolean {
    return this.proc !== undefined && this.proc.exitCode === null;
  }

  /** No-op: codex exec spawns fresh per turn — nothing to pre-warm. */
  start(): void {
    /* intentionally empty */
  }

  send(text: string): void {
    if (this.disposed || this.running) return;
    this.turnStartedAt = Date.now();

    const args = ['exec'];
    if (this.threadId) args.push('resume', this.threadId);
    args.push(
      '--json',
      '--sandbox', 'workspace-write',
      '--ask-for-approval', 'never', // headless has no TTY to prompt on — checkpoints are the safety net
    );
    if (this.modelConfig?.model) args.push('--model', this.modelConfig.model);
    args.push(text);

    const binary = resolveCodexBinary();
    this.proc = spawn(binary, args, {
      cwd: this.workspaceRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => {
      const trimmed = chunk.trim();
      if (trimmed) this.onEvent({ kind: 'stderr', text: trimmed });
    });
    this.proc.on('error', (err) => {
      this.onEvent({
        kind: 'stderr',
        text:
          `Failed to launch codex CLI (${binary}): ${err.message}\n` +
          'Install the Codex CLI (see https://developers.openai.com/codex) and run `codex login`.',
      });
      this.onEvent({ kind: 'exit', code: -1 });
      this.proc = undefined;
    });
    this.proc.on('close', (code) => {
      this.onEvent({ kind: 'exit', code });
      this.proc = undefined;
    });
  }

  stop(): void {
    if (!this.proc) return;
    this.proc.kill('SIGTERM');
    this.proc = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.parseLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private parseLine(line: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // Non-JSON noise on stdout — ignore.
    }

    switch (event.type) {
      case 'thread.started':
        if (typeof event.thread_id === 'string') this.threadId = event.thread_id;
        this.onEvent({ kind: 'init', sessionId: this.threadId ?? '', model: this.modelConfig?.model || 'codex' });
        break;

      case 'item.completed': {
        const item = event.item as CodexItem | undefined;
        if (!item?.type) break;
        this.emitItem(item);
        break;
      }

      case 'turn.completed': {
        const usage = event.usage as Record<string, unknown> | undefined;
        this.onEvent({
          kind: 'turnDone',
          durationMs: Date.now() - this.turnStartedAt,
          inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined,
          isError: false,
        });
        break;
      }

      case 'turn.failed': {
        const error = event.error as Record<string, unknown> | undefined;
        const message = typeof error?.message === 'string' ? error.message : 'Codex turn failed.';
        this.onEvent({ kind: 'stderr', text: message });
        this.onEvent({ kind: 'turnDone', durationMs: Date.now() - this.turnStartedAt, isError: true });
        break;
      }

      default:
        break; // Unknown event type — schema not fully verified, skip quietly.
    }
  }

  private emitItem(item: CodexItem): void {
    const id = item.id ?? `${Date.now()}`;
    switch (item.type) {
      case 'agent_message':
        if (item.text) this.onEvent({ kind: 'assistantText', text: item.text });
        break;

      case 'command_execution':
        this.onEvent({ kind: 'toolUse', toolUseId: id, name: 'CodexCommand', input: { command: item.command ?? '' } });
        this.onEvent({
          kind: 'toolResult',
          toolUseId: id,
          summary: (item.aggregated_output ?? '').slice(0, 400),
          isError: typeof item.exit_code === 'number' && item.exit_code !== 0,
        });
        break;

      case 'file_change': {
        const changes = item.changes ?? [];
        const label = changes.map((c) => `${c.kind ?? 'update'} ${c.path ?? ''}`).join(', ');
        this.onEvent({ kind: 'toolUse', toolUseId: id, name: 'CodexFileChange', input: { summary: label } });
        this.onEvent({ kind: 'toolResult', toolUseId: id, summary: label, isError: false });
        break;
      }

      case 'mcp_tool_call':
      case 'web_search':
        this.onEvent({ kind: 'toolUse', toolUseId: id, name: item.type, input: {} });
        break;

      default:
        break; // reasoning, plan updates, etc. — not rendered in this pass.
    }
  }
}
