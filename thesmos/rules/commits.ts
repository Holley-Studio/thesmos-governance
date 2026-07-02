// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Conventional Commits Governance Rules — COMMIT_001–010
 *
 * Validates commit messages against the Conventional Commits specification.
 * Rules use the changedFiles sentinel: path === '.git/COMMIT_EDITMSG'.
 * The commit:lint command passes the message as a fake changed file, so all
 * rules run through the standard detect() interface — explain, baseline, and
 * suppressions:audit all work automatically.
 *
 * Spec: https://www.conventionalcommits.org/en/v1.0.0/
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

export interface CommitLintConfig {
  enabled?: boolean;
  types?: string[];
  requireScope?: boolean;
  maxSubjectLength?: number;
  requireTicket?: boolean;
  ticketPattern?: string;
  allowedScopes?: string[];
}

const COMMIT_EDITMSG = '.git/COMMIT_EDITMSG';

const DEFAULT_TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'chore', 'ci', 'build', 'revert',
];

// Matches: type[(scope)][!]: subject
// Groups: 1=type, 2=scope(optional), 3=breaking(!), 4=subject
const CONVENTIONAL_RE = /^([a-z][a-z0-9-]*)(?:\(([^)]*)\))?(!)?: (.+)/;

function stripComments(msg: string): string {
  return msg.split('\n').filter((l) => !l.startsWith('#')).join('\n');
}

function parseCommit(raw: string): {
  firstLine: string;
  type: string | null;
  scope: string | null;
  breaking: boolean;
  subject: string | null;
  body: string;
  footer: string;
  valid: boolean;
} {
  const msg = stripComments(raw).trimEnd();
  const lines = msg.split('\n');
  const firstLine = (lines[0] ?? '').trim();

  const m = CONVENTIONAL_RE.exec(firstLine);
  if (!m) {
    return { firstLine, type: null, scope: null, breaking: false, subject: null, body: '', footer: '', valid: false };
  }

  const type = m[1] ?? null;
  const scope = m[2] ?? null;
  const breaking = m[3] === '!';
  const subject = m[4] ?? null;

  // Body starts after blank line following first line
  let bodyStart = 1;
  while (bodyStart < lines.length && lines[bodyStart]?.trim() === '') bodyStart++;
  const restLines = lines.slice(bodyStart);

  // Footer: lines after last blank line in body
  let footerStart = restLines.length;
  for (let i = restLines.length - 1; i >= 0; i--) {
    if (restLines[i]?.trim() === '') { footerStart = i + 1; break; }
  }
  const body = restLines.slice(0, footerStart).join('\n');
  const footer = restLines.slice(footerStart).join('\n');

  return { firstLine, type, scope, breaking, subject, valid: true, body, footer };
}

