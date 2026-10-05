import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {legalUrl} from '../worker/web.js';

export async function createLocalRuntime(){
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=resolve(root,'dist/client');
await mkdir(resolve(root,'.local-data'),{recursive:true,mode:0o700});
// Load only the optional public-data credential. Local inference never loads
// or forwards an OpenAI key, including if .env.local contains one.
let token=process.env.COURTLISTENER_API_TOKEN||'';
if(!token){try{const env=await readFile(resolve(root,'.env.local'),'utf8');token=env.match(/^COURTLISTENER_API_TOKEN\s*=\s*["']?([^\s"']+)/m)?.[1]||'';}catch{}}
const mf=new Miniflare({modules:true,scriptPath:resolve(root,'dist/server/index.js'),compatibilityDate:'2025-09-01',
  d1Databases:['DB'],d1Persist:resolve(root,'.local-data/d1'),
  bindings:{LOCAL_RESEARCH:'true',OLLAMA_MODEL:process.env.OLLAMA_MODEL||'qwen3:14b',DEMO_SESSION_SECRET:randomBytes(32).toString('hex'),...(token?{COURTLISTENER_API_TOKEN:token}:{})},
  serviceBindings:{ASSETS:async request=>{
    let path;try{path=resolve(publicDir,'.'+decodeURIComponent(new URL(request.url).pathname));}catch{return new Response('Not found',{status:404});}
    if(!path.startsWith(publicDir+'/'))return new Response('Not found',{status:404});
    try{return new Response(await readFile(path),{headers:{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.gz':'application/gzip'})[extname(path)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
  }},
  outboundService:async request=>{
    const u=new URL(request.url);
    const local=u.origin==='http://127.0.0.1:11434'&&u.pathname==='/api/chat';
    if(!local&&!legalUrl(request.url)&&!(u.protocol==='https:'&&['www.courtlistener.com','www.ecfr.gov','www.federalregister.gov'].includes(u.hostname)))return new Response('Outbound destination not allowed',{status:403});
    const response=await fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(request.method==='POST'?{body:await request.arrayBuffer()}:{}),redirect:'manual',signal:AbortSignal.timeout(local?180000:50000)});
    const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
    return new Response(response.body,{status:response.status,headers});
  }
});
const db=await mf.getD1Database('DB');
await db.prepare('CREATE TABLE IF NOT EXISTS local_workbench_migrations(name TEXT PRIMARY KEY)').run();
for(const name of (await readdir(resolve(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort()){
  if(await db.prepare('SELECT name FROM local_workbench_migrations WHERE name=?').bind(name).first())continue;
  const sql=await readFile(resolve(root,'drizzle',name),'utf8');
  const statements=sql.split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s));
  await db.batch([...statements,db.prepare('INSERT INTO local_workbench_migrations(name) VALUES(?)').bind(name)]);
}
return {mf,db,courtlistener:!!token};
}
