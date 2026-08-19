// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Provider registry — the router's lookup table.
 *
 * Kept deliberately dumb. It resolves ids to providers and reports health; it
 * does not choose models. Routing policy (which model suits which task) belongs
 * with Zeus and needs mission context this layer does not have, so putting a
 * heuristic here would be a second, competing router.
 */

import type { ModelDescriptor, ModelProvider, ProviderHealth } from './types.js';

export interface ProviderStatus {
  id: string;
  label: string;
  health: ProviderHealth;
  models: ModelDescriptor[];
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  list(): ModelProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Health plus models for every provider, for `providers:list` and doctor.
   *
   * One unreachable provider must not blank the report, so each is isolated:
   * a rejection becomes an `unavailable` row rather than failing the batch.
   */
  async statuses(): Promise<ProviderStatus[]> {
    return Promise.all(
      this.list().map(async (provider): Promise<ProviderStatus> => {
        try {
          const health = await provider.health();
          const models = health.available ? await provider.listModels().catch(() => []) : [];
          return { id: provider.id, label: provider.label, health, models };
        } catch (err) {
          return {
            id: provider.id,
            label: provider.label,
            health: {
              available: false,
              endpoint: 'unknown',
              locality: 'local',
              errorCode: 'unknown',
              detail: err instanceof Error ? err.message : String(err),
            },
            models: [],
          };
        }
      }),
    );
  }
}
