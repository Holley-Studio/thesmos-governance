export interface KnowledgeCitation {
 id:string; sourceId:string; citation:number; title:string; path:string; section:string; text:string;
 sourceUrl:string; documentHash:string; syncedAt:string; status:string; authority:number;
}
export interface RagBundle {
 scope:'studio'|'ohw'|'drive'; libraryId?:string; mode:'hybrid'|'keyword'; sources:KnowledgeCitation[]; warnings:string[];
 lastSyncedAt?:string; generation?:string; evidenceStatus:'ready'|'insufficient'|'unavailable';
}
export interface RagStatus {
 supported:boolean; scope?:'studio'|'ohw'; state:'empty'|'building'|'ready'|'stale'|'error';
 documents:number; passages:number; completed:number; total:number; model?:string; generation?:string;
 error?:string; warnings:string[]; lastSyncedAt?:string;
}
