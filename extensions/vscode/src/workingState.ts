// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * WorkingStateManager — single source of truth for "the extension is busy".
 *
 * Any long operation registers with a god emoji + progress verb; the most
 * recent registration wins the display. While any registration is live, the
 * label ticks elapsed seconds once per second. When the stack empties, the
 * manager emits `undefined` so the owner can restore its idle display.
 *
 * No vscode import — pure logic, driven by a callback, so it unit-tests
 * without an extension host.
 */

interface Entry {
  id: number;
  emoji: string;
  verb: string;
  startedAt: number;
}

export class WorkingStateManager {
  private readonly entries: Entry[] = [];
  private nextId = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly onChange: (label: string | undefined) => void) {}

  begin(emoji: string, verb: string): { dispose(): void } {
    const entry: Entry = { id: this.nextId++, emoji, verb, startedAt: Date.now() };
    this.entries.push(entry);
    this.emit();
    if (this.timer === undefined) {
      this.timer = setInterval(() => this.emit(), 1000);
    }
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const idx = this.entries.findIndex((e) => e.id === entry.id);
        if (idx !== -1) this.entries.splice(idx, 1);
        if (this.entries.length === 0 && this.timer !== undefined) {
          clearInterval(this.timer);
          this.timer = undefined;
        }
        this.emit();
      },
    };
  }

  private emit(): void {
    const top = this.entries[this.entries.length - 1];
    if (!top) {
      this.onChange(undefined);
      return;
    }
    const seconds = Math.floor((Date.now() - top.startedAt) / 1000);
    this.onChange(`$(sync~spin) ${top.emoji} ${top.verb}… (${seconds}s)`);
  }

  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.entries.length = 0;
  }
}
