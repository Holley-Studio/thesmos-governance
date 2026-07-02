// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos Drift Detection — proves that governance is actually in sync.
 *
 * Detects 10 categories of drift:
 *   1.  adapter.missing           — adapter file not generated
 *   2.  adapter.no-metadata       — generated section has no THESMOS:META comment
 *   3.  adapter.rule-count-mismatch — META ruleCount != current registry
 *   4.  adapter.version-mismatch  — META version != current config
 *   5.  adapter.manual-edit       — content inside generated section was edited by hand
 *   6.  governance.missing        — governance markdown file not generated
 *   7.  governance.stale          — rule-dependent section is out of sync with registry
 *   8.  registry.not-propagated   — registry has agents/skills but adapters don't reflect them
 *   9.  registry.agent-file-missing / registry.skill-file-missing — registered ID has no file
 *   10. catalog.unknown-agent / catalog.unknown-skill — registered ID unknown to any catalog
 *   11. profile.missing-artifact  — profile active in registry but required file not on disk
 *   12. report.missing / report.stale — report.json absent or beyond max-age
 *
 * All check functions are pure — fs access is injected via DriftInput so the
 * full suite is testable without touching disk. The only I/O function is
 * runDriftForRoot().
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ThesmosConfig } from './types';
import {
  ADAPTER_OUTPUT_PATHS,
  THESMOS_RULES,
  buildAdapterContent,
  parseAdapterMeta,
  type Rule,
} from './adapters';
import { extractGeneratedSection } from './output';
import { buildInitFiles } from './init';
import { isReportStale } from './report';
import {
  loadRegistryConfig,
  mergeRegistryConfig,
  REGISTRY_DEFAULTS,
} from './registry';
import { loadBuiltInCatalog, loadUserCatalog, loadCatalogProfile } from './catalog';

// ── Public types ──────────────────────────────────────────────────────────────

export interface DriftFinding {
  type: string;
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW';
  file?: string;
  message: string;
  fixSuggestion?: string;
}

export interface DriftInput {
  config: ThesmosConfig;
  rules: Rule[];
  /** Returns true when a repo-relative path exists. */
  fileExists: (rel: string) => boolean;
  /** Returns file contents or null on any error. */
  readFileSafe: (rel: string) => string | null;
  /** Returns parsed JSON object or null on any error. */
  readJsonSafe: (rel: string) => Record<string, unknown> | null;
  /** Returns bare filenames in a directory (NOT full paths); empty array on any error. */
  listDirSafe: (rel: string) => string[];
  /** Injectable current time — lets tests control staleness without mocking Date. */
  now: Date;
  // ── Pre-loaded registry state ─────────────────────────────────────────────
  registryAgentIds: string[];
  registrySkillIds: string[];
  registryProfileIds: string[];
  // ── Pre-loaded profile expectations ──────────────────────────────────────
  /** profileId → { agents, skills } — IDs that should be installed on disk */
  profileExpected: Map<string, { agents: string[]; skills: string[] }>;
  // ── Pre-loaded catalog knowledge ──────────────────────────────────────────
  /** All agent IDs known to any catalog (built-in or user) */
  knownAgentIds: Set<string>;
  /** All skill IDs known to any catalog (built-in or user) */
  knownSkillIds: Set<string>;
  /**
   * Expected content of governance files produced by buildInitFiles(config).
   * Keyed by repo-relative path. Pre-computed so check functions stay pure.
   */
  expectedInitContent: Record<string, string>;
}

// ── Governance files whose generated sections contain rule-derived content ────

