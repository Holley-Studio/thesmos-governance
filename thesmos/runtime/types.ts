// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos Runtime — provider-neutral execution contracts.
 *
 * Thesmos owns orchestration and governance; model providers are interchangeable
 * execution engines operating under Thesmos authority. This module is the seam
 * that makes that true in code rather than in prose.
 *
 * Deliberately dependency-free and free of any `vscode` import: the same
 * contracts back Pantheon Chat today and a headless `thesmos runtime` later.
 * Nothing here may reach for the editor, the filesystem, or a network client —
 * providers bring their own transport.
 *
 * The event shape is not invented here. It is the union Claude and Codex
 * sessions already emit in the VS Code extension, lifted into core unchanged so
 * the extraction costs those two providers exactly nothing.
 */

/**
 * How a provider executes work.
 *
 * The distinction that matters to governance is not the vendor but the
 * mechanism: `cli` wraps a subprocess carrying the user's own login, `http`
 * speaks directly to an inference endpoint. A `cli` provider inherits whatever
 * the binary's own settings and hooks permit; an `http` provider inherits
 * nothing, so Thesmos must supply the entire boundary itself.
 */
export type ProviderKind = 'cli' | 'http';

/**
 * Where a provider's endpoint physically lives.
 *
 * This drives the egress decision, so it is a closed set rather than a boolean:
 * `lan` is not `local`, and the difference is the point. See
 * `runtime/endpoint.ts` for how a URL is classified — never infer locality from
 * a provider id or a label.
 */
export type EndpointLocality = 'local' | 'lan' | 'remote';

/**
 * Structured reachability, never an exception.
 *
 * A provider the user has not installed is a normal state of the world, not a
 * system failure. `health()` reports it; it does not throw.
 */
export interface ProviderHealth {
  available: boolean;
  endpoint: string;
  locality: EndpointLocality;
  latencyMs?: number;
  /** Stable machine-readable code — see `ProviderErrorCode`. Absent when healthy. */
  errorCode?: string;
  /** One short human-readable line. Never a raw provider payload. */
  detail?: string;
}

/**
 * What a model can actually do.
 *
 * Every field is optional on purpose: an undetectable capability must stay
 * unknown rather than be guessed. `false` means "verified absent", `undefined`
 * means "not determined" — routing must treat those differently, because
 * assuming absence silently downgrades a capable model and assuming presence
 * produces a runtime failure the user cannot explain.
 */
export interface ModelCapabilities {
  chat?: boolean;
  streaming?: boolean;
  toolUse?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  embeddings?: boolean;
}

/**
 * Cost posture for routing.
 *
 * `local-compute` is not free. It consumes the user's hardware, power, memory
 * and GPU time. Modelling it as `$0` would let a router treat local inference
 * as costless and stampede every task onto the user's laptop. The metered API
 * cost is what is zero, and only that is claimed.
 */
export type BillingClass = 'metered-api' | 'subscription' | 'local-compute';

/** Whether prompt content leaves the user's machine. */
export type PrivacyClass = 'local-only' | 'egress';

/**
 * Everything routing needs to choose a model without guessing.
 *
 * Unknown metadata is absent, not defaulted. A router that cannot tell whether
 * a model supports tools must be able to see that it cannot tell.
 */
export interface ModelDescriptor {
  /** Provider-scoped model id, exactly as the provider names it. */
  id: string;
  /** Human label for pickers. Falls back to `id` when the provider offers none. */
  label: string;
  providerId: string;
  /** True only for loopback endpoints. LAN and remote are not local. */
  local: boolean;
  billingClass: BillingClass;
  privacyClass: PrivacyClass;
  capabilities: ModelCapabilities;
  /** Only when the provider reports it. Never estimated from a name. */
  contextWindow?: number;
  /**
   * Vector width this model produces, when the provider reports it.
   *
   * Present so a governed-memory consumer can size and validate a vector store
   * *before* embedding a corpus. Discovering it by embedding a probe string
   * would work, but a store built at the wrong width corrupts silently and is
   * only noticed at retrieval time — so this stays undefined rather than
   * guessed when the provider does not say.
   */
  embeddingDimensions?: number;
  /** Parameter count / quantization as reported, for display and rough routing. */
  parameterSize?: string;
  quantization?: string;
  /** On-disk size in bytes, when reported. */
  sizeBytes?: number;
}

