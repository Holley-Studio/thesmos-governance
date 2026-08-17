// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Primary roles and specialist classification.
 *
 * A user picks from eight roles, not from sixty-eight gods. The Pantheon is not
 * reduced by this — every specialist keeps its name, mythology, domains, CLI
 * discovery, and adapters. `hidden: true` means "not in the default selector",
 * never "unavailable" (Olympus Phase 5).
 */

import type { CouncilPrimaryRole } from './contract.js';
import { COUNCIL_PRIMARY_ROLES } from './contract.js';

// ── Role definitions ──────────────────────────────────────────────────────────

export interface CouncilRoleDefinition {
  role: CouncilPrimaryRole;
  title: string;
  /** What a user gets when they pick this role. */
  summary: string;
  /** Agent id of the god who leads the role. Must exist in the catalog. */
  leadAgentId: string;
  leadDisplayName: string;
}

/**
 * Leads are drawn from the shipped roster only — an agent held back from the
 * public drop (`catalog/holdbacks.json`) can never be a role lead, or picking
 * the role would surface an unannounced god.
 */
export const COUNCIL_ROLE_DEFINITIONS: readonly CouncilRoleDefinition[] = [
  {
    role: 'build',
    title: 'Build',
    summary: 'Implement features and changes in the codebase.',
    leadAgentId: 'talos-web-dev-agent',
    leadDisplayName: 'Talos',
  },
  {
    role: 'plan',
    title: 'Plan',
    summary: 'Break work down, sequence it, and decide what to do next.',
    leadAgentId: 'metis-pm-agent',
    leadDisplayName: 'Metis',
  },
  {
    role: 'debug',
    title: 'Debug',
    summary: 'Reproduce, isolate, and explain failures before fixing them.',
    leadAgentId: 'cassandra-qa-agent',
    leadDisplayName: 'Cassandra',
  },
  {
    role: 'review',
    title: 'Review',
    summary: 'Review changes for correctness, clarity, and governance findings.',
    leadAgentId: 'momus-challenger-agent',
    leadDisplayName: 'Momus',
  },
  {
    role: 'security',
    title: 'Security',
    summary: 'Threat-model, audit, and prove security findings with reproduction.',
    leadAgentId: 'argus-security-agent',
    leadDisplayName: 'Argus',
  },
  {
    role: 'design',
    title: 'Design',
    summary: 'Design UI, design systems, and accessible interaction.',
    leadAgentId: 'hephaestus-design-agent',
    leadDisplayName: 'Hephaestus',
  },
  {
    role: 'growth',
    title: 'Growth',
    summary: 'Marketing, acquisition, content, and measurable growth work.',
    leadAgentId: 'hermes-marketing-agent',
    leadDisplayName: 'Hermes',
  },
  {
    role: 'operations',
    title: 'Operations',
    summary: 'Process, people, finance, legal, and day-to-day running of the business.',
    leadAgentId: 'hera-operations-agent',
    leadDisplayName: 'Hera',
  },
];

export function roleDefinition(role: CouncilPrimaryRole): CouncilRoleDefinition {
  const found = COUNCIL_ROLE_DEFINITIONS.find((r) => r.role === role);
  if (!found) throw new Error(`Unknown council role: ${role}`);
  return found;
}

