import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {reserve,upgradeReservation,settle,CAP,RESERVE,WEB_RESERVE,cost} from '../worker/budget.js';
import {conversationContext} from '../shared/conversation.js';
import {quoteSegments,webSources,legalUrl,referenceKey} from '../worker/web.js';

import {fixture} from './fixture.mjs';

const webUrl='https://example.gov/statutes/property';
const webResponse={status:'completed',usage:{input_tokens:2000,output_tokens:300},output:[{type:'web_search_call',status:'completed',action:{sources:[{url:webUrl,title:'Example government code'},{url:'https://lawfirm.example/blog'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({propositions:[{section:'Findings',claim:'A supported web finding.',source_id:'',quote_id:'',web_source_url:webUrl},{section:'Findings',claim:'Invented source rejected.',source_id:'',quote_id:'',web_source_url:'https://example.gov/invented'}]})}]}]};
test('public legal web uses bounded tool calls, checks provenance and accounts for the tool fee',async t=>{
  const f=await fixture(t,{webResponse,plan:{task:'research',search_query:'property limitation period',database_ids:['legal_web'],coverage_gaps:['state_codes'],filters:{court:'',after:'',before:''}}});
  const q=f.question({task:'auto',database_ids:'auto'}),r=await f.req('research',q),data=await r.json();
  assert.equal(r.status,200);assert.equal(f.calls.length,2);assert.equal(f.calls[1].max_tool_calls,4);assert.equal(f.calls[1].tools[0].type,'web_search');
  assert.equal(data.propositions.length,1);assert.equal(data.removed,1);assert.equal(data.propositions[0].evidence_method,'web_citation');assert.equal(data.propositions[0].quote,'');
  assert.equal(data.sources.length,1);assert.equal(data.sources[0].text,'');assert.equal(data.sources[0].source_url,webUrl);assert.equal(data.searched[0].pages,1);
  assert.ok(!data.coverage_notes.some(note=>/selective|not directly connected/.test(note)));
  const row=await f.db.prepare('SELECT * FROM demo_calls WHERE id=?').bind(q.request_id).first();assert.equal(row.web_search_calls,1);assert.equal(row.charged,10763);assert.equal(row.state,'completed');
});
test('source-only and local research never invoke the paid web tool',async t=>{
  const f=await fixture(t);const r=await (await f.req('search',f.question({database_ids:['legal_web']}))).json();
  assert.equal(r.model_used,false);assert.equal(f.calls.length,0);assert.equal(r.searched[0].status,'pending');
  const l=await fixture(t,{local:true,bindings:{LOCAL_RESEARCH:'true'}});
  assert.equal((await (await l.req('status')).json()).databases.find(d=>d.id==='legal_web').available,false);
  assert.equal((await l.req('research',l.question({database_ids:['legal_web']}))).status,400);assert.equal(l.calls.length,0);
});
test('web reservation upgrades are atomic and preserve the lifetime cap',async t=>{
  const f=await fixture(t);
  await f.db.prepare("INSERT INTO demo_calls (id,visitor,session,created,state,charged) VALUES ('historical','v','s',0,'completed',?)").bind(CAP-WEB_RESERVE-RESERVE).run();
  assert.equal(await reserve(f.db,'a','v','s',1),true);assert.equal(await reserve(f.db,'b','v','s',1),true);
  const upgrades=await Promise.all(['a','b'].map(id=>upgradeReservation(f.db,id)));assert.equal(upgrades.filter(Boolean).length,1);
  assert.equal((await f.db.prepare('SELECT SUM(charged) n FROM demo_calls').first()).n,CAP);
  assert.equal(cost({input_tokens:1,output_tokens:1,web_search_calls:-1}),null);
});
test('a refused web upgrade settles planning and never sends the paid tool call',async t=>{
  const f=await fixture(t,{webResponse,plan:{task:'research',search_query:'property limits',database_ids:['legal_web'],filters:{court:'',after:'',before:''}}});
  await f.db.prepare("INSERT INTO demo_calls (id,visitor,session,created,state,charged) VALUES ('old','v','s',0,'completed',?)").bind(CAP-RESERVE).run();
  const q=f.question({task:'auto',database_ids:'auto'});assert.equal((await f.req('research',q)).status,429);assert.equal(f.calls.length,1);
  assert.equal((await f.db.prepare('SELECT charged FROM demo_calls WHERE id=?').bind(q.request_id).first()).charged,163);
});
test('web provider failures or missing tool accounting retain the larger reservation',async t=>{
  for(const options of [{fail:true},{webResponse:{...webResponse,output:webResponse.output.slice(1)}}]){
    const f=await fixture(t,options),q=f.question({database_ids:['legal_web']});await f.req('research',q);
    const row=await f.db.prepare('SELECT state,charged FROM demo_calls WHERE id=?').bind(q.request_id).first();assert.equal(row.state,'reserved');assert.equal(row.charged,WEB_RESERVE);
  }
});
test('web provenance rejects unsafe and unapproved hosts, and quotation segments preserve exact text',()=>{
  for(const url of ['http://example.gov/law','https://example.gov:123/law','https://user@example.gov/law','https://example.gov.evil.test/law','https://127.0.0.1/law','https://law.justia.com/cases/test','javascript:alert(1)'])assert.equal(legalUrl(url),null);
  assert.ok(legalUrl('https://leg.state.fl.us/code'));assert.ok(legalUrl('https://library.municode.com/ga/atlanta/codes/code_of_ordinances'));
  assert.equal(webSources({output:[{type:'message',content:[{type:'output_text',text:webUrl}]}]}).length,0);
  const source={id:'S1',text:('The original document’s punctuation and  whitespace remain intact. '+ 'Details follow without any fictional authority. ').repeat(15)};
  for(const q of quoteSegments(source)){assert.ok(source.text.includes(q.quote));assert.ok(q.quote.length>=20&&q.quote.length<=240);}
});
test('a finding can cite several actual web sources; one invented reference rejects the finding',async t=>{
  const second='https://example.gov/city/code',response=structuredClone(webResponse);
  response.output[0].action.sources.push({url:second,title:'City code'});
  response.output[1].content[0].text=JSON.stringify({propositions:[
    {section:'Findings',claim:'Both sources support distinct parts.',source_id:'',quote_id:'',web_source_urls:[webUrl,second]},
    {section:'Findings',claim:'One source is invented.',source_id:'',quote_id:'',web_source_urls:[webUrl,'https://example.gov/missing']}
  ]});
  const f=await fixture(t,{webResponse:response}),data=await (await f.req('research',f.question({database_ids:['legal_web']}))).json();
  assert.equal(data.propositions.length,1);assert.equal(data.propositions[0].source_ids.length,2);assert.equal(data.sources.length,2);assert.equal(data.removed,1);assert.equal(data.removed_references.length,1);
});
test('an invented quotation segment cannot fall back to a supplied quote',async t=>{
  const f=await fixture(t,{draftResponse:{status:'completed',usage:{input_tokens:1000,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({propositions:[{section:'Findings',claim:'Invalid segment.',source_id:'S1',quote_id:'S1Q999999',quote:'A fabricated fallback quote.',web_source_urls:[]}]})}]}]}});
  const data=await (await f.req('research',f.question())).json();assert.equal(data.propositions.length,0);assert.equal(data.removed,1);assert.match(data.removed_references[0].reason,/segment/);
});
test('unanswered parts of a multi-issue request remain visible after citation validation',async t=>{
  const response=structuredClone(webResponse);response.output[1].content[0].text=JSON.stringify({propositions:[{issue_id:'I1',section:'Findings',claim:'Only the first issue has support.',source_id:'',quote_id:'',web_source_urls:[webUrl]}]});
  const f=await fixture(t,{webResponse:response,plan:{task:'research',search_query:'two issues',research_questions:['What is the state rule?','What is the city rule?'],database_ids:['legal_web'],filters:{court:'',after:'',before:''}}});
  const data=await (await f.req('research',f.question({task:'auto',database_ids:'auto'}))).json();
  assert.deepEqual(data.unanswered_issues,[{id:'I2',question:'What is the city rule?'}]);assert.equal(data.propositions.length,1);assert.equal(data.research_issues.length,2);
  assert.equal(JSON.parse(f.calls[1].input).research_issues[1].question,'What is the city rule?');
});
test('ignored attempts after the builtin execution cap do not leave a known response reserved',async t=>{
  const response=structuredClone(webResponse);response.output.unshift(...Array.from({length:4},()=>({type:'web_search_call',status:'searching',action:{type:'open_page'}})));
  const f=await fixture(t,{webResponse:response}),q=f.question({database_ids:['legal_web']});await f.req('research',q);
  const row=await f.db.prepare('SELECT * FROM demo_calls WHERE id=?').bind(q.request_id).first();assert.equal(row.state,'completed');assert.equal(row.web_search_calls,4);assert.equal(row.charged,40600);
});
test('feedback saves without an account, model call, question or attachment by default',async t=>{
  const f=await fixture(t),id=crypto.randomUUID(),request_id=crypto.randomUUID();
  const r=await f.req('feedback',{id,request_id,rating:'needs_work',issue:'sources',comment:'The source is outdated.',documents:attached});
  assert.equal(r.status,200);assert.equal((await r.json()).saved,true);assert.equal(f.calls.length,0);
  const row=await f.db.prepare('SELECT * FROM research_feedback WHERE id=?').bind(id).first();assert.equal(row.shared_context,null);assert.equal(row.comment,'The source is outdated.');assert.equal(row.request_id,request_id);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM demo_calls').first()).n,0);
  assert.equal((await f.req('feedback')).status,405,'Public visitors cannot read saved feedback');
});
test('feedback context requires explicit consent and can be removed on update',async t=>{
  const f=await fixture(t),body={id:crypto.randomUUID(),request_id:crypto.randomUUID(),rating:'helpful'};
  assert.equal((await f.req('feedback',{...body,question:'Private question',answer:'Private answer'})).status,400);
  assert.equal((await f.req('feedback',{...body,share_context:true,question:'Question selected for sharing',answer:'Answer selected for sharing'})).status,200);
  let row=await f.db.prepare('SELECT * FROM research_feedback WHERE id=?').bind(body.id).first();assert.deepEqual(JSON.parse(row.shared_context),{question:'Question selected for sharing',answer:'Answer selected for sharing'});
  assert.equal((await f.req('feedback',{...body,rating:'needs_work',share_context:false,comment:'Changed my feedback.'})).status,200);
  row=await f.db.prepare('SELECT * FROM research_feedback WHERE id=?').bind(body.id).first();assert.equal(row.shared_context,null);assert.equal(row.rating,'needs_work');assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM research_feedback').first()).n,1);
});
test('feedback rejects cross-origin, oversized and invalid writes, and cannot update another visitor',async t=>{
  const f=await fixture(t),body={id:crypto.randomUUID(),request_id:crypto.randomUUID(),rating:'helpful'};
  assert.equal((await f.req('feedback',body,'',{Origin:'https://evil.test'})).status,403);
  for(const extra of [{rating:'invalid'},{issue:'invalid'},{comment:'x'.repeat(2001)},{share_context:'true'},{share_context:true,question:'x'.repeat(2001),answer:'x'}])assert.equal((await f.req('feedback',{...body,...extra})).status,400);
  assert.equal((await f.req('feedback',body)).status,200);
  assert.equal((await f.req('feedback',{...body,rating:'needs_work'},'',{'CF-Connecting-IP':'203.0.113.99'})).status,429);
  assert.equal((await f.db.prepare('SELECT rating FROM research_feedback WHERE id=?').bind(body.id).first()).rating,'helpful');assert.equal(f.calls.length,0);
});
test('feedback volume is bounded without disabling updates or changing research spending',async t=>{
  const f=await fixture(t),body={id:crypto.randomUUID(),request_id:crypto.randomUUID(),rating:'helpful'};await f.req('feedback',body);
  const row=await f.db.prepare('SELECT * FROM research_feedback').first();
  await f.db.batch(Array.from({length:59},()=>f.db.prepare('INSERT INTO research_feedback (id,visitor,created,updated,request_id,rating,issue,comment,model) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),row.visitor,row.created,row.updated,body.request_id,'helpful','','',row.model)));
  assert.equal((await f.req('feedback',{...body,id:crypto.randomUUID()})).status,429);
  assert.equal((await f.req('feedback',{...body,comment:'Update still allowed'})).status,200);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM demo_calls').first()).n,0);
});
test('citation normalization removes tracking but preserves content-selecting query parameters',()=>{
  assert.equal(referenceKey('https://www.supremecourt.gov/opinions/example.pdf?abcdef12345='),referenceKey('https://www.supremecourt.gov/opinions/example.pdf'));
  assert.equal(referenceKey('https://example.gov/code?section=2&utm_source=search'),referenceKey('https://example.gov/code?section=2'));
  assert.equal(referenceKey('https://example.gov/code?title=9&section=2'),referenceKey('https://example.gov/code?section=2&title=9'));
  assert.notEqual(referenceKey('https://example.gov/code?section=2'),referenceKey('https://example.gov/code?section=3'));
  assert.notEqual(referenceKey('https://example.gov/opinion.pdf?edition=2024'),referenceKey('https://example.gov/opinion.pdf'));
});
test('a normalized citation retains the actual provider URL and cannot introduce a new authority',async t=>{
  const response=structuredClone(webResponse),providerUrl='https://www.supremecourt.gov/opinions/example.pdf?abcdef12345=';
  response.output[0].action.sources=[{url:providerUrl}];response.output[1].content[0].text=JSON.stringify({propositions:[{section:'Findings',claim:'Finding from a reported PDF.',source_id:'',quote_id:'',web_source_urls:['https://www.supremecourt.gov/opinions/example.pdf']},{section:'Findings',claim:'Different PDF is not allowed.',source_id:'',quote_id:'',web_source_urls:['https://www.supremecourt.gov/opinions/different.pdf']}]});
  const f=await fixture(t,{webResponse:response}),data=await (await f.req('research',f.question({database_ids:['legal_web']}))).json();assert.equal(data.propositions.length,1);assert.equal(data.sources[0].source_url,providerUrl);assert.equal(data.removed,1);
});

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
  assert.equal((await f.req('research',f.question({question:'   '}))).status,400);
  assert.equal((await f.req('research',f.question({question:'a'.repeat(11000)}))).status,400);
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
function remoteFixture(seen,{failCourt=false,hostile=false,duplicateEcfr=false}={}) {
  return async request=>{
    if(request.url.startsWith('https://api.openai.com/'))return;
    seen.push({url:request.url,authorization:request.headers.get('authorization')});
    const u=new URL(request.url);
    if(u.hostname==='www.ecfr.gov'){
      if(u.pathname.includes('/search/'))return Response.json({meta:{total_count:250},results:Array.from({length:duplicateEcfr?2:1},()=>({type:'Section',hierarchy:{title:'38',part:'21',section:'21.257'},headings:{section:'Self-<strong>employment</strong>',chapter:'Veterans Affairs'}}))});
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
  assert.equal(f.calls[0].store,false);assert.equal(f.calls[0].service_tier,'default');assert.equal(f.calls[0].max_output_tokens,6144);assert.equal(f.calls[0].model,'gpt-6-luna');assert.equal(f.calls[0].tools,undefined);
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

test('legacy counts do not reset spending; the new job limiter is reported separately',async t=>{
  const f=await fixture(t),now=Math.floor(Date.now()/1000),encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(f.bindings.DEMO_SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const ip=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('203.0.113.1')))].map(b=>b.toString(16).padStart(2,'0')).join('');
  for(let i=0;i<40;i++)await f.db.prepare('INSERT INTO demo_calls(id,visitor,session,created,state,charged) VALUES(?,?,?,?,?,?)').bind('old'+i,ip,'public:'+ip,now-2,'completed',1000).run();
  await f.db.prepare('INSERT INTO demo_attempts(id,count,expires) VALUES(?,100,?)').bind('research:'+ip+':'+Math.floor(now/3600),now+7200).run();
  const status=await (await f.req('status')).json();assert.equal(status.request_limits,true);assert.equal(status.cap,10);assert.equal(status.daily_remaining,undefined);
  assert.equal((await f.req('research',f.question())).status,200);
  assert.equal((await f.db.prepare('SELECT SUM(charged) n FROM demo_calls').first()).n,40325);
  const admitted=await Promise.all(Array.from({length:15},()=>reserve(f.db,crypto.randomUUID(),ip,'public:'+ip,now)));
  assert.equal(admitted.filter(Boolean).length,15,'No minute or concurrent count ceiling');
});

test('automatic settings use the model and account for planning plus drafting together',async t=>{
  const f=await fixture(t);
  const q=f.question({question:'Why?',task:'auto',database_ids:'auto',context:'User: Tell me about Celotex.'});
  const r=await f.req('research',q);assert.equal(r.status,200);const data=await r.json();
  assert.equal(data.task,'brief');assert.equal(data.query,'Celotex');assert.deepEqual(data.databases,['cap']);assert.equal(data.automatic,true);assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].max_output_tokens,1536);assert.match(f.calls[0].input,/Tell me about Celotex/);assert.match(f.calls[1].input,/conversation_context/);
  const ledger=await f.db.prepare('SELECT * FROM demo_calls').first();assert.equal(ledger.charged,488);assert.equal(ledger.input_tokens,1500);assert.equal(ledger.output_tokens,300);
  assert.equal((await f.req('research',q)).status,429);assert.equal(f.calls.length,2);
});

test('clarification settles only planning, searches no providers and retains idempotency',async t=>{
  const f=await fixture(t,{plan:{action:'clarify',message:'What type of matter do you mean?',suggestions:['Personal injury','Contract dispute'],coverage_gaps:['state_codes'],task:'research',search_query:'Georgia statute of limitations',database_ids:[],filters:{court:'',after:'',before:''}}});
  const q=f.question({question:'What is the statute of limitations in Georgia?',task:'auto',database_ids:'auto'});
  const response=await f.req('research',q);assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.needs_clarification,true);assert.equal(data.follow_up.kind,'clarify');assert.deepEqual(data.sources,[]);assert.deepEqual(data.searched,[]);assert.deepEqual(data.databases,[]);assert.match(data.coverage_notes[0],/not directly connected/);assert.equal(f.calls.length,1);
  assert.equal((await f.db.prepare('SELECT charged FROM demo_calls').first()).charged,163);
  assert.equal((await f.req('research',q)).status,429);assert.equal(f.calls.length,1);
});

test('short follow-up includes prior user topic and clarification in both planning and drafting',async t=>{
  const f=await fixture(t);
  const context=conversationContext([{question:'Tell me about Celotex.',query:'Celotex',follow_up:{kind:'clarify',message:'Which issue?',suggestions:['Summary judgment burden']}}]);
  const result=await (await f.req('research',f.question({question:'Summary judgment burden',task:'auto',context}))).json();
  assert.ok(result.propositions.length);assert.equal(f.calls.length,2);
  for(const call of f.calls){const input=JSON.parse(call.input);assert.match(input.conversation_context,/Tell me about Celotex/);assert.match(input.conversation_context,/Assistant follow-up: Which issue/);}
  assert.ok(conversationContext(Array.from({length:10},()=>({question:'x'.repeat(2000),query:'topic',propositions:[]}))).length<=3500);
});

test('out-of-scope turn returns a next step without retrieving unrelated law',async t=>{
  const f=await fixture(t,{plan:{action:'scope',message:'I can help with legal research. What would you like to explore?',suggestions:[],coverage_gaps:[],task:'research',search_query:'',database_ids:[],filters:{court:'',after:'',before:''}}});
  const r=await (await f.req('research',f.question({question:'Hello',task:'auto',database_ids:'auto'}))).json();
  assert.equal(r.follow_up.kind,'scope');assert.equal(r.needs_clarification,false);assert.equal(r.sources.length,0);assert.equal(f.calls.length,1);
});

test('automatic topics use semantic case search while manual queries keep keyword syntax and filters',async t=>{
  const seen=[],f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-court-token'},source:remoteFixture(seen),plan:{action:'research',task:'research',search_query:'California security deposit return deadline',case_name:'',state_jurisdiction:'CA',database_ids:['courtlistener'],filters:{court:'',after:'',before:''}}});
  const body=f.question({question:'When must a California landlord return a security deposit?',task:'auto',database_ids:['courtlistener'],filters:{after:'2020-01-01'}});
  const data=await (await f.req('research',body)).json();const search=seen.find(s=>s.url.includes('/search/'));assert.equal(new URL(search.url).searchParams.get('semantic'),'true');assert.equal(new URL(search.url).searchParams.get('court'),'cal calctapp calappdeptsuper');assert.equal(new URL(search.url).searchParams.get('filed_after'),'2020-01-01');assert.equal(data.searched[0].searches[0].mode,'semantic');
  seen.length=0;
  await f.req('research',{...body,filters:{court:'scotus'},search_query:'"security deposit" AND refund',request_id:crypto.randomUUID()});const manual=new URL(seen.find(s=>s.url.includes('/search/')).url);assert.equal(manual.searchParams.get('court'),'scotus');assert.equal(manual.searchParams.has('semantic'),false);assert.equal(manual.searchParams.get('q'),'"security deposit" AND refund');
});

test('invalid follow-up fails closed and local clarification uses no paid calls',async t=>{
  const plan={action:'clarify',message:'Which jurisdiction?',suggestions:['x'.repeat(121)],task:'research',database_ids:[],filters:{court:'',after:'',before:''}};
  const bad=await fixture(t,{plan});assert.equal((await bad.req('research',bad.question({task:'auto',database_ids:'auto'}))).status,502);assert.equal(bad.calls.length,1);
  const local=await fixture(t,{plan:{...plan,suggestions:[]},local:true,bindings:{LOCAL_RESEARCH:'true',OPENAI_API_KEY:''}});
  const result=await (await local.req('research',local.question({task:'auto',database_ids:'auto'}))).json();assert.equal(result.needs_clarification,true);assert.equal(local.calls.length,1);assert.equal((await local.db.prepare('SELECT COUNT(*) n FROM demo_calls').first()).n,0);
});

test('clarification preserves manual settings and bounds full conversation input',async t=>{
  const f=await fixture(t,{plan:{action:'clarify',message:'What issue?',suggestions:[],task:'memo',database_ids:[],filters:{court:'',after:'',before:''}}});
  const response=await f.req('research',f.question({question:'q'.repeat(2000),context:'c'.repeat(3500),auto_fields:true,task:'compare',search_query:'manual terms',filters:{court:'scotus'}}));
  assert.equal(response.status,200);const p=await response.json();assert.equal(p.task,'compare');assert.equal(p.query,'manual terms');assert.equal(p.needs_clarification,true);assert.ok(new TextEncoder().encode(JSON.stringify(f.calls[0])).length<=14000);
});

test('case-status search resolves the named case, prefers lead opinions and retrieves later treatment',async t=>{
  const seen=[],primary={cluster_id:1,caseName:'Atlas v. Beacon',citation:['100 U.S. 100'],court:'Supreme Court',court_id:'scotus',dateFiled:'1980-01-01',absolute_url:'/opinion/1/atlas/',opinions:[{id:11,type:'dissent'},{id:12,type:'lead-opinion'}]};
  const later={cluster_id:2,caseName:'Nova v. Comet',citation:['200 U.S. 200'],court:'Supreme Court',court_id:'scotus',dateFiled:'2020-01-01',absolute_url:'/opinion/2/nova/',opinions:[{id:21,type:'dissent'},{id:22,type:'lead-opinion'}]};
  const recent={...later,cluster_id:3,caseName:'Gamma v. Delta',dateFiled:'2026-01-01',absolute_url:'/opinion/3/gamma/',opinions:[{id:32,type:'combined-opinion'}]};
  const f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-court-token'},plan:{task:'research',search_query:'Atlas v. Beacon',case_name:'Atlas v. Beacon',research_focus:'case_status',database_reason:'Cases and later treatment.',database_ids:['courtlistener'],filters:{court:'',after:'',before:''}},source:async request=>{
    if(!request.url.includes('courtlistener.com'))return;
    const u=new URL(request.url);seen.push(u);
    if(u.pathname.endsWith('/search/')){
      if(u.searchParams.get('q').startsWith('caseName:'))return Response.json({count:10,results:[primary]});
      assert.equal(u.searchParams.get('court'),'scotus');assert.equal(u.searchParams.get('filed_after'),'1980-01-01');
      assert.match(u.searchParams.get('q'),/"Atlas v. Beacon" AND/);
      return Response.json({count:20,results:u.searchParams.get('order_by')==='dateFiled desc'?[recent,later]:[later]});
    }
    assert.doesNotMatch(u.pathname,/opinions\/(11|21)\//,'Dissents must not displace available lead opinions');
    return Response.json({plain_text:u.pathname.includes('/12/')?'The original Atlas v. Beacon decision held that the rule was required.':('Background material without any relevant decision. '.repeat(100)+'We hold that Atlas v. Beacon is overruled. The prior rule cannot stand. ').repeat(2)});
  }});
  const data=await (await f.req('research',f.question({question:'Is Atlas v. Beacon still good law?',task:'auto',database_ids:'auto'}))).json();
  assert.equal(data.research_focus,'case_status');assert.equal(data.sources[0].research_role,'later-treatment');
  assert.ok(data.sources.some(s=>s.text.includes('Atlas v. Beacon is overruled')));
  assert.ok(data.sources.some(s=>s.research_role==='original'));assert.ok(data.sources.some(s=>s.research_role==='recent-treatment'));
  assert.equal(data.searched[0].searches.length,3);assert.equal(seen[0].searchParams.get('q'),'caseName:(Atlas AND Beacon)');assert.equal(seen[0].searchParams.get('order_by'),'citeCount desc');
  assert.equal(f.calls.length,2,'Improved retrieval must not add unbudgeted model calls');
});

