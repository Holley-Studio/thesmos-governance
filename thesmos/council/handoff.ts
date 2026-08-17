// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Typed agent handoff — the structured thing an agent returns instead of prose.
 *
 * The governing rule: **a claim of completion without the evidence the contract
 * requires is not a completion.** `validateHandoff` will not let `complete`
 * stand when required evidence is absent; it reports the gap and downgrades the
 * status to `partial`. An agent cannot mark its own homework by asserting
 * confidently.
 *
 * Everything a handoff carries is normalized before it is stored or rendered:
 * paths to forward slashes, lists deduplicated and sorted, secrets redacted,
 * absolute machine paths stripped. Handoffs get pasted into issues and PRs, so
 * the safe form is the only form.
 */

import {
  type CouncilAgentContract,
  type CouncilPrimaryRole,
  serializeStable,
} from './contract.js';
import { HANDOFF_BASE_REQUIRED_FIELDS, handoffRequiredFieldsForRole } from './evidence.js';
import { normalizeMatchPath } from './matching.js';
import {
  SANITIZE_LIMITS,
  containsSecretLike,
  redactSecrets,
  sanitizeText,
  scrubForOutput,
  toProvenancePath,
} from './sanitize.js';

// ── Schema ────────────────────────────────────────────────────────────────────

export const AGENT_HANDOFF_SCHEMA_VERSION = '1.0.0';

export const SUPPORTED_HANDOFF_SCHEMA_VERSIONS: readonly string[] = [
  AGENT_HANDOFF_SCHEMA_VERSION,
];

export type AgentHandoffStatus = 'complete' | 'partial' | 'blocked' | 'failed';

export const AGENT_HANDOFF_STATUSES: readonly AgentHandoffStatus[] = [
  'complete',
  'partial',
  'blocked',
  'failed',
];

export function isAgentHandoffStatus(value: unknown): value is AgentHandoffStatus {
  return typeof value === 'string' && (AGENT_HANDOFF_STATUSES as readonly string[]).includes(value);
}

export type AgentTestStatus = 'passed' | 'failed' | 'skipped' | 'errored';

export interface AgentTestResult {
  /** Suite or command label, e.g. `thesmos unit`. */
  name: string;
  status: AgentTestStatus;
  /** Counts, when the runner reported them. Absent is honest; zero is a claim. */
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  durationMs?: number;
  /** The command that produced this result, normalized — never re-executed. */
  command?: string;
  /** Short excerpt. Truncated and redacted; never raw runner output. */
  excerpt?: string;
}

export interface AgentHandoff {
  schemaVersion: string;
  missionId: string;
  taskId: string;
  agentId: string;
  status: AgentHandoffStatus;
  summary: string;
  evidenceRefs: string[];
  changedFiles: string[];
  commandsRun: string[];
  testResults: AgentTestResult[];
  unresolvedRisks: string[];
  recommendedNextTasks: string[];
}

// ── Codes ─────────────────────────────────────────────────────────────────────

export const HANDOFF_CODES = {
  schemaVersionUnsupported: 'HANDOFF_SCHEMA_VERSION_UNSUPPORTED',
  fieldMissing: 'HANDOFF_FIELD_MISSING',
  statusInvalid: 'HANDOFF_STATUS_INVALID',
  agentUnknown: 'HANDOFF_AGENT_UNKNOWN',
  agentMismatch: 'HANDOFF_AGENT_MISMATCH',
  evidenceMissing: 'HANDOFF_EVIDENCE_MISSING',
  completionUnproven: 'HANDOFF_COMPLETION_UNPROVEN',
  secretSerialized: 'HANDOFF_SECRET_SERIALIZED',
  absolutePath: 'HANDOFF_ABSOLUTE_PATH',
  testResultInvalid: 'HANDOFF_TEST_RESULT_INVALID',
} as const;

export interface HandoffIssue {
  code: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
  remediation?: string;
}

export interface HandoffValidationResult {
  valid: boolean;
  /** What the handoff actually proves, which may be less than it claims. */
  effectiveStatus: AgentHandoffStatus;
  issues: HandoffIssue[];
}

