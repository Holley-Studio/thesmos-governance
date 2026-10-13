// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * ClaudeCliProvider tests.
 *
 * Everything runs against an injected `spawn`, so the suite never needs a
 * real `claude` binary or a real subprocess. The fake child process is a
 * plain EventEmitter shaped like the slice of `ChildProcess` the provider
 * actually touches (stdout/stderr streams, stdin.write, kill, exitCode).
 */
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { RuntimeEvent } from '../../types.js';
import { ClaudeCliProvider, CLAUDE_CLI_PROVIDER_ID } from './provider.js';

interface FakeChildProcess extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (enc: string) => void };
  stderr: EventEmitter & { setEncoding: (enc: string) => void };
  stdin: { write: (data: string) => boolean; writes: string[] };
  exitCode: number | null;
  kill: (signal?: string) => boolean;
}

function createFakeProcess(): FakeChildProcess {
  const proc = new EventEmitter() as FakeChildProcess;
  const stdout = new EventEmitter() as FakeChildProcess['stdout'];
  stdout.setEncoding = vi.fn();
  const stderr = new EventEmitter() as FakeChildProcess['stderr'];
  stderr.setEncoding = vi.fn();
  proc.stdout = stdout;
  proc.stderr = stderr;
  const writes: string[] = [];
  proc.stdin = {
    writes,
    write: vi.fn((data: string) => {
      writes.push(data);
      return true;
    }),
  };
  proc.exitCode = null;
  proc.kill = vi.fn(() => {
    proc.exitCode = 0;
    return true;
  });
  return proc;
}

function collect(): { events: RuntimeEvent[]; sink: (e: RuntimeEvent) => void } {
  const events: RuntimeEvent[] = [];
  return { events, sink: (e) => events.push(e) };
}

function streamJsonLine(payload: Record<string, unknown>): string {
  return JSON.stringify(payload) + '\n';
}

describe('ClaudeCliProvider identity', () => {
  it('identifies itself as a subscription-backed cli provider', () => {
    const provider = new ClaudeCliProvider();
    expect(provider.id).toBe(CLAUDE_CLI_PROVIDER_ID);
    expect(provider.kind).toBe('cli');
  });
});

describe('ClaudeCliProvider health', () => {
  it('reports available when claude --version launches and exits', async () => {
    const fakeProc = createFakeProcess();
    const spawnImpl = vi.fn(() => fakeProc) as unknown as typeof import('node:child_process').spawn;
    const provider = new ClaudeCliProvider({
      spawnImpl,
      resolveBinaryImpl: () => '/usr/local/bin/claude',
    });

    const healthPromise = provider.health();
    fakeProc.emit('exit', 0);
    const health = await healthPromise;

    expect(health.available).toBe(true);
    expect(health.locality).toBe('local');
    expect(spawnImpl).toHaveBeenCalledWith('/usr/local/bin/claude', ['--version'], expect.anything());
  });

  it('reports unavailable with an actionable message when the binary is missing', async () => {
    const fakeProc = createFakeProcess();
    const spawnImpl = vi.fn(() => fakeProc) as unknown as typeof import('node:child_process').spawn;
    const provider = new ClaudeCliProvider({ spawnImpl, resolveBinaryImpl: () => 'claude' });

    const healthPromise = provider.health();
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    fakeProc.emit('error', enoent);
    const health = await healthPromise;

    expect(health.available).toBe(false);
    expect(health.errorCode).toBe('unavailable');
    expect(health.detail).toMatch(/not found on path/i);
  });

  it('never rejects, matching every other provider health() contract', async () => {
    const spawnImpl = vi.fn(() => {
      throw new Error('boom');
    }) as unknown as typeof import('node:child_process').spawn;
    const provider = new ClaudeCliProvider({ spawnImpl, resolveBinaryImpl: () => 'claude' });

    await expect(provider.health()).resolves.toMatchObject({ available: false });
  });

  /**
   * Regression: Node throws EINVAL rather than spawning a `.cmd` without a
   * shell (CVE-2024-27980 mitigation). The resolver prefers the native
   * `.exe`, but an install that ships only a shim still has to launch.
   */
  it('spawns a .cmd shim through a shell, and a native .exe without one', async () => {
    const shimProc = createFakeProcess();
    const shimSpawn = vi.fn(() => shimProc) as unknown as typeof import('node:child_process').spawn;
    const shimHealth = new ClaudeCliProvider({
      spawnImpl: shimSpawn,
      resolveBinaryImpl: () => 'C:\\scoop\\shims\\claude.cmd',
    }).health();
    shimProc.emit('exit', 0);
    await shimHealth;
    expect(shimSpawn).toHaveBeenCalledWith(
      'C:\\scoop\\shims\\claude.cmd',
      ['--version'],
      expect.objectContaining({ shell: true }),
    );

    const exeProc = createFakeProcess();
    const exeSpawn = vi.fn(() => exeProc) as unknown as typeof import('node:child_process').spawn;
    const exeHealth = new ClaudeCliProvider({
      spawnImpl: exeSpawn,
      resolveBinaryImpl: () => 'C:\\npm\\claude.exe',
    }).health();
    exeProc.emit('exit', 0);
    await exeHealth;
    expect(exeSpawn).toHaveBeenCalledWith(
      'C:\\npm\\claude.exe',
      ['--version'],
      expect.objectContaining({ shell: false }),
    );
  });
});