test('later-case suggestions are fetched as search leads, never used as answer evidence by themselves',async t=>{
  const seen=[],base=remoteFixture(seen);
  const f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-court-token'},plan:{task:'research',search_query:'Example v. Example',case_name:'Example v. Example',later_case_name:'Missing v. Nobody',research_focus:'case_status',database_ids:['courtlistener'],filters:{court:'',after:'',before:''}},source:async request=>{
    if(request.url.includes('courtlistener.com')&&new URL(request.url).searchParams.get('q')?.includes('Missing'))return Response.json({count:0,results:[]});return base(request);
  }});
  const data=await (await f.req('research',f.question({task:'auto',database_ids:'auto'}))).json();
  assert.equal(data.searched[0].searches.length,4);assert.equal(data.searched[0].searches[1].matches,0);assert.ok(data.sources.every(s=>!s.name.includes('Missing')));assert.ok(!f.calls[1].input.includes('Missing'));assert.equal(f.calls.length,2);
});

test('later-treatment failure preserves original evidence and discloses the gap',async t=>{
  const seen=[],base=remoteFixture(seen);
  const f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-court-token'},plan:{task:'research',search_query:'Example v. Example',case_name:'Example v. Example',research_focus:'case_status',database_ids:['courtlistener'],filters:{court:'',after:'',before:''}},source:async request=>{
    if(request.url.includes('courtlistener.com')&&new URL(request.url).searchParams.get('q')?.includes('overrul*'))return new Response('{}',{status:429});return base(request);
  }});
  const data=await (await f.req('research',f.question({task:'auto',database_ids:'auto'}))).json();
  assert.ok(data.sources.length);assert.equal(data.searched[0].searches[1].status,'unavailable');assert.match(data.searched[0].warnings.join(' '),/No later-treatment full text/);
  assert.equal(data.searched[0].searches.length,2,'Upstream rate limits must not trigger more requests');
});

