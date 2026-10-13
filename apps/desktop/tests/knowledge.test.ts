import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readKnowledge } from '../sidecar/studio/knowledge.js';
test('knowledge is client-scoped, excludes unregistered notes, and rejects changed snapshots', () => {
 const root=mkdtempSync(join(tmpdir(),'pantheon-knowledge-'));
 try {
  mkdirSync(join(root,'ohw'));mkdirSync(join(root,'studio'));mkdirSync(join(root,'inbox'));
  const text='## C14 — Google measurement call\n\n- Owner: Matthew\n- Status: Done\n- Next step: No call; DEC-2026-008.\n';
  writeFileSync(join(root,'ohw','tasks.md'),text);writeFileSync(join(root,'studio','tasks.md'),'Studio-only secret canary');writeFileSync(join(root,'inbox','notes.md'),'Unreviewed canary');
  const d={id:'tracker',scope:'ohw',path:'ohw/tasks.md',title:'OHW tasks',sourceUrl:'https://docs.google.com/spreadsheets/d/tracker/edit',syncedAt:new Date().toISOString(),status:'source-snapshot',allowedProviders:['ollama'],sha256:createHash('sha256').update(text).digest('hex')};
  writeFileSync(join(root,'manifest.json'),JSON.stringify({version:1,lastSyncedAt:d.syncedAt,documents:[d]}));
  const v=readKnowledge('ohw','C14',root);assert.equal(v.tasks[0].status,'Done');assert.equal(v.hits.length,1);assert.equal(v.stale,false);assert.ok(!JSON.stringify(v).includes('canary'));assert.equal(readKnowledge('studio','C14',root).hits.length,0);
  writeFileSync(join(root,'ohw','tasks.md'),text+'Changed');const bad=readKnowledge('ohw','C14',root);assert.equal(bad.documents,0);assert.equal(bad.hits.length,0);assert.match(bad.warnings.join(),/hash changed/);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('malformed registrations are excluded without losing valid knowledge', () => {
 const root=mkdtempSync(join(tmpdir(),'pantheon-knowledge-'));
 try {
  mkdirSync(join(root,'ohw')); const text='Reviewed roadmap'; writeFileSync(join(root,'ohw','roadmap.md'),text);
  const d={id:'roadmap',scope:'ohw',path:'ohw/roadmap.md',title:'Roadmap',sourceUrl:'https://docs.google.com/document/d/roadmap/edit',syncedAt:new Date().toISOString(),status:'source-snapshot',allowedProviders:['ollama'],sha256:createHash('sha256').update(text).digest('hex')};
  const bad=[null,{},[], {...d,sourceUrl:'javascript:alert(1)'}, {...d,path:'ohw/%2e%2e/roadmap.md'}, {...d,path:'ohw/roadmap.md:stream'}, {...d,title:42}, {...d,status:'unknown'}, {...d,authority:{toString:null}}, {...d,allowedProviders:'ollama'}];
  writeFileSync(join(root,'manifest.json'),JSON.stringify({version:1,lastSyncedAt:d.syncedAt,documents:[...bad,d]}));
  const v=readKnowledge('ohw','roadmap',root); assert.equal(v.documents,1); assert.equal(v.hits.length,1); assert.ok(v.warnings.length>=bad.length);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('literal percent filenames do not pass the registered Markdown path schema', () => {
 const root=mkdtempSync(join(tmpdir(),'pantheon-knowledge-'));
 try {
  mkdirSync(join(root,'ohw'));const text='Literal percent source'; writeFileSync(join(root,'ohw','tax%20plan.md'),text);
  const d={id:'tax',scope:'ohw',path:'ohw/tax%20plan.md',title:'Tax plan',sourceUrl:'https://docs.google.com/document/d/tax/edit',syncedAt:new Date().toISOString(),status:'source-snapshot',allowedProviders:['ollama'],sha256:createHash('sha256').update(text).digest('hex')};
  writeFileSync(join(root,'manifest.json'),JSON.stringify({version:1,documents:[d]}));const v=readKnowledge('ohw','percent',root);assert.equal(v.documents,0);assert.match(v.warnings.join(),/Invalid source registration/);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('malformed or linked manifest fails closed with an actionable view', () => {
 const root=mkdtempSync(join(tmpdir(),'pantheon-knowledge-')); const outside=mkdtempSync(join(tmpdir(),'pantheon-outside-'));
 try {
  writeFileSync(join(root,'manifest.json'),'{'); const malformed=readKnowledge('ohw','',root); assert.equal(malformed.connected,false); assert.ok(malformed.warnings.length);
  rmSync(join(root,'manifest.json')); writeFileSync(join(outside,'manifest.json'),JSON.stringify({version:1,documents:[]}));
  symlinkSync(outside,join(root,'linked'),'junction');
  // A linked root manifest must never provide trusted registrations.
  const linked=readKnowledge('ohw','',join(root,'linked')); assert.equal(linked.connected,false); assert.ok(linked.warnings.length);
 } finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('knowledge folder junctions cannot expose snapshots outside its root', () => {
 const root=mkdtempSync(join(tmpdir(),'pantheon-knowledge-')); const outside=mkdtempSync(join(tmpdir(),'pantheon-outside-'));
 try {
  const text='Private escape canary'; writeFileSync(join(outside,'note.md'),text); symlinkSync(outside,join(root,'ohw'),'junction');
  const d={id:'note',scope:'ohw',path:'ohw/note.md',title:'Note',sourceUrl:'https://docs.google.com/document/d/note/edit',syncedAt:new Date().toISOString(),status:'source-snapshot',allowedProviders:['ollama'],sha256:createHash('sha256').update(text).digest('hex')};
  writeFileSync(join(root,'manifest.json'),JSON.stringify({version:1,documents:[d]})); const v=readKnowledge('ohw','canary',root); assert.equal(v.documents,0); assert.ok(v.warnings.length); assert.ok(!JSON.stringify(v).includes(text));
 } finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
