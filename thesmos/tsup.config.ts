import { defineConfig } from 'tsup';
import { cpSync, existsSync } from 'node:fs';

export default defineConfig([
  {
    // ── Public library API ────────────────────────────────────────────────────
    // Consumed by VS Code extensions, programmatic users, and tests.
    // Emits types (.d.ts) so consumers get full IntelliSense.
    entry: { index: 'index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: false,
    clean: true,
    target: 'node20',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    // Node built-ins are not bundled (they're external by default in tsup)
    platform: 'node',
    async onSuccess() {
      // Copy built-in JSON preset files into dist/ so they're available at runtime.
      // config.ts resolves preset paths relative to import.meta.url (i.e., dist/).
      if (existsSync('presets')) {
        cpSync('presets', 'dist/presets', { recursive: true });
      }
    },
  },
  {
    // ── CLI binary ────────────────────────────────────────────────────────────
    // Installed as the `thesmos` command after `npm install -g` or via
    // package.json bin. Bundled into a single self-contained file — consumers
    // do not need to install additional dependencies.
    entry: { cli: 'bin/cli.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    clean: false,
    target: 'node20',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    platform: 'node',
    // Prepend the Node.js shebang so the file is directly executable.
    // esbuild strips the vite-node shebang from bin/cli.ts automatically.
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