test('a successful zero-match treatment search is empty, not a provider outage',async t=>{
  const f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-court-token'},plan:{task:'research',search_query:'Missing v. Nobody',case_name:'Missing v. Nobody',research_focus:'case_status',database_ids:['courtlistener'],filters:{court:'',after:'',before:''}},source:async request=>request.url.includes('courtlistener.com')?Response.json({count:0,results:[]}):undefined});
  const data=await (await f.req('research',f.question({task:'auto',database_ids:'auto'}))).json();
  assert.equal(data.no_evidence,true);assert.equal(data.searched[0].status,'empty');assert.equal(f.calls.length,1);assert.ok(data.searched[0].searches.every(s=>s.status==='ok'&&s.matches===0));
});

test('streaming research reports real stages and final results while keeping the same accounting',async t=>{
  const f=await fixture(t);
  const r=await f.req('research',f.question({task:'auto',database_ids:'auto'}),'',{Accept:'text/event-stream'});
  assert.match(r.headers.get('Content-Type'),/text\/event-stream/);
  const frames=(await r.text()).trim().split('\n\n').map(frame=>({event:frame.match(/^event: (.+)$/m)[1],data:JSON.parse(frame.match(/^data: (.+)$/m)[1])}));
  const stages=frames.filter(f=>f.event==='progress').map(f=>f.data.stage);
  for(const stage of ['accepted','planning','plan','searching','source_complete','drafting','checking'])assert.ok(stages.includes(stage),stage);
  assert.equal(frames.at(-1).event,'result');assert.equal(frames.at(-1).data.propositions.length,1);assert.equal((await f.db.prepare('SELECT charged FROM demo_calls').first()).charged,488);
  const bad=await f.req('research',f.question(),'',{Accept:'text/event-stream',Origin:'https://evil.test'});const error=await bad.text();assert.match(error,/event: error/);assert.match(error,/"status":403/);assert.equal(f.calls.length,2);
});

