// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * ClaudeSession — drives the Claude Code CLI as a long-lived subprocess in
 * headless stream-JSON mode and emits typed events for the chat UI.
 *
 *   claude -p --output-format stream-json --input-format stream-json \
 *          --verbose --include-partial-messages --permission-mode <mode>
 *
 * The subprocess uses the developer's own Claude Code login and settings, so
 * project hooks (including Thesmos governance PreToolUse hooks) fire normally.
 * The stream-json wire format is internal to Claude Code and can change —
 * every parse path here is defensive and unknown events are ignored.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBinary } from './binaryResolver.js';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto';

/** Tools gated by the in-chat permission dialog when a permission gate is configured. */
const GATED_TOOLS_MATCHER = 'Bash|Edit|Write|MultiEdit|WebFetch';

export interface PermissionGateConfig {
  /** Socket path the standalone hook process connects to (see permissionBridge.ts). */
  socketPath: string;
  /** Absolute path to the bundled dist/permissionHook.cjs. */
  hookScriptPath: string;
}

export function resolveClaudeBinary(): string {
  return resolveBinary('claude', [join(homedir(), '.claude', 'local', 'claude')]);
}

/** Shaped events consumed by the chat controller. */
export type SessionEvent =
  | { kind: 'init'; sessionId: string; model: string }
  | { kind: 'textDelta'; text: string }
  | { kind: 'assistantText'; text: string }
  | { kind: 'toolUse'; toolUseId: string; name: string; input: Record<string, unknown> }
  | { kind: 'toolResult'; toolUseId: string; summary: string; isError: boolean }
  | {
      kind: 'turnDone';
      costUsd?: number;
      durationMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      isError: boolean;
    }
  | { kind: 'stderr'; text: string }
  | { kind: 'exit'; code: number | null };

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function blockSummary(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : typeof (c as ContentBlock)?.text === 'string' ? (c as ContentBlock).text : ''))
      .join('')
      .trim();
  }
  return '';
}

export class ClaudeSession {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = '';
  private sessionId: string | undefined;
  private disposed = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly onEvent: (event: SessionEvent) => void,
    private readonly permissionMode: PermissionMode = 'default',
    private readonly resumeSessionId?: string,
    private readonly permissionGate?: PermissionGateConfig,
    /** Optional model id/alias (--model) and provider env overrides. */
    private readonly modelConfig?: { model?: string; env?: Record<string, string> },
  ) {}

  get id(): string | undefined {
    return this.sessionId;
  }

  get running(): boolean {
    return this.proc !== undefined && this.proc.exitCode === null;
  }

  /** Spawn the CLI. Idempotent — subsequent calls are no-ops while running. */
  start(): void {
    if (this.running || this.disposed) return;

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', this.permissionMode,
    ];
    // Prefer the live session id (set once the first turn inits) so a respawn
    // after stop/crash resumes the same conversation instead of forking a new one.
    const resumeId = this.sessionId ?? this.resumeSessionId;
    if (resumeId) args.push('--resume', resumeId);

    if (this.modelConfig?.model) args.push('--model', this.modelConfig.model);

    const env: NodeJS.ProcessEnv = { ...process.env, ...this.modelConfig?.env };
    if (this.permissionGate) {
      // --settings merges with (does not replace) the project's own
      // .claude/settings.json, so existing Thesmos governance hooks still
      // fire — this only adds one scoped PreToolUse hook for this subprocess.
      const settingsPath = this.writeScopedSettings(this.permissionGate);
      args.push('--settings', settingsPath);
      env.THESMOS_PERM_SOCKET = this.permissionGate.socketPath;
    }

    const binary = resolveClaudeBinary();
    this.proc = spawn(binary, args, {
      cwd: this.workspaceRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) this.onEvent({ kind: 'stderr', text });
    });
    this.proc.on('error', (err) => {
      this.onEvent({
        kind: 'stderr',
        text:
          `Failed to launch claude CLI (${binary}): ${err.message}\n` +
          'Install Claude Code (https://claude.com/claude-code) or open VS Code from a terminal so it inherits your PATH.',
      });
      this.onEvent({ kind: 'exit', code: -1 });
      this.proc = undefined;
    });
    this.proc.on('close', (code) => {
      this.onEvent({ kind: 'exit', code });
      this.proc = undefined;
    });
  }

  /** Write a temp settings file containing only our scoped PreToolUse hook. */
  private writeScopedSettings(gate: PermissionGateConfig): string {
    const dir = join(tmpdir(), 'thesmos-pantheon-chat');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `settings-${randomBytes(12).toString('hex')}.json`);
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: GATED_TOOLS_MATCHER,
            hooks: [{ type: 'command', command: `node "${gate.hookScriptPath}"`, timeout: 180 }],
          },
        ],
      },
    };
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
    return path;
  }

  /** Send a user prompt into the live session (starts the process if needed). */
  send(text: string): void {
    this.start();
    if (!this.proc) return;
    const message = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    };
    this.proc.stdin.write(JSON.stringify(message) + '\n');
  }

  /** Hard-stop the current turn by killing the subprocess. */
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
      case 'system':
        if (event.subtype === 'init') {
          this.sessionId = typeof event.session_id === 'string' ? event.session_id : this.sessionId;
          this.onEvent({
            kind: 'init',
            sessionId: this.sessionId ?? '',
            model: typeof event.model === 'string' ? event.model : 'unknown',
          });
        }
        break;

      case 'stream_event': {
        // Anthropic SSE event wrapped by the CLI (--include-partial-messages).
        const inner = event.event as Record<string, unknown> | undefined;
        if (inner?.type === 'content_block_delta') {
          const delta = inner.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            this.onEvent({ kind: 'textDelta', text: delta.text });
          }
        }
        break;
      }

      case 'assistant': {
        const message = event.message as { content?: ContentBlock[] } | undefined;
        for (const block of message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            this.onEvent({ kind: 'assistantText', text: block.text });
          } else if (block.type === 'tool_use' && block.id && block.name) {
            this.onEvent({
              kind: 'toolUse',
              toolUseId: block.id,
              name: block.name,
              input: block.input ?? {},
            });
          }
        }
        break;
      }

      case 'user': {
        // Tool results echo back as user messages.
        const message = event.message as { content?: ContentBlock[] } | undefined;
        for (const block of message?.content ?? []) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            this.onEvent({
              kind: 'toolResult',
              toolUseId: block.tool_use_id,
              summary: blockSummary(block.content).slice(0, 400),
              isError: block.is_error === true,
            });
          }
        }
        break;
      }

      case 'result': {
        const usage = event.usage as Record<string, unknown> | undefined;
        this.onEvent({
          kind: 'turnDone',
          costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined,
          durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
          inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined,
          isError: event.is_error === true,
        });
        break;
      }

      default:
        break; // Unknown event type — format is internal, skip quietly.
    }
  }
}
