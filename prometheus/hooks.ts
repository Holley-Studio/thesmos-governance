/**
 * Prometheus Git Hook integration.
 *
 * Installs governance checks into git hooks without requiring husky or any
 * external dependency. Writes directly to .git/hooks/ (local-only) or to
 * .husky/ (committed, team-wide) when --husky is specified.
 *
 * Design rules:
 * - All content generation is pure (no fs access)
 * - I/O is isolated to installHooks() / uninstallHooks()
 * - Idempotent: safe to run multiple times
 * - Non-destructive: preserves existing hook content, appends prometheus block
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type HookTarget = 'git' | 'husky';
export type HookName = 'pre-commit' | 'pre-push' | 'commit-msg';

export interface HookInstallOptions {
  /** Write to .husky/ (committed) instead of .git/hooks/ (local-only). */
  target?: HookTarget;
  /** Git base ref for validate (default: 'origin/main'). */
  base?: string;
  /** Only install the specified hooks (default: pre-commit + pre-push). */
  hooks?: HookName[];
  /** Preview only — do not write any files. */
  dryRun?: boolean;
}

export interface HookResult {
  hook: HookName;
  path: string;
  status: 'created' | 'updated' | 'already-configured' | 'skipped';
}

export interface HookStatusResult {
  hook: HookName;
  path: string;
  exists: boolean;
  hasPrometheus: boolean;
  content: string | null;
}

// ── Prometheus block markers ──────────────────────────────────────────────────

const BLOCK_START = '# prometheus-governance:start';
const BLOCK_END   = '# prometheus-governance:end';

/** Returns true if the hook file already has a prometheus-governance block. */
export function hookHasPrometheus(content: string): boolean {
  return content.includes(BLOCK_START);
}

// ── Pure content generators ───────────────────────────────────────────────────

/** Shebang + set -e header for a new hook file. */
function shellHeader(): string {
  return '#!/usr/bin/env sh\nset -e\n';
}

/**
 * Generate the prometheus block for a given hook.
 * The block is wrapped in start/end markers so it can be detected and updated.
 */
export function generateHookBlock(hook: HookName, base: string): string {
  const lines = [BLOCK_START];

  if (hook === 'pre-commit') {
    lines.push(
      '# Run a fast adapter-freshness check before committing.',
      '# Exit 1 if adapters are stale or required governance files are missing.',
      'npx --no-install prometheus ci-check',
    );
  }

  if (hook === 'pre-push') {
    lines.push(
      '# Run full governance validation before pushing.',
      `# Exit 1 on BLOCKER findings vs. ${base}.`,
      `npx --no-install prometheus validate --base=${base}`,
    );
  }

  if (hook === 'commit-msg') {
    lines.push(
      '# Governance hook placeholder — no-op by default.',
      '# Add custom commit message rules here.',
    );
  }

  lines.push(BLOCK_END);
  return lines.join('\n');
}

/**
 * Inject or replace the prometheus block in an existing hook file.
 * Preserves all content outside the markers.
 */
export function injectHookBlock(existing: string, block: string): string {
  if (hookHasPrometheus(existing)) {
    // Replace existing block
    const startIdx = existing.indexOf(BLOCK_START);
    const endIdx = existing.indexOf(BLOCK_END);
    if (startIdx !== -1 && endIdx !== -1) {
      return existing.slice(0, startIdx).trimEnd() + '\n\n' + block + '\n' + existing.slice(endIdx + BLOCK_END.length).trimStart();
    }
  }
  // Append block to existing content
  return existing.trimEnd() + '\n\n' + block + '\n';
}

/**
 * Build the full content for a hook file (new or updated).
 */
export function buildHookContent(hook: HookName, base: string, existing?: string): string {
  const block = generateHookBlock(hook, base);
  if (!existing) {
    return shellHeader() + '\n' + block + '\n';
  }
  if (!existing.startsWith('#!')) {
    // Existing file has no shebang — prepend one
    return shellHeader() + '\n' + injectHookBlock(existing, block);
  }
  return injectHookBlock(existing, block);
}