/**
 * Normalized session events.
 *
 * Lifted verbatim from the union Claude and Codex already emit so that
 * extracting them into core is a move, not a rewrite. Ollama emits the same
 * shape, which is what lets one UI consume all three without provider branches.
 */
export type RuntimeEvent =
  | { kind: 'init'; sessionId: string; model: string }
  | { kind: 'textDelta'; text: string }
  | { kind: 'thinkingDelta'; text: string }
  | { kind: 'assistantText'; text: string }
  | { kind: 'toolUse'; toolUseId: string; name: string; input: Record<string, unknown> }
  | { kind: 'toolResult'; toolUseId: string; summary: string; isError: boolean }
  | {
      kind: 'turnDone';
      costUsd?: number;
      durationMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      isError: boolean;
    }
  | { kind: 'compacting'; trigger: string; preTokens?: number }
  | { kind: 'usage'; contextTokens: number }
  /**
   * Normalized subscription-plan window data from the provider's
   * `rate_limit_event`. Identifying fields (uuid, session_id) and billing-detail
   * strings are stripped before the event reaches a consumer — they are never
   * stored or propagated. The `windowPayload` object is safe to pass directly to
   * `SubscriptionUsageProvider.ingestStreamEvent()`.
   */
  | { kind: 'rateLimitInfo'; windowPayload: Record<string, unknown> }
  | { kind: 'stderr'; text: string }
  | { kind: 'exit'; code: number | null };

export type RuntimeEventSink = (event: RuntimeEvent) => void;

/** What a caller supplies to open a session. */
export interface SessionOptions {
  /** Absolute path the session treats as its working root. */
  workspaceRoot: string;
  onEvent: RuntimeEventSink;
  /** Provider-scoped model id. Empty/undefined means "provider default". */
  model?: string;
  /** Resume an earlier conversation when the provider supports it. */
  resumeSessionId?: string;
  /** Prepended as a system message where the provider supports one. */
  systemPrompt?: string;
}

/**
 * A live conversation with a provider.
 *
 * Intentionally small. It covers what Claude (long-lived subprocess fed by
 * stdin), Codex (one subprocess per turn) and Ollama (streaming HTTP) all
 * genuinely share, and nothing further — a wider contract would be shaped by
 * speculation rather than by three working implementations.
 */
export interface AgentSession {
  /** Provider-assigned id once known; undefined before the first turn inits. */
  readonly id: string | undefined;
  readonly running: boolean;
  /** Optional pre-warm. Providers with nothing to warm implement it as a no-op. */
  start(): void;
  send(text: string): void | Promise<void>;
  /** Abort the in-flight turn. Must leave no orphaned process or request. */
  stop(): void;
  dispose(): void;
}

/** An execution engine Thesmos can route work to. */
export interface ModelProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: ProviderKind;
  /** Reachability. Resolves with `available: false` rather than rejecting. */
  health(): Promise<ProviderHealth>;
  /** Models actually present, discovered live. Empty array when unreachable. */
  listModels(): Promise<ModelDescriptor[]>;
  createSession(options: SessionOptions): AgentSession;
}

/**
 * Embeddings as a separate capability rather than a chat-session mode.
 *
 * Kept apart so a future governed-memory consumer (Mnemosyne) can depend on
 * embeddings without dragging in session lifecycle, and so a provider that
 * serves embeddings but not chat is representable.
 */
export interface EmbeddingProvider {
  readonly id: string;
  embed(model: string, input: readonly string[], signal?: AbortSignal): Promise<number[][]>;
}

/** Narrowing helper — avoids `'embed' in provider` casts at call sites. */
export function supportsEmbeddings(
  provider: ModelProvider,
): provider is ModelProvider & EmbeddingProvider {
  return typeof (provider as Partial<EmbeddingProvider>).embed === 'function';
}
