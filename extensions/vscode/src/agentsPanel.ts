// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agents sidebar panel — lists Pantheon agents grouped by division.
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
import { PANTHEON_SIDEBAR_AGENTS } from './generated/pantheon-sidebar';

// ── Agent catalog ─────────────────────────────────────────────────────────────

interface AgentEntry {
  id: string;
  name: string;
  domain: string;
  role: string;
  model: string;
}

/** Catalog-driven from thesmos/catalog via export-agents.ts — never hand-edit the list. */
const AGENTS: AgentEntry[] = PANTHEON_SIDEBAR_AGENTS;

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
