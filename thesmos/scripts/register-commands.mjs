#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Register the Phase 0B CLI commands in bin/cli.ts.
 *
 * Idempotent: re-running makes no change. Kept as a script rather than a
 * hand-edit so the registration is reproducible and reviewable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(import.meta.dirname, '..', 'bin', 'cli.ts');
let s = readFileSync(CLI, 'utf8');
const before = s;

const IMPORTS = [
  ["cmdCredentialsLint", "import { cmdCredentialsLint } from './commands/credentials.ts';"],
  ["cmdClaimsLint", "import { cmdClaimsLint } from './commands/claims.ts';"],
];
for (const [sym, line] of IMPORTS) {
  if (!s.includes(sym)) {
    s = s.replace("import { cmdBrandLint } from './commands/brand.ts';",
                  `import { cmdBrandLint } from './commands/brand.ts';\n${line}`);
  }
}

const ROUTES = [
  ["'credentials:lint'", "  'credentials:lint': cmdCredentialsLint,"],
  ["'claims:lint'", "  'claims:lint': (argv) => cmdClaimsLint(['lint', ...argv]),"],
  ["'claims:check'", "  'claims:check': (argv) => cmdClaimsLint(['check', ...argv]),"],
];
for (const [key, line] of ROUTES) {
  if (!s.includes(key)) {
    s = s.replace("  'brand:lint': cmdBrandLint,", `  'brand:lint': cmdBrandLint,\n${line}`);
  }
}

const HELP = [
  ["  credentials:lint", "  credentials:lint         Detect fabricated agent credentials"],
  ["  claims:lint", "  claims:lint              Enforce the product claims registry"],
];
for (const [key, line] of HELP) {
  if (!s.includes(key)) {
    s = s.replace("  brand:lint               Enforce canonical naming on public surfaces",
                  `  brand:lint               Enforce canonical naming on public surfaces\n${line}`);
  }
}

if (s !== before) {
  writeFileSync(CLI, s, 'utf8');
  console.log('bin/cli.ts updated');
} else {
  console.log('bin/cli.ts already registered — no change');
}
