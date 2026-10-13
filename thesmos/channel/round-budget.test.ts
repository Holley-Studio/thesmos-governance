// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { RoundBudget, DEFAULT_ROUND_CEILING } from './round-budget.js';

describe('RoundBudget', () => {
  it('starts unspent and not exhausted', () => {
    const budget = new RoundBudget(3);
    expect(budget.used).toBe(0);
    expect(budget.remaining).toBe(3);
    expect(budget.exhausted).toBe(false);
  });

  it('charges turns one at a time up to the ceiling', () => {
    const budget = new RoundBudget(2);
    expect(budget.charge()).toBe(true);
    expect(budget.charge()).toBe(true);
    expect(budget.exhausted).toBe(true);
    expect(budget.remaining).toBe(0);
  });

  it('refuses a charge that would breach the ceiling and clamps to it', () => {
    const budget = new RoundBudget(2);
    budget.charge();
    expect(budget.charge(5)).toBe(false);
    expect(budget.used).toBe(2);
    expect(budget.exhausted).toBe(true);
  });

  it('refuses a negative charge without mutating state', () => {
    const budget = new RoundBudget(3);
    expect(budget.charge(-1)).toBe(false);
    expect(budget.used).toBe(0);
  });

  it('defaults to specialists (up to MAX_ROUTED_AGENTS) plus Zeus', () => {
    expect(DEFAULT_ROUND_CEILING).toBe(5);
  });
});
