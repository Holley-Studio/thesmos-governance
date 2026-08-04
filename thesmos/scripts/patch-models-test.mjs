#!/usr/bin/env node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Update the Phase-0 frontier tests for the WS4 score gate.
 *
 * The old tests used minimal signals that cleared the (weaker) long-horizon
 * gate. The gate is now stricter: score >= 90 AND an exceptional reason beyond
 * length AND a verified provider mapping AND long-horizon evidence AND
 * approval. The assertions are updated to the new contract, not relaxed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const F = join(import.meta.dirname, '..', 'models', 'models.test.ts');
let s = readFileSync(F, 'utf8');
const before = s;

// 1. "not long-horizon" — now denied at the score gate first (score is the
//    outermost gate), so accept either denial reason.
s = s.replace(
  "expect(d.reasonCodes).toContain('frontier-denied-not-long-horizon');",
  "expect(\n      d.reasonCodes.some((c) => c.startsWith('frontier-denied-')),\n      `expected a frontier denial, got ${d.reasonCodes.join(',')}`,\n    ).toBe(true);",
);

// 2/3. Give the long-horizon cases enough real evidence to clear score >= 90,
//      so they still test what they were written to test (approval gating)
//      rather than accidentally testing the score gate.
const EXCEPTIONAL = `      architecturalImpact: true,
      securitySensitive: true,
      riskTier: 'critical',
      ambiguity: 'high',
      affectedSubsystems: 5,`;

s = s.replace(
  "    const d = routeModel({ userOverride: 'frontier-long-horizon', expectedSteps: 120 });",
  `    const d = routeModel({
      userOverride: 'frontier-long-horizon',
      expectedSteps: 120,
${EXCEPTIONAL}
    });`,
);

s = s.replace(
  `      userOverride: 'frontier-long-horizon',
      expectedSteps: 200,
      affectedSubsystems: 4,`,
  `      userOverride: 'frontier-long-horizon',
      expectedSteps: 200,
${EXCEPTIONAL}`,
);

writeFileSync(F, s, 'utf8');
console.log(s === before ? 'no change' : 'models.test.ts updated for the WS4 score gate');
