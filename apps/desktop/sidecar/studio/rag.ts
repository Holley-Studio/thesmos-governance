import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { EmbeddingProvider } from '../../../../thesmos/runtime/types.js';
import { cosineSimilarity } from '../../../../thesmos/memory/retrieve.js';
import { OllamaProvider } from '../../../../thesmos/runtime/providers/ollama/provider.js';
import type { KnowledgeCitation, RagBundle, RagStatus } from '../../shared/rag.js';
import { StudioStore, registeredProjectKind } from './store.js';
import { readKnowledgeInventory, knowledgeRoot, knowledgeTerms, type KnowledgeInventory } from './knowledge.js';

interface Passage extends Omit<KnowledgeCitation,'citation'> { key:string; vector?:number[] }
interface Index {version:1;scope:'studio'|'ohw';generation:string;fingerprint:string;model:string;dimensions:number;passages:Passage[];warnings:string[]}
export interface RagOptions {
 /** Dependency injection for isolated tests; production RPC exposes none of these options. */
 knowledgeRoot?:string; scopeForRoot?:(root:string)=>'studio'|'ohw'|'client'; embeddingProvider?:EmbeddingProvider; model?:string;
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const abort=()=>new Error('Knowledge operation cancelled');
const validVector=(v:unknown):v is number[]=>Array.isArray(v)&&v.length>0&&v.length<=8192&&v.every(n=>typeof n==='number'&&Number.isFinite(n))&&v.some(n=>n!==0);
const fingerprint=(i:KnowledgeInventory)=>hash(JSON.stringify({connected:i.connected,lastSyncedAt:i.lastSyncedAt,docs:i.documents.map(d=>[d.id,d.sha256,d.syncedAt,d.status,d.sourceUrl,d.allowedProviders,d.authority])}));
function chunks(inventory:KnowledgeInventory):Passage[] {
 const passages:Passage[]=[];
 for(const d of inventory.documents){
  if(d.stale)continue;
  let ordinal=0;
  for(const block of d.content.split(/(?=^#{1,6} )/m)){
   const section=(/^#{1,6}\s+(.+)$/m.exec(block)?.[1]??d.title).slice(0,500);
   // Keep task/heading blocks together; bounded overlap for long narrative sections.
   for(let offset=0;offset<block.length;offset+=1200){
    const text=block.slice(offset,offset+1500).trim();if(!text)continue;
    const id=`${d.id}:${++ordinal}:${hash(text).slice(0,12)}`;
    passages.push({id,key:hash(d.id+'\n'+text),sourceId:d.id,title:d.title,path:d.path,section,text,sourceUrl:d.sourceUrl,documentHash:d.sha256,syncedAt:d.syncedAt,status:d.status,authority:d.authority??0});
   }
  }
 }
 return passages;
}
export function isLocalEmbeddingModel(value:unknown):boolean {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const info=value as Record<string,unknown>;const details=info.details as Record<string,unknown>|undefined;
 return !info.remote_host&&!info.remote_model&&!!details&&details.format==='gguf'&&Array.isArray(info.capabilities)&&info.capabilities.includes('embedding');
}
const endpoint='http://127.0.0.1:11434';
const localFetch:typeof fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.origin!==endpoint||url.username||url.password)throw Error('Private embeddings require the local Ollama endpoint');
 return fetch(input,{...init,redirect:'error',signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(30_000)])});
};

