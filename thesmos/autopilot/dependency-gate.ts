// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Autopilot dependency gating — Depends on: N must be completed before a task runs.
 * Plan-parser already rejects forward/self/circular deps; this enforces runtime control flow.
 */
import type { AutopilotSession, AutopilotTask } from '../types.js';
import { isTaskBlocked, isTaskCompleted } from './session.js';

/**
 * Return 1-based dependency numbers that are not yet completed.
 * Timed-out and blocked deps count as unmet (not completed).
 */
export function unmetDependencyNumbers(
  task: AutopilotTask,
  session: AutopilotSession,
): number[] {
  if (!task.dependsOn?.length) return [];
  return task.dependsOn.filter((n) => {
    const idx = n - 1;
    return !isTaskCompleted(session, idx);
  });
}

/**
 * Human-readable block reason when dependencies are unmet, or null when ready.
 */
export function dependencyBlockReason(
  task: AutopilotTask,
  session: AutopilotSession,
): string | null {
  const unmet = unmetDependencyNumbers(task, session);
  if (unmet.length === 0) return null;

  const details = unmet.map((n) => {
    const idx = n - 1;
    if (isTaskBlocked(session, idx)) return `task ${n} (blocked)`;
    if (session.timedOutTaskIndexes.includes(idx)) return `task ${n} (timed out)`;
    return `task ${n} (not completed)`;
  });

  return `Dependencies unmet: ${details.join(', ')}`;
}