test('manual selections retain all connected databases even if the planner suggests just case law',async t=>{
  const seen=[],f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-court-token'},source:remoteFixture(seen)});
  const data=await (await f.req('research',f.question({task:'auto',database_ids:['courtlistener','ecfr','federal_register']}))).json();
  assert.deepEqual(data.databases,['courtlistener','ecfr','federal_register']);assert.equal(data.searched.length,3);assert.ok(data.sources.some(s=>s.database_id==='ecfr'));assert.match(data.database_reason,/selected in Search settings/);
});

test('disconnecting a progress stream does not skip model cost settlement',async t=>{
  let release,started;const gate=new Promise(r=>release=r),drafting=new Promise(r=>started=r);
  const f=await fixture(t,{beforeDraft:async()=>{started();await gate;}});
  const r=await f.req('research',f.question(),'',{Accept:'text/event-stream'}),reader=r.body.getReader();
  await reader.read();await drafting;const canceled=reader.cancel();release();await canceled;
  let ledger;
  for(let i=0;i<50;i++){ledger=await f.db.prepare('SELECT * FROM demo_calls').first();if(ledger?.state==='completed')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(ledger.state,'completed');assert.equal(ledger.charged,325);assert.equal(f.calls.length,1);
});

test('manual task, database, query and filters override the automatic plan',async t=>{
  const f=await fixture(t,{plan:{task:'memo',search_query:'unwanted query',database_ids:['ecfr'],filters:{court:'ca9',after:'2021-01-01',before:'2024-01-01'}}});
  const data=await (await f.req('research',f.question({task:'compare',auto_fields:true,search_query:'Twombly Iqbal',filters:{court:'scotus',after:'1900-01-01',before:'2015-01-01'}}))).json();
  assert.equal(data.task,'compare');assert.equal(data.query,'Twombly Iqbal');assert.deepEqual(data.databases,['cap']);assert.equal(data.filters.court,'scotus');assert.equal(data.filters.after,'1900-01-01');assert.equal(data.filters.before,'2015-01-01');assert.equal(f.calls.length,2);
});

test('invalid automatic plans fail without drafting or arbitrary source access',async t=>{
  const f=await fixture(t,{plan:{task:'brief',search_query:'Celotex',database_ids:['attacker'],filters:{court:'',after:'',before:''}}});
  assert.equal((await f.req('research',f.question({task:'auto',database_ids:'auto'}))).status,502);
  assert.equal(f.calls.length,1);assert.equal((await f.db.prepare('SELECT charged FROM demo_calls').first()).charged,163);
});

test('automatic routing respects an exhausted budget before either model call',async t=>{
  const f=await fixture(t);await f.db.prepare("INSERT INTO demo_calls(id,visitor,session,created,state,charged) VALUES('spent','a','a',0,'completed',?)").bind(CAP).run();
  assert.equal((await f.req('research',f.question({task:'auto',database_ids:'auto'}))).status,429);assert.equal(f.calls.length,0);
  assert.equal((await f.req('search',f.question())).status,200);
});

test('automatic settings also run on local Ollama without API spending',async t=>{
  const f=await fixture(t,{local:true,bindings:{LOCAL_RESEARCH:'true',OPENAI_API_KEY:''}});
  const data=await (await f.req('research',f.question({task:'auto',database_ids:'auto'}))).json();assert.equal(data.task,'brief');assert.equal(data.model,'qwen3:14b');assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.num_predict,1536);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM demo_calls').first()).n,0);
});

