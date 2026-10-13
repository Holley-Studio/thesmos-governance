import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DriveService } from '../sidecar/studio/drive/service.js';
const session = { accountId: 'account1', email: 'fixture@example.com', accessToken: 'SECRET', expiresAt: Date.now() + 3600000 };
async function idle(s: DriveService) { for (let i = 0; i < 1000; i++) {
    if (s.status().state !== 'syncing')
        return;
    await new Promise(r => setTimeout(r, 2));
} throw Error('timeout'); }
test('initial cursor precedes 205-file pagination; race change replaces content, deletion revokes; tokens never persist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drive-test-'));
    const calls: string[] = [];
    let removed = false;
    const meta = (id: string, version = '1') => ({ id, name: 'Retention ' + id, mimeType: 'text/plain', version });
    const fetchImpl: typeof fetch = async (input, init) => {
        const u = new URL(String(input));
        calls.push(u.pathname);
        assert.equal(init?.redirect, 'error');
        if (u.pathname.endsWith('startPageToken'))
            return Response.json({ startPageToken: 'before' });
        if (u.pathname.endsWith('/drives'))
            return Response.json({ drives: [] });
        if (u.pathname.endsWith('/files'))
            return Response.json(u.searchParams.has('pageToken') ? { files: Array.from({ length: 5 }, (_, i) => meta('doc' + (i + 200))) } : { files: Array.from({ length: 200 }, (_, i) => meta('doc' + i)), nextPageToken: 'second' });
        if (u.pathname.endsWith('/changes'))
            return Response.json({ changes: removed ? [{ fileId: 'doc0', removed: true }] : [{ fileId: 'doc0', file: meta('doc0', '2') }], newStartPageToken: 'after' });
        if (u.searchParams.get('alt') === 'media')
            return new Response('Customers leave when onboarding is confusing. Improve retention.');
        return Response.json(meta(u.pathname.split('/').pop()!, '2'));
    };
    const s = new DriveService(dir, { fetchImpl, embeddingProvider: { id: 'ollama', embed: async (_m, inputs) => inputs.map(() => [1, 0, 0]) } });
    try {
        s.setSession(session);
        s.sync();
        await idle(s);
        assert.equal(s.status().indexed, 205, JSON.stringify({ status: s.status(), files: s.files(3) }));
        assert.equal(calls[0], '/drive/v3/changes/startPageToken');
        assert.equal(s.files(500).length, 205);
        assert.equal((await s.search('retention')).evidenceStatus, 'ready');
        removed = true;
        s.sync();
        await idle(s);
        assert.throws(() => s.source('doc0'));
        assert.equal(s.status().indexed, 204);
        s.pause();
        s.shutdown();
        const restarted = new DriveService(dir, { fetchImpl });
        restarted.setSession(session);
        assert.equal(restarted.status().state, 'paused');
        assert.equal(restarted.sync(false).accepted, false);
        restarted.disconnect();
        assert.equal(restarted.status().discovered, 0);
        restarted.shutdown();
    }
    finally {
        s.shutdown();
        rmSync(dir, { recursive: true, force: true });
    }
});
function fixture(handler: (u: URL) => Promise<Response> | Response) { const dir = mkdtempSync(join(tmpdir(), 'drive-fixture-')); const fetchImpl: typeof fetch = async (input, init) => { assert.equal(new URL(String(input)).origin, 'https://www.googleapis.com'); assert.equal(init?.redirect, 'error'); return handler(new URL(String(input))); }; const service = () => new DriveService(dir, { fetchImpl, delay: async () => { }, embeddingProvider: { id: 'ollama', embed: async (_m, inputs) => inputs.map(() => [1, 0, 0]) } }); const s = service(); s.setSession(session); return { dir, s, service, cleanup: () => { s.shutdown(); rmSync(dir, { recursive: true, force: true }); } }; }
const doc = { id: 'doc', name: 'Welcome', mimeType: 'text/plain', version: '1' };
function normal(u: URL): Response { if (u.pathname.endsWith('startPageToken'))
    return Response.json({ startPageToken: 'start' }); if (u.pathname.endsWith('/drives'))
    return Response.json({ drives: [] }); if (u.pathname.endsWith('/files'))
    return Response.json({ files: [doc] }); if (u.pathname.endsWith('/changes'))
    return Response.json({ changes: [], newStartPageToken: 'next' }); if (u.searchParams.get('alt') === 'media')
    return new Response('Welcome onboarding retention customers'); return Response.json(doc); }