describe('ClaudeCliProvider listModels', () => {
  it('returns an empty list — no cheap way to enumerate a subscription session', async () => {
    const provider = new ClaudeCliProvider();
    await expect(provider.listModels()).resolves.toEqual([]);
  });
});

describe('ClaudeCliSession send', () => {
  function createSession(fakeProc: FakeChildProcess) {
    const spawnImpl = vi.fn(() => fakeProc) as unknown as typeof import('node:child_process').spawn;
    const provider = new ClaudeCliProvider({
      spawnImpl,
      resolveBinaryImpl: () => '/usr/local/bin/claude',
    });
    const { events, sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp/project', onEvent: sink });
    return { session, events, spawnImpl, fakeProc };
  }

  it('spawns with --permission-mode plan, writes stdin, and normalizes a full turn', () => {
    const fakeProc = createFakeProcess();
    const { session, events, spawnImpl } = createSession(fakeProc);

    session.send('review this diff');

    expect(spawnImpl).toHaveBeenCalledWith(
      '/usr/local/bin/claude',
      expect.arrayContaining(['--permission-mode', 'plan']),
      expect.objectContaining({ cwd: '/tmp/project' }),
    );
    expect(fakeProc.stdin.writes).toHaveLength(1);
    expect(JSON.parse(fakeProc.stdin.writes[0])).toMatchObject({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'review this diff' }] },
    });

    fakeProc.stdout.emit(
      'data',
      streamJsonLine({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-sonnet-5' }) +
        streamJsonLine({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Looks ' } },
        }) +
        streamJsonLine({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'good.' } },
        }) +
        streamJsonLine({ type: 'result', is_error: false, total_cost_usd: 0.01, duration_ms: 900 }),
    );

    expect(session.id).toBe('sess-1');
    expect(events.filter((e) => e.kind === 'textDelta').map((e) => (e as { text: string }).text)).toEqual([
      'Looks ',
      'good.',
    ]);
    const done = events.find((e) => e.kind === 'turnDone') as { isError: boolean; costUsd?: number };
    expect(done).toMatchObject({ isError: false, costUsd: 0.01 });
  });

  it('ignores non-JSON noise on stdout instead of throwing', () => {
    const fakeProc = createFakeProcess();
    const { session, events } = createSession(fakeProc);

    session.send('hi');
    fakeProc.stdout.emit('data', 'not json at all\n');
    fakeProc.stdout.emit('data', streamJsonLine({ type: 'result', is_error: false }));

    expect(events.find((e) => e.kind === 'turnDone')).toBeDefined();
  });

  it('reassembles a stream-json frame split across chunk boundaries', () => {
    const fakeProc = createFakeProcess();
    const { session, events } = createSession(fakeProc);
    session.send('hi');

    const line = streamJsonLine({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'alpha' } },
    });
    fakeProc.stdout.emit('data', line.slice(0, 15));
    fakeProc.stdout.emit('data', line.slice(15));

    expect(events.filter((e) => e.kind === 'textDelta').map((e) => (e as { text: string }).text)).toEqual(['alpha']);
  });

  it('classifies a login-failure stderr chunk into an actionable message', () => {
    const fakeProc = createFakeProcess();
    const { session, events } = createSession(fakeProc);
    session.send('hi');

    fakeProc.stderr.emit('data', 'Error: not logged in. Please run `claude login` first.\n');

    const stderrEvent = events.find((e) => e.kind === 'stderr') as { text: string };
    expect(stderrEvent.text).toMatch(/not logged in to claude code/i);
    expect(stderrEvent.text).not.toContain('Please run `claude login`');
  });

  it('passes through unrecognized stderr text verbatim', () => {
    const fakeProc = createFakeProcess();
    const { session, events } = createSession(fakeProc);
    session.send('hi');

    fakeProc.stderr.emit('data', 'some unrelated warning\n');

    const stderrEvent = events.find((e) => e.kind === 'stderr') as { text: string };
    expect(stderrEvent.text).toBe('some unrelated warning');
  });

  it('reports actionable stderr and an exit event when the binary fails to launch', () => {
    const fakeProc = createFakeProcess();
    const { session, events } = createSession(fakeProc);

    session.send('hi');
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    fakeProc.emit('error', enoent);

    const stderrEvent = events.find((e) => e.kind === 'stderr') as { text: string };
    expect(stderrEvent.text).toMatch(/failed to launch claude cli/i);
    expect(events.find((e) => e.kind === 'exit')).toMatchObject({ code: -1 });
    expect(session.running).toBe(false);
  });

  it('stop() kills the subprocess and emits no further turnDone', () => {
    const fakeProc = createFakeProcess();
    const { session, events } = createSession(fakeProc);
    session.send('hi');

    session.stop();

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(session.running).toBe(false);
    expect(events.find((e) => e.kind === 'turnDone')).toBeUndefined();
  });

  it('dispose() stops the session and marks it terminal', () => {
    const fakeProc = createFakeProcess();
    const { session } = createSession(fakeProc);
    session.send('hi');

    session.dispose();

    expect(fakeProc.kill).toHaveBeenCalled();
    session.start();
    expect(session.running).toBe(false);
  });
});
