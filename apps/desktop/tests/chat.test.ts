import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { StudioStore } from '../sidecar/studio/store.js';
import { CouncilChatService } from '../sidecar/studio/chat.js';
import { chatHandoff, recentConversation, councilInstructions, CHAT_CONTEXT_LIMIT, type CouncilThread } from '../shared/chat.js';
import type { WorkerRun, WorkerResult } from '../sidecar/studio/workers.js';

function fixture() {
 const dir = mkdtempSync(join(tmpdir(), 'pantheon-chat-test-'));
 assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\pantheon-chat-test-') || resolve(dir).startsWith(resolve(tmpdir()) + '/pantheon-chat-test-'));
 const root = join(dir, 'project'); mkdirSync(root); const data = join(dir, 'data');
 const store = new StudioStore(data); const project = store.register(root);
 let currentRoot = root; let jobsBusy = false; let runs = 0; let stopped = false; let lastPrompt = ''; let cwd = '';
 let finish: (result: WorkerResult) => void = () => undefined;
 let fail: (error: Error) => void = () => undefined;
 const roster = () => [{ god: 'Zeus', role: 'Priorities' }, { god: 'Athena', role: 'Strategy' }, { god: 'Apollo', role: 'Content' }];
 const chat = new CouncilChatService(store, () => currentRoot, roster, () => jobsBusy, async (_engine, workerCwd, prompt): Promise<WorkerRun> => {
  runs++; lastPrompt = prompt; cwd = workerCwd;
  return { promise: new Promise((res, rej) => { finish = res; fail = rej; }), stop: () => { stopped = true; fail(new Error('Stopped')); } };
 });
 const create = (engine = 'ollama', god = 'Council', allowCloud = false) => chat.create({ projectId: project.id, god, engine, allowCloud });
 const send = (thread: CouncilThread, text = 'Help me think', requestId = randomUUID(), allowCloud = false) => chat.send({ threadId: thread.id, revision: thread.revision, text, requestId, allowCloud });
 return { dir, store, project, root, chat, create, send, roster, setRoot: (value: string) => { currentRoot = value; }, setBusy: () => { jobsBusy = true; },
  runs: () => runs, stopped: () => stopped, prompt: () => lastPrompt, cwd: () => cwd,
  finish: (text = 'A useful idea') => finish({ text, model: 'fixture-model', durationMs: 5 }), fail: () => fail(new Error('Unavailable')),
  close: () => { chat.shutdown(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function settle() { await new Promise<void>((res) => setImmediate(res)); }

test('local chat is durable, isolated from project files, and included in the existing database backup', async () => {
 const f = fixture(); try {
  const thread = f.create(); const pending = f.send(thread, 'Brainstorm a better offer'); await settle();
  assert.equal(f.runs(), 1); assert.ok(f.cwd().startsWith(join(f.dir, 'data'))); assert.notEqual(f.cwd(), f.root);
  assert.match(f.prompt(), /ONE model/); f.finish('Three practical options'); await settle();
  const complete = f.chat.get({ threadId: thread.id }); assert.equal(complete.messages[1].text, 'Three practical options'); assert.equal(complete.messages[1].model, 'fixture-model');
  assert.equal(pending.messages[1].state, 'pending'); assert.equal(f.chat.busy, false);
  const backup = f.store.backup(); const db = new DatabaseSync(backup.path, { readOnly: true });
  try { assert.match(String(db.prepare('SELECT body FROM council_chats WHERE id = ?').get(thread.id)?.body), /Three practical options/); } finally { db.close(); }
 } finally { f.close(); }
});

test('repeated request ID never consumes another model turn; changed payload is refused', async () => {
 const f = fixture(); try { const t = f.create(); const id = randomUUID(); const first = f.send(t, 'An idea', id); await settle();
  const again = f.send(t, 'An idea', id); assert.equal(again.revision, first.revision); assert.equal(f.runs(), 1);
  assert.throws(() => f.send(t, 'Another idea', id), /different message/); f.finish(); await settle();
  f.send(t, 'An idea', id); assert.equal(f.runs(), 1);
 } finally { f.close(); }
});

test('cloud chat creation and every new send require explicit subscription sharing', async () => {
 const f = fixture(); try {
  assert.throws(() => f.create('codex'), /Confirm OpenAI/); assert.equal(f.runs(), 0);
  const t = f.create('codex', 'Zeus', true); assert.throws(() => f.send(t), /Confirm OpenAI/);
  f.send(t, 'Explore this', randomUUID(), true); await settle(); assert.equal(f.runs(), 1); f.finish(); await settle();
 } finally { f.close(); }
});

test('unknown or held-back gods and engines cannot be used', () => {
 const f = fixture(); try { assert.throws(() => f.create('ollama', 'InventedGod'), /unavailable/); assert.throws(() => f.create('paid-api'), /Choose local/); assert.equal(f.runs(), 0); } finally { f.close(); }
});

test('project grants prevent another project from reading, sending, or deleting a conversation', () => {
 const f = fixture(); try { const t = f.create(); f.setRoot(join(f.dir, 'other'));
  for (const method of ['get', 'stop', 'delete'] as const) assert.throws(() => f.chat[method]({ threadId: t.id }), /Open this conversation/);
  assert.throws(() => f.send(t), /Open this conversation/); assert.throws(() => f.chat.list({ projectId: f.project.id }), /Open this conversation/);
 } finally { f.setRoot(f.root); f.close(); }
});

test('workboard and chat share a single-worker limit; stale revisions are refused', async () => {
 const f = fixture(); try { const t = f.create(); const second = f.create(); const active = f.send(t); await settle();
  assert.throws(() => f.send(second), /current chat/); assert.throws(() => f.chat.delete({ threadId: t.id }), /Stop/);
  f.finish(); await settle(); assert.throws(() => f.send(t, 'New thought'), /changed/);
  assert.ok(active.revision > t.revision); f.setBusy(); assert.throws(() => f.send(second), /workboard job/);
 } finally { f.close(); }
});

test('stopping a turn records cancellation and ignores a late result without automatic retry', async () => {
 const f = fixture(); try { const t = f.create(); f.send(t); await settle(); const stopped = f.chat.stop({ threadId: t.id });
  assert.equal(f.stopped(), true); assert.equal(stopped.messages[1].state, 'cancelled'); f.finish('Too late'); await settle();
  assert.equal(f.chat.get({ threadId: t.id }).messages[1].state, 'cancelled'); assert.equal(f.runs(), 1); assert.equal(f.chat.busy, false);
 } finally { f.close(); }
});

test('a failed model reply stays visible and never starts a paid fallback or retry', async () => {
 const f = fixture(); try { const t = f.create(); f.send(t); await settle(); f.fail(); await settle();
  assert.equal(f.chat.get({ threadId: t.id }).messages[1].state, 'failed'); assert.equal(f.runs(), 1); assert.equal(f.chat.busy, false);
 } finally { f.close(); }
});

test('restart marks an interrupted turn failed without invoking any worker', () => {
 const f = fixture(); try { const t = f.create(); f.store.saveChat({ ...t, revision: 1, messages: [{ id: 'old', role: 'assistant', state: 'pending', text: '', at: t.createdAt }] });
  const recovered = new CouncilChatService(f.store, () => f.root, f.roster, () => false, async () => { throw new Error('Must never run'); });
  assert.equal(recovered.get({ threadId: t.id }).messages[0].state, 'failed'); assert.equal(f.runs(), 0);
 } finally { f.close(); }
});

test('optimistic updates refuse lost writes and deletion removes only the chosen thread', () => {
 const f = fixture(); try { const t = f.create(); const other = f.create(); f.store.saveChat({ ...t, revision: 1 });
  assert.throws(() => f.store.saveChat({ ...t, revision: 1 }), /changed/); f.chat.delete({ threadId: t.id });
  assert.ok(f.store.events().some((event) => event.action === 'conversation-deleted' && event.detail.includes(t.id)));
  assert.equal(f.chat.list({ projectId: f.project.id }).length, 1); assert.equal(f.chat.get({ threadId: other.id }).id, other.id);
 } finally { f.close(); }
});

test('context is bounded by whole turns; handoff excludes failed replies and unrequested private knowledge', () => {
 const f = fixture(); try { const t = f.create(); const messages: CouncilThread['messages'] = [];
  for (let i = 0; i < 20; i++) { messages.push({ id: `u${i}`, role: 'user', state: 'complete', text: `user-${i} ` + 'a'.repeat(2000), at: t.createdAt }, { id: `a${i}`, role: 'assistant', state: 'complete', text: `reply-${i} ` + 'b'.repeat(2000), at: t.createdAt }); }
  messages.push({ id: 'failure-user', role: 'user', state: 'complete', text: 'failed request', at: t.createdAt }, { id: 'failure', role: 'assistant', state: 'failed', text: 'PRIVATE_FAILED_ERROR', at: t.createdAt });
  const recent = recentConversation(messages); assert.ok(recent.text.length <= CHAT_CONTEXT_LIMIT); assert.ok(recent.omitted > 0); assert.match(recent.text, /user-19/); assert.doesNotMatch(recent.text, /user-0 |PRIVATE_FAILED_ERROR/);
  const handoff = chatHandoff({ ...t, messages }, 'Council', ['Strategy'], 'Help with an offer', 'work');
  assert.match(handoff, /WORK BRIEF/); assert.match(handoff, /Help with an offer/); assert.doesNotMatch(handoff, /PRIVATE_FAILED_ERROR|Holley Studio Knowledge/);
 } finally { f.close(); }
});

test('empty or oversized messages never start inference', () => {
 const f = fixture(); try { const t = f.create(); assert.throws(() => f.send(t, ' '), /valid text/); assert.throws(() => f.send(t, 'a'.repeat(4001)), /valid text/); assert.equal(f.runs(), 0); } finally { f.close(); }
});
test('council instructions disclose one-model perspectives and require evidence rather than invented execution', () => {
 const instructions = councilInstructions('Council', ['Priorities']);
 assert.match(instructions, /ONE model/); assert.match(instructions, /no tools or access to files/); assert.match(instructions, /written approval/);
});
