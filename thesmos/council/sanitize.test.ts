// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Outbound-text safety.
 *
 * The drift test matters most: this module keeps its own credential patterns so
 * it can be pure, which is exactly the setup where two lists quietly diverge and
 * a shape the scanner blocks becomes a shape a report happily prints.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REDACTION_PATTERNS,
  REDACTION_PLACEHOLDER,
  containsSecretLike,
  normalizeStringList,
  redactAbsolutePaths,
  redactSecrets,
  sanitizeText,
  sanitizeToken,
  scrubForOutput,
  stripControlChars,
  toProvenancePath,
} from './sanitize.js';
import { CONFIG_DEFAULTS } from '../config.js';

describe('anti-drift with the scanner’s pattern list', () => {
  it('detects everything CONFIG_DEFAULTS.secretPatterns detects', () => {
    // A representative string for each configured scanner pattern. If a pattern
    // is added to config without an equivalent here, this fails — which is the
    // point: emission must never be laxer than detection.
    const samples: Record<string, string> = {
      'sk-[a-zA-Z0-9-]{20,}': 'sk-abcdefghijklmnopqrstuvwxyz',
      'eyJ[a-zA-Z0-9+/]{20,}={0,2}\\.': 'eyJhbGciOiJIUzI1NiIsInR5cCI6.payload.signature',
      '-----BEGIN[^-]+PRIVATE KEY-----':
        '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
      'secret_access_key\\s*[:=]\\s*[A-Za-z0-9/+]{20,}':
        'secret_access_key=abcdefghijklmnopqrstuvwx',
      'AAAA[0-9A-Za-z+/]{40,}': `AAAA${'a'.repeat(45)}`,
    };

    for (const pattern of CONFIG_DEFAULTS.secretPatterns) {
      const sample = samples[pattern];
      expect(sample, `no sample for configured pattern ${pattern} — add one`).toBeDefined();
      expect(containsSecretLike(sample!), `council redaction misses ${pattern}`).toBe(true);
    }
  });
});

describe('secret redaction', () => {
  it.each([
    ['github token', 'ghp_0123456789abcdefghijABCDEF'],
    ['github pat', 'github_pat_0123456789abcdefghij0123'],
    ['openai key', 'sk-abcdefghijklmnopqrstuvwxyz'],
    ['aws access key', 'AKIAIOSFODNN7EXAMPLE'],
    ['google key', 'AIzaSyA0123456789abcdefghijklmnopqrs'],
    ['slack token', 'xoxb-123456789012-abcdefghij'],
    ['bearer token', 'Bearer abcdefghijklmnopqrstuvwxyz'],
    ['assigned password', 'password: hunter2hunter2'],
  ])('redacts a %s', (_label, secret) => {
    const text = `before ${secret} after`;
    expect(containsSecretLike(text)).toBe(true);
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain(REDACTION_PLACEHOLDER);
  });

  it('leaves ordinary text alone', () => {
    for (const text of ['npm test', 'src/app.ts changed', 'no findings']) {
      expect(containsSecretLike(text), text).toBe(false);
      expect(redactSecrets(text)).toBe(text);
    }
  });

  it('survives a malformed configured pattern instead of failing open', () => {
    const patterns = ['([unclosed', 'ghp_[A-Za-z0-9]{16,}'];
    expect(redactSecrets('ghp_0123456789abcdefghijABCDEF', patterns)).toContain(REDACTION_PLACEHOLDER);
  });
});

describe('machine-path redaction', () => {
  it.each([
    ['/Users/someone/repo/file.ts', 'someone'],
    ['/home/someone/repo/file.ts', 'someone'],
    ['C:\\Users\\someone\\repo\\file.ts', 'someone'],
  ])('strips the operator name from %s', (path, name) => {
    expect(redactAbsolutePaths(path)).not.toContain(name);
  });

  it('strips a supplied repo root', () => {
    expect(redactAbsolutePaths('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
  });

  it('scrubs secrets and paths together', () => {
    const result = scrubForOutput('/Users/someone/x.ts uses sk-abcdefghijklmnopqrstuvwxyz');
    expect(result).not.toContain('someone');
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });
});

describe('provenance paths', () => {
  it('relativizes a path under the root', () => {
    expect(toProvenancePath('/repo/.thesmos/agents/a.md', '/repo')).toBe('.thesmos/agents/a.md');
  });

  it('keeps the shape of a home path with the username removed', () => {
    expect(toProvenancePath('/Users/someone/.claude/agents/a.md', '/repo')).toBe(
      '~/.claude/agents/a.md'
    );
  });

  it('degrades an unrelated absolute path to its basename', () => {
    expect(toProvenancePath('/opt/vendor/secret-layout/a.md', '/repo')).toBe('a.md');
  });

  it('normalizes Windows separators', () => {
    expect(toProvenancePath('.thesmos\\agents\\a.md')).toBe('.thesmos/agents/a.md');
  });
});

describe('text sanitization', () => {
  it('removes control characters and ANSI sequences', () => {
    const esc = String.fromCharCode(27);
    expect(sanitizeText(`${esc}[31mred${esc}[0m`)).toBe('red');
    expect(stripControlChars(`a${String.fromCharCode(0)}b`)).toBe('ab');
  });

  it('keeps tabs and newlines as whitespace rather than deleting the words around them', () => {
    expect(sanitizeText('one\ttwo\nthree')).toBe('one two three');
  });

  it('neutralizes generated-section markers and comment terminators', () => {
    const result = sanitizeText('--> <!-- THESMOS:GENERATED START rules --> injected');
    expect(result).not.toContain('THESMOS:GENERATED');
    expect(result).not.toContain('-->');
  });

  it('strips HTML tags and code fences', () => {
    expect(sanitizeText('<script>x</script> hi')).not.toContain('<script>');
    expect(sanitizeText('```js\nx\n```')).not.toContain('```');
  });

  it('collapses to a single line so it cannot introduce Markdown structure', () => {
    expect(sanitizeText('# Heading\n- item\n| table |')).not.toContain('\n');
  });

  it('truncates at the requested length', () => {
    expect(sanitizeText('x'.repeat(500), 100).length).toBeLessThanOrEqual(100);
  });

  it('unwraps a symmetric quote pair left by the frontmatter parser', () => {
    expect(sanitizeText('"quoted value"')).toBe('quoted value');
    expect(sanitizeText('"unbalanced')).toBe('"unbalanced');
  });
});

describe('token normalization', () => {
  it('lower-cases and kebab-safes a token', () => {
    expect(sanitizeToken('  Threat Modeling ')).toBe('threat-modeling');
    expect(sanitizeToken('"quoted"')).toBe('quoted');
  });

  it('deduplicates and sorts a list', () => {
    expect(normalizeStringList(['b', 'A', 'b', ''])).toEqual(['a', 'b']);
  });

  it('returns an empty list for non-arrays', () => {
    expect(normalizeStringList('not an array')).toEqual([]);
    expect(normalizeStringList(undefined)).toEqual([]);
  });

  it('bounds an absurdly long list', () => {
    expect(normalizeStringList(Array.from({ length: 500 }, (_, i) => `t${i}`), 10).length).toBe(10);
  });
});
