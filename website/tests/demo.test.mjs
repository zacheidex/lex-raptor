import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {reserve,settle,CAP,RESERVE,cost} from '../worker/budget.js';

async function fixture(t,options={}) {
  const calls=[];
  const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2025-09-01',d1Databases:['DB'],
    bindings:{DEMO_ENABLED:'true',OPENAI_API_KEY:'fake-test-key',DEMO_PASSCODE:'test-demo-passcode-only',DEMO_SESSION_SECRET:'test-session-secret-not-for-production',DEMO_EXPIRES_AT:String(Math.floor(Date.now()/1000)+86400),...options.bindings},
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
  async function unlock(){const r=await req('unlock',{passcode:'test-demo-passcode-only'});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);return r.headers.get('set-cookie').split(';')[0];}
  const question=(extra={})=>({question:'What does Celotex say about the burden on summary judgment?',database_ids:['cap'],request_id:crypto.randomUUID(),...extra});
  return {mf,db,calls,req,unlock,question};
}

test('passcode, origin, disabled state and selection prevent any provider call',async t=>{
  const f=await fixture(t);
  assert.equal((await f.req('research',f.question())).status,401);
  assert.equal((await f.req('unlock',{passcode:'wrong'})).status,401);
  assert.equal((await f.req('unlock',{passcode:'test-demo-passcode-only'},'',{Origin:'https://evil.test'})).status,403);
  const cookie=await f.unlock();
  assert.equal((await f.req('research',f.question({database_ids:[]}),cookie)).status,400);
  assert.equal((await f.req('research',f.question({database_ids:['courtlistener']}),cookie)).status,400);
  assert.equal((await f.req('research',f.question({question:'a'.repeat(2001)}),cookie)).status,400);
  assert.equal((await f.req('research',f.question(),cookie+'tampered')).status,401);
  assert.equal(f.calls.length,0);
  const disabled=await fixture(t,{bindings:{DEMO_ENABLED:'false'}});
  assert.equal((await disabled.req('unlock',{passcode:'test-demo-passcode-only'})).status,503);
  assert.equal((await (await disabled.req('status')).json()).enabled,false);
});

test('research settles actual tokens, removes fabricated evidence and refuses duplicate IDs',async t=>{
  const f=await fixture(t),cookie=await f.unlock(),q=f.question();
  const r=await f.req('research',q,cookie);assert.equal(r.status,200);
  const result=await r.json();assert.equal(result.propositions.length,1);assert.equal(result.removed,1);assert.ok(result.sources.length);
  assert.equal(f.calls[0].store,false);assert.equal(f.calls[0].service_tier,'default');assert.equal(f.calls[0].max_output_tokens,4096);assert.equal(f.calls[0].model,'gpt-6-luna');assert.equal(f.calls[0].tools,undefined);
  const ledger=await f.db.prepare('SELECT * FROM demo_calls').first();assert.equal(ledger.charged,325);assert.equal(ledger.state,'completed');assert.equal(ledger.model,'gpt-6-luna');
  assert.equal((await f.req('research',q,cookie)).status,429);assert.equal(f.calls.length,1);
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
  const f=await fixture(t,{fail:true}),cookie=await f.unlock();
  assert.equal((await f.req('research',f.question(),cookie)).status,502);
  const ledger=await f.db.prepare('SELECT * FROM demo_calls').first();assert.equal(ledger.charged,RESERVE);assert.equal(ledger.state,'reserved');assert.equal(f.calls.length,1);
  await settle(f.db,ledger.id,{});assert.equal((await f.db.prepare('SELECT charged FROM demo_calls').first()).charged,RESERVE);
  assert.equal(cost({input_tokens:-1,output_tokens:0}),null);
});

test('daily visitor limits survive a new session, and passcode guessing is throttled',async t=>{
  const f=await fixture(t),now=Math.floor(Date.now()/1000);
  for(let i=0;i<10;i++)await f.db.prepare('INSERT INTO demo_calls(id,visitor,session,created,state,charged) VALUES(?,?,?,?,?,?)').bind('old'+i,'same-ip','old-session',now-500,'completed',1000).run();
  assert.equal(await reserve(f.db,crypto.randomUUID(),'same-ip','new-session',now),false);
  for(let i=0;i<10;i++)assert.equal((await f.req('unlock',{passcode:'wrong'})).status,401);
  assert.equal((await f.req('unlock',{passcode:'test-demo-passcode-only'})).status,429);
});

test('demo page is served, has no inline scripts and no hidden research login account',async t=>{
  const f=await fixture(t);
  const r=await f.mf.dispatchFetch('https://lex.test/demo');assert.equal(r.status,200);const html=await r.text();assert.match(html,/Demo passcode/);assert.match(html,/Search databases/);assert.ok(!html.includes('fake-test-key'));assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
});
