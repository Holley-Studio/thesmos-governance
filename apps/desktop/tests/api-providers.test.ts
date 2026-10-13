import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { API_ORIGINS, apiConnections, authorizePaidApi, hasProviderKey, listProviderModels, providerFetch, redactSecrets, setProviderKey, startApiWorker } from '../sidecar/studio/api-providers.js';
import { DEFAULT_SETTINGS, SettingsStore, type PantheonSettings } from '../sidecar/studio/settings.js';
import { startWorker, subscriptionEnv, resolveGeminiCli } from '../sidecar/studio/workers.js';
import { StudioService } from '../sidecar/studio/service.js';
import { StudioStore } from '../sidecar/studio/store.js';
import { CouncilChatService } from '../sidecar/studio/chat.js';
import { API_WORKERS, workerReady, type ApiWorkerId } from '../shared/studio.js';

// Fixture strings only. No real key exists in this file and no request leaves the process.
const KEY: Record<ApiWorkerId, string> = { 'claude-api': 'fixture-anthropic-key-0123456789', 'openai-api': 'sk-fixture-openai-key-0123456789', 'gemini-api': 'AIzaFixtureGeminiKey0123456789abc' };
const ON: PantheonSettings = { ...DEFAULT_SETTINGS, paidApiEnabled: true, openaiApiModel: 'gpt-fixture', geminiApiModel: 'gemini-fixture' };
const CONSENT = { allowCloud: true, allowPaidApi: true };
interface Seen { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown>; redirect?: string; credentials?: string; signal?: AbortSignal | null }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** Replaces global fetch for one test. Anything not answered by `reply` fails the test. */
async function withFetch<T>(reply: (seen: Seen) => Response | Promise<Response>, run: (calls: Seen[]) => Promise<T>): Promise<T> {
 const original = globalThis.fetch; const calls: Seen[] = [];
 globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const seen: Seen = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers).entries()), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, redirect: init?.redirect, credentials: init?.credentials, signal: init?.signal };
  calls.push(seen); return reply(seen);
 }) as typeof fetch;
 try { return await run(calls); } finally { globalThis.fetch = original; for (const id of API_WORKERS) setProviderKey(id, null); }
}
const setKeys = () => { for (const id of API_WORKERS) setProviderKey(id, KEY[id]); };
const answers = (seen: Seen): Response => seen.url.includes('anthropic') ? json({ content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'Claude answer' }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 7 } })
 : seen.url.includes('openai') ? json({ choices: [{ message: { role: 'assistant', content: 'OpenAI answer' } }], usage: { prompt_tokens: 12, completion_tokens: 8 } })
 : json({ candidates: [{ content: { parts: [{ text: 'Gemini ' }, { text: 'answer' }] } }], usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 9 } });

test('API requests go only to the three provider addresses, without redirects or ambient credentials', async () => {
 await withFetch(() => json({}), async (calls) => {
  for (const bad of ['http://api.openai.com/v1/models', 'https://api.openai.com.evil.example/v1/models', 'https://evil.example/?next=https://api.openai.com', 'https://user:pw@api.anthropic.com/v1/models',
   'https://api.anthropic.com:8443/v1/models', 'https://generativelanguage.googleapis.com.evil.example/', 'http://127.0.0.1:11434/api/tags', 'https://openai.com/v1/models', 'file:///C:/Windows/win.ini']) {
   await assert.rejects(providerFetch(bad), /three approved provider addresses/, bad);
  }
  assert.equal(calls.length, 0);
  for (const origin of Object.values(API_ORIGINS)) await providerFetch(origin + '/v1/models', { redirect: 'follow', credentials: 'include' });
  assert.deepEqual(calls.map((c) => [new URL(c.url).origin, c.redirect, c.credentials]), Object.values(API_ORIGINS).map((origin) => [origin, 'error', 'omit']));
  assert.deepEqual(Object.values(API_ORIGINS), ['https://api.anthropic.com', 'https://api.openai.com', 'https://generativelanguage.googleapis.com']);
 });
 const original = globalThis.fetch;
 try {
  globalThis.fetch = (async () => Object.defineProperty(json({}), 'redirected', { value: true })) as typeof fetch;
  await assert.rejects(providerFetch('https://api.openai.com/v1/models'), /redirected/);
  globalThis.fetch = (async () => Object.defineProperty(json({}), 'url', { value: 'https://evil.example/v1/models' })) as typeof fetch;
  await assert.rejects(providerFetch('https://api.openai.com/v1/models'), /redirected/);
 } finally { globalThis.fetch = original; }
});

