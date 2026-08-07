// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Provider-backed task runner.
 *
 * The piece that was missing for a mission to actually *do* anything:
 * `executeMission` has always required a `TaskRunner`, and until now the only
 * implementations were test doubles. This one drives a real `ModelProvider`.
 *
 * It lives in core, not in the desktop app, because the desktop is a surface —
 * a `DesktopMissionRunner` would be a second execution path to keep in
 * agreement with the CLI's.
 *
 * Shape of one task:
 *
 *   binding + upstream handoffs + governed memory
 *        → prompt (authority hierarchy preserved)
 *        → provider session
 *        → streamed text
 *        → AgentHandoff
 *
 * The model's output is *parsed into* a handoff, never trusted as one. A model
 * that claims `status: complete` with fabricated evidence refs would otherwise
 * write straight into governed memory via the closed loop.
 */

import { assembleContext } from '../context-intelligence.js';
import { normalizeHandoff } from '../council/handoff.js';
import type { AgentHandoff } from '../council/handoff.js';
import type { ModelProvider, RuntimeEvent } from '../runtime/types.js';
import type { TaskRunContext, TaskRunResult, TaskRunner } from './execute.js';

/** Progress surfaced while a task runs, for a live UI. */
export interface AgentProgress {
  taskId: string;
  agentId: string;
  kind: 'started' | 'delta' | 'completed' | 'failed';
  /** Streamed text for `delta`; a short summary otherwise. */
  text?: string;
  model?: string;
}

export interface AgentRunnerOptions {
  provider: ModelProvider;
  /** Provider-scoped model id. Empty means the provider default. */
  model?: string;
  workspaceRoot: string;
  /** Standing policy text placed above everything else. */
  systemPolicy?: string;
  /** Called as the task streams. Must not throw — failures here are swallowed. */
  onProgress?: (progress: AgentProgress) => void;
  /** Hard ceiling on a single task's output, as a safety valve. */
  maxOutputChars?: number;
}

/**
 * The instruction block every task carries.
 *
 * Asks for a fenced JSON handoff. Deliberately explicit that unverified claims
 * must be reported as risks rather than results: the closed-loop memory writer
 * treats a `complete` handoff with evidence as durable knowledge, so overclaiming
 * here becomes a false memory later.
 */
function handoffInstruction(): string {
  return [
    'Respond with a short explanation, then a single fenced JSON block:',
    '',
    '```json',
    '{',
    '  "status": "complete" | "partial" | "blocked" | "failed",',
    '  "summary": "one or two sentences stating what is now true",',
    '  "evidenceRefs": ["file paths, commands, or ids that support the summary"],',
    '  "changedFiles": [],',
    '  "commandsRun": [],',
    '  "unresolvedRisks": ["anything you could not verify"],',
    '  "recommendedNextTasks": []',
    '}',
    '```',
    '',
    'Report only what you actually established. Anything you could not verify',
    'belongs in unresolvedRisks, never in summary — a claim recorded as fact',
    'becomes durable project memory.',
  ].join('\n');
}

/** Extract the last fenced JSON block, which is the handoff. */
function extractHandoffJson(text: string): unknown | undefined {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(fences[i][1].trim());
    } catch {
      // Try the next-earlier fence: a model may emit an illustrative block
      // before the real one.
    }
  }
  return undefined;
}

/**
 * Build the prompt for one task.
 *
 * Uses `assembleContext` so the authority hierarchy is identical to every other
 * consumer — policy, then intent, then current evidence, then memory. Upstream
 * handoffs are *current evidence*: they were produced by this mission, not
 * recalled from history.
 */
function buildPrompt(ctx: TaskRunContext, systemPolicy?: string): string {
  const upstream = ctx.upstream
    .map((h) => `- ${h.agentId} (${h.status}): ${h.summary}`)
    .join('\n');

  return assembleContext({
    systemPolicy,
    governance: [
      `You are ${ctx.binding.contract.identity.id}, acting under Thesmos mission authority.`,
      'You may only report actions you actually performed.',
      'You have no filesystem or shell access in this turn; describe what should be done.',
    ].join('\n'),
    userIntent: [`Mission goal: ${ctx.mission.goal}`, `Your task: ${ctx.binding.task.title}`, ctx.binding.task.intent].join(
      '\n',
    ),
    currentEvidence: upstream ? `Completed upstream tasks:\n${upstream}` : undefined,
    // Already fenced and sanitized by Context Intelligence.
    memoryCapsule: ctx.memoryContext?.capsule,
  });
}

