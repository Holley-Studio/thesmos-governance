// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyMissionToPrompt, extractZeusPrompt } from './teams.ts';

const TEAMS_DIR = join(import.meta.dirname, '../../catalog/teams');

const TEAM_SLUGS = [
  'argonauts',
  'aegis',
  'bronze-guard',
  'caduceus',
  'creative-atelier',
  'figma-team',
  'forge',
  'furies',
  'harvest',
  'muses',
  'olympian-council',
  'phalanx',
] as const;

describe('pantheon team catalog', () => {
  for (const slug of TEAM_SLUGS) {
    it(`${slug} exposes a non-empty Zeus orchestration prompt`, () => {
      const body = readFileSync(join(TEAMS_DIR, `${slug}.md`), 'utf8').split('---\n').slice(2).join('---\n');
      const prompt = extractZeusPrompt(body);
      expect(prompt.length).toBeGreaterThan(80);
      expect(prompt).toMatch(/\[USER_MISSION\]/);
    });
  }

  it('extractZeusPrompt tolerates prose before the fenced block', () => {
    const sample = `## Zeus orchestration prompt

Optional intro line before the fence.

\`\`\`
Mission: [USER_MISSION]
Route to Athena first.
\`\`\``;
    expect(extractZeusPrompt(sample)).toContain('Route to Athena first.');
  });

  it('applyMissionToPrompt replaces USER_MISSION and USER_BRIEF', () => {
    const raw = 'Brief: [USER_BRIEF]\nMission: [USER_MISSION]';
    expect(applyMissionToPrompt(raw, 'Launch Q3')).toBe('Brief: Launch Q3\nMission: Launch Q3');
  });
});
