import {database,reserve,settle,CAP,MODEL,RESERVE} from './budget.js';
import {databases,retrieve,payload,validate} from './research.js';
const encoder=new TextEncoder();
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
class PublicError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new PublicError(status,message);};
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function hmac(secret,value) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
}
const ready=env=>env.DEMO_ENABLED==='true'&&env.OPENAI_API_KEY&&env.DEMO_SESSION_SECRET?.length>=32&&Number(env.DEMO_EXPIRES_AT)>Date.now()/1000;
async function visitor(request,env) {
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip)fail(503,'Demo access is temporarily unavailable.');
  return hmac(env.DEMO_SESSION_SECRET,ip);
}
async function readBody(request) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Send a JSON request.');
  const reader=request.body?.getReader();if(!reader)fail(400,'Missing request.');
  let size=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>10000){await reader.cancel();fail(413,'The question is too long.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Invalid request.');}
}
async function api(request,env) {
  const path=new URL(request.url).pathname, now=Math.floor(Date.now()/1000);
  if(path==='/api/demo/status'&&request.method==='GET') {
    const enabled=!!ready(env);
    const state=await database(env).prepare('SELECT COALESCE(SUM(charged),0) total FROM demo_calls').first();
    return json({enabled,access:'public',exhausted:state.total+RESERVE>CAP,databases,model:MODEL,limit:'10 questions per network per day',cap:10});
  }
  if(request.method!=='POST')fail(405,'Method not allowed.');
  if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'Open the demo on this website to continue.');
  if(path!=='/api/demo/research')fail(404,'Not found.');
  if(!ready(env))fail(503,'The online demo is not enabled yet. You can run Lex Raptor locally.');
  const db=database(env),ip=await visitor(request,env);
  // Keep the existing ledger schema and visitor hash so opening public access
  // cannot reset historical spending or rolling network limits. No cookie needed.
  const sid='public:'+ip;
  const body=await readBody(request);
  if(typeof body.question!=='string'||body.question.trim().length<10||body.question.length>2000)fail(400,'Enter a question between 10 and 2,000 characters.');
  if(!Array.isArray(body.database_ids)||body.database_ids.length!==1||body.database_ids[0]!=='cap')fail(400,'Select the CAP starter collection. Other databases are not connected.');
  if(!/^[a-f0-9-]{36}$/.test(body.request_id||''))fail(400,'Missing request identifier.');
  const sources=retrieve(body.question);
  if(!sources.length)return json({propositions:[],sources:[],removed:0,incomplete:false,model:MODEL,databases:['cap'],no_evidence:true});
  const input=payload(body.question,sources);
  if(!await reserve(db,body.request_id,ip,sid,now))fail(429,'The shared budget, visitor limit, or concurrent request limit has been reached. A repeated request cannot be charged twice.');
  let response;
  try {
    const result=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.OPENAI_API_KEY},body:input,redirect:'manual',signal:AbortSignal.timeout(90000)});
    if(!result.ok) {
      const error=await result.json().catch(()=>({}));
      const field=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(value)?value:null;
      console.error(JSON.stringify({event:'demo_provider_rejection',status:result.status,model:MODEL,
        code:field(error.error?.code),type:field(error.error?.type),param:field(error.error?.param)}));
      fail(502,'The model provider could not complete the request. Its cost reservation is held; there is no automatic retry.');
    }
    response=await result.json();
  } catch(error) {
    if(error instanceof PublicError)throw error;
    fail(504,'The model request was interrupted. Its cost reservation is held; there is no automatic retry.');
  }
  await settle(db,body.request_id,response.usage);
  return json({...validate(response,sources),sources,model:MODEL,databases:['cap']});
}
export default {
  async fetch(request,env) {
    try {
      if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env);
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      const url=new URL(request.url);if(url.pathname==='/demo')url.pathname='/demo.html';
      const result=await env.ASSETS.fetch(new Request(url,request));
      const headers=new Headers(result.headers);
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
      return new Response(result.body,{status:result.status,headers});
    } catch(error) {
      // Never log prompts, cookies, provider response bodies or keys.
      if(!(error instanceof PublicError))console.error('Demo service failure');
      return json({error:error instanceof PublicError?error.message:'The demo is temporarily unavailable. Please try again later.'},error instanceof PublicError?error.status:503);
    }
  }
};
