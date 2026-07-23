// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Zeus domain router — keyword → Pantheon agent IDs.
 * Extracted from pantheon CLI so routing is unit-testable without spawning adapters.
 */

export interface DomainRoute {
  pattern: RegExp;
  agents: string[];
}

/** Canonical Zeus routing table (lean: max 4 agents returned by routeTask). */
export const DOMAIN_ROUTING: DomainRoute[] = [
  { pattern: /marketing|campaign|growth|channel|brand awareness|gtm plan/i, agents: ['hermes-marketing-agent', 'apollo-content-agent', 'aphrodite-creative-agent'] },
  { pattern: /meddpicc|discovery call|qualify this|pipeline audit|forecast this/i, agents: ['ares-deal-strategy-agent', 'ares-discovery-agent', 'ares-pipeline-agent', 'ares-sales-agent'] },
  { pattern: /sales|pitch|deal|close|proposal|objection|demo/i, agents: ['ares-sales-agent', 'nike-leadgen-agent', 'ares-deal-strategy-agent'] },
  { pattern: /design|ui|ux|component|layout|wireframe|interface|design system/i, agents: ['hephaestus-design-agent', 'aphrodite-creative-agent'] },
  { pattern: /legal|contract|tos|nda|terms|liability|agreement/i, agents: ['themis-legal-agent', 'argus-security-agent'] },
  { pattern: /analytics|kpi|metrics|dashboard|measure/i, agents: ['tyche-analytics-agent', 'pythia-data-agent'] },
  { pattern: /security|threat|audit|vulnerability|pentest|owasp/i, agents: ['argus-security-agent'] },
  { pattern: /finance|pricing|budget|unit economics|cac|ltv|revenue|cost/i, agents: ['plutus-finance-agent'] },
  { pattern: /\bpr\b|press|media|crisis|announcement|coverage|journalist/i, agents: ['pheme-pr-agent', 'apollo-content-agent'] },
  { pattern: /operations|sop|hiring|\bhr\b|onboarding|process|handbook/i, agents: ['hera-operations-agent'] },
  { pattern: /content|copy|blog|email|post|write|landing page copy/i, agents: ['apollo-content-agent', 'erato-brand-voice-agent'] },
  { pattern: /\bseo\b|organic search|keyword cluster/i, agents: ['psyche-seo-agent', 'apollo-content-agent'] },
  { pattern: /video|production|shoot|edit|film/i, agents: ['dionysus-video-agent'] },
  { pattern: /animation|motion|storyboard|after effects|micro-interaction/i, agents: ['morpheus-animation-agent'] },
  { pattern: /photo|shot list|photography|art direction|retouching/i, agents: ['artemis-photography-agent'] },
  { pattern: /\bsql\b|business intelligence|cohort|attribution|anomaly|analyse data/i, agents: ['pythia-data-agent', 'tyche-analytics-agent'] },
  { pattern: /ux research|user interview|usability|persona|jtbd|affinity map/i, agents: ['psyche-research-agent', 'daedalus-product-agent'] },
  { pattern: /compliance|grc|gdpr|soc2|iso 27001|eu ai act|audit trail|risk register/i, agents: ['nemesis-compliance-agent', 'argus-security-agent'] },
  { pattern: /customer success|renewal|churn prevention|qbr|upsell|health score/i, agents: ['demeter-cs-agent', 'hestia-cx-agent'] },
  { pattern: /strategy|gtm|competitive|okr|positioning/i, agents: ['athena-strategy-agent'] },
  { pattern: /leads|prospecting|outbound|icp|lead gen/i, agents: ['nike-leadgen-agent'] },
  { pattern: /creative|brand|identity|visual|aesthetic|logo|creative brief/i, agents: ['aphrodite-creative-agent', 'erato-brand-voice-agent'] },
  { pattern: /\bcx\b|customer experience|retention|churn|\bnps\b|\bcsat\b/i, agents: ['hestia-cx-agent'] },
  { pattern: /support ticket|how do i install|faq|why is my gate/i, agents: ['hebe-support-agent'] },
  { pattern: /knowledge|documentation|wiki|runbook|memory|context/i, agents: ['mnemosyne-knowledge-agent', 'polyhymnia-docs-agent'] },
  { pattern: /product|prd|feature|roadmap|user story|requirements|mvp/i, agents: ['daedalus-product-agent'] },
  { pattern: /partnership|\bbd\b|business development|reseller|channel partner|alliance/i, agents: ['heracles-bd-agent'] },
  { pattern: /next\.?js|react|typescript|implement|api route|server component|web app|frontend/i, agents: ['talos-web-dev-agent', 'hephaestus-design-agent'] },
  { pattern: /architecture|system design|adr|tech stack choice/i, agents: ['chiron-architecture-agent'] },
  { pattern: /devops|dockerfile|kubernetes|terraform|ci\/?cd|infrastructure/i, agents: ['kratos-devops-agent', 'eos-automation-agent'] },
  { pattern: /test plan|playwright|qa strategy|e2e test|write tests/i, agents: ['cassandra-qa-agent'] },
  { pattern: /\bai\b|llm|prompt engineering|rag|model selection|agent architecture/i, agents: ['aether-ai-strategy-agent', 'dike-ethics-agent'] },
  { pattern: /ethics|bias|responsible ai|ai act classification/i, agents: ['dike-ethics-agent'] },
  { pattern: /mjml|html email|email template/i, agents: ['calliope-email-agent'] },
  { pattern: /project plan|critical path|break this into phases|execution plan/i, agents: ['metis-pm-agent'] },
  { pattern: /challenge this|devil.?s advocate|pre-mortem|what.?s wrong with/i, agents: ['momus-challenger-agent'] },
  { pattern: /figma|design.?to.?code|token governance/i, agents: ['eidos-figma-orchestrator'] },
  { pattern: /debug|root cause|stack trace|why is this broken/i, agents: ['asclepius-debugging-agent'] },
  { pattern: /stripe|payments|billing integration/i, agents: ['chrysos-stripe-agent', 'plutus-billing-agent'] },
  { pattern: /supabase|postgres rls/i, agents: ['pontus-supabase-agent'] },
  { pattern: /vercel|edge deploy/i, agents: ['notus-vercel-agent'] },
  { pattern: /github release|repository hygiene/i, agents: ['kronos-github-agent'] },
  { pattern: /social media|community growth|linkedin posts/i, agents: ['nike-social-agent', 'apollo-content-agent'] },
  { pattern: /case study|social proof|customer roi story/i, agents: ['clio-case-study-agent'] },
  { pattern: /drift|scope creep|are we still on course/i, agents: ['proteus-drift-agent'] },
  { pattern: /blender|3d model|keyshot|product viz/i, agents: ['pygmalion-blender-agent', 'helios-keyshot-agent'] },
];

export const MAX_ROUTED_AGENTS = 4;

/**
 * Route a free-text task to up to {@link MAX_ROUTED_AGENTS} Pantheon agent IDs.
 */
export function routeTask(task: string, maxAgents = MAX_ROUTED_AGENTS): string[] {
  const matched = new Set<string>();
  for (const { pattern, agents } of DOMAIN_ROUTING) {
    if (pattern.test(task)) {
      for (const a of agents) matched.add(a);
    }
  }
  return [...matched].slice(0, maxAgents);
}
