import {legalCitation,sourceKind} from '../shared/legal-citations.js';
// Web citations have provider provenance, not independently downloaded text.
// Keep this distinct from the exact passage checks on our API connectors.
export const WEB_CALL_LIMIT=4;
export function legalUrl(value) {
  if(typeof value!=='string'||value.length>2000)return null;
  try {
    const u=new URL(value),h=u.hostname;
    if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    let status='';
    if(h.endsWith('.gov')||/\.state\.[a-z]{2}\.us$/.test(h))status='Government source; check publication and effective dates.';
    else if(h==='law.justia.com'&&u.pathname.startsWith('/codes/'))status='Unofficial statute mirror; check edition and subsequent amendments.';
    else if((h==='law.justia.com'&&/^\/cases\/[a-z-]+\//.test(u.pathname))||(h==='supreme.justia.com'&&/^\/cases\/federal\/us\//.test(u.pathname)))status='Unofficial opinion mirror; distinguish the court opinion from editorial summaries.';
    else if(h==='www.courtlistener.com'&&u.pathname.startsWith('/opinion/'))status='CourtListener opinion record; later treatment not verified.';
    else if(h==='www.law.cornell.edu'&&/^\/(uscode|cfr|constitution|supremecourt|supct)\//.test(u.pathname))status='Legal Information Institute compilation; check currency.';
    else if(['library.municode.com','codelibrary.amlegal.com','ecode360.com'].includes(h))status='Municipal code publisher; check supplement date and adopting ordinance.';
    if(!status)return null;
    u.hash='';return {url:u.href,host:h,status};
  }catch{return null;}
}
export function referenceKey(value) {
  const safe=legalUrl(value);if(!safe)return '';
  const u=new URL(safe.url);
  for(const [key,val] of [...u.searchParams]){
    // Preserve parameters that select statutes, editions, sections or languages.
    // Search providers sometimes add empty cache-busting IDs to government PDFs.
    // Resolve those aliases to the actual provider URL; never invent a source.
    if(/^utm_/i.test(key)||['gclid','fbclid','msclkid'].includes(key.toLowerCase())||
       (u.hostname.endsWith('.gov')&&u.pathname.endsWith('.pdf')&&val===''&&/^[a-z0-9]{10,32}$/i.test(key)))u.searchParams.delete(key);
  }
  u.searchParams.sort();return u.href;
}
export function webSources(response) {
  const found=new Map();
  function add(item) {
    const safe=legalUrl(item?.url);if(!safe)return;
    if(found.has(safe.url)){if(typeof item.title==='string'){found.get(safe.url).name=item.title.slice(0,250);found.get(safe.url).citation=legalCitation(safe.url,item.title);}return;}
    found.set(safe.url,{id:'W'+(found.size+1),database_id:'legal_web',kind:'web_page',evidence_method:'web_citation',name:typeof item.title==='string'?item.title.slice(0,250):safe.host,citation:legalCitation(safe.url,item.title||''),source_kind:sourceKind(safe.url),source_url:safe.url,text:'',locator:'Provider web citation; page text was not independently retrieved by Lex Raptor.',source_status:safe.status,decision_date:'',court:safe.host,opinion_type:'Public legal web page'});
  }
  // Only actual tool records/annotations can authorize a URL, never JSON claims.
  for(const o of response.output||[]){
    if(o.type==='web_search_call'){
      for(const s of o.action?.sources||[])add(s);
      // A completed open operation reports the actual URL separately from
      // search-result sources. This proves tool provenance, not successful
      // page retrieval or claim support; keep the same web-citation disclosure.
      if(o.status==='completed'&&o.action?.type==='open_page')add({url:o.action.url});
    }
    if(o.type==='message')for(const c of o.content||[])for(const a of c.annotations||[])if(a.type==='url_citation')add(a);
  }
  return [...found.values()];
}
export function webSearches(response) {
  return (response.output||[]).filter(o=>o.type==='web_search_call').map(o=>({phase:'web '+(o.action?.type||'search'),status:o.status||'unknown',query:(o.action?.queries||[o.action?.query||o.action?.url||'']).filter(x=>typeof x==='string').slice(0,6).map(x=>x.slice(0,500)).join(' · ')}));
}
export function quoteSegments(source) {
  const result=[];let start=0;const text=source.text||'';
  while(start<text.length){
    let end=Math.min(start+240,text.length);
    if(end<text.length){const window=text.slice(start,end),stop=[...window.matchAll(/[.!?;]\s/g)].filter(m=>m.index>=60).at(-1);end=start+(stop?stop.index+1:Math.max(window.lastIndexOf(' '),180));}
    const quote=text.slice(start,end);if(quote.trim().length>=20)result.push({id:source.id+'Q'+(result.length+1),quote});
    start=end;
  }
  return result;
}