const GOVERNANCE_SECTIONS: Array<{ path: string; sectionId: string }> = [
  { path: '.thesmos/GUARDRAILS.md', sectionId: 'rules' },
  { path: '.thesmos/RULES.md', sectionId: 'rules' },
  { path: '.thesmos/governance/CODE_REVIEW.md', sectionId: 'checklist' },
  { path: '.thesmos/governance/REVIEW_AGENT.md', sectionId: 'instructions' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Remove the "## Active Thesmos Context" catalog context block that
 * buildAdapterContent appends when a catalog is passed. This lets us compare
 * the rules-only portion of a generated section without false-positive hits
 * when catalog context has been legitimately injected.
 */
function stripCatalogContext(section: string): string {
  const MARKER = '\n---\n\n## Active Thesmos Context';
  const idx = section.indexOf(MARKER);
  // Use trimEnd() so that any extra trailing newline left after slicing doesn't
  // cause a false-positive mismatch against the expected (which has no trailing ws).
  return (idx === -1 ? section : section.slice(0, idx)).trimEnd();
}

// ── Check 1 & 7: Missing adapter files and missing governance files ────────────

function checkMissingFiles(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  // Adapter files — BLOCKER: every target must be generated
  for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
    if (!input.fileExists(relPath)) {
      findings.push({
        type: 'adapter.missing',
        severity: 'BLOCKER',
        file: relPath,
        message: `${relPath} is missing — ${target} adapter has not been generated`,
        fixSuggestion: 'Run thesmos adapters to generate all AI adapter files',
      });
    }
  }

  // Governance files — HIGH: required governance docs not present
  for (const { path: relPath } of GOVERNANCE_SECTIONS) {
    if (!input.fileExists(relPath)) {
      findings.push({
        type: 'governance.missing',
        severity: 'HIGH',
        file: relPath,
        message: `${relPath} is missing — governance doc has not been generated`,
        fixSuggestion: 'Run thesmos init to create all governance files',
      });
    }
  }

  return findings;
}

// ── Check 2, 3, 4: Adapter metadata mismatches ────────────────────────────────

function checkAdapterMetadata(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
    if (!input.fileExists(relPath)) continue; // already reported as missing

    const content = input.readFileSafe(relPath);
    if (!content) continue;

    const meta = parseAdapterMeta(content);

    if (!meta) {
      findings.push({
        type: 'adapter.no-metadata',
        severity: 'HIGH',
        file: relPath,
        message: `${relPath} is missing the THESMOS:META comment — cannot verify freshness`,
        fixSuggestion: 'Run thesmos adapters to regenerate with embedded metadata',
      });
      continue;
    }

    if (meta.ruleCount !== input.rules.length) {
      findings.push({
        type: 'adapter.rule-count-mismatch',
        severity: 'HIGH',
        file: relPath,
        message: `${relPath} (${target}) has ${meta.ruleCount} rules but registry has ${input.rules.length}`,
        fixSuggestion: 'Run thesmos adapters to regenerate adapter files from the current rule registry',
      });
    }

    if (meta.version !== input.config.version) {
      findings.push({
        type: 'adapter.version-mismatch',
        severity: 'MEDIUM',
        file: relPath,
        message: `${relPath} (${target}) was generated at version ${meta.version}, current version is ${input.config.version}`,
        fixSuggestion: 'Run thesmos adapters to refresh adapter files after upgrading Thesmos',
      });
    }
  }

  return findings;
}

// ── Check 5: Manual edits inside generated sections ───────────────────────────

function checkManualEdits(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
    if (!input.fileExists(relPath)) continue;

    const content = input.readFileSafe(relPath);
    if (!content) continue;

    const meta = parseAdapterMeta(content);
    // Only check when metadata is fresh — stale files already reported by checkAdapterMetadata
    if (!meta) continue;
    if (meta.ruleCount !== input.rules.length) continue;
    if (meta.version !== input.config.version) continue;

    const actualSection = extractGeneratedSection(content, 'rules');
    if (!actualSection) continue;

    // Build the expected generated section (no catalog context)
    const freshContent = buildAdapterContent(
      target as keyof typeof ADAPTER_OUTPUT_PATHS,
      '',
      input.rules,
      input.config
    );
    const expectedSection = extractGeneratedSection(freshContent, 'rules');
    if (!expectedSection) continue;

    // Strip catalog context appended by buildAdapterContent when a catalog is active
    const actualCore = stripCatalogContext(actualSection);
    const expectedCore = stripCatalogContext(expectedSection);

    if (actualCore !== expectedCore) {
      findings.push({
        type: 'adapter.manual-edit',
        severity: 'HIGH',
        file: relPath,
        message: `${relPath} (${target}) has manual edits inside the THESMOS:GENERATED section — content does not match the canonical generator output`,
        fixSuggestion: 'Remove edits inside the THESMOS:GENERATED markers and run thesmos adapters, or move content outside the markers',
      });
    }
  }

  return findings;
}

// ── Check 6: Governance docs out of sync with rule registry ───────────────────

