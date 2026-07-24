// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, expect, it } from 'vitest';
import { generateRag, generateRagPlan } from './rag.js';
import type { WizardAnswers, WizardContext } from '../wizard.js';

const ctx: WizardContext = {
  detectedStack: ['typescript'],
  projectName: 'thesmos-rag-test',
  hasExistingAgents: false,
};

function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    name: 'docs-qa',
    job: 'answer questions about docs',
    docFormat: 'markdown',
    chunkSize: 'medium',
    embedModel: 'openai',
    vectorStore: 'in-memory',
    retrieval: 'similarity',
    outputFormat: 'plain text',
    mcpTool: 'no',
    ...overrides,
  };
}

describe('generateRag scaffold', () => {
  it('emits real OpenAI embed + completeWithContext (no TODO stubs)', async () => {
    const artifact = await generateRag(answers({ embedModel: 'openai' }), ctx, {
      scaffold: true,
      planOnly: false,
    });
    const retriever = artifact.files.find((f) => f.path.endsWith('retriever.ts'))?.content ?? '';
    const pipeline = artifact.files.find((f) => f.path.endsWith('pipeline.ts'))?.content ?? '';

    expect(retriever).toContain('api.openai.com/v1/embeddings');
    expect(retriever).not.toContain('Embedding not yet implemented');
    expect(retriever).not.toContain('ANTHROPIC_API_KEY');

    expect(pipeline).toContain('async function completeWithContext');
    expect(pipeline).toContain('await completeWithContext(context, userQuery)');
    expect(pipeline).not.toContain('[TODO: wire LLM completion]');
    expect(pipeline).toContain('api.anthropic.com/v1/messages');
  });

  it('maps legacy anthropic embedModel to local deterministic embed', async () => {
    const artifact = await generateRag(answers({ embedModel: 'anthropic' }), ctx, {
      scaffold: true,
      planOnly: false,
    });
    const retriever = artifact.files.find((f) => f.path.endsWith('retriever.ts'))?.content ?? '';
    expect(retriever).toContain('Deterministic local embedding');
    expect(retriever).not.toContain('Embedding not yet implemented');
    expect(retriever).not.toContain('Local embedding not yet implemented');
  });

  it('emits Cohere embed when selected', async () => {
    const artifact = await generateRag(answers({ embedModel: 'cohere' }), ctx, {
      scaffold: true,
      planOnly: false,
    });
    const retriever = artifact.files.find((f) => f.path.endsWith('retriever.ts'))?.content ?? '';
    expect(retriever).toContain('api.cohere.com/v1/embed');
    expect(retriever).toContain('COHERE_API_KEY');
  });
});

describe('generateRagPlan', () => {
  it('does not tell users to wire ANTHROPIC_API_KEY for embeddings', () => {
    const plan = generateRagPlan(answers(), ctx);
    expect(plan).not.toMatch(/Wire real embedding API \(BYOK — `ANTHROPIC_API_KEY`/);
    expect(plan).toContain('Anthropic has no public embeddings API');
    expect(plan).toContain('answer generation');
  });
});
