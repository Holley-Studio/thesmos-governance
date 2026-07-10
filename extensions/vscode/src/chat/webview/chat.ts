// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pantheon Chat webview script. Runs in the browser context of the webview.
 *
 * Security note (AI_028): all model/tool text is HTML-escaped before the
 * markdown-lite transform, which only ever injects a fixed set of safe tags.
 */

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

interface GodInfo {
  emoji: string;
  name: string;
  domain: string;
  progressVerb: string;
  color: string;
}

type UiItem =
  | { kind: 'user'; text: string; checkpointId?: string; queued?: boolean }
  | { kind: 'assistant'; text: string }
  | { kind: 'zeus'; text: string }
  | { kind: 'god'; toolUseId: string; god: GodInfo; description: string; status: 'running' | 'done' | 'error'; summary?: string; startedAt: number; durationMs?: number }
  | { kind: 'tool'; name: string; label: string }
  | { kind: 'diff'; file: string; oldText?: string; newText: string }
  | { kind: 'permission'; requestId: string; toolName: string; label: string; status: 'pending' | 'allowed' | 'denied' }
  | { kind: 'todo'; id: string; todos: TodoEntry[] }
  | { kind: 'governance'; findings: GovernanceFinding[]; fileCount: number }
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

type InboundMessage =
  | { type: 'reset' }
  | { type: 'history'; items: UiItem[] }
  | { type: 'item'; item: UiItem }
  | { type: 'delta'; text: string }
  | { type: 'deltaDone' }
  | { type: 'godComplete'; toolUseId: string; summary: string; isError: boolean; durationMs: number }
  | { type: 'status'; running: boolean; model?: string; sessionId?: string; permissionMode?: string; totalCostUsd?: number; savedUsdSession?: number; savedUsdMonth?: number }
  | { type: 'providerInfo'; label: string; models: Array<{ id: string; label: string }>; currentModel: string }
  | { type: 'attachments'; paths: string[] }
  | { type: 'permissionResolved'; requestId: string; status: 'allowed' | 'denied' }
  | { type: 'todoUpdate'; id: string; todos: TodoEntry[] }
  | { type: 'fileList'; paths: string[] };

const vscode = acquireVsCodeApi();

const log = document.getElementById('log') as HTMLDivElement;
const empty = document.getElementById('empty') as HTMLDivElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const newBtn = document.getElementById('new-session') as HTMLButtonElement;
const chroniclesBtn = document.getElementById('chronicles') as HTMLButtonElement;
const meta = document.getElementById('session-meta') as HTMLSpanElement;
const modeSelect = document.getElementById('mode') as HTMLSelectElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const providerBtn = document.getElementById('provider-btn') as HTMLButtonElement;
const attachBtn = document.getElementById('attach') as HTMLButtonElement;
const mentionPopup = document.getElementById('mention-popup') as HTMLDivElement;
const attachmentsRow = document.getElementById('attachments') as HTMLDivElement;

let pendingAttachments: string[] = [];

// ── Thinking indicator ────────────────────────────────────────────────────────
// Shown instantly on send and whenever the turn is running but nothing has
// streamed for >2s (long tool gaps). Removed by any content event.
const THINKING_VERBS = [
  'The council deliberates',
  'Zeus weighs the matter',
  'The oracle stirs',
  'Wisdom gathers on Olympus',
];
let thinkingEl: HTMLDivElement | undefined;
let thinkingVerbIdx = 0;
let thinkingGapTimer: ReturnType<typeof setTimeout> | undefined;
let turnRunning = false;

function showThinking(): void {
  if (thinkingEl) return;
  thinkingEl = div('msg thinking');
  thinkingVerbIdx = (thinkingVerbIdx + 1) % THINKING_VERBS.length;
  const pulse = document.createElement('span');
  pulse.className = 'pulse';
  const verb = document.createElement('span');
  verb.className = 'verb';
  verb.textContent = `⚡ ${THINKING_VERBS[thinkingVerbIdx]}…`;
  thinkingEl.append(pulse, verb);
  append(thinkingEl);
}

function hideThinking(): void {
  thinkingEl?.remove();
  thinkingEl = undefined;
}

