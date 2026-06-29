// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, Finding, DetectInput } from '../types.js';
import { classifySeverity } from '../severity.js';

const isWorkflowFile = (p: string) => /\.github\/workflows\/.*\.ya?ml$/.test(p);
const isActionFile = (p: string) => /action\.ya?ml$/.test(p);
const isGitHubActionsFile = (p: string) => isWorkflowFile(p) || isActionFile(p);

export const GITHUB_ACTIONS_RULES: ThesmosRule[] = [
  // ── GHA_001: Script injection via untrusted GitHub context ───────────────
  {
    id: 'GHA_001',
    category: 'gha_script_injection',
    description: 'Untrusted GitHub context expression used directly inside a run: step — script injection.',
    severity: 'BLOCKER',
    tags: ['security', 'github-actions', 'script-injection', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'GitHub context values like github.event.issue.body or github.event.pull_request.title are attacker-controlled. When interpolated directly into a run: shell command they expand before the shell sees them, enabling arbitrary command injection.',
      commonViolations: [
        'run: echo "${{ github.event.issue.body }}"',
        'run: |\n  deploy --message "${{ github.event.pull_request.title }}"',
      ],
      goodExample: 'env:\n  ISSUE_BODY: ${{ github.event.issue.body }}\nrun: echo "$ISSUE_BODY"',
      badExample: 'run: echo "${{ github.event.issue.body }}" # script injection',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_script_injection', config.severityRules);
      const findings: Finding[] = [];
      const DANGEROUS_CTX_RE = /\$\{\{\s*github\.event\.(?:issue\.body|comment\.body|pull_request\.(?:title|body)|head_commit\.message|review\.body|discussion\.body)\s*\}\}/;
      const RUN_RE = /^\s+run:\s*/m;
      const WINDOW = 10;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!DANGEROUS_CTX_RE.test(line)) continue;
          // Check if a `run:` appears on the same line or within the previous WINDOW lines
          const start = Math.max(0, i - WINDOW);
          const preceding = lines.slice(start, i + 1).join('\n');
          if (RUN_RE.test(preceding)) {
            findings.push({
              severity: sev,
              category: 'gha_script_injection',
              file: path,
              line: i + 1,
              message: 'Untrusted GitHub context value interpolated directly into a run: step — script injection.',
              suggestion: 'Set the value as an environment variable first:\nenv:\n  VALUE: ${{ github.event.issue.body }}\nrun: echo "$VALUE"',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_002: pull_request_target with PR head checkout ───────────────────
  {
    id: 'GHA_002',
    category: 'gha_pull_request_target_checkout',
    description: 'pull_request_target event combined with actions/checkout at the PR head — privileged workflow runs attacker code.',
    severity: 'BLOCKER',
    tags: ['security', 'github-actions', 'pwn-request', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'pull_request_target runs with write permissions to the base repo. If the workflow then checks out the PR head (attacker-controlled code), the attacker can steal secrets or manipulate the repo.',
      commonViolations: [
        'on: pull_request_target\n...\n- uses: actions/checkout@v4\n  with:\n    ref: ${{ github.event.pull_request.head.sha }}',
      ],
      goodExample: '# Either use pull_request (not pull_request_target) or do not check out the PR head',
      badExample: 'on: pull_request_target\n...\n- uses: actions/checkout@v4\n  with:\n    ref: ${{ github.event.pull_request.head.sha }} # DANGER',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_pull_request_target_checkout', config.severityRules);
      const findings: Finding[] = [];
      const PRT_RE = /pull_request_target/;
      const CHECKOUT_REF_RE = /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\./;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        if (!PRT_RE.test(content)) continue;
        if (!CHECKOUT_REF_RE.test(content)) continue;
        // Fire on each line that contains the dangerous ref
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (CHECKOUT_REF_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'gha_pull_request_target_checkout',
              file: path,
              line: i + 1,
              message: 'pull_request_target workflow checks out the PR head ref — privileged run executes attacker code.',
              suggestion: 'Do not check out the PR head in pull_request_target workflows. Use pull_request instead, or separate the privileged steps from code execution.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_003: permissions: write-all ──────────────────────────────────────
  {
    id: 'GHA_003',
    category: 'gha_write_all_permissions',
    description: 'permissions: write-all grants all write permissions to the workflow token.',
    severity: 'HIGH',
    tags: ['security', 'github-actions', 'permissions', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'write-all grants the GITHUB_TOKEN write access to every GitHub API scope. A compromised step or supply-chain attack can use this to push code, modify releases, or exfiltrate secrets.',
      commonViolations: [
        'permissions: write-all',
      ],
      goodExample: 'permissions:\n  contents: read\n  pull-requests: write',
      badExample: 'permissions: write-all # grants all scopes',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_write_all_permissions', config.severityRules);
      const findings: Finding[] = [];
      const WRITE_ALL_RE = /^\s*permissions:\s*write-all\s*$/;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (WRITE_ALL_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'gha_write_all_permissions',
              file: path,
              line: i + 1,
              message: 'permissions: write-all grants all write permissions — use minimal scoped permissions.',
              suggestion: 'Replace with explicit minimal permissions, e.g.:\npermissions:\n  contents: read\n  pull-requests: write',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_004: unpinned action (branch/tag reference) ──────────────────────
  {
    id: 'GHA_004',
    category: 'gha_unpinned_action',
    description: 'actions/checkout or third-party action referenced at a branch/tag rather than a full commit SHA.',
    severity: 'MEDIUM',
    tags: ['security', 'github-actions', 'supply-chain', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Tags and branches are mutable. A compromised action maintainer can push malicious code to a tag, and your workflow silently executes it. Pinning to a full SHA guarantees immutability.',
      commonViolations: [
        'uses: actions/checkout@v4',
        'uses: owner/repo@main',
        'uses: third-party/action@latest',
      ],
      goodExample: 'uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af68e # v4.2.2',
      badExample: 'uses: actions/checkout@v4 # mutable tag',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_unpinned_action', config.severityRules);
      const findings: Finding[] = [];
      // Matches uses: owner/repo@branch-or-tag (not a 40-char SHA)
      const UNPINNED_RE = /^\s*-?\s*uses:\s*\S+@(?!([0-9a-f]{40})\b)(?:main|master|latest|v\d[\w.]*)(?:\s|$)/;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (UNPINNED_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'gha_unpinned_action',
              file: path,
              line: i + 1,
              message: 'Action pinned to a mutable branch/tag — use a full commit SHA for supply-chain safety.',
              suggestion: 'Pin to a full 40-character SHA, e.g.: uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af68e',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_005: secrets echoed in run step ──────────────────────────────────
  {
    id: 'GHA_005',
    category: 'gha_secrets_logged',
    description: 'Secret value echoed inside a run: step — secrets in logs even with masking.',
    severity: 'HIGH',
    tags: ['security', 'github-actions', 'secrets', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: "GitHub Actions masks known secret values in logs, but masking can be bypassed by splitting or encoding the value. Echoing secrets also sets a poor security precedent and can leak in third-party log forwarders.",
      commonViolations: [
        'run: echo "Token is ${{ secrets.MY_TOKEN }}"',
        'run: echo ${{ secrets.API_KEY }}',
      ],
      goodExample: '# Never echo secrets. Pass them as env vars to the consuming command.',
      badExample: 'run: echo "Token: ${{ secrets.MY_TOKEN }}" # bad even with masking',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_secrets_logged', config.severityRules);
      const findings: Finding[] = [];
      const ECHO_SECRET_RE = /\becho\b[^#\n]*\$\{\{\s*secrets\./;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (ECHO_SECRET_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'gha_secrets_logged',
              file: path,
              line: i + 1,
              message: 'Secret echoed in run: step — avoid logging secret values even when masking is active.',
              suggestion: 'Pass secrets as environment variables to your command rather than interpolating them into shell strings.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_006: self-hosted runner with public contribution trigger ──────────
  {
    id: 'GHA_006',
    category: 'gha_self_hosted_runner',
    description: 'Self-hosted runner used in a workflow that can be triggered by external contributors.',
    severity: 'HIGH',
    tags: ['security', 'github-actions', 'self-hosted-runner', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Self-hosted runners persist between jobs and may have access to internal network resources. A pull_request or issue_comment trigger from a fork lets attackers run arbitrary code on your internal infrastructure.',
      commonViolations: [
        'on: [pull_request]\n...\nruns-on: self-hosted',
      ],
      goodExample: 'runs-on: ubuntu-latest # use ephemeral GitHub-hosted runners for public triggers',
      badExample: 'on:\n  pull_request:\nruns-on: self-hosted # any fork PR runs on your infra',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_self_hosted_runner', config.severityRules);
      const findings: Finding[] = [];
      const SELF_HOSTED_RE = /runs-on:\s*self-hosted/;
      const PUBLIC_TRIGGER_RE = /pull_request:|issue_comment:/;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        if (!PUBLIC_TRIGGER_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SELF_HOSTED_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'gha_self_hosted_runner',
              file: path,
              line: i + 1,
              message: 'Self-hosted runner used in workflow triggered by external contributors — code execution on your infrastructure.',
              suggestion: 'Use GitHub-hosted ephemeral runners (ubuntu-latest) for workflows triggered by pull_request or issue_comment.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_007: workflow inputs used directly in run steps ──────────────────
  {
    id: 'GHA_007',
    category: 'gha_env_from_input',
    description: 'Workflow dispatch input interpolated directly into a run: command instead of being set as an env var first.',
    severity: 'HIGH',
    tags: ['security', 'github-actions', 'script-injection', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Workflow inputs are user-controlled strings. Interpolating them directly into run: commands before the shell sees them enables the same script injection as untrusted GitHub event context.',
      commonViolations: [
        'run: deploy --env ${{ inputs.environment }}',
        'run: echo ${{ github.event.inputs.message }}',
      ],
      goodExample: 'env:\n  DEPLOY_ENV: ${{ inputs.environment }}\nrun: deploy --env "$DEPLOY_ENV"',
      badExample: 'run: deploy --env ${{ inputs.environment }} # script injection via inputs',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_env_from_input', config.severityRules);
      const findings: Finding[] = [];
      const INPUT_RE = /\$\{\{\s*(?:github\.event\.)?inputs\.\w+\s*\}\}/;
      const RUN_RE = /^\s+run:/m;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!INPUT_RE.test(line)) continue;
          const start = Math.max(0, i - WINDOW);
          const preceding = lines.slice(start, i + 1).join('\n');
          if (RUN_RE.test(preceding)) {
            findings.push({
              severity: sev,
              category: 'gha_env_from_input',
              file: path,
              line: i + 1,
              message: 'Workflow input interpolated directly into run: command — set as env var first.',
              suggestion: 'Assign to an environment variable:\nenv:\n  MY_INPUT: ${{ inputs.my_param }}\nrun: command "$MY_INPUT"',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_008: upload-artifact with context expression in path ──────────────
  {
    id: 'GHA_008',
    category: 'gha_artifact_path_traversal',
    description: 'actions/upload-artifact with a path: containing a GitHub context expression — potential path traversal.',
    severity: 'MEDIUM',
    tags: ['security', 'github-actions', 'path-traversal', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Artifact paths constructed from GitHub context values can be manipulated by attackers to overwrite files outside the intended directory or create artifacts with unexpected names that affect downstream jobs.',
      commonViolations: [
        '- uses: actions/upload-artifact@v4\n  with:\n    path: dist/${{ github.event.pull_request.head.ref }}',
      ],
      goodExample: '- uses: actions/upload-artifact@v4\n  with:\n    name: build-output\n    path: dist/',
      badExample: '- uses: actions/upload-artifact@v4\n  with:\n    path: dist/${{ github.event.pull_request.head.ref }} # path traversal risk',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_artifact_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const UPLOAD_RE = /actions\/upload-artifact/;
      const PATH_CTX_RE = /^\s*path:\s*.*\$\{\{/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!UPLOAD_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + WINDOW + 1);
          for (let j = i + 1; j < end; j++) {
            if (PATH_CTX_RE.test(lines[j]!)) {
              findings.push({
                severity: sev,
                category: 'gha_artifact_path_traversal',
                file: path,
                line: j + 1,
                message: 'upload-artifact path: contains a GitHub context expression — potential path traversal.',
                suggestion: 'Use a static path for artifacts and pass dynamic values via artifact name, not path.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_009: cache restore-keys using only github.ref ────────────────────
  {
    id: 'GHA_009',
    category: 'gha_cache_restore_key_mutable',
    description: 'actions/cache restore-keys: ends with ${{ github.ref }} — mutable cache key enables cache poisoning.',
    severity: 'MEDIUM',
    tags: ['security', 'github-actions', 'cache-poisoning', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'A restore-keys entry that terminates with ${{ github.ref }} matches any cache written to that branch. An attacker who can write to the branch cache can poison it with a malicious build artifact consumed by future jobs.',
      commonViolations: [
        'restore-keys: |\n  ${{ runner.os }}-node-${{ github.ref }}',
      ],
      goodExample: 'key: ${{ runner.os }}-node-${{ hashFiles("**/package-lock.json") }}\nrestore-keys: |\n  ${{ runner.os }}-node-',
      badExample: 'restore-keys: |\n  ${{ runner.os }}-node-${{ github.ref }} # mutable, poisonable',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_cache_restore_key_mutable', config.severityRules);
      const findings: Finding[] = [];
      const RESTORE_RE = /^\s*restore-keys:\s*/;
      const GITHUB_REF_TRAIL_RE = /\$\{\{\s*github\.ref\s*\}\}\s*$/;
      const WINDOW = 3;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!RESTORE_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + WINDOW + 1);
          for (let j = i; j < end; j++) {
            if (GITHUB_REF_TRAIL_RE.test(lines[j]!)) {
              findings.push({
                severity: sev,
                category: 'gha_cache_restore_key_mutable',
                file: path,
                line: j + 1,
                message: 'Cache restore-key ending with ${{ github.ref }} is mutable — enables cache poisoning.',
                suggestion: 'End restore-keys with a stable prefix (e.g. runner.os + dep hash) rather than github.ref.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── GHA_010: deprecated ::set-env / ::add-path commands ──────────────────
  {
    id: 'GHA_010',
    category: 'gha_deprecated_set_env',
    description: 'Deprecated ::set-env:: or ::add-path:: workflow commands used — CVE-2020-15228 environment injection.',
    severity: 'HIGH',
    tags: ['security', 'github-actions', 'CVE-2020-15228', 'ci-cd'],
    sinceVersion: '1.6.0',
    explain: {
      why: '::set-env:: and ::add-path:: were deprecated because untrusted data written to stdout could set arbitrary environment variables in subsequent steps, enabling privilege escalation via environment injection (CVE-2020-15228).',
      commonViolations: [
        'run: echo "::set-env name=PATH::$HOME/bin:$PATH"',
        'run: echo "::add-path::$HOME/bin"',
      ],
      goodExample: 'run: echo "MY_VAR=value" >> $GITHUB_ENV',
      badExample: 'run: echo "::set-env name=MY_VAR::value" # CVE-2020-15228',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('gha_deprecated_set_env', config.severityRules);
      const findings: Finding[] = [];
      const DEPRECATED_CMD_RE = /::set-env\s+name=|::add-path::/;
      for (const { path, content } of changedFiles) {
        if (!isGitHubActionsFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (DEPRECATED_CMD_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'gha_deprecated_set_env',
              file: path,
              line: i + 1,
              message: 'Deprecated ::set-env:: or ::add-path:: command used — environment injection vulnerability (CVE-2020-15228).',
              suggestion: 'Use $GITHUB_ENV file instead: echo "MY_VAR=value" >> $GITHUB_ENV',
            });
          }
        }
      }
      return findings;
    },
  },
];
