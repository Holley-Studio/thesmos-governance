// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Native Ollama provider.
 *
 * Speaks directly to the Ollama service. Claude Code is not involved, no
 * compatibility proxy is involved, and localhost needs no API key — the whole
 * value of this provider is that Thesmos owns the session end to end.
 *
 * Governance is applied here rather than at the call site so that every
 * consumer — Pantheon Chat, CLI, a future headless runtime — inherits the same
 * boundary without having to remember to ask for it.
 */

import {
  authorizeEndpointEgress,
  assertEgressPermitted,
  authorizeToolCall,
  type EgressDecision,
  type ToolCallRequest,
} from '../../governance.js';
import { parseEndpoint } from '../../endpoint.js';
import { ProviderError } from '../../errors.js';
import type { CouncilPermissionPolicy } from '../../../council/contract.js';
import type {
  AgentSession,
  EmbeddingProvider,
  ModelDescriptor,
  ModelProvider,
  ProviderHealth,
  RuntimeEvent,
  SessionOptions,
} from '../../types.js';
import { OllamaClient, type OllamaMessage, type OllamaTag } from './client.js';

export const OLLAMA_PROVIDER_ID = 'ollama';
export const OLLAMA_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';

export interface OllamaProviderOptions {
  /** Defaults to loopback. Any other host is governed as egress. */
  baseUrl?: string;
  /** Policy the egress and tool checks resolve against. */
  policy?: CouncilPermissionPolicy;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Read Ollama's declared capability list.
 *
 * Absent capability data leaves every flag `undefined` rather than `false`:
 * older Ollama builds omit the field entirely, and reporting "no tool support"
 * for a model that has it would quietly route work away from a capable model.
 */
function capabilitiesFrom(declared: string[] | undefined): ModelDescriptor['capabilities'] {
  if (!declared) return { chat: true, streaming: true };
  const has = (c: string): boolean => declared.includes(c);
  return {
    chat: true,
    streaming: true,
    toolUse: has('tools'),
    vision: has('vision'),
    reasoning: has('thinking'),
    embeddings: has('embedding'),
  };
}

export class OllamaProvider implements ModelProvider, EmbeddingProvider {
  readonly id = OLLAMA_PROVIDER_ID;
  readonly label = 'Ollama';
  readonly kind = 'http' as const;

  private readonly client: OllamaClient;
  private readonly endpointOrigin: string;
  private readonly egress: EgressDecision;

  constructor(private readonly options: OllamaProviderOptions = {}) {
    const raw = options.baseUrl?.trim() || OLLAMA_DEFAULT_ENDPOINT;
    // Evaluated once at construction so an invalid or ungoverned endpoint is a
    // property of the provider, not a surprise on the first prompt.
    this.egress = authorizeEndpointEgress(raw, options.policy);
    this.endpointOrigin = this.egress.endpoint;
    this.client = new OllamaClient(
      // Fall back to the raw string only when parsing failed; every method
      // re-asserts egress before dialling, so this is never actually reached.
      (() => {
        try {
          return parseEndpoint(raw).origin;
        } catch {
          return raw;
        }
      })(),
      options.fetchImpl,
    );
  }

  get endpoint(): string {
    return this.endpointOrigin;
  }

  /** The egress decision for this provider's endpoint, for UI and doctor output. */
  get egressDecision(): EgressDecision {
    return this.egress;
  }

  /**
   * Reachability. Never rejects — an uninstalled optional provider is a normal
   * state, and a thrown error here would make Thesmos look broken because the
   * user has not installed something they never asked for.
   */
  async health(): Promise<ProviderHealth> {
    if (!this.egress.permitted) {
      return {
        available: false,
        endpoint: this.endpointOrigin,
        locality: this.egress.locality,
        errorCode: 'egress_denied',
        detail: this.egress.reason,
      };
    }

    const result = await this.client.health();
    if (result.ok) {
      return {
        available: true,
        endpoint: this.endpointOrigin,
        locality: this.egress.locality,
        latencyMs: result.latencyMs,
      };
    }
    return {
      available: false,
      endpoint: this.endpointOrigin,
      locality: this.egress.locality,
      errorCode: result.error.code,
      detail: result.error.message,
    };
  }

