// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Opt-in Pantheon orchestration execution — runs routed agents via autopilot adapters.
 * Brief-only mode (no LLM) remains the default in pantheon:orchestrate.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logAgentComplete, logAgentError, logAgentSpawn } from '../agent-activity.js';
import {
  createReceipt,
  hashPayload,
  writeExecutionReceipt,
} from '../execution-receipt.js';
import { createAdapter } from '../autopilot/adapters.js';
import { randomUUID } from 'node:crypto';

export interface OrchestrateAgentRef {
  id: string;
  name: string;
  god: string;
  role: string;
  body: string;
}

export interface OrchestrateExecuteOptions {
  root: string;
  task: string;
  agents: OrchestrateAgentRef[];
  agentIds: string[];
  sessionId: string;
  adapterType?: string;
  httpAdapterUrl?: string;
  dangerouslySkipPermissions?: boolean;
  timeoutMs?: number;
}

export interface OrchestrateAgentResult {
  agentId: string;
  god: string;
  success: boolean;
  summary: string | null;
  timedOut: boolean;
}

function buildAgentPrompt(task: string, agent: OrchestrateAgentRef, teammates: string[]): string {
  const bodyExcerpt = agent.body.trim().slice(0, 4000);
  const team = teammates.length > 0 ? teammates.join(', ') : 'none';
  return [
    `You are ${agent.name} (${agent.god}) — ${agent.role}.`,
    ``,
    `Zeus Orchestration Task: ${task}`,
    ``,
    `Your sub-task: Handle the "${agent.role.toLowerCase()}" dimension of the task above.`,
    `Coordinate with: ${team}`,
    ``,
    `Agent instructions (excerpt):`,
    bodyExcerpt,
    ``,
    `Produce your deliverable in your standard output format.`,
    `End with a line: TASK COMPLETE— <one-sentence summary>`,
  ].join('\n');
}

/**
 * Execute each routed agent sequentially via the configured adapter.
 * Logs spawn/complete/error to agent-activity.jsonl.
 */
export async function executeOrchestration(
  options: OrchestrateExecuteOptions,
): Promise<OrchestrateAgentResult[]> {
  const adapter = createAdapter(options.adapterType ?? 'claude', {
    httpUrl: options.httpAdapterUrl,
    dangerouslySkipPermissions: options.dangerouslySkipPermissions === true,
  });

  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const tmpDir = mkdtempSync(join(tmpdir(), 'thesmos-orchestrate-'));
  const results: OrchestrateAgentResult[] = [];

  for (const id of options.agentIds) {
    const agent = options.agents.find((a) => a.id === id);
    if (!agent) continue;

    const invocationId = randomUUID();
    const teammates = options.agentIds
      .filter((x) => x !== id)
      .map((x) => options.agents.find((a) => a.id === x)?.god)
      .filter((g): g is string => Boolean(g));

    logAgentSpawn(options.root, {
      sessionId: options.sessionId,
      agentId: invocationId,
      description: `Orchestrate execute: ${options.task}`,
      subagentType: id,
    });

    const started = Date.now();
    const logPath = join(tmpDir, `${id}.log`);
    const prompt = buildAgentPrompt(options.task, agent, teammates);

    process.stdout.write(`  → Executing ${agent.god} (${id}) via ${adapter.name}...\n`);

    try {
      const result = await adapter.execute(prompt, {
        timeoutMs,
        logPath,
        sessionId: options.sessionId,
        taskIndex: results.length,
      });

      const durationMs = Date.now() - started;
      writeExecutionReceipt(
        options.root,
        createReceipt({
          runId: options.sessionId,
          taskId: invocationId,
          source: 'pantheon-orchestrate',
          agentId: id,
          adapter: adapter.name,
          routing: { kind: 'pantheon', detail: agent.god },
          durationMs,
          promptHash: hashPayload(prompt),
          resultHash: hashPayload(result.summary),
          terminalStatus: result.success ? 'complete' : result.timedOut ? 'timed_out' : 'error',
          blockReason: result.success
            ? undefined
            : result.timedOut
              ? 'timed out'
              : `exit ${result.exitCode}`,
        }),
      );
      if (result.success) {
        logAgentComplete(options.root, {
          sessionId: options.sessionId,
          agentId: invocationId,
          durationMs,
          resultSummary: (result.summary ?? 'ok').slice(0, 200),
        });
      } else {
        logAgentError(options.root, {
          sessionId: options.sessionId,
          agentId: invocationId,
          durationMs,
          resultSummary: result.timedOut ? 'timed out' : `exit ${result.exitCode}`,
        });
      }

      results.push({
        agentId: id,
        god: agent.god,
        success: result.success,
        summary: result.summary,
        timedOut: result.timedOut,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - started;
      writeExecutionReceipt(
        options.root,
        createReceipt({
          runId: options.sessionId,
          taskId: invocationId,
          source: 'pantheon-orchestrate',
          agentId: id,
          adapter: adapter.name,
          routing: { kind: 'pantheon', detail: agent.god },
          durationMs,
          promptHash: hashPayload(prompt),
          resultHash: hashPayload(msg),
          terminalStatus: 'error',
          blockReason: msg.slice(0, 200),
        }),
      );
      logAgentError(options.root, {
        sessionId: options.sessionId,
        agentId: invocationId,
        durationMs,
        resultSummary: msg.slice(0, 200),
      });
      results.push({
        agentId: id,
        god: agent.god,
        success: false,
        summary: null,
        timedOut: false,
      });
    }
  }

  return results;
}
