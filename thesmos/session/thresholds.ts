// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Config → session thresholds.
 *
 * Report age deliberately reuses `doctor.reportMaxAgeDays` rather than
 * introducing a parallel key, so `thesmos doctor` and the session hook can
 * never disagree about what "stale" means.
 */

import type { ThesmosConfig } from '../types.js';
import type { StalenessThresholds } from './types.js';

const DEFAULT_BASELINE_DAYS = 30;
const DEFAULT_FETCH_HOURS = 12;
const DEFAULT_MAX_BYTES = 1200;

export function resolveThresholds(config: ThesmosConfig): StalenessThresholds {
  const staleness = config.session?.staleness;
  return {
    reportDays: config.doctor?.reportMaxAgeDays ?? 7,
    baselineDays: staleness?.baselineDays ?? DEFAULT_BASELINE_DAYS,
    fetchHours: staleness?.fetchHours ?? DEFAULT_FETCH_HOURS,
  };
}

export interface SessionStartOptions {
  enabled: boolean;
  backgroundFetch: boolean;
  maxBytes: number;
}

export function resolveSessionOptions(config: ThesmosConfig): SessionStartOptions {
  const start = config.session?.start;
  return {
    enabled: start?.enabled ?? true,
    backgroundFetch: start?.backgroundFetch ?? true,
    maxBytes: start?.maxBytes ?? DEFAULT_MAX_BYTES,
  };
}
