import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutopilotWatcher } from '../autopilotWatcher.js';
import { getLastMockWatcher } from '../__mocks__/vscode.js';

const SESSION_PATH_SUFFIX = join('.thesmos', 'autopilot', '.session.json');

function makeWorkspace(): string {
  const dir = join(tmpdir(), `thesmos-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '.thesmos', 'autopilot'), { recursive: true });
  return dir;
}

function writeSession(dir: string, data: object): void {
  writeFileSync(join(dir, SESSION_PATH_SUFFIX), JSON.stringify(data), 'utf8');
}

describe('AutopilotWatcher', () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it('session is null when no session file exists', () => {
    const watcher = new AutopilotWatcher(root);
    expect(watcher.session).toBeNull();
    watcher.dispose();
  });

  it('loads session from disk on construction', () => {
    writeSession(root, { id: 'test-session', planPath: '/plan.md', planSlug: 'plan', branch: 'main', startedAt: '2024-01-01', adapter: 'claude', completedTaskIndexes: [], blockedTasks: [], timedOutTaskIndexes: [], decisionLog: [], journalPath: '/journal.md' });
    const watcher = new AutopilotWatcher(root);
    expect(watcher.session?.id).toBe('test-session');
    watcher.dispose();
  });

  it('does not fire onDidChange when session is unchanged after fs event', async () => {
    writeSession(root, { id: 'abc', planPath: '/p', planSlug: 's', branch: 'main', startedAt: '', adapter: 'claude', completedTaskIndexes: [], blockedTasks: [], timedOutTaskIndexes: [], decisionLog: [], journalPath: '/j' });
    const watcher = new AutopilotWatcher(root);

    let fires = 0;
    watcher.onDidChange(() => { fires++; });

    const fsWatcher = getLastMockWatcher();
    fsWatcher?.triggerChange();

    // Allow the 250ms debounce to elapse
    await new Promise((r) => setTimeout(r, 350));

    expect(fires).toBe(0);
    watcher.dispose();
  });

  it('fires onDidChange when session content changes after fs event', async () => {
    writeSession(root, { id: 'abc', planPath: '/p', planSlug: 's', branch: 'main', startedAt: '', adapter: 'claude', completedTaskIndexes: [], blockedTasks: [], timedOutTaskIndexes: [], decisionLog: [], journalPath: '/j' });
    const watcher = new AutopilotWatcher(root);

    const fired: Array<unknown> = [];
    watcher.onDidChange((s) => { fired.push(s); });

    // Update the session file content, then trigger the watcher
    writeSession(root, { id: 'abc', planPath: '/p', planSlug: 's', branch: 'main', startedAt: '', adapter: 'claude', completedTaskIndexes: [0], blockedTasks: [], timedOutTaskIndexes: [], decisionLog: [], journalPath: '/j' });

    const fsWatcher = getLastMockWatcher();
    fsWatcher?.triggerChange();

    await new Promise((r) => setTimeout(r, 350));

    expect(fired).toHaveLength(1);
    watcher.dispose();
  });

  it('does not throw when session file contains invalid JSON', () => {
    writeFileSync(join(root, SESSION_PATH_SUFFIX), '{ not valid json', 'utf8');
    expect(() => new AutopilotWatcher(root)).not.toThrow();
  });

  it('session is null when session file contains invalid JSON', () => {
    writeFileSync(join(root, SESSION_PATH_SUFFIX), '{ not valid json', 'utf8');
    const watcher = new AutopilotWatcher(root);
    expect(watcher.session).toBeNull();
    watcher.dispose();
  });

  it('isCancelling is false with no cancel sentinel', () => {
    const watcher = new AutopilotWatcher(root);
    expect(watcher.isCancelling).toBe(false);
    watcher.dispose();
  });

  it('debounces rapid fs events into a single reload', async () => {
    writeSession(root, { id: 'abc', planPath: '/p', planSlug: 's', branch: 'main', startedAt: '', adapter: 'claude', completedTaskIndexes: [], blockedTasks: [], timedOutTaskIndexes: [], decisionLog: [], journalPath: '/j' });
    const watcher = new AutopilotWatcher(root);

    let reloadCount = 0;
    watcher.onDidChange(() => { reloadCount++; });

    writeSession(root, { id: 'abc', planPath: '/p', planSlug: 's', branch: 'main', startedAt: '', adapter: 'claude', completedTaskIndexes: [0, 1, 2], blockedTasks: [], timedOutTaskIndexes: [], decisionLog: [], journalPath: '/j' });

    const fsWatcher = getLastMockWatcher();
    // Fire 5 rapid events — should collapse to 1 reload
    for (let i = 0; i < 5; i++) fsWatcher?.triggerChange();

    await new Promise((r) => setTimeout(r, 350));

    expect(reloadCount).toBe(1);
    watcher.dispose();
  });
});