test('demo page offers research without a passcode or login control',async t=>{
  const f=await fixture(t);
  const r=await f.mf.dispatchFetch('https://lex.test/demo');assert.equal(r.status,200);const html=await r.text();assert.doesNotMatch(html,/passcode|unlock-panel|lock-demo|type="password"/);assert.match(html,/Search databases/);assert.match(html,/Auto task/);assert.doesNotMatch(html,/MVP|Early research|Public preview/);const home=await f.mf.dispatchFetch('https://lex.test/');assert.match(await home.text(),/What are you researching/);assert.ok(!html.includes('fake-test-key'));assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
});

test('duplicate regulation sections do not consume multiple evidence slots',async t=>{
  const seen=[],f=await fixture(t,{source:remoteFixture(seen,{duplicateEcfr:true})});
  const data=await (await f.req('search',f.question({database_ids:['ecfr'],search_query:'self-employment vocational'}))).json();
  assert.equal(data.sources.length,1);assert.equal(seen.filter(s=>s.url.includes('/full/')).length,1);
});

test('a drafting failure after successful planning retains the entire two-call reservation',async t=>{
  const f=await fixture(t,{failDraft:true}),q=f.question({task:'auto',database_ids:'auto'});
  assert.equal((await f.req('research',q)).status,502);assert.equal(f.calls.length,2);
  const ledger=await f.db.prepare('SELECT * FROM demo_calls').first();assert.equal(ledger.state,'reserved');assert.equal(ledger.charged,RESERVE);
  assert.equal((await f.req('research',q)).status,429);assert.equal(f.calls.length,2);
});

