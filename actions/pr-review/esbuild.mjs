/**
 * Build script for the Thesmos Governance PR Review GitHub Action.
 *
 * Produces a single CJS bundle at dist/index.js that is committed to the repo
 * and executed directly by the GitHub Actions Node.js runner — no npm install
 * required at runtime.
 *
 * External: none (everything including @actions/* and thesmos-governance is bundled).
 */

import * as esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
  // Don't externalise anything — the dist must be fully self-contained
  external: [],
  // Polyfill import.meta.url for any ESM→CJS conversions inside bundled deps
  banner: {
    js: [
      '// Thesmos Governance PR Review — by Holley Studio',
      'const __importMetaUrl = require("url").pathToFileURL(__filename).href;',
    ].join('\n'),
  },
  define: {
    'import.meta.url': '__importMetaUrl',
  },
});

if (result.errors.length > 0) {
  process.exit(1);
}
