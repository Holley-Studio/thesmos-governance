// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos pantheon:team — agent team orchestration (V1: sequential routing)
 *
 * Usage:
 *   thesmos pantheon:team                          List all available teams
 *   thesmos pantheon:team <slug>                   Show team composition and Zeus prompt
 *   thesmos pantheon:team <slug> "[mission]"       Print Zeus orchestration prompt for this mission
 *   thesmos pantheon:team <slug> --json            Machine-readable team definition
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseArgs, flag } from '../lib/args.ts';

// ── Team loader ───────────────────────────────────────────────────────────────

const TEAMS_DIR = join(import.meta.dirname, '../../catalog/teams');

interface TeamFrontmatter {
  id: string;
  name: string;
  mythology: string;
  mission: string;
  invocation: string;
  sequence: string[];
}

function parseTeamFile(filePath: string): { frontmatter: TeamFrontmatter; body: string } | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const yamlBlock = match[1] ?? '';
    const body = match[2] ?? '';

    // Minimal YAML parse (no external dep)
    const fm: Partial<TeamFrontmatter> = {};
    const lines = yamlBlock.split('\n');
    let inSequence = false;
    const seq: string[] = [];

    for (const line of lines) {
      if (line.startsWith('sequence:')) { inSequence = true; continue; }
      if (inSequence && line.match(/^\s+-\s+/)) {
        seq.push(line.replace(/^\s+-\s+/, '').trim());
        continue;
      }
      inSequence = false;

      const kv = line.match(/^(\w[\w-]*):\s*"?(.+?)"?\s*$/);
      if (!kv) continue;
      const [, key, val] = kv;
      if (key === 'id') fm.id = val ?? '';
      else if (key === 'name') fm.name = val ?? '';
      else if (key === 'mythology') fm.mythology = val ?? '';
      else if (key === 'mission') fm.mission = val ?? '';
      else if (key === 'invocation') fm.invocation = val ?? '';
    }

    fm.sequence = seq;
    return { frontmatter: fm as TeamFrontmatter, body };
  } catch {
    return null;
  }
}

function listTeams(): Array<{ slug: string; frontmatter: TeamFrontmatter }> {
  if (!existsSync(TEAMS_DIR)) return [];
  return readdirSync(TEAMS_DIR)
    .filter((f) => f.endsWith('.md'))
    .flatMap((f) => {
      const parsed = parseTeamFile(join(TEAMS_DIR, f));
      if (!parsed) return [];
      return [{ slug: basename(f, '.md'), frontmatter: parsed.frontmatter }];
    });
}

// ── pantheon:team (list) ──────────────────────────────────────────────────────

function cmdTeamList(json: boolean): void {
  const teams = listTeams();
  if (teams.length === 0) {
    console.log('\n  No teams found in catalog/teams/\n');
    return;
  }

  if (json) {
    process.stdout.write(JSON.stringify(teams.map((t) => ({
      id: t.frontmatter.id,
      name: t.frontmatter.name,
      mission: t.frontmatter.mission,
      agents: t.frontmatter.sequence.length,
    }))));
    return;
  }

  console.log('\n── Thesmos Agent Teams ───────────────────────────────────────────\n');
  for (const { slug, frontmatter: fm } of teams) {
    console.log(`  ${fm.name}`);
    console.log(`    Mission : ${fm.mission}`);
    console.log(`    Agents  : ${fm.sequence.length} (${fm.sequence.map((s) => s.split('-')[0]).join(' → ')})`);
    console.log(`    Invoke  : thesmos pantheon:team ${slug} "[mission]"\n`);
  }
}

// ── pantheon:team <slug> ──────────────────────────────────────────────────────

function cmdTeamShow(slug: string, mission: string | undefined, json: boolean): void {
  const teamFile = join(TEAMS_DIR, `${slug}.md`);
  if (!existsSync(teamFile)) {
    process.stderr.write(
      `  Team "${slug}" not found.\n  Available teams: ${listTeams().map((t) => t.slug).join(', ')}\n`,
    );
    process.exit(1);
  }

  const parsed = parseTeamFile(teamFile);
  if (!parsed) {
    process.stderr.write(`  Failed to parse team file: ${teamFile}\n`);
    process.exit(1);
  }

  const { frontmatter: fm, body } = parsed;

  if (json) {
    process.stdout.write(JSON.stringify({
      id: fm.id,
      name: fm.name,
      mission: fm.mission,
      mythology: fm.mythology,
      sequence: fm.sequence,
      agentCount: fm.sequence.length,
    }, null, 2) + '\n');
    return;
  }

  console.log(`\n── ${fm.name} ─────────────────────────────────────────`);
  console.log(`\n  ${fm.mythology}\n`);
  console.log(`  Mission : ${fm.mission}`);
  console.log(`\n  Sequence (${fm.sequence.length} agents):`);
  fm.sequence.forEach((agent, i) => {
    const name = agent.split('-')[0]!;
    console.log(`    ${String(i + 1).padStart(2)}. ${name.charAt(0).toUpperCase() + name.slice(1)}`);
  });

  if (mission) {
    // Extract Zeus orchestration prompt from body
    const promptMatch = body.match(/## Zeus orchestration prompt\n+```\n([\s\S]*?)```/);
    const rawPrompt = promptMatch ? promptMatch[1] ?? '' : '';
    const prompt = rawPrompt.replace('[USER_MISSION]', mission);

    console.log(`\n── Zeus Orchestration Prompt ─────────────────────────────────────`);
    console.log(`\n  Copy this prompt to invoke Zeus in Claude Code or Cursor:\n`);
    console.log('  ' + prompt.replace(/\n/g, '\n  '));
    console.log(`\n── How to invoke ─────────────────────────────────────────────────`);
    console.log(`\n  Claude Code:`);
    console.log(`    Agent({ subagent_type: "Zeus", prompt: "<prompt above>" })\n`);
    console.log(`  CLI:`);
    console.log(`    thesmos pantheon:orchestrate "${mission.slice(0, 60)}..."\n`);
  } else {
    console.log(`\n  To generate the Zeus prompt for a specific mission:`);
    console.log(`    thesmos pantheon:team ${slug} "[your mission here]"\n`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdTeams(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const json = flag(flags, 'json');

  const slug = positionals[0];
  const mission = positionals[1];

  if (!slug) {
    cmdTeamList(json);
    return;
  }

  cmdTeamShow(slug, mission, json);
}
