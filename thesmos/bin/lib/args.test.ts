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

  it('parses space-separated value flags when declared', () => {
    const r = parseArgs(['--target', 'cursor', '--agent', 'zeus', '--all'], {
      valueFlags: ['target', 'agent'],
    });
    expect(r.flags['target']).toBe('cursor');
    expect(r.flags['agent']).toBe('zeus');
    expect(r.flags['all']).toBe(true);
    expect(r.positionals).toEqual([]);
  });

  it('keeps unknown bare flags boolean so positionals stay positionals', () => {
    const r = parseArgs(['--write', 'zeus-executive-agent']);
    expect(r.flags['write']).toBe(true);
    expect(r.positionals).toEqual(['zeus-executive-agent']);
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
