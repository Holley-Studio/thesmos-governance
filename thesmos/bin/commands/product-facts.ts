// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos product-facts:generate | :check | :lint
 *
 * Exit codes: 0 clean · 1 drift/findings · 2 coverage or invariant failure
 *
 * Exit 2 outranks exit 1: a check that cannot prove what it read has no
 * standing to report a pass OR a finding.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs, flag } from '../lib/args.ts';
import { loadProductFacts, productFactsAreFresh } from '../../product-facts.ts';
import { computePopulationsForRoot, checkPopulationInvariants } from '../../agent-populations.ts';
import {
  FACT_EXCLUSIONS,
  FACT_SURFACES,
  formatFactFindings,
  lintFactContent,
  readSafe,
  type ProductFactFinding,
} from '../../product-facts-lint.ts';
import {
  buildCoverageReport,
  formatCoverage,
  trackedEligibleFiles,
} from '../../lint-coverage.ts';

function roots(): { repoRoot: string; pkgRoot: string } {
  const cwd = process.cwd();
  return cwd.endsWith('thesmos')
    ? { repoRoot: join(cwd, '..'), pkgRoot: cwd }
    : { repoRoot: cwd, pkgRoot: join(cwd, 'thesmos') };
}

export async function cmdProductFacts(argv: string[]): Promise<void> {
  const [mode = 'check', ...rest] = argv;
  const { flags } = parseArgs(rest);
  const json = flag(flags, 'json');
  const { repoRoot, pkgRoot } = roots();

  if (mode === 'generate') {
    execFileSync('npx', ['tsx', join(pkgRoot, 'scripts', 'generate-product-facts.ts')], {
      cwd: pkgRoot,
      stdio: 'inherit',
    });
    return;
  }

  if (mode === 'check') {
    const problems = checkPopulationInvariants(computePopulationsForRoot(pkgRoot));
    if (problems.length > 0) {
      console.error(`product-facts:check: population invariants violated:\n  - ${problems.join('\n  - ')}`);
      process.exit(2);
    }
    const r = productFactsAreFresh();
    console.log(r.fresh ? `product-facts:check — OK · ${r.detail}` : `product-facts:check — DRIFT · ${r.detail}`);
    if (!r.fresh) process.exit(1);
    return;
  }

  // ── lint ──────────────────────────────────────────────────────────────────
  const facts = loadProductFacts();
  const extensions = ['.md', '.html', '.txt', '.json'];
  const eligible = trackedEligibleFiles(repoRoot, FACT_SURFACES, extensions);

  const findings: ProductFactFinding[] = [];
  const scannedFiles: string[] = [];
  for (const rel of eligible) {
    if (FACT_EXCLUSIONS.some((e) => rel.includes(e.path))) continue;
    const content = readSafe(repoRoot, rel);
    if (content === null) continue;
    scannedFiles.push(rel);
    findings.push(...lintFactContent(content, rel, facts));
  }

  const coverage = buildCoverageReport({
    lint: 'product-facts:lint',
    repoRoot,
    configuredRoots: FACT_SURFACES,
    extensions,
    exclusions: FACT_EXCLUSIONS,
    scannedFiles,
    findings: findings.length,
  });

  if (json) {
    process.stdout.write(JSON.stringify({ coverage, findings }, null, 2) + '\n');
  } else {
    console.log(formatFactFindings(findings));
    console.log('');
    console.log(formatCoverage(coverage));
  }
  process.exit(coverage.exitCode);
}
