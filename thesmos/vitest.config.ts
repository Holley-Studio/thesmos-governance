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
        'vitest.config.ts',
        'tsup.config.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
