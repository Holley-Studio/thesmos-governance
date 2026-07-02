// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * AI adapter interface and implementations.
 * Adapters execute a task prompt and return a structured result.
 *
 * Claude adapter: calls `claude -p <prompt> --dangerously-skip-permissions`
 * HTTP adapter:   POSTs to a configurable endpoint (generic/custom LLM servers)
 *
 * The --dangerously-skip-permissions flag bypasses Claude Code's own permission
 * prompts inside the subprocess — separate from Thesmos's permission profile
 * which handles the parent VSCode extension's permission system.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AdapterOptions {
  timeoutMs: number;
  logPath: string;
  sessionId: string;
  taskIndex: number;
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

// ── Claude adapter ────────────────────────────────────────────────────────────

export class ClaudeAdapter implements Adapter {
  name = 'claude';

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  async execute(prompt: string, options: AdapterOptions): Promise<AdapterResult> {
    ensureLogDir(options.logPath);

    return new Promise<AdapterResult>((resolve) => {
      const logStream = createWriteStream(options.logPath, { flags: 'a' });
      let rawOutput = '';
      let timedOut = false;

      const child = spawn(
        'claude',
        ['-p', prompt, '--dangerously-skip-permissions'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        }
      );

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

export function createAdapter(type: string, httpUrl?: string): Adapter {
  switch (type) {
    case 'claude': return new ClaudeAdapter();
    case 'http': {
      if (!httpUrl) throw new Error('HTTP adapter requires autopilot.httpAdapterUrl in config');
      return new HttpAdapter(httpUrl);
    }
    default:
      throw new Error(`Unknown adapter type "${type}". Supported: claude, http`);
  }
}
