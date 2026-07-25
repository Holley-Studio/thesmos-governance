// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos certificate:generate — produce a signed governance certificate
 * for the current project delivery.
 *
 * The certificate is a sha256-hashed JSON artifact that records governance
 * state at a point in time. Auditors and clients can verify it without access
 * to source code. Agencies can include it in every delivery package.
 *
 * Usage:
 *   thesmos certificate:generate            print JSON to stdout
 *   thesmos certificate:generate --write    write to .thesmos/certificate.json
 *   thesmos certificate:generate --verify   verify an existing certificate's hash
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { computeHealthForRoot } from '../../health.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import { THESMOS_RULES } from '../../rules/registry.ts';

export interface GovernanceCertificate {
  tool: string;
  version: string;
  project: string;
  timestamp: string;
  rulesChecked: number;
  blockers: number;
  highFindings: number;
  mediumFindings: number;
  totalFindings: number;
  healthScore: number;
  healthGrade: string;
  hash: string;
  chain: string;
}

function sha256(input: string): string {
  return 'sha256:' + createHash('sha256').update(input).digest('hex');
}

function buildCertificate(
  project: string,
  version: string,
  blockers: number,
  highFindings: number,
  mediumFindings: number,
  totalFindings: number,
  healthScore: number,
  healthGrade: string,
  prevHash: string,
  timestamp: string,
): GovernanceCertificate {
  const stable = JSON.stringify({
    project,
    timestamp,
    rulesChecked: THESMOS_RULES.length,
    blockers,
    highFindings,
    mediumFindings,
    totalFindings,
    healthScore,
    healthGrade,
  });

  return {
    tool: 'thesmos-governance',
    version,
    project,
    timestamp,
    rulesChecked: THESMOS_RULES.length,
    blockers,
    highFindings,
    mediumFindings,
    totalFindings,
    healthScore,
    healthGrade,
    hash: sha256(stable),
    chain: sha256(prevHash + stable),
  };
}

export async function cmdCertificate(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const write = flag(flags, 'write');
  const verify = flag(flags, 'verify');

  if (verify) {
    const certPath = join(root, '.thesmos', 'certificate.json');
    if (!existsSync(certPath)) {
      process.stderr.write('certificate:generate: no certificate found at .thesmos/certificate.json\n');
      process.exit(1);
    }
    const cert: GovernanceCertificate = JSON.parse(readFileSync(certPath, 'utf8'));
    const stable = JSON.stringify({
      project: cert.project,
      timestamp: cert.timestamp,
      rulesChecked: cert.rulesChecked,
      blockers: cert.blockers,
      highFindings: cert.highFindings,
      mediumFindings: cert.mediumFindings,
      totalFindings: cert.totalFindings,
      healthScore: cert.healthScore,
      healthGrade: cert.healthGrade,
    });
    const expected = sha256(stable);
    if (cert.hash === expected) {
      process.stdout.write(`Certificate hash valid: ${cert.hash}\n`);
      process.stdout.write(`Project: ${cert.project}  Score: ${cert.healthScore}  Grade: ${cert.healthGrade}  Issued: ${cert.timestamp}\n`);
    } else {
      process.stderr.write(`Certificate tampered or corrupted!\n`);
      process.stderr.write(`  Stored:   ${cert.hash}\n`);
      process.stderr.write(`  Computed: ${expected}\n`);
      process.exit(1);
    }
    return;
  }

  // Read previous cert hash for chain continuity
  const certPath = join(root, '.thesmos', 'certificate.json');
  let prevHash = '';
  if (existsSync(certPath)) {
    try {
      const prev: GovernanceCertificate = JSON.parse(readFileSync(certPath, 'utf8'));
      prevHash = prev.hash;
    } catch { /* first certificate — chain starts fresh */ }
  }

  const scan = loadReport(root);
  const findings = scan ? runReview({ scan, config }).findings : [];
  const health = computeHealthForRoot(root, config);

  const blockers = findings.filter((f) => f.severity === 'BLOCKER').length;
  const highFindings = findings.filter((f) => f.severity === 'HIGH').length;
  const mediumFindings = findings.filter((f) => f.severity === 'MEDIUM').length;

  // Read version from thesmos package.json
  let version = '1.0.0';
  try {
    const pkgPath = new URL('../../../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    version = pkg.version ?? version;
  } catch { /* use fallback */ }

  const cert = buildCertificate(
    config.project ?? 'unknown',
    version,
    blockers,
    highFindings,
    mediumFindings,
    findings.length,
    health.score,
    health.grade,
    prevHash,
    new Date().toISOString(),
  );

  const json = JSON.stringify(cert, null, 2) + '\n';

  if (write) {
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(certPath, json);
    process.stdout.write(`Wrote ${certPath}\n`);
    process.stdout.write(`Hash: ${cert.hash}\n`);
    process.stdout.write(`Score: ${cert.healthScore} / 100  Grade: ${cert.healthGrade}  Blockers: ${cert.blockers}\n`);
  } else {
    process.stdout.write(json);
  }
}
