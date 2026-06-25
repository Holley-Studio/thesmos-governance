/**
 * Thesmos Brain Learn — BYOK Claude API integration.
 *
 * This module is NEVER imported at startup. It is dynamically imported only
 * when `brain:learn` is explicitly invoked by the user. This prevents the
 * @anthropic-ai/sdk dependency from affecting the CLI bundle for users who
 * don't use this feature.
 *
 * Security model:
 *   - API key resolved from: --api-key flag → ANTHROPIC_API_KEY env var → error
 *   - Key is NEVER stored by Thesmos — passed directly to SDK per invocation
 *   - Pre-flight cost estimate always shown before any API call
 *   - User must confirm (or pass --yes) before the API call is made
 *   - brain:learn is NEVER called automatically (no hooks, no cron)
 */

import type { BrainStore, ProposedRule, ProposedAgent } from './brain-store.js';
import { makeLogger } from './logger.js';

const log = makeLogger('brain-learn');

// ── Token/cost estimation ─────────────────────────────────────────────────────

const MODEL_COST_PER_1K: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.00025, output: 0.00125 },
  'claude-sonnet-4-6':         { input: 0.003,   output: 0.015 },
  'claude-opus-4-8':           { input: 0.015,   output: 0.075 },
};

function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const rates = MODEL_COST_PER_1K[model] ?? MODEL_COST_PER_1K['claude-haiku-4-5-20251001']!;
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}

function estimatePromptTokens(text: string): number {
  // Rough approximation: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ── Prompt builder ────────────────────────────────────────────────────────────

interface LearnPromptData {
  highSuppressRules: Array<{ ruleId: string; fires: number; suppressed: number; rate: number }>;
  stack: string[];
  sessionCount: number;
  totalFindings: number;
  suppressionExamples: Array<{ ruleId: string; reasons: string[] }>;
}

function buildLearnPrompt(data: LearnPromptData): string {
  return JSON.stringify({
    task: 'thesmos-governance-analysis',
    instructions: [
      'Analyze the governance data from a Thesmos repository scan.',
      'Identify rules with high false-positive rates and suggest refinements.',
      'Identify gaps — patterns not covered by any existing rule.',
      'Propose new custom rules as structured data.',
      'Identify patterns that suggest a new Pantheon agent would help.',
      'Return ONLY valid JSON matching the response_schema.',
    ],
    repository: {
      stack: data.stack,
      sessions: data.sessionCount,
      totalFindings: data.totalFindings,
    },
    highFalsePositiveRules: data.highSuppressRules,
    suppressionExamples: data.suppressionExamples,
    response_schema: {
      refinements: [{ ruleId: 'string', suggestion: 'string', rationale: 'string' }],
      proposedRules: [{
        id: 'string (CUSTOM_NNN)',
        name: 'string',
        description: 'string',
        severity: 'LOW|MEDIUM|HIGH|BLOCKER',
        pattern: 'string (regex or description)',
        rationale: 'string',
      }],
      proposedAgents: [{
        name: 'string (slug)',
        purpose: 'string',
        trigger: 'string',
        rationale: 'string',
      }],
      insights: ['string'],
    },
  }, null, 2);
}

// ── Learn options ─────────────────────────────────────────────────────────────

export interface LearnOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  maxCostUsd: number;
  dryRun: boolean;
  skipConfirm: boolean;
}

export interface LearnResult {
  refinements: Array<{ ruleId: string; suggestion: string; rationale: string }>;
  proposedRules: ProposedRule[];
  proposedAgents: ProposedAgent[];
  insights: string[];
  tokensUsed: number;
  estimatedCostUsd: number;
  dryRun: boolean;
}

// ── Main learn function ───────────────────────────────────────────────────────

