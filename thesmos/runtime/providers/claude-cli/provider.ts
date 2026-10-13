// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Native Claude Code CLI provider.
 *
 * Wraps the `claude` CLI as a long-lived subprocess in headless stream-json
 * mode, riding whatever login the user already has via `claude login` — no
 * API key, no separate credential store. This is the desktop app's
 * subscription-backed provider.
 *
 * The event mapping below is ported from the VS Code extension's
 * `ClaudeSession` (extensions/vscode/src/chat/claudeSession.ts), which is
 * where `RuntimeEvent` itself was lifted from — the stream-json wire shape is
 * proven, not new. What's new here is packaging it as a `ModelProvider` the
 * desktop sidecar can register directly, without the VS Code-only permission
 * hook/settings machinery that session doesn't need for a headless app.
 *
 * `kind: 'cli'` — governance here is inherited from the binary's own
 * permission mode, not re-applied by Thesmos the way `OllamaProvider` (an
 * `http` provider) must supply its own egress boundary. Every session is
 * spawned with `--permission-mode plan`, so the model genuinely has no
 * filesystem or shell access this turn, regardless of what it asks for.
 */

import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { classifyClaudeCliFailure } from './errors.js';
import { isBatchShim, resolveClaudeBinary } from './binary-resolver.js';
import type {
  AgentSession,
  ModelDescriptor,
  ModelProvider,
  ProviderHealth,
  RuntimeEvent,
  SessionOptions,
} from '../../types.js';

export const CLAUDE_CLI_PROVIDER_ID = 'claude-cli';

/** How long `health()` waits for `claude --version` before giving up. */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Node refuses to spawn a `.cmd`/`.bat` without a shell (the CVE-2024-27980
 * mitigation) and throws `EINVAL`. The resolver already prefers the native
 * `claude.exe` an npm shim wraps, so this is only reached by an install
 * shape that ships nothing else — in which case a shell is the only way to
 * launch it at all.
 *
 * Note the cost: with `shell: true`, Node does *not* escape arguments, so
 * they pass through `cmd.exe`'s tokenizer. Everything this provider sends is
 * either a fixed flag or a provider-scoped model/session id, none of which
 * are free-form user text — the prompt itself goes over stdin, never argv.
 */
function spawnOptionsFor(binary: string): { shell: boolean } {
  return { shell: isBatchShim(binary) };
}

export interface ClaudeCliProviderOptions {
  /** Injectable for tests — no real subprocess is ever spawned in the suite. */
  spawnImpl?: typeof spawn;
  resolveBinaryImpl?: typeof resolveClaudeBinary;
}

export class ClaudeCliProvider implements ModelProvider {
  readonly id = CLAUDE_CLI_PROVIDER_ID;
  readonly label = 'Claude Code';
  readonly kind = 'cli' as const;

  constructor(private readonly options: ClaudeCliProviderOptions = {}) {}

  private get spawnImpl(): typeof spawn {
    return this.options.spawnImpl ?? spawn;
  }

  private get resolveBinaryImpl(): typeof resolveClaudeBinary {
    return this.options.resolveBinaryImpl ?? resolveClaudeBinary;
  }

  /**
   * Confirms the binary launches. Never probes auth — a live check would
   * spend a real turn every time a provider card renders. Never rejects,
   * matching every other provider's `health()` contract.
   */
  async health(): Promise<ProviderHealth> {
    const binary = this.resolveBinaryImpl();
    const endpoint = `claude CLI (${binary})`;

    try {
      await new Promise<void>((resolve, reject) => {
        let proc: ChildProcess;
        try {
          proc = this.spawnImpl(binary, ['--version'], {
            stdio: ['ignore', 'ignore', 'ignore'],
            ...spawnOptionsFor(binary),
          });
        } catch (err) {
          reject(err);
          return;
        }
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error(`claude --version timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`));
        }, HEALTH_CHECK_TIMEOUT_MS);
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        proc.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return { available: true, endpoint, locality: 'local' };
    } catch (err) {
      const notFound = (err as NodeJS.ErrnoException)?.code === 'ENOENT';
      return {
        available: false,
        endpoint,
        locality: 'local',
        errorCode: 'unavailable',
        detail: notFound
          ? 'Claude Code CLI not found on PATH. Install: https://claude.com/claude-code'
          : err instanceof Error
            ? err.message
            : String(err),
      };
    }
  }

  /**
   * No cheap, side-effect-free way to enumerate the models a CLI subscription
   * session can use without a network round trip through the CLI itself —
   * empty for v1, matching Ollama's "empty on failure" posture. `--model`
   * still works as an opaque pass-through string.
   */
  async listModels(): Promise<ModelDescriptor[]> {
    return [];
  }

  createSession(options: SessionOptions): AgentSession {
    return new ClaudeCliSession(options, this.spawnImpl, this.resolveBinaryImpl);
  }
}

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
      .map((c) =>
        typeof c === 'string' ? c : typeof (c as ContentBlock)?.text === 'string' ? (c as ContentBlock).text : '',
      )
      .join('')
      .trim();
  }
  return '';
}

