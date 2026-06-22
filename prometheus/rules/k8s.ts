/**
 * Kubernetes and Docker Compose security rules (K8S_001–010).
 *
 * Detects misconfigurations in Kubernetes YAML manifests and docker-compose.yml.
 * Complements dockerfile.ts (Dockerfile) and terraform.ts (AWS/IaC) with
 * container orchestration-specific security checks.
 */

import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isK8sManifest(path: string): boolean {
  if (!/\.(ya?ml)$/.test(path)) return false;
  return (
    /\/(k8s|kubernetes|manifests?|deploy(?:ment)?|charts?|helm|kube)\//i.test(path) ||
    /(?:deployment|service|pod|statefulset|daemonset|cronjob|ingress|configmap|secret)\.ya?ml$/i.test(path)
  );
}

function isDockerCompose(path: string): boolean {
  return /docker-compose(?:\.[a-z-]+)?\.ya?ml$/.test(path);
}

function isK8sOrCompose(path: string): boolean {
  return isK8sManifest(path) || isDockerCompose(path);
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const K8S_RULES: PrometheusRule[] = [
  {
    id: 'K8S_001',
    category: 'k8s_no_resource_limits',
    description: 'Kubernetes container spec without resources.limits — pod can consume unbounded CPU/memory.',
    severity: 'HIGH',
    tags: ['security', 'kubernetes', 'resource-management'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Without resource limits, a single misbehaving pod can consume all cluster resources and starve other workloads. This also makes the cluster vulnerable to resource exhaustion DoS attacks.',
      commonViolations: ['containers: without a resources: limits: block'],
      goodExample: 'resources:\n  limits:\n    cpu: "500m"\n    memory: "256Mi"\n  requests:\n    cpu: "100m"\n    memory: "128Mi"',
      badExample: 'containers:\n  - name: app\n    image: myapp:1.0  # no resources block',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_no_resource_limits', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isK8sManifest(path)) continue;
        if (!/\bcontainers?\s*:/m.test(content)) continue;
        // If "containers:" is present but "limits:" is not, flag it
        if (!/\blimits\s*:/m.test(content)) {
          findings.push({
            severity: sev,
            category: 'k8s_no_resource_limits',
            file: path,
            message: 'Kubernetes manifest has container(s) without resources.limits — unbounded resource usage.',
            suggestion: 'Add resources.limits (cpu and memory) to every container spec.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_002',
    category: 'k8s_run_as_root',
    description: 'Kubernetes pod or container securityContext allows running as root.',
    severity: 'HIGH',
    tags: ['security', 'kubernetes', 'privilege-escalation'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Running containers as root means a container escape gives the attacker root on the host node. Set runAsNonRoot: true and a specific runAsUser to enforce least privilege.',
      commonViolations: [
        'securityContext:\n  runAsUser: 0',
        '# no securityContext — defaults to root',
      ],
      goodExample: 'securityContext:\n  runAsNonRoot: true\n  runAsUser: 1000',
      badExample: 'securityContext:\n  runAsUser: 0  # root',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_run_as_root', config.severityRules);
      const findings: Finding[] = [];
      const ROOT_USER_RE = /runAsUser\s*:\s*0\b/;
      const RUN_AS_ROOT_RE = /runAsNonRoot\s*:\s*false/;
      for (const { path, content } of changedFiles) {
        if (!isK8sManifest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (ROOT_USER_RE.test(line) || RUN_AS_ROOT_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'k8s_run_as_root',
              file: path,
              line: i + 1,
              message: 'Container securityContext allows running as root (UID 0) — privilege escalation risk.',
              suggestion: 'Set runAsNonRoot: true and runAsUser: <non-zero UID>.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_003',
    category: 'k8s_privileged_container',
    description: 'Kubernetes container runs with privileged: true — equivalent to root access on the host node.',
    severity: 'BLOCKER',
    tags: ['security', 'kubernetes', 'privilege-escalation'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'A privileged container has nearly all Linux capabilities and can access host devices, bypass cgroup limits, and escape the container boundary. This is the highest-risk Kubernetes misconfiguration.',
      commonViolations: ['securityContext:\n  privileged: true'],
      goodExample: 'securityContext:\n  privileged: false\n  capabilities:\n    drop: ["ALL"]',
      badExample: 'securityContext:\n  privileged: true  # BLOCKER: full host access',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_privileged_container', config.severityRules);
      const findings: Finding[] = [];
      const PRIVILEGED_RE = /privileged\s*:\s*true/;
      for (const { path, content } of changedFiles) {
        if (!isK8sManifest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (PRIVILEGED_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'k8s_privileged_container',
              file: path,
              line: i + 1,
              message: 'Container runs with privileged: true — equivalent to root on the host node.',
              suggestion: 'Set privileged: false and grant only the specific capabilities needed.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_004',
    category: 'k8s_host_pid_or_network',
    description: 'Pod spec uses hostPID: true or hostNetwork: true — shares host process or network namespace.',
    severity: 'HIGH',
    tags: ['security', 'kubernetes', 'namespace-isolation'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'hostPID: true lets the container see and signal all host processes. hostNetwork: true bypasses network policies and can expose services on host IP addresses. Both break container isolation.',
      commonViolations: ['hostPID: true', 'hostNetwork: true'],
      goodExample: '# Omit hostPID and hostNetwork — they default to false.',
      badExample: 'spec:\n  hostPID: true\n  hostNetwork: true',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_host_pid_or_network', config.severityRules);
      const findings: Finding[] = [];
      const HOST_NS_RE = /hostPID\s*:\s*true|hostNetwork\s*:\s*true|hostIPC\s*:\s*true/;
      for (const { path, content } of changedFiles) {
        if (!isK8sManifest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (HOST_NS_RE.test(line)) {
            const which = /hostPID/.test(line) ? 'hostPID' : /hostNetwork/.test(line) ? 'hostNetwork' : 'hostIPC';
            findings.push({
              severity: sev,
              category: 'k8s_host_pid_or_network',
              file: path,
              line: i + 1,
              message: `${which}: true — pod shares host namespace, breaking container isolation.`,
              suggestion: `Remove ${which}: true unless this pod requires host-level access (DaemonSet / system component).`,
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_005',
    category: 'k8s_secret_as_env_literal',
    description: 'Kubernetes secret value appears as a literal string in env: rather than using secretKeyRef.',
    severity: 'BLOCKER',
    tags: ['security', 'kubernetes', 'secrets'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Embedding secrets as literal env values in YAML manifests means they are stored in the Kubernetes API etcd (which may not be encrypted) and visible in plain text in git history. Use secretKeyRef to reference Kubernetes Secrets.',
      commonViolations: [
        'env:\n  - name: DB_PASSWORD\n    value: "s3cr3t"',
        'env:\n  - name: API_KEY\n    value: "sk-prod-..."',
      ],
      goodExample: 'env:\n  - name: DB_PASSWORD\n    valueFrom:\n      secretKeyRef:\n        name: db-secret\n        key: password',
      badExample: 'env:\n  - name: DB_PASSWORD\n    value: "hardcoded-password"',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_secret_as_env_literal', config.severityRules);
      const findings: Finding[] = [];
      // env var named with secret-like name + value: (literal, not valueFrom:)
      const SECRET_NAME_RE = /name\s*:\s*(?:.*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|API_KEY|AUTH).*)$/im;
      const LITERAL_VALUE_RE = /^\s+value\s*:\s*["'][^"']{4,}/;
      for (const { path, content } of changedFiles) {
        if (!isK8sManifest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SECRET_NAME_RE.test(lines[i]!)) {
            // Check next few lines for a literal value
            const nextLines = lines.slice(i + 1, i + 4);
            const literalIdx = nextLines.findIndex((l) => LITERAL_VALUE_RE.test(l));
            if (literalIdx >= 0) {
              findings.push({
                severity: sev,
                category: 'k8s_secret_as_env_literal',
                file: path,
                line: i + literalIdx + 2,
                message: 'Secret-like env variable has a literal value — use secretKeyRef instead.',
                suggestion: 'Replace value: with valueFrom: secretKeyRef: to reference a Kubernetes Secret.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_006',
    category: 'k8s_no_readiness_probe',
    description: 'Kubernetes Deployment container without a readinessProbe — traffic is sent before the app is ready.',
    severity: 'MEDIUM',
    tags: ['reliability', 'kubernetes', 'health-checks'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Without a readinessProbe, Kubernetes sends traffic to pods immediately after the container starts, before the application is ready to serve requests. This causes 502/503 errors during deployments.',
      commonViolations: ['containers: without readinessProbe:'],
      goodExample: 'readinessProbe:\n  httpGet:\n    path: /health\n    port: 3000\n  initialDelaySeconds: 5\n  periodSeconds: 10',
      badExample: 'containers:\n  - name: app\n    image: myapp:1.0  # no readinessProbe',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_no_readiness_probe', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isK8sManifest(path)) continue;
        // Only flag Deployment/StatefulSet kinds
        if (!/kind\s*:\s*(?:Deployment|StatefulSet|DaemonSet)/m.test(content)) continue;
        if (!/\bcontainers?\s*:/m.test(content)) continue;
        if (!/readinessProbe\s*:/m.test(content)) {
          findings.push({
            severity: sev,
            category: 'k8s_no_readiness_probe',
            file: path,
            message: 'Deployment/StatefulSet has no readinessProbe — traffic routed before app is ready.',
            suggestion: 'Add readinessProbe with an httpGet or exec check to your container spec.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_007',
    category: 'k8s_image_pull_policy_never',
    description: 'Container imagePullPolicy: Never — image won\'t be refreshed, running stale/vulnerable versions.',
    severity: 'HIGH',
    tags: ['security', 'kubernetes', 'images'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'imagePullPolicy: Never prevents Kubernetes from pulling updated images. If the local image is outdated or compromised, the cluster will continue running the insecure version indefinitely.',
      commonViolations: ['imagePullPolicy: Never'],
      goodExample: 'imagePullPolicy: Always  # or IfNotPresent with pinned digest',
      badExample: 'imagePullPolicy: Never  # stale image permanently cached',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_image_pull_policy_never', config.severityRules);
      const findings: Finding[] = [];
      const NEVER_RE = /imagePullPolicy\s*:\s*Never\b/;
      for (const { path, content } of changedFiles) {
        if (!isK8sManifest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (NEVER_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'k8s_image_pull_policy_never',
              file: path,
              line: i + 1,
              message: 'imagePullPolicy: Never — image is never refreshed, running potentially stale/vulnerable version.',
              suggestion: 'Use imagePullPolicy: Always (or IfNotPresent with a pinned digest tag) for production workloads.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_008',
    category: 'k8s_no_security_context',
    description: 'Kubernetes container spec with no securityContext block — missing explicit privilege controls.',
    severity: 'MEDIUM',
    tags: ['security', 'kubernetes', 'hardening'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Without a securityContext, containers run with default kernel capabilities (including CAP_NET_ADMIN, CAP_SYS_PTRACE on some distros). Explicitly dropping capabilities and setting allowPrivilegeEscalation: false is a security baseline.',
      commonViolations: ['containers: block without securityContext:'],
      goodExample: 'securityContext:\n  allowPrivilegeEscalation: false\n  runAsNonRoot: true\n  capabilities:\n    drop: ["ALL"]',
      badExample: 'containers:\n  - name: app\n    image: myapp:1.0  # no securityContext',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_no_security_context', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isK8sManifest(path)) continue;
        if (!/\bcontainers?\s*:/m.test(content)) continue;
        if (!/securityContext\s*:/m.test(content)) {
          findings.push({
            severity: sev,
            category: 'k8s_no_security_context',
            file: path,
            message: 'Container has no securityContext — default capabilities and root access not explicitly denied.',
            suggestion: 'Add securityContext with allowPrivilegeEscalation: false, runAsNonRoot: true, and capabilities.drop: ["ALL"].',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_009',
    category: 'k8s_compose_no_healthcheck',
    description: 'Docker Compose service missing healthcheck — container assumed healthy immediately on start.',
    severity: 'MEDIUM',
    tags: ['reliability', 'docker-compose', 'health-checks'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Without a healthcheck, Docker considers the container healthy as soon as it starts, even if the application inside is still initializing or has crashed. Dependent services may start before dependencies are ready.',
      commonViolations: ['services: without healthcheck: block'],
      goodExample: 'healthcheck:\n  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]\n  interval: 30s\n  timeout: 10s\n  retries: 3',
      badExample: 'services:\n  api:\n    image: myapp:1.0  # no healthcheck',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_compose_no_healthcheck', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isDockerCompose(path)) continue;
        if (!/\bservices\s*:/m.test(content)) continue;
        if (!/healthcheck\s*:/m.test(content)) {
          findings.push({
            severity: sev,
            category: 'k8s_compose_no_healthcheck',
            file: path,
            message: 'Docker Compose file has services without healthcheck — containers assumed healthy immediately.',
            suggestion: 'Add healthcheck: to each service with a test command and appropriate interval/timeout/retries.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'K8S_010',
    category: 'k8s_latest_tag',
    description: 'Kubernetes manifest references an image with :latest tag — deployment is not reproducible.',
    severity: 'HIGH',
    tags: ['security', 'kubernetes', 'images', 'reproducibility'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'The :latest tag resolves to different image digests over time. This makes deployments non-reproducible (you can\'t roll back to exactly what was running before) and allows a compromised image to be pulled transparently.',
      commonViolations: ['image: myapp:latest', 'image: nginx:latest'],
      goodExample: 'image: myapp:1.4.2  # or myapp@sha256:...',
      badExample: 'image: myapp:latest',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('k8s_latest_tag', config.severityRules);
      const findings: Finding[] = [];
      const LATEST_RE = /^\s+image\s*:\s*\S+:latest\s*$/m;
      for (const { path, content } of changedFiles) {
        if (!isK8sOrCompose(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/^\s+image\s*:\s*\S+:latest\s*$/.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'k8s_latest_tag',
              file: path,
              line: i + 1,
              message: 'Image uses :latest tag — deployment is not reproducible and may pull unexpected changes.',
              suggestion: 'Pin to a specific version tag or SHA256 digest.',
            });
          }
        }
      }
      return findings;
    },
  },
];