test('partial reconciliation and failed change pages retain unseen sources and durable cursor', async () => { let expired = false, failed = false; let initial = true; const f = fixture(u => { if (u.pathname.endsWith('/changes') && expired) {
    expired = false;
    return new Response('{}', { status: 410 });
} if (u.pathname.endsWith('/changes') && failed)
    return new Response('{}', { status: 500 }); if (u.pathname.endsWith('/files') && !initial) {
    if (u.searchParams.has('pageToken'))
        return new Response('{}', { status: 500 });
    return Response.json({ files: [], nextPageToken: 'partial' });
} return normal(u); }); try {
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().indexed, 1);
    const synced = f.s.status().lastSyncedAt;
    failed = true;
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().indexed, 1);
    assert.equal(f.s.status().lastSyncedAt, synced);
    failed = false;
    initial = false;
    expired = true;
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().indexed, 1);
    assert.equal(f.s.status().state, 'error');
    assert.equal(f.s.status().lastSyncedAt, synced);
}
finally {
    f.cleanup();
} });
test('queued extraction failure is durable across restart and does not acquire synced timestamp', async () => { let fail = true; const f = fixture(u => u.searchParams.get('alt') === 'media' && fail ? new Response('{}', { status: 500 }) : normal(u)); let next: DriveService | undefined; try {
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().failed, 1);
    assert.equal(f.s.status().remaining, 1);
    assert.equal(f.s.status().lastSyncedAt, undefined);
    assert.equal(f.s.files()[0].syncedAt, undefined);
    f.s.shutdown();
    next = f.service();
    next.setSession(session);
    fail = false;
    next.sync();
    await idle(next);
    assert.equal(next.status().indexed, 1);
    next.shutdown();
    const bytes = readFileSync(join(f.dir, 'drive.sqlite'));
    assert.equal(bytes.includes(Buffer.from('SECRET')), false);
}
finally {
    next?.shutdown();
    f.cleanup();
} });
test('current permission/version checks fail closed and revoke previously indexed evidence', async () => { let revoke = false, offline = false; const f = fixture(u => { if (u.pathname.endsWith('/doc') && revoke)
    return new Response('{}', { status: 404 }); if (offline)
    throw Error('network'); return normal(u); }); try {
    f.s.sync();
    await idle(f.s);
    assert.equal((await f.s.search('onboarding')).sources.length, 1);
    revoke = true;
    await assert.rejects(f.s.search('onboarding'));
    assert.throws(() => f.s.source('doc'));
    assert.equal(f.s.status().passages, 0);
    revoke = false;
    offline = true;
    await assert.rejects(f.s.search('onboarding'));
}
finally {
    f.cleanup();
} });
test('disconnect same-account reconnect during a delayed download cannot publish stale contents', async () => { let release: ((v: Response) => void) | undefined; let delayed = true; const f = fixture(u => { if (u.searchParams.get('alt') === 'media' && delayed)
    return new Promise<Response>(r => { release = r; }); return normal(u); }); try {
    f.s.sync();
    for (let n = 0; n < 100 && !release; n++)
        await new Promise(r => setTimeout(r, 2));
    assert.ok(release);
    f.s.disconnect();
    f.s.setSession(session);
    release!(new Response('stale'));
    await new Promise(r => setTimeout(r, 10));
    assert.equal(f.s.status().indexed, 0);
    delayed = false;
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().indexed, 1);
    f.s.setSession({ ...session, accountId: 'different' });
    assert.equal(f.s.status().discovered, 0);
    assert.throws(() => f.s.source('doc'));
}
finally {
    f.cleanup();
} });
test('native exports and shared-drive pages are visible and shortcut cycles are skipped', async () => { const native = { ...doc, id: 'native', mimeType: 'application/vnd.google-apps.document' }; const shortcut = { id: 'shortcut', name: 'Loop', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'shortcut' } }; const f = fixture(u => { if (u.pathname.endsWith('/drives'))
    return Response.json({ drives: [{ id: 'shared' }] }); if (u.pathname.endsWith('/files'))
    return Response.json({ files: u.searchParams.get('corpora') === 'drive' ? [native, shortcut] : [] }); if (u.pathname.endsWith('/native/export')) {
    assert.equal(u.searchParams.get('mimeType'), 'text/plain');
    return new Response('Native onboarding retained');
} if (u.pathname.endsWith('/native'))
    return Response.json(native); return normal(u); }); try {
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().indexed, 1);
    assert.equal(f.s.status().skipped, 1);
    assert.match(f.s.files().find(r => r.id === 'shortcut')!.reason!, /cycle/);
    assert.equal(f.s.source('native').url, 'https://docs.google.com/document/d/native/edit');
}
finally {
    f.cleanup();
} });
test('transient 403 reasons and 429 retry boundedly while 401 requires sign-in without empty success', async () => { let attempts = 0, signin = false; const f = fixture(u => { if (signin)
    return new Response('{}', { status: 401 }); if (u.searchParams.get('alt') === 'media') {
    attempts++;
    if (attempts === 1)
        return Response.json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 403 });
    if (attempts === 2)
        return new Response('{}', { status: 429 });
} return normal(u); }); try {
    f.s.sync();
    await idle(f.s);
    assert.equal(attempts, 3);
    assert.equal(f.s.status().indexed, 1);
    const synced = f.s.status().lastSyncedAt;
    signin = true;
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().state, 'signin');
    assert.equal(f.s.sync().accepted, false);
    assert.equal(f.s.status().indexed, 1);
    assert.equal(f.s.status().lastSyncedAt, synced);
    await assert.rejects(f.s.search('welcome'));
}
finally {
    f.cleanup();
} });
test('restart resumes failed listing page with original pre-listing cursor', async () => { let first = true, fail = true; let starts = 0; const second = { ...doc, id: 'second' }; const f = fixture(u => { if (u.pathname.endsWith('startPageToken'))
    starts++; if (u.pathname.endsWith('/files')) {
    if (u.searchParams.has('pageToken')) {
        if (fail)
            return new Response('{}', { status: 500 });
        return Response.json({ files: [second] });
    }
    assert.equal(first, true);
    first = false;
    return Response.json({ files: [doc], nextPageToken: 'resume' });
} if (u.pathname.endsWith('/second'))
    return Response.json(second); return normal(u); }); let next: DriveService | undefined; try {
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().discovered, 1);
    assert.equal(f.s.status().indexed, 0);
    f.s.shutdown();
    next = f.service();
    next.setSession(session);
    fail = false;
    next.sync();
    await idle(next);
    assert.equal(next.status().indexed, 2);
    assert.equal(starts, 1);
}
finally {
    next?.shutdown();
    f.cleanup();
} });
test('changed source extraction failure invalidates old passages immediately and preserves pending job', async () => { let change = false; const changed = { ...doc, version: '2' }; const f = fixture(u => { if (change) {
    if (u.pathname.endsWith('/changes'))
        return Response.json({ changes: [{ fileId: 'doc', file: changed }], newStartPageToken: 'new' });
    if (u.pathname.endsWith('/doc')) {
        if (u.searchParams.get('alt') === 'media')
            return new Response('{}', { status: 500 });
        return Response.json(changed);
    }
} return normal(u); }); try {
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().passages, 1);
    change = true;
    f.s.sync();
    await idle(f.s);
    assert.equal(f.s.status().passages, 0);
    assert.equal(f.s.status().failed, 1);
    assert.equal(f.s.status().remaining, 1);
    assert.equal((await f.s.search('onboarding')).sources.length, 0);
}
finally {
    f.cleanup();
} });
test('embedding dimension changes fail to keyword search and cached text vectors are reused exactly', async () => { const dir = mkdtempSync(join(tmpdir(), 'drive-vector-')); let calls = 0, dimensions = 3, version = '1'; const s = new DriveService(dir, { fetchImpl: async (input) => { const u = new URL(String(input)); const m = { ...doc, version }; if (u.pathname.endsWith('/doc') && u.searchParams.get('alt') !== 'media')
        return Response.json(m); if (u.pathname.endsWith('/changes'))
        return Response.json({ changes: version === '2' ? [{ fileId: 'doc', file: m }] : [], newStartPageToken: 'next' }); return normal(u); }, embeddingProvider: { id: 'ollama', embed: async (_m, inputs) => { calls++; return inputs.map(() => dimensions === 3 ? [1, 0, 0] : [1, 0]); } } }); try {
    s.setSession(session);
    s.sync();
    await idle(s);
    assert.equal(calls, 1);
    version = '2';
    s.sync();
    await idle(s);
    assert.equal(calls, 1);
    dimensions = 2;
    const result = await s.search('onboarding');
    assert.equal(result.mode, 'keyword');
    assert.equal(result.sources.length, 1);
    assert.match(result.warnings.join(' '), /keyword/);
}
finally {
    s.shutdown();
    rmSync(dir, { recursive: true, force: true });
} });

