// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos Runtime — public surface.
 *
 * Thesmos owns orchestration and governance. Model providers are interchangeable
 * execution engines operating under Thesmos authority.
 *
 * Consumers (Pantheon Chat, the CLI, a future `thesmos runtime`) import from
 * here rather than reaching into provider internals, so a provider can be added
 * or replaced without touching its callers.
 */

export type {
  AgentSession,
  BillingClass,
  EmbeddingProvider,
  EndpointLocality,
  ModelCapabilities,
  ModelDescriptor,
  ModelProvider,
  PrivacyClass,
  ProviderHealth,
  ProviderKind,
  RuntimeEvent,
  RuntimeEventSink,
  SessionOptions,
} from './types.js';
export { supportsEmbeddings } from './types.js';

export {
  classifyHost,
  isLocalEndpoint,
  parseEndpoint,
  InvalidEndpointError,
  type ParsedEndpoint,
} from './endpoint.js';

export {
  normalizeHttpError,
  normalizeTransportError,
  ProviderError,
  type ProviderErrorCode,
} from './errors.js';

export {
  assertEgressPermitted,
  authorizeEndpointEgress,
  authorizeToolCall,
  channelForTool,
  type EgressDecision,
  type ToolAuthorization,
  type ToolCallRequest,
} from './governance.js';

export { ProviderRegistry, type ProviderStatus } from './registry.js';

export {
  OllamaProvider,
  OLLAMA_DEFAULT_ENDPOINT,
  OLLAMA_PROVIDER_ID,
  type OllamaProviderOptions,
} from './providers/ollama/provider.js';
export { OllamaClient } from './providers/ollama/client.js';
