import {authority,publicDocumentUrl} from './cases.js';
import {limited,checkpoint} from './runtime.js';
import {SourceError} from './sources.js';
export async function originalFile(env,body){
 const a=await authority(env,body.cluster_id),o=a.opinions.find(o=>o.id===Number(body.opinion_id));
 if(!o||!o.original_url)throw new SourceError('No permitted original PDF is available. Download the labeled opinion text or HTML instead.');
 const key='public-pdf:'+o.id,now=Math.floor(Date.now()/1000),old=await env.DB.prepare('SELECT body FROM source_cache WHERE id=? AND expires>?').bind(key,now).first();
 if(old){const data=JSON.parse(old.body);return {authority:a.name,opinion_id:o.id,...data,cached:true};}
 let url=o.original_url;
 for(let hop=0;hop<4;hop++){
  if(!publicDocumentUrl(url))throw new SourceError('The PDF redirects outside the permitted public source hosts.');
  await checkpoint(env);const r=await limited(env,'public_document',()=>fetch(url,{redirect:'manual',headers:{Accept:'application/pdf'},signal:AbortSignal.timeout(30000)}));
  if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('Location');await r.body?.cancel();if(!location)break;url=new URL(location,url).href;continue;}
  if(!r.ok){await r.body?.cancel();throw new SourceError('The publisher PDF is unavailable (HTTP '+r.status+'). Use the labeled text alternative.');}
  const reader=r.body.getReader(),parts=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5000000){await reader.cancel();throw new SourceError('The original PDF exceeds 5 MB. Open its publisher link instead.');}parts.push(value);}
  const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
  if(new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw new SourceError('The publisher returned something other than a PDF.');
  let binary='';for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));
  const result={base64:btoa(binary),source_url:url,retrieved_at:new Date().toISOString(),kind:'Original publisher PDF',size};
  if(size<650000)await env.DB.prepare('INSERT INTO source_cache(id,body,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,expires=excluded.expires').bind(key,JSON.stringify(result),now+86400).run();return {authority:a.name,opinion_id:o.id,...result};
 }
 throw new SourceError('The original PDF has an unresolved redirect.');
}
