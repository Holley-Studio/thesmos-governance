// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Human-readable labels and Pantheon guardian names for Thesmos rule categories.
 *
 * Used in block messages (claude-govern.ts), the brain file (brain.ts), and
 * anywhere a rule ID or category slug needs to be surfaced to a human.
 */

import type { ThesmosRule } from './types.js';

// ── Guardian map: category prefix → god name + emoji ────────────────────────
// Ordered longest-first so 'local_llm_' matches before 'local_'.

const GUARDIAN_PREFIXES: Array<[prefix: string, label: string]> = [
  ['eu_ai_',     '⚖️  Themis'],
  ['local_llm_', '🤖 Aether'],
  ['local_',     '🤖 Aether'],
  ['hipaa_',     '⚖️  Themis'],
  ['gdpr_',      '⚖️  Themis'],
  ['dora_',      '⚖️  Themis'],
  ['agent_',     '⚡ Zeus'],
  ['agnt_',      '⚡ Zeus'],
  ['rag_',       '👁  Argus'],
  ['mcp_',       '👁  Argus'],
  ['sec_',       '👁  Argus'],
  ['auth_',      '👁  Argus'],
  ['vibe_',      '👁  Argus'],
  ['jwt_',       '👁  Argus'],
  ['cors_',      '👁  Argus'],
  ['dast_',      '👁  Argus'],
  ['proto_',     '👁  Argus'],
  ['ws_',        '👁  Argus'],
  ['ai_',        '🤖 Aether'],
  ['db_',        '🗄️  Pontus'],
  ['prisma_',    '🗄️  Pontus'],
  ['database_',  '🗄️  Pontus'],
  ['css_',       '🔨 Hephaestus'],
  ['design_',    '🔨 Hephaestus'],
  ['a11y_',      '🔨 Hephaestus'],
  ['react_',     '🔨 Hephaestus'],
  ['dep_',       '🔒 Nemesis'],
  ['slop_',      '🔒 Nemesis'],
  ['sc_',        '🔒 Nemesis'],
  ['k8s_',       '🛠️  Kratos'],
  ['docker_',    '🛠️  Kratos'],
  ['gha_',       '🛠️  Kratos'],
  ['tf_',        '🛠️  Kratos'],
  ['vercel_',    '🌐 Notus'],
  ['commit_',    '🔀 Kronos'],
  ['git_',       '🔀 Kronos'],
  ['test_',      '🔴 Cassandra'],
  ['debt_',      '📋 Mnemosyne'],
  ['next_',      '⚙️  Talos'],
  ['trpc_',      '⚙️  Talos'],
  ['api_',       '⚙️  Talos'],
  ['gql_',       '⚙️  Talos'],
  ['node_',      '⚙️  Talos'],
  ['zod_',       '⚙️  Talos'],
  ['form_',      '⚙️  Talos'],
  ['state_',     '⚙️  Talos'],
  ['ts_',        '⚙️  Talos'],
  ['import_',    '⚙️  Talos'],
  ['async_',     '⚙️  Talos'],
  ['err_',       '⚙️  Talos'],
  ['error_',     '⚙️  Talos'],
  ['log_',       '⚙️  Talos'],
  ['perf_',      '⚙️  Talos'],
  ['py_',        '⚙️  Talos'],
  ['go_',        '⚙️  Talos'],
  ['rb_',        '⚙️  Talos'],
  ['php_',       '⚙️  Talos'],
  ['java_',      '⚙️  Talos'],
  ['cs_',        '⚙️  Talos'],
  ['rust_',      '⚙️  Talos'],
  ['djg_',       '⚙️  Talos'],
  ['django_',    '⚙️  Talos'],
  ['lic_',       '⚖️  Themis'],
  ['license_',   '⚖️  Themis'],
];

// ── Domain prefix → readable label ──────────────────────────────────────────

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

/** Convert a snake_case category slug to "Domain: Title Case Name". */
export function categoryTitle(category: string): string {
  const parts = category.split('_').filter(Boolean);
  if (parts.length === 0) return category;
  const prefix = parts[0]!.toLowerCase();
  const domain = DOMAIN_LABELS[prefix] ?? (prefix.charAt(0).toUpperCase() + prefix.slice(1));
  const rest = parts.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return rest ? `${domain}: ${rest}` : domain;
}

/** Return the guardian god label (emoji + name) for a rule category. */
export function categoryGuardian(category: string): string {
  for (const [prefix, label] of GUARDIAN_PREFIXES) {
    if (category.startsWith(prefix)) return label;
  }
  return '⚙️  Talos';
}

/**
 * Return a short human name for a rule by ID.
 * Falls back to the ID itself if not found in the registry.
 */
export function ruleNameById(id: string, rules: readonly ThesmosRule[]): string {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return id;
  const desc = rule.description.split(/[.—\n]/)[0]?.trim() ?? '';
  return desc.length > 60 ? desc.slice(0, 57) + '…' : desc || id;
}

/**
 * One-line label for a rule category: "👁 Argus · Security: Missing Rate Limit"
 * Used in block messages and brain.md.
 */
export function categoryLabel(category: string): string {
  return `${categoryGuardian(category)} · ${categoryTitle(category)}`;
}
