import { useCallback, useEffect, useRef, useState } from 'react';
import type { RagStatus } from '../../shared/rag';
import type { DriveStatus } from '../../shared/drive';
import { KnowledgeSources, knowledgeStatusLabel } from './KnowledgeSources';
import type { JSX } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { runtime, openChatGPT, type PantheonAgentSummary } from '../ipc/runtime';
import { chatHandoff, recentConversation, type CouncilThread, type ChatEngine, type ThreadSummary } from '../../shared/chat';
import type { Connection } from '../../shared/studio';
import { Icon, GodSigil } from '../design/Icon';
import { AppIcon } from '../design/AppIcon';
import { Avatar, Badge, Empty, time } from './StudioDialogs';

const STARTERS = [
 ['Think with Zeus', 'Help me choose the three most valuable priorities for Holley Studio this week. Ask about my current constraints before recommending a plan.'],
 ['Explore with Athena', 'Let’s brainstorm a repeatable service offer for Holley Studio that clients would value. Help me explore the tradeoffs.'],
 ['Gather the council', 'What would Zeus, Athena, and Apollo each consider when planning the next phase of the Otter House Wellness project? Treat our current facts as unknown until I supply them.'],
];
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The conversation could not be updated';

export function CouncilChat({ projectId, agents, connections, workBusy, initialKnowledge = false, initialQuestion = '', initialKnowledgeLibrary = 'project' }: { projectId: string; agents: PantheonAgentSummary[]; connections: Connection[]; workBusy: boolean; initialKnowledge?: boolean; initialQuestion?: string; initialKnowledgeLibrary?: 'project'|'drive' }): JSX.Element {
 const [threads, setThreads] = useState<ThreadSummary[]>([]); const [thread, setThread] = useState<CouncilThread>();
 const [god, setGod] = useState('Council'); const [engine, setEngine] = useState<ChatEngine>('ollama');
 const [draft, setDraft] = useState(initialQuestion);
 const [useKnowledge, setUseKnowledge] = useState(initialKnowledge); const [ragStatus, setRagStatus] = useState<RagStatus>(); const [cloudConsent, setCloudConsent] = useState(false);
 const [knowledgeLibrary, setKnowledgeLibrary] = useState<'project'|'drive'>(initialKnowledgeLibrary);
 const [driveStatus, setDriveStatus] = useState<DriveStatus>(); const driveAccount = useRef<string|undefined>(undefined);
 const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
 const [handoff, setHandoff] = useState<'chat' | 'work'>(); const [deleting, setDeleting] = useState(false);
 const [handoffDraft, setHandoffDraft] = useState('');
 const inFlight = useRef(false); const lastAttempt = useRef<{ id: string; text: string; threadId: string; useKnowledge: boolean; library: 'project'|'drive' } | undefined>(undefined);
 const selectedId = useRef(''); const messagesView = useRef<HTMLDivElement>(null); const dialog = useRef<HTMLDialogElement>(null);
 const alive = useRef(true);
 const gods = [...new Set(agents.map((a) => a.god))].sort((a, b) => a === 'Zeus' ? -1 : b === 'Zeus' ? 1 : a.localeCompare(b));
 const chosenGod = thread?.god ?? god; const chosenEngine = thread?.engine ?? engine;
 const pending = thread?.messages.some((m) => m.state === 'pending') ?? false;
 const ready = connections.some((c) => c.id === chosenEngine && c.state === 'ready');
 const roles = agents.filter((a) => (chosenGod === 'Council' ? ['Zeus', 'Athena', 'Apollo'].includes(a.god) : a.god === chosenGod)).map((a) => `${a.god}: ${a.role}`);
 const composer = useRef<HTMLTextAreaElement>(null);
 useEffect(() => { if (initialKnowledge) composer.current?.focus(); }, [initialKnowledge]);
 const privateThread = thread?.messages.some(m => m.useKnowledge || m.knowledge) ?? false;
 const driveReady = Boolean(driveStatus?.account && !['disconnected','signin','offline','error'].includes(driveStatus.state));
 useEffect(() => { let active = true; let fetching = false; const refresh = async () => { if(fetching) return; fetching=true; try { const status = await runtime.driveStatus(); if(!active) return; if(driveAccount.current !== undefined && driveAccount.current !== status.account?.id) { setUseKnowledge(false); lastAttempt.current=undefined; } driveAccount.current=status.account?.id; setDriveStatus(status); if(['disconnected','signin','offline'].includes(status.state)) setUseKnowledge(false); } catch { if(active) { setDriveStatus(undefined); setUseKnowledge(false); } } finally {fetching=false;} }; void refresh(); const timer=setInterval(() => void refresh(),2000); return () => {active=false;clearInterval(timer);}; }, []);
 useEffect(() => { let active = true; const refresh = () => { void runtime.ragStatus(projectId).then(s => { if (active) setRagStatus(s); }).catch(() => { if (active) setRagStatus(undefined); }); }; refresh(); const timer = setInterval(refresh, 2000); return () => { active = false; clearInterval(timer); }; }, [projectId]);
 const prepareHandoff = (mode: 'chat' | 'work') => { if (privateThread || useKnowledge) return; setHandoffDraft(chatHandoff(thread, chosenGod, roles, draft, mode)); setError(''); setHandoff(mode); };
 const refreshList = useCallback(async () => { if (projectId) { const result = await runtime.chatList(projectId); if (alive.current) setThreads(result); } }, [projectId]);
 useEffect(() => { alive.current = true; void refreshList().catch((e: unknown) => { if (alive.current) setError(errorText(e)); }); return () => { alive.current = false; }; }, [refreshList]);
 useEffect(() => {
  if (!thread?.id || !pending) return;
  let fetching = false; const id = thread.id;
  const timer = setInterval(() => {
   if (fetching || document.hidden) return; fetching = true;
   void runtime.chatGet(id).then((result) => { if (alive.current && selectedId.current === id) { setThread(result); setError(''); if (!result.messages.some((m) => m.state === 'pending')) void refreshList().catch(() => undefined); } })
    .catch((e: unknown) => { if (alive.current) setError(errorText(e)); }).finally(() => { fetching = false; });
  }, 1200);
  return () => clearInterval(timer);
 }, [thread?.id, pending, refreshList]);
 useEffect(() => { if (thread?.messages.length && messagesView.current) messagesView.current.scrollTop = messagesView.current.scrollHeight; }, [thread?.messages.length, pending]);
 useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); }, [notice]);
 useEffect(() => {
  if (!handoff && !deleting) return;
  const previous = document.activeElement as HTMLElement | null; const el = dialog.current; el?.showModal();
  return () => { el?.close(); previous?.focus(); };
 }, [handoff, deleting]);
 const select = async (id: string) => {
  if (inFlight.current) return; inFlight.current = true; setBusy(true);
  selectedId.current = id; setError(''); setDraft(''); setUseKnowledge(false); setCloudConsent(false); lastAttempt.current = undefined;
  try { const result = await runtime.chatGet(id); if (alive.current && selectedId.current === id) setThread(result); } catch (e) { if (alive.current) setError(errorText(e)); } finally { inFlight.current = false; if (alive.current) setBusy(false); }
 };
 const fresh = () => { selectedId.current = ''; setThread(undefined); setDraft(''); setUseKnowledge(false); setCloudConsent(false); setError(''); lastAttempt.current = undefined; };
 const send = async () => {
  if (inFlight.current || !draft.trim() || pending || workBusy || !ready || (chosenEngine === 'codex' && !cloudConsent)) return;
  inFlight.current = true; setBusy(true); setError(''); let current = thread;
  try {
   if (!current) { current = await runtime.chatCreate(projectId, god, engine, cloudConsent); if (!alive.current) return; selectedId.current = current.id; setThread(current); }
   const attempt = lastAttempt.current?.text === draft.trim() && lastAttempt.current.threadId === current.id && lastAttempt.current.useKnowledge === useKnowledge && lastAttempt.current.library === knowledgeLibrary ? lastAttempt.current : { id: crypto.randomUUID(), text: draft.trim(), threadId: current.id, useKnowledge, library: knowledgeLibrary };
   lastAttempt.current = attempt;
   const result = await runtime.chatSend(current, attempt.text, attempt.id, cloudConsent, useKnowledge, knowledgeLibrary);
   if (!alive.current) return; setThread(result); setDraft(''); lastAttempt.current = undefined; await refreshList();
  } catch (e) {
   if (!alive.current) return; setError(errorText(e));
   if (current) { try { const result = await runtime.chatGet(current.id); if (alive.current) setThread(result); } catch { /* Preserve the useful send error. */ } }
  } finally { inFlight.current = false; if (alive.current) setBusy(false); }
 };
 const stop = async () => { if (!thread || inFlight.current) return; inFlight.current = true; setBusy(true); try { setThread(await runtime.chatStop(thread.id)); await refreshList(); } catch (e) { setError(errorText(e)); } finally { inFlight.current = false; setBusy(false); } };
 const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setNotice('Copied. Review the destination before sharing.'); } catch { setError('Clipboard access is unavailable. Select and copy the text in the preview.'); } };
 const continueChatGPT = async () => {
  if (busy) return; setBusy(true); setError('');
  try { await navigator.clipboard.writeText(handoffDraft); await openChatGPT(); setNotice(`Prompt copied. Paste into ChatGPT and choose ${handoff === 'work' ? 'Work' : 'Chat'} there. Responses stay in ChatGPT.`); setHandoff(undefined); }
  catch (e) { setError(`${errorText(e)}. You can select and copy the prompt, then open chatgpt.com.`); } finally { setBusy(false); }
 };
 const remove = async () => { if (!thread || busy) return; setBusy(true); try { await runtime.chatDelete(thread.id); setDeleting(false); fresh(); await refreshList(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
 if (!projectId) return <Empty title="Choose a project to gather the council">Conversations belong to the active project. Connect a project folder above to begin.</Empty>;

 return <div className="p-chat-page">
  <div className="p-chat-hero"><div className="p-chat-seal"><GodSigil name="Zeus"/></div><div><span className="p-eyebrow">THE COUNCIL CHAMBER</span><h1>Chat with the Gods.</h1><p>A place to think aloud. Shape the idea before it becomes the work.</p></div><Badge state="ready">Your space to explore</Badge></div>
  <div className="p-chat-routes" aria-label="Conversation options">
   <div><AppIcon service="ollama"/><div><strong>Local conversation</strong><span>Inside Pantheon · no cloud-model credits</span></div></div>
   <button type="button" onClick={() => prepareHandoff('chat')} disabled={busy || pending || privateThread || useKnowledge}><AppIcon service="chatgpt"/><div><strong>ChatGPT Chat</strong><span>Prepare a prompt · continue in ChatGPT</span></div><Icon name="arrow"/></button>
   <button type="button" onClick={() => prepareHandoff('work')} disabled={busy || pending || privateThread || useKnowledge}><AppIcon service="codex"/><div><strong>ChatGPT Work</strong><span>Prepare a brief · uses Work allowance</span></div><Icon name="arrow"/></button>
  </div>
  {error && <div className="p-banner p-banner-error" role="alert">{error}</div>}{notice && <div className="p-banner" role="status">{notice}</div>}
  <div className="p-chat-layout"><aside className="p-chat-history" aria-label="Saved conversations"><button type="button" className="p-button" onClick={fresh} disabled={busy}><Icon name="plus"/>New conversation</button><p className="p-eyebrow">SAVED IN THIS PROJECT</p>
   {threads.length ? threads.map((item) => <button type="button" key={item.id} className="p-chat-thread" aria-current={thread?.id === item.id ? 'true' : undefined} disabled={busy} onClick={() => void select(item.id)}><strong>{item.title}</strong><span>{item.god} · {item.engine === 'ollama' ? 'Local' : 'Work / Codex'}{item.pending ? ' · Thinking' : ''}</span></button>) : <p className="p-muted">Your conversations will appear here.</p>}
  </aside><section className="p-chat-room" aria-label="Council conversation">
   <div className="p-chat-room-head"><Avatar name={chosenGod === 'Council' ? 'Zeus' : chosenGod}/><div><strong>{chosenGod === 'Council' ? 'Council of Olympus' : chosenGod}</strong><span>{chosenGod === 'Council' ? 'Zeus · Athena · Apollo. One model, three perspectives.' : 'Your thinking partner'}</span></div>{thread && <button type="button" className="p-text-button" onClick={() => setDeleting(true)} disabled={busy || pending}>Delete</button>}</div>
   {!thread && <div className="p-chat-choices"><label>Speak with<select aria-label="Choose a god" value={god} onChange={(e) => setGod(e.target.value)} disabled={busy}><option value="Council">Council · Zeus, Athena & Apollo</option>{gods.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>Intelligence<select aria-label="Chat intelligence" value={engine} onChange={(e) => { setEngine(e.target.value as ChatEngine); setUseKnowledge(false); setCloudConsent(false); }} disabled={busy}><option value="ollama">Ollama · local, no model credits</option><option value="codex">ChatGPT worker · Work/Codex allowance</option></select></label></div>}
   <div ref={messagesView} className="p-chat-messages" role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions text">
    {thread?.messages.length ? thread.messages.map((message) => <article key={message.id} className="p-chat-message" data-role={message.role}><div className="p-chat-message-label"><strong>{message.role === 'user' ? 'Matthew' : chosenGod === 'Council' ? 'The Council' : chosenGod}</strong><span>{time(message.at)}{message.model ? ` · ${message.model}` : ''}</span></div>
     {message.state === 'pending' ? <p className="p-chat-thinking">Thinking through your idea… <span>Stop any time below.</span></p> : message.state !== 'complete' ? <p className="p-chat-failed">{message.error || 'This turn did not complete'}</p> : message.role === 'user' ? <p className="p-chat-user-text">{message.text}</p> : <><div className="p-chat-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children, href }) => <span>{children}{href?.startsWith('https://') ? ` (${href})` : ''}</span> }}>{message.text}</Markdown></div><button className="p-text-button" type="button" onClick={() => void copy(message.text)}>Copy answer</button></>}
     {message.knowledge && <KnowledgeSources headingLevel={2} projectId={projectId} bundle={message.knowledge} citationWarning={message.citationWarning}/>}
    </article>) : <div className="p-chat-welcome"><div className="p-chat-council">{['Zeus', 'Athena', 'Apollo'].map((name) => <Avatar name={name} size="large" key={name}/>)}</div><h2>Every great outcome starts<br/>with a better conversation.</h2><p>Bring an idea, a question, or a decision. The council helps you give it shape.</p><div className="p-chat-starters">{STARTERS.map(([label, prompt], index) => <button type="button" key={label} onClick={() => { setDraft(prompt); if (!thread) setGod(index === 0 ? 'Zeus' : index === 1 ? 'Athena' : 'Council'); }}>{label}<Icon name="arrow" size={15}/></button>)}</div></div>}
   </div>
   <form className="p-chat-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
    <div className="p-knowledge-opt-in"><label>Knowledge library<select aria-label="Knowledge library" value={knowledgeLibrary} disabled={busy || pending || chosenEngine !== 'ollama'} onChange={e => { setKnowledgeLibrary(e.target.value as 'project'|'drive'); setUseKnowledge(false); lastAttempt.current=undefined; }}><option value="project">Curated project sources</option><option value="drive">My Google Drive</option></select></label><label><input type="checkbox" aria-label={knowledgeLibrary === 'drive' ? 'Use Drive knowledge' : 'Use project knowledge'} checked={useKnowledge} onChange={e => setUseKnowledge(e.target.checked)} disabled={busy || pending || chosenEngine !== 'ollama' || (knowledgeLibrary === 'drive' ? !driveReady : !ragStatus?.supported)}/>{knowledgeLibrary === 'drive' ? 'Use Drive knowledge' : 'Use project knowledge'}</label><p>{chosenEngine !== 'ollama' ? 'Private knowledge is available with local Ollama only.' : knowledgeLibrary === 'drive' ? `${driveStatus?.account?.email ?? 'Connect Google Drive in Connections'} · ${driveStatus?.state ?? 'Checking connection'}. Sources stay on this PC.` : `${ragStatus?.scope?.toUpperCase() ?? 'This project'} · ${knowledgeStatusLabel(ragStatus)}. Sources stay on this PC.`}</p>{privateThread && <p>This conversation contains private knowledge. ChatGPT handoffs are unavailable.</p>}</div>
    {chosenEngine === 'codex' && <label className="p-chat-consent"><input type="checkbox" checked={cloudConsent} onChange={(e) => setCloudConsent(e.target.checked)} disabled={busy || pending}/>Send this conversation to OpenAI using my Work/Codex allowance. Remaining allowance is not measured.</label>}
    <label className="p-sr-only" htmlFor="council-message">Message the council</label><textarea ref={composer} id="council-message" value={draft} rows={3} maxLength={4000} placeholder={`What’s on your mind${chosenGod === 'Council' ? '?' : `, for ${chosenGod}?`}`} disabled={busy || pending} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/>
    <div className="p-chat-composer-foot"><span><AppIcon service={chosenEngine}/>{chosenEngine === 'ollama' ? 'Local Ollama · no API charges' : 'ChatGPT worker · shared Work/Codex usage'}</span>{pending ? <button type="button" className="p-button" onClick={() => void stop()} disabled={busy}><Icon name="stop"/>Stop answer</button> : <button type="submit" className="p-button p-primary" disabled={busy || !draft.trim() || workBusy || !ready || !roles.length || (chosenEngine === 'codex' && !cloudConsent)}>{busy ? 'Starting…' : 'Send message'}<Icon name="arrow"/></button>}</div>
    <p className="p-chat-fine">{workBusy ? 'A workboard job is running. Finish or stop it before sending.' : !ready ? 'This worker is not ready. Check Connections, or prepare a ChatGPT handoff above.' : 'Ctrl + Enter to send. Chats are saved locally; ideas are drafts, not approved tasks.'}{thread && recentConversation(thread.messages).omitted > 0 ? ' Older turns stay saved but are outside the model context; start a fresh chat with a recap.' : ''} Private knowledge files are not attached automatically.</p>
   </form>
  </section></div>
  {(handoff || deleting) && <dialog ref={dialog} className="p-dialog p-chat-dialog" aria-labelledby="chat-dialog-title" onCancel={(e) => { e.preventDefault(); if (!busy) { setHandoff(undefined); setDeleting(false); } }}><div className="p-dialog-head"><h2 id="chat-dialog-title">{deleting ? 'Delete this conversation?' : `Continue with ChatGPT ${handoff === 'work' ? 'Work' : 'Chat'}`}</h2><button className="p-icon-button" type="button" aria-label="Close preview" disabled={busy} onClick={() => { setHandoff(undefined); setDeleting(false); }}><Icon name="close"/></button></div>
   {deleting ? <><p>This removes this conversation from Pantheon. Existing database backups may still contain it.</p><div className="p-dialog-actions"><button className="p-button" type="button" onClick={() => setDeleting(false)} disabled={busy}>Keep conversation</button><button className="p-button p-primary" type="button" onClick={() => void remove()} disabled={busy}>Delete conversation</button></div></> : <><p>{handoff === 'work' ? 'Use Work in official ChatGPT for a reviewable deliverable. Work shares the Codex allowance and applicable credits.' : 'Use Chat in official ChatGPT for everyday brainstorming with your signed-in account. Availability and limits depend on your plan and selected model.'}</p><p>Only the text below is copied. Paste it into ChatGPT and choose {handoff === 'work' ? 'Work' : 'Chat'} there. This opens your browser; responses remain in ChatGPT. Pantheon does not import your login or ChatGPT history.</p><label htmlFor="chat-handoff-preview">Review what you will share</label><textarea id="chat-handoff-preview" rows={12} maxLength={30000} value={handoffDraft} onChange={(e) => setHandoffDraft(e.target.value)}/><p className="p-chat-fine">No API key, automatic upload, or hidden paid fallback. Remove private details before sharing; edit this preview before copying.</p>{error && <p role="alert" className="p-chat-failed">{error}</p>}<div className="p-dialog-actions"><button className="p-button" type="button" disabled={busy} onClick={() => void copy(handoffDraft)}>Copy prompt</button><button className="p-button p-primary" type="button" disabled={busy} onClick={() => void continueChatGPT()}><AppIcon service="chatgpt" size={20}/>{busy ? 'Opening…' : 'Copy & open ChatGPT'}</button></div></>}
  </dialog>}
 </div>;
}
