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
 * Signing state, persisted on every record.
 *
 * This repository has no key management and no trust root, so every record
 * persists exactly `{ kind: 'none' }`. It is written, covered by the envelope
 * hash, and validated on read, so a reader can distinguish "this journal
 * asserts it is unsigned" from "this journal says nothing about signing".
 *
 * Only `none` exists. An earlier revision declared an `unverified` variant
 * carrying an algorithm, key id and signature, and persisted none of it — the
 * type was never wired into a record. That was removed rather than implemented:
 * a variant whose semantics do not exist is a promise the schema cannot keep.
 * Introducing signing will require a schema version bump, and the honest
 * position is to say so rather than to claim a placeholder makes it free.
 */
export type RecordAttestation = { kind: 'none' };

export function isRecordAttestation(value: unknown): value is RecordAttestation {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'none' &&
    Object.keys(value as object).length === 1
  );
}

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

/**
 * The envelope projection, hashed to produce `recordHash`.
 *
 * Two digests exist because they answer different questions, and collapsing
 * them was the defect that made timestamps forgeable:
 *
 * - `contentHash` is **semantic identity**. Two records describing the same
 *   event have the same content hash regardless of when or where they were
 *   written. It must stay free of position and time, or replay determinism is
 *   impossible.
 * - `recordHash` is **envelope integrity**. It binds that semantic identity to
 *   this position, this timestamp, this attestation state, and this chain. It
 *   is what makes the persisted record unforgeable in place.
 *
 * `recordHash` is excluded from its own projection, for the obvious reason.
 */
export interface RecordEnvelope {
  contentHash: string;
  /** `recordHash` of the previous record — the chain links envelopes. */
  prevRecordHash: string;
  sequence: number;
  /** ISO-8601 UTC, validated on the way in and on the way out. */
  recordedAt: string;
  attestation: RecordAttestation;
}

/** A record as it appears on disk: content, envelope, and envelope digest. */
export interface CouncilRecord extends RecordContent, RecordEnvelope {
  /** `sha256:<hex>` over the envelope projection, excluding itself. */
  recordHash: string;
}

/** First `prevRecordHash` in a journal. Distinguishable from any real digest. */
export const GENESIS_HASH = 'sha256:genesis';

/**
 * Canonical ISO-8601 UTC with milliseconds, e.g. `2026-01-01T00:00:00.000Z`.
 *
 * Deliberately strict. A timestamp is part of the authenticated envelope, so an
 * ambiguous or locale-dependent form would make the same instant hash two ways.
 */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_RE.test(value)) return false;
  const parsed = Date.parse(value);
  // Round-tripping rejects values that match the shape but are not real dates,
  // such as month 13 or the 31st of February.
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

// ── Head anchor ───────────────────────────────────────────────────────────────

/**
 * The sibling anchor that makes suffix truncation detectable.
 *
 * A backward chain proves each record follows its predecessor. It cannot prove
 * that no record followed the *last* one, so deleting a valid suffix leaves a
 * journal that verifies perfectly. The anchor records how far the journal is
 * known to have reached.
 *
 * This defends against crashes, truncation and accidental loss. It does **not**
 * defend against an attacker who can rewrite the journal and the anchor
 * together — both are local files, and no local artifact can establish that.
 */
export interface JournalHead {
  schemaVersion: string;
  /** Distinguishes a rebuilt journal from a truncated one. */
  journalId: string;
  /** Sequence of the last committed record; -1 for an initialized empty journal. */
  sequence: number;
  /** `recordHash` of the last committed record, or the genesis sentinel. */
  tipRecordHash: string;
}

/** How the journal and its anchor relate. */
export type HeadState =
  | 'agreed'
  | 'journal-ahead-recoverable'
  | 'head-ahead'
  | 'tip-mismatch'
  | 'missing'
  | 'corrupt';

// ── Verification ──────────────────────────────────────────────────────────────

export const RECORD_CODES = {
  schemaUnsupported: 'RECORD_SCHEMA_UNSUPPORTED',
  contentHashMismatch: 'RECORD_CONTENT_HASH_MISMATCH',
  recordHashMismatch: 'RECORD_ENVELOPE_HASH_MISMATCH',
  chainBroken: 'RECORD_CHAIN_BROKEN',
  sequenceGap: 'RECORD_SEQUENCE_GAP',
  malformed: 'RECORD_MALFORMED',
  tornTail: 'RECORD_TORN_TAIL',
  tornTailRepaired: 'RECORD_TORN_TAIL_REPAIRED',
  timestampInvalid: 'RECORD_TIMESTAMP_INVALID',
  attestationInvalid: 'RECORD_ATTESTATION_INVALID',
  secretPresent: 'RECORD_SECRET_PRESENT',
  absolutePath: 'RECORD_ABSOLUTE_PATH',
  controlCharacter: 'RECORD_CONTROL_CHARACTER',
  executionUnproven: 'RECORD_EXECUTION_UNPROVEN',
  // Head anchor
  headMissing: 'RECORD_HEAD_MISSING',
  headCorrupt: 'RECORD_HEAD_CORRUPT',
  headAhead: 'RECORD_HEAD_AHEAD',
  headTipMismatch: 'RECORD_HEAD_TIP_MISMATCH',
  headRecovered: 'RECORD_HEAD_RECOVERED',
  // Transaction
  lockHeld: 'RECORD_LOCK_HELD',
  lockStaleRecovered: 'RECORD_LOCK_STALE_RECOVERED',
  writeIncomplete: 'RECORD_WRITE_INCOMPLETE',
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
  /**
   * How the journal relates to its anchor.
   *
   * `missing` is reported as a degraded state rather than silently treated as
   * agreement: a journal with no anchor cannot be checked for truncation, and
   * calling that "verified" would be the same overclaim the anchor exists to
   * remove.
   */
  headState: HeadState;
  /** False when no anchor was available to check suffix truncation against. */
  suffixAnchored: boolean;
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
