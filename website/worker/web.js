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
    else if(h==='www.law.cornell.edu'&&/^\/(uscode|cfr|constitution)\//.test(u.pathname))status='Legal Information Institute compilation; check currency.';
    else if(['library.municode.com','codelibrary.amlegal.com','ecode360.com'].includes(h))status='Municipal code publisher; check supplement date and adopting ordinance.';
    if(!status)return null;
    u.hash='';return {url:u.href,host:h,status};
  }catch{return null;}
}
export function webSources(response) {
  const found=new Map();
  function add(item) {
    const safe=legalUrl(item?.url);if(!safe)return;
    if(found.has(safe.url)){if(typeof item.title==='string')found.get(safe.url).name=item.title.slice(0,250);return;}
    found.set(safe.url,{id:'W'+(found.size+1),database_id:'legal_web',kind:'web_page',evidence_method:'web_citation',name:typeof item.title==='string'?item.title.slice(0,250):safe.host,citation:'',source_url:safe.url,text:'',locator:'Provider web citation; page text was not independently retrieved by Lex Raptor.',source_status:safe.status,decision_date:'',court:safe.host,opinion_type:'Public legal web page'});
  }
  // Only actual tool records/annotations can authorize a URL, never JSON claims.
  for(const o of response.output||[]){
    if(o.type==='web_search_call')for(const s of o.action?.sources||[])add(s);
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
