// @vitest-environment node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * config.schema.json drift + tokenBudget contract tests.
 *
 * The schema declares `additionalProperties: false`, so every key the runtime
 * reads MUST be declared or a schema-validating editor flags valid configs.
 * This suite guards against the drift that let `tokenBudget` be read by the
 * runtime for months while the schema rejected it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface JsonSchema {
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchemaProp>;
}
interface JsonSchemaProp {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  description?: string;
  properties?: Record<string, JsonSchemaProp>;
  additionalProperties?: boolean | JsonSchemaProp;
}

const schemaPath = join(__dirname, 'config.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as JsonSchema;

/** Minimal draft-07 checker for the scalar constraints this suite asserts. */
function violates(prop: JsonSchemaProp, value: unknown): boolean {
  if (prop.enum && !prop.enum.includes(value)) return true;
  if (prop.type === 'number' && typeof value !== 'number') return true;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return true;
    if (prop.minimum !== undefined && value < prop.minimum) return true;
    if (prop.maximum !== undefined && value > prop.maximum) return true;
    if (prop.exclusiveMinimum !== undefined && value <= prop.exclusiveMinimum) return true;
    if (prop.exclusiveMaximum !== undefined && value >= prop.exclusiveMaximum) return true;
  }
  return false;
}

describe('config.schema.json — drift guard', () => {
  it('declares every top-level key used by the live .thesmos/config.json', () => {
    const live = JSON.parse(readFileSync(join(__dirname, '..', '.thesmos', 'config.json'), 'utf-8')) as Record<string, unknown>;
    const declared = new Set(Object.keys(schema.properties ?? {}));
    const undeclared = Object.keys(live).filter((k) => !declared.has(k));
    expect(undeclared).toEqual([]);
  });

  it('declares tokenBudget (the drift this suite exists to prevent)', () => {
    expect(schema.properties?.tokenBudget).toBeDefined();
    expect(schema.properties?.tokenBudget.type).toBe('object');
  });
});

describe('config.schema.json — tokenBudget contract', () => {
  const tb = schema.properties!.tokenBudget.properties!;

  it('billingMode accepts exactly auto | subscription | metered, defaulting to auto', () => {
    expect(tb.billingMode.enum).toEqual(['auto', 'subscription', 'metered']);
    expect(tb.billingMode.default).toBe('auto');
    expect(violates(tb.billingMode, 'subscription')).toBe(false);
    expect(violates(tb.billingMode, 'metered')).toBe(false);
    expect(violates(tb.billingMode, 'prepaid')).toBe(true);
    expect(violates(tb.billingMode, '')).toBe(true);
  });

  it('monetary ceilings require positive finite values', () => {
    for (const key of ['sessionMaxCostUSD', 'subscriptionWarningEquivalentUSD'] as const) {
      expect(tb[key].exclusiveMinimum).toBe(0);
      expect(violates(tb[key], 15)).toBe(false);
      expect(violates(tb[key], 0)).toBe(true);
      expect(violates(tb[key], -5)).toBe(true);
      expect(violates(tb[key], Infinity)).toBe(true);
      expect(violates(tb[key], 'lots')).toBe(true);
    }
  });

  it('warnAtFraction is strictly between 0 and 1', () => {
    expect(violates(tb.warnAtFraction, 0.8)).toBe(false);
    expect(violates(tb.warnAtFraction, 0)).toBe(true);
    expect(violates(tb.warnAtFraction, 1)).toBe(true);
    expect(violates(tb.warnAtFraction, 1.5)).toBe(true);
    expect(violates(tb.warnAtFraction, -0.1)).toBe(true);
  });

  it('describes billingMode semantics so editors surface them (autocomplete + hover)', () => {
    const desc = String(tb.billingMode.description);
    expect(desc).toContain('metered');
    expect(desc).toContain('subscription');
    expect(desc).toContain('advisory');
    expect(desc).toMatch(/API-equivalent/);
    // The migration promise: old configs are never reinterpreted as metered.
    expect(desc.toLowerCase()).toContain("behave as 'auto'");
  });

  it('rejects unknown tokenBudget keys (additionalProperties: false)', () => {
    expect(schema.properties!.tokenBudget.additionalProperties).toBe(false);
  });

  it('keeps every legacy field so old configs remain valid', () => {
    for (const key of [
      'enabled',
      'sessionMaxTokens',
      'sessionMaxCostUSD',
      'dailyMaxCostUSD',
      'projectMaxCostUSD',
      'alertAt',
      'hardStopAt',
      'modelCostTable',
    ]) {
      expect(tb[key], `tokenBudget.${key} missing from schema`).toBeDefined();
    }
  });
});
