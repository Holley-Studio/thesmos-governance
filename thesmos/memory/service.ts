// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — the one entry point callers use.
 *
 * Composes validation, storage, embedding and retrieval so no consumer has to
 * remember the order. Every path degrades: with no embedding provider the
 * service still stores, still retrieves (lexically), and says so — semantic
 * search being unavailable must never mean memory is unavailable.
 */

import { DEFAULT_MEMORY_BUDGET, type MemoryBudget, type MemoryProposal, type MemoryRecord, type MemorySearchResult } from './types.js';
import { MemoryStore } from './store.js';
import { validateMemoryProposal, type MemoryValidationResult, type MemoryWriteContext } from './validate.js';
import { applyBudget, deduplicate, detectConflicts, rankMemories, type MemoryQuery } from './retrieve.js';
import { embedQuery, type EmbeddingContext } from './embeddings.js';
import { renderMemoryCapsule, type MemoryTelemetry, type RenderedMemoryCapsule } from './capsule.js';

export interface RecallOptions extends MemoryQuery {
  budget?: MemoryBudget;
  /** Absent means lexical-only retrieval. */
  embedding?: EmbeddingContext;
  signal?: AbortSignal;
}

export interface RecallOutcome {
  results: MemorySearchResult[];
  capsule: RenderedMemoryCapsule;
  telemetry: MemoryTelemetry;
}

export class MnemosyneService {
  readonly store: MemoryStore;

  constructor(
    private readonly root: string,
    private readonly writeContext: MemoryWriteContext,
  ) {
    this.store = new MemoryStore(root);
  }

  /**
   * Validate, then persist on acceptance.
   *
   * Returns the decision either way — a caller must be able to tell a rejected
   * write from a silent no-op.
   */
  remember(proposal: MemoryProposal): {
    validation: MemoryValidationResult;
    record?: MemoryRecord;
  } {
    const validation = validateMemoryProposal(proposal, this.writeContext);
    if (validation.decision !== 'accept') return { validation };

    const record = this.store.append({
      ...proposal,
      // Trust the evaluated sensitivity, not the proposer's claim.
      sensitivity: validation.effectiveSensitivity,
    });
    return { validation, record };
  }

  /**
   * Retrieve, rank, dedupe, budget and render.
   *
   * Conflicts are computed over the *retrieved* set rather than the whole
   * store: a contradiction the caller was never going to see is noise, and
   * scanning everything on each query would be quadratic for no benefit.
   */
  async recall(options: RecallOptions): Promise<RecallOutcome> {
    const startedAt = Date.now();
    const records = this.store.all();

    let queryVector: readonly number[] | undefined;
    let embeddingMs: number | undefined;

    if (options.embedding) {
      const embedStart = Date.now();
      const vector = await embedQuery(options.text, options.embedding, options.signal);
      embeddingMs = Date.now() - embedStart;
      queryVector = vector ?? undefined;
    }

    const vectorIndex = options.embedding
      ? new Map(
          this.store
            .vectorsIn(
              options.embedding.provider.id,
              options.embedding.model,
              options.embedding.dimensions,
            )
            .map((v) => [v.memoryId, v.vector]),
        )
      : undefined;

    const ranked = rankMemories(
      records,
      options,
      vectorIndex ? (id) => vectorIndex.get(id) : undefined,
      queryVector,
    );

    const deduped = deduplicate(ranked);
    const budget = options.budget ?? DEFAULT_MEMORY_BUDGET;
    const { kept, droppedForBudget } = applyBudget(deduped, budget);

    const conflicts = detectConflicts(kept.map((r) => r.memory));
    const capsule = renderMemoryCapsule(kept, conflicts);

    const allCandidateChars = records.reduce((sum, r) => sum + r.content.length, 0);
    const keptChars = kept.reduce((sum, r) => sum + r.memory.content.length, 0);

    return {
      results: kept,
      capsule,
      telemetry: {
        candidatesConsidered: records.length,
        retrieved: kept.length,
        droppedForBudget,
        memoryChars: keptChars,
        // ESTIMATE — the cost of the full store versus what was injected. Not a
        // measurement of tokens saved against any real alternative run.
        contextCharsAvoidedEstimate: Math.max(0, allCandidateChars - keptChars),
        conflictsDetected: conflicts.length,
        embeddingUsed: Boolean(queryVector),
        retrievalMs: Date.now() - startedAt,
        embeddingMs,
      },
    };
  }

  /** Forget one record and its vectors. */
  forgetById(id: string): boolean {
    return this.store.forget((r) => r.id === id).removed > 0;
  }

  forgetMission(missionId: string): number {
    return this.store.forget((r) => r.missionId === missionId).removed;
  }

  forgetRepository(repoId: string): number {
    return this.store.forget((r) => r.repoId === repoId).removed;
  }
}
