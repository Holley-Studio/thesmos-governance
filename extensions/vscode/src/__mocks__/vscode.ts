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

export const workspace = {
  createFileSystemWatcher: (_pattern: unknown): MockFileSystemWatcher => {
    _lastWatcher = new MockFileSystemWatcher();
    return _lastWatcher;
  },
};

export const window = {
  showErrorMessage: (_msg: string) => Promise.resolve(undefined),
  showInformationMessage: (_msg: string) => Promise.resolve(undefined),
};
