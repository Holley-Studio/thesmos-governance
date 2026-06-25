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

if (watching) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[thesmos-vscode] watching for changes…');
} else {
  const result = await esbuild.build(options);
  if (result.errors.length > 0) {
    process.exit(1);
  }
}
