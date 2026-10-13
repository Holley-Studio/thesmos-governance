// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Channel persistence — flat, append-only JSONL, one directory per channel.
 *
 * Mirrors `thesmos/agent-activity.ts`'s shape rather than Mnemosyne's
 * (`thesmos/memory/store.ts`): a channel message is a plain event, not
 * curated project knowledge, and Mnemosyne's schema (confidence, sensitivity,
 * supersession) has no meaning for it. `.thesmos/channels/<id>/` follows the
 * same local-state convention every other `.thesmos/` subdirectory already
 * uses.
 */

import { existsSync, appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChannelDefinition, ChannelMessage } from './types.js';

function channelDir(root: string, channelId: string): string {
  return join(root, '.thesmos', 'channels', channelId);
}

function definitionPath(root: string, channelId: string): string {
  return join(channelDir(root, channelId), 'channel.json');
}

function messagesPath(root: string, channelId: string): string {
  return join(channelDir(root, channelId), 'messages.jsonl');
}

function ensureDir(root: string, channelId: string): void {
  const dir = channelDir(root, channelId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readChannelDefinition(root: string, channelId: string): ChannelDefinition | undefined {
  const path = definitionPath(root, channelId);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ChannelDefinition;
  } catch {
    return undefined;
  }
}

export function writeChannelDefinition(root: string, definition: ChannelDefinition): void {
  ensureDir(root, definition.id);
  writeFileSync(definitionPath(root, definition.id), JSON.stringify(definition, null, 2), 'utf-8');
}

/**
 * Read the definition, creating it from `fallback` on first use.
 *
 * A channel is created implicitly the first time it's opened rather than
 * through a separate provisioning step — v1 ships exactly one default
 * channel, so "first open" and "first ever use of the app" are the same
 * moment.
 */
export function ensureChannelDefinition(root: string, fallback: ChannelDefinition): ChannelDefinition {
  return readChannelDefinition(root, fallback.id) ?? (writeChannelDefinition(root, fallback), fallback);
}

export function appendMessage(
  root: string,
  channelId: string,
  message: Omit<ChannelMessage, 'id' | 'ts' | 'seq'>,
): ChannelMessage {
  // Small logs (hundreds of messages, not millions) — re-reading to compute
  // the next seq is simpler and safer than maintaining an in-memory counter
  // that would go stale across sidecar restarts.
  const seq = readMessages(root, channelId).length;
  const full: ChannelMessage = {
    id: randomUUID(),
    seq,
    ts: new Date().toISOString(),
    ...message,
  };
  ensureDir(root, channelId);
  appendFileSync(messagesPath(root, channelId), JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

export function readMessages(root: string, channelId: string): ChannelMessage[] {
  const path = messagesPath(root, channelId);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const messages: ChannelMessage[] = [];
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line) as ChannelMessage);
    } catch {
      // Skip malformed lines rather than fail the whole read.
    }
  }
  return messages;
}

/** Messages strictly after `sinceSeq`, for polling. */
export function readMessagesSince(root: string, channelId: string, sinceSeq: number | undefined): ChannelMessage[] {
  const all = readMessages(root, channelId);
  if (sinceSeq === undefined) return all;
  return all.filter((m) => m.seq > sinceSeq);
}
