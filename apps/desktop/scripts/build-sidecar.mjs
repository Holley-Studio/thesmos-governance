// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Build the Thesmos Runtime sidecar.
 *
 * Two stages:
 *
 *   1. **Bundle** — esbuild collapses the runtime and everything it imports
 *      from Thesmos core into one CommonJS file. No node_modules ship.
 *
 *   2. **Seal** — Node's built-in SEA (single executable application) injects
 *      that bundle into a copy of the Node binary, producing
 *      `thesmos-runtime[.exe]`. This is what lets an installed user run Thesmos
 *      without Node on their machine.
 *
 * SEA is used rather than `pkg` or `nexe` because it ships with Node itself:
 * no third-party packer to keep current with each Node release, and no separate
 * supply-chain surface for a binary that will hold the user's project memory.
 *
 * Stage 2 is skipped with a clear message when the toolchain cannot complete it
 * (older Node, or a platform without `postject`), so a developer still gets a
 * working bundle and `tauri dev` still runs.
 */

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const outDir = join(appDir, 'src-tauri', 'resources');
const workDir = join(appDir, '.sidecar-build');

const isWindows = process.platform === 'win32';
const exeName = `thesmos-runtime${isWindows ? '.exe' : ''}`;
const bundlePath = join(workDir, 'runtime.cjs');

mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

// ── 1. Bundle ────────────────────────────────────────────────────────────────
await build({
  entryPoints: [join(appDir, 'sidecar', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: bundlePath,
  // Node builtins stay external; everything from Thesmos core is inlined.
  external: ['node:*'],
  logLevel: 'info',
});
console.log('[sidecar] bundled →', bundlePath);

// ── 2. Seal into a single executable ─────────────────────────────────────────
const seaConfig = join(workDir, 'sea-config.json');
const blobPath = join(workDir, 'runtime.blob');
const target = join(outDir, exeName);

writeFileSync(
  seaConfig,
  JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true }, null, 2),
);

try {
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  // Copy the running Node binary, then inject the blob into that copy.
  if (existsSync(target)) rmSync(target, { force: true });
  copyFileSync(process.execPath, target);

  // Resolve postject's JS entry and run it with `node` directly.
  //
  // Not `npx`: since the Windows argument-injection fix, Node refuses to spawn
  // a `.cmd` without a shell (EINVAL), and going through a shell to reach a
  // bundler step is both slower and an unnecessary quoting hazard.
  const postjectCli = createRequire(import.meta.url).resolve('postject/dist/cli.js');

  const postjectArgs = [
    postjectCli,
    target,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (process.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');

  execFileSync(process.execPath, postjectArgs, { stdio: 'inherit' });
  console.log('[sidecar] sealed →', target);
} catch (err) {
  // A failed seal is a packaging gap, not a broken build: report it plainly and
  // leave the bundle so development still works.
  console.warn('[sidecar] SEA packaging skipped:', err instanceof Error ? err.message : err);
  console.warn('[sidecar] The bundle exists but no self-contained executable was produced.');
  console.warn('[sidecar] An installed build WILL require Node until this succeeds.');
  copyFileSync(bundlePath, join(outDir, 'runtime.cjs'));
  process.exitCode = 0;
}
