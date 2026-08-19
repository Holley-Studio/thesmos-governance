// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pantheon Chat's Ollama integration.
 *
 * Focused on the seam the extension owns — that Ollama is a *native* provider
 * rather than another Anthropic-shim preset, and that adding it left the two
 * CLI providers untouched. Wire behaviour is covered in the core runtime suite.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PROVIDER_PRESETS, ProviderManager } from '../chat/providerManager.js';
import { resetMockConfig, setMockConfig } from '../__mocks__/vscode.js';
import { probeOllama } from '../chat/ollamaSession.js';

/** Minimal ExtensionContext: globalState + secrets are all ProviderManager touches. */
function fakeContext(initial?: Record<string, unknown>) {
  const global = new Map<string, unknown>(Object.entries(initial ?? {}));
  const secrets = new Map<string, string>();
  return {
    globalState: {
      get: <T>(key: string): T | undefined => global.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        global.set(key, value);
      },
    },
    secrets: {
      get: async (key: string): Promise<string | undefined> => secrets.get(key),
      store: async (key: string, value: string): Promise<void> => {
        secrets.set(key, value);
      },
      delete: async (key: string): Promise<void> => {
        secrets.delete(key);
      },
    },
  } as unknown as ConstructorParameters<typeof ProviderManager>[0];
}

const PROVIDER_STATE_KEY = 'thesmos.pantheonChat.provider';

beforeEach(() => {
  resetMockConfig();
});

describe('Ollama as a native provider preset', () => {
  const ollama = PROVIDER_PRESETS.find((p) => p.id === 'ollama');

  it('is registered in the picker', () => {
    expect(ollama).toBeDefined();
    expect(ollama!.label).toMatch(/ollama/i);
  });

  it('is native rather than CLI- or proxy-driven', () => {
    // The whole point: not routed through `claude` and not an Anthropic shim.
    expect(ollama!.native).toBe('ollama');
    expect(ollama!.cli).toBeUndefined();
    expect(ollama!.baseUrl).toBeUndefined();
  });

  it('never asks for an API key', () => {
    expect(ollama!.needsKey).toBe(false);
  });

  it('declares no static model list', () => {
    // Models are a fact about the user's machine, discovered live.
    expect(ollama!.models).toEqual([]);
  });
});

describe('ProviderManager with Ollama active', () => {
  function managerWithOllama(): ProviderManager {
    return new ProviderManager(fakeContext({ [PROVIDER_STATE_KEY]: { id: 'ollama' } }));
  }

  it('supplies no Anthropic env — nothing is routed through a shim', async () => {
    const env = await managerWithOllama().envForActive();
    expect(env).toBeUndefined();
  });

  it('does not report a missing key for a local provider', async () => {
    // `null` is the "key not linked" signal; Ollama must never produce it.
    expect(await managerWithOllama().envForActive()).not.toBeNull();
  });

  it('defaults to the loopback endpoint', () => {
    expect(managerWithOllama().ollamaBaseUrl).toBe('http://127.0.0.1:11434');
  });

  it('honours a configured endpoint', () => {
    setMockConfig('thesmos.providers.ollama.baseUrl', 'http://127.0.0.1:9999');
    expect(managerWithOllama().ollamaBaseUrl).toBe('http://127.0.0.1:9999');
  });

  it('falls back to loopback when the configured value is blank', () => {
    setMockConfig('thesmos.providers.ollama.baseUrl', '   ');
    expect(managerWithOllama().ollamaBaseUrl).toBe('http://127.0.0.1:11434');
  });

  it('returns no models when the service is unreachable', async () => {
    // 49999 is closed (and not a port undici blocks outright, which would mask
    // the connection-refused path this is meant to exercise).
    setMockConfig('thesmos.providers.ollama.baseUrl', 'http://127.0.0.1:49999');
    await expect(managerWithOllama().modelsForActive()).resolves.toEqual([]);
  });

  it('reports unavailability through probeActive rather than throwing', async () => {
    setMockConfig('thesmos.providers.ollama.baseUrl', 'http://127.0.0.1:49999');
    const probe = await managerWithOllama().probeActive();
    expect(probe).toMatchObject({ available: false });
    expect(probe!.detail).toMatch(/reachable/i);
  });
});

describe('existing providers are unchanged', () => {
  it('keeps Anthropic as the default with its static models', async () => {
    const manager = new ProviderManager(fakeContext());
    expect(manager.active.id).toBe('anthropic');
    expect(manager.active.needsKey).toBe(false);
    await expect(manager.modelsForActive()).resolves.toBe(manager.active.models);
  });

  it('keeps Codex CLI-driven and key-free', () => {
    const codex = PROVIDER_PRESETS.find((p) => p.id === 'codex')!;
    expect(codex.cli).toBe('codex');
    expect(codex.native).toBeUndefined();
    expect(codex.needsKey).toBe(false);
  });

  it('leaves shim providers still requiring a key', async () => {
    for (const id of ['glm', 'kimi', 'deepseek', 'custom']) {
      const preset = PROVIDER_PRESETS.find((p) => p.id === id)!;
      expect(preset.needsKey).toBe(true);
      expect(preset.native).toBeUndefined();
    }
    // And an unlinked key still reports as unlinked.
    const manager = new ProviderManager(fakeContext({ [PROVIDER_STATE_KEY]: { id: 'glm' } }));
    expect(await manager.envForActive()).toBeNull();
  });

  it('returns static model lists synchronously-equivalent for non-native providers', async () => {
    const manager = new ProviderManager(fakeContext({ [PROVIDER_STATE_KEY]: { id: 'deepseek' } }));
    const models = await manager.modelsForActive();
    expect(models.map((m) => m.id)).toContain('deepseek-reasoner');
  });

  it('has no probe for non-native providers', async () => {
    const manager = new ProviderManager(fakeContext({ [PROVIDER_STATE_KEY]: { id: 'anthropic' } }));
    await expect(manager.probeActive()).resolves.toBeUndefined();
  });
});

describe('probeOllama', () => {
  it('reports unavailable with no models when nothing is listening', async () => {
    // Direct coverage for the exported probe the picker and header both rely on.
    const probe = await probeOllama('http://127.0.0.1:49999');
    expect(probe.available).toBe(false);
    expect(probe.models).toEqual([]);
    expect(probe.endpoint).toBe('http://127.0.0.1:49999');
    expect(probe.detail).toMatch(/reachable/i);
  });

  it('defaults to the loopback endpoint when none is given', async () => {
    const probe = await probeOllama();
    expect(probe.endpoint).toBe('http://127.0.0.1:11434');
  });

  it('never throws for a malformed endpoint', async () => {
    await expect(probeOllama('not-a-url')).resolves.toMatchObject({ available: false });
  });
});