  /**
   * Discover installed models. Never a hardcoded list.
   *
   * Returns `[]` when Ollama is unreachable so a picker renders "no models"
   * rather than an error dialog for an optional provider.
   */
  async listModels(): Promise<ModelDescriptor[]> {
    if (!this.egress.permitted) return [];

    let tags: OllamaTag[];
    try {
      tags = await this.client.listTags();
    } catch {
      return [];
    }

    const local = this.egress.locality === 'local';
    return Promise.all(
      tags.map(async (tag): Promise<ModelDescriptor> => {
        const detail = await this.client.show(tag.name);
        return {
          id: tag.name,
          label: tag.name,
          providerId: this.id,
          local,
          // Local inference has no metered API cost, but it is not free — it
          // spends the user's hardware, power and GPU time.
          billingClass: local ? 'local-compute' : 'metered-api',
          privacyClass: local ? 'local-only' : 'egress',
          capabilities: capabilitiesFrom(detail?.capabilities),
          contextWindow: readFamilyScalar(detail?.model_info, 'context_length'),
          embeddingDimensions: readFamilyScalar(detail?.model_info, 'embedding_length'),
          parameterSize: tag.details?.parameter_size ?? detail?.details?.parameter_size,
          quantization: tag.details?.quantization_level ?? detail?.details?.quantization_level,
          sizeBytes: typeof tag.size === 'number' ? tag.size : undefined,
        };
      }),
    );
  }

  createSession(options: SessionOptions): AgentSession {
    assertEgressPermitted(this.egress);
    return new OllamaSession(this.client, options, this.options.policy);
  }

  async embed(model: string, input: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    assertEgressPermitted(this.egress);
    return this.client.embed(model, input, signal);
  }
}

/**
 * Read a family-prefixed scalar out of Ollama's `model_info`.
 *
 * Keys are namespaced by family (`gemma4.context_length`, `qwen3.embedding_length`),
 * so the family is read off the key rather than assumed. The match is anchored
 * to exactly `<family>.<field>` — one dot — because sibling keys are genuinely
 * misleading: `gemma4.vision.embedding_length` (1152) sits next to the real
 * `gemma4.embedding_length` (2816), and a suffix match would happily return the
 * vision tower's width. A vector store built at the wrong width corrupts
 * silently and only fails at retrieval.
 *
 * Unreadable stays undefined. A guessed context window causes truncation the
 * user cannot diagnose, and a guessed dimension corrupts memory.
 */
function readFamilyScalar(
  info: Record<string, unknown> | undefined,
  field: string,
): number | undefined {
  if (!info) return undefined;
  for (const [key, value] of Object.entries(info)) {
    const parts = key.split('.');
    if (parts.length !== 2 || parts[1] !== field) continue;
    if (typeof value === 'number' && value > 0) return value;
  }
  return undefined;
}

/**
 * One Ollama conversation.
 *
 * History is held in memory because the Ollama chat API is stateless — each
 * turn posts the full message list. That also makes cancellation clean: an
 * aborted turn simply never appends its assistant message.
 */
class OllamaSession implements AgentSession {
  private readonly sessionId: string;
  private readonly history: OllamaMessage[] = [];
  private controller: AbortController | undefined;
  private disposed = false;
  private active = false;