function checkGovernanceDocs(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const { path: relPath, sectionId } of GOVERNANCE_SECTIONS) {
    if (!input.fileExists(relPath)) continue; // already reported as missing

    const actualContent = input.readFileSafe(relPath);
    if (!actualContent) continue;

    const actualSection = extractGeneratedSection(actualContent, sectionId);
    if (!actualSection) {
      // File exists but generated section markers are absent
      findings.push({
        type: 'governance.stale',
        severity: 'MEDIUM',
        file: relPath,
        message: `${relPath} is missing the THESMOS:GENERATED markers for section "${sectionId}"`,
        fixSuggestion: 'Run thesmos init to regenerate governance files',
      });
      continue;
    }

    const expectedContent = input.expectedInitContent[relPath];
    if (!expectedContent) continue;

    const expectedSection = extractGeneratedSection(expectedContent, sectionId);
    if (!expectedSection) continue;

    if (actualSection !== expectedSection) {
      findings.push({
        type: 'governance.stale',
        severity: 'MEDIUM',
        file: relPath,
        message: `${relPath} section "${sectionId}" is out of sync with the current rule registry`,
        fixSuggestion: 'Run thesmos init to regenerate governance files from the current rule registry',
      });
    }
  }

  return findings;
}

// ── Check 8: Registry changes not propagated to adapter files ─────────────────

function checkRegistryPropagation(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];
  if (input.registryAgentIds.length === 0 && input.registrySkillIds.length === 0) {
    return findings;
  }

  const CATALOG_SECTION = '## Active Thesmos Context';

  for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
    if (!input.fileExists(relPath)) continue;

    const content = input.readFileSafe(relPath);
    if (!content) continue;

    if (!content.includes(CATALOG_SECTION)) {
      findings.push({
        type: 'registry.not-propagated',
        severity: 'HIGH',
        file: relPath,
        message: `${relPath} (${target}) does not include the active catalog context — registry has ${input.registryAgentIds.length} agent(s) and ${input.registrySkillIds.length} skill(s)`,
        fixSuggestion: 'Run thesmos adapters to propagate the registry configuration into all adapter files',
      });
    }
  }

  return findings;
}

// ── Check 9: Registered agent/skill IDs with no corresponding file on disk ────

function checkRegistryFiles(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const id of input.registryAgentIds) {
    const relPath = `.thesmos/agents/${id}.md`;
    if (!input.fileExists(relPath)) {
      findings.push({
        type: 'registry.agent-file-missing',
        severity: 'HIGH',
        file: relPath,
        message: `Agent "${id}" is enabled in registry.json but ${relPath} does not exist`,
        fixSuggestion: `Run thesmos agent:create "${id}" or thesmos catalog:enable ${id} agent to install the file`,
      });
    }
  }

  for (const id of input.registrySkillIds) {
    const relPath = `.thesmos/skills/${id}.md`;
    if (!input.fileExists(relPath)) {
      findings.push({
        type: 'registry.skill-file-missing',
        severity: 'HIGH',
        file: relPath,
        message: `Skill "${id}" is enabled in registry.json but ${relPath} does not exist`,
        fixSuggestion: `Run thesmos skill:create "${id}" or thesmos catalog:enable ${id} skill to install the file`,
      });
    }
  }

  return findings;
}

// ── Check 10: Catalog consistency — registered IDs unknown to any catalog ─────

function checkCatalogConsistency(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const id of input.registryAgentIds) {
    if (!input.knownAgentIds.has(id)) {
      findings.push({
        type: 'catalog.unknown-agent',
        severity: 'MEDIUM',
        file: `.thesmos/agents/${id}.md`,
        message: `Agent "${id}" is in registry.json but not found in any catalog (built-in or user)`,
        fixSuggestion: `Run thesmos agent:create "${id}" to scaffold the agent file, then add it to the catalog`,
      });
    }
  }

  for (const id of input.registrySkillIds) {
    if (!input.knownSkillIds.has(id)) {
      findings.push({
        type: 'catalog.unknown-skill',
        severity: 'MEDIUM',
        file: `.thesmos/skills/${id}.md`,
        message: `Skill "${id}" is in registry.json but not found in any catalog (built-in or user)`,
        fixSuggestion: `Run thesmos skill:create "${id}" to scaffold the skill file, then add it to the catalog`,
      });
    }
  }

  return findings;
}

// ── Check 11: Profile artifacts missing on disk ───────────────────────────────

