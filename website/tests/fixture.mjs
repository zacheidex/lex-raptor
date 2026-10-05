import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
export async function fixture(t,options={}) {
  const calls=[];
  const bindings={DEMO_ENABLED:'true',OPENAI_API_KEY:'fake-test-key',DEMO_SESSION_SECRET:'test-session-secret-not-for-production',DEMO_EXPIRES_AT:String(Math.floor(Date.now()/1000)+86400),...options.bindings};
  const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2025-09-01',d1Databases:['DB'],
    bindings,
    serviceBindings:{ASSETS:async request=>new Response(await readFile('public'+(new URL(request.url).pathname==='/'?'/index.html':new URL(request.url).pathname)))},
    outboundService:async request=>{
      if(options.source){const response=await options.source(request);if(response)return response;}
      if(options.local&&request.url==='http://127.0.0.1:11434/api/chat'){
        const body=await request.json();calls.push(body);if(body.format.properties.search_query)return Response.json({done:true,done_reason:'stop',prompt_eval_count:500,eval_count:100,message:{content:JSON.stringify(options.plan||{task:'brief',search_query:'Celotex',database_ids:['cap'],filters:{court:'',after:'',before:''}})}});if(options.verify&&body.format.properties.findings)return Response.json({done:true,done_reason:'stop',prompt_eval_count:500,eval_count:100,message:{content:JSON.stringify({findings:[]})}});const {sources}=JSON.parse(body.messages[1].content);
        return Response.json({done:true,done_reason:'stop',prompt_eval_count:1000,eval_count:200,message:{content:JSON.stringify({propositions:[{section:body.format.properties.propositions.items.properties.section.enum[0],claim:'Local fixture finding.',source_id:sources[0].id,quote_id:sources[0].text.match(/\[(S\d+Q\d+)\]/)[1],web_source_url:''}]})}});
      }
      assert.equal(request.url,'https://api.openai.com/v1/responses');
      const body=await request.json();calls.push(body);
      if(options.verify&&['citation_page_reader','citation_support_review'].includes(body.text.format.name))return Response.json(await options.verify(body));
      if(options.beforeDraft&&body.text.format.name==='legal_research')await options.beforeDraft();
      if(options.fail||(options.failDraft&&body.text.format.name==='legal_research'))return new Response('{}',{status:500});
      if(body.text.format.name==='research_plan')return Response.json({status:'completed',usage:{input_tokens:500,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(options.plan||{task:'brief',search_query:'Celotex',database_ids:['cap'],filters:{court:'',after:'',before:''}})}]}]});
      if(options.webResponse&&body.tools)return Response.json(options.webResponse);
      if(options.draft)return Response.json(await options.draft(body));
      if(options.draftResponse)return Response.json(options.draftResponse);
      const {sources}=JSON.parse(body.input),s=sources[0];
      return Response.json({status:'completed',usage:{input_tokens:1000,output_tokens:200},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({propositions:[{claim:'A fixture claim to verify citation handling.',source_id:s.id,quote_id:s.text.match(/\[(S\d+Q\d+)\]/)[1],web_source_url:''},{claim:'Invented authority must be removed.',source_id:'invented',quote:'This quotation is not a real supplied source.'}]})}]}]});
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
