// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Execution Advisory — recommends a model and Pantheon agents to execute a
 * plan, biased toward the cheapest model that gets the job done (AGNT_031:
 * model selection must match task depth). No LLM call — purely heuristic and
 * deterministic so it's free to run and reproducible.
 */
import { readFileSync } from 'node:fs';

export type ModelTier = 'haiku' | 'sonnet' | 'fable';

export interface ModelRecommendation {
  /** Cost tier bucket. */
  model: ModelTier;
  /** Concrete Claude model id to run. The top tier resolves to the reasoning
   * flagship (claude-opus-4-8) for architecture/orchestration or the creative
   * flagship (claude-fable-5) for creative/customer-facing work. */
  claudeModel: string;
  /** Concrete Codex CLI model id for the same tier. */
  codexModel: string;
  costMultiple: string;
  rationale: string;
}

export interface AgentSuggestion {
  key: string;
  emoji: string;
  name: string;
  domain: string;
  score: number;
}

export interface Classification {
  mechanicalPct: number;
  creativePct: number;
  architecturePct: number;
  bulkPct: number;
}

interface GodEntry {
  emoji: string;
  name: string;
  domain: string;
}

// ── Configurable model IDs ───────────────────────────────────────────────────
// Defaults are current as of the release date; override via env vars when
// Anthropic publishes new model IDs — no code change required.
// NOTE: do not add more hardcoded IDs here. The Model Steward (Phase C) will
// replace this with a provider-neutral catalog.
export const DEFAULT_MODEL_IDS = {
  fast: process.env['THESMOS_MODEL_FAST'] ?? 'claude-haiku-4-5-20251001',
  mid:  process.env['THESMOS_MODEL_MID']  ?? 'claude-sonnet-4-6',
  top:  process.env['THESMOS_MODEL_TOP']  ?? 'claude-opus-4-8',
  creative: process.env['THESMOS_MODEL_CREATIVE'] ?? 'claude-fable-5',
} as const;

// ── Work-type keyword buckets ────────────────────────────────────────────────

const MECHANICAL_KEYWORDS = [
  'rename', 'sed', 'regenerate', 'regex', 'find/replace', 'find-and-replace',
  'bump version', 'update dependency', 'update dependencies', 'gitignore',
  'config', 'lint', 'format', 'reformat', 'move file', 'delete file',
  'truth table', 'count fix', 'path fix', 'link fix', 'boilerplate',
];

const CREATIVE_KEYWORDS = [
  'copy', 'copywriting', 'landing page', 'brand', 'persona', 'prompt',
  'marketing', 'headline', 'tagline', 'voice', 'tone', 'story', 'narrative',
  'campaign', 'pitch', 'customer-facing', 'user-facing', 'gumroad',
];

const ARCHITECTURE_KEYWORDS = [
  'design', 'schema', 'refactor', 'migration', 'architecture', 'orchestrat',
  'system design', 'api design', 'data model', 'protocol', 'framework',
  'restructure', 'rearchitect',
];

const BULK_KEYWORDS = [
  'every file', 'every page', 'all files', 'all pages', 'across the repo',
  'batch', 'bulk', 'mass', 'entire codebase',
];

function countMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((n, kw) => (lower.includes(kw) ? n + 1 : n), 0);
}

/** Classify a plan's text into rough work-type percentages (sum ~100). */
export function classifyPlan(text: string): Classification {
  const mechanical = countMatches(text, MECHANICAL_KEYWORDS);
  const creative = countMatches(text, CREATIVE_KEYWORDS);
  const architecture = countMatches(text, ARCHITECTURE_KEYWORDS);
  const bulk = countMatches(text, BULK_KEYWORDS);

  const total = mechanical + creative + architecture + bulk;
  if (total === 0) {
    // No strong signal either way — default to a mechanical-leaning mix,
    // since most engineering plans are majority mechanical execution.
    return { mechanicalPct: 60, creativePct: 15, architecturePct: 20, bulkPct: 5 };
  }

  // Round the first three independently, then derive the last from the
  // remainder so the four percentages always sum to exactly 100 — avoids
  // the classic "101%" artifact from rounding each share separately.
  const mechanicalPct = Math.round((mechanical / total) * 100);
  const creativePct = Math.round((creative / total) * 100);
  const architecturePct = Math.round((architecture / total) * 100);
  const bulkPct = 100 - mechanicalPct - creativePct - architecturePct;

  return { mechanicalPct, creativePct, architecturePct, bulkPct };
}

