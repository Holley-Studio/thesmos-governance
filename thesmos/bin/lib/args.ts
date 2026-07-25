// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pure CLI argument parsing — no process.argv access here.
 * Callers pass the slice of argv they want parsed.
 */

export interface ParsedArgs {
  /** Named flags: --foo=bar → { foo: 'bar' }; --bool → { bool: true } */
  flags: Record<string, string | boolean>;
  /** Non-flag arguments (positional file paths, etc.) */
  positionals: string[];
}

/**
 * Flags that take a value. For these, a bare `--flag` followed by a
 * non-flag token consumes that token as its value (`--pack /p.zip`).
 * Boolean flags (--write, --all, --json, …) are deliberately NOT listed:
 * they must never swallow a following positional (`--write ares`).
 * Built from every `flagVal(flags, 'x')` / `flags['x'] as string` usage.
 */
const VALUE_FLAGS = new Set([
  'access',
  'agent',
  'author',
  'base',
  'baseline',
  'blockers',
  'categories',
  'debounce',
  'expires',
  'fail-on',
  'findings',
  'format',
  'health-threshold',
  'history',
  'limit',
  'max',
  'min',
  'next',
  'note',
  'on',
  'out',
  'owner',
  'pack',
  'pr',
  'profile',
  'prompt',
  'provider',
  'reason',
  'repo',
  'report',
  'rule',
  'session',
  'severity',
  'severity-filter',
  'since',
  'status',
  'summary',
  'tag',
  'target',
  'targets',
  'text',
  'threshold',
  'token',
  'verbosity',
  'webhook',
]);

/**
 * Parse an argv slice that has already had the command name stripped.
 * e.g. parseArgs(['--json', '--base=main', 'file.ts'])
 * Value-taking flags accept both `--flag=value` and `--flag value`.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const name = arg.slice(2);
        const next = argv[i + 1];
        if (VALUE_FLAGS.has(name) && next !== undefined && !next.startsWith('-')) {
          flags[name] = next;
          i++; // consume the value token
        } else {
          flags[name] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals };
}

/** Returns true only when the flag was set as a boolean (--flag, no value). */
export function flag(flags: ParsedArgs['flags'], name: string): boolean {
  return flags[name] === true;
}

/** Returns the string value of a flag, or undefined when absent or boolean. */
export function flagVal(flags: ParsedArgs['flags'], name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}
