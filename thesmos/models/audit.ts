// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Model audit — deterministic detection of model drift across every surface.
 *
 * Follows the `doctor.ts` shape deliberately: the checks are pure functions over
 * an input struct, and I/O is confined to one loader at the bottom. That keeps
 * the whole detector testable without a filesystem and makes it embeddable in
 * `doctor` and `health` rather than becoming a fourth parallel command
 * (Operation Olympus D10 — extend, do not duplicate).
 *
 * Everything here is mechanical. No judgement, no model call, no heuristics —
 * the same repository state always produces the same findings, which is what
 * makes this safe to use as a required status check.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  type LogicalProfile,
  LOGICAL_PROFILES,
  MODEL_REGISTRY,
  REGISTRY_VERSION,
  isActiveModelId,
  lookupLegacyId,
  lookupModelId,
  priceOn,
  registryHash,
  resolveProfile,
} from './registry.js';
import { type ModelRouteDecision, hasModelMismatch } from './routing.js';

// ── Findings ─────────────────────────────────────────────────────────────────

export type ModelAuditSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ModelAuditCode =
  | 'MODEL_UNKNOWN_ID'
  | 'MODEL_DEPRECATED_ID'
  | 'MODEL_RETIRED_ID'
  | 'MODEL_INVALID_ID'
  | 'MODEL_MAP_DRIFT'
  | 'MODEL_PICKER_DRIFT'
  | 'MODEL_EXPORT_STALE'
  | 'MODEL_PRICING_OBSOLETE'
  | 'MODEL_PRICING_MISSING'
  | 'MODEL_FALLBACK_MISSING'
  | 'MODEL_AGENT_PINNED_FRONTIER'
  | 'MODEL_EFFECTIVE_MISMATCH'
  | 'MODEL_CLI_TOO_OLD'
  | 'MODEL_REGISTRY_MALFORMED';

export interface ModelAuditFinding {
  code: ModelAuditCode;
  severity: ModelAuditSeverity;
  /** Repo-relative path when the finding has a location. */
  file: string | null;
  message: string;
  fix: string;
}

