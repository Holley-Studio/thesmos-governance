import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBrief, mergeBriefPull, sourceFreshness, overlappingEvents, calendarReference, googleDestination } from '../shared/brief.js';
import { readBrief } from '../sidecar/studio/brief.js';
const captured = '2026-09-30T18:00:00Z'; const clock = Date.parse(captured);
function example() { return { version: 1, account: 'matthew@holley.studio', timeZone: 'America/Chicago', updatedAt: captured,
 window: { start: captured, end: '2026-10-07T18:00:00Z' },
 mail: { status: 'ok', attemptedAt: captured, verifiedAt: captured, truncated: true, items: [{ id: 'a123', threadId: 'a123', sender: 'Client <client@example.com>', subject: 'Project question', receivedAt: captured, unread: true, starred: false }] },
 calendar: { status: 'ok', attemptedAt: captured, verifiedAt: captured, truncated: false, items: [{ id: 'meeting', title: 'Project review', start: '2026-09-30T19:00:00Z', end: '2026-09-30T20:00:00Z', allDay: false, busy: true, response: 'accepted', reference: 'dGVzdA==' }] } }; }
test('metadata projection never returns mail bodies, snippets, attachments or event descriptions', () => {
 const raw = example(); Object.assign(raw.mail.items[0], { body: 'PRIVATE_BODY', snippet: 'PRIVATE_PREVIEW', attachments: ['PRIVATE_ATTACHMENT'] }); Object.assign(raw.calendar.items[0], { description: 'PRIVATE_DESCRIPTION', attendees: ['PRIVATE_ATTENDEE'] });
 const output = parseBrief(raw, clock); assert.doesNotMatch(JSON.stringify(output), /PRIVATE_/); assert.equal(output.mail.items[0].subject, 'Project question');
});
test('unsupported versions, unknown accounts, duplicates and oversized data fail verification', () => {
 const raw = example(); assert.throws(() => parseBrief({ ...raw, version: 2 }, clock)); assert.throws(() => parseBrief({ ...raw, account: 'x@host/?evil' }, clock));
 assert.throws(() => parseBrief({ ...raw, mail: { ...raw.mail, items: [raw.mail.items[0], raw.mail.items[0]] } }, clock));
 assert.throws(() => parseBrief({ ...raw, mail: { ...raw.mail, items: Array(21).fill(raw.mail.items[0]) } }, clock));
});
test('clearly sensitive subject metadata is hidden without hiding ordinary security alerts', () => {
 const raw = example(); for (const label of ['Your verification code is 123456','Password reset link','Patient diagnosis: private details']) {
  const result = parseBrief({ ...raw, mail: { ...raw.mail, items: [{ ...raw.mail.items[0], subject: label }] } }, clock); assert.equal(result.mail.items[0].subject,'Sensitive subject hidden — open Google'); assert.doesNotMatch(JSON.stringify(result),/123456|private details/);
 }
 assert.equal(parseBrief({ ...raw, mail: { ...raw.mail, items: [{ ...raw.mail.items[0], subject: 'Security alert' }] } }, clock).mail.items[0].subject,'Security alert');
});
test('verification times cannot move into the future or disappear while records remain', () => {
 const raw = example(); assert.throws(() => parseBrief(raw, clock - 600000)); assert.throws(() => parseBrief({ ...raw, mail: { ...raw.mail, status: 'error', verifiedAt: undefined } }, clock));
 assert.throws(() => parseBrief({ ...raw, calendar: { ...raw.calendar, items: [{ ...raw.calendar.items[0], end: 'invalid' }] } }, clock));
});
test('partial refresh failure preserves previous items and verification time without inventing freshness', () => {
 const previous = parseBrief(example(), clock); const attemptedAt = new Date().toISOString();
 const next = mergeBriefPull(previous, { account: previous.account, attemptedAt, window: { start: attemptedAt, end: new Date(Date.now()+86400000).toISOString() }, mail: { status: 'ok', items: [], truncated: false }, calendar: { status: 'error', items: [] } });
 assert.equal(next.mail.items.length, 0); assert.equal(next.mail.verifiedAt, attemptedAt); assert.deepEqual(next.calendar.items, previous.calendar.items); assert.equal(next.calendar.verifiedAt, previous.calendar.verifiedAt); assert.deepEqual(next.window, previous.window); assert.equal(sourceFreshness(next.calendar), 'failed');
});
test('a verified empty calendar is a real empty result; a failed first pull has no verified data', () => {
 const attemptedAt = new Date().toISOString(); const input = { account: 'matthew@holley.studio', attemptedAt, window: { start: attemptedAt, end: new Date(Date.now()+86400000).toISOString() }, mail: { status: 'error' }, calendar: { status: 'ok', items: [], truncated: false } };
 const result = mergeBriefPull(undefined, input); assert.equal(result.calendar.items.length, 0); assert.ok(result.calendar.verifiedAt); assert.equal(result.mail.verifiedAt, undefined); assert.equal(result.mail.status, 'error');
});
test('changing an account never carries another accounts cached messages into the new pull', () => {
 const previous = parseBrief(example(), clock); assert.throws(() => mergeBriefPull(previous, { account: 'another@example.com', attemptedAt: captured }), /account differs/);
});
test('old successful snapshots show as stale and an access failure shows as failed', () => {
 const source = parseBrief(example(), clock).mail; assert.equal(sourceFreshness(source, clock+60000), 'current'); assert.equal(sourceFreshness(source, clock+91*60000), 'stale'); assert.equal(sourceFreshness({ ...source, status: 'error' }, clock), 'failed');
});
test('all-day exclusive end dates are preserved and invalid or inverted dates are refused', () => {
 const raw = example(); const event = { ...raw.calendar.items[0], allDay: true, start: '2026-10-01', end: '2026-10-03' };
 const result = parseBrief({ ...raw, calendar: { ...raw.calendar, items: [event] } }, clock); assert.equal(result.calendar.items[0].end, '2026-10-03');
 assert.throws(() => parseBrief({ ...raw, calendar: { ...raw.calendar, items: [{ ...event, start: '2026-02-30' }] } }, clock)); assert.throws(() => parseBrief({ ...raw, calendar: { ...raw.calendar, items: [{ ...event, end: event.start }] } }, clock));
});
test('time-overlap indicators exclude free, declined and all-day events and touching endpoints', () => {
 const event = parseBrief(example(), clock).calendar.items[0]; const second = { ...event, id: 'second', start: '2026-09-30T19:30:00.000Z' }; const touching = { ...event, id: 'touch', start: event.end, end: '2026-09-30T21:00:00.000Z' };
 assert.deepEqual([...overlappingEvents([event, second])].sort(), ['meeting','second']); assert.equal(overlappingEvents([event,touching]).size, 0);
 for (const excluded of [{ ...second, busy: false }, { ...second, response: 'declined' as const }, { ...second, allDay: true }]) assert.equal(overlappingEvents([event,excluded]).size,0);
});
test('calendar deep links accept only official Google event references and discard redirects', () => {
 assert.equal(calendarReference('https://www.google.com/calendar/event?eid=dGVzdA%3D%3D&redirect=https://evil.example'), 'dGVzdA==');
 for (const url of ['javascript:alert(1)','https://www.google.com.evil.example/calendar/event?eid=x','https://x@www.google.com/calendar/event?eid=x','https://www.google.com:444/calendar/event?eid=x','https://www.google.com/calendar/event?eid=x%26evil']) assert.equal(calendarReference(url), undefined);
});
test('opening an item uses its verified account and reference and refuses missing IDs', () => {
 const snapshot = parseBrief(example(), clock); assert.deepEqual(googleDestination('gmail',snapshot,'a123'),{ service:'gmail',account:'matthew@holley.studio',reference:'a123' }); assert.equal(googleDestination('calendar',snapshot,'meeting').reference,'dGVzdA=='); assert.throws(() => googleDestination('gmail',snapshot,'missing'));
});
test('cache loading distinguishes missing, malformed, oversized and valid saved data', () => {
 const dir = mkdtempSync(join(tmpdir(),'pantheon-brief-test-')); try {
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()))); const folder=join(dir,'briefing'); assert.match(readBrief(dir).problem!,/No verified/); mkdirSync(folder);
  writeFileSync(join(folder,'snapshot.json'),'invalid'); assert.equal(readBrief(dir).snapshot,undefined); writeFileSync(join(folder,'snapshot.json'),'a'.repeat(256001)); assert.equal(readBrief(dir).snapshot,undefined);
  writeFileSync(join(folder,'snapshot.json'),JSON.stringify(example())); const view=readBrief(dir); assert.equal(view.snapshot?.mail.items[0].id,'a123'); assert.equal(view.monitor.enabled,false);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('briefing directory junctions cannot expand the runtime read boundary', () => {
 const dir=mkdtempSync(join(tmpdir(),'pantheon-brief-boundary-')); try { const outside=join(dir,'other'); mkdirSync(outside); writeFileSync(join(outside,'snapshot.json'),JSON.stringify(example())); symlinkSync(outside,join(dir,'briefing'),'junction'); assert.equal(readBrief(dir).snapshot,undefined); }
 finally { const link=join(dir,'briefing'); try { rmSync(link,{recursive:true,force:true}); } catch { /* Cleanup remains inside the explicit test root. */ } rmSync(dir,{recursive:true,force:true}); }
});
