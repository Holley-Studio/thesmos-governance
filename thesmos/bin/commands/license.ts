// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos license — manage Thesmos Pro/Team/Enterprise licenses
 *
 * Usage:
 *   thesmos license:activate <key>   Activate a license key
 *   thesmos license:status           Show current license info
 *   thesmos license:deactivate       Remove license (reverts to community)
 */

import {
  activateLicense,
  deactivateLicense,
  getLicenseInfo,
  hasTier,
} from '../../license.ts';
import { parseArgs } from '../lib/args.ts';

// ── activate ──────────────────────────────────────────────────────────────────

async function cmdLicenseActivate(argv: string[]): Promise<void> {
  const { positionals } = parseArgs(argv);
  const key = positionals[0];

  if (!key) {
    process.stderr.write('Usage: thesmos license:activate <key>\n');
    process.exit(1);
  }

  process.stdout.write('\n  Validating license key...\n');
  const result = await activateLicense(key);

  if (!result.success) {
    process.stderr.write(`\n  ✗ Activation failed: ${result.error}\n\n`);
    process.exit(1);
  }

  const tier = result.tier ?? 'community';
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const expiry = result.expiresAt
    ? `  Expires     : ${new Date(result.expiresAt).toLocaleDateString()}`
    : '  Renewal     : Managed via billing portal';

  console.log(`
  ✓ Thesmos ${tierLabel} activated!

  Account     : ${result.email ?? '—'}
  Tier        : ${tierLabel}
  Seats       : ${result.seats ?? 1}
${expiry}

  All ${tierLabel} features are now enabled.
  Run: thesmos license:status  to confirm.
`);
}

// ── status ────────────────────────────────────────────────────────────────────

function cmdLicenseStatus(): void {
  const info = getLicenseInfo();
  const tierLabel = info.tier.charAt(0).toUpperCase() + info.tier.slice(1);

  if (info.tier === 'community') {
    console.log(`
── Thesmos License Status ────────────────────────────────────────

  Tier        : Community (Free)
  License key : Not activated

  Community includes:
    ✓ Core CLI (scan, fix, validate, health, deps:audit)
    ✓ 500 core governance rules
    ✓ 10 core Pantheon agents
    ✓ GitHub PR Review (summary comment only)
    ✓ Community support

  Upgrade to Pro ($29/month) to unlock:
    → All 1,075+ rules
    → All 54 Pantheon + Specialty agents
    → Inline PR review comments + SARIF export
    → VS Code diagnostics + Fix button
    → secrets:vault, profile memory

  thesmos license:activate <key>
  Buy at: https://holleystudios.com/thesmos

`);
    return;
  }

  const expLine = info.expiresAt
    ? `  Expires     : ${new Date(info.expiresAt).toLocaleDateString()}`
    : '  Renewal     : Managed via billing portal';
  const validLine = info.validatedAt
    ? `  Last check  : ${new Date(info.validatedAt).toLocaleString()}${info.offline ? ' (offline — will re-validate)' : ''}`
    : '  Last check  : Not validated yet';

  const hasTeam = hasTier('team');
  const hasEnterprise = hasTier('enterprise');

  const features = [
    '  ✓ All 1,075+ governance rules',
    '  ✓ All 54 Pantheon + Specialty agents',
    '  ✓ Inline PR review comments + SARIF export',
    '  ✓ VS Code diagnostics + Fix button',
    '  ✓ secrets:vault + profile memory',
  ];

  if (hasTeam) {
    features.push(
      '  ✓ Agent Teams (pantheon:team)',
      '  ✓ pantheon:council multi-agent',
      '  ✓ Shared team governance baseline',
      '  ✓ PR trend tracking + Slack notifications',
    );
  }

  if (hasEnterprise) {
    features.push(
      '  ✓ SSO (SAML, Okta)',
      '  ✓ EU AI Act compliance export',
      '  ✓ Custom rule packs + private MCP',
      '  ✓ Dedicated CSM + SLA',
    );
  }

  console.log(`
── Thesmos License Status ────────────────────────────────────────

  Tier        : ${tierLabel}
  Account     : ${info.email ?? '—'}
  Seats       : ${info.seats}
${expLine}
${validLine}

  Active features:
${features.join('\n')}

  Manage your license: https://holleystudios.com/thesmos/billing

`);
}

// ── deactivate ────────────────────────────────────────────────────────────────

function cmdLicenseDeactivate(): void {
  deactivateLicense();
  console.log(`
  License removed. Thesmos is now running in Community mode.

  To reactivate: thesmos license:activate <key>
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdLicense(subcommand: string, argv: string[]): Promise<void> {
  switch (subcommand) {
    case 'activate':
      return cmdLicenseActivate(argv);
    case 'status':
      cmdLicenseStatus();
      return;
    case 'deactivate':
      cmdLicenseDeactivate();
      return;
    default:
      process.stderr.write(`Unknown license subcommand: ${subcommand}\n`);
      process.stderr.write('Available: activate, status, deactivate\n');
      process.exit(1);
  }
}
