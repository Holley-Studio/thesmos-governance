import {inflateRawSync, inflateSync} from 'node:zlib';
import {posix} from 'node:path';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {getDocumentProxy} from 'unpdf';
import type {DriveRemoteFile} from '../../../shared/drive.ts';

export const MAX_DRIVE_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DRIVE_TEXT_BYTES = 10 * 1024 * 1024;
export const MAX_DRIVE_ARCHIVE_ENTRIES = 2000;
type Section = {title:string;text:string};
type Result = {text:string;sections?:Section[]};
const office = {
 docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
function fail(reason:string):never {throw new Error(reason);}
function utf8(bytes:Uint8Array):string {try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('File is not valid UTF-8 text.');}}
function complete(result:Result):Result {
 if(Buffer.byteLength(result.text,'utf8')>MAX_DRIVE_TEXT_BYTES)fail('Extracted text exceeds the 10 MiB processing limit.');
 if(!result.text.trim())fail('No readable text found; scanned documents need OCR.');
 return result;
}
function crc(bytes:Uint8Array):number {let c=0xffffffff;for(const v of bytes){c^=v;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
/** Preflight the central directory before ANY inflation. Never extract to disk. */
function archive(bytes:Uint8Array):Map<string,Buffer> {
 const b=Buffer.from(bytes);const bad=()=>fail('Malformed Office archive.');
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
 if(end<0)return bad();
 const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12),start=b.readUInt32LE(end+16);
 if(b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||b.readUInt16LE(end+8)!==count||start+size!==end)return bad();
 if(count>MAX_DRIVE_ARCHIVE_ENTRIES)fail('Archive exceeds the 2000 entry processing limit.');
 const entries:{name:string;size:number;compressed:number;offset:number;method:number;crc:number}[]=[];const names=new Set<string>();let p=start,total=0;
 for(let i=0;i<count;i++){
  if(p+46>end||b.readUInt32LE(p)!==0x02014b50)return bad();
  const flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),compressed=b.readUInt32LE(p+20),expanded=b.readUInt32LE(p+24),nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),offset=b.readUInt32LE(p+42);
  if(p+46+nl+el+cl>end||flags&1||![0,8].includes(method)||b.readUInt16LE(p+34))return bad();
  const name=utf8(b.subarray(p+46,p+46+nl));
  if(!name||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.split('/').some(s=>s==='..'||s==='.')||names.has(name))fail('Unsafe archive entry path or duplicate name.');
  if(/(?:vbaProject\.bin|activeX\/|embeddings\/|\.js$|\.exe$)/i.test(name))fail('Office active content is not supported.');
  names.add(name);total+=expanded;if(total>MAX_DRIVE_FILE_BYTES)fail('Archive exceeds the 20 MiB inflated processing limit.');
  entries.push({name,size:expanded,compressed,offset,method,crc:b.readUInt32LE(p+16)});p+=46+nl+el+cl;
 }
 if(p!==end)return bad();
 const out=new Map<string,Buffer>();total=0;
 for(const e of entries){
  const o=e.offset;if(o+30>start||b.readUInt32LE(o)!==0x04034b50)return bad();
  const nl=b.readUInt16LE(o+26),el=b.readUInt16LE(o+28),from=o+30+nl+el;
  if(from+e.compressed>start||b.readUInt16LE(o+8)!==e.method||b.readUInt16LE(o+6)&1||utf8(b.subarray(o+30,o+30+nl))!==e.name)return bad();
  let raw:Buffer;try{raw=e.method===8?inflateRawSync(b.subarray(from,from+e.compressed),{maxOutputLength:MAX_DRIVE_FILE_BYTES-total}):b.subarray(from,from+e.compressed);}catch{fail('Archive exceeds limits or contains invalid compressed data.');}
  total+=raw.length;if(total>MAX_DRIVE_FILE_BYTES)fail('Archive exceeds the 20 MiB inflated processing limit.');
  if(raw.length!==e.size||crc(raw)!==e.crc)return bad();out.set(e.name,raw);
 }
 return out;
}
type Node = Record<string,unknown>;
const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,trimValues:false,processEntities:false,cdataPropName:'#cdata'});
/** Decode only the five XML escapes and valid Unicode scalars, exactly once.
 * This operates on already parsed values; it cannot create XML syntax, resolve
 * custom declarations, or fetch a resource. CDATA remains literal text. */