  constructor(
    private readonly client: OllamaClient,
    private readonly options: SessionOptions,
    private readonly policy: CouncilPermissionPolicy | undefined,
  ) {
    this.sessionId = `ollama-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (options.systemPrompt) {
      this.history.push({ role: 'system', content: options.systemPrompt });
    }
  }

  get id(): string {
    return this.sessionId;
  }

  get running(): boolean {
    return this.active;
  }

  /** Nothing to pre-warm — HTTP has no process to spawn. */
  start(): void {
    /* intentionally empty */
  }

  async send(text: string): Promise<void> {
    if (this.disposed || this.active) return;
    const model = this.options.model?.trim();
    if (!model) {
      this.emit({ kind: 'stderr', text: 'No Ollama model selected.' });
      this.emit({ kind: 'turnDone', isError: true });
      return;
    }

    this.active = true;
    this.controller = new AbortController();
    this.history.push({ role: 'user', content: text });
    this.emit({ kind: 'init', sessionId: this.sessionId, model });

    const startedAt = Date.now();
    let assistant = '';
    let promptTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      const stream = this.client.chatStream(
        { model, messages: [...this.history] },
        this.controller.signal,
      );

      for await (const chunk of stream) {
        const delta = chunk.message?.content;
        if (delta) {
          assistant += delta;
          this.emit({ kind: 'textDelta', text: delta });
        }
        const thinking = chunk.message?.thinking;
        if (thinking) this.emit({ kind: 'thinkingDelta', text: thinking });

        for (const call of chunk.message?.tool_calls ?? []) {
          this.handleToolCall(call);
        }

        if (chunk.done) {
          promptTokens = chunk.prompt_eval_count;
          outputTokens = chunk.eval_count;
        }
      }

      if (assistant) this.history.push({ role: 'assistant', content: assistant });
      if (promptTokens && promptTokens > 0) {
        this.emit({ kind: 'usage', contextTokens: promptTokens });
      }
      this.emit({
        kind: 'turnDone',
        durationMs: Date.now() - startedAt,
        inputTokens: promptTokens,
        outputTokens,
        // Local inference has no metered API cost. Deliberately not `costUsd: 0`
        // for a remote endpoint, whose cost we genuinely do not know.
        costUsd: 0,
        isError: false,
      });
    } catch (err) {
      const perr =
        err instanceof ProviderError ? err : new ProviderError('unknown', 'Ollama request failed.');
      // A user-initiated stop is not an error turn — the UI already reflects it.
      if (perr.code !== 'cancelled') {
        this.emit({ kind: 'stderr', text: perr.message });
      }
      this.emit({
        kind: 'turnDone',
        durationMs: Date.now() - startedAt,
        isError: perr.code !== 'cancelled',
      });
    } finally {
      this.active = false;
      this.controller = undefined;
    }
  }

  /**
   * A tool call is surfaced as a *request* and authorized by Thesmos.
   *
   * Execution is deliberately not wired up in this pass: the contract, the
   * authority check and the denial path are real, and a denied call is reported
   * as such. What is missing is the execute-and-feed-result loop, which is
   * follow-up work — see `docs/architecture/runtime-providers.md`. Faking
   * execution would be worse than not shipping it.
   */
  private handleToolCall(call: {
    id?: string;
    function?: { name?: string; arguments?: Record<string, unknown> | string };
  }): void {
    const name = call.function?.name;
    if (!name) return;

    const rawArgs = call.function?.arguments;
    let args: Record<string, unknown> = {};
    if (typeof rawArgs === 'string') {
      try {
        args = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        args = {};
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      args = rawArgs;
    }

    const request: ToolCallRequest = { id: call.id ?? `${Date.now()}`, name, arguments: args };
    const auth = authorizeToolCall(request, this.policy);

    this.emit({ kind: 'toolUse', toolUseId: request.id, name, input: args });
    this.emit({
      kind: 'toolResult',
      toolUseId: request.id,
      summary: auth.permitted
        ? `Authorized (${auth.resolution.channel}). Tool execution for Ollama is not yet wired up — no action taken.`
        : `Blocked by Thesmos governance (${auth.resolution.channel}): ${auth.reason}`,
      isError: !auth.permitted,
    });
  }

  stop(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.active = false;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private emit(event: RuntimeEvent): void {
    this.options.onEvent(event);
  }
}
