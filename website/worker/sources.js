import {retrieve as starter} from './research.js';

const encoder=new TextEncoder();
export class SourceError extends Error {}
const clean=v=>String(v??'').slice(0,2000);
export function plain(value) {
  return String(value??'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<\/(?:p|div|pre|head|h[1-6]|tr|section)>|<br\s*\/?\s*>/gi,'\n')
    .replace(/<[^>]*>/g,'').replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,(m,d,h,n)=>{
      if(d||h){const c=parseInt(d||h,h?16:10);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';}
      return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n]??m;
    }).replace(/\0/g,'').replace(/\s+/g,' ').trim();
}
export function catalog(env) {
  return [
    {id:'courtlistener',name:'CourtListener',available:!!env.COURTLISTENER_API_TOKEN,description:env.COURTLISTENER_API_TOKEN?'Live federal and state case-law search':'Needs an owner-supplied API token',kind:'cases'},
    {id:'ecfr',name:'eCFR',available:true,description:'Live search across federal regulations; dated source text',kind:'regulations'},
    {id:'federal_register',name:'Federal Register',available:true,description:'Rules, proposed rules, notices and presidential documents',kind:'notices'},
    {id:'cap',name:'CAP starter library',available:true,description:'12 Supreme Court opinions · 1938–2014 · works offline',kind:'cases',cases:12}
  ];
}
export function validateSelection(ids,env) {
  if(!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>!catalog(env).some(d=>d.id===id&&d.available)))throw new SourceError('Select at least one connected database.');
}
export function filters(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new SourceError('Use valid search filters.');
  const out={court:input.court||'',after:input.after||'',before:input.before||''};
  if(typeof out.court!=='string'||!/^([a-z0-9]{2,20})?$/.test(out.court))throw new SourceError('Use a CourtListener court ID, such as scotus or ca9.');
  for(const k of ['after','before'])if(out[k]&&(typeof out[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(out[k])||!Number.isFinite(Date.parse(out[k]))||new Date(out[k]).toISOString().slice(0,10)!==out[k]))throw new SourceError('Use valid dates for the search range.');
  if(out.after&&out.before&&out.after>out.before)throw new SourceError('The start date must come before the end date.');
  return out;
}
export function safeLink(value,host) {
  try{const u=new URL(value,'https://'+host);return u.protocol==='https:'&&u.hostname===host&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
export async function sourceRequest(env,provider,url,{method='GET',body,cache=false,json=true}={}) {
  const host={courtlistener:'www.courtlistener.com',ecfr:'www.ecfr.gov',federal_register:'www.federalregister.gov'}[provider];
  if(!host||!safeLink(url,host))throw new SourceError('Unsupported source address.');
  const now=Math.floor(Date.now()/1000);
  if(cache){const old=await env.DB.prepare('SELECT body FROM source_cache WHERE id=? AND expires>?').bind(url,now).first();if(old)return json?JSON.parse(old.body):old.body;}
  const headers={Accept:json?'application/json':'*/*','Accept-Encoding':'gzip','User-Agent':'LexRaptor/0.4 (+https://lexraptor.com)'};
  if(provider==='courtlistener'){
    if(!env.COURTLISTENER_API_TOKEN)throw new SourceError('CourtListener is not connected.');
    headers.Authorization='Token '+env.COURTLISTENER_API_TOKEN;
  }
  if(body)headers['Content-Type']='application/x-www-form-urlencoded';
  let response;
  try{response=await fetch(url,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(provider==='courtlistener'?45000:20000)});}catch{throw new SourceError('The source service did not respond. Try again later.');}
  if(!response.ok)throw new SourceError(response.status===429?'The source service is rate limited. Try again later.':response.status===401||response.status===403?'The source service declined access. Its connection needs attention.':'The source service could not complete this search.');
  const reader=response.body.getReader(),parts=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1500000){await reader.cancel();throw new SourceError('A source document exceeds the source size limit. Open the original record.');}parts.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  const text=new TextDecoder().decode(bytes);
  let data;try{data=json?JSON.parse(text):text;}catch{throw new SourceError('The source returned an unreadable response.');}
  if(cache&&size<900000){await env.DB.prepare('INSERT INTO source_cache(id,body,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(url,text,now+86400).run();}
  return data;
}
const tokens=q=>[...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g)||[])].filter(t=>!['the','and','what','does','about','that','this','from','with','have','under','which'].includes(t)).slice(0,40);
export function passages(text,meta,query) {
  const terms=tokens(query),chunks=[];
  for(let offset=0;offset<text.length;offset+=1600){const part=text.slice(offset,offset+1800);if(part.trim().length<30)continue;
    const words=new Set(part.toLowerCase().match(/[a-z0-9]+/g)||[]);
    const score=terms.reduce((n,t)=>n+(words.has(t)?1:0),0);
    chunks.push({...meta,id:meta.case_id+':'+offset,text:part,locator:`Whitespace-normalized extracted text, characters ${offset+1}–${offset+part.length}`,score});
  }
  return chunks.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,3).map(({score,...s})=>s);
}
function starterSearch(query,f) {
  if(f.court&&f.court!=='scotus')return [];
  return starter(query,f).map(s=>({...s,database_id:'cap',database_name:'CAP starter library',kind:'case',source_status:'Historical opinion; later treatment not checked'}));
}
async function courtlistener(env,query,f) {
  const u=new URL('https://www.courtlistener.com/api/rest/v4/search/');
  u.search=new URLSearchParams({q:query,type:'o',order_by:'score desc',highlight:'off',...(f.court?{court:f.court}:{}),...(f.after?{filed_after:f.after}:{}),...(f.before?{filed_before:f.before}:{})});
  const result=await sourceRequest(env,'courtlistener',u.href),hits=[],warnings=[];let downloaded=0;
  for(const c of (result.results||[]).slice(0,5)){
    for(const o of (c.opinions||[]).slice(0,1)){
      if(downloaded>=3)break;if(!Number.isSafeInteger(o.id))continue;
      downloaded++;
      let full;try{full=await sourceRequest(env,'courtlistener',`https://www.courtlistener.com/api/rest/v4/opinions/${o.id}/`,{cache:true});}catch(e){warnings.push(`Opinion ${o.id}: ${e instanceof SourceError?e.message:'Retrieval failed.'}`);continue;}
      const text=plain(full.plain_text||full.html_with_citations||full.html||full.html_lawbox||full.html_columbia||full.xml_harvard||'');
      if(!text){warnings.push(`Opinion ${o.id}: no usable full text returned.`);continue;}
      hits.push(...passages(text,{case_id:'cl-'+o.id,name:clean(plain(c.caseName)),citation:clean(plain((c.citation||[]).join('; '))),court:clean(c.court),decision_date:clean(c.dateFiled),opinion_type:clean(o.type||full.type||'not specified'),source_url:safeLink(c.absolute_url,'www.courtlistener.com'),database_id:'courtlistener',database_name:'CourtListener',kind:'case',source_status:'Citation existence and exact text only; later treatment not checked'},query));
    }
  }
  return {sources:hits,total:result.count??null,note:'Published opinions; up to 3 full opinion records per search. No search snippets are used as evidence.',warnings};
}
async function federalRegister(env,query,f) {
  const u=new URL('https://www.federalregister.gov/api/v1/documents.json');
  u.search=new URLSearchParams({'conditions[term]':query,per_page:'3',order:'relevance',...(f.after?{'conditions[publication_date][gte]':f.after}:{}),...(f.before?{'conditions[publication_date][lte]':f.before}:{})});
  const result=await sourceRequest(env,'federal_register',u.href),hits=[],warnings=[];
  for(const r of (result.results||[]).slice(0,3)){
    if(!/^\d{4}-\d+$/.test(r.document_number))continue;
    try{
      const full=await sourceRequest(env,'federal_register',`https://www.federalregister.gov/api/v1/documents/${r.document_number}.json`,{cache:true});
      const url=safeLink(full.raw_text_url,'www.federalregister.gov');if(!url)continue;
      const text=plain(await sourceRequest(env,'federal_register',url,{cache:true,json:false}));
      hits.push(...passages(text,{case_id:'fr-'+r.document_number,name:clean(full.title),citation:clean(full.citation||r.document_number),court:clean((full.agencies||[]).map(a=>a.name).join(', ')),decision_date:clean(full.publication_date),opinion_type:clean(full.type),source_url:safeLink(full.html_url,'www.federalregister.gov'),official_url:safeLink(full.pdf_url,'www.govinfo.gov'),database_id:'federal_register',database_name:'Federal Register',kind:'regulatory document',source_status:clean(full.type)+(full.effective_on?'; stated effective date '+clean(full.effective_on):'; no effective date supplied')+'; verify operative status in the official edition'},query));
    }catch(e){warnings.push(`${r.document_number}: ${e instanceof SourceError?e.message:'Document retrieval failed.'}`);}
  }
  return {sources:hits,total:result.count??null,note:'Up to 3 full documents. Proposed rules and notices are not automatically binding law.',warnings};
}
async function ecfr(env,query) {
  const u=new URL('https://www.ecfr.gov/api/search/v1/results');u.search=new URLSearchParams({query,per_page:'3'});
  const [result,titles]=await Promise.all([sourceRequest(env,'ecfr',u.href),sourceRequest(env,'ecfr','https://www.ecfr.gov/api/versioner/v1/titles.json',{cache:true})]);
  const hits=[],warnings=[],seen=new Set();
  for(const r of (result.results||[]).slice(0,3)){
    const h=r.hierarchy||{},title=(titles.titles||[]).find(t=>String(t.number)===h.title),date=title?.up_to_date_as_of;
    if(r.type!=='Section'||r.removed||r.reserved||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d+$/.test(h.title||'')||!/^\d[\w.\-]*$/.test(h.section||''))continue;
    const sectionKey=`${h.title}:${h.part||''}:${h.section}:${date}`;
    if(seen.has(sectionKey))continue;seen.add(sectionKey);
    const url=new URL(`https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${h.title}.xml`);url.search=new URLSearchParams({section:h.section,...(h.part?{part:h.part}:{})});
    try{
      const text=plain(await sourceRequest(env,'ecfr',url.href,{cache:true,json:false}));
      hits.push(...passages(text,{case_id:`ecfr-${h.title}-${h.section}-${date}`,name:plain(r.headings?.section||h.section),citation:`${h.title} CFR ${h.section}`,court:plain(r.headings?.chapter||title.name),decision_date:date,opinion_type:'Regulation',source_url:`https://www.ecfr.gov/on/${date}/title-${h.title}/section-${h.section}`,database_id:'ecfr',database_name:'eCFR',kind:'regulation',source_status:`eCFR snapshot as of ${date}; an editorial compilation, not an official legal edition`},query));
    }catch(e){warnings.push(`${h.title} CFR ${h.section}: ${e instanceof SourceError?e.message:'Section retrieval failed.'}`);}
  }
  return {sources:hits,total:result.meta?.total_count??result.meta?.total_results??null,note:'Up to 3 dated sections. Court and publication-date filters do not apply to this current eCFR snapshot.',warnings};
}
export async function searchSources(env,{query,database_ids,...f}) {
  const outcomes=await Promise.all(database_ids.map(async id=>{
    try{const result=id==='cap'?{sources:starterSearch(query,f),total:null,note:'Search of the 12 imported starter opinions.'}:await ({courtlistener,ecfr,federal_register:federalRegister}[id])(env,query,f);
      return {id,status:result.sources.length?'ok':(result.warnings?.length?'unavailable':'empty'),...result};
    }catch(e){return {id,status:'unavailable',sources:[],total:null,note:e instanceof SourceError?e.message:'This database could not be searched.'};}
  }));
  // Interleave databases so one selected collection cannot consume the entire
  // context. Full passages, not search snippets, enter citation validation.
  const sources=[];for(let i=0;i<12;i++)for(const outcome of outcomes){const s=outcome.sources[i];if(s)sources.push(s);}
  return {sources:sources.slice(0,32),searched:outcomes.map(({sources,...r})=>({...r,passages:sources.length})),retrieved_at:new Date().toISOString()};
}
export function evidenceSubset(sources,maxBytes=22000) {
  const result=[];let size=0;
  for(const s of sources){const n=encoder.encode(JSON.stringify(s)).length;if(size+n<=maxBytes){result.push(s);size+=n;}if(result.length===12)break;}
  return result.map((s,i)=>({...s,original_id:s.id,id:'S'+(i+1)}));
}
export async function auditCitations(env,text) {
  const rows=await sourceRequest(env,'courtlistener','https://www.courtlistener.com/api/rest/v4/citation-lookup/',{method:'POST',body:new URLSearchParams({text}).toString()});
  if(!Array.isArray(rows))throw new SourceError('The citation service returned an unreadable response.');
  return rows.slice(0,50).map(r=>({citation:clean(r.citation),status:r.status,normalized:(r.normalized_citations||[]).slice(0,5).map(clean),matches:(r.clusters||[]).slice(0,5).map(c=>({name:clean(c.case_name),url:safeLink(c.absolute_url,'www.courtlistener.com')}))}));
}
