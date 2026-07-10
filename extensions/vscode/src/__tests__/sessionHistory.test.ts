// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// sessionHistory derives its directory from homedir() — point it at a sandbox.
const sandbox = mkdtempSync(join(tmpdir(), 'pantheon-home-'));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => sandbox };
});

import { listSessions, loadTranscript, sessionsDir } from '../chat/sessionHistory.js';

const workspace = '/Users/test/my-project';

function writeSession(id: string, lines: unknown[]): void {
  const dir = sessionsDir(workspace);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
}

beforeEach(() => {
  rmSync(sessionsDir(workspace), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(sessionsDir(workspace), { recursive: true, force: true });
});

describe('sessionHistory', () => {
  it('derives the project slug the way Claude Code does', () => {
    expect(sessionsDir(workspace)).toBe(join(sandbox, '.claude', 'projects', '-Users-test-my-project'));
  });

  it('lists sessions with titles from the first user message', () => {
    writeSession('abc-123', [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Fix the login bug' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }] } },
    ]);
    const sessions = listSessions(workspace);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('abc-123');
    expect(sessions[0].title).toBe('Fix the login bug');
    expect(sessions[0].messageCount).toBe(2);
  });

  it('prefers summary lines for titles when present', () => {
    writeSession('with-summary', [
      { type: 'summary', summary: 'Login bug investigation' },
      { type: 'user', message: { role: 'user', content: 'something else' } },
    ]);
    expect(listSessions(workspace)[0].title).toBe('Login bug investigation');
  });

  it('skips empty transcripts and survives malformed lines', () => {
    writeSession('empty', [{ type: 'summary', summary: 'no messages here' }]);
    const dir = sessionsDir(workspace);
    writeFileSync(join(dir, 'corrupt.jsonl'), 'not json at all\n{broken', 'utf-8');
    expect(listSessions(workspace)).toHaveLength(0);
  });

  it('rebuilds a text-only transcript, skipping tool traffic and sidechains', () => {
    writeSession('transcript', [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Hello gods' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'file stuff' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Greetings, mortal.' }] } },
      { type: 'user', isSidechain: true, message: { role: 'user', content: [{ type: 'text', text: 'subagent noise' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>injected</system-reminder>' }] } },
    ]);
    const transcript = loadTranscript(workspace, 'transcript');
    expect(transcript).toEqual([
      { role: 'user', text: 'Hello gods' },
      { role: 'assistant', text: 'Greetings, mortal.' },
    ]);
  });

  it('rejects path-traversal session ids', () => {
    expect(loadTranscript(workspace, '../../../etc/passwd')).toEqual([]);
  });

  it('returns [] when the projects directory does not exist', () => {
    expect(listSessions('/nonexistent/workspace')).toEqual([]);
  });
});