// ── Path resolution ───────────────────────────────────────────────────────────

/** Returns the hooks directory for a given target. */
export function hooksDir(root: string, target: HookTarget): string {
  return target === 'husky' ? join(root, '.husky') : join(root, '.git', 'hooks');
}

/** Returns the path to a specific hook file. */
export function hookPath(root: string, target: HookTarget, hook: HookName): string {
  return join(hooksDir(root, target), hook);
}

// ── Status check ──────────────────────────────────────────────────────────────

/** Report the current state of all prometheus-managed hooks. */
export function getHookStatus(
  root: string,
  target: HookTarget = 'git',
  hooks: HookName[] = ['pre-commit', 'pre-push'],
): HookStatusResult[] {
  return hooks.map((hook) => {
    const path = hookPath(root, target, hook);
    const exists = existsSync(path);
    const content = exists ? readFileSync(path, 'utf8') : null;
    return {
      hook,
      path,
      exists,
      hasPrometheus: content ? hookHasPrometheus(content) : false,
      content,
    };
  });
}

// ── I/O entry point ───────────────────────────────────────────────────────────

/**
 * Install prometheus git hooks.
 * Idempotent: existing prometheus blocks are updated, other hook content is preserved.
 */
export function installHooks(root: string, options: HookInstallOptions = {}): HookResult[] {
  const target  = options.target ?? 'git';
  const base    = options.base   ?? 'origin/main';
  const hooks   = options.hooks  ?? ['pre-commit', 'pre-push'];
  const dryRun  = options.dryRun ?? false;

  // Validate git repo
  if (target === 'git' && !existsSync(join(root, '.git'))) {
    throw new Error('No .git directory found. Run from the root of a git repository.');
  }

  const dir = hooksDir(root, target);

  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
  }

  const results: HookResult[] = [];

  for (const hook of hooks) {
    const path = hookPath(root, target, hook);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;

    if (existing && hookHasPrometheus(existing)) {
      // Check if block is up-to-date
      const expected = generateHookBlock(hook, base);
      const currentStart = existing.indexOf(BLOCK_START);
      const currentEnd   = existing.indexOf(BLOCK_END) + BLOCK_END.length;
      const currentBlock = existing.slice(currentStart, currentEnd);

      if (currentBlock === expected) {
        results.push({ hook, path, status: 'already-configured' });
        continue;
      }
    }

    const content = buildHookContent(hook, base, existing);
    const status  = !existing ? 'created' : 'updated';

    if (!dryRun) {
      writeFileSync(path, content, 'utf8');
      try { chmodSync(path, 0o755); } catch { /* ignore on windows */ }
    }

    results.push({ hook, path, status });
  }

  return results;
}

/**
 * Remove all prometheus-managed blocks from git hooks.
 * Leaves other hook content intact.
 */
export function uninstallHooks(root: string, options: Pick<HookInstallOptions, 'target' | 'hooks' | 'dryRun'> = {}): HookResult[] {
  const target = options.target ?? 'git';
  const hooks  = options.hooks  ?? ['pre-commit', 'pre-push'];
  const dryRun = options.dryRun ?? false;

  const results: HookResult[] = [];

  for (const hook of hooks) {
    const path = hookPath(root, target, hook);
    if (!existsSync(path)) {
      results.push({ hook, path, status: 'skipped' });
      continue;
    }

    const content = readFileSync(path, 'utf8');
    if (!hookHasPrometheus(content)) {
      results.push({ hook, path, status: 'skipped' });
      continue;
    }

    const startIdx = content.indexOf(BLOCK_START);
    const endIdx   = content.indexOf(BLOCK_END) + BLOCK_END.length;
    const cleaned  = (content.slice(0, startIdx).trimEnd() + '\n' + content.slice(endIdx).trimStart()).trimEnd() + '\n';

    if (!dryRun) {
      writeFileSync(path, cleaned, 'utf8');
    }

    results.push({ hook, path, status: 'updated' });
  }

  return results;
}
