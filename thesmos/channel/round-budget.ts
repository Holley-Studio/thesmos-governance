// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Round budget — bounds how many agent turns one user message can trigger.
 *
 * Mirrors `thesmos/mission/limits.ts`'s `StepBudget`: a plain counter with a
 * hard ceiling, instantiated fresh per user message, no clock involved.
 * Without this, specialists replying to each other's replies within a round
 * (see `thesmos/channel/orchestrator.ts`) has no natural stopping point.
 */

export class RoundBudget {
  private spent = 0;

  constructor(private readonly ceiling: number) {}

  get used(): number {
    return this.spent;
  }

  get remaining(): number {
    return Math.max(0, this.ceiling - this.spent);
  }

  get exhausted(): boolean {
    return this.spent >= this.ceiling;
  }

  /** Charge one agent turn. Returns false when the charge would breach the ceiling. */
  charge(n = 1): boolean {
    if (n < 0) return false;
    if (this.spent + n > this.ceiling) {
      this.spent = this.ceiling;
      return false;
    }
    this.spent += n;
    return true;
  }
}

/**
 * v1 ceiling: up to `MAX_ROUTED_AGENTS` (4) specialists plus Zeus's closing
 * synthesis. One round per user message — genuine open-ended multi-round
 * back-and-forth (agents keep replying to each other unprompted) is a
 * separate, larger design and intentionally not built yet.
 */
export const DEFAULT_ROUND_CEILING = 5;