export async function learnFromBrainStore(
  store: BrainStore,
  opts: LearnOptions,
): Promise<LearnResult> {
  // Build prompt data
  const highSuppressRules = Object.entries(store.ruleEffectiveness)
    .filter(([, eff]) => eff.fires > 0 && eff.suppressed / eff.fires > 0.4)
    .map(([ruleId, eff]) => ({
      ruleId,
      fires: eff.fires,
      suppressed: eff.suppressed,
      rate: Math.round((eff.suppressed / eff.fires) * 100),
    }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 10);

  const suppressionExamples = Object.entries(store.suppressions)
    .filter(([, s]) => s.reasons.length > 0)
    .slice(0, 5)
    .map(([ruleId, s]) => ({ ruleId, reasons: s.reasons.slice(0, 3) }));

  const promptData: LearnPromptData = {
    highSuppressRules,
    stack: store.detectedStack,
    sessionCount: store.sessions.length,
    totalFindings: store.sessions.reduce((sum, s) => sum + s.findings, 0),
    suppressionExamples,
  };

  const prompt = buildLearnPrompt(promptData);
  const estimatedInputTokens = estimatePromptTokens(prompt);
  const estimatedOutputTokens = 2000; // typical response size
  const estimatedCost = estimateCost(estimatedInputTokens, estimatedOutputTokens, opts.model);

  // Pre-flight report
  console.log('\n  thesmos brain:learn — pre-flight check\n');
  console.log(`  Model:           ${opts.model}`);
  console.log(`  Prompt tokens:   ~${estimatedInputTokens.toLocaleString()}`);
  console.log(`  Expected output: ~${estimatedOutputTokens.toLocaleString()} tokens`);
  console.log(`  Estimated cost:  ~$${estimatedCost.toFixed(4)} USD`);
  console.log(`  Budget ceiling:  $${opts.maxCostUsd} (config: brain.maxCostUsdPerRun)`);
  console.log('');

  // Budget check
  if (estimatedInputTokens > opts.maxTokens) {
    throw new Error(
      `Prompt size (~${estimatedInputTokens} tokens) exceeds maxTokensPerRun (${opts.maxTokens}).\n` +
      'Pass --max-tokens=N or reduce the data by running brain:observe on fewer sessions.',
    );
  }
  if (estimatedCost > opts.maxCostUsd) {
    throw new Error(
      `Estimated cost ($${estimatedCost.toFixed(4)}) exceeds maxCostUsdPerRun ($${opts.maxCostUsd}).\n` +
      'Pass --max-cost=N to raise the ceiling, or use a cheaper model with --model=claude-haiku-4-5-20251001.',
    );
  }

  if (opts.dryRun) {
    console.log('  (--dry-run) Would send the above prompt. No API call made.\n');
    console.log('  Prompt preview:');
    console.log('  ' + prompt.split('\n').slice(0, 10).join('\n  ') + '\n  ...\n');
    return {
      refinements: [],
      proposedRules: [],
      proposedAgents: [],
      insights: [],
      tokensUsed: 0,
      estimatedCostUsd: estimatedCost,
      dryRun: true,
    };
  }

  // Confirmation prompt (unless --yes)
  if (!opts.skipConfirm) {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirmed = await new Promise<boolean>((resolve) => {
      rl.question('  Proceed? [y/N]: ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
    if (!confirmed) {
      console.log('\n  Cancelled.\n');
      process.exit(0);
    }
  }

  // Dynamic import of Anthropic SDK — only happens when user explicitly calls brain:learn
  console.log('\n  Calling Claude API...\n');
  // @ts-ignore — @anthropic-ai/sdk is an optional runtime dep, not listed in package.json
  let Anthropic: typeof import('@anthropic-ai/sdk').default;
  try {
    // @ts-ignore — optional runtime dep; caught below if absent
    const mod = await import('@anthropic-ai/sdk');
    Anthropic = mod.default;
  } catch {
    throw new Error(
      'The @anthropic-ai/sdk package is required for brain:learn.\n' +
      'Install it: npm install --save-dev @anthropic-ai/sdk\n' +
      'Or add to your project: npm add @anthropic-ai/sdk',
    );
  }

  const client = new Anthropic({ apiKey: opts.apiKey });

  const t0 = Date.now();
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: Math.min(opts.maxTokens - estimatedInputTokens, 4096),
    messages: [{
      role: 'user',
      content: prompt,
    }],
    system: 'You are a security engineering expert analyzing code governance data. Return ONLY valid JSON matching the requested schema. No markdown, no explanation outside the JSON.',
  });
  const durationMs = Date.now() - t0;

  const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
  const actualCost = estimateCost(
    response.usage?.input_tokens ?? 0,
    response.usage?.output_tokens ?? 0,
    opts.model,
  );

  log.info('brain:learn API call complete', { tokensUsed, durationMs, actualCost });

  // Parse response
  const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
  let parsed: {
    refinements?: Array<{ ruleId: string; suggestion: string; rationale: string }>;
    proposedRules?: Array<{ id: string; name: string; description: string; severity: string; pattern: string; rationale: string }>;
    proposedAgents?: Array<{ name: string; purpose: string; trigger: string; rationale: string }>;
    insights?: string[];
  };

  try {
    parsed = JSON.parse(rawText) as typeof parsed;
  } catch {
    log.error('brain:learn response parse failed', { rawText: rawText.slice(0, 200) });
    throw new Error('Claude API returned non-JSON response. Run with --dry-run to inspect the prompt.');
  }

  const now = new Date().toISOString();
  const nextId = (n: number) => `CUSTOM_${String(n).padStart(3, '0')}`;
  const existingCount = store.proposedRules.length;

  const proposedRules: ProposedRule[] = (parsed.proposedRules ?? []).map((r, i) => ({
    id: r.id ?? nextId(existingCount + i + 1),
    name: r.name ?? 'Unnamed rule',
    description: r.description ?? '',
    severity: r.severity ?? 'MEDIUM',
    pattern: r.pattern ?? '',
    rationale: r.rationale ?? '',
    status: 'pending',
    proposedAt: now,
  }));

  const proposedAgents: ProposedAgent[] = (parsed.proposedAgents ?? []).map((a) => ({
    name: a.name ?? 'unnamed-agent',
    purpose: a.purpose ?? '',
    trigger: a.trigger ?? '',
    rationale: a.rationale ?? '',
    status: 'pending',
    proposedAt: now,
  }));

  return {
    refinements: parsed.refinements ?? [],
    proposedRules,
    proposedAgents,
    insights: parsed.insights ?? [],
    tokensUsed,
    estimatedCostUsd: actualCost,
    dryRun: false,
  };
}

// ── Cost error messages ───────────────────────────────────────────────────────

export function formatDisabledError(): string {
  return [
    '',
    '  thesmos brain:learn: disabled',
    '',
    '  brain:learn is disabled in .thesmos/config.json (brain.learn.enabled=false).',
    '  To re-enable: thesmos brain:enable',
    '',
    '  Note: All other Thesmos features work without an API key.',
    '',
  ].join('\n');
}

export function formatMissingKeyError(): string {
  return [
    '',
    '  thesmos brain:learn: ANTHROPIC_API_KEY not set',
    '',
    '  brain:learn requires your own Anthropic API key.',
    '  Set it: export ANTHROPIC_API_KEY=sk-ant-...',
    '  Or pass: thesmos brain:learn --api-key=sk-ant-...',
    '',
    '  Estimated cost per run: $0.005–$0.05 (depends on repo size)',
    '  To see the estimate without making an API call:',
    '    thesmos brain:learn --dry-run',
    '',
  ].join('\n');
}
