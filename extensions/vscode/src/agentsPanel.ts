// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Agents sidebar panel — lists all 40 Pantheon agents grouped by domain.
 *
 * Shows:
 *   ● Strategy
 *   └── Athena — Business Strategy & GTM
 *   ● Marketing
 *   └── Hermes — Marketing Strategy & Growth
 *   …
 *
 * Each agent item has an [Invoke] inline action that opens a quick-input
 * prompt and then runs the agent via the Claude Code CLI.
 */

import * as vscode from 'vscode';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── Agent catalog ─────────────────────────────────────────────────────────────

interface AgentEntry {
  id: string;
  name: string;
  domain: string;
  role: string;
  model: string;
}

const AGENTS: AgentEntry[] = [
  { id: 'zeus-executive-agent',       name: 'Zeus',        domain: 'Executive',      role: 'Executive Orchestration',        model: 'claude-opus-4-8' },
  { id: 'athena-strategy-agent',      name: 'Athena',      domain: 'Strategy',       role: 'Business Strategy & GTM',        model: 'claude-opus-4-8' },
  { id: 'hermes-marketing-agent',     name: 'Hermes',      domain: 'Marketing',      role: 'Marketing Strategy & Growth',    model: 'claude-sonnet-4-6' },
  { id: 'argus-security-agent',       name: 'Argus',       domain: 'Security',       role: 'Security & Threat Modeling',     model: 'claude-opus-4-8' },
  { id: 'ares-sales-agent',           name: 'Ares',        domain: 'Sales',          role: 'Sales Strategy & Closing',       model: 'claude-sonnet-4-6' },
  { id: 'aphrodite-creative-agent',   name: 'Aphrodite',   domain: 'Creative',       role: 'Creative Direction & Brand',     model: 'claude-sonnet-4-6' },
  { id: 'hephaestus-design-agent',    name: 'Hephaestus',  domain: 'Design',         role: 'UI/UX & Design Systems',         model: 'claude-sonnet-4-6' },
  { id: 'themis-legal-agent',         name: 'Themis',      domain: 'Legal',          role: 'Legal Strategy & Contracts',     model: 'claude-sonnet-4-6' },
  { id: 'tyche-analytics-agent',      name: 'Tyche',       domain: 'Analytics',      role: 'Analytics & KPIs',               model: 'claude-sonnet-4-6' },
  { id: 'plutus-finance-agent',       name: 'Plutus',      domain: 'Finance',        role: 'Finance, Pricing & Unit Econ',   model: 'claude-sonnet-4-6' },
  { id: 'pheme-pr-agent',             name: 'Pheme',       domain: 'PR',             role: 'PR & Communications',            model: 'claude-sonnet-4-6' },
  { id: 'apollo-content-agent',       name: 'Apollo',      domain: 'Content',        role: 'Content & Copywriting',          model: 'claude-sonnet-4-6' },
  { id: 'daedalus-product-agent',     name: 'Daedalus',    domain: 'Product',        role: 'Product Management',             model: 'claude-sonnet-4-6' },
  { id: 'hera-operations-agent',      name: 'Hera',        domain: 'Operations',     role: 'Operations & HR',                model: 'claude-sonnet-4-6' },
  { id: 'nike-leadgen-agent',         name: 'Nike',        domain: 'Lead Gen',       role: 'Lead Generation & Pipeline',     model: 'claude-sonnet-4-6' },
  { id: 'heracles-bd-agent',          name: 'Heracles',    domain: 'Biz Dev',        role: 'Business Dev & Partnerships',    model: 'claude-sonnet-4-6' },
  { id: 'mnemosyne-knowledge-agent',  name: 'Mnemosyne',   domain: 'Knowledge',      role: 'Knowledge Management',           model: 'claude-sonnet-4-6' },
  { id: 'hestia-cx-agent',            name: 'Hestia',      domain: 'Customer Exp',   role: 'Customer Experience',            model: 'claude-sonnet-4-6' },
  { id: 'demeter-cs-agent',           name: 'Demeter',     domain: 'Customer Succ',  role: 'Customer Success',               model: 'claude-sonnet-4-6' },
  { id: 'psyche-research-agent',      name: 'Psyche',      domain: 'Research',       role: 'UX Research & Insights',         model: 'claude-sonnet-4-6' },
  { id: 'nemesis-compliance-agent',   name: 'Nemesis',     domain: 'Compliance',     role: 'Compliance & GRC',               model: 'claude-sonnet-4-6' },
  { id: 'pythia-data-agent',          name: 'Pythia',      domain: 'Data',           role: 'Data & Business Intelligence',   model: 'claude-sonnet-4-6' },
  { id: 'dionysus-video-agent',       name: 'Dionysus',    domain: 'Video',          role: 'Video Production',               model: 'claude-haiku-4-5-20251001' },
  { id: 'morpheus-animation-agent',   name: 'Morpheus',    domain: 'Animation',      role: 'Animation & Motion',             model: 'claude-haiku-4-5-20251001' },
  { id: 'artemis-photography-agent',  name: 'Artemis',     domain: 'Photography',    role: 'Photography & Art Direction',    model: 'claude-haiku-4-5-20251001' },
  { id: 'dike-ethics-agent',          name: 'Dike',        domain: 'Ethics',         role: 'Ethics & AI Responsibility',     model: 'claude-sonnet-4-6' },
  { id: 'aether-ai-strategy-agent',   name: 'Aether',      domain: 'AI Strategy',    role: 'AI Strategy & Implementation',   model: 'claude-sonnet-4-6' },
  { id: 'calliope-email-agent',       name: 'Calliope',    domain: 'Email',          role: 'Email & Newsletter',             model: 'claude-haiku-4-5-20251001' },
  { id: 'cassandra-qa-agent',         name: 'Cassandra',   domain: 'QA',             role: 'QA & Testing',                   model: 'claude-sonnet-4-6' },
  { id: 'chiron-architecture-agent',  name: 'Chiron',      domain: 'Architecture',   role: 'Software Architecture',          model: 'claude-sonnet-4-6' },
  { id: 'clio-case-study-agent',      name: 'Clio',        domain: 'Case Studies',   role: 'Case Studies & Social Proof',    model: 'claude-haiku-4-5-20251001' },
  { id: 'eos-automation-agent',       name: 'Eos',         domain: 'Automation',     role: 'Automation & Workflows',         model: 'claude-sonnet-4-6' },
  { id: 'erato-brand-voice-agent',    name: 'Erato',       domain: 'Brand Voice',    role: 'Brand Voice & Tone',             model: 'claude-haiku-4-5-20251001' },
  { id: 'kratos-devops-agent',        name: 'Kratos',      domain: 'DevOps',         role: 'DevOps & Infrastructure',        model: 'claude-sonnet-4-6' },
  { id: 'metis-pm-agent',             name: 'Metis',       domain: 'Proj Mgmt',      role: 'Project Management',             model: 'claude-sonnet-4-6' },
  { id: 'momus-challenger-agent',     name: 'Momus',       domain: 'Challenger',     role: "Devil's Advocate & Critique",    model: 'claude-sonnet-4-6' },
  { id: 'polyhymnia-docs-agent',      name: 'Polyhymnia',  domain: 'Docs',           role: 'Documentation & Technical Docs', model: 'claude-haiku-4-5-20251001' },
  { id: 'proteus-drift-agent',        name: 'Proteus',     domain: 'Drift',          role: 'Scope Drift Detection',          model: 'claude-sonnet-4-6' },
  { id: 'talos-web-dev-agent',        name: 'Talos',       domain: 'Web Dev',        role: 'Web Development',                model: 'claude-sonnet-4-6' },
  { id: 'coeus-ideation-agent',       name: 'Coeus',       domain: 'Ideation',       role: 'Ideation & Brainstorming',       model: 'claude-sonnet-4-6' },
];

