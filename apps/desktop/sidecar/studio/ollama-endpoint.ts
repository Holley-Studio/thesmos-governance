// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Where Ollama is.
 *
 * By default it is on this PC and nothing leaves the machine. A PC without a
 * capable GPU can instead be pointed, in Settings, at Ollama on another machine
 * on the same private network. That choice is explicit, limited to private
 * addresses, and stated in the interface: prompts and document passages then
 * travel to that machine.
 *
 * Never a public host. The address must be this PC or a private-range IPv4
 * address, so "local AI" can never quietly become a cloud service.
 */

import { COUNCIL_PERMISSION_CHANNELS, type CouncilPermissionPolicy } from '../../../../thesmos/council/contract.js';

export const LOCAL_OLLAMA = 'http://127.0.0.1:11434';
let current = LOCAL_OLLAMA;

function privateIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  // 10/8, 172.16/12, 192.168/16, and 100.64/10 (carrier-grade NAT, used by Tailscale).
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Returns the normalised origin, or throws with a message fit to show the user. */
export function validateOllamaEndpoint(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 60) throw new Error('Enter the Ollama address as http://address:port');
  const text = raw.trim();
  if (!text) return LOCAL_OLLAMA;
  const match = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\/?$/.exec(text);
  if (!match) throw new Error('Use the form http://192.168.0.10:11434 with a numeric address and a port');
  const [, host, portText] = match;
  const port = Number(portText);
  if (port < 1 || port > 65535) throw new Error('The Ollama port is not valid');
  if (host !== '127.0.0.1' && !privateIPv4(host)) throw new Error('Ollama must be on this PC or on your private network (10.x, 172.16–31.x, 192.168.x or a Tailscale 100.64–127.x address)');
  return `http://${host}:${port}`;
}

/** Set once at startup from saved settings; an invalid saved value falls back to this PC. */
export function setOllamaEndpoint(raw: unknown): void {
  try { current = validateOllamaEndpoint(raw); } catch { current = LOCAL_OLLAMA; }
}

export const ollamaOrigin = (): string => current;
export const ollamaUrl = (path: string): string => current + path;
export const ollamaIsLocal = (): boolean => current.startsWith('http://127.0.0.1:');

/**
 * The egress policy the core provider requires before it will dial anything
 * that is not loopback: an allow rule for exactly the configured origin.
 */
export function ollamaPolicy(): CouncilPermissionPolicy | undefined {
  if (ollamaIsLocal()) return undefined;
  const policy = {} as CouncilPermissionPolicy;
  for (const channel of COUNCIL_PERMISSION_CHANNELS) policy[channel] = [];
  policy.web = [{ decision: 'allow', patterns: [current] }];
  return policy;
}
