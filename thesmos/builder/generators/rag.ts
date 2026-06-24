/**
 * RAG pipeline generator — creates Retrieval-Augmented Generation scaffold from wizard answers.
 *
 * Outputs (scaffold mode):
 *   - thesmos/rag/<name>/chunker.ts
 *   - thesmos/rag/<name>/retriever.ts
 *   - thesmos/rag/<name>/pipeline.ts
 *   - thesmos/mcp-tools/<name>-rag.ts  (if mcpTool === 'yes')
 */

import type { WizardAnswers, WizardContext } from '../wizard.js';
import { makeLogger } from '../../logger.js';

const log = makeLogger('generator:rag');

export interface RagArtifact {
  files: Array<{ path: string; content: string; label: string }>;
  ragName: string;
}

// ── Chunker ───────────────────────────────────────────────────────────────────

function buildChunker(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'rag-pipeline';
  const chunkSize = answers['chunkSize'] === 'small' ? 512 : answers['chunkSize'] === 'large' ? 2048 : 1024;
  const docFormat = answers['docFormat'] ?? 'markdown';

  return `/**
 * ${name} — document chunker
 * Doc format: ${docFormat}
 * Chunk size: ${chunkSize} tokens (approx)
 */

import { makeLogger } from '../../logger.js';

const log = makeLogger('rag:${name}:chunker');

export interface Chunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    chunkIndex: number;
    totalChunks: number;
  };
}

const CHUNK_SIZE = ${chunkSize};
const CHUNK_OVERLAP = Math.floor(${chunkSize} * 0.1);

export function chunkDocument(source: string, content: string): Chunk[] {
  const words = content.split(/\\s+/);
  const chunks: Chunk[] = [];
  let i = 0;

  while (i < words.length) {
    const slice = words.slice(i, i + CHUNK_SIZE);
    if (slice.length === 0) break;

    chunks.push({
      id: \`\${source}:chunk:\${chunks.length}\`,
      content: slice.join(' '),
      metadata: {
        source,
        chunkIndex: chunks.length,
        totalChunks: 0, // filled in below
      },
    });

    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  const total = chunks.length;
  for (const chunk of chunks) chunk.metadata.totalChunks = total;

  log.debug('chunked document', { source, chunks: total, chunkSize: CHUNK_SIZE });
  return chunks;
}
`;
}

// ── Retriever ─────────────────────────────────────────────────────────────────

function buildRetriever(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'rag-pipeline';
  const vectorStore = answers['vectorStore'] ?? 'in-memory';
  const retrieval = answers['retrieval'] ?? 'similarity';
  const embedModel = answers['embedModel'] ?? 'openai';

  const embedComment = embedModel === 'openai'
    ? '// Uses ANTHROPIC_API_KEY or OPENAI_API_KEY — BYOK, never stored by Thesmos'
    : embedModel === 'anthropic'
    ? '// Uses ANTHROPIC_API_KEY — BYOK, never stored by Thesmos'
    : '// Uses local embedding model — no API key needed';

  return `/**
 * ${name} — vector retriever
 * Vector store: ${vectorStore}
 * Retrieval strategy: ${retrieval}
 * Embedding model: ${embedModel}
 */

import { makeLogger } from '../../logger.js';
import type { Chunk } from './chunker.js';

const log = makeLogger('rag:${name}:retriever');

${embedComment}

export interface RetrievedChunk extends Chunk {
  score: number;
}

// ── Embedding ────────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  ${embedModel === 'openai' || embedModel === 'anthropic'
    ? `// TODO: call embedding API with BYOK key from env
  // const apiKey = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  // if (!apiKey) throw new Error('API key required for embeddings. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  throw new Error('Embedding not yet implemented — wire up your BYOK API key');`
    : `// TODO: call local sentence-transformers or similar
  throw new Error('Local embedding not yet implemented');`}
}

// ── In-memory store (replace with ${vectorStore} in production) ──────────────

interface VectorEntry { chunk: Chunk; vector: number[] }
const store: VectorEntry[] = [];

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB);
}

export async function addDocuments(chunks: Chunk[]): Promise<void> {
  for (const chunk of chunks) {
    const vector = await embed(chunk.content);
    store.push({ chunk, vector });
  }
  log.info('documents indexed', { count: chunks.length });
}

