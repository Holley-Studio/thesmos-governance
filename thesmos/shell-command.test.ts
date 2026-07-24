// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  tokenizeShellCommand,
  segmentMatchesPhrase,
  commandMatchesPhrase,
  normalizeExecutableName,
  analyzeCommand,
  resolveInvocation,
  findStringPayload,
  commandInvokesDelete,
  commandInvokesGitPush,
  commandInvokesDatabaseWrite,
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

  it('matches "npm publish" across a boolean global flag (npm --silent publish)', () => {
    expect(commandMatchesPhrase('npm --silent publish', 'npm publish')).toBe(true);
  });

  it('matches "git push" across a value-taking global flag and its value (git -C ./repo push)', () => {
    expect(commandMatchesPhrase('git -C ./repo push origin main', 'git push')).toBe(true);
  });
});

// ── Heredoc header chaining (a real bypass: text after <<DELIM on the same
// line, including a chained command, was previously discarded along with
// the body it introduces) ────────────────────────────────────────────────────

describe('heredoc header chaining', () => {
  it('still flags a destructive command chained after a heredoc header on the same line', () => {
    // Bash executes `rm -rf` here — only "body" (the heredoc's actual
    // stdin payload) is data. This must be detected as destructive.
    const cmd = 'cat <<EOF; rm -rf /tmp/example\nbody\nEOF';
    expect(commandMatchesPhrase(cmd, 'rm -rf')).toBe(true);
  });

  it('produces two independent segments: the heredoc-fed command and the chained command', () => {
    const segs = tokenizeShellCommand('cat <<EOF; rm -rf /tmp/example\nbody\nEOF');
    expect(segs.map((s) => s.tokens.map((t) => t.text))).toEqual([
      ['cat'],
      ['rm', '-rf', '/tmp/example'],
    ]);
  });

  it('only the heredoc BODY is excluded — a command on the line AFTER a clean terminator is live', () => {
    // The terminator line must be exactly the delimiter (real bash rule) —
    // "EOF" alone terminates the heredoc; "git push" on the FOLLOWING line
    // is a separate, subsequent statement, not body text.
    const cmd = 'cat <<EOF\nnpm publish\nEOF\ngit push origin main';
    expect(commandMatchesPhrase(cmd, 'npm publish')).toBe(false);
    expect(commandMatchesPhrase(cmd, 'git push')).toBe(true);
  });

  it('text sharing a line with the terminator does NOT cleanly end the heredoc (matches real bash: the terminator must be alone on its line)', () => {
    // "EOF; git push" is not a bare "EOF" line, so this is actually an
    // unterminated heredoc in real bash too — everything through end of
    // string stays body/inert. Conservative and correct, not a bypass.
    const cmd = 'cat <<EOF\nnpm publish\nEOF; git push origin main';
    expect(commandMatchesPhrase(cmd, 'git push')).toBe(false);
  });

  it('still treats the heredoc body itself as inert even with chaining on the header line', () => {
    const cmd = 'cat <<EOF; echo hi\nrm -rf /tmp/example\nEOF';
    // "rm -rf" only appears inside the body — never a live command here.
    expect(commandMatchesPhrase(cmd, 'rm -rf')).toBe(false);
  });

  it('handles an unterminated heredoc by consuming to end-of-string (never misparses a later line as live)', () => {
    const cmd = 'cat <<EOF\nrm -rf /tmp/example';
    expect(commandMatchesPhrase(cmd, 'rm -rf')).toBe(false);
    // Sanity: the earlier "cat" segment is still produced.
    const segs = tokenizeShellCommand(cmd);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.tokens.map((t) => t.text)).toEqual(['cat']);
  });

  it('consumes multiple heredocs opened on the same line in order before resuming', () => {
    const cmd = 'diff <<A <<B; rm -rf /tmp/example\nbodyA\nA\nbodyB\nB';
    expect(commandMatchesPhrase(cmd, 'rm -rf')).toBe(true);
    const segs = tokenizeShellCommand(cmd);
    expect(segs.map((s) => s.tokens.map((t) => t.text))).toEqual([
      ['diff'],
      ['rm', '-rf', '/tmp/example'],
    ]);
  });
});

