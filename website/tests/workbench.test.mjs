import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
import {citationOccurrences,exactIntent} from '../shared/citations.js';
import {legalCitation} from '../shared/legal-citations.js';
import {opinionText,publicDocumentUrl} from '../worker/cases.js';
import {requestContext,limited} from '../worker/runtime.js';
import {researchDocx,authorityPacket,authorityHTML,researchText} from '../client/exports.js';
import {unzipSync,strFromU8,strToU8} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';

const celotex=JSON.parse(await readFile('tests/fixtures/celotex-public.json','utf8'));
const cluster=(id=111722)=>({id,case_name:id===111722?celotex.name:'Erie Railroad v. Tompkins',case_name_short:id===111722?'Celotex':'Erie',date_filed:id===111722?'1986-06-25':'1938-04-25',citations:[{volume:id===111722?477:304,reporter:'U.S.',page:id===111722?317:64}],absolute_url:'/opinion/'+id+'/case/',docket:'https://www.courtlistener.com/api/rest/v4/dockets/1/',sub_opinions:celotex.opinions.map(o=>'https://www.courtlistener.com/api/rest/v4/opinions/'+o.id+'/')});
function provider(options={}){
 const calls=[];
 async function source(request){const u=new URL(request.url);if(u.hostname!=='www.courtlistener.com')return;calls.push(u.href);
  if(u.pathname.endsWith('/citation-lookup/')){const text=new URLSearchParams(await request.text()).get('text');return Response.json(citationOccurrences(text).map(o=>({citation:o.text,normalized_citations:[o.text],status:/999/.test(o.text)?404:/Umbrella/.test(o.text)?400:/1 H/.test(o.text)?300:200,clusters:/999|Umbrella/.test(o.text)?[]:/1 H/.test(o.text)?[cluster(111722),cluster(103012)]:[cluster(/304/.test(o.text)?103012:111722)]})));}
  if(u.pathname.endsWith('/search/'))return Response.json({count:options.namedAmbiguous?2:1,results:[{...cluster(),cluster_id:111722,caseName:celotex.name,citation:['477 U.S. 317']},...(options.namedAmbiguous?[{...cluster(999),cluster_id:999,caseName:'Celotex Corp. v. Catrett, order on rehearing',citation:['478 U.S. 1053']}]:[])]});
  if(u.pathname.endsWith('/courts/'))return Response.json({count:2,next:null,results:[{id:'scotus',full_name:'Supreme Court of the United States',jurisdiction:'F'},{id:'ga',full_name:'Supreme Court of Georgia',jurisdiction:'S'}]});
  if(/\/courts\/scotus\/$/.test(u.pathname))return Response.json({full_name:'Supreme Court of the United States',jurisdiction:'F'});
  if(/\/dockets\/1\/$/.test(u.pathname))return Response.json({court:'https://www.courtlistener.com/api/rest/v4/courts/scotus/'});
  if(/\/clusters\/\d+\/$/.test(u.pathname))return Response.json(cluster(Number(u.pathname.split('/').at(-2))));
  if(u.pathname.endsWith('/opinions/')){const id=Number(u.searchParams.get('cluster'));return Response.json({next:null,results:(options.onlyDissent?celotex.opinions.filter(o=>o.type==='040dissent'):celotex.opinions).map(o=>({id:o.id,type:o.type,cluster:'https://www.courtlistener.com/api/rest/v4/clusters/'+id+'/',plain_text:options.unavailable?'':o.text,...(options.pdf?{download_url:'https://example.gov/opinion.pdf'}:{})})).reverse()});}
  throw new Error('Unexpected source URL '+u.href);
 }
 return {calls,source};
}
const response=propositions=>({status:'completed',usage:{input_tokens:800,output_tokens:200},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({propositions})}]}]});
const briefDraft=body=>{const sources=JSON.parse(body.input).sources;const s=sources[0],quote=s.text.match(/\[(S\d+Q\d+)\]/)[1];return response(['Facts','Procedural history','Issue','Rule','Holding','Reasoning','Disposition'].map(section=>({section,claim:'Fixture statement for '+section,source_id:s.id,quote_id:quote,web_source_urls:[]})));};