function checkProfileArtifacts(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const profileId of input.registryProfileIds) {
    const expected = input.profileExpected.get(profileId);
    if (!expected) {
      findings.push({
        type: 'profile.unknown',
        severity: 'MEDIUM',
        message: `Profile "${profileId}" is listed in registry.json but is not a known built-in profile`,
        fixSuggestion: 'Run thesmos catalog:profiles to list available profiles',
      });
      continue;
    }

    for (const agentId of expected.agents) {
      const relPath = `.thesmos/agents/${agentId}.md`;
      if (!input.fileExists(relPath)) {
        findings.push({
          type: 'profile.missing-artifact',
          severity: 'MEDIUM',
          file: relPath,
          message: `Profile "${profileId}" requires agent "${agentId}" but ${relPath} is not on disk`,
          fixSuggestion: `Run thesmos init --profile=${profileId} to install all profile artifacts`,
        });
      }
    }

    for (const skillId of expected.skills) {
      const relPath = `.thesmos/skills/${skillId}.md`;
      if (!input.fileExists(relPath)) {
        findings.push({
          type: 'profile.missing-artifact',
          severity: 'MEDIUM',
          file: relPath,
          message: `Profile "${profileId}" requires skill "${skillId}" but ${relPath} is not on disk`,
          fixSuggestion: `Run thesmos init --profile=${profileId} to install all profile artifacts`,
        });
      }
    }
  }

  return findings;
}

// ── Check 12: Stale or missing report.json ────────────────────────────────────

function checkReportStaleness(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const reportPath = '.thesmos/report.json';

  if (!input.fileExists(reportPath)) {
    findings.push({
      type: 'report.missing',
      severity: 'MEDIUM',
      file: reportPath,
      message: 'report.json is missing — thesmos scan has not been run',
      fixSuggestion: 'Run thesmos scan to generate the initial repo intelligence report',
    });
    return findings;
  }

  const report = input.readJsonSafe(reportPath);
  const generatedAt = report?.['generatedAt'] as string | undefined;
  const maxDays = input.config.doctor.reportMaxAgeDays;

  if (isReportStale(generatedAt, maxDays, input.now.getTime())) {
    const ageLabel = generatedAt
      ? `${Math.floor((input.now.getTime() - new Date(generatedAt).getTime()) / 86_400_000)} day(s) old`
      : 'no timestamp';
    findings.push({
      type: 'report.stale',
      severity: 'LOW',
      file: reportPath,
      message: `report.json is stale (${ageLabel}, limit ${maxDays} days) — repo intelligence may be outdated`,
      fixSuggestion: 'Run thesmos scan to refresh the repo intelligence report',
    });
  }

  return findings;
}

// ── Aggregator ────────────────────────────────────────────────────────────────

/**
 * Run all drift checks against the provided injectable input.
 * Returns findings sorted by severity (BLOCKER first) then file name.
 */
export function runDrift(input: DriftInput): DriftFinding[] {
  const raw = [
    ...checkMissingFiles(input),
    ...checkAdapterMetadata(input),
    ...checkManualEdits(input),
    ...checkGovernanceDocs(input),
    ...checkRegistryPropagation(input),
    ...checkRegistryFiles(input),
    ...checkCatalogConsistency(input),
    ...checkProfileArtifacts(input),
    ...checkReportStaleness(input),
  ];

  const SEVERITY_RANK: Record<DriftFinding['severity'], number> = {
    BLOCKER: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };

  return raw.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      a.type.localeCompare(b.type)
  );
}

// ── I/O entry point ───────────────────────────────────────────────────────────

/** Run drift checks against an actual repo on disk. */
export function runDriftForRoot(root: string, config: ThesmosConfig): DriftFinding[] {
  // Load registry
  const regRaw = loadRegistryConfig(root);
  const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, regRaw);

  // Load catalog knowledge (silent on any error — catalog may not be installed)
  let knownAgentIds = new Set<string>();
  let knownSkillIds = new Set<string>();
  try {
    const builtin = loadBuiltInCatalog();
    const user = loadUserCatalog(root);
    knownAgentIds = new Set([
      ...builtin.agents.map((a) => a.frontmatter.id),
      ...user.agents.map((a) => a.frontmatter.id),
    ]);
    knownSkillIds = new Set([
      ...builtin.skills.map((s) => s.frontmatter.id),
      ...user.skills.map((s) => s.frontmatter.id),
    ]);
  } catch { /* catalog unavailable — consistency checks will be skipped */ }

  // Load profile expectations
  const profileExpected = new Map<string, { agents: string[]; skills: string[] }>();
  for (const id of merged.profiles) {
    try {
      const profile = loadCatalogProfile(id);
      if (profile) profileExpected.set(id, { agents: profile.agents, skills: profile.skills });
    } catch { /* profile not found */ }
  }

  // Pre-build expected governance content (pure — no disk reads inside buildInitFiles)
  let expectedInitContent: Record<string, string> = {};
  try {
    expectedInitContent = buildInitFiles(config, undefined, {});
  } catch { /* init build failed — governance checks will be skipped */ }

  const readFileSafe = (rel: string): string | null => {
    try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; }
  };
  const readJsonSafe = (rel: string): Record<string, unknown> | null => {
    try { return JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>; } catch { return null; }
  };
  const listDirSafe = (rel: string): string[] => {
    try { return readdirSync(join(root, rel)); } catch { return []; }
  };

  return runDrift({
    config,
    rules: THESMOS_RULES,
    fileExists: (rel) => existsSync(join(root, rel)),
    readFileSafe,
    readJsonSafe,
    listDirSafe,
    now: new Date(),
    registryAgentIds: merged.agents,
    registrySkillIds: merged.skills,
    registryProfileIds: merged.profiles,
    profileExpected,
    knownAgentIds,
    knownSkillIds,
    expectedInitContent,
  });
}