test('native refresh failure preserves historical account coverage, revokes active retrieval and recovers persisted pause',async()=>{
 const f=fixture(normal);try{f.s.sync();await idle(f.s);f.s.pause();const before=f.s.status();const auth=f.s.setAuthState('signin');assert.equal(auth.state,'signin');assert.equal(auth.account?.id,session.accountId);assert.equal(auth.indexed,1);assert.equal(auth.lastSyncedAt,before.lastSyncedAt);assert.equal(f.s.sync().accepted,false);await assert.rejects(f.s.search('welcome'));assert.equal(JSON.stringify(auth).includes('SECRET'),false);f.s.setSession(session);assert.equal(f.s.status().state,'paused');assert.equal(f.s.sync(false).accepted,false);f.s.sync();await idle(f.s);f.s.setAuthState('offline');assert.equal(f.s.status().indexed,1);await assert.rejects(f.s.search('welcome'));f.s.setSession(session);assert.equal(f.s.status().state,'idle');assert.equal((await f.s.search('welcome')).sources.length,1);}finally{f.cleanup();}
});
test('expired sessions cannot issue Drive requests and status never serializes tokens',async()=>{
 let requests=0;const f=fixture(u=>{requests++;return normal(u);});try{const status=f.s.setSession({...session,expiresAt:Date.now()-1});assert.equal(status.state,'signin');assert.equal(f.s.sync().accepted,false);assert.equal(requests,0);await assert.rejects(f.s.search('welcome'));assert.equal(requests,0);assert.equal(JSON.stringify(status).includes('accessToken'),false);assert.equal(JSON.stringify(status).includes('SECRET'),false);f.s.setSession(session);f.s.sync();await idle(f.s);assert.equal(f.s.status().indexed,1);}finally{f.cleanup();}
});
test('native auth invalidation aborts delayed search and preserves index for renewed credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'drive-auth-cancel-'));let release:((v:number[][])=>void)|undefined;let searchDelay=false;const s=new DriveService(dir,{fetchImpl:async input=>normal(new URL(String(input))),embeddingProvider:{id:'ollama',embed:async(_m,inputs)=>{if(searchDelay&&inputs[0].startsWith('search_query'))return new Promise(r=>{release=r;});return inputs.map(()=>[1,0,0]);}}});try{s.setSession(session);s.sync();await idle(s);searchDelay=true;const pending=s.search('welcome');for(let n=0;n<100&&!release;n++)await new Promise(r=>setTimeout(r,2));assert.ok(release);s.setAuthState('signin');release!([[1,0,0]]);await assert.rejects(pending,/cancelled/);assert.equal(s.status().indexed,1);assert.equal(s.status().state,'signin');s.setSession(session);searchDelay=false;assert.equal((await s.search('welcome')).sources.length,1);}finally{s.shutdown();rmSync(dir,{recursive:true,force:true});}
});

