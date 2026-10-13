/** Metadata only. Mail bodies, previews, attachments and meeting descriptions are excluded. */
export interface BriefMail { id: string; threadId: string; sender: string; subject: string; receivedAt: string; unread: boolean; starred: boolean }
export interface BriefEvent { id: string; title: string; start: string; end: string; allDay: boolean; busy: boolean; response: 'accepted' | 'tentative' | 'needsAction' | 'declined' | 'unknown'; reference?: string }
export interface BriefSource<T> { status: 'ok' | 'error'; attemptedAt: string; verifiedAt?: string; truncated: boolean; items: T[] }
export interface DailyBrief {
 version: 1; account: string; timeZone: 'America/Chicago'; updatedAt: string;
 window: { start: string; end: string }; mail: BriefSource<BriefMail>; calendar: BriefSource<BriefEvent>;
}
export interface BriefView { snapshot?: DailyBrief; problem?: string; monitor: { enabled: boolean; firstScheduledRunVerified: boolean; description: string }; }
const object = (x: unknown): Record<string, unknown> => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Invalid briefing object'); return x as Record<string, unknown>; };
function stamp(x: unknown): string {
 if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x) || !Number.isFinite(Date.parse(x))) throw new Error('Invalid briefing timestamp');
 return new Date(x).toISOString();
}
function text(x: unknown, max: number, fallback = ''): string { return typeof x === 'string' ? x.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, max) || fallback : fallback; }
function subject(x: unknown, fallback: string): string { const label = text(x, 250, fallback);
 if (/\b(?:patient|diagnosis|prescription|medical record|clinical result|password reset|magic link|otp)\b|\b(?:verification|one.time|sign.in|login|authentication).{0,30}\b(?:code|token|password)\b|\byour code\b/i.test(label)) return 'Sensitive subject hidden — open Google';
 return label;
}
export function validBriefAccount(x: unknown): x is string { return typeof x === 'string' && x.length < 160 && /^[a-zA-Z0-9._+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(x); }
export function calendarReference(link: unknown): string | undefined {
 if (typeof link !== 'string' || link.length > 2000) return undefined;
 try { const url = new URL(link); if (url.protocol !== 'https:' || url.username || url.password || url.port || !['calendar.google.com', 'www.google.com'].includes(url.hostname) || !url.pathname.startsWith('/calendar/')) return undefined;
  const ref = url.searchParams.get('eid'); return ref && /^[a-zA-Z0-9_=\-]{1,600}$/.test(ref) ? ref : undefined;
 } catch { return undefined; }
}
function date(x: unknown): string {
 if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) !== x) throw new Error('Invalid all-day date'); return x;
}
export function parseBrief(input: unknown, now = Date.now()): DailyBrief {
 const value = object(input); if (value.version !== 1 || !validBriefAccount(value.account) || value.timeZone !== 'America/Chicago') throw new Error('Unsupported briefing account or version');
 const updatedAt = stamp(value.updatedAt); if (Date.parse(updatedAt) > now + 300000) throw new Error('Briefing clock is ahead');
 const rawWindow = object(value.window); const window = { start: stamp(rawWindow.start), end: stamp(rawWindow.end) };
 if (Date.parse(window.end) <= Date.parse(window.start) || Date.parse(window.end) - Date.parse(window.start) > 8 * 86400000) throw new Error('Invalid calendar window');
 const source = <T>(raw: unknown, limit: number, parse: (x: unknown) => T, identity: (x: T) => string): BriefSource<T> => {
  const data = object(raw); if (!['ok', 'error'].includes(String(data.status)) || !Array.isArray(data.items) || data.items.length > limit) throw new Error('Invalid briefing source');
  const attemptedAt = stamp(data.attemptedAt); const verifiedAt = data.verifiedAt ? stamp(data.verifiedAt) : undefined;
  if (Date.parse(attemptedAt) > now + 300000 || (verifiedAt && (Date.parse(verifiedAt) > Date.parse(attemptedAt) || Date.parse(verifiedAt) > now + 300000)) || (data.status === 'ok' && !verifiedAt)) throw new Error('Invalid source verification');
  const items = data.items.map(parse); if ((items.length && !verifiedAt) || new Set(items.map(identity)).size !== items.length) throw new Error('Unverified or duplicate briefing records');
  return { status: data.status as 'ok' | 'error', attemptedAt, verifiedAt, truncated: data.truncated === true, items };
 };
 const mail = source(value.mail, 20, raw => { const m = object(raw); if (typeof m.id !== 'string' || !/^[a-fA-F0-9]{1,64}$/.test(m.id) || typeof m.threadId !== 'string' || !/^[a-fA-F0-9]{1,64}$/.test(m.threadId)) throw new Error('Invalid mail reference');
  return { id: m.id, threadId: m.threadId, sender: text(m.sender, 180, 'Unknown sender'), subject: subject(m.subject, '(No subject)'), receivedAt: stamp(m.receivedAt), unread: m.unread === true, starred: m.starred === true };
 }, m => m.id);
 const calendar = source(value.calendar, 30, raw => { const e = object(raw); const id = text(e.id, 250); if (!id) throw new Error('Missing calendar reference');
  const allDay = e.allDay === true; const start = allDay ? date(e.start) : stamp(e.start); const end = allDay ? date(e.end) : stamp(e.end);
  if (end <= start) throw new Error('Calendar end must follow start');
  const response = ['accepted', 'tentative', 'needsAction', 'declined'].includes(String(e.response)) ? e.response as BriefEvent['response'] : 'unknown';
  return { id, title: subject(e.title, 'Untitled event'), start, end, allDay, busy: e.busy !== false, response, reference: typeof e.reference === 'string' && /^[a-zA-Z0-9_=\-]{1,600}$/.test(e.reference) ? e.reference : undefined };
 }, e => e.id);
 mail.items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)); calendar.items.sort((a, b) => a.start.localeCompare(b.start));
 return { version: 1, account: value.account, timeZone: 'America/Chicago', updatedAt, window, mail, calendar };
}
export function sourceFreshness(source: BriefSource<unknown>, now = Date.now()): 'current' | 'stale' | 'failed' {
 if (source.status === 'error') return 'failed'; return source.verifiedAt && now - Date.parse(source.verifiedAt) <= 90 * 60000 ? 'current' : 'stale';
}
export function mergeBriefPull(previous: DailyBrief | undefined, input: unknown): DailyBrief {
 const pull = object(input); if (!validBriefAccount(pull.account) || (previous && previous.account !== pull.account)) throw new Error('Refresh account differs from the verified account');
 const attemptedAt = stamp(pull.attemptedAt);
 const next = <T>(raw: unknown, old?: BriefSource<T>) => { const source = object(raw);
  if (source.status === 'ok') return { status: 'ok', attemptedAt, verifiedAt: attemptedAt, truncated: source.truncated === true, items: source.items };
  if (source.status !== 'error') throw new Error('Invalid refresh result');
  return { status: 'error', attemptedAt, verifiedAt: old?.verifiedAt, truncated: old?.truncated ?? false, items: old?.items ?? [] };
 };
 const calendarRaw = object(pull.calendar);
 return parseBrief({ version: 1, account: pull.account, timeZone: 'America/Chicago', updatedAt: attemptedAt,
  window: calendarRaw.status === 'ok' || !previous ? pull.window : previous.window,
  mail: next(pull.mail, previous?.mail), calendar: next(pull.calendar, previous?.calendar) });
}
export function overlappingEvents(events: BriefEvent[]): Set<string> {
 const ids = new Set<string>(); const timed = events.filter(e => !e.allDay && e.busy && e.response !== 'declined');
 for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) if (timed[i].start < timed[j].end && timed[j].start < timed[i].end) { ids.add(timed[i].id); ids.add(timed[j].id); }
 return ids;
}
export function googleDestination(service: 'gmail' | 'calendar', snapshot: DailyBrief, id?: string): { service: 'gmail' | 'calendar'; account: string; reference?: string } {
 if (service !== 'gmail' && service !== 'calendar') throw new Error('Choose Gmail or Google Calendar');
 if (!id) return { service, account: snapshot.account };
 const item = service === 'gmail' ? snapshot.mail.items.find(m => m.id === id) : snapshot.calendar.items.find(e => e.id === id);
 if (!item) throw new Error('This item is no longer in the briefing. Reload it first.');
 return { service, account: snapshot.account, reference: service === 'gmail' ? (item as BriefMail).threadId : (item as BriefEvent).reference };
}