/**
 * Recommend a model tier, biased DOWN by default (AGNT_031). Fable is only
 * recommended when architecture or creative work is genuinely dominant —
 * never as a default for mechanical or bulk-heavy plans.
 */
export function recommendModel(c: Classification): ModelRecommendation {
  if (c.bulkPct >= 40 && c.architecturePct < 20 && c.creativePct < 20) {
    return {
      model: 'haiku',
      claudeModel: DEFAULT_MODEL_IDS.fast,
      codexModel: 'gpt-5.5-instant',
      costMultiple: '~5x cheaper than Sonnet, ~10x cheaper than the top tier',
      rationale: `${c.bulkPct}% bulk/repetitive work with little architectural or creative judgment — Haiku handles high-volume mechanical passes at a fraction of the cost.`,
    };
  }

  if (c.architecturePct >= 30 || c.creativePct >= 30) {
    // Top cost tier — but the concrete flagship depends on WHY it was chosen.
    // Architecture/orchestration wants the reasoning flagship (DEFAULT_MODEL_IDS.top,
    // the model the Pantheon's Zeus/Argus/Athena actually run on); creative or
    // customer-facing work wants the creative flagship (claude-fable-5).
    const architectureLed = c.architecturePct >= c.creativePct;
    return {
      model: 'fable',
      claudeModel: architectureLed ? DEFAULT_MODEL_IDS.top : DEFAULT_MODEL_IDS.creative,
      codexModel: 'gpt-5.5-pro',
      costMultiple: '~5x the cost of Sonnet',
      rationale: architectureLed
        ? `${c.architecturePct}% architecture/orchestration work — this is where the reasoning flagship (${DEFAULT_MODEL_IDS.top}, what the orchestration gods run on) earns its cost. Delegate mechanical cleanup elsewhere.`
        : `${c.creativePct}% creative/customer-facing work — ${DEFAULT_MODEL_IDS.creative}'s generative range earns its cost here. Delegate mechanical cleanup elsewhere.`,
    };
  }

  return {
    model: 'sonnet',
    claudeModel: DEFAULT_MODEL_IDS.mid,
    codexModel: 'gpt-5.5',
    costMultiple: 'baseline (~5x cheaper than the top tier)',
    rationale: `${c.mechanicalPct}% mechanical execution — file edits, config changes, regenerations. Sonnet handles this reliably; a top-tier model's extra reasoning depth wouldn't improve find/replace accuracy.`,
  };
}

interface ScoreOptions {
  /** Weight per direct name mention (default 10 — a named god is a strong signal). */
  nameWeight?: number;
  /** Require at least one domain-vocabulary hit — filters out gods who are
   * merely DISCUSSED (e.g. "delete the iris files") rather than fit for the
   * work. */
  requireDomainHit?: boolean;
}

/**
 * Score how well a god matches the plan text. Being named directly (e.g. a
 * plan that says "Apollo (pricing page + Gumroad copy)") is a strong signal,
 * but mention frequency is not fitness — callers assigning WORK (assignPhases)
 * lower the name weight and require a domain hit.
 */
