// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * PantheonChatController — hosts the Pantheon Chat webview (sidebar view and
 * optional editor tab), owns the ClaudeSession subprocess, and shapes raw
 * stream events into the UI item protocol consumed by webview/chat.ts.
 *
 * One controller = one live conversation. Both webview hosts render the same
 * conversation; history is replayed to any webview that (re)attaches.
 */

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeSession, type SessionEvent, type PermissionMode } from './claudeSession.js';
import { CodexSession } from './codexSession.js';
import { CheckpointManager } from './checkpointManager.js';
import { GodMapper, type GodEntry } from './godMapper.js';
import { PermissionBridge, type PermissionRequest } from './permissionBridge.js';
import { ProviderManager } from './providerManager.js';
import { listSessions, loadTranscript } from './sessionHistory.js';
import { appendSavings, estimateTierSaving, monthSavingsUsd } from './savingsLedger.js';
import { runReview, ThesmosNotFoundError } from '../runner.js';
import type { Finding } from '../types.js';
import { runAdvise, shouldGate, budgetState, type DispatchAdvice } from './dispatchAdvisor.js';

interface GodUiInfo extends GodEntry {}

/** Both classes share the id/running/start/send/stop/dispose surface the controller needs. */
type AgentSession = ClaudeSession | CodexSession;

type UiItem =
  | { kind: 'user'; text: string; checkpointId?: string; queued?: boolean }
  | { kind: 'assistant'; text: string; god?: { emoji: string; name: string; color: string } }
  | { kind: 'zeus'; text: string }
  | { kind: 'god'; toolUseId: string; god: GodUiInfo; description: string; status: 'running' | 'done' | 'error'; summary?: string; startedAt: number; durationMs?: number; model?: string }
  | { kind: 'tool'; name: string; label: string }
  | { kind: 'diff'; file: string; oldText?: string; newText: string }
  | { kind: 'permission'; requestId: string; toolName: string; label: string; status: 'pending' | 'allowed' | 'denied' }
  | { kind: 'todo'; id: string; todos: TodoEntry[] }
  | { kind: 'governance'; findings: GovernanceFinding[]; fileCount: number }
  | { kind: 'dispatchOrder'; orderId: string; advice: DispatchAdvice; budgetLine: string | null; status: 'pending' | 'approved' | 'skipped' | 'dismissed' }
  | { kind: 'error'; text: string }
  | { kind: 'turnFooter'; text: string };

interface GovernanceFinding {
  severity: string;
  category: string;
  file: string;
  line?: number;
  message: string;
}

interface TodoEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

interface PersistedChat {
  items: UiItem[];
  sessionId?: string;
  permissionMode?: PermissionMode;
  totalCostUsd?: number;
  modelId?: string;
}

const STATE_KEY = 'thesmos.pantheonChat.state';
const DIFF_PREVIEW_CHARS = 2000;
/** Standard (non-1M) Claude context window, used to compute the live usage meter %. */
const CONTEXT_WINDOW_TOKENS = 200_000;

const AGENT_TOOL_NAMES = new Set(['Agent', 'Task']);
const ZEUS_BANNER = /^⚡\s*ZEUS/u;
/** Lean-tier routing line: "⚡ ZEUS · 👁 Argus — Security & Threat Modeling". */
const ZEUS_LEAN_LINE = /^⚡\s*ZEUS\s*·\s*(.+)$/u;

/**
 * Appended to the CLI's system prompt so headless Pantheon Chat sessions feel
 * like the council chamber: every reply opens with the lean routing line and
 * matching gods actually get dispatched instead of silently answered inline.
 */
const PANTHEON_SYSTEM_PROMPT =
  'You are rendering inside Pantheon Chat, the Thesmos council chamber. ' +
  "Open EVERY response with exactly one lean routing line: '⚡ ZEUS · <emoji> <God> — <domain>' " +
  "when the task matches a Pantheon domain, or '⚡ ZEUS · direct response' otherwise — then answer " +
  "in that god's voice, economically. When a task clearly matches a Pantheon specialist's domain, " +
  'dispatch that god as a subagent via the Agent tool (one specialist by default; councils of 2-3 ' +
  'only for genuinely cross-domain work). Per AGNT_031 model discipline, prefer lighter models for ' +
  'mechanical subagent work and reserve heavier models for architecture or customer-facing output.';

/** One-line label for a non-agent tool call. */
function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return String(input.command ?? '').slice(0, 120);
    case 'Read':
    case 'Write':
    case 'Edit':
      return String(input.file_path ?? '').replace(/^.*\//, '…/');
    case 'Grep':
      return String(input.pattern ?? '').slice(0, 80);
    case 'Glob':
      return String(input.pattern ?? '');
    case 'WebFetch':
    case 'WebSearch':
      return String(input.url ?? input.query ?? '').slice(0, 100);
    case 'CodexCommand':
      return String(input.command ?? '').slice(0, 120);
    case 'CodexFileChange':
      return String(input.summary ?? '').slice(0, 120);
    default: {
      const first = Object.values(input)[0];
      return typeof first === 'string' ? first.slice(0, 100) : '';
    }
  }
}

/** Stable per-workspace directory name for the shadow checkpoint repo. */
function workspaceKey(root: string): string {
  return root.replace(/[^a-zA-Z0-9]/g, '-').slice(-80);
}

/** Read sessionMaxCostUSD from .thesmos/config.json → tokenBudget, returning undefined if absent. */
function readSessionBudget(workspaceRoot: string): number | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(workspaceRoot, '.thesmos', 'config.json'), 'utf-8')) as Record<string, unknown>;
    const tb = raw['tokenBudget'] as Record<string, unknown> | undefined;
    const v = Number(tb?.['sessionMaxCostUSD']);
    return isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read `model:` pinned in agent definition frontmatter (.claude/agents/*.md,
 * project then user scope) keyed by the god's lowercase first name — so god
 * bubbles can show which model each god actually runs on.
 */
function loadAgentModels(workspaceRoot: string): Map<string, string> {
  const models = new Map<string, string>();
  const { readdirSync, readFileSync } = require('node:fs') as typeof import('node:fs');
  const { homedir } = require('node:os') as typeof import('node:os');
  for (const dir of [join(homedir(), '.claude', 'agents'), join(workspaceRoot, '.claude', 'agents')]) {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const head = readFileSync(join(dir, file), 'utf-8').slice(0, 2000);
        const name = /^name:\s*(.+)$/m.exec(head)?.[1]?.trim();
        const model = /^model:\s*(\S+)/m.exec(head)?.[1]?.trim();
        if (!name || !model) continue;
        const key = name.replace(/^[^\p{L}]+/u, '').split(/[\s—–-]/)[0]?.toLowerCase();
        if (key) models.set(key, model); // project scope wins (scanned second)
      } catch {
        continue;
      }
    }
  }
  return models;
}

/** Fuller description for the permission dialog — the user is deciding, so show more. */
function permissionLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      // Security (Argus HIGH-1): never truncate the command the user is consenting to —
      // a hidden tail past a cutoff defeats informed consent. The webview renders this
      // as textContent in a scrollable block, so the full string is safe to send.
      return String(input.command ?? '');
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return String(input.file_path ?? '');
    case 'WebFetch':
      return String(input.url ?? '');
    default:
      return toolLabel(name, input);
  }
}

