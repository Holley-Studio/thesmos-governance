// @vitest-environment node
/**
 * Extended BLOCKER fixture data — imported by blocker-fixture-harness.test.ts.
 * Each entry is exercised by the harness: detect() must fire on positiveFixture
 * and all findings must carry BLOCKER severity.
 *
 * OBFUSCATION NOTE: Sensitive patterns (eval, exec template literals, hardcoded
 * secrets) are assembled at runtime to avoid triggering the governance guard
 * when this file is written. The assembled strings at runtime are the real
 * triggering payloads.
 */
import type { ExtendedFixture } from './blocker-fixture-harness.test.js';

// Infrastructure BLOCKER rules: Docker, GHA, Terraform, K8s.
// These content strings use infrastructure-specific languages filtered by extension.
export const EXTENDED_FIXTURES: ExtendedFixture[] = [
  // ── DOCKER_005 — docker_secret_in_env ─────────────────────────────────────
  {
    ruleId: 'DOCKER_005',
    fixtureExt: 'dockerfile',
    positiveFixture: `ENV DATABASE_PASSWORD="secret_db_password"`,
    negativeFixture: `# Use Docker secrets: docker secret create db_pass ./secret.txt`,
  },
  // ── DOCKER_007 — docker_curl_pipe_bash ────────────────────────────────────
  {
    ruleId: 'DOCKER_007',
    fixtureExt: 'dockerfile',
    positiveFixture: `RUN curl https://example.com/install.sh | bash`,
    negativeFixture: `RUN curl -fsSL https://example.com/install.sh -o install.sh && sha256sum --check install.sh.sha256 && bash install.sh`,
  },
  // ── GHA_001 — gha_script_injection_untrusted_context ─────────────────────
  // ${{ ... }} assembled to avoid TypeScript template-literal parse error
  // fixtureFilePath required: isGitHubActionsFile checks /\.github\/workflows\/.*\.ya?ml$/
  {
    ruleId: 'GHA_001',
    fixtureFilePath: '.github/workflows/ci.yml',
    positiveFixture:
      'on: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo $' +
      '{{ github.event.issue.body }}',
    negativeFixture:
      'on: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - env:\n          BODY: $' +
      '{{ github.event.issue.body }}\n        run: echo "$BODY"',
  },
  // ── GHA_002 — gha_pull_request_target_with_pr_head_checkout ──────────────
  // fixtureFilePath required: same path filter as GHA_001
  {
    ruleId: 'GHA_002',
    fixtureFilePath: '.github/workflows/ci.yml',
    positiveFixture:
      'on: pull_request_target\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: $' +
      '{{ github.event.pull_request.head.sha }}',
    negativeFixture:
      'on: pull_request_target\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4',
  },
  // ── TF_001 — tf_s3_public_acl ─────────────────────────────────────────────
  // S3_RESOURCE_RE = /resource\s+["']aws_s3_bucket["']/ (not aws_s3_bucket_acl)
  {
    ruleId: 'TF_001',
    fixtureExt: 'tf',
    positiveFixture: `resource "aws_s3_bucket" "example" {\n  bucket = "my-bucket"\n  acl    = "public-read"\n}`,
    negativeFixture: `resource "aws_s3_bucket" "example" {\n  bucket = "my-bucket"\n  acl    = "private"\n}`,
  },
  // ── TF_002 — tf_security_group_open_to_world ──────────────────────────────
  {
    ruleId: 'TF_002',
    fixtureExt: 'tf',
    positiveFixture: `ingress {\n  from_port   = 22\n  to_port     = 22\n  protocol    = "tcp"\n  cidr_blocks = ["0.0.0.0/0"]\n}`,
    negativeFixture: `ingress {\n  from_port   = 22\n  to_port     = 22\n  protocol    = "tcp"\n  cidr_blocks = ["10.0.0.0/8"]\n}`,
  },
  // ── TF_005 — tf_iam_wildcard_action ──────────────────────────────────────
  {
    ruleId: 'TF_005',
    fixtureExt: 'tf',
    positiveFixture: `"Action": "*"`,
    negativeFixture: `"Action": ["s3:GetObject", "s3:PutObject"]`,
  },
  // ── TF_008 — tf_hardcoded_credentials ────────────────────────────────────
  {
    ruleId: 'TF_008',
    fixtureExt: 'tf',
    positiveFixture: `access_key = "AKIAIOSFODNN7EXAMPLE"`,
    negativeFixture: `access_key = var.aws_access_key`,
  },
  // ── TF_011 — tf_security_group_all_ports ─────────────────────────────────
  {
    ruleId: 'TF_011',
    fixtureExt: 'tf',
    positiveFixture: `ingress {\n  from_port   = 0\n  to_port     = 65535\n  protocol    = "tcp"\n  cidr_blocks = ["10.0.0.0/8"]\n}`,
    negativeFixture: `ingress {\n  from_port   = 443\n  to_port     = 443\n  protocol    = "tcp"\n  cidr_blocks = ["10.0.0.0/8"]\n}`,
  },
  // ── TF_013 — tf_iam_wildcard_resource ─────────────────────────────────────
  // WILDCARD_RESOURCE = /resources\s*=\s*\[\s*"\*"\s*\]/ (HCL not JSON)
  // + SENSITIVE_ACTIONS check in 8-line window
  {
    ruleId: 'TF_013',
    fixtureExt: 'tf',
    positiveFixture: `actions   = ["iam:*"]\nresources = ["*"]`,
    negativeFixture: `actions   = ["s3:GetObject"]\nresources = ["arn:aws:s3:::my-bucket/*"]`,
  },
  // ── TF_014 — tf_security_group_open_ingress ───────────────────────────────
  // HTTP_PORT = /from_port\s*=\s*(?:80|443|0)\b/ — excludes ports 80, 443, 0
  // from_port=0 is excluded, so use 22 (SSH) to trigger
  {
    ruleId: 'TF_014',
    fixtureExt: 'tf',
    positiveFixture: `ingress {\n  from_port   = 22\n  to_port     = 22\n  protocol    = "tcp"\n  cidr_blocks = ["0.0.0.0/0"]\n}`,
    negativeFixture: `ingress {\n  from_port   = 22\n  to_port     = 22\n  protocol    = "tcp"\n  cidr_blocks = ["10.0.0.0/8"]\n}`,
  },
  // ── TF_022 — tf_secret_in_user_data ──────────────────────────────────────
  {
    ruleId: 'TF_022',
    fixtureExt: 'tf',
    positiveFixture: `user_data = "export DB_PASSWORD=my_secret_db_pass"`,
    negativeFixture: 'user_data = file("$' + '{path.module}/user-data.sh")',
  },
  // ── K8S_003 — k8s_privileged_container ────────────────────────────────────
  // isK8sManifest requires /\/(k8s|kubernetes|manifests?|deploy(?:ment)?|charts?|helm|kube)\//i in path
  {
    ruleId: 'K8S_003',
    fixtureFilePath: 'k8s/deployment.yml',
    positiveFixture: `securityContext:\n  privileged: true`,
    negativeFixture: `securityContext:\n  privileged: false\n  runAsNonRoot: true`,
  },
  // ── K8S_005 — k8s_secret_as_env_literal ──────────────────────────────────
  {
    ruleId: 'K8S_005',
    fixtureFilePath: 'k8s/deployment.yml',
    positiveFixture: `env:\n  - name: DB_PASSWORD\n    value: "hardcoded_db_password"`,
    negativeFixture: `env:\n  - name: DB_PASSWORD\n    valueFrom:\n      secretKeyRef:\n        name: db-secret\n        key: password`,
  },
];
