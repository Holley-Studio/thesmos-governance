// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — embedding indexing.
 *
 * Mnemosyne is the memory system; Ollama is *an* embedding provider. This
 * module depends only on the runtime's `EmbeddingProvider` contract, so adding
 * another provider later needs no change here and no second memory
 * architecture.
 *
 * Two invariants:
 *   1. Vectors are namespaced by `provider:model:dimensions`. Vectors from
 *      different spaces are never compared — cosine distance between unrelated
 *      spaces returns a plausible number, which is the dangerous kind of wrong.
 *   2. Secret- and sensitive-class content is never sent to a provider.
 *      Embedding does not launder sensitivity.
 */

import { embeddingNamespace, type MemoryRecord } from './types.js';
import { hashContent, type MemoryStore, type StoredVector } from './store.js';
import type { EmbeddingProvider, ModelDescriptor } from '../runtime/types.js';

/** Sensitivity classes that must never leave the process as a vector request. */
const NON_EMBEDDABLE = new Set(['secret', 'sensitive']);

export function isEmbeddable(record: MemoryRecord): boolean {
  return !NON_EMBEDDABLE.has(record.sensitivity);
}

export interface EmbeddingContext {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
}

export interface IndexResult {
  embedded: number;
  skippedSensitive: number;
  skippedUpToDate: number;
  failed: number;
  namespace: string;
}

/**
 * Resolve the embedding model to use.
 *
 * Fails with an actionable message rather than silently pulling a model: a
 * multi-gigabyte download is not something to trigger on someone's behalf.
 */
export function resolveEmbeddingModel(
  models: readonly ModelDescriptor[],
  configured: string | undefined,
): { model: ModelDescriptor } | { error: string } {
  const embedders = models.filter((m) => m.capabilities.embeddings === true);

  if (configured) {
    const exact = models.find((m) => m.id === configured);
    if (!exact) {
      return {
        error: `Embedding model "${configured}" is not installed. Pull it with \`ollama pull ${configured}\`, or set providers.ollama.embeddingModel to one you have.`,
      };
    }
    // A chat model asked to embed produces vectors of poor quality rather than
    // an error, so refuse rather than quietly build a bad index.
    if (exact.capabilities.embeddings === false) {
      return { error: `Model "${configured}" does not support embeddings.` };
    }
    return { model: exact };
  }

  if (embedders.length === 0) {
    return {
      error:
        'No embedding-capable model is installed. `ollama pull nomic-embed-text` is a common choice (a recommendation, not a requirement), then set providers.ollama.embeddingModel.',
    };
  }
  // Deterministic pick so an unconfigured store indexes reproducibly.
  const sorted = [...embedders].sort((a, b) => a.id.localeCompare(b.id));
  return { model: sorted[0] };
}

/**
 * Embed every record that needs it.
 *
 * Skips records whose stored vector already matches the current content hash,
 * so re-running is cheap and a content edit is what triggers re-embedding.
 */
export async function indexMemories(
  store: MemoryStore,
  records: readonly MemoryRecord[],
  context: EmbeddingContext,
  signal?: AbortSignal,
): Promise<IndexResult> {
  const namespace = embeddingNamespace(context.provider.id, context.model, context.dimensions);
  const existing = new Map(
    store
      .vectors()
      .filter((v) => v.namespace === namespace)
      .map((v) => [v.memoryId, v]),
  );

  const pending: MemoryRecord[] = [];
  let skippedSensitive = 0;
  let skippedUpToDate = 0;

  for (const record of records) {
    if (!isEmbeddable(record)) {
      skippedSensitive++;
      continue;
    }
    const current = existing.get(record.id);
    if (current && current.contentHash === hashContent(record.content)) {
      skippedUpToDate++;
      continue;
    }
    pending.push(record);
  }

  if (pending.length === 0) {
    return { embedded: 0, skippedSensitive, skippedUpToDate, failed: 0, namespace };
  }

  let embedded = 0;
  let failed = 0;

  // Batched, but bounded — one enormous request is harder to cancel and can
  // exceed a provider's payload limits.
  const BATCH = 16;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    try {
      const vectors = await context.provider.embed(
        context.model,
        batch.map((r) => r.content),
        signal,
      );
      batch.forEach((record, index) => {
        const vector = vectors[index];
        // A width that disagrees with the namespace would corrupt the space.
        if (!Array.isArray(vector) || vector.length !== context.dimensions) {
          failed++;
          return;
        }
        const stored: StoredVector = {
          memoryId: record.id,
          namespace,
          contentHash: hashContent(record.content),
          vector,
        };
        store.putVector(stored);
        embedded++;
      });
    } catch {
      failed += batch.length;
    }
  }

  return { embedded, skippedSensitive, skippedUpToDate, failed, namespace };
}

/**
 * Embed a query in the same namespace as the index.
 *
 * Returns null on any failure so the caller falls back to lexical retrieval
 * rather than returning nothing — degraded search beats no search.
 */
export async function embedQuery(
  text: string,
  context: EmbeddingContext,
  signal?: AbortSignal,
): Promise<number[] | null> {
  try {
    const [vector] = await context.provider.embed(context.model, [text], signal);
    if (!Array.isArray(vector) || vector.length !== context.dimensions) return null;
    return vector;
  } catch {
    return null;
  }
}
