/**
 * Dashboard generator — creates monitoring/analytics dashboard scaffold from wizard answers.
 *
 * Outputs (plan mode):
 *   - .prometheus/builds/<name>-dashboard-plan.md
 *
 * Outputs (scaffold mode):
 *   - src/components/dashboards/<name>.tsx  (Next.js target)
 *   - OR public/dashboards/<name>.html      (plain HTML + Chart.js)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WizardAnswers, WizardContext } from '../wizard.js';
import { makeLogger } from '../../logger.js';

const log = makeLogger('generator:dashboard');

export interface DashboardArtifact {
  files: Array<{ path: string; content: string; label: string }>;
  dashboardName: string;
}

// ── Next.js component ─────────────────────────────────────────────────────────

function buildNextjsComponent(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'dashboard';
  const PascalName = name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join('');
  const metric = answers['metric'] ?? 'key metric';
  const dataSource = answers['dataSource'] ?? 'prometheus report.json';
  const refresh = answers['refresh'] ?? 'manual refresh';

  const refreshLogic = refresh === 'real-time'
    ? `  useEffect(() => {
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);`
    : refresh === 'on-scan'
    ? `  // Re-fetch when prometheus scan completes (poll .prometheus/report.json)
  useEffect(() => { fetchData(); }, []);`
    : `  useEffect(() => { fetchData(); }, []);`;

  return `'use client';

import { useState, useEffect } from 'react';

interface DashboardData {
  metric: number;
  timestamp: string;
  label: string;
}

export default function ${PascalName}Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    try {
      setLoading(true);
      // TODO: replace with real data fetch from: ${dataSource}
      const res = await fetch('/api/prometheus/metrics');
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
      const json = await res.json() as DashboardData;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }

${refreshLogic}

  if (loading) return <div className="p-4 text-gray-500">Loading ${metric}...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">${PascalName}</h2>
      <div className="text-4xl font-bold text-blue-600">{data.metric}</div>
      <div className="text-sm text-gray-500 mt-1">{data.label}</div>
      <div className="text-xs text-gray-400 mt-4">Updated: {data.timestamp}</div>
      {/* TODO: add Chart.js or Recharts visualization for ${metric} */}
    </div>
  );
}
`;
}

// ── Plain HTML dashboard ───────────────────────────────────────────────────────

function buildHtmlDashboard(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'dashboard';
  const displayName = name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  const metric = answers['metric'] ?? 'key metric';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${displayName}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #f9fafb; }
    .card { background: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 16px; }
    h1 { font-size: 1.5rem; color: #111; }
    .metric { font-size: 3rem; font-weight: 700; color: #2563eb; }
    .label { color: #6b7280; font-size: 0.875rem; margin-top: 4px; }
    .ts { color: #9ca3af; font-size: 0.75rem; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${displayName}</h1>
    <div class="metric" id="metricValue">—</div>
    <div class="label">${metric}</div>
    <div class="ts" id="timestamp"></div>
  </div>
  <div class="card">
    <canvas id="metricsChart" height="80"></canvas>
  </div>
  <script>
    // TODO: replace with real data endpoint
    async function fetchMetrics() {
      try {
        const res = await fetch('.prometheus/report.json');
        const data = await res.json();
        document.getElementById('metricValue').textContent = data.metric ?? '—';
        document.getElementById('timestamp').textContent = 'Updated: ' + new Date().toLocaleString();
      } catch (e) {
        document.getElementById('metricValue').textContent = 'Error';
        console.error(e);
      }
    }

    const ctx = document.getElementById('metricsChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{ label: '${metric}', data: [], borderColor: '#2563eb', tension: 0.1 }]
      },
      options: { responsive: true, plugins: { legend: { position: 'top' } } }
    });

    fetchMetrics();
  </script>
</body>
</html>
`;
}

// ── Plan generator ────────────────────────────────────────────────────────────

export function generateDashboardPlan(answers: WizardAnswers, context: WizardContext): string {
  const name = answers['name'] ?? 'dashboard';
  const displayName = name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  const dataSource = answers['dataSource'] ?? 'prometheus report.json';
  const target = answers['target'] ?? 'Next.js component';
  const metric = answers['metric'] ?? 'primary metric';
  const refresh = answers['refresh'] ?? 'manual refresh';
  const stack = context.detectedStack.join(', ') || 'unknown stack';

  return [
    `# ${displayName} Dashboard — Implementation Plan`,
    '',
    `## Purpose`,
    `Displays **${metric}** from **${dataSource}**.`,
    '',
    `## Architecture decisions`,
    '',
    `| Decision | Choice | Rationale |`,
    `|----------|--------|-----------|`,
    `| Data source | ${dataSource} | Selected during wizard |`,
    `| Render target | ${target} | Matches detected stack: ${stack} |`,
    `| Refresh strategy | ${refresh} | Balances freshness vs. cost |`,
    `| Primary metric | ${metric} | Core KPI for this dashboard |`,
    '',
    `## Implementation checklist`,
    '',
    target.startsWith('Next')
      ? `- [ ] Create \`src/components/dashboards/${name}.tsx\``
      : `- [ ] Create \`public/dashboards/${name}.html\``,
    `- [ ] Implement data fetch from: ${dataSource}`,
    `- [ ] Add Chart.js/Recharts visualization for ${metric}`,
    `- [ ] Wire refresh strategy: ${refresh}`,
    `- [ ] Add error boundary / loading state`,
    `- [ ] Run governance scan: prometheus review src/components/dashboards/${name}.tsx`,
    '',
    `## Security considerations`,
    '',
    `- Ensure data fetch endpoint requires authentication`,
    `- Do not expose raw database queries or internal paths in client-side code`,
    `- Validate all API response shapes before rendering`,
    '',
    `## Test scenarios`,
    '',
    `1. Happy path: metric fetched and displayed correctly`,
    `2. Loading state: spinner shown while fetch is in progress`,
    `3. Error state: error message shown when API fails`,
    `4. ${refresh === 'real-time' ? 'Polling: data refreshes every 5 seconds' : 'Refresh: data updates on trigger'}`,
    '',
    `---`,
    `*Generated by prometheus build:dashboard --plan*`,
    `*Run: prometheus build:dashboard --scaffold to write code files*`,
  ].join('\n');
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateDashboard(
  answers: WizardAnswers,
  context: WizardContext,
  opts: { scaffold: boolean; planOnly: boolean },
): Promise<DashboardArtifact> {
  const name = (answers['name'] ?? 'dashboard').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  answers['name'] = name;
  const target = answers['target'] ?? 'nextjs';

  const files: DashboardArtifact['files'] = [];

  if (opts.scaffold) {
    if (target === 'html') {
      files.push({
        path: `public/dashboards/${name}.html`,
        content: buildHtmlDashboard(answers),
        label: 'HTML dashboard with Chart.js',
      });
    } else {
      files.push({
        path: `src/components/dashboards/${name}.tsx`,
        content: buildNextjsComponent(answers),
        label: 'Next.js dashboard component',
      });
    }
  }

  log.info('dashboard generator complete', { name, files: files.length });
  return { files, dashboardName: name };
}