// ── Tree items ────────────────────────────────────────────────────────────────

type AgentItemKind = 'domain' | 'agent';

class AgentTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: AgentItemKind,
    public readonly agent?: AgentEntry,
    collapsible = vscode.TreeItemCollapsibleState.None,
  ) {
    super(label, collapsible);
    this.contextValue = kind;
  }
}

// ── Tree provider ─────────────────────────────────────────────────────────────

export class AgentsTreeProvider
  implements vscode.TreeDataProvider<AgentTreeItem>, vscode.Disposable {

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private domainGroups: Map<string, AgentEntry[]> = new Map();
  private activeAgents = new Set<string>();
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    this.rebuild();
  }

  setActive(agentId: string, active: boolean): void {
    if (active) {
      this.activeAgents.add(agentId);
      this.appendActivityEvent(agentId, 'spawn');
    } else {
      this.activeAgents.delete(agentId);
    }
    this._onDidChangeTreeData.fire();
  }

  private appendActivityEvent(agentId: string, type: 'spawn' | 'complete'): void {
    try {
      const dir = join(this.workspaceRoot, '.thesmos');
      mkdirSync(dir, { recursive: true });
      const event = {
        ts: new Date().toISOString(),
        type,
        sessionId: 'sidebar',
        agentId: `sidebar-${agentId}-${randomUUID()}`,
        description: `Invoked from sidebar`,
        subagentType: agentId,
      };
      appendFileSync(join(dir, 'agent-activity.jsonl'), JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // non-fatal — never let logging break the sidebar
    }
  }

  private rebuild(): void {
    this.domainGroups.clear();
    for (const agent of AGENTS) {
      const group = this.domainGroups.get(agent.domain) ?? [];
      group.push(agent);
      this.domainGroups.set(agent.domain, group);
    }
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): AgentTreeItem[] {
    if (!element) {
      return [...this.domainGroups.keys()].map((domain) => {
        const agents = this.domainGroups.get(domain)!;
        const item = new AgentTreeItem(
          domain,
          'domain',
          undefined,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.description = `${agents.length} agent${agents.length === 1 ? '' : 's'}`;
        item.iconPath = new vscode.ThemeIcon('symbol-namespace');
        return item;
      });
    }

    if (element.kind === 'domain') {
      const agents = this.domainGroups.get(element.label as string) ?? [];
      return agents.map((agent) => {
        const isActive = this.activeAgents.has(agent.id);
        const item = new AgentTreeItem(agent.name, 'agent', agent);
        item.description = isActive ? 'working…' : agent.role;
        item.tooltip = new vscode.MarkdownString(
          `**${agent.name}** — ${agent.role}\n\n` +
          `Model: \`${agent.model}\`\n\n` +
          `Invoke via Claude Code:\n\`\`\`\nAgent({ subagent_type: "${agent.id}", prompt: "<task>" })\n\`\`\``,
        );
        item.iconPath = new vscode.ThemeIcon(isActive ? 'sync~spin' : 'person');
        item.command = {
          command: 'thesmos.agents.invoke',
          title: 'Invoke Agent',
          arguments: [agent],
        };
        return item;
      });
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

// ── Invoke command handler ─────────────────────────────────────────────────────

export async function invokeAgentCommand(agent?: AgentEntry): Promise<void> {
  if (!agent) return;

  const task = await vscode.window.showInputBox({
    title: `Invoke ${agent.name} — ${agent.role}`,
    prompt: 'Describe the task for this agent',
    placeHolder: 'e.g. Draft a competitive analysis for our Q3 launch',
  });
  if (!task) return;

  const snippet = `Agent({ subagent_type: "${agent.id}", prompt: "${task.replace(/"/g, '\\"')}" })`;
  await vscode.env.clipboard.writeText(snippet);

  void vscode.window.showInformationMessage(
    `Copied invocation for ${agent.name} to clipboard. Paste it into Claude Code.`,
    'Open Terminal',
  ).then((choice) => {
    if (choice === 'Open Terminal') {
      const terminal = vscode.window.createTerminal('Thesmos Agent');
      terminal.show();
    }
  });
}
