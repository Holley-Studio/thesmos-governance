// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — construction and content hashing.
 *
 * One canonical serializer and one hash format, both borrowed from layers that
 * already use them: `serializeStable` from the council contract and
 * `contentHash` from agent ownership. A second serializer would be a second
 * definition of "identical", which is the thing this layer exists to make
 * unambiguous.
 *
 * `recordedAt` and `sequence` are outside the hashed projection on purpose. A
 * wall-clock reading would make an otherwise identical replay hash differently,
 * and position is a property of the journal rather than of what the record
 * means.
 */

import { contentHash } from '../agent-ownership.js';
import { serializeStable } from '../council/contract.js';
import { redactField, redactMap } from './redact.js';
import {
  GENESIS_HASH,
  RECORD_SCHEMA_VERSION,
  isCanonicalTimestamp,
  isRecordAttestation,
  isRecordEventKind,
  type CouncilRecord,
  type RecordActor,
  type RecordAttestation,
  type RecordAuthority,
  type RecordContent,
  type RecordEnvelope,
  type RecordEventKind,
  type RecordIdentity,
  type RecordOutcome,
} from './types.js';

/** What a caller supplies. Everything derived is computed here, not accepted. */
export interface RecordInput {
  event: RecordEventKind;
  identity: RecordIdentity;
  actor: RecordActor;
  intent: string;
  outcome: RecordOutcome;
  authority?: RecordAuthority;
  digests?: Record<string, string>;
  links?: Record<string, string>;
}

function redactActor(actor: RecordActor, root?: string): RecordActor {
  switch (actor.kind) {
    case 'human':
      return { kind: 'human', confirmationId: redactField(actor.confirmationId, root) };
    case 'agent':
      return {
        kind: 'agent',
        agentId: redactField(actor.agentId, root),
        contractVersion: redactField(actor.contractVersion, root),
        contractHash: redactField(actor.contractHash, root),
      };
    default:
      return { kind: 'system', component: redactField(actor.component, root) };
  }
}

/**
 * Rebuild the outcome variant by variant.
 *
 * Deliberately not a spread. Copying an arbitrary caller object would let an
 * `executed`-shaped field ride along on a `planned` outcome, and the whole
 * point of the union is that such a field cannot exist. Reconstructing means
 * only the fields belonging to the matched variant survive.
 */
function redactOutcome(outcome: RecordOutcome, root?: string): RecordOutcome {
  switch (outcome.kind) {
    case 'validated':
      return { kind: 'validated', valid: outcome.valid === true };
    case 'refused':
      return { kind: 'refused', reasonCode: redactField(outcome.reasonCode, root) };
    case 'failed':
      return { kind: 'failed', reasonCode: redactField(outcome.reasonCode, root) };
    case 'executed':
      return {
        kind: 'executed',
        receiptRef: redactField(outcome.receiptRef, root),
        receiptTaskId: redactField(outcome.receiptTaskId, root),
      };
    default:
      return { kind: 'planned' };
  }
}

function redactIdentity(identity: RecordIdentity, root?: string): RecordIdentity {
  const missionId = redactField(identity.missionId ?? '', root);
  const taskId = redactField(identity.taskId ?? '', root);
  return {
    correlationId: redactField(identity.correlationId, root),
    causationId: redactField(identity.causationId ?? '', root),
    ...(missionId ? { missionId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

/**
 * Build the hashable content of a record.
 *
 * Never throws on bad input: an unknown event kind degrades to
 * `failure.recorded` rather than rejecting, because losing the fact that
 * *something* happened is worse than recording it under a coarser label.
 */
export function buildRecordContent(input: RecordInput, root?: string): RecordContent {
  const digests = redactMap(input.digests, root).map;
  const links = redactMap(input.links, root).map;

  const authority = input.authority
    ? {
        channel: input.authority.channel,
        target: redactField(input.authority.target, root),
        decision: input.authority.decision,
        reason: redactField(input.authority.reason, root),
        ...(input.authority.confirmationId
          ? { confirmationId: redactField(input.authority.confirmationId, root) }
          : {}),
      }
    : undefined;

  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    event: isRecordEventKind(input.event) ? input.event : 'failure.recorded',
    identity: redactIdentity(input.identity, root),
    actor: redactActor(input.actor, root),
    intent: redactField(input.intent, root),
    outcome: redactOutcome(input.outcome, root),
    ...(authority ? { authority } : {}),
    digests,
    links,
  };
}

/**
 * `sha256:<hex>` over the semantic content alone — **identity, not integrity**.
 *
 * Deliberately excludes position, time and attestation so that two records
 * describing the same event hash identically. That property is what makes
 * replay determinism testable, and it is exactly why this hash cannot also
 * protect the envelope: see `hashRecordEnvelope`.
 */
export function hashRecordContent(content: RecordContent): string {
  return contentHash(serializeStable(content));
}

/**
 * `sha256:<hex>` over the envelope — **integrity, not identity**.
 *
 * Binds semantic identity to this position, this timestamp, this attestation
 * state and this chain. Changing any of them changes this digest, which is what
 * makes a persisted record unforgeable in place.
 *
 * An earlier revision had only `hashRecordContent`, so `recordedAt` was covered
 * by nothing and could be rewritten freely on an existing journal without
 * detection.
 */
export function hashRecordEnvelope(envelope: RecordEnvelope): string {
  return contentHash(
    serializeStable({
      contentHash: envelope.contentHash,
      prevRecordHash: envelope.prevRecordHash,
      sequence: envelope.sequence,
      recordedAt: envelope.recordedAt,
      attestation: envelope.attestation,
    })
  );
}

/**
 * Seal a record into the chain.
 *
 * `recordedAt` is supplied rather than read from the clock so the caller owns
 * the only non-deterministic input and tests can produce byte-identical
 * journals. It is validated here rather than trusted: an unparseable or
 * non-canonical timestamp would otherwise be authenticated as-is, making the
 * envelope hash agree with a value no reader can interpret.
 */
export function sealRecord(
  content: RecordContent,
  prevRecordHash: string,
  sequence: number,
  recordedAt: string,
  attestation: RecordAttestation = { kind: 'none' }
): CouncilRecord {
  if (!isCanonicalTimestamp(recordedAt)) {
    throw new Error(`recordedAt must be canonical ISO-8601 UTC with milliseconds`);
  }
  if (!isRecordAttestation(attestation)) {
    throw new Error(`attestation must be exactly { kind: 'none' }`);
  }

  const envelope: RecordEnvelope = {
    contentHash: hashRecordContent(content),
    prevRecordHash: prevRecordHash || GENESIS_HASH,
    sequence,
    recordedAt,
    attestation,
  };

  return { ...content, ...envelope, recordHash: hashRecordEnvelope(envelope) };
}

/** Strip the envelope back off, for re-hashing semantic content on verification. */
export function contentOf(record: CouncilRecord): RecordContent {
  const {
    contentHash: _c,
    prevRecordHash: _p,
    sequence: _s,
    recordedAt: _r,
    attestation: _a,
    recordHash: _h,
    ...content
  } = record;
  return content as RecordContent;
}

/** Lift the envelope back out, for re-hashing on verification. */
export function envelopeOf(record: CouncilRecord): RecordEnvelope {
  return {
    contentHash: record.contentHash,
    prevRecordHash: record.prevRecordHash,
    sequence: record.sequence,
    recordedAt: record.recordedAt,
    attestation: record.attestation,
  };
}