const attached=[{name:'sample.txt',type:'text',pages:[{number:1,text:'Either party may terminate the agreement by giving thirty days of written notice. The project starts on March 15, 2026.'}]}];
test('document-only research cites attachments without querying public databases or caching private text',async t=>{
 const f=await fixture(t);const data=await (await f.req('research',f.question({task:'analyze',documents:attached,document_mode:'only',database_ids:[]}))).json();
 assert.equal(data.task,'analyze');assert.deepEqual(data.databases,['documents']);assert.equal(data.sources[0].kind,'attachment');assert.equal(data.sources[0].source_url,'');assert.match(data.propositions[0].quote,/terminate/);assert.equal(data.document_coverage[0].name,'sample.txt');
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM source_cache').first()).n,0);assert.equal(f.calls.length,1);
});
test('automatic document analysis honors document-only scope even when the planner names a database',async t=>{
 const f=await fixture(t,{plan:{task:'analyze',search_query:'termination',database_ids:['ecfr'],filters:{court:'',after:'',before:''}}});
 const data=await (await f.req('research',f.question({task:'auto',documents:attached,database_ids:'auto'}))).json();
 assert.equal(data.task,'analyze');assert.deepEqual(data.databases,['documents']);assert.equal(f.calls.length,2);assert.ok(!f.calls[0].input.includes('thirty days'),'Planner gets metadata, not document contents');
});
test('explicit combined research keeps public authorities distinct from attached documents',async t=>{
 const f=await fixture(t);const data=await (await f.req('research',f.question({task:'memo',documents:attached,document_mode:'with_sources',database_ids:['cap']}))).json();
 assert.deepEqual(data.databases,['documents','cap']);assert.ok(data.sources.some(s=>s.kind==='attachment'));assert.ok(data.sources.some(s=>s.database_id==='cap'));assert.equal(data.document_coverage.length,1);
});
test('invalid attachment metadata, oversized text and request envelopes fail before inference',async t=>{
 const f=await fixture(t);
 for(const documents of [[{...attached[0],name:'../secret.txt'}],Array(6).fill(attached[0]),[{...attached[0],pages:[{number:1,text:'a'.repeat(300001)}]}]])assert.equal((await f.req('research',f.question({documents}))).status,400);
 assert.equal((await f.req('research',f.question({padding:'a'.repeat(700001)}))).status,413);assert.equal(f.calls.length,0);
});