test('Celotex and Erie citation identities resolve without models or regulatory retrieval; cache reused',async t=>{
 const p=provider(),f=await fixture(t,{source:p.source,bindings:{COURTLISTENER_API_TOKEN:'test'},draft:briefDraft});
 for(const cite of ['477 U.S. 317','304 U.S. 64']){const data=await(await f.req('resolve',{text:cite})).json();assert.equal(data.resolution.case.id,cite.startsWith('477')?111722:103012);assert.equal(data.metrics.model_requests,0);}
 const q=f.question({question:'Brief Celotex Corp. v. Catrett, 477 U.S. 317 (1986)',task:'auto',database_ids:'auto'}),data=await(await f.req('research',q)).json();
 assert.equal(data.authorities[0].principal_id,celotex.principal_id);assert.equal(new Set(data.sources.filter(s=>s.research_role==='separate').map(s=>s.opinion_id)).size,3);assert.deepEqual(data.searched.map(s=>s.id),['courtlistener']);assert.equal(f.calls.length,1);assert.equal(data.propositions.length,7);assert.deepEqual(data.missing_sections,['Separate opinions']);assert.equal(data.metrics.model_requests,1);
 const before=p.calls.length;const next=await(await f.req('search',{...q,request_id:crypto.randomUUID()})).json();assert.equal(p.calls.length,before);assert.equal(next.model_used,false);assert.ok(next.metrics.cache_hits>=5);
});
test('named cases resolve first; ambiguous procedural stages require selection',async t=>{
 for(const ambiguous of [false,true]){const p=provider({namedAmbiguous:ambiguous}),f=await fixture(t,{source:p.source,bindings:{COURTLISTENER_API_TOKEN:'test'},draft:briefDraft});
 const q=f.question({question:'Brief Celotex Corp. v. Catrett',task:'brief',database_ids:'auto'}),data=await(await f.req('research',q)).json();
 if(ambiguous){assert.equal(data.resolution.status,'ambiguous');assert.equal(f.calls.length,0);assert.equal(data.resolution.candidates.length,2);const chosen=await(await f.req('research',{...q,selected_case:111722,request_id:crypto.randomUUID()})).json();assert.equal(chosen.resolution.case.id,111722);}
 else{assert.equal(data.resolution.status,'resolved');assert.equal(f.calls.length,1);assert.deepEqual(data.searched.map(s=>s.id),['courtlistener']);}}
});
test('orders or separate opinions are never substituted for unavailable principal opinion',async t=>{
 const p=provider({onlyDissent:true}),f=await fixture(t,{source:p.source,bindings:{COURTLISTENER_API_TOKEN:'test'}});
 const d=await(await f.req('authority',{cluster_id:111722})).json();assert.equal(d.authority.principal_id,null);assert.equal(d.authority.availability,'unavailable');assert.match(d.authority.warnings.join(' '),/not substituted/);
});
test('exact case honors explicit sources and visible jurisdiction conflicts',async t=>{
 const p=provider(),f=await fixture(t,{source:p.source,bindings:{COURTLISTENER_API_TOKEN:'test'}}),q=f.question({question:'Brief 477 U.S. 317',task:'brief',source_mode:'explicit',database_ids:['ecfr']});
 assert.equal((await(await f.req('research',q)).json()).source_conflict,true);
 const conflict=await(await f.req('research',{...q,request_id:crypto.randomUUID(),source_mode:'auto',database_ids:'auto',scope:{level:'state',state:'GA'}})).json();assert.equal(conflict.scope_conflict,true);assert.match(conflict.scope.description,/Georgia/);assert.equal(f.calls.length,0);
});
test('visible scope is supplied to planning, applied to search, and returned on clarification',async t=>{
 const p=provider(),f=await fixture(t,{source:p.source,bindings:{COURTLISTENER_API_TOKEN:'test'},plan:{task:'research',search_query:'insurance duty to defend',database_ids:['courtlistener'],filters:{court:'',after:'',before:''}}});
 const q=f.question({question:'What triggers an insurer’s duty to defend?',task:'auto',database_ids:'auto',scope:{level:'state',state:'GA',court_ids:['ga'],after:'2000-01-01',governing_law:'Georgia'}});
 const data=await(await f.req('search',{...q,database_ids:['courtlistener']})).json();assert.equal(data.filters.court,'ga');assert.equal(data.filters.after,'2000-01-01');assert.equal(data.scope.governing_law,'Georgia');assert.ok(p.calls.some(c=>new URL(c).searchParams.get('court')==='ga'));
 const c=await fixture(t,{plan:{action:'clarify',clarification_reason:'jurisdiction',message:'Which jurisdiction governs this insurance dispute?',suggestions:['Georgia','California'],task:'research',search_query:'duty to defend',database_ids:[],filters:{court:'',after:'',before:''}}});
 const clarified=await(await c.req('research',c.question({question:'When must an insurer defend?',task:'auto',database_ids:'auto'}))).json();assert.equal(clarified.needs_clarification,true);assert.deepEqual(JSON.parse(c.calls[0].input).jurisdiction_selection,{});assert.equal(clarified.scope.level,'any');
});
test('collection preserves repeated and parallel occurrences, ambiguous/malformed/missing entries with no AI',async t=>{
 const p=provider(),f=await fixture(t,{source:p.source,bindings:{COURTLISTENER_API_TOKEN:'test'}});
 const text='Celotex, 477 U.S. 317, 106 S. Ct. 2548. Again 477 U.S. 317. Erie 304 U.S. 64. 1 H. 150. 999 U.S. 999. 33 Umbrella 422. Id. at 321.';
 const d=await(await f.req('collect',{text})).json();assert.equal(d.items.length,6);assert.equal(d.occurrence_count,8);assert.equal(d.items[0].occurrences.length,3);assert.deepEqual(d.items.map(i=>i.status),['resolved','resolved','ambiguous','not_found','unrecognized','unrecognized']);assert.equal(f.calls.length,0);assert.ok(d.items[0].occurrences.every(o=>text.slice(o.start,o.end)===o.text));
});
test('literal page markers and legal web citations retain real identifiers without invented editions',()=>{
 assert.match(opinionText({xml_harvard:'<p>Hello <page-number citation-index="1" label="318">*318</page-number> world.</p>'}),/\[Source page 318\]/);
 assert.equal(legalCitation('https://law.justia.com/codes/alabama/2024/title-13a/chapter-3/section-13a-3-23/'),'Alabama Code § 13A-3-23 (2024 edition)');
 assert.equal(legalCitation('https://example.gov/law','Ala. Code 1975, § 13A-3-23'),'Ala. Code 1975, § 13A-3-23');
 assert.equal(legalCitation('https://example.gov/unknown','Unknown law'),'');assert.equal(legalCitation('https://www.law.cornell.edu/uscode/text/42/1983'),'42 U.S.C. § 1983');
 assert.equal(publicDocumentUrl('http://example.gov/test.pdf'),'');assert.equal(publicDocumentUrl('https://evil.test/test.pdf'),'');
 assert.equal(exactIntent({question:'Is Atlas v. Beacon still good law?'}),null);assert.equal(exactIntent({question:"What's the current situation with Roe v. Wade?"}),null);assert.ok(exactIntent({question:'What was the holding in Celotex Corp. v. Catrett?'}));
});
test('DOCX and packet archive are valid and retain partial/unavailable review state and unresolved entries',()=>{
 const record={question:'Brief Celotex',scope:{state:'GA'},sources:[{id:'S1',name:celotex.name,citation:'477 U.S. 317',text:'A public excerpt',source_url:celotex.source_url,locator:'Source page 318'}],propositions:[{section:'Holding',claim:'Fixture claim',source_id:'S1',quote:'A public excerpt',verification:{support:{verdict:'partial',reason:'Missing a qualification'},quotation:'Exact match',later_treatment:'Not reviewed'}}],missing_sections:['Facts']};
 const files=unzipSync(researchDocx(record)),errors=[];for(const [name,b]of Object.entries(files)){if(/xml$|rels$/.test(name))new DOMParser({onError:(level,message)=>errors.push(message)}).parseFromString(strFromU8(b),'application/xml');}assert.deepEqual(errors,[]);const doc=strFromU8(files['word/document.xml']);assert.match(doc,/partial/);assert.match(doc,/Missing a qualification/);assert.match(doc,/Facts: missing/);assert.match(doc,/Source page 318/);assert.match(researchText(record),/Not reviewed/);
 const items=[{key:'a',case:celotex,status:'resolved',selected:true,original_citations:['477 U.S. 317'],occurrences:[]},{key:'b',status:'not_found',original_citations:['999 U.S. 999'],occurrences:[]}];
 const packet=unzipSync(authorityPacket(items,[{key:'a',name:'case.html',bytes:strToU8(authorityHTML(celotex)),kind:'Generated HTML'}]));assert.deepEqual(Object.keys(packet).sort(),['case.html','manifest.json','table-of-authorities.csv']);assert.match(strFromU8(packet['case.html']),/not an original court PDF/);const manifest=JSON.parse(strFromU8(packet['manifest.json']));assert.equal(manifest.items[1].status,'not_found');assert.equal(manifest.items[0].case.opinions,undefined);assert.match(strFromU8(packet['table-of-authorities.csv']),/999 U.S. 999/);
});
test('provider semaphore bounds concurrent requests and stops cancelled work',async()=>{
 const env={REQUEST:requestContext()};let active=0,max=0;await Promise.all(Array.from({length:12},()=>limited(env,'fixture',async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;})));assert.equal(max,3);env.REQUEST.cancelled=true;await assert.rejects(()=>limited(env,'fixture',()=>{}),/Cancelled/);
});
test('invite gate rejects missing, expired and wrong-audience tokens; accepts valid session; local still works',async t=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test';
 const issuer='https://lex-test.cloudflareaccess.com',aud='lex-pilot',f=await fixture(t,{bindings:{ACCESS_MODE:'invite',ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:aud},source:request=>request.url===issuer+'/cdn-cgi/access/certs'?Response.json({keys:[jwk]}):null});
 assert.equal((await f.req('research',f.question())).status,401);assert.equal((await(await f.req('status')).json()).access_required,true);
 for(const [audience,exp,wanted] of [[aud,'2h',200],['wrong','2h',401],[aud,Math.floor(Date.now()/1000)-10,401]]){const token=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('invited-user').setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(exp).sign(privateKey);assert.equal((await f.req('search',f.question(),' ',{Authorization:'Bearer '+token})).status,wanted);}
 const local=await fixture(t,{local:true,bindings:{LOCAL_RESEARCH:'true',ACCESS_MODE:'invite'}});assert.equal((await local.req('search',local.question())).status,200);assert.equal(local.calls.length,0);
});
test('authorities stream before synthesis and cancellation prevents an answer while preserving cost accounting',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),p=provider();
 const f=await fixture(t,{source:p.source,bindings:{COURTLISTENER_API_TOKEN:'test'},draft:briefDraft,beforeDraft:async()=>{entered();await gate;}});
 const q=f.question({question:'Brief 477 U.S. 317',database_ids:'auto',task:'brief'}),r=await f.req('research',q,'',{Accept:'text/event-stream'}),reader=r.body.getReader(),decoder=new TextDecoder();let text='';
 while(!text.includes('Resolved opinion available')){const part=await reader.read();assert.equal(part.done,false);text+=decoder.decode(part.value);}
 assert.ok(!text.includes('event: result'));await started;assert.equal((await f.req('cancel',{request_id:q.request_id})).status,200);release();
 for(;;){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value);}
 assert.match(text,/Cancelled/);assert.ok(!text.includes('event: result'));assert.equal((await f.db.prepare('SELECT state FROM research_jobs WHERE id=?').bind(q.request_id).first()).state,'cancelled');assert.equal((await f.db.prepare('SELECT state FROM demo_calls WHERE id=?').bind(q.request_id).first()).state,'completed');
});
test('case support review reopens actual opinion and retains partial and unavailable evidence',async t=>{
 for(const unavailable of [false,true]){const p=provider({unavailable}),f=await fixture(t,{source:p.source,bindings:{COURTLISTENER_API_TOKEN:'test'},verify:body=>({status:'completed',usage:{input_tokens:600,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({findings:[{finding_id:'F1',verdict:'partial',reason:'The cited text does not support every qualification.',evidence_ids:JSON.parse(body.input).sources[0].segments.slice(0,1).map(e=>e.id)}]})}]}]})});
 const quote=celotex.opinions[0].text.slice(0,160),d=await(await f.req('review',{request_id:crypto.randomUUID(),findings:[{claim:'The Supreme Court approved the trial judgment without remand.',source_id:'S1',quote}],sources:[{id:'S1',cluster_id:111722,opinion_id:celotex.principal_id,text:'Forged client evidence must not override the opinion.',source_url:celotex.source_url}]})).json();
 assert.equal(d.findings[0].verdict,unavailable?'unverified':'partial');if(!unavailable){assert.equal(d.findings[0].quotation,'Exact match');assert.ok(d.findings[0].evidence.every(e=>!e.text.includes('Forged client')));}else assert.equal(f.calls.length,0);
 }
});
test('packet document endpoint checks identity and PDF bytes; caches public file without forwarding credentials',async t=>{
 const p=provider({pdf:true});let downloads=0;
 const f=await fixture(t,{bindings:{COURTLISTENER_API_TOKEN:'test'},source:async request=>{if(request.url==='https://example.gov/opinion.pdf'){downloads++;assert.equal(request.headers.get('Authorization'),null);return new Response('%PDF-1.4\n% Public fixture; byte-preservation test\n%%EOF',{headers:{'Content-Type':'application/pdf'}});}return p.source(request);}});
 const body={cluster_id:111722,opinion_id:celotex.principal_id};const first=await(await f.req('authority-file',body)).json();assert.equal(Buffer.from(first.base64,'base64').toString(),'%PDF-1.4\n% Public fixture; byte-preservation test\n%%EOF');assert.equal(first.kind,'Original publisher PDF');assert.equal((await(await f.req('authority-file',body)).json()).cached,true);assert.equal(downloads,1);assert.equal((await f.req('authority-file',{...body,opinion_id:123})).status,400);
});
test('import rejects malformed projects and strips original attachments',async()=>{
 const {projectData}=await import('../public/projects.js');const original={format:'lex-raptor-project',version:1,name:'Public fixture',notes:'',bookmarks:[],history:[{question:'Public question',sources:[],propositions:[],attachments:['raw bytes'],documents:[{text:'original full attachment'}]}]};
 const saved=projectData(original);assert.equal(saved.history[0].documents,undefined);assert.equal(saved.history[0].attachments,undefined);assert.throws(()=>projectData({...original,history:[{question:'x',sources:[null]}]}),/Invalid saved/);
});
test('court directory retains dated provider metadata when live refresh is rate limited',async()=>{
 const {courts}=await import('../worker/courts.js'),originalNow=Date.now,originalFetch=globalThis.fetch;
 const db={prepare:()=>({bind:()=>({first:async()=>null,run:async()=>({})})})};
 try{Date.now=()=>originalNow()+172800000;globalThis.fetch=async()=>new Response('{}',{status:429});const directory=await courts({DB:db,COURTLISTENER_API_TOKEN:'test'});assert.equal(directory.courts.length,472);assert.equal(directory.metadata_mode,'provider snapshot fallback');assert.match(directory.notice,/temporarily unavailable/);assert.equal(directory.partial,false);}finally{Date.now=originalNow;globalThis.fetch=originalFetch;}
});
