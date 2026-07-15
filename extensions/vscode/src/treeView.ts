// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * FindingsTreeProvider — Explorer panel tree of all governance findings.
 *
 * Tree shape:
 *   ● BLOCKER (3)
 *     ↳ [error] "Auth route missing middleware" — src/api/users.ts
 *   ● HIGH (1)
 *     ↳ [error] "Unprotected server action" — app/actions.ts
 *   ● MEDIUM (5)
 *     ↳ ...
 *
 * Clicking a finding item opens the file at the offending line.
 * Severity groups auto-expand on first load; collapse to MEDIUM/below when
 * there are blockers (to keep signal-to-noise high).
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import type { Finding, Severity } from './types.js';

// ── Category → human label helpers ───────────────────────────────────────────

const GUARDIAN_PREFIXES: Array<[string, string]> = [
  ['eu_ai_', '⚖️ Themis'], ['local_llm_', '🤖 Aether'], ['hipaa_', '⚖️ Themis'],
  ['gdpr_', '⚖️ Themis'], ['dora_', '⚖️ Themis'], ['agent_', '⚡ Zeus'],
  ['agnt_', '⚡ Zeus'], ['rag_', '👁 Argus'], ['mcp_', '👁 Argus'],
  ['sec_', '👁 Argus'], ['auth_', '👁 Argus'], ['vibe_', '👁 Argus'],
  ['jwt_', '👁 Argus'], ['cors_', '👁 Argus'], ['dast_', '👁 Argus'],
  ['proto_', '👁 Argus'], ['ws_', '👁 Argus'], ['ai_', '🤖 Aether'],
  ['db_', '🗄️ Pontus'], ['prisma_', '🗄️ Pontus'], ['database_', '🗄️ Pontus'],
  ['css_', '🔨 Hephaestus'], ['design_', '🔨 Hephaestus'], ['a11y_', '🔨 Hephaestus'],
  ['react_', '🔨 Hephaestus'], ['dep_', '🔒 Nemesis'], ['slop_', '🔒 Nemesis'],
  ['sc_', '🔒 Nemesis'], ['k8s_', '🛠️ Kratos'], ['docker_', '🛠️ Kratos'],
  ['gha_', '🛠️ Kratos'], ['tf_', '🛠️ Kratos'], ['vercel_', '🌐 Notus'],
  ['commit_', '🔀 Kronos'], ['git_', '🔀 Kronos'],
  ['test_', '🔴 Cassandra'], ['debt_', '📋 Mnemosyne'],
];

const DOMAIN_LABELS: Record<string, string> = {
  sec: 'Security', auth: 'Auth', agent: 'Agent', agnt: 'Agent',
  ai: 'AI', local: 'Local LLM', rag: 'RAG', mcp: 'MCP',
  db: 'Database', prisma: 'Prisma', database: 'Database',
  react: 'React', next: 'Next.js', ts: 'TypeScript',
  trpc: 'tRPC', api: 'API', gql: 'GraphQL', node: 'Node',
  css: 'CSS', design: 'Design', a11y: 'Accessibility',
  gdpr: 'GDPR', hipaa: 'HIPAA', dora: 'DORA', eu: 'EU AI Act',
  dep: 'Dependency', slop: 'Supply Chain', sc: 'Supply Chain',
  k8s: 'Kubernetes', docker: 'Docker', gha: 'GitHub Actions',
  tf: 'Terraform', vercel: 'Vercel', commit: 'Commit', git: 'Git',
  test: 'Testing', debt: 'Tech Debt', zod: 'Zod', form: 'Forms',
  state: 'State', log: 'Logging', err: 'Error', error: 'Error',
  import: 'Import', perf: 'Performance', vibe: 'Vibe Coding',
  ws: 'WebSocket', jwt: 'JWT', proto: 'Prototype', dast: 'DAST',
  py: 'Python', go: 'Go', rb: 'Ruby', php: 'PHP', java: 'Java',
  cs: 'C#', rust: 'Rust', djg: 'Django', django: 'Django',
  lic: 'License', license: 'License', cors: 'CORS',
};

export function categoryGuardian(category: string): string {
  for (const [prefix, label] of GUARDIAN_PREFIXES) {
    if (category.startsWith(prefix)) return label;
  }
  return '⚙️ Talos';
}

