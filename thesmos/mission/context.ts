// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission → Context Intelligence bridge.
 *
 * Derives what a task may *remember* from the same authority that decides what
 * it may *do*. A task never states its own memory scope, exactly as it never
 * states its own permissions — semantic similarity is not permission, and a
 * task that could name its own scope could read another project's history by
 * asking nicely.
 *
 * Kept separate from `execute.ts` so the executor stays free of memory imports
 * and remains testable without a store.
 */

import {
  buildMissionContext,
  deriveQuery,
  type ContextAuthority,
  type ContextBudget,
  type ContextResult,
} from '../context-intelligence.js';
import type { EmbeddingContext } from '../memory/embeddings.js';
import type { MemoryScope } from '../memory/types.js';
import type { MissionContextProvider, TaskMemoryContext } from './execute.js';
import type { Mission, TaskBinding } from './types.js';

/**
 * The scope a task may read.
 *
 * A task is bound to one mission, so `mission` is the widest it can ever see —
 * never `global`, never `workspace`, and never another mission's records.
 * Delegated children inherit the same ceiling because they are bound to the
 * same mission object, which is what makes widening structurally impossible
 * rather than merely discouraged.
 */
export function memoryScopeForTask(): MemoryScope {
  return 'mission';
}

export interface MissionContextOptions {
  root: string;
  /** Project/repo identity. Absent means recall declines rather than guesses. */
  repoId?: string;
  projectId?: string;
  budget?: ContextBudget;
  embedding?: EmbeddingContext;
  /** Explicit off switch for privacy-sensitive or benchmark runs. */
  recall?: boolean;
  /** Receives per-task diagnostics for receipts and `context:explain`. */
  onDiagnostics?: (taskId: string, result: ContextResult) => void;
}

/**
 * Build a `MissionContextProvider` bound to one repo.
 *
 * Returns `undefined` for a task whenever nothing qualified, so the runner sees
 * no memory rather than an empty block that still costs tokens.
 */
export function createMissionContextProvider(
  options: MissionContextOptions,
): MissionContextProvider {
  return async (mission: Mission, binding: TaskBinding): Promise<TaskMemoryContext | undefined> => {
    const authority: ContextAuthority = {
      // Derived, not supplied. See memoryScopeForTask.
      maxScope: memoryScopeForTask(),
      repoId: options.repoId,
      projectId: options.projectId,
      missionId: mission.id,
    };

    const query = deriveQuery({
      missionIntent: mission.goal,
      taskTitle: binding.task.title,
      taskIntent: binding.task.intent,
    });

    const result = await buildMissionContext({
      root: options.root,
      query,
      authority,
      budget: options.budget,
      embedding: options.embedding,
      recall: options.recall,
      // Upstream handoffs are already in the runner's context; memory that
      // merely restates them would be paid for twice.
      currentEvidence: binding.task.intent,
    });

    options.onDiagnostics?.(binding.task.id, result);

    if (result.included.length === 0) return undefined;
    return {
      capsule: result.memoryCapsule,
      memoryIds: result.memoryIds,
      tokensEstimate: result.diagnostics.memoryTokensEstimate,
    };
  };
}