test('metadata format changes skip newly unsupported files rather than attempting extraction',async()=>{let unsupported=false;let mediaCalls=0;const f=fixture(u=>{if(u.pathname.endsWith('/doc')&&u.searchParams.get('alt')!=='media'&&unsupported)return Response.json({...doc,version:'2',mimeType:'image/png'});if(u.searchParams.get('alt')==='media')mediaCalls++;return normal(u);});try{unsupported=true;f.s.sync();await idle(f.s);assert.equal(f.s.status().skipped,1);assert.equal(f.s.status().failed,0);assert.equal(mediaCalls,0);}finally{f.cleanup();}
});

test('download network loss suspends remaining backlog with offline state and never records success',async()=>{let network=true;const f=fixture(u=>{if(network&&u.searchParams.get('alt')==='media')throw Error('offline');return normal(u);});try{f.s.sync();await idle(f.s);assert.equal(f.s.status().state,'offline');assert.equal(f.s.status().remaining,1);assert.equal(f.s.status().lastSyncedAt,undefined);network=false;f.s.setSession(session);f.s.sync();await idle(f.s);assert.equal(f.s.status().indexed,1);}finally{f.cleanup();}
});

test('shared-only changes reconcile every sync and membership drive events without fileId rediscover and remove sources',async()=>{let member=false,event=false,version='1';const f=fixture(u=>{if(u.pathname.endsWith('/drives'))return Response.json({drives:member?[{id:'shared'}]:[]});if(u.pathname.endsWith('/files'))return Response.json({files:member&&u.searchParams.get('corpora')==='drive'?[{...doc,version}]:[]});if(u.pathname.endsWith('/changes')){const changes=event?[{changeType:'drive',driveId:'shared',removed:!member}]:[];event=false;return Response.json({changes,newStartPageToken:'next'});}if(u.pathname.endsWith('/doc')&&u.searchParams.get('alt')!=='media')return Response.json({...doc,version});if(u.searchParams.get('alt')==='media')return new Response('Welcome onboarding version '+version);return normal(u);});try{f.s.sync();await idle(f.s);assert.equal(f.s.status().indexed,0);member=true;event=true;f.s.sync();await idle(f.s);assert.equal(f.s.status().indexed,1);assert.match((await f.s.search('welcome')).sources[0].text,/version 1/);version='2';f.s.sync();await idle(f.s);assert.match((await f.s.search('welcome')).sources[0].text,/version 2/);member=false;event=true;f.s.sync();await idle(f.s);assert.equal(f.s.status().indexed,0);assert.throws(()=>f.s.source('doc'));}finally{f.cleanup();}
});
test('malformed missing metadata IDs fail closed without cursor advance or phantom catalog files',async()=>{const f=fixture(u=>u.pathname.endsWith('/files')?Response.json({files:[{name:'No ID',mimeType:'text/plain'}]}):normal(u));try{f.s.sync();await idle(f.s);assert.equal(f.s.status().state,'error');assert.equal(f.s.status().discovered,0);assert.match(f.s.status().error!,/identity/);}finally{f.cleanup();}
});

