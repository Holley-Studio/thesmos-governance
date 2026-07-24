// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  tokenizeShellCommand,
  segmentMatchesPhrase,
  commandMatchesPhrase,
  normalizeExecutableName,
} from './shell-command';

describe('tokenizeShellCommand', () => {
  it('splits on whitespace into bare tokens', () => {
    const [seg] = tokenizeShellCommand('rm -rf /tmp/x');
    expect(seg.tokens.map((t) => t.text)).toEqual(['rm', '-rf', '/tmp/x']);
    expect(seg.tokens.every((t) => !t.quoted)).toBe(true);
  });

  it('treats a whole double-quoted argument as one quoted token', () => {
    const [seg] = tokenizeShellCommand('echo "npm publish"');
    expect(seg.tokens).toEqual([
      { text: 'echo', quoted: false },
      { text: 'npm publish', quoted: true },
    ]);
  });

  it('treats a whole single-quoted argument as one quoted token', () => {
    const [seg] = tokenizeShellCommand("echo 'rm -rf'");
    expect(seg.tokens).toEqual([
      { text: 'echo', quoted: false },
      { text: 'rm -rf', quoted: true },
    ]);
  });

  it('reconstructs a token split across a quote boundary as BARE, not quoted (bypass fix)', () => {
    // r"m" -rf must still resolve to the bare token "rm" -- previously,
    // blanking the quoted span broke "rm" into unmatched fragments.
    const [seg] = tokenizeShellCommand('r"m" -rf /');
    expect(seg.tokens[0]).toEqual({ text: 'rm', quoted: false });
  });

  it('resolves backslash-escaped characters outside quotes as bare text', () => {
    const [seg] = tokenizeShellCommand('rm\\ -rf /tmp/x');
    // "rm\ " escapes the space, so "rm -rf" is NOT what's produced here --
    // the escaped space glues "rm" and the next char together as one token.
    expect(seg.tokens[0]!.text.startsWith('rm')).toBe(true);
    expect(seg.tokens[0]!.quoted).toBe(false);
  });

  it('honors double-quote backslash escapes for \\ $ ` "', () => {
    const [seg] = tokenizeShellCommand('echo "say \\"hi\\""');
    expect(seg.tokens[1]).toEqual({ text: 'say "hi"', quoted: true });
  });

  it('treats a bare # as starting a comment to end of string', () => {
    const [seg] = tokenizeShellCommand('echo hello # rm -rf ignored');
    expect(seg.tokens.map((t) => t.text)).toEqual(['echo', 'hello']);
  });

  it('does NOT treat a mid-token # as a comment start', () => {
    const [seg] = tokenizeShellCommand('echo foo#bar');
    expect(seg.tokens.map((t) => t.text)).toEqual(['echo', 'foo#bar']);
  });

  it('splits chained commands on ; && || | & into independent segments', () => {
    const segs = tokenizeShellCommand('echo a; echo b && echo c || echo d | echo e & echo f');
    expect(segs).toHaveLength(6);
    expect(segs.map((s) => s.tokens.map((t) => t.text))).toEqual([
      ['echo', 'a'],
      ['echo', 'b'],
      ['echo', 'c'],
      ['echo', 'd'],
      ['echo', 'e'],
      ['echo', 'f'],
    ]);
  });

  it('does not split chain operators that appear inside quotes', () => {
    const [seg] = tokenizeShellCommand('echo "a && b; c | d"');
    expect(seg.tokens).toEqual([
      { text: 'echo', quoted: false },
      { text: 'a && b; c | d', quoted: true },
    ]);
  });

  it('handles unterminated quotes without throwing (fails toward one reconstructed token)', () => {
    expect(() => tokenizeShellCommand('echo "unterminated')).not.toThrow();
    const [seg] = tokenizeShellCommand('echo "unterminated');
    expect(seg.tokens[1]!.text).toBe('unterminated');
  });
});

