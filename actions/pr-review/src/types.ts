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
}

/** Parsed action inputs. */
export interface ActionInputs {
  githubToken: string;
  failOnSeverity: Severity | 'none';
  postInlineComments: boolean;
  updateSummary: boolean;
}

/** A single comment to post inline on a PR diff. */
export interface InlineComment {
  path: string;
  line: number;
  body: string;
}
