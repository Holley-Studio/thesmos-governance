// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, hashContent } from './store.js';
import { embedQuery, indexMemories, isEmbeddable, resolveEmbeddingModel } from './embeddings.js';
import type { EmbeddingProvider, ModelDescriptor } from '../runtime/types.js';
import type { MemoryProposal } from './types.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnemosyne-emb-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function proposal(overrides: Partial<MemoryProposal> = {}): MemoryProposal {
  return {
    scope: 'repository',
    type: 'architecture-decision',
    content: 'Thesmos owns provider orchestration.',
    provenance: { sourceKind: 'user', creator: 'm', derivation: 'stated' },
    confidence: 'high',
    sensitivity: 'project',
    metadata: {},
    ...overrides,
  };
}

/** Provider returning fixed-width vectors, counting the strings it received. */
function fakeProvider(dimensions = 3): EmbeddingProvider & { seen: string[] } {
  const seen: string[] = [];
  return {
    id: 'ollama',
    seen,
    async embed(_model, input) {
      seen.push(...input);
      return input.map((_, i) => Array.from({ length: dimensions }, (_, d) => (d === 0 ? 1 : i * 0.01)));
    },
  };
}

function model(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: 'nomic-embed-text',
    label: 'nomic-embed-text',
    providerId: 'ollama',
    local: true,
    billingClass: 'local-compute',
    privacyClass: 'local-only',
    capabilities: { embeddings: true },
    ...overrides,
  };
}

describe('resolveEmbeddingModel', () => {
  it('picks an embedding-capable model deterministically', () => {
    const out = resolveEmbeddingModel(
      [model({ id: 'zeta-embed' }), model({ id: 'alpha-embed' })],
      undefined,
    );
    expect('model' in out && out.model.id).toBe('alpha-embed');
  });

  it('honours a configured model', () => {
    const out = resolveEmbeddingModel([model({ id: 'a' }), model({ id: 'b' })], 'b');
    expect('model' in out && out.model.id).toBe('b');
  });

  it('gives an actionable error when the configured model is missing', () => {
    // Never silently pull a multi-gigabyte model on the user's behalf.
    const out = resolveEmbeddingModel([model({ id: 'a' })], 'missing-model');
    expect('error' in out && out.error).toMatch(/ollama pull missing-model/);
  });

  it('refuses a model that cannot embed', () => {
    const out = resolveEmbeddingModel(
      [model({ id: 'chat-only', capabilities: { embeddings: false } })],
      'chat-only',
    );
    expect('error' in out && out.error).toMatch(/does not support embeddings/);
  });

  it('explains what to do when nothing can embed', () => {
    const out = resolveEmbeddingModel([model({ capabilities: { embeddings: false } })], undefined);
    expect('error' in out && out.error).toMatch(/recommendation, not a requirement/);
  });
});