export class PantheonChatController implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'thesmos.pantheonChat';

  private readonly godMapper: GodMapper;
  private readonly webviews = new Set<vscode.Webview>();
  private readonly history: UiItem[] = [];
  private readonly godStart = new Map<string, number>();
  private session: AgentSession | undefined;
  private model: string | undefined;
  private permissionMode: PermissionMode = 'default';
  private lastSessionId: string | undefined;
  private totalCostUsd = 0;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];
  private permissionBridge: PermissionBridge | undefined;
  private readonly alwaysAllowed = new Set<string>();

  private readonly checkpoints: CheckpointManager;
  private checkpointsUnavailableNoted = false;
  private currentTodoId: string | undefined;
  private readonly promptQueue: Array<{ text: string; attachments: string[] }> = [];
  private turnRunning = false;
  /** Prompt held while its Dispatch Order card awaits approval. */
  private pendingDispatch:
    | { orderId: string; text: string; attachments: string[]; advice: DispatchAdvice }
    | undefined;
  /** True once an 80% budget warning has been shown this session. */
  private budgetWarned = false;
  private readonly turnChangedFiles = new Set<string>();
  private governanceUnavailable = false;
  private agentModels: Map<string, string> = new Map();
  private currentActivity: string | null = null;
  /** Persistent phase shown in the status strip for the whole turn (Thinking / Writing / Compacting / …). */
  private currentPhase: string | null = null;
  /** Latest input-context size (tokens) reported by the model, for the live usage meter. */
  private contextTokens = 0;
  private readonly providers: ProviderManager;
  private modelId = '';

  // Credit Guardian — estimated savings vs flagship baseline (see savingsLedger.ts).
  private savedUsdSession = 0;
  private savingsCacheAt: number | undefined;
  private savingsCacheVal = 0;
  /** Session cost ceiling from .thesmos/config.json tokenBudget.sessionMaxCostUSD. */
  private readonly sessionBudgetUsd: number | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceRoot: string,
  ) {
    this.godMapper = new GodMapper(workspaceRoot);
    this.agentModels = loadAgentModels(workspaceRoot);
    this.providers = new ProviderManager(context);
    this.checkpoints = new CheckpointManager(
      workspaceRoot,
      vscode.Uri.joinPath(this.context.globalStorageUri, 'checkpoints', workspaceKey(workspaceRoot)).fsPath,
    );
    this.sessionBudgetUsd = readSessionBudget(workspaceRoot);
    this.restore();
  }

  /** Create a session with the current mode/model/provider. Null = key not linked. */
  private async createSession(resumeId: string | undefined): Promise<AgentSession | null> {
    const preset = this.providers.active;
    const env = await this.providers.envForActive();
    if (env === null) {
      this.pushItem({
        kind: 'error',
        text: `${preset.label} needs a linked API key — click the provider button in the header.`,
      });
      return null;
    }
    if (preset.cli === 'codex') {
      // Codex's own permission model (--ask-for-approval) is set inside
      // CodexSession — the in-chat permission dialog is Claude-only for now.
      return new CodexSession(this.workspaceRoot, (e) => this.onSessionEvent(e), resumeId, {
        model: this.modelId || undefined,
      });
    }
    return new ClaudeSession(
      this.workspaceRoot,
      (e) => this.onSessionEvent(e),
      this.permissionMode,
      resumeId,
      this.permissionGate(),
      { model: this.modelId || undefined, env, appendSystemPrompt: PANTHEON_SYSTEM_PROMPT },
    );
  }

  /** Live "what are the gods doing right now" strip above the composer. */
  private setActivity(text: string | null): void {
    if (text === this.currentActivity) return;
    this.currentActivity = text;
    this.broadcast({ type: 'activity', text });
  }

  /**
   * Persistent phase label for the status strip. Unlike setActivity (which the
   * streaming bubble clears), this stays visible for the whole turn so the user
   * always knows the state — including compaction and inter-tool gaps.
   */
  private setPhase(text: string | null): void {
    if (text === this.currentPhase) return;
    this.currentPhase = text;
    this.broadcast({ type: 'phase', text });
  }

  /** Push the live context-window usage to the strip meter. */
  private updateUsage(contextTokens: number): void {
    if (contextTokens <= this.contextTokens) return; // monotonic within a turn
    this.contextTokens = contextTokens;
    const pct = Math.min(100, Math.round((contextTokens / CONTEXT_WINDOW_TOKENS) * 100));
    this.broadcast({ type: 'usage', contextTokens, contextPct: pct });
  }

  /** Restart the subprocess (mode/model/provider changed) but keep the conversation. */
  private async restartSession(): Promise<void> {
    const resumeId = this.session?.id ?? this.lastSessionId;
    this.session?.dispose();
    this.session = (await this.createSession(resumeId)) ?? undefined;
    this.broadcastProviderInfo();
    this.broadcast({
      type: 'status',
      running: false,
      model: this.model,
      sessionId: this.session?.id,
      permissionMode: this.permissionMode,
      totalCostUsd: this.totalCostUsd,
    });
  }

  private broadcastProviderInfo(): void {
    const preset = this.providers.active;
    this.broadcast({
      type: 'providerInfo',
      label: preset.label,
      models: preset.models,
      currentModel: this.modelId,
    });
  }

  /** Lazily create and start the permission bridge for this conversation. */
  private ensureBridge(): PermissionBridge {
    if (!this.permissionBridge) {
      // The socket path gates tool approval — the nonce must be unguessable.
      const nonce = randomBytes(16).toString('hex');
      this.permissionBridge = new PermissionBridge(nonce, (req) => this.onPermissionRequest(req));
      this.permissionBridge.start();
    }
    return this.permissionBridge;
  }

  private onPermissionRequest(req: PermissionRequest): void {
    if (this.alwaysAllowed.has(req.toolName)) {
      this.permissionBridge?.respond(req.requestId, { decision: 'allow' });
      return;
    }
    this.pushItem({
      kind: 'permission',
      requestId: req.requestId,
      toolName: req.toolName,
      label: permissionLabel(req.toolName, req.toolInput),
      status: 'pending',
    });
  }

  private resolvePermission(requestId: string, decision: 'allow' | 'deny', alwaysAllow: boolean): void {
    const item = this.history.find(
      (i): i is Extract<UiItem, { kind: 'permission' }> => i.kind === 'permission' && i.requestId === requestId,
    );
    if (!item || item.status !== 'pending') return;
    // Answer the pending request immediately; the one-shot status guard above makes this safe.
    item.status = decision === 'allow' ? 'allowed' : 'denied';
    this.permissionBridge?.respond(requestId, { decision });
    this.broadcast({ type: 'permissionResolved', requestId, status: item.status });
    this.schedulePersist();
    // Session-wide always-allow is a privilege escalation — gate it separately (Argus HIGH-2).
    if (alwaysAllow && decision === 'allow') void this.grantAlwaysAllow(item.toolName);
  }

  /**
   * Grant session-wide auto-approval for a tool, gated behind a native modal.
   * Bash is excluded entirely — a blanket grant would auto-run any shell command.
   */
  private async grantAlwaysAllow(toolName: string): Promise<void> {
    if (toolName === 'Bash') {
      void vscode.window.showWarningMessage(
        'Bash is never added to always-allow — each shell command is reviewed on its own.',
      );
      return;
    }
    const ok = await vscode.window.showWarningMessage(
      `Auto-approve every ${toolName} call for the rest of this session, without asking again?`,
      { modal: true },
      'Enable',
    );
    if (ok === 'Enable') this.alwaysAllowed.add(toolName);
  }

  /** Restore the last conversation after a window reload. */
  private restore(): void {
    const saved = this.context.workspaceState.get<PersistedChat>(STATE_KEY);
    if (!saved || !Array.isArray(saved.items) || saved.items.length === 0) return;
    // God bubbles can never still be running after a reload, and a pending
    // permission request has no live socket to resolve it against anymore.
    for (const item of saved.items) {
      if (item.kind === 'god' && item.status === 'running') item.status = 'done';
      if (item.kind === 'permission' && item.status === 'pending') item.status = 'denied';
    }
    // The prompt queue is in-memory only — queued bubbles never sent are dropped.
    this.history.push(...saved.items.filter((i) => !(i.kind === 'user' && i.queued === true)));
    this.lastSessionId = saved.sessionId;
    this.permissionMode = saved.permissionMode ?? 'default';
    this.totalCostUsd = saved.totalCostUsd ?? 0;
    this.modelId = saved.modelId ?? '';
    const lastTodo = [...saved.items].reverse().find((i): i is Extract<UiItem, { kind: 'todo' }> => i.kind === 'todo');
    this.currentTodoId = lastTodo?.id;
  }

  private schedulePersist(): void {
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      const state: PersistedChat = {
        items: this.history.slice(-200),
        sessionId: this.session?.id ?? this.lastSessionId,
        permissionMode: this.permissionMode,
        totalCostUsd: this.totalCostUsd,
        modelId: this.modelId,
      };
      void this.context.workspaceState.update(STATE_KEY, state);
    }, 400);
  }

  // ── Webview hosting ─────────────────────────────────────────────────────

  private sidebarVisible = false;
  private panelVisible = false;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.attach(view.webview);
    this.sidebarVisible = view.visible;
    view.onDidChangeVisibility(() => {
      this.sidebarVisible = view.visible;
    });
    view.onDidDispose(() => {
      this.sidebarVisible = false;
      this.webviews.delete(view.webview);
    });
  }

  private tabPanel: vscode.WebviewPanel | undefined;

  openInTab(): void {
    if (this.tabPanel) {
      this.tabPanel.reveal();
      return;
    }
    const location = vscode.workspace.getConfiguration('thesmos').get<string>('chat.openLocation', 'beside');
    const column = location === 'active' ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
    const panel = vscode.window.createWebviewPanel(
      'thesmos.pantheonChatTab',
      '⚡ Pantheon Chat',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.tabPanel = panel;
    this.attach(panel.webview);
    this.panelVisible = panel.visible;
    panel.onDidChangeViewState((e) => {
      this.panelVisible = e.webviewPanel.visible;
    });
    panel.onDidDispose(() => {
      this.webviews.delete(panel.webview);
      this.tabPanel = undefined;
      this.panelVisible = false;
    });
  }

  private attach(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
    };
    webview.html = this.buildHtml(webview);
    this.webviews.add(webview);
    this.disposables.push(
      webview.onDidReceiveMessage((msg: {
        type: string;
        text?: string;
        mode?: string;
        attachments?: string[];
        data?: string;
        mime?: string;
        name?: string;
        requestId?: string;
        decision?: string;
        alwaysAllow?: boolean;
        checkpointId?: string;
        model?: string;
        orderId?: string;
      }) => {
        switch (msg.type) {
          case 'ready':
            this.post(webview, { type: 'history', items: this.history });
            this.broadcastProviderInfo();
            this.post(webview, {
              type: 'status',
              running: this.session?.running ?? false,
              model: this.model,
              sessionId: this.session?.id,
              permissionMode: this.permissionMode,
              totalCostUsd: this.totalCostUsd,
            });
            break;
          case 'send':
            if (typeof msg.text === 'string') {
              void this.sendPrompt(msg.text, Array.isArray(msg.attachments) ? msg.attachments : []);
            }
            break;
          case 'restore':
            if (typeof msg.checkpointId === 'string') void this.restoreCheckpoint(msg.checkpointId);
            break;
          case 'stop':
            this.stop();
            break;
          case 'newSession':
            this.newSession();
            break;
          case 'setPermissionMode':
            if (msg.mode === 'default' || msg.mode === 'acceptEdits' || msg.mode === 'plan' || msg.mode === 'auto') {
              void this.setPermissionMode(msg.mode);
            }
            break;
          case 'setModel':
            if (typeof msg.model === 'string') void this.setModel(msg.model);
            break;
          case 'pickProvider':
            void this.pickProvider();
            break;
          case 'permissionResponse':
            if (typeof msg.requestId === 'string' && (msg.decision === 'allow' || msg.decision === 'deny')) {
              this.resolvePermission(msg.requestId, msg.decision, msg.alwaysAllow === true);
            }
            break;
          case 'dispatchApprove':
            if (typeof msg.orderId === 'string') this.resolveDispatch(msg.orderId, 'approved');
            break;
          case 'dispatchSkip':
            if (typeof msg.orderId === 'string') this.resolveDispatch(msg.orderId, 'skipped');
            break;
          case 'pickImage':
            void this.pickImages(webview);
            break;
          case 'listFiles':
            void this.listWorkspaceFiles(webview);
            break;
          case 'openChronicles':
            void this.openChronicles();
            break;
          case 'openInTab':
            this.openInTab();
            break;
          case 'exportRecord':
            void this.exportCouncilRecord();
            break;
          case 'openBudgetConfig':
            void vscode.workspace.openTextDocument(
              vscode.Uri.file(join(this.workspaceRoot, '.thesmos', 'config.json'))
            ).then((doc) => vscode.window.showTextDocument(doc));
            break;
          case 'pasteImage':
            if (typeof msg.data === 'string' && msg.data.length > 0) {
              this.savePastedImage(webview, msg.data, msg.mime ?? 'image/png');
            }
            break;
          case 'dropFile':
            if (typeof msg.data === 'string' && typeof msg.name === 'string' && msg.data.length > 0) {
              this.saveDroppedFile(webview, msg.data, msg.name, msg.mime ?? 'application/octet-stream');
            }
            break;
        }
      }),
    );
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'chat.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'pantheon.css'),
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Pantheon Chat</title>
</head>
<body>
  <div id="app">
    <div id="header">
      <span class="title">⚡ PANTHEON</span>
      <span class="session-meta" id="session-meta"></span>
      <span id="savings" title="Credit Guardian — estimated savings vs flagship baseline. Ledger: .thesmos/savings.jsonl"></span>
      <select id="model-select" title="Model for this session"></select>
      <button id="provider-btn" title="LLM provider — link Anthropic, GLM, Kimi, DeepSeek, or a custom proxy (GPT/Gemini)">⚡</button>
      <button id="chronicles" title="Chronicles — reopen a past session">📜</button>
      <button id="export-record" title="Export this session as a Council Record (markdown)">📤</button>
      <button id="open-tab" title="Open in editor tab">↗️</button>
      <button id="new-session" title="New session">⟳ New</button>
    </div>
    <div id="budget-bar-wrap" title="Session cost — click to edit budget in .thesmos/config.json">
      <span id="budget-cost">$0.0000</span>
      <div id="budget-bar"><div id="budget-fill"></div></div>
      <span id="budget-ceiling"></span>
    </div>
    <div id="log"></div>
    <div id="empty">
      <div class="glyph">🏛️</div>
      <div class="headline">THE COUNCIL AWAITS</div>
      <div>Describe your task — Zeus will route it to the right god.</div>
      <div class="first-prompts">
        <button class="suggest" data-prompt="Have Argus review my most recently changed files for security issues">👁 Argus: review my recent changes</button>
        <button class="suggest" data-prompt="What is the current health of this repo? Summarize the top findings.">⚖ Judge this repo's health</button>
        <button class="suggest" data-prompt="Explain what Thesmos governance is enforcing in this workspace">📜 What laws govern this place?</button>
      </div>
    </div>
    <div id="attachments"></div>
    <div id="status-strip">
      <span class="spinner"></span>
      <span id="phase-label"></span>
      <div id="usage-meter" title="Context window usage">
        <div class="usage-bar"><div id="usage-fill"></div></div>
        <span id="usage-text"></span>
      </div>
    </div>
    <div id="mention-popup" class="hidden"></div>
    <div id="composer">
      <select id="mode" title="Permission mode — auto lets Claude's AI classifier approve safe tool calls and block dangerous ones without prompting">
        <option value="default">🛡 default</option>
        <option value="acceptEdits">✏️ accept edits</option>
        <option value="auto">⚡ auto</option>
        <option value="plan">🗺 plan</option>
      </select>
      <button id="attach" title="Attach image">📎</button>
      <textarea id="input" rows="1" placeholder="Summon the gods…"></textarea>
      <button id="send" title="Send (Enter)">Send</button>
      <button id="stop" title="Stop the current turn">■ Stop</button>
    </div>
  </div>
  <script src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

  // ── Conversation control ────────────────────────────────────────────────

  /**
   * The in-chat dialog gate applies in default/acceptEdits modes, where
   * headless mode would otherwise silently deny ungranted tools. `auto`
   * delegates to the CLI's own AI classifier and `plan` doesn't execute —
   * neither needs (or wants) our dialogs.
   */
  private permissionGate(): { socketPath: string; hookScriptPath: string } | undefined {
    if (this.permissionMode !== 'default' && this.permissionMode !== 'acceptEdits') return undefined;
    return {
      socketPath: this.ensureBridge().socketPath,
      hookScriptPath: this.hookScriptPath(),
    };
  }

  private userDisplayText(text: string, attachments: string[]): string {
    const names = attachments.map((p) => p.split('/').pop() ?? p);
    return [text, ...names.map((n) => `📎 ${n}`)].filter(Boolean).join('\n');
  }

  private async sendPrompt(text: string, attachments: string[] = []): Promise<void> {
    // Budget enforcement (fail-closed): re-read the ceiling each send so the
    // user can raise it in .thesmos/config.json and immediately continue.
    const budget = readSessionBudget(this.workspaceRoot);
    if (budgetState(this.totalCostUsd, budget) === 'exceeded') {
      this.pushItem({
        kind: 'error',
        text:
          `⛔ Session budget reached (~$${this.totalCostUsd.toFixed(2)} of $${budget!.toFixed(2)}). ` +
          `Raise tokenBudget.sessionMaxCostUSD in .thesmos/config.json (click the budget bar) or start a new session.`,
      });
      return;
    }

    if (this.turnRunning) {
      // A turn is live — queue this prompt and dispatch it when the turn ends.
      this.promptQueue.push({ text, attachments });
      this.pushItem({ kind: 'user', text: this.userDisplayText(text, attachments), queued: true });
      return;
    }

    // A newer prompt supersedes any card still awaiting approval.
    if (this.pendingDispatch) this.resolveDispatch(this.pendingDispatch.orderId, 'dismissed');

    // Dispatch Order gate — deterministic advise heuristic, $0, fail-open.
    const advice = await runAdvise(this.workspaceRoot, text);
    if (advice && shouldGate(advice, this.permissionMode)) {
      const orderId = `do-${Date.now().toString(36)}`;
      this.pendingDispatch = { orderId, text, attachments, advice };
      const budgetLine =
        budget !== undefined
          ? `$${this.totalCostUsd.toFixed(2)} of $${budget.toFixed(2)} session budget used`
          : null;
      this.pushItem({ kind: 'dispatchOrder', orderId, advice, budgetLine, status: 'pending' });
      return;
    }

    await this.dispatchPrompt(text, attachments, false);
  }

  /** Resolve a pending Dispatch Order card: approve routes + dispatches, skip dispatches as-is. */
  private resolveDispatch(orderId: string, status: 'approved' | 'skipped' | 'dismissed'): void {
    const card = this.history.find(
      (i): i is Extract<UiItem, { kind: 'dispatchOrder' }> =>
        i.kind === 'dispatchOrder' && i.orderId === orderId,
    );
    if (card && card.status === 'pending') {
      card.status = status;
      this.broadcast({ type: 'dispatchResolved', orderId, status });
      this.schedulePersist();
    }
    const pending = this.pendingDispatch;
    if (!pending || pending.orderId !== orderId) return;
    this.pendingDispatch = undefined;
    if (status === 'dismissed') return;

    let prompt = pending.text;
    if (status === 'approved') {
      // Approval steers routing: name the approved gods so Zeus dispatches them,
      // and apply the recommended model tier (AGNT_031) for the whole turn.
      if (pending.advice.agents.length > 0) {
        const roster = pending.advice.agents.map((a) => `${a.emoji} ${a.name} (${a.domain})`).join(', ');
        prompt += `\n\n⚡ Approved dispatch order: engage ${roster} as subagents for their domains.`;
      }
      const rec = pending.advice.recommendation.claudeModel;
      if (rec && rec !== this.modelId && this.providers.active.id === 'anthropic') {
        void this.setModel(rec).then(() => this.dispatchPrompt(prompt, pending.attachments, false));
        return;
      }
    }
    void this.dispatchPrompt(prompt, pending.attachments, false);
  }

  private async dispatchPrompt(text: string, attachments: string[], dequeued: boolean): Promise<void> {
    if (!this.session) {
      // Resume the restored conversation, if any.
      this.session = (await this.createSession(this.lastSessionId)) ?? undefined;
      if (!this.session) return;
    }
    this.turnRunning = true;
    this.turnChangedFiles.clear();

    const checkpointId = await this.checkpoints.snapshot(text.slice(0, 72));
    if (checkpointId === undefined && !this.checkpointsUnavailableNoted) {
      this.checkpointsUnavailableNoted = true;
      this.pushItem({ kind: 'error', text: 'Checkpoints unavailable — git was not found on this machine.' });
    }

    if (dequeued) {
      // The queued bubble already exists — promote it in place with its
      // checkpoint (snapshotted now, at dispatch, not when it was typed).
      const queuedItem = this.history.find(
        (i): i is Extract<UiItem, { kind: 'user' }> => i.kind === 'user' && i.queued === true,
      );
      if (queuedItem) {
        queuedItem.queued = false;
        queuedItem.checkpointId = checkpointId;
        this.broadcast({ type: 'history', items: this.history });
      }
    } else {
      this.pushItem({ kind: 'user', text: this.userDisplayText(text, attachments), checkpointId });
    }

    this.broadcast({
      type: 'status',
      running: true,
      model: this.model,
      sessionId: this.session.id,
      permissionMode: this.permissionMode,
      totalCostUsd: this.totalCostUsd,
    });
    // The CLI reads image files via its Read tool when given absolute paths.
    const prompt = [text, ...attachments.map((p) => `Attached image (read it): ${p}`)]
      .filter(Boolean)
      .join('\n\n');
    this.session.send(prompt);
  }

  /** Called when a turn finishes — dispatch the next queued prompt, if any. */
  private drainQueue(): void {
    const next = this.promptQueue.shift();
    if (next) void this.dispatchPrompt(next.text, next.attachments, true);
  }

  private async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (mode === this.permissionMode) return;
    // Entering auto mode disarms the per-call human gate — require explicit native
    // confirmation so a stray webview message can't silently downgrade posture (Argus HIGH-3).
    if (mode === 'auto') {
      const ok = await vscode.window.showWarningMessage(
        'Auto mode lets the model approve its own tool calls — including file writes and shell commands — without asking you first. Enable it for this session?',
        { modal: true },
        'Enable Auto',
      );
      if (ok !== 'Enable Auto') {
        // Revert the optimistic dropdown change in the webview to the current mode.
        this.broadcast({
          type: 'status',
          running: false,
          model: this.model,
          sessionId: this.session?.id,
          permissionMode: this.permissionMode,
          totalCostUsd: this.totalCostUsd,
        });
        return;
      }
    }
    this.permissionMode = mode;
    // Mode is a spawn-time CLI flag — restart and resume so it applies next turn.
    if (this.session) await this.restartSession();
    this.schedulePersist();
    this.broadcast({
      type: 'status',
      running: false,
      model: this.model,
      sessionId: this.session?.id,
      permissionMode: mode,
      totalCostUsd: this.totalCostUsd,
    });
  }

  private async setModel(modelId: string): Promise<void> {
    if (modelId === this.modelId) return;
    this.modelId = modelId;
    if (this.session) await this.restartSession();
    this.schedulePersist();
    this.broadcastProviderInfo();
  }

  private async pickProvider(): Promise<void> {
    const changed = await this.providers.pick();
    if (!changed) return;
    this.modelId = ''; // model ids are provider-specific — reset to default
    await this.restartSession();
    this.pushItem({
      kind: 'turnFooter',
      text: `— 🔗 power source: ${this.providers.active.label} —`,
    });
  }

  /** Restore workspace files to a checkpoint — destructive, so confirm first. */
  /**
   * Restore workspace files to a checkpoint. Shows the diff first (neither
   * Cursor nor Windsurf do this — their restores are one-shot and, by their
   * own users' reports, effectively irreversible) and offers an honest
   * choice: restoring files does NOT rewind what Claude remembers saying or
   * doing after this point (the CLI's session transcript only ever grows,
   * it can't be partially rewound) — so "Restore & Start Fresh Chat" is
   * offered for when file state and conversation memory need to agree.
   */
  private async restoreCheckpoint(checkpointId: string): Promise<void> {
    const diff = await this.checkpoints.diffSince(checkpointId);

    if (!diff.trim()) {
      void vscode.window.showInformationMessage('Pantheon Chat: the workspace already matches this checkpoint.');
      return;
    }

    const diffDoc = await vscode.workspace.openTextDocument({ content: diff, language: 'diff' });
    await vscode.window.showTextDocument(diffDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });

    const RESTORE_FILES = '⟲ Restore Files';
    const RESTORE_FRESH = '⟲ Restore & Start Fresh Chat';
    const choice = await vscode.window.showWarningMessage(
      'Restore workspace files to this checkpoint?',
      {
        modal: true,
        detail:
          'The diff just opened beside this chat — review it first. Files created since this point are removed ' +
          '(node_modules and .git are untouched); your real git history is not affected.\n\n' +
          `"${RESTORE_FILES}" keeps this conversation exactly as-is — Claude still remembers what happened after ` +
          `this point even though the files no longer show it. "${RESTORE_FRESH}" resets both together.`,
      },
      RESTORE_FILES,
      RESTORE_FRESH,
    );
    if (choice !== RESTORE_FILES && choice !== RESTORE_FRESH) return;

    // Never restore under a live turn — the CLI would keep writing on top.
    this.session?.stop();
    try {
      await this.checkpoints.restore(checkpointId);

      if (choice === RESTORE_FRESH) {
        const cutIndex = this.history.findIndex(
          (i): i is Extract<UiItem, { kind: 'user' }> => i.kind === 'user' && i.checkpointId === checkpointId,
        );
        if (cutIndex !== -1) this.history.length = cutIndex + 1;
        this.session?.dispose();
        this.session = undefined;
        this.lastSessionId = undefined;
        this.totalCostUsd = 0;
    this.savedUsdSession = 0;
        this.currentTodoId = undefined;
        this.pushItem({ kind: 'turnFooter', text: '— ⟲ Kronos restored the workspace and opened a fresh chapter —' });
        this.broadcast({ type: 'history', items: this.history });
      } else {
        this.pushItem({ kind: 'turnFooter', text: '— ⟲ Kronos restored the workspace to this point —' });
      }
      void vscode.window.showInformationMessage('Pantheon Chat: workspace restored.');
    } catch (err) {
      this.pushItem({
        kind: 'error',
        text: `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    this.broadcast({
      type: 'status',
      running: false,
      model: this.model,
      sessionId: this.session?.id,
      permissionMode: this.permissionMode,
      totalCostUsd: this.totalCostUsd,
    });
    this.schedulePersist();
  }

  /** File list for @ mention autocomplete — capped to keep the payload light. */
  private async listWorkspaceFiles(webview: vscode.Webview): Promise<void> {
    try {
      const uris = await vscode.workspace.findFiles(
        '**/*',
        '{**/node_modules/**,**/.git/**,**/dist/**,**/.next/**,**/.turbo/**,**/__pycache__/**,**/.venv/**}',
        1000,
      );
      const paths = uris.map((u) => this.relativize(u.fsPath)).sort();
      this.post(webview, { type: 'fileList', paths });
    } catch {
      this.post(webview, { type: 'fileList', paths: [] });
    }
  }

  private async pickImages(webview: vscode.Webview): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach',
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
    });
    if (!picked || picked.length === 0) return;
    this.post(webview, { type: 'attachments', paths: picked.map((u) => u.fsPath) });
  }

  /** Write a pasted image (base64) to a temp file and attach it. */
  private savePastedImage(webview: vscode.Webview, base64: string, mime: string): void {
    try {
      // The mime string crosses the webview boundary — allowlist the extension
      // so a crafted subtype can never influence the file path.
      const ALLOWED_EXT = new Set(['png', 'jpg', 'gif', 'webp', 'bmp']);
      const subtype = mime.split('/')[1]?.toLowerCase().replace('jpeg', 'jpg');
      const ext = subtype && ALLOWED_EXT.has(subtype) ? subtype : 'png';
      const dir = join(tmpdir(), 'thesmos-pantheon-chat');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `pasted-${Date.now()}.${ext}`);
      writeFileSync(path, Buffer.from(base64, 'base64'));
      this.post(webview, { type: 'attachments', paths: [path] });
    } catch (err) {
      this.pushItem({
        kind: 'error',
        text: `Could not save pasted image: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** Write a dropped non-image file (base64) to a temp file and attach it. */
  private saveDroppedFile(webview: vscode.Webview, base64: string, name: string, _mime: string): void {
    try {
      // Strip directory components — a crafted name cannot escape the temp dir.
      const safeStem = name
        .replace(/[/\\]/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);
      const lastDot = safeStem.lastIndexOf('.');
      const stem = lastDot > 0 ? safeStem.slice(0, lastDot) : safeStem || 'dropped';
      const ext = lastDot > 0 ? safeStem.slice(lastDot) : '';
      const dir = join(tmpdir(), 'thesmos-pantheon-chat');
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${stem}-${Date.now()}${ext}`);
      writeFileSync(filePath, Buffer.from(base64, 'base64'));
      this.post(webview, { type: 'attachments', paths: [filePath] });
    } catch (err) {
      this.pushItem({
        kind: 'error',
        text: `Could not save dropped file: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  unlinkProvider(): void {
    void this.providers.unlink();
  }

  stop(): void {
    if (this.pendingDispatch) this.resolveDispatch(this.pendingDispatch.orderId, 'dismissed');
    this.session?.stop();
    this.turnRunning = false;
    this.setActivity(null);
    this.setPhase(null);
    // Stop means stop — drop anything still waiting in the queue too.
    if (this.promptQueue.length > 0) {
      this.promptQueue.length = 0;
      for (let i = this.history.length - 1; i >= 0; i--) {
        const item = this.history[i];
        if (item.kind === 'user' && item.queued === true) this.history.splice(i, 1);
      }
      this.broadcast({ type: 'history', items: this.history });
    }
    this.broadcast({ type: 'status', running: false, model: this.model, sessionId: this.session?.id });
  }

  /** 📤 Export the conversation as a shareable Council Record (markdown). */
  private async exportCouncilRecord(): Promise<void> {
    if (this.history.length === 0) {
      void vscode.window.showInformationMessage('Pantheon Chat: nothing to export yet.');
      return;
    }
    const lines: string[] = [];
    const workspaceName = this.workspaceRoot.split('/').pop() ?? 'workspace';
    const now = new Date();
    lines.push(`# ⚡ Council Record — ${workspaceName}`);
    lines.push('');
    lines.push(
      `_${now.toLocaleString()}${this.model ? ` · ${this.model}` : ''} · ${this.providers.active.label}` +
        `${this.totalCostUsd > 0 ? ` · session cost $${this.totalCostUsd.toFixed(4)}` : ''}` +
        `${this.savedUsdSession > 0 ? ` · ~$${this.savedUsdSession.toFixed(2)} saved (Credit Guardian)` : ''}_`,
    );
    lines.push('');

    for (const item of this.history) {
      switch (item.kind) {
        case 'user':
          if (item.queued) break;
          lines.push('## 🧑 Mortal', '', item.text, '');
          break;
        case 'assistant':
          lines.push(item.god ? `## ${item.god.emoji} ${item.god.name}` : '## ⚡ Response', '', item.text, '');
          break;
        case 'zeus':
          lines.push('```', item.text, '```', '');
          break;
        case 'god': {
          const model = item.model ? ` · \`${item.model}\`` : '';
          const duration = item.durationMs !== undefined ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : '';
          lines.push(`### ${item.god.emoji} ${item.god.name} — ${item.god.domain}${model}${duration}`, '');
          if (item.description) lines.push(`> Charge: ${item.description}`, '');
          if (item.summary) lines.push(item.summary, '');
          break;
        }
        case 'diff':
          lines.push(`**🔨 ${item.file}**`, '');
          if (item.oldText) lines.push('```diff', ...item.oldText.split('\n').map((l) => `- ${l}`), '```', '');
          lines.push('```diff', ...item.newText.split('\n').map((l) => `+ ${l}`), '```', '');
          break;
        case 'tool':
          lines.push(`- ⚙ \`${item.name}\` ${item.label}`);
          break;
        case 'permission':
          lines.push(`- 🛡 ${item.toolName} — **${item.status}** (${item.label})`);
          break;
        case 'todo':
          lines.push('**📋 Battle plan**', '');
          for (const t of item.todos) {
            lines.push(`- [${t.status === 'completed' ? 'x' : ' '}] ${t.content}`);
          }
          lines.push('');
          break;
        case 'governance': {
          const verdict =
            item.findings.length === 0
              ? 'the gates hold — 0 findings'
              : `${item.findings.length} finding${item.findings.length === 1 ? '' : 's'}`;
          lines.push(`### 👁 Argus inspected this turn — ${verdict}`, '');
          for (const f of item.findings) {
            lines.push(`- **${f.severity}** \`${f.category}\` ${f.file}${f.line ? `:${f.line}` : ''} — ${f.message}`);
          }
          lines.push('');
          break;
        }
        case 'turnFooter':
          lines.push(`_${item.text}_`, '');
          break;
        case 'error':
          lines.push(`> ⚠ ${item.text}`, '');
          break;
      }
    }
    lines.push('---', '', '_Recorded by Thesmos Pantheon Chat._', '');

    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(join(this.workspaceRoot, `council-record-${stamp}.md`)),
      filters: { Markdown: ['md'] },
      title: 'Export Council Record',
    });
    if (!target) return;
    writeFileSync(target.fsPath, lines.join('\n'), 'utf-8');
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  /** 📜 Chronicles — browse past sessions and reopen one. */
  private async openChronicles(): Promise<void> {
    const sessions = listSessions(this.workspaceRoot).filter((s) => s.sessionId !== this.lastSessionId);
    if (sessions.length === 0) {
      void vscode.window.showInformationMessage('Pantheon Chat: no past chronicles found for this workspace.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      sessions.map((s) => ({
        label: s.title,
        description: `${s.modifiedAt.toLocaleDateString()} ${s.modifiedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        detail: `${s.messageCount} messages`,
        sessionId: s.sessionId,
      })),
      { title: '📜 Chronicles — past sessions', placeHolder: 'Reopen a chronicle; the gods remember where you left off' },
    );
    if (!picked) return;

    this.session?.dispose();
    this.session = undefined;
    this.turnRunning = false;
    this.promptQueue.length = 0;
    this.lastSessionId = picked.sessionId;
    this.totalCostUsd = 0;
    this.savedUsdSession = 0;
    this.currentTodoId = undefined;
    this.godStart.clear();
    this.history.length = 0;
    for (const t of loadTranscript(this.workspaceRoot, picked.sessionId)) {
      this.history.push(t.role === 'user' ? { kind: 'user', text: t.text } : { kind: 'assistant', text: t.text });
    }
    this.history.push({ kind: 'turnFooter', text: '— 📜 chronicle reopened — the gods remember —' });
    this.broadcast({ type: 'history', items: this.history });
    this.broadcast({
      type: 'status',
      running: false,
      sessionId: picked.sessionId,
      permissionMode: this.permissionMode,
      totalCostUsd: 0,
    });
    this.schedulePersist();
  }

  newSession(): void {
    if (this.pendingDispatch) this.resolveDispatch(this.pendingDispatch.orderId, 'dismissed');
    this.budgetWarned = false;
    this.session?.dispose();
    this.session = undefined;
    this.model = undefined;
    this.lastSessionId = undefined;
    this.totalCostUsd = 0;
    this.savedUsdSession = 0;
    this.history.length = 0;
    this.godStart.clear();
    this.alwaysAllowed.clear();
    this.currentTodoId = undefined;
    this.permissionBridge?.dispose();
    this.permissionBridge = undefined;
    void this.context.workspaceState.update(STATE_KEY, undefined);
    this.broadcast({ type: 'reset' });
    this.broadcast({ type: 'status', running: false, permissionMode: this.permissionMode });
  }

  // ── Stream event shaping ────────────────────────────────────────────────

  private onSessionEvent(event: SessionEvent): void {
    switch (event.kind) {
      case 'init':
        this.model = event.model;
        if (event.sessionId) this.lastSessionId = event.sessionId;
        this.contextTokens = 0;
        this.setPhase('🔮 Thinking…');
        this.broadcast({
          type: 'status',
          running: true,
          model: event.model,
          sessionId: event.sessionId,
          permissionMode: this.permissionMode,
          totalCostUsd: this.totalCostUsd,
        });
        break;

      case 'textDelta':
        this.setActivity(null); // the streaming bubble itself shows progress
        this.setPhase('✍️ Writing…'); // strip stays lit even while the bubble streams
        this.broadcast({ type: 'delta', text: event.text });
        break;

      case 'thinkingDelta':
        this.setActivity('🔮 divine deliberation…');
        this.setPhase('🔮 Thinking…');
        this.broadcast({ type: 'thinking', text: event.text });
        break;

      case 'compacting':
        this.setPhase('📦 Compacting context…');
        this.setActivity('📦 compacting context…');
        break;

      case 'usage':
        this.updateUsage(event.contextTokens);
        break;

      case 'assistantText': {
        this.broadcast({ type: 'deltaDone' });
        const trimmed = event.text.trimStart();
        const firstLine = trimmed.split('\n')[0]?.trim() ?? '';
        const leanMatch = ZEUS_LEAN_LINE.exec(firstLine);

        if (leanMatch && trimmed.split('\n').length > 1) {
          // Lean routing line — strip it and attribute the bubble to the god.
          const body = trimmed.split('\n').slice(1).join('\n').trim();
          const route = leanMatch[1].trim();
          let god: { emoji: string; name: string; color: string } | undefined;
          if (!/direct response/i.test(route)) {
            const resolved = this.godMapper.resolve(route);
            if (resolved.name !== 'Oracle') {
              god = { emoji: resolved.emoji, name: resolved.name, color: resolved.color };
            }
          }
          // The raw text (header included) already streamed — replace it.
          this.broadcast({ type: 'removeLive' });
          this.pushItem({ kind: 'assistant', text: body, god });
        } else if (ZEUS_BANNER.test(trimmed)) {
          this.pushItem({ kind: 'zeus', text: event.text });
        } else {
          this.pushItem({ kind: 'assistant', text: event.text }, /* alreadyStreamed */ true);
        }
        break;
      }

      case 'toolUse': {
        const activity = this.activityFor(event.name, event.input);
        this.setActivity(activity);
        this.setPhase(activity);
        if (event.name === 'TodoWrite' && Array.isArray(event.input.todos)) {
          const todos = event.input.todos as TodoEntry[];
          const existing = this.currentTodoId
            ? this.history.find(
                (i): i is Extract<UiItem, { kind: 'todo' }> => i.kind === 'todo' && i.id === this.currentTodoId,
              )
            : undefined;
          if (existing) {
            existing.todos = todos;
            this.broadcast({ type: 'todoUpdate', id: existing.id, todos });
          } else {
            const id = `todo-${Date.now()}`;
            this.currentTodoId = id;
            this.pushItem({ kind: 'todo', id, todos });
          }
        } else if (AGENT_TOOL_NAMES.has(event.name)) {
          const subagentType = String(event.input.subagent_type ?? 'general-purpose');
          const god = this.godMapper.resolve(subagentType);
          const godKey = subagentType.replace(/^[^\p{L}]+/u, '').split(/[\s—–-]/)[0]?.toLowerCase() ?? '';
          const model =
            typeof event.input.model === 'string' && event.input.model
              ? event.input.model
              : this.agentModels.get(godKey);
          this.godStart.set(event.toolUseId, Date.now());
          this.pushItem({
            kind: 'god',
            toolUseId: event.toolUseId,
            god,
            description: String(event.input.description ?? event.input.prompt ?? '').slice(0, 200),
            status: 'running',
            startedAt: Date.now(),
            model,
          });
        } else if (event.name === 'Edit' && typeof event.input.file_path === 'string') {
          this.turnChangedFiles.add(this.relativize(event.input.file_path));
          this.pushItem({
            kind: 'diff',
            file: this.relativize(event.input.file_path),
            oldText: String(event.input.old_string ?? '').slice(0, DIFF_PREVIEW_CHARS),
            newText: String(event.input.new_string ?? '').slice(0, DIFF_PREVIEW_CHARS),
          });
        } else if (event.name === 'Write' && typeof event.input.file_path === 'string') {
          this.turnChangedFiles.add(this.relativize(event.input.file_path));
          this.pushItem({
            kind: 'diff',
            file: this.relativize(event.input.file_path),
            newText: String(event.input.content ?? '').slice(0, DIFF_PREVIEW_CHARS),
          });
        } else if (event.name === 'MultiEdit' && typeof event.input.file_path === 'string') {
          this.turnChangedFiles.add(this.relativize(event.input.file_path));
          const edits = Array.isArray(event.input.edits) ? event.input.edits : [];
          for (const edit of edits.slice(0, 5) as Array<Record<string, unknown>>) {
            this.pushItem({
              kind: 'diff',
              file: this.relativize(event.input.file_path),
              oldText: String(edit.old_string ?? '').slice(0, DIFF_PREVIEW_CHARS),
              newText: String(edit.new_string ?? '').slice(0, DIFF_PREVIEW_CHARS),
            });
          }
        } else {
          this.pushItem({ kind: 'tool', name: event.name, label: toolLabel(event.name, event.input) });
        }
        break;
      }

      case 'toolResult': {
        const startedAt = this.godStart.get(event.toolUseId);
        if (startedAt === undefined) break; // Not a god bubble — plain tools show no result row.
        this.godStart.delete(event.toolUseId);
        const durationMs = Date.now() - startedAt;
        const item = this.history.find(
          (i): i is Extract<UiItem, { kind: 'god' }> => i.kind === 'god' && i.toolUseId === event.toolUseId,
        );
        if (item) {
          item.status = event.isError ? 'error' : 'done';
          item.summary = event.summary;
          item.durationMs = durationMs;
        }
        this.broadcast({
          type: 'godComplete',
          toolUseId: event.toolUseId,
          summary: event.summary,
          isError: event.isError,
          durationMs,
        });
        break;
      }

      case 'turnDone': {
        this.broadcast({ type: 'deltaDone' });
        this.turnRunning = false;
        if (event.costUsd !== undefined) {
          // Credit Guardian: cumulative-cost delta = this turn's cost. A turn
          // that genuinely ran on a cheaper tier records an estimated saving
          // vs the flagship baseline (never counts a recommendation not taken).
          const turnCost = Math.max(0, event.costUsd - this.totalCostUsd);
          const modelName = this.model ?? this.modelId;
          const saved = estimateTierSaving(modelName, turnCost);
          if (saved !== undefined && saved > 0) {
            this.savedUsdSession += saved;
            this.savingsCacheAt = undefined; // month figure changed — invalidate
            try {
              appendSavings(this.workspaceRoot, {
                ts: new Date().toISOString(),
                type: 'model_tier',
                detail: `chat turn on ${modelName}`,
                estSavedUsd: saved,
                model: modelName,
                costUsd: turnCost,
              });
            } catch {
              // Ledger write is best-effort — never break a turn over it.
            }
          }
        }
        if (event.costUsd !== undefined) this.totalCostUsd = event.costUsd; // CLI reports cumulative session cost
        // Budget guardian: warn once at 80%, hard-notify at 100%. Enforcement
        // (blocking the next send) happens in sendPrompt, fail-closed.
        {
          const budget = readSessionBudget(this.workspaceRoot);
          const state = budgetState(this.totalCostUsd, budget);
          if (state === 'warn' && !this.budgetWarned) {
            this.budgetWarned = true;
            this.pushItem({
              kind: 'turnFooter',
              text: `— ⚠️ ~$${this.totalCostUsd.toFixed(2)} of $${budget!.toFixed(2)} session budget used —`,
            });
          } else if (state === 'exceeded') {
            this.pushItem({
              kind: 'error',
              text:
                `⛔ Session budget reached (~$${this.totalCostUsd.toFixed(2)} of $${budget!.toFixed(2)}). ` +
                `New prompts are blocked until you raise tokenBudget.sessionMaxCostUSD or start a new session.`,
            });
            try {
              appendSavings(this.workspaceRoot, {
                ts: new Date().toISOString(),
                type: 'budget_stop',
                detail: `session stopped at $${this.totalCostUsd.toFixed(2)} (ceiling $${budget!.toFixed(2)})`,
                costUsd: this.totalCostUsd,
              });
            } catch {
              // Ledger write is best-effort — never break a turn over it.
            }
          }
        }
        this.setActivity(null);
        this.setPhase(null);
        const fmtTok = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
        const parts: string[] = [];
        if (event.durationMs !== undefined) parts.push(`${(event.durationMs / 1000).toFixed(1)}s`);
        if (event.costUsd !== undefined) parts.push(`$${event.costUsd.toFixed(4)}`);
        if (event.inputTokens !== undefined || event.outputTokens !== undefined) {
          parts.push(`in ${fmtTok(event.inputTokens ?? 0)} → out ${fmtTok(event.outputTokens ?? 0)}`);
        }
        if (event.cacheReadTokens !== undefined && event.cacheReadTokens > 0) {
          parts.push(`⚡ ${fmtTok(event.cacheReadTokens)} from cache`);
        }
        if (parts.length > 0) this.pushItem({ kind: 'turnFooter', text: `— ${parts.join(' · ')} —` });
        this.broadcast({
          type: 'status',
          running: false,
          model: this.model,
          sessionId: this.session?.id,
          permissionMode: this.permissionMode,
          totalCostUsd: this.totalCostUsd,
        });
        this.schedulePersist();
        // Governance Turn Report: Argus inspects every turn that changed files.
        if (this.turnChangedFiles.size > 0) {
          void this.runGovernanceReport([...this.turnChangedFiles]);
          this.turnChangedFiles.clear();
        }
        // The gods have spoken — whisper via the status bar if nobody is watching.
        if (
          !this.sidebarVisible &&
          !this.panelVisible &&
          this.promptQueue.length === 0 &&
          vscode.workspace.getConfiguration('thesmos').get<boolean>('chat.notifyOnTurnEnd', true)
        ) {
          vscode.window.setStatusBarMessage('⚡ The gods have spoken — Pantheon Chat is ready', 8000);
        }
        this.drainQueue();
        break;
      }

      case 'stderr':
        // Surface real failures only; the CLI logs routine notices to stderr.
        if (/error|failed|not found|ENOENT/i.test(event.text)) {
          this.pushItem({ kind: 'error', text: event.text.slice(0, 500) });
        }
        break;

      case 'exit':
        this.turnRunning = false;
        this.setActivity(null);
        this.setPhase(null);
        this.broadcast({ type: 'status', running: false, model: this.model, sessionId: this.session?.id });
        break;
    }
  }

  /** Run `thesmos review` over the files this turn touched and render the verdict. */
  private async runGovernanceReport(files: string[]): Promise<void> {
    if (this.governanceUnavailable) return;
    try {
      const output = await runReview(this.workspaceRoot, undefined, files);
      this.pushItem({
        kind: 'governance',
        fileCount: files.length,
        findings: (output.findings ?? []).slice(0, 25).map((f: Finding) => ({
          severity: f.severity,
          category: f.category,
          file: f.file,
          line: f.line,
          message: f.message,
        })),
      });
    } catch (err) {
      if (err instanceof ThesmosNotFoundError) {
        // Thesmos isn't installed in this workspace — the report is a bonus,
        // not a nag. Note it once in the log and stay quiet after that.
        this.governanceUnavailable = true;
        return;
      }
      // Best-effort feature: review failures never interrupt the conversation.
    }
  }

  private hookScriptPath(): string {
    return vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'permissionHook.cjs').fsPath;
  }

  /** Mythic activity line for the live ticker, per tool. */
  private activityFor(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case 'Agent':
      case 'Task': {
        const god = this.godMapper.resolve(String(input.subagent_type ?? ''));
        return `${god.emoji} ${god.name} — ${god.progressVerb}…`;
      }
      case 'Read':
        return `📖 reading the scrolls — ${toolLabel(name, input)}`;
      case 'Grep':
      case 'Glob':
        return `🔍 searching the archives — ${toolLabel(name, input)}`;
      case 'Edit':
      case 'Write':
      case 'MultiEdit':
        return `🔨 forging — ${toolLabel(name, input)}`;
      case 'Bash':
        return `⚒ wielding the shell — ${toolLabel(name, input).slice(0, 60)}`;
      case 'WebFetch':
      case 'WebSearch':
        return '🌐 consulting distant oracles…';
      case 'TodoWrite':
        return '📋 drawing up the battle plan…';
      default:
        return `⚙ ${name}…`;
    }
  }

  private relativize(path: string): string {
    return path.startsWith(this.workspaceRoot)
      ? path.slice(this.workspaceRoot.length + 1)
      : path;
  }

  /** Record an item in history and broadcast it, unless it was already streamed live. */
  private pushItem(item: UiItem, alreadyStreamed = false): void {
    this.history.push(item);
    if (!alreadyStreamed) this.broadcast({ type: 'item', item });
    this.schedulePersist();
  }

  private broadcast(message: unknown): void {
    // Credit Guardian: every status update carries the savings figures and session budget
    // so the header bar stays current without threading them through ten call sites.
    if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'status') {
      message = {
        ...message,
        savedUsdSession: this.savedUsdSession,
        savedUsdMonth: this.monthSavings(),
        sessionBudgetUsd: this.sessionBudgetUsd,
      };
    }
    for (const webview of this.webviews) this.post(webview, message);
  }

  /** Month savings, cached for 30s — the file is tiny but re-reading per status would be waste. */
  private monthSavings(): number {
    const now = Date.now();
    if (this.savingsCacheAt === undefined || now - this.savingsCacheAt > 30_000) {
      try {
        this.savingsCacheVal = monthSavingsUsd(this.workspaceRoot, new Date());
      } catch {
        this.savingsCacheVal = 0;
      }
      this.savingsCacheAt = now;
    }
    return this.savingsCacheVal;
  }

  private post(webview: vscode.Webview, message: unknown): void {
    void webview.postMessage(message);
  }

  dispose(): void {
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer);
    this.session?.dispose();
    this.permissionBridge?.dispose();
    for (const d of this.disposables) d.dispose();
    this.webviews.clear();
  }
}
