// Small development diagnostic. Requires a running LOCAL workbench and never
// runs against an API-model deployment. It is not a held-out legal benchmark.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const base=process.env.LEX_RAPTOR_BASE_URL||'http://127.0.0.1:8787';
const status=await (await fetch(base+'/api/demo/status')).json();
if(status.inference!=='local')throw new Error('This diagnostic requires local inference; paid API runs are disabled.');
const tasks=JSON.parse(await readFile(new URL('../../benchmark/workbench/tasks.json',import.meta.url),'utf8'));
const dir=new URL('../.local-data/',import.meta.url);await mkdir(dir,{recursive:true});
const destination=new URL('diagnostic-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',dir),results=[];
for(const task of tasks){
  const start=Date.now();
  try{
    const response=await fetch(base+'/api/demo/research',{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json'},body:JSON.stringify({...task,request_id:crypto.randomUUID()}),signal:AbortSignal.timeout(240000)});
    const result=await response.json(),props=result.propositions||[],sources=new Map((result.sources||[]).map(s=>[s.id,s]));
    results.push({case:task,http_status:response.status,seconds:(Date.now()-start)/1000,retained:props.length,exact_quotes:props.filter(p=>p.quote?.length>=20&&sources.get(p.source_id)?.text.includes(p.quote)).length,removed:result.removed||0,result});
  }catch(e){results.push({case:task,error:e.name,seconds:(Date.now()-start)/1000});}
  await writeFile(destination,JSON.stringify(results,null,2));
  const {case:taskInfo,result,...summary}=results.at(-1);console.log(JSON.stringify({id:taskInfo.id,...summary}));
}
console.log('Saved '+destination.pathname);
