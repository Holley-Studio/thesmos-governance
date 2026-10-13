/** Connector results are supplied by the authorized Codex bridge; this writer never authenticates or calls Google. */
import { readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync, unlinkSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mergeBriefPull, parseBrief, type DailyBrief } from '../shared/brief.js';
const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const dataDir = arg('--data-dir');
if (!dataDir || !isAbsolute(dataDir)) throw new Error('Choose an absolute app data directory');
if (process.argv.includes('--window')) { const start = new Date(); console.log(JSON.stringify({ start: start.toISOString(), end: new Date(start.getTime() + 7 * 86400000).toISOString() })); }
else {
 const inputFile = arg('--input'); const folder = join(dataDir, 'briefing'); mkdirSync(folder, { recursive: true });
 if (!inputFile || !isAbsolute(inputFile) || resolve(inputFile) !== resolve(folder, 'pull.json')) throw new Error('Stage metadata in briefing/pull.json only');
 if (lstatSync(folder).isSymbolicLink() || lstatSync(inputFile).isSymbolicLink() || !lstatSync(inputFile).isFile() || lstatSync(inputFile).size > 256000) throw new Error('Invalid metadata staging file');
 const snapshotFile = join(folder, 'snapshot.json'); let previous: DailyBrief | undefined;
 try { const stat = lstatSync(snapshotFile); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256000) throw new Error('Invalid snapshot location'); previous = parseBrief(JSON.parse(readFileSync(snapshotFile, 'utf8').replace(/^\uFEFF/, ''))); }
 catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
 const snapshot = mergeBriefPull(previous, JSON.parse(readFileSync(inputFile, 'utf8').replace(/^\uFEFF/, '')));
 if (snapshot.account !== 'matthew@holley.studio') throw new Error('This bridge is scoped to the Holley Studio account');
 const temp = join(folder, `snapshot-${randomUUID()}.tmp`); writeFileSync(temp, JSON.stringify(snapshot, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); renameSync(temp, snapshotFile);
 unlinkSync(inputFile);
 if (process.argv.includes('--scheduled')) {
  const file = join(folder, 'monitor.json'); const stat = lstatSync(file); if (stat.isSymbolicLink() || stat.size > 10000) throw new Error('Invalid monitor file');
  const config = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (config.enabled === true) { config.firstScheduledRunVerified = config.firstScheduledRunVerified === true || (snapshot.mail.status === 'ok' && snapshot.calendar.status === 'ok'); config.lastAttemptAt = snapshot.updatedAt;
   const configTemp = file + '.' + randomUUID() + '.tmp'; writeFileSync(configTemp, JSON.stringify(config, null, 2) + '\n', 'utf8'); renameSync(configTemp, file); }
 }
 console.log(JSON.stringify({ written: true, mailShown: snapshot.mail.items.length, calendarShown: snapshot.calendar.items.length, mailStatus: snapshot.mail.status, calendarStatus: snapshot.calendar.status, verifiedAt: snapshot.updatedAt }));
}