export const COMMIT_RULES: ThesmosRule[] = [
  {
    id: 'COMMIT_001',
    category: 'commit_invalid_format',
    description: "Commit message first line must match Conventional Commits format: type[(scope)][!]: subject",
    severity: 'BLOCKER',
    tags: ['git', 'commits', 'conventional-commits'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Commit messages that don't follow Conventional Commits break changelog generation, semantic versioning automation, and make git log unreadable at scale. Tools like release-it, semantic-release, and commitizen all require this format.",
      commonViolations: [
        '"Added login page" — no type prefix',
        '"fix login" — missing colon and space',
        '"Feature: added auth" — type must be lowercase',
      ],
      goodExample: 'feat(auth): add login redirect\nfix: handle null session on reload',
      badExample: '"Added login page" or "Feature: added auth" — wrong format',
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_invalid_format', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const parsed = parseCommit(content);
        if (!parsed.valid) {
          findings.push({
            severity,
            category: 'commit_invalid_format',
            file: path,
            line: 1,
            message: `Commit message does not follow Conventional Commits format: "${parsed.firstLine}"`,
            suggestion: 'Use format: type[(scope)][!]: subject  (e.g. "feat(auth): add login redirect")',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_002',
    category: 'commit_unknown_type',
    description: "Commit type must be one of the allowed types (feat, fix, docs, etc.)",
    severity: 'HIGH',
    tags: ['git', 'commits', 'conventional-commits'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Unknown commit types break automated tooling that categorises changelog entries. 'update:', 'change:', 'added:' are common AI-generated mistakes that don't map to any semantic meaning in the release pipeline.",
      commonViolations: ['"update: improve performance"', '"change: refactor auth"', '"added: new user model"'],
      goodExample: 'refactor(auth): simplify session handling\nperf(db): add index on user_id',
      badExample: '"update: improve login" or "change: refactor auth"',
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_unknown_type', config.severityRules);
      const allowedTypes = config.commitLint?.types ?? DEFAULT_TYPES;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const parsed = parseCommit(content);
        if (!parsed.valid || !parsed.type) continue;
        if (!allowedTypes.includes(parsed.type)) {
          findings.push({
            severity,
            category: 'commit_unknown_type',
            file: path,
            line: 1,
            message: `Unknown commit type "${parsed.type}". Allowed: ${allowedTypes.join(', ')}`,
            suggestion: `Change to one of: ${allowedTypes.slice(0, 5).join(', ')}…`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_003',
    category: 'commit_subject_too_long',
    description: "Commit subject line should not exceed 72 characters (configurable via commitLint.maxSubjectLength).",
    severity: 'MEDIUM',
    tags: ['git', 'commits', 'conventional-commits'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Long subject lines are truncated in GitHub PR lists, git log --oneline, and terminal output. The 72-character limit ensures the full message is readable everywhere without horizontal scrolling.",
      commonViolations: ['Long descriptive sentences used as commit subjects instead of concise summaries'],
      goodExample: 'feat(auth): add OAuth2 PKCE flow for mobile clients',
      badExample: 'feat(auth): add the new OAuth2 PKCE flow that is needed for the mobile clients because they cannot use implicit flow',
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_subject_too_long', config.severityRules);
      const max = config.commitLint?.maxSubjectLength ?? 72;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const parsed = parseCommit(content);
        if (!parsed.valid) continue;
        const len = parsed.firstLine.length;
        if (len > max) {
          findings.push({
            severity,
            category: 'commit_subject_too_long',
            file: path,
            line: 1,
            message: `Commit subject is ${len} characters (max ${max}): "${parsed.firstLine}"`,
            suggestion: `Shorten to ${max} characters or fewer. Move details to the commit body.`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_004',
    category: 'commit_subject_ends_period',
    description: "Commit subject must not end with a period.",
    severity: 'LOW',
    tags: ['git', 'commits', 'conventional-commits'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Trailing periods in commit subjects are a style convention violation. The subject is a title, not a sentence — titles don't end with periods. This is enforced by commitlint and semantic-release configurations.",
      commonViolations: ['"feat: add login page." — trailing period'],
      goodExample: 'feat(auth): add login page',
      badExample: 'feat(auth): add login page.',
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_subject_ends_period', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const parsed = parseCommit(content);
        if (!parsed.valid || !parsed.subject) continue;
        if (parsed.subject.endsWith('.')) {
          findings.push({
            severity,
            category: 'commit_subject_ends_period',
            file: path,
            line: 1,
            message: 'Commit subject ends with a period.',
            suggestion: 'Remove the trailing period from the subject line.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_005',
    category: 'commit_subject_starts_uppercase',
    description: "Commit subject (after 'type: ') must start with a lowercase letter.",
    severity: 'LOW',
    tags: ['git', 'commits', 'conventional-commits'],
    sinceVersion: '1.3.0',
    explain: {
      why: "The Conventional Commits spec and most tooling expects an imperative, lowercase subject: 'add login' not 'Added login' or 'Add login'. Uppercase subjects are often a sign that an AI tool generated a sentence-cased description instead of a proper imperative.",
      commonViolations: ['"feat: Added login" — past tense + uppercase', '"fix: Fix the bug" — sentence case'],
      goodExample: 'feat(auth): add login redirect',
      badExample: 'feat(auth): Add login redirect',
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_subject_starts_uppercase', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const parsed = parseCommit(content);
        if (!parsed.valid || !parsed.subject) continue;
        const first = parsed.subject[0];
        if (first && first === first.toUpperCase() && /[A-Z]/.test(first)) {
          findings.push({
            severity,
            category: 'commit_subject_starts_uppercase',
            file: path,
            line: 1,
            message: `Commit subject starts with uppercase "${first}". Use lowercase imperative.`,
            suggestion: `Change to: "${parsed.subject[0].toLowerCase()}${parsed.subject.slice(1)}"`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_006',
    category: 'commit_wip_message',
    description: "WIP commit messages must not land on protected branches.",
    severity: 'HIGH',
    tags: ['git', 'commits', 'conventional-commits'],
    sinceVersion: '1.3.0',
    explain: {
      why: "WIP commits signal unfinished work. If they land on main or a release branch, they pollute the changelog, break bisect, and may include half-implemented features. They should be squashed or reworded before merging.",
      commonViolations: ['"WIP: adding new feature"', '"[WIP] auth refactor"', '"wip: half done"'],
      goodExample: 'feat(auth): add OAuth flow (complete, tested)',
      badExample: 'WIP: adding auth, not done yet',
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_wip_message', config.severityRules);
      const WIP_RE = /\b(?:WIP|wip)\b|\[WIP\]|^wip:/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const msg = stripComments(content);
        const firstLine = (msg.split('\n')[0] ?? '').trim();
        if (WIP_RE.test(firstLine)) {
          findings.push({
            severity,
            category: 'commit_wip_message',
            file: path,
            line: 1,
            message: 'WIP commit message detected. Squash or reword before merging.',
            suggestion: 'Finish the work and rewrite as a proper Conventional Commit before pushing.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_007',
    category: 'commit_scope_uppercase',
    description: "Commit scope must be lowercase kebab-case (e.g. auth-flow, not Auth Flow).",
    severity: 'LOW',
    tags: ['git', 'commits', 'conventional-commits'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Scopes with uppercase letters or spaces break tooling that uses them as identifiers (e.g. changelog sections, version bump scope filters). The spec requires scopes to be a noun in lowercase.",
      commonViolations: ['"feat(Auth): add login"', '"fix(User Service): handle null"'],
      goodExample: 'feat(auth): add login\nfix(user-service): handle null session',
      badExample: 'feat(Auth Flow): add login',
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_scope_uppercase', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const parsed = parseCommit(content);
        if (!parsed.valid || !parsed.scope) continue;
        if (/[A-Z\s]/.test(parsed.scope)) {
          findings.push({
            severity,
            category: 'commit_scope_uppercase',
            file: path,
            line: 1,
            message: `Commit scope "(${parsed.scope})" contains uppercase letters or spaces. Use kebab-case.`,
            suggestion: `Change scope to: "${parsed.scope.toLowerCase().replace(/\s+/g, '-')}"`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_008',
    category: 'commit_breaking_no_footer',
    description: "Breaking change indicator (!) requires a BREAKING CHANGE: footer in the commit body.",
    severity: 'BLOCKER',
    tags: ['git', 'commits', 'conventional-commits', 'breaking-change'],
    sinceVersion: '1.3.0',
    explain: {
      why: "The Conventional Commits spec requires that a '!' breaking change marker be accompanied by a 'BREAKING CHANGE:' footer describing the impact. Without it, automated semver tooling cannot generate accurate changelogs or determine the correct version bump.",
      commonViolations: ['feat(api)!: remove deprecated endpoint  (no footer explaining the breaking change)'],
      goodExample: 'feat(api)!: remove /v1/users endpoint\n\nBREAKING CHANGE: The /v1/users endpoint is removed. Migrate to /v2/users.',
      badExample: 'feat(api)!: remove /v1/users endpoint  (no BREAKING CHANGE footer)',
      relatedPlaybooks: ['git-conventions.md', 'semver.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_breaking_no_footer', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const parsed = parseCommit(content);
        if (!parsed.valid || !parsed.breaking) continue;
        const fullMsg = stripComments(content);
        if (!/^BREAKING CHANGE:/m.test(fullMsg)) {
          findings.push({
            severity,
            category: 'commit_breaking_no_footer',
            file: path,
            line: 1,
            message: 'Breaking change (!) declared but no "BREAKING CHANGE:" footer found.',
            suggestion: 'Add a footer: "BREAKING CHANGE: <description of what breaks and how to migrate>"',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_009',
    category: 'commit_no_ticket_ref',
    description: "When commitLint.requireTicket is true, commit message must reference a ticket number.",
    severity: 'MEDIUM',
    tags: ['git', 'commits', 'project-management'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Linking commits to tickets enables traceability — you can find the original requirement, stakeholder discussion, and acceptance criteria for any code change. Without this, archaeology is the only option when debugging a production issue months later.",
      commonViolations: ['"feat: add login" — no ticket reference when required'],
      goodExample: 'feat(auth): add login redirect\n\nCloses JIRA-1234',
      badExample: 'feat(auth): add login redirect  (no ticket when requireTicket: true)',
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      if (!config.commitLint?.requireTicket) return [];
      const severity = classifySeverity('commit_no_ticket_ref', config.severityRules);
      const patternStr = config.commitLint?.ticketPattern ?? '[A-Z]+-\\d+|#\\d+';
      let ticketRe: RegExp;
      try { ticketRe = new RegExp(patternStr); } catch { return []; }

      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const parsed = parseCommit(content);
        if (!parsed.valid) continue;
        const fullMsg = stripComments(content);
        if (!ticketRe.test(fullMsg)) {
          findings.push({
            severity,
            category: 'commit_no_ticket_ref',
            file: path,
            line: 1,
            message: 'No ticket reference found. Add a ticket ID in the commit body or footer.',
            suggestion: `Add a footer line like "Closes JIRA-1234" or "Refs #42"`,
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'COMMIT_010',
    category: 'commit_merge_commit_raw',
    description: "Raw merge commit messages ('Merge branch X into Y') should be avoided — use squash merge instead.",
    severity: 'HIGH',
    tags: ['git', 'commits', 'conventional-commits'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Raw merge commits pollute git history with uninformative messages, make git bisect unreliable, and produce noisy changelogs. Squash merging produces a single atomic commit per feature with a proper Conventional Commits message.",
      commonViolations: ['"Merge branch \'feature/auth\' into \'main\'"'],
      goodExample: 'feat(auth): add OAuth2 login flow (squash-merged from feature/auth)',
      badExample: "Merge branch 'feature/auth' into 'main'",
      relatedPlaybooks: ['git-conventions.md'],
      relatedAgents: ['commit-reviewer'],
      relatedSkills: ['commit-message-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('commit_merge_commit_raw', config.severityRules);
      const MERGE_RE = /^Merge branch '.+' into '.+'/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (path !== COMMIT_EDITMSG) continue;
        const firstLine = (stripComments(content).split('\n')[0] ?? '').trim();
        if (MERGE_RE.test(firstLine)) {
          findings.push({
            severity,
            category: 'commit_merge_commit_raw',
            file: path,
            line: 1,
            message: `Raw merge commit detected: "${firstLine}"`,
            suggestion: 'Use squash merge and write a proper Conventional Commits message instead.',
          });
        }
      }
      return findings;
    },
  },
];
