import {useEffect,useRef,useState} from 'react';
import type {DriveFileView,DriveStatus} from '../../shared/drive';
import type {RagBundle} from '../../shared/rag';
import {runtime,syncDrive,pauseDrive,resumeDrive,openDriveSource} from '../ipc/runtime';
import {KnowledgeSources} from './KnowledgeSources';
import '../design/drive.css';

const labels:Record<DriveStatus['state'],string>={disconnected:'Google Drive is disconnected',idle:'Connected',syncing:'Sync in progress',paused:'Sync paused',offline:'Offline · cached library',signin:'Google sign-in needed',error:'Sync needs attention'};
const fileLabels:Record<DriveFileView['status'],string>={queued:'Waiting to process',indexed:'Searchable',skipped:'Not searchable',failed:'Needs attention',removed:'Access removed'};
const pageSize=50;
function date(value:string|undefined){return value?new Date(value).toLocaleString():'Not yet completed';}

export function DriveLibrary({onAsk}:{onAsk:(question:string)=>void}){
 const [status,setStatus]=useState<DriveStatus>();const [files,setFiles]=useState<DriveFileView[]>([]);
 const [query,setQuery]=useState(''),[catalogQuery,setCatalogQuery]=useState(''),[offset,setOffset]=useState(0);
 const [results,setResults]=useState<RagBundle>();const [error,setError]=useState('');
 const [operation,setOperation]=useState('');const [searching,setSearching]=useState(false);
 const [loadingFiles,setLoadingFiles]=useState(false);
 const mounted=useRef(false),account=useRef(''),generation=useRef(0),request=useRef(0),searchRequest=useRef(0);
 const priorState=useRef<DriveStatus['state']|undefined>(undefined);
 const listing=useRef({offset:0,query:''});listing.current={offset,query:catalogQuery};
 const applyStatus=(next:DriveStatus)=>{
  const identity=next.state==='disconnected'?'':next.account?.id??'';
  if(identity!==account.current){account.current=identity;++generation.current;++request.current;++searchRequest.current;listing.current={offset:0,query:''};setResults(undefined);setFiles([]);setOffset(0);setCatalogQuery('');setQuery('');setSearching(false);setLoadingFiles(false);}
  if(next.state!==priorState.current&&['signin','offline','disconnected'].includes(next.state)){++searchRequest.current;setResults(undefined);setSearching(false);}
  priorState.current=next.state;
  setStatus(next);
 };
 const loadFiles=async()=>{
  const current=++request.current,epoch=generation.current,identity=account.current;
  if(!identity){setFiles([]);return;}
  setLoadingFiles(true);
  try{const result=await runtime.driveFiles(pageSize,listing.current.offset,listing.current.query);if(mounted.current&&epoch===generation.current&&identity===account.current&&current===request.current)setFiles(result);}
  catch(e){if(mounted.current&&epoch===generation.current&&current===request.current)setError(e instanceof Error?e.message:'Could not list Drive files.');}
  finally{if(mounted.current&&current===request.current)setLoadingFiles(false);}
 };
 useEffect(()=>{
  mounted.current=true;let active=true,pending=false;
  const poll=async()=>{if(pending)return;pending=true;try{const next=await runtime.driveStatus();if(!active)return;applyStatus(next);await loadFiles();}catch(e){if(active)setError(e instanceof Error?e.message:'Could not check the Drive library.');}finally{pending=false;}};
  void poll();const timer=setInterval(()=>void poll(),2000);
  return()=>{active=false;mounted.current=false;++generation.current;++request.current;++searchRequest.current;clearInterval(timer);};
 },[]);
 useEffect(()=>{if(mounted.current)void loadFiles();},[offset,catalogQuery]);
 const run=async(action:'sync'|'pause'|'resume')=>{
  if(operation)return;setOperation(action);setError('');const epoch=generation.current;
  try{await(action==='sync'?syncDrive():action==='pause'?pauseDrive():resumeDrive());const next=await runtime.driveStatus();if(mounted.current&&epoch===generation.current){applyStatus(next);await loadFiles();}}
  catch(e){if(mounted.current&&epoch===generation.current)setError(e instanceof Error?e.message:'Could not update Drive sync.');}
  finally{if(mounted.current)setOperation('');}
 };
 const search=async()=>{
  if(!query.trim()||!account.current)return;const current=++searchRequest.current,epoch=generation.current,identity=account.current;
  const question=query.trim();setError('');setSearching(true);setResults(undefined);setOffset(0);setCatalogQuery(question);
  try{const result=await runtime.driveSearch(question),next=await runtime.driveStatus();if(!mounted.current||epoch!==generation.current||current!==searchRequest.current)return;applyStatus(next);if(identity===account.current&&epoch===generation.current&&result.scope==='drive'&&result.libraryId===`drive:${identity}`)setResults(result);}
  catch(e){if(mounted.current&&epoch===generation.current&&current===searchRequest.current)setError(e instanceof Error?e.message:'Could not search Drive sources.');}
  finally{if(mounted.current&&current===searchRequest.current)setSearching(false);}
 };
 const connected=Boolean(status?.account)&&status?.state!=='disconnected';
 const usable=connected&&status?.state!=='signin'&&status?.state!=='offline';
 const syncAllowed=connected&&status?.state!=='signin';
 return <div className="p-drive-library">
  <section className="p-drive-hero" aria-labelledby="drive-library-heading">
   <span className="p-eyebrow">WHOLE DRIVE · LOCAL KNOWLEDGE</span><h2 id="drive-library-heading">Your Drive library.</h2>
   <p>Search readable documents across your connected account. Source text and its search index stay on this PC. Discovered documents remain source material for review.</p>
   <div className="p-drive-heading"><strong role="status">{status?labels[status.state]:'Checking Drive library…'}</strong>{status?.account&&<span className="p-drive-account">{status.account.email}</span>}</div>
   {!connected&&status&&<p>Connect Google Drive in Connections to start discovering your files.</p>}
   {connected&&<>
    <dl className="p-drive-counts"><div><dt>Discovered files</dt><dd>{status!.discovered.toLocaleString()}</dd></div><div><dt>Searchable documents</dt><dd>{status!.indexed.toLocaleString()}</dd></div><div><dt>Passages</dt><dd>{status!.passages.toLocaleString()}</dd></div><div><dt>Waiting</dt><dd>{status!.remaining.toLocaleString()}</dd></div><div><dt>Not searchable</dt><dd>{status!.skipped.toLocaleString()}</dd></div><div><dt>Need attention</dt><dd>{status!.failed.toLocaleString()}</dd></div></dl>
    <p className="p-muted">Last successful sync: {date(status?.lastSyncedAt)}{status?.nextSyncAt?` · Next check: ${date(status.nextSyncAt)}`:''}</p>
    {status?.state==='syncing'&&<p role="status">Discovery and extraction continue in the background. Coverage is incomplete until the scan finishes.</p>}
    {status?.state==='offline'&&<p className="p-drive-warning">These are dated cached sources. Current Drive permissions cannot be checked while offline.</p>}
    <div className="p-drive-actions"><button className="p-button" type="button" disabled={Boolean(operation)||!syncAllowed||status?.state==='syncing'} onClick={()=>void run('sync')}>{operation==='sync'?'Starting sync…':'Sync now'}</button>{status?.state==='paused'?<button className="p-button" type="button" disabled={Boolean(operation)||!syncAllowed} onClick={()=>void run('resume')}>Resume sync</button>:<button className="p-button" type="button" disabled={Boolean(operation)||!syncAllowed} onClick={()=>void run('pause')}>{status?.state==='syncing'?'Pause / cancel current scan':'Pause sync'}</button>}</div>
   </>}
   {status?.warnings.map((warning,i)=><p className="p-drive-warning" key={i}>{warning}</p>)}
   {(error||status?.error)&&<p className="p-drive-warning" role="alert">{error||status?.error}</p>}
  </section>
  {connected&&<>
   <section className="p-drive-search" aria-labelledby="drive-search-heading"><h3 id="drive-search-heading">Find a passage or ask your library</h3><form className="p-drive-search-row" onSubmit={event=>{event.preventDefault();void search();}}><label htmlFor="drive-source-query" className="p-drive-query-label">Search Drive sources</label><input id="drive-source-query" className="search-input" value={query} maxLength={1000} onChange={event=>setQuery(event.target.value)} placeholder="Find a decision, project or next step…"/><button className="p-button" type="submit" disabled={searching||!usable||!query.trim()}>{searching?'Searching…':'Search sources'}</button><button className="p-button p-primary" type="button" disabled={!usable||!query.trim()} onClick={()=>onAsk(query.trim())}>Ask with local AI</button></form><p className="p-muted">Asking selects the Drive library for a local chat turn. It uses source passages with citations; it does not approve policy or decisions.</p>{results&&<KnowledgeSources projectId="" bundle={results} heading="Drive source search results"/>}</section>
   <section className="p-drive-catalog" aria-labelledby="drive-catalog-heading"><div className="p-drive-heading"><h3 id="drive-catalog-heading">Discovered files</h3>{catalogQuery&&<button className="p-text-button" type="button" onClick={()=>{setCatalogQuery('');setQuery('');setOffset(0);setResults(undefined);}}>Clear filter</button>}</div><p className="p-muted">{catalogQuery?`Titles matching “${catalogQuery}”. `:''}Images, scans and unsupported formats remain visible with their coverage reason.</p>
    {!files.length&&<p role="status">{loadingFiles?'Loading files…':status?.state==='syncing'?'Files will appear as discovery progresses.':catalogQuery?'No matching file titles.':'No files have been discovered yet.'}</p>}
    <ul className="p-drive-file-list">{files.map(file=><li key={file.id}><div className="p-drive-file-head"><h4>{file.title}</h4><span className="p-drive-state" data-file-state={file.status}>{fileLabels[file.status]}</span></div>{file.reason&&<p className="p-drive-file-reason">{file.reason}</p>}<p className="p-muted">{file.mimeType}{file.modifiedTime?` · Modified ${date(file.modifiedTime)}`:''}{file.syncedAt?` · Indexed ${date(file.syncedAt)}`:''}</p><button type="button" className="p-text-button" disabled={file.status==='removed'} onClick={()=>{const epoch=generation.current;void openDriveSource(file.id).catch(e=>{if(mounted.current&&epoch===generation.current)setError(e instanceof Error?e.message:'Could not open this Drive source.');});}}>Open in Drive<span className="p-drive-sr-only">: {file.title}</span></button></li>)}</ul>
    <nav className="p-drive-pagination" aria-label="Drive file pages"><button className="p-button" type="button" disabled={!offset||loadingFiles} onClick={()=>setOffset(Math.max(0,offset-pageSize))}>Previous</button><span role="status">{files.length?`${offset+1}–${offset+files.length}`:'0'} files shown</span><button className="p-button" type="button" disabled={files.length<pageSize||loadingFiles} onClick={()=>setOffset(offset+pageSize)}>Next</button></nav>
   </section>
  </>}
 </div>;
}
