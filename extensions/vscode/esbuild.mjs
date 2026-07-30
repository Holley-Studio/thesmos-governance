/**
 * Build script for the Thesmos Governance VS Code extension.
 *
 * Bundles src/extension.ts → dist/extension.js (CommonJS, Node 18+).
 * The `vscode` module is external — it's injected by the VS Code runtime.
 */

import * as esbuild from 'esbuild';
import { argv } from 'process';
import { execFileSync } from 'child_process';

const watching = argv.includes('--watch');

// Honest build fingerprint: the short commit SHA, plus a `-dirty` suffix when
// the working tree has uncommitted changes at build time. Without the suffix a
// bundle built from a dirty tree would carry a SHA that does NOT identify its
// contents — the exact "which code is actually running?" trap this project hit.
let buildSha = 'dev';
try {
  buildSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  // `-dirty` when SOURCE differs from HEAD. The build output (dist/) is excluded
  // — it is regenerated every build, so counting it would mark every committed
  // bundle dirty. Any other uncommitted file means the bundle does not match a
  // commit, which the fingerprint must admit.
  const porcelain = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  const dirtySource = porcelain
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((p) => p && !p.includes('extensions/vscode/dist/') && !p.startsWith('dist/'));
  if (dirtySource.length > 0) buildSha += '-dirty';
} catch {}

/** Injected at build time into both bundles — lets diagnostics prove which commit is running. */
const buildDefines = {
  __BUILD_SHA__: JSON.stringify(buildSha),
  __PROTOCOL_VERSION__: JSON.stringify(2),
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watching,
  logLevel: 'info',
  define: buildDefines,
};

/** Pantheon Chat webview bundle — browser context, no vscode module. */
/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ['src/chat/webview/chat.ts', 'src/chat/webview/pantheon.css'],
  bundle: true,
  outdir: 'dist/webview',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: !watching,
  logLevel: 'info',
  define: buildDefines,
};

/**
 * Standalone PreToolUse permission hook. The `claude` CLI spawns this as its
 * own bare `node` process per the hooks contract — it must not bundle or
 * import `vscode`.
 */
/** @type {import('esbuild').BuildOptions} */
const hookOptions = {
  entryPoints: ['src/chat/permissionHookScript.ts'],
  bundle: true,
  outfile: 'dist/permissionHook.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watching,
  logLevel: 'info',
};

if (watching) {
  const ctx = await esbuild.context(options);
  const webviewCtx = await esbuild.context(webviewOptions);
  const hookCtx = await esbuild.context(hookOptions);
  await Promise.all([ctx.watch(), webviewCtx.watch(), hookCtx.watch()]);
  console.log('[thesmos-vscode] watching for changes…');
} else {
  const results = await Promise.all([
    esbuild.build(options),
    esbuild.build(webviewOptions),
    esbuild.build(hookOptions),
  ]);
  if (results.some((r) => r.errors.length > 0)) {
    process.exit(1);
  }
}
