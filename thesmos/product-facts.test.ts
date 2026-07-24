// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadProductFacts,
  deriveProductFacts,
  productFactsAreFresh,
} from './product-facts.js';
import { THESMOS_RULES } from './rules/registry.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

describe('product facts', () => {
  it('deriveProductFacts matches registry + package version', () => {
    const live = deriveProductFacts();
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
      license: string;
    };
    expect(live.version).toBe(pkg.version);
    expect(live.license).toBe(pkg.license);
    expect(live.ruleCount).toBe(THESMOS_RULES.length);
    expect(live.agentCount).toBeGreaterThan(0);
  });

  it('catalog/product-facts.json is present and fresh', () => {
    expect(existsSync(join(ROOT, 'catalog', 'product-facts.json'))).toBe(true);
    const check = productFactsAreFresh();
    expect(check.fresh).toBe(true);
    const loaded = loadProductFacts();
    expect(loaded.source).toBe('artifact');
    expect(loaded.version).toBe(deriveProductFacts().version);
  });
});
