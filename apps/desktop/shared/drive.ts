export interface DriveAccount { id:string; email:string }
export type DriveState = 'disconnected'|'idle'|'syncing'|'paused'|'offline'|'signin'|'error';
export interface DriveStatus {
 state:DriveState; account?:DriveAccount; discovered:number; indexed:number; passages:number;
 skipped:number; failed:number; remaining:number; lastSyncedAt?:string; nextSyncAt?:string;
 error?:string; warnings:string[];
}
export interface DriveFileView { id:string; title:string; mimeType:string; status:'queued'|'indexed'|'skipped'|'failed'|'removed'; reason?:string; modifiedTime?:string; syncedAt?:string; url:string }
export interface DriveAuthStatus { configured:boolean; connected:boolean; signingIn:boolean; account?:DriveAccount; error?:string }
export interface DriveRemoteFile {
 id:string; name?:string; mimeType?:string; modifiedTime?:string; version?:string; size?:string;
 trashed?:boolean; parents?:string[]; webViewLink?:string;
 capabilities?:{canDownload?:boolean}; shortcutDetails?:{targetId?:string;targetMimeType?:string};
}
