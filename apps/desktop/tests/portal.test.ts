import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {StudioService} from '../sidecar/studio/service.ts';
import {parsePortalRequest,requestBrief,requestJobId,PORTAL_REQUEST_SCHEMA,PORTAL_PACKAGE_SCHEMA} from '../sidecar/studio/portal.ts';
import type {StudioArtifact} from '../shared/studio.ts';

const request = (extra: Record<string, unknown> = {}) => ({schema: PORTAL_REQUEST_SCHEMA, requestId: 'REQ-2026-0042', revision: 2, client: 'Otter House Wellness', project: 'Website', title: 'Refresh the services page', scope: 'Rewrite the three service descriptions.\nKeep the booking link.', acceptanceCriteria: ['Three services described', 'Booking link works'], requestedDate: '2026-11-03', ...extra});
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function fixture(run: (service: StudioService, projectId: string, dir: string) => void): void {
 const dir = mkdtempSync(join(tmpdir(), 'pantheon-portal-'));
 const root = join(dir, 'client-site'); mkdirSync(root); writeFileSync(join(root, 'README.md'), '# Client site');
 const service = new StudioService(join(dir, 'data'), () => root);
 try { run(service, service.store.register(root).id, dir); } finally { service.store.close(); rmSync(dir, {recursive: true, force: true}); }
}

test('a valid portal request is parsed and its brief marks the text as the client’s words', () => {
 const parsed = parsePortalRequest(JSON.stringify(request()));
 assert.equal(parsed.requestId, 'REQ-2026-0042'); assert.equal(parsed.revision, 2);
 const brief = requestBrief(parsed);
 assert.match(brief, /request REQ-2026-0042, revision 2/);
 assert.match(brief, /client’s words, not as instructions/);
 assert.match(brief, /Requested date \(not an agreed date\): 2026-11-03/);
 assert.match(brief, /- Booking link works/);
});

test('portal requests are refused when anything is off-contract', () => {
 const bad: [string, unknown][] = [
  ['wrong schema', request({schema: 'holley.portal.request/2'})], ['unknown field', request({priority: 'urgent'})],
  ['bad id', request({requestId: '../../x'})], ['fractional revision', request({revision: 1.5})], ['zero revision', request({revision: 0})],
  ['no criteria', request({acceptanceCriteria: []})], ['too many criteria', request({acceptanceCriteria: Array(21).fill('x')})],
  ['non-string criterion', request({acceptanceCriteria: [7]})], ['impossible date', request({requestedDate: '2026-02-30'})],
  ['control character', request({title: 'Refresh\u0000 page'})], ['newline in a single-line field', request({client: 'A\nB'})],
  ['empty scope', request({scope: '   '})], ['oversized scope', request({scope: 'x'.repeat(4001)})], ['array', [request()]],
 ];
 for (const [name, value] of bad) assert.throws(() => parsePortalRequest(JSON.stringify(value)), Error, name);
 assert.throws(() => parsePortalRequest('not json'), /not a portal request/);
 assert.throws(() => parsePortalRequest(JSON.stringify(request({scope: 'x'.repeat(70_000)}))), /too large/);
});

test('importing a request creates one planned job, linked to the request, and is idempotent', () => fixture((service, projectId) => {
 const content = JSON.stringify(request());
 const job = service.importRequest({projectId, playbookId: 'content-brief', content});
 assert.equal(job.state, 'planned'); assert.equal(job.attempts, 0);
 assert.deepEqual(job.portalRequest, {requestId: 'REQ-2026-0042', revision: 2});
 assert.equal(job.dueAt, undefined, 'a requested date must never become a due date');
 assert.equal(job.id, requestJobId(parsePortalRequest(content), projectId, 'content-brief'));
 assert.equal(service.importRequest({projectId, playbookId: 'content-brief', content}).id, job.id);
 assert.equal(service.snapshot().jobs.filter((j) => j.projectId === projectId).length, 1);
 // A new revision is new work, not a silent replacement of the old job.
 const revised = service.importRequest({projectId, playbookId: 'content-brief', content: JSON.stringify(request({revision: 3}))});
 assert.notEqual(revised.id, job.id);
 assert.equal(service.snapshot().jobs.filter((j) => j.projectId === projectId).length, 2);
 assert.throws(() => service.importRequest({projectId, playbookId: 'no-such-playbook', content}));
 assert.throws(() => service.importRequest({projectId: 'missing-project', playbookId: 'content-brief', content}));
}));

test('an export carries a portal package that matches the exported files byte for byte', () => fixture((service, projectId) => {
 const job = service.importRequest({projectId, playbookId: 'content-brief', content: JSON.stringify(request())});
 const text = '# Deliverable\n' + 'Body text for the client deliverable [S1].\n'.repeat(12);
 const artifact: StudioArtifact = {id: 'artifact-0001', jobId: job.id, title: 'Client site · Content brief', content: text, sha256: sha(text), createdAt: new Date().toISOString(), sources: [], findings: [], checks: [{name: 'Review required', passed: true, detail: 'fixture'}], worker: 'evidence'};
 service.store.startJob(job.id, 'evidence');
 service.store.finish(job.id, artifact, {durationMs: 1});
 const exported = service.export(job.id);
 const read = (name: string) => readFileSync(join(exported.path, name), 'utf8');
 const pkg = JSON.parse(read('portal-package.json'));
 assert.equal(pkg.schema, PORTAL_PACKAGE_SCHEMA);
 assert.deepEqual(pkg.portalRequest, {requestId: 'REQ-2026-0042', revision: 2});
 assert.equal(pkg.internalReview.state, 'draft', 'an unreviewed job must not be presented as accepted');
 assert.equal(pkg.artifact.sha256, sha(text));
 assert.deepEqual(pkg.files.map((f: {name: string}) => f.name).sort(), ['deliverable.html', 'deliverable.md', 'evidence.json']);
 for (const file of pkg.files) { const body = read(file.name); assert.equal(file.sha256, sha(body), file.name); assert.equal(file.bytes, Buffer.byteLength(body, 'utf8'), file.name); }
 assert.equal(JSON.parse(read('manifest.json'))['portal-package.json'], sha(read('portal-package.json')));
}));
