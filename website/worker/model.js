import {MODEL,MAX_OUTPUT} from './budget.js';
export const local=env=>env.LOCAL_RESEARCH==='true';
export const modelName=env=>local(env)?(env.OLLAMA_MODEL||'qwen3:14b'):MODEL;
export const modelReady=env=>local(env)||(env.DEMO_ENABLED==='true'&&!!env.OPENAI_API_KEY&&Number(env.DEMO_EXPIRES_AT)>Date.now()/1000);
export async function generate(env,input) {
  if(local(env)){
    // The portable launcher binds to loopback. Hosted deployments never set
    // LOCAL_RESEARCH; neither model nor endpoint can be selected by a visitor.
    const body=JSON.parse(input);
    const result=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:modelName(env),stream:false,think:false,format:body.text.format.schema,messages:[{role:'system',content:body.instructions},{role:'user',content:body.input}],options:{temperature:0,num_predict:Math.min(body.max_output_tokens||MAX_OUTPUT,MAX_OUTPUT),num_ctx:16384}}),signal:AbortSignal.timeout(180000)});
    if(!result.ok)return {ok:false,status:result.status,error:{code:'local_model_unavailable'}};
    const data=await result.json();
    return {ok:true,data:{status:data.done_reason==='length'?'incomplete':'completed',output:[{type:'message',content:[{type:'output_text',text:data.message?.content||''}]}],usage:{input_tokens:data.prompt_eval_count||0,output_tokens:data.eval_count||0}}};
  }
  const result=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.OPENAI_API_KEY},body:input,redirect:'manual',signal:AbortSignal.timeout(150000)});
  if(!result.ok){const data=await result.json().catch(()=>({}));return {ok:false,status:result.status,error:data.error||{}};}
  return {ok:true,data:await result.json()};
}
