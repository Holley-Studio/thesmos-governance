// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseArgs, flag, flagVal } from './args.ts';

describe('parseArgs', () => {
  it('returns empty on no args', () => {
    const r = parseArgs([]);
    expect(r.flags).toEqual({});
    expect(r.positionals).toEqual([]);
  });

  it('parses boolean flags', () => {
    const r = parseArgs(['--json', '--dry-run']);
    expect(r.flags).toEqual({ json: true, 'dry-run': true });
    expect(r.positionals).toEqual([]);
  });

  it('parses value flags', () => {
    const r = parseArgs(['--base=main', '--targets=claude,gemini']);
    expect(r.flags['base']).toBe('main');
    expect(r.flags['targets']).toBe('claude,gemini');
  });

  it('collects positionals', () => {
    const r = parseArgs(['src/foo.ts', 'src/bar.ts']);
    expect(r.positionals).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('mixes flags and positionals', () => {
    const r = parseArgs(['--json', 'src/foo.ts', '--base=main']);
    expect(r.flags['json']).toBe(true);
    expect(r.flags['base']).toBe('main');
    expect(r.positionals).toEqual(['src/foo.ts']);
  });

  describe('space-separated values for value-taking flags', () => {
    it('--pack /path/x.zip consumes the next token as the value', () => {
      const r = parseArgs(['--pack', '/path/x.zip']);
      expect(r.flags['pack']).toBe('/path/x.zip');
      expect(r.positionals).toEqual([]);
    });

    it('--pack=/path/x.zip still works (equals syntax preserved)', () => {
      const r = parseArgs(['--pack=/path/x.zip']);
      expect(r.flags['pack']).toBe('/path/x.zip');
      expect(r.positionals).toEqual([]);
    });

    it('--target claude-code consumes the value', () => {
      const r = parseArgs(['--target', 'claude-code']);
      expect(r.flags['target']).toBe('claude-code');
      expect(r.positionals).toEqual([]);
    });

    it('--all --write remain boolean when adjacent', () => {
      const r = parseArgs(['--all', '--write']);
      expect(r.flags['all']).toBe(true);
      expect(r.flags['write']).toBe(true);
      expect(r.positionals).toEqual([]);
    });

    it('--write as final arg is boolean true', () => {
      const r = parseArgs(['--write']);
      expect(r.flags['write']).toBe(true);
    });

    it('boolean flag followed by a positional does not eat it', () => {
      const r = parseArgs(['ares', '--write']);
      expect(r.flags['write']).toBe(true);
      expect(r.positionals).toEqual(['ares']);
    });

    it('--write ares keeps ares as a positional (write is boolean)', () => {
      const r = parseArgs(['--write', 'ares']);
      expect(r.flags['write']).toBe(true);
      expect(r.positionals).toEqual(['ares']);
    });

    it('value flag as final arg falls back to boolean true', () => {
      const r = parseArgs(['--pack']);
      expect(r.flags['pack']).toBe(true);
    });

    it('value flag followed by another flag does not consume it', () => {
      const r = parseArgs(['--pack', '--json']);
      expect(r.flags['pack']).toBe(true);
      expect(r.flags['json']).toBe(true);
    });

    it('mixed: pantheon-style install invocation', () => {
      const r = parseArgs(['--pack', '/tmp/p.zip', '--target', 'claude-code', '--force', 'extra']);
      expect(r.flags['pack']).toBe('/tmp/p.zip');
      expect(r.flags['target']).toBe('claude-code');
      expect(r.flags['force']).toBe(true);
      expect(r.positionals).toEqual(['extra']);
    });
  });
});

describe('flag', () => {
  it('returns true when flag is boolean true', () => {
    expect(flag({ json: true }, 'json')).toBe(true);
  });

  it('returns false when flag absent', () => {
    expect(flag({}, 'json')).toBe(false);
  });

  it('returns false when flag is a string', () => {
    expect(flag({ base: 'main' }, 'base')).toBe(false);
  });
});

describe('flagVal', () => {
  it('returns string value', () => {
    expect(flagVal({ base: 'main' }, 'base')).toBe('main');
  });

  it('returns undefined when absent', () => {
    expect(flagVal({}, 'base')).toBeUndefined();
  });

  it('returns undefined when boolean flag', () => {
    expect(flagVal({ json: true }, 'json')).toBeUndefined();
  });
});
