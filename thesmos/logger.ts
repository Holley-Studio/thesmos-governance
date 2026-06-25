/**
 * Thesmos internal logger — zero dependencies, NDJSON to stderr.
 *
 * Level resolution (highest priority first):
 *   1. THESMOS_LOG_LEVEL env var  (error|warn|info|debug)
 *   2. CI=true                       → error only
 *   3. default                       → warn
 *
 * Never log: file content, token values, secrets, API keys.
 * Log: paths, rule IDs, durations, error messages, counts.
 */

type Level = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function resolveLevel(): Level {
  const env = process.env['THESMOS_LOG_LEVEL']?.toLowerCase();
  if (env === 'error' || env === 'warn' || env === 'info' || env === 'debug') return env;
  if (process.env['CI'] === 'true') return 'error';
  return 'warn';
}

const activeRank: number = LEVEL_RANK[resolveLevel()];

export interface Logger {
  error(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  debug(msg: string, extra?: Record<string, unknown>): void;
  timed<T>(msg: string, fn: () => T, extra?: Record<string, unknown>): T;
}

function write(level: Level, module: string, msg: string, extra?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] > activeRank) return;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    module,
    msg,
    ...extra,
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export function makeLogger(module: string): Logger {
  return {
    error: (msg, extra) => write('error', module, msg, extra),
    warn:  (msg, extra) => write('warn',  module, msg, extra),
    info:  (msg, extra) => write('info',  module, msg, extra),
    debug: (msg, extra) => write('debug', module, msg, extra),

    timed<T>(msg: string, fn: () => T, extra?: Record<string, unknown>): T {
      const t0 = Date.now();
      try {
        const result = fn();
        write('debug', module, msg, { ...extra, durationMs: Date.now() - t0 });
        return result;
      } catch (e) {
        write('error', module, msg, {
          ...extra,
          durationMs: Date.now() - t0,
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
        throw e;
      }
    },
  };
}
