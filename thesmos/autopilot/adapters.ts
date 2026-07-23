// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * AI adapter interface and implementations.
 * Adapters execute a task prompt and return a structured result.
 *
 * Claude adapter: calls `claude -p <prompt>` by default.
 * HTTP adapter:   POSTs to a configurable endpoint (generic/custom LLM servers)
 *
 * `--dangerously-skip-permissions` is opt-in only via
 * `autopilot.dangerouslySkipPermissions: true` (or AdapterOptions). Default is off.
 * Unattended runs should rely on the Thesmos permission profile + claude:govern hooks.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AdapterOptions {
  timeoutMs: number;
  logPath: string;
  sessionId: string;
  taskIndex: number;
  /**
   * When true, append `--dangerously-skip-permissions` to the Claude CLI.
   * Default: false. Prefer the autopilot permission profile instead.
   */
  dangerouslySkipPermissions?: boolean;
}

export interface AdapterResult {
  success: boolean;
  timedOut: boolean;
  exitCode: number | null;
  summary: string | null;
  rawOutputPath: string;
}

export interface Adapter {
  name: string;
  isAvailable(): Promise<boolean>;
  execute(prompt: string, options: AdapterOptions): Promise<AdapterResult>;
}

export interface ClaudeAdapterConfig {
  /**
   * Default for execute() when AdapterOptions does not override.
   * Must be explicitly true to enable --dangerously-skip-permissions.
   */
  dangerouslySkipPermissions?: boolean;
}

export interface CreateAdapterOptions {
  httpUrl?: string;
  dangerouslySkipPermissions?: boolean;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function ensureLogDir(logPath: string): void {
  const dir = dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function extractSummary(output: string): string | null {
  // Look for explicit completion signal from task prompt instructions
  const match = /TASK COMPLETE[—\-–]\s*(.+)/i.exec(output);
  return match ? match[1]!.trim().slice(0, 500) : null;
}

/**
 * Resolve whether Claude should skip its own permission prompts.
 * Only an explicit `true` enables the flag — undefined/false stay off.
 */
export function resolveDangerouslySkipPermissions(
  value: boolean | undefined,
): boolean {
  return value === true;
}

/**
 * Build Claude CLI argv for a print-mode (`-p`) invocation.
 * Exported for unit tests — keeps spawn args honest and reviewable.
 */
export function buildClaudeCliArgs(
  prompt: string,
  options: { dangerouslySkipPermissions?: boolean } = {},
): string[] {
  const args = ['-p', prompt];
  if (resolveDangerouslySkipPermissions(options.dangerouslySkipPermissions)) {
    args.push('--dangerously-skip-permissions');
  }
  return args;
}

function warnSkipPermissionsOnce(adapter: ClaudeAdapter): void {
  if (adapter.skipPermissionsWarned) return;
  adapter.skipPermissionsWarned = true;
  process.stderr.write(
    '[autopilot] WARNING: --dangerously-skip-permissions is enabled ' +
      '(autopilot.dangerouslySkipPermissions=true). ' +
      'Prefer the permission profile + claude:govern hooks for unattended runs.\n',
  );
}

// ── Claude adapter ────────────────────────────────────────────────────────────

export class ClaudeAdapter implements Adapter {
  name = 'claude';
  /** @internal — tracks one-time stderr warning */
  skipPermissionsWarned = false;
  private readonly config: ClaudeAdapterConfig;

  constructor(config: ClaudeAdapterConfig = {}) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  async execute(prompt: string, options: AdapterOptions): Promise<AdapterResult> {
    ensureLogDir(options.logPath);

    const skip = resolveDangerouslySkipPermissions(
      options.dangerouslySkipPermissions ?? this.config.dangerouslySkipPermissions,
    );
    if (skip) warnSkipPermissionsOnce(this);

    const cliArgs = buildClaudeCliArgs(prompt, { dangerouslySkipPermissions: skip });

    return new Promise<AdapterResult>((resolve) => {
      const logStream = createWriteStream(options.logPath, { flags: 'a' });
      let rawOutput = '';
      let timedOut = false;

      const child = spawn('claude', cliArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, options.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        rawOutput += text;
        logStream.write(text);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        logStream.write('[stderr] ' + chunk.toString());
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        logStream.end();
        resolve({
          success: code === 0 && !timedOut,
          timedOut,
          exitCode: code,
          summary: extractSummary(rawOutput),
          rawOutputPath: options.logPath,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        logStream.write(`[error] ${err.message}\n`);
        logStream.end();
        resolve({
          success: false,
          timedOut: false,
          exitCode: null,
          summary: null,
          rawOutputPath: options.logPath,
        });
      });
    });
  }
}

// ── HTTP adapter (generic LLM endpoint) ──────────────────────────────────────

export class HttpAdapter implements Adapter {
  name = 'http';
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(this.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      return resp.ok || resp.status === 405; // 405 = Method Not Allowed is fine for HEAD
    } catch {
      return false;
    }
  }

  async execute(prompt: string, options: AdapterOptions): Promise<AdapterResult> {
    ensureLogDir(options.logPath);
    const logStream = createWriteStream(options.logPath, { flags: 'a' });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);

      const resp = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session_id: options.sessionId, task_index: options.taskIndex }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const text = await resp.text();
        logStream.write(`[http] ${resp.status}: ${text}\n`);
        logStream.end();
        return { success: false, timedOut: false, exitCode: resp.status, summary: null, rawOutputPath: options.logPath };
      }

      const text = await resp.text();
      logStream.write(text + '\n');
      logStream.end();

      return {
        success: true,
        timedOut: false,
        exitCode: 0,
        summary: extractSummary(text),
        rawOutputPath: options.logPath,
      };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      logStream.write(`[error] ${err instanceof Error ? err.message : String(err)}\n`);
      logStream.end();
      return { success: false, timedOut, exitCode: null, summary: null, rawOutputPath: options.logPath };
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an AI adapter.
 *
 * Overloads preserve the historical `createAdapter(type, httpUrl?)` call shape
 * while allowing structured options for Claude safety flags.
 */
export function createAdapter(type: string, httpUrlOrOptions?: string | CreateAdapterOptions): Adapter {
  const opts: CreateAdapterOptions =
    typeof httpUrlOrOptions === 'string'
      ? { httpUrl: httpUrlOrOptions }
      : (httpUrlOrOptions ?? {});

  switch (type) {
    case 'claude':
      return new ClaudeAdapter({
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
      });
    case 'http': {
      if (!opts.httpUrl) throw new Error('HTTP adapter requires autopilot.httpAdapterUrl in config');
      return new HttpAdapter(opts.httpUrl);
    }
    default:
      throw new Error(`Unknown adapter type "${type}". Supported: claude, http`);
  }
}
