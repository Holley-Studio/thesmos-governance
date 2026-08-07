// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Minimal Ollama HTTP client.
 *
 * Talks to the native `/api` surface directly. No OpenAI SDK, no Anthropic
 * compatibility shim, no proxy — the whole point of this provider is that
 * Thesmos owns the wire, so a dependency that re-frames Ollama as something
 * else would defeat it. The surface used here is three endpoints and a
 * newline-delimited JSON stream, which does not justify a client library.
 *
 * Every request takes an `AbortSignal`. Cancellation that leaves inference
 * running on the user's GPU is not cancellation.
 */

import { normalizeHttpError, normalizeTransportError, ProviderError } from '../../errors.js';

/** A model as `/api/tags` reports it. Every field defensive — Ollama's shape varies by version. */
export interface OllamaTag {
  name: string;
  model?: string;
  size?: number;
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

/** `/api/show` detail, used for capability detection. */
export interface OllamaShow {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
}

/** One decoded frame of a `/api/chat` stream. */
export interface OllamaChatChunk {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: Record<string, unknown> | string };
    }>;
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class OllamaClient {
  /**
   * @param origin Normalized origin from `parseEndpoint` — never a raw user string.
   */
  constructor(
    private readonly origin: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  get endpoint(): string {
    return this.origin;
  }

  /**
   * Round-trip `/api/tags` to prove the *service* answers.
   *
   * Deliberately not a binary-on-PATH check: an installed `ollama` executable
   * with no running daemon is precisely the case that would make us claim
   * availability and then fail on the first prompt.
   */
  async health(timeoutMs = 3_000): Promise<{ ok: true; latencyMs: number } | { ok: false; error: ProviderError }> {
    const started = Date.now();
    try {
      const res = await this.request('/api/tags', { method: 'GET' }, undefined, timeoutMs);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: normalizeHttpError(res.status, body, this.origin, 'Ollama') };
      }
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: normalizeTransportError(err, this.origin, 'Ollama') };
    }
  }

  async listTags(signal?: AbortSignal): Promise<OllamaTag[]> {
    const res = await this.request('/api/tags', { method: 'GET' }, signal);
    if (!res.ok) {
      throw normalizeHttpError(res.status, await res.text().catch(() => ''), this.origin, 'Ollama');
    }
    const body: unknown = await res.json().catch(() => {
      throw new ProviderError('malformed_response', 'Ollama returned an unreadable model list.');
    });
    const models = (body as { models?: unknown }).models;
    if (!Array.isArray(models)) {
      throw new ProviderError(
        'malformed_response',
        'Ollama returned an unreadable model list.',
        `expected .models[], got ${typeof models}`,
      );
    }
    // Drop entries without a usable name rather than surfacing blank picker rows.
    return models.filter(
      (m): m is OllamaTag => typeof m === 'object' && m !== null && typeof (m as OllamaTag).name === 'string',
    );
  }

  /**
   * Per-model detail. Returns null instead of throwing: capability detail is an
   * enhancement, and one model that fails `/api/show` must not empty the picker.
   */
  async show(model: string, signal?: AbortSignal): Promise<OllamaShow | null> {
    try {
      const res = await this.request(
        '/api/show',
        { method: 'POST', body: JSON.stringify({ model }) },
        signal,
      );
      if (!res.ok) return null;
      return (await res.json()) as OllamaShow;
    } catch {
      return null;
    }
  }

  /**
   * Stream a chat turn, yielding decoded frames as they arrive.
   *
   * Ollama streams newline-delimited JSON, not SSE, so the framing is a buffer
   * split on `\n`. A partial trailing line is kept for the next chunk — cutting
   * a frame mid-object and parsing it would drop tokens silently.
   */
  async *chatStream(
    body: {
      model: string;
      messages: OllamaMessage[];
      tools?: unknown[];
      options?: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ): AsyncGenerator<OllamaChatChunk> {
    const res = await this.request(
      '/api/chat',
      { method: 'POST', body: JSON.stringify({ ...body, stream: true }) },
      signal,
      // No timeout: generation legitimately runs longer than any fixed budget.
      // `signal` remains the cancellation path.
      0,
    );

    if (!res.ok) {
      throw normalizeHttpError(res.status, await res.text().catch(() => ''), this.origin, 'Ollama');
    }
    if (!res.body) {
      throw new ProviderError('malformed_response', 'Ollama returned an empty response stream.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            const frame = this.decodeFrame(line);
            if (frame) yield frame;
          }
          newline = buffer.indexOf('\n');
        }
      }
    } catch (err) {
      // Aborting mid-generation errors the body stream. That is the user
      // pressing stop, not a failure — surfacing it as one would put a red
      // error in the transcript every time someone interrupts a long answer.
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new ProviderError('cancelled', 'Request cancelled.');
      }
      if (err instanceof ProviderError) throw err;
      throw normalizeTransportError(err, this.origin, 'Ollama');
    }

    const tail = buffer.trim();
    if (tail) {
      const frame = this.decodeFrame(tail);
      if (frame) yield frame;
    }
  }

  /**
   * Ollama reports mid-stream failures as an `error` field inside an otherwise
   * ordinary frame, so this promotes them to a thrown ProviderError. Left as a
   * data frame they would surface as an empty response with no explanation.
   */
  private decodeFrame(line: string): OllamaChatChunk | null {
    let parsed: OllamaChatChunk;
    try {
      parsed = JSON.parse(line) as OllamaChatChunk;
    } catch {
      return null; // Non-JSON noise — skip rather than abort a live stream.
    }
    if (typeof parsed.error === 'string' && parsed.error) {
      throw normalizeHttpError(200, parsed.error, this.origin, 'Ollama');
    }
    return parsed;
  }

  async embed(model: string, input: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const res = await this.request(
      '/api/embed',
      { method: 'POST', body: JSON.stringify({ model, input: [...input] }) },
      signal,
    );
    if (!res.ok) {
      throw normalizeHttpError(res.status, await res.text().catch(() => ''), this.origin, 'Ollama');
    }
    const body = (await res.json()) as { embeddings?: unknown };
    if (!Array.isArray(body.embeddings)) {
      throw new ProviderError('malformed_response', 'Ollama returned an unreadable embedding response.');
    }
    return body.embeddings as number[][];
  }

  /**
   * Single place where a request is actually dialled.
   *
   * `timeoutMs === 0` means streaming: the caller's signal is handed to `fetch`
   * untouched. Wrapping it in a second controller would be actively wrong here
   * — `fetch` resolves once the *headers* arrive, so any teardown tied to that
   * promise would sever cancellation while the body is still generating, and a
   * later `stop()` would leave inference running on the user's GPU.
   *
   * For finite requests a timeout controller is chained to the caller's signal
   * so either can abort. The abort listener is registered `once` and left to
   * fire-and-detach rather than being removed on settle, for the same reason.
   */
  private async request(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<Response> {
    const url = `${this.origin}${path}`;
    const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };

    if (timeoutMs <= 0) {
      try {
        return await this.fetchImpl(url, { ...init, headers, signal });
      } catch (err) {
        if (signal?.aborted) throw new ProviderError('cancelled', 'Request cancelled.');
        throw normalizeTransportError(err, this.origin, 'Ollama');
      }
    }

    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.fetchImpl(url, { ...init, headers, signal: controller.signal });
    } catch (err) {
      // A caller-driven abort is a cancellation, not a transport failure.
      if (signal?.aborted) throw new ProviderError('cancelled', 'Request cancelled.');
      throw normalizeTransportError(err, this.origin, 'Ollama');
    } finally {
      clearTimeout(timer);
    }
  }
}