// ── Interpreter and database-client string payloads ──────────────────────────

describe('interpreter payload recognition', () => {
  it('bash -c "..." payload is recursively analyzed, not inert', () => {
    expect(commandMatchesPhrase('bash -c "rm -rf /tmp/example"', 'rm -rf')).toBe(true);
  });

  it('sh -c \'...\' payload is recursively analyzed', () => {
    expect(commandMatchesPhrase("sh -c 'git push origin main'", 'git push')).toBe(true);
  });

  it('zsh -c "..." payload is recursively analyzed', () => {
    expect(commandMatchesPhrase('zsh -c "npm publish"', 'npm publish')).toBe(true);
  });

  it('cmd /c "..." payload is recursively analyzed', () => {
    const { segments } = analyzeCommand('cmd /c "del /s /q build"');
    const bareWords = segments.flatMap((s) => s.tokens.filter((t) => !t.quoted).map((t) => t.text.toLowerCase()));
    expect(bareWords).toContain('del');
  });

  it('powershell -Command "..." payload is recursively analyzed', () => {
    const { segments } = analyzeCommand('powershell -Command "Remove-Item -Recurse build"');
    const bareWords = segments.flatMap((s) => s.tokens.filter((t) => !t.quoted).map((t) => t.text.toLowerCase()));
    expect(bareWords).toContain('remove-item');
  });

  it('pwsh -Command "..." payload is recursively analyzed', () => {
    expect(commandMatchesPhrase('pwsh -Command "git push origin main"', 'git push')).toBe(true);
  });

  it('quoted arguments to echo remain inert (not treated as an interpreter payload)', () => {
    expect(commandMatchesPhrase('echo "rm -rf /tmp"', 'rm -rf')).toBe(false);
  });

  it('quoted commit messages remain inert', () => {
    expect(commandMatchesPhrase('git commit -m "bash -c rm -rf mentioned here"', 'rm -rf')).toBe(false);
  });

  it('quoted ordinary file paths remain inert', () => {
    expect(commandMatchesPhrase('cat "./scripts/rm -rf notes.md"', 'rm -rf')).toBe(false);
  });

  it('quoted documentation text passed to an unrecognized command remains inert', () => {
    expect(commandMatchesPhrase('some-doc-tool "npm publish is documented here"', 'npm publish')).toBe(false);
  });

  it('recognizes a nested interpreter payload two levels deep', () => {
    const cmd = 'bash -c "bash -c \\"rm -rf /tmp/example\\""';
    expect(commandMatchesPhrase(cmd, 'rm -rf')).toBe(true);
  });

  it('finds a database-write pattern nested inside a shell interpreter payload', () => {
    const cmd = 'bash -c "psql -c \'DROP TABLE users\'"';
    expect(commandInvokesDatabaseWrite(cmd)).toBe(true);
  });
});

// ── Recursion depth and payload size limits (fail closed on ambiguity) ───────

