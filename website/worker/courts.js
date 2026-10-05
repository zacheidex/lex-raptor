import {sourceRequest,SourceError} from './sources.js';
import snapshot from './court-directory.json' with {type:'json'};
import states from './state-courts.json' with {type:'json'};
export const stateOptions=Object.entries(states).map(([id,s])=>({id,name:s.name}));
export async function courts(env){
 const key='court-directory:v3',now=Math.floor(Date.now()/1000);
 const saved=await env.DB.prepare('SELECT body FROM source_cache WHERE id=? AND expires>?').bind(key,now).first();if(saved)return JSON.parse(saved.body);
 if(Date.now()-Date.parse(snapshot.retrieved_at)<86400000)return {...snapshot,metadata_mode:'packaged provider snapshot'};
 try{
 let url='https://www.courtlistener.com/api/rest/v4/courts/?in_use=true&page_size=100&fields=id,full_name,short_name,jurisdiction,in_use,start_date,end_date',all=[];
 for(let i=0;i<30&&url;i++){
  const page=await sourceRequest(env,'courtlistener',url,{cache:true});all.push(...(page.results||[]));
  url=typeof page.next==='string'&&page.next.startsWith('https://www.courtlistener.com/api/rest/v4/courts/?')?page.next:'';
 }
 const rows=all.filter(c=>/^[a-z0-9]{2,20}$/.test(c.id)).map(c=>({id:c.id,name:c.full_name||c.short_name||c.id,short_name:c.short_name||c.id,jurisdiction:c.jurisdiction,level:c.jurisdiction?.startsWith('F')?'federal':/^S(?:A|T|S)?$/.test(c.jurisdiction)?'state':'other',state:stateOptions.find(s=>new RegExp('\\b'+s.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(c.full_name)||states[s.id].courts.includes(c.id))?.id||'',start_date:c.start_date,end_date:c.end_date}));
 const result={courts:rows,states:stateOptions,partial:!!url,retrieved_at:new Date().toISOString(),source:'CourtListener court metadata'};
 if(!url)await env.DB.prepare('INSERT INTO source_cache(id,body,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(key,JSON.stringify(result),now+86400).run();return result;
 }catch(error){const fallback={...snapshot,notice:'Live court metadata is temporarily unavailable. Using the provider directory retrieved '+snapshot.retrieved_at.slice(0,10)+'.',metadata_mode:'provider snapshot fallback'};await env.DB.prepare('INSERT INTO source_cache(id,body,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(key,JSON.stringify(fallback),now+3600).run();return fallback;}
}
export function validateScope(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new SourceError('Choose a valid jurisdiction.');
 const scope={level:value.level||'any',state:value.state||'',court_ids:value.court_ids||[],after:value.after||'',before:value.before||'',governing_law:typeof value.governing_law==='string'?value.governing_law.slice(0,120):''};
 if(!['any','federal','state'].includes(scope.level)||scope.state&&!states[scope.state]||!Array.isArray(scope.court_ids)||scope.court_ids.length>12||scope.court_ids.some(id=>typeof id!=='string'||! /^[a-z0-9]{2,20}$/.test(id)))throw new SourceError('Select supported courts and a valid state.');
 for(const date of [scope.after,scope.before])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new SourceError('Choose valid scope dates.');
 if(scope.after&&scope.before&&scope.after>scope.before)throw new SourceError('The start date is later than the end date.');return scope;
}
export async function scopeFilters(env,scope){
 const selected=scope.court_ids.length||scope.level!=='any'||scope.state;
 if(!selected)return {court:'',after:scope.after,before:scope.before,labels:[],...scope};
 const directory=await courts(env);
 const rows=directory.courts.filter(c=>(!scope.state||c.state===scope.state)&&(scope.level==='any'||c.level===scope.level)&&(!scope.court_ids.length||scope.court_ids.includes(c.id)));
 if(scope.court_ids.some(id=>!rows.some(c=>c.id===id)))throw new SourceError('A selected court conflicts with the state/federal scope or is unavailable.');
 if(!rows.length||directory.partial&&!scope.court_ids.length)throw new SourceError('Court metadata could not resolve this scope. Choose specific available courts or retry.');
 return {...scope,court:rows.map(c=>c.id).join(' '),after:scope.after,before:scope.before,labels:scope.court_ids.length?rows.map(c=>c.name):[],description:[scope.level==='any'?'All court levels':scope.level,states[scope.state]?.name,scope.court_ids.length?rows.map(c=>c.name).join(', '):'',scope.after?'from '+scope.after:'',scope.before?'through '+scope.before:''].filter(Boolean).join(' · ')};
}
export function relationship(source,scope){
 if(!scope?.court_ids?.length||!scope.governing_law||!source.court_id)return 'Jurisdiction relationship undetermined.';
 if(scope.court_ids.includes(source.court_id))return 'Same selected court; precedential force is undetermined.';
 return 'Different from the selected court; precedential force is undetermined.';
}
