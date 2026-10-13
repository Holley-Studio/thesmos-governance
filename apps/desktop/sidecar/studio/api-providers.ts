// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * API-key engines: Claude, OpenAI and Gemini billed to the user's own API account.
 *
 * The native shell owns the keys. It seals them on disk and pushes them here
 * over the private pipe; this module holds them in memory only. A key is never
 * logged, returned, written, or echoed in an error.
 *
 * Off unless Settings allows it, and every use needs its own explicit consent.
 * Nothing here is ever a fallback for a subscription or local engine. Requests
 * are plain text in, plain text out: no tools, exactly three fixed hosts.
 */

import { API_WORKERS, API_COMPANY, isApiWorker, type ApiWorkerId, type Connection } from '../../shared/studio.js';
import { apiModel, MODEL_ID, type PantheonSettings } from './settings.js';
import type { WorkerResult, WorkerRun } from './workers.js';

export const API_ORIGINS: Record<ApiWorkerId, string> = {
  'claude-api': 'https://api.anthropic.com', 'openai-api': 'https://api.openai.com', 'gemini-api': 'https://generativelanguage.googleapis.com',
};
const API_NAMES: Record<ApiWorkerId, string> = { 'claude-api': 'Claude API', 'openai-api': 'OpenAI API', 'gemini-api': 'Gemini API' };
const RESPONSE_LIMIT = 2_000_000;
const OUTPUT_TOKENS = 16_000;
const keys = new Map<ApiWorkerId, string>();
const verified = new Set<ApiWorkerId>();

/** Called only from the native-only `providers.session` method. Returns no secret. */
export function setProviderKey(provider: unknown, apiKey: unknown): { provider: ApiWorkerId; hasKey: boolean } {
  if (!isApiWorker(provider)) throw new Error('Unknown API provider');
  verified.delete(provider);
  if (apiKey === null) { keys.delete(provider); return { provider, hasKey: false }; }
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{20,300}$/.test(apiKey)) throw new Error('The API key was not accepted');
  keys.set(provider, apiKey);
  return { provider, hasKey: true };
}
export const hasProviderKey = (provider: ApiWorkerId): boolean => keys.has(provider);

/** Removes every held key and the common key shapes from text bound for the user or the database. */
export function redactSecrets(text: string): string {
  let clean = text;
  for (const key of keys.values()) clean = clean.split(key).join('[redacted credential]');
  return clean.replace(/\b(?:sk-|sk_ant_|AIza)[A-Za-z0-9_-]{16,}/g, '[redacted credential]');
}

// Exactly the three provider hosts, over HTTPS, with no redirect and no ambient credentials.
export const providerFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!Object.values(API_ORIGINS).includes(url.origin) || url.protocol !== 'https:' || url.username || url.password) throw new Error('API requests are limited to the three approved provider addresses');
  init?.signal?.throwIfAborted();
  const response = await fetch(url, { ...init, credentials: 'omit', redirect: 'error' });
  if (response.redirected || (response.url && new URL(response.url).origin !== url.origin)) throw new Error('The provider redirected the request; it was refused');
  return response;
};

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RESPONSE_LIMIT) { void reader.cancel().catch(() => undefined); throw new Error('The provider response exceeded the size limit'); }
    chunks.push(value);
  }
  try { const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>; } catch { /* reported below */ }
  throw new Error('The provider returned an unreadable response');
}

// Provider error bodies are not shown: they can quote the request, including its credential.
function failure(provider: ApiWorkerId, status: number): Error {
  const name = API_NAMES[provider];
  if (status === 401 || status === 403) return new Error(`${name} refused this API key. Check the key under Connections.`);
  if (status === 404) return new Error(`${name} does not offer the chosen model to this key. Choose a model under Connections.`);
  if (status === 429) return new Error(`${name} reported a rate limit or exhausted quota. No retry or other engine was started.`);
  if (status === 400 || status === 422) return new Error(`${name} did not accept the request (${status}). Choose another model under Connections.`);
  return new Error(`${name} is unavailable (${status}). No retry or other engine was started.`);
}

