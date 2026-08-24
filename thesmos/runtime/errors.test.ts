// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Error normalization.
 *
 * The property under test throughout: the user-facing `message` stays short and
 * actionable, and provider payloads only ever reach `detail`. A chat bubble
 * must never receive kilobytes of echoed prompt.
 */
import { describe, it, expect } from 'vitest';
import { ProviderError, normalizeHttpError, normalizeTransportError } from './errors.js';

/** Node surfaces connection failures on `cause.code`. */
function transportError(code: string): Error {
  const err = new Error('fetch failed') as Error & { cause?: { code: string } };
  err.cause = { code };
  return err;
}

describe('normalizeTransportError', () => {
  it('maps connection refused to an actionable message naming the endpoint', () => {
    const err = normalizeTransportError(transportError('ECONNREFUSED'), '127.0.0.1:11434', 'Ollama');
    expect(err.code).toBe('connection_refused');
    expect(err.message).toContain('127.0.0.1:11434');
    expect(err.message).toMatch(/start it/i);
  });

  it('maps DNS failure to unavailable', () => {
    expect(normalizeTransportError(transportError('ENOTFOUND'), 'host', 'Ollama').code).toBe('unavailable');
    expect(normalizeTransportError(transportError('EAI_AGAIN'), 'host', 'Ollama').code).toBe('unavailable');
  });

  it('maps the timeout family', () => {
    for (const code of ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']) {
      expect(normalizeTransportError(transportError(code), 'host').code).toBe('timeout');
    }
  });

  it('maps a reset connection to unavailable', () => {
    expect(normalizeTransportError(transportError('ECONNRESET'), 'host').code).toBe('unavailable');
  });

  it('treats an AbortError as cancellation, not failure', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    expect(normalizeTransportError(abort, 'host').code).toBe('cancelled');
  });

  it('passes an existing ProviderError through unchanged', () => {
    const original = new ProviderError('model_not_found', 'nope');
    expect(normalizeTransportError(original, 'host')).toBe(original);
  });

  it('reads a code from the error itself, not only from cause', () => {
    const direct = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
    expect(normalizeTransportError(direct, 'host').code).toBe('connection_refused');
  });

  it('falls back to unknown while keeping the detail for logs', () => {
    const err = normalizeTransportError(new Error('something odd'), 'host');
    expect(err.code).toBe('unknown');
    expect(err.detail).toContain('something odd');
  });

  it('handles a non-Error throw without crashing', () => {
    expect(normalizeTransportError('just a string', 'host').code).toBe('unknown');
  });
});

describe('normalizeHttpError', () => {
  it('maps a 404 to an actionable model-not-installed message', () => {
    const err = normalizeHttpError(404, 'model not found', 'host', 'Ollama');
    expect(err.code).toBe('model_not_found');
    expect(err.message).toMatch(/not installed/i);
  });

  it('recognizes Ollama’s pull hint at any status', () => {
    const err = normalizeHttpError(400, 'model "x" not found, try pulling it first', 'host');
    expect(err.code).toBe('model_not_found');
  });

  it('maps context overflow', () => {
    expect(normalizeHttpError(400, 'context length exceeded', 'host').code).toBe('context_overflow');
  });

  it('maps an unsupported capability', () => {
    expect(normalizeHttpError(400, 'model does not support tools', 'host').code).toBe(
      'unsupported_capability',
    );
  });

  it('maps gateway timeouts', () => {
    expect(normalizeHttpError(504, '', 'host').code).toBe('timeout');
    expect(normalizeHttpError(408, '', 'host').code).toBe('timeout');
  });

  it('maps server errors to unavailable', () => {
    expect(normalizeHttpError(500, 'boom', 'host').code).toBe('unavailable');
    expect(normalizeHttpError(503, 'boom', 'host').code).toBe('unavailable');
  });

  it('keeps a huge payload out of the user-facing message', () => {
    // The whole point of the message/detail split.
    const payload = 'LEAKED_SOURCE'.repeat(1000);
    const err = normalizeHttpError(500, payload, 'host', 'Ollama');
    expect(err.message).not.toContain('LEAKED_SOURCE');
    expect(err.message.length).toBeLessThan(120);
  });

  it('truncates even the detail so a log line stays bounded', () => {
    const err = normalizeHttpError(500, 'x'.repeat(10_000), 'host');
    expect(err.detail!.length).toBeLessThan(2100);
  });

  it('reports an unmapped status without pretending to know more', () => {
    const err = normalizeHttpError(418, 'teapot', 'host', 'Ollama');
    expect(err.code).toBe('unknown');
    expect(err.message).toContain('418');
  });
});
