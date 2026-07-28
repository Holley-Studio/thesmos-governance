// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — schema.
 *
 * The durable, append-only evidence layer. Two existing JSONL logs already
 * record *what happened* — `execution-receipt.ts` and `governance-log.ts` — and
 * this layer does not replace either. It links to them by id and adds the three
 * properties an evidence layer needs that they do not have: a tamper-evident
 * chain, a durability barrier, and corruption that fails closed instead of
 * being silently skipped.
 *
 * The load-bearing design decision is `RecordOutcome`. Nothing in this
 * repository executes an agent — there is no `mission:run` — so a record must
 * be structurally incapable of claiming that something ran. `executed` is the
 * only variant carrying a receipt reference, and it is the only variant that
 * can carry one. A caller cannot promote `planned` to `executed` by setting a
 * field, because the field does not exist on that variant.
 */

import type { CouncilPermissionChannel, CouncilPermissionDecision } from '../council/contract.js';

/** Bumped when a persisted record changes shape in a way readers must know. */
export const RECORD_SCHEMA_VERSION = '1.0.0';

/**
 * Versions this build can read. A journal written by a *newer* Thesmos is
 * refused rather than reinterpreted — see `readJournal`.
 */
export const SUPPORTED_RECORD_SCHEMA_VERSIONS: readonly string[] = [RECORD_SCHEMA_VERSION];

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * Who or what caused a record.
 *
 * `human` is deliberately coarse: no username, no email, no machine account.
 * Attribution beyond "a human confirmed this" is a privacy cost with no
 * governance benefit at this layer.
 */
export type RecordActor =
  | { kind: 'human'; confirmationId: string }
  | { kind: 'agent'; agentId: string; contractVersion: string; contractHash: string }
  | { kind: 'system'; component: string };

export interface RecordIdentity {
  /** Groups every record belonging to one logical operation. */
  correlationId: string;
  /** The record this one was caused by. Empty for the first in a chain. */
  causationId: string;
  /** Deterministic mission id, when the record belongs to a mission. */
  missionId?: string;
  /** Task within that mission, when applicable. */
  taskId?: string;
}

// ── Events ────────────────────────────────────────────────────────────────────

/**
 * What a record is about.
 *
 * Pack lifecycle and evaluation events are defined now, before anything emits
 * them, so Phase 2 can record its operations without a schema change. A type
 * that exists but is unused is cheaper than a migration.
 */
export const RECORD_EVENT_KINDS = [
  'mission.planned',
  'mission.validated',
  'task.bound',
  'authority.decided',
  'pack.discovered',
  'pack.quarantined',
  'pack.verified',
  'pack.installed',
  'pack.updated',
  'pack.removed',
  'pack.rolled_back',
  'evaluation.started',
  'evaluation.completed',
  'failure.recorded',
  'rollback.performed',
] as const;

export type RecordEventKind = (typeof RECORD_EVENT_KINDS)[number];

export function isRecordEventKind(value: unknown): value is RecordEventKind {
  return typeof value === 'string' && (RECORD_EVENT_KINDS as readonly string[]).includes(value);
}

// ── Authority ─────────────────────────────────────────────────────────────────

/**
 * A concrete authorization decision.
 *
 * Concrete is the operative word: a channel and a *resolved target*, never a
 * glob. Counting rules over patterns cannot answer whether an action was
 * permitted, and a record that implied otherwise would repeat the defect
 * corrected in §17.7.
 */
export interface RecordAuthority {
  channel: CouncilPermissionChannel;
  target: string;
  decision: CouncilPermissionDecision;
  /** Deterministic, redaction-safe explanation from the resolver. */
  reason: string;
  /** Present only when a human confirmed an `ask`. */
  confirmationId?: string;
}

// ── Outcome ───────────────────────────────────────────────────────────────────

/**
 * What actually happened — the discriminator that keeps records honest.
 *
 * `executed` requires `receiptRef`. There is no way to express "this ran" with
 * no evidence that it ran, and no optional field on the other variants that a
 * caller could set to imply it. When execution lands in a later PR, it supplies
 * a receipt id and gets `executed`; until then, nothing can.
 */
