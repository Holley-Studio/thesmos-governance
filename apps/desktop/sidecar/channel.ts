// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Sidecar adapter for the channel — thin glue between the wire protocol and
 * thesmos/channel/orchestrator.ts. All the actual logic (persistence,
 * routing, round bounding, agent turns) lives there; this file only
 * translates IPC params/results and picks which registered provider backs a
 * round.
 *
 * `channel.postMessage` returns as soon as the user's message is recorded —
 * the round itself runs in the background inside the orchestrator, so this
 * handler (and the 30s request/response timeout on the Rust side) never
 * blocks on agent turns. The desktop polls `channel.getMessages` to see the
 * round land.
 */

import { postMessage as orchestratorPostMessage, DEV_TEAM_CHANNEL } from '../../../thesmos/channel/orchestrator.js';
import { ensureChannelDefinition, readMessagesSince } from '../../../thesmos/channel/store.js';
import { CLAUDE_CLI_PROVIDER_ID } from '../../../thesmos/runtime/providers/claude-cli/provider.js';
import type { ProviderRegistry } from '../../../thesmos/runtime/registry.js';
import type { ChannelDefinition, ChannelMessage } from '../../../thesmos/channel/types.js';

function resolveChannelId(raw: unknown): string {
  return typeof raw === 'string' && raw ? raw : DEV_TEAM_CHANNEL.id;
}

function requireProjectRoot(projectRoot: string | undefined): string {
  if (!projectRoot) throw new Error('open a project before using the channel');
  return projectRoot;
}

export function handleChannelGet(
  projectRoot: string | undefined,
  params: Record<string, unknown>,
): ChannelDefinition {
  const root = requireProjectRoot(projectRoot);
  const channelId = resolveChannelId(params.channelId);
  const definition = ensureChannelDefinition(root, DEV_TEAM_CHANNEL);
  if (definition.id !== channelId) throw new Error(`unknown channel "${channelId}"`);
  return definition;
}

export function handleChannelPostMessage(
  projectRoot: string | undefined,
  registry: ProviderRegistry,
  params: Record<string, unknown>,
): { accepted: true; message: ChannelMessage; respondingAgentIds: string[] } {
  const root = requireProjectRoot(projectRoot);
  const channelId = resolveChannelId(params.channelId);
  if (typeof params.text !== 'string' || !params.text.trim()) {
    throw new Error('channel.postMessage requires non-empty text');
  }
  const providerId =
    typeof params.providerId === 'string' && params.providerId ? params.providerId : CLAUDE_CLI_PROVIDER_ID;
  const provider = registry.get(providerId);
  if (!provider) throw new Error(`unknown provider "${providerId}"`);

  const { message, respondingAgentIds } = orchestratorPostMessage(channelId, params.text, { root, provider });
  return { accepted: true, message, respondingAgentIds };
}

export function handleChannelGetMessages(
  projectRoot: string | undefined,
  params: Record<string, unknown>,
): { messages: ChannelMessage[] } {
  const root = requireProjectRoot(projectRoot);
  const channelId = resolveChannelId(params.channelId);
  const sinceSeq = typeof params.sinceSeq === 'number' ? params.sinceSeq : undefined;
  return { messages: readMessagesSince(root, channelId, sinceSeq) };
}
