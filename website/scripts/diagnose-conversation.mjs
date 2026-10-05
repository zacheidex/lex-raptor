#!/usr/bin/env node
// Development routing and retrieval checks, not a legal-accuracy score.
import {mkdir,writeFile} from 'node:fs/promises';
import {conversationContext} from '../shared/conversation.js';
const args=process.argv.slice(2),base=(args.find(a=>a.startsWith('http'))||'http://127.0.0.1:8787').replace(/\/$/,'');
const status=await (await fetch(base+'/api/demo/status')).json();
if(!status.clarifying_questions||status.research_revision<5)throw new Error('Expected research revision is not live; no test sent.');
if(status.inference!=='local'&&!args.includes('--allow-api-spend'))throw new Error('Hosted checks require --allow-api-spend. Twelve requests reserve at most $4.80 within the server budget; no retries.');
const tests=[
 {id:'georgia',question:'What is the statute of limitations in Georgia?',expected:'clarify',review:'Ask the claim/offense type; do not state one deadline.'},
 {id:'landlord',question:'Can my landlord do that?',expected:'clarify',review:'Ask what happened and/or the jurisdiction.'},
 {id:'recording',question:'Can I secretly record my boss at work?',expected:'clarify',review:'Ask the relevant jurisdiction before giving a rule.'},
 {id:'appeal',question:'How long do I have to appeal?',expected:'clarify',review:'Ask decision/court/jurisdiction, not one guessed deadline.'},
 {id:'noncompete',question:'Is my noncompete enforceable?',expected:'clarify',review:'Ask governing law or material context.'},
 {id:'greeting',question:'Hello there!',expected:'scope',review:'Friendly invitation, no legal database retrieval.'},
 {id:'foreign',question:'What is the current inheritance law in Japan?',expected:'scope',review:'Disclose unavailable foreign law coverage, not U.S. opinions.'},
 {id:'clear',question:'What does Celotex Corp. v. Catrett say about the summary judgment burden?',expected:'research',databases:['cap'],review:'Proceed without unnecessary clarification; inspect quote support.'},
 {id:'followup',question:'Personal injury',expected:'research',review:'Retain Georgia and limitations from the first turn; inspect retrieved Georgia opinions and limitations/exceptions.'},
 {id:'california',question:'When must a California landlord return a security deposit?',expected:'research',databases:'auto',review:'Use California authorities; disclose state-code gap and inspect exceptions.'},
 {id:'newyork',question:'What is the general statute of limitations for breach of a written contract in New York?',expected:'research',databases:'auto',review:'Use New York authorities; inspect rule and coverage limits.'},
 {id:'overview',question:'Give a general overview of limitation periods for civil claims in Georgia; I am not asking for a deadline for a specific case.',expected:'research',databases:'auto',review:'Respect the explicit overview request without demanding a claim type; inspect breadth and omissions.'}
];
const output=new URL('../.local-data/conversation/',import.meta.url);await mkdir(output,{recursive:true});const records=[];
for(const test of tests){
 const body={question:test.question,task:'auto',database_ids:test.databases||status.databases.filter(d=>d.available&&d.id!=='cap').map(d=>d.id),request_id:crypto.randomUUID()};
 if(test.id==='followup')body.context=conversationContext([{...records[0].response,question:tests[0].question}]);
 const started=Date.now();
 const r=await fetch(base+'/api/demo/research',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
 const data=await r.json(),actual=data.follow_up?.kind||'research',sources=new Map((data.sources||[]).map(s=>[s.id,s]));
 const record={id:test.id,request:body,expected_action:test.expected,actual_action:actual,routing_pass:r.ok&&actual===test.expected,review_criteria:test.review,http_status:r.status,seconds:(Date.now()-started)/1000,retained:data.propositions?.length||0,web_citations:(data.propositions||[]).filter(p=>p.evidence_method==='web_citation').length,literal_quotes:(data.propositions||[]).filter(p=>p.evidence_method!=='web_citation'&&p.quote?.length>=20&&sources.get(p.source_id)?.text.includes(p.quote)).length,response:data};
 records.push(record);await writeFile(new URL(test.id+'.json',output),JSON.stringify(record,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({id:test.id,action:actual,routing_pass:record.routing_pass,seconds:record.seconds,retained:record.retained,follow_up:data.follow_up,filters:data.filters,manual_review_required:true}));
 if(!r.ok)break;
}
