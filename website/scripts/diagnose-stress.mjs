#!/usr/bin/env node
// Development evaluation; retained failures require qualitative source review.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const args=process.argv.slice(2),base=(args.find(a=>a.startsWith('http'))||'http://127.0.0.1:8787').replace(/\/$/,''),url=new URL(base);
if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Use a plain HTTP(S) origin.');
const status=await (await fetch(base+'/api/demo/status')).json();
if(status.research_revision<10)throw new Error('Expected research revision 10 or later; no requests sent.');
const selected=args.find(a=>a.startsWith('--cases='))?.slice(8).split(',');
const cases=JSON.parse(await readFile(new URL('./stress-cases.json',import.meta.url),'utf8')).filter(c=>!selected||selected.includes(c.id));
if(!cases.length)throw new Error('No matching cases.');
if(status.inference!=='local'&&!args.includes('--allow-api-spend'))throw new Error(`Hosted tests require --allow-api-spend. ${cases.length} requests can reserve up to $${(cases.length*.40).toFixed(2)} within the shared cap. No retries.`);
const directory=new URL('../.local-data/stress/',import.meta.url);await mkdir(directory,{recursive:true});
const destination=new URL(new Date().toISOString().replace(/[:.]/g,'-')+'.json',directory),records=[];
for(const c of cases){
 const body={question:c.question,task:'auto',database_ids:c.database_ids||status.databases.filter(d=>d.available&&d.id!=='cap').map(d=>d.id),request_id:crypto.randomUUID()};
 if(c.context)body.context=c.context;if(c.documents)Object.assign(body,{documents:c.documents,document_mode:'only'});
 const start=Date.now();let data,http_status;
 try{const response=await fetch(base+'/api/demo/research',{method:'POST',headers:{'Content-Type':'application/json',Origin:url.origin},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});http_status=response.status;data=await response.json();}
 catch(e){data={error:e.name,uncertain_cost:true};}
 const record={id:c.id,request:body,review_criteria:c.review,expected_action:c.expected||'research',seconds:(Date.now()-start)/1000,http_status,response:data};records.push(record);
 await writeFile(destination,JSON.stringify({revision:status.research_revision,model:status.model,results:records},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({id:c.id,seconds:record.seconds,action:data.follow_up?.kind||'research',retained:data.propositions?.length||0,removed:data.removed||0,unanswered:data.unanswered_issues?.length||0,error:data.error,manual_review_required:true}));
 if(data.error||http_status>=400)break;
}
console.log(`Saved ${records.length} ungraded outcomes to ${destination.pathname}`);