// ── Output formatters ─────────────────────────────────────────────────────────

const SEVERITY_RANK_LABEL: Record<DriftFinding['severity'], string> = {
  BLOCKER: '🔴 BLOCKER',
  HIGH: '🟠 HIGH',
  MEDIUM: '🟡 MEDIUM',
  LOW: '🔵 LOW',
};

function groupBySeverity(
  findings: DriftFinding[]
): Map<DriftFinding['severity'], DriftFinding[]> {
  const order: DriftFinding['severity'][] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'];
  const map = new Map<DriftFinding['severity'], DriftFinding[]>(
    order.map((s) => [s, []])
  );
  for (const f of findings) map.get(f.severity)!.push(f);
  return map;
}

/**
 * Human-readable console drift report.
 */
export function formatDriftConsole(
  findings: DriftFinding[],
  projectName = 'Repo'
): string {
  const lines: string[] = [];
  lines.push(`Thesmos Drift — ${projectName}`);
  lines.push('─'.repeat(52));
  lines.push('');

  if (findings.length === 0) {
    lines.push('  No drift detected — all checks passed.');
    lines.push('');
    lines.push('─'.repeat(52));
    return lines.join('\n');
  }

  const groups = groupBySeverity(findings);
  for (const [severity, group] of groups) {
    if (group.length === 0) continue;
    lines.push(`  ${SEVERITY_RANK_LABEL[severity]} (${group.length})`);
    for (const f of group) {
      const loc = f.file ? `${f.file} — ` : '';
      lines.push(`  ✗  ${loc}${f.type}: ${f.message}`);
      if (f.fixSuggestion) {
        lines.push(`     → ${f.fixSuggestion}`);
      }
    }
    lines.push('');
  }

  lines.push('─'.repeat(52));
  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const summary = blockers > 0
    ? `  ${findings.length} finding${findings.length === 1 ? '' : 's'} — ${blockers} BLOCKER${blockers === 1 ? '' : 'S'} must be fixed`
    : `  ${findings.length} finding${findings.length === 1 ? '' : 's'} — run suggestions above to resolve`;
  lines.push(summary);

  return lines.join('\n');
}

/**
 * Markdown drift report.
 */
export function formatDriftMarkdown(
  findings: DriftFinding[],
  projectName = 'Repo'
): string {
  const lines: string[] = [];
  lines.push(`## Thesmos Drift — ${projectName}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('**✅ No drift detected — all checks passed.**');
    return lines.join('\n');
  }

  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const statusLabel = blockers > 0
    ? `⛔ ${blockers} BLOCKER finding${blockers === 1 ? '' : 's'} — must fix before merge`
    : `⚠️ ${findings.length} drift finding${findings.length === 1 ? '' : 's'}`;
  lines.push(`**${statusLabel}**`);
  lines.push('');

  const groups = groupBySeverity(findings);
  for (const [severity, group] of groups) {
    if (group.length === 0) continue;
    lines.push(`### ${SEVERITY_RANK_LABEL[severity]}`);
    lines.push('');
    lines.push('| File | Type | Message | Fix |');
    lines.push('|---|---|---|---|');
    for (const f of group) {
      const file = f.file ? `\`${f.file}\`` : '—';
      const fix = f.fixSuggestion ? `_${f.fixSuggestion}_` : '—';
      lines.push(`| ${file} | \`${f.type}\` | ${f.message} | ${fix} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Machine-readable JSON drift report.
 */
export function formatDriftJson(findings: DriftFinding[]): string {
  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const clean = findings.length === 0;
  return JSON.stringify(
    { clean, total: findings.length, blockers, findings },
    null,
    2
  );
}
