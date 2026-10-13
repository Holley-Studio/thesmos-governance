import { useEffect, useRef, useState } from 'react';
import type { RagBundle, RagStatus } from '../../shared/rag';
import { KnowledgeSources, knowledgeStatusLabel } from './KnowledgeSources';
import type { KnowledgeView } from '../../shared/studio';
import { runtime } from '../ipc/runtime';
import { Badge, Panel } from './StudioDialogs';

export function KnowledgeDesk({ projectId, onAsk }: { projectId: string; onAsk?: (question?: string) => void }) {
  const [view, setView] = useState<KnowledgeView>();
  const [query, setQuery] = useState(''); const [error, setError] = useState('');
  const [results, setResults] = useState<RagBundle>(); const [status, setStatus] = useState<RagStatus>(); const [working, setWorking] = useState(false); const alive = useRef(true); const request = useRef(0);
  const [notice, setNotice] = useState('');
  const refresh = async (q = '') => { const id = ++request.current; try { const [result, bundle] = await Promise.all([runtime.knowledge(projectId, q), q.trim() ? runtime.ragSearch(projectId, q.trim()) : Promise.resolve(undefined)]); if (alive.current && request.current === id) { setView(result); setResults(bundle); setError(''); } } catch (e) { if (alive.current && request.current === id) setError(String(e)); } };
  const updateIndex = async (cancel: boolean) => { if (working) return; setWorking(true); setError(''); try { const result = cancel ? await runtime.ragCancel(projectId) : (await runtime.ragRebuild(projectId)).status; if (alive.current) setStatus(result); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not update the local index.'); } finally { if (alive.current) setWorking(false); } };
  useEffect(() => { alive.current = true; setView(undefined); setResults(undefined); setStatus(undefined); setQuery(''); void refresh(); let fetching = false; const poll = () => { if (fetching) return; fetching = true; void runtime.ragStatus(projectId).then(result => { if (alive.current) setStatus(result); }).catch(e => { if (alive.current) setError(e instanceof Error ? e.message : 'Could not check local sources.'); }).finally(() => { fetching = false; }); }; poll(); const timer = setInterval(poll, 1500); return () => { alive.current = false; ++request.current; clearInterval(timer); }; }, [projectId]);
  const tasks = view?.tasks.filter(t => `${t.id} ${t.title} ${t.owner} ${t.status}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setNotice('Copied. Review the source and select the worker before starting a job.'); } catch { setError('Clipboard unavailable. Select and copy the visible text.'); } };
  return <>
    <section className="p-knowledge-intro"><span className="p-eyebrow">LOCAL PROJECT KNOWLEDGE</span><h2>Ask your sources.</h2><p>Find a decision, connect an idea, or ask about the next step. Answers draw on approved snapshots in this project and show the passages used.</p><button className="p-button p-primary" type="button" disabled={!status?.supported} onClick={() => onAsk?.(query.trim() || undefined)}>Ask your sources</button><div className="p-knowledge-index"><strong role="status">{knowledgeStatusLabel(status)}</strong><p>{status?.documents ?? 0} approved documents · {status?.passages ?? 0} searchable passages{status?.lastSyncedAt ? ` · snapshot ${new Date(status.lastSyncedAt).toLocaleString()}` : ''}</p>{status?.state === 'building' ? <><progress aria-label="Local index build progress" value={status.completed} max={Math.max(1,status.total)}/><p>{status.completed} of {status.total} passages prepared</p><button className="p-button" type="button" disabled={working} onClick={() => void updateIndex(true)}>Cancel build</button></> : <button className="p-button" type="button" disabled={working || !status?.supported} onClick={() => void updateIndex(false)}>{status?.state === 'empty' ? 'Build local index' : 'Rebuild local index'}</button>}{status?.error && <p role="alert">{status.error}</p>}{status?.warnings.map((warning,i) => <p key={i} className="p-knowledge-warning">{warning}</p>)}</div></section>
    <Panel title="Drive context · local snapshot">
      {error && <p role="alert">{error}</p>}
      {!view?.connected ? <p>Your curated knowledge folder has not been refreshed yet.</p> : <>
        <div className="p-section-heading"><p>{view.scope.toUpperCase()} · {view.documents} registered documents · refreshed {view.lastSyncedAt ? new Date(view.lastSyncedAt).toLocaleString() : 'Unknown'}</p><Badge state={view.stale ? 'unverified' : 'ready'}>{view.stale ? 'Refresh needed' : 'Recent snapshot'}</Badge></div>
        <p>{view.bridge} Google Drive remains the business task ledger. This is a dated local copy, refreshed through the Codex bridge on this PC. Pantheon does not check Drive live. Private context is approved for local Ollama only.</p>
        <p className="p-path">{view.root}</p>
        <div className="search-row"><input className="search-input" aria-label="Search registered knowledge and tasks" placeholder="Find a task or source, such as C14 or homepage…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void refresh(query); }}/><button className="p-button" type="button" onClick={() => void refresh(query)}>Search local sources</button></div>
        {view.warnings.map(w => <p key={w} role="status">{w}</p>)}
        {results && <KnowledgeSources projectId={projectId} bundle={results} heading="Source search results"/>}
        {!results && view.hits.map(h => <article className="memory" key={h.id}><h3>{h.title}</h3><p style={{whiteSpace:'pre-wrap'}}>{h.text}</p><p className="p-muted">{h.status} · snapshot {h.syncedAt.slice(0,10)} · {h.path}</p><p className="p-path">{h.sourceUrl}</p><button className="p-text-button" type="button" onClick={() => void copy(`[${h.id}] ${h.title}\n${h.text}\nSource: ${h.sourceUrl}\nSnapshot: ${h.syncedAt}\nLocal Ollama only; this is a dated source snapshot.`)}>Copy source passage</button></article>)}
        {query && !results && !view.hits.length && <p>No source passages found. A missing fact stays unknown.</p>}
      </>}
    </Panel>
    {view?.connected && <Panel title="Canonical tasks · Metis">
      <p>{view.taskSourceUrl}</p><p>Task status comes from Drive. A Pantheon draft does not close a task or approve a live change.</p>
      <div className="p-job-list">{tasks.slice(0,45).map(t => <article className="memory" key={t.id}><h3>{t.id} · {t.title}</h3><p>{t.owner} · {t.status} · {t.due}</p><p>{t.nextStep}</p><button className="p-text-button" type="button" onClick={() => void copy(`Canonical task: ${t.id}\nTask ledger: ${view.taskSourceUrl}\nOwner: ${t.owner}\nRecorded status: ${t.status}\nNext step: ${t.nextStep}\nPrepare an internal review draft only. Unknowns remain unknown; do not claim approval or completion.`)}>Copy task brief</button></article>)}</div>
      {notice && <p role="status">{notice}</p>}
    </Panel>}
  </>;
}
