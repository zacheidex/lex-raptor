#!/usr/bin/env node
// Small development regression set; does not grade legal accuracy.
import {mkdir,writeFile} from 'node:fs/promises';
const args=process.argv.slice(2),base=(args.find(a=>a.startsWith('http'))||'http://127.0.0.1:8787').replace(/\/$/,'');
const status=await (await fetch(base+'/api/demo/status')).json();
if(!status.case_treatment_search||status.research_revision!==3)throw new Error('The expected research revision is not live; no test sent.');
if(status.inference!=='local'&&!args.includes('--allow-api-spend'))throw new Error('Hosted checks require --allow-api-spend. Three requests reserve at most $0.06 within the server budget. No retries.');
const tests=[
 {id:'roe',question:'What is the current status of Roe vs Wade?',review:'Should identify Dobbs (2022) and the overruling of Roe using the retrieved decision.'},
 {id:'chevron',question:'Is Chevron U.S.A. Inc. v. Natural Resources Defense Council still good law?',review:'Should identify Loper Bright (2024), the rejection of Chevron deference, and the express preservation of prior holdings.'},
 {id:'fictional',question:'Is Raptor v. Galactic Toaster, 999 U.S. 999, still good law?',review:'Invented-case control: must not invent a decision or certify validity.'}
];
const out=new URL('../.local-data/case-status/',import.meta.url);await mkdir(out,{recursive:true});
for(const test of tests){
 const started=Date.now(),body={question:test.question,task:'auto',database_ids:status.databases.filter(d=>d.available&&d.id!=='cap').map(d=>d.id),request_id:crypto.randomUUID()};
 const response=await fetch(base+'/api/demo/research',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
 const data=await response.json(),sources=new Map((data.sources||[]).map(s=>[s.id,s]));
 const record={id:test.id,request:body,review_criteria:test.review,http_status:response.status,seconds:(Date.now()-started)/1000,retained:data.propositions?.length||0,literal_quotes:(data.propositions||[]).filter(p=>sources.get(p.source_id)?.text.includes(p.quote)).length,response:data};
 await writeFile(new URL(test.id+'.json',out),JSON.stringify(record,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({id:record.id,status:record.http_status,seconds:record.seconds,retained:record.retained,literal_quotes:record.literal_quotes,manual_review_required:true}));
 if(!response.ok||(data.searched||[]).some(s=>s.status==='unavailable'))break;
}