test('validated attachments override a false missing-document plan without external search',async t=>{
 const f=await fixture(t,{plan:{action:'clarify',clarification_reason:'missing_document',message:'Please reupload.',suggestions:[],task:'analyze',search_query:'review contract',database_ids:[],filters:{court:'',after:'',before:''}}});
 const data=await (await f.req('research',f.question({task:'auto',documents:attached,database_ids:'auto'}))).json();
 assert.equal(data.follow_up,undefined);assert.equal(data.task,'analyze');assert.deepEqual(data.databases,['documents']);assert.ok(data.propositions.length);assert.equal(f.calls.length,2);
});
test('foreign-only law scope prevents U.S. searches even when the planner requests research',async t=>{
 const f=await fixture(t,{plan:{action:'research',jurisdiction_scope:'foreign',task:'research',search_query:'inheritance law',database_ids:['legal_web'],filters:{court:'',after:'',before:''}}});
 const data=await (await f.req('research',f.question({question:'What are inheritance rules in Japan?',task:'auto',database_ids:'auto'}))).json();
 assert.equal(data.follow_up.kind,'scope');assert.match(data.follow_up.message,/U.S. law/);assert.equal(f.calls.length,1);assert.deepEqual(data.sources,[]);
});

test('completed page-open URLs count as tool provenance, while attempted and failed opens do not',()=>{
 const output=[{type:'web_search_call',status:'completed',action:{type:'open_page',url:'https://example.gov/opened'}},{type:'web_search_call',status:'failed',action:{type:'open_page',url:'https://example.gov/failed'}},{type:'web_search_call',status:'searching',action:{type:'open_page',url:'https://example.gov/attempted'}},{type:'web_search_call',status:'completed',action:{type:'search',url:'https://example.gov/guessed'}},{type:'web_search_call',status:'completed',action:{type:'open_page',url:'https://unapproved.example/secret'}}];
 assert.deepEqual(webSources({output}).map(s=>s.source_url),['https://example.gov/opened']);assert.equal(webSources({output})[0].text,'');
});

test('recognized case publishers are eligible but unrelated publisher pages are not',()=>{
 for(const u of ['https://supreme.justia.com/cases/federal/us/372/335/','https://law.justia.com/cases/federal/appellate-courts/ca2/one.html','https://www.law.cornell.edu/supremecourt/text/372/335','https://www.courtlistener.com/opinion/123/case/'])assert.ok(legalUrl(u));
 for(const u of ['https://supreme.justia.com/blog/advice','https://www.courtlistener.com/docket/123/private','https://www.law.cornell.edu/wex/something'])assert.equal(legalUrl(u),null);
});

test('case briefs retain opening facts and a distant operative holding within the excerpt budget',async t=>{
 const text='Atlas asked the state court for counsel and was denied. '+('Background procedural discussion without the operative decision. ').repeat(120)+' We hold that counsel must be appointed in this proceeding. The judgment is reversed. '+('Closing directions to the lower court. ').repeat(20);
 const f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'fake-token'},source:async req=>{
  if(!req.url.includes('courtlistener.com'))return;
  if(new URL(req.url).pathname.endsWith('/search/'))return Response.json({count:1,results:[{cluster_id:1,caseName:'Atlas v. Beacon',citation:['100 U.S. 100'],court:'Supreme Court',court_id:'scotus',absolute_url:'/opinion/1/atlas/',opinions:[{id:11,type:'lead-opinion'}]}]});
  return Response.json({plain_text:text});
 }});
 const data=await (await f.req('research',f.question({task:'brief',search_query:'Atlas v. Beacon',database_ids:['courtlistener']}))).json();
 assert.ok(data.sources.some(s=>s.text.includes('Atlas asked the state court')));assert.ok(data.sources.some(s=>s.text.includes('We hold that counsel must be appointed')));assert.ok(data.sources.length<=3);
});


test('planning and drafting ceilings remain below their conservative reservations',()=>{
 assert.ok(Math.ceil((14000+32768+8192)*.225+(1536+6144)*.5)<RESERVE);
 assert.ok(Math.ceil((14000+4096+5*(32768+4096)+10*128000)*.225+(1536+6144)*.5)+4*10000<WEB_RESERVE);
});

