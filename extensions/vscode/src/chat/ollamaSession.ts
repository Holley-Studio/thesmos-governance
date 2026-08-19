// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pantheon Chat's adapter onto the core Ollama provider.
 *
 * Deliberately thin. All of the behaviour — health, discovery, streaming,
 * cancellation, error normalization, egress governance — lives in
 * `thesmos/runtime`, so the CLI and a future headless runtime get it without
 * going through VS Code. This file only reconciles the two lifecycles: the
 * chat controller's synchronous `send()` versus the runtime's async one.
 *
 * If logic starts accumulating here, it belongs in core instead.
 */

import {
  OllamaProvider,
  OLLAMA_DEFAULT_ENDPOINT,
} from '../../../../thesmos/runtime/providers/ollama/provider.js';
import type { ModelDescriptor, RuntimeEvent } from '../../../../thesmos/runtime/types.js';
import type { AgentSession as RuntimeSession } from '../../../../thesmos/runtime/types.js';

export { OLLAMA_DEFAULT_ENDPOINT };

/** Probe the configured endpoint. Never throws — an absent Ollama is normal. */
export async function probeOllama(
  baseUrl: string = OLLAMA_DEFAULT_ENDPOINT,
): Promise<{ available: boolean; endpoint: string; detail?: string; models: ModelDescriptor[] }> {
  const provider = new OllamaProvider({ baseUrl });
  const health = await provider.health();
  const models = health.available ? await provider.listModels() : [];
  return { available: health.available, endpoint: health.endpoint, detail: health.detail, models };
}

/**
 * Wraps the runtime session in the shape the chat controller already drives
 * (`start`/`send`/`stop`/`dispose`, events pushed to a sink).
 *
 * `send()` is fire-and-forget because the controller's contract is synchronous;
 * the promise is retained so `dispose()` cannot leave a turn unobserved, and a
 * rejection is converted into the same normalized events any other failure
 * produces rather than becoming an unhandled rejection.
 */
export class OllamaChatSession {
  private readonly session: RuntimeSession;
  private inFlight: Promise<void> | undefined;

  constructor(
    workspaceRoot: string,
    onEvent: (event: RuntimeEvent) => void,
    modelConfig?: { model?: string; baseUrl?: string; systemPrompt?: string },
  ) {
    const provider = new OllamaProvider({ baseUrl: modelConfig?.baseUrl });
    this.session = provider.createSession({
      workspaceRoot,
      onEvent,
      model: modelConfig?.model,
      systemPrompt: modelConfig?.systemPrompt,
    });
    this.onEvent = onEvent;
  }

  private readonly onEvent: (event: RuntimeEvent) => void;

  get id(): string | undefined {
    return this.session.id;
  }

  get running(): boolean {
    return this.session.running;
  }

  start(): void {
    this.session.start();
  }

  send(text: string): void {
    this.inFlight = Promise.resolve(this.session.send(text)).catch((err: unknown) => {
      this.onEvent({
        kind: 'stderr',
        text: err instanceof Error ? err.message : 'Ollama request failed.',
      });
      this.onEvent({ kind: 'turnDone', isError: true });
    });
  }

  stop(): void {
    this.session.stop();
  }

  dispose(): void {
    this.session.dispose();
    void this.inFlight;
  }
}
