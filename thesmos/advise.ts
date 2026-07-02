// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Execution Advisory — recommends a model and Pantheon agents to execute a
 * plan, biased toward the cheapest model that gets the job done (AGNT_031:
 * model selection must match task depth). No LLM call — purely heuristic and
 * deterministic so it's free to run and reproducible.
 */
import { readFileSync } from 'node:fs';

export type ModelTier = 'haiku' | 'sonnet' | 'fable';

export interface ModelRecommendation {
  model: ModelTier;
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
      costMultiple: '~5x cheaper than Sonnet, ~10x cheaper than Fable',
      rationale: `${c.bulkPct}% bulk/repetitive work with little architectural or creative judgment — Haiku handles high-volume mechanical passes at a fraction of the cost.`,
    };
  }

  if (c.architecturePct >= 30 || c.creativePct >= 30) {
    return {
      model: 'fable',
      costMultiple: '~5x the cost of Sonnet',
      rationale: `${c.architecturePct}% architecture/orchestration and ${c.creativePct}% creative/customer-facing work — this is where Fable's reasoning depth earns its cost. Use it for the judgment-heavy workstreams; delegate mechanical cleanup elsewhere.`,
    };
  }

  return {
    model: 'sonnet',
    costMultiple: 'baseline (~5x cheaper than Fable)',
    rationale: `${c.mechanicalPct}% mechanical execution — file edits, config changes, regenerations. Sonnet handles this reliably; Fable's extra reasoning depth wouldn't improve find/replace accuracy.`,
  };
}

/**
 * Score how well a god matches the plan text. Being named directly (e.g. a
 * plan that says "Apollo (pricing page + Gumroad copy)") is a much stronger
 * signal than incidental domain-vocabulary overlap, so name mentions are
 * weighted heavily above keyword hits.
 */
export function suggestAgents(
  text: string,
  gods: Record<string, GodEntry>,
  limit = 5,
): AgentSuggestion[] {
  const lower = text.toLowerCase();
  const scored: AgentSuggestion[] = [];

  for (const [key, god] of Object.entries(gods)) {
    let score = 0;

    const nameLower = god.name.toLowerCase();
    const nameMentions = lower.split(nameLower).length - 1;
    score += nameMentions * 10;

    const domainWords = god.domain
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    for (const word of domainWords) {
      if (lower.includes(word)) score++;
    }

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
  const modelLabel = { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-5', fable: 'claude-fable-5' }[recommendation.model];
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

export function formatKickoffPrompt(planPath: string, advisory: Advisory): string {
  const modelLabel = { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-5', fable: 'claude-fable-5' }[advisory.recommendation.model];
  const agentList = advisory.agents.map((a) => `${a.emoji} ${a.name} (${a.domain})`).join(', ');
  const lines: string[] = [];
  lines.push('📋 KICKOFF PROMPT (copy-paste to start execution)');
  lines.push('');
  lines.push('```');
  lines.push(`/model ${modelLabel}`);
  lines.push('');
  lines.push(`Execute the approved plan at`);
  lines.push(planPath);
  lines.push('');
  if (agentList) lines.push(`Agents suggested for this plan: ${agentList}`);
  lines.push('Follow the plan\'s stated implementation order and verification section.');
  lines.push('```');
  return lines.join('\n');
}
