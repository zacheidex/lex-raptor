import {createServer} from 'node:http';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Miniflare} from 'miniflare';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.LEX_RAPTOR_PORT||8787);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
const publicDir=resolve(root,'public');
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
    try{return new Response(await readFile(path),{headers:{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.gz':'application/gzip'})[extname(path)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
  }},
  outboundService:async request=>{
    const u=new URL(request.url);
    const local=u.origin==='http://127.0.0.1:11434'&&u.pathname==='/api/chat';
    if(!local&&!(u.protocol==='https:'&&['www.courtlistener.com','www.ecfr.gov','www.federalregister.gov'].includes(u.hostname)))return new Response('Outbound destination not allowed',{status:403});
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
const server=createServer(async(req,res)=>{
  try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403);res.end('Use the loopback address.');return;}
    let size=0;const parts=[];
    for await(const part of req){size+=part.length;if(size>10000){res.writeHead(413);res.end('Request too large');return;}parts.push(part);}
    const path=req.url==='/'?'/demo':req.url;
    const result=await mf.dispatchFetch('http://'+req.headers.host+path,{method:req.method,headers:{...req.headers,'CF-Connecting-IP':'127.0.0.1'},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(parts)})});
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch{res.writeHead(503,{'Content-Type':'text/plain'});res.end('The local workbench could not complete this request.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Lex Raptor local research: http://127.0.0.1:${port}/demo\nModel: ${process.env.OLLAMA_MODEL||'qwen3:14b'} via local Ollama. No OpenAI calls. CourtListener ${token?'connected':'not configured'}.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();mf.dispose().finally(()=>process.exit(0));});