test('a key is held in memory only: never returned, listed, or written to disk', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'pantheon-api-keys-'));
 try {
  await withFetch(() => json({ data: [{ id: 'gpt-fixture' }] }), async () => {
   for (const bad of [undefined, 42, '', 'short', 'has a space in it 0123456789', 'line\nbreak-0123456789-0123456789', 'ünïcödé-0123456789-0123456789', 'x'.repeat(301)]) assert.throws(() => setProviderKey('openai-api', bad), /not accepted/, String(bad));
   for (const bad of ['claude', 'codex', 'ollama', 'grok-api', '__proto__', undefined]) assert.throws(() => setProviderKey(bad, KEY['openai-api']), /Unknown API provider/, String(bad));
   assert.equal(hasProviderKey('openai-api'), false);
   const store = new SettingsStore(dir); store.update({ paidApiEnabled: true, openaiApiModel: 'gpt-fixture' });
   const reply = setProviderKey('openai-api', KEY['openai-api']);
   assert.deepEqual(reply, { provider: 'openai-api', hasKey: true });
   await listProviderModels('openai-api');
   assert.ok(!JSON.stringify([reply, apiConnections(store.read())]).includes('fixture-openai'));
   for (const name of readdirSync(dir, { recursive: true }) as string[]) { const path = join(dir, name); if (statSync(path).isFile()) assert.ok(!readFileSync(path, 'utf8').includes('fixture-openai'), name); }
   assert.throws(() => store.update({ apiKey: KEY['openai-api'] }), /not a setting/);
   assert.throws(() => store.update({ openaiApiKey: KEY['openai-api'] }), /not a setting/);
   assert.deepEqual(setProviderKey('openai-api', null), { provider: 'openai-api', hasKey: false });
  });
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('connection cards report no key, key saved, then verified by a successful model list', async () => {
 await withFetch((seen) => seen.url.includes('anthropic') ? json({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }, { id: 'bad id with spaces' }, { id: 7 }] })
  : seen.url.includes('openai') ? json({ error: { message: 'Incorrect API key provided: ' + KEY['openai-api'] } }, 401)
  : json({ models: [{ name: 'models/gemini-fixture', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-fixture', supportedGenerationMethods: ['embedContent'] }] }), async (calls) => {
  const card = (id: ApiWorkerId, settings = ON) => apiConnections(settings).find((c) => c.id === id)!;
  assert.deepEqual(apiConnections(DEFAULT_SETTINGS).map((c) => [c.id, c.state, c.api]), API_WORKERS.map((id) => [id, 'missing', { hasKey: false, verified: false, model: id === 'claude-api' ? 'claude-sonnet-5-5' : '', enabled: false }]));
  await assert.rejects(listProviderModels('claude-api'), /Save a Claude API key/); assert.equal(calls.length, 0);
  setKeys();
  assert.equal(card('claude-api').state, 'unverified'); assert.match(card('claude-api').detail, /Not verified yet/);
  assert.deepEqual(await listProviderModels('claude-api'), { provider: 'claude-api', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] });
  assert.equal(card('claude-api').state, 'ready'); assert.deepEqual(card('claude-api').api, { hasKey: true, verified: true, model: 'claude-sonnet-5-5', enabled: true });
  assert.deepEqual((await listProviderModels('gemini-api')).models, ['gemini-fixture']);
  // A refused key stays "saved, not verified", and the provider's echo of the key is never shown.
  await assert.rejects(listProviderModels('openai-api'), (err: Error) => /refused this API key/.test(err.message) && !err.message.includes('fixture') && !err.message.includes('Incorrect'));
  assert.equal(card('openai-api').state, 'unverified');
  // Replacing or removing a key drops its verification.
  setProviderKey('claude-api', KEY['claude-api'] + '-new'); assert.equal(card('claude-api').state, 'unverified');
  setProviderKey('gemini-api', null); assert.equal(card('gemini-api').state, 'missing');
  await assert.rejects(listProviderModels('grok-api'), /Unknown API provider/);
  // The key travels in a header, never in the address, and listing sends no prompt.
  assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [['GET', 'https://api.anthropic.com/v1/models?limit=1000', undefined], ['GET', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', undefined], ['GET', 'https://api.openai.com/v1/models', undefined]]);
  assert.equal(calls[0].headers['x-api-key'], KEY['claude-api']); assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[1].headers['x-goog-api-key'], KEY['gemini-api']); assert.equal(calls[2].headers.authorization, 'Bearer ' + KEY['openai-api']);
  // Usable means the setting, a key and a model: verification is informative, not a gate.
  setKeys();
  assert.equal(workerReady(apiConnections(ON), 'openai-api'), true);
  assert.equal(workerReady(apiConnections({ ...ON, paidApiEnabled: false }), 'openai-api'), false);
  assert.equal(workerReady(apiConnections({ ...ON, openaiApiModel: '' }), 'openai-api'), false);
  setProviderKey('openai-api', null); assert.equal(workerReady(apiConnections(ON), 'openai-api'), false);
 });
});

test('paid API use needs the setting and both consents on every request; a grant works once', async () => {
 await withFetch(answers, async (calls) => {
  setKeys();
  assert.equal(DEFAULT_SETTINGS.paidApiEnabled, false);
  assert.throws(() => authorizePaidApi('openai-api', { ...ON, paidApiEnabled: false }, CONSENT), /turned off/);
  for (const params of [{}, { allowCloud: true }, { allowPaidApi: true }, { allowCloud: 'true', allowPaidApi: true }, { allowCloud: true, allowPaidApi: 1 }]) assert.throws(() => authorizePaidApi('openai-api', ON, params), /Confirm sending this to OpenAI and paying per use/, JSON.stringify(params));
  assert.throws(() => authorizePaidApi('openai-api', { ...ON, openaiApiModel: '' }, CONSENT), /Choose a OpenAI API model/);
  assert.throws(() => authorizePaidApi('gemini-api', { ...ON, geminiApiModel: '' }, CONSENT), /Choose a Gemini API model/);
  setProviderKey('gemini-api', null); assert.throws(() => authorizePaidApi('gemini-api', ON, CONSENT), /Save a Gemini API key/);
  // No grant, a forged grant, another provider's grant, or a used grant: refused before any request.
  assert.throws(() => startApiWorker('openai-api', 'p', 's', undefined), /not authorized/);
  assert.throws(() => startApiWorker('openai-api', 'p', 's', { provider: 'openai-api', model: 'gpt-fixture' }), /not authorized/);
  assert.throws(() => startApiWorker('openai-api', 'p', 's', authorizePaidApi('claude-api', ON, CONSENT)), /not authorized/);
  await assert.rejects(startWorker('openai-api', tmpdir(), 'p'), /not authorized/);
  assert.equal(calls.length, 0);
  const grant = authorizePaidApi('openai-api', ON, CONSENT); assert.ok(Object.isFrozen(grant));
  assert.equal((await startApiWorker('openai-api', 'p', 's', grant).promise).text, 'OpenAI answer');
  assert.throws(() => startApiWorker('openai-api', 'p', 's', grant), /not authorized/);
  assert.equal(calls.length, 1);
 });
});

test('each provider gets one plain text request with no tools, and the answer is parsed and bounded', async () => {
 await withFetch(answers, async (calls) => {
  setKeys();
  const run = async (id: ApiWorkerId, settings = ON) => (await startWorker(id, tmpdir(), 'USER PROMPT', undefined, { systemPrompt: 'SYSTEM PROMPT', api: authorizePaidApi(id, settings, CONSENT) })).promise;
  const claude = await run('claude-api', { ...DEFAULT_SETTINGS, paidApiEnabled: true });
  assert.equal(claude.text, 'Claude answer'); assert.equal(claude.model, 'claude-sonnet-5-5'); assert.equal(claude.inputTokens, 11); assert.equal(claude.outputTokens, 7);
  const openai = await run('openai-api'); assert.deepEqual([openai.text, openai.model, openai.inputTokens, openai.outputTokens], ['OpenAI answer', 'gpt-fixture', 12, 8]);
  const gemini = await run('gemini-api'); assert.deepEqual([gemini.text, gemini.model, gemini.inputTokens, gemini.outputTokens], ['Gemini answer', 'gemini-fixture', 13, 9]);
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [['POST', 'https://api.anthropic.com/v1/messages'], ['POST', 'https://api.openai.com/v1/chat/completions'], ['POST', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent']]);
  assert.deepEqual(calls[0].body, { model: 'claude-sonnet-5-5', max_tokens: 16000, system: 'SYSTEM PROMPT', messages: [{ role: 'user', content: 'USER PROMPT' }] });
  assert.deepEqual(calls[1].body, { model: 'gpt-fixture', max_completion_tokens: 16000, messages: [{ role: 'system', content: 'SYSTEM PROMPT' }, { role: 'user', content: 'USER PROMPT' }] });
  assert.deepEqual(calls[2].body, { system_instruction: { parts: [{ text: 'SYSTEM PROMPT' }] }, contents: [{ role: 'user', parts: [{ text: 'USER PROMPT' }] }], generationConfig: { maxOutputTokens: 16000 } });
  assert.deepEqual([calls[0].headers['x-api-key'], calls[0].headers['anthropic-version'], calls[1].headers.authorization, calls[2].headers['x-goog-api-key']], [KEY['claude-api'], '2023-06-01', 'Bearer ' + KEY['openai-api'], KEY['gemini-api']]);
  for (const call of calls) { assert.ok(!/tool|function|mcp|web_search/i.test(JSON.stringify(call.body))); assert.equal(call.redirect, 'error'); assert.equal(call.credentials, 'omit'); assert.ok(!call.url.includes('key=')); assert.ok(call.signal); }
  // The same context limit as every other worker, checked before anything is sent.
  await assert.rejects(startWorker('openai-api', tmpdir(), 'x'.repeat(36_001), undefined, { api: authorizePaidApi('openai-api', ON, CONSENT) }), /context limit/);
  // A model name that could reshape the Gemini address is refused before any request.
  await assert.rejects(run('gemini-api', { ...ON, geminiApiModel: '../../v1/files' }), /Choose a Gemini model/);
  assert.equal(calls.length, 3);
 });
});

test('provider failures are final and never echo a key, a provider body, or start another engine', async () => {
 const leak = (seen: Seen) => `echo ${seen.headers['x-api-key'] ?? seen.headers.authorization ?? seen.headers['x-goog-api-key']}`;
 const attempt = async (id: ApiWorkerId, reply: (seen: Seen) => Response | Promise<Response>) => withFetch(reply, async (calls) => {
  setKeys(); const error = await startApiWorker(id, 'p', 's', authorizePaidApi(id, ON, CONSENT)).promise.then(() => undefined, (err: Error) => err);
  return { error, calls: calls.length };
 });
 for (const id of API_WORKERS) {
  for (const [status, pattern] of [[401, /refused this API key/], [403, /refused this API key/], [404, /does not offer the chosen model/], [429, /rate limit or exhausted quota/], [400, /did not accept the request/], [500, /unavailable \(500\)/], [529, /unavailable \(529\)/]] as const) {
   const { error, calls } = await attempt(id, (seen) => json({ error: { message: leak(seen) } }, status));
   assert.match(error!.message, pattern, `${id} ${status}`); assert.ok(!error!.message.includes('fixture') && !error!.message.includes('Fixture') && !error!.message.includes('echo'), error!.message);
   assert.equal(calls, 1, 'exactly one request: no retry and no second provider');
  }
  assert.match((await attempt(id, () => { throw new TypeError('fetch failed: ' + KEY[id]); })).error!.message, /could not be reached/);
  assert.match((await attempt(id, () => new Response('<html>not json</html>'))).error!.message, /unreadable response/);
  assert.match((await attempt(id, () => json({}))).error!.message, /did not return a text answer/);
  assert.match((await attempt(id, () => new Response('x'.repeat(2_000_001)))).error!.message, /size limit/);
 }
 assert.match((await attempt('claude-api', () => json({ content: [], stop_reason: 'refusal' }))).error!.message, /Claude declined/);
 // A model that repeats a credential has it removed, and a long answer is cut like any other worker's.
 await withFetch(() => json({ choices: [{ message: { content: `Your key is ${KEY['openai-api']} and ${KEY['claude-api']}. ` + 'y'.repeat(70_000) } }] }), async () => {
  setKeys(); const result = await startApiWorker('openai-api', 'p', 's', authorizePaidApi('openai-api', ON, CONSENT)).promise;
  assert.ok(!result.text.includes('fixture')); assert.match(result.text, /^Your key is \[redacted credential\] and \[redacted credential\]\./); assert.equal(result.text.length, 64_000);
  assert.equal(redactSecrets(`a ${KEY['gemini-api']} b sk-live0123456789abcdefgh c`), 'a [redacted credential] b [redacted credential] c');
 });
});

test('an API request can be stopped, honours an outer cancellation, and has a time limit', async () => {
 const hang = (seen: Seen) => new Promise<Response>((_, reject) => seen.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
 await withFetch(hang, async (calls) => {
  setKeys(); const grant = () => authorizePaidApi('claude-api', ON, CONSENT);
  const stopped = startApiWorker('claude-api', 'p', 's', grant()); await new Promise((r) => setImmediate(r)); stopped.stop();
  await assert.rejects(stopped.promise, /Job stopped/); assert.equal(calls[0].signal!.aborted, true);
  const controller = new AbortController(); const outer = await startWorker('claude-api', tmpdir(), 'p', undefined, { api: grant(), signal: controller.signal });
  await new Promise((r) => setImmediate(r)); controller.abort(); await assert.rejects(outer.promise, /Job stopped/);
  await assert.rejects(startApiWorker('claude-api', 'p', 's', grant(), undefined, 30).promise, /time limit\. No retry/);
  const already = new AbortController(); already.abort();
  await assert.rejects(startWorker('claude-api', tmpdir(), 'p', undefined, { api: grant(), signal: already.signal }));
  assert.equal(calls.length, 3);
 });
});

function project() {
 const dir = mkdtempSync(join(tmpdir(), 'pantheon-api-job-')); const root = join(dir, 'site'); mkdirSync(root);
 writeFileSync(join(root, 'README.md'), '# Site\nA small public brochure site for a fixture client.');
 return { dir, root, data: join(dir, 'data') };
}
const settle = async (until: () => boolean) => { for (let i = 0; i < 200 && !until(); i++) await new Promise((r) => setTimeout(r, 10)); };

test('a workboard job runs on an API engine only with the setting and consent, and a refusal uses no attempt', async () => {
 const f = project(); const service = new StudioService(f.data, () => f.root); const settings = new SettingsStore(f.data);
 try {
  await withFetch(answers, async (calls) => {
   service.register(f.root); const p = service.store.projects()[0];
   const job = service.create({ projectId: p.id, playbookId: 'seo-plan', brief: 'Plan it', requestId: randomUUID() });
   const refused = (params: Record<string, unknown>, pattern: RegExp) => { assert.throws(() => service.run({ jobId: job.id, ...params }), pattern); assert.equal(service.store.job(job.id).state, 'planned'); assert.equal(service.store.job(job.id).attempts, 0); };
   setKeys();
   refused({ worker: 'openai-api', ...CONSENT }, /turned off/);
   settings.update({ paidApiEnabled: true });
   refused({ worker: 'openai-api', ...CONSENT }, /Choose a OpenAI API model/);
   settings.update({ openaiApiModel: 'gpt-fixture' });
   refused({ worker: 'openai-api' }, /Confirm sending this to OpenAI/);
   refused({ worker: 'openai-api', allowCloud: true }, /paying per use/);
   refused({ worker: 'openai-api', allowPaidApi: true }, /Confirm sending this to OpenAI/);
   refused({ worker: 'azure-api', ...CONSENT }, /supported worker/);
   setProviderKey('openai-api', null); refused({ worker: 'openai-api', ...CONSENT }, /Save a OpenAI API key/); setProviderKey('openai-api', KEY['openai-api']);
   assert.equal(calls.length, 0);
   assert.equal(service.run({ jobId: job.id, worker: 'openai-api', ...CONSENT }).job.worker, 'openai-api');
   await settle(() => service.store.job(job.id).state !== 'running');
   const done = service.store.job(job.id); assert.equal(done.state, 'review'); assert.equal(done.model, 'gpt-fixture'); assert.equal(done.inputTokens, 12);
   const artifact = service.store.artifact(done.artifactId!); assert.equal(artifact.worker, 'openai-api'); assert.equal(artifact.content, 'OpenAI answer');
   assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
   assert.match(String((calls[0].body!.messages as { content: string }[])[0].content), /no tools/); assert.match(String((calls[0].body!.messages as { content: string }[])[1].content), /UNTRUSTED SOURCE DATA BEGIN/);
   // Human review still stands between this draft and acceptance.
   assert.ok(artifact.checks.some((c) => c.name === 'Review required'));
  });
  // A failed paid attempt is recorded once, without the key, and nothing else is tried.
  await withFetch((seen) => json({ error: { message: 'bad key ' + seen.headers.authorization } }, 401), async (calls) => {
   setKeys(); const p = service.store.projects()[0];
   const job = service.create({ projectId: p.id, playbookId: 'seo-plan', brief: 'Again', requestId: randomUUID() });
   service.run({ jobId: job.id, worker: 'openai-api', ...CONSENT });
   await settle(() => service.store.job(job.id).state !== 'running');
   const failed = service.store.job(job.id); assert.equal(failed.state, 'failed'); assert.match(failed.error!, /refused this API key/); assert.equal(calls.length, 1);
   assert.ok(!JSON.stringify([failed, service.store.events()]).includes('fixture-openai'));
  });
 } finally { service.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('chat accepts Claude and API engines only with consent, keeps private knowledge local, and never falls back', async () => {
 const f = project(); const store = new StudioStore(f.data); const p = store.register(f.root); const settings = new SettingsStore(f.data);
 const started: { engine: string; api: unknown }[] = []; let fail: (error: Error) => void = () => undefined;
 const chat = new CouncilChatService(store, () => f.root, () => [{ god: 'Zeus', role: 'Priorities' }], () => false,
  async (engine, _cwd, _prompt, _system, _signal, api) => { started.push({ engine, api }); return { stop: () => undefined, promise: new Promise((_, reject) => { fail = reject; }) }; },
  { search: async () => { throw new Error('knowledge must not be searched for a cloud engine'); } });
 const create = (engine: string, extra: Record<string, unknown> = {}) => chat.create({ projectId: p.id, god: 'Zeus', engine, ...extra });
 const send = (t: { id: string; revision: number }, extra: Record<string, unknown> = {}) => chat.send({ threadId: t.id, revision: t.revision, text: 'Think with me', requestId: randomUUID(), ...extra });
 try {
  await withFetch(() => { throw new Error('no provider request is expected in this test'); }, async (calls) => {
   setKeys();
   // Claude subscription: the same explicit consent as the ChatGPT worker, on creation and on every send.
   assert.throws(() => create('claude'), /Confirm Anthropic conversation sharing/);
   const claude = create('claude', { allowCloud: true }); assert.equal(claude.engine, 'claude');
   assert.throws(() => send(claude), /Confirm Anthropic/); assert.throws(() => send(claude, { allowCloud: true, useKnowledge: true }), /requires local Ollama/);
   send(claude, { allowCloud: true }); await new Promise((r) => setImmediate(r));
   assert.deepEqual(started, [{ engine: 'claude', api: undefined }]);
   // The subscription worker fails: the turn fails. No API engine is started in its place.
   fail(new Error('Claude subscription login is not ready')); await new Promise((r) => setImmediate(r));
   const after = chat.get({ threadId: claude.id }); assert.equal(after.messages[1].state, 'failed'); assert.equal(started.length, 1); assert.equal(calls.length, 0);
   // API engines: off by default, then gated by both consents on creation and on every send.
   for (const id of API_WORKERS) assert.throws(() => create(id, CONSENT), /turned off/);
   settings.update({ paidApiEnabled: true, openaiApiModel: 'gpt-fixture' });
   assert.throws(() => create('openai-api', { allowCloud: true }), /paying per use/); assert.throws(() => create('gemini-api', CONSENT), /Choose a Gemini API model/);
   const paid = create('openai-api', CONSENT);
   assert.throws(() => send(paid), /Confirm sending this to OpenAI/); assert.throws(() => send(paid, { allowCloud: true }), /paying per use/);
   assert.throws(() => send(paid, { ...CONSENT, useKnowledge: true }), /requires local Ollama/);
   settings.update({ paidApiEnabled: false }); assert.throws(() => send(paid, CONSENT), /turned off/); settings.update({ paidApiEnabled: true });
   assert.equal(started.length, 1);
   send(paid, CONSENT); await new Promise((r) => setImmediate(r));
   assert.equal(started.length, 2); assert.equal(started[1].engine, 'openai-api'); assert.deepEqual(started[1].api, { provider: 'openai-api', model: 'gpt-fixture' });
   fail(new Error(`provider said ${KEY['openai-api']}`)); await new Promise((r) => setImmediate(r));
   const failed = chat.get({ threadId: paid.id }).messages[1]; assert.equal(failed.state, 'failed'); assert.ok(!failed.error!.includes('fixture')); assert.equal(started.length, 2); assert.equal(calls.length, 0);
  });
 } finally { chat.shutdown(); store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('settings keep paid API use off by default and accept only plain model names', () => {
 const dir = mkdtempSync(join(tmpdir(), 'pantheon-api-settings-'));
 try {
  const store = new SettingsStore(dir);
  assert.deepEqual([store.read().paidApiEnabled, store.read().claudeApiModel, store.read().openaiApiModel, store.read().geminiApiModel], [false, 'claude-sonnet-5-5', '', '']);
  for (const patch of [{ paidApiEnabled: 'true' }, { paidApiEnabled: 1 }, { openaiApiModel: 'gpt 5' }, { openaiApiModel: 'x'.repeat(81) }, { geminiApiModel: 'model?key=1' }, { geminiApiModel: 'a\nb' }, { claudeApiModel: '<script>' }, { openaiApiModel: 42 }, { preferredWorker: 'azure-api' }]) assert.throws(() => store.update(patch), Error, JSON.stringify(patch));
  assert.equal(store.read().paidApiEnabled, false);
  const saved = store.update({ paidApiEnabled: true, openaiApiModel: 'gpt-5.5', geminiApiModel: 'gemini-3-pro', claudeApiModel: '', preferredWorker: 'claude-api' });
  assert.deepEqual([saved.paidApiEnabled, saved.openaiApiModel, saved.geminiApiModel, saved.claudeApiModel, saved.preferredWorker], [true, 'gpt-5.5', 'gemini-3-pro', 'claude-sonnet-5-5', 'claude-api']);
  assert.deepEqual(new SettingsStore(dir).read(), saved);
  // A hand-edited file cannot switch paid use on with a non-boolean, or smuggle in a model name.
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ paidApiEnabled: 'yes', openaiApiModel: 'bad model', geminiApiModel: 7 }));
  assert.deepEqual([store.read().paidApiEnabled, store.read().openaiApiModel, store.read().geminiApiModel], [false, '', '']);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the Gemini subscription CLI is only detected, never run', () => {
 const dir = mkdtempSync(join(tmpdir(), 'pantheon-gemini-cli-')); const previous = process.env.PATH;
 try {
  process.env.PATH = dir; assert.equal(resolveGeminiCli(), undefined);
  const shim = join(dir, process.platform === 'win32' ? 'gemini.cmd' : 'gemini'); writeFileSync(shim, 'exit 1');
  assert.equal(resolveGeminiCli(), shim);
 } finally { process.env.PATH = previous; rmSync(dir, { recursive: true, force: true }); }
});

test('subscription workers still never inherit an API key from the environment', () => {
 const names = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN'];
 const previous = names.map((name) => process.env[name]);
 try {
  setKeys(); for (const name of names) process.env[name] = 'fixture-environment-value';
  const env = subscriptionEnv(); for (const name of names) assert.equal(env[name], undefined, name);
  // A key saved for an API engine lives only in the API module: it is not placed in any child environment.
  assert.ok(!JSON.stringify(env).includes('fixture-anthropic') && !JSON.stringify(env).includes('fixture-openai') && !JSON.stringify(env).includes('FixtureGemini'));
 } finally { names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); for (const id of API_WORKERS) setProviderKey(id, null); }
});
