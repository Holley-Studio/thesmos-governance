import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { StudioStore, sha256 } from '../sidecar/studio/store.js';
import { StudioService, auditText, qualityChecks } from '../sidecar/studio/service.js';
import { godName } from '../shared/pantheon.js';
import { DatabaseSync } from 'node:sqlite';
import { captureEvidence, readEvidence } from '../sidecar/studio/evidence.js';
import { codexArgs, claudeArgs, captureCli, subscriptionEnv, claudeSubscriptionStatus } from '../sidecar/studio/workers.js';
import type { StudioArtifact } from '../shared/studio.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pantheon-test-'));
  const root = join(dir, 'otter-house-wellness'); mkdirSync(root);
  writeFileSync(join(root, 'README.md'), '# OHW\nThis is a pitch demo, not a production site.');
  for (const folder of ['src/components/ui', 'src/content', 'src/app/about']) mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, 'src/components/ui/ContactForm.tsx'), 'onSubmit={(e) => e.preventDefault()} Send Message (Demo — not connected)');
  writeFileSync(join(root, 'src/content/testimonials.ts'), 'isPlaceholder: true');
  writeFileSync(join(root, 'src/content/site.ts'), 'url: "https://demo.otterhousewellness.com"');
  writeFileSync(join(root, 'src/app/about/page.tsx'), 'export default function Page() {}');
  const store = new StudioStore(join(dir, 'data')); const project = store.register(root);
  const create = (playbookId = 'delivery-audit') => store.createJob({ projectId: project.id, playbookId, brief: 'Inspect this project', requestId: randomUUID() });
  const close = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, root, store, project, create, close };
}
function artifact(jobId: string, valid = true): StudioArtifact {
  const content = '# Report\n' + ('Verified source observation [S1].\n'.repeat(12));
  return { id: randomUUID(), jobId, title: 'OHW audit', content, sha256: sha256(content), createdAt: new Date().toISOString(), sources: [{ id: 'S1', path: 'README.md', excerpt: 'demo', sha256: sha256('demo'), capturedAt: new Date().toISOString() }], findings: [], checks: [{ name: 'Evidence', passed: valid, detail: 'Fixture' }], worker: 'evidence' };
}

