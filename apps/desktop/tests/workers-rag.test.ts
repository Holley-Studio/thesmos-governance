import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftingFetch, startWorker } from '../sidecar/studio/workers.js';
const endpoint = 'http://127.0.0.1:11434';
const local = { details: { format: 'gguf' }, capabilities: ['completion'], model_info: { 'general.architecture': 'qwen' } };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const requestDetails = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => input instanceof Request
 ? { url: input.url, body: await input.clone().text(), redirect: input.redirect, credentials: input.credentials, headers: input.headers }
 : { url: String(input), body: String(init?.body ?? ''), redirect: init?.redirect, credentials: init?.credentials, headers: new Headers(init?.headers) };

test('arbitrary or noncanonical models are refused before model verification or generation', async () => {
 const original = globalThis.fetch;
 try {
  for (const model of ['uninstalled-model', ' qwen3.5:4b ', 'qwen3.5:4b\n']) {
   const urls: string[] = [];
   globalThis.fetch = async (input) => { const url = input instanceof Request ? input.url : String(input); urls.push(url); return json(url.endsWith('/api/tags') ? {models:[{name:'qwen3.5:4b'}]} : local); };
   await assert.rejects(draftingFetch(`${endpoint}/api/chat`, {method:'POST',body:JSON.stringify({model,messages:[{role:'user',content:'PRIVATE'}]})}), /installed|canonical|allowed/i);
   assert.ok(urls.every((url)=>url.endsWith('/api/tags')));
  }
 } finally {globalThis.fetch=original;}
});

test('a preferred cloud proxy model is refused by the real worker without a fallback or private POST', async () => {
 const original = globalThis.fetch; let posts = 0;
 try {
  globalThis.fetch = async (input, init) => {
   const request = await requestDetails(input, init);
   if (request.url.endsWith('/api/tags')) return json({ models: [{ name: 'cloud-preferred' }, { name: 'qwen3.5:4b' }] });
   if (request.url.endsWith('/api/show')) return json(JSON.parse(request.body).model === 'cloud-preferred' ? { ...local, remote_host: 'https://ollama.com', remote_model: 'cloud' } : local);
   posts++; return new Response('{"done":true,"message":{"content":"private answer"}}\n');
  };
  const run = await startWorker('ollama', '.', 'PRIVATE EVIDENCE', undefined, { systemPrompt:'PRIVATE SYSTEM', preferredModel:'cloud-preferred' });
  await assert.rejects(run.promise); assert.equal(posts, 0);
 } finally { globalThis.fetch = original; }
});

test('loopback cloud proxies and unverifiable models never receive private chat payloads', async () => {
 const original = globalThis.fetch;
 try {
  for (const show of [{ ...local, remote_host: 'https://ollama.com', remote_model: 'cloud' }, { capabilities: ['completion'] }, { ...local, capabilities: ['embedding'] }]) {
   const posts: string[] = [];
   globalThis.fetch = async (input, init) => { const request = await requestDetails(input, init); if (request.url.endsWith('/api/tags')) return json({models:[{name:'qwen3.5:4b'}]}); if (request.url.endsWith('/api/show')) return json(show); posts.push(request.body); return json({}); };
   await assert.rejects(draftingFetch(`${endpoint}/api/chat`, { method: 'POST', body: JSON.stringify({ model: 'qwen3.5:4b', messages: [{role:'user',content:'PRIVATE EVIDENCE'}], stream:true }) }), /verified local|local GGUF|remote/i);
   assert.deepEqual(posts, []);
  }
 } finally { globalThis.fetch = original; }
});

test('verified local model is checked without private data before bounded generation and redirects are forbidden', async () => {
 const original = globalThis.fetch; const calls: Awaited<ReturnType<typeof requestDetails>>[] = [];
 try {
  globalThis.fetch = async (input, init) => { const request = await requestDetails(input, init); calls.push(request); return json(request.url.endsWith('/api/tags') ? {models:[{name:'qwen3.5:4b'}]} : request.url.endsWith('/api/show') ? local : {}); };
  await draftingFetch(`${endpoint}/api/chat`, { method:'POST', credentials:'include', headers:{cookie:'PRIVATE COOKIE',authorization:'PRIVATE AUTH'}, body:JSON.stringify({ model:'qwen3.5:4b', messages:[{role:'user',content:'PRIVATE EVIDENCE'}], stream:true }) });
  assert.equal(calls[0].url, `${endpoint}/api/tags`); assert.equal(calls[1].url, `${endpoint}/api/show`);
  assert.doesNotMatch(calls[1].body, /PRIVATE EVIDENCE/);
  for (const request of calls) { assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit'); assert.equal(request.headers.has('cookie'), false); assert.equal(request.headers.has('authorization'), false); }
  assert.match(calls[2].body, /PRIVATE EVIDENCE/);
  assert.equal(JSON.parse(calls[2].body).options.num_ctx, 8192);
 } finally { globalThis.fetch = original; }
});

test('aborting local model verification prevents any private chat POST even when show ignores cancellation', async () => {
 const original = globalThis.fetch; const controller = new AbortController(); let finish!: () => void; let posts = 0;
 try {
  globalThis.fetch = async (input, init) => { const request = await requestDetails(input, init); if (request.url.endsWith('/api/tags')) return json({models:[{name:'qwen3.5:4b'}]}); if (request.url.endsWith('/api/show')) { await new Promise<void>((resolve) => {finish=resolve;}); return json(local); } posts++; return json({}); };
  const response = draftingFetch(`${endpoint}/api/chat`, {signal:controller.signal,method:'POST',body:JSON.stringify({model:'qwen3.5:4b',messages:[{role:'user',content:'PRIVATE'}]})});
  await tick(); controller.abort(); finish(); await assert.rejects(response, /abort|cancel/i); assert.equal(posts,0);
 } finally { globalThis.fetch=original; }
});

test('real worker startup cancellation during delayed model discovery never sends a prompt', async () => {
 const original = globalThis.fetch; const controller = new AbortController(); let finish!:()=>void; let posts=0;
 try {
  globalThis.fetch = async (input) => {
   if (String(input).endsWith('/api/tags')) { await new Promise<void>((resolve)=>{finish=resolve;}); return json({models:[{name:'qwen3.5:4b'}]}); }
   if (String(input).endsWith('/api/show')) return json(local);
   posts++; return new Response('{"done":true,"message":{"content":"late"}}\n');
  };
  const started = startWorker('ollama', '.', 'PRIVATE EVIDENCE', undefined, {systemPrompt:'Fixture',preferredModel:'qwen3.5:4b',signal:controller.signal});
  await tick(); controller.abort(); finish();
  let late: Awaited<typeof started>|undefined;
  await assert.rejects(started.then((run)=>{late=run;return run;}), /abort|cancel|stopped/i);
  if (late) await late.promise;
  assert.equal(posts,0);
 } finally {globalThis.fetch=original;}
});