export function categoryTitle(category: string): string {
  const parts = category.split('_').filter(Boolean);
  if (parts.length === 0) return category;
  const prefix = parts[0]!.toLowerCase();
  const domain = DOMAIN_LABELS[prefix] ?? (prefix.charAt(0).toUpperCase() + prefix.slice(1));
  const rest = parts.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return rest ? `${domain}: ${rest}` : domain;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'];

const SEVERITY_LABEL: Record<Severity, string> = {
  BLOCKER: 'Blocker',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  TECH_DEBT: 'Tech Debt',
};

const SEVERITY_ICON: Record<Severity, string> = {
  BLOCKER: 'error',
  HIGH: 'error',
  MEDIUM: 'warning',
  LOW: 'info',
  TECH_DEBT: 'lightbulb',
};

const SEVERITY_COLOR: Record<Severity, vscode.ThemeColor> = {
  BLOCKER: new vscode.ThemeColor('errorForeground'),
  HIGH: new vscode.ThemeColor('errorForeground'),
  MEDIUM: new vscode.ThemeColor('editorWarning.foreground'),
  LOW: new vscode.ThemeColor('editorInfo.foreground'),
  TECH_DEBT: new vscode.ThemeColor('editorHint.foreground'),
};

// ── Tree item types ───────────────────────────────────────────────────────────

type TreeNode = SeverityGroupItem | FindingItem | EmptyItem;

class SeverityGroupItem extends vscode.TreeItem {
  readonly kind = 'group' as const;

  constructor(
    public readonly severity: Severity,
    public readonly findings: Finding[],
    hasBlockers: boolean,
  ) {
    const count = findings.length;
    const label = `${SEVERITY_LABEL[severity]}  (${count})`;
    const collapse =
      count === 0
        ? vscode.TreeItemCollapsibleState.None
        : severity === 'BLOCKER' || severity === 'HIGH' || !hasBlockers
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;

    super(label, collapse);

    this.iconPath = new vscode.ThemeIcon(
      SEVERITY_ICON[severity],
      SEVERITY_COLOR[severity],
    );
    this.contextValue = 'severityGroup';
    this.description = count === 0 ? 'none' : undefined;
  }
}

export class FindingItem extends vscode.TreeItem {
  readonly kind = 'finding' as const;

  constructor(
    public readonly finding: Finding,
    workspaceRoot: string,
  ) {
    super(finding.message, vscode.TreeItemCollapsibleState.None);

    this.description = finding.file;
    const guardian = categoryGuardian(finding.category);
    const title = categoryTitle(finding.category);
    this.tooltip = new vscode.MarkdownString(
      `**${finding.severity}** · ${guardian} · ${title}\n\n` +
        `${finding.message}` +
        (finding.suggestion ? `\n\n_${finding.suggestion}_` : ''),
    );

    // Lightning bolt for findings the fix command can auto-resolve;
    // clipboard icon prompts copy-to-AI workflow for manual fixes.
    const isFixable = Boolean(finding.suggestion);
    this.iconPath = new vscode.ThemeIcon(
      isFixable ? 'zap' : SEVERITY_ICON[finding.severity],
      SEVERITY_COLOR[finding.severity],
    );
    this.contextValue = isFixable ? 'fixableFinding' : 'finding';

    const absPath = join(workspaceRoot, finding.file);
    const line = Math.max(0, (finding.line ?? 1) - 1);

    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [
        vscode.Uri.file(absPath),
        {
          selection: new vscode.Range(line, 0, line, 0),
          preview: true,
        } satisfies vscode.TextDocumentShowOptions,
      ],
    };
  }
}

class EmptyItem extends vscode.TreeItem {
  readonly kind = 'empty' as const;

  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('pass-filled');
    this.contextValue = 'empty';
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class FindingsTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<TreeNode | TreeNode[] | undefined | null | void>();

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private findings: Finding[] = [];
  private workspaceRoot = '';
  private state: 'idle' | 'loading' | 'ready' | 'no-report' | 'not-installed' = 'idle';

  refresh(findings: Finding[], workspaceRoot: string): void {
    this.findings = findings;
    this.workspaceRoot = workspaceRoot;
    this.state = 'ready';
    this._onDidChangeTreeData.fire();
  }

  setLoading(): void {
    this.state = 'loading';
    this._onDidChangeTreeData.fire();
  }

  setNoReport(): void {
    this.state = 'no-report';
    this._onDidChangeTreeData.fire();
  }

  setNotInstalled(): void {
    this.state = 'not-installed';
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof SeverityGroupItem) {
      return element.findings.map((f) => new FindingItem(f, this.workspaceRoot));
    }

    // Root level
    if (this.state === 'loading') {
      return [new EmptyItem('Analysing…')];
    }

    if (this.state === 'no-report') {
      return [new EmptyItem('Run "Thesmos: Scan Repository" to start')];
    }

    if (this.state === 'not-installed') {
      return [new EmptyItem('thesmos-governance not installed')];
    }

    if (this.state === 'idle') {
      return [];
    }

    if (this.findings.length === 0) {
      return [new EmptyItem('All governance checks passed')];
    }

    const hasBlockers = this.findings.some((f) => f.severity === 'BLOCKER');
    const byGroup = new Map<Severity, Finding[]>();

    for (const sev of SEVERITY_ORDER) {
      byGroup.set(sev, []);
    }

    for (const finding of this.findings) {
      byGroup.get(finding.severity)?.push(finding);
    }

    return SEVERITY_ORDER.filter((sev) => (byGroup.get(sev)?.length ?? 0) > 0).map(
      (sev) => new SeverityGroupItem(sev, byGroup.get(sev) ?? [], hasBlockers),
    );
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
