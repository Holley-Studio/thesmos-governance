import { describe, it, expect } from 'vitest';
import { DOCKERFILE_RULES } from './dockerfile';
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
  const r = DOCKERFILE_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(id: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(id).detect(input);
}

// ── DOCKER_001 — Running as root ──────────────────────────────────────────

describe('DOCKER_001 — no USER instruction (runs as root)', () => {
  it('fires when Dockerfile has no USER directive', () => {
    const findings = detect('DOCKER_001', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nRUN npm install\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_run_as_root');
  });

  it('fires when only USER root is present', () => {
    const findings = detect('DOCKER_001', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nUSER root\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when a non-root USER is set', () => {
    const findings = detect('DOCKER_001', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nRUN useradd -r appuser\nUSER appuser\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Dockerfile files', () => {
    const findings = detect('DOCKER_001', [
      {
        path: 'src/app.ts',
        content: 'FROM node:18\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_002 — ADD instead of COPY ─────────────────────────────────────

describe('DOCKER_002 — ADD used for local file copy', () => {
  it('fires on ADD ./app /app', () => {
    const findings = detect('DOCKER_002', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nADD ./app /app\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_add_instead_of_copy');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on ADD . /workspace', () => {
    const findings = detect('DOCKER_002', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nADD . /workspace\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on COPY', () => {
    const findings = detect('DOCKER_002', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nCOPY ./app /app\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on ADD with https URL (covered by DOCKER_010)', () => {
    const findings = detect('DOCKER_002', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nADD https://example.com/file.tar.gz /tmp/\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_003 — :latest tag or no tag ───────────────────────────────────

describe('DOCKER_003 — FROM with :latest tag or no tag', () => {
  it('fires on FROM node:latest', () => {
    const findings = detect('DOCKER_003', [
      {
        path: 'Dockerfile',
        content: 'FROM node:latest\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_latest_tag');
  });

  it('fires on FROM ubuntu (no tag)', () => {
    const findings = detect('DOCKER_003', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu\nRUN apt-get update',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on FROM node:18.20.4-alpine', () => {
    const findings = detect('DOCKER_003', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18.20.4-alpine\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on FROM with digest', () => {
    const findings = detect('DOCKER_003', [
      {
        path: 'Dockerfile',
        content: 'FROM node@sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_004 — No HEALTHCHECK ───────────────────────────────────────────

describe('DOCKER_004 — no HEALTHCHECK instruction', () => {
  it('fires when runnable image has no HEALTHCHECK', () => {
    const findings = detect('DOCKER_004', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_no_healthcheck');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires when ENTRYPOINT is present but no HEALTHCHECK', () => {
    const findings = detect('DOCKER_004', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nENTRYPOINT ["node"]\nCMD ["server.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when HEALTHCHECK is present', () => {
    const findings = detect('DOCKER_004', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nHEALTHCHECK CMD curl -f http://localhost/ || exit 1\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on build-stage-only Dockerfiles (no CMD/ENTRYPOINT)', () => {
    const findings = detect('DOCKER_004', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18 AS builder\nRUN npm run build',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_005 — Secret in ENV ────────────────────────────────────────────

describe('DOCKER_005 — secret literal in ENV', () => {
  it('fires on ENV DATABASE_PASSWORD=supersecret', () => {
    const findings = detect('DOCKER_005', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nENV DATABASE_PASSWORD=supersecret123\nCMD ["node", "app.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_secret_in_env');
  });

  it('fires on ENV API_KEY=abc123literal', () => {
    const findings = detect('DOCKER_005', [
      {
        path: 'Dockerfile',
        content: 'FROM python:3.11\nENV API_KEY=abc123literal\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when value is a variable reference ${VAR}', () => {
    const findings = detect('DOCKER_005', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nENV DATABASE_PASSWORD=${DATABASE_PASSWORD}\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-sensitive ENV variables', () => {
    const findings = detect('DOCKER_005', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nENV NODE_ENV=production\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_006 — EXPOSE 22 (SSH) ──────────────────────────────────────────

describe('DOCKER_006 — EXPOSE SSH port 22', () => {
  it('fires on EXPOSE 22', () => {
    const findings = detect('DOCKER_006', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN apt-get install -y openssh-server\nEXPOSE 22\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_expose_ssh');
  });

  it('fires on EXPOSE 80 22 443 (multiple ports including 22)', () => {
    const findings = detect('DOCKER_006', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nEXPOSE 80 22 443\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on EXPOSE 80', () => {
    const findings = detect('DOCKER_006', [
      {
        path: 'Dockerfile',
        content: 'FROM nginx:alpine\nEXPOSE 80\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_007 — curl|bash ────────────────────────────────────────────────

describe('DOCKER_007 — RUN curl/wget piped to bash/sh', () => {
  it('fires on RUN curl ... | bash', () => {
    const findings = detect('DOCKER_007', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN curl https://install.sh | bash\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_curl_pipe_bash');
  });

  it('fires on RUN wget ... | sh', () => {
    const findings = detect('DOCKER_007', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN wget -qO- https://get.example.com/install | sh\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on RUN curl ... | zsh', () => {
    const findings = detect('DOCKER_007', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN curl https://setup.sh | zsh\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on curl download without pipe to shell', () => {
    const findings = detect('DOCKER_007', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN curl -fsSL https://install.sh -o install.sh && bash install.sh\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_008 — sudo in RUN ──────────────────────────────────────────────

describe('DOCKER_008 — RUN sudo', () => {
  it('fires on RUN sudo apt-get install', () => {
    const findings = detect('DOCKER_008', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN sudo apt-get install -y nginx\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_sudo_in_run');
  });

  it('fires on RUN sudo chmod ...', () => {
    const findings = detect('DOCKER_008', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN sudo chmod +x /usr/local/bin/myapp\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on RUN without sudo', () => {
    const findings = detect('DOCKER_008', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN apt-get install -y nginx\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_009 — Secret in ARG ────────────────────────────────────────────

describe('DOCKER_009 — sensitive ARG name', () => {
  it('fires on ARG API_KEY', () => {
    const findings = detect('DOCKER_009', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nARG API_KEY\nRUN echo "building"\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_secret_in_arg');
  });

  it('fires on ARG PASSWORD', () => {
    const findings = detect('DOCKER_009', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nARG PASSWORD\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on ARG TOKEN', () => {
    const findings = detect('DOCKER_009', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nARG TOKEN\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on non-sensitive ARG names', () => {
    const findings = detect('DOCKER_009', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nARG NODE_VERSION=18\nARG BUILD_DATE\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_010 — ADD URL ──────────────────────────────────────────────────

describe('DOCKER_010 — ADD downloading from URL', () => {
  it('fires on ADD https://... /tmp/', () => {
    const findings = detect('DOCKER_010', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nADD https://example.com/package.tar.gz /tmp/\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_add_url');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on ADD http://... /opt/', () => {
    const findings = detect('DOCKER_010', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nADD http://example.com/binary /opt/bin/\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on local ADD (covered by DOCKER_002)', () => {
    const findings = detect('DOCKER_010', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nADD ./local-file.tar.gz /tmp/\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_011 — apt-get install without cleanup ──────────────────────────

describe('DOCKER_011 — apt-get install without cleanup', () => {
  it('fires when apt-get install has no cleanup', () => {
    const findings = detect('DOCKER_011', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN apt-get update && apt-get install -y nginx\nCMD ["nginx", "-g", "daemon off;"]\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_apt_no_cleanup');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on apt-get install alone in RUN without cleanup in window', () => {
    const findings = detect('DOCKER_011', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nRUN apt-get install -y curl\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when rm -rf /var/lib/apt/lists is in the same RUN window', () => {
    const findings = detect('DOCKER_011', [
      {
        path: 'Dockerfile',
        content: [
          'FROM ubuntu:22.04',
          'RUN apt-get update && \\',
          '    apt-get install -y nginx && \\',
          '    rm -rf /var/lib/apt/lists/*',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_012 — Mutable semver tag ──────────────────────────────────────

describe('DOCKER_012 — mutable semver tag without digest', () => {
  it('fires on FROM node:18', () => {
    const findings = detect('DOCKER_012', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_mutable_tag');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on FROM python:3.11-alpine', () => {
    const findings = detect('DOCKER_012', [
      {
        path: 'Dockerfile',
        content: 'FROM python:3.11-alpine\nCMD ["python", "app.py"]',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when digest is present', () => {
    const findings = detect('DOCKER_012', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18-alpine@sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on :latest (covered by DOCKER_003)', () => {
    // DOCKER_012 only fires on semver-like tags (starting with digit)
    const findings = detect('DOCKER_012', [
      {
        path: 'Dockerfile',
        content: 'FROM node:latest',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_013 — COPY then RUN chown ─────────────────────────────────────

describe('DOCKER_013 — separate COPY and RUN chown/chmod', () => {
  it('fires on COPY followed by RUN chown within 3 lines', () => {
    const findings = detect('DOCKER_013', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nCOPY ./app /app\nRUN chown -R appuser:appuser /app\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_copy_chown_separate');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on COPY followed by RUN chmod within 3 lines', () => {
    const findings = detect('DOCKER_013', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nCOPY ./scripts /scripts\nRUN chmod +x /scripts/entrypoint.sh\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when RUN chown is far from any COPY', () => {
    const findings = detect('DOCKER_013', [
      {
        path: 'Dockerfile',
        content: [
          'FROM node:18',
          'RUN apt-get update',
          'RUN apt-get install -y curl',
          'RUN apt-get install -y git',
          'RUN apt-get install -y make',
          'RUN chown -R appuser /usr/local',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when COPY uses --chown flag', () => {
    const findings = detect('DOCKER_013', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nCOPY --chown=appuser:appuser ./app /app\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_014 — Privileged port ─────────────────────────────────────────

describe('DOCKER_014 — EXPOSE privileged port (< 1024 except 80/443)', () => {
  it('fires on EXPOSE 21 (FTP)', () => {
    const findings = detect('DOCKER_014', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nEXPOSE 21\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_privileged_port');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on EXPOSE 25 (SMTP)', () => {
    const findings = detect('DOCKER_014', [
      {
        path: 'Dockerfile',
        content: 'FROM ubuntu:22.04\nEXPOSE 25\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on EXPOSE 80', () => {
    const findings = detect('DOCKER_014', [
      {
        path: 'Dockerfile',
        content: 'FROM nginx:alpine\nEXPOSE 80\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on EXPOSE 443', () => {
    const findings = detect('DOCKER_014', [
      {
        path: 'Dockerfile',
        content: 'FROM nginx:alpine\nEXPOSE 443\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on high port like EXPOSE 3000', () => {
    const findings = detect('DOCKER_014', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nEXPOSE 3000\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DOCKER_015 — CMD without ENTRYPOINT ──────────────────────────────────

describe('DOCKER_015 — CMD but no ENTRYPOINT', () => {
  it('fires when CMD is present but ENTRYPOINT is absent', () => {
    const findings = detect('DOCKER_015', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nRUN npm install\nCMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('docker_no_entrypoint');
  });

  it('does not fire when both CMD and ENTRYPOINT are present', () => {
    const findings = detect('DOCKER_015', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nENTRYPOINT ["node"]\nCMD ["server.js"]',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when Dockerfile has only ENTRYPOINT and no CMD', () => {
    const findings = detect('DOCKER_015', [
      {
        path: 'Dockerfile',
        content: 'FROM node:18\nENTRYPOINT ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Dockerfile files', () => {
    const findings = detect('DOCKER_015', [
      {
        path: 'src/app.ts',
        content: 'CMD ["node", "server.js"]',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});
