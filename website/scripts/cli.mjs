#!/usr/bin/env node
import {conversationContext} from '../shared/conversation.js';
import {parseArgs} from 'node:util';
import {readFile,stat,readdir,writeFile,access} from 'node:fs/promises';
import {resolve,dirname,basename,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {extractDocument,checkCollection,MAX_FILE_BYTES} from '../shared/extract.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=`Lex Raptor · open-source research from your terminal

  lex-raptor ask "Summarize the termination clauses" --file contract.pdf
  lex-raptor ask "Compare these agreements" --dir ./agreements --task compare
  cat notes.txt | lex-raptor ask "Build a timeline" --stdin --task timeline
  lex-raptor search "Celotex summary judgment" --sources cap
  lex-raptor chat --file brief.docx
  lex-raptor inspect --file opinion.pdf --json

Options
  --file PATH       Attach a PDF, DOCX, TXT or Markdown file (repeatable)
  --dir PATH        Read supported files recursively (repeatable; no hidden files/symlinks)
  --stdin           Attach UTF-8 text piped to stdin
  --task NAME       auto, analyze, timeline, research, brief, memo, compare, arguments
  --sources LIST    documents, cap, courtlistener, ecfr, federal_register, or auto
                    Default: documents when attached; otherwise the offline CAP library
  --query TEXT      Explicit database search terms
  --court ID        CourtListener court ID
  --after DATE      From YYYY-MM-DD
  --before DATE     Through YYYY-MM-DD
  --model NAME      Installed Ollama model (default: qwen3:14b)
  --json            Output the complete structured result
  --output PATH     Save output; refuses existing files unless --force is supplied
  --force           Allow replacing the explicit output path
  --help            Show this help

Runs local Ollama only. No hosted API fallback. Online sources are opt-in.
Attachments: 5 files, 5 MB each, 200 PDF pages, 300 KB extracted text total.
Analysis uses selected excerpts, with coverage and quote checks in the result.
Scanned PDFs require OCR first. DOCX formatting and pagination are not retained.
Interactive commands: /attach PATH, /files, /clear, /new, /task NAME,
/sources LIST, /save PATH, /help, /quit. No shell commands are executed.
`;
let runtime;
const history=[],documents=[];
function markdown(r,question){
 if(r.follow_up)return [question,'',r.follow_up.message,...r.follow_up.suggestions.map(s=>'• '+s),'',...(r.coverage_notes||[]),'Reply in chat, or include the original question and your clarification in a new ask command.',''].join('\n');
 const lines=['# Lex Raptor',question,'',`Task: ${r.task} | Sources: ${r.databases.join(', ')} | Model: ${r.model_used?r.model:'No model call'}`,''];
 lines.push(...(r.coverage_notes||[]));if(r.jurisdiction_note)lines.push(r.jurisdiction_note);
 for(const d of r.document_coverage||[])lines.push(`Document: ${d.name} — ${d.selected_passages} excerpt(s) from ${d.extracted_characters} extracted characters.`,...(d.warnings||[]));
 let section='';for(const p of r.propositions||[]){if(p.section!==section){section=p.section;lines.push('',`## ${section}`);}const s=r.sources.find(s=>s.id===p.source_id);lines.push('',p.claim,'',p.evidence_method==='web_citation'?'Web citation — page text not independently quote-checked.':`> ${p.quote}`,'',`${s?.citation||p.source_id} · ${s?.locator||''}`,...(p.source_ids||[p.source_id]).map(id=>r.sources.find(s=>s.id===id)?.source_url||''));}
 if(r.model_used&&!r.propositions?.length)lines.push('No supported findings were returned. Inspect the source results or refine the request.');
 for(const s of r.searched||[])lines.push('',s.id+': '+s.status+' — '+s.note,...(s.warnings||[]));
 if(r.missing_sections?.length)lines.push('Missing sections: '+r.missing_sections.join(', '));
 lines.push('','## Retrieved excerpts');for(const s of r.sources||[])lines.push('',s.citation+' · '+s.locator,s.text);
 lines.push('','Review the sources and context. Excerpt analysis is not a complete file review or verification of current legal validity.');return lines.join('\n')+'\n';
}
async function readDocument(path){
 const resolved=resolve(path),info=await stat(resolved);if(!info.isFile())throw new Error('Not a regular file: '+path);if(info.size>MAX_FILE_BYTES)throw new Error(basename(path)+': file exceeds 5 MB.');
 const pdfjs=extname(path).toLowerCase()==='.pdf'?await import('pdfjs-dist/legacy/build/pdf.mjs'):undefined;
 return extractDocument(basename(path),new Uint8Array(await readFile(resolved)),pdfjs);
}
async function findFiles(path,found=[]){
 for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name.startsWith('.')||['node_modules','dist','build','vendor'].includes(entry.name)||entry.isSymbolicLink())continue;
  const full=resolve(path,entry.name);if(entry.isDirectory())await findFiles(full,found);else if(entry.isFile()&&/\.(pdf|docx|txt|md|markdown)$/i.test(entry.name)){found.push(full);if(found.length>5)throw new Error('Folder contains more than five supported files. Select a smaller folder or explicit --file paths.');}
 }return found;
}
async function attach(path){const doc=await readDocument(path);checkCollection([...documents,doc]);documents.push(doc);return doc;}
async function ensureRuntime(){
 if(runtime)return runtime;
 try{await access(resolve(root,'dist/server/index.js'));}catch{execFileSync(process.execPath,[resolve(root,'scripts/build.mjs')],{cwd:root,stdio:['ignore','ignore','inherit']});}
 const {createLocalRuntime}=await import('./local-runtime.mjs');runtime=await createLocalRuntime();return runtime;
}
async function research(question,settings,search=false){
 const {mf}=await ensureRuntime();const source=settings.sources||(documents.length?'documents':'cap');
 if(source==='documents'&&!documents.length)throw new Error('Attach a document before using --sources documents.');
 const body={question,documents,document_mode:source==='documents'?'only':'with_sources',task:settings.task||'auto',auto_fields:true,database_ids:source==='auto'?'auto':source==='documents'?[]:source.split(','),search_query:settings.query||'',filters:{court:settings.court||'',after:settings.after||'',before:settings.before||''},context:conversationContext(history),request_id:crypto.randomUUID()};
 const response=await mf.dispatchFetch('http://localhost/api/demo/'+(search?'search':'research'),{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost','CF-Connecting-IP':'127.0.0.1'},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Research failed.');if(!search)history.push({...result,question});return result;
}
async function save(path,content,force=false){await writeFile(resolve(path),content,{flag:force?'w':'wx',mode:0o600});}
async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{file:{type:'string',multiple:true},dir:{type:'string',multiple:true},stdin:{type:'boolean'},task:{type:'string'},sources:{type:'string'},query:{type:'string'},court:{type:'string'},after:{type:'string'},before:{type:'string'},model:{type:'string'},json:{type:'boolean'},output:{type:'string'},force:{type:'boolean'},help:{type:'boolean',short:'h'}}});
 if(values.help){process.stdout.write(usage);return;}
 const command=['ask','search','chat','inspect'].includes(positionals[0])?positionals.shift():'ask';
 if(values.model)process.env.OLLAMA_MODEL=values.model;
 const paths=[...(values.file||[])];for(const dir of values.dir||[])paths.push(...await findFiles(resolve(dir)));if(paths.length>5)throw new Error('Select at most five files.');
 for(const path of [...new Set(paths)])await attach(path);
 if(values.stdin){if(process.stdin.isTTY)throw new Error('--stdin requires piped text.');const chunks=[];let count=0;for await(const chunk of process.stdin){count+=chunk.length;if(count>MAX_FILE_BYTES)throw new Error('Piped input exceeds 5 MB.');chunks.push(chunk);}documents.push(await extractDocument('stdin.txt',new Uint8Array(Buffer.concat(chunks))));checkCollection(documents);}
 if(command==='inspect'){
  if(!documents.length)throw new Error('Use --file, --dir or --stdin to select documents.');
  const text=values.json?JSON.stringify({documents},null,2)+'\n':documents.map(d=>d.name+'\n'+d.pages.map(p=>(d.type==='PDF'?'Page '+p.number+'\n':'')+p.text).join('\n\n')).join('\n\n');if(values.output)await save(values.output,text,values.force);else process.stdout.write(text);return;
 }
 if(command==='chat'){
  if(!process.stdin.isTTY)throw new Error('Interactive chat requires a terminal. Use ask --stdin for a pipe.');
  process.stderr.write('Lex Raptor · local Ollama · '+(process.env.OLLAMA_MODEL||'qwen3:14b')+'\nA sharp eye for the evidence. /help for commands.\n');
  const rl=createInterface({input:process.stdin,output:process.stderr});let last;
  try{for(;;){const q=(await rl.question('you> ')).trim();if(!q)continue;if(['/quit','/exit'].includes(q))break;try{
   if(q==='/help'){process.stderr.write(usage);continue;}
   if(q.startsWith('/attach ')){const path=q.slice(8).trim().replace(/^"(.*)"$/,'$1');const doc=await attach(path);process.stderr.write('Attached '+doc.name+'\n');continue;}
   if(q==='/files'){process.stderr.write((documents.map(d=>d.name).join('\n')||'No attachments')+'\n');continue;}
   if(q==='/clear'){documents.length=0;process.stderr.write('Attachments cleared.\n');continue;}
   if(q==='/new'){history.length=0;documents.length=0;last=null;process.stderr.write('New chat.\n');continue;}
   if(q.startsWith('/task ')){values.task=q.slice(6).trim();continue;}
   if(q.startsWith('/sources ')){values.sources=q.slice(9).trim();continue;}
   if(q.startsWith('/save ')){if(!last)throw new Error('No result to save.');await save(q.slice(6).trim(),JSON.stringify(last,null,2)+'\n');continue;}
   if(q.startsWith('/'))throw new Error('Unknown command. Use /help.');
   const result=await research(q,values);last={...result,question:q};process.stdout.write(values.json?JSON.stringify(last)+'\n':markdown(result,q));
  }catch(e){process.stderr.write('Lex Raptor: '+e.message+'\n');}}}finally{rl.close();}return;
 }
 const question=positionals.join(' ').trim();if(!question)throw new Error('Provide a question. Use --help for examples.');
 const result=await research(question,values,command==='search');const content=values.json?JSON.stringify({...result,question},null,2)+'\n':markdown(result,question);
 if(values.output)await save(values.output,content,values.force);else process.stdout.write(content);
}
try{await main();}catch(error){process.stderr.write('Lex Raptor: '+(error.code==='EEXIST'?'Output file exists. Choose another path or use --force.':error.message)+'\n');process.exitCode=1;}finally{if(runtime)await runtime.mf.dispose();}
