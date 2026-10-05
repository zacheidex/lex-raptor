import {database,reserve,upgradeReservation,settle,CAP,RESERVE,WEB_RESERVE} from './budget.js';
import {webSources,webSearches,WEB_CALL_LIMIT} from './web.js';
import {tasks,payload,validate} from './research.js';
import {catalog,validateSelection,filters,searchSources,evidenceSubset,auditCitations,SourceError} from './sources.js';
import {local,modelName,modelReady,generate} from './model.js';
import {planPayload,readPlan} from './planner.js';
import {validateDocuments,documentPassages,documentCoverage} from './documents.js';
import {saveFeedback} from './feedback.js';
import {verificationInput,verifyCitations,reviewPassageFindings} from './verification.js';
import {resolveCase,authority,authorityPassages,localAuthorityPassages,collectCases} from './cases.js';
import {courts,validateScope,scopeFilters,relationship} from './courts.js';
import {requestContext,checkpoint,beginJob,metrics,Cancelled} from './runtime.js';
import {authorize,accessMode} from './access.js';
import {originalFile} from './files.js';
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
  return hmac(env.DEMO_SESSION_SECRET,env.AUTH_SUBJECT?'account:'+env.AUTH_SUBJECT:ip);
}
async function readBody(request) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Send a JSON request.');
  const reader=request.body?.getReader();if(!reader)fail(400,'Missing request.');
  let size=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>700000){await reader.cancel();fail(413,'The request is too large. Split the documents.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Invalid request.');}
}
async function apiCore(request,env,progress=()=>{}) {
  const path=new URL(request.url).pathname, now=Math.floor(Date.now()/1000);
  if(path==='/api/demo/status'&&request.method==='GET') {
    const access=await authorize(request,env),enabled=!!ready(env)&&access.authorized;
    const state=await database(env).prepare('SELECT COALESCE(SUM(charged),0) total FROM demo_calls').first();
    return json({enabled,search_enabled:env.DEMO_SESSION_SECRET?.length>=32&&access.authorized,access:accessMode(env),access_required:!access.authorized,login_url:access.login_url||'',access_configured:access.configured!==false,inference:local(env)?'local':'api',exhausted:!local(env)&&state.total+RESERVE>CAP,request_limits:true,automatic_fields:true,attachments:true,research_progress:true,case_treatment_search:true,clarifying_questions:true,research_revision:15,citation_recheck:true,databases:catalog(env),tasks,model:modelName(env),cap:local(env)?null:CAP/1e6});
  }
  if(path==='/api/demo/courts'&&request.method==='GET')return json(env.COURTLISTENER_API_TOKEN?await courts(env):{courts:[],states:[],unavailable:'Connect CourtListener to load its court directory.'});
  if(request.method!=='POST')fail(405,'Method not allowed.');
  if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'Open research on this website to continue.');
  if(!['/api/demo/research','/api/demo/search','/api/demo/citations','/api/demo/feedback','/api/demo/verify','/api/demo/resolve','/api/demo/authority','/api/demo/collect','/api/demo/authority-file','/api/demo/cancel','/api/demo/review'].includes(path))fail(404,'Not found.');
  if(env.DEMO_SESSION_SECRET?.length<32||!env.DEMO_SESSION_SECRET)fail(503,'Research access is temporarily unavailable.');
  if(['/api/demo/research','/api/demo/verify','/api/demo/review'].includes(path)&&!ready(env))fail(503,'Online AI is currently unavailable. You can run Lex Raptor locally.');
  const db=database(env),ip=await visitor(request,env);
  // Keep the existing ledger schema and visitor hash so opening public access
  // cannot reset historical spending. No cookie needed.
  const sid='public:'+ip;
  const body=await readBody(request);
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Send a research request.');
  if(path==='/api/demo/cancel'){
    if(!/^[a-f0-9-]{36}$/.test(body.request_id||''))fail(400,'Missing request identifier.');
    await db.prepare("UPDATE research_jobs SET state='cancelled' WHERE id=? AND visitor=? AND state='active'").bind(body.request_id,ip).run();return json({cancelled:true});
  }
  if(path!=='/api/demo/feedback'){
    const jobId=body.request_id||crypto.randomUUID();if(!/^[a-f0-9-]{36}$/.test(jobId))fail(400,'Invalid request identifier.');
    if(!await beginJob(env,jobId,ip,['/api/demo/research','/api/demo/verify','/api/demo/review'].includes(path)))fail(429,'This request was already submitted or the request/concurrency limit was reached. Wait for active work to finish.');
  }
  if(path==='/api/demo/resolve'){
    if(typeof body.text!=='string'||body.text.length>2000)fail(400,'Enter a case name or citation (up to 2,000 characters).');
    return json({resolution:await resolveCase(env,{...body,question:body.text}),model_used:false,metrics:metrics(env)});
  }
  if(path==='/api/demo/authority')return json({authority:await authority(env,body.cluster_id),model_used:false,metrics:metrics(env)});
  if(path==='/api/demo/authority-file')return json(await originalFile(env,body));
  if(path==='/api/demo/collect'){
    if(typeof body.text!=='string'||body.text.length>64000)fail(400,'Paste up to 64,000 characters or attach a brief.');
    const documents=validateDocuments(body.documents);
    return json({...await collectCases(env,{...body,documents},progress),metrics:metrics(env)});
  }
  if(path==='/api/demo/feedback'){
    if(!await saveFeedback(db,body,ip,now,modelName(env)))fail(429,'Feedback could not be saved right now. Please try again later.');
    return json({saved:true});
  }
  if(path==='/api/demo/citations'){
    if(!env.COURTLISTENER_API_TOKEN)fail(503,'Citation lookup needs a connected CourtListener account.');
    if(typeof body.text!=='string'||body.text.length<3||body.text.length>6000)fail(400,'Enter 3 to 6,000 characters of public citation text.');
    return json({citations:await auditCitations(env,body.text),limitation:'Checks case-citation existence and ambiguity only. No treatment, good-law status, or proposition support determination.',model_used:false});
  }
  let reserved=0,usage={input_tokens:0,output_tokens:0,web_search_calls:0},usageKnown=true;
  async function admission(amount){
    if(local(env)||reserved>=amount)return;
    if(reserved){
      if(!await upgradeReservation(db,body.request_id)){await reconcile();fail(429,'There is not enough of the shared $10 allowance remaining for web research. Choose other sources or run locally.');}
    }else if(!await reserve(db,body.request_id,ip,sid,now,amount))fail(429,'The shared AI spending allowance is exhausted, or this request was already submitted. Source search is still available.');
    reserved=amount;
  }
  async function callModel(input,useWeb=false){
    await checkpoint(env);
    await admission(useWeb?WEB_RESERVE:RESERVE);
    env.REQUEST.metrics.model_requests++;
    let result;
    try{result=await generate(env,input);}catch{fail(504,local(env)?'The local model request was interrupted.':'The model request was interrupted. Its cost reservation is held; there is no automatic retry.');}
    if(!result.ok){
      const field=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(value)?value:null;
      console.error(JSON.stringify({event:'demo_provider_rejection',status:result.status,model:modelName(env),code:field(result.error?.code)}));
      fail(502,local(env)?'The local model is unavailable. Start Ollama and install the configured model.':'The model provider could not complete the request. Its cost reservation is held; there is no automatic retry.');
    }
    for(const k of ['input_tokens','output_tokens']){const n=result.data.usage?.[k];if(!Number.isSafeInteger(n)||n<0)usageKnown=false;else usage[k]+=n;}
    if(useWeb){
      const calls=Array.isArray(result.data.output)?result.data.output.filter(o=>o.type==='web_search_call').length:null;
      // The API may return an extra ignored attempt after max_tool_calls.
      // Charge every reported attempt up to the provider-enforced execution cap.
      if(calls===null||calls<1)usageKnown=false;else usage.web_search_calls+=Math.min(calls,JSON.parse(input).max_tool_calls||WEB_CALL_LIMIT);
    }
    try{await checkpoint(env);}catch(e){await reconcile();throw e;}
    return result.data;
  }
  async function reconcile(){if(reserved&&usageKnown)await settle(db,body.request_id,usage);}
  if(path==='/api/demo/review'){
    const checked=await reviewPassageFindings(env,body,callModel,progress);await reconcile();return json({...checked,metrics:metrics(env)});
  }
  if(path==='/api/demo/verify'){
    const input=verificationInput(body);
    const checked=await verifyCitations(env,input,callModel,progress);
    await reconcile();return json({...checked,metrics:metrics(env)});
  }
  if(typeof body.question!=='string'||body.question.trim().length<1||body.question.length>2000)fail(400,'Enter a message between 1 and 2,000 characters.');
  const documents=validateDocuments(body.documents);
  if(body.document_mode!==undefined&&!['only','with_sources'].includes(body.document_mode))fail(400,'Choose a valid document research scope.');
  const onlyDocuments=documents.length>0&&body.document_mode!=='with_sources';
  const automatic=path==='/api/demo/research'&&(body.task==='auto'||body.database_ids==='auto'||body.auto_fields===true);
  if(!onlyDocuments&&body.database_ids!=='auto')validateSelection(body.database_ids,env);
  if(body.database_ids==='auto'&&!automatic&&path!=='/api/demo/search')fail(400,'Choose databases.');
  const selectedFilters=filters(body.filters),requestedTask=body.task||'research';
  if(requestedTask!=='auto'&&!Object.hasOwn(tasks,requestedTask))fail(400,'Choose an available research workflow.');
  if(body.search_query!==undefined&&(typeof body.search_query!=='string'||body.search_query.length>300))fail(400,'Keep search terms within 300 characters.');
  if(body.context!==undefined&&(typeof body.context!=='string'||body.context.length>3500))fail(400,'Conversation context is too long. Start a new chat.');
  if(path==='/api/demo/research'&&!/^[a-f0-9-]{36}$/.test(body.request_id||''))fail(400,'Missing request identifier.');
  const scope=validateScope(body.scope||{court_ids:selectedFilters.court.split(' ').filter(Boolean),after:selectedFilters.after,before:selectedFilters.before}),effectiveScope=await scopeFilters(env,scope);
  let resolution=null,resolvedAuthority=null,exactSources=null;
  if(!onlyDocuments){
    progress({stage:'resolving',message:'Checking for an exact case…'});
    resolution=await resolveCase(env,body);
    if(resolution&&resolution.status!=='resolved')return json({resolution,needs_selection:true,propositions:[],sources:[],searched:[],scope:effectiveScope,model_used:false,metrics:metrics(env)});
    if(resolution?.status==='resolved'){
      const wantsManual=body.source_mode==='explicit';
      const allowed=body.database_ids==='auto'||!wantsManual||body.database_ids.includes('courtlistener')||resolution.local&&body.database_ids.includes('cap');
      if(!allowed)return json({resolution,source_conflict:true,message:'This case resolves through CourtListener, which is not in your explicit source selection. Enable it to brief this case.',propositions:[],sources:[],searched:[],model_used:false});
      if(resolution.local){
        const c=resolution.case;if(effectiveScope.court&&!effectiveScope.court.split(' ').includes(c.court_id)||scope.after&&c.date<scope.after||scope.before&&c.date>scope.before)return json({resolution,scope:effectiveScope,scope_conflict:true,message:'The resolved case falls outside the selected scope.',propositions:[],sources:[],searched:[],model_used:false});
        exactSources=localAuthorityPassages(c.id);progress({stage:'authorities',message:'Resolved starter-library case available',sources:exactSources,resolution});
      }
      if(!resolution.local){resolvedAuthority=await authority(env,resolution.case.id);resolution.case={...resolvedAuthority,opinions:undefined};
        if((effectiveScope.court&&!effectiveScope.court.split(' ').includes(resolvedAuthority.court_id))||(scope.after&&resolvedAuthority.date<scope.after)||(scope.before&&resolvedAuthority.date>scope.before))return json({resolution,scope:effectiveScope,scope_conflict:true,message:'The resolved case falls outside your selected courts or dates. Adjust the visible scope to continue.',propositions:[],sources:[],searched:[],model_used:false});
        exactSources=authorityPassages(resolvedAuthority,body.question,requestedTask);progress({stage:'authorities',message:'Resolved opinion available',sources:exactSources,authorities:[resolvedAuthority],resolution});
      }
    }
  }
  const exactBrief=resolution?.status==='resolved'&&resolution.simple;
  let plan={query:body.search_query?.trim()||body.question.slice(0,300),task:requestedTask==='auto'?'research':requestedTask,database_ids:body.database_ids==='auto'?catalog(env).filter(d=>d.available&&d.id!=='cap').map(d=>d.id):body.database_ids,...selectedFilters};
  if(exactBrief){plan={...plan,task:requestedTask==='auto'?'brief':requestedTask,query:(resolution.case.citations?.[0]||resolution.case.citation||resolution.case.name).slice(0,300),case_name:resolution.case.name,database_ids:body.source_mode==='explicit'?body.database_ids:[resolution.local?'cap':'courtlistener'],database_reason:'Resolved '+(resolution.case.citations?.[0]||resolution.case.citation||resolution.case.name)+' before drafting.'};}
  if(automatic&&!exactBrief){
    progress({stage:'planning',message:'Planning the research…'});
    const planned=await callModel(planPayload(env,body));
    try{plan=readPlan(planned,env,body);}catch(e){await reconcile();const reason=['Incomplete plan','Invalid action','Invalid follow-up','Invalid coverage','Unknown task','Invalid query','Invalid state','Invalid research scope'].includes(e.message)?e.message:'Invalid plan format';fail(502,'Automatic settings could not be prepared ('+reason+'). Choose task, databases and search terms manually, then try again.');}
  }
  if(plan.follow_up){
    await reconcile();
    return json({follow_up:plan.follow_up,needs_clarification:plan.follow_up.kind==='clarify',scope:effectiveScope,metrics:metrics(env),coverage_notes:plan.coverage_notes,query:plan.query,task:plan.task,databases:[],searched:[],sources:[],propositions:[],automatic:true,model_used:true,model:modelName(env),inference:local(env)?'local':'api'});
  }
  if(body.scope&&(scope.court_ids.length||scope.level!=='any'||scope.state)){plan.court=effectiveScope.court;plan.jurisdiction_note=effectiveScope.description;}
  if(scope.after)plan.after=scope.after;if(scope.before)plan.before=scope.before;
  plan.manual_query=!!body.search_query?.trim();
  plan.topic_search=automatic&&!plan.manual_query?'semantic':'keyword';
  if(plan.research_focus!=='case_status'&&/\b(current status|still (?:good|valid|binding)|good law|overruled|overturned|later treatment)\b/i.test(body.question))plan.research_focus='case_status';
  if(onlyDocuments)plan.database_ids=[];
  const {query,task,database_ids}=plan;
  const searchFilters=filters(plan);
  const issues=(plan.research_questions||[query]).map((question,i)=>({id:'I'+(i+1),question}));
  progress({stage:'plan',message:onlyDocuments?'Reading attached document excerpts…':'Searching selected databases…',task,databases:database_ids,reason:plan.database_reason||'Searching your selected databases.'});
  let found=onlyDocuments?{sources:[],searched:[],retrieved_at:new Date().toISOString()}:await searchSources(env,{...plan,resolved_case:resolvedAuthority,database_ids:exactSources&&exactBrief?plan.database_ids.filter(id=>id!==(resolution.local?'cap':'courtlistener')):plan.database_ids},progress);
  if(exactSources){found.sources=[...exactSources,...found.sources];found.searched=found.searched.filter(s=>s.id!==(resolution.local?'cap':'courtlistener')||!exactBrief);found.searched.unshift({id:resolution.local?'cap':'courtlistener',status:exactSources.length?'ok':'unavailable',passages:exactSources.length,total:1,note:'Exact case identity resolved; principal and available separate opinions retrieved. '+(resolvedAuthority?.warnings||[]).join(' ')});}
  const docPassages=documentPassages(documents,body.question);
  if(documents.length){
    const merged=[];for(let i=0;i<Math.max(docPassages.length,found.sources.length);i++){if(docPassages[i])merged.push(docPassages[i]);if(found.sources[i])merged.push(found.sources[i]);}found.sources=merged;
    found.searched.unshift({id:'documents',status:docPassages.length?'ok':'empty',passages:docPassages.length,total:documents.length,note:'Selected excerpts of attached documents; this is not an exhaustive review.'});
  }
  const meta={...found,resolution,authorities:resolvedAuthority?[resolvedAuthority]:[],scope:effectiveScope,source_selection:body.source_mode||'auto',jurisdiction_note:plan.jurisdiction_note||'',coverage_notes:plan.coverage_notes||[],query,task,databases:[...(documents.length?['documents']:[]),...database_ids],database_reason:plan.database_reason||'Searching your selected databases.',research_focus:plan.research_focus||'general',research_issues:issues,document_coverage:documentCoverage(documents,found.sources),filters:searchFilters,automatic,model:modelName(env),inference:local(env)?'local':'api'};
  if(path==='/api/demo/search')return json({...meta,model_used:false,metrics:metrics(env)});
  await checkpoint(env);
  const sources=evidenceSubset(found.sources,body.context?18500:22000);
  const useWeb=!local(env)&&database_ids.includes('legal_web');
  meta.document_coverage=documentCoverage(documents,sources);
  if(!sources.length&&!useWeb){await reconcile();return json({...meta,propositions:[],sources:[],removed:0,incomplete:false,no_evidence:true,model_used:automatic});}
  // Fit the actual encoded schema, issue list and annotated excerpts, including
  // multibyte text. Remove the lowest-priority final passage before any draft call.
  let draftInput;
  for(;;){try{draftInput=payload(body.question,sources,task,body.context||'',plan.research_focus,useWeb,query,issues,effectiveScope);break;}catch(e){if(e.message!=='Context too large'||sources.length<=1)throw e;sources.pop();}}
  meta.document_coverage=documentCoverage(documents,sources);
  progress({stage:'drafting',...(useWeb?{database:'legal_web'}:{}),message:useWeb?'Searching public legal sources and writing an answer…':'Writing an answer from '+sources.length+' source passages…'});
  const response=await callModel(draftInput,useWeb);
  await reconcile();
  if(useWeb){
    const web=webSources(response);sources.push(...web);
    Object.assign(meta.searched.find(r=>r.id==='legal_web'),{status:web.length?'ok':'empty',passages:0,pages:web.length,consulted_urls:web.length,consulted_sources:web.map(s=>({url:s.source_url,title:s.name})).slice(0,40),searches:webSearches(response),note:'Up to four web tool calls. Listed pages are cited in the answer. Web citations are provider-reported; page text is not independently quote-checked. Court/date filters apply only to the database connectors, not web search.'});
    meta.coverage_notes.push('Web citations are provided by the search service; their text has not been independently quote-checked.');
  }
  // Public-only cache cleanup never touches the lifetime spending ledger.
  await db.prepare('DELETE FROM source_cache WHERE expires<?').bind(now).run();
  await db.prepare('DELETE FROM research_jobs WHERE created<?').bind(now-172800).run();
  await db.prepare('DELETE FROM source_requests WHERE created<?').bind(now-172800).run();
  await db.prepare('DELETE FROM demo_attempts WHERE expires<?').bind(now).run();
  progress({stage:'checking',message:'Checking source quotations…'});
  const checked=validate(response,sources,task,issues);
  if(task==='brief'&&!sources.some(s=>s.research_role==='separate'))checked.missing_sections=checked.missing_sections?.filter(s=>s!=='Separate opinions');
  for(const p of checked.propositions){p.verification={citation:resolution?.status==='resolved'&&(resolvedAuthority&&sources.find(s=>s.id===p.source_id)?.cluster_id===resolvedAuthority.id||resolution.local&&sources.find(s=>s.id===p.source_id)?.case_id===resolution.case.id)?'Resolved exact case':'Not independently resolved',quotation:p.evidence_method==='exact_passage'?'Exact match':'Not available',support:{verdict:'not_reviewed',reason:'AI proposition-support review has not been run.'},later_treatment:plan.research_focus==='case_status'?'Limited search of retrieved later opinions; not comprehensive':'Not reviewed'};}
  if(task==='brief'&&resolvedAuthority){const cited=new Set(checked.propositions.filter(p=>p.section==='Separate opinions').map(p=>sources.find(s=>s.id===p.source_id)?.opinion_id));for(const op of resolvedAuthority.opinions.filter(o=>!o.principal&&o.text))if(!cited.has(op.id))meta.coverage_notes.push(op.label+' (opinion '+op.id+') was retrieved but has no retained summary. Open the full opinion in Evidence to review it.');}
  const used=new Set(checked.propositions.flatMap(p=>p.source_ids||[p.source_id]));
  const displayed=sources.filter(s=>s.evidence_method!=='web_citation'||used.has(s.id));
  if(useWeb)meta.searched.find(r=>r.id==='legal_web').pages=displayed.filter(s=>s.evidence_method==='web_citation').length;
  return json({...meta,...checked,sources:displayed.map(s=>({...s,relationship:relationship(s,effectiveScope)})),model_used:true,metrics:metrics(env)});
}
async function api(request,env,progress=()=>{}){
 const context=requestContext();env={...env,REQUEST:context};
 const access=await authorize(request,env);
 if(!access.authorized&&new URL(request.url).pathname!=='/api/demo/status')return json({error:access.configured===false?'Invite access is enabled but its server configuration is incomplete.':'Sign in through the configured invite-only Access application.',login_url:access.login_url||''},401);
 env.AUTH_SUBJECT=access.subject||'';
 try{return await apiCore(request,env,progress);}finally{if(context.job)await env.DB.prepare("UPDATE research_jobs SET state='finished' WHERE id=? AND state='active'").bind(context.job).run();}
}
function errorResponse(error){
  // Never log prompts, provider response bodies, documents or keys.
  if(!(error instanceof PublicError)&&!(error instanceof SourceError)&&!(error instanceof Cancelled))console.error('Demo service failure');
  return json({error:error instanceof PublicError||error instanceof SourceError||error instanceof Cancelled?error.message:'Research is temporarily unavailable. Please try again later.'},error instanceof PublicError||error instanceof Cancelled?error.status:error instanceof SourceError?400:503);
}
function streamResearch(request,env,context){
  let closed=false;
  const stream=new ReadableStream({start(controller){
    const emit=(event,data)=>{if(!closed){try{controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));}catch{closed=true;}}};
    const work=(async()=>{
      emit('progress',{stage:'accepted',message:'Starting research…'});
      try{const response=await api(request,env,data=>emit('progress',data));emit(response.ok?'result':'error',{...await response.json(),status:response.status});}
      catch(e){const response=errorResponse(e);emit('error',{...await response.json(),status:response.status});}
      finally{if(!closed){closed=true;controller.close();}}
    })();
    // Finish accounting even if the browser disconnects. No automatic retries.
    context?.waitUntil(work);
  },cancel(){closed=true;}});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export default {
  async fetch(request,env,context) {
    try {
      if(request.method==='POST'&&['/api/demo/research','/api/demo/search','/api/demo/verify','/api/demo/collect','/api/demo/review'].includes(new URL(request.url).pathname)&&request.headers.get('Accept')==='text/event-stream')return streamResearch(request,env,context);
      if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env);
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      const url=new URL(request.url);
      if(['/sources','/sources.html'].includes(url.pathname))return new Response(null,{status:308,headers:{Location:'/open-source'+url.search+'#datasets'}});
      if(url.pathname==='/'||url.pathname==='/demo')url.pathname='/index.html';
      else if(['/about','/open-source','/run-locally'].includes(url.pathname))url.pathname+='.html';
      const result=await env.ASSETS.fetch(new Request(url,request));
      const headers=new Headers(result.headers);
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set('Cache-Control','no-cache');
      headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
      return new Response(result.body,{status:result.status,headers});
    } catch(error) {
      return errorResponse(error);
    }
  }
};
