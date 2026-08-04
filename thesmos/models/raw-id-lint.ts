// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Raw provider model-ID lint (WS4).
 *
 * Provider API identifiers must live in ONE place. A raw id copied into an
 * agent document, a UI picker, or a budget table is a fact that will drift —
 * and drift here fails at runtime, not at review.
 *
 * Approved locations only:
 *   - the model registry itself
 *   - provider adapters
 *   - adapter tests
 *   - explicit historical fixtures, each with a stated reason
 *
 * Generated platform exports MAY resolve aliases to provider ids at export
 * time; the canonical catalog stays provider-neutral.
 */

import { type CoverageExclusion } from '../lint-coverage.js';

/** Shapes that identify a provider API model id. */
export const RAW_MODEL_ID_PATTERNS: readonly RegExp[] = [
  /\bclaude-(?:opus|sonnet|haiku|fable|mythos)-[0-9][\w.-]*/g,
  /\bgpt-[0-9][\w.-]*/g,
  /\bgpt-4o\b/g,
  /\bgemini-[0-9][\w.-]*/g,
];

/** Roots scanned for raw ids. */
export const RAW_ID_ROOTS: readonly string[] = [
  'thesmos/catalog/agents/',
  'thesmos/catalog/skills/',
  'thesmos/bin/',
  'extensions/vscode/src/',
];

/**
 * Approved locations, each with a reason.
 *
 * Deliberately narrow and path-scoped. A directory-wide exclusion would let a
 * raw id reappear anywhere beneath it while the lint still reported clean.
 */
export const RAW_ID_EXCLUSIONS: readonly CoverageExclusion[] = [
  { path: 'thesmos/models/registry.ts', reason: 'the registry IS the approved home for provider ids' },
  { path: 'thesmos/models/models.test.ts', reason: 'registry tests assert on exact provider ids' },
  { path: 'thesmos/models/raw-id-lint.ts', reason: 'the linter necessarily contains the patterns' },
  { path: 'extensions/vscode/src/generated/', reason: 'generated export — fix the catalog and regenerate' },
  { path: 'thesmos/catalog/agents/reviewers/', reason: 'reviewer agents pin a model directly; migration tracked separately' },
];

export interface RawIdFinding {
  file: string;
  line: number;
  modelId: string;
  excerpt: string;
  guidance: string;
}

export function lintRawIds(content: string, rel: string): RawIdFinding[] {
  const out: RawIdFinding[] = [];
  const lines = content.split('\n');
  for (const pattern of RAW_MODEL_ID_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(lines[i]!)) !== null) {
        out.push({
          file: rel,
          line: i + 1,
          modelId: m[0],
          excerpt: lines[i]!.trim().slice(0, 140),
          guidance:
            'Reference a logical profile (fast-mechanical / balanced-agentic / deep-reasoning / ' +
            'frontier-long-horizon) and let thesmos/models/registry.ts resolve the provider id.',
        });
        if (m[0].length === 0) pattern.lastIndex++;
      }
    }
  }
  return out;
}

export function formatRawIdFindings(findings: readonly RawIdFinding[]): string {
  if (findings.length === 0) return 'No raw provider model IDs outside approved locations.';
  const lines: string[] = [`${findings.length} raw provider model ID(s) found outside approved locations`, ''];
  for (const f of findings.slice(0, 100)) {
    lines.push(`${f.file}:${f.line}  ${f.modelId}`);
    lines.push(`  > ${f.excerpt}`);
    lines.push(`  fix: ${f.guidance}`);
    lines.push('');
  }
  if (findings.length > 100) lines.push(`… ${findings.length - 100} more`);
  return lines.join('\n');
}
