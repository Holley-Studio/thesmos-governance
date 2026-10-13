// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Best-effort classification of Claude CLI auth failures.
 *
 * There is no proactive "is the user logged in" check anywhere in this
 * provider — a live probe would spend a real turn every time a provider card
 * renders. Instead, an auth failure is detected reactively, by pattern-
 * matching the stderr/`result` text a failed turn actually produced. This is
 * inherently fragile: the exact phrasing is Anthropic's to change across CLI
 * versions without notice, and the list below has not yet been validated
 * against a real logged-out session. Unmatched text still surfaces via the
 * generic `unknown` error path — never silently swallowed.
 */

import { ProviderError } from '../../errors.js';

const LOGIN_FAILURE_PATTERNS: RegExp[] = [
  /not logged in/i,
  /please run ['"`]?claude(\s+code)? login/i,
  /\bclaude\s+login\b/i,
  /authenticat(e|ion|ed)?\s+(failed|required|error)/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /invalid api key/i,
  /no active subscription/i,
];

/**
 * Returns an actionable `ProviderError` when `text` looks like a login
 * failure, `undefined` otherwise — the caller falls through to a generic
 * error when nothing matches.
 */
export function classifyClaudeCliFailure(text: string): ProviderError | undefined {
  if (!text) return undefined;
  const matched = LOGIN_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
  if (!matched) return undefined;
  return new ProviderError(
    'unavailable',
    'Not logged in to Claude Code. Run `claude` in a terminal, sign in, then retry.',
    text,
  );
}
