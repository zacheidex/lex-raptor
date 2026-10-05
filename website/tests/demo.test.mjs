import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {reserve,settle,CAP,RESERVE,cost} from '../worker/budget.js';

async function fixture(t,options={}) {
  const calls=[];
  const bindings={DEMO_ENABLED:'true',OPENAI_API_KEY:'fake-test-key',DEMO_SESSION_SECRET:'test-session-secret-not-for-production',DEMO_EXPIRES_AT:String(Math.floor(Date.now()/1000)+86400),...options.bindings};
  const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2025-09-01',d1Databases:['DB'],
    bindings,
    serviceBindings:{ASSETS:async request=>new Response(await readFile('public'+(new URL(request.url).pathname==='/'?'/index.html':new URL(request.url).pathname)))},
    outboundService:async request=>{
      if(options.source){const response=await options.source(request);if(response)return response;}
      if(options.local&&request.url==='http://127.0.0.1:11434/api/chat'){
        const body=await request.json();calls.push(body);const {sources}=JSON.parse(body.messages[1].content);
        return Response.json({done:true,done_reason:'stop',prompt_eval_count:1000,eval_count:200,message:{content:JSON.stringify({propositions:[{section:body.format.properties.propositions.items.properties.section.enum[0],claim:'Local fixture finding.',source_id:sources[0].id,quote:sources[0].text.slice(0,80)}]})}});
      }
      assert.equal(request.url,'https://api.openai.com/v1/responses');
      const body=await request.json();calls.push(body);
      if(options.fail)return new Response('{}',{status:500});
      const {sources}=JSON.parse(body.input),s=sources[0];
      return Response.json({status:'completed',usage:{input_tokens:1000,output_tokens:200},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({propositions:[{claim:'A fixture claim to verify citation handling.',source_id:s.id,quote:s.text.slice(0,100)},{claim:'Invented authority must be removed.',source_id:'invented',quote:'This quotation is not a real supplied source.'}]})}]}]});
    }
  });
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()) {
    for(const sql of (await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
  }
  async function req(path,body,cookie='',headers={}){return mf.dispatchFetch('https://lex.test/api/demo/'+path,{...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',Origin:'https://lex.test','CF-Connecting-IP':'203.0.113.1',Cookie:cookie,...headers}});}
  const question=(extra={})=>({question:'What does Celotex say about the burden on summary judgment?',database_ids:['cap'],request_id:crypto.randomUUID(),...extra});
  return {mf,db,calls,req,question,bindings};
}

test('origin, disabled state, visitor identification and selection guard public research',async t=>{
  const f=await fixture(t);
  const status=await (await f.req('status')).json();assert.equal(status.enabled,true);assert.equal(status.access,'public');
  assert.equal((await f.req('research',f.question(),'',{Origin:'https://evil.test'})).status,403);
  assert.equal((await f.req('research',f.question(),'',{'Sec-Fetch-Site':'cross-site'})).status,403);
  // Miniflare fills missing edge IP headers, so call the built handler directly
  // to verify a host without that trusted header fails before model use.
  const {default:worker}=await import('../dist/server/index.js');
  const noIp=new Request('https://lex.test/api/demo/research',{method:'POST',headers:{Origin:'https://lex.test','Content-Type':'application/json'},body:JSON.stringify(f.question())});
  assert.equal((await worker.fetch(noIp,{...f.bindings,DB:f.db})).status,503);
  assert.equal((await f.req('research',f.question({database_ids:[]}))).status,400);
  assert.equal((await f.req('research',f.question({database_ids:['courtlistener']}))).status,400);
  assert.equal((await f.req('research',f.question({question:'a'.repeat(2001)}))).status,400);
  assert.equal((await f.req('research',f.question({question:'a'.repeat(11000)}))).status,413);
  assert.equal((await f.req('unlock',{})).status,404);
  assert.equal(f.calls.length,0);
  const disabled=await fixture(t,{bindings:{DEMO_ENABLED:'false'}});
  assert.equal((await disabled.req('research',disabled.question())).status,503);
  assert.equal((await (await disabled.req('status')).json()).enabled,false);
  assert.equal(disabled.calls.length,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM demo_calls').first()).n,0);
});

const regulationText='A program of vocational rehabilitation benefits may include self-employment when the agency determines that it is a suitable vocational goal.';
const noticeText='The agency proposes to revise the eligibility requirements. This is a proposed rule and is not a final determination of eligibility.';
function remoteFixture(seen,{failCourt=false,hostile=false}={}) {
  return async request=>{
    if(request.url.startsWith('https://api.openai.com/'))return;
    seen.push({url:request.url,authorization:request.headers.get('authorization')});
    const u=new URL(request.url);
    if(u.hostname==='www.ecfr.gov'){
      if(u.pathname.includes('/search/'))return Response.json({meta:{total_count:250},results:[{type:'Section',hierarchy:{title:'38',part:'21',section:'21.257'},headings:{section:'Self-<strong>employment</strong>',chapter:'Veterans Affairs'}}]});
      if(u.pathname.endsWith('titles.json'))return Response.json({titles:[{number:38,name:'Veterans benefits',up_to_date_as_of:'2026-10-01'}]});
      return new Response('<DIV8><P>'+regulationText+'</P></DIV8>');
    }
    if(u.hostname==='www.federalregister.gov'){
      if(u.pathname==='/api/v1/documents.json')return Response.json({count:120,results:[{document_number:'2026-12345'}]});
      if(u.pathname.includes('/api/v1/documents/'))return Response.json({document_number:'2026-12345',title:'Eligibility proposal',citation:'91 FR 12345',publication_date:'2026-10-01',type:'Proposed Rule',raw_text_url:hostile?'https://attacker.invalid/steal':'https://www.federalregister.gov/documents/full_text/text/2026/10/01/2026-12345.txt',html_url:'https://www.federalregister.gov/documents/2026/10/01/2026-12345/eligibility',agencies:[{name:'Agency'}]});
      return new Response('<html><body><pre>'+noticeText+'</pre></body></html>');
    }
    if(u.hostname==='www.courtlistener.com'){
      if(failCourt)return new Response('{}',{status:503});
      assert.equal(request.headers.get('authorization'),'Token fake-court-token');
      if(u.pathname.endsWith('/citation-lookup/'))return Response.json([{citation:'477 U.S. 317',status:200,normalized_citations:['477 U.S. 317'],clusters:[{case_name:'Celotex',absolute_url:'/opinion/123/celotex/'}]},{citation:'999 U.S. 999',status:404,clusters:[]}]);
      if(u.pathname.endsWith('/search/'))return Response.json({count:150000,results:[{caseName:'Example v. Example',citation:['123 F.3d 456'],court:'Ninth Circuit',dateFiled:'2020-05-01',absolute_url:'/opinion/123/example/',opinions:[{id:123,type:'lead-opinion',snippet:'SNIPPET MUST NEVER BE EVIDENCE'}]}]});
      if(u.pathname.endsWith('/opinions/123/'))return Response.json({plain_text:'The judgment is reversed because the party was entitled to notice and an opportunity to be heard before the final decision.'});
    }
    throw new Error('Unexpected remote destination');
  };
}

test('live-database search uses fetched text, preserves source types, and spends no model credits',async t=>{
  const seen=[],f=await fixture(t,{source:remoteFixture(seen)});
  const r=await f.req('search',f.question({database_ids:['ecfr','federal_register'],search_query:'eligibility',filters:{after:'2020-01-01'}}));assert.equal(r.status,200);
  const data=await r.json();assert.equal(data.model_used,false);assert.equal(f.calls.length,0);
  assert.equal(data.searched.length,2);assert.ok(data.searched.every(s=>s.status==='ok'));
  assert.ok(data.sources.some(s=>s.text===regulationText&&s.source_status.includes('2026-10-01')));
  assert.ok(data.sources.some(s=>s.text===noticeText&&s.opinion_type==='Proposed Rule'));
  assert.ok(seen.every(s=>s.authorization===null));
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM demo_calls').first()).n,0);
  const docsBefore=seen.filter(s=>s.url.includes('/full/')).length;
  await f.req('search',f.question({database_ids:['ecfr'],search_query:'eligibility'}));
  assert.equal(seen.filter(s=>s.url.includes('/full/')).length,docsBefore,'Public document cache should avoid repeat full-text downloads');
});

test('a failed selected database is disclosed while other sources remain usable',async t=>{
  const seen=[],f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-court-token'},source:remoteFixture(seen,{failCourt:true})});
  const data=await (await f.req('search',f.question({database_ids:['courtlistener','ecfr']}))).json();
  assert.equal(data.searched.find(s=>s.id==='courtlistener').status,'unavailable');
  assert.equal(data.searched.find(s=>s.id==='ecfr').status,'ok');assert.ok(data.sources.every(s=>s.database_id==='ecfr'));assert.equal(f.calls.length,0);
});

test('CourtListener search and citation audit keep the token server-side and never cite snippets',async t=>{
  const seen=[],f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-court-token'},source:remoteFixture(seen)});
  const data=await (await f.req('search',f.question({database_ids:['courtlistener'],filters:{court:'ca9',after:'2010-01-01'}}))).json();
  assert.ok(data.sources.length);assert.ok(data.sources.every(s=>!s.text.includes('SNIPPET')));assert.ok(seen[0].url.includes('court=ca9'));
  const audit=await (await f.req('citations',{text:'477 U.S. 317 and 999 U.S. 999'})).json();
  assert.deepEqual(audit.citations.map(c=>c.status),[200,404]);assert.equal(audit.model_used,false);assert.equal(f.calls.length,0);
  assert.ok(!JSON.stringify({data,audit}).includes('fake-court-token'));
});

test('untrusted source URLs cannot forward credentials or fetch another host',async t=>{
  const seen=[],f=await fixture(t,{source:remoteFixture(seen,{hostile:true})});
  const data=await (await f.req('search',f.question({database_ids:['federal_register']}))).json();
  assert.equal(data.sources.length,0);assert.equal(seen.length,2);assert.ok(seen.every(s=>s.url.startsWith('https://www.federalregister.gov/')));
});

test('all advanced workflows run through local Ollama without an API key or spending ledger debit',async t=>{
  const f=await fixture(t,{local:true,bindings:{LOCAL_RESEARCH:'true',OPENAI_API_KEY:'',DEMO_ENABLED:'false',DEMO_EXPIRES_AT:'0'}});
  const status=await (await f.req('status')).json();assert.equal(status.enabled,true);assert.equal(status.inference,'local');assert.equal(status.cap,null);
  for(const task of ['brief','memo','compare','arguments']){
    const r=await f.req('research',f.question({task}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.task,task);assert.equal(data.propositions.length,1);assert.equal(data.model,'qwen3:14b');
  }
  assert.equal(f.calls.length,4);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM demo_calls').first()).n,0);
});

test('date filtering happens before selection and unsupported workflows fail without inference',async t=>{
  const f=await fixture(t);
  const data=await (await f.req('research',f.question({filters:{after:'2020-01-01'}}))).json();assert.equal(data.no_evidence,true);assert.equal(f.calls.length,0);
  assert.equal((await f.req('research',f.question({task:'invented'}))).status,400);
  assert.equal((await f.req('research',f.question({filters:{after:'2026-02-31'}}))).status,400);
  assert.equal((await f.req('research',f.question({filters:{after:'2026-01-01',before:'2020-01-01'}}))).status,400);
});

test('research without cookies or passcode settles tokens, validates quotes and refuses duplicate IDs',async t=>{
  const f=await fixture(t),q=f.question();
  const r=await f.req('research',q);assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
  const result=await r.json();assert.equal(result.propositions.length,1);assert.equal(result.removed,1);assert.ok(result.sources.length);
  assert.equal(f.calls[0].store,false);assert.equal(f.calls[0].service_tier,'default');assert.equal(f.calls[0].max_output_tokens,4096);assert.equal(f.calls[0].model,'gpt-6-luna');assert.equal(f.calls[0].tools,undefined);
  const ledger=await f.db.prepare('SELECT * FROM demo_calls').first();assert.equal(ledger.charged,325);assert.equal(ledger.state,'completed');assert.equal(ledger.model,'gpt-6-luna');
  assert.equal((await f.req('research',q,'__Host-lex-demo=obsolete-cookie')).status,429);assert.equal(f.calls.length,1);
  const serialized=JSON.stringify(result);assert.ok(!serialized.includes('fake-test-key'));
});

test('parallel requests cannot overspend the last reservation',async t=>{
  const f=await fixture(t),now=Math.floor(Date.now()/1000);
  await f.db.prepare(`INSERT INTO demo_calls(id,visitor,session,created,state,charged) VALUES('earlier','other','other',?,'completed',?)`).bind(now-1000,CAP-RESERVE).run();
  const admitted=await Promise.all(Array.from({length:30},(_,i)=>reserve(f.db,crypto.randomUUID(),'ip'+i,'s'+i,now)));
  assert.equal(admitted.filter(Boolean).length,1);
  assert.equal((await f.db.prepare('SELECT SUM(charged) n FROM demo_calls').first()).n,CAP);
  assert.equal(await reserve(f.db,crypto.randomUUID(),'new','new',now+864000),false,'Cap must not reset on a new day');
});

test('provider failures and missing usage retain their full reservation',async t=>{
  const f=await fixture(t,{fail:true});
  assert.equal((await f.req('research',f.question())).status,502);
  const ledger=await f.db.prepare('SELECT * FROM demo_calls').first();assert.equal(ledger.charged,RESERVE);assert.equal(ledger.state,'reserved');assert.equal(f.calls.length,1);
  await settle(f.db,ledger.id,{});assert.equal((await f.db.prepare('SELECT charged FROM demo_calls').first()).charged,RESERVE);
  assert.equal(cost({input_tokens:-1,output_tokens:0}),null);
});

test('historical daily visitor limits survive public access and cookie changes',async t=>{
  const f=await fixture(t),now=Math.floor(Date.now()/1000);
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode('test-session-secret-not-for-production'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const ip=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('203.0.113.1')))].map(b=>b.toString(16).padStart(2,'0')).join('');
  for(let i=0;i<10;i++)await f.db.prepare('INSERT INTO demo_calls(id,visitor,session,created,state,charged) VALUES(?,?,?,?,?,?)').bind('old'+i,ip,'old-signed-session',now-500,'completed',1000).run();
  assert.equal((await f.req('research',f.question())).status,429);
  assert.equal((await f.req('research',f.question(),'__Host-lex-demo=new-cookie')).status,429);
  assert.equal(f.calls.length,0);
  assert.equal((await f.db.prepare('SELECT SUM(charged) n FROM demo_calls').first()).n,10000);
  assert.equal((await f.req('research',f.question(),'',{'CF-Connecting-IP':'203.0.113.2'})).status,200);
});

test('demo page offers research without a passcode or login control',async t=>{
  const f=await fixture(t);
  const r=await f.mf.dispatchFetch('https://lex.test/demo');assert.equal(r.status,200);const html=await r.text();assert.doesNotMatch(html,/passcode|unlock-panel|lock-demo|type="password"/);assert.match(html,/Search databases/);assert.ok(!html.includes('fake-test-key'));assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
});
