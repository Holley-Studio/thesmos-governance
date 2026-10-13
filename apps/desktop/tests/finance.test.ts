import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {accountLabel,analyzeFinance,checkedMapping,csvTable,financeCents,financeDate,financeTotals,suggestedMapping,MAX_CSV_BYTES,type FinanceInput,type FinanceMapping} from '../shared/finance.ts';
import {FinanceStore} from '../sidecar/studio/finance.ts';
const content='Date,Description,Amount,Category\r\n09/01/2026,"UI fixture client, project",1000.00,Client receipts\r\n09/02/2026,UI fixture software,-19.99,Software\r\n10/01/2026,UI fixture transfer,-300.00,Transfer\r\n';
function input(raw=content):FinanceInput{return {fileName:'UI-test.csv',content:raw,account:'UI TEST checking',currency:'USD',mapping:suggestedMapping(csvTable(raw)[0])};}
function temporary(run:(store:FinanceStore,dir:string)=>void):void{const dir=mkdtempSync(join(tmpdir(),'pantheon-finance-'));try{run(new FinanceStore(dir),dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function commit(store:FinanceStore,i=input(),extra:Record<string,unknown>={}){const p=store.preview({...i});return store.commit({...i,revision:p.revision,fileHash:p.fileHash,previewKey:p.previewKey,confirm:true,...extra});}
test('CSV reads BOM, commas, escaped quotes, multiline fields and line endings without evaluation',()=>{
 assert.deepEqual(csvTable('\uFEFFDate,Description,Amount\r\n2026-09-01,"A, ""B""\n=HYPERLINK(""x"")",1.00\r\n'),[['Date','Description','Amount'],['2026-09-01','A, "B"\n=HYPERLINK("x")','1.00']]);
});
test('CSV refuses unfinished or misplaced quotes, ambiguous headers, NUL, oversized fields and files',()=>{
 for(const raw of ['Date,Amount\n"x,1','Date,Amount\nx"y,1','Date,Date\nx,1','Date,Amount\nx\0,1','Date,Amount\n"x"z,1','Date,Amount\n'+'a'.repeat(4097)+',1'])assert.throws(()=>csvTable(raw));assert.throws(()=>csvTable('a'.repeat(MAX_CSV_BYTES+1)));
});
test('amount conversion uses exact cents including negative symbols, grouping, zero and parentheses',()=>{
 assert.equal(financeCents('1,234.56','USD'),123456);assert.equal(financeCents('-$19.99','USD'),-1999);assert.equal(financeCents('($1,000.50)','USD'),-100050);assert.equal(financeCents('USD -0.01','USD'),-1);assert.equal(financeCents('0.00','USD'),0);
 for(const raw of ['','1.005','1,23.00','1.234,56','1e3','NaN','-$-1.00','(1)-','9007199254740992'])assert.throws(()=>financeCents(raw,'USD'));assert.throws(()=>financeCents('€10.00','USD'));
});
test('dates use the explicitly selected order and reject invalid calendar days and serial dates',()=>{
 assert.equal(financeDate('03/04/2026','mdy'),'2026-03-04');assert.equal(financeDate('03/04/2026','dmy'),'2026-04-03');assert.equal(financeDate('2024-02-29','iso'),'2024-02-29');
 for(const raw of ['2026-02-29','2026-02-30','2026-13-01','1900-02-29','46200'])assert.throws(()=>financeDate(raw,'iso'));
});
test('header suggestions never guess the meaning of Net, Gross, Debit or Credit',()=>{
 const m=suggestedMapping(['Date','Name','Gross','Fee','Net','Debit','Credit','Currency','Status','Transaction ID']);assert.equal(m.amount,-1);assert.equal(m.incoming,-1);assert.equal(m.outgoing,-1);assert.equal(m.currency,7);assert.equal(m.id,9);assert.equal(accountLabel('  Business   checking '),'Business checking');
});
test('mapping rejects reused, missing or out-of-range columns and missing account/currency',()=>{
 const i=input();assert.throws(()=>checkedMapping({...i.mapping,amount:0},4));assert.throws(()=>analyzeFinance({...i,mapping:{...i.mapping,date:-1}}));assert.throws(()=>analyzeFinance({...i,currency:'JPY' as FinanceInput['currency']}));assert.throws(()=>analyzeFinance({...i,account:''}));
});
test('posted transaction totals and monthly movement reconcile independently to source cents',()=>{
 const p=analyzeFinance(input());assert.equal(p.invalidRows,0);assert.equal(p.sourceRecords,3);assert.equal(p.transactions[0].description,'UI fixture client, project');const t=financeTotals(p.transactions);assert.deepEqual({in:t.incomingCents,out:t.outgoingCents,net:t.netCents,n:t.count},{in:100000,out:31999,net:68001,n:3});assert.deepEqual(t.months,[{month:'2026-09',incomingCents:100000,outgoingCents:1999,netCents:98001},{month:'2026-10',incomingCents:0,outgoingCents:30000,netCents:-30000}]);
});
test('positive-out and explicitly mapped split columns preserve direction without relying on header names',()=>{
 const signed=analyzeFinance({...input(),mapping:{...input().mapping,positive:'out'}});assert.equal(signed.transactions[0].amountCents,-100000);
 const raw='Date,Description,Debit,Credit\n09/01/2026,UI fixture received,200.00,\n09/02/2026,UI fixture paid,,100.00';const i=input(raw);const m:FinanceMapping={...i.mapping,mode:'split',incoming:2,outgoing:3};assert.deepEqual(analyzeFinance({...i,mapping:m}).transactions.map(r=>r.amountCents),[20000,-10000]);
 const both=analyzeFinance({...input(raw+'\n09/03/2026,UI fixture invalid,1,2'),mapping:m});assert.equal(both.invalidRows,1);
});
test('invalid rows are reported and cannot be imported as a partial healthy ledger',()=>temporary(store=>{
 const i=input(content+'bad-date,UI invalid,10.00,\n09/01/2026,UI missing,,');const p=store.preview({...i});assert.equal(p.invalidRows,2);assert.equal(p.issues.length,2);assert.throws(()=>store.commit({...i,revision:p.revision,fileHash:p.fileHash,previewKey:p.previewKey,confirm:true}));assert.equal(store.read().accounts.length,0);
}));
test('mapped status excludes known unposted entries but unknown status and mixed currency require attention',()=>{
 const raw='Date,Name,Net,Currency,Status,Transaction ID\n09/01/2026,UI fixture completed,97.00,USD,Completed,a\n09/02/2026,UI fixture pending,20,USD,Pending,b\n09/03/2026,UI fixture mixed,10,EUR,Completed,c\n09/04/2026,UI fixture unknown,10,USD,Other,d';const i=input(raw);const p=analyzeFinance({...i,mapping:{...i.mapping,amount:2}});assert.equal(p.excludedUnposted,1);assert.equal(p.invalidRows,2);assert.equal(p.transactions.length,1);assert.equal(p.transactions[0].amountCents,9700);
});
test('repeated-looking rows require explicit acknowledgement and remain included; repeated IDs are invalid',()=>temporary(store=>{
 const raw='Date,Description,Amount\n09/01/2026,UI identical,-5\n09/01/2026,UI identical,-5';const i=input(raw),p=store.preview({...i});assert.equal(p.repeatedRows,2);assert.throws(()=>store.commit({...i,revision:p.revision,fileHash:p.fileHash,previewKey:p.previewKey,confirm:true}));const saved=commit(store,i,{acknowledgeRepeated:true});assert.equal(saved.accounts[0].transactions.length,2);assert.equal(financeTotals(saved.accounts[0].transactions).outgoingCents,1000);
 const ids=input(raw.replace('Amount','Amount,Transaction ID').replaceAll('UI identical,-5','UI identical,-5,a'));assert.equal(analyzeFinance(ids).invalidRows,1);
}));
test('saving requires reviewed input, matching source hash and current revision',()=>temporary(store=>{
 const i=input(),p=store.preview({...i});for(const extra of [{confirm:false},{fileHash:'0'.repeat(64)},{revision:7}])assert.throws(()=>store.commit({...i,revision:p.revision,fileHash:p.fileHash,previewKey:p.previewKey,confirm:true,...extra}));assert.equal(store.read().revision,0);
}));
test('reviewed preview binds account, date mapping, money direction and currency even with identical CSV bytes',()=>temporary(store=>{
 const i=input(),p=store.preview({...i});for(const change of [{account:'UI TEST different'}, {mapping:{...i.mapping,positive:'out'}}, {currency:'EUR'}])assert.throws(()=>store.commit({...i,...change,revision:p.revision,fileHash:p.fileHash,previewKey:p.previewKey,confirm:true}));assert.equal(store.read().accounts.length,0);
}));
test('reimport is idempotent, replacement is scoped, other accounts persist and stale previews fail',()=>temporary(store=>{
 const first=commit(store);assert.equal(first.revision,1);assert.equal(commit(store).revision,1);const stale=store.preview({...input()});const other={...input(),account:'UI TEST card'};commit(store,other);assert.throws(()=>store.commit({...input(),revision:stale.revision,fileHash:stale.fileHash,previewKey:stale.previewKey,confirm:true}));
 const replacement={...input(),content:content.replace('1000.00','1500.00')};const changed=commit(store,replacement);assert.equal(changed.accounts.length,2);assert.equal(changed.accounts.find(a=>a.label==='UI TEST checking')?.transactions.length,3);assert.equal(financeTotals(changed.accounts.find(a=>a.label==='UI TEST checking')!.transactions).incomingCents,150000);assert.equal(changed.audit.length,3);assert.throws(()=>store.preview({...input(),currency:'EUR'}));
}));
test('unused private CSV columns and original contents do not enter the saved snapshot',()=>temporary((store,dir)=>{
 const i=input('Date,Description,Amount,Private\n09/01/2026,UI safe,12.34,DO_NOT_STORE_PRIVATE_FIELD');commit(store,i);const text=readFileSync(join(dir,'finance/ledger.json'),'utf8');assert.ok(!text.includes('DO_NOT_STORE_PRIVATE_FIELD'));assert.ok(!text.includes('"content"'));assert.equal(store.read().accounts[0].transactions[0].amountCents,1234);
}));
test('corrupt finance data is not reset or overwritten, and replacements retain the previous ledger',()=>temporary((store,dir)=>{
 commit(store);commit(store,{...input(),content:content.replace('1000.00','2000.00')});const previous=JSON.parse(readFileSync(join(dir,'finance/ledger.previous.json'),'utf8'));assert.equal(previous.revision,1);writeFileSync(join(dir,'finance/ledger.json'),'broken');assert.throws(()=>store.read());assert.throws(()=>store.preview({...input()}));assert.equal(readFileSync(join(dir,'finance/ledger.json'),'utf8'),'broken');
}));
test('finance backup matches saved records and provides a checksum without importing into knowledge',()=>temporary((store,dir)=>{
 assert.throws(()=>store.backup());const saved=commit(store),backup=store.backup();const bytes=readFileSync(backup.path);assert.equal(backup.sha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(backup.path.startsWith(join(dir,'exports')));assert.deepEqual(JSON.parse(bytes.toString('utf8')),JSON.parse(JSON.stringify(saved)));assert.ok(!existsSync(join(dir,'knowledge')));
}));
test('saved record counts and repeated-row review must reconcile before more imports are accepted',()=>temporary((store,dir)=>{
 const saved=commit(store),file=join(dir,'finance/ledger.json');saved.accounts[0].sourceRecords=1;writeFileSync(file,JSON.stringify(saved));assert.throws(()=>store.read());assert.throws(()=>store.preview({...input()}));assert.equal(JSON.parse(readFileSync(file,'utf8')).accounts[0].sourceRecords,1);
}));
test('finance folder and ledger links cannot expand the fixed read/write boundary',()=>temporary((store,dir)=>{
 const outside=join(dir,'other');mkdirSync(outside);symlinkSync(outside,join(dir,'finance'),'junction');assert.throws(()=>store.read());assert.throws(()=>store.preview({...input()}));rmSync(join(dir,'finance'),{recursive:true,force:true});mkdirSync(join(dir,'finance'));const file=join(outside,'ledger.json');writeFileSync(file,'{}');symlinkSync(file,join(dir,'finance/ledger.json'),'file');assert.throws(()=>store.read());
}));
