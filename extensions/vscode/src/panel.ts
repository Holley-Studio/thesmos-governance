// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * HealthPanel — VS Code Webview panel showing the governance health dashboard.
 *
 * Renders a themed HTML page that respects VS Code's light/dark/high-contrast
 * themes by using CSS variables from the vscode-webview body class.
 * A single panel instance is reused across multiple calls (singleton).
 */

import * as vscode from 'vscode';
import type { HealthScore } from './types.js';

export interface HealthEntry { score: number; grade: string; ts: number }

export class HealthPanel implements vscode.Disposable {
  private static instance: HealthPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private lastHealth: HealthScore | null = null;

  private constructor(extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(
      'thesmos.health',
      'Thesmos Health',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    this.panel.onDidDispose(() => {
      HealthPanel.instance = undefined;
    });
  }

  static show(extensionUri: vscode.Uri, health: HealthScore, history: HealthEntry[] = []): HealthPanel {
    if (!HealthPanel.instance) {
      HealthPanel.instance = new HealthPanel(extensionUri);
    }

    const panel = HealthPanel.instance;
    panel.lastHealth = health;
    panel.panel.webview.html = buildHtml(health, history);
    panel.panel.reveal(vscode.ViewColumn.Beside, true);
    return panel;
  }

  dispose(): void {
    this.panel.dispose();
    HealthPanel.instance = undefined;
  }
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function gradeColor(grade: string): string {
  if (grade === 'A+' || grade === 'A') return 'var(--vscode-charts-green, #73c991)';
  if (grade === 'B') return 'var(--vscode-charts-blue, #4daafc)';
  if (grade === 'C') return 'var(--vscode-charts-yellow, #cca700)';
  return 'var(--vscode-charts-red, #f48771)';
}

function scoreBar(score: number): string {
  const pct = Math.max(0, Math.min(100, score));
  const color =
    score >= 80
      ? 'var(--vscode-charts-green, #73c991)'
      : score >= 60
        ? 'var(--vscode-charts-yellow, #cca700)'
        : 'var(--vscode-charts-red, #f48771)';

  return `
    <div class="score-bar-track">
      <div class="score-bar-fill" style="width:${pct}%;background:${color}"></div>
    </div>`;
}

function deductionList(health: HealthScore): string {
  if (health.deductions.length === 0) return '<p class="muted">No deductions — excellent governance posture.</p>';

  return health.deductions
    .map(
      (d) =>
        `<div class="deduction-row">
          <span class="deduction-label">${escHtml(d.label)}</span>
          <span class="deduction-amount">−${d.amount}</span>
          ${d.detail ? `<p class="deduction-detail">${escHtml(d.detail)}</p>` : ''}
        </div>`,
    )
    .join('\n');
}

function bonusList(health: HealthScore): string {
  if (health.bonuses.length === 0) return '';

  return `
    <section class="card">
      <h2>Bonuses</h2>
      ${health.bonuses.map((b) => `<div class="bonus-row"><span>${escHtml(b.label)}</span><span class="bonus-amount">+${b.amount}</span></div>`).join('\n')}
    </section>`;
}

function actionList(health: HealthScore): string {
  if (health.priorityActions.length === 0) {
    return '<p class="muted">Nothing to do — your governance is in great shape.</p>';
  }
  return `<ol class="action-list">${health.priorityActions.map((a) => `<li>${escHtml(a)}</li>`).join('\n')}</ol>`;
}

function totalRow(label: string, value: string | number | boolean): string {
  const display = typeof value === 'boolean' ? (value ? '✓' : '✗') : String(value);
  const cls = typeof value === 'boolean' ? (value ? 'good' : 'bad') : '';
  return `<tr><td>${escHtml(label)}</td><td class="${cls}">${escHtml(display)}</td></tr>`;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trendChart(history: HealthEntry[]): string {
  if (history.length < 2) return '';

  const W = 220, H = 44, P = 6;
  const scores = history.map((h) => h.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = Math.max(max - min, 1);
  const n = scores.length;

  const pts = scores
    .map((s, i) => {
      const x = (P + (i / (n - 1)) * (W - P * 2)).toFixed(1);
      const y = (H - P - ((s - min) / range) * (H - P * 2)).toFixed(1);
      return `${x},${y}`;
    })
    .join(' ');

  const last = scores[n - 1];
  const lx = (W - P).toFixed(1);
  const ly = (H - P - ((last - min) / range) * (H - P * 2)).toFixed(1);
  const up = last >= scores[0];
  const arrow = up ? '↑' : '↓';
  const arrowColor = up ? 'var(--vscode-charts-green,#73c991)' : 'var(--vscode-charts-red,#f48771)';

  return `
  <section class="card">
    <h2>Health Trend <span style="color:${arrowColor}">${arrow}</span><span class="muted"> · last ${n} scans</span></h2>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block;overflow:visible;margin-bottom:4px">
      <polyline points="${escHtml(pts)}"
        fill="none" stroke="var(--vscode-charts-blue,#4daafc)"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="3" fill="var(--vscode-charts-blue,#4daafc)"/>
    </svg>
    <p class="muted" style="font-size:11px">${escHtml(String(scores[0]))} → ${escHtml(String(last))}</p>
  </section>`;
}

function reachAPlus(health: HealthScore): string {
  if (health.grade === 'A+' || health.priorityActions.length === 0) return '';
  const needed = Math.max(0, 95 - health.score);
  if (needed <= 0) return '';

  return `
  <section class="card" style="border-color:var(--vscode-charts-blue,#4daafc)">
    <h2>Reach A+ <span class="muted">(+${needed} pts needed)</span></h2>
    <ol class="action-list">
      ${health.priorityActions.slice(0, 3).map((a) => `<li>${escHtml(a)}</li>`).join('\n      ')}
    </ol>
  </section>`;
}

function buildHtml(health: HealthScore, history: HealthEntry[] = []): string {
  const { score, grade } = health;
  const gColor = gradeColor(grade);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline';" />
  <title>Thesmos Health</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px;
      max-width: 720px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 24px;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    }

    .score-circle {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      border: 4px solid ${gColor};
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .score-number {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
      color: ${gColor};
    }

    .score-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      margin-top: 2px;
    }

    .header-meta h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .grade-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      background: ${gColor};
      color: var(--vscode-editor-background);
      font-weight: 700;
      font-size: 13px;
      margin-bottom: 8px;
    }

    .header-meta p {
      opacity: 0.7;
      font-size: 12px;
    }

    /* ── Score bar ── */
    .score-bar-track {
      height: 6px;
      background: var(--vscode-progressBar-background, #3c3c3c);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 10px;
    }

    .score-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* ── Cards ── */
    .card {
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border, #3c3c3c);
      border-radius: 6px;
      padding: 16px 20px;
      margin-bottom: 16px;
    }

    .card h2 {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      margin-bottom: 12px;
    }

    /* ── Deductions ── */
    .deduction-row {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    }

    .deduction-row:last-child { border-bottom: none; }

    .deduction-label { flex: 1; }

    .deduction-amount {
      color: var(--vscode-charts-red, #f48771);
      font-weight: 600;
      font-size: 12px;
    }

    .deduction-detail {
      width: 100%;
      opacity: 0.6;
      font-size: 11px;
      margin-top: 2px;
    }

    /* ── Bonuses ── */
    .bonus-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
    }

    .bonus-amount {
      color: var(--vscode-charts-green, #73c991);
      font-weight: 600;
    }

    /* ── Actions ── */
    .action-list {
      padding-left: 18px;
    }

    .action-list li {
      padding: 4px 0;
      line-height: 1.5;
    }

    /* ── Totals table ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    td {
      padding: 5px 0;
      border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    }

    tr:last-child td { border-bottom: none; }

    td:last-child {
      text-align: right;
      font-weight: 600;
    }

    .good { color: var(--vscode-charts-green, #73c991); }
    .bad  { color: var(--vscode-charts-red,   #f48771); }

    .muted { opacity: 0.6; font-size: 12px; }

    /* ── Footer ── */
    .footer {
      margin-top: 24px;
      opacity: 0.45;
      font-size: 11px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="score-circle">
      <span class="score-number">${escHtml(String(score))}</span>
      <span class="score-label">/ 100</span>
    </div>
    <div class="header-meta">
      <h1>Governance Health</h1>
      <span class="grade-badge">${escHtml(grade)}</span>
      <p>Thesmos Governance · Holley Studio</p>
      ${scoreBar(score)}
    </div>
  </div>

  ${reachAPlus(health)}

  <section class="card">
    <h2>Priority Actions</h2>
    ${actionList(health)}
  </section>

  ${trendChart(history)}

  <section class="card">
    <h2>Deductions</h2>
    ${deductionList(health)}
  </section>

  ${bonusList(health)}

  <section class="card">
    <h2>Breakdown</h2>
    <table>
      ${totalRow('New findings', health.totals.newFindings)}
      ${totalRow('Baselined findings', health.totals.baselineFindings)}
      ${totalRow('Drift events', health.totals.driftEvents)}
      ${totalRow('Suppression issues', health.totals.suppressionIssues)}
      ${totalRow('Baseline exists', health.totals.hasBaseline)}
      ${totalRow('Scan report exists', health.totals.hasReport)}
      ${totalRow('Report is fresh', health.totals.reportFresh)}
    </table>
  </section>

  <p class="footer">Thesmos Governance by Holley Studio · as of ${escHtml(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</p>
</body>
</html>`;
}
