/**
 * Build script for the Thesmos Governance VS Code extension.
 *
 * Bundles src/extension.ts → dist/extension.js (CommonJS, Node 18+).
 * The `vscode` module is external — it's injected by the VS Code runtime.
 */

import * as esbuild from 'esbuild';
import { argv } from 'process';

const watching = argv.includes('--watch');

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
