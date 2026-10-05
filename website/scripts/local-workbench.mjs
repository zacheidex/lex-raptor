import {createServer} from 'node:http';
import {createLocalRuntime} from './local-runtime.mjs';
const port=Number(process.env.LEX_RAPTOR_PORT||8787);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
const {mf,courtlistener}=await createLocalRuntime();
const server=createServer(async(req,res)=>{
  try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403);res.end('Use the loopback address.');return;}
    let size=0;const parts=[];
    for await(const part of req){size+=part.length;if(size>700000){res.writeHead(413);res.end('Request too large');return;}parts.push(part);}
    const path=req.url==='/'?'/demo':req.url;
    const result=await mf.dispatchFetch('http://'+req.headers.host+path,{method:req.method,headers:{...req.headers,'CF-Connecting-IP':'127.0.0.1'},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(parts)})});
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch{res.writeHead(503,{'Content-Type':'text/plain'});res.end('The local workbench could not complete this request.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Lex Raptor local research: http://127.0.0.1:${port}/demo\nModel: ${process.env.OLLAMA_MODEL||'qwen3:14b'} via local Ollama. No OpenAI calls. CourtListener ${courtlistener?'connected':'not configured'}.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();mf.dispose().finally(()=>process.exit(0));});