test('local model digest swap during embedding cannot publish wrong-space vectors; unchanged documents rebuild',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'drive-digest-'));let space='digest-old',swap=true,calls=0;const s=new DriveService(dir,{fetchImpl:async input=>normal(new URL(String(input))),embeddingSpace:async()=>space,embeddingProvider:{id:'ollama',embed:async(_m,inputs)=>{calls++;if(swap&&inputs[0].startsWith('search_document')){space='digest-new';swap=false;}return inputs.map(()=>[1,0,0]);}}});try{s.setSession(session);s.sync();await idle(s);assert.equal(s.status().indexed,0);assert.equal(s.status().passages,0);s.sync();await idle(s);assert.equal(s.status().indexed,1);space='digest-next';const before=await s.search('unrelated paraphrase');assert.equal(before.mode,'keyword');assert.match(before.warnings.join(' '),/sync|keyword/);s.sync();await idle(s);assert.equal(s.status().indexed,1);assert.ok(calls>=3);assert.equal((await s.search('welcome')).mode,'hybrid');}finally{s.shutdown();rmSync(dir,{recursive:true,force:true});}
});
test('late native refresh failure cannot change a disconnected service state',()=>{const f=fixture(normal);try{f.s.disconnect();assert.equal(f.s.setAuthState('signin').state,'disconnected');assert.equal(f.s.setAuthState('offline').state,'disconnected');}finally{f.cleanup();}});

test('coverage warnings remain visible in status and retrieval without duplicate text',async()=>{const f=fixture(normal);try{f.s.sync();await idle(f.s);const warnings=f.s.status().warnings;assert.ok(warnings.some(w=>/Word.*headers.*footers.*footnotes/.test(w)));assert.ok(warnings.some(w=>/Google Slides.*slide boundaries.*speaker notes/.test(w)));assert.ok(warnings.some(w=>/PDF.*compressed.*encrypted.*scans/.test(w)));const bundle=await f.s.search('welcome');for(const warning of warnings)assert.ok(bundle.warnings.includes(warning));assert.equal(new Set(bundle.warnings).size,bundle.warnings.length);}finally{f.cleanup();}});
test('untrusted API error reasons cannot echo private contents into status or catalog',async()=>{let reason:unknown='PRIVATE CONTENT\nwith spaces';const f=fixture(u=>u.searchParams.get('alt')==='media'?Response.json({error:{errors:[{reason}]}},{status:500}):normal(u));try{for(const candidate of [reason,{private:'SECRET'},'x'.repeat(81)]){reason=candidate;f.s.sync();await idle(f.s);assert.match(f.s.files()[0].reason!,/requestRejected/);assert.doesNotMatch(JSON.stringify({status:f.s.status(),files:f.s.files()}),/PRIVATE CONTENT|SECRET/);}}finally{f.cleanup();}});
