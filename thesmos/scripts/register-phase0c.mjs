#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** Register Phase 0C CLI commands. Idempotent. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(import.meta.dirname, '..', 'bin', 'cli.ts');
let s = readFileSync(CLI, 'utf8');
const before = s;

const anchorImport = "import { cmdBrandLint } from './commands/brand.ts';";
const anchorRoute = "  'brand:lint': cmdBrandLint,";
const anchorHelp = '  brand:lint               Enforce canonical naming on public surfaces';

const IMPORTS = [
  ['cmdProductFacts', "import { cmdProductFacts } from './commands/product-facts.ts';"],
  ['cmdModelsLint', "import { cmdModelsLint } from './commands/models-lint.ts';"],
];
for (const [sym, line] of IMPORTS) {
  if (!s.includes(sym)) s = s.replace(anchorImport, `${anchorImport}\n${line}`);
}

const ROUTES = [
  ["'product-facts:generate'", "  'product-facts:generate': (argv) => cmdProductFacts(['generate', ...argv]),"],
  ["'product-facts:check'", "  'product-facts:check': (argv) => cmdProductFacts(['check', ...argv]),"],
  ["'product-facts:lint'", "  'product-facts:lint': (argv) => cmdProductFacts(['lint', ...argv]),"],
  ["'models:lint'", "  'models:lint': cmdModelsLint,"],
];
for (const [key, line] of ROUTES) {
  if (!s.includes(key)) s = s.replace(anchorRoute, `${anchorRoute}\n${line}`);
}

const HELP = [
  ['  product-facts:check', '  product-facts:check      Fail when committed product facts drift'],
  ['  product-facts:lint', '  product-facts:lint       Detect hard-coded product counts and prices'],
  ['  models:lint', '  models:lint              Fail on raw provider model IDs outside the registry'],
];
for (const [key, line] of HELP) {
  if (!s.includes(key)) s = s.replace(anchorHelp, `${anchorHelp}\n${line}`);
}

writeFileSync(CLI, s, 'utf8');
console.log(s === before ? 'cli.ts already registered' : 'cli.ts updated');