/** Every stream event resets the gap timer; if 2s pass mid-turn, think again. */
function bumpThinkingGap(): void {
  hideThinking();
  clearTimeout(thinkingGapTimer);
  if (!turnRunning) return;
  thinkingGapTimer = setTimeout(() => {
    if (turnRunning) showThinking();
  }, 2000);
}

let liveBubble: HTMLDivElement | undefined;
let liveText = '';
const godElements = new Map<string, HTMLDivElement>();
const godStart = new Map<string, number>();
const permissionElements = new Map<string, HTMLDivElement>();
const todoElements = new Map<string, HTMLDivElement>();

// ── Rendering ─────────────────────────────────────────────────────────────

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape first, then apply a minimal safe markdown transform. */
function renderMarkdown(raw: string): string {
  const escaped = escapeHtml(raw);
  const parts = escaped.split(/```([^\n]*)\n([\s\S]*?)```/g);
  let html = '';
  for (let i = 0; i < parts.length; i += 3) {
    html += inlineMarkdown(parts[i] ?? '');
    if (i + 2 < parts.length) {
      html += `<pre><code>${parts[i + 2] ?? ''}</code></pre>`;
    }
  }
  return html;
}

function inlineMarkdown(escaped: string): string {
  return escaped
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

/** Adds a Copy button to each fenced code block that doesn't already have one. */
function attachCodeCopyButtons(container: HTMLElement): void {
  for (const pre of container.querySelectorAll('pre')) {
    if (pre.querySelector('.code-copy-btn')) continue;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const text = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
      void navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
    pre.appendChild(btn);
  }
}

// Only auto-scroll while the user is already reading the newest content —
// never yank them down while they scroll back through history.
let stickToBottom = true;
log.addEventListener('scroll', () => {
  stickToBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 60;
});

function scrollToEnd(): void {
  if (stickToBottom) log.scrollTop = log.scrollHeight;
}

function append(el: HTMLElement): void {
  empty.style.display = 'none';
  log.appendChild(el);
  scrollToEnd();
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function renderItem(item: UiItem): void {
  switch (item.kind) {
    case 'user': {
      const el = div(`msg user${item.queued ? ' queued' : ''}`);
      el.textContent = item.text;
      if (item.queued) {
        const marker = document.createElement('span');
        marker.className = 'queued-marker';
        marker.textContent = '⏳ queued';
        el.appendChild(marker);
      }
      if (item.checkpointId) {
        const btn = document.createElement('button');
        btn.className = 'restore-btn';
        btn.title = 'Restore workspace files to this point (Kronos turns back time)';
        btn.textContent = '⟲';
        const checkpointId = item.checkpointId;
        btn.addEventListener('click', () =>
          vscode.postMessage({ type: 'restore', checkpointId }),
        );
        el.appendChild(btn);
      }
      append(el);
      break;
    }
    case 'assistant': {
      finalizeLiveBubble();
      const el = div('msg assistant');
      el.innerHTML = renderMarkdown(item.text);
      attachCodeCopyButtons(el);
      append(el);
      break;
    }
    case 'zeus': {
      // The banner text already streamed into the live bubble — replace it
      // with the styled banner instead of showing the text twice.
      if (liveBubble) liveBubble.remove();
      finalizeLiveBubble();
      const el = div('msg zeus');
      el.textContent = item.text;
      append(el);
      break;
    }
    case 'god': {
      finalizeLiveBubble();
      const el = div(`msg god${item.status === 'done' ? ' done' : ''}${item.status === 'error' ? ' error' : ''}`);
      el.style.setProperty('--god-color', item.god.color);
      const head = div('god-head');
      head.innerHTML =
        `<span class="god-emoji">${escapeHtml(item.god.emoji)}</span>` +
        `<span class="god-name">${escapeHtml(item.god.name)}</span>` +
        `<span class="god-domain">${escapeHtml(item.god.domain)}</span>`;
      el.appendChild(head);
      const body = div('god-body');
      body.textContent = item.summary ?? item.description;
      el.appendChild(body);
      const status = div('god-status');
      if (item.status === 'running') {
        status.innerHTML = `<span class="spinner"></span><span class="verb">${escapeHtml(item.god.progressVerb)}…</span> <span class="elapsed"></span>`;
        godStart.set(item.toolUseId, item.startedAt || Date.now());
      } else {
        status.textContent = `${item.status === 'error' ? '⚠' : '✓'} ${item.durationMs !== undefined ? formatDuration(item.durationMs) : ''}`;
      }
      el.appendChild(status);
      godElements.set(item.toolUseId, el);
      append(el);
      break;
    }
    case 'tool': {
      const el = div('msg tool');
      el.innerHTML = `<span class="tool-name">${escapeHtml(item.name)}</span> ${escapeHtml(item.label)}`;
      el.title = item.label;
      append(el);
      break;
    }
    case 'diff': {
      const el = div('msg diff');
      const header = div('diff-file');
      header.textContent = item.file;
      el.appendChild(header);
      if (item.oldText) {
        const oldBlock = document.createElement('pre');
        oldBlock.className = 'diff-old';
        oldBlock.textContent = item.oldText;
        el.appendChild(oldBlock);
      }
      const newBlock = document.createElement('pre');
      newBlock.className = 'diff-new';
      newBlock.textContent = item.newText;
      el.appendChild(newBlock);
      append(el);
      break;
    }
    case 'permission': {
      const el = buildPermissionCard(item);
      permissionElements.set(item.requestId, el);
      append(el);
      break;
    }
    case 'todo': {
      const el = buildTodoCard(item.todos);
      todoElements.set(item.id, el);
      append(el);
      break;
    }
    case 'governance': {
      append(buildGovernanceCard(item));
      break;
    }
    case 'error': {
      const el = div('msg error-note');
      el.textContent = item.text;
      append(el);
      break;
    }
    case 'turnFooter': {
      const el = div('msg turn-footer');
      el.textContent = item.text;
      append(el);
      break;
    }
  }
}

function buildPermissionCard(item: Extract<UiItem, { kind: 'permission' }>): HTMLDivElement {
  const el = div(`msg permission ${item.status}`);

  const head = div('perm-head');
  const icon = document.createElement('span');
  icon.className = 'perm-icon';
  icon.textContent = '🔔';
  const title = document.createElement('span');
  title.className = 'perm-title';
  title.textContent = `${item.toolName} wants to run`;
  head.append(icon, title);
  el.appendChild(head);

  const body = document.createElement('pre');
  body.className = 'perm-body';
  body.textContent = item.label || '(no details)';
  el.appendChild(body);

  if (item.status !== 'pending') {
    const resolved = div('perm-resolved');
    resolved.textContent = item.status === 'allowed' ? '✓ Approved' : '✕ Denied';
    el.appendChild(resolved);
    return el;
  }

  const actions = div('perm-actions');

  const alwaysLabel = document.createElement('label');
  alwaysLabel.className = 'perm-always';
  const alwaysCheckbox = document.createElement('input');
  alwaysCheckbox.type = 'checkbox';
  alwaysLabel.append(alwaysCheckbox, document.createTextNode(` Always allow ${item.toolName} this session`));

  const denyBtn = document.createElement('button');
  denyBtn.className = 'perm-deny';
  denyBtn.textContent = 'Deny';
  const allowBtn = document.createElement('button');
  allowBtn.className = 'perm-allow';
  allowBtn.textContent = 'Approve';

  const respond = (decision: 'allow' | 'deny'): void => {
    allowBtn.disabled = true;
    denyBtn.disabled = true;
    alwaysCheckbox.disabled = true;
    vscode.postMessage({
      type: 'permissionResponse',
      requestId: item.requestId,
      decision,
      alwaysAllow: alwaysCheckbox.checked,
    });
  };
  denyBtn.addEventListener('click', () => respond('deny'));
  allowBtn.addEventListener('click', () => respond('allow'));

  actions.append(alwaysLabel, denyBtn, allowBtn);
  el.appendChild(actions);
  return el;
}

const TODO_ICON: Record<TodoEntry['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
};

function buildTodoCard(todos: TodoEntry[]): HTMLDivElement {
  const el = div('msg todo');
  const head = div('todo-head');
  const done = todos.filter((t) => t.status === 'completed').length;
  head.innerHTML = `<span class="todo-icon">📜</span><span class="todo-title">The gods' task list</span><span class="todo-count">${done}/${todos.length}</span>`;
  el.appendChild(head);

  const list = document.createElement('ul');
  list.className = 'todo-list';
  for (const t of todos) {
    const li = document.createElement('li');
    li.className = `todo-item ${t.status}`;
    const marker = document.createElement('span');
    marker.className = 'todo-marker';
    marker.textContent = TODO_ICON[t.status] ?? '○';
    const label = document.createElement('span');
    label.textContent = t.status === 'in_progress' ? t.activeForm : t.content;
    li.append(marker, label);
    list.appendChild(li);
  }
  el.appendChild(list);
  return el;
}

function updateTodoCard(el: HTMLDivElement, todos: TodoEntry[]): void {
  const fresh = buildTodoCard(todos);
  el.innerHTML = fresh.innerHTML;
}

const SEVERITY_ORDER = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'];

function buildGovernanceCard(item: Extract<UiItem, { kind: 'governance' }>): HTMLDivElement {
  const clean = item.findings.length === 0;
  const el = div(`msg governance${clean ? ' clean' : ''}`);

  const counts = new Map<string, number>();
  for (const f of item.findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const countText = clean
    ? 'the gates hold — 0 findings'
    : SEVERITY_ORDER.filter((s) => counts.has(s))
        .map((s) => `${counts.get(s)} ${s}`)
        .join(' · ');

  const head = div('gov-head');
  head.innerHTML =
    `<span class="gov-icon">👁</span>` +
    `<span class="gov-title">Argus inspected this turn</span>` +
    `<span class="gov-summary">${escapeHtml(countText)}</span>`;
  el.appendChild(head);

  if (!clean) {
    const list = div('gov-findings');
    for (const f of item.findings) {
      const row = div(`gov-finding sev-${f.severity.toLowerCase()}`);
      const loc = `${f.file}${f.line !== undefined ? `:${f.line}` : ''}`;
      row.innerHTML =
        `<span class="gov-sev">${escapeHtml(f.severity)}</span>` +
        `<span class="gov-cat">${escapeHtml(f.category)}</span>` +
        `<span class="gov-loc">${escapeHtml(loc)}</span><br>` +
        `<span class="gov-msg">${escapeHtml(f.message)}</span>`;
      list.appendChild(row);
    }
    list.style.display = 'none';
    el.appendChild(list);
    head.style.cursor = 'pointer';
    head.addEventListener('click', () => {
      list.style.display = list.style.display === 'none' ? 'flex' : 'none';
    });
  }
  return el;
}

// ── Streaming ─────────────────────────────────────────────────────────────

function ensureLiveBubble(): HTMLDivElement {
  if (!liveBubble) {
    liveBubble = div('msg assistant');
    append(liveBubble);
  }
  return liveBubble;
}

function finalizeLiveBubble(): void {
  liveBubble = undefined;
  liveText = '';
}

// Batch delta re-renders to one per frame — re-rendering the whole bubble on
// every token is O(n²) over a long response.
let liveRenderScheduled = false;
function scheduleLiveRender(): void {
  if (liveRenderScheduled) return;
  liveRenderScheduled = true;
  requestAnimationFrame(() => {
    liveRenderScheduled = false;
    if (!liveText) return;
    const bubble = ensureLiveBubble();
    bubble.innerHTML = renderMarkdown(liveText);
    attachCodeCopyButtons(bubble);
    scrollToEnd();
  });
}

// ── God elapsed timers ────────────────────────────────────────────────────

setInterval(() => {
  for (const [id, startedAt] of godStart) {
    const el = godElements.get(id)?.querySelector('.elapsed');
    if (el) el.textContent = formatDuration(Date.now() - startedAt);
  }
}, 1000);

// ── Inbound messages ──────────────────────────────────────────────────────

window.addEventListener('message', (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'reset':
      log.innerHTML = '';
      empty.style.display = 'flex';
      godElements.clear();
      godStart.clear();
      permissionElements.clear();
      todoElements.clear();
      finalizeLiveBubble();
      thinkingEl = undefined; // log was cleared — drop the stale reference
      clearTimeout(thinkingGapTimer);
      meta.textContent = '';
      break;
    case 'history':
      log.innerHTML = '';
      godElements.clear();
      godStart.clear();
      permissionElements.clear();
      todoElements.clear();
      finalizeLiveBubble();
      thinkingEl = undefined; // log was cleared — drop the stale reference
      clearTimeout(thinkingGapTimer);
      for (const item of msg.items) renderItem(item);
      break;
    case 'item':
      bumpThinkingGap();
      renderItem(msg.item);
      break;
    case 'delta':
      bumpThinkingGap();
      liveText += msg.text;
      scheduleLiveRender();
      break;
    case 'deltaDone':
      finalizeLiveBubble();
      bumpThinkingGap();
      break;
    case 'godComplete': {
      const el = godElements.get(msg.toolUseId);
      godStart.delete(msg.toolUseId);
      if (!el) break;
      el.classList.add(msg.isError ? 'error' : 'done');
      const body = el.querySelector('.god-body');
      if (body && msg.summary) body.textContent = msg.summary;
      const status = el.querySelector('.god-status');
      if (status) status.textContent = `${msg.isError ? '⚠' : '✓'} ${formatDuration(msg.durationMs)}`;
      break;
    }
    case 'status':
      document.body.classList.toggle('running', msg.running);
      turnRunning = msg.running;
      if (!msg.running) {
        clearTimeout(thinkingGapTimer);
        hideThinking();
      }
      {
        // Credit Guardian header figure — month-to-date, session detail in tooltip.
        const savingsEl = document.getElementById('savings');
        if (savingsEl) {
          const s = msg.savedUsdSession ?? 0;
          const m = msg.savedUsdMonth ?? 0;
          savingsEl.textContent = m > 0 ? `⚖ ~$${m.toFixed(2)} saved` : '';
          savingsEl.setAttribute('title',
            `Credit Guardian (estimated vs flagship baseline)\nSession: ~$${s.toFixed(2)} · Month: ~$${m.toFixed(2)}\nLedger: .thesmos/savings.jsonl`);
        }
      }
      // While a turn runs, Send becomes Queue — messages wait their turn.
      sendBtn.textContent = msg.running ? 'Queue' : 'Send';
      sendBtn.title = msg.running ? 'Queue for when the current turn finishes' : 'Send (Enter)';
      if (msg.model || msg.sessionId || msg.totalCostUsd !== undefined) {
        meta.textContent = [
          msg.model,
          msg.sessionId ? `session ${msg.sessionId.slice(0, 8)}` : '',
          msg.totalCostUsd !== undefined && msg.totalCostUsd > 0 ? `Σ $${msg.totalCostUsd.toFixed(4)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
      }
      if (msg.permissionMode) modeSelect.value = msg.permissionMode;
      break;
    case 'providerInfo': {
      providerBtn.textContent = msg.label.split(' ')[0] ?? '⚡'; // the provider emoji
      providerBtn.title = `Provider: ${msg.label} — click to change or link another (GLM, Kimi, DeepSeek, GPT/Gemini via proxy)`;
      modelSelect.innerHTML = '';
      for (const m of msg.models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        modelSelect.appendChild(opt);
      }
      modelSelect.value = msg.currentModel;
      break;
    }
    case 'attachments':
      pendingAttachments = [...pendingAttachments, ...msg.paths];
      renderAttachments();
      break;
    case 'permissionResolved': {
      const el = permissionElements.get(msg.requestId);
      permissionElements.delete(msg.requestId);
      if (!el) break;
      el.classList.remove('pending');
      el.classList.add(msg.status);
      const actions = el.querySelector('.perm-actions');
      actions?.remove();
      const resolved = div('perm-resolved');
      resolved.textContent = msg.status === 'allowed' ? '✓ Approved' : '✕ Denied';
      el.appendChild(resolved);
      break;
    }
    case 'todoUpdate': {
      const el = todoElements.get(msg.id);
      if (el) updateTodoCard(el, msg.todos);
      break;
    }
    case 'fileList':
      workspaceFiles = msg.paths;
      if (mentionOpen) updateMentionState(); // refresh results now that the list has arrived
      break;
  }
});

// ── Attachments ───────────────────────────────────────────────────────────

function renderAttachments(): void {
  attachmentsRow.innerHTML = '';
  attachmentsRow.style.display = pendingAttachments.length > 0 ? 'flex' : 'none';
  pendingAttachments.forEach((path, index) => {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip';
    const name = path.split('/').pop() ?? path;
    chip.innerHTML = `📎 ${escapeHtml(name)} <button class="remove" title="Remove">✕</button>`;
    (chip.querySelector('.remove') as HTMLButtonElement).addEventListener('click', () => {
      pendingAttachments.splice(index, 1);
      renderAttachments();
    });
    attachmentsRow.appendChild(chip);
  });
}

// ── Outbound actions ──────────────────────────────────────────────────────

function send(): void {
  const text = input.value.trim();
  if (!text && pendingAttachments.length === 0) return;
  input.value = '';
  input.style.height = 'auto';
  vscode.postMessage({ type: 'send', text, attachments: pendingAttachments });
  pendingAttachments = [];
  renderAttachments();
  turnRunning = true;
  showThinking();
}

sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
newBtn.addEventListener('click', () => vscode.postMessage({ type: 'newSession' }));
attachBtn.addEventListener('click', () => vscode.postMessage({ type: 'pickImage' }));
modeSelect.addEventListener('change', () =>
  vscode.postMessage({ type: 'setPermissionMode', mode: modeSelect.value }),
);
modelSelect.addEventListener('change', () =>
  vscode.postMessage({ type: 'setModel', model: modelSelect.value }),
);
providerBtn.addEventListener('click', () => vscode.postMessage({ type: 'pickProvider' }));
chroniclesBtn.addEventListener('click', () => vscode.postMessage({ type: 'openChronicles' }));

input.addEventListener('keydown', (e) => {
  if (mentionOpen) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveMentionSelection(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveMentionSelection(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); confirmMentionSelection(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeMentionPopup(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  updateMentionState();
});
input.addEventListener('blur', () => {
  // Let a click on the popup register before we tear it down.
  setTimeout(closeMentionPopup, 150);
});

// ── @ file mentions ───────────────────────────────────────────────────────

let workspaceFiles: string[] = [];
let filesRequested = false;
let mentionOpen = false;
let mentionStart = -1; // index of the '@' that opened the current mention
let mentionMatches: string[] = [];
let mentionIndex = 0;

function updateMentionState(): void {
  const caret = input.selectionStart ?? input.value.length;
  const upToCaret = input.value.slice(0, caret);
  const at = upToCaret.lastIndexOf('@');
  if (at === -1 || /\s/.test(upToCaret.slice(at + 1))) {
    closeMentionPopup();
    return;
  }
  // Require a word boundary before '@' so emails/paths mid-word don't trigger it.
  if (at > 0 && !/[\s(]/.test(upToCaret[at - 1] ?? ' ')) {
    closeMentionPopup();
    return;
  }
  mentionStart = at;
  const query = upToCaret.slice(at + 1).toLowerCase();

  if (!filesRequested) {
    filesRequested = true;
    vscode.postMessage({ type: 'listFiles' });
  }

  mentionMatches = (query ? workspaceFiles.filter((f) => f.toLowerCase().includes(query)) : workspaceFiles).slice(0, 30);
  mentionIndex = 0;
  if (mentionMatches.length === 0) {
    closeMentionPopup();
    return;
  }
  mentionOpen = true;
  renderMentionPopup();
}

function renderMentionPopup(): void {
  mentionPopup.innerHTML = '';
  mentionPopup.classList.remove('hidden');
  mentionMatches.forEach((path, i) => {
    const row = document.createElement('div');
    row.className = `mention-row${i === mentionIndex ? ' active' : ''}`;
    row.textContent = path;
    row.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus in the textarea
      mentionIndex = i;
      confirmMentionSelection();
    });
    mentionPopup.appendChild(row);
  });
}

function moveMentionSelection(delta: number): void {
  mentionIndex = (mentionIndex + delta + mentionMatches.length) % mentionMatches.length;
  renderMentionPopup();
}

function confirmMentionSelection(): void {
  const path = mentionMatches[mentionIndex];
  if (path === undefined || mentionStart === -1) { closeMentionPopup(); return; }
  const caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, mentionStart);
  const after = input.value.slice(caret);
  const inserted = `@${path} `;
  input.value = before + inserted + after;
  const newCaret = before.length + inserted.length;
  input.setSelectionRange(newCaret, newCaret);
  closeMentionPopup();
  input.focus();
}

function closeMentionPopup(): void {
  mentionOpen = false;
  mentionStart = -1;
  mentionPopup.classList.add('hidden');
  mentionPopup.innerHTML = '';
}

// Paste-to-attach: pasted images become attachments instead of text.
input.addEventListener('paste', (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (base64) vscode.postMessage({ type: 'pasteImage', data: base64, mime: item.type });
    };
    reader.readAsDataURL(file);
  }
});

vscode.postMessage({ type: 'ready' });
