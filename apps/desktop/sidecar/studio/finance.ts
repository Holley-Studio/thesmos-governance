import {readFileSync,writeFileSync,renameSync,copyFileSync,existsSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {accountLabel,analyzeFinance,checkedMapping,csvTable,financeDate,financeTotals,FINANCE_CURRENCIES,type FinanceAccount,type FinanceCurrency,type FinanceInput,type FinanceLedger,type FinancePreview,type FinanceRow} from '../../shared/finance.js';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid finance data.');return v as Record<string,unknown>;};
const integer=(v:unknown,max:number)=>{if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>max)throw Error('Invalid finance count.');return Number(v);};
const short=(v:unknown,max:number)=>{if(typeof v!=='string'||!v||v.length>max||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(v))throw Error('Invalid finance text.');return v;};
const hash=(v:unknown)=>{const s=short(v,64);if(!/^[0-9a-f]{64}$/.test(s))throw Error('Invalid source hash.');return s;};
const uuid=(v:unknown)=>{const s=short(v,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s))throw Error('Invalid finance identity.');return s;};
const timestamp=(v:unknown)=>{const s=short(v,40);if(!/^\d{4}-\d\d-\d\dT/.test(s)||!Number.isFinite(Date.parse(s)))throw Error('Invalid finance import time.');return s;};
function inputFrom(params:Record<string,unknown>):FinanceInput {
 const fileName=short(params.fileName,200);if(!/\.csv$/i.test(fileName)||/[\\/]/.test(fileName))throw Error('Choose a CSV filename.');
 if(typeof params.content!=='string')throw Error('Choose a CSV export.');
 const table=csvTable(params.content);return {fileName,content:params.content,account:accountLabel(params.account),currency:params.currency as FinanceCurrency,mapping:checkedMapping(params.mapping,table[0].length)};
}
export class FinanceStore {
 constructor(private readonly dataDir:string){}
 private folder(name='finance'):string {
  const folder=join(this.dataDir,name);if(!existsSync(folder))mkdirSync(folder,{recursive:true});
  if(lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory()||realpathSync(folder).toLowerCase()!==join(realpathSync(this.dataDir),name).toLowerCase())throw Error('Finance location cannot be verified.');return folder;
 }
 private safeFile(file:string):void {if(existsSync(file)){const stat=lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>12_000_000)throw Error('Finance file cannot be verified.');}}
 read():FinanceLedger {
  const file=join(this.folder(),'ledger.json');if(!existsSync(file))return {version:1,revision:0,accounts:[],audit:[]};this.safeFile(file);
  let raw:unknown;try{raw=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('The saved finance snapshot is unreadable. Restore a verified backup before importing.');}
  const v=obj(raw);if(v.version!==1||!Array.isArray(v.accounts)||v.accounts.length>10||!Array.isArray(v.audit)||v.audit.length>100)throw Error('Unsupported finance snapshot.');
  const revision=integer(v.revision,1_000_000);let totalRows=0;
  const accounts:FinanceAccount[]=v.accounts.map(raw=>{const a=obj(raw);const currency=a.currency as FinanceCurrency;if(!FINANCE_CURRENCIES.includes(currency)||!Array.isArray(a.transactions)||a.transactions.length>10_000)throw Error('Invalid finance account.');totalRows+=a.transactions.length;if(totalRows>20_000)throw Error('Finance row limit exceeded.');
   const transactions:FinanceRow[]=a.transactions.map(raw=>{const r=obj(raw);if(!Number.isSafeInteger(r.amountCents)||Math.abs(Number(r.amountCents))>1_000_000_000_000)throw Error('Invalid saved amount.');return {record:integer(r.record,10_001),date:financeDate(short(r.date,10),'iso'),description:short(r.description,250),category:short(r.category,120),amountCents:Number(r.amountCents),transactionId:r.transactionId===undefined?undefined:short(r.transactionId,200),repeated:r.repeated===true};});
   const sourceRecords=integer(a.sourceRecords,10_000),excludedUnposted=integer(a.excludedUnposted,10_000);
   if(sourceRecords!==transactions.length+excludedUnposted||transactions.some(r=>r.record<2||r.record>sourceRecords+1)||new Set(transactions.map(r=>r.record)).size!==transactions.length||(transactions.some(r=>r.repeated)&&a.repeatedAcknowledged!==true))throw Error('Saved finance records do not reconcile.');
   financeTotals(transactions);return {id:uuid(a.id),label:accountLabel(a.label),currency,importedAt:timestamp(a.importedAt),fileName:short(a.fileName,200),fileHash:hash(a.fileHash),mapping:checkedMapping(a.mapping,64),sourceRecords,excludedUnposted,repeatedAcknowledged:a.repeatedAcknowledged===true,transactions};
  });
  if(new Set(accounts.map(a=>a.label.toLowerCase())).size!==accounts.length||new Set(accounts.map(a=>a.id)).size!==accounts.length)throw Error('Duplicate saved account.');
  const audit=v.audit.map(raw=>{const a=obj(raw);return {at:timestamp(a.at),accountId:uuid(a.accountId),fileHash:hash(a.fileHash),previousHash:a.previousHash===undefined?undefined:hash(a.previousHash),revision:integer(a.revision,1_000_000),rows:integer(a.rows,10_000)};});return {version:1,revision,accounts,audit};
 }
 preview(params:Record<string,unknown>):FinancePreview {
  const input=inputFrom(params);const ledger=this.read(),prior=ledger.accounts.find(a=>a.label.toLowerCase()===input.account.toLowerCase());
  if(prior&&prior.currency!==input.currency)throw Error('This account uses a different currency. Name a separate account for each currency.');
  const result=analyzeFinance(input),fileHash=sha(input.content);const previewKey=sha(JSON.stringify({revision:ledger.revision,fileHash,fileName:input.fileName,account:input.account,currency:input.currency,mapping:input.mapping}));return {...result,revision:ledger.revision,fileHash,previewKey,replacing:Boolean(prior),unchanged:Boolean(prior&&prior.fileHash===fileHash&&JSON.stringify(prior.mapping)===JSON.stringify(input.mapping))};
 }
 commit(params:Record<string,unknown>):FinanceLedger {
  if(params.confirm!==true)throw Error('Review the date format, amount direction, currency and posted status before saving.');
  const input=inputFrom(params),preview=this.preview(params),ledger=this.read();if(params.revision!==ledger.revision||preview.revision!==ledger.revision||params.fileHash!==preview.fileHash||params.previewKey!==preview.previewKey)throw Error('The finance data or import changed. Preview again before saving.');
  if(preview.invalidRows||!preview.transactions.length)throw Error('Resolve invalid records and include at least one posted transaction before saving.');
  if(preview.repeatedRows&&params.acknowledgeRepeated!==true)throw Error('Verify the repeated-looking records represent separate transactions. They will all be included.');
  if(preview.unchanged)return ledger;
  const prior=ledger.accounts.find(a=>a.label.toLowerCase()===input.account.toLowerCase());if(!prior&&ledger.accounts.length>=10)throw Error('The pilot supports at most ten account snapshots.');
  const at=new Date().toISOString();const account:FinanceAccount={id:prior?.id??randomUUID(),label:input.account,currency:input.currency,importedAt:at,fileName:input.fileName,fileHash:preview.fileHash,mapping:input.mapping,sourceRecords:preview.sourceRecords,excludedUnposted:preview.excludedUnposted,repeatedAcknowledged:params.acknowledgeRepeated===true,transactions:preview.transactions};
  const accounts=[...ledger.accounts.filter(a=>a.id!==account.id),account];if(accounts.reduce((n,a)=>n+a.transactions.length,0)>20_000)throw Error('The pilot supports at most 20,000 saved rows across accounts.');
  const revision=ledger.revision+1;if(revision>1_000_000)throw Error('Finance revision limit reached.');
  const next:FinanceLedger={version:1,revision,accounts,audit:[...ledger.audit,{at,accountId:account.id,fileHash:account.fileHash,previousHash:prior?.fileHash,revision,rows:account.transactions.length}].slice(-100)};
  const folder=this.folder(),file=join(folder,'ledger.json'),previous=join(folder,'ledger.previous.json');this.safeFile(file);this.safeFile(previous);
  const serialized=JSON.stringify(next);if(Buffer.byteLength(serialized,'utf8')>12_000_000)throw Error('The saved finance snapshot exceeds the file limit. Use shorter descriptions or a smaller reporting period.');
  const temporary=join(folder,randomUUID()+'.tmp');writeFileSync(temporary,serialized,{encoding:'utf8',flag:'wx'});if(existsSync(file))copyFileSync(file,previous);renameSync(temporary,file);return this.read();
 }
 backup():{path:string;sha256:string} {
  const ledger=this.read();if(!ledger.accounts.length)throw Error('Import an account snapshot before backing up.');const text=JSON.stringify(ledger,null,2);const file=join(this.folder('exports'),'finance-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.json');writeFileSync(file,text,{encoding:'utf8',flag:'wx'});return {path:file,sha256:sha(text)};
 }
}
