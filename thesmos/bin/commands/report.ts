// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos report — generate a visual HTML governance report.
 *
 * Flags:
 *   --html           emit a self-contained HTML report (default if no flag given)
 *   --out=<path>     write to file instead of stdout (default: .thesmos/report.html)
 *   --open           open the report in the default browser after writing
 *   --json           emit findings as JSON
 *   --markdown       emit findings as Markdown table
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import {
  runReview,
  formatFindingsJson,
  formatFindingsMarkdown,
} from '../../review.ts';
import { getActiveRules, discoverPacks, validatePack } from '../../packs.ts';
import { loadMetricsHistory } from '../../metrics.ts';
import type { Finding, ScanResult } from '../../types.ts';
import type { PackEntry } from '../../packs.ts';
import type { MetricsSnapshot } from '../../metrics.ts';

// ── HTML renderer ─────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  BLOCKER:   '#FF4444',
  HIGH:      '#FF8C00',
  MEDIUM:    '#F5C842',
  LOW:       '#4ADE80',
  TECH_DEBT: '#94A3B8',
};

const SEVERITY_BG: Record<string, string> = {
  BLOCKER:   'rgba(255,68,68,.1)',
  HIGH:      'rgba(255,140,0,.1)',
  MEDIUM:    'rgba(245,200,66,.1)',
  LOW:       'rgba(74,222,128,.08)',
  TECH_DEBT: 'rgba(148,163,184,.08)',
};

// ── Language mapping ──────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  'TypeScript/React': '#3178C6',
  'Python':           '#3572A5',
  'Go':               '#00ADD8',
  'Ruby':             '#CC342D',
  'Java':             '#B07219',
  'Rust':             '#DEA584',
  'Other':            '#6B7280',
};

function fileExtToLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'ts' || ext === 'tsx') return 'TypeScript/React';
  if (ext === 'py') return 'Python';
  if (ext === 'go') return 'Go';
  if (ext === 'rb') return 'Ruby';
  if (ext === 'java') return 'Java';
  if (ext === 'rs') return 'Rust';
  return 'Other';
}

function buildLanguageBreakdown(findings: Finding[]): Array<{ lang: string; count: number; pct: number; color: string }> {
  const langMap = new Map<string, number>();
  for (const f of findings) {
    const lang = fileExtToLang(f.file);
    langMap.set(lang, (langMap.get(lang) ?? 0) + 1);
  }
  const total = findings.length;
  return [...langMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => ({
      lang,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
      color: LANG_COLORS[lang] ?? LANG_COLORS['Other'],
    }));
}

// ── SVG Sparkline ─────────────────────────────────────────────────────────────

