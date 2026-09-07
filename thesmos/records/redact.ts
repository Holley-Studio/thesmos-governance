// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — redaction at the boundary.
 *
 * Every string entering a record passes through here. That is deliberate: a
 * layer that asks callers to redact before writing will eventually meet a
 * caller that forgets, and the failure is silent and permanent because the
 * journal is append-only.
 *
 * No sanitizer is implemented here. `council/sanitize` already owns secret and
 * absolute-path redaction and is the single source of truth for both; this
 * module composes it with control-character stripping and walks the record
 * structure. The one thing it adds is a *verifier*, so a journal written by an
 * older or buggier build can still be checked.
 */

import {
  REDACTION_PLACEHOLDER,
  containsSecretLike,
  scrubForOutput,
  stripControlChars,
} from '../council/sanitize.js';

/** Bound on any single recorded string. Records are evidence, not transcripts. */
export const MAX_FIELD_LENGTH = 4096;

/** Bound on entries in the `digests` and `links` maps. */
export const MAX_MAP_ENTRIES = 64;

/**
 * Clean one string for storage.
 *
 * Order matters. Secrets and absolute paths are removed first, because
 * `scrubForOutput` matches on shapes that control characters could otherwise
 * split; the control bytes go afterwards, and truncation is last so a bound is
 * applied to what actually gets stored.
 */
export function redactField(value: unknown, root?: string): string {
  if (typeof value !== 'string') return '';
  const scrubbed = stripControlChars(scrubForOutput(value, root));
  return scrubbed.length > MAX_FIELD_LENGTH
    ? `${scrubbed.slice(0, MAX_FIELD_LENGTH - 1)}…`
    : scrubbed;
}

/**
 * Clean a `digests` or `links` map.
 *
 * Keys are normalized to a conservative identifier shape rather than redacted,
 * because a key is a label chosen by the writer; a key that needs redacting is
 * a bug in the caller, and silently rewriting it would hide that.
 */
export function redactMap(
  value: unknown,
  root?: string
): { map: Record<string, string>; dropped: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { map: {}, dropped: [] };

  const out: Record<string, string> = {};
  const dropped: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_MAP_ENTRIES) {
      dropped.push(rawKey);
      continue;
    }
    const key = rawKey.replace(/[^A-Za-z0-9_.-]/g, '');
    if (key === '') {
      dropped.push(rawKey);
      continue;
    }
    out[key] = redactField(rawValue, root);
  }

  return { map: out, dropped };
}

// ── Verification ──────────────────────────────────────────────────────────────

export interface RedactionFinding {
  /** Dotted path into the record. */
  path: string;
  kind: 'secret' | 'absolute-path' | 'control-character';
}

/**
 * Absolute paths, both POSIX and Windows.
 *
 * Checked independently of the redactor so a journal written by a build with a
 * weaker sanitizer is still caught on read. The placeholder is exempt: once a
 * path has been replaced, the replacement itself must not re-trigger.
 */
const ABSOLUTE_PATH_RE = /(^|[\s"'(=[])(\/[A-Za-z0-9._-]+\/|[A-Za-z]:[\\/])/;

function hasControlCharacter(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r') return true;
    if (code === 0x7f) return true;
  }
  return false;
}

/**
 * Walk any value and report what should never have been stored.
 *
 * Used on read as well as on write. A record is evidence, and evidence that
 * quietly contains a credential is worse than no evidence, so this is checked
 * on the way out too rather than trusted because it was checked on the way in.
 */
export function findRedactionViolations(value: unknown, path = ''): RedactionFinding[] {
  const findings: RedactionFinding[] = [];

  const visit = (node: unknown, at: string): void => {
    if (typeof node === 'string') {
      if (hasControlCharacter(node)) findings.push({ path: at, kind: 'control-character' });
      if (containsSecretLike(node)) findings.push({ path: at, kind: 'secret' });
      if (!node.includes(REDACTION_PLACEHOLDER) && ABSOLUTE_PATH_RE.test(node)) {
        findings.push({ path: at, kind: 'absolute-path' });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${at}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(v, at === '' ? k : `${at}.${k}`);
      }
    }
  };

  visit(value, path);
  return findings;
}