/**
 * Create a `TaskRunner` backed by a live provider.
 *
 * Never throws: a provider failure becomes a `failed` handoff so the mission
 * records the truth and continues under its own rules, rather than the whole
 * graph collapsing on one bad request.
 */
export function createAgentRunner(options: AgentRunnerOptions): TaskRunner {
  const maxOutput = options.maxOutputChars ?? 24_000;

  return async (ctx: TaskRunContext): Promise<TaskRunResult> => {
    const taskId = ctx.binding.task.id;
    const agentId = ctx.binding.contract.identity.id;
    const emit = (progress: AgentProgress): void => {
      try {
        options.onProgress?.(progress);
      } catch {
        /* a UI listener must never be able to fail a mission */
      }
    };

    emit({ taskId, agentId, kind: 'started', model: options.model });

    const prompt = `${buildPrompt(ctx, options.systemPolicy)}\n\n${handoffInstruction()}`;

    let text = '';
    let failure: string | undefined;
    let truncated = false;

    await new Promise<void>((resolve) => {
      const session = options.provider.createSession({
        workspaceRoot: options.workspaceRoot,
        model: options.model,
        onEvent: (event: RuntimeEvent) => {
          switch (event.kind) {
            case 'textDelta':
              if (text.length < maxOutput) {
                text += event.text;
                emit({ taskId, agentId, kind: 'delta', text: event.text });
              } else if (!truncated) {
                // Stop the turn rather than accumulating without bound.
                truncated = true;
                session.stop();
              }
              break;
            case 'assistantText':
              if (!text) text = event.text;
              break;
            case 'stderr':
              failure = event.text;
              break;
            case 'turnDone':
              resolve();
              break;
            case 'exit':
              resolve();
              break;
            default:
              break;
          }
        },
      });

      void Promise.resolve(session.send(prompt)).catch((err: unknown) => {
        failure = err instanceof Error ? err.message : String(err);
        resolve();
      });
    });

    // The model's JSON is a *claim*. normalizeHandoff coerces and bounds it;
    // anything missing or malformed degrades to a partial handoff rather than
    // being invented.
    const claimed = extractHandoffJson(text);
    const base: Record<string, unknown> =
      claimed && typeof claimed === 'object' ? (claimed as Record<string, unknown>) : {};

    if (failure && !claimed) {
      const handoff = normalizeHandoff(
        {
          missionId: ctx.mission.id,
          taskId,
          agentId,
          status: 'failed',
          summary: `Provider request failed: ${failure}`.slice(0, 400),
          evidenceRefs: [],
          unresolvedRisks: ['The task did not run; no work was performed.'],
        },
        options.workspaceRoot,
      );
      emit({ taskId, agentId, kind: 'failed', text: handoff.summary });
      return { handoff };
    }

    // `normalizeHandoff` defaults an absent or invalid status to `failed` —
    // correct, because an agent may not mark its own homework. But a model that
    // produced real work and simply omitted the field is not a failure, and
    // recording it as one would poison mission history and the closed-loop
    // memory that reads from it. `partial` is the honest reading: work happened,
    // completion is unverified.
    const claimedStatus = typeof base.status === 'string' ? base.status : undefined;
    const resolvedStatus =
      claimedStatus && ['complete', 'partial', 'blocked', 'failed'].includes(claimedStatus)
        ? claimedStatus
        : text.trim()
          ? 'partial'
          : 'failed';

    const handoff: AgentHandoff = normalizeHandoff(
      {
        ...base,
        status: resolvedStatus,
        // Identity is assigned by the runtime, never accepted from the model —
        // otherwise a task could attribute its output to another agent.
        missionId: ctx.mission.id,
        taskId,
        agentId,
        summary:
          typeof base.summary === 'string' && base.summary.trim()
            ? base.summary
            : text.trim().slice(0, 400) || 'No summary reported.',
        ...(truncated
          ? {
              unresolvedRisks: [
                ...(Array.isArray(base.unresolvedRisks) ? (base.unresolvedRisks as string[]) : []),
                'Output was truncated at the runner limit; the result may be incomplete.',
              ],
            }
          : {}),
      },
      options.workspaceRoot,
    );

    emit({ taskId, agentId, kind: 'completed', text: handoff.summary });
    return { handoff };
  };
}