/**
 * One Claude CLI conversation — a long-lived subprocess fed newline-delimited
 * JSON on stdin, emitting newline-delimited JSON on stdout.
 */
class ClaudeCliSession implements AgentSession {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = '';
  private sessionId: string | undefined;
  private disposed = false;

  constructor(
    private readonly options: SessionOptions,
    private readonly spawnImpl: typeof spawn,
    private readonly resolveBinaryImpl: typeof resolveClaudeBinary,
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
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'plan',
    ];
    // Prefer the live session id (set once the first turn inits) so a respawn
    // after stop/crash resumes the same conversation instead of forking a new one.
    const resumeId = this.sessionId ?? this.options.resumeSessionId;
    if (resumeId) args.push('--resume', resumeId);
    if (this.options.model) args.push('--model', this.options.model);

    const binary = this.resolveBinaryImpl();
    this.proc = this.spawnImpl(binary, args, {
      cwd: this.options.workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...spawnOptionsFor(binary),
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (!text) return;
      const authFailure = classifyClaudeCliFailure(text);
      this.emit({ kind: 'stderr', text: authFailure ? authFailure.message : text });
    });
    this.proc.on('error', (err) => {
      this.emit({
        kind: 'stderr',
        text:
          `Failed to launch claude CLI (${binary}): ${err.message}\n` +
          'Install Claude Code (https://claude.com/claude-code) or make sure it is on PATH.',
      });
      this.emit({ kind: 'exit', code: -1 });
      this.proc = undefined;
    });
    this.proc.on('close', (code) => {
      this.emit({ kind: 'exit', code });
      this.proc = undefined;
    });
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
          this.emit({
            kind: 'init',
            sessionId: this.sessionId ?? '',
            model: typeof event.model === 'string' ? event.model : 'unknown',
          });
        } else if (event.subtype === 'compact_boundary') {
          const meta = event.compact_metadata as { trigger?: string; pre_tokens?: number } | undefined;
          this.emit({
            kind: 'compacting',
            trigger: typeof meta?.trigger === 'string' ? meta.trigger : 'auto',
            preTokens: typeof meta?.pre_tokens === 'number' ? meta.pre_tokens : undefined,
          });
        }
        break;

      case 'stream_event': {
        const inner = event.event as Record<string, unknown> | undefined;
        if (inner?.type === 'message_start') {
          const msg = inner.message as { usage?: Record<string, unknown> } | undefined;
          const u = msg?.usage;
          if (u) {
            const ctx =
              (typeof u.input_tokens === 'number' ? u.input_tokens : 0) +
              (typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0) +
              (typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0);
            if (ctx > 0) this.emit({ kind: 'usage', contextTokens: ctx });
          }
        } else if (inner?.type === 'content_block_delta') {
          const delta = inner.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            this.emit({ kind: 'textDelta', text: delta.text });
          } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            this.emit({ kind: 'thinkingDelta', text: delta.thinking });
          }
        }
        break;
      }

      case 'assistant': {
        const message = event.message as { content?: ContentBlock[] } | undefined;
        for (const block of message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            this.emit({ kind: 'assistantText', text: block.text });
          } else if (block.type === 'tool_use' && block.id && block.name) {
            this.emit({ kind: 'toolUse', toolUseId: block.id, name: block.name, input: block.input ?? {} });
          }
        }
        break;
      }

      case 'user': {
        // Tool results echo back as user messages.
        const message = event.message as { content?: ContentBlock[] } | undefined;
        for (const block of message?.content ?? []) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            this.emit({
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
        const isError = event.is_error === true;
        if (isError) {
          const resultText = typeof event.result === 'string' ? event.result : '';
          const authFailure = classifyClaudeCliFailure(resultText);
          if (authFailure) this.emit({ kind: 'stderr', text: authFailure.message });
        }
        this.emit({
          kind: 'turnDone',
          costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined,
          durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
          inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined,
          cacheReadTokens:
            typeof usage?.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : undefined,
          cacheCreationTokens:
            typeof usage?.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : undefined,
          isError,
        });
        break;
      }

      default:
        break; // Unknown event type — format is internal, skip quietly.
    }
  }

  private emit(event: RuntimeEvent): void {
    this.options.onEvent(event);
  }
}
