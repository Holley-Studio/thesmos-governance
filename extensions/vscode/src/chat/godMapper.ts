// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * GodMapper — resolves a subagent_type string (e.g. "Argus — Security Agent")
 * to its Pantheon god entry (emoji, name, domain, progressVerb, accent color).
 *
 * Source of truth is thesmos/catalog/pantheon-map.json. Resolution order:
 *   1. <workspaceRoot>/thesmos/catalog/pantheon-map.json   (this monorepo)
 *   2. <workspaceRoot>/node_modules/thesmos-governance/catalog/pantheon-map.json
 *   3. Built-in fallback covering the core gods.
 *
 * Keys in the map are the lowercase first word of the god name as it appears
 * in subagent_type — the same convention used by .claude/hooks/agent-activity.cjs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GodEntry {
  emoji: string;
  name: string;
  domain: string;
  progressVerb: string;
  /** CSS accent color derived from the domain. */
  color: string;
}

interface PantheonMapFile {
  gods: Record<string, { emoji: string; name: string; domain: string; progressVerb: string }>;
}

/** Domain keyword → accent color. First match wins; order matters. */
const DOMAIN_COLORS: Array<[RegExp, string]> = [
  [/security|threat|compliance|risk|legal/i, '#e5534b'],
  [/strategy|executive|orchestrat|decision/i, '#539bf5'],
  [/content|copy|brand|creative|voice|video|photo|anim/i, '#b083f0'],
  [/growth|marketing|sales|lead|pipeline|revenue|partner/i, '#57ab5a'],
  [/product|design|ui|ux|architect|engineer|web|dev/i, '#daaa3f'],
  [/data|analytics|finance|pricing|billing/i, '#39c5cf'],
];

const FALLBACK_GODS: PantheonMapFile['gods'] = {
  zeus: { emoji: '⚡', name: 'Zeus', domain: 'Executive Orchestration', progressVerb: 'convening the council' },
  argus: { emoji: '👁', name: 'Argus', domain: 'Security & Threat Modeling', progressVerb: 'inspecting the perimeter' },
  athena: { emoji: '🦉', name: 'Athena', domain: 'Business Strategy', progressVerb: 'weighing the strategies' },
  apollo: { emoji: '✍️', name: 'Apollo', domain: 'Content & Copywriting', progressVerb: 'composing the verses' },
  hephaestus: { emoji: '🔨', name: 'Hephaestus', domain: 'UI/UX & Design Systems', progressVerb: 'forging the components' },
};

const GENERIC_AGENT: GodEntry = {
  emoji: '🔮',
  name: 'Oracle',
  domain: 'General Purpose',
  progressVerb: 'divining an answer',
  color: '#8b949e',
};

export function domainColor(domain: string): string {
  for (const [pattern, color] of DOMAIN_COLORS) {
    if (pattern.test(domain)) return color;
  }
  return '#8b949e';
}

export class GodMapper {
  private readonly gods: PantheonMapFile['gods'];

  constructor(workspaceRoot: string) {
    this.gods = GodMapper.loadMap(workspaceRoot);
  }

  private static loadMap(workspaceRoot: string): PantheonMapFile['gods'] {
    const candidates = [
      join(workspaceRoot, 'thesmos', 'catalog', 'pantheon-map.json'),
      join(workspaceRoot, 'node_modules', 'thesmos-governance', 'catalog', 'pantheon-map.json'),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as PantheonMapFile;
        if (parsed.gods && typeof parsed.gods === 'object') return parsed.gods;
      } catch {
        // Malformed map — fall through to the next candidate.
      }
    }
    return FALLBACK_GODS;
  }

  /**
   * Resolve a subagent_type like "Argus — Security Agent" or "🦉 Athena — Strategy Agent".
   * Returns the generic Oracle entry for utility agents (Explore, Plan, general-purpose…).
   */
  resolve(subagentType: string): GodEntry {
    const stripped = subagentType.replace(/^[^\p{L}]+/u, '');
    const key = stripped.split(/[\s—–-]/)[0]?.toLowerCase() ?? '';
    const god = this.gods[key];
    if (!god) return GENERIC_AGENT;
    return { ...god, color: domainColor(god.domain) };
  }
}
