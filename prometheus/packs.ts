/**
 * Prometheus Rule Packs — installable bundles of rules, agents, skills, playbooks, and profiles.
 *
 * A pack is a directory (local or future: npm package) with a pack.json manifest:
 *
 *   .prometheus/packs/<pack-name>/
 *     pack.json         — pack manifest (required)
 *     rules/            — optional PrometheusRule definitions (future: compiled JS)
 *     agents/           — optional agent .md files
 *     skills/           — optional skill .md files
 *     playbooks/        — optional markdown playbooks
 *     profiles/         — optional profile .json files
 *
 * Pack IDs follow @scope/name convention (e.g. @prometheus/web, @company/internal).
 * Packs are discovered from:
 *   1. .prometheus/packs/          — local user packs
 *   2. node_modules/@prometheus/   — future npm-installed packs
 *
 * Design for future marketplace without implementing it:
 *   - pack.json format is stable and versioned
 *   - Validation is strict now so future tooling can rely on it
 *   - Pack IDs are scoped to avoid collisions
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import type { PrometheusRule } from './types';

// ── Public types ──────────────────────────────────────────────────────────────

export type PackCategory =
  | '@prometheus/core'
  | '@prometheus/web'
  | '@prometheus/security'
  | '@prometheus/nextjs'
  | '@prometheus/supabase'
  | '@prometheus/design-system'
  | '@prometheus/accessibility'
  | string; // user packs: @company/name

export interface PackManifest {
  /** Scoped pack ID, e.g. "@prometheus/web" or "@company/internal". */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Semver version string. */
  version: string;
  /** Brief description of what the pack provides. */
  description: string;
  /** Pack author or organisation. */
  author: string;
  /** List of tags for discovery. */
  tags: string[];
  /** What content types this pack provides. */
  provides: PackProvides;
  /** Packs this pack depends on (IDs only). */
  requires?: string[];
  /** URL to pack homepage or repository (optional). */
  homepage?: string;
  /** Schema version for forward compatibility. */
  schemaVersion: '1';
}

export interface PackProvides {
  rules: boolean;
  agents: boolean;
  skills: boolean;
  playbooks: boolean;
  profiles: boolean;
}

export interface PackEntry {
  /** Absolute path to the pack directory. */
  dir: string;
  /** Relative path for display (e.g. ".prometheus/packs/my-pack"). */
  relDir: string;
  /** Parsed manifest. */
  manifest: PackManifest;
  /** Where the pack was found. */
  source: 'local' | 'node_modules';
}

export interface PackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export const LOCAL_PACKS_DIR = '.prometheus/packs';
export const NPM_PACKS_SCOPE = '@prometheus';

/**
 * Discover all installed packs in the given root.
 * Looks in .prometheus/packs/ and node_modules/@prometheus/.
 */