describe('normalizeExecutableName', () => {
  it('strips a POSIX directory prefix', () => {
    expect(normalizeExecutableName('/usr/local/bin/npm')).toBe('npm');
  });

  it('strips a Windows directory prefix and .cmd extension', () => {
    expect(normalizeExecutableName('C:\\Program Files\\nodejs\\npm.cmd')).toBe('npm');
  });

  it('strips a bare .exe extension', () => {
    expect(normalizeExecutableName('git.exe')).toBe('git');
  });

  it('leaves a bare name with no path or extension unchanged', () => {
    expect(normalizeExecutableName('npm')).toBe('npm');
  });

  it('does not strip a non-executable-looking extension', () => {
    expect(normalizeExecutableName('my.config.npm')).toBe('my.config.npm');
  });
});

describe('segmentMatchesPhrase / commandMatchesPhrase', () => {
  it('matches the configured phrase as the real, live command', () => {
    expect(commandMatchesPhrase('npm publish --access public', 'npm publish')).toBe(true);
  });

  it('matches with flags between chain and the configured phrase (same segment only)', () => {
    expect(commandMatchesPhrase('rm -rf /tmp/x', 'rm -rf')).toBe(true);
  });

  it('does NOT match when the phrase appears only as inert quoted content (echo)', () => {
    expect(commandMatchesPhrase('echo "npm publish"', 'npm publish')).toBe(false);
  });

  it('does NOT match when the phrase appears only inside a commit message', () => {
    expect(commandMatchesPhrase('git commit -m "removes rm -rf usage"', 'rm -rf')).toBe(false);
  });

  it('does NOT match when the phrase is documentation text passed to another command', () => {
    expect(commandMatchesPhrase('cat <<EOF\nnpm publish\nEOF', 'npm publish')).toBe(false);
  });

  it('does NOT match a phrase appearing only in a file path argument', () => {
    expect(commandMatchesPhrase('cat "./docs/npm publish notes.md"', 'npm publish')).toBe(false);
  });

  it('closes the quote-split bypass: r"m" -rf still matches "rm -rf"', () => {
    expect(commandMatchesPhrase('r"m" -rf /', 'rm -rf')).toBe(true);
  });

  it('matches a Windows-style executable path invoking the configured command', () => {
    expect(commandMatchesPhrase('C:\\Program Files\\nodejs\\npm.cmd publish', 'npm publish')).toBe(true);
  });

  it('matches when a later argument is a quoted path containing spaces', () => {
    expect(commandMatchesPhrase('git push --force "/path with spaces/repo"', 'git push --force')).toBe(true);
  });

  it('matches a chained destructive command even when it is not the first segment', () => {
    expect(commandMatchesPhrase('echo starting && rm -rf /tmp/build', 'rm -rf')).toBe(true);
  });

  it('does not match across a chain boundary (phrase split over two segments)', () => {
    expect(commandMatchesPhrase('npm && publish', 'npm publish')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(commandMatchesPhrase('DROP TABLE users', 'drop table')).toBe(true);
  });

  it('still catches an exact-syntax signature that is itself built from chain-operator characters (fork bomb)', () => {
    // The default destructivePatterns list includes ':(){:|:&};:' verbatim --
    // it has no whitespace, so it can't decompose into segment tokens the
    // way "rm -rf" does. Must not silently stop matching.
    expect(commandMatchesPhrase(':(){:|:&};:', ':(){:|:&};:')).toBe(true);
    expect(commandMatchesPhrase('echo start; :(){:|:&};: # boom', ':(){:|:&};:')).toBe(true);
  });

  it('an exact-syntax signature is still inert when it only appears in a quoted string', () => {
    expect(commandMatchesPhrase('echo "not actually a fork bomb: :(){:|:&};:"', ':(){:|:&};:')).toBe(false);
  });

  it('a normal word-shaped pattern does not use the exotic-syntax fallback (bypass stays fixed)', () => {
    // Regression guard: the fallback must never reopen the quote-adjacency
    // bypass for ordinary word patterns like "rm -rf".
    expect(commandMatchesPhrase('echo "rm -rf"', 'rm -rf')).toBe(false);
  });
});