export async function retrieve(query: string, topK = 5): Promise<RetrievedChunk[]> {
  const queryVector = await embed(query);

  const scored = store.map(({ chunk, vector }) => ({
    ...chunk,
    score: cosineSimilarity(queryVector, vector),
  }));

  ${retrieval === 'mmr'
    ? `// MMR: balance relevance and diversity
  const sorted = scored.sort((a, b) => b.score - a.score);
  const results: RetrievedChunk[] = [];
  const selected = new Set<string>();
  for (const item of sorted) {
    if (results.length >= topK) break;
    if (!selected.has(item.id)) {
      results.push(item);
      selected.add(item.id);
    }
  }
  return results;`
    : retrieval === 'hybrid'
    ? `// Hybrid: boost exact keyword matches in addition to semantic score
  const queryWords = new Set(query.toLowerCase().split(/\\s+/));
  const hybridScored = scored.map(item => ({
    ...item,
    score: item.score + (Array.from(queryWords).filter(w => item.content.toLowerCase().includes(w)).length * 0.05),
  }));
  return hybridScored.sort((a, b) => b.score - a.score).slice(0, topK);`
    : `// Similarity: return top-K by cosine similarity
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);`}
}
`;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

function buildPipeline(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'rag-pipeline';
  const job = answers['job'] ?? 'answer questions about documents';
  const outputFormat = answers['outputFormat'] ?? 'plain text';

  return `/**
 * ${name} — RAG pipeline
 * Purpose: ${job}
 * Output format: ${outputFormat}
 *
 * Security: retrieved content is used as context only.
 * Do NOT pass user queries directly into system prompts (prompt injection via docs).
 * Always sanitize retrieved content before including in LLM calls.
 */

import { makeLogger } from '../../logger.js';
import { chunkDocument } from './chunker.js';
import { addDocuments, retrieve } from './retriever.js';

export { addDocuments };

const log = makeLogger('rag:${name}:pipeline');

export interface PipelineQuery {
  query: string;
  topK?: number;
}

export interface PipelineResult {
  answer: string;
  sources: string[];
  ${outputFormat === 'json-citations' ? 'citations: Array<{ source: string; excerpt: string }>;' : ''}
}

export async function ingest(source: string, content: string): Promise<void> {
  const chunks = chunkDocument(source, content);
  await addDocuments(chunks);
  log.info('ingested', { source, chunks: chunks.length });
}