export function isRoleLead(agentId: string): boolean {
  return COUNCIL_ROLE_DEFINITIONS.some((r) => r.leadAgentId === agentId);
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Tag → role weights. Weighted scoring rather than first-match so a document
 * carrying several domain tags lands where the *bulk* of its tags point, and so
 * adding a tag can never silently flip a previously stable classification by
 * winning a race.
 *
 * Example: Themis carries `legal, contracts, compliance, tos, nda`. First-match
 * on `compliance` would file the legal agent under Security; weighted scoring
 * files it under Operations, where a user looking for contract work will look.
 */
const TAG_ROLE_WEIGHTS: Readonly<Record<string, Partial<Record<CouncilPrimaryRole, number>>>> = {
  // build
  'web-development': { build: 3 },
  implementation: { build: 3 },
  nextjs: { build: 2 },
  react: { build: 2 },
  typescript: { build: 2 },
  python: { build: 2 },
  frontend: { build: 2 },
  backend: { build: 2 },
  fullstack: { build: 2 },
  api: { build: 2 },
  database: { build: 2 },
  supabase: { build: 2 },
  graphql: { build: 2 },
  forms: { build: 1 },
  migration: { build: 1, operations: 1 },
  refactor: { build: 2 },
  monorepo: { build: 1, operations: 1 },
  'state-management': { build: 2 },
  'data-fetching': { build: 2 },
  automation: { build: 1, operations: 2 },

  // plan
  strategy: { plan: 3 },
  planning: { plan: 3 },
  roadmap: { plan: 3 },
  'project-management': { plan: 3 },
  execution: { plan: 2 },
  'critical-path': { plan: 2 },
  prd: { plan: 2 },
  'user-stories': { plan: 2 },
  product: { plan: 2 },
  'product-management': { plan: 2 },
  architecture: { plan: 2, build: 1 },
  'system-design': { plan: 2 },
  adr: { plan: 2 },
  gtm: { plan: 1, growth: 2 },
  okr: { plan: 2 },
  ideation: { plan: 2 },
  orchestrator: { plan: 2 },
  orchestration: { plan: 2 },
  executive: { plan: 2 },
  'decision-making': { plan: 2 },
  ethics: { plan: 1, security: 2 },

  // debug
  qa: { debug: 3 },
  testing: { debug: 3 },
  'test-strategy': { debug: 3 },
  playwright: { debug: 2 },
  debugging: { debug: 3 },
  incident: { debug: 2, operations: 1 },
  'error-handling': { debug: 2 },
  observability: { debug: 2, operations: 1 },
  performance: { debug: 2 },

  // review
  challenger: { review: 3 },
  clarity: { review: 2 },
  'devil-advocate': { review: 2 },
  'pre-mortem': { review: 2 },
  review: { review: 3 },
  'code-quality': { review: 3 },
  drift: { review: 2 },
  alignment: { review: 2 },
  'scope-creep': { review: 2 },
  documentation: { review: 1, operations: 2 },
  'technical-writing': { review: 1, operations: 2 },

  // security
  security: { security: 3 },
  'threat-modeling': { security: 3 },
  owasp: { security: 3 },
  vulnerability: { security: 3 },
  auth: { security: 2 },
  rls: { security: 2 },
  privacy: { security: 2 },
  gdpr: { security: 2 },
  'gdpr-aware': { security: 1 },
  compliance: { security: 2 },
  grc: { security: 2 },
  risk: { security: 2 },
  governance: { security: 2 },
  audit: { security: 2 },
  'supply-chain': { security: 3 },
  'prompt-injection': { security: 3 },
  'ai-safety': { security: 2 },
  'responsible-ai': { security: 2 },
  'ai-act': { security: 2 },
  bias: { security: 1 },
  'pci-dss': { security: 2 },
  env: { security: 1 },

  // design
  design: { design: 3 },
  ui: { design: 3 },
  ux: { design: 3 },
  'design-system': { design: 3 },
  accessibility: { design: 3 },
  tokens: { design: 2 },
  figma: { design: 2 },
  components: { design: 2 },
  animation: { design: 2 },
  motion: { design: 2 },
  'creative-direction': { design: 2 },
  'visual-identity': { design: 2 },
  brand: { design: 2 },
  creative: { design: 2 },
  photography: { design: 2 },
  '3d': { design: 2 },
  blender: { design: 2 },
  keyshot: { design: 2 },
  rendering: { design: 2 },
  'ux-research': { design: 2 },
  'user-insights': { design: 2 },

  // growth
  marketing: { growth: 3 },
  growth: { growth: 3 },
  campaigns: { growth: 2 },
  seo: { growth: 3 },
  'organic-growth': { growth: 3 },
  content: { growth: 2 },
  copywriting: { growth: 2 },
  social: { growth: 2 },
  'social-media': { growth: 2 },
  leadgen: { growth: 3 },
  outbound: { growth: 2 },
  pipeline: { growth: 2 },
  sales: { growth: 3 },
  'deal-strategy': { growth: 2 },
  meddpicc: { growth: 2 },
  discovery: { growth: 2 },
  closing: { growth: 2 },
  pitch: { growth: 2 },
  proposals: { growth: 2 },
  pr: { growth: 2 },
  communications: { growth: 2 },
  press: { growth: 2 },
  'brand-voice': { growth: 2 },
  messaging: { growth: 2 },
  positioning: { growth: 2 },
  'case-study': { growth: 2 },
  'social-proof': { growth: 2 },
  email: { growth: 2 },
  analytics: { growth: 2 },
  kpi: { growth: 2 },
  metrics: { growth: 2 },
  attribution: { growth: 2 },
  'competitive-intelligence': { growth: 2 },
  'competitive-intel': { growth: 2 },
  'market-research': { growth: 2 },
  video: { growth: 1, design: 2 },

  // operations
  operations: { operations: 3 },
  hr: { operations: 3 },
  process: { operations: 3 },
  sop: { operations: 3 },
  hiring: { operations: 3 },
  recruiting: { operations: 3 },
  onboarding: { operations: 2 },
  support: { operations: 2 },
  cx: { operations: 2 },
  retention: { operations: 2 },
  'customer-success': { operations: 2 },
  'account-management': { operations: 2 },
  legal: { operations: 3 },
  contracts: { operations: 3 },
  tos: { operations: 2 },
  nda: { operations: 2 },
  finance: { operations: 3 },
  pricing: { operations: 2 },
  'unit-economics': { operations: 2 },
  billing: { operations: 2 },
  invoicing: { operations: 2 },
  budget: { operations: 2 },
  devops: { operations: 3 },
  infrastructure: { operations: 3 },
  kubernetes: { operations: 2 },
  terraform: { operations: 2 },
  deployment: { operations: 2 },
  ci: { operations: 2 },
  release: { operations: 2 },
  versioning: { operations: 2 },
  github: { operations: 2 },
  knowledge: { operations: 2 },
  memory: { operations: 2 },
  partnerships: { operations: 2 },
  bd: { operations: 2 },
  crm: { operations: 2 },
  data: { operations: 1 },
  sql: { operations: 1 },
};

export interface RoleClassification {
  role: CouncilPrimaryRole;
  /** True when no tag scored — the fallback was used and should be recorded. */
  fallback: boolean;
  /** Winning score, for diagnostics. */
  score: number;
}

/**
 * The documented fallback. Operations is chosen deliberately: it is the role
 * whose baseline grants the least (no write scope, no shell), so an unclassified
 * agent lands in the most constrained place rather than the most useful one.
 */
export const FALLBACK_ROLE: CouncilPrimaryRole = 'operations';

/**
 * Classify an agent from its tags plus its free-text `role` line.
 *
 * Deterministic: the same tags always produce the same role, and ties are
 * broken by the fixed `COUNCIL_PRIMARY_ROLES` order rather than by object
 * iteration order.
 */
export function classifyPrimaryRole(input: {
  agentId: string;
  tags: readonly string[];
  roleText?: string;
}): RoleClassification {
  const scores = new Map<CouncilPrimaryRole, number>();
  const add = (role: CouncilPrimaryRole, weight: number) =>
    scores.set(role, (scores.get(role) ?? 0) + weight);

  for (const rawTag of input.tags) {
    const tag = String(rawTag).trim().toLowerCase();
    const weights = TAG_ROLE_WEIGHTS[tag];
    if (!weights) continue;
    for (const [role, weight] of Object.entries(weights)) {
      add(role as CouncilPrimaryRole, weight ?? 0);
    }
  }

  // The free-text `role:` line contributes at half weight — it is prose, and
  // prose should never outvote the structured tag list.
  const roleWords = (input.roleText ?? '')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
  for (const word of roleWords) {
    const weights = TAG_ROLE_WEIGHTS[word];
    if (!weights) continue;
    for (const [role, weight] of Object.entries(weights)) {
      add(role as CouncilPrimaryRole, (weight ?? 0) / 2);
    }
  }

  let best: CouncilPrimaryRole | null = null;
  let bestScore = 0;
  for (const role of COUNCIL_PRIMARY_ROLES) {
    const score = scores.get(role) ?? 0;
    if (score > bestScore) {
      best = role;
      bestScore = score;
    }
  }

  if (best === null) return { role: FALLBACK_ROLE, fallback: true, score: 0 };
  return { role: best, fallback: false, score: bestScore };
}