export type RecordOutcome =
  | { kind: 'planned' }
  | { kind: 'validated'; valid: boolean }
  | { kind: 'refused'; reasonCode: string }
  | { kind: 'failed'; reasonCode: string }
  | {
      kind: 'executed';
      /** Run id of the `ExecutionReceipt` that proves it. Required. */
      receiptRef: string;
      /** Task id within that receipt file. Required. */
      receiptTaskId: string;
    };

/** Narrows without asserting — the only sanctioned way to read an execution claim. */
export function isExecutedOutcome(
  outcome: RecordOutcome
): outcome is Extract<RecordOutcome, { kind: 'executed' }> {
  return outcome.kind === 'executed';
}

// ── Attestation ───────────────────────────────────────────────────────────────

/**
 * Signing state.
 *
 * This repository has no key management and no trust root, so every record is
 * `none`. The field exists so a real signing implementation has somewhere to go
 * without breaking the schema, and so a reader can tell "unsigned" from
 * "signature not checked". Nothing here simulates a signature.
 */
export type RecordAttestation =
  | { kind: 'none' }
  | { kind: 'unverified'; algorithm: string; keyId: string; signature: string };

// ── Record ────────────────────────────────────────────────────────────────────

/**
 * The hashed projection of a record.
 *
 * Everything here is content. `recordedAt` and `sequence` are deliberately
 * absent: a wall-clock reading would make an otherwise identical replay hash
 * differently, and sequence is a property of the journal rather than of the
 * record's meaning.
 */
export interface RecordContent {
  schemaVersion: string;
  event: RecordEventKind;
  identity: RecordIdentity;
  actor: RecordActor;
  /** Redaction-safe summary of what was intended. */
  intent: string;
  outcome: RecordOutcome;
  /** Present for `authority.decided`; omitted otherwise. */
  authority?: RecordAuthority;
  /** Digests of inputs and outputs — never the content itself. */
  digests: Record<string, string>;
  /** Ids into other logs. Values are ids, never paths or payloads. */
  links: Record<string, string>;
}

/** A record as it appears on disk: content, chain, and journal metadata. */
export interface CouncilRecord extends RecordContent {
  /** `sha256:<hex>` over the canonical serialization of the content alone. */
  contentHash: string;
  /** `contentHash` of the previous record, or the genesis sentinel. */
  prevHash: string;
  /** Position in the journal, from 0. Not hashed. */
  sequence: number;
  /** ISO-8601 UTC. Not hashed — see `RecordContent`. */
  recordedAt: string;
}

/** First `prevHash` in a journal. Distinguishable from any real digest. */
export const GENESIS_HASH = 'sha256:genesis';

// ── Verification ──────────────────────────────────────────────────────────────

export const RECORD_CODES = {
  schemaUnsupported: 'RECORD_SCHEMA_UNSUPPORTED',
  contentHashMismatch: 'RECORD_CONTENT_HASH_MISMATCH',
  chainBroken: 'RECORD_CHAIN_BROKEN',
  sequenceGap: 'RECORD_SEQUENCE_GAP',
  malformed: 'RECORD_MALFORMED',
  tornTail: 'RECORD_TORN_TAIL',
  secretPresent: 'RECORD_SECRET_PRESENT',
  absolutePath: 'RECORD_ABSOLUTE_PATH',
  controlCharacter: 'RECORD_CONTROL_CHARACTER',
  executionUnproven: 'RECORD_EXECUTION_UNPROVEN',
} as const;

export interface RecordIssue {
  code: string;
  severity: 'error' | 'warning';
  /** Journal position, or -1 when the issue is about the journal as a whole. */
  sequence: number;
  message: string;
  remediation?: string;
}

export interface JournalVerification {
  valid: boolean;
  recordCount: number;
  /** Records readable and chain-intact, which may be fewer than were written. */
  intactCount: number;
  /** True when the final record was partially written — the crash signature. */
  tornTail: boolean;
  issues: RecordIssue[];
}

export function recordIssue(
  code: string,
  severity: 'error' | 'warning',
  sequence: number,
  message: string,
  remediation?: string
): RecordIssue {
  return { code, severity, sequence, message, ...(remediation ? { remediation } : {}) };
}

/** Stable ordering so two verifications of one journal report identically. */
export function sortRecordIssues(issues: readonly RecordIssue[]): RecordIssue[] {
  return [...issues].sort(
    (a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)
  );
}

export function hasRecordErrors(issues: readonly RecordIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
