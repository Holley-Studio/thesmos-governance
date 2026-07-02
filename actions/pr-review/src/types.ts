// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Shared types for the Thesmos Governance PR Review Action.
 *
 * The Finding / ChangedFile shapes mirror thesmos-governance's public API
 * and are declared here to avoid importing from the bundled library at the
 * type level — the real imports happen in index.ts where esbuild resolves them.
 */

export type Severity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'TECH_DEBT';

export interface Finding {
  severity: Severity;
  file: string;
  line?: number;
  category: string;
  message: string;
  suggestion?: string;
}

export interface ChangedFile {
  path: string;
  content: string;
  diff?: string;
  /** GitHub file status: 'added' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'. */
  status?: string;
  /** Resolved new-side changed-line set for this file — see diff-lines.ts. */
  changedLines?: Set<number> | 'all';
}

/** Parsed action inputs. */
export interface ActionInputs {
  githubToken: string;
  failOnSeverity: Severity | 'none';
  postInlineComments: boolean;
  updateSummary: boolean;
  /** Include the collapsed "pre-existing findings in touched files" section in the summary. */
  reportPreexisting: boolean;
}

/** A single comment to post inline on a PR diff. */
export interface InlineComment {
  path: string;
  line: number;
  body: string;
}
