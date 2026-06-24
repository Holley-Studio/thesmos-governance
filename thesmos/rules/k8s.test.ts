// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { K8S_RULES } from './k8s';
import { CONFIG_DEFAULTS } from '../config';
import type { ScanResult } from '../types';

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

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const r = K8S_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files });
}

// ── K8S_001 — missing resource limits ────────────────────────────────────────

describe('K8S_001 — missing resource limits', () => {
  it('fires on K8s container without resources.limits', () => {
    const findings = detect('K8S_001', [{
      path: 'k8s/deployment.yaml',
      content: `
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: api
        image: my-api:1.0.0
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when resources.limits are defined', () => {
    const findings = detect('K8S_001', [{
      path: 'k8s/deployment.yaml',
      content: `
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: api
        image: my-api:1.0.0
        resources:
          limits:
            cpu: "500m"
            memory: "256Mi"
`,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on non-K8s files', () => {
    const findings = detect('K8S_001', [{
      path: 'src/config.ts',
      content: `const limits = { maxRequests: 100 };`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_002 — run as root ────────────────────────────────────────────────────

describe('K8S_002 — run as root', () => {
  it('fires on runAsUser: 0', () => {
    const findings = detect('K8S_002', [{
      path: 'k8s/pod.yaml',
      content: `
spec:
  containers:
  - name: app
    securityContext:
      runAsUser: 0
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on runAsNonRoot: false', () => {
    const findings = detect('K8S_002', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: app
    securityContext:
      runAsNonRoot: false
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on runAsNonRoot: true', () => {
    const findings = detect('K8S_002', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: app
    securityContext:
      runAsNonRoot: true
      runAsUser: 1000
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_003 — privileged container ───────────────────────────────────────────

describe('K8S_003 — privileged container', () => {
  it('fires on privileged: true', () => {
    const findings = detect('K8S_003', [{
      path: 'k8s/daemonset.yaml',
      content: `
spec:
  containers:
  - name: monitor
    securityContext:
      privileged: true
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('does NOT fire on privileged: false', () => {
    const findings = detect('K8S_003', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: app
    securityContext:
      privileged: false
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_004 — host namespaces ─────────────────────────────────────────────────

describe('K8S_004 — host namespaces', () => {
  it('fires on hostPID: true', () => {
    const findings = detect('K8S_004', [{
      path: 'k8s/pod.yaml',
      content: `
apiVersion: v1
kind: Pod
spec:
  hostPID: true
  containers:
  - name: debug
    image: busybox
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on hostNetwork: true', () => {
    const findings = detect('K8S_004', [{
      path: 'k8s/pod.yaml',
      content: `
spec:
  hostNetwork: true
  containers:
  - name: app
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire without host namespace flags', () => {
    const findings = detect('K8S_004', [{
      path: 'k8s/pod.yaml',
      content: `
spec:
  containers:
  - name: app
    image: my-app:1.0.0
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_005 — literal secret in env var ──────────────────────────────────────

describe('K8S_005 — literal secret in env var', () => {
  it('fires on API_KEY with literal value instead of secretKeyRef', () => {
    const findings = detect('K8S_005', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: api
    env:
    - name: API_KEY
      value: "sk-abc123secret"
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on PASSWORD literal env value', () => {
    const findings = detect('K8S_005', [{
      path: 'k8s/deployment.yaml',
      content: `
    env:
    - name: DB_PASSWORD
      value: "mysecretpassword"
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when using secretKeyRef', () => {
    const findings = detect('K8S_005', [{
      path: 'k8s/deployment.yaml',
      content: `
    env:
    - name: API_KEY
      valueFrom:
        secretKeyRef:
          name: api-secret
          key: key
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_006 — missing readinessProbe ─────────────────────────────────────────

describe('K8S_006 — missing readinessProbe', () => {
  it('fires on Deployment without readinessProbe', () => {
    const findings = detect('K8S_006', [{
      path: 'k8s/deployment.yaml',
      content: `
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: api
        image: my-api:1.0.0
        ports:
        - containerPort: 3000
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when readinessProbe is defined', () => {
    const findings = detect('K8S_006', [{
      path: 'k8s/deployment.yaml',
      content: `
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: api
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_007 — imagePullPolicy: Never ─────────────────────────────────────────

describe('K8S_007 — imagePullPolicy Never', () => {
  it('fires on imagePullPolicy: Never', () => {
    const findings = detect('K8S_007', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: app
    image: my-app:1.0.0
    imagePullPolicy: Never
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire on imagePullPolicy: Always', () => {
    const findings = detect('K8S_007', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: app
    imagePullPolicy: Always
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_008 — missing securityContext ────────────────────────────────────────

describe('K8S_008 — missing securityContext', () => {
  it('fires on container without securityContext', () => {
    const findings = detect('K8S_008', [{
      path: 'k8s/deployment.yaml',
      content: `
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: api
        image: my-api:1.0.0
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when securityContext is present', () => {
    const findings = detect('K8S_008', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: api
    securityContext:
      runAsNonRoot: true
      allowPrivilegeEscalation: false
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_009 — docker-compose no healthcheck ──────────────────────────────────

describe('K8S_009 — docker-compose missing healthcheck', () => {
  it('fires on service without healthcheck in docker-compose.yml', () => {
    const findings = detect('K8S_009', [{
      path: 'docker-compose.yml',
      content: `
version: '3.8'
services:
  api:
    image: my-api:1.0.0
    ports:
      - "3000:3000"
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when healthcheck is defined', () => {
    const findings = detect('K8S_009', [{
      path: 'docker-compose.yml',
      content: `
services:
  api:
    image: my-api:1.0.0
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
`,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on non-compose files', () => {
    const findings = detect('K8S_009', [{
      path: 'README.md',
      content: `# My App\n\nRun with docker-compose up`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── K8S_010 — latest image tag ────────────────────────────────────────────────

describe('K8S_010 — latest image tag', () => {
  it('fires on :latest tag in K8s deployment', () => {
    const findings = detect('K8S_010', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: api
    image: my-api:latest
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on :latest tag in docker-compose', () => {
    const findings = detect('K8S_010', [{
      path: 'docker-compose.yml',
      content: `
services:
  api:
    image: node:latest
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('fires on :latest in nested registry image reference', () => {
    const findings = detect('K8S_010', [{
      path: 'k8s/pod.yaml',
      content: `
spec:
  containers:
  - name: app
    image: my-registry.io/my-app:latest
`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on pinned semver tag', () => {
    const findings = detect('K8S_010', [{
      path: 'k8s/deployment.yaml',
      content: `
spec:
  containers:
  - name: api
    image: my-api:1.2.3
`,
    }]);
    expect(findings).toHaveLength(0);
  });
});
