// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * License Compliance Rules — LIC_001–010
 *
 * Pure static analysis on package.json and lockfile content.
 * No network calls, no async operations — fits detect() perfectly.
 *
 * Catches GPL contamination, missing licenses, and SPDX violations
 * that AI code generators routinely introduce when pulling in new dependencies.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── SPDX data ─────────────────────────────────────────────────────────────────

const GPL_IDENTIFIERS = new Set([
  'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-2.0+',
  'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'GPL-3.0+',
  'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'AGPL-3.0+',
  'AGPL-1.0', 'GPL-1.0',
]);

const COPYLEFT_IDENTIFIERS = new Set([
  'LGPL-2.0', 'LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.0+',
  'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-2.1+',
  'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'LGPL-3.0+',
  'MPL-2.0', 'EUPL-1.1', 'EUPL-1.2', 'CDDL-1.0', 'EPL-1.0', 'EPL-2.0',
]);

const PROPRIETARY_IDENTIFIERS = new Set([
  'SEE LICENSE IN', 'Proprietary', 'PROPRIETARY', 'Commercial',
  'LicenseRef-', 'COMMERCIAL',
]);

const PERMISSIVE_IDENTIFIERS = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Unlicense',
  'CC0-1.0', '0BSD', 'BlueOak-1.0.0', 'MIT-0',
]);

// Known non-SPDX strings that npm uses
const INVALID_SPDX = new Set([
  'Public Domain', 'BSD', 'GPL', 'LGPL', 'Apache', 'Apache 2.0',
  'Apache-2', 'GPL2', 'MIT/X11', 'dual', 'custom',
]);

const AI_TRAINING_RE = /no.?ai.?training|non.?commercial|nc\b|cc-by-nc/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function f(
  category: string,
  severity: Finding['severity'],
  message: string,
  suggestion: string,
  file = 'package.json',
): Finding {
  return { severity, file, category, message, suggestion };
}

function isPackageJson(path: string): boolean {
  return path === 'package.json' || path.endsWith('/package.json');
}

function isLockfile(path: string): boolean {
  return path === 'package-lock.json' || path.endsWith('/package-lock.json');
}

function pkgContent(input: DetectInput): string | null {
  if (input.changedFiles !== undefined) {
    return input.changedFiles.find((cf) => isPackageJson(cf.path))?.content ?? null;
  }
  const p = join(process.cwd(), 'package.json');
  try { return existsSync(p) ? readFileSync(p, 'utf8') : null; } catch { return null; }
}

function lockContent(input: DetectInput): string | null {
  if (input.changedFiles !== undefined) {
    return input.changedFiles.find((cf) => isLockfile(cf.path))?.content ?? null;
  }
  const p = join(process.cwd(), 'package-lock.json');
  try { return existsSync(p) ? readFileSync(p, 'utf8') : null; } catch { return null; }
}

function parsePkg(content: string): Record<string, unknown> | null {
  try { return JSON.parse(content) as Record<string, unknown>; } catch { return null; }
}

function parseLock(content: string): Record<string, unknown> | null {
  try { return JSON.parse(content) as Record<string, unknown>; } catch { return null; }
}

function isCommercialProject(pkg: Record<string, unknown>): boolean {
  const license = (pkg.license as string | undefined) ?? '';
  return PERMISSIVE_IDENTIFIERS.has(license) || license === 'UNLICENSED';
}