describe('indexMemories', () => {
  it('embeds records and stores namespaced vectors', async () => {
    const store = new MemoryStore(root);
    store.append(proposal({ content: 'first fact' }));
    store.append(proposal({ content: 'second fact' }));
    const provider = fakeProvider();

    const result = await indexMemories(store, store.all(), {
      provider,
      model: 'nomic-embed-text',
      dimensions: 3,
    });

    expect(result.embedded).toBe(2);
    expect(result.namespace).toBe('ollama:nomic-embed-text:3');
    expect(store.vectorsIn('ollama', 'nomic-embed-text', 3)).toHaveLength(2);
  });

  it('never sends secret or sensitive content to the provider', async () => {
    // Embedding does not launder sensitivity.
    const store = new MemoryStore(root);
    store.append(proposal({ content: 'public architecture note', sensitivity: 'project' }));
    store.append(proposal({ content: 'HUNTER2-LOOKING-CREDENTIAL', sensitivity: 'secret' }));
    store.append(proposal({ content: 'internal risk detail', sensitivity: 'sensitive' }));
    const provider = fakeProvider();

    const result = await indexMemories(store, store.all(), {
      provider,
      model: 'm',
      dimensions: 3,
    });

    expect(result.skippedSensitive).toBe(2);
    expect(provider.seen).toEqual(['public architecture note']);
    expect(provider.seen.join(' ')).not.toContain('CREDENTIAL');
  });

  it('skips records already embedded at the same content hash', async () => {
    const store = new MemoryStore(root);
    store.append(proposal({ content: 'stable fact' }));
    const provider = fakeProvider();
    const ctx = { provider, model: 'm', dimensions: 3 };

    await indexMemories(store, store.all(), ctx);
    const second = await indexMemories(store, store.all(), ctx);

    expect(second.embedded).toBe(0);
    expect(second.skippedUpToDate).toBe(1);
  });

  it('re-embeds when content changes', async () => {
    const store = new MemoryStore(root);
    const saved = store.append(proposal({ content: 'original text' }));
    const provider = fakeProvider();
    const ctx = { provider, model: 'm', dimensions: 3 };
    await indexMemories(store, store.all(), ctx);

    store.update(saved.id, { content: 'edited text' });
    const result = await indexMemories(store, store.all(), ctx);

    expect(result.embedded).toBe(1);
    const [vector] = store.vectorsIn('ollama', 'm', 3);
    expect(vector.contentHash).toBe(hashContent('edited text'));
  });

  it('rejects a vector whose width disagrees with the namespace', async () => {
    // A wrong width would silently corrupt the vector space.
    const store = new MemoryStore(root);
    store.append(proposal({ content: 'a fact' }));
    const wrongWidth: EmbeddingProvider = {
      id: 'ollama',
      async embed(_m, input) {
        return input.map(() => [1, 2]); // 2 dims, namespace says 3
      },
    };

    const result = await indexMemories(store, store.all(), {
      provider: wrongWidth,
      model: 'm',
      dimensions: 3,
    });

    expect(result.embedded).toBe(0);
    expect(result.failed).toBe(1);
    expect(store.vectors()).toHaveLength(0);
  });

  it('counts a provider failure without throwing', async () => {
    const store = new MemoryStore(root);
    store.append(proposal({ content: 'a fact' }));
    const failing: EmbeddingProvider = {
      id: 'ollama',
      async embed() {
        throw new Error('ollama down');
      },
    };

    const result = await indexMemories(store, store.all(), {
      provider: failing,
      model: 'm',
      dimensions: 3,
    });
    expect(result.failed).toBe(1);
    expect(result.embedded).toBe(0);
  });

  it('batches rather than sending one enormous request', async () => {
    const store = new MemoryStore(root);
    for (let i = 0; i < 40; i++) store.append(proposal({ content: `fact number ${i}` }));
    const embed = vi.fn(async (_m: string, input: readonly string[]) =>
      input.map(() => [1, 0, 0]),
    );
    const provider: EmbeddingProvider = { id: 'ollama', embed };

    await indexMemories(store, store.all(), { provider, model: 'm', dimensions: 3 });
    expect(embed.mock.calls.length).toBeGreaterThan(1);
    for (const [, input] of embed.mock.calls) expect(input.length).toBeLessThanOrEqual(16);
  });
});

describe('embedQuery', () => {
  it('returns a vector in the expected width', async () => {
    const vector = await embedQuery('a query', {
      provider: fakeProvider(3),
      model: 'm',
      dimensions: 3,
    });
    expect(vector).toHaveLength(3);
  });

  it('returns null on width mismatch so the caller falls back lexically', async () => {
    const vector = await embedQuery('a query', {
      provider: fakeProvider(5),
      model: 'm',
      dimensions: 3,
    });
    expect(vector).toBeNull();
  });

  it('returns null when the provider is down rather than throwing', async () => {
    const down: EmbeddingProvider = {
      id: 'ollama',
      async embed() {
        throw new Error('connection refused');
      },
    };
    await expect(embedQuery('q', { provider: down, model: 'm', dimensions: 3 })).resolves.toBeNull();
  });
});

describe('isEmbeddable', () => {
  it('permits public and project content', () => {
    expect(isEmbeddable({ sensitivity: 'public' } as never)).toBe(true);
    expect(isEmbeddable({ sensitivity: 'project' } as never)).toBe(true);
  });

  it('refuses sensitive and secret content', () => {
    expect(isEmbeddable({ sensitivity: 'sensitive' } as never)).toBe(false);
    expect(isEmbeddable({ sensitivity: 'secret' } as never)).toBe(false);
  });
});
