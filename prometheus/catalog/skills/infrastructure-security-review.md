---
id: infrastructure-security-review
name: Infrastructure Security Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - terraform
  - infrastructure
  - security
  - aws
  - iac
enabled: true
---

# Infrastructure Security Review

## Purpose

Audits Terraform and IaC configuration for security misconfigurations, over-permissive IAM policies, open network access, missing encryption at rest, and secrets embedded in infrastructure code. Maps directly to the Terraform ruleset and AWS Well-Architected Security Pillar.

## When to use

- Before any Terraform `apply` to production or staging
- When a PR adds new AWS resources
- Periodic security posture review of existing infrastructure
- After AI-generated Terraform scaffolding review
- Following a security incident to verify the fix closes the right vector

## Required inputs

- Changed `.tf` and `.tfvars` files
- Active Prometheus config with Terraform rule severity settings
- List of affected AWS resource types

## Workflow steps

1. Run `npm run prometheus:review` on all changed Terraform files
2. Check IAM resources for wildcard actions (`"*"`) and wildcard resources (`"*"`)
3. Verify security groups — no `0.0.0.0/0` ingress on ports other than 80/443
4. Scan for plaintext credentials in `*.tf` and `*.tfvars` files
5. Confirm all RDS instances have `deletion_protection = true` and encryption enabled
6. Verify EBS volumes have `encrypted = true`
7. Check EC2 instances for IMDSv1 enabled and public IP associations
8. Confirm S3 buckets have versioning enabled and no public ACLs
9. Verify KMS keys have key rotation enabled
10. Check for secrets in `user_data` / cloud-init scripts
11. Confirm stateful resources have `lifecycle { prevent_destroy = true }`
12. Verify provider versions are pinned and a remote backend is configured

## Prometheus commands

```bash
npm run prometheus:review
```

## Expected output

Findings grouped by risk tier:
- **BLOCKER**: hardcoded credentials, wildcard IAM actions, open security group on SSH/RDP/DB ports, secrets in user_data
- **HIGH**: public RDS, IMDSv1, unencrypted EBS, no deletion protection, wildcard resource on sensitive actions
- **MEDIUM**: no S3 versioning, no DynamoDB PITR, no KMS rotation, missing prevent_destroy, unpinned providers
- **LOW**: no remote backend, Lambda missing reserved concurrency

Each finding includes the exact resource name, file, and line number, plus the specific attribute to change.

## Related agents

- infrastructure-reviewer
- security-reviewer
- devops-reviewer

## Related rule packs

- @prometheus/core
