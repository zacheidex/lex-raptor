#!/usr/bin/env node
// Development checks with retained results, not an attorney accuracy score.
import {mkdir,writeFile} from 'node:fs/promises';
import {conversationContext} from '../shared/conversation.js';
const args=process.argv.slice(2),base=(args.find(a=>a.startsWith('http'))||'http://127.0.0.1:8787').replace(/\/$/,'');
const status=await (await fetch(base+'/api/demo/status')).json();
if(status.research_revision<7)throw new Error('Expected revision is not live; no request sent.');
if(status.inference!=='local'&&!args.includes('--allow-api-spend'))throw new Error('Hosted checks require --allow-api-spend. Six requests reserve at most $2.40 within the shared cap. No retries.');
const cases=[
 {id:'georgia',question:'What are the statute of limitations in Georgia?',expected:'clarify',review:'Ask the material claim type without inventing a single deadline.'},
 {id:'property',question:'Property damage',previous:0,expected:'research',review:'Retain Georgia and limitations. Distinguish ordinary property-damage periods from product repose; inspect code edition and exceptions.'},
 {id:'atlanta',question:'Is marijuana legal in Atlanta?',expected:'clarify',review:'Clarify recreational/medical scope, or give a supported overview of both.'},
 {id:'both',question:'Both',previous:2,expected:'research',review:'Retain Atlanta and marijuana. Distinguish state recreational law, city penalties and the current medical program. Check 2026 amendments; do not certify current law from an old press release.'},
 {id:'california',question:'How long does a California landlord have to return a residential security deposit?',expected:'research',review:'Answer with relevant California sources and deadline qualifications.'},
 {id:'roe',question:'What is the current situation with Roe v Wade?',expected:'research',review:'Identify the Dobbs overruling without claiming a comprehensive citator check.'}
];
const out=new URL('../.local-data/statutes/',import.meta.url);await mkdir(out,{recursive:true});const records=[];
for(const c of cases){
 const body={question:c.question,task:'auto',database_ids:status.databases.filter(d=>d.available&&d.id!=='cap').map(d=>d.id),request_id:crypto.randomUUID()};
 if(c.previous!==undefined)body.context=conversationContext([{...records[c.previous].response,question:cases[c.previous].question}]);
 const start=Date.now();
 const response=await fetch(base+'/api/demo/research',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
 const data=await response.json(),sources=new Map((data.sources||[]).map(s=>[s.id,s])),props=data.propositions||[],actual=data.follow_up?.kind||'research';
 const record={id:c.id,request:body,review_criteria:c.review,expected_action:c.expected,actual_action:actual,routing_pass:response.ok&&actual===c.expected,seconds:(Date.now()-start)/1000,http_status:response.status,retained:props.length,exact_passages:props.filter(p=>p.evidence_method==='exact_passage'&&p.quote?.length>=20&&sources.get(p.source_id)?.text.includes(p.quote)).length,web_citations:props.filter(p=>p.evidence_method==='web_citation').length,response:data};
 records.push(record);await writeFile(new URL(c.id+'.json',out),JSON.stringify(record,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({id:c.id,seconds:record.seconds,routing_pass:record.routing_pass,retained:record.retained,exact_passages:record.exact_passages,web_citations:record.web_citations,manual_review_required:true}));
 if(!response.ok)break;
}
