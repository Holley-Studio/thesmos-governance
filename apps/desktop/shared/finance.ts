/** Posted transaction snapshots. Integer minor units; no accounting or AI inference. */
export const FINANCE_CURRENCIES = ['USD','CAD','EUR','GBP','AUD','NZD','CHF'] as const;
export type FinanceCurrency = typeof FINANCE_CURRENCIES[number];
export interface FinanceMapping { date: number; description: number; category: number; id: number; currency: number; status: number; mode: 'signed' | 'split'; amount: number; incoming: number; outgoing: number; positive: 'in' | 'out'; dates: 'iso' | 'mdy' | 'dmy' }
export interface FinanceInput { fileName: string; content: string; account: string; currency: FinanceCurrency; mapping: FinanceMapping }
export interface FinanceRow { record: number; date: string; description: string; category: string; amountCents: number; transactionId?: string; repeated: boolean }
export interface FinanceAccount { id: string; label: string; currency: FinanceCurrency; importedAt: string; fileName: string; fileHash: string; mapping: FinanceMapping; sourceRecords: number; excludedUnposted: number; repeatedAcknowledged: boolean; transactions: FinanceRow[] }
export interface FinanceLedger { version: 1; revision: number; accounts: FinanceAccount[]; audit: {at:string;accountId:string;fileHash:string;previousHash?:string;revision:number;rows:number}[] }
export interface FinancePreview { revision: number; fileHash: string; previewKey: string; headers: string[]; transactions: FinanceRow[]; sourceRecords: number; excludedUnposted: number; invalidRows: number; repeatedRows: number; issues: {record: number; message: string}[]; replacing: boolean; unchanged: boolean }
export interface FinanceTotals { incomingCents: number; outgoingCents: number; netCents: number; count: number; months: {month: string; incomingCents: number; outgoingCents: number; netCents: number}[] }
export const MAX_CSV_BYTES = 1_048_576;
export const MAX_FINANCE_ROWS = 10_000;
const clean = (v: string, max: number) => v.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').trim().slice(0,max);
export function accountLabel(value: unknown): string { if(typeof value !== 'string')throw Error('Name the account.');const s=clean(value,81).replace(/\s+/g,' ');if(!s||s.length>80)throw Error('Use an account name of 1–80 characters.');return s; }
export function csvTable(input: unknown): string[][] {
 if(typeof input !== 'string'||new TextEncoder().encode(input).length>MAX_CSV_BYTES||input.includes('\0'))throw Error('Choose a UTF-8 CSV no larger than 1 MB.');
 const text=input.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[];let cell='';let quoted=false;let closed=false;
 const pushCell=()=>{if(cell.length>4096)throw Error('A CSV field exceeds the 4,096-character limit.');row.push(cell);if(row.length>64)throw Error('The CSV has more than 64 columns.');cell='';closed=false;};
 const pushRow=()=>{pushCell();if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>MAX_FINANCE_ROWS+1)throw Error('Use an export of at most 10,000 transaction rows.');};
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;}
  else if(ch===',')pushCell();else if(ch==='\n'||ch==='\r'){pushRow();if(ch==='\r'&&text[i+1]==='\n')i++;}
  else if(ch==='"'){if(cell||closed)throw Error('A CSV quote is misplaced.');quoted=true;}
  else {if(closed)throw Error('Unexpected text after a quoted CSV field.');cell+=ch;}
 }
 if(quoted)throw Error('The CSV has an unfinished quoted field.');if(cell||row.length||closed)pushRow();
 if(rows.length<2)throw Error('The CSV needs a header and at least one transaction.');
 const headers=rows[0].map(v=>clean(v,120));if(headers.some(v=>!v)||new Set(headers.map(v=>v.toLowerCase())).size!==headers.length)throw Error('Use a single header row with distinct, nonempty column names.');rows[0]=headers;return rows;
}
export function suggestedMapping(headers: string[]): FinanceMapping {
 const find=(names:string[])=>headers.findIndex(h=>names.includes(h.toLowerCase().trim()));
 return {date:find(['date','transaction date','posted date','posting date']),description:find(['description','memo','name','payee']),category:find(['category']),id:find(['transaction id','transactionid']),currency:find(['currency']),status:find(['status']),mode:'signed',amount:find(['amount']),incoming:-1,outgoing:-1,positive:'in',dates:'mdy'};
}
export function financeDate(input: string, order: FinanceMapping['dates']): string {
 const value=input.trim();let y:number,m:number,d:number;
 if(order==='iso'){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)throw Error('Expected YYYY-MM-DD.');[,y,m,d]=match.map(Number);}
 else {const match=/^(\d{1,2})([\/-])(\d{1,2})\2(\d{4})$/.exec(value);if(!match)throw Error('Expected a day/month/year or month/day/year date.');y=Number(match[4]);m=Number(match[order==='mdy'?1:3]);d=Number(match[order==='mdy'?3:1]);}
 const iso=`${y.toString().padStart(4,'0')}-${m.toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
 if(y<1980||y>2100||m<1||m>12||d<1||d>31||new Date(iso+'T00:00:00Z').toISOString().slice(0,10)!==iso)throw Error('Invalid transaction date.');return iso;
}
export function financeCents(input: string, currency: FinanceCurrency): number {
 let value=input.trim();if(!value)throw Error('Amount is missing.');
 let sign=1,hasSign=false;if(/^\(.+\)$/.test(value)){sign=-1;hasSign=true;value=value.slice(1,-1).trim();}else if(value[0]==='-'||value[0]==='+'){sign=value[0]==='-'?-1:1;hasSign=true;value=value.slice(1).trim();}
 if(value.startsWith(currency))value=value.slice(3).trim();
 const marker=value[0];if(['$','€','£'].includes(marker)){if((marker==='€'&&currency!=='EUR')||(marker==='£'&&currency!=='GBP')||(marker==='$'&&!['USD','CAD','AUD','NZD'].includes(currency)))throw Error('Currency symbol differs from the selected currency.');value=value.slice(1).trim();}
 if(!hasSign&&(value[0]==='-'||value[0]==='+')){sign=value[0]==='-'?-1:1;value=value.slice(1);}
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value))throw Error('Use amounts with a decimal point and at most two decimal places.');
 const [whole,fraction='']=value.replaceAll(',','').split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents>1_000_000_000_000)throw Error('Amount exceeds the supported range.');return sign*cents;
}
export function checkedMapping(input: unknown, columns: number): FinanceMapping {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose the CSV columns.');const m=input as FinanceMapping;
 if(!['signed','split'].includes(m.mode)||!['in','out'].includes(m.positive)||!['iso','mdy','dmy'].includes(m.dates))throw Error('Choose amount direction and date format.');
 const fields=['date','description','category','id','currency','status','amount','incoming','outgoing'] as const;
 for(const f of fields)if(!Number.isInteger(m[f])||m[f]<-1||m[f]>=columns)throw Error('A selected column is unavailable.');
 const required=m.mode==='signed'?['date','description','amount'] as const:['date','description','incoming','outgoing'] as const;
 if(required.some(f=>m[f]<0))throw Error('Select date, description and the money column(s).');
 const used=[...required,...(['category','id','currency','status'] as const).filter(f=>m[f]>=0)].map(f=>m[f]);if(new Set(used).size!==used.length)throw Error('Map each selected column to only one field.');
 return {date:m.date,description:m.description,category:m.category,id:m.id,currency:m.currency,status:m.status,mode:m.mode,amount:m.amount,incoming:m.incoming,outgoing:m.outgoing,positive:m.positive,dates:m.dates};
}
export function analyzeFinance(input: FinanceInput): Omit<FinancePreview,'revision'|'fileHash'|'previewKey'|'replacing'|'unchanged'> {
 accountLabel(input.account);if(!FINANCE_CURRENCIES.includes(input.currency))throw Error('Choose a supported two-decimal currency.');
 const table=csvTable(input.content),headers=table[0],m=checkedMapping(input.mapping,headers.length);const transactions:FinanceRow[]=[];const issues:FinancePreview['issues']=[];let invalidRows=0,excludedUnposted=0,repeatedRows=0;
 const ids=new Set<string>();const fingerprints=new Map<string,FinanceRow>();
 for(let i=1;i<table.length;i++){const raw=table[i],record=i+1;try{
  if(raw.length!==headers.length)throw Error('Column count differs from the header.');
  if(m.status>=0){const status=raw[m.status].trim().toLowerCase();if(!['completed','posted','settled'].includes(status)){if(['pending','denied','voided','canceled','cancelled','processing','created'].includes(status)){excludedUnposted++;continue;}throw Error('Unknown transaction status; use a posted-transactions export.');}}
  if(m.currency>=0&&raw[m.currency].trim().toUpperCase()!==input.currency)throw Error('Currency differs from the selected account. Separate mixed-currency exports.');
  const date=financeDate(raw[m.date],m.dates);const description=clean(raw[m.description],250);if(!description)throw Error('Description is missing.');
  let amountCents:number;if(m.mode==='signed'){amountCents=financeCents(raw[m.amount],input.currency)*(m.positive==='in'?1:-1);}else{
   const incoming=raw[m.incoming].trim()?financeCents(raw[m.incoming],input.currency):0,outgoing=raw[m.outgoing].trim()?financeCents(raw[m.outgoing],input.currency):0;
   if((!raw[m.incoming].trim()&&!raw[m.outgoing].trim())||incoming<0||outgoing<0||(incoming!==0&&outgoing!==0))throw Error('Use a nonnegative amount in only one money-in or money-out column.');amountCents=incoming-outgoing;
  }
  const transactionId=m.id>=0?clean(raw[m.id],200):undefined;if(m.id>=0&&(!transactionId||ids.has(transactionId)))throw Error('Transaction ID is missing or repeated.');if(transactionId)ids.add(transactionId);
  const item:FinanceRow={record,date,description,category:m.category>=0?clean(raw[m.category],120)||'Unspecified':'Unspecified',amountCents,transactionId,repeated:false};
  if(!transactionId){const key=JSON.stringify([date,description,amountCents]);const prior=fingerprints.get(key);if(prior){if(!prior.repeated){prior.repeated=true;repeatedRows++;}item.repeated=true;repeatedRows++;}else fingerprints.set(key,item);}
  transactions.push(item);
 }catch(error){invalidRows++;if(issues.length<20)issues.push({record,message:error instanceof Error?error.message:'This record could not be verified.'});}}
 financeTotals(transactions);return {headers,transactions,sourceRecords:table.length-1,excludedUnposted,invalidRows,repeatedRows,issues};
}
export function financeTotals(rows: FinanceRow[]): FinanceTotals {
 let incomingCents=0,outgoingCents=0;const months=new Map<string,{month:string;incomingCents:number;outgoingCents:number;netCents:number}>();
 for(const row of rows){if(!Number.isSafeInteger(row.amountCents))throw Error('Invalid stored amount.');const incoming=Math.max(row.amountCents,0),outgoing=Math.max(-row.amountCents,0);incomingCents+=incoming;outgoingCents+=outgoing;
  if(!Number.isSafeInteger(incomingCents)||!Number.isSafeInteger(outgoingCents))throw Error('Total exceeds the supported range.');
  const month=row.date.slice(0,7),group=months.get(month)??{month,incomingCents:0,outgoingCents:0,netCents:0};group.incomingCents+=incoming;group.outgoingCents+=outgoing;group.netCents=group.incomingCents-group.outgoingCents;months.set(month,group);
 }
 return {incomingCents,outgoingCents,netCents:incomingCents-outgoingCents,count:rows.length,months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month))};
}
