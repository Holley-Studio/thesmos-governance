// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Normalized provider errors.
 *
 * Two audiences with opposite needs: the user wants one actionable line, the
 * doctor/log wants everything. Conflating them either buries the fix in a wall
 * of JSON or throws away the detail needed to diagnose. So every error carries
 * a short `message` and an optional `detail`, and only `message` is ever shown
 * in chat.
 */

/** Stable codes. Callers branch on these, never on message text. */
export type ProviderErrorCode =
  | 'unavailable'
  | 'connection_refused'
  | 'timeout'
  | 'model_not_found'
  | 'context_overflow'
  | 'unsupported_capability'
  | 'malformed_response'
  | 'egress_denied'
  | 'invalid_endpoint'
  | 'cancelled'
  | 'unknown';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  /** Full diagnostic text for logs and `providers:doctor`. Never surfaced in chat. */
  readonly detail?: string;

  constructor(code: ProviderErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.detail = detail;
  }
}

/** Node attaches connection failures to `cause.code` — dig it out defensively. */
function systemErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

/**
 * Map a thrown transport error onto a code plus a line the user can act on.
 *
 * `endpointLabel` is interpolated so the message names the address that
 * actually failed — "Ollama isn't reachable" without a host is unactionable
 * when the user has a non-default endpoint configured.
 */
export function normalizeTransportError(
  err: unknown,
  endpointLabel: string,
  providerLabel = 'Provider',
): ProviderError {
  if (err instanceof ProviderError) return err;

  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);

  if (err instanceof Error && err.name === 'AbortError') {
    return new ProviderError('cancelled', 'Request cancelled.', detail);
  }

  const sys = systemErrorCode(err);
  switch (sys) {
    case 'ECONNREFUSED':
      return new ProviderError(
        'connection_refused',
        `${providerLabel} isn't reachable at ${endpointLabel}. Start it, then retry.`,
        detail,
      );
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new ProviderError(
        'unavailable',
        `Cannot resolve ${endpointLabel}. Check the configured endpoint.`,
        detail,
      );
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
      return new ProviderError('timeout', `${providerLabel} timed out at ${endpointLabel}.`, detail);
    case 'ECONNRESET':
      return new ProviderError(
        'unavailable',
        `${providerLabel} closed the connection at ${endpointLabel}.`,
        detail,
      );
    default:
      return new ProviderError(
        'unknown',
        `${providerLabel} request to ${endpointLabel} failed.`,
        detail,
      );
  }
}

/**
 * Map a non-2xx HTTP response.
 *
 * `body` is captured into `detail` but never into `message` — provider error
 * payloads run to kilobytes and routinely echo the prompt back, which would put
 * source code into a chat error bubble.
 */
export function normalizeHttpError(
  status: number,
  body: string,
  endpointLabel: string,
  providerLabel = 'Provider',
): ProviderError {
  const detail = `HTTP ${status}: ${body.slice(0, 2000)}`;
  const lower = body.toLowerCase();

  if (status === 404 || lower.includes('not found, try pulling it first')) {
    return new ProviderError(
      'model_not_found',
      'That model is not installed. Pull it, then retry.',
      detail,
    );
  }
  if (lower.includes('context') && (lower.includes('exceed') || lower.includes('too long'))) {
    return new ProviderError('context_overflow', 'The conversation exceeds the model context.', detail);
  }
  if (lower.includes('does not support tools') || lower.includes('does not support insert')) {
    return new ProviderError(
      'unsupported_capability',
      'That model does not support the requested capability.',
      detail,
    );
  }
  if (status === 408 || status === 504) {
    return new ProviderError('timeout', `${providerLabel} timed out at ${endpointLabel}.`, detail);
  }
  if (status >= 500) {
    return new ProviderError('unavailable', `${providerLabel} returned a server error.`, detail);
  }
  return new ProviderError('unknown', `${providerLabel} rejected the request (HTTP ${status}).`, detail);
}