function xmlCharacters(value:string):string {
 const predefined:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return value.replace(/&([^;\s<&]+);/g,(_,entity:string)=>{
  if(Object.hasOwn(predefined,entity))return predefined[entity];
  if(!/^#(?:x[0-9a-fA-F]+|[0-9]+)$/.test(entity))return fail('Unsupported XML entity reference.');
  const scalar=entity.startsWith('#x')?Number.parseInt(entity.slice(2),16):Number(entity.slice(1));
  if(!Number.isInteger(scalar)||!(scalar===9||scalar===10||scalar===13||(scalar>=0x20&&scalar<=0xd7ff)||(scalar>=0xe000&&scalar<=0xfffd)||(scalar>=0x10000&&scalar<=0x10ffff)))return fail('Invalid XML character reference.');
  return String.fromCodePoint(scalar);
 });
}
function decodeXmlValues(tree:Node[]):Node[] {
 for(const node of tree)for(const [key,value]of Object.entries(node)){
  if(key==='#cdata')continue;
  if(key==='#text')node[key]=xmlCharacters(String(value));
  else if(key===':@'&&value&&typeof value==='object')for(const [name,raw]of Object.entries(value)) (value as Record<string,unknown>)[name]=xmlCharacters(String(raw));
  else if(Array.isArray(value))decodeXmlValues(value as Node[]);
 }return tree;
}
function xml(bytes:Uint8Array|undefined):Node[] {
 if(!bytes)fail('Office document is missing required XML.');
 const text=utf8(bytes);
 if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(text))fail('XML DTD or entity declarations are not supported.');
 if(XMLValidator.validate(text)!==true)fail('Malformed XML in Office document.');
 // Bound depth and element count before recursive XML traversal.
 let depth=0,count=0;for(const m of text.matchAll(/<\/?[A-Za-z_][^>]*>/g)){if(m[0].startsWith('</'))depth--;else{if(++count>200000)fail('XML exceeds the element processing limit.');if(!m[0].endsWith('/>')&&++depth>128)fail('XML exceeds the nesting processing limit.');}}
 return decodeXmlValues(parser.parse(text) as Node[]);
}
function tag(n:Node):string {return Object.keys(n).find(k=>k!==':@'&&k!=='#text')??'';}
function local(n:Node):string{return tag(n).split(':').pop()??'';}
function children(n:Node):Node[]{const v=n[tag(n)];return Array.isArray(v)?v as Node[]:[];}
function nodes(tree:Node[],name:string):Node[]{const out:Node[]=[];for(const n of tree){if(local(n)===name)out.push(n);out.push(...nodes(children(n),name));}return out;}
function attr(n:Node,name:string):string {const a=n[':@'] as Record<string,string>|undefined;return String(a?.[name]??'');}
function textOf(tree:Node[]):string{return tree.map(n=>n['#text']!==undefined?String(n['#text']):textOf(children(n))).join('');}
function runs(n:Node):string{return nodes(children(n),'t').map(t=>textOf(children(t))).join('');}
function paragraphs(tree:Node[]):string{return nodes(tree,'p').map(runs).join('\n');}
function textBudget() {let used=0;return(text:string):string=>{used+=Buffer.byteLength(text);if(used>MAX_DRIVE_TEXT_BYTES)fail('Extracted text exceeds the 10 MiB processing limit.');return text;};}
function rels(a:Map<string,Buffer>,path:string,base:string):Map<string,string>{
 const result=new Map<string,string>();for(const r of nodes(xml(a.get(path)),'Relationship')){
  if(attr(r,'TargetMode')==='External')continue;
  const target=attr(r,'Target');if(target.includes('\\')||target.includes(':')||target.includes('\0'))fail('Unsafe Office relationship.');
  const name=target.startsWith('/')?target.slice(1):posix.normalize(posix.join(base,target));
  if(name.startsWith('../')||!name.startsWith(`${base}/`))fail('Unsafe Office relationship.');
  result.set(attr(r,'Id'),name);
 }return result;
}
function docx(a:Map<string,Buffer>):Result {
 const bounded=textBudget();
 const tree=xml(a.get('word/document.xml')),body=nodes(tree,'body')[0];if(!body)fail('Malformed Word document.');
 const lines=children(body).map(n=>{
  if(local(n)==='p'){const style=nodes(children(n),'pStyle')[0],heading=style&&/^Heading([1-6])$/i.exec(attr(style,'w:val'));return bounded(`${heading?'#'.repeat(Number(heading[1]))+' ':''}${runs(n)}`);}
  if(local(n)==='tbl')return nodes(children(n),'tr').map(row=>nodes(children(row),'tc').map(cell=>bounded(paragraphs(children(cell)))).join('\t')).join('\n');
  return '';
 });return {text:lines.filter(Boolean).join('\n')};
}
function xlsx(a:Map<string,Buffer>):Result {
 const bounded=textBudget();
 const workbook=xml(a.get('xl/workbook.xml')),relationships=rels(a,'xl/_rels/workbook.xml.rels','xl');
 const strings=a.has('xl/sharedStrings.xml')?nodes(xml(a.get('xl/sharedStrings.xml')),'si').map(runs):[];
 const sections=nodes(workbook,'sheet').map(sheet=>{
  const name=attr(sheet,'name'),target=relationships.get(attr(sheet,'r:id'));
  const tree=xml(target?a.get(target):undefined);
  const rows=nodes(tree,'row').map(row=>nodes(children(row),'c').map(cell=>{
   const type=attr(cell,'t'),value=textOf(children(nodes(children(cell),'v')[0]??{}));let content=value;
   if(type==='s'){const i=Number(value);if(!Number.isInteger(i)||i<0||i>=strings.length)fail('Malformed spreadsheet shared-string reference.');content=strings[i];}
   if(type==='inlineStr')content=runs(cell);
   if(!value&&nodes(children(cell),'f').length&&type!=='inlineStr')fail('Spreadsheet formula has no cached value; recalculate it in its source app.');
   return bounded(`${attr(cell,'r')}: ${content}`);
  }).join('\t')).join('\n');
  return {title:`Sheet: ${name}`,text:rows};
 });return sectionResult(sections);
}
function pptx(a:Map<string,Buffer>):Result {
 const bounded=textBudget();
 const tree=xml(a.get('ppt/presentation.xml')),relationships=rels(a,'ppt/_rels/presentation.xml.rels','ppt');
 const sections=nodes(tree,'sldId').map((s,i)=>{const target=relationships.get(attr(s,'r:id'));return {title:`Slide ${i+1}`,text:bounded(paragraphs(xml(target?a.get(target):undefined)))};});
 return sectionResult(sections);
}
function sectionResult(sections:Section[]):Result{if(!sections.some(s=>s.text.trim()))fail('No readable text found; scanned documents need OCR.');return {text:sections.map(s=>`${s.title}\n${s.text}`).join('\n\n'),sections};}
/** Restrictive preflight supports ordinary text PDFs without allowing unbounded stream expansion. */
function pdfPreflight(bytes:Uint8Array):void {
 const b=Buffer.from(bytes),source=b.toString('latin1');
 if(!source.startsWith('%PDF-')||!source.includes('%%EOF'))fail('Malformed PDF document.');
 if(/\/[A-Za-z0-9]*#[0-9A-Fa-f]{2}/.test(source))fail('PDF encoded names are unsupported by the safety preflight.');
 if(/\/(?:Encrypt|ObjStm|JavaScript|JS|Launch)\b/.test(source))fail('Encrypted, active, or compressed-object PDFs are not supported.');
 let total=0,objects=0;for(const _ of source.matchAll(/\b\d+\s+\d+\s+obj\b/g))if(++objects>20000)fail('PDF exceeds the object processing limit.');
 const re=/\bstream(?:\r\n|\n|\r)/g;let m:RegExpExecArray|null;
 while((m=re.exec(source))){
  const dictStart=source.lastIndexOf('<<',m.index),dict=source.slice(dictStart,m.index),length=/\/Length\s+(\d+)(?=\s|\/|>)/.exec(dict);
  if(dictStart<0||!length||/\/Length\s+\d+\s+\d+\s+R\b/.test(dict))fail('PDF stream uses an unsupported indirect length.');
  const from=re.lastIndex,size=Number(length[1]);if(size>MAX_DRIVE_FILE_BYTES||from+size>b.length)fail('PDF stream exceeds processing limits.');
  const filters=[...dict.matchAll(/\/([A-Za-z]+Decode)\b/g)].map(x=>x[1]);
  if(filters.some(f=>f!=='FlateDecode')||filters.length>1||(/\/Filter\b/.test(dict)&&! /\/Filter\s*(?:\/FlateDecode\b|\[\s*\/FlateDecode\s*\])/.test(dict)))fail('PDF stream uses an unsupported compression filter.');
  let inflated=size;try{if(filters.length)inflated=inflateSync(b.subarray(from,from+size),{maxOutputLength:MAX_DRIVE_FILE_BYTES-total}).length;}catch{fail('PDF exceeds limits or contains invalid compressed data.');}
  total+=inflated;if(total>MAX_DRIVE_FILE_BYTES)fail('PDF exceeds the 20 MiB inflated processing limit.');
  const after=source.slice(from+size,from+size+30);if(!/^\s*endstream\b/.test(after))fail('Malformed PDF stream length.');
  re.lastIndex=from+size+after.indexOf('endstream')+9;
 }
}
async function pdf(bytes:Uint8Array):Promise<Result>{
 pdfPreflight(bytes);
 let document:Awaited<ReturnType<typeof getDocumentProxy>>|undefined;
 try{
  const options: NonNullable<Parameters<typeof getDocumentProxy>[1]> & {isEvalSupported:boolean} = {isEvalSupported:false,disableFontFace:true,useSystemFonts:false,maxImageSize:0,disableAutoFetch:true,verbosity:0,stopAtErrors:true};
  document=await getDocumentProxy(Uint8Array.from(bytes),options);
  if(document.numPages>1000)fail('PDF exceeds the 1000 page processing limit.');
  const sections:Section[]=[];let total=0;
  for(let page=1;page<=document.numPages;page++){
   const p=await document.getPage(page),content=await p.getTextContent();
   const text=content.items.map(item=>'str' in item?item.str+('hasEOL' in item&&item.hasEOL?'\n':' '):'').join('').trim();
   total+=Buffer.byteLength(text);if(total>MAX_DRIVE_TEXT_BYTES)fail('Extracted text exceeds the 10 MiB processing limit.');
   sections.push({title:`Page ${page}`,text});p.cleanup();
  }
  if(!sections.some(s=>s.text.trim()))fail('No readable text found; scanned documents need OCR.');
  return sectionResult(sections);
 }catch(error){if(error instanceof Error&&/processing limit|No readable text/.test(error.message))throw error;return fail('PDF could not be read safely; malformed or unsupported document.');}
 finally{await document?.loadingTask.destroy();}
}
export async function extractDriveFile(meta:DriveRemoteFile,bytes:Uint8Array):Promise<Result>{
 if(bytes.byteLength>MAX_DRIVE_FILE_BYTES)fail('File exceeds the 20 MiB download processing limit.');
 const mime=meta.mimeType?.split(';')[0].trim().toLowerCase();
 if(['text/plain','text/markdown','text/x-markdown','text/csv','application/vnd.google-apps.document','application/vnd.google-apps.presentation'].includes(mime??''))return complete({text:utf8(bytes)});
 if(mime==='application/pdf')return complete(await pdf(bytes));
 if([office.docx,office.xlsx,office.pptx,'application/vnd.google-apps.spreadsheet'].includes(mime??'')){
  const a=archive(bytes);
  // Validate every XML part, including unused parts, before accepting this file.
  for(const [name,data]of a)if(/\.(?:xml|rels)$/i.test(name))xml(data);
  return complete(mime===office.docx?docx(a):mime===office.pptx?pptx(a):xlsx(a));
 }
 fail('Unsupported file type; images, scans, archives and executables are not searchable.');
}
