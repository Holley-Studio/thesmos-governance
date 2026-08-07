// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Minimal vscode module mock for unit tests.
 * The real vscode API is only available inside the Extension Host; this stub
 * lets tests import extension code without a running VS Code instance.
 */

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];

  readonly event = (listener: (e: T) => void): { dispose(): void } => {
    this._listeners.push(listener);
    return {
      dispose: () => {
        this._listeners = this._listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(e: T): void {
    for (const l of this._listeners) l(e);
  }

  dispose(): void {
    this._listeners = [];
  }
}

export class RelativePattern {
  constructor(
    public readonly base: unknown,
    public readonly pattern: string,
  ) {}
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, path }),
};

// ── FileSystemWatcher mock ────────────────────────────────────────────────────

export class MockFileSystemWatcher {
  private _changeListeners: Array<() => void> = [];
  private _createListeners: Array<() => void> = [];
  private _deleteListeners: Array<() => void> = [];

  onDidChange = (l: () => void) => { this._changeListeners.push(l); return { dispose: () => {} }; };
  onDidCreate = (l: () => void) => { this._createListeners.push(l); return { dispose: () => {} }; };
  onDidDelete = (l: () => void) => { this._deleteListeners.push(l); return { dispose: () => {} }; };
  dispose = () => {};

  triggerChange(): void { for (const l of this._changeListeners) l(); }
  triggerCreate(): void { for (const l of this._createListeners) l(); }
  triggerDelete(): void { for (const l of this._deleteListeners) l(); }
}

let _lastWatcher: MockFileSystemWatcher | null = null;

export function getLastMockWatcher(): MockFileSystemWatcher | null {
  return _lastWatcher;
}

/** Settings backing `workspace.getConfiguration`. Tests set keys directly. */
const _config = new Map<string, unknown>();

export function setMockConfig(key: string, value: unknown): void {
  _config.set(key, value);
}

export function resetMockConfig(): void {
  _config.clear();
}

export const workspace = {
  createFileSystemWatcher: (_pattern: unknown): MockFileSystemWatcher => {
    _lastWatcher = new MockFileSystemWatcher();
    return _lastWatcher;
  },
  getConfiguration: (section?: string) => ({
    get: <T>(key: string): T | undefined =>
      _config.get(section ? `${section}.${key}` : key) as T | undefined,
  }),
};

/** Messages surfaced during a test, so assertions can check what the user saw. */
export const shownMessages: Array<{ level: string; message: string }> = [];

export function resetShownMessages(): void {
  shownMessages.length = 0;
}

export const window = {
  showErrorMessage: (msg: string) => {
    shownMessages.push({ level: 'error', message: msg });
    return Promise.resolve(undefined);
  },
  showInformationMessage: (msg: string) => {
    shownMessages.push({ level: 'info', message: msg });
    return Promise.resolve(undefined);
  },
  showWarningMessage: (msg: string) => {
    shownMessages.push({ level: 'warning', message: msg });
    return Promise.resolve(undefined);
  },
};
