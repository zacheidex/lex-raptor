import {retrieve as starter,modelSource} from './research.js';
import {limited,checkpoint} from './runtime.js';

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
    {id:'legal_web',name:'Public legal web',available:env.LOCAL_RESEARCH!=='true'&&env.DEMO_ENABLED==='true'&&!!env.OPENAI_API_KEY,description:env.LOCAL_RESEARCH==='true'?'Hosted AI feature; local inference never calls the paid web tool':'Statutes, government guidance and municipal codes · AI search',kind:'web'},
    {id:'cap',name:'CAP starter library',available:true,description:'12 Supreme Court opinions · 1938–2014 · works offline',kind:'cases',cases:12}
  ];
}
export function validateSelection(ids,env) {
  if(!Array.isArray(ids)||!ids.length||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>!catalog(env).some(d=>d.id===id&&d.available)))throw new SourceError('Select at least one connected database.');
}
export function filters(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new SourceError('Use valid search filters.');
  const out={court:input.court||'',after:input.after||'',before:input.before||''};
  if(typeof out.court!=='string'||!/^([a-z0-9]{2,20}( [a-z0-9]{2,20}){0,599})?$/.test(out.court))throw new SourceError('Use a CourtListener court ID, such as scotus or ca9.');
  for(const k of ['after','before'])if(out[k]&&(typeof out[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(out[k])||!Number.isFinite(Date.parse(out[k]))||new Date(out[k]).toISOString().slice(0,10)!==out[k]))throw new SourceError('Use valid dates for the search range.');
  if(out.after&&out.before&&out.after>out.before)throw new SourceError('The start date must come before the end date.');
  return out;
}
export function safeLink(value,host) {
  if(typeof value!=='string'||!value.trim())return '';
  try{const u=new URL(value,'https://'+host);return u.protocol==='https:'&&u.hostname===host&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
export function opinionText(raw){
 const input=raw.xml_harvard||raw.html_with_citations||raw.html||raw.html_lawbox||raw.html_columbia||raw.plain_text||'';
 return plain(input.replace(/<(?:page-number|span)\b([^>]*(?:star-pagination|citation-index)[^>]*)>([\s\S]*?)<\/(?:page-number|span)>/gi,(m,attrs,inner)=>{const label=attrs.match(/label=["']([^"']+)["']/)?.[1]||plain(inner).replace(/^\*/,'');return /^\d+[A-Za-z]?$/.test(label)?' [Source page '+label+'] ':inner;}));
}

export async function sourceRequest(env,provider,url,{method='GET',body,cache=false,json=true}={}) {
  await checkpoint(env);
  const host={courtlistener:'www.courtlistener.com',ecfr:'www.ecfr.gov',federal_register:'www.federalregister.gov'}[provider];
  if(!host||!safeLink(url,host))throw new SourceError('Unsupported source address.');
  const now=Math.floor(Date.now()/1000);
  if(cache){const old=await env.DB.prepare('SELECT body FROM source_cache WHERE id=? AND expires>?').bind(url,now).first();if(old){if(env.REQUEST)env.REQUEST.metrics.cache_hits++;return json?JSON.parse(old.body):old.body;}}
  const headers={Accept:json?'application/json':'*/*','Accept-Encoding':'gzip','User-Agent':'LexRaptor/0.4 (+https://lexraptor.com)'};
  if(provider==='courtlistener'){
    if(!env.COURTLISTENER_API_TOKEN)throw new SourceError('CourtListener is not connected.');
    headers.Authorization='Token '+env.COURTLISTENER_API_TOKEN;
  }
  if(body)headers['Content-Type']='application/x-www-form-urlencoded';
  return limited(env,provider,async()=>{
  let response;
  try{response=await fetch(url,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(provider==='courtlistener'?45000:20000)});}catch(e){if(e.status===499)throw e;throw new SourceError('The source service did not respond. Try again later.');}
  if(!response.ok)throw new SourceError(response.status===429?'The source service is rate limited. Try again later.':response.status===401||response.status===403?'The source service declined access. Its connection needs attention.':'The source service could not complete this search.');
  const reader=response.body.getReader(),parts=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1500000){await reader.cancel();throw new SourceError('A source document exceeds the source size limit. Open the original record.');}parts.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  const text=new TextDecoder().decode(bytes);
  let data;try{data=json?JSON.parse(text):text;}catch{throw new SourceError('The source returned an unreadable response.');}
  if(cache&&size<900000){await env.DB.prepare('INSERT INTO source_cache(id,body,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(url,text,now+86400).run();}
  return data;
  });
}
const tokens=q=>[...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g)||[])].filter(t=>!['the','and','what','does','about','that','this','from','with','have','under','which'].includes(t)).slice(0,40);
export function passages(text,meta,query,{treatment=false,brief=false}={}) {
  const terms=tokens(query),chunks=[];
  for(let offset=0;offset<text.length;offset+=1600){const part=text.slice(offset,offset+1800);if(part.trim().length<30)continue;
    const words=new Set(part.toLowerCase().match(/[a-z0-9]+/g)||[]);
    let score=terms.reduce((n,t)=>n+(words.has(t)?1:0),0);
    if(treatment&&score){
      if(/overrul\w*|abrogat\w*|supersed\w*|reaffirm\w*|no longer good law/i.test(part))score+=12;
      if(/we (?:therefore )?(?:hold|overrule|reaffirm)|(?:is|are|must be|hereby) overruled/i.test(part))score+=16;
      if(/do(?:es)? not call into question|still subject to.*stare decisis|does not (?:overrule|disturb)/i.test(part))score+=16;
    }
    if(brief){if(/we (?:therefore )?(?:hold|conclude)|(?:is|are|must be|hereby) overruled|judgment.{0,80}(?:reversed|affirmed|vacated)|essential to a fair trial/i.test(part))score+=10;}
    chunks.push({...meta,id:meta.case_id+':'+offset,text:part,locator:`Whitespace-normalized extracted text, characters ${offset+1}–${offset+part.length}`,score,offset});
  }
  const ranked=[...chunks].sort((a,b)=>b.score-a.score||a.offset-b.offset);
  const chosen=brief&&chunks.length?[chunks[0],...ranked.filter(c=>c.offset!==0).slice(0,2)]:ranked.slice(0,3);
  return chosen.map(({score,offset,...s})=>s);
}
function starterSearch(query,f) {
  if(f.court&&f.court!=='scotus')return [];
  return starter(query,f).map(s=>({...s,database_id:'cap',database_name:'CAP starter library',kind:'case',source_status:'Historical opinion; later treatment not checked'}));
}
// These searches discover possible treatment, not a comprehensive citator.
// Named cases are resolved by caseName + citation prominence, so a two-line
// rehearing order does not displace the principal decision on name alone.
export function caseNameQuery(name) {
  const words=String(name).replace(/\b(?:v|vs|versus)\.?\b/gi,' ').match(/[\p{L}\p{N}]+/gu)||[];
  return words.length?`caseName:(${words.slice(0,18).join(' AND ')})`:'';
}
async function courtlistener(env,query,f,progress=()=>{}) {
  const warnings=[],searches=[],seen=new Set(),groups=[];
  let downloaded=0;
  const status=f.research_focus==='case_status';
  const name=f.case_name||(!f.manual_query&&/\bv(?:s)?\.?\s/i.test(query)&&query.length<160?query:'');
  async function search(q,scope,order,phase){
    const semantic=phase==='original'&&!name&&f.topic_search==='semantic';
    progress({stage:'searching',message:phase==='original'?(name?'Finding the principal opinion…':'Finding opinions about your question…'):'Searching for later treatment…',database:'courtlistener'});
    const u=new URL('https://www.courtlistener.com/api/rest/v4/search/');
    u.search=new URLSearchParams({q,type:'o',order_by:order,highlight:'off',...(semantic?{semantic:'true'}:{}),...(scope.court?{court:scope.court}:{}),...(scope.after?{filed_after:scope.after}:{}),...(scope.before?{filed_before:scope.before}:{})});
    const record={phase,query:q,mode:semantic?'semantic':'keyword',court:scope.court||'',after:scope.after||'',before:scope.before||'',order,status:'pending',matches:null};searches.push(record);
    try{const result=await sourceRequest(env,'courtlistener',u.href);record.status='ok';record.matches=result.count??null;return result;}catch(e){record.status='unavailable';throw e;}
  }
  async function read(c,phase){
    const priority=['lead-opinion','unanimous-opinion','combined-opinion','plurality-opinion','on-the-merits'];
    const opinions=[...(c.opinions||[])].sort((a,b)=>{
      const rank=o=>{const n=priority.indexOf(o.type);return n<0?20:n;};return rank(a)-rank(b);
    });
    const o=opinions.find(o=>Number.isSafeInteger(o.id));
    if(!o||seen.has(c.cluster_id||c.absolute_url||o.id)||downloaded>=4)return;
    seen.add(c.cluster_id||c.absolute_url||o.id);downloaded++;const rank=downloaded;
    progress({stage:'reading',message:'Reading '+plain(c.caseName).slice(0,160)+'…',database:'courtlistener'});
    try{
      const full=await sourceRequest(env,'courtlistener',`https://www.courtlistener.com/api/rest/v4/opinions/${o.id}/`,{cache:true});
      const text=opinionText(full);const clusterId=Number(c.cluster_id)||Number(String(full.cluster||'').match(/\/(\d+)\/?$/)?.[1])||undefined;if(c.cluster_id&&full.cluster&&Number(String(full.cluster).match(/\/(\d+)\/?$/)?.[1])!==Number(c.cluster_id))throw new SourceError('The opinion did not match the returned case identity.');
      if(!text){warnings.push(`Opinion ${o.id}: no usable full text returned.`);return;}
      const record=passages(text,{case_id:'cl-'+o.id,cluster_id:clusterId,opinion_id:o.id,identity:clusterId?'cl-'+clusterId:undefined,court_id:c.court_id||'',source_kind:'Court opinion text via CourtListener; provider transcription',short_name:clean(plain(c.caseNameShort||c.caseName)),name:clean(plain(c.caseName)),citation:clean(plain((c.citation||[]).join('; '))),court:clean(c.court),decision_date:clean(c.dateFiled),opinion_type:clean(o.type||full.type||'not specified'),source_url:safeLink(c.absolute_url,'www.courtlistener.com'),official_url:safeLink(o.download_url||full.download_url,'www.supremecourt.gov'),database_id:'courtlistener',database_name:'CourtListener',kind:'case',research_role:phase,source_status:phase==='original'?'Original search result; does not establish current validity':'Later-treatment search result; read the opinion to establish what treatment occurred. Not a citator determination.'},name||query,{treatment:status&&phase!=='original',brief:f.task==='brief'&&phase==='original'});
      groups.push({rank,passages:record});
    }catch(e){warnings.push(`Opinion ${o.id}: ${e instanceof SourceError?e.message:'Retrieval failed.'}`);}
  }
  const original=f.resolved_case?{count:1,results:[{caseName:f.resolved_case.name,court_id:f.resolved_case.court_id,dateFiled:f.resolved_case.date,cluster_id:f.resolved_case.id,opinions:[]}]}:await search(name?caseNameQuery(name):query,f,name?'citeCount desc':'score desc','original');
  const primary=original.results?.[0];
  await Promise.all((original.results||[]).slice(0,status&&name?1:3).map(c=>read(c,'original')));
  if(status&&name){
    const target=plain(primary?.caseName||name).replace(/["\\]/g,' ').slice(0,180);
    const q=`"${target}" AND (overrul* OR abrogat* OR supersed* OR reaffirm*)`;
    // A Supreme Court precedent's controlling judicial treatment is sought in
    // that court. For other courts leave scope broad enough for higher courts.
    const scope={...f,court:f.court||(primary?.court_id==='scotus'?'scotus':''),after:[f.after,primary?.dateFiled].filter(Boolean).sort().at(-1)||''};
    if(!scope.before||scope.after<=scope.before){
      // A model-suggested later case is only a search lead. It is never supplied
      // to the answer as a fact: only retrieved opinion text can support it.
      let leadRead=false,blocked=false;
      if(f.later_case_name&&f.later_case_name.toLowerCase()!==name.toLowerCase()){
        try{const candidate=await search(caseNameQuery(f.later_case_name),scope,'citeCount desc','candidate-treatment');const before=groups.length;for(const c of (candidate.results||[]).slice(0,1))await read(c,'candidate-treatment');leadRead=groups.length>before;}
        catch(e){warnings.push(e instanceof SourceError?e.message:'Later-decision search failed.');blocked=true;}
      }
      for(const [order,phase,count] of blocked?[]:[['score desc','later-treatment',leadRead?1:2],['dateFiled desc','recent-treatment',1]]){
        try{const result=await search(q,scope,order,phase);const candidates=(result.results||[]).filter(c=>!seen.has(c.cluster_id||c.absolute_url||c.opinions?.[0]?.id));await Promise.all(candidates.slice(0,count).map(c=>read(c,phase)));}
        catch(e){warnings.push(e instanceof SourceError?e.message:'Later-treatment search failed.');break;}
      }
    }
    if(!groups.some(g=>g.passages[0]?.research_role!=='original'))warnings.push('No later-treatment full text was retrieved. The original decision alone cannot establish present validity.');
  }
  // Put later treatment before the original for status questions; interleave
  // opinions so the source context contains more than one authority.
  groups.sort((a,b)=>(status?Number(a.passages[0]?.research_role==='original')-Number(b.passages[0]?.research_role==='original'):0)||a.rank-b.rank);
  const hits=[];
  // Give a specifically retrieved later decision enough context to retain its
  // qualifications, without letting it consume every authority slot.
  const candidate=groups.find(g=>g.passages[0]?.research_role==='candidate-treatment');
  if(candidate)hits.push(...candidate.passages.slice(0,2));
  for(let i=0;i<3;i++)for(const group of groups)if(group.passages[i]&&!hits.includes(group.passages[i]))hits.push(group.passages[i]);
  const availability=hits.length?'ok':warnings.length&&searches.some(s=>s.status!=='ok'||s.matches!==0)?'unavailable':'empty';
  return {status:availability,sources:hits,total:original.count??null,note:status?'Principal opinion plus targeted and recent later-treatment searches; up to 4 full opinions. This is a limited search, not a complete good-law check.':'Published opinions; up to 3 full opinions, preferring lead opinions. Search snippets are never evidence.',warnings,searches};
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
export async function searchSources(env,{query,database_ids,...f},progress=()=>{}) {
  const outcomes=await Promise.all(database_ids.map(async id=>{
    if(id==='legal_web')return {id,status:'pending',sources:[],total:null,note:'Public legal web search runs only with AI Send; Source search makes no paid web calls.'};
    progress({stage:'searching',database:id,message:'Searching '+(catalog(env).find(d=>d.id===id)?.name||id)+'…'});
    try{const result=id==='cap'?{sources:starterSearch(query,f),total:null,note:'Search of the 12 imported starter opinions.'}:await ({courtlistener,ecfr,federal_register:federalRegister}[id])(env,query,f,progress);
      progress({stage:'authorities',database:id,sources:result.sources,message:'Authorities available from '+id});
      progress({stage:'source_complete',database:id,message:(catalog(env).find(d=>d.id===id)?.name||id)+': '+result.sources.length+' passages retrieved.'});
      return {id,status:result.sources.length?'ok':(result.warnings?.length?'unavailable':'empty'),...result};
    }catch(e){progress({stage:'source_complete',database:id,message:(catalog(env).find(d=>d.id===id)?.name||id)+': unavailable.'});return {id,status:'unavailable',sources:[],total:null,note:e instanceof SourceError?e.message:'This database could not be searched.'};}
  }));
  // Interleave databases so one selected collection cannot consume the entire
  // context. Full passages, not search snippets, enter citation validation.
  const sources=[];for(let i=0;i<12;i++)for(const outcome of outcomes){const s=outcome.sources[i];if(s)sources.push(s);}
  return {sources:sources.slice(0,32),searched:outcomes.map(({sources,...r})=>({...r,passages:sources.length})),retrieved_at:new Date().toISOString()};
}
export function evidenceSubset(sources,maxBytes=22000) {
  const result=[];let size=0;
  for(const s of sources){const n=encoder.encode(JSON.stringify(modelSource(s))).length;if(size+n<=maxBytes){result.push(s);size+=n;}if(result.length===12)break;}
  return result.map((s,i)=>({...s,original_id:s.id,id:'S'+(i+1)}));
}
export async function auditCitations(env,text) {
  const rows=await sourceRequest(env,'courtlistener','https://www.courtlistener.com/api/rest/v4/citation-lookup/',{method:'POST',body:new URLSearchParams({text}).toString()});
  if(!Array.isArray(rows))throw new SourceError('The citation service returned an unreadable response.');
  return rows.slice(0,50).map(r=>({citation:clean(r.citation),status:r.status,normalized:(r.normalized_citations||[]).slice(0,5).map(clean),matches:(r.clusters||[]).slice(0,5).map(c=>({name:clean(c.case_name),url:safeLink(c.absolute_url,'www.courtlistener.com')}))}));
}
