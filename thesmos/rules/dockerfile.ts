// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, Finding, DetectInput } from '../types.js';
import { classifySeverity } from '../severity.js';

const isDockerfile = (p: string) => /Dockerfile(?:\.\w+)?$|\.dockerfile$/i.test(p);

export const DOCKERFILE_RULES: ThesmosRule[] = [
  // ── DOCKER_001: Running as root ───────────────────────────────────────────
  {
    id: 'DOCKER_001',
    category: 'docker_run_as_root',
    description: 'No USER instruction or only USER root — container runs as root.',
    severity: 'HIGH',
    tags: ['security', 'docker', 'least-privilege'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Running containers as root means any container escape gives the attacker root on the host. Always switch to a non-root user before the final CMD/ENTRYPOINT.',
      commonViolations: [
        'FROM node:18\nRUN npm install\nCMD ["node", "server.js"]  # no USER directive',
      ],
      goodExample: 'FROM node:18\nRUN useradd -r appuser\nUSER appuser\nCMD ["node", "server.js"]',
      badExample: 'FROM node:18\n# no USER — runs as root',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_run_as_root', config.severityRules);
      const findings: Finding[] = [];
      // Non-root user: USER directive that is NOT "root" or "0"
      const NON_ROOT_USER_RE = /^\s*USER\s+(?!root\b|0\b)\S/m;
      const HAS_FROM_RE = /^\s*FROM\b/m;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        if (!HAS_FROM_RE.test(content)) continue;
        if (!NON_ROOT_USER_RE.test(content)) {
          findings.push({
            severity: sev,
            category: 'docker_run_as_root',
            file: path,
            line: 1,
            message: 'No non-root USER instruction found — container will run as root.',
            suggestion: 'Add a USER directive with a non-root user before CMD/ENTRYPOINT.',
          });
        }
      }
      return findings;
    },
  },

  // ── DOCKER_002: ADD instead of COPY ───────────────────────────────────────
  {
    id: 'DOCKER_002',
    category: 'docker_add_instead_of_copy',
    description: 'ADD used to copy local files — use COPY instead.',
    severity: 'MEDIUM',
    tags: ['docker', 'best-practice'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'ADD has implicit behaviours (URL fetching, tar auto-extraction) that make Dockerfiles unpredictable. COPY is explicit and should be used for local file copies.',
      commonViolations: ['ADD ./app /app'],
      goodExample: 'COPY ./app /app',
      badExample: 'ADD ./app /app',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_add_instead_of_copy', config.severityRules);
      const findings: Finding[] = [];
      // ADD not followed by http/https URL
      const ADD_LOCAL_RE = /^\s*ADD\s+(?!https?:\/\/)/i;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (ADD_LOCAL_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'docker_add_instead_of_copy',
              file: path,
              line: i + 1,
              message: 'ADD used for local file copy — prefer COPY for predictable behaviour.',
              suggestion: 'Replace ADD with COPY. Use ADD only for URL downloads or auto-extracting archives.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_003: :latest tag or no tag ────────────────────────────────────
  {
    id: 'DOCKER_003',
    category: 'docker_latest_tag',
    description: 'FROM uses :latest tag or no tag — image is not pinned.',
    severity: 'HIGH',
    tags: ['security', 'docker', 'reproducibility'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'The :latest tag (and tagless FROM) resolves to whatever the registry currently hosts. A registry update can silently change your base image, breaking builds or introducing vulnerabilities.',
      commonViolations: ['FROM node:latest', 'FROM ubuntu'],
      goodExample: 'FROM node:18.20.4-alpine3.20@sha256:abc123...',
      badExample: 'FROM node:latest',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_latest_tag', config.severityRules);
      const findings: Finding[] = [];
      // FROM with :latest (with optional --platform flag)
      const LATEST_RE = /^\s*FROM\s+(?:--platform=\S+\s+)?\S+:latest\b/i;
      // FROM with no tag and no digest: image name only (no colon, no @)
      const NO_TAG_RE = /^\s*FROM\s+(?:--platform=\S+\s+)?([^\s:@]+)\s*(?:#.*)?$/;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (LATEST_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'docker_latest_tag',
              file: path,
              line: i + 1,
              message: 'FROM uses :latest tag — pin to a specific version or digest.',
              suggestion: 'Use a pinned tag like node:18.20.4-alpine or add a @sha256: digest.',
            });
          } else if (NO_TAG_RE.test(line) && /^\s*FROM\b/i.test(line)) {
            findings.push({
              severity: sev,
              category: 'docker_latest_tag',
              file: path,
              line: i + 1,
              message: 'FROM has no tag — image version is unpinned and may change.',
              suggestion: 'Specify a version tag: e.g. FROM ubuntu:22.04 or use a @sha256: digest.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_004: No HEALTHCHECK ────────────────────────────────────────────
  {
    id: 'DOCKER_004',
    category: 'docker_no_healthcheck',
    description: 'Runnable image has no HEALTHCHECK instruction.',
    severity: 'MEDIUM',
    tags: ['docker', 'reliability'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Without a HEALTHCHECK, orchestrators cannot tell whether your container is actually serving traffic or is stuck. A container that starts but is broken will receive traffic indefinitely.',
      commonViolations: ['CMD ["node", "server.js"]  # no HEALTHCHECK'],
      goodExample: 'HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/health || exit 1',
      badExample: 'CMD ["node", "server.js"]  # no HEALTHCHECK',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_no_healthcheck', config.severityRules);
      const findings: Finding[] = [];
      const HAS_HEALTHCHECK_RE = /^\s*HEALTHCHECK\b/m;
      const CMD_OR_ENTRYPOINT_RE = /^\s*(?:CMD|ENTRYPOINT)\b/m;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        // Only fire on runnable images (those with CMD or ENTRYPOINT)
        if (!CMD_OR_ENTRYPOINT_RE.test(content)) continue;
        if (!HAS_HEALTHCHECK_RE.test(content)) {
          // Find the first CMD or ENTRYPOINT line to report
          const lines = content.split('\n');
          let fireLine = 1;
          for (let i = 0; i < lines.length; i++) {
            if (/^\s*(?:CMD|ENTRYPOINT)\b/.test(lines[i]!)) {
              fireLine = i + 1;
              break;
            }
          }
          findings.push({
            severity: sev,
            category: 'docker_no_healthcheck',
            file: path,
            line: fireLine,
            message: 'No HEALTHCHECK instruction — orchestrators cannot detect an unhealthy container.',
            suggestion: 'Add HEALTHCHECK --interval=30s CMD curl -f http://localhost/health || exit 1',
          });
        }
      }
      return findings;
    },
  },

  // ── DOCKER_005: Secret in ENV ─────────────────────────────────────────────
  {
    id: 'DOCKER_005',
    category: 'docker_secret_in_env',
    description: 'ENV instruction sets a sensitive variable to a literal value.',
    severity: 'BLOCKER',
    tags: ['security', 'docker', 'secrets'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'ENV values are baked into the image and visible to every process in the container and to anyone who runs docker inspect. Secrets must never be set as ENV literals.',
      commonViolations: ['ENV DATABASE_PASSWORD=supersecret123'],
      goodExample: 'ENV DATABASE_PASSWORD=${DATABASE_PASSWORD}  # inject at runtime',
      badExample: 'ENV DATABASE_PASSWORD=supersecret123',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_secret_in_env', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_ENV_RE = /^\s*ENV\s+[A-Z0-9_]*(?:PASSWORD|SECRET|API_KEY|TOKEN|PRIVATE_KEY|AUTH|PASSWD|CREDENTIAL)[A-Z0-9_]*\s*[=\s]/i;
      // Skip if value is a variable reference like ${VAR} or $VAR
      const VAR_REF_RE = /\$\{?\w+\}?/;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (SECRET_ENV_RE.test(line)) {
            // Extract the value part — fire only if not a variable reference
            const valueMatch = line.match(/[=\s]\s*(\S+)\s*$/);
            const value = valueMatch?.[1] ?? '';
            if (!VAR_REF_RE.test(value)) {
              findings.push({
                severity: sev,
                category: 'docker_secret_in_env',
                file: path,
                line: i + 1,
                message: 'Sensitive ENV variable set to a literal value — secret baked into image.',
                suggestion: 'Use ENV VAR=${VAR} to inject at runtime, or use Docker BuildKit secrets.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_006: EXPOSE 22 (SSH) ───────────────────────────────────────────
  {
    id: 'DOCKER_006',
    category: 'docker_expose_ssh',
    description: 'EXPOSE 22 exposes the SSH port.',
    severity: 'HIGH',
    tags: ['security', 'docker', 'network'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Exposing SSH in a container is an anti-pattern. It increases attack surface and encourages shelling into containers instead of using proper logging and exec tooling.',
      commonViolations: ['EXPOSE 22'],
      goodExample: '# Use docker exec instead of SSH for debugging',
      badExample: 'EXPOSE 22',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_expose_ssh', config.severityRules);
      const findings: Finding[] = [];
      const EXPOSE_SSH_RE = /^\s*EXPOSE\s+(?:22\b|.*\s22\b)/;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (EXPOSE_SSH_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'docker_expose_ssh',
              file: path,
              line: i + 1,
              message: 'EXPOSE 22 exposes SSH — use docker exec for container access instead.',
              suggestion: 'Remove EXPOSE 22. Use docker exec or a sidecar for debugging.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_007: curl | bash ───────────────────────────────────────────────
  {
    id: 'DOCKER_007',
    category: 'docker_curl_pipe_bash',
    description: 'RUN curl/wget piped to bash/sh — arbitrary remote code execution.',
    severity: 'BLOCKER',
    tags: ['security', 'docker', 'supply-chain'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Piping a remote script directly to a shell executes whatever the server returns, with no opportunity to inspect or verify it. A compromised CDN or DNS hijack yields full RCE during build.',
      commonViolations: ['RUN curl https://install.sh | bash'],
      goodExample: 'RUN curl -fsSL https://install.sh -o install.sh && sha256sum --check install.sh.sha256 && bash install.sh',
      badExample: 'RUN curl https://install.sh | bash',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_curl_pipe_bash', config.severityRules);
      const findings: Finding[] = [];
      const CURL_PIPE_BASH_RE = /^\s*RUN\b[^#]*(?:curl|wget)\b[^#]*\|\s*(?:bash|sh|zsh|ash)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (CURL_PIPE_BASH_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'docker_curl_pipe_bash',
              file: path,
              line: i + 1,
              message: 'RUN curl/wget piped to shell — remote code executes without verification.',
              suggestion: 'Download the script, verify its checksum, then execute it separately.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_008: sudo in RUN ───────────────────────────────────────────────
  {
    id: 'DOCKER_008',
    category: 'docker_sudo_in_run',
    description: 'RUN sudo used inside Dockerfile — redundant and signals running as root.',
    severity: 'HIGH',
    tags: ['security', 'docker', 'best-practice'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'During a Docker build, commands already run as root unless USER is set. Using sudo is redundant and suggests the image will run as root in production.',
      commonViolations: ['RUN sudo apt-get install -y nginx'],
      goodExample: 'RUN apt-get install -y nginx',
      badExample: 'RUN sudo apt-get install -y nginx',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_sudo_in_run', config.severityRules);
      const findings: Finding[] = [];
      const SUDO_RUN_RE = /^\s*RUN\b[^#]*\bsudo\b/;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SUDO_RUN_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'docker_sudo_in_run',
              file: path,
              line: i + 1,
              message: 'RUN sudo is redundant — build-time commands already run as root.',
              suggestion: 'Remove sudo. If the intent is to run as a non-root user, set USER before RUN.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_009: Secret in ARG ─────────────────────────────────────────────
  {
    id: 'DOCKER_009',
    category: 'docker_secret_in_arg',
    description: 'ARG with a sensitive name — build-arg values are visible in docker history.',
    severity: 'HIGH',
    tags: ['security', 'docker', 'secrets'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'ARG values passed at build time are stored in the image history and accessible via docker history --no-trunc. Anyone with image access can recover the secret.',
      commonViolations: ['ARG API_KEY'],
      goodExample: 'RUN --mount=type=secret,id=mykey cat /run/secrets/mykey',
      badExample: 'ARG API_KEY  # visible in docker history',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_secret_in_arg', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_ARG_RE = /^\s*ARG\s+(?:PASSWORD|SECRET|API_KEY|TOKEN|PRIVATE_KEY|AUTH_TOKEN|CREDENTIAL)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SECRET_ARG_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'docker_secret_in_arg',
              file: path,
              line: i + 1,
              message: 'Sensitive ARG value will be visible in docker history.',
              suggestion: 'Use Docker BuildKit secrets: RUN --mount=type=secret,id=mykey ...',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_010: ADD URL ───────────────────────────────────────────────────
  {
    id: 'DOCKER_010',
    category: 'docker_add_url',
    description: 'ADD downloading from a URL — use curl/wget with checksum verification instead.',
    severity: 'MEDIUM',
    tags: ['security', 'docker', 'supply-chain'],
    sinceVersion: '1.6.0',
    explain: {
      why: "ADD <url> downloads a file with no checksum verification. A compromised or man-in-the-middle'd download can inject malicious content into your image.",
      commonViolations: ['ADD https://example.com/package.tar.gz /tmp/'],
      goodExample: 'RUN curl -fsSL https://example.com/pkg.tar.gz -o /tmp/pkg.tar.gz && echo "expected_sha256  /tmp/pkg.tar.gz" | sha256sum --check',
      badExample: 'ADD https://example.com/package.tar.gz /tmp/',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_add_url', config.severityRules);
      const findings: Finding[] = [];
      const ADD_URL_RE = /^\s*ADD\s+https?:\/\//i;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (ADD_URL_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'docker_add_url',
              file: path,
              line: i + 1,
              message: 'ADD downloads from URL with no checksum verification.',
              suggestion: 'Use RUN curl/wget and verify the checksum before using the downloaded file.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_011: apt-get install without cleanup ───────────────────────────
  {
    id: 'DOCKER_011',
    category: 'docker_apt_no_cleanup',
    description: 'apt-get install without rm -rf /var/lib/apt/lists/* in the same RUN layer.',
    severity: 'MEDIUM',
    tags: ['docker', 'image-size'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'apt-get install populates /var/lib/apt/lists/ with package indexes. If not cleaned in the same RUN step, these files are permanently baked into the image layer, bloating the image size.',
      commonViolations: ['RUN apt-get install -y nginx'],
      goodExample: 'RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*',
      badExample: 'RUN apt-get install -y nginx  # no cleanup',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_apt_no_cleanup', config.severityRules);
      const findings: Finding[] = [];
      const APT_INSTALL_RE = /^\s*RUN\b[^\\]*apt-get\s+install\b/i;
      const CLEANUP_RE = /rm\s+-rf\s+\/var\/lib\/apt\/lists/;
      const WINDOW = 8;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!APT_INSTALL_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + WINDOW + 1);
          const windowText = lines.slice(i, end).join('\n');
          if (!CLEANUP_RE.test(windowText)) {
            findings.push({
              severity: sev,
              category: 'docker_apt_no_cleanup',
              file: path,
              line: i + 1,
              message: 'apt-get install without rm -rf /var/lib/apt/lists/* — bloats the image layer.',
              suggestion: 'Chain: RUN apt-get update && apt-get install -y <pkg> && rm -rf /var/lib/apt/lists/*',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_012: Mutable semver tag (no digest) ────────────────────────────
  {
    id: 'DOCKER_012',
    category: 'docker_mutable_tag',
    description: 'FROM uses a mutable semver tag without a digest — image can silently change.',
    severity: 'MEDIUM',
    tags: ['security', 'docker', 'reproducibility'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Even specific version tags like node:18 or python:3.11 are mutable — the registry can push a new image to the same tag. Pin to a @sha256: digest for fully reproducible builds.',
      commonViolations: ['FROM node:18', 'FROM python:3.11-alpine'],
      goodExample: 'FROM node:18.20.4-alpine3.20@sha256:abc123...',
      badExample: 'FROM node:18  # mutable — can change without warning',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_mutable_tag', config.severityRules);
      const findings: Finding[] = [];
      // FROM with a semver-like tag but no @sha256 digest
      const SEMVER_TAG_RE = /^\s*FROM\s+(?:--platform=\S+\s+)?\S+:\d[\w.\-]*\s*(?:#.*)?$/;
      const HAS_DIGEST_RE = /@sha256:/;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (SEMVER_TAG_RE.test(line) && !HAS_DIGEST_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'docker_mutable_tag',
              file: path,
              line: i + 1,
              message: 'FROM uses a mutable version tag without a @sha256: digest.',
              suggestion: 'Pin to a digest: FROM node:18-alpine@sha256:<digest>',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_013: Separate COPY + RUN chown ────────────────────────────────
  {
    id: 'DOCKER_013',
    category: 'docker_copy_chown_separate',
    description: 'COPY followed by a separate RUN chown/chmod — use COPY --chown= instead.',
    severity: 'MEDIUM',
    tags: ['docker', 'image-size', 'best-practice'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'A RUN chown after COPY duplicates the files in a new layer, doubling their storage. Using COPY --chown= sets ownership without an extra layer.',
      commonViolations: ['COPY ./app /app\nRUN chown -R appuser:appuser /app'],
      goodExample: 'COPY --chown=appuser:appuser ./app /app',
      badExample: 'COPY ./app /app\nRUN chown -R appuser:appuser /app',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_copy_chown_separate', config.severityRules);
      const findings: Finding[] = [];
      const CHOWN_CHMOD_RE = /^\s*RUN\s+(?:chown|chmod)\b/i;
      const COPY_RE = /^\s*COPY\b/i;
      const LOOKBACK = 3;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!CHOWN_CHMOD_RE.test(lines[i]!)) continue;
          const start = Math.max(0, i - LOOKBACK);
          const precedingLines = lines.slice(start, i);
          if (precedingLines.some((l) => COPY_RE.test(l))) {
            findings.push({
              severity: sev,
              category: 'docker_copy_chown_separate',
              file: path,
              line: i + 1,
              message: 'RUN chown/chmod after COPY creates an extra layer — use COPY --chown= instead.',
              suggestion: 'Replace with: COPY --chown=user:group <src> <dest>',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_014: Privileged port (< 1024, not 80/443/22) ──────────────────
  {
    id: 'DOCKER_014',
    category: 'docker_privileged_port',
    description: 'EXPOSE of a privileged port below 1024 (other than 80 and 443).',
    severity: 'MEDIUM',
    tags: ['security', 'docker', 'network'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Ports below 1024 are privileged and typically require root to bind. Exposing them suggests the container runs as root. Use a reverse proxy and bind to a high port inside the container.',
      commonViolations: ['EXPOSE 21', 'EXPOSE 25'],
      goodExample: 'EXPOSE 3000  # run app on high port, use reverse proxy for 80/443',
      badExample: 'EXPOSE 21  # FTP — privileged port requiring root',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_privileged_port', config.severityRules);
      const findings: Finding[] = [];
      const EXPOSE_RE = /^\s*EXPOSE\s+(\d+)/;
      // Ports already covered by other rules or acceptable
      const ALLOWED_PORTS = new Set(['80', '443', '22']);
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = EXPOSE_RE.exec(lines[i]!);
          if (!match) continue;
          const port = match[1]!;
          if (parseInt(port, 10) < 1024 && !ALLOWED_PORTS.has(port)) {
            findings.push({
              severity: sev,
              category: 'docker_privileged_port',
              file: path,
              line: i + 1,
              message: `EXPOSE ${port} — privileged port below 1024 requires root to bind.`,
              suggestion: 'Use a high port (>= 1024) inside the container and a reverse proxy for external traffic.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DOCKER_015: CMD but no ENTRYPOINT ────────────────────────────────────
  {
    id: 'DOCKER_015',
    category: 'docker_no_entrypoint',
    description: 'Dockerfile has CMD but no ENTRYPOINT — container behaviour is unpredictable.',
    severity: 'LOW',
    tags: ['docker', 'best-practice'],
    sinceVersion: '1.6.0',
    explain: {
      why: 'Without ENTRYPOINT, the CMD can be completely replaced by any docker run argument. Using ENTRYPOINT for the binary and CMD for default arguments makes the container purpose clear and harder to misuse.',
      commonViolations: ['CMD ["node", "server.js"]  # no ENTRYPOINT'],
      goodExample: 'ENTRYPOINT ["node"]\nCMD ["server.js"]',
      badExample: 'CMD ["node", "server.js"]  # no ENTRYPOINT',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('docker_no_entrypoint', config.severityRules);
      const findings: Finding[] = [];
      const HAS_CMD_RE = /^\s*CMD\b/m;
      const HAS_ENTRYPOINT_RE = /^\s*ENTRYPOINT\b/m;
      for (const { path, content } of changedFiles) {
        if (!isDockerfile(path)) continue;
        if (!HAS_CMD_RE.test(content)) continue;
        if (!HAS_ENTRYPOINT_RE.test(content)) {
          // Fire on the CMD line
          const lines = content.split('\n');
          let fireLine = 1;
          for (let i = 0; i < lines.length; i++) {
            if (/^\s*CMD\b/.test(lines[i]!)) {
              fireLine = i + 1;
              break;
            }
          }
          findings.push({
            severity: sev,
            category: 'docker_no_entrypoint',
            file: path,
            line: fireLine,
            message: 'CMD present without ENTRYPOINT — CMD can be overridden entirely at docker run.',
            suggestion: 'Use ENTRYPOINT for the binary and CMD for default arguments.',
          });
        }
      }
      return findings;
    },
  },
];
