import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractDocument,checkCollection} from '../shared/extract.js';
import {samplePdf,sampleDocx} from './make-fixtures.mjs';
import {zipSync,strToU8} from 'fflate';
const bytes=s=>new TextEncoder().encode(s),run=promisify(execFile);
test('PDF and DOCX extraction preserve readable text with explicit source location',async()=>{
 const pdf=await extractDocument('opinion.pdf',samplePdf('Thirty days of written notice are required.'),pdfjs);assert.equal(pdf.type,'PDF');assert.equal(pdf.pages[0].number,1);assert.match(pdf.pages[0].text,/Thirty days/);
 const docx=await extractDocument('agreement.docx',sampleDocx('Thirty days & written notice.'));assert.equal(docx.type,'DOCX');assert.equal(docx.pages[0].text,'Thirty days & written notice.');assert.match(docx.warnings.join(' '),/pagination|page layout/i);
});
test('scanned PDFs, unsafe XML, binary text and excessive extraction are rejected',async()=>{
 await assert.rejects(()=>extractDocument('empty.pdf',samplePdf(''),pdfjs),/no readable text/);
 await assert.rejects(()=>extractDocument('fake.txt',new Uint8Array([0,1,2,3])),/binary/);
 await assert.rejects(()=>extractDocument('big.txt',bytes('a'.repeat(300001))),/300 KB/);
 const bad=zipSync({'word/document.xml':strToU8('<!DOCTYPE foo [<!ENTITY x "text">]><w:document/>')});await assert.rejects(()=>extractDocument('bad.docx',bad),/XML declarations/);
 const expanded=zipSync({'word/document.xml':strToU8('a'.repeat(4000001))});await assert.rejects(()=>extractDocument('bomb.docx',expanded),/4 MB/);
 const one=await extractDocument('notes.txt',bytes('A synthetic document with sufficient content.'));assert.throws(()=>checkCollection(Array(6).fill(one)),/five/);
});
test('CLI inspect reads explicit files without starting a model and protects output files',async()=>{
 const {stdout}=await run(process.execPath,['scripts/cli.mjs','inspect','--file','tests/fixtures/agreement.pdf','--file','tests/fixtures/agreement.docx','--json']);const data=JSON.parse(stdout);assert.equal(data.documents.length,2);assert.match(data.documents[0].pages[0].text,/thirty days/);
 await assert.rejects(()=>run(process.execPath,['scripts/cli.mjs','inspect','--file','tests/fixtures/agreement.txt','--output','tests/fixtures/agreement.txt']),e=>/Output file exists/.test(e.stderr));
 const {stdout:help}=await run(process.execPath,['scripts/cli.mjs','--help']);assert.match(help,/No hosted API fallback/);
});