function authHeaders(provider: ApiWorkerId): Record<string, string> {
  const key = keys.get(provider);
  if (!key) throw new Error(`Save a ${API_NAMES[provider]} key under Connections first`);
  if (provider === 'claude-api') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (provider === 'openai-api') return { authorization: `Bearer ${key}` };
  return { 'x-goog-api-key': key };
}

async function call(provider: ApiWorkerId, path: string, signal: AbortSignal, body?: unknown): Promise<Record<string, unknown>> {
  try {
    const response = await providerFetch(API_ORIGINS[provider] + path, { method: body === undefined ? 'GET' : 'POST', signal,
      headers: { ...authHeaders(provider), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw failure(provider, response.status); }
    return await boundedJson(response);
  } catch (err) {
    if (err instanceof TypeError) throw new Error(`${API_NAMES[provider]} could not be reached. No retry or other engine was started.`);
    throw new Error(redactSecrets(err instanceof Error ? err.message : `${API_NAMES[provider]} request failed`).slice(0, 600));
  }
}

const modelIds = (items: unknown, pick: (item: Record<string, unknown>) => unknown): string[] =>
  [...new Set((Array.isArray(items) ? items : []).flatMap((item) => { const id = item && typeof item === 'object' ? pick(item as Record<string, unknown>) : undefined; return typeof id === 'string' && MODEL_ID.test(id) ? [id] : []; }))].sort().slice(0, 400);

/** Lists what the stored key can use. Sends no prompt or document; a success marks the key verified. */
export async function listProviderModels(provider: unknown, signal?: AbortSignal): Promise<{ provider: ApiWorkerId; models: string[] }> {
  if (!isApiWorker(provider)) throw new Error('Unknown API provider');
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
  let models: string[];
  if (provider === 'claude-api') models = modelIds((await call(provider, '/v1/models?limit=1000', bounded)).data, (m) => m.id);
  else if (provider === 'openai-api') models = modelIds((await call(provider, '/v1/models', bounded)).data, (m) => m.id);
  else models = modelIds((await call(provider, '/v1beta/models?pageSize=1000', bounded)).models, (m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent') && typeof m.name === 'string' ? m.name.replace(/^models\//, '') : undefined);
  if (!models.length) throw new Error(`${API_NAMES[provider]} listed no usable models for this key`);
  verified.add(provider);
  return { provider, models };
}

/** Proof that one request passed every paid-API gate. Only `authorizePaidApi` can mint one. */
export interface ApiGrant { readonly provider: ApiWorkerId; readonly model: string }
const grants = new WeakSet<ApiGrant>();

/** The single gate: the setting, both per-request consents, a chosen model and a held key. */
export function authorizePaidApi(worker: ApiWorkerId, settings: PantheonSettings, params: Record<string, unknown>): ApiGrant {
  if (settings.paidApiEnabled !== true) throw new Error('Paid API engines are turned off. Turn them on in Settings first.');
  if (params.allowCloud !== true || params.allowPaidApi !== true) throw new Error(`Confirm sending this to ${API_COMPANY[worker]} and paying per use from your API account`);
  const model = apiModel(settings, worker);
  if (!model || !MODEL_ID.test(model)) throw new Error(`Choose a ${API_NAMES[worker]} model under Connections first`);
  if (!keys.has(worker)) throw new Error(`Save a ${API_NAMES[worker]} key under Connections first`);
  const grant: ApiGrant = Object.freeze({ provider: worker, model });
  grants.add(grant);
  return grant;
}

const textOf = (parts: unknown): string => (Array.isArray(parts) ? parts : []).map((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' && (part as { type?: unknown }).type !== 'thinking' ? (part as { text: string }).text : '').join('');
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

async function complete(grant: ApiGrant, system: string, prompt: string, signal: AbortSignal): Promise<Omit<WorkerResult, 'durationMs'>> {
  const { provider, model } = grant;
  if (provider === 'claude-api') {
    const reply = await call(provider, '/v1/messages', signal, { model, max_tokens: OUTPUT_TOKENS, system, messages: [{ role: 'user', content: prompt }] });
    if (reply.stop_reason === 'refusal') throw new Error('Claude declined this request. No other engine was started.');
    const usage = reply.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
    return { text: textOf(reply.content), model, inputTokens: count(usage?.input_tokens), outputTokens: count(usage?.output_tokens) };
  }
  if (provider === 'openai-api') {
    const reply = await call(provider, '/v1/chat/completions', signal, { model, max_completion_tokens: OUTPUT_TOKENS, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] });
    const message = (Array.isArray(reply.choices) ? reply.choices[0] as { message?: { content?: unknown } } | undefined : undefined)?.message;
    const usage = reply.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
    return { text: typeof message?.content === 'string' ? message.content : '', model, inputTokens: count(usage?.prompt_tokens), outputTokens: count(usage?.completion_tokens) };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model)) throw new Error('Choose a Gemini model from the list under Connections');
  const reply = await call(provider, `/v1beta/models/${model}:generateContent`, signal, { system_instruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: OUTPUT_TOKENS } });
  const candidate = Array.isArray(reply.candidates) ? reply.candidates[0] as { content?: { parts?: unknown } } | undefined : undefined;
  const usage = reply.usageMetadata as { promptTokenCount?: unknown; candidatesTokenCount?: unknown } | undefined;
  return { text: textOf(candidate?.content?.parts), model, inputTokens: count(usage?.promptTokenCount), outputTokens: count(usage?.candidatesTokenCount) };
}

/** One request, one answer. A failure is final: no retry, no other engine. */
export function startApiWorker(worker: ApiWorkerId, prompt: string, systemPrompt: string, grant: ApiGrant | undefined, signal?: AbortSignal, timeoutMs = 240_000): WorkerRun {
  if (!grant || !grants.has(grant) || grant.provider !== worker) throw new Error('This API engine was not authorized for this request');
  grants.delete(grant);
  signal?.throwIfAborted();
  const startedAt = Date.now(); const controller = new AbortController(); let reason = '';
  const end = (why: string) => { reason ||= why; controller.abort(); };
  const abort = () => end('stopped');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => end('timeout'), timeoutMs);
  const promise = complete(grant, systemPrompt, prompt, controller.signal).then((result) => {
    const text = redactSecrets(result.text);
    if (!text.trim()) throw new Error(`${API_NAMES[worker]} did not return a text answer`);
    return { ...result, text: text.slice(0, 64_000), durationMs: Date.now() - startedAt };
  }, (err: unknown) => {
    if (reason === 'stopped') throw new Error('Job stopped');
    if (reason === 'timeout') throw new Error('The API request exceeded its time limit. No retry or other engine was started.');
    throw err;
  }).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
  return { promise, stop: abort };
}

/** Connection cards for the three API engines. State only; never a key. */
export function apiConnections(settings: PantheonSettings): Connection[] {
  return API_WORKERS.map((id): Connection => {
    const hasKey = keys.has(id); const isVerified = hasKey && verified.has(id); const model = apiModel(settings, id);
    return { id, name: API_NAMES[id], kind: 'model', state: !hasKey ? 'missing' : isVerified ? 'ready' : 'unverified',
      detail: `${!hasKey ? 'No API key saved on this PC.' : isVerified ? 'Key saved and verified by listing models.' : 'Key saved. Not verified yet: list models to check it.'} ${!settings.paidApiEnabled ? 'Paid API engines are turned off in Settings.' : model ? `Model: ${model}.` : 'No model chosen yet.'}`,
      billing: `Billed per use to your ${API_COMPANY[id]} API account · never automatic`, api: { hasKey, verified: isVerified, model, enabled: settings.paidApiEnabled } };
  });
}