describe('bounded recursive analysis — depth and size limits', () => {
  /** Wraps `inner` in N layers of `bash -c "..."`, correctly re-escaping
   *  embedded quotes for each additional outer layer. */
  function nestBashC(inner: string, levels: number): string {
    let cmd = inner;
    for (let i = 0; i < levels; i++) {
      const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      cmd = `bash -c "${escaped}"`;
    }
    return cmd;
  }

  it('resolves fully within the depth budget (3 levels of bash -c nesting)', () => {
    const cmd = nestBashC('rm -rf /tmp/example', 3);
    const analysis = analyzeCommand(cmd);
    expect(analysis.ambiguous).toBe(false);
    expect(commandMatchesPhrase(cmd, 'rm -rf')).toBe(true);
  });

  it('marks the analysis ambiguous once nesting exceeds the depth budget', () => {
    const cmd = nestBashC('rm -rf /tmp/example', 4);
    const analysis = analyzeCommand(cmd);
    expect(analysis.ambiguous).toBe(true);
  });

  it('an ambiguous (too-deep) analysis is treated as a match by commandMatchesPhrase — fail closed', () => {
    const cmd = nestBashC('echo hello', 4); // no destructive text anywhere, but too deep to prove it
    expect(commandMatchesPhrase(cmd, 'rm -rf')).toBe(true);
  });

  it('an ambiguous (too-deep) analysis is treated as a match by commandInvokesDelete/GitPush/DatabaseWrite', () => {
    const cmd = nestBashC('echo hello', 4);
    expect(commandInvokesDelete(cmd)).toBe(true);
    expect(commandInvokesGitPush(cmd)).toBe(true);
    expect(commandInvokesDatabaseWrite(cmd)).toBe(true);
  });

  it('marks the analysis ambiguous when a single payload exceeds the size limit', () => {
    const bigPayload = 'echo ' + 'x'.repeat(5000);
    const cmd = `bash -c "${bigPayload}"`;
    const analysis = analyzeCommand(cmd);
    expect(analysis.ambiguous).toBe(true);
  });

  it('a normal, small payload is well under the size limit and resolves normally', () => {
    const cmd = 'bash -c "echo hello"';
    const analysis = analyzeCommand(cmd);
    expect(analysis.ambiguous).toBe(false);
  });
});

// ── resolveInvocation / findStringPayload (unit-level, used by scope.ts) ─────

describe('resolveInvocation', () => {
  it('resolves the bare executable at position 0', () => {
    const [seg] = tokenizeShellCommand('rm -rf /tmp/x');
    expect(resolveInvocation(seg!)).toEqual({ executable: 'rm', index: 0 });
  });

  it('resolves a POSIX absolute path executable', () => {
    const [seg] = tokenizeShellCommand('/bin/rm -rf ./build');
    expect(resolveInvocation(seg!)).toEqual({ executable: 'rm', index: 0 });
  });

  it('skips a single wrapper (sudo) to find the real executable', () => {
    const [seg] = tokenizeShellCommand('sudo rm -rf ./build');
    expect(resolveInvocation(seg!)).toEqual({ executable: 'rm', index: 1 });
  });

  it('skips env and its assignment to find the real executable', () => {
    const [seg] = tokenizeShellCommand('env FOO=bar rm -rf ./build');
    expect(resolveInvocation(seg!)).toEqual({ executable: 'rm', index: 2 });
  });

  it('skips command wrapper', () => {
    const [seg] = tokenizeShellCommand('command rm -rf ./build');
    expect(resolveInvocation(seg!)).toEqual({ executable: 'rm', index: 1 });
  });

  it('skips chained wrappers (sudo env)', () => {
    const [seg] = tokenizeShellCommand('sudo env rm -rf ./build');
    expect(resolveInvocation(seg!)).toEqual({ executable: 'rm', index: 2 });
  });

  it('returns null when the segment is empty', () => {
    expect(resolveInvocation({ tokens: [] })).toBeNull();
  });

  it('returns null when the first token is fully quoted', () => {
    const [seg] = tokenizeShellCommand('"rm" -rf ./build');
    expect(resolveInvocation(seg!)).toBeNull();
  });
});

describe('findStringPayload', () => {
  it('returns the reconstructed payload text after a recognized flag', () => {
    const [seg] = tokenizeShellCommand('bash -c "rm -rf /tmp"');
    const invocation = resolveInvocation(seg!)!;
    expect(findStringPayload(seg!, invocation)).toBe('rm -rf /tmp');
  });

  it('returns null for an executable with no recognized string-payload flags', () => {
    const [seg] = tokenizeShellCommand('echo "rm -rf /tmp"');
    const invocation = resolveInvocation(seg!)!;
    expect(findStringPayload(seg!, invocation)).toBeNull();
  });

  it('returns null when the recognized flag has no following token', () => {
    const [seg] = tokenizeShellCommand('bash -c');
    const invocation = resolveInvocation(seg!)!;
    expect(findStringPayload(seg!, invocation)).toBeNull();
  });
});