export function discoverPacks(root: string): PackEntry[] {
  const entries: PackEntry[] = [];

  // Local user packs
  const localDir = join(root, LOCAL_PACKS_DIR);
  if (existsSync(localDir)) {
    for (const name of readdirSync(localDir)) {
      const packDir = join(localDir, name);
      if (!statSync(packDir).isDirectory()) continue;
      const manifestPath = join(packDir, 'pack.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = parsePackManifest(readFileSync(manifestPath, 'utf8'));
      if (manifest) {
        entries.push({
          dir: packDir,
          relDir: `${LOCAL_PACKS_DIR}/${name}`,
          manifest,
          source: 'local',
        });
      }
    }
  }

  // npm-installed @prometheus/* packs
  const nmDir = join(root, 'node_modules', NPM_PACKS_SCOPE);
  if (existsSync(nmDir)) {
    for (const name of readdirSync(nmDir)) {
      const packDir = join(nmDir, name);
      if (!statSync(packDir).isDirectory()) continue;
      const manifestPath = join(packDir, 'pack.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = parsePackManifest(readFileSync(manifestPath, 'utf8'));
      if (manifest) {
        entries.push({
          dir: packDir,
          relDir: `node_modules/@prometheus/${name}`,
          manifest,
          source: 'node_modules',
        });
      }
    }
  }

  return entries;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

export function parsePackManifest(raw: string): PackManifest | null {
  try {
    return JSON.parse(raw) as PackManifest;
  } catch {
    return null;
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

const SCOPED_ID_RE = /^@[a-z0-9-]+\/[a-z0-9-]+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+/;

/**
 * Validate a pack directory.
 * Checks manifest correctness and content directory structure.
 * Pure for tests — pass packDir as absolute path.
 */
export function validatePack(packDir: string, manifest: PackManifest): PackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required manifest fields
  if (!manifest.id) errors.push('manifest.id is required');
  else if (!SCOPED_ID_RE.test(manifest.id)) {
    errors.push(`manifest.id "${manifest.id}" must be a scoped ID like @scope/name (lowercase, hyphens allowed)`);
  }

  if (!manifest.name) errors.push('manifest.name is required');
  if (!manifest.version) errors.push('manifest.version is required');
  else if (!SEMVER_RE.test(manifest.version)) warnings.push(`manifest.version "${manifest.version}" should be a semver string`);

  if (!manifest.description) errors.push('manifest.description is required');
  if (!manifest.author) warnings.push('manifest.author is recommended');
  if (!manifest.schemaVersion) errors.push('manifest.schemaVersion is required');
  else if (manifest.schemaVersion !== '1') errors.push(`manifest.schemaVersion must be "1" (got "${manifest.schemaVersion}")`);

  if (!manifest.provides) {
    errors.push('manifest.provides is required');
  } else {
    // Validate content directories exist when provides flag is true
    const contentDirs: Array<{ key: keyof PackProvides; dir: string }> = [
      { key: 'rules', dir: 'rules' },
      { key: 'agents', dir: 'agents' },
      { key: 'skills', dir: 'skills' },
      { key: 'playbooks', dir: 'playbooks' },
      { key: 'profiles', dir: 'profiles' },
    ];
    for (const { key, dir } of contentDirs) {
      const hasFlag = manifest.provides[key];
      const dirExists = existsSync(join(packDir, dir));
      if (hasFlag && !dirExists) {
        warnings.push(`manifest.provides.${key}=true but ${dir}/ directory does not exist`);
      }
      if (!hasFlag && dirExists) {
        warnings.push(`${dir}/ directory exists but manifest.provides.${key}=false`);
      }
    }

    // At least one content type must be provided
    const anyProvides = Object.values(manifest.provides).some(Boolean);
    if (!anyProvides) {
      errors.push('manifest.provides must have at least one content type set to true');
    }
  }

  // Warn on unknown requires
  if (manifest.requires && !Array.isArray(manifest.requires)) {
    errors.push('manifest.requires must be an array of pack IDs');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all discovered packs and return results keyed by pack ID.
 */
export function validateAllPacks(
  packs: PackEntry[]
): Map<string, { entry: PackEntry; result: PackValidationResult }> {
  const results = new Map<string, { entry: PackEntry; result: PackValidationResult }>();
  for (const entry of packs) {
    const result = validatePack(entry.dir, entry.manifest);
    results.set(entry.manifest.id, { entry, result });
  }
  return results;
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatPackListConsole(packs: PackEntry[], projectName = 'Repo'): string {
  const lines: string[] = [];
  const SEP = '─'.repeat(56);

  lines.push(`Prometheus Packs — ${projectName}`);
  lines.push(SEP);
  lines.push('');

  if (packs.length === 0) {
    lines.push('  No packs installed.');
    lines.push('');
    lines.push('  To add a local pack:');
    lines.push(`    mkdir -p .prometheus/packs/my-pack`);
    lines.push(`    # create .prometheus/packs/my-pack/pack.json`);
    lines.push('');
    lines.push(SEP);
    return lines.join('\n');
  }

  for (const p of packs) {
    const { manifest } = p;
    const provides = manifest.provides
      ? Object.entries(manifest.provides).filter(([, v]) => v).map(([k]) => k).join(', ')
      : '(unknown)';
    lines.push(`  ${manifest.id}  v${manifest.version}`);
    lines.push(`     ${manifest.description}`);
    lines.push(`     Provides: ${provides || '(none)'}  |  Source: ${p.source}  |  ${p.relDir}`);
    if (manifest.tags?.length > 0) {
      lines.push(`     Tags: ${manifest.tags.join(', ')}`);
    }
    lines.push('');
  }

  lines.push(SEP);
  lines.push(`  ${packs.length} pack${packs.length === 1 ? '' : 's'} installed`);

  return lines.join('\n');
}

export function formatPackListJson(packs: PackEntry[]): string {
  return JSON.stringify(
    packs.map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      source: p.source,
      dir: p.relDir,
      provides: p.manifest.provides,
      tags: p.manifest.tags,
    })),
    null,
    2
  );
}

export function formatPackValidateConsole(
  results: Map<string, { entry: PackEntry; result: PackValidationResult }>
): string {
  const lines: string[] = [];
  const SEP = '─'.repeat(56);

  lines.push('Prometheus Pack Validation');
  lines.push(SEP);
  lines.push('');

  if (results.size === 0) {
    lines.push('  No packs to validate.');
    lines.push('');
    lines.push(SEP);
    return lines.join('\n');
  }

  let invalid = 0;
  for (const [id, { result }] of results) {
    const status = result.valid ? '✅' : '❌';
    lines.push(`  ${status}  ${id}`);
    for (const e of result.errors) lines.push(`       error: ${e}`);
    for (const w of result.warnings) lines.push(`       warn:  ${w}`);
    if (!result.valid) invalid++;
    lines.push('');
  }

  lines.push(SEP);
  lines.push(
    `  ${results.size} pack${results.size === 1 ? '' : 's'} checked — ` +
      `${results.size - invalid} valid, ${invalid} invalid`
  );

  return lines.join('\n');
}

export function formatPackValidateJson(
  results: Map<string, { entry: PackEntry; result: PackValidationResult }>
): string {
  const obj = Object.fromEntries(
    [...results.entries()].map(([id, { entry, result }]) => [
      id,
      {
        valid: result.valid,
        source: entry.source,
        dir: entry.relDir,
        errors: result.errors,
        warnings: result.warnings,
      },
    ])
  );
  return JSON.stringify(
    {
      clean: [...results.values()].every((r) => r.result.valid),
      totalPacks: results.size,
      packs: obj,
    },
    null,
    2
  );
}

// ── Runtime rule loading ──────────────────────────────────────────────────────

/**
 * Attempt to load exported rules from a single pack directory.
 *
 * The pack must have `provides.rules: true` and a `rules/index.js` (or
 * `rules/index.cjs`) file that default-exports or named-exports an array
 * called `PACK_RULES` or the default export must be `PrometheusRule[]`.
 *
 * Returns an empty array if the file doesn't exist or the export is malformed —
 * never throws, so one bad pack doesn't block the rest.
 */
export async function loadPackRulesFromEntry(entry: PackEntry): Promise<PrometheusRule[]> {
  if (!entry.manifest.provides.rules) return [];

  const candidates = [
    join(entry.dir, 'rules', 'index.js'),
    join(entry.dir, 'rules', 'index.cjs'),
    join(entry.dir, 'rules', 'index.mjs'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const mod = await import(resolve(filePath)) as Record<string, unknown>;
      const rules =
        (mod['PACK_RULES'] as PrometheusRule[] | undefined) ??
        (mod['default'] as PrometheusRule[] | undefined);
      if (Array.isArray(rules)) {
        return rules.filter(
          (r): r is PrometheusRule =>
            typeof r === 'object' &&
            r !== null &&
            typeof (r as PrometheusRule).id === 'string' &&
            typeof (r as PrometheusRule).detect === 'function'
        );
      }
    } catch {
      // malformed pack — skip silently
    }
  }
  return [];
}

/**
 * Load rules from all installed packs in the given project root.
 * Silently skips packs with no rules or malformed rule files.
 */
export async function loadPackRules(root: string): Promise<PrometheusRule[]> {
  const packs = discoverPacks(root);
  const ruleSets = await Promise.all(packs.map((entry) => loadPackRulesFromEntry(entry)));
  return ruleSets.flat();
}

/**
 * Return the full active rule set: built-in rules + any pack rules.
 * Pass this to runReview() as the second argument to include pack rules.
 *
 * @example
 * import { getActiveRules } from 'prometheus-governance/packs';
 * import { runReview } from 'prometheus-governance';
 * const rules = await getActiveRules(process.cwd());
 * const findings = runReview(input, rules);
 */
export async function getActiveRules(
  root: string,
  builtinRules?: PrometheusRule[]
): Promise<PrometheusRule[]> {
  const { PROMETHEUS_RULES } = await import('./rules/registry.js');
  const base = builtinRules ?? PROMETHEUS_RULES;
  const packRules = await loadPackRules(root);
  return [...base, ...packRules];
}