test('unknown client registrations cannot read studio knowledge', () => {
 const f=fixture(); f.store.close(); const root=join(f.dir,'arbitrary-client');mkdirSync(root); const service=new StudioService(join(f.dir,'scope-data'),()=>root);
 try {service.register(root);const project=service.store.projects()[0];assert.equal(project.kind,'client');assert.throws(()=>service.knowledge({projectId:project.id}),/knowledge.*registered|registered.*knowledge/i);assert.equal(service.store.register(root).id,project.id); } finally {service.store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('legacy client classifications lose private knowledge access when reopened', () => {
 const f = fixture(); const project = f.project; f.store.close();
 const db = new DatabaseSync(join(f.dir, 'data', 'studio.sqlite'));
 db.prepare('UPDATE projects SET body = ? WHERE id = ?').run(JSON.stringify({ ...project, kind: 'studio' }), project.id); db.close();
 const service = new StudioService(join(f.dir, 'data'), () => f.root);
 try {
  // Check authorization even before the caller re-registers this legacy row.
  assert.throws(() => service.knowledge({ projectId: project.id }), /knowledge.*registered|registered.*knowledge/i);
  service.register(f.root);
  assert.equal(service.store.project(project.id).kind, 'client');
  assert.equal(service.store.project(project.id).id, project.id);
 } finally { service.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a cancelled attempt cannot fail its replacement when it settles late', async (t) => {
 const f = fixture(); f.store.close(); const service = new StudioService(join(f.dir, 'retry-service'), () => f.root);
 let rejectOld!: (error: Error) => void; let finishNew!: () => void;
 const oldAttempt = new Promise<void>((_, reject) => { rejectOld = reject; });
 const newAttempt = new Promise<void>((resolve) => { finishNew = resolve; });
 let calls = 0;
 t.mock.method(service as unknown as { execute(): Promise<void> }, 'execute', () => ++calls === 1 ? oldAttempt : newAttempt);
 try {
  service.register(f.root); const project = service.store.projects()[0];
  const job = service.create({ projectId: project.id, playbookId: 'delivery-audit', brief: 'Retry safely', requestId: randomUUID() });
  service.run({ jobId: job.id }); service.cancel(job.id); service.run({ jobId: job.id });
  rejectOld(new Error('Job stopped'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(service.store.job(job.id).state, 'running');
  assert.equal(service.store.job(job.id).attempts, 2);
  assert.ok(!service.store.events().some(event => event.action === 'job-failed'));
  service.store.finish(job.id, artifact(job.id), {}); finishNew();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(service.store.job(job.id).state, 'review');
 } finally { finishNew(); service.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('stopping during model discovery handles the eventual worker rejection', async (t) => {
 const f = fixture(); f.store.close(); const service = new StudioService(join(f.dir, 'discovery-service'), () => f.root);
 let releaseTags!: (value: Response) => void;
 const tags = new Promise<Response>((resolve) => { releaseTags = resolve; });
 t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/api/tags')) return tags;
  if (url.endsWith('/api/show')) return Response.json({ capabilities: ['completion'] });
  if (url.endsWith('/api/chat')) return new Promise<Response>((_, reject) => {
   if (init?.signal?.aborted) reject(new Error('Aborted'));
   else init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  });
  throw new Error(`Unexpected fetch: ${url}`);
 });
 try {
  service.register(f.root); const project = service.store.projects()[0];
  const job = service.create({ projectId: project.id, playbookId: 'seo-plan', brief: 'Stop before discovery finishes', requestId: randomUUID() });
  service.run({ jobId: job.id, worker: 'ollama' }); service.cancel(job.id);
  releaseTags(Response.json({ models: [{ name: 'llama3.2:3b' }] }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(service.store.job(job.id).state, 'cancelled');
  assert.ok(!service.store.events().some(event => event.action === 'job-failed'));
 } finally { service.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('calendar dates and due-date request identity are validated', () => {
 const f=fixture(); try {
  const input={projectId:f.project.id,playbookId:'delivery-audit',brief:'Inspect',requestId:randomUUID()};
  for(const dueAt of ['2026-02-30','2026-04-31','2025-02-29','0000-01-01']) assert.throws(()=>f.store.createJob({...input,dueAt}),/due date/);
  const job=f.store.createJob({...input,dueAt:'2028-02-29'}); assert.equal(f.store.createJob({...input,dueAt:'2028-02-29'}).id,job.id);
  assert.throws(()=>f.store.createJob({...input,dueAt:'2028-03-01'}),/different assignment/); assert.throws(()=>f.store.createJob(input),/different assignment/);
 }finally {f.close();}
});

test('job service refuses malformed optional due dates', () => {
 const f=fixture(); f.store.close(); const service=new StudioService(join(f.dir,'date-service'),()=>f.root);
 try {service.register(f.root);const project=service.store.projects()[0];for(const dueAt of [123,null,{}]) assert.throws(()=>service.create({projectId:project.id,playbookId:'delivery-audit',brief:'Inspect',requestId:randomUUID(),dueAt}),/due date/);assert.equal(service.store.jobs().length,0);}
 finally {service.store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('generic projects do not inherit clinical intake findings or fabricated audit dates', () => {
 const f=fixture(); try {
  rmSync(join(f.root,'src/components/ui/ContactForm.tsx'));mkdirSync(join(f.root,'docs'));writeFileSync(join(f.root,'docs/growth-strategy.md'),'# Strategy\nReviewed September 2026.');
  const result=captureEvidence({...f.project,kind:'client'});assert.ok(!result.findings.some(x=>x.title==='Intake implementation was not inspected'));assert.ok(!result.findings.some(x=>x.evidence.includes('July 2026')));assert.ok(result.findings.some(x=>x.title==='Historical growth audit needs revalidation'));
  assert.ok(!auditText('Generic project',result.sources,result.findings,result.routes,'client').includes('healthcare claims'));
 }finally {f.close();}
});
test('source audit finds real launch blockers and excludes private files', () => {
  const f = fixture();
  try { writeFileSync(join(f.root, '.env'), 'PRIVATE_SECRET=never-read'); const result = captureEvidence(f.project); assert.equal(result.findings.filter((x) => x.severity === 'blocker').length, 3); assert.deepEqual(result.routes, ['/about']); assert.ok(result.sources.every((s) => !s.path.includes('.env'))); assert.equal(result.sources.find((s) => s.path === 'README.md')?.sha256, sha256(readFileSync(join(f.root, 'README.md'), 'utf8'))); } finally { f.close(); }
});
test('duplicate create request produces exactly one durable job', () => {
 const f = fixture(); try { const first = f.create(); const second = f.store.createJob({ projectId: f.project.id, playbookId: first.playbookId, brief: first.brief, requestId: first.id }); assert.equal(second.id, first.id); assert.equal(f.store.jobs().length, 1); } finally { f.close(); }
});
test('deity identities preserve job IDs and historical ownership records', () => {
 const f = fixture(); f.store.close(); const service = new StudioService(join(f.dir, 'identities'), () => f.root);
 try { service.register(f.root); const project = service.store.projects()[0]; const job = service.create({projectId:project.id,playbookId:'delivery-audit',brief:'Historical audit',requestId:randomUUID()}); service.store.saveJob({...job,owner:'Cassandra'}); const visible = service.snapshot().jobs.find((j)=>j.id===job.id)!; assert.equal(visible.owner,'Themis'); assert.equal(service.store.job(job.id).owner,'Cassandra'); assert.equal(visible.id,job.id); assert.equal(godName('Zeus'),'Zeus'); assert.equal(godName('Talos'),'Hephaestus'); } finally {service.store.close();rmSync(f.dir,{recursive:true,force:true});}
});
test('request IDs cannot silently change an assignment', () => {
 const f = fixture(); try { const job = f.create(); assert.throws(() => f.store.createJob({ projectId: f.project.id, playbookId: job.playbookId, brief: 'Changed instruction', requestId: job.id }), /different assignment/); assert.equal(f.store.jobs().length, 1); } finally { f.close(); }
});
test('captured source content matches its digest', () => {
 const f = fixture(); try { const result = captureEvidence(f.project); for (const source of result.sources) assert.equal(sha256(source.content!), source.sha256); } finally { f.close(); }
});
test('ordinary submit prevention is not mistaken for a demo backend', () => {
 const f = fixture(); try { writeFileSync(join(f.root, 'src/components/ui/ContactForm.tsx'), 'onSubmit={(e) => { e.preventDefault(); fetch("/api/intake", {method:"POST"}); }}'); assert.ok(!captureEvidence(f.project).findings.some((x) => x.title === 'Intake form is a demo stub')); } finally { f.close(); }
});
test('Windows native picker paths identify the existing project', () => {
 if (process.platform !== 'win32') return;
 const f = fixture(); try { const native = String.fromCharCode(92,92,63,92) + f.root; assert.equal(f.store.register(native).id, f.project.id); assert.equal(f.store.projects().length, 1); } finally { f.close(); }
});
test('backup is a standalone database containing committed WAL work', () => {
 const f = fixture(); try { const job = f.create(); const snapshot = f.store.backup(); assert.equal(createHash('sha256').update(readFileSync(snapshot.path)).digest('hex'), snapshot.sha256); const backupDir = join(f.dir, 'restored'); mkdirSync(backupDir); writeFileSync(join(backupDir, 'studio.sqlite'), readFileSync(snapshot.path)); const restored = new StudioStore(backupDir); try { assert.equal(restored.job(job.id).brief, job.brief); assert.equal(restored.projects().length, 1); } finally { restored.close(); } } finally { f.close(); }
});
test('only one job can run; completed output requires an explicit review', () => {
 const f = fixture(); try { const a = f.create(); const b = f.create(); f.store.startJob(a.id, 'evidence'); assert.throws(() => f.store.startJob(b.id, 'evidence'), /Another job/); assert.throws(() => f.store.review(a.id, 'approve', 'okay'), /awaiting review/); f.store.finish(a.id, artifact(a.id), {}); assert.equal(f.store.job(a.id).state, 'review'); assert.throws(() => f.store.review(a.id, 'approve', ' '), /review note/); const approved = f.store.review(a.id, 'approve', 'Inspected the fixture evidence.'); assert.equal(approved.state, 'approved'); assert.throws(() => f.store.startJob(a.id, 'evidence'), /revised/); } finally { f.close(); }
});
test('failed quality checks prevent approval, revision invalidates acceptance', () => {
 const f = fixture(); try { const job = f.create(); f.store.startJob(job.id, 'evidence'); f.store.finish(job.id, artifact(job.id, false), {}); assert.throws(() => f.store.review(job.id, 'approve', 'Accept'), /quality checks/); f.store.review(job.id, 'revise', 'Add missing evidence.'); assert.equal(f.store.job(job.id).state, 'planned'); assert.match(f.store.job(job.id).brief, /Add missing evidence/); } finally { f.close(); }
});
test('crash recovery preserves work and never starts another inference', () => {
 const f = fixture(); const job = f.create(); f.store.startJob(job.id, 'ollama'); f.store.close(); const reopened = new StudioStore(join(f.dir, 'data')); try { assert.equal(reopened.job(job.id).state, 'failed'); assert.equal(reopened.job(job.id).attempts, 1); assert.match(reopened.job(job.id).error!, /stopped/); } finally { reopened.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test('attempt limit prevents unbounded paid or local loops', () => {
 const f = fixture(); try { const job = f.create(); for (let i = 0; i < 3; i++) { const running = f.store.startJob(job.id, 'ollama'); f.store.saveJob({ ...running, state: 'failed' }); } assert.throws(() => f.store.startJob(job.id, 'ollama'), /Attempt limit/); } finally { f.close(); }
});
test('source path traversal and symlink escape are rejected', () => {
 const f = fixture(); try { writeFileSync(join(f.dir, 'outside.md'), 'not granted'); assert.throws(() => readEvidence(f.root, '../outside.md', 'S1'), /escapes/); const linked = join(f.root, 'linked'); symlinkSync(f.dir, linked, 'junction'); assert.throws(() => readEvidence(f.root, 'linked/outside.md', 'S1'), /escapes/); } finally { f.close(); }
});
test('raw credentials in curated sources fail closed', () => {
 const f = fixture(); try { writeFileSync(join(f.root, 'README.md'), '-----BEGIN PRIVATE KEY-----'); assert.throws(() => captureEvidence(f.project), /credential/); } finally { f.close(); }
});
test('quality checks reject invented citations and short outputs', () => {
 const source = artifact('fixture').sources; assert.ok(qualityChecks('not a deliverable [S99]', source, true).some((c) => !c.passed)); assert.ok(qualityChecks(artifact('fixture').content, source, true).every((c) => c.passed));
});
test('a simulated tool transcript cannot pass document quality checks', () => {
 const doc = artifact('fixture');
 const transcript = '**Tool use: Write**\n\n```\nfile_path: fake-plan.md\n```\n\n' + doc.content;
 assert.ok(qualityChecks(transcript, doc.sources, true).some(c => c.name === 'No simulated tool execution' && !c.passed));
 assert.ok(qualityChecks(doc.content, doc.sources, true).every(c => c.passed));
});
test('exports retain draft status, escape HTML, and have verified checksums', () => {
 const f = fixture(); f.store.close(); const service = new StudioService(join(f.dir, 'service'), () => f.root); try { service.register(f.root); const p = service.store.projects()[0]; const job = service.create({ projectId: p.id, playbookId: 'delivery-audit', brief: '', requestId: randomUUID() }); service.store.startJob(job.id, 'evidence'); const doc = artifact(job.id); doc.content += '<script>alert("unsafe")</script>'; doc.sha256 = sha256(doc.content); service.store.finish(job.id, doc, {}); const exported = service.export(job.id); const text = readFileSync(join(exported.path, 'deliverable.md'), 'utf8'); assert.match(text, /DRAFT — NOT APPROVED/); const html = readFileSync(join(exported.path, 'deliverable.html'), 'utf8'); assert.ok(!html.includes('<script>')); const manifest = JSON.parse(readFileSync(join(exported.path, 'manifest.json'), 'utf8')); assert.equal(sha256(text), manifest['deliverable.md']); assert.ok(existsSync(join(exported.path, 'evidence.json'))); } finally { service.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test('cloud inference requires an explicit selection and matching active project', () => {
 const f = fixture(); f.store.close(); const service = new StudioService(join(f.dir, 'service'), () => f.root); try { service.register(f.root); const p = service.store.projects()[0]; const job = service.create({ projectId: p.id, playbookId: 'seo-plan', brief: '', requestId: randomUUID() }); assert.throws(() => service.run({ jobId: job.id, worker: 'codex' }), /explicitly/); assert.equal(service.store.job(job.id).state, 'planned'); } finally { service.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test('official workers disable tool access and inherited customizations', () => {
 assert.ok(codexArgs().includes('--ignore-user-config')); assert.ok(codexArgs().includes('read-only')); assert.ok(codexArgs().includes('shell_tool')); assert.ok(codexArgs().includes('hooks')); assert.ok(!codexArgs().some((a) => a.includes('bypass'))); assert.ok(claudeArgs().includes('--safe-mode')); assert.ok(claudeArgs().includes('--strict-mcp-config')); assert.ok(claudeArgs().includes(''));
 const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key'; try { assert.equal(subscriptionEnv().OPENAI_API_KEY, undefined); } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});
test('worker nonzero exit and timeout return actionable failures', async () => {
 await assert.rejects(captureCli(process.execPath, ['-e', 'process.exit(3)'], tmpdir()).promise, /code 3/);
 await assert.rejects(captureCli(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], tmpdir(), '', 100).promise, /timed out/);
});
test('signed-out CLI status is readable without accepting failed model runs', async () => {
 const args = ['-e', 'process.stdout.write(JSON.stringify({loggedIn:false,authMethod:"none"}));process.exit(1)'];
 const probe = await captureCli(process.execPath, args, tmpdir(), '', 8_000, [0, 1]).promise;
 assert.equal(claudeSubscriptionStatus(probe.text).state, 'signin');
 await assert.rejects(captureCli(process.execPath, args, tmpdir()).promise);
 assert.equal(claudeSubscriptionStatus('{"loggedIn":true,"authMethod":"claude.ai"}').state, 'ready');
 assert.equal(claudeSubscriptionStatus('{"loggedIn":true,"authMethod":"api_key"}').state, 'unverified');
 assert.equal(claudeSubscriptionStatus('{}').state, 'unverified');
 assert.throws(() => claudeSubscriptionStatus('not JSON'));
});
