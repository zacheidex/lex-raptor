export class Cancelled extends Error {constructor(){super('Cancelled. Calls already sent to a provider may still finish and incur charges.');this.status=499;}}
export function requestContext(){return {active:0,queue:[],metrics:{provider_requests:{},cache_hits:0,model_requests:0,started:Date.now()},cancelled:false};}
export async function checkpoint(env){
 const c=env.REQUEST;if(!c)return;
 if(c.cancelled)throw new Cancelled();
 if(c.job){const row=await env.DB.prepare('SELECT state FROM research_jobs WHERE id=?').bind(c.job).first();if(row?.state==='cancelled'){c.cancelled=true;throw new Cancelled();}}
}
export async function limited(env,provider,fn){
 const c=env.REQUEST;if(!c)return fn();
 if(c.active>=3)await new Promise(resolve=>c.queue.push(resolve));c.active++;
 try{await checkpoint(env);c.metrics.provider_requests[provider]=(c.metrics.provider_requests[provider]||0)+1;return await fn();}
 finally{c.active--;c.queue.shift()?.();}
}
export function metrics(env){const m=env.REQUEST?.metrics;return m?{...m,started:undefined,elapsed_ms:Date.now()-m.started}:undefined;}
export async function beginJob(env,id,visitor,ai){
 const now=Math.floor(Date.now()/1000),rate=Math.max(1,Math.min(1000,Number(env.REQUESTS_PER_HOUR)||120)),aiRate=Math.max(1,Math.min(100,Number(env.AI_REQUESTS_PER_HOUR)||20));
 await env.DB.prepare('DELETE FROM research_jobs WHERE created<?').bind(now-172800).run();
 const row=await env.DB.prepare(`INSERT INTO research_jobs(id,visitor,created,state,ai) SELECT ?,?,?,'active',?
 WHERE (SELECT COUNT(*) FROM research_jobs WHERE visitor=? AND created>?)<?
 AND (SELECT COUNT(*) FROM research_jobs WHERE visitor=? AND created>? AND state='active')<3
 AND (?=0 OR (SELECT COUNT(*) FROM research_jobs WHERE visitor=? AND created>? AND ai=1)<?)
 ON CONFLICT(id) DO NOTHING RETURNING id`).bind(id,visitor,now,ai?1:0,visitor,now-3600,rate,visitor,now-600,ai?1:0,visitor,now-3600,aiRate).first();
 if(row)env.REQUEST.job=id;return !!row;
}
