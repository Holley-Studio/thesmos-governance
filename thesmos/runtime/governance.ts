// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Runtime governance — the egress and tool-authority boundary for providers.
 *
 * Two rules this module exists to enforce:
 *
 *   1. Sending a prompt to a non-loopback endpoint is data egress. It carries
 *      source code, repository context and tool output off the machine, so it
 *      is authorized on the existing `web` permission channel rather than a
 *      new parallel system. Loopback is exempt because nothing leaves the host.
 *
 *   2. A model asking for a tool is a *request*, never an execution. The
 *      provider hands the request to Thesmos, Thesmos resolves it against
 *      mission authority, and only an outright `allow` proceeds. No provider
 *      may reach a shell.
 *
 * Everything here is pure: decisions in, decisions out, no I/O. That keeps the
 * boundary testable and keeps it identical whether the caller is Pantheon Chat
 * or a headless runtime.
 */

import { resolvePermission, type CouncilPermissionResolution } from '../council/permissions.js';
import { COUNCIL_PERMISSION_CHANNELS, type CouncilPermissionPolicy } from '../council/contract.js';
import { parseEndpoint, type ParsedEndpoint } from './endpoint.js';
import { ProviderError } from './errors.js';
import type { EndpointLocality } from './types.js';

/**
 * A policy granting nothing.
 *
 * Used when a caller supplies none. `resolvePermission` treats an empty channel
 * as "no rule matches", which resolves to `ask` — so an absent policy asks for
 * approval rather than assuming it. That is the whole reason this is an empty
 * policy and not a permissive one.
 */
const EMPTY_POLICY: CouncilPermissionPolicy = COUNCIL_PERMISSION_CHANNELS.reduce(
  (policy, channel) => {
    policy[channel] = [];
    return policy;
  },
  {} as CouncilPermissionPolicy,
);

/** Outcome of the egress check for a provider endpoint. */
export interface EgressDecision {
  /** True only when the request may proceed without further confirmation. */
  permitted: boolean;
  /** True when the user must approve before the request proceeds. */
  requiresApproval: boolean;
  locality: EndpointLocality;
  endpoint: string;
  reason: string;
  /** Present for non-loopback endpoints, absent when locality made it moot. */
  resolution?: CouncilPermissionResolution;
}

/**
 * Decide whether workspace context may be sent to `rawEndpoint`.
 *
 * Loopback short-circuits to permitted: the bytes never leave the machine, so
 * demanding a `web` grant for the default local configuration would be noise
 * that trains users to approve everything.
 *
 * Every other endpoint — including LAN — is resolved on the `web` channel
 * against the caller's policy. LAN is deliberately not treated as local: a
 * workstation on a shared network is still a different machine under someone
 * else's control.
 *
 * A policy that says nothing yields `ask`, not `allow`. Silence must not
 * authorize sending a repository to an arbitrary host.
 */
export function authorizeEndpointEgress(
  rawEndpoint: string,
  policy: CouncilPermissionPolicy | undefined,
): EgressDecision {
  let parsed: ParsedEndpoint;
  try {
    parsed = parseEndpoint(rawEndpoint);
  } catch (err) {
    return {
      permitted: false,
      requiresApproval: false,
      locality: 'remote',
      endpoint: rawEndpoint,
      reason: err instanceof Error ? err.message : 'invalid endpoint',
    };
  }

  if (parsed.locality === 'local') {
    return {
      permitted: true,
      requiresApproval: false,
      locality: 'local',
      endpoint: parsed.origin,
      reason: 'loopback endpoint — no data leaves this machine',
    };
  }

  const resolution = resolvePermission(policy ?? EMPTY_POLICY, 'web', parsed.origin);
  const permitted = resolution.decision === 'allow';

  return {
    permitted,
    // `deny` is final; only an `ask` is answerable by prompting the user.
    requiresApproval: resolution.decision === 'ask',
    locality: parsed.locality,
    endpoint: parsed.origin,
    reason:
      resolution.decision === 'allow'
        ? resolution.reason
        : `${parsed.locality} endpoint ${parsed.origin} sends workspace context off this machine — ${resolution.reason}`,
    resolution,
  };
}

/** Throw the normalized error for a refused endpoint. */
export function assertEgressPermitted(decision: EgressDecision): void {
  if (decision.permitted) return;
  throw new ProviderError(
    decision.locality === 'remote' || decision.locality === 'lan' ? 'egress_denied' : 'invalid_endpoint',
    decision.requiresApproval
      ? `Sending workspace context to ${decision.endpoint} needs approval.`
      : `Blocked: ${decision.reason}`,
    decision.reason,
  );
}

/** A tool call a model asked for. Requested — not yet run. */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolAuthorization {
  request: ToolCallRequest;
  permitted: boolean;
  requiresApproval: boolean;
  reason: string;
  resolution: CouncilPermissionResolution;
}

/**
 * Map a model's tool request onto the channel that governs it.
 *
 * The mapping is intentionally conservative: anything not recognized is routed
 * to `shell`, the most tightly held channel. An unknown tool name is exactly
 * the case where guessing generously is most dangerous, so the default is the
 * strictest channel rather than the most convenient one.
 */
export function channelForTool(name: string): 'read' | 'edit' | 'shell' | 'web' | 'browser' | 'mcp' {
  const n = name.toLowerCase();
  if (n.startsWith('mcp__') || n.includes('mcp')) return 'mcp';
  if (n.includes('browser') || n.includes('playwright')) return 'browser';
  if (n.includes('fetch') || n.includes('websearch') || n.includes('http')) return 'web';
  if (n.includes('write') || n.includes('edit') || n.includes('patch')) return 'edit';
  if (n.includes('read') || n.includes('glob') || n.includes('grep') || n.includes('list')) return 'read';
  return 'shell';
}

/**
 * The single choke point for a provider-requested tool call.
 *
 * Extracting a concrete target matters: a `shell` rule that allows `git status`
 * must not be satisfied by a request whose command is `rm -rf /`. So the target
 * comes from the argument the channel actually governs, and falls back to the
 * tool name only when no such argument is present.
 */
export function authorizeToolCall(
  request: ToolCallRequest,
  policy: CouncilPermissionPolicy | undefined,
): ToolAuthorization {
  const channel = channelForTool(request.name);
  const args = request.arguments ?? {};

  const candidate =
    channel === 'shell'
      ? args.command ?? args.cmd ?? args.script
      : channel === 'web' || channel === 'browser'
        ? args.url ?? args.uri
        : args.path ?? args.file_path ?? args.filePath ?? args.pattern;

  const target = typeof candidate === 'string' && candidate.trim() ? candidate : request.name;
  const resolution = resolvePermission(policy ?? EMPTY_POLICY, channel, target);

  return {
    request,
    permitted: resolution.decision === 'allow',
    requiresApproval: resolution.decision === 'ask',
    reason: resolution.reason,
    resolution,
  };
}