const verifyPage='A hypothetical public legal source. Actions concerning property must be filed within four years. This provision is subject to the exceptions in the following section.';
const verifiedResponse=data=>({status:'completed',usage:{input_tokens:1000,output_tokens:200},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}]});
const verificationBody=(urls=[webUrl])=>({request_id:crypto.randomUUID(),findings:[{claim:'Property actions have a four-year period, subject to statutory exceptions.',urls}]});
test('citation recheck reads fresh text and grounds its support review in fresh evidence',async t=>{
 const f=await fixture(t,{source:request=>{if(request.url===webUrl){assert.equal(request.headers.get('Authorization'),null);assert.equal(request.headers.get('Cache-Control'),'no-cache');return new Response('<main>'+verifyPage+'</main>',{headers:{'Content-Type':'text/html'}});}},verify:body=>{
  assert.equal(body.text.format.name,'citation_support_review');assert.equal(body.tools,undefined);const {sources}=JSON.parse(body.input);assert.ok(sources[0].segments[0].text.includes('four years'));
  return verifiedResponse({findings:[{finding_id:'F1',verdict:'supported',reason:'The period and exception match the fresh source.',evidence_ids:[sources[0].segments[0].id]}]});
 }});
 const body=verificationBody(),response=await f.req('verify',body),result=await response.json();assert.equal(response.status,200);assert.equal(result.findings[0].verdict,'supported');assert.equal(result.pages[0].method,'direct');assert.equal(result.pages[0].text,undefined);assert.equal(result.findings[0].evidence[0].text,verifyPage);
 const row=await f.db.prepare('SELECT * FROM demo_calls WHERE id=?').bind(body.request_id).first();assert.equal(row.charged,325);assert.equal(row.web_search_calls,0);assert.equal(row.state,'completed');assert.equal((await f.req('verify',body)).status,429);
});
test('citation review rejects invented evidence and cannot endorse unreadable companion sources',async t=>{
 let round=0;
 const f=await fixture(t,{source:request=>request.url.startsWith('https://example.gov/')?new Response(request.url===webUrl?verifyPage:'denied',{status:request.url===webUrl?200:403,headers:{'Content-Type':'text/plain'}}):null,verify:body=>{
  if(body.text.format.name==='citation_page_reader')return {...verifiedResponse({pages:[]}),output:[{type:'web_search_call',status:'completed',action:{type:'open_page',url:'https://example.gov/missing'}},...verifiedResponse({pages:[]}).output]};
  return verifiedResponse({findings:[{finding_id:'F1',verdict:'supported',reason:'A purported match.',evidence_ids:++round===1?['invented']:['V1E1']}]});
 }});
 let result=await (await f.req('verify',verificationBody())).json();assert.equal(result.findings[0].verdict,'unverified');assert.equal(result.findings[0].evidence.length,0);
 result=await (await f.req('verify',verificationBody([webUrl,'https://example.gov/missing']))).json();assert.equal(result.findings[0].verdict,'partial');assert.equal(result.pages[1].status,'unavailable');
});
test('PDF fallback requires an actual completed open of the same URL and preserves its provenance',async t=>{
 let hasOpen=false;
 const pdf='https://example.gov/opinion.pdf';
 const f=await fixture(t,{source:r=>r.url===pdf?new Response('%PDF',{headers:{'Content-Type':'application/pdf'}}):null,verify:body=>{
  if(body.text.format.name==='citation_page_reader'){
   assert.equal(body.max_tool_calls,1);assert.doesNotMatch(body.input,/Property actions/);assert.equal(body.tools[0].external_web_access,true);
   return {...verifiedResponse({pages:[{source_id:'V1',status:'readable',text:verifyPage}]}),output:[{type:'web_search_call',status:'completed',action:hasOpen?{type:'open_page',url:pdf}:{type:'search',sources:[{url:pdf}]}},...verifiedResponse({pages:[{source_id:'V1',status:'readable',text:verifyPage}]}).output]};
  }
  return verifiedResponse({findings:[{finding_id:'F1',verdict:'partial',reason:'An excerpt supports only part of this claim.',evidence_ids:['V1E1']}]});
 }});
 let result=await (await f.req('verify',verificationBody([pdf]))).json();assert.equal(result.findings[0].verdict,'unverified');assert.equal(f.calls.length,1);
 hasOpen=true;const body=verificationBody([pdf]);result=await (await f.req('verify',body)).json();assert.equal(result.findings[0].verdict,'partial');assert.equal(result.pages[0].method,'web_reader');assert.equal(result.findings[0].evidence[0].method,'web_reader');
 const row=await f.db.prepare('SELECT * FROM demo_calls WHERE id=?').bind(body.request_id).first();assert.equal(row.charged,10650);assert.equal(row.web_search_calls,1);
});
test('citation recheck rejects unsafe URLs and does not follow a publisher redirect to private hosts',async t=>{
 const fetched=[];
 const f=await fixture(t,{source:r=>{if(!r.url.startsWith('https://api.openai.com/')){fetched.push(r.url);return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});}},verify:()=>({...verifiedResponse({pages:[]}),output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[]}},...verifiedResponse({pages:[]}).output]})});
 for(const url of ['http://example.gov/','https://example.gov.evil.test/','https://127.0.0.1/','https://example.gov:444/','https://user:secret@example.gov/'])assert.equal((await f.req('verify',verificationBody([url]))).status,400);
 assert.equal(f.calls.length,0);assert.equal(fetched.length,0);
 const result=await (await f.req('verify',verificationBody())).json();assert.deepEqual(fetched,[webUrl]);assert.equal(result.pages[0].status,'unavailable');assert.equal(result.findings[0].verdict,'unverified');
});
test('citation recheck respects the lifetime cap and holds uncertain provider spending',async t=>{
 const f=await fixture(t,{source:r=>r.url===webUrl?new Response(verifyPage,{headers:{'Content-Type':'text/plain'}}):null,fail:true});
 let body=verificationBody();assert.equal((await f.req('verify',body)).status,502);
 const row=await f.db.prepare('SELECT * FROM demo_calls WHERE id=?').bind(body.request_id).first();assert.equal(row.state,'reserved');assert.equal(row.charged,RESERVE);
 await f.db.prepare("INSERT INTO demo_calls (id,visitor,session,created,state,charged) VALUES ('prior','v','s',0,'completed',?)").bind(CAP-RESERVE).run();
 assert.equal((await f.req('verify',verificationBody())).status,429);assert.equal(f.calls.length,1);
});
test('local citation recheck never sends claims to OpenAI or invokes the paid web reader',async t=>{
 const f=await fixture(t,{local:true,bindings:{LOCAL_RESEARCH:'true'},source:r=>r.url===webUrl?new Response(verifyPage,{headers:{'Content-Type':'text/plain'}}):null,verify:true});
 const result=await (await f.req('verify',verificationBody())).json();assert.equal(result.findings[0].verdict,'unverified');assert.equal(f.calls.length,1);assert.equal(f.calls[0].model,'qwen3:14b');assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM demo_calls').first()).n,0);
});
