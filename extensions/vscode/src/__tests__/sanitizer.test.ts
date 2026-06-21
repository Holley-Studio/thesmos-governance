import { describe, it, expect } from 'vitest';
import { sanitizeShellArg, sanitizeBranchName, sanitizeId } from '../commands.js';

describe('sanitizeShellArg', () => {
  it('passes clean strings through unchanged', () => {
    expect(sanitizeShellArg('hello world')).toBe('hello world');
    expect(sanitizeShellArg('path/to/file.ts')).toBe('path/to/file.ts');
  });

  it('strips backticks', () => {
    expect(sanitizeShellArg('foo`bar`baz')).toBe('foobarbaz');
  });

  it('strips dollar signs', () => {
    expect(sanitizeShellArg('$HOME/path')).toBe('HOME/path');
    expect(sanitizeShellArg('$(rm -rf /)')).toBe('(rm -rf /)');
  });

  it('strips newlines', () => {
    expect(sanitizeShellArg('foo\nbar')).toBe('foobar');
    expect(sanitizeShellArg('foo\r\nbar')).toBe('foobar');
  });

  it('escapes double-quotes', () => {
    expect(sanitizeShellArg('say "hello"')).toBe('say \\"hello\\"');
  });

  it('handles empty string', () => {
    expect(sanitizeShellArg('')).toBe('');
  });
});

describe('sanitizeBranchName', () => {
  it('allows alphanumerics, slashes, hyphens, dots, and underscores', () => {
    expect(sanitizeBranchName('feat/my-feature_v1.0')).toBe('feat/my-feature_v1.0');
  });

  it('strips shell metacharacters', () => {
    expect(sanitizeBranchName('feat;rm -rf /')).toBe('featrm-rf/');
  });

  it('strips spaces', () => {
    expect(sanitizeBranchName('my branch')).toBe('mybranch');
  });

  it('handles empty string', () => {
    expect(sanitizeBranchName('')).toBe('');
  });
});

describe('sanitizeId', () => {
  it('allows alphanumerics, hyphens, and underscores', () => {
    expect(sanitizeId('20240101-1200')).toBe('20240101-1200');
    expect(sanitizeId('session_abc-123')).toBe('session_abc-123');
  });

  it('strips shell metacharacters', () => {
    expect(sanitizeId('id;rm -rf /')).toBe('idrm-rf');
  });

  it('strips slashes and dots', () => {
    expect(sanitizeId('../etc/passwd')).toBe('etcpasswd');
  });

  it('handles empty string', () => {
    expect(sanitizeId('')).toBe('');
  });
});
