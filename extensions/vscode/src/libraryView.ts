// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Library view — Agents and Skills in a single TreeView (replaces the separate
 * Agents and Agent Activity sidebar panels).
 *
 * Two root sections:
 *   ● Agents  (67 Pantheon specialists, grouped by domain, invoke action)
 *   ● Skills  (stub — populated by Governed Skills v2)
 */

import * as vscode from 'vscode';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PANTHEON_SIDEBAR_AGENTS } from './generated/pantheon-sidebar';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentEntry {
  id: string;
  name: string;
  domain: string;
  role: string;
  model: string;
}

const AGENTS: AgentEntry[] = PANTHEON_SIDEBAR_AGENTS;

type ItemKind = 'section' | 'domain' | 'agent' | 'skillsPlaceholder';

// ── Tree items ─────────────────────────────────────────────────────────────────

class LibraryItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly itemKind: ItemKind,
    public readonly agent?: AgentEntry,
    collapsible = vscode.TreeItemCollapsibleState.None,
  ) {
    super(label, collapsible);
    this.contextValue = itemKind;
  }
}

// ── Provider ───────────────────────────────────────────────────────────────────

export class LibraryTreeProvider
  implements vscode.TreeDataProvider<LibraryItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<LibraryItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly domainGroups: Map<string, AgentEntry[]> = new Map();
  private readonly activeAgents = new Set<string>();
  private readonly workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    this.buildDomainGroups();
  }

  setActive(agentId: string, active: boolean): void {
    if (active) {
      this.activeAgents.add(agentId);
      this.logActivityEvent(agentId, 'spawn');
    } else {
      this.activeAgents.delete(agentId);
    }
    this._onDidChangeTreeData.fire();
  }

  private logActivityEvent(agentId: string, type: 'spawn' | 'complete'): void {
    try {
      const dir = join(this.workspaceRoot, '.thesmos');
      mkdirSync(dir, { recursive: true });
      const event = {
        ts: new Date().toISOString(),
        type,
        sessionId: 'sidebar',
        agentId: `sidebar-${agentId}-${randomUUID()}`,
        description: 'Invoked from Library',
        subagentType: agentId,
      };
      appendFileSync(join(dir, 'agent-activity.jsonl'), JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // Never let logging break the sidebar.
    }
  }

  private buildDomainGroups(): void {
    this.domainGroups.clear();
    for (const agent of AGENTS) {
      const group = this.domainGroups.get(agent.domain) ?? [];
      group.push(agent);
      this.domainGroups.set(agent.domain, group);
    }
  }

  getTreeItem(element: LibraryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: LibraryItem): LibraryItem[] {
    if (!element) {
      return [
        this.makeSection('Agents', `${AGENTS.length} specialists`),
        this.makeSection('Skills', 'Governed Skills v2 — coming soon'),
      ];
    }

    if (element.itemKind === 'section' && element.label === 'Agents') {
      return [...this.domainGroups.keys()].map((domain) => {
        const agents = this.domainGroups.get(domain)!;
        const item = new LibraryItem(domain, 'domain', undefined, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = `${agents.length}`;
        item.iconPath = new vscode.ThemeIcon('folder');
        return item;
      });
    }

    if (element.itemKind === 'domain') {
      const domain = String(element.label);
      return (this.domainGroups.get(domain) ?? []).map((agent) => {
        const isActive = this.activeAgents.has(agent.id);
        const item = new LibraryItem(agent.name, 'agent', agent);
        item.description = agent.role;
        item.tooltip = new vscode.MarkdownString(
          `**${agent.name}**\n\n${agent.role}\n\nModel: \`${agent.model || 'default'}\`\n\n_Click to invoke_`,
        );
        item.iconPath = isActive
          ? new vscode.ThemeIcon('sync~spin')
          : new vscode.ThemeIcon('person');
        item.command = {
          command: 'thesmos.agents.invoke',
          title: 'Invoke Agent',
          arguments: [agent],
        };
        return item;
      });
    }

    if (element.itemKind === 'section' && element.label === 'Skills') {
      const placeholder = new LibraryItem('Governed Skills v2 in development', 'skillsPlaceholder');
      placeholder.description = '';
      placeholder.iconPath = new vscode.ThemeIcon('sparkle');
      placeholder.tooltip = 'First-party Thesmos Skills with declared permissions and provenance — coming in PR 2.';
      return [placeholder];
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  private makeSection(label: string, description: string): LibraryItem {
    const item = new LibraryItem(label, 'section', undefined, vscode.TreeItemCollapsibleState.Expanded);
    item.description = description;
    item.iconPath = label === 'Agents'
      ? new vscode.ThemeIcon('person-add')
      : new vscode.ThemeIcon('extensions');
    return item;
  }
}

// Re-export what extension.ts currently imports from agentsPanel.ts
export { AgentEntry };
export type { AgentEntry as AgentInfo };

/** Shared invoke handler, called by the existing thesmos.agents.invoke command. */
export function invokeAgentCommand(agent: AgentEntry): AgentEntry { return agent; }
