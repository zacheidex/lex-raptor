import {database,reserve,settle,CAP,RESERVE} from './budget.js';
import {tasks,payload,validate} from './research.js';
import {catalog,validateSelection,filters,searchSources,evidenceSubset,auditCitations,SourceError} from './sources.js';
import {local,modelName,modelReady,generate} from './model.js';
import {planPayload,readPlan} from './planner.js';
const encoder=new TextEncoder();
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
class PublicError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new PublicError(status,message);};
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function hmac(secret,value) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
}
const ready=env=>env.DEMO_SESSION_SECRET?.length>=32&&modelReady(env);
async function visitor(request,env) {
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip)fail(503,'Research access is temporarily unavailable.');
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
    return json({enabled,search_enabled:env.DEMO_SESSION_SECRET?.length>=32,access:'public',inference:local(env)?'local':'api',exhausted:!local(env)&&state.total+RESERVE>CAP,request_limits:false,automatic_fields:true,databases:catalog(env),tasks,model:modelName(env),cap:local(env)?null:CAP/1e6});
  }
  if(request.method!=='POST')fail(405,'Method not allowed.');
  if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'Open research on this website to continue.');
  if(!['/api/demo/research','/api/demo/search','/api/demo/citations'].includes(path))fail(404,'Not found.');
  if(env.DEMO_SESSION_SECRET?.length<32||!env.DEMO_SESSION_SECRET)fail(503,'Research access is temporarily unavailable.');
  if(path==='/api/demo/research'&&!ready(env))fail(503,'Online AI is currently unavailable. You can run Lex Raptor locally.');
  const db=database(env),ip=await visitor(request,env);
  // Keep the existing ledger schema and visitor hash so opening public access
  // cannot reset historical spending. No cookie needed.
  const sid='public:'+ip;
  const body=await readBody(request);
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Send a research request.');
  if(path==='/api/demo/citations'){
    if(!env.COURTLISTENER_API_TOKEN)fail(503,'Citation lookup needs a connected CourtListener account.');
    if(typeof body.text!=='string'||body.text.length<3||body.text.length>6000)fail(400,'Enter 3 to 6,000 characters of public citation text.');
    return json({citations:await auditCitations(env,body.text),limitation:'Checks case-citation existence and ambiguity only. No treatment, good-law status, or proposition support determination.',model_used:false});
  }
  if(typeof body.question!=='string'||body.question.trim().length<1||body.question.length>2000)fail(400,'Enter a message between 1 and 2,000 characters.');
  const automatic=path==='/api/demo/research'&&(body.task==='auto'||body.database_ids==='auto'||body.auto_fields===true);
  if(body.database_ids!=='auto')validateSelection(body.database_ids,env);
  if(body.database_ids==='auto'&&!automatic&&path!=='/api/demo/search')fail(400,'Choose databases.');
  const selectedFilters=filters(body.filters),requestedTask=body.task||'research';
  if(requestedTask!=='auto'&&!Object.hasOwn(tasks,requestedTask))fail(400,'Choose an available research workflow.');
  if(body.search_query!==undefined&&(typeof body.search_query!=='string'||body.search_query.length>300))fail(400,'Keep search terms within 300 characters.');
  if(body.context!==undefined&&(typeof body.context!=='string'||body.context.length>3500))fail(400,'Conversation context is too long. Start a new chat.');
  if(path==='/api/demo/research'&&!/^[a-f0-9-]{36}$/.test(body.request_id||''))fail(400,'Missing request identifier.');
  let reserved=false,usage={input_tokens:0,output_tokens:0},usageKnown=true;
  async function admission(){
    if(reserved||local(env))return;
    if(!await reserve(db,body.request_id,ip,sid,now))fail(429,'The shared AI spending allowance is exhausted, or this request was already submitted. Source search is still available.');
    reserved=true;
  }
  async function callModel(input){
    await admission();
    let result;
    try{result=await generate(env,input);}catch{fail(504,local(env)?'The local model request was interrupted.':'The model request was interrupted. Its cost reservation is held; there is no automatic retry.');}
    if(!result.ok){
      const field=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(value)?value:null;
      console.error(JSON.stringify({event:'demo_provider_rejection',status:result.status,model:modelName(env),code:field(result.error?.code)}));
      fail(502,local(env)?'The local model is unavailable. Start Ollama and install the configured model.':'The model provider could not complete the request. Its cost reservation is held; there is no automatic retry.');
    }
    for(const k of ['input_tokens','output_tokens']){const n=result.data.usage?.[k];if(!Number.isSafeInteger(n)||n<0)usageKnown=false;else usage[k]+=n;}
    return result.data;
  }
  async function reconcile(){if(reserved&&usageKnown)await settle(db,body.request_id,usage);}
  let plan={query:body.search_query?.trim()||body.question.slice(0,300),task:requestedTask==='auto'?'research':requestedTask,database_ids:body.database_ids==='auto'?catalog(env).filter(d=>d.available&&d.id!=='cap').map(d=>d.id):body.database_ids,...selectedFilters};
  if(automatic){
    const planned=await callModel(planPayload(env,body));
    try{plan=readPlan(planned,env,body);}catch{await reconcile();fail(502,'Automatic settings could not be prepared. Choose task, databases and search terms manually, then try again.');}
  }
  const {query,task,database_ids,...searchFilters}=plan;
  const found=await searchSources(env,plan);
  const meta={...found,query,task,databases:database_ids,filters:searchFilters,automatic,model:modelName(env),inference:local(env)?'local':'api'};
  if(path==='/api/demo/search')return json({...meta,model_used:false});
  const sources=evidenceSubset(found.sources,body.context?18500:22000);
  if(!sources.length){await reconcile();return json({...meta,propositions:[],sources:[],removed:0,incomplete:false,no_evidence:true,model_used:automatic});}
  const response=await callModel(payload(body.question,sources,task,body.context||''));
  await reconcile();
  // Public-only cache cleanup never touches the lifetime spending ledger.
  await db.prepare('DELETE FROM source_cache WHERE expires<?').bind(now).run();
  await db.prepare('DELETE FROM source_requests WHERE created<?').bind(now-172800).run();
  await db.prepare('DELETE FROM demo_attempts WHERE expires<?').bind(now).run();
  return json({...meta,...validate(response,sources,task),sources,model_used:true});
}
export default {
  async fetch(request,env) {
    try {
      if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env);
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      const url=new URL(request.url);
      if(url.pathname==='/'||url.pathname==='/demo')url.pathname='/index.html';
      else if(['/about','/sources','/run-locally'].includes(url.pathname))url.pathname+='.html';
      const result=await env.ASSETS.fetch(new Request(url,request));
      const headers=new Headers(result.headers);
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
      return new Response(result.body,{status:result.status,headers});
    } catch(error) {
      // Never log prompts, cookies, provider response bodies or keys.
      if(!(error instanceof PublicError)&&!(error instanceof SourceError))console.error('Demo service failure');
      return json({error:error instanceof PublicError||error instanceof SourceError?error.message:'Research is temporarily unavailable. Please try again later.'},error instanceof PublicError?error.status:error instanceof SourceError?400:503);
    }
  }
};
