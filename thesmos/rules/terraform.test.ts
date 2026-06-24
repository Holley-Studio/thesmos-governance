import { describe, it, expect } from 'vitest';
import { TERRAFORM_RULES } from './terraform';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function rule(id: string) {
  const r = TERRAFORM_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(id: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(id).detect(input);
}

// ── TF_001 — S3 bucket with public ACL ───────────────────────────────────────

describe('TF_001 — S3 bucket with public ACL', () => {
  it('fires on acl = "public-read" inside aws_s3_bucket', () => {
    const findings = detect('TF_001', [
      {
        path: 'infra/main.tf',
        content: [
          'resource "aws_s3_bucket" "example" {',
          '  bucket = "my-bucket"',
          '  acl    = "public-read"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_s3_public_acl');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on acl = "public-read-write"', () => {
    const findings = detect('TF_001', [
      {
        path: 'infra/main.tf',
        content: [
          'resource "aws_s3_bucket" "uploads" {',
          '  bucket = "my-uploads"',
          '  acl    = "public-read-write"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_s3_public_acl');
  });

  it('does not fire on acl = "private"', () => {
    const findings = detect('TF_001', [
      {
        path: 'infra/main.tf',
        content: [
          'resource "aws_s3_bucket" "example" {',
          '  bucket = "my-bucket"',
          '  acl    = "private"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Terraform files', () => {
    const findings = detect('TF_001', [
      {
        path: 'README.md',
        content: 'acl = "public-read"',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_002 — Security group open to 0.0.0.0/0 on sensitive ports ──────────────

describe('TF_002 — Security group ingress open to 0.0.0.0/0 on sensitive ports', () => {
  it('fires on 0.0.0.0/0 with SSH port 22', () => {
    const findings = detect('TF_002', [
      {
        path: 'infra/sg.tf',
        content: [
          'resource "aws_security_group" "example" {',
          '  ingress {',
          '    from_port   = 22',
          '    to_port     = 22',
          '    protocol    = "tcp"',
          '    cidr_blocks = ["0.0.0.0/0"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_sg_open_to_world');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on 0.0.0.0/0 with MySQL port 3306', () => {
    const findings = detect('TF_002', [
      {
        path: 'infra/sg.tf',
        content: [
          'resource "aws_security_group" "db" {',
          '  ingress {',
          '    from_port   = 3306',
          '    to_port     = 3306',
          '    protocol    = "tcp"',
          '    cidr_blocks = ["0.0.0.0/0"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when CIDR is restricted', () => {
    const findings = detect('TF_002', [
      {
        path: 'infra/sg.tf',
        content: [
          'resource "aws_security_group" "example" {',
          '  ingress {',
          '    from_port   = 22',
          '    to_port     = 22',
          '    protocol    = "tcp"',
          '    cidr_blocks = ["10.0.0.0/8"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on 0.0.0.0/0 for port 443 (not a sensitive port)', () => {
    const findings = detect('TF_002', [
      {
        path: 'infra/sg.tf',
        content: [
          'resource "aws_security_group" "web" {',
          '  ingress {',
          '    from_port   = 443',
          '    to_port     = 443',
          '    protocol    = "tcp"',
          '    cidr_blocks = ["0.0.0.0/0"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_003 — RDS publicly_accessible = true ───────────────────────────────────

describe('TF_003 — RDS instance with publicly_accessible = true', () => {
  it('fires on publicly_accessible = true', () => {
    const findings = detect('TF_003', [
      {
        path: 'infra/rds.tf',
        content: [
          'resource "aws_db_instance" "example" {',
          '  engine               = "mysql"',
          '  instance_class       = "db.t3.micro"',
          '  publicly_accessible  = true',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_rds_publicly_accessible');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire on publicly_accessible = false', () => {
    const findings = detect('TF_003', [
      {
        path: 'infra/rds.tf',
        content: [
          'resource "aws_db_instance" "example" {',
          '  engine              = "mysql"',
          '  instance_class      = "db.t3.micro"',
          '  publicly_accessible = false',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when publicly_accessible is absent', () => {
    const findings = detect('TF_003', [
      {
        path: 'infra/rds.tf',
        content: [
          'resource "aws_db_instance" "example" {',
          '  engine         = "mysql"',
          '  instance_class = "db.t3.micro"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_004 — RDS without storage encryption ───────────────────────────────────

describe('TF_004 — RDS instance without storage encryption', () => {
  it('fires on aws_db_instance without storage_encrypted', () => {
    const findings = detect('TF_004', [
      {
        path: 'infra/rds.tf',
        content: [
          'resource "aws_db_instance" "example" {',
          '  engine         = "mysql"',
          '  instance_class = "db.t3.micro"',
          '  username       = "admin"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_rds_no_encryption');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire when storage_encrypted = true is present', () => {
    const findings = detect('TF_004', [
      {
        path: 'infra/rds.tf',
        content: [
          'resource "aws_db_instance" "example" {',
          '  engine            = "mysql"',
          '  instance_class    = "db.t3.micro"',
          '  storage_encrypted = true',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('fires on aws_rds_cluster without storage_encrypted', () => {
    const findings = detect('TF_004', [
      {
        path: 'infra/aurora.tf',
        content: [
          'resource "aws_rds_cluster" "example" {',
          '  cluster_identifier = "aurora-cluster"',
          '  engine             = "aurora-mysql"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });
});

// ── TF_005 — IAM wildcard action ──────────────────────────────────────────────

describe('TF_005 — IAM policy with wildcard action ("*")', () => {
  it('fires on actions = ["*"]', () => {
    const findings = detect('TF_005', [
      {
        path: 'infra/iam.tf',
        content: [
          'data "aws_iam_policy_document" "admin" {',
          '  statement {',
          '    actions   = ["*"]',
          '    resources = ["*"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_iam_wildcard_action');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on JSON-style "Action": "*" in heredoc', () => {
    const findings = detect('TF_005', [
      {
        path: 'infra/iam.tf',
        content: '  "Action": "*",',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on specific actions', () => {
    const findings = detect('TF_005', [
      {
        path: 'infra/iam.tf',
        content: [
          'data "aws_iam_policy_document" "s3_read" {',
          '  statement {',
          '    actions   = ["s3:GetObject", "s3:ListBucket"]',
          '    resources = ["arn:aws:s3:::my-bucket/*"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_006 — IAM wildcard resource ───────────────────────────────────────────

describe('TF_006 — IAM policy with wildcard resource', () => {
  it('fires on resources = ["*"]', () => {
    const findings = detect('TF_006', [
      {
        path: 'infra/iam.tf',
        content: [
          'data "aws_iam_policy_document" "example" {',
          '  statement {',
          '    actions   = ["s3:DeleteObject"]',
          '    resources = ["*"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_iam_wildcard_resource');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire on specific ARN resources', () => {
    const findings = detect('TF_006', [
      {
        path: 'infra/iam.tf',
        content: [
          'statement {',
          '  actions   = ["s3:GetObject"]',
          '  resources = ["arn:aws:s3:::my-bucket/*"]',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Terraform files', () => {
    const findings = detect('TF_006', [
      {
        path: 'policy.json',
        content: '  resources = ["*"]',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_007 — S3 bucket without versioning ────────────────────────────────────

describe('TF_007 — S3 bucket without versioning enabled', () => {
  it('fires on aws_s3_bucket without versioning block', () => {
    const findings = detect('TF_007', [
      {
        path: 'infra/s3.tf',
        content: [
          'resource "aws_s3_bucket" "example" {',
          '  bucket = "my-bucket"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_s3_no_versioning');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('does not fire when versioning block is present', () => {
    const findings = detect('TF_007', [
      {
        path: 'infra/s3.tf',
        content: [
          'resource "aws_s3_bucket" "example" {',
          '  bucket = "my-bucket"',
          '  versioning {',
          '    enabled = true',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Terraform files', () => {
    const findings = detect('TF_007', [
      {
        path: 'infra/s3.yml',
        content: 'resource "aws_s3_bucket" "example" {\n  bucket = "my-bucket"\n}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_008 — Hardcoded credentials ───────────────────────────────────────────

describe('TF_008 — Hardcoded credentials in Terraform files', () => {
  it('fires on password = "literal_value" in .tf file', () => {
    const findings = detect('TF_008', [
      {
        path: 'infra/rds.tf',
        content: [
          'resource "aws_db_instance" "example" {',
          '  password = "mysupersecret123"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_hardcoded_credentials');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on api_key in .tfvars file', () => {
    const findings = detect('TF_008', [
      {
        path: 'infra/secrets.tfvars',
        content: 'api_key = "sk-abc123xyzabc"',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_hardcoded_credentials');
  });

  it('does not fire on variable references (var.*)', () => {
    const findings = detect('TF_008', [
      {
        path: 'infra/rds.tf',
        content: [
          'resource "aws_db_instance" "example" {',
          '  password = var.db_password',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on comment lines', () => {
    const findings = detect('TF_008', [
      {
        path: 'infra/rds.tf',
        content: '# password = "example_password_here"',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_009 — EC2 without IMDSv2 ──────────────────────────────────────────────

describe('TF_009 — EC2 instance without IMDSv2 enforcement', () => {
  it('fires on aws_instance without metadata_options', () => {
    const findings = detect('TF_009', [
      {
        path: 'infra/ec2.tf',
        content: [
          'resource "aws_instance" "example" {',
          '  ami           = "ami-12345678"',
          '  instance_type = "t3.micro"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_ec2_imds_v1');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('does not fire when http_tokens = "required" is set', () => {
    const findings = detect('TF_009', [
      {
        path: 'infra/ec2.tf',
        content: [
          'resource "aws_instance" "example" {',
          '  ami           = "ami-12345678"',
          '  instance_type = "t3.micro"',
          '  metadata_options {',
          '    http_tokens = "required"',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Terraform files', () => {
    const findings = detect('TF_009', [
      {
        path: 'infra/ec2.yaml',
        content: 'resource "aws_instance" "example" {\n  ami = "ami-12345678"\n}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_010 — CloudWatch log group without retention ──────────────────────────

describe('TF_010 — CloudWatch log group without retention policy', () => {
  it('fires on aws_cloudwatch_log_group without retention_in_days', () => {
    const findings = detect('TF_010', [
      {
        path: 'infra/logging.tf',
        content: [
          'resource "aws_cloudwatch_log_group" "example" {',
          '  name = "/aws/lambda/my-function"',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_log_group_no_retention');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('does not fire when retention_in_days is set', () => {
    const findings = detect('TF_010', [
      {
        path: 'infra/logging.tf',
        content: [
          'resource "aws_cloudwatch_log_group" "example" {',
          '  name              = "/aws/lambda/my-function"',
          '  retention_in_days = 90',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Terraform files', () => {
    const findings = detect('TF_010', [
      {
        path: 'infra/logging.json',
        content: 'resource "aws_cloudwatch_log_group" "example" {\n  name = "test"\n}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_011 — Security group with all ports open ───────────────────────────────

describe('TF_011 — Security group with all ports open (0-65535)', () => {
  it('fires on from_port = 0 and to_port = 65535', () => {
    const findings = detect('TF_011', [
      {
        path: 'infra/sg.tf',
        content: [
          'resource "aws_security_group" "example" {',
          '  ingress {',
          '    from_port   = 0',
          '    to_port     = 65535',
          '    protocol    = "tcp"',
          '    cidr_blocks = ["0.0.0.0/0"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_security_group_all_ports');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on from_port = 0 and to_port = 0 (all traffic)', () => {
    const findings = detect('TF_011', [
      {
        path: 'infra/sg.tf',
        content: [
          'resource "aws_security_group" "example" {',
          '  egress {',
          '    from_port   = 0',
          '    to_port     = 0',
          '    protocol    = "-1"',
          '    cidr_blocks = ["0.0.0.0/0"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on a specific port range', () => {
    const findings = detect('TF_011', [
      {
        path: 'infra/sg.tf',
        content: [
          'resource "aws_security_group" "example" {',
          '  ingress {',
          '    from_port   = 443',
          '    to_port     = 443',
          '    protocol    = "tcp"',
          '    cidr_blocks = ["0.0.0.0/0"]',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── TF_012 — Unencrypted EBS volume ──────────────────────────────────────────

describe('TF_012 — EBS volume without encryption', () => {
  it('fires on aws_ebs_volume without encrypted = true', () => {
    const findings = detect('TF_012', [
      {
        path: 'infra/ebs.tf',
        content: [
          'resource "aws_ebs_volume" "example" {',
          '  availability_zone = "us-east-1a"',
          '  size              = 40',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('tf_unencrypted_ebs');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire when encrypted = true is present', () => {
    const findings = detect('TF_012', [
      {
        path: 'infra/ebs.tf',
        content: [
          'resource "aws_ebs_volume" "example" {',
          '  availability_zone = "us-east-1a"',
          '  size              = 40',
          '  encrypted         = true',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Terraform files', () => {
    const findings = detect('TF_012', [
      {
        path: 'infra/ebs.yml',
        content: 'resource "aws_ebs_volume" "example" {\n  size = 40\n}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});
