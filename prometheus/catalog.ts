/**
 * Prometheus Catalog — built-in agent, skill, and profile loader.
 *
 * Built-in catalog lives at prometheus/catalog/ in source and at ../catalog/
 * relative to the compiled dist/ bundle. The finder tries dev path first
 * (running from source via vite-node), then falls back to prod path (npm install).
 *
 * All I/O functions accept injectable readers for pure unit testing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogFrontmatter {
  id: string;
  name: string;
  type: 'agent' | 'skill';
  version: string;
  owner: string;
  tags: string[];
  enabled: boolean;
}

export interface CatalogEntry {
  frontmatter: CatalogFrontmatter;
  body: string;
  content: string;
  path: string;
  source: 'builtin' | 'user';
}

export interface CatalogProfile {
  id: string;
  name: string;
  description: string;
  version: string;
  owner: string;
  agents: string[];
  skills: string[];
  rulePacks: string[];
}

export interface CatalogValidationResult {
  valid: boolean;
  errors: string[];
}

export type CatalogReadFn = (absPath: string) => string | null;
export type CatalogListFn = (dir: string) => string[];

// ── Frontmatter parser (pure) ─────────────────────────────────────────────────

export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: raw };

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return { frontmatter: {}, body: raw };

  const fmLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join('\n').trimStart();

  const fm: Record<string, unknown> = {};
  let currentArr: string[] | null = null;

  for (const line of fmLines) {
    const stripped = line.trimStart();
    if (stripped.startsWith('- ')) {
      const item = stripped.slice(2).trim();
      currentArr?.push(item);
      continue;
    }
    currentArr = null;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    if (val === '') {
      currentArr = [];
      fm[key] = currentArr;
    } else if (val === 'true') {
      fm[key] = true;
    } else if (val === 'false') {
      fm[key] = false;
    } else {
      fm[key] = val;
    }
  }

  return { frontmatter: fm, body };
}

// ── Frontmatter validator (pure) ──────────────────────────────────────────────

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const VALID_TYPES = new Set(['agent', 'skill']);

export function validateFrontmatter(
  fm: Record<string, unknown>
): CatalogValidationResult {
  const errors: string[] = [];
  const required = ['id', 'name', 'type', 'version', 'owner', 'enabled'] as const;

  for (const field of required) {
    if (!(field in fm) || fm[field] === undefined || fm[field] === '') {
      errors.push(`missing required field "${field}"`);
    }
  }

  if (fm.type !== undefined && !VALID_TYPES.has(fm.type as string)) {
    errors.push(`"type" must be "agent" or "skill", got "${String(fm.type)}"`);
  }

  if (typeof fm.version === 'string' && !SEMVER_RE.test(fm.version)) {
    errors.push(`"version" must be semver (x.y.z), got "${fm.version}"`);
  }

  if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
    errors.push('"tags" must be an array');
  }

  if ('enabled' in fm && typeof fm.enabled !== 'boolean') {
    errors.push('"enabled" must be a boolean (true or false)');
  }

  if (typeof fm.id === 'string' && !/^[a-z0-9-]+$/.test(fm.id)) {
    errors.push(`"id" must be lowercase kebab-case, got "${fm.id}"`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Catalog entry builder (pure) ──────────────────────────────────────────────

function buildEntry(
  filePath: string,
  content: string,
  source: 'builtin' | 'user'
): CatalogEntry | null {
  const { frontmatter: raw, body } = parseFrontmatter(content);
  const { valid, errors } = validateFrontmatter(raw);
  if (!valid) {
    process.stderr.write(
      `[prometheus] catalog: ${filePath} invalid frontmatter: ${errors.join(', ')}\n`
    );
    return null;
  }
  return {
    frontmatter: raw as unknown as CatalogFrontmatter,
    body,
    content,
    path: filePath,
    source,
  };
}

// ── Catalog directory loader ──────────────────────────────────────────────────

export function loadCatalogDir(
  dir: string,
  source: 'builtin' | 'user',
  filter?: string[],
  readFn: CatalogReadFn = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
  listFn: CatalogListFn = (d) =>
    existsSync(d)
      ? readdirSync(d)
          .filter((f) => f.endsWith('.md'))
          .sort()
      : []
): CatalogEntry[] {
  const files = listFn(dir);
  const entries: CatalogEntry[] = [];

  for (const file of files) {
    const absPath = join(dir, file);
    const content = readFn(absPath);
    if (content === null) continue;

    const entry = buildEntry(absPath, content, source);
    if (!entry) continue;

    if (filter && !filter.includes(entry.frontmatter.id)) continue;
    entries.push(entry);
  }

  return entries;
}

// ── Catalog directory locator ─────────────────────────────────────────────────

export function findCatalogDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const devPath = join(thisDir, 'catalog');
  if (existsSync(devPath)) return devPath;
  const prodPath = join(thisDir, '..', 'catalog');
  if (existsSync(prodPath)) return prodPath;
  throw new Error(
    `[prometheus] built-in catalog not found. Expected at: ${devPath} or ${prodPath}`
  );
}

// ── Built-in catalog loaders ──────────────────────────────────────────────────

export function loadBuiltInCatalog(): {
  agents: CatalogEntry[];
  skills: CatalogEntry[];
} {
  const catalogDir = findCatalogDir();
  return {
    agents: loadCatalogDir(join(catalogDir, 'agents'), 'builtin'),
    skills: loadCatalogDir(join(catalogDir, 'skills'), 'builtin'),
  };
}

export function loadBuiltInProfiles(): CatalogProfile[] {
  const catalogDir = findCatalogDir();
  const profilesDir = join(catalogDir, 'profiles');
  if (!existsSync(profilesDir)) return [];

  const files = readdirSync(profilesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const profiles: CatalogProfile[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(profilesDir, file), 'utf8');
      const parsed = JSON.parse(raw) as CatalogProfile;
      profiles.push(parsed);
    } catch {
      process.stderr.write(`[prometheus] catalog: could not load profile ${file}\n`);
    }
  }
  return profiles;
}

export function loadCatalogProfile(id: string): CatalogProfile | null {
  const profiles = loadBuiltInProfiles();
  return profiles.find((p) => p.id === id) ?? null;
}

// ── User catalog loader ───────────────────────────────────────────────────────

export function loadUserCatalog(
  root: string,
  enabledIds?: { agents?: string[]; skills?: string[] }
): { agents: CatalogEntry[]; skills: CatalogEntry[] } {
  return {
    agents: loadCatalogDir(
      join(root, '.prometheus', 'agents'),
      'user',
      enabledIds?.agents
    ),
    skills: loadCatalogDir(
      join(root, '.prometheus', 'skills'),
      'user',
      enabledIds?.skills
    ),
  };
}

// ── Catalog validator ─────────────────────────────────────────────────────────

export function validateCatalog(entries: CatalogEntry[]): CatalogValidationResult {
  const errors: string[] = [];

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const entry of entries) {
    const { id, name } = entry.frontmatter;

    if (seenIds.has(id)) {
      errors.push(`duplicate id: "${id}" in ${entry.path}`);
    }
    seenIds.add(id);

    if (seenNames.has(name)) {
      errors.push(`duplicate name: "${name}" in ${entry.path}`);
    }
    seenNames.add(name);

    const { valid, errors: fmErrors } = validateFrontmatter(
      entry.frontmatter as unknown as Record<string, unknown>
    );
    if (!valid) {
      for (const err of fmErrors) {
        errors.push(`[${id}] ${err}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Merged catalog ────────────────────────────────────────────────────────────

export function getActiveCatalog(
  root: string,
  enabledIds?: { agents?: string[]; skills?: string[] }
): { agents: CatalogEntry[]; skills: CatalogEntry[] } {
  const builtin = loadBuiltInCatalog();
  const user = loadUserCatalog(root, enabledIds);

  const agentIds = enabledIds?.agents;
  const skillIds = enabledIds?.skills;

  const agents = [
    ...builtin.agents.filter(
      (a) => !agentIds || agentIds.includes(a.frontmatter.id)
    ),
    ...user.agents,
  ];

  const skills = [
    ...builtin.skills.filter(
      (s) => !skillIds || skillIds.includes(s.frontmatter.id)
    ),
    ...user.skills,
  ];

  return { agents, skills };
}

// ── Agent / skill stub generators (pure, for agent:create / skill:create) ─────

export function buildAgentStub(id: string, name: string): string {
  return `---
id: ${id}
name: ${name}
type: agent
version: 1.0.0
owner: local
tags:
  - custom
enabled: true
---

# ${name}

## Purpose

Describe what this agent does and when to invoke it.

## When to use

- Describe trigger condition 1
- Describe trigger condition 2

## Rule focus

- List Prometheus rule IDs or categories this agent pays attention to

## Useful repo signals

- Patterns in the codebase this agent should look for

## Expected output

Describe the format of findings or commentary this agent produces.

## What not to do

- List anti-patterns or false positives to avoid

## Related skills

- List related skill IDs from the catalog
`;
}

export function buildSkillStub(id: string, name: string): string {
  return `---
id: ${id}
name: ${name}
type: skill
version: 1.0.0
owner: local
tags:
  - custom
enabled: true
---

# ${name}

## Purpose

Describe what this skill accomplishes and why it exists.

## When to use

- Describe when an AI agent or human should invoke this skill

## Required inputs

- Describe what files, context, or data are needed

## Workflow steps

1. Step one
2. Step two
3. Step three

## Prometheus commands

\`\`\`bash
# Example Prometheus commands this skill relies on
npm run prometheus:review
\`\`\`

## Expected output

Describe what a successful execution of this skill produces.

## Related agents

- List related agent IDs from the catalog

## Related rule packs

- @prometheus/core
`;
}
