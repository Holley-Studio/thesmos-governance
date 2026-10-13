import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const io = vi.hoisted(() => ({
  answers: [] as string[],
  execFileSync: vi.fn(),
  execSync: vi.fn(),
  closed: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execFileSync: io.execFileSync, execSync: io.execSync }));
vi.mock('node:readline', () => ({
  createInterface: () => ({
    question: (_prompt: string, answer: (value: string) => void) => {
      if (!io.answers.length) throw new Error('Unexpected wizard question');
      answer(io.answers.shift()!);
    },
    close: io.closed,
  }),
}));
import { cmdCommitCreate, cmdCommitLint, parseCommitLintArgs } from './commit-lint.js';

let root: string;
let output: string;
let priorExit: typeof process.exitCode;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos commit literal '));
  output = '';
  priorExit = process.exitCode;
  process.exitCode = undefined;
  io.answers = [];
  io.execFileSync.mockReset();
  io.execSync.mockReset();
  io.closed.mockReset();
  io.execFileSync.mockReturnValue('feat: last message\n');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = priorExit;
  rmSync(root, { recursive: true, force: true });
});

describe('commit command boundaries', () => {
  it('rejects ambiguous sources and retains an explicitly delimited file path', () => {
    expect(() => parseCommitLintArgs(['--last', '-m', 'fix: inline'])).toThrow(/one.*source/);
    expect(() => parseCommitLintArgs(['--message'])).toThrow(/requires/);
    expect(parseCommitLintArgs(['--json', '--', '-message.txt'])).toMatchObject({
      json: true,
      file: '-message.txt',
    });
    expect(parseCommitLintArgs(['--message=feat: literal'])).toMatchObject({
      message: 'feat: literal',
    });
  });
  it.each(['--message', '-m'])(
    'accepts %s without treating message content as a file or shell command',
    async (flag) => {
      const message =
        'fix: preserve "quotes" `ticks` $(commands) café\n\nUnicode Ω remains literal';
      await cmdCommitLint([flag, message, '--json']);
      expect(JSON.parse(output).message).toBe(message.split('\n')[0]);
      expect(io.execFileSync).not.toHaveBeenCalled();
      expect(io.execSync).not.toHaveBeenCalled();
    }
  );
  it('reads the last commit without a shell', async () => {
    await cmdCommitLint(['--last', '--json']);
    expect(io.execFileSync).toHaveBeenCalledWith(
      'git',
      ['log', '-1', '--format=%B'],
      expect.objectContaining({ cwd: root, encoding: 'utf8' })
    );
    expect(io.execSync).not.toHaveBeenCalled();
  });
  it('passes the complete message to a mocked Git process through stdin', async () => {
    io.answers = [
      '2',
      '',
      '',
      'keep "quotes" `ticks` $(commands) café',
      'Line one Ω',
      'Line two',
      '',
      '',
      'y',
    ];
    await cmdCommitCreate(['--commit']);
    expect(io.execFileSync).toHaveBeenCalledWith(
      'git',
      ['commit', '--file=-'],
      expect.objectContaining({
        cwd: root,
        input: 'fix: keep "quotes" `ticks` $(commands) café\n\nLine one Ω\nLine two',
      })
    );
    expect(io.execSync).not.toHaveBeenCalled();
    expect(io.closed).toHaveBeenCalled();
  });
  it('never runs Git when a generated message violates a blocking rule', async () => {
    io.answers = ['1', '', 'y', 'change interface', '', '', '', 'y'];
    await cmdCommitCreate(['--commit']);
    expect(io.execFileSync).not.toHaveBeenCalled();
    expect(io.execSync).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