// ── Normalization ─────────────────────────────────────────────────────────────

const MAX_LIST_ITEMS = 200;
const MAX_EXCERPT = 400;

function normalizeIdentifier(value: unknown, maxLength = 120): string {
  if (typeof value !== 'string') return '';
  return sanitizeText(value, maxLength).replace(/\s+/g, '-');
}

/** Deduplicate, sort, and forward-slash a path list. Absolute paths are relativized. */
function normalizePathList(values: unknown, root?: string): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const value of values.slice(0, MAX_LIST_ITEMS)) {
    if (typeof value !== 'string') continue;
    const relative = toProvenancePath(value, root);
    if (!relative) continue;
    const normalized = normalizeMatchPath(relative);
    out.add(normalized.ok ? normalized.value.path : relative);
  }
  return [...out].sort();
}

/** Deduplicate, sort, redact. Order is not information — the set is. */
function normalizeTextList(values: unknown, root?: string, maxLength = 300): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const value of values.slice(0, MAX_LIST_ITEMS)) {
    if (typeof value !== 'string') continue;
    const clean = scrubForOutput(sanitizeText(value, maxLength), root);
    if (clean) out.add(clean);
  }
  return [...out].sort();
}

function normalizeTestResult(raw: unknown, root?: string): AgentTestResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = sanitizeText(r['name'], SANITIZE_LIMITS.displayName);
  if (!name) return null;
  const status: AgentTestStatus = ['passed', 'failed', 'skipped', 'errored'].includes(
    String(r['status'])
  )
    ? (String(r['status']) as AgentTestStatus)
    : 'errored';

  const count = (key: string): number | undefined => {
    const value = r[key];
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  };

  const command = typeof r['command'] === 'string' ? scrubForOutput(sanitizeText(r['command'], 200), root) : undefined;
  const excerpt =
    typeof r['excerpt'] === 'string' ? scrubForOutput(sanitizeText(r['excerpt'], MAX_EXCERPT), root) : undefined;

  return {
    name,
    status,
    ...(count('total') !== undefined ? { total: count('total') } : {}),
    ...(count('passed') !== undefined ? { passed: count('passed') } : {}),
    ...(count('failed') !== undefined ? { failed: count('failed') } : {}),
    ...(count('skipped') !== undefined ? { skipped: count('skipped') } : {}),
    ...(count('durationMs') !== undefined ? { durationMs: count('durationMs') } : {}),
    ...(command ? { command } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}

/**
 * Bring any candidate object into canonical handoff shape.
 *
 * Total: never throws, never partially applies. An unparsable input produces an
 * empty-but-valid-shaped handoff that then fails validation with specific codes,
 * rather than a half-normalized object that looks fine.
 */
export function normalizeHandoff(raw: unknown, root?: string): AgentHandoff {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    schemaVersion:
      typeof r['schemaVersion'] === 'string' ? r['schemaVersion'] : AGENT_HANDOFF_SCHEMA_VERSION,
    missionId: normalizeIdentifier(r['missionId']),
    taskId: normalizeIdentifier(r['taskId']),
    agentId: normalizeIdentifier(r['agentId']),
    status: isAgentHandoffStatus(r['status']) ? r['status'] : 'failed',
    summary: scrubForOutput(sanitizeText(r['summary'], 1000), root),
    evidenceRefs: normalizeTextList(r['evidenceRefs'], root),
    changedFiles: normalizePathList(r['changedFiles'], root),
    commandsRun: normalizeTextList(r['commandsRun'], root, 200),
    testResults: (Array.isArray(r['testResults']) ? r['testResults'] : [])
      .slice(0, MAX_LIST_ITEMS)
      .map((t) => normalizeTestResult(t, root))
      .filter((t): t is AgentTestResult => t !== null)
      .sort((a, b) => a.name.localeCompare(b.name)),
    unresolvedRisks: normalizeTextList(r['unresolvedRisks'], root),
    recommendedNextTasks: normalizeTextList(r['recommendedNextTasks'], root),
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Which handoff field carries the proof for each required field name. */
function fieldIsPopulated(handoff: AgentHandoff, field: string): boolean {
  switch (field) {
    case 'agentId':
      return handoff.agentId !== '';
    case 'missionId':
      return handoff.missionId !== '';
    case 'taskId':
      return handoff.taskId !== '';
    case 'status':
      return isAgentHandoffStatus(handoff.status);
    case 'summary':
      return handoff.summary.trim() !== '';
    case 'evidenceRefs':
      return handoff.evidenceRefs.length > 0;
    case 'changedFiles':
      return handoff.changedFiles.length > 0;
    case 'commandsRun':
      return handoff.commandsRun.length > 0;
    case 'testResults':
      return handoff.testResults.length > 0;
    case 'unresolvedRisks':
      // An explicit "no unresolved risks" is a claim the agent must make in the
      // summary; an empty list alone does not prove the question was asked.
      return handoff.unresolvedRisks.length > 0;
    case 'recommendedNextTasks':
      return handoff.recommendedNextTasks.length > 0;
    default:
      return false;
  }
}

export interface HandoffValidationOptions {
  /** The contract of the agent that produced this handoff. */
  contract?: CouncilAgentContract;
  /** Ids the mission knows about — an unknown agent id is a routing error. */
  knownAgentIds?: readonly string[];
  /** Used when no contract is supplied. */
  role?: CouncilPrimaryRole;
}

/**
 * Validate a normalized handoff.
 *
 * Returns `effectiveStatus` alongside `valid`: a handoff that claims `complete`
 * without its required evidence is reported *and* downgraded, so a caller that
 * only reads the status still cannot be misled.
 */
export function validateHandoff(
  handoff: AgentHandoff,
  options: HandoffValidationOptions = {}
): HandoffValidationResult {
  const issues: HandoffIssue[] = [];
  const add = (
    code: string,
    severity: 'error' | 'warning',
    path: string,
    message: string,
    remediation?: string
  ): void => {
    issues.push({ code, severity, path, message: redactSecrets(message), ...(remediation ? { remediation } : {}) });
  };

  if (!SUPPORTED_HANDOFF_SCHEMA_VERSIONS.includes(handoff.schemaVersion)) {
    add(
      HANDOFF_CODES.schemaVersionUnsupported,
      'error',
      'schemaVersion',
      `unsupported handoff schema version "${String(handoff.schemaVersion)}" (supported: ${SUPPORTED_HANDOFF_SCHEMA_VERSIONS.join(', ')})`,
      'emit the current schema version'
    );
  }

  if (!isAgentHandoffStatus(handoff.status)) {
    add(
      HANDOFF_CODES.statusInvalid,
      'error',
      'status',
      `status "${String(handoff.status)}" is not complete|partial|blocked|failed`
    );
  }

  for (const field of HANDOFF_BASE_REQUIRED_FIELDS) {
    if (!fieldIsPopulated(handoff, field)) {
      add(
        HANDOFF_CODES.fieldMissing,
        'error',
        field,
        `required field "${field}" is empty`,
        'every handoff must identify its mission, task, agent, status, and summary'
      );
    }
  }

  const contract = options.contract;
  if (contract && handoff.agentId && contract.identity.id !== handoff.agentId) {
    add(
      HANDOFF_CODES.agentMismatch,
      'error',
      'agentId',
      `handoff claims agent "${handoff.agentId}" but was validated against contract "${contract.identity.id}"`,
      'validate a handoff against the contract of the agent that produced it'
    );
  }

  if (options.knownAgentIds && handoff.agentId && !options.knownAgentIds.includes(handoff.agentId)) {
    add(
      HANDOFF_CODES.agentUnknown,
      'error',
      'agentId',
      `agent "${handoff.agentId}" is not a known agent`,
      'run `thesmos agents:list` to see routable agent ids'
    );
  }

  const requiredFields =
    contract?.handoff?.requiredFields ??
    (options.role ? handoffRequiredFieldsForRole(options.role) : HANDOFF_BASE_REQUIRED_FIELDS);

  const missingEvidence = [...requiredFields]
    .filter((field) => !HANDOFF_BASE_REQUIRED_FIELDS.includes(field))
    .filter((field) => !fieldIsPopulated(handoff, field))
    .sort();

  for (const field of missingEvidence) {
    add(
      HANDOFF_CODES.evidenceMissing,
      'error',
      field,
      `the contract requires evidence in "${field}", which is empty`,
      `populate ${field}, or report status "partial" and say what is missing`
    );
  }

  let effectiveStatus = isAgentHandoffStatus(handoff.status) ? handoff.status : 'failed';
  if (handoff.status === 'complete' && missingEvidence.length > 0) {
    effectiveStatus = 'partial';
    add(
      HANDOFF_CODES.completionUnproven,
      'error',
      'status',
      `status "complete" is not supported by the evidence — missing: ${missingEvidence.join(', ')}; recorded as "partial"`,
      'produce the missing evidence, or report the work as partial'
    );
  }

  for (const [index, result] of handoff.testResults.entries()) {
    if (
      result.total !== undefined &&
      result.passed !== undefined &&
      result.failed !== undefined &&
      result.passed + result.failed > result.total
    ) {
      add(
        HANDOFF_CODES.testResultInvalid,
        'error',
        `testResults[${index}]`,
        `passed (${result.passed}) + failed (${result.failed}) exceeds total (${result.total})`,
        'report the counts the runner actually printed'
      );
    }
    if (result.status === 'passed' && result.failed !== undefined && result.failed > 0) {
      add(
        HANDOFF_CODES.testResultInvalid,
        'error',
        `testResults[${index}]`,
        `"${result.name}" is reported as passed with ${result.failed} failing test(s)`,
        'a suite with failures is not passed'
      );
    }
  }

  for (const path of handoff.changedFiles) {
    if (/^([a-zA-Z]:)?\//.test(path)) {
      add(
        HANDOFF_CODES.absolutePath,
        'error',
        'changedFiles',
        `"${path}" is an absolute machine path`,
        'normalize with the repo root so paths are repo-relative'
      );
    }
  }

  if (containsSecretLike(serializeStable(handoff, 0))) {
    add(
      HANDOFF_CODES.secretSerialized,
      'error',
      'summary',
      'handoff contains a credential-shaped value',
      'never place command output containing credentials into a handoff'
    );
  }

  const sorted = [...issues].sort(
    (a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)
  );
  return {
    valid: !sorted.some((i) => i.severity === 'error'),
    effectiveStatus,
    issues: sorted,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Stable JSON. Same handoff, same bytes. */
export function serializeHandoff(handoff: AgentHandoff, indent = 2): string {
  return serializeStable(handoff, indent);
}

/** Human-readable Markdown, generated from the typed structure — never parsed back. */
export function renderHandoffMarkdown(handoff: AgentHandoff): string {
  const section = (title: string, items: readonly string[]): string[] =>
    items.length === 0 ? [] : ['', `**${title}**`, ...items.map((i) => `- ${i}`)];

  const tests = handoff.testResults.map((t) => {
    const counts = [
      t.total !== undefined ? `${t.total} total` : '',
      t.passed !== undefined ? `${t.passed} passed` : '',
      t.failed !== undefined ? `${t.failed} failed` : '',
      t.skipped !== undefined ? `${t.skipped} skipped` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return `${t.name} — ${t.status}${counts ? ` (${counts})` : ''}`;
  });

  return [
    `## Handoff — ${handoff.agentId}`,
    '',
    `- **Mission:** ${handoff.missionId || '(none)'}`,
    `- **Task:** ${handoff.taskId || '(none)'}`,
    `- **Status:** ${handoff.status}`,
    '',
    handoff.summary || '_No summary provided._',
    ...section('Changed files', handoff.changedFiles),
    ...section('Commands run', handoff.commandsRun),
    ...section('Tests', tests),
    ...section('Evidence', handoff.evidenceRefs),
    ...section('Unresolved risks', handoff.unresolvedRisks),
    ...section('Recommended next', handoff.recommendedNextTasks),
    '',
  ].join('\n');
}