function extractLockDeps(lock: Record<string, unknown>): Array<{ name: string; license?: string }> {
  const packages = (lock.packages ?? lock.dependencies) as Record<string, { license?: string }> | undefined;
  if (!packages) return [];
  return Object.entries(packages)
    .filter(([key]) => key !== '' && key !== 'node_modules')
    .map(([key, val]) => {
      const name = key.replace(/^node_modules\//, '');
      return { name, license: val.license };
    });
}

// ── Rule: LIC_001 — GPL in commercial project ─────────────────────────────────

const LIC_001: ThesmosRule = {
  id: 'LIC_001',
  category: 'lic_gpl_in_commercial',
  severity: 'BLOCKER',
  description: 'GPL/AGPL dependency found in a project with a commercial or permissive license — copyleft contamination.',
  tags: ['license', 'legal', 'gpl', 'compliance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'GPL and AGPL licenses require derivative works to also be GPL. Using a GPL dependency in commercial or proprietary software triggers this copyleft obligation and can expose the entire codebase.',
    commonViolations: ['AI generates code that imports a GPL library', 'Developer adds GPL dep without checking project license compatibility'],
    goodExample: 'Use MIT/Apache alternatives (e.g., better-sqlite3 instead of sqlite3-wasm if it were GPL).',
    badExample: '"license": "MIT" in package.json with a GPL dep in package-lock.json',
  },
  detect(input: DetectInput): Finding[] {
    const pc = pkgContent(input);
    if (!pc) return [];
    const pkg = parsePkg(pc);
    if (!pkg) return [];
    if (!isCommercialProject(pkg)) return [];

    const lock = lockContent(input);
    if (!lock) return [];
    const lockParsed = parseLock(lock);
    if (!lockParsed) return [];

    const gplDeps = extractLockDeps(lockParsed)
      .filter((d) => d.license && GPL_IDENTIFIERS.has(d.license));

    return gplDeps.map((d) =>
      f('lic_gpl_in_commercial', 'BLOCKER',
        `"${d.name}" uses ${d.license} — GPL copyleft incompatible with your ${pkg.license as string} project license.`,
        `Replace with a permissively licensed alternative or change your project license.`),
    );
  },
};

// ── Rule: LIC_002 — Unknown license ──────────────────────────────────────────

const LIC_002: ThesmosRule = {
  id: 'LIC_002',
  category: 'lic_unknown_license',
  severity: 'HIGH',
  description: 'Dependency has UNLICENSED or missing license — cannot determine usage rights.',
  tags: ['license', 'legal', 'compliance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without a license, the default is "all rights reserved" — you technically have no right to use the package. This is a legal risk for commercial projects.',
    commonViolations: ['Internal packages with no license field', 'Packages using "UNLICENSED" string to block usage'],
    goodExample: 'Add "license": "MIT" to the package or find a licensed alternative.',
    badExample: '"license": "UNLICENSED" or no license field in dependency\'s package.json',
  },
  detect(input: DetectInput): Finding[] {
    const lock = lockContent(input);
    if (!lock) return [];
    const lockParsed = parseLock(lock);
    if (!lockParsed) return [];

    return extractLockDeps(lockParsed)
      .filter((d) => !d.license || d.license === 'UNLICENSED' || d.license === '')
      .slice(0, 5) // cap at 5 to avoid noise
      .map((d) =>
        f('lic_unknown_license', 'HIGH',
          `"${d.name}" has no license — usage rights are unclear.`,
          `Check the repository for a LICENSE file or find a licensed alternative.`),
      );
  },
};

// ── Rule: LIC_003 — Copyleft dependency ──────────────────────────────────────

const LIC_003: ThesmosRule = {
  id: 'LIC_003',
  category: 'lic_copyleft_dependency',
  severity: 'MEDIUM',
  description: 'LGPL dependency requires attribution and limited linking rules.',
  tags: ['license', 'legal', 'lgpl', 'compliance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'LGPL packages can be used in commercial software but require you to: (1) provide attribution, (2) allow end users to replace the library. Dynamic linking is generally OK; static linking needs care.',
    commonViolations: ['Statically bundling LGPL code without complying with LGPL terms'],
    goodExample: 'Link dynamically (default for npm) and include attribution.',
    badExample: 'Statically compiling LGPL code into your binary',
  },
  detect(input: DetectInput): Finding[] {
    const lock = lockContent(input);
    if (!lock) return [];
    const lockParsed = parseLock(lock);
    if (!lockParsed) return [];

    return extractLockDeps(lockParsed)
      .filter((d) => d.license && COPYLEFT_IDENTIFIERS.has(d.license))
      .slice(0, 5)
      .map((d) =>
        f('lic_copyleft_dependency', 'MEDIUM',
          `"${d.name}" uses ${d.license} — review LGPL/copyleft obligations.`,
          `Ensure you comply with ${d.license} requirements (attribution, dynamic linking).`),
      );
  },
};

// ── Rule: LIC_004 — No project license file ───────────────────────────────────

const LIC_004: ThesmosRule = {
  id: 'LIC_004',
  category: 'lic_no_project_license',
  severity: 'HIGH',
  description: 'No LICENSE file found in project root — open source obligations unclear.',
  tags: ['license', 'legal', 'compliance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Without a LICENSE file, the project defaults to "all rights reserved" even if package.json says MIT. GitHub and legal frameworks require the actual file to be present.',
    commonViolations: ['Developer declares license in package.json but forgets to add the LICENSE file'],
    goodExample: 'LICENSE or LICENSE.md file present in the repository root.',
    badExample: '"license": "MIT" in package.json with no LICENSE file',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    // Only check if package.json declares a license
    const pc = pkgContent(input);
    if (!pc) return [];
    const pkg = parsePkg(pc);
    if (!pkg || !pkg.license) return [];

    // Don't flag if the LICENSE file is in changedFiles (being added)
    if (input.changedFiles?.some((cf) => /^LICENSE(\.md|\.txt)?$/i.test(cf.path))) return [];

    const hasLicenseFile =
      existsSync(join(root, 'LICENSE')) ||
      existsSync(join(root, 'LICENSE.md')) ||
      existsSync(join(root, 'LICENSE.txt'));

    if (hasLicenseFile) return [];
    return [f('lic_no_project_license', 'HIGH',
      `package.json declares "${pkg.license as string}" but no LICENSE file exists in the project root.`,
      'Add a LICENSE file. For MIT: https://opensource.org/licenses/MIT',
      'LICENSE')];
  },
};

// ── Rule: LIC_005 — Proprietary dependency ────────────────────────────────────

const LIC_005: ThesmosRule = {
  id: 'LIC_005',
  category: 'lic_proprietary_dependency',
  severity: 'HIGH',
  description: 'Dependency uses a proprietary or non-open-source license.',
  tags: ['license', 'legal', 'proprietary'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Proprietary dependencies create hidden cost and legal obligations. They may prohibit certain uses, require per-user licensing, or restrict redistribution.',
    commonViolations: ['SDK distributed under Commercial/Proprietary license'],
    goodExample: 'Check license agreement before using commercial SDK dependencies.',
    badExample: '"license": "SEE LICENSE IN license.md" with restrictive terms',
  },
  detect(input: DetectInput): Finding[] {
    const lock = lockContent(input);
    if (!lock) return [];
    const lockParsed = parseLock(lock);
    if (!lockParsed) return [];

    return extractLockDeps(lockParsed)
      .filter((d) => {
        if (!d.license) return false;
        return [...PROPRIETARY_IDENTIFIERS].some((id) => d.license!.startsWith(id));
      })
      .slice(0, 3)
      .map((d) =>
        f('lic_proprietary_dependency', 'HIGH',
          `"${d.name}" uses a proprietary license "${d.license}".`,
          `Review license agreement for "${d.name}" to ensure your use is permitted.`),
      );
  },
};

// ── Rule: LIC_006 — Invalid SPDX identifier ──────────────────────────────────

const LIC_006: ThesmosRule = {
  id: 'LIC_006',
  category: 'lic_spdx_invalid',
  severity: 'LOW',
  description: 'package.json "license" field is not a valid SPDX identifier.',
  tags: ['license', 'spdx'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Non-standard license strings are ambiguous, break tooling, and may not satisfy open source compliance scanners.',
    commonViolations: ['"license": "Apache 2.0" (should be "Apache-2.0")', '"license": "MIT/BSD" (should use "OR" operator)'],
    goodExample: '"license": "MIT"  or "license": "MIT OR Apache-2.0"',
    badExample: '"license": "MIT/X11" or "license": "Custom"',
  },
  detect(input: DetectInput): Finding[] {
    const pc = pkgContent(input);
    if (!pc) return [];
    const pkg = parsePkg(pc);
    if (!pkg) return [];
    const license = pkg.license as string | undefined;
    if (!license) return [];
    if (INVALID_SPDX.has(license)) {
      return [f('lic_spdx_invalid', 'LOW',
        `package.json "license": "${license}" is not a valid SPDX expression.`,
        `Use a valid SPDX identifier. Example: "MIT", "Apache-2.0", "MIT OR Apache-2.0"`)];
    }
    return [];
  },
};

// ── Rule: LIC_007 — Dual license ambiguous ────────────────────────────────────

const LIC_007: ThesmosRule = {
  id: 'LIC_007',
  category: 'lic_dual_license_ambiguous',
  severity: 'LOW',
  description: 'Dependency uses dual "OR" license without specifying which applies to your project.',
  tags: ['license', 'legal', 'compliance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'A "MIT OR GPL-2.0" license means you must choose which terms apply to your project. If you don\'t choose, you may accidentally be under GPL.',
    commonViolations: ['Using dual-licensed package assuming the permissive option applies automatically'],
    goodExample: 'Document which license option you\'ve selected in your THIRD_PARTY_LICENSES file.',
    badExample: '"license": "MIT OR GPL-2.0" without declaring your chosen option',
  },
  detect(input: DetectInput): Finding[] {
    const lock = lockContent(input);
    if (!lock) return [];
    const lockParsed = parseLock(lock);
    if (!lockParsed) return [];

    return extractLockDeps(lockParsed)
      .filter((d) => d.license?.includes(' OR ') && d.license.split(' OR ').some((l) => GPL_IDENTIFIERS.has(l.trim())))
      .slice(0, 3)
      .map((d) =>
        f('lic_dual_license_ambiguous', 'LOW',
          `"${d.name}" uses dual license "${d.license}" — you must choose which applies.`,
          `Document your license choice for "${d.name}" in THIRD_PARTY_LICENSES.md.`),
      );
  },
};

// ── Rule: LIC_008 — AI training restriction ───────────────────────────────────

const LIC_008: ThesmosRule = {
  id: 'LIC_008',
  category: 'lic_ai_training_restriction',
  severity: 'MEDIUM',
  description: 'Dependency license restricts AI training use — conflicts with AI-assisted development.',
  tags: ['license', 'legal', 'ai'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Some licenses (CC-BY-NC, "No AI Training" clauses) prohibit using the code for AI model training. If your AI tools learn from codebases, this restriction may apply.',
    commonViolations: ['Using data/asset packages with CC-BY-NC licenses in AI training pipelines'],
    goodExample: 'Use packages with permissive licenses (MIT, Apache-2.0) that explicitly allow AI use.',
    badExample: '"license": "CC-BY-NC-4.0" in a package used for AI training data',
  },
  detect(input: DetectInput): Finding[] {
    const lock = lockContent(input);
    if (!lock) return [];
    const lockParsed = parseLock(lock);
    if (!lockParsed) return [];

    return extractLockDeps(lockParsed)
      .filter((d) => d.license && AI_TRAINING_RE.test(d.license))
      .slice(0, 3)
      .map((d) =>
        f('lic_ai_training_restriction', 'MEDIUM',
          `"${d.name}" license "${d.license}" may restrict AI training use.`,
          `Verify whether your AI workflow use case is permitted under "${d.license}".`),
      );
  },
};

// ── Rule: LIC_009 — License mismatch ─────────────────────────────────────────

const LIC_009: ThesmosRule = {
  id: 'LIC_009',
  category: 'lic_license_mismatch',
  severity: 'BLOCKER',
  description: 'Project is open source (GPL) but has a permissive dep that conflicts with GPL requirements.',
  tags: ['license', 'legal', 'gpl', 'compliance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'GPL projects must only use GPL-compatible dependencies. Some licenses (e.g., Apache-2.0 has a patent clause) have subtle incompatibilities with GPL-2.0.',
    commonViolations: ['GPL-2.0 project using Apache-2.0 deps (incompatible due to patent clause in Apache-2.0)'],
    goodExample: 'Use GPL-2.0-or-later (compatible with Apache-2.0) or GPL-3.0.',
    badExample: '"license": "GPL-2.0" project with "license": "Apache-2.0" deps',
  },
  detect(input: DetectInput): Finding[] {
    const pc = pkgContent(input);
    if (!pc) return [];
    const pkg = parsePkg(pc);
    if (!pkg) return [];
    const projectLicense = (pkg.license as string | undefined) ?? '';
    // GPL-2.0 is incompatible with Apache-2.0 due to patent clause
    if (!['GPL-2.0', 'GPL-2.0-only'].includes(projectLicense)) return [];

    const lock = lockContent(input);
    if (!lock) return [];
    const lockParsed = parseLock(lock);
    if (!lockParsed) return [];

    const apacheDeps = extractLockDeps(lockParsed)
      .filter((d) => d.license === 'Apache-2.0');

    return apacheDeps.slice(0, 3).map((d) =>
      f('lic_license_mismatch', 'BLOCKER',
        `"${d.name}" uses Apache-2.0 which is GPL-2.0 incompatible (patent clause conflict).`,
        `Upgrade project to GPL-2.0-or-later or GPL-3.0, or replace the Apache-2.0 dependency.`),
    );
  },
};

// ── Rule: LIC_010 — No attribution for MIT/BSD ────────────────────────────────

const LIC_010: ThesmosRule = {
  id: 'LIC_010',
  category: 'lic_missing_attribution',
  severity: 'LOW',
  description: 'Project uses MIT/BSD dependencies but has no THIRD_PARTY_LICENSES or NOTICE file.',
  tags: ['license', 'attribution', 'compliance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'MIT and BSD licenses require attribution (preserving copyright notices). While rarely enforced, production applications and enterprise customers often require a THIRD_PARTY_LICENSES file.',
    commonViolations: ['Shipping commercial product with no attribution for open source dependencies'],
    goodExample: 'THIRD_PARTY_LICENSES.md listing all MIT/BSD dep copyright notices.',
    badExample: '(no attribution file when using 200+ MIT deps in a commercial product)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    // Only flag in projects with a commercial/proprietary license
    const pc = pkgContent(input);
    if (!pc) return [];
    const pkg = parsePkg(pc);
    if (!pkg?.license || !PERMISSIVE_IDENTIFIERS.has(pkg.license as string)) return [];

    // Don't flag if attribution file already exists
    const hasAttribution =
      existsSync(join(root, 'THIRD_PARTY_LICENSES')) ||
      existsSync(join(root, 'THIRD_PARTY_LICENSES.md')) ||
      existsSync(join(root, 'NOTICE')) ||
      existsSync(join(root, 'NOTICE.md')) ||
      input.changedFiles?.some((cf) => /THIRD_PARTY|NOTICE/i.test(cf.path));

    if (hasAttribution) return [];

    const lock = lockContent(input);
    if (!lock) return [];
    const lockParsed = parseLock(lock);
    if (!lockParsed) return [];

    const mitDeps = extractLockDeps(lockParsed).filter((d) => d.license && ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'].includes(d.license));
    if (mitDeps.length < 10) return []; // Only flag when there are many deps

    return [f('lic_missing_attribution', 'LOW',
      `${mitDeps.length} MIT/BSD dependencies require attribution but no THIRD_PARTY_LICENSES file exists.`,
      'Add THIRD_PARTY_LICENSES.md listing copyright notices for all MIT/BSD dependencies.',
      'THIRD_PARTY_LICENSES.md')];
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const LICENSE_RULES: ThesmosRule[] = [
  LIC_001,
  LIC_002,
  LIC_003,
  LIC_004,
  LIC_005,
  LIC_006,
  LIC_007,
  LIC_008,
  LIC_009,
  LIC_010,
];
