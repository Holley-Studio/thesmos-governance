// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The desktop sidecar's provider registry — one shared instance so
 * `providers.list` and mission execution see the same registered providers
 * rather than each constructing their own.
 */

import { OllamaProvider } from '../../../thesmos/runtime/providers/ollama/provider.js';
import { ClaudeCliProvider } from '../../../thesmos/runtime/providers/claude-cli/provider.js';
import { ProviderRegistry } from '../../../thesmos/runtime/registry.js';

export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new OllamaProvider());
  registry.register(new ClaudeCliProvider());
  return registry;
}
