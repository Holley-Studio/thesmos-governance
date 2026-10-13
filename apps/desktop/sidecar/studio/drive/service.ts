import { ollamaOrigin, ollamaUrl, ollamaPolicy } from '../ollama-endpoint.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DriveRemoteFile, DriveStatus, DriveFileView } from '../../../shared/drive.js';
import type { RagBundle, KnowledgeCitation } from '../../../shared/rag.js';
import type { EmbeddingProvider } from '../../../../../thesmos/runtime/types.js';
import { OllamaProvider } from '../../../../../thesmos/runtime/providers/ollama/provider.js';
import { cosineSimilarity } from '../../../../../thesmos/memory/retrieve.js';
import { knowledgeTerms } from '../knowledge.js';
import { isLocalEmbeddingModel } from '../rag.js';
import { extractDriveFile } from './extract.js';
export interface DriveSession {
    accountId: string;
    email: string;
    accessToken: string;
    expiresAt: number;
}
export interface DriveOptions {
    /** Isolated fixture injection only. Never exposed through runtime RPC. */
    fetchImpl?: typeof fetch;
    embeddingProvider?: EmbeddingProvider;
    embeddingSpace?:(signal:AbortSignal)=>Promise<string>;
    delay?: (ms: number, signal: AbortSignal) => Promise<void>;
    onInvalidate?: () => void;
}
type FileRow = {
    id: string;
    meta: string;
    status: DriveFileView['status'];
    reason: string | null;
    synced: string | null;
    seen: string | null;
    stamp: string;
    url: string;
};
type AccountRow = {
    cursor: string | null;
    scan: string | null;
    page: string | null;
    scopes: string | null;
    scope_index: number;
    paused: number;
    synced: string | null;
};
type PassageRow = {
    id: string;
    file: string;
    title: string;
    section: string;
    text: string;
    hash: string;
    synced: string;
    vector: string | null;
    space: string | null;
    dimensions: number;
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
const stamp = (m: DriveRemoteFile) => JSON.stringify([m.version ?? '', m.modifiedTime ?? '', m.mimeType ?? '', m.capabilities?.canDownload ?? true, m.trashed ?? false, m.shortcutDetails ?? null]);
const vectorOK = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.length <= 8192 && v.every(x => typeof x === 'number' && Number.isFinite(x)) && v.some(x => x !== 0);
const supported = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation']);
const fields = 'id,name,mimeType,modifiedTime,version,size,trashed,parents,webViewLink,capabilities(canDownload),shortcutDetails';
const coverageWarnings = [
    'Word extraction covers the main body; headers, footers, and footnotes may be omitted.',
    'Google Slides plain text exports may omit slide boundaries and speaker notes.',
    'PDF files with unusual compressed content, encrypted content, or scans may be unsupported; each affected file shows its reason.'
];
function sourceURL(m: DriveRemoteFile) { if (!safeId(m.id))
    throw Error('Invalid Drive file identity'); const native = m.mimeType === 'application/vnd.google-apps.document' ? 'document' : m.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'spreadsheets' : m.mimeType === 'application/vnd.google-apps.presentation' ? 'presentation' : null; return native ? `https://docs.google.com/${native}/d/${m.id}/edit` : `https://drive.google.com/file/d/${m.id}/view`; }
class ApiError extends Error {
    constructor(public code: number, public reason: string) { super(code === 401 ? 'Google sign-in needed' : code === 403 ? 'Drive access denied: ' + reason : code === 404 ? 'Drive source unavailable' : code === 410 ? 'Drive cursor expired' : 'Drive request failed (' + code + '): ' + reason); }
}
export class DriveService {
    private db: DatabaseSync;
    private session?: DriveSession;
    private generation = 0;
    private stopped = false;
    private controller?: AbortController;
    private searches = new Set<AbortController>();
    private state: DriveStatus['state'] = 'disconnected';
    private error?: string;
    private warnings: string[] = [];
    private provider: EmbeddingProvider;
    private closing = false;
    constructor(dataDir: string, private options: DriveOptions = {}) {
        mkdirSync(dataDir, { recursive: true });
        this.db = new DatabaseSync(join(dataDir, 'drive.sqlite'));
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,cursor TEXT,scan TEXT,page TEXT,scopes TEXT,scope_index INTEGER NOT NULL DEFAULT 0,paused INTEGER NOT NULL DEFAULT 0,synced TEXT);
 CREATE TABLE IF NOT EXISTS shared_state(account TEXT PRIMARY KEY,drives TEXT NOT NULL,reconcile INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS files(account TEXT,id TEXT,meta TEXT NOT NULL,status TEXT NOT NULL,reason TEXT,synced TEXT,seen TEXT,stamp TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(account,id));
 CREATE TABLE IF NOT EXISTS jobs(account TEXT,file TEXT,attempts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,file));
 CREATE TABLE IF NOT EXISTS passages(account TEXT,id TEXT,file TEXT,title TEXT,section TEXT,text TEXT,hash TEXT,synced TEXT,vector TEXT,space TEXT,dimensions INTEGER,PRIMARY KEY(account,id));
 CREATE VIRTUAL TABLE IF NOT EXISTS lexical USING fts5(account UNINDEXED,id UNINDEXED,title,section,text);
 CREATE TABLE IF NOT EXISTS vectors(account TEXT,hash TEXT,space TEXT,dimensions INTEGER,vector TEXT,PRIMARY KEY(account,hash,space)); CREATE TABLE IF NOT EXISTS model_spaces(account TEXT,space TEXT,dimensions INTEGER,PRIMARY KEY(account,space)); CREATE INDEX IF NOT EXISTS passage_file ON passages(account,file);`);
        this.provider = options.embeddingProvider ?? new OllamaProvider({ baseUrl: ollamaOrigin(), policy: ollamaPolicy(), fetchImpl: (input, init) => this.local(input, init) });
        if (this.provider.id !== 'ollama')
            throw Error('Drive embeddings require local Ollama');
    }
    private account() { if (this.stopped || !this.session)
        throw Error('Connect Google Drive first'); return this.session.accountId; }
    private a(): AccountRow { return this.db.prepare('SELECT * FROM accounts WHERE id=?').get(this.account()) as unknown as AccountRow; }
    private tx(fn: () => void) { this.db.exec('BEGIN IMMEDIATE'); try {
        fn();
        this.db.exec('COMMIT');
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
    } }
    private invalidate() { this.options.onInvalidate?.(); for (const c of this.searches)
        c.abort(); }
    private cancel() { this.generation++; this.controller?.abort(); this.controller = undefined; this.invalidate(); }
    setSession(s: DriveSession): DriveStatus { if (this.stopped)
        throw Error('Drive service stopped'); if (!safeId(s.accountId) || !s.email || !s.accessToken || !Number.isFinite(s.expiresAt))
        throw Error('Invalid Google session'); if (this.session?.accountId === s.accountId) {
        this.session = { ...s };
        if (this.state === 'signin' || this.state === 'offline')
            this.state = this.a().paused ? 'paused' : 'idle';
        return this.status();
    } this.cancel(); this.session = { ...s }; this.db.prepare('INSERT OR IGNORE INTO accounts(id) VALUES(?)').run(s.accountId); this.state = this.a().paused ? 'paused' : 'idle'; this.error = undefined; this.warnings = []; return this.status(); }
    disconnect(): DriveStatus { this.cancel(); this.session = undefined; this.state = 'disconnected'; this.error = undefined; this.warnings = []; return this.status(); }
    /** Native refresh failures revoke current retrieval without discarding historical catalog coverage. */
    setAuthState(state: 'signin' | 'offline'): DriveStatus {
        if (state !== 'signin' && state !== 'offline') throw Error('Invalid Drive authentication state');
        if (this.stopped) throw Error('Drive service stopped');
        if(!this.session) return this.status();
        this.cancel();
        this.state = state;
        this.error = state === 'signin' ? 'Google sign-in needed' : 'Drive is offline; current permissions cannot be verified';
        if (state === 'signin' && this.session) this.session = {...this.session, accessToken: '', expiresAt: 0};
        return this.status();
    }
    status(): DriveStatus { if (this.session && !this.stopped && this.session.expiresAt <= Date.now() && this.state !== 'signin') return this.setAuthState('signin'); const empty = { state: this.state, discovered: 0, indexed: 0, passages: 0, skipped: 0, failed: 0, remaining: 0, warnings: [...new Set([...coverageWarnings,...this.warnings])], error: this.error }; if (!this.session || this.stopped)
        return empty; const id = this.account(); const rows = this.db.prepare('SELECT status,count(*) n FROM files WHERE account=? GROUP BY status').all(id) as unknown as {
        status: string;
        n: number;
    }[]; const counts = Object.fromEntries(rows.map(r => [r.status, r.n])); const a = this.a(); return { ...empty, account: { id, email: this.session.email }, discovered: rows.filter(r => r.status !== 'removed').reduce((n, r) => n + r.n, 0), indexed: counts.indexed ?? 0, skipped: counts.skipped ?? 0, failed: counts.failed ?? 0, remaining: Number((this.db.prepare('SELECT count(*) n FROM jobs WHERE account=?').get(id) as {
            n: number;
        }).n), passages: Number((this.db.prepare('SELECT count(*) n FROM passages WHERE account=?').get(id) as {
            n: number;
        }).n), lastSyncedAt: a.synced ?? undefined, nextSyncAt: a.synced && !a.paused ? new Date(Date.parse(a.synced) + 300000).toISOString() : undefined }; }
    files(limit = 100, offset = 0, query = ''): DriveFileView[] { const id = this.account(); if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0 || typeof query !== 'string' || query.length > 1000)
        throw Error('Invalid Drive catalog request'); return (this.db.prepare('SELECT * FROM files WHERE account=? AND meta LIKE ? ORDER BY id LIMIT ? OFFSET ?').all(id, '%' + query + '%', limit, offset) as unknown as FileRow[]).map(r => { const m = JSON.parse(r.meta) as DriveRemoteFile; return { id: r.id, title: m.name ?? r.id, mimeType: m.mimeType ?? '', status: r.status, reason: r.reason ?? undefined, modifiedTime: m.modifiedTime, syncedAt: r.synced ?? undefined, url: r.url }; }); }
    pause(): DriveStatus { const id = this.account(); this.db.prepare('UPDATE accounts SET paused=1 WHERE id=?').run(id); this.cancel(); this.state = 'paused'; return this.status(); }
    sync(force = true): {
        accepted: boolean;
        status: DriveStatus;
    } { this.account(); if (!this.session!.accessToken || this.session!.expiresAt <= Date.now()) return {accepted:false,status:this.setAuthState('signin')}; if (this.controller || (!force && this.a().paused))
        return { accepted: false, status: this.status() }; if (force)
        this.db.prepare('UPDATE accounts SET paused=0 WHERE id=?').run(this.account()); const c = new AbortController(); this.controller = c; const gen = this.generation; this.state = 'syncing'; this.error = undefined; void this.run(c, gen); return { accepted: true, status: this.status() }; }
    private check(signal: AbortSignal, gen: number) { if (signal.aborted || gen !== this.generation || this.stopped || !this.session)
        throw Error('Drive operation cancelled'); }
    private async wait(ms: number, signal: AbortSignal) { if (this.options.delay)
        return this.options.delay(ms, signal); await new Promise<void>((resolve, reject) => { const done = () => { signal.removeEventListener('abort', abort); resolve(); }; const timer = setTimeout(done, ms); const abort = () => { clearTimeout(timer); reject(Error('Drive operation cancelled')); }; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted)
        abort(); }); }
    private async request(path: string, params: Record<string, string>, signal: AbortSignal, gen: number, bytes = false): Promise<any> { const url = new URL('https://www.googleapis.com/drive/v3/' + path); for (const [k, v] of Object.entries(params))
        url.searchParams.set(k, v); for (let attempt = 0;; attempt++) {
        this.check(signal, gen);
        if (this.session!.expiresAt <= Date.now())
            throw new ApiError(401, 'expired');
        let res: Response;
        try {
            res = await (this.options.fetchImpl ?? fetch)(url.href, { headers: { Authorization: 'Bearer ' + this.session!.accessToken }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
        }
        catch (e) {
            this.check(signal, gen);
            if (attempt < 2) {
                await this.wait(250 * 2 ** attempt, signal);
                continue;
            }
            throw Error('Drive is offline');
        }
        this.check(signal, gen);
        if (!res.ok) {
            let reason = 'requestRejected';
            try {
                const body = await res.json() as {
                    error?: {
                        errors?: {
                            reason?: string;
                        }[];
                    };
                };
                const supplied = body.error?.errors?.[0]?.reason;
                reason = typeof supplied === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(supplied) ? supplied : 'requestRejected';
            }
            catch { reason = 'requestRejected'; }
            const retry = res.status === 429 || res.status >= 500 || (res.status === 403 && ['rateLimitExceeded', 'userRateLimitExceeded', 'backendError'].includes(reason));
            if (retry && attempt < 2) {
                await this.wait(Math.min(10000, Number(res.headers.get('retry-after') ?? 0) * 1000 || 250 * 2 ** attempt), signal);
                continue;
            }
            throw new ApiError(res.status, reason);
        }
        if (!bytes) {
            const data = await res.json();
            this.check(signal, gen);
            return data;
        }
        const maximum = 20 * 1024 * 1024;
        if (Number(res.headers.get('content-length') ?? 0) > maximum)
            throw Error('File exceeds local 20 MB download limit');
        if (!res.body)
            throw Error('Empty Drive download');
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
            for (;;) {
                const r = await reader.read();
                this.check(signal, gen);
                if (r.done)
                    break;
                length += r.value.length;
                if (length > maximum)
                    throw Error('File exceeds local 20 MB download limit');
                chunks.push(r.value);
            }
        }
        finally {
            await reader.cancel();
        }
        const data = new Uint8Array(length);
        let pos = 0;
        for (const chunk of chunks) {
            data.set(chunk, pos);
            pos += chunk.length;
        }
        return data;
    } }
    private erase(id: string) { const a = this.account(); this.db.prepare('DELETE FROM lexical WHERE account=? AND id IN (SELECT id FROM passages WHERE account=? AND file=?)').run(a, a, id); this.db.prepare('DELETE FROM passages WHERE account=? AND file=?').run(a, id); }
    private remove(id: string) { this.invalidate(); this.erase(id); this.db.prepare("UPDATE files SET status='removed',reason='Removed or access revoked',synced=NULL WHERE account=? AND id=?").run(this.account(), id); this.db.prepare('DELETE FROM jobs WHERE account=? AND file=?').run(this.account(), id); }
    private record(m: DriveRemoteFile, seen?: string) { if (!safeId(m.id))
        throw Error('Drive returned invalid identity'); if (m.trashed) {
        this.remove(m.id);
        return;
    } const a = this.account(); const old = this.db.prepare('SELECT * FROM files WHERE account=? AND id=?').get(a, m.id) as unknown as FileRow | undefined; const changed = !old || old.stamp !== stamp(m) || old.status === 'removed'; let reason: string | undefined; let status: DriveFileView['status'] = changed ? 'queued' : old!.status; if (m.capabilities?.canDownload === false) {
        status = 'skipped';
        reason = 'Download permission unavailable';
    }
    else if (m.mimeType === 'application/vnd.google-apps.shortcut') {
        status = 'skipped';
        reason = 'Shortcut target is cataloged separately';
    }
    else if (!supported.has(m.mimeType ?? '')) {
        status = 'skipped';
        reason = m.mimeType === 'application/vnd.google-apps.folder' ? 'Folder contains no searchable text' : 'Unsupported text format';
    } if (changed || status === 'skipped') {
        this.invalidate();
        this.erase(m.id);
    } this.db.prepare('INSERT INTO files(account,id,meta,status,reason,synced,seen,stamp,url) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET meta=excluded.meta,status=excluded.status,reason=excluded.reason,synced=excluded.synced,seen=COALESCE(excluded.seen,files.seen),stamp=excluded.stamp,url=excluded.url').run(a, m.id, JSON.stringify(m), status, reason ?? (changed ? null : old?.reason ?? null), changed ? null : old?.synced ?? null, seen ?? null, stamp(m), sourceURL(m)); if (changed && status === 'queued')
        this.db.prepare('INSERT INTO jobs(account,file,attempts) VALUES(?,?,0) ON CONFLICT(account,file) DO UPDATE SET attempts=0').run(a, m.id); if (status === 'skipped')
        this.db.prepare('DELETE FROM jobs WHERE account=? AND file=?').run(a, m.id); }
    private async beginScan(signal: AbortSignal, gen: number) { const start = await this.request('changes/startPageToken', { supportsAllDrives: 'true' }, signal, gen); if (typeof start.startPageToken !== 'string' || !start.startPageToken)
        throw Error('Invalid Drive change cursor'); const drives: string[] = []; let page: string | undefined; do {
        const data = await this.request('drives', { pageSize: '100', fields: 'nextPageToken,drives(id)', ...(page ? { pageToken: page } : {}) }, signal, gen);
        if (!Array.isArray(data.drives))
            throw Error('Invalid shared Drive inventory');
        for (const d of data.drives) {
            if (!safeId(d.id))
                throw Error('Invalid shared Drive identity');
            drives.push(d.id);
        }
        page = data.nextPageToken;
    } while (page); this.check(signal, gen); this.tx(()=>{this.db.prepare('UPDATE accounts SET cursor=?,scan=?,page=NULL,scopes=?,scope_index=0 WHERE id=?').run(start.startPageToken, randomUUID(), JSON.stringify(['user', ...drives]), this.account());this.db.prepare('INSERT INTO shared_state(account,drives,reconcile) VALUES(?,?,0) ON CONFLICT(account) DO UPDATE SET drives=excluded.drives,reconcile=0').run(this.account(),JSON.stringify(drives));});if(drives.length&&!this.warnings.includes('Shared drives use a complete metadata reconciliation on each sync.'))this.warnings.push('Shared drives use a complete metadata reconciliation on each sync.'); }
    private async scan(signal: AbortSignal, gen: number) { while (this.a().scan) {
        const a = this.a();
        const scopes = JSON.parse(a.scopes!) as string[];
        const scope = scopes[a.scope_index];
        const data = await this.request('files', { q: 'trashed = false', pageSize: '1000', fields: `nextPageToken,incompleteSearch,files(${fields})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: scope === 'user' ? 'user' : 'drive', ...(scope === 'user' ? {} : { driveId: scope }), ...(a.page ? { pageToken: a.page } : {}) }, signal, gen);
        if (!Array.isArray(data.files) || data.incompleteSearch)
            throw Error('Drive listing incomplete; reconciliation deferred');
        this.tx(() => { for (const m of data.files)
            this.record(m, a.scan!); if (data.nextPageToken)
            this.db.prepare('UPDATE accounts SET page=? WHERE id=?').run(data.nextPageToken, this.account());
        else if (a.scope_index + 1 < scopes.length)
            this.db.prepare('UPDATE accounts SET page=NULL,scope_index=scope_index+1 WHERE id=?').run(this.account());
        else {
            const unseen = this.db.prepare("SELECT id FROM files WHERE account=? AND status!='removed' AND (seen IS NULL OR seen!=?)").all(this.account(), a.scan!) as {
                id: string;
            }[];
            for (const r of unseen)
                this.remove(r.id);
            this.db.prepare('UPDATE accounts SET scan=NULL,page=NULL,scopes=NULL,scope_index=0 WHERE id=?').run(this.account());
        } });
    } }
    private async changes(signal: AbortSignal, gen: number) { for (;;) {
        const a = this.a();
        const data = await this.request('changes', { pageToken: a.cursor!, pageSize: '1000', fields: `nextPageToken,newStartPageToken,changes(changeType,driveId,fileId,removed,file(${fields}))`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }, signal, gen);
        if (!Array.isArray(data.changes) || (!data.nextPageToken && !data.newStartPageToken))
            throw Error('Invalid Drive change page');
        let reconcile=false;
        this.tx(() => { for (const c of data.changes) {
            if(c.changeType==='drive'){if(!safeId(c.driveId))throw Error('Invalid changed shared Drive identity');reconcile=true;continue;}
            if (!safeId(c.fileId))
                throw Error('Invalid changed file identity');
            if (c.removed || !c.file)
                this.remove(c.fileId);
            else {
                if (c.file.id !== c.fileId)
                    throw Error('Changed file identity mismatch');
                this.record(c.file);
            }
        } this.db.prepare('UPDATE accounts SET cursor=? WHERE id=?').run(data.nextPageToken ?? data.newStartPageToken, this.account());if(reconcile)this.db.prepare('INSERT INTO shared_state(account,drives,reconcile) VALUES(?,\'[]\',1) ON CONFLICT(account) DO UPDATE SET reconcile=1').run(this.account()); });
        if(reconcile){await this.beginScan(signal,gen);await this.scan(signal,gen);continue;}
        if (!data.nextPageToken)
            return;
    } }
    private async resolveShortcuts(signal: AbortSignal, gen: number) { const all = this.db.prepare("SELECT meta FROM files WHERE account=? AND status='skipped'").all(this.account()) as {
        meta: string;
    }[]; for (const row of all) {
        let m = JSON.parse(row.meta) as DriveRemoteFile;
        if (m.mimeType !== 'application/vnd.google-apps.shortcut')
            continue;
        const visited = new Set([m.id]);
        try {
            while (m.shortcutDetails?.targetId) {
                const id = m.shortcutDetails.targetId;
                if (!safeId(id) || visited.has(id) || visited.size > 16)
                    throw Error('Shortcut target cycle or depth limit');
                visited.add(id);
                m = await this.request('files/' + id, { fields, supportsAllDrives: 'true' }, signal, gen);
            }
            this.tx(() => this.record(m));
        }
        catch (e) {
            this.check(signal, gen);
            if (e instanceof ApiError && e.code === 401)
                throw e;
            if(e instanceof Error && e.message.includes('offline'))throw e;this.db.prepare('UPDATE files SET reason=? WHERE account=? AND id=?').run(e instanceof Error ? e.message : 'Shortcut target unavailable', this.account(), JSON.parse(row.meta).id);
        }
    } }
    private async local(input: RequestInfo | URL, init?: RequestInit) { const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); if (url.origin !== ollamaOrigin() || url.username || url.password)
        throw Error('Private embeddings require local Ollama'); return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30000)]) }); }
    private async space(signal: AbortSignal) { if (this.options.embeddingProvider)
        return this.options.embeddingSpace?this.options.embeddingSpace(signal):'fixture:nomic-embed-text'; const tags = await this.local(ollamaUrl('/api/tags'), { signal }); if (!tags.ok)
        throw Error('Local embedding model unavailable'); const data = await tags.json() as {
        models?: {
            name: string;
            digest: string;
            remote_model?: string;
            remote_host?: string;
        }[];
    }; const tag = data.models?.find(m => m.name === 'nomic-embed-text:latest'); if (!tag || tag.remote_host || tag.remote_model || !tag.digest)
        throw Error('Install local nomic-embed-text'); const show = await this.local(ollamaUrl('/api/show'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'nomic-embed-text:latest' }), signal }); if (!show.ok || !isLocalEmbeddingModel(await show.json()))
        throw Error('Remote embedding models are forbidden'); return 'nomic-embed-text:latest:' + tag.digest; }
    private async jobs(signal: AbortSignal, gen: number) { let space: string | undefined; try {
        space = await this.space(signal);
    }
    catch (e) {
        this.check(signal, gen);
        if(!this.warnings.includes('Semantic search unavailable; keyword search remains available.'))this.warnings.push('Semantic search unavailable; keyword search remains available.');
    } if(space){const stale=this.db.prepare("SELECT DISTINCT f.id FROM files f JOIN passages p ON p.account=f.account AND p.file=f.id WHERE f.account=? AND f.status='indexed' AND (p.space IS NULL OR p.space!=?)").all(this.account(),space) as {id:string}[];if(stale.length)this.tx(()=>{this.invalidate();for(const r of stale){this.erase(r.id);this.db.prepare("UPDATE files SET status='queued',reason='Embedding model changed; rebuilding',synced=NULL WHERE account=? AND id=?").run(this.account(),r.id);this.db.prepare('INSERT OR IGNORE INTO jobs(account,file) VALUES(?,?)').run(this.account(),r.id);}});} const jobs = this.db.prepare('SELECT file FROM jobs WHERE account=? ORDER BY file').all(this.account()) as {
        file: string;
    }[]; for (const job of jobs) {
        this.check(signal, gen);
        let row = this.db.prepare('SELECT * FROM files WHERE account=? AND id=?').get(this.account(), job.file) as unknown as FileRow;
        if (!row)
            continue;
        try {
            let m = JSON.parse(row.meta) as DriveRemoteFile;
            if (Number(m.size ?? 0) > 20 * 1024 * 1024)
                throw Error('File exceeds local 20 MB download limit');
            const current = await this.request('files/' + m.id, { fields, supportsAllDrives: 'true' }, signal, gen) as DriveRemoteFile;
            if (current.id !== m.id)
                throw Error('Drive metadata identity mismatch');
            if (current.trashed || current.capabilities?.canDownload === false) {
                this.tx(() => this.record(current));
                continue;
            }
            if (stamp(current) !== row.stamp) {
                this.tx(() => this.record(current));
                row = this.db.prepare('SELECT * FROM files WHERE account=? AND id=?').get(this.account(), job.file) as unknown as FileRow;
                m = current;
            }
            if (row.status !== 'queued' && row.status !== 'failed') continue;
            const native = m.mimeType?.startsWith('application/vnd.google-apps.');
            const params: Record<string, string> = native ? { mimeType: m.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/plain' } : { alt: 'media', supportsAllDrives: 'true' };
            const bytes = await this.request('files/' + m.id + (native ? '/export' : ''), params, signal, gen, true) as Uint8Array;
            const extracted = await extractDriveFile(m, bytes);
            this.check(signal, gen);
            const parts = extracted.sections?.length ? extracted.sections : [{ title: m.name ?? m.id, text: extracted.text }];
            const passages: {
                title: string;
                text: string;
                vector?: number[];
            }[] = [];
            for (const part of parts) {
                for (let offset = 0; offset < part.text.length; offset += 1800) {
                    const text = part.text.slice(offset, offset + 2000).trim();
                    if (text)
                        passages.push({ title: part.title, text });
                }
            }
            if (!passages.length)
                throw Error('No readable text; scanned or empty document');
            let dimensions = 0;
            if (space) {
                try {
                    for (const p of passages) {
                        const cached = this.db.prepare('SELECT vector,dimensions FROM vectors WHERE account=? AND hash=? AND space=?').get(this.account(), hash(p.text), space) as {
                            vector: string;
                            dimensions: number;
                        } | undefined;
                        const vectors = cached ? [JSON.parse(cached.vector)] : await this.provider.embed('nomic-embed-text:latest', ['search_document: ' + p.text], signal);
                        this.check(signal, gen);
                        if (vectors.length !== 1 || !vectorOK(vectors[0]) || (dimensions && vectors[0].length !== dimensions))
                            throw Error('Embedding model dimensions changed');
                        const modelRow = this.db.prepare('SELECT dimensions FROM model_spaces WHERE account=? AND space=?').get(this.account(), space) as {
                            dimensions: number;
                        } | undefined;
                        if (modelRow && modelRow.dimensions !== vectors[0].length)
                            throw Error('Embedding model dimensions changed');
                        dimensions = vectors[0].length;
                        p.vector = vectors[0];
                        this.db.prepare('INSERT OR IGNORE INTO model_spaces VALUES(?,?,?)').run(this.account(), space, dimensions);
                    }
                }
                catch (e) {
                    this.check(signal, gen);
                    for (const p of passages)
                        delete p.vector;
                    dimensions = 0;
                    if(!this.warnings.includes('Semantic search unavailable; keyword search remains available.'))this.warnings.push('Semantic search unavailable; keyword search remains available.');
                }
            }
            const latest = await this.request('files/' + m.id, { fields, supportsAllDrives: 'true' }, signal, gen) as DriveRemoteFile;
            if (latest.id !== m.id)
                throw Error('Drive metadata identity mismatch');
            if (stamp(latest) !== stamp(m)) {
                this.tx(() => this.record(latest));
                continue;
            }
            this.check(signal, gen);
            if(passages.some(p=>p.vector)&&await this.space(signal)!==space)throw Error('Embedding model changed during indexing; sync to rebuild');
            this.check(signal,gen);
            const synced = new Date().toISOString();
            this.tx(() => { this.erase(m.id); passages.forEach((p, index) => { const id = m.id + ':' + index; if(p.vector)this.db.prepare('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?,?)').run(this.account(),hash(p.text),space!,dimensions,JSON.stringify(p.vector)); this.db.prepare('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(this.account(), id, m.id, m.name ?? m.id, p.title, p.text, hash(extracted.text), synced, p.vector ? JSON.stringify(p.vector) : null, p.vector ? space! : null, p.vector ? dimensions : 0); this.db.prepare('INSERT INTO lexical(account,id,title,section,text) VALUES(?,?,?,?,?)').run(this.account(), id, m.name ?? m.id, p.title, p.text); }); this.db.prepare("UPDATE files SET status='indexed',reason=NULL,synced=? WHERE account=? AND id=?").run(synced, this.account(), m.id); this.db.prepare('DELETE FROM jobs WHERE account=? AND file=?').run(this.account(), m.id); });
        }
        catch (e) {
            this.check(signal, gen);
            if (e instanceof ApiError && e.code === 401)
                throw e;
            if (e instanceof ApiError && (e.code === 404 || (e.code === 403 && ['insufficientFilePermissions', 'forbidden', 'accessDenied', 'notFound'].includes(e.reason)))) {
                this.tx(() => this.remove(job.file));
                continue;
            }
            if(e instanceof Error && e.message.includes('offline')) throw e;
            this.db.prepare("UPDATE files SET status='failed',reason=?,synced=NULL WHERE account=? AND id=?").run(e instanceof Error ? e.message : 'Extraction failed', this.account(), job.file);
            this.db.prepare('UPDATE jobs SET attempts=attempts+1 WHERE account=? AND file=?').run(this.account(), job.file);
        }
    } }
    private async run(c: AbortController, gen: number) { try {
        const shared=this.db.prepare('SELECT drives,reconcile FROM shared_state WHERE account=?').get(this.account()) as {drives:string;reconcile:number}|undefined;
        if(this.a().cursor&&!this.a().scan&&shared&&(shared.reconcile||JSON.parse(shared.drives).length))await this.beginScan(c.signal,gen);
        if (!this.a().cursor)
            await this.beginScan(c.signal, gen);
        if (this.a().scan)
            await this.scan(c.signal, gen);
        try {
            await this.changes(c.signal, gen);
        }
        catch (e) {
            if (e instanceof ApiError && e.code === 410) {
                await this.beginScan(c.signal, gen);
                await this.scan(c.signal, gen);
                await this.changes(c.signal, gen);
            }
            else
                throw e;
        }
        await this.resolveShortcuts(c.signal, gen);
        await this.jobs(c.signal, gen);
        this.check(c.signal, gen);
        const remaining = Number((this.db.prepare('SELECT count(*) n FROM jobs WHERE account=?').get(this.account()) as {
            n: number;
        }).n);
        if (!remaining)
            this.db.prepare('UPDATE accounts SET synced=? WHERE id=?').run(new Date().toISOString(), this.account());
        this.state = remaining ? 'error' : 'idle';
        if (remaining)
            this.error = 'Some files could not be indexed; retry with Sync now.';
    }
    catch (e) {
        if (!c.signal.aborted && gen === this.generation) {
            this.error = e instanceof Error ? e.message : 'Drive sync failed';
            if(e instanceof ApiError && e.code === 401) this.setAuthState('signin');
            else this.state = this.error.includes('offline') ? 'offline' : 'error';
        }
    }
    finally {
        if (this.controller === c)
            this.controller = undefined;
        this.closeIfReady();
    } }
    async search(query: string, signal?: AbortSignal): Promise<RagBundle> { const account = this.account(); if (typeof query !== 'string' || query.length > 8000)
        throw Error('Invalid knowledge question'); if (this.state === 'signin' || this.state === 'offline')
        throw Error('Current Drive permission cannot be verified. Reconnect before asking.'); const c = new AbortController(); this.searches.add(c); const combined = AbortSignal.any([c.signal, ...(signal ? [signal] : [])]); const gen = this.generation; const bundle: RagBundle = { scope: 'drive', libraryId: 'drive:' + account, mode: 'keyword', sources: [], warnings: [...new Set([...coverageWarnings,...this.warnings])], lastSyncedAt: this.a().synced ?? undefined, generation: String(gen), evidenceStatus: 'insufficient' }; try {
        await this.request('changes/startPageToken', { supportsAllDrives: 'true' }, combined, gen);
        this.check(combined, gen);
        const terms = knowledgeTerms(query);
        const matches = terms.map(t => '"' + t.replaceAll('"', '""') + '"').join(' OR ');
        const lexical = matches ? this.db.prepare('SELECT id FROM lexical WHERE lexical MATCH ? AND account=? ORDER BY rank LIMIT 200').all(matches, account) as {
            id: string;
        }[] : [];
        const candidates = new Map<string, PassageRow>();
        for (const r of lexical) {
            const p = this.db.prepare('SELECT * FROM passages WHERE account=? AND id=?').get(account, r.id) as unknown as PassageRow;
            if (p)
                candidates.set(p.id, p);
        }
        let qv: number[] | undefined;
        let modelSpace: string | undefined;
        try {
            modelSpace = await this.space(combined);
            const v = await this.provider.embed('nomic-embed-text:latest', ['search_query: ' + query], combined);
            this.check(combined, gen);
            if (v.length !== 1 || !vectorOK(v[0]))
                throw Error('Invalid query vector');
            qv = v[0];
            const expected = this.db.prepare('SELECT dimensions FROM model_spaces WHERE account=? AND space=?').get(account, modelSpace) as {
                dimensions: number;
            } | undefined;
            if (expected && expected.dimensions !== qv.length)
                throw Error('Embedding dimensions changed; sync to rebuild');
            if(await this.space(combined)!==modelSpace)throw Error('Embedding model changed during search; sync to rebuild');
            this.check(combined,gen);
            const indexedVectors=this.db.prepare('SELECT count(*) n FROM passages WHERE account=? AND space=? AND dimensions=?').get(account,modelSpace,qv.length) as {n:number};
            if(!indexedVectors.n)throw Error('No current model vectors; sync to rebuild');
            const semantic = this.db.prepare('SELECT * FROM passages WHERE account=? AND space=? AND dimensions=?').iterate(account, modelSpace, qv.length);
            for (const raw of semantic) {
                const p = raw as unknown as PassageRow;
                const vec = JSON.parse(p.vector!) as number[];
                if (vectorOK(vec) && cosineSimilarity(qv, vec) >= .72)
                    candidates.set(p.id, p);
            }
            bundle.mode = 'hybrid';
        }
        catch (e) {
            this.check(combined, gen);
            qv=undefined;
            bundle.warnings.push('Using keyword search; local semantic search unavailable.');
        }
        this.check(combined, gen);
        const ranked = [...candidates.values()].map(p => { const bag = knowledgeTerms(p.title + ' ' + p.section + ' ' + p.text); const lexical = terms.length ? terms.filter(t => bag.includes(t)).length / terms.length : 0; const vec = p.vector && p.space === modelSpace ? JSON.parse(p.vector) : null; const semantic = qv && vectorOK(vec) && vec.length === qv.length ? cosineSimilarity(qv, vec) : 0; return { p, score: lexical + Math.max(0, semantic) * .85, eligible: lexical >= .34 || semantic >= .72 }; }).filter(r => r.eligible).sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
        const validated = new Set<string>();
        for (const { p } of ranked) {
            if (bundle.sources.length >= 6)
                break;
            if (!validated.has(p.file)) {
                const row = this.db.prepare("SELECT * FROM files WHERE account=? AND id=? AND status='indexed'").get(account, p.file) as unknown as FileRow | undefined;
                if (!row)
                    continue;
                let current: DriveRemoteFile;
                try {
                    current = await this.request('files/' + p.file, { fields, supportsAllDrives: 'true' }, combined, gen);
                }
                catch (e) {
                    this.check(combined, gen);
                    if (e instanceof ApiError && (e.code === 403 || e.code === 404)) {
                        this.tx(() => this.remove(p.file));
                        throw Error('Drive permissions changed. Ask again.');
                    }
                    throw e;
                }
                if (current.trashed || current.capabilities?.canDownload === false || stamp(current) !== row.stamp) {
                    this.tx(() => this.record(current));
                    throw Error('Drive source changed. Sync and ask again.');
                }
                validated.add(p.file);
            }
            this.check(combined, gen);
            const row = this.db.prepare("SELECT * FROM files WHERE account=? AND id=? AND status='indexed'").get(account, p.file) as unknown as FileRow | undefined;
            if (!row)
                continue;
            const citation: KnowledgeCitation = { id: p.id, sourceId: p.file, citation: bundle.sources.length + 1, title: p.title, path: 'drive/' + p.file, section: p.section, text: p.text, sourceUrl: row.url, documentHash: p.hash, syncedAt: p.synced, status: 'source-snapshot', authority: 0 };
            bundle.sources.push(citation);
        }
        this.check(combined, gen);
        bundle.evidenceStatus = bundle.sources.length ? 'ready' : 'insufficient';
        return bundle;
    }
    catch (e) {
        if (!combined.aborted && gen === this.generation) {
            if (e instanceof ApiError && e.code === 401)
                this.setAuthState('signin');
            else if (e instanceof Error && e.message.includes('offline'))
                this.state = 'offline';
        }
        throw e;
    }
    finally {
        this.searches.delete(c);
        this.closeIfReady();
    } }
    source(sourceId: string): {
        url: string;
    } { if (!safeId(sourceId))
        throw Error('Invalid Drive source'); const row = this.db.prepare("SELECT url FROM files WHERE account=? AND id=? AND status='indexed'").get(this.account(), sourceId) as {
        url: string;
    } | undefined; if (!row)
        throw Error('This Drive source is no longer available'); return { url: row.url }; }
    shutdown(): void { if (this.stopped)
        return; this.stopped = true; this.cancel(); this.session = undefined; this.closing = true; this.closeIfReady(); }
    private closeIfReady() { if (this.closing && !this.controller && this.searches.size === 0) {
        this.closing = false;
        try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort: close regardless */ }
        this.db.close();
    } }
}
