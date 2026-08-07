// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos providers:list    — provider reachability and discovered models
 * thesmos providers:doctor  — the same, with diagnostics and a non-zero exit
 *
 * Both report on the *service*, never on a binary being present on PATH: an
 * installed `ollama` executable with no running daemon is exactly the state
 * that would make a PATH check claim availability and then fail on first use.
 */

import { loadConfig } from '../../config.js';
import { ProviderRegistry } from '../../runtime/registry.js';
import { OllamaProvider, OLLAMA_DEFAULT_ENDPOINT } from '../../runtime/providers/ollama/provider.js';
import type { ProviderStatus } from '../../runtime/registry.js';

/** Optional providers configured in `.thesmos/config.json`. */
interface ProvidersConfig {
  ollama?: { enabled?: boolean; baseUrl?: string };
}

function readProvidersConfig(root: string): ProvidersConfig {
  const config = loadConfig(root) as { providers?: ProvidersConfig };
  return config.providers ?? {};
}

function buildRegistry(root: string): { registry: ProviderRegistry; required: Set<string> } {
  const providers = readProvidersConfig(root);
  const registry = new ProviderRegistry();
  const required = new Set<string>();

  // Absent config still registers Ollama so `providers:list` can tell the user
  // whether it is running — discovery should not require opting in first.
  const ollama = providers.ollama;
  if (ollama?.enabled !== false) {
    registry.register(new OllamaProvider({ baseUrl: ollama?.baseUrl }));
    // Only an explicit `enabled: true` makes it required. Optional providers
    // must never fail the gate merely by being absent.
    if (ollama?.enabled === true) required.add('ollama');
  }

  return { registry, required };
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '';
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? ` ${gb.toFixed(1)}GB` : ` ${Math.round(bytes / 1_000_000)}MB`;
}

function printStatuses(statuses: ProviderStatus[], verbose: boolean): void {
  for (const status of statuses) {
    const state = status.health.available ? 'available' : 'unavailable';
    const latency = status.health.latencyMs !== undefined ? ` ${status.health.latencyMs}ms` : '';
    const locality = status.health.locality !== 'local' ? ` [${status.health.locality}]` : '';
    console.log(
      `  ${status.label.padEnd(12)}${state.padEnd(13)}${status.health.endpoint}${locality}${latency}`,
    );
    if (!status.health.available && status.health.detail) {
      console.log(`               ${status.health.detail}`);
    }
    if (status.models.length > 0) {
      console.log(`\n  ${status.label} models:`);
      for (const model of status.models) {
        const caps = [
          model.capabilities.toolUse ? 'tools' : '',
          model.capabilities.vision ? 'vision' : '',
          model.capabilities.reasoning ? 'reasoning' : '',
          model.capabilities.embeddings ? 'embeddings' : '',
        ]
          .filter(Boolean)
          .join(',');
        const ctx = model.contextWindow ? ` ctx=${model.contextWindow}` : '';
        const params = model.parameterSize ? ` ${model.parameterSize}` : '';
        console.log(
          `    ${model.id}${params}${formatBytes(model.sizeBytes)}${ctx}${caps ? ` (${caps})` : ''}`,
        );
        if (verbose) {
          console.log(
            `      billing=${model.billingClass} privacy=${model.privacyClass} local=${model.local}`,
          );
        }
      }
      console.log('');
    } else if (status.health.available) {
      console.log(`               no models installed`);
    }
  }
}

export async function cmdProviders(sub: string, argv: string[]): Promise<void> {
  const root = process.cwd();
  const asJson = argv.includes('--json');
  const verbose = argv.includes('--verbose');

  const { registry, required } = buildRegistry(root);
  const statuses = await registry.statuses();

  if (asJson) {
    console.log(JSON.stringify({ providers: statuses, required: [...required] }, null, 2));
  } else {
    console.log('');
    console.log('  Providers');
    printStatuses(statuses, verbose);
    if (statuses.every((s) => !s.health.available)) {
      console.log('  No optional providers reachable. Claude and Codex are driven by their own CLIs');
      console.log('  and are not listed here — see `thesmos doctor`.');
      console.log('');
    }
  }

  if (sub !== 'doctor') return;

  // Only a provider the user explicitly marked required can fail the command.
  const missing = statuses.filter((s) => required.has(s.id) && !s.health.available);
  if (missing.length > 0) {
    for (const s of missing) {
      process.stderr.write(
        `thesmos providers:doctor — ${s.label} is configured as required but is ${s.health.errorCode ?? 'unavailable'}\n`,
      );
    }
    process.exit(1);
  }
}

export { OLLAMA_DEFAULT_ENDPOINT };
