import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseBrief, type BriefView } from '../../shared/brief.js';
export function readBrief(dataDir: string): BriefView {
 const folder = join(dataDir, 'briefing'); const file = join(folder, 'snapshot.json');
 const monitor = { enabled: false, firstScheduledRunVerified: false, description: 'Automatic refresh is not configured.' };
 try {
  if (lstatSync(folder).isSymbolicLink() || realpathSync(folder).toLowerCase() !== join(realpathSync(dataDir), 'briefing').toLowerCase()) throw new Error('Invalid briefing location');
  try { const configFile = join(folder, 'monitor.json'); const configStat = lstatSync(configFile); if (configStat.isSymbolicLink() || configStat.size > 10000) throw new Error('Invalid monitor file');
   const config = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
   if (config.version === 1 && config.enabled === true) { monitor.enabled = true; monitor.firstScheduledRunVerified = config.firstScheduledRunVerified === true; monitor.description = 'Hourly, weekdays 8 AM–6 PM Central while this PC and Codex are available.'; }
  } catch { /* A missing monitor never implies an active schedule. */ }
  const stat = lstatSync(file); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256000) throw new Error('Invalid briefing cache');
  return { snapshot: parseBrief(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))), monitor };
 } catch (error) {
  const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
  return { monitor, problem: missing ? 'No verified inbox/calendar pull is available yet.' : 'The local briefing could not be verified. It has not been shown as current.' };
 }
}