export function suggestAgents(
  text: string,
  gods: Record<string, GodEntry>,
  limit = 5,
  options: ScoreOptions = {},
): AgentSuggestion[] {
  const { nameWeight = 10, requireDomainHit = false } = options;
  const lower = text.toLowerCase();
  const scored: AgentSuggestion[] = [];

  for (const [key, god] of Object.entries(gods)) {
    let score = 0;

    const nameLower = god.name.toLowerCase();
    const nameMentions = lower.split(nameLower).length - 1;
    score += nameMentions * nameWeight;

    const domainWords = god.domain
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    let domainHits = 0;
    for (const word of domainWords) {
      if (lower.includes(word)) domainHits++;
    }
    score += domainHits;

    if (requireDomainHit && domainHits === 0) continue;
    if (score > 0) scored.push({ key, emoji: god.emoji, name: god.name, domain: god.domain, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function loadPantheonMap(mapPath: string): Record<string, GodEntry> {
  try {
    const raw = JSON.parse(readFileSync(mapPath, 'utf-8')) as { gods: Record<string, GodEntry> };
    return raw.gods ?? {};
  } catch {
    return {};
  }
}

export interface Advisory {
  classification: Classification;
  recommendation: ModelRecommendation;
  agents: AgentSuggestion[];
}

export function buildAdvisory(planText: string, gods: Record<string, GodEntry>): Advisory {
  const classification = classifyPlan(planText);
  const recommendation = recommendModel(classification);
  const agents = suggestAgents(planText, gods);
  return { classification, recommendation, agents };
}

export function formatAdvisoryConsole(advisory: Advisory): string {
  const { recommendation, agents } = advisory;
  const modelLabel = recommendation.claudeModel;
  const lines: string[] = [];
  lines.push('⚡ EXECUTION ADVISORY');
  lines.push(`Recommended model: ${modelLabel}`);
  lines.push(`  ${recommendation.rationale}`);
  lines.push(`  Cost: ${recommendation.costMultiple}`);
  lines.push('');
  if (agents.length > 0) {
    lines.push('Agents fit to execute:');
    for (const a of agents) {
      lines.push(`  ${a.emoji} ${a.name} — ${a.domain}`);
    }
  } else {
    lines.push('Agents fit to execute: none matched — likely a general-purpose task.');
  }
  lines.push('');
  lines.push('Doctrine: AGNT_031 (model selection must match task depth) · routing tiers in CLAUDE.md');
  return lines.join('\n');
}

// ── Operation names ───────────────────────────────────────────────────────────

const OPERATION_ADJECTIVES = [
  'Rising', 'Silent', 'Bronze', 'Marble', 'Golden', 'Iron', 'Clear', 'Swift',
  'Burning', 'Hidden', 'Sovereign', 'Radiant', 'Thundering', 'Watchful',
  'Unbroken', 'Crowned', 'First', 'Final', 'Twin', 'Distant', 'Sacred',
  'Storm', 'Winter', 'Summer', 'Dawn', 'Dusk', 'North', 'Amber', 'Ivory',
  'Obsidian', 'Crimson', 'Azure', 'Gilded', 'Vigilant', 'Steadfast',
  'Boundless', 'Eternal', 'Luminous', 'Tempered', 'Fabled',
];

const OPERATION_NOUNS = [
  'Aegis', 'Temple', 'Forge', 'Council', 'Olympus', 'Oracle', 'Colossus',
  'Labyrinth', 'Trident', 'Lyre', 'Chariot', 'Anvil', 'Beacon', 'Citadel',
  'Compass', 'Covenant', 'Crown', 'Ember', 'Gate', 'Harbor', 'Helm',
  'Horizon', 'Lantern', 'Meridian', 'Monolith', 'Pillar', 'Sentinel',
  'Spear', 'Summit', 'Threshold', 'Torch', 'Vanguard', 'Vault', 'Watch',
  'Accord', 'Ascent', 'Decree', 'Mandate', 'Reckoning', 'Restoration',
];

/**
 * Deterministic mythic operation name for a plan — the same plan text always
 * yields the same name, so re-running advise agrees with itself.
 */
export function generateOperationName(planText: string): string {
  let hash = 0;
  for (let i = 0; i < planText.length; i++) {
    hash = (hash * 31 + planText.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash);
  const adj = OPERATION_ADJECTIVES[h % OPERATION_ADJECTIVES.length];
  const noun = OPERATION_NOUNS[Math.floor(h / OPERATION_ADJECTIVES.length) % OPERATION_NOUNS.length];
  return `${adj} ${noun}`;
}

// ── Phase → god assignments ───────────────────────────────────────────────────

export interface PhaseAssignment {
  heading: string;
  god: AgentSuggestion | null;
  /** This phase's own model recommendation — classified from its own body
   * text, independent of the plan's overall recommendation. A plan can
   * legitimately span tiers: an architecture phase scoped for the reasoning
   * flagship, followed by mechanical implementation phases scoped for Sonnet. */
  model: ModelRecommendation;
}

/**
 * Split a plan into phases by `## Phase N` / `## W<N>` style headings and
 * suggest the best-matching god AND model tier for each phase's own text —
 * free, deterministic, no LLM call. This is what lets a kickoff read
 * "Phase 1: Opus, Phase 2: Sonnet, Phase 3: Haiku" instead of one blanket
 * model for a plan that may not need the same tier throughout.
 */
export function assignPhases(
  planText: string,
  gods: Record<string, GodEntry>,
): PhaseAssignment[] {
  const phaseRe = /^##+\s+((?:Phase|W)\s*\d+[^\n]*)$/gim;
  const matches = [...planText.matchAll(phaseRe)];
  if (matches.length === 0) return [];

  const assignments: PhaseAssignment[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : planText.length;
    const body = planText.slice(start, end);
    // Work assignment routes by domain fit, not mention frequency — a phase
    // that says "delete the iris files" discusses Iris without needing her.
    const [top] = suggestAgents(body, gods, 1, { nameWeight: 3, requireDomainHit: true });
    const model = recommendModel(classifyPlan(body));
    assignments.push({ heading: matches[i][1].trim(), god: top ?? null, model });
  }
  return assignments;
}

// ── Kickoff prompt v2 ─────────────────────────────────────────────────────────

const TIER_LABEL: Record<ModelTier, string> = {
  haiku: 'a fast, high-throughput model',
  sonnet: 'a capable mid-tier model',
  fable: 'a top-tier reasoning model',
};

export function formatKickoffPrompt(
  planPath: string,
  advisory: Advisory,
  planText = '',
  gods: Record<string, GodEntry> = {},
): string {
  const tier = advisory.recommendation.model;
  const opName = generateOperationName(planText || planPath);
  const phases = planText ? assignPhases(planText, gods) : [];

  const out: string[] = [];
  out.push(`📋 KICKOFF — Operation ${opName}`);
  out.push('');
  out.push('STEP 1 · Set your model first (run in your tool — NOT part of the paste):');
  out.push(`  Claude Code : /model ${advisory.recommendation.claudeModel}`);
  out.push(`  Codex CLI   : /model ${advisory.recommendation.codexModel}`);
  out.push(`  Gemini CLI  : equivalent tier via /model`);
  out.push(`  Cursor/IDE  : pick the equivalent tier in the model dropdown`);
  out.push('');
  out.push('STEP 2 · Paste everything below the line as your first message:');
  out.push('────────────────────────────────────────────────');
  out.push(`⚡ ZEUS — DISPATCH ORDER · Operation ${opName}`);
  out.push('');
  out.push('You are executing an approved plan under Zeus\'s command.');
  out.push(`Plan file: ${planPath}`);
  out.push('');
  out.push(`Model check: this operation was scoped for ${TIER_LABEL[tier]}`);
  out.push(`(${advisory.recommendation.rationale.split('—')[0].trim()}). State your`);
  out.push('model; if you are a lighter tier, flag it before starting rather');
  out.push('than silently proceeding.');
  out.push('');
  if (advisory.agents.length > 0) {
    out.push('God assignments (spawn as subagents where your platform supports');
    out.push('them — Claude Code: the Agent tool; elsewhere channel each god\'s');
    out.push('persona, banner and signature included):');
    if (phases.length > 0) {
      const mixedTiers = new Set(phases.map((p) => p.model.model)).size > 1;
      for (const p of phases) {
        const g = p.god;
        // Only print a per-phase model when phases actually differ in tier —
        // repeating the same model on every line is noise, not information.
        const modelSuffix = mixedTiers ? ` [${p.model.claudeModel}]` : '';
        out.push(g
          ? `  ${p.heading} → ${g.emoji} ${g.name} — ${g.domain}${modelSuffix}`
          : `  ${p.heading} → handle directly${modelSuffix}`);
      }
      if (mixedTiers) {
        out.push('');
        out.push('This plan spans model tiers — switch `/model` at each phase boundary');
        out.push('rather than running the whole operation on one tier.');
      }
    } else {
      for (const a of advisory.agents) {
        out.push(`  ${a.emoji} ${a.name} — ${a.domain}`);
      }
    }
    out.push('');
    out.push('Delegation doctrine: one god per single-domain phase; councils only');
    out.push('for genuinely cross-domain work; close each phase with');
    out.push('⚡ ZEUS — COUNCIL REPORT before starting the next.');
    out.push('');
  }
  out.push('Follow the plan\'s stated implementation order. Run each phase\'s');
  out.push('Verification block before its PR; report failures rather than');
  out.push('skipping them.');
  out.push('────────────────────────────────────────────────');
  return out.join('\n');
}
