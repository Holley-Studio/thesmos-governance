import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { runtime, openGoogle } from '../ipc/runtime';
import { googleDestination, overlappingEvents, sourceFreshness, type BriefView, type BriefSource, type BriefEvent } from '../../shared/brief';
import type { StudioJob } from '../../shared/studio';
import { AppIcon } from '../design/AppIcon';
import { Icon, GodSigil } from '../design/Icon';
import { Panel, Badge, Empty, STATE, time } from './StudioDialogs';
const zone = 'America/Chicago';
function localDate(value = Date.now()): string { const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); return ['year','month','day'].map(k => parts.find(p => p.type === k)?.value).join('-'); }
function SourceNote({ source }: { source: BriefSource<unknown> }): JSX.Element {
 const state = sourceFreshness(source); return <div className="p-brief-source"><Badge state={state === 'current' ? 'ready' : state === 'failed' ? 'failed' : 'review'}>{state === 'current' ? 'Snapshot verified' : state === 'failed' ? 'Last refresh failed' : 'Snapshot is older'}</Badge><span>{source.verifiedAt ? `Pulled ${time(source.verifiedAt)}` : 'No successful pull'}{state === 'failed' ? ' · Showing last verified items, if available' : ''}</span></div>;
}
function eventTime(event: BriefEvent): string {
 if (event.allDay) return `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(event.start + 'T12:00:00Z'))} · All day`;
 return time(event.start) + ' – ' + new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(event.end));
}
export function TodayDesk({ jobs, projectName, onWorkboard }: { jobs: StudioJob[]; projectName?: string; onWorkboard(): void }): JSX.Element {
 const [view, setView] = useState<BriefView>(); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
 const [mailFilter, setMailFilter] = useState('all'); const [query, setQuery] = useState(''); const [agenda, setAgenda] = useState('week');
 const [clock, setClock] = useState(Date.now());
 const load = useCallback(async () => { try { setView(await runtime.brief()); setError(''); } catch { setError('The saved briefing could not be loaded.'); } finally { setLoading(false); } }, []);
 useEffect(() => { void load(); const timer = setInterval(() => { setClock(Date.now()); if (!document.hidden) void load(); }, 60000); return () => clearInterval(timer); }, [load]);
 const snapshot = view?.snapshot; const today = localDate(clock);
 const emails = (snapshot?.mail.items ?? []).filter(m => (mailFilter === 'all' || (mailFilter === 'unread' ? m.unread : m.starred)) && `${m.subject} ${m.sender}`.toLowerCase().includes(query.toLowerCase()));
 const events = (snapshot?.calendar.items ?? []).filter(e => e.response !== 'declined' && (e.allDay ? e.end > today : Date.parse(e.end) > clock) && (agenda === 'week' || (e.allDay ? e.start <= today && e.end > today : localDate(Date.parse(e.start)) === today)));
 const overlaps = overlappingEvents(events);
 const followups = jobs.filter(j => j.state === 'review' || j.state === 'failed' || (['planned','running'].includes(j.state) && j.dueAt && j.dueAt <= today));
 const open = async (service: 'gmail' | 'calendar', id?: string) => { if (!snapshot) return; try { await openGoogle(googleDestination(service, snapshot, id)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open Google'); } };
 return <div className="p-today"><header className="p-brief-hero"><div className="p-brief-sigil"><GodSigil name="Hermes"/></div><div><span className="p-eyebrow">HERMES · YOUR DAILY BRIEF</span><h1>A clear view of your day.</h1><p>{new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: zone }).format(new Date(clock))} · Central time</p></div><button type="button" className="p-button" onClick={() => void load()}><Icon name="refresh"/>Reload briefing</button></header>
 {error && <div role="alert" className="p-error">{error}</div>}
 {view?.problem && <div className="p-note"><Icon name="shield"/><p>{view.problem} Open your connected Google tools to verify access; Pantheon displays only verified local snapshots.</p></div>}
 {loading && !view && <p role="status" className="p-muted">Loading your saved briefing…</p>}
 {snapshot && <><div className="p-brief-summary"><div><span>Inbox shown</span><strong>{snapshot.mail.verifiedAt ? snapshot.mail.items.length : "—"}</strong><small>Latest messages · last 14 days</small></div><div><span>Unread shown</span><strong>{snapshot.mail.verifiedAt ? snapshot.mail.items.filter(m => m.unread).length : "—"}</strong><small>Within this selected inbox view</small></div><div><span>Upcoming events shown</span><strong>{snapshot.calendar.verifiedAt ? events.length : "—"}</strong><small>Primary calendar · next 7 days</small></div><div><span>Project follow-ups</span><strong>{followups.length}</strong><small>{projectName ?? 'Connect a project'}</small></div></div>
 <div className="p-brief-monitor"><Icon name="connections"/><div><strong>{snapshot.account} · Account overview</strong><span>{view.monitor.description} {view.monitor.enabled && !view.monitor.firstScheduledRunVerified ? 'First scheduled refresh pending.' : ''} Reload reads the saved snapshot; it does not pull Google immediately.</span></div></div></>}
 <div className="p-brief-grid"><Panel title="Your inbox" action={<button type="button" className="p-text-button" disabled={!snapshot} onClick={() => void open('gmail')}><AppIcon service="gmail" size={19}/>Open Gmail<Icon name="arrow" size={14}/></button>}>
 {snapshot && <SourceNote source={snapshot.mail}/>}<div className="p-brief-filters"><div role="group" aria-label="Inbox filter">{[['all','All shown'],['unread','Unread'],['starred','Starred']].map(([id,label]) => <button type="button" key={id} aria-pressed={mailFilter === id} onClick={() => setMailFilter(id)}>{label}</button>)}</div><input type="search" aria-label="Search displayed emails" placeholder="Find an email…" value={query} onChange={e => setQuery(e.target.value)}/></div>
 <div className="p-brief-mail">{emails.map(m => <button type="button" key={m.id} className={`p-brief-mail-row${m.unread ? ' is-unread' : ''}`} onClick={() => void open('gmail', m.id)} aria-label={`Open ${m.subject} in Gmail`}><span className="p-brief-mail-dot" aria-label={m.unread ? 'Unread' : 'Read'}/><div><strong>{m.subject}</strong><span>{m.sender}</span></div><div className="p-brief-mail-date"><time dateTime={m.receivedAt}>{time(m.receivedAt)}</time>{m.starred && <span>★ Starred</span>}</div><Icon name="arrow" size={14}/></button>)}</div>
 {!emails.length && <Empty title={snapshot?.mail.verifiedAt ? 'No matching messages shown' : 'Inbox not verified'}>{snapshot ? 'Try another filter or open Gmail. This is a bounded view, not the full mailbox.' : 'The authorized Google connection supplies a read-only briefing through Codex.'}</Empty>}
 {snapshot && <p className="p-brief-footnote">Up to 20 recent inbox messages. Promotions, social, spam and trash are excluded.{snapshot.mail.truncated ? ' More matching messages exist in Gmail.' : ''} Open the original message in Gmail to read or reply.</p>}
 </Panel><div className="p-brief-right"><Panel title="Coming up" action={<button type="button" className="p-text-button" disabled={!snapshot} onClick={() => void open('calendar')}><AppIcon service="google-calendar" size={19}/>Calendar<Icon name="arrow" size={14}/></button>}>
 {snapshot && <SourceNote source={snapshot.calendar}/>}<div className="p-brief-agenda-filter" role="group" aria-label="Agenda range">{[['day','Today'],['week','Next 7 days']].map(([id,label]) => <button type="button" key={id} aria-pressed={agenda === id} onClick={() => setAgenda(id)}>{label}</button>)}</div>
 {events.map(e => <button type="button" key={e.id} className="p-brief-event" onClick={() => void open('calendar', e.id)}><span className="p-brief-event-time">{eventTime(e)}</span><strong>{e.title}</strong><div>{e.response === 'needsAction' && <Badge state="review">RSVP needed</Badge>}{e.response === 'tentative' && <Badge state="review">Tentative</Badge>}{overlaps.has(e.id) && <Badge state="review">Time overlap</Badge>}</div></button>)}
 {!events.length && <Empty title={snapshot?.calendar.verifiedAt ? 'No upcoming events returned' : 'Calendar not verified'}>{snapshot ? 'No matching events are shown from the connected primary calendar in this window. This does not verify your full availability.' : 'Upcoming events appear after a verified Google Calendar pull.'}</Empty>}
 {snapshot?.calendar.truncated && <p className="p-brief-footnote">The 30-event limit was reached. Open Calendar for the complete schedule.</p>}
 </Panel><Panel title={projectName ? `${projectName} · Follow-ups` : 'Workboard follow-ups'} action={<button type="button" className="p-text-button" onClick={onWorkboard}>Workboard<Icon name="arrow" size={14}/></button>}>
 {followups.slice(0,6).map(j => <button type="button" className="p-brief-followup" key={j.id} onClick={onWorkboard}><strong>{j.title}</strong><span>{STATE[j.state]} · {j.owner}{j.dueAt ? ` · due ${j.dueAt}` : ''}</span></button>)}{!followups.length && <p className="p-brief-footnote">No review, failed or due items are shown in this project's local workboard. Drive remains the canonical business task list.</p>}
 </Panel></div></div><div className="p-note p-brief-privacy"><Icon name="shield"/><p>This briefing shows sender/subject metadata and event times. Bodies, attachments and event descriptions are excluded. Nothing here is automatically sent to AI chats or registered as knowledge. Reply, RSVP or reschedule in Google.</p></div>
 </div>;
}