export interface ModelAuditResult {
  findings: ModelAuditFinding[];
  registryVersion: string;
  registryHash: string;
  /** Counts by severity, for a one-line summary. */
  counts: Record<ModelAuditSeverity, number>;
  /** Agent documents parsed, so the report proves coverage rather than asserting it. */
  agentsScanned: number;
  /**
   * Of those, how many actually declare a `claude_model`.
   *
   * The two numbers differ legitimately: reviewer/specialist agents carry no
   * model pin and are excluded from map-drift comparison. Reporting only the
   * larger number would imply coverage the audit does not have.
   */
  agentsWithModel: number;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface AgentModelRecord {
  /** Repo-relative path to the agent document. */
  file: string;
  id: string;
  claudeModel: string | null;
  openaiModel: string | null;
  chatgptModel: string | null;
}

export interface GeneratedMapRecord {
  file: string;
  /** agent id → claude model id, as found in the generated artifact. */
  entries: Record<string, string>;
}

export interface ModelAuditInput {
  agents: readonly AgentModelRecord[];
  /** Every generated model map that must agree with the catalog. */
  generatedMaps: readonly GeneratedMapRecord[];
  /** Model ids offered by any provider/model picker UI. */
  pickerModelIds?: readonly { file: string; ids: readonly string[] }[];
  /** Routing decisions observed at runtime, for requested-vs-effective checks. */
  decisions?: readonly ModelRouteDecision[];
  /** Installed CLI version, when the caller could determine it. */
  cliVersion?: string | null;
  /** Date to evaluate pricing windows against. */
  now: Date;
}

// ── Pure checks ──────────────────────────────────────────────────────────────

function classifyId(
  id: string,
  file: string,
  field: string,
): ModelAuditFinding | null {
  if (isActiveModelId(id)) return null;

  const legacy = lookupLegacyId(id);
  if (legacy) {
    const replacement = legacy.replacementProfile
      ? resolveProfile(legacy.replacementProfile, legacy.provider)
      : null;
    const target = replacement ? `"${replacement.id}"` : 'a supported model';
    if (legacy.state === 'invalid') {
      return {
        code: 'MODEL_INVALID_ID',
        severity: 'BLOCKER',
        file,
        message: `${field} is "${id}", which is not a real model id. ${legacy.reason}`,
        fix: `Replace with ${target} (profile "${legacy.replacementProfile}").`,
      };
    }
    return {
      code: legacy.state === 'retired' ? 'MODEL_RETIRED_ID' : 'MODEL_DEPRECATED_ID',
      severity: legacy.state === 'retired' ? 'BLOCKER' : 'HIGH',
      file,
      message: `${field} is "${id}" (${legacy.state}). ${legacy.reason}`,
      fix: `Replace with ${target} (profile "${legacy.replacementProfile}").`,
    };
  }

  return {
    code: 'MODEL_UNKNOWN_ID',
    severity: 'HIGH',
    file,
    message: `${field} is "${id}", which is absent from the canonical model registry.`,
    fix: `Add it to thesmos/models/registry.ts with a verified source, or replace it with a registry model id.`,
  };
}

/** Unknown, deprecated, retired, invalid ids anywhere in active agent frontmatter. */
export function checkAgentModelIds(agents: readonly AgentModelRecord[]): ModelAuditFinding[] {
  const out: ModelAuditFinding[] = [];
  for (const a of agents) {
    if (a.claudeModel) {
      const f = classifyId(a.claudeModel, a.file, 'platforms.claude_model');
      if (f) out.push(f);
    }
    if (a.openaiModel) {
      const f = classifyId(a.openaiModel, a.file, 'platforms.openai_model');
      if (f) out.push(f);
    }
    if (a.chatgptModel) {
      const f = classifyId(a.chatgptModel, a.file, 'platforms.chatgpt_model');
      if (f) out.push(f);
    }
  }
  return out;
}

/**
 * No active agent may default to the frontier tier.
 *
 * This is the invariant that keeps cost bounded: frontier is a per-task human
 * decision, so a static pin makes every future invocation of that agent
 * frontier-priced without anyone re-deciding.
 */
export function checkNoFrontierPins(agents: readonly AgentModelRecord[]): ModelAuditFinding[] {
  const out: ModelAuditFinding[] = [];
  for (const a of agents) {
    if (!a.claudeModel) continue;
    const entry = lookupModelId(a.claudeModel);
    if (entry?.profile === 'frontier-long-horizon') {
      out.push({
        code: 'MODEL_AGENT_PINNED_FRONTIER',
        severity: 'BLOCKER',
        file: a.file,
        message: `Agent "${a.id}" statically defaults to the frontier model "${a.claudeModel}". Frontier is never a static assignment.`,
        fix: `Set platforms.claude_model to the balanced default ("${resolveProfile('balanced-agentic')?.id}") or, with written rationale, the deep-reasoning model ("${resolveProfile('deep-reasoning')?.id}"). Frontier is reached only via an approved per-task route.`,
      });
    }
  }
  return out;
}

/** Generated maps must equal what the catalog says. */
export function checkGeneratedMapDrift(
  agents: readonly AgentModelRecord[],
  maps: readonly GeneratedMapRecord[],
): ModelAuditFinding[] {
  const out: ModelAuditFinding[] = [];
  const canonical = new Map<string, string>();
  for (const a of agents) if (a.claudeModel) canonical.set(a.id, a.claudeModel);

  for (const map of maps) {
    for (const [agentId, mapped] of Object.entries(map.entries)) {
      const expected = canonical.get(agentId);
      if (expected === undefined) {
        out.push({
          code: 'MODEL_EXPORT_STALE',
          severity: 'HIGH',
          file: map.file,
          message: `Generated map lists agent "${agentId}", which no longer exists in the catalog.`,
          fix: 'Regenerate with `npm run agents:export --workspace=thesmos`.',
        });
        continue;
      }
      if (expected !== mapped) {
        out.push({
          code: 'MODEL_MAP_DRIFT',
          severity: 'HIGH',
          file: map.file,
          message: `Generated map has "${agentId}" → "${mapped}" but the catalog says "${expected}".`,
          fix: 'Regenerate with `npm run agents:export --workspace=thesmos`. Never hand-edit a generated model map.',
        });
      }
    }
    for (const [agentId] of canonical) {
      if (!(agentId in map.entries)) {
        out.push({
          code: 'MODEL_EXPORT_STALE',
          severity: 'HIGH',
          file: map.file,
          message: `Catalog agent "${agentId}" is missing from the generated map.`,
          fix: 'Regenerate with `npm run agents:export --workspace=thesmos`.',
        });
      }
    }
  }
  return out;
}

/** Every id a picker offers must be an active registry id. */
export function checkPickerDrift(
  pickers: readonly { file: string; ids: readonly string[] }[],
): ModelAuditFinding[] {
  const out: ModelAuditFinding[] = [];
  for (const p of pickers) {
    for (const id of p.ids) {
      if (isActiveModelId(id)) continue;
      const legacy = lookupLegacyId(id);
      out.push({
        code: 'MODEL_PICKER_DRIFT',
        severity: 'HIGH',
        file: p.file,
        message: legacy
          ? `Picker offers "${id}" (${legacy.state}). ${legacy.reason}`
          : `Picker offers "${id}", which is absent from the canonical model registry.`,
        fix: 'Derive picker entries from thesmos/models/registry.ts instead of listing ids inline.',
      });
    }
  }
  return out;
}

/**
 * Registry self-consistency: pricing windows must be usable today, fallbacks
 * must resolve, and the frontier tier must not dead-end.
 */
export function checkRegistryIntegrity(now: Date): ModelAuditFinding[] {
  const out: ModelAuditFinding[] = [];
  const file = 'thesmos/models/registry.ts';

  for (const e of MODEL_REGISTRY) {
    if (e.state !== 'active') continue;
    const label = `${e.provider}/${e.profile} ("${e.id}")`;

    if (e.pricing) {
      const p = priceOn(e.pricing, now);
      if (!p) {
        out.push({
          code: 'MODEL_PRICING_OBSOLETE',
          severity: 'HIGH',
          file,
          message: `${label} has pricing windows but none covers ${now.toISOString().slice(0, 10)}.`,
          fix: 'Add a current price window with a verified source URL and verifiedAt date.',
        });
      }
      // Overlapping windows make priceOn order-dependent — that is a bug.
      for (let i = 1; i < e.pricing.points.length; i++) {
        const prev = e.pricing.points[i - 1]!;
        const cur = e.pricing.points[i]!;
        if (prev.effectiveTo === null || cur.effectiveFrom <= prev.effectiveTo) {
          out.push({
            code: 'MODEL_REGISTRY_MALFORMED',
            severity: 'BLOCKER',
            file,
            message: `${label} has overlapping or unbounded-then-continued price windows at index ${i}.`,
            fix: 'Give every superseded price window an effectiveTo date that precedes the next effectiveFrom.',
          });
        }
      }
    } else if (e.provider === 'anthropic') {
      // Anthropic pricing is verifiable; a gap here is a real omission.
      out.push({
        code: 'MODEL_PRICING_MISSING',
        severity: 'MEDIUM',
        file,
        message: `${label} has no verified pricing recorded.`,
        fix: 'Record pricing with effective dates, or leave null and ensure consumers render cost as unknown.',
      });
    }

    // Only the cheapest profile may legitimately have no fallback.
    if (e.fallbackProfile === null && e.profile !== 'balanced-agentic') {
      out.push({
        code: 'MODEL_FALLBACK_MISSING',
        severity: 'MEDIUM',
        file,
        message: `${label} declares no fallback profile.`,
        fix: 'Set fallbackProfile so an unavailable model degrades predictably instead of failing.',
      });
    }
    if (e.fallbackProfile && !resolveProfile(e.fallbackProfile, e.provider)) {
      out.push({
        code: 'MODEL_REGISTRY_MALFORMED',
        severity: 'BLOCKER',
        file,
        message: `${label} falls back to "${e.fallbackProfile}", which has no ${e.provider} entry.`,
        fix: 'Add the missing provider entry or point the fallback at an existing profile.',
      });
    }
  }

  // Every profile must be servable by at least one provider.
  for (const profile of LOGICAL_PROFILES) {
    const served = MODEL_REGISTRY.some((e) => e.profile === profile && e.state === 'active');
    if (!served) {
      out.push({
        code: 'MODEL_REGISTRY_MALFORMED',
        severity: 'BLOCKER',
        file,
        message: `Logical profile "${profile}" has no active model on any provider.`,
        fix: 'Add an active entry for this profile.',
      });
    }
  }
  return out;
}

/** Requested vs effective divergence, from observed routing decisions. */
export function checkEffectiveModelTruth(
  decisions: readonly ModelRouteDecision[],
): ModelAuditFinding[] {
  const out: ModelAuditFinding[] = [];
  for (const d of decisions) {
    if (!hasModelMismatch(d)) continue;
    out.push({
      code: 'MODEL_EFFECTIVE_MISMATCH',
      severity: 'HIGH',
      file: null,
      message: `Requested "${d.requestedModelId}" but the runtime reported "${d.effectiveModelId}".`,
      fix: d.fallback
        ? `A fallback was recorded (${d.fallback.from}→${d.fallback.to}: ${d.fallback.reason}). Surface it to the user rather than showing the requested model.`
        : 'No fallback was recorded, so this divergence is unexplained. Investigate before trusting the turn summary.',
    });
  }
  return out;
}

/**
 * CLI version gate.
 *
 * Only reports when the registry carries a VERIFIED minimum. No minimum is
 * currently on record for any model, so this check stays silent rather than
 * inventing a version number to compare against — a fabricated threshold would
 * produce confidently wrong upgrade advice.
 */
export function checkCliVersion(
  cliVersion: string | null | undefined,
): ModelAuditFinding[] {
  const out: ModelAuditFinding[] = [];
  for (const e of MODEL_REGISTRY) {
    if (e.state !== 'active' || !e.minCliVersion) continue;
    if (!cliVersion) {
      out.push({
        code: 'MODEL_CLI_TOO_OLD',
        severity: 'LOW',
        file: null,
        message: `Cannot verify CLI support for "${e.id}" (requires ≥ ${e.minCliVersion}); installed version is unknown.`,
        fix: 'Report the installed CLI version so the minimum can be checked.',
      });
      continue;
    }
    if (compareSemver(cliVersion, e.minCliVersion) < 0) {
      out.push({
        code: 'MODEL_CLI_TOO_OLD',
        severity: 'HIGH',
        file: null,
        message: `Installed CLI ${cliVersion} cannot expose "${e.displayName}" (${e.id}), which requires ≥ ${e.minCliVersion}.`,
        fix: `Upgrade the CLI to ${e.minCliVersion} or newer, then re-select the model.`,
      });
    }
  }
  return out;
}

/** Numeric semver compare. Returns <0, 0, or >0. Non-numeric parts sort as 0. */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.');
  const pb = b.replace(/^v/, '').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? '0', 10) || 0;
    const nb = Number.parseInt(pb[i] ?? '0', 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// ── Aggregate ────────────────────────────────────────────────────────────────

export function auditModels(input: ModelAuditInput): ModelAuditResult {
  const findings: ModelAuditFinding[] = [
    ...checkRegistryIntegrity(input.now),
    ...checkAgentModelIds(input.agents),
    ...checkNoFrontierPins(input.agents),
    ...checkGeneratedMapDrift(input.agents, input.generatedMaps),
    ...checkPickerDrift(input.pickerModelIds ?? []),
    ...checkEffectiveModelTruth(input.decisions ?? []),
    ...checkCliVersion(input.cliVersion),
  ];

  const counts: Record<ModelAuditSeverity, number> = { BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.severity] += 1;

  return {
    findings,
    registryVersion: REGISTRY_VERSION,
    registryHash: registryHash(),
    counts,
    agentsScanned: input.agents.length,
    agentsWithModel: input.agents.filter((a) => a.claudeModel !== null).length,
  };
}

// ── I/O (the only impure part) ───────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Minimal frontmatter field read. Sufficient for the flat `platforms:` block. */
function readScalar(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!m) return null;
  return m[1]!.replace(/^["']|["']$/g, '').trim() || null;
}

export function parseAgentModelRecord(source: string, file: string): AgentModelRecord | null {
  const fm = source.match(FRONTMATTER_RE);
  if (!fm) return null;
  const block = fm[1]!;
  const id = readScalar(block, 'id');
  if (!id) return null;
  const enabled = readScalar(block, 'enabled');
  if (enabled !== null && enabled.toLowerCase() === 'false') return null;
  return {
    file,
    id,
    claudeModel: readScalar(block, 'claude_model'),
    openaiModel: readScalar(block, 'openai_model'),
    chatgptModel: readScalar(block, 'chatgpt_model'),
  };
}

const GENERATED_ENTRY_RE = /^\s*"([^"]+)":\s*"([^"]+)",?\s*$/gm;

export function parseGeneratedMap(source: string, file: string): GeneratedMapRecord {
  const entries: Record<string, string> = {};
  for (const m of source.matchAll(GENERATED_ENTRY_RE)) entries[m[1]!] = m[2]!;
  return { file, entries };
}

function walkMarkdown(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkMarkdown(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

export interface RunModelAuditOptions {
  now?: Date;
  cliVersion?: string | null;
  decisions?: readonly ModelRouteDecision[];
}

/** Load repository state and run the audit. The only filesystem entry point. */
export function runModelAuditForRoot(
  root: string,
  options: RunModelAuditOptions = {},
): ModelAuditResult {
  // `root` may be the monorepo root OR the thesmos workspace directory,
  // depending on which npm script invoked us. Resolving both keeps `doctor`
  // and `health` honest from either cwd — scanning zero agents and reporting
  // "no drift" would be a false all-clear, which is worse than an error.
  const catalogRoot = existsSync(join(root, 'thesmos', 'catalog', 'agents'))
    ? root
    : existsSync(join(root, 'catalog', 'agents'))
      ? join(root, '..')
      : root;

  const agents: AgentModelRecord[] = [];
  for (const full of walkMarkdown(join(catalogRoot, 'thesmos', 'catalog', 'agents'))) {
    const rec = parseAgentModelRecord(readFileSync(full, 'utf8'), relative(catalogRoot, full));
    if (rec) agents.push(rec);
  }

  const generatedMaps: GeneratedMapRecord[] = [];
  for (const rel of [
    join('thesmos', 'generated', 'pantheon-models.ts'),
    join('extensions', 'vscode', 'src', 'generated', 'pantheon-models.ts'),
  ]) {
    const full = join(catalogRoot, rel);
    if (existsSync(full)) generatedMaps.push(parseGeneratedMap(readFileSync(full, 'utf8'), rel));
  }

  return auditModels({
    agents,
    generatedMaps,
    decisions: options.decisions,
    cliVersion: options.cliVersion,
    now: options.now ?? new Date(),
  });
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatModelAuditConsole(result: ModelAuditResult): string {
  const lines: string[] = [];
  lines.push(`Model audit — registry ${result.registryVersion} (hash ${result.registryHash})`);
  lines.push(
    `Agents scanned: ${result.agentsScanned} (${result.agentsWithModel} declare a Claude model; the rest carry no model pin)`,
  );
  if (result.findings.length === 0) {
    lines.push('No model drift detected.');
    return lines.join('\n');
  }
  lines.push(
    `Findings: ${result.counts.BLOCKER} BLOCKER · ${result.counts.HIGH} HIGH · ${result.counts.MEDIUM} MEDIUM · ${result.counts.LOW} LOW`,
  );
  lines.push('');
  for (const f of result.findings) {
    lines.push(`[${f.severity}] ${f.code}${f.file ? ` — ${f.file}` : ''}`);
    lines.push(`  ${f.message}`);
    lines.push(`  fix: ${f.fix}`);
  }
  return lines.join('\n');
}
