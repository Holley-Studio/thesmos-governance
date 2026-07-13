// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos agent:install <file-or-directory>
 *
 * Install a custom agent Markdown file (or all .md files in a directory) into
 * .thesmos/agents/, register it in .thesmos/registry.json, and synchronize
 * platform adapter files.
 *
 * Flags:
 *   --force      Overwrite an existing canonical file
 *   --dry-run    Validate and print proposed operations without mutating anything
 *   --no-sync    Install and register but skip adapter generation
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import {
  installAgent,
  syncAdapters,
  isIgnoredAgentFile,
  AgentInstallError,
} from '../../agent-lifecycle.ts';

export async function cmdAgentInstall(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { positionals, flags } = parseArgs(argv);

  const force   = flag(flags, 'force');
  const dryRun  = flag(flags, 'dry-run');
  const noSync  = flag(flags, 'no-sync');

  if (positionals.length === 0) {
    process.stderr.write(
      'agent:install: missing <file-or-directory>\n' +
      'Usage: thesmos agent:install <file.md|directory> [--force] [--dry-run] [--no-sync]\n'
    );
    process.exit(1);
  }

  const target = resolve(positionals[0]!);

  if (!existsSync(target)) {
    process.stderr.write(`agent:install: not found: ${positionals[0]}\n`);
    process.exit(1);
  }

  const stat = statSync(target);

  if (stat.isDirectory()) {
    await installDirectory(target, root, { force, dryRun, noSync });
  } else if (stat.isFile()) {
    await installFile(target, root, { force, dryRun, noSync });
  } else {
    process.stderr.write(`agent:install: not a file or directory: ${positionals[0]}\n`);
    process.exit(1);
  }
}

// ── Single-file install ───────────────────────────────────────────────────────

async function installFile(
  absPath: string,
  root: string,
  opts: { force: boolean; dryRun: boolean; noSync: boolean }
): Promise<void> {
  const { force, dryRun, noSync } = opts;

  let content: string;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch (err) {
    process.stderr.write(`agent:install: cannot read "${absPath}": ${String(err)}\n`);
    process.exit(1);
    return;
  }

  let result;
  try {
    result = installAgent({ content, sourcePath: absPath, force, dryRun, noSync, root });
  } catch (err) {
    if (err instanceof AgentInstallError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }

  let adapterPaths: string[] = [];
  if (!dryRun && !noSync) {
    try {
      adapterPaths = syncAdapters(root);
    } catch (err) {
      process.stderr.write(`agent:install: adapter sync failed: ${String(err)}\n`);
    }
  }

  printSingleResult(result.agentId, absPath, result, adapterPaths, dryRun, noSync);
}

// ── Directory install ─────────────────────────────────────────────────────────

async function installDirectory(
  absDir: string,
  root: string,
  opts: { force: boolean; dryRun: boolean; noSync: boolean }
): Promise<void> {
  const { force, dryRun, noSync } = opts;

  // Enumerate .md files non-recursively, deterministic (sorted) order
  const files = readdirSync(absDir)
    .filter((f) => f.endsWith('.md') && !isIgnoredAgentFile(f))
    .sort()
    .map((f) => join(absDir, f));

  if (files.length === 0) {
    console.log('agent:install: no .md files found (README.md excluded).');
    return;
  }

  // Read all files first
  type FileInput = { absPath: string; content: string };
  const inputs: FileInput[] = [];
  for (const absPath of files) {
    try {
      inputs.push({ absPath, content: readFileSync(absPath, 'utf8') });
    } catch (err) {
      process.stderr.write(`agent:install: cannot read "${absPath}": ${String(err)}\n`);
      process.exit(1);
    }
  }

  // Validate all first (all-or-nothing)
  const pendingResults: Array<{ input: FileInput; result: ReturnType<typeof installAgent> }> = [];
  const validationErrors: string[] = [];

  for (const input of inputs) {
    try {
      const result = installAgent({
        content: input.content,
        sourcePath: input.absPath,
        force,
        dryRun: true,  // validate-only first pass
        noSync: true,
        root,
      });
      pendingResults.push({ input, result });
    } catch (err) {
      if (err instanceof AgentInstallError) {
        validationErrors.push(`  ✗  ${basename(input.absPath)}: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  if (validationErrors.length > 0) {
    process.stderr.write(
      `agent:install: ${validationErrors.length} validation failure(s) — no files installed.\n` +
      validationErrors.join('\n') + '\n'
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log(`agent:install: dry-run — ${pendingResults.length} agent(s) would be installed\n`);
    for (const { result } of pendingResults) {
      printSingleResult(result.agentId, result.canonicalFile, result, [], true, noSync);
    }
    return;
  }

  // Real install pass (all-or-nothing has already been validated above)
  const installedResults: Array<ReturnType<typeof installAgent>> = [];
  for (const { input } of pendingResults) {
    const result = installAgent({
      content: input.content,
      sourcePath: input.absPath,
      force,
      dryRun: false,
      noSync: true,  // sync once at the end
      root,
    });
    installedResults.push(result);
  }

  // Sync adapters once for the whole batch
  let adapterPaths: string[] = [];
  if (!noSync) {
    try {
      adapterPaths = syncAdapters(root);
    } catch (err) {
      process.stderr.write(`agent:install: adapter sync failed: ${String(err)}\n`);
    }
  }

  // Summary output
  console.log(`agent:install — ${installedResults.length} agent(s) installed\n`);
  for (const result of installedResults) {
    const reg = result.registryResult === 'added' ? 'added' : 'already registered';
    console.log(`  ✓  ${result.agentId}  (registry: ${reg})`);
    for (const w of result.warnings) {
      console.log(`     ⚠  ${w}`);
    }
  }

  if (!noSync && adapterPaths.length > 0) {
    console.log(`\n  Adapters synchronized: ${adapterPaths.length} file(s)`);
  } else if (noSync) {
    console.log(`\n  Adapters not synchronized. Run: thesmos adapters`);
  }
}

// ── Output ────────────────────────────────────────────────────────────────────

function printSingleResult(
  agentId: string,
  sourcePath: string,
  result: ReturnType<typeof installAgent>,
  adapterPaths: string[],
  dryRun: boolean,
  noSync: boolean
): void {
  const prefix = dryRun ? '(dry-run) ' : '';
  const regLabel =
    result.registryResult === 'dry-run'
      ? 'would add'
      : result.registryResult === 'added'
      ? 'added'
      : 'already registered';

  const adapterLabel =
    dryRun
      ? 'would synchronize'
      : noSync
      ? 'skipped'
      : adapterPaths.length > 0
      ? 'synchronized'
      : 'none written';

  console.log(`${prefix}Installed custom agent: ${agentId}`);
  console.log(`  Source:    ${sourcePath}`);
  console.log(`  Canonical: ${result.canonicalFile}`);
  console.log(`  Registry:  ${regLabel}`);
  console.log(`  Adapters:  ${adapterLabel}`);

  for (const w of result.warnings) {
    console.log(`  ⚠  ${w}`);
  }

  if (noSync && !dryRun) {
    console.log(`\n  To synchronize adapters: thesmos adapters`);
  }
}
