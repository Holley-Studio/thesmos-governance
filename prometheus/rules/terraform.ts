import type { PrometheusRule, Finding, DetectInput } from '../types.js';
import { classifySeverity } from '../severity.js';

const isTerraformFile = (p: string) => /\.tf$/.test(p);
const isTerraformVars = (p: string) => /\.tfvars$/.test(p);
const isTerraformOrVars = (p: string) => /\.tf$|\.tfvars$/.test(p);

export const TERRAFORM_RULES: PrometheusRule[] = [
  // ── TF_001: S3 bucket with public ACL ────────────────────────────────────
  {
    id: 'TF_001',
    category: 'tf_s3_public_acl',
    description: 'S3 bucket resource with a public-read or public-read-write ACL — publicly exposes all bucket objects.',
    severity: 'BLOCKER',
    tags: ['security', 'terraform', 'aws', 's3', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Setting acl = "public-read" or "public-read-write" on an S3 bucket makes every object in the bucket accessible to anyone on the internet. Even if current objects are safe, future uploads inherit the ACL. Use bucket policies for controlled, per-path access instead.',
      commonViolations: [
        'acl = "public-read"',
        'acl = "public-read-write"',
      ],
      goodExample: '# Remove the acl argument and use a bucket policy for controlled access\nresource "aws_s3_bucket_policy" "example" {\n  bucket = aws_s3_bucket.example.id\n  policy = data.aws_iam_policy_document.example.json\n}',
      badExample: 'resource "aws_s3_bucket" "example" {\n  bucket = "my-bucket"\n  acl    = "public-read" # BLOCKER: publicly exposes all objects\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_s3_public_acl', config.severityRules);
      const findings: Finding[] = [];
      const ACL_RE = /^\s*acl\s*=\s*["']public-read(?:-write)?["']/;
      const S3_RESOURCE_RE = /resource\s+["']aws_s3_bucket["']/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!ACL_RE.test(lines[i]!)) continue;
          // Check within 20 lines before for aws_s3_bucket resource
          const start = Math.max(0, i - 20);
          const window = lines.slice(start, i + 1).join('\n');
          if (S3_RESOURCE_RE.test(window)) {
            findings.push({
              severity: sev, category: 'tf_s3_public_acl', file: path, line: i + 1,
              message: 'S3 bucket has a public ACL — all objects are publicly readable/writable.',
              suggestion: 'Remove the acl argument. Use aws_s3_bucket_policy with an explicit policy for controlled access.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_002: Security group ingress open to 0.0.0.0/0 on sensitive ports ──
  {
    id: 'TF_002',
    category: 'tf_sg_open_to_world',
    description: 'Security group allows inbound traffic from 0.0.0.0/0 on sensitive ports (SSH, database ports).',
    severity: 'BLOCKER',
    tags: ['security', 'terraform', 'aws', 'networking', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Exposing SSH (22), MySQL (3306), PostgreSQL (5432), Redis (6379), MongoDB (27017), or Oracle (1521) to the entire internet allows brute-force, credential stuffing, and exploit scanning. Databases should never be directly reachable from the internet.',
      commonViolations: [
        'cidr_blocks = ["0.0.0.0/0"] with from_port = 22',
        'cidr_blocks = ["0.0.0.0/0"] with from_port = 3306',
      ],
      goodExample: 'ingress {\n  from_port   = 22\n  to_port     = 22\n  protocol    = "tcp"\n  cidr_blocks = ["10.0.0.0/8"] # restrict to internal network\n}',
      badExample: 'ingress {\n  from_port   = 22\n  to_port     = 22\n  protocol    = "tcp"\n  cidr_blocks = ["0.0.0.0/0"] # BLOCKER: SSH open to the internet\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_sg_open_to_world', config.severityRules);
      const findings: Finding[] = [];
      const OPEN_CIDR_RE = /cidr_blocks\s*=\s*\[\s*["']0\.0\.0\.0\/0["']/;
      const SENSITIVE_PORT_RE = /(?:from_port|port)\s*=\s*(?:22|3306|5432|6379|27017|1521)\b/;
      const WINDOW = 10;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!OPEN_CIDR_RE.test(lines[i]!)) continue;
          const start = Math.max(0, i - WINDOW);
          const end = Math.min(lines.length, i + WINDOW + 1);
          const window = lines.slice(start, end).join('\n');
          if (SENSITIVE_PORT_RE.test(window)) {
            findings.push({
              severity: sev, category: 'tf_sg_open_to_world', file: path, line: i + 1,
              message: 'Security group allows 0.0.0.0/0 access on a sensitive port (SSH/database).',
              suggestion: 'Restrict cidr_blocks to specific trusted IP ranges. Never expose databases to the internet.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_003: RDS instance with publicly_accessible = true ─────────────────
  {
    id: 'TF_003',
    category: 'tf_rds_publicly_accessible',
    description: 'RDS instance or cluster with publicly_accessible = true — database is internet-reachable.',
    severity: 'HIGH',
    tags: ['security', 'terraform', 'aws', 'rds', 'database', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Setting publicly_accessible = true attaches a public IP to the RDS instance and allows connections from outside the VPC (subject to security groups). Even with a strong password, internet-exposed databases are subject to brute-force and exploit scanning.',
      commonViolations: [
        'publicly_accessible = true',
      ],
      goodExample: 'resource "aws_db_instance" "example" {\n  # ...\n  publicly_accessible = false\n}',
      badExample: 'resource "aws_db_instance" "example" {\n  # ...\n  publicly_accessible = true # HIGH: database reachable from internet\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_rds_publicly_accessible', config.severityRules);
      const findings: Finding[] = [];
      const PUBLIC_RE = /^\s*publicly_accessible\s*=\s*true\b/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (PUBLIC_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'tf_rds_publicly_accessible', file: path, line: i + 1,
              message: 'RDS instance has publicly_accessible = true — database is internet-reachable.',
              suggestion: 'Set publicly_accessible = false. Access RDS from within the VPC via a bastion host or VPN.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_004: RDS instance without storage encryption ──────────────────────
  {
    id: 'TF_004',
    category: 'tf_rds_no_encryption',
    description: 'RDS instance or cluster without storage_encrypted = true — data at rest is unencrypted.',
    severity: 'HIGH',
    tags: ['security', 'terraform', 'aws', 'rds', 'encryption', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Without storage encryption, anyone who gains physical or API access to the underlying EBS volume can read database contents. AWS RDS encryption is free and has no performance impact — there is no reason not to enable it.',
      commonViolations: [
        'resource "aws_db_instance" without storage_encrypted = true',
      ],
      goodExample: 'resource "aws_db_instance" "example" {\n  # ...\n  storage_encrypted = true\n}',
      badExample: 'resource "aws_db_instance" "example" {\n  engine         = "mysql"\n  instance_class = "db.t3.micro"\n  # HIGH: missing storage_encrypted = true\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_rds_no_encryption', config.severityRules);
      const findings: Finding[] = [];
      const RDS_RESOURCE_RE = /^\s*resource\s+["']aws_(?:db_instance|rds_cluster)["']/;
      const ENCRYPTED_RE = /storage_encrypted\s*=\s*true/;
      const SCAN_LINES = 30;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!RDS_RESOURCE_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + SCAN_LINES);
          const block = lines.slice(i, end).join('\n');
          if (!ENCRYPTED_RE.test(block)) {
            findings.push({
              severity: sev, category: 'tf_rds_no_encryption', file: path, line: i + 1,
              message: 'RDS instance/cluster declared without storage_encrypted = true — data at rest is unencrypted.',
              suggestion: 'Add storage_encrypted = true to the aws_db_instance or aws_rds_cluster resource.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_005: IAM policy with wildcard action ("*") ────────────────────────
  {
    id: 'TF_005',
    category: 'tf_iam_wildcard_action',
    description: 'IAM policy statement grants all actions ("*") — full AWS admin access.',
    severity: 'BLOCKER',
    tags: ['security', 'terraform', 'aws', 'iam', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'actions = ["*"] or Action: "*" is equivalent to granting full AWS administrator access. Any entity with this policy can create/delete any resource, exfiltrate data, or escalate privileges to other accounts.',
      commonViolations: [
        'actions = ["*"]',
        '"Action": "*"',
      ],
      goodExample: 'statement {\n  actions   = ["s3:GetObject", "s3:PutObject"]\n  resources = ["arn:aws:s3:::my-bucket/*"]\n}',
      badExample: 'statement {\n  actions   = ["*"] # BLOCKER: full admin access\n  resources = ["*"]\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_iam_wildcard_action', config.severityRules);
      const findings: Finding[] = [];
      const WILDCARD_ACTION_RE = /actions\s*=\s*\[\s*["']\*["']\s*\]/;
      const JSON_ACTION_RE = /["']Action["']\s*:\s*["']\*["']/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (WILDCARD_ACTION_RE.test(line) || JSON_ACTION_RE.test(line)) {
            findings.push({
              severity: sev, category: 'tf_iam_wildcard_action', file: path, line: i + 1,
              message: 'IAM policy grants all actions ("*") — equivalent to full admin access.',
              suggestion: 'Enumerate only the specific actions required. Follow principle of least privilege.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_006: IAM policy statement with wildcard resource ──────────────────
  {
    id: 'TF_006',
    category: 'tf_iam_wildcard_resource',
    description: 'IAM policy statement uses resources = ["*"] — policy applies to all AWS resources.',
    severity: 'HIGH',
    tags: ['security', 'terraform', 'aws', 'iam', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'resources = ["*"] makes the policy apply to every resource in the account. Combined with write or delete actions this allows account-wide destructive operations. Always scope resources to specific ARNs.',
      commonViolations: [
        'resources = ["*"]',
      ],
      goodExample: 'statement {\n  actions   = ["s3:GetObject"]\n  resources = ["arn:aws:s3:::my-bucket/*"]\n}',
      badExample: 'statement {\n  actions   = ["s3:DeleteObject"]\n  resources = ["*"] # HIGH: applies to every S3 bucket\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_iam_wildcard_resource', config.severityRules);
      const findings: Finding[] = [];
      const WILDCARD_RESOURCE_RE = /resources\s*=\s*\[\s*["']\*["']\s*\]/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (WILDCARD_RESOURCE_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'tf_iam_wildcard_resource', file: path, line: i + 1,
              message: 'IAM policy statement targets all resources ("*") — policy has account-wide blast radius.',
              suggestion: 'Scope resources to specific ARNs: resources = ["arn:aws:s3:::my-bucket/*"].',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_007: S3 bucket without versioning enabled ─────────────────────────
  {
    id: 'TF_007',
    category: 'tf_s3_no_versioning',
    description: 'S3 bucket resource without versioning enabled — objects cannot be recovered after deletion or overwrite.',
    severity: 'MEDIUM',
    tags: ['security', 'terraform', 'aws', 's3', 'data-protection', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Without versioning, deleting or overwriting an S3 object is permanent. Versioning protects against accidental deletion, ransomware attacks, and application bugs that corrupt data.',
      commonViolations: [
        'resource "aws_s3_bucket" without a versioning { enabled = true } block',
      ],
      goodExample: 'resource "aws_s3_bucket" "example" {\n  bucket = "my-bucket"\n  versioning {\n    enabled = true\n  }\n}',
      badExample: 'resource "aws_s3_bucket" "example" {\n  bucket = "my-bucket"\n  # MEDIUM: no versioning block\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_s3_no_versioning', config.severityRules);
      const findings: Finding[] = [];
      const S3_RESOURCE_RE = /^\s*resource\s+["']aws_s3_bucket["']/;
      const VERSIONING_RE = /versioning\s*\{/;
      const SCAN_LINES = 30;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!S3_RESOURCE_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + SCAN_LINES);
          const block = lines.slice(i, end).join('\n');
          if (!VERSIONING_RE.test(block)) {
            findings.push({
              severity: sev, category: 'tf_s3_no_versioning', file: path, line: i + 1,
              message: 'S3 bucket declared without a versioning block — objects cannot be recovered after deletion.',
              suggestion: 'Add a versioning block with enabled = true inside the aws_s3_bucket resource.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_008: Hardcoded credentials in Terraform files ─────────────────────
  {
    id: 'TF_008',
    category: 'tf_hardcoded_credentials',
    description: 'Hardcoded password, secret, or API key found in Terraform configuration.',
    severity: 'BLOCKER',
    tags: ['security', 'terraform', 'secrets', 'credentials', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Hardcoded credentials end up in version control, Terraform state files, and CI logs. Anyone with access to these artifacts can extract the credentials. Use variables, SSM Parameter Store, or Secrets Manager references instead.',
      commonViolations: [
        'password = "mysupersecret123"',
        'api_key  = "sk-abc123xyz"',
      ],
      goodExample: 'resource "aws_db_instance" "example" {\n  password = var.db_password\n}',
      badExample: 'resource "aws_db_instance" "example" {\n  password = "mysupersecret123" # BLOCKER: hardcoded credential\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_hardcoded_credentials', config.severityRules);
      const findings: Finding[] = [];
      const CRED_RE = /(?:password|secret|api_key|access_key|private_key|auth_token)\s*=\s*["'][^"'$]{8,}["']/i;
      for (const { path, content } of changedFiles) {
        if (!isTerraformOrVars(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*#/.test(line)) continue; // skip comment lines
          if (CRED_RE.test(line)) {
            // Skip placeholder-only values (all asterisks)
            const match = line.match(/["']([^"'$]+)["']\s*$/);
            if (match && /^\*+$/.test(match[1]!)) continue;
            findings.push({
              severity: sev, category: 'tf_hardcoded_credentials', file: path, line: i + 1,
              message: 'Hardcoded credential or secret found in Terraform config.',
              suggestion: 'Use var.* references, data.aws_ssm_parameter, or data.aws_secretsmanager_secret_version.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_009: EC2 instance without IMDSv2 enforcement ──────────────────────
  {
    id: 'TF_009',
    category: 'tf_ec2_imds_v1',
    description: 'EC2 instance without IMDSv2 enforcement — vulnerable to SSRF-to-metadata attacks.',
    severity: 'MEDIUM',
    tags: ['security', 'terraform', 'aws', 'ec2', 'ssrf', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'IMDSv1 allows any code running on the instance (including SSRF exploits) to fetch IAM credentials from 169.254.169.254 with a simple HTTP GET. IMDSv2 requires a PUT request with a session token, blocking SSRF-based metadata theft.',
      commonViolations: [
        'resource "aws_instance" without metadata_options { http_tokens = "required" }',
      ],
      goodExample: 'resource "aws_instance" "example" {\n  ami           = "ami-12345"\n  instance_type = "t3.micro"\n  metadata_options {\n    http_tokens = "required"\n  }\n}',
      badExample: 'resource "aws_instance" "example" {\n  ami           = "ami-12345"\n  instance_type = "t3.micro"\n  # MEDIUM: no metadata_options block — IMDSv1 enabled\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_ec2_imds_v1', config.severityRules);
      const findings: Finding[] = [];
      const INSTANCE_RE = /^\s*resource\s+["']aws_instance["']/;
      const HTTP_TOKENS_RE = /http_tokens\s*=\s*["']required["']/;
      const SCAN_LINES = 20;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!INSTANCE_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + SCAN_LINES);
          const block = lines.slice(i, end).join('\n');
          if (!HTTP_TOKENS_RE.test(block)) {
            findings.push({
              severity: sev, category: 'tf_ec2_imds_v1', file: path, line: i + 1,
              message: 'EC2 instance declared without IMDSv2 enforcement — SSRF can steal IAM credentials.',
              suggestion: 'Add metadata_options { http_tokens = "required" } to enforce IMDSv2.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_010: CloudWatch log group without retention policy ─────────────────
  {
    id: 'TF_010',
    category: 'tf_log_group_no_retention',
    description: 'CloudWatch log group without retention_in_days — logs are retained indefinitely, increasing cost and compliance risk.',
    severity: 'MEDIUM',
    tags: ['security', 'terraform', 'aws', 'cloudwatch', 'logging', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Without a retention policy, CloudWatch log groups keep logs forever at increasing cost. Many compliance frameworks (HIPAA, PCI-DSS) require log data to be purged after a defined retention period. Setting a reasonable retention period also limits exposure of sensitive data in logs.',
      commonViolations: [
        'resource "aws_cloudwatch_log_group" without retention_in_days',
      ],
      goodExample: 'resource "aws_cloudwatch_log_group" "example" {\n  name              = "/aws/lambda/my-function"\n  retention_in_days = 90\n}',
      badExample: 'resource "aws_cloudwatch_log_group" "example" {\n  name = "/aws/lambda/my-function"\n  # MEDIUM: no retention_in_days — logs kept forever\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_log_group_no_retention', config.severityRules);
      const findings: Finding[] = [];
      const LOG_GROUP_RE = /^\s*resource\s+["']aws_cloudwatch_log_group["']/;
      const RETENTION_RE = /retention_in_days/;
      const SCAN_LINES = 10;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!LOG_GROUP_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + SCAN_LINES);
          const block = lines.slice(i, end).join('\n');
          if (!RETENTION_RE.test(block)) {
            findings.push({
              severity: sev, category: 'tf_log_group_no_retention', file: path, line: i + 1,
              message: 'CloudWatch log group without retention_in_days — logs kept indefinitely.',
              suggestion: 'Add retention_in_days = 90 (or your compliance requirement) to the aws_cloudwatch_log_group resource.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_011: Security group with all ports open (0-65535) ──────────────────
  {
    id: 'TF_011',
    category: 'tf_security_group_all_ports',
    description: 'Security group ingress/egress with from_port = 0 and to_port = 65535 — all TCP/UDP ports open.',
    severity: 'BLOCKER',
    tags: ['security', 'terraform', 'aws', 'networking', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Allowing traffic on all 65535 ports defeats the purpose of a security group. Every service running on the instance is exposed — including administration ports, debug endpoints, and internal APIs not intended for external access.',
      commonViolations: [
        'from_port = 0 and to_port = 65535',
      ],
      goodExample: 'ingress {\n  from_port   = 443\n  to_port     = 443\n  protocol    = "tcp"\n  cidr_blocks = ["0.0.0.0/0"]\n}',
      badExample: 'ingress {\n  from_port   = 0\n  to_port     = 65535 # BLOCKER: all ports open\n  protocol    = "tcp"\n  cidr_blocks = ["0.0.0.0/0"]\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_security_group_all_ports', config.severityRules);
      const findings: Finding[] = [];
      const FROM_PORT_ZERO_RE = /from_port\s*=\s*0\b/;
      const TO_PORT_ALL_RE = /to_port\s*=\s*(?:65535|0)\b/;
      const WINDOW = 10;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!FROM_PORT_ZERO_RE.test(lines[i]!)) continue;
          const start = Math.max(0, i - WINDOW);
          const end = Math.min(lines.length, i + WINDOW + 1);
          const window = lines.slice(start, end).join('\n');
          if (TO_PORT_ALL_RE.test(window)) {
            findings.push({
              severity: sev, category: 'tf_security_group_all_ports', file: path, line: i + 1,
              message: 'Security group rule opens all ports (from_port = 0, to_port = 65535) — entire port range exposed.',
              suggestion: 'Restrict to the specific ports your service requires (e.g. 443 for HTTPS only).',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_012: EBS volume without encryption ────────────────────────────────
  {
    id: 'TF_012',
    category: 'tf_unencrypted_ebs',
    description: 'EBS volume declared without encrypted = true — data at rest is unencrypted.',
    severity: 'HIGH',
    tags: ['security', 'terraform', 'aws', 'ebs', 'encryption', 'iac'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Unencrypted EBS volumes can be detached and mounted to another instance or accessed via snapshot sharing, exposing all stored data. EBS encryption has no performance penalty and is free — enable it by default.',
      commonViolations: [
        'resource "aws_ebs_volume" without encrypted = true',
      ],
      goodExample: 'resource "aws_ebs_volume" "example" {\n  availability_zone = "us-east-1a"\n  size              = 40\n  encrypted         = true\n}',
      badExample: 'resource "aws_ebs_volume" "example" {\n  availability_zone = "us-east-1a"\n  size              = 40\n  # HIGH: no encrypted = true\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_unencrypted_ebs', config.severityRules);
      const findings: Finding[] = [];
      const EBS_RESOURCE_RE = /^\s*resource\s+["']aws_ebs_volume["']/;
      const ENCRYPTED_RE = /encrypted\s*=\s*true/;
      const SCAN_LINES = 15;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!EBS_RESOURCE_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + SCAN_LINES);
          const block = lines.slice(i, end).join('\n');
          if (!ENCRYPTED_RE.test(block)) {
            findings.push({
              severity: sev, category: 'tf_unencrypted_ebs', file: path, line: i + 1,
              message: 'EBS volume declared without encrypted = true — data at rest is unencrypted.',
              suggestion: 'Add encrypted = true to the aws_ebs_volume resource.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_013: IAM policy with wildcard resource on sensitive actions ─────────
  {
    id: 'TF_013',
    category: 'tf_iam_sensitive_wildcard_resource',
    description: 'IAM policy grants sensitive actions with `"Resource": "*"` — overly permissive.',
    severity: 'BLOCKER',
    tags: ['security', 'terraform', 'aws', 'iam', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Granting actions like s3:DeleteObject, ec2:TerminateInstances, iam:AttachRolePolicy, or secretsmanager:GetSecretValue on Resource: "*" means the principal can act on every resource in the account, not just the intended one. This enables privilege escalation and data exfiltration if the principal is compromised.',
      commonViolations: ['actions = ["s3:*", "ec2:*"]\nresources = ["*"]', 'actions = ["iam:*"]\nresources = ["*"]'],
      goodExample: 'actions   = ["s3:GetObject", "s3:PutObject"]\nresources = ["arn:aws:s3:::my-bucket/*"]',
      badExample: 'actions   = ["s3:*"]\nresources = ["*"]  # ❌ wildcard resource on admin actions',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_iam_sensitive_wildcard_resource', config.severityRules);
      const findings: Finding[] = [];
      const SENSITIVE_ACTIONS = /(?:iam:|s3:Delete|ec2:Terminate|secretsmanager:|kms:Decrypt|sts:AssumeRole)/;
      const WILDCARD_RESOURCE = /resources\s*=\s*\[\s*"\*"\s*\]/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!WILDCARD_RESOURCE.test(lines[i]!)) continue;
          const surrounding = lines.slice(Math.max(0, i - 8), i + 3).join('\n');
          if (SENSITIVE_ACTIONS.test(surrounding)) {
            findings.push({
              severity: sev, category: 'tf_iam_sensitive_wildcard_resource', file: path, line: i + 1,
              message: 'IAM policy grants sensitive actions on Resource: "*" — scope to specific ARNs.',
              suggestion: 'Replace "*" with specific ARNs: resources = ["arn:aws:s3:::my-bucket/*"]',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_014: Security group with 0.0.0.0/0 on non-HTTP ports ──────────────
  {
    id: 'TF_014',
    category: 'tf_sg_open_ingress',
    description: 'Security group allows ingress from `0.0.0.0/0` on a non-HTTP/HTTPS port.',
    severity: 'BLOCKER',
    tags: ['security', 'terraform', 'aws', 'network', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Inbound rules allowing traffic from 0.0.0.0/0 (the entire internet) on ports other than 80/443 expose services like SSH (22), RDP (3389), databases (3306, 5432, 6379), and admin panels to the public internet. These are primary entry points for automated attacks and brute force.',
      commonViolations: ['from_port = 22  cidr_blocks = ["0.0.0.0/0"]', 'from_port = 3306  cidr_blocks = ["0.0.0.0/0"]'],
      goodExample: 'cidr_blocks = ["10.0.0.0/8"]  # private CIDR only',
      badExample: 'from_port   = 22\ncidr_blocks = ["0.0.0.0/0"]  # ❌ SSH open to internet',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_sg_open_ingress', config.severityRules);
      const findings: Finding[] = [];
      const OPEN_CIDR = /cidr_blocks\s*=\s*\[?\s*["']0\.0\.0\.0\/0["']/;
      const HTTP_PORT = /from_port\s*=\s*(?:80|443|0)\b/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!OPEN_CIDR.test(lines[i]!)) continue;
          const surrounding = lines.slice(Math.max(0, i - 5), i + 3).join('\n');
          if (!HTTP_PORT.test(surrounding) && /ingress|from_port/.test(surrounding)) {
            findings.push({
              severity: sev, category: 'tf_sg_open_ingress', file: path, line: i + 1,
              message: 'Security group allows ingress from 0.0.0.0/0 on non-HTTP port — exposes service to the internet.',
              suggestion: 'Restrict cidr_blocks to known IP ranges or VPC CIDR: cidr_blocks = [aws_vpc.main.cidr_block]',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_015: Missing Terraform backend configuration ───────────────────────
  {
    id: 'TF_015',
    category: 'tf_no_backend',
    description: 'No `terraform { backend }` block — state is stored locally and not shared with the team.',
    severity: 'HIGH',
    tags: ['terraform', 'iac', 'collaboration'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Without a remote backend (S3, Terraform Cloud, GCS), state is stored in a local terraform.tfstate file. Local state cannot be shared with teammates, has no locking (concurrent applies corrupt state), and is lost if the machine is destroyed.',
      commonViolations: ['terraform { required_providers { ... } } — no backend block'],
      goodExample: 'terraform {\n  backend "s3" {\n    bucket         = "my-tf-state"\n    key            = "prod/terraform.tfstate"\n    region         = "us-east-1"\n    dynamodb_table = "terraform-locks"\n    encrypt        = true\n  }\n}',
      badExample: 'terraform {\n  required_version = ">= 1.0"\n  # ❌ no backend — local state only\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_no_backend', config.severityRules);
      const findings: Finding[] = [];
      const TF_BLOCK = /^\s*terraform\s*\{/;
      const HAS_BACKEND = /\bbackend\s+["']\w+["']\s*\{/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path) || path.includes('module')) continue;
        if (!TF_BLOCK.test(content)) continue;
        if (HAS_BACKEND.test(content)) continue;
        const line = content.split('\n').findIndex((l) => TF_BLOCK.test(l));
        findings.push({
          severity: sev, category: 'tf_no_backend', file: path, line: line >= 0 ? line + 1 : undefined,
          message: 'No remote backend configured — Terraform state is local only, preventing team collaboration and state locking.',
          suggestion: 'Add a backend block: backend "s3" { bucket = "..." key = "..." region = "..." dynamodb_table = "..." encrypt = true }',
        });
      }
      return findings;
    },
  },

  // ── TF_016: Sensitive variable without sensitive = true ───────────────────
  {
    id: 'TF_016',
    category: 'tf_sensitive_var_not_marked',
    description: 'Variable with a sensitive name (password, secret, token, key) not marked `sensitive = true`.',
    severity: 'HIGH',
    tags: ['security', 'terraform', 'secrets', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Terraform logs variable values in plan output and state files. Variables containing credentials must be marked sensitive = true to redact them from logs, plan output, and the state JSON. Without this, secrets appear in plain text in CI logs and terraform.tfstate.',
      commonViolations: ['variable "db_password" {}', 'variable "api_secret_key" { type = string }'],
      goodExample: 'variable "db_password" {\n  type      = string\n  sensitive = true\n}',
      badExample: 'variable "db_password" {\n  type = string\n  # ❌ missing sensitive = true\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_sensitive_var_not_marked', config.severityRules);
      const findings: Finding[] = [];
      const SENSITIVE_VAR = /^\s*variable\s+["'](?:[^"']*(?:password|secret|token|key|credential|private)[^"']*)["']/i;
      const HAS_SENSITIVE = /sensitive\s*=\s*true/;
      const SCAN_LINES = 10;
      for (const { path, content } of changedFiles) {
        if (!isTerraformOrVars(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!SENSITIVE_VAR.test(lines[i]!)) continue;
          const block = lines.slice(i, Math.min(lines.length, i + SCAN_LINES)).join('\n');
          if (!HAS_SENSITIVE.test(block)) {
            findings.push({
              severity: sev, category: 'tf_sensitive_var_not_marked', file: path, line: i + 1,
              message: 'Variable with sensitive name lacks `sensitive = true` — value will appear in plan output and state files.',
              suggestion: 'Add sensitive = true to the variable block.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_017: Missing provider version constraint ────────────────────────────
  {
    id: 'TF_017',
    category: 'tf_unpinned_provider',
    description: '`required_providers` missing version constraint — provider may update with breaking changes.',
    severity: 'MEDIUM',
    tags: ['terraform', 'iac', 'reproducibility'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Without a version constraint, terraform init installs the latest provider version each run. Provider major versions often contain breaking changes. Pinning ensures reproducible infrastructure across environments and prevents surprise breakage in CI.',
      commonViolations: ['required_providers { aws = { source = "hashicorp/aws" } }'],
      goodExample: 'required_providers {\n  aws = {\n    source  = "hashicorp/aws"\n    version = "~> 5.0"\n  }\n}',
      badExample: 'required_providers {\n  aws = {\n    source = "hashicorp/aws"\n    # ❌ no version constraint\n  }\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_unpinned_provider', config.severityRules);
      const findings: Finding[] = [];
      const PROVIDER_SOURCE = /source\s*=\s*["']\w+\/\w+["']/;
      const HAS_VERSION = /version\s*=/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        if (!/required_providers/.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!PROVIDER_SOURCE.test(lines[i]!)) continue;
          const surrounding = lines.slice(Math.max(0, i - 1), i + 4).join('\n');
          if (!HAS_VERSION.test(surrounding)) {
            findings.push({
              severity: sev, category: 'tf_unpinned_provider', file: path, line: i + 1,
              message: 'Provider has no version constraint — add a version pin to prevent unexpected breaking changes.',
              suggestion: 'Add version = "~> 5.0" to the provider block.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_018: RDS instance without deletion protection ─────────────────────
  {
    id: 'TF_018',
    category: 'tf_rds_no_deletion_protection',
    description: 'RDS instance missing `deletion_protection = true` — can be permanently deleted by terraform destroy.',
    severity: 'HIGH',
    tags: ['security', 'terraform', 'aws', 'rds', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Without deletion protection, a mistaken terraform destroy or automated pipeline can permanently delete a production database in seconds. deletion_protection = true requires the protection to be explicitly disabled before the resource can be deleted, adding a safety gate.',
      commonViolations: ['resource "aws_db_instance" "main" { engine = "postgres" }'],
      goodExample: 'resource "aws_db_instance" "main" {\n  deletion_protection = true\n  skip_final_snapshot = false\n}',
      badExample: 'resource "aws_db_instance" "main" {\n  engine = "postgres"\n  # ❌ no deletion_protection\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_rds_no_deletion_protection', config.severityRules);
      const findings: Finding[] = [];
      const RDS_RESOURCE = /resource\s+["']aws_db_instance["']/;
      const DELETION_PROTECTION = /deletion_protection\s*=\s*true/;
      const SCAN_LINES = 40;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!RDS_RESOURCE.test(lines[i]!)) continue;
          const block = lines.slice(i, Math.min(lines.length, i + SCAN_LINES)).join('\n');
          if (!DELETION_PROTECTION.test(block)) {
            findings.push({
              severity: sev, category: 'tf_rds_no_deletion_protection', file: path, line: i + 1,
              message: 'RDS instance missing deletion_protection — can be destroyed accidentally or by CI pipelines.',
              suggestion: 'Add deletion_protection = true and skip_final_snapshot = false to the aws_db_instance resource.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_019: Lambda without reserved concurrency ───────────────────────────
  {
    id: 'TF_019',
    category: 'tf_lambda_no_reserved_concurrency',
    description: 'Lambda function without `reserved_concurrent_executions` — can consume all account concurrency.',
    severity: 'MEDIUM',
    tags: ['terraform', 'aws', 'lambda', 'iac', 'reliability'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'By default, a single Lambda function can scale to the account-level concurrency limit (1,000 by default), starving all other functions. Setting reserved_concurrent_executions caps the function and ensures other critical functions retain capacity during traffic spikes.',
      commonViolations: ['resource "aws_lambda_function" "api" { ... }'],
      goodExample: 'resource "aws_lambda_function" "api" {\n  reserved_concurrent_executions = 100\n}',
      badExample: 'resource "aws_lambda_function" "api" {\n  # ❌ no reserved_concurrent_executions\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_lambda_no_reserved_concurrency', config.severityRules);
      const findings: Finding[] = [];
      const LAMBDA_RESOURCE = /resource\s+["']aws_lambda_function["']/;
      const CONCURRENCY = /reserved_concurrent_executions\s*=/;
      const SCAN_LINES = 30;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!LAMBDA_RESOURCE.test(lines[i]!)) continue;
          const block = lines.slice(i, Math.min(lines.length, i + SCAN_LINES)).join('\n');
          if (!CONCURRENCY.test(block)) {
            findings.push({
              severity: sev, category: 'tf_lambda_no_reserved_concurrency', file: path, line: i + 1,
              message: 'Lambda function has no reserved concurrency — can consume the entire account concurrency limit.',
              suggestion: 'Add reserved_concurrent_executions = 100 (adjust to your traffic needs).',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_020: DynamoDB without point-in-time recovery ──────────────────────
  {
    id: 'TF_020',
    category: 'tf_dynamodb_no_pitr',
    description: 'DynamoDB table missing Point-In-Time Recovery (PITR) — data loss risk.',
    severity: 'HIGH',
    tags: ['terraform', 'aws', 'dynamodb', 'backup', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Without PITR, accidental bulk deletes or application bugs that corrupt data cannot be recovered beyond the last manual backup. PITR provides continuous backups for the last 35 days with second-level granularity at minimal additional cost.',
      commonViolations: ['resource "aws_dynamodb_table" "main" { ... }'],
      goodExample: 'point_in_time_recovery {\n  enabled = true\n}',
      badExample: 'resource "aws_dynamodb_table" "main" {\n  name = "users"\n  # ❌ no point_in_time_recovery block\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_dynamodb_no_pitr', config.severityRules);
      const findings: Finding[] = [];
      const DYNAMO_RESOURCE = /resource\s+["']aws_dynamodb_table["']/;
      const HAS_PITR = /point_in_time_recovery/;
      const SCAN_LINES = 35;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!DYNAMO_RESOURCE.test(lines[i]!)) continue;
          const block = lines.slice(i, Math.min(lines.length, i + SCAN_LINES)).join('\n');
          if (!HAS_PITR.test(block)) {
            findings.push({
              severity: sev, category: 'tf_dynamodb_no_pitr', file: path, line: i + 1,
              message: 'DynamoDB table missing Point-In-Time Recovery — enable PITR to recover from accidental data loss.',
              suggestion: 'Add: point_in_time_recovery { enabled = true }',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_021: KMS key without key rotation ──────────────────────────────────
  {
    id: 'TF_021',
    category: 'tf_kms_no_rotation',
    description: 'KMS key missing `enable_key_rotation = true` — cryptographic key is never rotated.',
    severity: 'MEDIUM',
    tags: ['security', 'terraform', 'aws', 'kms', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Long-lived KMS keys increase the blast radius of a key compromise. Automatic annual rotation reduces this risk at no operational cost. AWS rotates the backing key material while keeping the key ID stable — no re-encryption of existing data is required.',
      commonViolations: ['resource "aws_kms_key" "main" { description = "My key" }'],
      goodExample: 'resource "aws_kms_key" "main" {\n  description             = "My key"\n  enable_key_rotation     = true\n}',
      badExample: 'resource "aws_kms_key" "main" {\n  description = "My key"\n  # ❌ no key rotation\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_kms_no_rotation', config.severityRules);
      const findings: Finding[] = [];
      const KMS_RESOURCE = /resource\s+["']aws_kms_key["']/;
      const HAS_ROTATION = /enable_key_rotation\s*=\s*true/;
      const SCAN_LINES = 20;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!KMS_RESOURCE.test(lines[i]!)) continue;
          const block = lines.slice(i, Math.min(lines.length, i + SCAN_LINES)).join('\n');
          if (!HAS_ROTATION.test(block)) {
            findings.push({
              severity: sev, category: 'tf_kms_no_rotation', file: path, line: i + 1,
              message: 'KMS key missing automatic rotation — add enable_key_rotation = true.',
              suggestion: 'Add enable_key_rotation = true to the aws_kms_key resource.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_022: Secret in user_data / cloud-init ──────────────────────────────
  {
    id: 'TF_022',
    category: 'tf_secret_in_user_data',
    description: 'Hardcoded secret or token in EC2 `user_data` — visible in AWS console and instance metadata.',
    severity: 'BLOCKER',
    tags: ['security', 'terraform', 'aws', 'secrets', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'user_data content is visible to anyone with ec2:DescribeInstanceAttribute permissions and is accessible from within the instance via the metadata service (http://169.254.169.254). Secrets embedded here are stored unencrypted in AWS and in your Terraform state.',
      commonViolations: ['user_data = "#!/bin/bash\\nexport API_KEY=sk-abc123\\n"'],
      goodExample: 'user_data = templatefile("init.sh.tpl", {})\n# Inject secrets via AWS Secrets Manager or SSM Parameter Store at runtime',
      badExample: 'user_data = "#!/bin/bash\\nexport SECRET_KEY=abc123"  # ❌ secret in user_data',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_secret_in_user_data', config.severityRules);
      const findings: Finding[] = [];
      const USER_DATA_SECRET = /user_data\s*=\s*["'](?:[^"']*(?:password|secret|token|api[_-]?key|AWS_SECRET)[^"']*)["']/i;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (USER_DATA_SECRET.test(line)) {
            findings.push({
              severity: sev, category: 'tf_secret_in_user_data', file: path, line: i + 1,
              message: 'Secret or credential found in user_data — visible in AWS console and instance metadata service.',
              suggestion: 'Use AWS Secrets Manager or SSM Parameter Store and retrieve secrets at runtime inside the instance.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── TF_023: Missing lifecycle prevent_destroy on stateful resources ────────
  {
    id: 'TF_023',
    category: 'tf_no_prevent_destroy',
    description: 'Stateful resource (RDS, S3, DynamoDB) missing `lifecycle { prevent_destroy = true }`.',
    severity: 'HIGH',
    tags: ['terraform', 'aws', 'iac', 'reliability'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Stateful resources like databases and S3 buckets contain irreplaceable data. Adding lifecycle { prevent_destroy = true } makes terraform plan error if the resource would be destroyed, preventing accidental data loss from refactoring, resource renaming, or CI pipelines.',
      commonViolations: ['resource "aws_s3_bucket" "main" { bucket = "prod-data" }'],
      goodExample: 'resource "aws_rds_cluster" "main" {\n  lifecycle {\n    prevent_destroy = true\n  }\n}',
      badExample: 'resource "aws_rds_cluster" "main" {\n  # ❌ no prevent_destroy\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_no_prevent_destroy', config.severityRules);
      const findings: Finding[] = [];
      const STATEFUL_RESOURCE = /resource\s+["'](?:aws_db_instance|aws_rds_cluster|aws_s3_bucket|aws_dynamodb_table|aws_elasticsearch_domain|aws_opensearch_domain)["']/;
      const PREVENT_DESTROY = /prevent_destroy\s*=\s*true/;
      const SCAN_LINES = 50;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!STATEFUL_RESOURCE.test(lines[i]!)) continue;
          const block = lines.slice(i, Math.min(lines.length, i + SCAN_LINES)).join('\n');
          if (!PREVENT_DESTROY.test(block)) {
            findings.push({
              severity: sev, category: 'tf_no_prevent_destroy', file: path, line: i + 1,
              message: 'Stateful resource missing lifecycle prevent_destroy — can be accidentally destroyed by terraform.',
              suggestion: 'Add: lifecycle { prevent_destroy = true }',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── TF_024: EC2 instance with public IP enabled ───────────────────────────
  {
    id: 'TF_024',
    category: 'tf_ec2_public_ip',
    description: 'EC2 instance with `associate_public_ip_address = true` — instance directly reachable from internet.',
    severity: 'HIGH',
    tags: ['security', 'terraform', 'aws', 'ec2', 'network', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Directly assigning a public IP to an EC2 instance bypasses the recommended architecture of private subnets + load balancer + NAT gateway. Instances with public IPs are directly reachable and must rely entirely on security groups and host firewalls for protection.',
      commonViolations: ['associate_public_ip_address = true'],
      goodExample: 'associate_public_ip_address = false\n# Use a load balancer or NAT gateway for outbound access',
      badExample: 'associate_public_ip_address = true  # ❌ instance directly on internet',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_ec2_public_ip', config.severityRules);
      const findings: Finding[] = [];
      const PUBLIC_IP = /associate_public_ip_address\s*=\s*true/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (PUBLIC_IP.test(line) && !/^\s*#/.test(line)) {
            findings.push({
              severity: sev, category: 'tf_ec2_public_ip', file: path, line: i + 1,
              message: 'EC2 instance assigned a public IP — place in a private subnet behind a load balancer instead.',
              suggestion: 'Set associate_public_ip_address = false and use a load balancer or NAT gateway.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── TF_025: S3 bucket without versioning ─────────────────────────────────
  {
    id: 'TF_025',
    category: 'tf_s3_no_versioning',
    description: 'S3 bucket missing versioning configuration — deleted or overwritten objects cannot be recovered.',
    severity: 'MEDIUM',
    tags: ['terraform', 'aws', 's3', 'backup', 'iac'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Without S3 versioning, an accidental `aws s3 rm`, an overwrite, or a bug in your application permanently deletes object data. Versioning retains all versions of every object and supports MFA Delete for additional protection against accidental deletion.',
      commonViolations: ['resource "aws_s3_bucket" "main" { bucket = "app-data" }'],
      goodExample: 'resource "aws_s3_bucket_versioning" "main" {\n  bucket = aws_s3_bucket.main.id\n  versioning_configuration { status = "Enabled" }\n}',
      badExample: 'resource "aws_s3_bucket" "main" {\n  bucket = "app-data"\n  # ❌ no versioning\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('tf_s3_no_versioning', config.severityRules);
      const findings: Finding[] = [];
      const S3_RESOURCE = /resource\s+["']aws_s3_bucket["']\s+["'](\w+)["']/;
      for (const { path, content } of changedFiles) {
        if (!isTerraformFile(path)) continue;
        const bucketNames: string[] = [];
        const lines = content.split('\n');
        lines.forEach((line) => {
          const m = S3_RESOURCE.exec(line);
          if (m) bucketNames.push(m[1]!);
        });
        for (const name of bucketNames) {
          const VERSIONING_BLOCK = new RegExp(`aws_s3_bucket_versioning[\\s\\S]*?${name}`);
          if (!VERSIONING_BLOCK.test(content) && !/versioning_configuration/.test(content)) {
            const line = lines.findIndex((l) => l.includes(`"${name}"`));
            findings.push({
              severity: sev, category: 'tf_s3_no_versioning', file: path, line: line >= 0 ? line + 1 : undefined,
              message: `S3 bucket "${name}" has no versioning — deleted or overwritten objects cannot be recovered.`,
              suggestion: 'Add aws_s3_bucket_versioning resource with status = "Enabled".',
            });
          }
        }
      }
      return findings;
    },
  },
];
