// @vitest-environment node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Dispatch-path enforcement tests for the billing-aware Budget Guardian.
 *
 * budgetPolicy.test.ts proves the decision matrix; this suite proves the
 * WIRING — that every path a prompt can take to the CLI (direct send,
 * approved dispatch order, skipped dispatch order, queued prompt, resumed
 * dispatch) runs through the same billing-aware decision, and that raising
 * the ceiling or reclassifying billing unblocks the SAME session immediately.
 *
 * The controller is instantiated against the mocked vscode module (see
 * vitest.config alias) with a throwaway workspace root; the Claude session
 * itself is stubbed so no CLI process ever spawns.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PantheonChatController } from '../chat/chatViewProvider.js';

/** Minimal Memento mock. */
function memento() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (store.has(key) ? (store.get(key) as T) : defaultValue),
    update: async (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
    },
    keys: (): readonly string[] => [...store.keys()],
    setKeysForSync: (): void => {},
  };
}

function makeExtensionContext(root: string): never {
  return {
    globalState: memento(),
    workspaceState: memento(),
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
    },
    globalStorageUri: { fsPath: join(root, 'storage'), path: join(root, 'storage') },
  } as unknown as never;
}

interface Controller {
  totalCostUsd: number;
  history: Array<{ kind: string; text?: string }>;
  session: unknown;
  turnRunning: boolean;
  promptQueue: Array<{ text: string; attachments: string[] }>;
  pendingDispatch: unknown;
  checkpoints: unknown;
  createSession(resume?: string): Promise<unknown>;
  sendPrompt(text: string, attachments?: string[]): Promise<void>;
  dispatchPrompt(text: string, attachments: string[], dequeued: boolean): Promise<void>;
  resolveDispatch(orderId: string, status: 'approved' | 'skipped' | 'dismissed'): void;
  drainQueue(): void;
  dispose(): void;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

describe('Budget Guardian — every dispatch path is billing-aware', () => {
  let root: string;
  let controller: Controller;
  let sent: string[];

  const writeConfig = (tokenBudget: Record<string, unknown>): void => {
    writeFileSync(join(root, '.thesmos', 'config.json'), JSON.stringify({ tokenBudget }), 'utf-8');
  };

  /** Stub the expensive edges so a permitted dispatch is observable via `sent`. */
  const stubTransport = (): void => {
    sent = [];
    controller.checkpoints = { snapshot: async () => 'cp-test' };
    controller.createSession = async () => ({
      id: 'session-test',
      send: (prompt: string) => sent.push(prompt),
      dispose: () => {},
    });
  };

  const lastError = (): string => {
    const errors = controller.history.filter((i) => i.kind === 'error');
    return errors.length ? String(errors[errors.length - 1].text) : '';
  };

  beforeEach(() => {
    root = join(tmpdir(), `thesmos-dispatch-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeConfig({ billingMode: 'metered', sessionMaxCostUSD: 15 });
    controller = new PantheonChatController(
      makeExtensionContext(root),
      root,
    ) as unknown as Controller;
    stubTransport();
    controller.totalCostUsd = 20; // over the $15 metered ceiling
  });

  afterEach(() => {
    try {
      controller.dispose();
    } catch {
      /* mock teardown is best-effort */
    }
    try {
      rmSync(root, { recursive: true });
    } catch {
      /* tmp cleanup is best-effort */
    }
  });

  it('direct send: blocked at the metered ceiling, nothing reaches the CLI', async () => {
    await controller.sendPrompt('direct prompt');
    expect(sent).toEqual([]);
    expect(lastError()).toContain('paused to prevent additional API usage');
    expect(controller.promptQueue).toEqual([]);
  });

  it('dispatchPrompt (the choke point): blocked even when called directly', async () => {
    await controller.dispatchPrompt('sneaky prompt', [], false);
    expect(sent).toEqual([]);
    expect(lastError()).toContain('session ceiling');
  });

  it('approved dispatch order: approval cannot bypass a ceiling reached before approval', async () => {
    controller.pendingDispatch = {
      orderId: 'do-test',
      text: 'approved prompt',
      attachments: [],
      advice: { agents: [], recommendation: {} },
    };
    controller.resolveDispatch('do-test', 'approved');
    await tick();
    expect(sent).toEqual([]);
    expect(lastError()).toContain('paused to prevent additional API usage');
  });

  it('skipped dispatch order: skip is a dispatch too, and stays blocked', async () => {
    controller.pendingDispatch = {
      orderId: 'do-skip',
      text: 'skipped prompt',
      attachments: [],
      advice: { agents: [], recommendation: {} },
    };
    controller.resolveDispatch('do-skip', 'skipped');
    await tick();
    expect(sent).toEqual([]);
  });

  it('queued prompt: the queue drains into the decision, not past it', async () => {
    controller.promptQueue.push({ text: 'queued prompt', attachments: [] });
    controller.drainQueue();
    await tick();
    expect(sent).toEqual([]);
    expect(controller.promptQueue).toEqual([]); // cleared, not retried silently
    expect(lastError()).toContain('Queued prompt not sent');
  });

  it('raising the ceiling unblocks the SAME session immediately — no restart', async () => {
    await controller.sendPrompt('blocked first');
    expect(sent).toEqual([]);
    writeConfig({ billingMode: 'metered', sessionMaxCostUSD: 50 });
    await controller.sendPrompt('now allowed');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('now allowed');
  });

  it('reclassifying to subscription removes the hard block immediately', async () => {
    await controller.sendPrompt('blocked first');
    expect(sent).toEqual([]);
    writeConfig({ billingMode: 'subscription', sessionMaxCostUSD: 15 });
    await controller.sendPrompt('subscription send');
    expect(sent).toHaveLength(1);
  });

  it('a verified subscription session is never blocked, however large the estimate', async () => {
    writeConfig({ billingMode: 'subscription', sessionMaxCostUSD: 15 });
    controller.totalCostUsd = 9999;
    await controller.dispatchPrompt('huge estimate', [], false);
    expect(sent).toHaveLength(1);
  });

  it('unknown billing (old config without billingMode) is advisory — dispatch proceeds', async () => {
    writeConfig({ sessionMaxCostUSD: 15 }); // legacy shape, over ceiling
    await controller.dispatchPrompt('legacy config prompt', [], false);
    expect(sent).toHaveLength(1); // never hard-blocks on unverified billing
  });
});
