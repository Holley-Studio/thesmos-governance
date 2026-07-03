// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { stripGeneratedRegions } from './helpers';

describe('stripGeneratedRegions', () => {
  it('removes content between THESMOS:GENERATED markers, preserving line count', () => {
    const content = [
      '# Title',
      '<!-- THESMOS:GENERATED START rules -->',
      '| [AGNT_037] | `agent_context_1m_unguarded` | [1m] model variant |',
      'process.env.SECRET = "leak";',
      '<!-- THESMOS:GENERATED END rules -->',
      'trailing line',
    ].join('\n');

    const stripped = stripGeneratedRegions(content);
    const lines = stripped.split('\n');
    expect(lines).toHaveLength(6); // line count preserved
    expect(lines[0]).toBe('# Title');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('');
    expect(lines[5]).toBe('trailing line');
    expect(stripped).not.toContain('[1m]');
    expect(stripped).not.toContain('process.env.SECRET');
  });

  it('strips to end of file when the START marker is unclosed', () => {
    const content = [
      'kept',
      '<!-- THESMOS:GENERATED START rules -->',
      'generated one',
      'generated two',
    ].join('\n');

    const stripped = stripGeneratedRegions(content);
    const lines = stripped.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('kept');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('');
  });

  it('handles multiple marker pairs', () => {
    const content = [
      'a',
      '<!-- THESMOS:GENERATED START one -->',
      'gen1',
      '<!-- THESMOS:GENERATED END one -->',
      'b',
      '<!-- THESMOS:GENERATED START two -->',
      'gen2',
      '<!-- THESMOS:GENERATED END two -->',
      'c',
    ].join('\n');

    const stripped = stripGeneratedRegions(content);
    expect(stripped.split('\n')).toHaveLength(9);
    expect(stripped).not.toContain('gen1');
    expect(stripped).not.toContain('gen2');
    expect(stripped).toContain('a');
    expect(stripped).toContain('b');
    expect(stripped).toContain('c');
  });

  it('returns content unchanged when no markers are present', () => {
    const content = 'line one\nline two\nline three';
    expect(stripGeneratedRegions(content)).toBe(content);
  });
});
