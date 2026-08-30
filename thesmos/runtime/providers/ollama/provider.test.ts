// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Ollama provider tests.
 *
 * Everything runs against an injected `fetch`, so the suite never needs a live
 * Ollama and never opens a socket. Streaming is exercised through a real
 * ReadableStream so the newline framing is genuinely tested rather than stubbed.
 */
import { describe, it, expect, vi } from 'vitest';
import { COUNCIL_PERMISSION_CHANNELS, type CouncilPermissionPolicy } from '../../../council/contract.js';
import { supportsEmbeddings, type RuntimeEvent } from '../../types.js';
import { ProviderError } from '../../errors.js';
import { OllamaProvider } from './provider.js';

function emptyPolicy(): CouncilPermissionPolicy {
  return COUNCIL_PERMISSION_CHANNELS.reduce((acc, c) => {
    acc[c] = [];
    return acc;
  }, {} as CouncilPermissionPolicy);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build an ndjson stream the way Ollama emits one. */
function ndjsonResponse(frames: unknown[], chunkSplitter?: (s: string) => string[]): Response {
  const text = frames.map((f) => JSON.stringify(f)).join('\n') + '\n';
  const pieces = chunkSplitter ? chunkSplitter(text) : [text];
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/**
 * A body that stays open until the signal aborts, then errors — the behaviour
 * real `fetch` gives an in-flight stream. Without this the cancellation tests
 * would hang rather than prove anything.
 */
function openStreamHonouring(signal: AbortSignal | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!signal) return;
      if (signal.aborted) {
        controller.error(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => controller.error(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    },
  });
}

function connectionRefused(): never {
  const err = new Error('fetch failed') as Error & { cause?: { code: string } };
  err.cause = { code: 'ECONNREFUSED' };
  throw err;
}

describe('OllamaProvider health', () => {
  it('reports available with latency when the service answers', async () => {
    const provider = new OllamaProvider({
      fetchImpl: vi.fn(async () => jsonResponse({ models: [] })) as unknown as typeof fetch,
    });
    const health = await provider.health();
    expect(health.available).toBe(true);
    expect(health.locality).toBe('local');
    expect(health.endpoint).toBe('http://127.0.0.1:11434');
    expect(typeof health.latencyMs).toBe('number');
  });

  it('reports unavailable rather than throwing when Ollama is not running', async () => {
    // An uninstalled optional provider is a normal state of the world.
    const provider = new OllamaProvider({
      fetchImpl: vi.fn(connectionRefused) as unknown as typeof fetch,
    });
    const health = await provider.health();
    expect(health.available).toBe(false);
    expect(health.errorCode).toBe('connection_refused');
    expect(health.detail).toMatch(/isn't reachable/i);
  });

  it('verifies the service endpoint, not a binary on PATH', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [] }));
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await provider.health();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reports egress_denied for an ungoverned remote endpoint without dialling it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [] }));
    const provider = new OllamaProvider({
      baseUrl: 'https://ollama.example.com',
      policy: emptyPolicy(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const health = await provider.health();
    expect(health.available).toBe(false);
    expect(health.errorCode).toBe('egress_denied');
    expect(health.locality).toBe('remote');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('OllamaProvider listModels', () => {
  it('discovers installed models dynamically with metadata', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({
          models: [{ name: 'qwen3:8b', size: 5_200_000_000, details: { parameter_size: '8B', quantization_level: 'Q4_K_M' } }],
        });
      }
      return jsonResponse({
        capabilities: ['completion', 'tools', 'thinking'],
        model_info: { 'qwen3.context_length': 40960 },
      });
    });
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const models = await provider.listModels();

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'qwen3:8b',
      providerId: 'ollama',
      local: true,
      parameterSize: '8B',
      quantization: 'Q4_K_M',
      contextWindow: 40960,
      sizeBytes: 5_200_000_000,
    });
    expect(models[0].capabilities).toMatchObject({ toolUse: true, reasoning: true, vision: false });
  });

  it('bills local inference as local-compute, never as free', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags') ? jsonResponse({ models: [{ name: 'llama3:8b' }] }) : jsonResponse({}),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [model] = await provider.listModels();
    expect(model.billingClass).toBe('local-compute');
    expect(model.privacyClass).toBe('local-only');
  });

  it('leaves undetectable metadata unknown rather than guessing', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags') ? jsonResponse({ models: [{ name: 'mystery:latest' }] }) : jsonResponse({}),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [model] = await provider.listModels();
    expect(model.contextWindow).toBeUndefined();
    expect(model.parameterSize).toBeUndefined();
    expect(model.capabilities.toolUse).toBeUndefined();
  });

  it('reads embedding width from the family key, not a sibling decoy', async () => {
    // Real shape from gemma4: the vision tower and a per-layer field both end
    // in `embedding_length`. Picking either would size a vector store wrongly
    // and only fail later, at retrieval.
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags')
        ? jsonResponse({ models: [{ name: 'gemma4:26b' }] })
        : jsonResponse({
            model_info: {
              'gemma4.context_length': 262144,
              'gemma4.embedding_length': 2816,
              'gemma4.embedding_length_per_layer_input': 0,
              'gemma4.vision.embedding_length': 1152,
            },
          }),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [model] = await provider.listModels();
    expect(model.embeddingDimensions).toBe(2816);
    expect(model.contextWindow).toBe(262144);
  });

  it('leaves embedding width unknown when the provider does not report it', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags') ? jsonResponse({ models: [{ name: 'x:latest' }] }) : jsonResponse({ model_info: {} }),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [model] = await provider.listModels();
    expect(model.embeddingDimensions).toBeUndefined();
  });

  it('surfaces embedding-capable models so memory can select one', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags')
        ? jsonResponse({ models: [{ name: 'nomic-embed-text' }] })
        : jsonResponse({ capabilities: ['embedding'], model_info: { 'nomic.embedding_length': 768 } }),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [model] = await provider.listModels();
    expect(model.capabilities.embeddings).toBe(true);
    expect(model.embeddingDimensions).toBe(768);
  });

  it('returns an empty list rather than throwing when unreachable', async () => {
    const provider = new OllamaProvider({
      fetchImpl: vi.fn(connectionRefused) as unknown as typeof fetch,
    });
    await expect(provider.listModels()).resolves.toEqual([]);
  });

  it('fails safely on a malformed model payload', async () => {
    const provider = new OllamaProvider({
      fetchImpl: vi.fn(async () => jsonResponse({ models: 'not-an-array' })) as unknown as typeof fetch,
    });
    await expect(provider.listModels()).resolves.toEqual([]);
  });

  it('drops nameless entries instead of rendering blank rows', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags')
        ? jsonResponse({ models: [{ name: 'good:latest' }, { size: 1 }, null] })
        : jsonResponse({}),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toEqual(['good:latest']);
  });

  it('marks models from a granted remote endpoint as non-local egress', async () => {
    const policy = emptyPolicy();
    policy.web = [{ decision: 'allow', patterns: ['https://ollama.example.com'] }];
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/api/tags') ? jsonResponse({ models: [{ name: 'llama3:8b' }] }) : jsonResponse({}),
    );
    const provider = new OllamaProvider({
      baseUrl: 'https://ollama.example.com',
      policy,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [model] = await provider.listModels();
    expect(model.local).toBe(false);
    expect(model.privacyClass).toBe('egress');
  });
});

