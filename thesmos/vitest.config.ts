import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    // The suite asserts against the full engine. Tiering tests opt into 'free'
    // explicitly via config.tier; everything else runs premium (all rules).
    env: { THESMOS_TIER: 'premium' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'dist/**',
        'node_modules/**',
        'bin/**',
        // Packaging / Gumroad / agent-export helpers — not library surface.
        'scripts/**',
        'vitest.config.ts',
        'tsup.config.ts',
      ],
      // Floors measured after enabling a real `test:coverage` CI step (Phase 1).
      // Raise deliberately as coverage grows; do not restore aspirational gaps.
      thresholds: {
        lines: 68,
        functions: 70,
        branches: 58,
        statements: 68,
      },
    },
  },
});
