import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync,deflateSync} from 'node:zlib';
import {extractDriveFile,MAX_DRIVE_FILE_BYTES} from '../sidecar/studio/drive/extract.ts';
const enc=(s:string)=>Buffer.from(s);
const mime={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
const extract=(type:string,b:Uint8Array)=>extractDriveFile({id:'fixture',name:'Synthetic',mimeType:type},b);
function crc(b:Buffer){let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function zip(entries:Record<string,string>,fakeSize?:number){const local:Buffer[]=[],central:Buffer[]=[];let offset=0;for(const [name,value]of Object.entries(entries)){const n=enc(name),raw=enc(value),data=deflateRawSync(raw),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(8,8);h.writeUInt32LE(crc(raw),14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(fakeSize??raw.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(8,10);c.writeUInt32LE(crc(raw),16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(fakeSize??raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;}const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,cd,end]);}
function pdf(pages:string[],compressed=false){const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];for(let i=0;i<pages.length;i++){objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);const raw=enc(`BT /F1 12 Tf 72 720 Td (${pages[i]}) Tj ET`),data=compressed?deflateSync(raw):raw;objects.push(`<< /Length ${data.length}${compressed?' /Filter /FlateDecode':''} >>\nstream\n${data.toString('latin1')}\nendstream`);}let out='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out,'latin1'));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const start=Buffer.byteLength(out,'latin1');out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(out,'latin1');}
for(const type of ['text/plain','text/markdown','text/csv','application/vnd.google-apps.document','application/vnd.google-apps.presentation'])test(`complete UTF8 ${type}`,async()=>{const s='# Café\nfirst,last\nAlice,Holley\nfinal';assert.equal((await extract(type,enc(s))).text,s);});
test('DOCX paragraphs, headings and table cells',async()=>{const r=await extract(mime.docx,zip({'word/document.xml':'<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p><w:p><w:r><w:t>Complete &amp; final</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'}));assert.match(r.text,/# Overview\nComplete & final/);assert.match(r.text,/Cell A\tCell B/);});
const workbook={'xl/workbook.xml':'<workbook><sheets><sheet name="Budget" r:id="rId1"/><sheet name="People" r:id="rId2"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>','xl/sharedStrings.xml':'<sst><si><t>Total</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>','xl/worksheets/sheet2.xml':'<worksheet><sheetData><row r="2"><c r="C2" t="inlineStr"><is><t>Alice</t></is></c></row></sheetData></worksheet>'};
for(const type of [mime.xlsx,'application/vnd.google-apps.spreadsheet'])test(`sheets and cell provenance ${type}`,async()=>{const r=await extract(type,zip(workbook));assert.deepEqual(r.sections?.map(s=>s.title),['Sheet: Budget','Sheet: People']);assert.match(r.text,/A1: Total/);assert.match(r.text,/B1: 2/);assert.match(r.text,/C2: Alice/);});
test('PPTX uses presentation slide order',async()=>{const r=await extract(mime.pptx,zip({'ppt/presentation.xml':'<p:presentation><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>','ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>','ppt/slides/slide1.xml':'<p:sld><a:p><a:r><a:t>Last</a:t></a:r></a:p></p:sld>','ppt/slides/slide2.xml':'<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>'}));assert.deepEqual(r.sections?.map(s=>s.text),['First','Last']);});
for(const compressed of [false,true])test(`PDF complete pages compressed=${compressed}`,async()=>{const r=await extract('application/pdf',pdf(['First page','Final page'],compressed));assert.deepEqual(r.sections?.map(s=>s.title),['Page 1','Page 2']);assert.match(r.sections![0].text,/First page/);assert.match(r.sections![1].text,/Final page/);});
test('scanned or empty PDF explicitly unavailable',async()=>assert.rejects(extract('application/pdf',pdf([''])),/No readable text/));
test('invalid UTF8 rejected, never replacement text',async()=>assert.rejects(extract('text/plain',Buffer.from([0xc3,0x28])),/valid UTF-8/));
test('unsupported image and archives explicitly unavailable',async()=>{for(const type of ['image/png','application/zip','application/x-msdownload'])await assert.rejects(extract(type,enc('anything')),/Unsupported file type/);});
test('input size bound',async()=>assert.rejects(extract('text/plain',new Uint8Array(MAX_DRIVE_FILE_BYTES+1)),/20 MiB/));
test('archive claimed inflation bound before inflate',async()=>assert.rejects(extract(mime.docx,zip({'word/document.xml':'<doc/>'},MAX_DRIVE_FILE_BYTES+1)),/Archive exceeds/));
test('archive actual inflated bound despite lying central directory',async()=>assert.rejects(extract(mime.docx,zip({'word/document.xml':'x'.repeat(MAX_DRIVE_FILE_BYTES+1)},1)),/Archive exceeds/));
test('rejects path traversal and duplicate names',async()=>assert.rejects(extract(mime.docx,zip({'../word/document.xml':'<doc/>'})),/Unsafe archive/));
test('rejects active Office content and external XML entities',async()=>{await assert.rejects(extract(mime.docx,zip({'word/document.xml':'<doc/>','word/vbaProject.bin':'macro'})),/active content/);await assert.rejects(extract(mime.docx,zip({'word/document.xml':'<!DOCTYPE doc [<!ENTITY x SYSTEM "https://evil.invalid">]><doc>&x;</doc>'})),/DTD or entity/);});
test('malformed archive and XML fail whole file',async()=>{await assert.rejects(extract(mime.docx,enc('invalid')),/Malformed/);await assert.rejects(extract(mime.docx,zip({'word/document.xml':'<w:document><w:p></w:document>'})),/Malformed XML/);});
test('PDF filter and encoded name bypasses fail before parser inflation',async()=>{
 const raw=pdf(['Bounded text'],true).toString('latin1');
 await assert.rejects(extract('application/pdf',Buffer.from(raw.replace('/FlateDecode','/F#6cateDecode'),'latin1')),/unsupported/);
 await assert.rejects(extract('application/pdf',Buffer.from(raw.replace('/FlateDecode','/LZWDecode'),'latin1')),/unsupported/);
});
test('PDF indirect stream length rejected without digit backtracking',async()=>{
 const raw=pdf(['Bounded text']).toString('latin1').replace(/\/Length (\d+)/,'/Length $1 0 R');
 await assert.rejects(extract('application/pdf',Buffer.from(raw,'latin1')),/indirect length/);
});
test('PDF stream expansion bounded before PDF.js',async()=>{
 const raw=deflateSync(enc('x'.repeat(MAX_DRIVE_FILE_BYTES+1)));
 const file=Buffer.concat([enc(`%PDF-1.4\n1 0 obj\n<< /Length ${raw.length} /Filter /FlateDecode >>\nstream\n`),raw,enc('\nendstream\nendobj\n%%EOF')]);
 await assert.rejects(extract('application/pdf',file),/PDF exceeds limits/);
});
test('empty sheets do not become searchable based on sheet titles',async()=>{
 await assert.rejects(extract(mime.xlsx,zip({...workbook,'xl/worksheets/sheet1.xml':'<worksheet/>','xl/worksheets/sheet2.xml':'<worksheet/>'})),/No readable text/);
});
test('repeated shared strings cannot amplify extracted text beyond its bound',async()=>{
 const large='a'.repeat(1024*1024),cells=Array.from({length:11},(_,i)=>`<c r="A${i+1}" t="s"><v>0</v></c>`).join('');
 await assert.rejects(extract(mime.xlsx,zip({...workbook,'xl/sharedStrings.xml':`<sst><si><t>${large}</t></si></sst>`,'xl/worksheets/sheet1.xml':`<worksheet><row>${cells}</row></worksheet>`})),/10 MiB/);
});
test('controlled XML decoding preserves predefined and numeric entities exactly once',async()=>{
 const r=await extract(mime.docx,zip({'word/document.xml':'<w:document><w:body><w:p><w:r><w:t>Caf&#xE9; &amp; &lt;literal&gt; &amp;lt; &quot;quoted&quot; &apos; &#8364; <![CDATA[&amp; &custom;]]></w:t></w:r></w:p></w:body></w:document>'}));
 assert.equal(r.text,'Café & <literal> &lt; "quoted" \' € &amp; &custom;');
 const sheet=await extract(mime.xlsx,zip({...workbook,'xl/workbook.xml':'<workbook><sheets><sheet name="Budget &amp; &#8364;" r:id="rId1"/></sheets></workbook>'}));
 assert.equal(sheet.sections?.[0].title,'Sheet: Budget & €');
});
test('custom XML entity references and invalid numeric scalars fail whole file',async()=>{
 for(const entity of ['&custom;','&#0;','&#xD800;','&#x110000;'])await assert.rejects(extract(mime.docx,zip({'word/document.xml':`<w:document><w:body><w:p><w:r><w:t>${entity}</w:t></w:r></w:p></w:body></w:document>`})),/Unsupported XML entity|Invalid XML character/);
});