describe('OllamaProvider chat', () => {
  function collect(): { events: RuntimeEvent[]; sink: (e: RuntimeEvent) => void } {
    const events: RuntimeEvent[] = [];
    return { events, sink: (e) => events.push(e) };
  }

  it('normalizes a streamed turn into runtime events', async () => {
    const fetchImpl = vi.fn(async () =>
      ndjsonResponse([
        { message: { content: 'Hel' } },
        { message: { content: 'lo' } },
        { done: true, prompt_eval_count: 12, eval_count: 4 },
      ]),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { events, sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp', onEvent: sink, model: 'qwen3:8b' });

    await session.send('hi');

    expect(events.filter((e) => e.kind === 'textDelta').map((e) => (e as { text: string }).text)).toEqual(['Hel', 'lo']);
    const done = events.find((e) => e.kind === 'turnDone') as { inputTokens?: number; outputTokens?: number; isError: boolean };
    expect(done).toMatchObject({ inputTokens: 12, outputTokens: 4, isError: false });
    expect(events.find((e) => e.kind === 'init')).toBeDefined();
  });

  it('reassembles frames split across chunk boundaries', async () => {
    // Cutting a frame mid-object and parsing it would drop tokens silently.
    const fetchImpl = vi.fn(async () =>
      ndjsonResponse(
        [{ message: { content: 'alpha' } }, { done: true }],
        (text) => [text.slice(0, 12), text.slice(12)],
      ),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { events, sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp', onEvent: sink, model: 'm' });

    await session.send('hi');
    expect(events.filter((e) => e.kind === 'textDelta').map((e) => (e as { text: string }).text).join('')).toBe('alpha');
  });

  it('surfaces reasoning output separately from answer text', async () => {
    const fetchImpl = vi.fn(async () =>
      ndjsonResponse([{ message: { thinking: 'pondering' } }, { message: { content: 'answer' } }, { done: true }]),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { events, sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp', onEvent: sink, model: 'm' });

    await session.send('hi');
    expect(events.some((e) => e.kind === 'thinkingDelta')).toBe(true);
  });

  it('normalizes a missing model into an actionable message', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('model "ghost" not found, try pulling it first', { status: 404 }),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { events, sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp', onEvent: sink, model: 'ghost' });

    await session.send('hi');
    const err = events.find((e) => e.kind === 'stderr') as { text: string };
    expect(err.text).toMatch(/not installed/i);
    expect((events.find((e) => e.kind === 'turnDone') as { isError: boolean }).isError).toBe(true);
  });

  it('keeps provider payloads out of user-facing errors', async () => {
    const huge = 'SECRET_SOURCE_CODE'.repeat(500);
    const fetchImpl = vi.fn(async () => new Response(huge, { status: 500 }));
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { events, sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp', onEvent: sink, model: 'm' });

    await session.send('hi');
    const err = events.find((e) => e.kind === 'stderr') as { text: string };
    expect(err.text).not.toContain('SECRET_SOURCE_CODE');
    expect(err.text.length).toBeLessThan(200);
  });

  it('refuses to send without a selected model', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { events, sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp', onEvent: sink });

    await session.send('hi');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((events.find((e) => e.kind === 'turnDone') as { isError: boolean }).isError).toBe(true);
  });

  it('aborts the HTTP request on stop, leaving no zombie inference', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      // Never-ending stream, mirroring a long generation. Real `fetch` errors
      // the body when the signal aborts, so the mock must too — otherwise the
      // test would pass on a provider that leaks inference.
      return new Response(openStreamHonouring(init.signal ?? undefined), { status: 200 });
    });
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp', onEvent: sink, model: 'm' });

    const turn = session.send('hi');
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal!.aborted).toBe(false);

    session.stop();
    expect(capturedSignal!.aborted).toBe(true);
    await turn;
    expect(session.running).toBe(false);
  });

  it('does not report a user-initiated stop as an error', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      new Response(openStreamHonouring(init.signal ?? undefined), { status: 200 }),
    );
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { events, sink } = collect();
    const session = provider.createSession({ workspaceRoot: '/tmp', onEvent: sink, model: 'm' });

    const turn = session.send('hi');
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    session.stop();
    await turn;

    expect(events.some((e) => e.kind === 'stderr')).toBe(false);
  });

  it('refuses to create a session for an ungoverned remote endpoint', () => {
    const provider = new OllamaProvider({
      baseUrl: 'https://ollama.example.com',
      policy: emptyPolicy(),
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(() =>
      provider.createSession({ workspaceRoot: '/tmp', onEvent: () => {}, model: 'm' }),
    ).toThrow(ProviderError);
  });
});

describe('OllamaProvider embeddings', () => {
  it('is reachable as a capability without opening a chat session', async () => {
    // Governed memory must not have to fake a conversation to embed a corpus —
    // that is what would force a second inference path later.
    const fetchImpl = vi.fn(async () => jsonResponse({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }));
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const vectors = await provider.embed('nomic-embed-text', ['alpha', 'beta']);
    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/embed',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('narrows through supportsEmbeddings so a consumer needs no cast', () => {
    const provider = new OllamaProvider({ fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(supportsEmbeddings(provider)).toBe(true);
  });

  it('refuses to embed to an ungoverned remote endpoint', async () => {
    // Embedding a repository is egress like any other prompt.
    const fetchImpl = vi.fn(async () => jsonResponse({ embeddings: [] }));
    const provider = new OllamaProvider({
      baseUrl: 'https://ollama.example.com',
      policy: emptyPolicy(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.embed('m', ['secret source'])).rejects.toThrow(ProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a malformed embedding payload rather than returning junk vectors', async () => {
    const provider = new OllamaProvider({
      fetchImpl: vi.fn(async () => jsonResponse({ embeddings: 'nope' })) as unknown as typeof fetch,
    });
    await expect(provider.embed('m', ['x'])).rejects.toThrow(/unreadable/i);
  });

  it('passes an abort signal through so a long indexing run is cancellable', async () => {
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      seen = init.signal ?? undefined;
      return jsonResponse({ embeddings: [[1]] });
    });
    const provider = new OllamaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const controller = new AbortController();
    await provider.embed('m', ['x'], controller.signal);
    expect(seen).toBeDefined();
  });
});

describe('OllamaProvider tool authority', () => {
  it('reports a tool request as blocked instead of executing it', async () => {
    // The model asks; Thesmos decides. There is no path from here to a shell.
    const fetchImpl = vi.fn(async () =>
      ndjsonResponse([
        { message: { tool_calls: [{ id: 't1', function: { name: 'Bash', arguments: { command: 'rm -rf /' } } }] } },
        { done: true },
      ]),
    );
    const provider = new OllamaProvider({
      policy: emptyPolicy(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const events: RuntimeEvent[] = [];
    const session = provider.createSession({
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      model: 'm',
    });

    await session.send('delete everything');

    const result = events.find((e) => e.kind === 'toolResult') as { summary: string; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.summary).toMatch(/blocked by thesmos governance/i);
  });

  it('parses string-encoded tool arguments before judging them', async () => {
    const fetchImpl = vi.fn(async () =>
      ndjsonResponse([
        { message: { tool_calls: [{ id: 't1', function: { name: 'Bash', arguments: '{"command":"git status"}' } }] } },
        { done: true },
      ]),
    );
    const policy = emptyPolicy();
    policy.shell = [{ decision: 'allow', patterns: ['git status'] }];
    const provider = new OllamaProvider({ policy, fetchImpl: fetchImpl as unknown as typeof fetch });
    const events: RuntimeEvent[] = [];
    const session = provider.createSession({
      workspaceRoot: '/tmp',
      onEvent: (e) => events.push(e),
      model: 'm',
    });

    await session.send('check status');

    const use = events.find((e) => e.kind === 'toolUse') as { input: Record<string, unknown> };
    expect(use.input).toEqual({ command: 'git status' });
    const result = events.find((e) => e.kind === 'toolResult') as { isError: boolean; summary: string };
    // Authorized, but execution is explicitly not wired up — and says so.
    expect(result.isError).toBe(false);
    expect(result.summary).toMatch(/not yet wired up/i);
  });
});
