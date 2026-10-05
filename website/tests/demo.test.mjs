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
