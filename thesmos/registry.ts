/**
 * Prometheus registry — loads, validates, and resolves .thesmos/registry.json.
 *
 * The registry is the single declaration of what is active in a consumer repo:
 *   - which rule packs are enabled (phase 2: resolved to actual rules)
 *   - which agents are registered (phase 3: injected into adapters)
 *   - which skills are available (phase 4: runnable skill workflows)
 *   - which profile is selected (phase 5: composable preset)
 *
 * Design rules:
 *   - loadRegistryConfig and resolveRegistry are pure (readFileSafe is injectable)
 *   - loadAndResolveRegistry is the single I/O convenience entry point
 *   - Missing or invalid registry.json silently falls back to REGISTRY_DEFAULTS
 *   - Merge: absent fields in registry.json fall back to defaults; present fields win
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Registry path (consumer-repo-relative) ────────────────────────────────────

export const REGISTRY_PATH = '.thesmos/registry.json';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Shape of .thesmos/registry.json — all fields optional (defaults apply). */
export interface ThesmosRegistryConfig {
  /** Rule pack IDs to enable, e.g. "@thesmos/core", "@thesmos/web". */
  rules?: string[];
  /** Local agent IDs — each maps to .thesmos/agents/<id>.md */
  agents?: string[];
  /** Local skill IDs — each maps to .thesmos/skills/<id>.md */
  skills?: string[];
  /** Profile IDs — used to compose rule packs, agents, and adapters. */
  profiles?: string[];
}

/** A loaded local agent file (from .thesmos/agents/<id>.md). */
export interface AgentEntry {
  id: string;
  /** Parsed from the first `# Heading` in the file. */
  name: string;
  content: string;
  /** Repo-relative path, e.g. `.thesmos/agents/security-reviewer.md` */
  path: string;
}

/** A loaded local skill file (from .thesmos/skills/<id>.md). */
export interface SkillEntry {
  id: string;
  /** Parsed from the first `# Heading` in the file. */
  name: string;
  content: string;
  /** Repo-relative path, e.g. `.thesmos/skills/web-review.md` */
  path: string;
}

/** Fully resolved registry after merging config and loading local files. */
export interface ResolvedRegistry {
  /** Active rule pack IDs. Phase 2 maps these to actual ThesmosRule[]. */
  rulePacks: string[];
  /** Loaded agent entries (only agents whose files were found are included). */
  agents: AgentEntry[];
  /** Loaded skill entries (only skills whose files were found are included). */
  skills: SkillEntry[];
  /** Active profile IDs. */
  profiles: string[];
}

// ── Defaults ──────────────────────────────────────────────────────────────────

/** Default registry when no .thesmos/registry.json is present. */
export const REGISTRY_DEFAULTS: Required<ThesmosRegistryConfig> = {
  rules: ['@thesmos/core'],
  agents: [],
  skills: [],
  profiles: [],
};

// ── Validation ────────────────────────────────────────────────────────────────

export interface RegistryValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a parsed registry.json object.
 * Returns { valid: true, errors: [] } on success.
 */
export function validateRegistryConfig(raw: unknown): RegistryValidationResult {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ['registry.json must be a JSON object'] };
  }

  const obj = raw as Record<string, unknown>;

  for (const key of ['rules', 'agents', 'skills', 'profiles'] as const) {
    if (!(key in obj)) continue;
    if (!Array.isArray(obj[key])) {
      errors.push(`"${key}" must be an array`);
      continue;
    }
    const arr = obj[key] as unknown[];
    for (let i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== 'string') {
        errors.push(`"${key}[${i}]" must be a string, got ${typeof arr[i]}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Merge ─────────────────────────────────────────────────────────────────────

/**
 * Merge a user registry config with base defaults.
 * Each key present in `override` replaces the base value; absent keys use the base.
 * This gives users full control: list all desired packs, including built-ins.
 */
export function mergeRegistryConfig(
  base: Required<ThesmosRegistryConfig>,
  override: ThesmosRegistryConfig
): Required<ThesmosRegistryConfig> {
  return {
    rules: override.rules ?? base.rules,
    agents: override.agents ?? base.agents,
    skills: override.skills ?? base.skills,
    profiles: override.profiles ?? base.profiles,
  };
}

// ── Loading ───────────────────────────────────────────────────────────────────

const defaultReadFileSafe =
  (absPath: string): string | null => {
    try {
      return readFileSync(absPath, 'utf8');
    } catch {
      return null;
    }
  };

/**
 * Load .thesmos/registry.json from disk.
 * Returns an empty config (uses all defaults when merged) on any error.
 * Pass a `readFileSafe` implementation for testing without disk access.
 */
export function loadRegistryConfig(
  root: string,
  readFileSafe: (absPath: string) => string | null = defaultReadFileSafe
): ThesmosRegistryConfig {
  const absPath = join(root, REGISTRY_PATH);
  const raw = readFileSafe(absPath);
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  const { valid } = validateRegistryConfig(parsed);
  return valid ? (parsed as ThesmosRegistryConfig) : {};
}

// ── Resolution ────────────────────────────────────────────────────────────────

function parseName(content: string): string {
  const match = /^#\s+(.+)$/m.exec(content);
  return match?.[1]?.trim() ?? 'Unknown';
}

/**
 * Resolve a merged registry config to a ResolvedRegistry by loading local files.
 * Agents and skills listed in config that cannot be found on disk are silently skipped.
 * Pass a `readFileSafe` implementation for testing.
 */
export function resolveRegistry(
  root: string,
  config: Required<ThesmosRegistryConfig>,
  readFileSafe: (absPath: string) => string | null = defaultReadFileSafe
): ResolvedRegistry {
  const agents: AgentEntry[] = [];
  for (const id of config.agents) {
    const relPath = `.thesmos/agents/${id}.md`;
    const content = readFileSafe(join(root, relPath));
    if (content !== null) {
      agents.push({ id, name: parseName(content), content, path: relPath });
    }
  }

  const skills: SkillEntry[] = [];
  for (const id of config.skills) {
    const relPath = `.thesmos/skills/${id}.md`;
    const content = readFileSafe(join(root, relPath));
    if (content !== null) {
      skills.push({ id, name: parseName(content), content, path: relPath });
    }
  }

  return {
    rulePacks: config.rules,
    agents,
    skills,
    profiles: config.profiles,
  };
}

// ── Convenience I/O ───────────────────────────────────────────────────────────

/**
 * Load, merge, and resolve the full registry for a repo root.
 * Convenience wrapper — uses real disk I/O. For tests, compose the pure
 * functions (loadRegistryConfig + mergeRegistryConfig + resolveRegistry) directly.
 */
export function loadAndResolveRegistry(root: string): ResolvedRegistry {
  const raw = loadRegistryConfig(root);
  const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, raw);
  return resolveRegistry(root, merged);
}
