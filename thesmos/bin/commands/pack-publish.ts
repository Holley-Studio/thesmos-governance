// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos pack:publish [pack-name] — compile, validate, and npm publish a rule pack
 *
 * Usage:
 *   thesmos pack:publish
 *   thesmos pack:publish my-pack
 *   thesmos pack:publish my-pack --compile --dry-run
 *   thesmos pack:publish my-pack --tag=beta
 *   thesmos pack:publish my-pack --access=restricted
 *
 * Steps:
 *   1. Discover the target pack (by name or auto-detect if only one exists)
 *   2. Validate the manifest with validatePack()
 *   3. Check rules/index.ts has been compiled (warn if not; --compile to fix)
 *   4. Warn if package.json is missing
 *   5. Warn if version is still "1.0.0" (the scaffold default)
 *   6. --dry-run: print summary and exit 0
 *   7. Run: npm publish --access public [--tag=<tag>]
 *   8. Print post-publish hint
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { discoverPacks, validatePack } from '../../packs.ts';
import type { PackEntry } from '../../packs.ts';

/** Visible for testing — run tsup compilation on the pack's rules/index.ts */
export function compilePackRules(packDir: string): { success: boolean; output: string } {
  const result = spawnSync(
    'npx',
    ['tsup', 'rules/index.ts', '--format', 'esm', '--outDir', 'rules', '--no-splitting'],
    { cwd: packDir, encoding: 'utf8', shell: true },
  );
  const output = [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n');
  return { success: result.status === 0, output };
}

/** Visible for testing — run npm publish in the pack directory */
export function runNpmPublish(
  packDir: string,
  opts: { access?: string; tag?: string },
): { success: boolean; output: string } {
  const args = ['publish', '--access', opts.access ?? 'public'];
  if (opts.tag) args.push('--tag', opts.tag);

  const result = spawnSync('npm', args, {
    cwd: packDir,
    encoding: 'utf8',
    shell: true,
  });
  const output = [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n');
  return { success: result.status === 0, output };
}

/**
 * Resolve which pack to operate on.
 * Returns the PackEntry or null on error (errors are written to stderr + exit called).
 */
function resolvePack(
  root: string,
  packName: string | undefined,
): PackEntry | null {
  // Build list from the local packs directory only — we only publish local packs
  const localPacksDir = join(root, '.thesmos', 'packs');

  if (!existsSync(localPacksDir)) {
    process.stderr.write(
      'pack:publish: no packs directory found at .thesmos/packs/\n' +
        '  Run: thesmos pack:create @scope/name\n',
    );
    process.exit(1);
  }

  const allPacks = discoverPacks(root);
  const localPacks = allPacks.filter((p) => p.source === 'local');

  if (localPacks.length === 0) {
    process.stderr.write(
      'pack:publish: no local packs found in .thesmos/packs/\n' +
        '  Run: thesmos pack:create @scope/name\n',
    );
    process.exit(1);
  }

  if (packName) {
    // User specified a name — match by directory basename or by pack ID suffix
    const match = localPacks.find(
      (p) =>
        p.relDir.endsWith('/' + packName) ||
        p.manifest.id.endsWith('/' + packName) ||
        p.manifest.id === packName,
    );
    if (!match) {
      process.stderr.write(
        `pack:publish: pack "${packName}" not found in .thesmos/packs/\n` +
          `  Available: ${localPacks.map((p) => p.manifest.id).join(', ')}\n`,
      );
      process.exit(1);
    }
    return match;
  }

  if (localPacks.length === 1) {
    return localPacks[0]!;
  }

  // Multiple packs and no name given
  process.stderr.write(
    'pack:publish: multiple packs found — specify which one to publish:\n\n',
  );
  for (const p of localPacks) {
    process.stderr.write(`  ${p.manifest.id}  (${p.relDir})\n`);
  }
  process.stderr.write(
    '\n  Usage: thesmos pack:publish <pack-name>\n',
  );
  process.exit(1);
  return null; // unreachable — satisfies TS
}

export async function cmdPackPublish(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { positionals, flags } = parseArgs(argv);

  const packName = positionals[0];
  const dryRun = flag(flags, 'dry-run');
  const compile = flag(flags, 'compile');
  const jsonMode = flag(flags, 'json');
  const access = flagVal(flags, 'access') ?? 'public';
  const tag = flagVal(flags, 'tag');

  // ── 1. Discover the target pack ────────────────────────────────────────────
  const pack = resolvePack(root, packName);
  if (!pack) return; // unreachable but keeps TS happy

  const { dir: packDir, manifest } = pack;

  // ── 2. Validate the manifest ───────────────────────────────────────────────
  const validation = validatePack(packDir, manifest);
  if (!validation.valid) {
    process.stderr.write(
      `pack:publish: manifest validation failed for ${manifest.id}:\n`,
    );
    for (const err of validation.errors) {
      process.stderr.write(`  error: ${err}\n`);
    }
    process.exit(1);
  }
  // Print any warnings but don't block
  for (const warn of validation.warnings) {
    process.stderr.write(`  warn: ${warn}\n`);
  }

  // ── 3. Check for uncompiled rules ─────────────────────────────────────────
  const hasTsSrc = existsSync(join(packDir, 'rules', 'index.ts'));
  const hasJsOut = existsSync(join(packDir, 'rules', 'index.js'));

  if (manifest.provides.rules && hasTsSrc && !hasJsOut) {
    if (compile) {
      process.stdout.write(
        'pack:publish: compiling rules/index.ts with tsup...\n',
      );
      const { success, output } = compilePackRules(packDir);
      if (output) process.stdout.write(output + '\n');
      if (!success) {
        process.stderr.write(
          'pack:publish: tsup compilation failed — fix errors above and retry.\n',
        );
        process.exit(1);
      }
      process.stdout.write('pack:publish: rules compiled successfully.\n');
    } else {
      process.stderr.write(
        'pack:publish: warn — provides.rules=true but rules/index.js does not exist.\n' +
          '  Compile first:  npx tsup rules/index.ts --format esm --outDir rules --no-splitting\n' +
          '  Or re-run with: thesmos pack:publish --compile\n',
      );
      // Warn but don't block — user might use a different build tool
    }
  }

  // ── 4. Check package.json exists ──────────────────────────────────────────
  if (!existsSync(join(packDir, 'package.json'))) {
    process.stderr.write(
      'pack:publish: warn — no package.json found in pack directory.\n' +
        '  A package.json is required for npm publishing.\n' +
        '  Create one with:  cd ' + pack.relDir + ' && npm init --scope=<scope>\n',
    );
  }

  // ── 5. Warn on default version ────────────────────────────────────────────
  if (manifest.version === '1.0.0') {
    process.stderr.write(
      'pack:publish: warn — version is still "1.0.0" (the scaffold default).\n' +
        '  If this is not your first publish, bump the version in pack.json first.\n',
    );
  }

  // ── 6. Dry-run summary ────────────────────────────────────────────────────
  if (dryRun) {
    if (jsonMode) {
      process.stdout.write(
        JSON.stringify(
          {
            dryRun: true,
            pack: manifest.id,
            version: manifest.version,
            packDir,
            access,
            tag: tag ?? null,
            compile,
            validationWarnings: validation.warnings,
          },
          null,
          2,
        ) + '\n',
      );
    } else {
      console.log('');
      console.log('pack:publish [dry-run] — would publish:');
      console.log('');
      console.log(`  Pack:     ${manifest.id}`);
      console.log(`  Version:  ${manifest.version}`);
      console.log(`  From:     ${pack.relDir}`);
      console.log(`  Access:   ${access}`);
      if (tag) console.log(`  Tag:      ${tag}`);
      console.log('');
      console.log('  Command:');
      const tagArg = tag ? ` --tag ${tag}` : '';
      console.log(`    npm publish --access ${access}${tagArg}`);
      console.log('');
      console.log('  Run without --dry-run to publish.');
    }
    return;
  }

  // ── 7. Run npm publish ────────────────────────────────────────────────────
  if (!jsonMode) {
    process.stdout.write(`pack:publish: publishing ${manifest.id}@${manifest.version}...\n`);
  }

  const { success, output } = runNpmPublish(packDir, { access, tag });

  if (output) process.stdout.write(output + '\n');

  if (!success) {
    process.stderr.write(
      `pack:publish: npm publish failed for ${manifest.id}@${manifest.version}.\n` +
        '  See output above for details.\n',
    );
    process.exit(1);
  }

  // ── 8. Post-publish hint ──────────────────────────────────────────────────
  const packageId = manifest.id;
  const version = manifest.version;

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          published: true,
          pack: packageId,
          version,
          access,
          tag: tag ?? null,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  console.log('');
  console.log(`Published ${packageId}@${version}`);
  console.log('');
  console.log('Users can install with:');
  console.log(`  npm install ${packageId}`);
  console.log('');
  console.log('Thesmos discovers packs under node_modules/@thesmos/ automatically.');
}
