import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { KnowledgeView } from '../../shared/studio.js';

export const knowledgeRoot = () => join(homedir(), 'Documents', 'Holley Studio Knowledge');
const stops = new Set('a an the is are was were to of in on for and or with what who how can do does our this that should we it my about'.split(' '));
export const knowledgeTerms = (text: string) => [...new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !stops.has(t)))];
const statuses = new Set(['source-snapshot', 'reviewed', 'approved', 'superseded', 'unreviewed', 'unavailable', 'blocked', 'revoked']);
export interface KnowledgeRegistration {
  id: string; scope: 'ohw' | 'studio'; path: string; title: string; sha256: string;
  syncedAt: string; status: string; sourceUrl: string; allowedProviders: string[]; authority?: number;
}
const safeSourceUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
};
const safeRegistration = (value: unknown): value is KnowledgeRegistration => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  // Registered paths are local relative Markdown names, never URLs or encoded paths.
  return (d.scope === 'ohw' || d.scope === 'studio') && typeof d.path === 'string' && d.path.length <= 240
    && /^(ohw|studio)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md$/.test(d.path) && d.path.startsWith(d.scope + '/')
    && typeof d.id === 'string' && d.id.length > 0 && d.id.length <= 200
    && typeof d.title === 'string' && d.title.length > 0 && d.title.length <= 500
    && typeof d.sha256 === 'string' && /^[a-f0-9]{64}$/.test(d.sha256)
    && typeof d.syncedAt === 'string' && d.syncedAt.length <= 100
    && typeof d.status === 'string' && statuses.has(d.status) && safeSourceUrl(d.sourceUrl)
    && (d.authority === undefined || (typeof d.authority === 'number' && Number.isFinite(d.authority) && d.authority >= 0 && d.authority <= 100))
    && Array.isArray(d.allowedProviders) && d.allowedProviders.length <= 20 && d.allowedProviders.every(p => typeof p === 'string');
};
const outside = (root: string, file: string) => {
  const rel = relative(root, file);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
};
export interface KnowledgeDocument extends KnowledgeRegistration { content:string; stale:boolean }
export interface KnowledgeInventory { scope:'ohw'|'studio'; root:string; connected:boolean; documents:KnowledgeDocument[]; stale:boolean; warnings:string[]; lastSyncedAt?:string }
export function readKnowledgeInventory(scope:'ohw'|'studio', root=knowledgeRoot()):KnowledgeInventory {
  const view:KnowledgeInventory = {scope,root,connected:false,documents:[],stale:true,warnings:[]};
  const manifest = join(root, 'manifest.json');
  if (!existsSync(manifest)) return view;
  let m: { version: number; documents: unknown[]; lastSyncedAt?: unknown };
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync.native(root);
    if (lstatSync(root).isSymbolicLink() || lstatSync(manifest).isSymbolicLink() || outside(canonicalRoot, realpathSync.native(manifest))) throw new Error('Knowledge manifest must be a local unlinked file');
    const stat = statSync(manifest);
    if (!stat.isFile() || stat.size > 100_000) throw new Error('Knowledge manifest is invalid or too large');
    m = JSON.parse(readFileSync(manifest, 'utf8'));
    if (!m || m.version !== 1 || !Array.isArray(m.documents) || m.documents.length > 100) throw new Error('Unsupported knowledge manifest');
  } catch (error) {
    view.warnings.push(error instanceof Error ? `Knowledge unavailable: ${error.message}` : 'Knowledge manifest could not be read.');
    return view;
  }
  view.connected = true;
  view.lastSyncedAt = typeof m.lastSyncedAt === 'string' ? m.lastSyncedAt : undefined;
  view.stale = !view.lastSyncedAt || !Number.isFinite(Date.parse(view.lastSyncedAt)) || Date.now() - Date.parse(view.lastSyncedAt) > 7 * 86400_000;
  for (const registration of m.documents) {
    if (!safeRegistration(registration)) { view.warnings.push('Invalid source registration excluded.'); continue; }
    const d = registration;
    if (d.scope !== scope) continue;
    if (m.documents.filter(v => safeRegistration(v) && v.scope === scope && v.id === d.id).length !== 1) { view.warnings.push(`${d.title}: duplicate source identity excluded`); continue; }
    if (['superseded', 'unreviewed'].includes(d.status)) continue;
    if (['unavailable', 'blocked', 'revoked'].includes(d.status)) { view.warnings.push(`${d.title}: source ${d.status}`); continue; }
    if (!Array.isArray(d.allowedProviders) || !d.allowedProviders.includes('ollama')) continue;
    const file = join(root, d.path);
    if (!existsSync(file)) { view.warnings.push(`${d.title}: snapshot missing`); continue; }
    let content: string;
    try {
      if (outside(canonicalRoot, realpathSync.native(file)) || lstatSync(file).isSymbolicLink() || !statSync(file).isFile() || statSync(file).size > 100_000) { view.warnings.push(`${d.title}: unsafe path excluded`); continue; }
      content = readFileSync(file, 'utf8');
    } catch { view.warnings.push(`${d.title}: snapshot could not be read`); continue; }
    if (createHash('sha256').update(content).digest('hex') !== d.sha256) { view.warnings.push(`${d.title}: hash changed; refresh required`); continue; }
    if (/-----BEGIN .*PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{20,}/.test(content)) { view.warnings.push(`${d.title}: potential secret excluded`); continue; }
    if (Date.now() - Date.parse(d.syncedAt) > 7 * 86400_000 || !Number.isFinite(Date.parse(d.syncedAt))) view.stale = true;
    view.documents.push({...d,content,stale: !Number.isFinite(Date.parse(d.syncedAt)) || Date.now()-Date.parse(d.syncedAt)>7*86400_000});

  }
  if(view.warnings.length) view.stale=true;
  return view;
}
export function readKnowledge(scope:'ohw'|'studio',query='',root=knowledgeRoot()):KnowledgeView {
 const inventory=readKnowledgeInventory(scope,root);
 const view:KnowledgeView={...inventory,documents:inventory.documents.length,hits:[],tasks:[],bridge:'Codex refreshes Drive snapshots; this app reads them locally.'};
 const needle=knowledgeTerms(query.slice(0,1000));
 for(const d of inventory.documents) {
 const content=d.content;
    if (d.path.endsWith('/tasks.md')) {
      view.taskSourceUrl = d.sourceUrl;
      for (const block of content.split(/(?=^## )/m)) {
        const title = /^## ([CMSL]\d{2}) — (.+)$/m.exec(block);
        if (!title) continue;
        const field = (name: string) => new RegExp(`^- ${name}: (.*)$`, 'm').exec(block)?.[1] ?? '';
        view.tasks.push({ id: title[1], title: title[2], owner: field('Owner'), status: field('Status'), nextStep: field('Next step'), due: field('Due') });
      }
    }
    if (!needle.length) continue;
    let passage = 0;
    for (const section of content.split(/(?=^#{1,3} )/m)) {
      for (let i = 0; i < section.length; i += 1200) {
        passage++;
        const text = section.slice(i, i + 1500).trim(); const bag = knowledgeTerms(text);
        const matches = needle.filter((t) => bag.includes(t));
        if (!matches.length) continue;
        const score = matches.length / needle.length * 10 + (d.authority ?? 0) / 100;
        view.hits.push({ id: `${d.id}:${passage}`, title: d.title, path: d.path, text, sourceUrl: d.sourceUrl, syncedAt: d.syncedAt, status: d.status, score });
      }
    }
  }
  view.hits.sort((a, b) => b.score - a.score);
  view.hits = view.hits.slice(0, 8);
  if (view.warnings.length) view.stale = true;
  return view;
}
