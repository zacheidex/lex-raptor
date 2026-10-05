import {sourceRequest,plain,safeLink,SourceError,caseNameQuery,passages,opinionText} from './sources.js';
import {citationOccurrences,citationKey,exactIntent} from '../shared/citations.js';
import corpus from './corpus.json' with {type:'json'};
import {checkpoint} from './runtime.js';
const api='https://www.courtlistener.com/api/rest/v4/';
const idFrom=value=>Number(String(value||'').match(/\/(\d+)\/?$/)?.[1])||null;
const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<1e11;
const ref=c=>(c.citations||[]).map(v=>typeof v==='string'?v:[v.volume,v.reporter,v.page].filter(Boolean).join(' '));
const statusNames={200:'resolved',300:'ambiguous',404:'not_found',400:'unrecognized',429:'not_checked'};
export function caseCandidate(c){
 const citations=ref(c),id=c.id||c.cluster_id||idFrom(c.resource_uri)||Number(String(c.absolute_url||'').match(/\/opinion\/(\d+)/)?.[1]);
 return {id,identity:'cl-'+id,name:plain(c.case_name||c.caseName||''),short_name:plain(c.case_name_short||c.caseNameShort||c.case_name||c.caseName||'').split(/, (?:Administr|Executor|Petitioner|Respondent)/)[0],citations,citation:citations.join('; '),court_id:c.court_id||'',court:c.court||'',date:c.date_filed||c.dateFiled||'',source_url:safeLink(c.absolute_url,'www.courtlistener.com'),precedential_status:c.precedential_status||c.status||'unknown',docket_id:c.docket_id||idFrom(c.docket),opinion_ids:(c.sub_opinions||[]).map(idFrom).filter(Boolean),stage:/certiorari|rehearing|order denying|petition denied/i.test(c.case_name||c.caseName||'')?'Order / procedural stage':'Check opinion and disposition'};
}
export async function citationLookup(env,text){
 const data=await sourceRequest(env,'courtlistener',api+'citation-lookup/',{method:'POST',body:new URLSearchParams({text}).toString()});
 if(!Array.isArray(data))throw new SourceError('The citation service returned an unreadable response.');
 return data.map(r=>({text:r.citation,normalized:r.normalized_citations||[],start:r.start_index,end:r.end_index,status:statusNames[r.status]||'not_checked',http_status:r.status,error:r.error_message||'',candidates:(r.clusters||[]).slice(0,15).map(caseCandidate)}));
}
async function citationBatch(env,items){
 const now=Math.floor(Date.now()/1000),out=new Map(),missing=[];
 for(const text of items){const key='case-citation:'+citationKey(text),saved=await env.DB.prepare('SELECT body FROM source_cache WHERE id=? AND expires>?').bind(key,now).first();if(saved){out.set(citationKey(text),JSON.parse(saved.body));if(env.REQUEST)env.REQUEST.metrics.cache_hits++;}else missing.push(text);}
 for(let at=0;at<missing.length;at+=8){await checkpoint(env);const batch=missing.slice(at,at+8),rows=await citationLookup(env,batch.join('\n'));
  for(const text of batch){const row=rows.find(r=>citationKey(r.text)===citationKey(text)||r.normalized.some(s=>citationKey(s)===citationKey(text)))||{text,status:'unrecognized',candidates:[],normalized:[],error:'The parser could not recognize this citation.'};out.set(citationKey(text),row);
   if(['resolved','ambiguous','not_found'].includes(row.status))await env.DB.prepare('INSERT INTO source_cache(id,body,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind('case-citation:'+citationKey(text),JSON.stringify(row),now+86400).run();
  }
 }
 return out;
}
export const localAuthorityPassages=id=>corpus.filter(p=>p.case_id===id);
export async function resolveCase(env,body){
 const intent=exactIntent(body);if(!intent)return null;
 if(!env.COURTLISTENER_API_TOKEN){
  const matches=corpus.filter(p=>intent.citations.some(c=>citationKey(p.citation).includes(citationKey(c.text)))||intent.name&&plain(p.name).toLowerCase()===intent.name.toLowerCase());
  const groups=[...new Map(matches.map(p=>[p.case_id,p])).values()];
  if(groups.length===1)return {status:'resolved',method:'CAP exact metadata',case:{...groups[0],identity:groups[0].case_id,id:groups[0].case_id,citations:[groups[0].citation],date:groups[0].decision_date,court_id:'scotus',short_name:groups[0].name},simple:intent.simple,local:true};
  return {status:groups.length?'ambiguous':'unavailable',candidates:groups.map(p=>({id:p.case_id,name:p.name,citation:p.citation,date:p.decision_date})),message:'Connect CourtListener for this case, or use an exact citation in the offline starter library.',simple:intent.simple};
 }
 let candidates=[],moreMatches=false,method='named-case search';
 if(intent.context&&validId(intent.context)&&!intent.citations.length&&!intent.name){const c=await sourceRequest(env,'courtlistener',api+'clusters/'+Number(intent.context)+'/',{cache:true});candidates=[caseCandidate(c)];method='Selected case context';}
 else if(intent.citations.length){
  method='Exact citation';const rows=await citationBatch(env,[...new Set(intent.citations.map(c=>c.text))]);
  const usable=[...rows.values()].filter(r=>r.candidates.length);
  if(usable.length){candidates=usable[0].candidates.filter(c=>usable.every(r=>r.candidates.some(x=>x.id===c.id)));if(!candidates.length&&!intent.simple)return null;if(!candidates.length)candidates=[...new Map(usable.flatMap(r=>r.candidates).map(c=>[c.id,c])).values()];}
  if([...rows.values()].some(r=>!r.candidates.length))return {status:'not_found',method,candidates,message:'At least one requested citation could not be resolved. Correct it or select a case explicitly.',lookups:[...rows.values()],simple:intent.simple};
 }else{
  const u=new URL(api+'search/');u.search=new URLSearchParams({q:caseNameQuery(intent.name),type:'o',order_by:'citeCount desc',highlight:'off'});
  const result=await sourceRequest(env,'courtlistener',u.href);candidates=(result.results||[]).slice(0,12).map(c=>caseCandidate({...c,citations:c.citation||[]}));
  moreMatches=Number(result.count)>candidates.length;
  // Multiple stages with the same parties are candidates, not a popularity
  // contest. A citation or user selection is required when more than one hits.
 }
 candidates=[...new Map(candidates.filter(c=>validId(c.id)).map(c=>[c.id,c])).values()];
 if(body.selected_case!==undefined){const selected=candidates.find(c=>c.id===Number(body.selected_case));if(!selected)throw new SourceError('Select one of the returned case candidates.');candidates=[selected];moreMatches=false;method+=' · user selected';}
 if(candidates.length!==1||moreMatches)return {status:candidates.length?'ambiguous':'not_found',method,candidates,message:candidates.length?'Which decision do you mean? These records may reflect different cases or procedural stages.':'No matching case was found. Try its reporter citation or full case name.',simple:intent.simple};
 return {status:'resolved',method,case:candidates[0],simple:intent.simple};
}
const types={'020lead':'Principal opinion','015unamimous':'Unanimous opinion','015unanimous':'Unanimous opinion','010combined':'Combined opinions (may include separate opinions)','030concurrence':'Concurrence','040dissent':'Dissent','025plurality':'Plurality','050addendum':'Addendum','060remittitur':'Remittitur','070rehearing':'Rehearing','080onthemerits':'On the merits','090onmotiontostrike':'Order on motion','100trialcourt':'Trial court opinion'};
export {opinionText};
export async function authority(env,id){
 if(!validId(id))throw new SourceError('Choose a valid case record.');
 const cluster=await sourceRequest(env,'courtlistener',api+'clusters/'+Number(id)+'/',{cache:true}),meta=caseCandidate(cluster),warnings=[];
 if(meta.docket_id){try{const d=await sourceRequest(env,'courtlistener',api+'dockets/'+meta.docket_id+'/?fields=court', {cache:true});meta.court_id=String(d.court||'').match(/courts\/([^/]+)/)?.[1]||meta.court_id;meta.docket_number=d.docket_number||'';}catch{warnings.push('Court metadata could not be retrieved.');}}
 if(meta.court_id){try{const c=await sourceRequest(env,'courtlistener',api+'courts/'+meta.court_id+'/',{cache:true});meta.court=c.full_name||c.short_name;meta.jurisdiction=c.jurisdiction;}catch{meta.court=meta.court_id;}}
 let rows=[];
 try{const data=await sourceRequest(env,'courtlistener',api+'opinions/?cluster='+Number(id)+'&page_size=20',{cache:true});rows=data.results||[];if(data.next)warnings.push('Additional opinion records were not retrieved. Open the source record for the complete set.');}catch(e){warnings.push(e.message);}
 const rank=o=>o.type==='020lead'?0:/015/.test(o.type)?1:o.type==='025plurality'?2:o.type==='010combined'?3:10;
 rows=rows.filter(o=>idFrom(o.cluster)===Number(id)).sort((a,b)=>rank(a)-rank(b));
 const primary=rows.find(o=>rank(o)<10),selected=primary?[primary,...rows.filter(o=>o.id!==primary.id&&o.type!=='010combined').slice(0,7)]:rows.slice(0,8);
 if(!primary)warnings.push('A principal opinion could not be identified. The available separate opinions or orders are not substituted for it.');
 const opinions=selected.map(o=>{const text=opinionText(o),truncated=text.length>300000;return {id:o.id,type:o.type,label:types[o.type]||o.type,principal:o===primary,text:text.slice(0,300000),truncated,availability:text?'text_available':'unavailable',original_url:publicDocumentUrl(o.download_url||o.local_path),opinions_cited:(o.opinions_cited||[]).map(idFrom).filter(Boolean).slice(0,100),source_kind:'Court opinion text via CourtListener',url:meta.source_url};});
 return {...meta,opinions,principal_id:primary?.id||null,warnings,retrieved_at:new Date().toISOString(),source_kind:'Court opinion text via CourtListener; provider transcription',availability:opinions.some(o=>o.principal&&o.text)?'text_available':'unavailable',navigation:{citing:'https://www.courtlistener.com/?q='+encodeURIComponent('cites:('+opinions.map(o=>o.id).join(' OR ')+')')+'&type=o',scholar:'https://scholar.google.com/scholar?as_sdt=2006&q='+encodeURIComponent(meta.citations[0]||meta.name)},treatment_scope:'Not reviewed. Citation links are incomplete provider relationships, not treatment analysis.'};
}
export function publicDocumentUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password)return '';if((u.hostname.endsWith('.gov')||/\.state\.[a-z]{2}\.us$/.test(u.hostname)||u.hostname==='storage.courtlistener.com')&&/\.pdf$/i.test(u.pathname))return u.href;}catch{}return '';
}
export function authorityPassages(a,question,task='brief'){
 const result=[];
 for(const o of a.opinions.filter(o=>o.text)){
  const meta={case_id:'cl-'+o.id,cluster_id:a.id,opinion_id:o.id,name:a.name,short_name:a.short_name,citation:a.citation,court:a.court,court_id:a.court_id,decision_date:a.date,opinion_type:o.label,principal:o.principal,database_id:'courtlistener',database_name:'CourtListener',kind:'case',source_kind:a.source_kind,source_status:'Resolved case identity; opinion transcription. Later treatment not reviewed.',source_url:a.source_url,official_url:'',original_file_url:o.original_url,research_role:o.principal?'principal':'separate',identity:a.identity};
  const chunks=[];for(let at=0;at<o.text.length;at+=1450){const text=o.text.slice(at,at+1600);if(text.length<40)continue;const page=o.text.slice(0,at).match(/\[Source page ([\w]+)\]/g)?.at(-1)||text.match(/\[Source page [\w]+\]/)?.[0]||'';chunks.push({...meta,id:'cl-'+o.id+':'+at,text,locator:page||'Extracted opinion text; no source page marker available',extraction_offset:at});}
  if(o.principal){if(chunks.length<=10)result.push(...chunks);else{const chosen=new Set([0,1,2,chunks.length-2,chunks.length-1]);for(let i=0;i<chunks.length;i++)if(/it is so ordered/i.test(chunks[i].text))chosen.add(i);for(let i=1;i<=5;i++)chosen.add(Math.floor(i*(chunks.length-1)/6));result.push(...[...chosen].sort((a,b)=>a-b).map(i=>chunks[i]));}}
  else result.push(...chunks.slice(0,1));
 }
 // Interleave some separate-opinion context after the first five principal
 // excerpts; metadata always distinguishes the author/type from the holding.
 const main=result.filter(s=>s.principal),separate=result.filter(s=>!s.principal);
 // Closing disposition can precede footnotes, so the final chunk alone is not enough.
 const outcome=main.filter(s=>/it is so ordered|judgment.{0,180}(?:reversed|vacated|affirmed|remanded)|case is remanded/i.test(s.text)).sort((a,b)=>Number(/it is so ordered/i.test(b.text))-Number(/it is so ordered/i.test(a.text)));
 const ordered=[...new Map([main[0],...outcome,...main].filter(Boolean).map(s=>[s.id,s])).values()];
 return [...ordered.slice(0,5),...separate.slice(0,3),...ordered.slice(5)];
}
export async function collectCases(env,body,progress=()=>{}){
 const documents=body.documents||[],locations=[{name:'Pasted text',type:'text',pages:[{number:1,text:body.text||''}]},...documents];
 const occurrences=locations.flatMap(d=>d.pages.flatMap(p=>citationOccurrences(p.text,{document:d.name,page:d.type==='PDF'?p.number:null,location:d.type==='PDF'?'PDF page '+p.number:(p.label||'Extracted text')})));
 const unique=[...new Map(occurrences.filter(o=>!o.uncertain).map(o=>[citationKey(o.text),o.text])).values()];
 if(unique.length>50)throw new SourceError('This collection has more than 50 distinct citation candidates. Split the brief or paste a smaller selection.');
 if(occurrences.length>1000)throw new SourceError('Too many citation occurrences. Split the document.');
 const rows=new Map(),errors=[];
 if(unique.length&&!env.COURTLISTENER_API_TOKEN)errors.push('CourtListener is not connected. Citation candidates are shown without resolution.');
 else for(let i=0;i<unique.length;i+=8){progress({stage:'resolving',message:'Resolving citations '+(i+1)+'–'+Math.min(i+8,unique.length)+' of '+unique.length+'…'});try{for(const [k,v] of await citationBatch(env,unique.slice(i,i+8)))rows.set(k,v);}catch(e){if(e.status===499)throw e;errors.push(e.message);}}
 const grouped=new Map();
 for(const o of occurrences){const row=rows.get(citationKey(o.text)),resolved=row?.status==='resolved'&&row.candidates.length===1,c=resolved?row.candidates[0]:null,key=c?'case:'+c.id:'citation:'+citationKey(o.text);
  if(!grouped.has(key))grouped.set(key,{key,status:o.uncertain?'unrecognized':row?.status||'not_checked',case:c,candidates:row?.candidates||[],occurrences:[],original_citations:[],availability:'Not retrieved',error:o.uncertain?'Short or malformed reference; supply a full citation.':row?.error||''});
  const group=grouped.get(key);group.occurrences.push(o);if(!group.original_citations.includes(o.text))group.original_citations.push(o.text);
 }
 return {items:[...grouped.values()],occurrence_count:occurrences.length,method:'Deterministic candidate parsing and CourtListener/Eyecite resolution; no model',warnings:errors,unparsed_note:!occurrences.length?'No supported full case citations were detected. Paste complete reporter citations; OCR and automatic Id./supra resolution are not included.':'Short forms, unusual citation formats and OCR errors may require correction.',retrieved_at:new Date().toISOString(),model_used:false};
}
