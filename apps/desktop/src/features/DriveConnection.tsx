import {useEffect,useRef,useState} from 'react';
import type {DriveAuthStatus} from '../../shared/drive';
import {driveAuthStatus,configureDrive,connectDrive,disconnectDrive} from '../ipc/runtime';
import '../design/drive.css';

export function DriveConnection() {
 const [auth,setAuth]=useState<DriveAuthStatus>();
 const [operation,setOperation]=useState<'import'|'connect'|'disconnect'|''>('');
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const mounted=useRef(false);const revision=useRef(0);
 useEffect(()=>{
  mounted.current=true;let active=true,pending=false;
  const poll=async()=>{if(pending)return;pending=true;try{const result=await driveAuthStatus();if(active)setAuth(result);}catch{if(active)setError('Could not check the Google Drive connection.');}finally{pending=false;}};
  void poll();const timer=setInterval(()=>void poll(),2000);
  return()=>{active=false;mounted.current=false;++revision.current;clearInterval(timer);};
 },[]);
 const refresh=async()=>{const result=await driveAuthStatus();if(mounted.current)setAuth(result);};
 const run=async(action:'connect'|'disconnect')=>{
  const current=++revision.current;setError('');setNotice('');setOperation(action);
  try{await(action==='connect'?connectDrive():disconnectDrive());if(mounted.current&&current===revision.current){await refresh();setNotice(action==='connect'?'Google sign-in finished. Your Drive library is available in Knowledge.':'Google Drive disconnected. Its local library is unavailable.');}}
  catch(e){if(mounted.current&&current===revision.current)setError(e instanceof Error?e.message:'Google Drive could not complete this action.');}
  finally{if(mounted.current&&current===revision.current)setOperation('');}
 };
 const importConfig=async(file:File|undefined)=>{
  if(!file)return;setError('');setNotice('');setOperation('import');const current=++revision.current;
  try{
   if(file.size>16384)throw new Error('Choose a Google Desktop app client JSON smaller than 16 KiB.');
   let clientConfig=await file.text();
   try{JSON.parse(clientConfig);}catch{throw new Error('This file is not valid JSON. Choose the downloaded Google Desktop app client JSON.');}
   try{await configureDrive(clientConfig);}finally{clientConfig='';}
   if(mounted.current&&current===revision.current){await refresh();setNotice('Google Desktop app configuration saved. Select Connect Google Drive to sign in.');}
  }catch(e){if(mounted.current&&current===revision.current)setError(e instanceof Error?e.message:'Could not import the Google Desktop app configuration.');}
  finally{if(mounted.current&&current===revision.current)setOperation('');}
 };
 const signingIn=auth?.signingIn||operation==='connect';
 const label=!auth?'Checking connection…':signingIn?'Waiting for Google sign-in':auth.connected?'Connected · read-only':auth.configured?'Ready to sign in':'Google setup needed';
 return <section className="p-drive-connection" aria-labelledby="drive-connection-heading">
  <header className="p-drive-heading"><div><span className="p-eyebrow">LOCAL KNOWLEDGE CONNECTION</span><h2 id="drive-connection-heading">Google Drive</h2></div><span className="p-drive-state" role="status">{label}</span></header>
  <p>Connect your Google account to keep a searchable copy of readable Drive documents on this PC. Pantheon requests read-only access and never edits your Drive files.</p>
  {auth?.account&&<p className="p-drive-account">{auth.account.email}</p>}
  {!auth?.configured&&auth&&<div className="p-drive-setup"><h3>Set up your Google Desktop app</h3><p>In Google Cloud, enable the Drive API, configure the OAuth consent screen, and create a Desktop app client. Download its client JSON and import it below.</p><p className="p-muted">Your AI subscription is separate from this connection. You complete Google sign-in in your browser.</p></div>}
  <div className="p-drive-actions">
   {!auth?.connected&&!signingIn&&<label className="p-drive-file-label">{operation==='import'?'Importing configuration…':'Import Google client JSON'}<input type="file" accept=".json,application/json" aria-label="Import Google Desktop app client JSON" disabled={!auth||Boolean(operation)} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void importConfig(file);}}/></label>}
   {!auth?.connected&&!signingIn&&<button className="p-button p-primary" type="button" disabled={!auth?.configured||Boolean(operation)} onClick={()=>void run('connect')}>Connect Google Drive</button>}
   {(auth?.connected||signingIn)&&<button className="p-button" type="button" disabled={operation==='disconnect'} onClick={()=>void run('disconnect')}>{operation==='disconnect'?'Disconnecting…':signingIn?'Cancel sign-in':'Disconnect Google Drive'}</button>}
  </div>
  {signingIn&&<p role="status">Finish sign-in and consent in your browser. This screen updates while you wait.</p>}
  {auth?.connected&&<p className="p-muted">Sync checks for changes every five minutes while Pantheon runs. Select the Drive library in Knowledge or local chat to use it.</p>}
  {notice&&<p className="p-drive-notice" role="status">{notice}</p>}
  {(error||auth?.error)&&<p className="p-drive-warning" role="alert">{error||auth?.error}</p>}
 </section>;
}
