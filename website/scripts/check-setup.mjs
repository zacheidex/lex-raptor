import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),checks=[];
const add=(name,ok,detail,required=true)=>checks.push({name,ok,detail,required});
const [major,minor]=process.versions.node.split('.').map(Number);
add('Node',major>20||major===20&&minor>=20,process.version+'; Node 20.20+ required');
let configured=!!process.env.COURTLISTENER_API_TOKEN;
try{const text=await readFile(resolve(root,'.env.local'),'utf8');configured ||= /^COURTLISTENER_API_TOKEN\s*=\s*["']?\S/m.test(text);}catch{}
add('CourtListener',configured,configured?'Credential present (value not printed; access not tested).':'Optional: set COURTLISTENER_API_TOKEN for nationwide cases. The 12-case starter library works without it.',false);
const model=process.env.OLLAMA_MODEL||'qwen3:14b';
try{const r=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(4000)});if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.json();const found=data.models?.some(m=>m.name===model||m.model===model);add('Ollama',true,'Local service responds at 127.0.0.1:11434.');add('Model',found,found?model+' is installed; inference/hardware performance has not been tested.':'Install the configured model with: ollama pull '+model+' (or set OLLAMA_MODEL to an installed model).');}catch{add('Ollama',false,'Start Ollama locally (ollama serve), then run this check again.');}
try{await readFile(resolve(root,'dist/server/index.js'));add('Build',true,'Worker build exists. Rebuild after source changes.');}catch{add('Build',false,'Run npm ci, then npm run build.');}
const result={mode:'local',paid_api_calls:0,checks,ready:checks.every(c=>c.ok||!c.required)};
console.log(process.argv.includes('--json')?JSON.stringify(result,null,2):checks.map(c=>(c.ok?'OK':c.required?'ACTION':'OPTIONAL')+' · '+c.name+' · '+c.detail).join('\n'));
if(!result.ready)process.exitCode=1;