export class RagService {
 private readonly folder:string;
 private readonly provider:EmbeddingProvider;
 private readonly model:string;
 private readonly indices=new Map<string,Index>();
 private readonly warnings=new Map<string,string[]>();
 private readonly builds=new Map<string,{controller:AbortController;status:RagStatus}>();
 private readonly searches=new Map<AbortController,string>();
 private stopped=false;
 constructor(dataDir:string,private readonly store:StudioStore,private readonly currentRoot:()=>string|undefined,private readonly options:RagOptions={}){
  this.folder=join(dataDir,'rag');mkdirSync(this.folder,{recursive:true});
  this.model=options.model??'nomic-embed-text:latest';
  this.provider=options.embeddingProvider??new OllamaProvider({baseUrl:endpoint,fetchImpl:localFetch});
  if(this.provider.id!=='ollama')throw Error('Private embeddings permit only Ollama');
  for(const scope of ['studio','ohw'] as const){
   try{
    const path=join(this.folder,scope+'.json');if(statSync(path).size>32_000_000)throw Error('Index too large');
    const index=JSON.parse(readFileSync(path,'utf8')) as Index;
    if(index.version!==1||index.scope!==scope||typeof index.generation!=='string'||typeof index.fingerprint!=='string'||typeof index.model!=='string'||!Number.isInteger(index.dimensions)||index.dimensions<0||index.dimensions>8192||!Array.isArray(index.passages)||index.passages.length>20_000||!Array.isArray(index.warnings)||!index.warnings.every(w=>typeof w==='string')||index.passages.some(p=>!p||typeof p.key!=='string'||(index.dimensions>0&&(!validVector(p.vector)||p.vector.length!==index.dimensions))||(index.dimensions===0&&p.vector!==undefined)))throw Error('Invalid index');
    this.indices.set(scope,index);
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.warnings.set(scope,['Saved knowledge index could not be read. Rebuild it.']);}
  }
 }
 private access(projectId:string){
  if(this.stopped)throw Error('Knowledge service has stopped');
  const project=this.store.project(projectId);const root=this.currentRoot();
  let same=false;try{same=!!root&&realpathSync.native(project.root).toLowerCase()===realpathSync.native(root).toLowerCase();}catch{same=false;}
  if(!same)throw Error('Open this project before reading its knowledge');
  const scope=(this.options.scopeForRoot??registeredProjectKind)(project.root);
  if(scope==='client')throw Error('Private knowledge is not registered for this client project');
  return scope;
 }
 private inventory(scope:'studio'|'ohw'){return readKnowledgeInventory(scope,this.options.knowledgeRoot??knowledgeRoot());}
 status(projectId:string):RagStatus{
  const scope=this.access(projectId);const inventory=this.inventory(scope);const index=this.indices.get(scope);const build=this.builds.get(projectId);
  if(build)return {...build.status,warnings:[...build.status.warnings,...inventory.warnings]};
  const failed=(this.warnings.get(scope)??[]).some(w=>w.startsWith('Knowledge rebuild failed:'));
  const warning=[...(this.warnings.get(scope)??[]),...inventory.warnings,...(index?.warnings??[])];
  return {supported:true,scope,state:failed?'error':!inventory.connected?(warning.length?'error':'empty'):inventory.stale||(index&&index.fingerprint!==fingerprint(inventory))?'stale':index?'ready':'empty',documents:inventory.documents.length,passages:index?.passages.length??0,completed:0,total:0,model:this.model,generation:index?.generation,warnings:warning,lastSyncedAt:inventory.lastSyncedAt,error:(failed||!inventory.connected)&&warning.length?warning[0]:undefined};
 }
 rebuild(projectId:string):{accepted:true;status:RagStatus}{
  const scope=this.access(projectId);this.cancel(projectId);
  const inventory=this.inventory(scope);const passages=chunks(inventory);const controller=new AbortController();
  const status:RagStatus={supported:true,scope,state:'building',documents:inventory.documents.length,passages:passages.length,completed:0,total:passages.length,model:this.model,warnings:[...inventory.warnings],lastSyncedAt:inventory.lastSyncedAt,generation:this.indices.get(scope)?.generation};
  this.builds.set(projectId,{controller,status});void this.build(projectId,scope,inventory,passages,controller,status);
  return {accepted:true,status:{...status}};
 }
 cancel(projectId:string):RagStatus{this.access(projectId);for(const [controller,id] of this.searches)if(id===projectId)controller.abort();this.builds.get(projectId)?.controller.abort();this.builds.delete(projectId);return this.status(projectId);}
 private check(projectId:string,scope:string,signal:AbortSignal){if(signal.aborted||this.access(projectId)!==scope)throw abort();}
 private async modelSpace(signal:AbortSignal):Promise<string>{
  if(this.options.embeddingProvider)return this.model;
  const response=await localFetch('http://127.0.0.1:11434/api/tags',{signal});if(!response.ok)throw Error('Local embedding service unavailable');
  const data=await response.json() as {models?:{name?:string;digest?:string;remote_host?:string;remote_model?:string}[]};
  const tag=data.models?.find(m=>m.name===this.model);
  if(!tag||tag.remote_host||tag.remote_model||typeof tag.digest!=='string'||!tag.digest)throw Error('Install the local nomic-embed-text model to enable semantic search');
  const shown=await localFetch('http://127.0.0.1:11434/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.model}),signal});
  if(!shown.ok||!isLocalEmbeddingModel(await shown.json()))throw Error('Semantic search requires a local GGUF embedding model; remote models are not permitted');
  return this.model+':'+tag.digest;
 }
 private async build(projectId:string,scope:'studio'|'ohw',inventory:KnowledgeInventory,passages:Passage[],controller:AbortController,status:RagStatus){
  let staged:string|undefined;
  try{
   if(!inventory.connected)throw Error('Refresh the registered knowledge snapshots before rebuilding');
   const initial=fingerprint(inventory);let space=this.model;let dimensions=0;const warnings=[...inventory.warnings];
   try{
    space=await this.modelSpace(controller.signal);this.check(projectId,scope,controller.signal);
    const previous=this.indices.get(scope);const reusable=new Map(previous?.model===space?previous.passages.map(p=>[p.key,p]):[]);
    for(const p of passages){
     this.check(projectId,scope,controller.signal);
     const old=reusable.get(p.key);const vectors=old?.vector?[old.vector]:await this.provider.embed(this.model,['search_document: '+p.text],controller.signal);
     if(vectors.length!==1)throw Error('Embedding provider returned an invalid number of vectors');
     const vector=vectors[0];
     this.check(projectId,scope,controller.signal);
     if(!validVector(vector)||(dimensions&&vector.length!==dimensions))throw Error('Embedding dimensions changed or vector invalid');
     dimensions=vector.length;p.vector=vector;status.completed++;
    }
   }catch(error){
    this.check(projectId,scope,controller.signal);
    for(const p of passages)delete p.vector;dimensions=0;status.completed=passages.length;
    warnings.push('Semantic search unavailable; using keyword search. '+(error instanceof Error?error.message:'Local embedding failure'));
   }
   this.check(projectId,scope,controller.signal);
   if(initial!==fingerprint(this.inventory(scope)))throw Error('Knowledge changed during rebuild. Rebuild again.');
   const index:Index={version:1,scope,generation:randomUUID(),fingerprint:initial,model:space,dimensions,passages,warnings};
   staged=join(this.folder,`${scope}-${index.generation}.tmp`);writeFileSync(staged,JSON.stringify(index),'utf8');
   const target=join(this.folder,scope+'.json');
   for(let attempt=0;;attempt++){
    this.check(projectId,scope,controller.signal);
    if(initial!==fingerprint(this.inventory(scope)))throw Error('Knowledge changed during rebuild');
    try{renameSync(staged,target);break;}catch(error){if(attempt>=4||!['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;await new Promise(r=>setTimeout(r,25*(attempt+1)));}
   }
   this.indices.set(scope,index);this.warnings.delete(scope);
  }catch(error){
   if(!controller.signal.aborted)this.warnings.set(scope,['Knowledge rebuild failed: '+(error instanceof Error?error.message:'Unknown error')]);
  }finally{
   if(staged){
    try{rmSync(staged,{force:true});}
    catch{this.warnings.set(scope,[...(this.warnings.get(scope)??[]),'Knowledge staging file could not be removed; the saved index remains intact.']);}
   }
   if(this.builds.get(projectId)?.controller===controller)this.builds.delete(projectId);
  }
 }
 async search(projectId:string,query:string,signal?:AbortSignal):Promise<RagBundle>{
  const scope=this.access(projectId);if(typeof query!=='string'||query.length>8000)throw Error('Use a valid knowledge question');
  const controller=new AbortController();this.searches.set(controller,projectId);const combined=AbortSignal.any([controller.signal,...(signal?[signal]:[])]);
  try{
   this.check(projectId,scope,combined);let inventory=this.inventory(scope);const initial=fingerprint(inventory);const index=this.indices.get(scope);
   const warnings=[...(this.warnings.get(scope)??[]),...inventory.warnings];const passages=chunks(inventory);let mode:'hybrid'|'keyword'='keyword';let queryVector:number[]|undefined;
   if(inventory.stale)warnings.push('Some snapshots are stale; refresh through Codex. Stale documents are excluded.');
   if(index?.dimensions){
    try{
     const space=await this.modelSpace(combined);this.check(projectId,scope,combined);
     if(space!==index.model)throw Error('Embedding model changed. Rebuild the knowledge index.');
     const vectors=await this.provider.embed(this.model,['search_query: '+query],combined);this.check(projectId,scope,combined);
     if(vectors.length!==1||!validVector(vectors[0])||vectors[0].length!==index.dimensions)throw Error('Embedding dimensions changed. Rebuild the knowledge index.');
     queryVector=vectors[0];mode='hybrid';
    }catch(error){this.check(projectId,scope,combined);warnings.push(error instanceof Error?error.message:'Semantic search unavailable');}
   }
   if(mode==='keyword')warnings.push('Using keyword search; rebuild with the local embedding model for semantic search.');
   this.check(projectId,scope,combined);inventory=this.inventory(scope);
   if(initial!==fingerprint(inventory))return {scope,mode,sources:[],warnings:[...warnings,'Knowledge changed during search. Ask again.'],evidenceStatus:'unavailable'};
   const indexed=new Map(index?.passages.map(p=>[p.key,p])??[]);const needle=knowledgeTerms(query);
   const ids=query.match(/\b(?:[CMSL]\d{2}|DEC-\d{4}-\d+)\b/gi)??[];
   const ranked=passages.map(p=>{
    const bag=knowledgeTerms(p.title+' '+p.section+' '+p.text);const lexical=needle.length?needle.filter(t=>bag.includes(t)).length/needle.length:0;
    const exact=ids.some(id=>p.text.toLowerCase().includes(id.toLowerCase()));
    const vector=indexed.get(p.key)?.vector;const semantic=queryVector&&vector?cosineSimilarity(queryVector,vector):0;
    // Semantic-only matches must clear a conservative floor; common words alone cannot answer.
    const eligible=ids.length?exact:lexical>=0.34||semantic>=0.72;
    return {p,eligible,score:(exact?3:0)+lexical+Math.max(0,semantic)*0.85+p.authority/1000};
   }).filter(r=>r.eligible).sort((a,b)=>b.score-a.score||a.p.id.localeCompare(b.p.id));
   const sources:KnowledgeCitation[]=ranked.slice(0,6).map(({p},i)=>{const {key,vector,...citation}=p;return {...citation,citation:i+1};});
   return {scope,mode,sources,warnings,lastSyncedAt:inventory.lastSyncedAt,generation:index?.generation,evidenceStatus:!inventory.connected?'unavailable':sources.length?'ready':'insufficient'};
  }finally{this.searches.delete(controller);}
 }
 source(projectId:string,sourceId:string):{url:string}{
  const scope=this.access(projectId);const document=this.inventory(scope).documents.find(d=>d.id===sourceId&&!d.stale);
  if(!document)throw Error('This knowledge source is no longer available or permitted');
  return {url:document.sourceUrl};
 }
 shutdown():void{this.stopped=true;for(const b of this.builds.values())b.controller.abort();for(const s of this.searches.keys())s.abort();this.builds.clear();}
}