function renderSparkline(values: number[], color: string, width = 100, height = 30): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      // Invert y: higher value = higher on chart (lower y coordinate)
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
    <circle cx="${(values.length - 1) * stepX}" cy="${(height - 2 - ((values[values.length - 1] - min) / range) * (height - 4)).toFixed(1)}" r="2.5" fill="${color}"/>
  </svg>`;
}

// ── HTML Options ──────────────────────────────────────────────────────────────

export interface HtmlReportOptions {
  packs?: PackEntry[];
  history?: MetricsSnapshot[];
  scan?: ScanResult;
}

// ── Main HTML formatter ───────────────────────────────────────────────────────

export function formatFindingsHtml(
  findings: Finding[],
  projectName = 'Project',
  scannedAt = new Date().toISOString(),
  options: HtmlReportOptions = {},
): string {
  const { packs, history, scan } = options;

  const bySeverity = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'].map((sev) => ({
    sev,
    count: findings.filter((f) => f.severity === sev).length,
  }));

  const byCategory = new Map<string, number>();
  for (const f of findings) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  const topCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  const date = new Date(scannedAt).toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const health = findings.length === 0 ? 'A+'
    : findings.some((f) => f.severity === 'BLOCKER') ? 'F'
    : findings.some((f) => f.severity === 'HIGH') ? 'D'
    : findings.filter((f) => f.severity === 'MEDIUM').length > 10 ? 'C'
    : findings.filter((f) => f.severity === 'MEDIUM').length > 0 ? 'B'
    : 'A';

  const healthColor = ['A+', 'A'].includes(health) ? '#4ADE80'
    : health === 'B' ? '#F5C842'
    : health === 'C' ? '#FF8C00'
    : '#FF4444';

  function renderFindings(list: Finding[]): string {
    return list.map((f) => `
      <div class="finding" style="border-left:3px solid ${SEVERITY_COLOR[f.severity]};background:${SEVERITY_BG[f.severity]}">
        <div class="finding-header">
          <span class="badge" style="color:${SEVERITY_COLOR[f.severity]};border-color:${SEVERITY_COLOR[f.severity]}20">${f.severity}</span>
          <span class="finding-cat">${f.category}</span>
          <span class="finding-loc">${f.file}${f.line != null ? `:${f.line}` : ''}</span>
        </div>
        <p class="finding-msg">${escHtml(f.message)}</p>
        ${f.suggestion ? `<p class="finding-fix">→ ${escHtml(f.suggestion)}</p>` : ''}
      </div>`).join('');
  }

  function escHtml(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  const fileGroups = [...byFile.entries()]
    .sort((a, b) => {
      const sevOrder = ['BLOCKER','HIGH','MEDIUM','LOW','TECH_DEBT'];
      const aWorst = Math.min(...a[1].map((f) => sevOrder.indexOf(f.severity)));
      const bWorst = Math.min(...b[1].map((f) => sevOrder.indexOf(f.severity)));
      return aWorst - bWorst;
    })
    .map(([file, list]) => `
    <details class="file-group" open="${list.some((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH')}">
      <summary class="file-summary">
        <span class="file-path">${escHtml(file)}</span>
        <span class="file-count">${list.length} finding${list.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="file-findings">${renderFindings(list)}</div>
    </details>`).join('');

  // ── Section: Language Breakdown ─────────────────────────────────────────────

  function renderLanguageBreakdown(): string {
    const findingLangs = buildLanguageBreakdown(findings);

    // Build a lookup of file counts from scan.languages (if available)
    const scanFileCounts = new Map<string, number>();
    if (scan?.languages) {
      for (const ls of scan.languages) {
        // Normalize scan language names to the report language names
        const normalized = ls.language === 'TypeScript' ? 'TypeScript/React' : ls.language;
        scanFileCounts.set(normalized, (scanFileCounts.get(normalized) ?? 0) + ls.fileCount);
      }
    }

    // If there are no findings AND no scan language data, render nothing
    if (findings.length === 0 && scanFileCounts.size === 0) return '';

    // Build a unified list: start with finding-based langs, then add scan-only languages
    const allLangNames = new Set<string>([
      ...findingLangs.map((l) => l.lang),
      ...scanFileCounts.keys(),
    ]);
    if (allLangNames.size === 0) return '';

    const findingsByLang = new Map(findingLangs.map(({ lang, count, pct, color }) => [lang, { count, pct, color }]));

    const unifiedLangs = [...allLangNames].map((lang) => {
      const f = findingsByLang.get(lang);
      const count    = f?.count ?? 0;
      const pct      = f?.pct   ?? 0;
      const color    = f?.color ?? (LANG_COLORS[lang] ?? LANG_COLORS['Other']);
      const fileCount = scanFileCounts.get(lang) ?? 0;
      return { lang, count, pct, color, fileCount };
    }).sort((a, b) => b.count - a.count || b.fileCount - a.fileCount);

    const hasScanData = scanFileCounts.size > 0;

    const bars = unifiedLangs.map(({ lang, count, pct, color, fileCount }) => {
      const filesBadge = hasScanData && fileCount > 0
        ? `<span class="lang-files">${fileCount} file${fileCount === 1 ? '' : 's'}</span>`
        : '';
      const findingsBadge = count > 0
        ? `<span class="lang-count">${count}</span><span class="lang-pct">${pct}%</span>`
        : `<span class="lang-pct">—</span>`;

      return `
      <div class="lang-row">
        <div class="lang-name">${escHtml(lang)}</div>
        <div class="lang-bar-track">
          <div class="lang-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="lang-stats">
          ${filesBadge}
          ${findingsBadge}
        </div>
      </div>`;
    }).join('');

    return `
  <div class="section">
    <div class="section-title">Language breakdown</div>
    <div class="lang-chart">${bars}
    </div>
  </div>`;
  }

  // ── Section: Pack Inventory ─────────────────────────────────────────────────

  function renderPackInventory(): string {
    if (!packs) return '';

    if (packs.length === 0) {
      return `
  <div class="section">
    <div class="section-title">Pack inventory</div>
    <div class="pack-empty">No packs installed — run <code>thesmos pack:create @org/name</code> to author one.</div>
  </div>`;
    }

    const check = '&#10003;'; // ✓
    const cross = '&#10007;'; // ✗

    const rows = packs.map((entry) => {
      const { manifest } = entry;
      const validation = validatePack(entry.dir, manifest);
      const statusMark = validation.valid
        ? `<span class="pack-valid">${check}</span>`
        : `<span class="pack-invalid">${cross}</span>`;
      const p = manifest.provides;

      return `
        <tr class="pack-row">
          <td class="pack-id"><code>${escHtml(manifest.id)}</code></td>
          <td class="pack-ver">v${escHtml(manifest.version)}</td>
          <td class="pack-src"><span class="pack-source-badge pack-source-${entry.source}">${entry.source}</span></td>
          <td class="pack-provides">
            ${p.rules     ? `<span class="prov-chip">rules</span>`     : ''}
            ${p.agents    ? `<span class="prov-chip">agents</span>`    : ''}
            ${p.skills    ? `<span class="prov-chip">skills</span>`    : ''}
            ${p.playbooks ? `<span class="prov-chip">playbooks</span>` : ''}
            ${p.profiles  ? `<span class="prov-chip">profiles</span>`  : ''}
          </td>
          <td class="pack-status">${statusMark}</td>
        </tr>`;
    }).join('');

    return `
  <div class="section">
    <div class="section-title">Pack inventory</div>
    <table class="pack-table">
      <thead>
        <tr>
          <th>Pack ID</th>
          <th>Version</th>
          <th>Source</th>
          <th>Provides</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
  </div>`;
  }

  // ── Section: Trend Sparklines ───────────────────────────────────────────────

  function renderTrendSparklines(): string {
    const snapshots = (history ?? []).slice(-30);

    if (snapshots.length < 2) {
      return `
  <div class="section">
    <div class="section-title">Trend</div>
    <p class="trend-empty">Not enough data — run <code>thesmos metrics --record</code> to start tracking.</p>
  </div>`;
    }

    const blockers     = snapshots.map((s) => s.findingsBySeverity?.BLOCKER ?? 0);
    const highs        = snapshots.map((s) => s.findingsBySeverity?.HIGH ?? 0);
    const healthScores = snapshots.map((s) => {
      // Derive a 0–100 health score: 100 - (weighted severity sum / total findings * 100)
      const total = s.totalFindings || 0;
      if (total === 0) return 100;
      const sev = s.findingsBySeverity ?? { BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0, TECH_DEBT: 0 };
      const weighted = (sev.BLOCKER ?? 0) * 5 + (sev.HIGH ?? 0) * 3 + (sev.MEDIUM ?? 0) * 2 + (sev.LOW ?? 0) * 1 + (sev.TECH_DEBT ?? 0) * 0.5;
      const maxWeighted = total * 5;
      return Math.round(100 - (weighted / maxWeighted) * 100);
    });

    const latest = snapshots[snapshots.length - 1];
    const latestDate = latest.recordedAt
      ? new Date(latest.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'unknown';

    const sparklineBlocker = renderSparkline(blockers, '#FF4444');
    const sparklineHigh    = renderSparkline(highs, '#FF8C00');
    const sparklineHealth  = renderSparkline(healthScores, '#4ADE80');

    return `
  <div class="section">
    <div class="section-title">Trend <span class="trend-meta">${snapshots.length} snapshots · latest ${escHtml(latestDate)}</span></div>
    <div class="sparklines">
      <div class="sparkline-card">
        <div class="sparkline-label">Blockers</div>
        <div class="sparkline-chart">${sparklineBlocker}</div>
        <div class="sparkline-value" style="color:#FF4444">${blockers[blockers.length - 1]}</div>
      </div>
      <div class="sparkline-card">
        <div class="sparkline-label">High</div>
        <div class="sparkline-chart">${sparklineHigh}</div>
        <div class="sparkline-value" style="color:#FF8C00">${highs[highs.length - 1]}</div>
      </div>
      <div class="sparkline-card">
        <div class="sparkline-label">Health Score</div>
        <div class="sparkline-chart">${sparklineHealth}</div>
        <div class="sparkline-value" style="color:#4ADE80">${healthScores[healthScores.length - 1]}</div>
      </div>
    </div>
  </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Thesmos Report — ${escHtml(projectName)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{font-size:14px}
  body{background:#050408;color:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  .page{max-width:980px;margin:0 auto;padding:48px 32px 96px}
  /* Header */
  .report-header{display:flex;align-items:flex-start;justify-content:space-between;gap:32px;margin-bottom:56px;padding-bottom:32px;border-bottom:1px solid rgba(255,255,255,.07)}
  .report-title{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:rgba(201,168,76,.6);margin-bottom:10px}
  .report-project{font-size:32px;font-weight:600;letter-spacing:-.02em;color:#F5F0E8}
  .report-date{font-size:12px;color:rgba(255,255,255,.3);margin-top:6px}
  .health-badge{text-align:center;flex-shrink:0}
  .health-grade{font-size:64px;font-weight:700;line-height:1;color:${healthColor};text-shadow:0 0 48px ${healthColor}44}
  .health-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-top:4px}
  /* Stat grid */
  .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:48px}
  .stat{background:#09080F;padding:20px 18px;text-align:center}
  .stat-n{font-size:28px;font-weight:600;line-height:1}
  .stat-l{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-top:4px}
  /* Section */
  .section{margin-bottom:40px}
  .section-title{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,168,76,.6);margin-bottom:16px;display:flex;align-items:center;gap:10px}
  .section-title::before{content:'';display:block;width:16px;height:1px;background:rgba(201,168,76,.4)}
  /* Category pills */
  .cats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:40px}
  .cat-pill{display:flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid rgba(255,255,255,.09);border-radius:8px;font-size:12px;color:rgba(255,255,255,.65)}
  .cat-pill-count{color:rgba(201,168,76,.8);font-weight:600;font-variant-numeric:tabular-nums}
  /* File groups */
  .file-group{border:1px solid rgba(255,255,255,.07);border-radius:10px;margin-bottom:10px;overflow:hidden}
  .file-summary{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;list-style:none;background:rgba(255,255,255,.025)}
  .file-summary:hover{background:rgba(255,255,255,.04)}
  .file-path{font-family:'SF Mono','JetBrains Mono',monospace;font-size:12px;color:rgba(255,255,255,.75)}
  .file-count{font-size:11px;color:rgba(255,255,255,.3)}
  .file-findings{padding:12px 16px;display:flex;flex-direction:column;gap:8px}
  /* Finding */
  .finding{padding:12px 16px;border-radius:6px}
  .finding-header{display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap}
  .badge{font-size:10px;font-weight:600;letter-spacing:.1em;padding:2px 8px;border-radius:4px;border:1px solid;background:transparent}
  .finding-cat{font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,.4)}
  .finding-loc{font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,.3);margin-left:auto}
  .finding-msg{font-size:13px;color:rgba(255,255,255,.75);line-height:1.5}
  .finding-fix{font-size:12px;color:rgba(201,168,76,.7);margin-top:4px}
  /* Clean state */
  .clean{text-align:center;padding:64px 32px;border:1px solid rgba(74,222,128,.15);border-radius:12px;background:rgba(74,222,128,.04)}
  .clean-icon{font-size:48px;margin-bottom:16px}
  .clean-title{font-size:20px;font-weight:600;color:#4ADE80;margin-bottom:8px}
  .clean-sub{font-size:14px;color:rgba(255,255,255,.4)}
  /* Language breakdown */
  .lang-chart{display:flex;flex-direction:column;gap:10px}
  .lang-row{display:flex;align-items:center;gap:12px}
  .lang-name{font-size:12px;color:rgba(255,255,255,.65);width:130px;flex-shrink:0}
  .lang-bar-track{flex:1;height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden}
  .lang-bar-fill{height:100%;border-radius:4px;transition:width .3s ease}
  .lang-stats{display:flex;gap:10px;font-size:11px;font-variant-numeric:tabular-nums;width:140px;justify-content:flex-end}
  .lang-files{color:rgba(255,255,255,.35);font-size:11px}
  .lang-count{color:rgba(255,255,255,.65);font-weight:600}
  .lang-pct{color:rgba(255,255,255,.3)}
  /* Pack table */
  .pack-table{width:100%;border-collapse:collapse;font-size:12px}
  .pack-table th{text-align:left;padding:8px 12px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.3);border-bottom:1px solid rgba(255,255,255,.07)}
  .pack-row td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top}
  .pack-row:last-child td{border-bottom:none}
  .pack-id code{font-family:'SF Mono','JetBrains Mono',monospace;font-size:12px;color:rgba(255,255,255,.75)}
  .pack-ver{color:rgba(255,255,255,.4)}
  .pack-source-badge{font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid;font-weight:600;letter-spacing:.06em}
  .pack-source-local{color:rgba(201,168,76,.8);border-color:rgba(201,168,76,.3)}
  .pack-source-node_modules{color:rgba(74,222,128,.8);border-color:rgba(74,222,128,.3)}
  .pack-provides{display:flex;flex-wrap:wrap;gap:4px}
  .prov-chip{font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08)}
  .pack-valid{color:#4ADE80;font-size:14px}
  .pack-invalid{color:#FF4444;font-size:14px}
  .pack-empty{font-size:13px;color:rgba(255,255,255,.4);padding:20px;border:1px solid rgba(255,255,255,.07);border-radius:8px}
  .pack-empty code{font-family:'SF Mono','JetBrains Mono',monospace;color:rgba(201,168,76,.7)}
  /* Sparklines */
  .sparklines{display:flex;gap:16px;flex-wrap:wrap}
  .sparkline-card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:16px 20px;display:flex;flex-direction:column;gap:8px;min-width:160px}
  .sparkline-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.3)}
  .sparkline-chart{line-height:0}
  .sparkline-value{font-size:24px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
  .trend-meta{font-size:10px;color:rgba(255,255,255,.2);text-transform:none;letter-spacing:0;font-weight:400}
  .trend-empty{font-size:13px;color:rgba(255,255,255,.4)}
  .trend-empty code{font-family:'SF Mono','JetBrains Mono',monospace;color:rgba(201,168,76,.7)}
  /* Footer */
  .report-footer{margin-top:64px;padding-top:24px;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:rgba(255,255,255,.2);display:flex;justify-content:space-between}
</style>
</head>
<body>
<div class="page">
  <div class="report-header">
    <div>
      <div class="report-title">Thesmos Governance Report</div>
      <div class="report-project">${escHtml(projectName)}</div>
      <div class="report-date">${date}</div>
    </div>
    <div class="health-badge">
      <div class="health-grade">${health}</div>
      <div class="health-label">Health Grade</div>
    </div>
  </div>

  <div class="stats">
    ${bySeverity.map(({ sev, count }) => `
    <div class="stat">
      <div class="stat-n" style="color:${SEVERITY_COLOR[sev]}">${count}</div>
      <div class="stat-l">${sev}</div>
    </div>`).join('')}
  </div>

  ${renderTrendSparklines()}

  ${renderLanguageBreakdown()}

  ${findings.length === 0 ? `
  <div class="clean">
    <div class="clean-icon">🔱</div>
    <div class="clean-title">All checks passed</div>
    <div class="clean-sub">No governance violations detected.</div>
  </div>` : `
  <div class="section">
    <div class="section-title">Top categories</div>
    <div class="cats">
      ${topCategories.map(([cat, n]) => `
      <div class="cat-pill">
        <span>${escHtml(cat)}</span>
        <span class="cat-pill-count">${n}</span>
      </div>`).join('')}
    </div>
  </div>

  <div class="section">
    <div class="section-title">${findings.length} finding${findings.length === 1 ? '' : 's'} by file</div>
    ${fileGroups}
  </div>`}

  ${renderPackInventory()}

  <div class="report-footer">
    <span>Thesmos Governance · <a href="https://github.com/Holley-Studio/thesmos-governance" style="color:rgba(201,168,76,.5)">github.com/Holley-Studio/thesmos-governance</a></span>
    <span>Built by Holley Studio</span>
  </div>
</div>
</body>
</html>`;
}

// ── Command ───────────────────────────────────────────────────────────────────

export async function cmdReport(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json     = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const open     = flag(flags, 'open');
  const outFlag  = flagVal(flags, 'out');

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write('thesmos report: .thesmos/report.json not found — run thesmos scan first\n');
    process.exit(1);
  }

  const registry = await getActiveRules(root);
  const { findings } = runReview({ scan, config }, registry);

  if (json) {
    process.stdout.write(formatFindingsJson(findings));
    return;
  }
  if (markdown) {
    process.stdout.write(formatFindingsMarkdown(findings, config.project));
    return;
  }

  // Load pack inventory and metrics history for HTML report
  const packs = discoverPacks(root);
  const history = loadMetricsHistory(root).slice(-30);

  const html = formatFindingsHtml(findings, config.project, scan.generatedAt, { packs, history, scan });
  const outPath = outFlag ?? join(root, '.thesmos', 'report.html');

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[thesmos] Could not write report to ${outPath}: ${msg}\n`);
    process.exit(1);
  }
  process.stdout.write(`\nThesmos Report — ${config.project}\n`);
  process.stdout.write(`  ${findings.length} finding${findings.length === 1 ? '' : 's'} · written to ${outPath}\n\n`);

  if (open) {
    try {
      const cmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open';
      execFileSync(cmd, [outPath], { stdio: 'ignore' });
    } catch { /* best-effort */ }
  }
}
