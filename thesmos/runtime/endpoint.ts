// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Endpoint validation and locality classification.
 *
 * A configurable provider endpoint is a trust boundary. Prompts carry source
 * code, repository context and tool output, so "which host receives this" is a
 * governance question, not a connection detail. This module answers it, and it
 * is the only place allowed to.
 *
 * The rule enforced here: locality is derived from the resolved host of a
 * parsed URL, never from a provider id, a label, or a config flag a caller can
 * set. `http://evil.example.com/?x=127.0.0.1` is remote, and so is
 * `http://127.0.0.1.attacker.com`.
 */

import type { EndpointLocality } from './types.js';

/** Only these schemes may ever be dialled. No file:, no ftp:, no data:. */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export interface ParsedEndpoint {
  /** Normalized origin, e.g. `http://127.0.0.1:11434`. No trailing slash. */
  origin: string;
  host: string;
  port: number;
  protocol: string;
  locality: EndpointLocality;
}

export class InvalidEndpointError extends Error {
  readonly code = 'invalid_endpoint';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEndpointError';
  }
}

/** Strip brackets IPv6 hosts carry in URL form (`[::1]` → `::1`). */
function bareHost(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * IPv4 loopback is the whole 127.0.0.0/8 block, not just 127.0.0.1.
 *
 * Matching only the canonical address would let `127.0.0.2` — equally loopback,
 * equally local — be misclassified as remote and pointlessly demand approval.
 */
function isIpv4Loopback(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  return octets[0] === 127;
}

/** RFC1918 plus the link-local block — reachable without leaving the network. */
function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  if (m.slice(1).map(Number).some((o) => o > 255)) return false;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Classify a host.
 *
 * `localhost` is treated as loopback because every platform resolves it there,
 * and refusing it would make the default configuration unusable. Any other
 * name — including one that merely *contains* a loopback literal — is remote:
 * we classify on the parsed host, so no amount of decoration in the URL can
 * borrow loopback's trust level.
 */
export function classifyHost(rawHost: string): EndpointLocality {
  const host = bareHost(rawHost).toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return 'local';
  if (isIpv4Loopback(host)) return 'local';
  if (isPrivateIpv4(host)) return 'lan';
  // Unique-local IPv6 (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return 'lan';
  return 'remote';
}

/**
 * Parse and classify, or throw.
 *
 * Rejects rather than repairs: a malformed endpoint is a configuration error
 * the user must see, and silently coercing one into something dialable is how
 * context ends up at an address nobody chose.
 */
export function parseEndpoint(raw: string): ParsedEndpoint {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidEndpointError('endpoint is empty');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidEndpointError(`"${trimmed}" is not a valid URL`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidEndpointError(
      `unsupported protocol "${url.protocol}" — only http: and https: are allowed`,
    );
  }
  if (!url.hostname) throw new InvalidEndpointError(`"${trimmed}" has no host`);

  // Credentials in an endpoint would end up in logs and error text. Refuse them
  // outright rather than carrying a secret we would then have to redact everywhere.
  if (url.username || url.password) {
    throw new InvalidEndpointError('endpoint must not embed credentials');
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidEndpointError(`invalid port "${url.port}"`);
  }

  return {
    origin: `${url.protocol}//${url.host}`,
    host: bareHost(url.hostname),
    port,
    protocol: url.protocol,
    locality: classifyHost(url.hostname),
  };
}

/** Convenience for the common "is this loopback" question. */
export function isLocalEndpoint(raw: string): boolean {
  try {
    return parseEndpoint(raw).locality === 'local';
  } catch {
    return false;
  }
}
