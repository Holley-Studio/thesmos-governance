// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos Runtime sidecar — wire protocol.
 *
 * The desktop UI does not import Thesmos core. It sends typed requests over
 * stdio to a runtime process that does. Two reasons that boundary exists:
 *
 *   1. The webview is untrusted relative to native capability. If the UI could
 *      call core directly it would need filesystem and process access, and
 *      Tauri's capability model would be decoration.
 *   2. The same runtime serves the CLI, the editor and a future daemon. A
 *      desktop-specific copy of mission/memory logic would be the third
 *      implementation of the same rules.
 *
 * Transport is newline-delimited JSON over stdin/stdout — not a local HTTP
 * server. An HTTP port is reachable by any process on the machine and needs its
 * own auth story; a pipe inherited from the parent is reachable only by the
 * parent. Narrower is the point.
 *
 * Every request carries an `id`; every response echoes it. Responses may arrive
 * out of order, because a long mission must not block a health check.
 */

/** Operations the UI may ask for. Deliberately closed — no passthrough. */
export type RuntimeMethod =
  | 'runtime.health'
  | 'runtime.shutdown'
  | 'providers.list'
  | 'memory.search'
  | 'memory.stats'
  | 'project.open'
  | 'pantheon.list';

export interface RuntimeRequest {
  id: string;
  method: RuntimeMethod;
  params?: Record<string, unknown>;
}

export type RuntimeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } };

/**
 * Unsolicited messages — streaming progress, mission events.
 *
 * Separate from responses so a consumer can route them without correlating
 * against a request it may never have made.
 */
export interface RuntimeEventMessage {
  event: string;
  payload: unknown;
}

export type RuntimeOutbound = RuntimeResponse | RuntimeEventMessage;

export function isEventMessage(msg: RuntimeOutbound): msg is RuntimeEventMessage {
  return typeof (msg as RuntimeEventMessage).event === 'string';
}

/** Shape returned by `runtime.health`. */
export interface RuntimeHealth {
  status: 'ready' | 'degraded';
  version: string;
  pid: number;
  uptimeMs: number;
  /** Absent until a project is opened — the runtime has no implicit root. */
  projectRoot?: string;
  /** Memory subsystem availability. `degraded` never blocks the app. */
  memory: { available: boolean; records?: number; detail?: string };
}
