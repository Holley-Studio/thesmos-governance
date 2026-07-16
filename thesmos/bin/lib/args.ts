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

export interface ParseArgsOptions {
  /**
   * Flag names that take a following value when written as `--name value`
   * (in addition to `--name=value`). Boolean flags like `--all` must NOT be listed.
   */
  valueFlags?: readonly string[];
}

/**
 * Parse an argv slice that has already had the command name stripped.
 * e.g. parseArgs(['--json', '--base=main', 'file.ts'])
 * e.g. parseArgs(['--target', 'cursor'], { valueFlags: ['target'] })
 */
export function parseArgs(argv: string[], opts: ParseArgsOptions = {}): ParsedArgs {
  const valueFlags = new Set(opts.valueFlags ?? []);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (valueFlags.has(key) && next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
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