export async function query(input: PipelineQuery): Promise<PipelineResult> {
  const { query: userQuery, topK = 5 } = input;

  log.info('query received', { queryLength: userQuery.length });

  const retrieved = await retrieve(userQuery, topK);
  const sources = [...new Set(retrieved.map((c) => c.metadata.source))];

  // Build context — sanitize to prevent prompt injection via retrieved docs
  const context = retrieved
    .map((c) => \`[Source: \${c.metadata.source}]\\n\${c.content}\`)
    .join('\\n\\n---\\n\\n');

  // TODO: send context + query to LLM (BYOK)
  // const apiKey = process.env.ANTHROPIC_API_KEY;
  // if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for LLM completion');
  // const answer = await callLLM(context, userQuery, apiKey);
  const answer = \`[TODO: wire LLM completion] Context retrieved (\${retrieved.length} chunks from \${sources.length} source(s))\`;

  log.info('query complete', { sources: sources.length, chunks: retrieved.length });

  return {
    answer,
    sources,
    ${outputFormat === 'json-citations' ? 'citations: retrieved.map(c => ({ source: c.metadata.source, excerpt: c.content.slice(0, 200) })),' : ''}
  };
}
`;
}

// ── MCP tool ──────────────────────────────────────────────────────────────────

function buildMcpTool(answers: WizardAnswers): string {
  const name = answers['name'] ?? 'rag-pipeline';
  const job = answers['job'] ?? 'answer questions about documents';

  return `/**
 * ${name}-rag — MCP tool for Prometheus MCP server
 * Purpose: ${job}
 *
 * Register in thesmos/mcp-server.ts TOOL_DEFINITIONS array.
 */

import { query } from '../rag/${name}/pipeline.js';

export const RAG_TOOL_DEFINITION = {
  name: '${name}_rag_query',
  description: '${job}. Returns answer with source citations.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The question to answer' },
      topK: { type: 'number', description: 'Number of chunks to retrieve (default: 5)' },
    },
    required: ['query'],
  },
};

export async function handle${name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join('')}RagQuery(
  params: { query: string; topK?: number },
): Promise<unknown> {
  const result = await query({ query: params.query, topK: params.topK });
  return result;
}
`;
}

// ── Plan generator ────────────────────────────────────────────────────────────

export function generateRagPlan(answers: WizardAnswers, context: WizardContext): string {
  const name = answers['name'] ?? 'rag-pipeline';
  const displayName = name.split('-').map((w: string) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  const job = answers['job'] ?? 'answer questions about documents';
  const docFormat = answers['docFormat'] ?? 'Markdown';
  const embedModel = answers['embedModel'] ?? 'OpenAI';
  const vectorStore = answers['vectorStore'] ?? 'in-memory';
  const retrieval = answers['retrieval'] ?? 'similarity';
  const outputFormat = answers['outputFormat'] ?? 'plain text';
  const mcpTool = answers['mcpTool'] ?? 'no';
  const chunkSize = answers['chunkSize'] ?? 'medium 1024';

  return [
    `# ${displayName} — RAG Pipeline Implementation Plan`,
    '',
    `## Purpose`,
    job,
    '',
    `## Architecture decisions`,
    '',
    `| Decision | Choice | Rationale |`,
    `|----------|--------|-----------|`,
    `| Document format | ${docFormat} | Input document type |`,
    `| Embedding model | ${embedModel} | BYOK — uses your own API key |`,
    `| Vector store | ${vectorStore} | Storage backend for embeddings |`,
    `| Retrieval strategy | ${retrieval} | Balance between relevance and diversity |`,
    `| Output format | ${outputFormat} | Downstream consumer format |`,
    `| Chunk size | ${chunkSize} | Balances context vs. token cost |`,
    `| Expose as MCP tool | ${mcpTool} | Makes this pipeline accessible to AI agents |`,
    '',
    `## Files to create`,
    '',
    `- \`thesmos/rag/${name}/chunker.ts\` — document chunking`,
    `- \`thesmos/rag/${name}/retriever.ts\` — vector storage + similarity search`,
    `- \`thesmos/rag/${name}/pipeline.ts\` — ingestion + query pipeline`,
    mcpTool === 'yes' ? `- \`thesmos/mcp-tools/${name}-rag.ts\` — MCP tool wrapper` : '',
    '',
    `## Implementation checklist`,
    '',
    `- [ ] Create chunker, retriever, pipeline files`,
    `- [ ] Wire real embedding API (BYOK — \`ANTHROPIC_API_KEY\` or \`OPENAI_API_KEY\`)`,
    `- [ ] Replace in-memory store with ${vectorStore}`,
    `- [ ] Add document ingestion script`,
    `- [ ] Wire LLM completion call in pipeline.ts`,
    mcpTool === 'yes' ? `- [ ] Register \`${name}_rag_query\` in thesmos/mcp-server.ts` : '',
    `- [ ] Run governance scan: thesmos review thesmos/rag/${name}/`,
    '',
    `## Security considerations`,
    '',
    `- **Prompt injection via docs**: Retrieved content MUST be treated as untrusted data.`,
    `  Never paste raw retrieved content into system prompts without sanitization.`,
    `- **API key handling**: Pass keys via env var only (\`ANTHROPIC_API_KEY\`). Never store in files.`,
    `- **Access control**: Ensure the retrieval endpoint requires authentication.`,
    `- **PII in documents**: If ingesting user data, apply retention limits and access controls.`,
    '',
    `---`,
    `*Generated by thesmos build:rag --plan*`,
    `*Run: thesmos build:rag --scaffold to write code files*`,
  ].filter((l) => l !== '').join('\n');
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateRag(
  answers: WizardAnswers,
  context: WizardContext,
  opts: { scaffold: boolean; planOnly: boolean },
): Promise<RagArtifact> {
  const name = (answers['name'] ?? 'rag-pipeline').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  answers['name'] = name;
  const mcpTool = answers['mcpTool'] ?? 'no';

  const files: RagArtifact['files'] = [];

  if (opts.scaffold) {
    files.push({
      path: `thesmos/rag/${name}/chunker.ts`,
      content: buildChunker(answers),
      label: 'Document chunker',
    });
    files.push({
      path: `thesmos/rag/${name}/retriever.ts`,
      content: buildRetriever(answers),
      label: 'Vector retriever',
    });
    files.push({
      path: `thesmos/rag/${name}/pipeline.ts`,
      content: buildPipeline(answers),
      label: 'RAG pipeline',
    });
    if (mcpTool === 'yes') {
      files.push({
        path: `thesmos/mcp-tools/${name}-rag.ts`,
        content: buildMcpTool(answers),
        label: 'MCP tool wrapper',
      });
    }
  }

  log.info('rag generator complete', { name, files: files.length });
  return { files, ragName: name };
}
