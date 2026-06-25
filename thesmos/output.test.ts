// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  renderJson,
  renderMarkdown,
  applyOutputMode,
  injectGeneratedSection,
  extractGeneratedSection,
} from './output';

describe('renderJson', () => {
  it('writes valid JSON to stdout', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    renderJson({ key: 'value', count: 1 });
    expect(write).toHaveBeenCalledOnce();
    const output = write.mock.calls[0][0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
    expect(JSON.parse(output)).toEqual({ key: 'value', count: 1 });
    write.mockRestore();
  });

  it('pretty-prints with 2-space indent', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    renderJson({ a: 1 });
    const output = write.mock.calls[0][0] as string;
    expect(output).toContain('\n  ');
    write.mockRestore();
  });
});

describe('renderMarkdown', () => {
  it('includes the title', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    renderMarkdown({ count: 3 }, 'My Report');
    const output = write.mock.calls[0][0] as string;
    expect(output).toContain('# My Report');
    write.mockRestore();
  });

  it('includes a datestamp', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    renderMarkdown({}, 'Test');
    const output = write.mock.calls[0][0] as string;
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}/);
    write.mockRestore();
  });
});

describe('applyOutputMode', () => {
  it('returns false when no flags are present', () => {
    expect(applyOutputMode({}, 'Test', [])).toBe(false);
  });

  it('emits JSON and returns true for --json flag', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = applyOutputMode({ x: 1 }, 'Test', ['--json']);
    expect(result).toBe(true);
    const output = write.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual({ x: 1 });
    write.mockRestore();
  });

  it('emits markdown and returns true for --markdown flag', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = applyOutputMode({ count: 5 }, 'Report', ['--markdown']);
    expect(result).toBe(true);
    const output = write.mock.calls[0][0] as string;
    expect(output).toContain('# Report');
    write.mockRestore();
  });

  it('prefers --json over --markdown when both present', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    applyOutputMode({ v: 1 }, 'T', ['--json', '--markdown']);
    const output = write.mock.calls[0][0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
    write.mockRestore();
  });
});

describe('injectGeneratedSection', () => {
  it('appends markers when document has none', () => {
    const result = injectGeneratedSection('# Doc\n\nContent.', 'rules', 'generated text');
    expect(result).toContain('<!-- THESMOS:GENERATED START rules -->');
    expect(result).toContain('generated text');
    expect(result).toContain('<!-- THESMOS:GENERATED END rules -->');
    expect(result).toContain('# Doc');
  });

  it('replaces between existing markers', () => {
    const doc = [
      '# Doc',
      '',
      '<!-- THESMOS:GENERATED START rules -->',
      'old content',
      '<!-- THESMOS:GENERATED END rules -->',
      '',
      'Footer.',
    ].join('\n');
    const result = injectGeneratedSection(doc, 'rules', 'new content');
    expect(result).toContain('new content');
    expect(result).not.toContain('old content');
    expect(result).toContain('Footer.');
    expect(result).toContain('# Doc');
  });

  it('is idempotent — injecting same content twice produces the same output', () => {
    const base = '# Doc\n\nManual.';
    const r1 = injectGeneratedSection(base, 'rules', 'generated');
    const r2 = injectGeneratedSection(r1, 'rules', 'generated');
    expect(r1).toBe(r2);
  });

  it('uses the section id in the markers', () => {
    const result = injectGeneratedSection('', 'my-section', 'content');
    expect(result).toContain('THESMOS:GENERATED START my-section');
    expect(result).toContain('THESMOS:GENERATED END my-section');
  });

  it('preserves content after the end marker', () => {
    const doc = [
      '<!-- THESMOS:GENERATED START rules -->',
      'old',
      '<!-- THESMOS:GENERATED END rules -->',
      'after',
    ].join('\n');
    const result = injectGeneratedSection(doc, 'rules', 'new');
    expect(result).toContain('after');
  });
});

describe('extractGeneratedSection', () => {
  it('returns null when markers are absent', () => {
    expect(extractGeneratedSection('no markers here', 'rules')).toBeNull();
  });

  it('extracts content between markers', () => {
    const doc = [
      'before',
      '<!-- THESMOS:GENERATED START rules -->',
      'extracted content',
      '<!-- THESMOS:GENERATED END rules -->',
      'after',
    ].join('\n');
    expect(extractGeneratedSection(doc, 'rules')).toBe('extracted content');
  });

  it('round-trips with injectGeneratedSection', () => {
    const base = '# Doc';
    const injected = injectGeneratedSection(base, 'rules', 'my rules');
    expect(extractGeneratedSection(injected, 'rules')).toBe('my rules');
  });

  it('returns null when only start marker is present', () => {
    expect(
      extractGeneratedSection('<!-- THESMOS:GENERATED START rules -->', 'rules')
    ).toBeNull();
  });
});
