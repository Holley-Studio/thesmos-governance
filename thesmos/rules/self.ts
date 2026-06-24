/**
 * Prometheus Self-Governance rules (SELF_001–010).
 *
 * Prometheus governs itself — these rules detect when the Prometheus
 * installation has drifted: outdated version, broken hooks, stale adapters,
 * stale context snapshots, and missing lockfile pins.
 *
 * Evaluated by `thesmos self:check`, and as a lightweight pre-flight
 * during every `thesmos scan` / `thesmos review`.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isThesmosConfig(path: string): boolean {
  return path.endsWith('.thesmos/config.json') || path === '.thesmos/config.json';
}

function isClaudeSettings(path: string): boolean {
  return path.endsWith('.claude/settings.json') || path === '.claude/settings.json';
}

function isGitHookFile(path: string): boolean {
  return /\.git\/hooks\/(pre-commit|pre-push)$/.test(path);
}

function isHuskyHookFile(path: string): boolean {
  return /\.husky\/(pre-commit|pre-push)$/.test(path);
}

function isPackageJson(path: string): boolean {
  return path === 'package.json' || path.endsWith('/package.json');
}

function isCiWorkflow(path: string): boolean {
  return /\.github\/workflows\/.*\.ya?ml$/.test(path);
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return 999;
  return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const SELF_RULES: ThesmosRule[] = [
  {
    id: 'SELF_001',
    category: 'self_version_behind',
    description: 'Installed thesmos-governance is behind the latest npm release by ≥ 1 minor version.',
    severity: 'HIGH',
    tags: ['self-governance', 'version', 'update'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'Thesmos rules are updated to cover new attack patterns and framework changes. Running a stale version means you are missing security coverage that has since been shipped.',
      commonViolations: ['thesmos-governance@2.1.0 installed when 2.3.1 is available'],
      goodExample: '"thesmos-governance": "^2.3.1"',
      badExample: '"thesmos-governance": "2.1.0"  // pinned to old minor version',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_version_behind', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isPackageJson(path)) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        const allDeps = {
          ...((pkg['dependencies'] as Record<string, string>) ?? {}),
          ...((pkg['devDependencies'] as Record<string, string>) ?? {}),
        };
        const currentVersion = allDeps['thesmos-governance'];
        if (!currentVersion) continue;
        // Detect if a hard-pinned old version (no ^ or ~) is used
        const versionMatch = currentVersion.replace(/^[\^~]/, '').match(/^(\d+)\.(\d+)\./);
        if (!versionMatch) continue;
        const minor = parseInt(versionMatch[2] ?? '0', 10);
        // Flag if pinned without ^ and on an old minor version (heuristic: minor < 3 means potentially stale)
        if (!currentVersion.startsWith('^') && !currentVersion.startsWith('~') && minor < 3) {
          const lines = content.split('\n');
          const lineIdx = lines.findIndex((l) => l.includes('thesmos-governance'));
          findings.push({
            severity: sev,
            category: 'self_version_behind',
            file: path,
            line: lineIdx >= 0 ? lineIdx + 1 : undefined,
            message: `thesmos-governance pinned to "${currentVersion}" without ^ — may be missing security rule updates.`,
            suggestion: 'Use a caret range: "thesmos-governance": "^2.3.1" and run thesmos self:update',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_002',
    category: 'self_version_patch_behind',
    description: 'thesmos-governance pinned to an exact version without caret or tilde — patch updates blocked.',
    severity: 'MEDIUM',
    tags: ['self-governance', 'version', 'update'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'Pinning to an exact version without ^ prevents automatic patch-level security updates. Security patches are released frequently and should be picked up automatically.',
      commonViolations: ['"thesmos-governance": "2.3.0"  // exact, no ^'],
      goodExample: '"thesmos-governance": "^2.3.0"  // allows 2.3.x patches',
      badExample: '"thesmos-governance": "2.3.0"  // blocks all updates',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_version_patch_behind', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isPackageJson(path)) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        const allDeps = {
          ...((pkg['dependencies'] as Record<string, string>) ?? {}),
          ...((pkg['devDependencies'] as Record<string, string>) ?? {}),
        };
        const currentVersion = allDeps['thesmos-governance'];
        if (!currentVersion) continue;
        // Only flag exact versions (no ^ or ~) that look valid semver
        if (/^\d+\.\d+\.\d+$/.test(currentVersion)) {
          const lines = content.split('\n');
          const lineIdx = lines.findIndex((l) => l.includes('thesmos-governance'));
          findings.push({
            severity: sev,
            category: 'self_version_patch_behind',
            file: path,
            line: lineIdx >= 0 ? lineIdx + 1 : undefined,
            message: `thesmos-governance exactly pinned to "${currentVersion}" — patch security updates will not be picked up automatically.`,
            suggestion: 'Use caret range: "^' + currentVersion + '" to allow patch updates.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_003',
    category: 'self_broken_hook',
    description: 'Git hook installed by Thesmos references thesmos-governance but the package may not be installed.',
    severity: 'HIGH',
    tags: ['self-governance', 'hooks', 'git'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'If thesmos-governance is uninstalled or the binary path changes (after a major version bump), git hooks that call `npx thesmos` will silently fail or error. This means governance checks stop running without any warning.',
      commonViolations: ['pre-commit hook calls npx thesmos but node_modules is missing or outdated'],
      goodExample: '#!/bin/sh\n# Thesmos pre-commit hook\nnpx thesmos ci --hook=pre-commit',
      badExample: '#!/bin/sh\n# Thesmos pre-commit hook\n/home/user/.npm-global/bin/thesmos ci  # absolute path breaks when npm prefix changes',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_broken_hook', config.severityRules);
      const findings: Finding[] = [];
      const ABSOLUTE_PATH_RE = /\/(?:home|usr|opt|root|Users)[^"'\s]*\/(?:bin\/|\.npm[^"'\s]*\/)thesmos\b/;
      for (const { path, content } of changedFiles) {
        if (!isGitHookFile(path) && !isHuskyHookFile(path)) continue;
        if (!content.includes('thesmos')) continue;
        if (ABSOLUTE_PATH_RE.test(content)) {
          const lines = content.split('\n');
          const lineIdx = lines.findIndex((l) => ABSOLUTE_PATH_RE.test(l));
          findings.push({
            severity: sev,
            category: 'self_broken_hook',
            file: path,
            line: lineIdx >= 0 ? lineIdx + 1 : undefined,
            message: 'Git hook uses absolute thesmos binary path — will break when npm prefix changes.',
            suggestion: 'Use `npx thesmos` instead of an absolute path. Run thesmos self:repair --hooks to fix.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_004',
    category: 'self_config_schema_old',
    description: '.thesmos/config.json uses an old schema (missing required fields from the current version).',
    severity: 'HIGH',
    tags: ['self-governance', 'config', 'schema'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'As Thesmos evolves, the config schema gains required fields. An old config silently falls back to defaults for missing fields, which may not match the repo\'s governance intent.',
      commonViolations: ['config.json created at v1.x with no "rules" or "severityRules" section'],
      goodExample: '{ "version": "2", "rules": { "enabled": true }, "severityRules": {} }',
      badExample: '{ "adapters": ["CLAUDE.md"] }  // v1-era config with no version field',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_config_schema_old', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isThesmosConfig(path)) continue;
        let cfg: Record<string, unknown>;
        try { cfg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        // v2+ configs must have a version field
        if (!cfg['version']) {
          findings.push({
            severity: sev,
            category: 'self_config_schema_old',
            file: path,
            message: '.thesmos/config.json has no "version" field — this is a v1 config that may be missing required fields.',
            suggestion: 'Run `thesmos init` to regenerate config, or add "version": "2" and review the current schema.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_005',
    category: 'self_stale_adapter',
    description: 'CLAUDE.md or AGENTS.md references a thesmos-governance version that is older than the currently installed version.',
    severity: 'MEDIUM',
    tags: ['self-governance', 'adapters', 'claude'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'Thesmos adapter files (CLAUDE.md, AGENTS.md) embed governance rule counts and command references. A stale adapter may list outdated commands or miss rules that were added in recent versions.',
      commonViolations: ['CLAUDE.md says "thesmos-governance v2.1.0 — 911 rules" when 1065+ rules are now active'],
      goodExample: 'Run `thesmos adapters` after every version update.',
      badExample: '// CLAUDE.md generated at v2.1.0, never regenerated after v2.3.x upgrade',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_stale_adapter', config.severityRules);
      const findings: Finding[] = [];
      const ADAPTER_VERSION_RE = /thesmos-governance\s+v?(\d+\.\d+\.\d+)/i;
      const CURRENT_MIN_MINOR = 3; // v2.3.x is current as of v2.3.1
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('CLAUDE.md') && !path.endsWith('AGENTS.md') && !path.endsWith('CURSOR.md')) continue;
        const match = ADAPTER_VERSION_RE.exec(content);
        if (!match) continue;
        const parts = (match[1] ?? '0.0.0').split('.');
        const minor = parseInt(parts[1] ?? '0', 10);
        if (minor < CURRENT_MIN_MINOR) {
          findings.push({
            severity: sev,
            category: 'self_stale_adapter',
            file: path,
            message: `Adapter file references thesmos-governance v${match[1]} — may be missing rules added in v2.3.x.`,
            suggestion: 'Run `thesmos adapters` to regenerate adapter files with the current rule count and commands.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_006',
    category: 'self_stale_context',
    description: '.thesmos/context.md (or context snapshot) was generated more than 7 days ago.',
    severity: 'MEDIUM',
    tags: ['self-governance', 'context', 'snapshot'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'The context snapshot is used by Thesmos (and AI assistants via CLAUDE.md) to understand the current repo architecture. A stale snapshot means the AI is working from an outdated picture of the codebase.',
      commonViolations: ['context.md generated 3 weeks ago — new API routes, auth changes not reflected'],
      goodExample: 'Run `thesmos context:snapshot` weekly or via a scheduled CI job.',
      badExample: '// context.md last updated 30+ days ago in an active codebase',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_stale_context', config.severityRules);
      const findings: Finding[] = [];
      const GENERATED_AT_RE = /generated(?:At)?[^0-9]{0,10}(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/i;
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('context.md') && !path.endsWith('context.json') && !path.endsWith('context-capsule.md')) continue;
        if (!path.includes('.thesmos')) continue;
        const match = GENERATED_AT_RE.exec(content);
        if (!match) continue;
        const age = daysSince(match[1]!);
        if (age > 7) {
          findings.push({
            severity: sev,
            category: 'self_stale_context',
            file: path,
            message: `Context snapshot is ${Math.floor(age)} days old — regenerate to keep AI governance accurate.`,
            suggestion: 'Run `thesmos context:snapshot` to refresh the context file.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_007',
    category: 'self_stale_brain',
    description: '.thesmos/brain.md was generated more than 3 days ago — Thesmos\'s institutional memory is stale.',
    severity: 'MEDIUM',
    tags: ['self-governance', 'brain', 'memory'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'The brain file captures active suppressions, known false positives, and architecture notes that help Claude Code make governance decisions. After 3 days in an active project the brain may be missing new suppressions or findings.',
      commonViolations: ['brain.md 2 weeks old in a repo with active daily commits'],
      goodExample: 'brain:compact is wired to the Claude Code Stop hook — runs before every compaction automatically.',
      badExample: '// brain.md last generated on project setup, never updated',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_stale_brain', config.severityRules);
      const findings: Finding[] = [];
      const GENERATED_RE = /generated:\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/i;
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('brain.md') && !path.endsWith('brain.json')) continue;
        if (!path.includes('.thesmos')) continue;
        const match = GENERATED_RE.exec(content);
        if (!match) continue;
        const age = daysSince(match[1]!);
        if (age > 3) {
          findings.push({
            severity: sev,
            category: 'self_stale_brain',
            file: path,
            message: `Brain file is ${Math.floor(age)} days old — run brain:snapshot to refresh Thesmos institutional memory.`,
            suggestion: 'Run `thesmos brain:snapshot` or install the Stop hook: `thesmos brain:hook-install`.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_008',
    category: 'self_ci_pinned_old_version',
    description: 'GitHub Actions workflow pins thesmos-governance to an old version via npx or npm install.',
    severity: 'LOW',
    tags: ['self-governance', 'ci', 'version'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'CI workflows that hardcode an old Thesmos version freeze security rule coverage at that version. New vulnerabilities detected by rules added after that version will not be caught in CI.',
      commonViolations: ['npx thesmos-governance@2.1.0 in GitHub Actions workflow'],
      goodExample: 'npx thesmos-governance@latest  // or use devDependencies and npx thesmos',
      badExample: 'run: npx thesmos-governance@2.0.0 ci  // old version hardcoded in workflow',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_ci_pinned_old_version', config.severityRules);
      const findings: Finding[] = [];
      const OLD_VERSION_RE = /npx\s+thesmos-governance@(\d+\.\d+\.\d+)/;
      const CURRENT_MIN_MINOR = 3;
      for (const { path, content } of changedFiles) {
        if (!isCiWorkflow(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = OLD_VERSION_RE.exec(lines[i]!);
          if (!match) continue;
          const parts = (match[1] ?? '0.0.0').split('.');
          const minor = parseInt(parts[1] ?? '0', 10);
          if (minor < CURRENT_MIN_MINOR) {
            findings.push({
              severity: sev,
              category: 'self_ci_pinned_old_version',
              file: path,
              line: i + 1,
              message: `CI workflow pins thesmos-governance@${match[1]} — newer security rules not active in CI.`,
              suggestion: 'Use npx thesmos-governance@latest or install via devDependencies and call npx thesmos.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_009',
    category: 'self_orphaned_suppression',
    description: 'Suppression comment references a rule ID that does not exist in the current rule set.',
    severity: 'MEDIUM',
    tags: ['self-governance', 'suppressions', 'drift'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'When rules are renamed or removed, suppression comments that reference them become orphaned — they do nothing but add noise. Worse, they can mask the intent of the original suppression when a new rule is added with a similar name.',
      commonViolations: ['// thesmos-ignore: NEXT_099 — rule was removed in v2.2.0'],
      goodExample: 'Remove orphaned suppression comments or update to the new rule ID.',
      badExample: '// thesmos-ignore: OLD_001  // this rule no longer exists',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_orphaned_suppression', config.severityRules);
      const findings: Finding[] = [];
      // Look for suppress comments — these get validated by the self:check command
      // At the rule level, just flag the pattern so self:check can cross-reference
      const SUPPRESS_RE = /thesmos-ignore:\s*([A-Z_0-9]+(?:\s*,\s*[A-Z_0-9]+)*)/g;
      const KNOWN_PREFIXES = new Set([
        'AI', 'AUTH', 'CI', 'CORS', 'DAST', 'DEBT', 'DOCKER', 'ENV', 'INFRA',
        'JWT', 'K8S', 'LOG', 'MCP', 'NEXT', 'PROTO', 'RAG', 'SC', 'SELF',
        'SLOP', 'TF', 'VIBE', 'WS', 'JAVA', 'RUBY', 'RUST', 'ZOD',
      ]);
      for (const { path, content } of changedFiles) {
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          SUPPRESS_RE.lastIndex = 0;
          let match;
          while ((match = SUPPRESS_RE.exec(lines[i]!)) !== null) {
            const ids = (match[1] ?? '').split(',').map((s) => s.trim());
            for (const id of ids) {
              const prefix = id.split('_')[0] ?? '';
              if (!KNOWN_PREFIXES.has(prefix)) {
                findings.push({
                  severity: sev,
                  category: 'self_orphaned_suppression',
                  file: path,
                  line: i + 1,
                  message: `Suppression references unknown rule prefix "${prefix}" in "${id}" — may be an orphaned or mistyped rule ID.`,
                  suggestion: 'Verify the rule ID exists with `thesmos explain <rule-id>`. Remove if the rule no longer exists.',
                });
              }
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SELF_010',
    category: 'self_not_in_devdeps',
    description: 'thesmos-governance is not in devDependencies — it is installed globally, making the version uncontrolled.',
    severity: 'LOW',
    tags: ['self-governance', 'dependencies', 'version'],
    sinceVersion: '2.3.1',
    explain: {
      why: 'A globally installed thesmos-governance is not version-controlled by the repo. Different developers and CI environments may run different versions, leading to inconsistent governance coverage.',
      commonViolations: ['thesmos globally installed via npm i -g thesmos-governance'],
      goodExample: '"devDependencies": { "thesmos-governance": "^2.3.1" }',
      badExample: '// thesmos installed globally — not in package.json devDependencies',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('self_not_in_devdeps', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isPackageJson(path)) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        const devDeps = (pkg['devDependencies'] as Record<string, string>) ?? {};
        const deps = (pkg['dependencies'] as Record<string, string>) ?? {};
        // Only flag if the package.json looks like a project root (has name + version)
        if (!pkg['name'] || !pkg['version']) continue;
        if (!devDeps['thesmos-governance'] && !deps['thesmos-governance']) {
          findings.push({
            severity: sev,
            category: 'self_not_in_devdeps',
            file: path,
            message: 'thesmos-governance not found in devDependencies — version may differ across environments.',
            suggestion: 'Add: "thesmos-governance": "^2.3.1" to devDependencies.',
          });
        }
      }
      return findings;
    },
  },
];
