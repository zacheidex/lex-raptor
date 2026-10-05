import {jwtVerify,createRemoteJWKSet} from 'jose';
import {local} from './model.js';
const keySets=new Map();
export function accessMode(env){return !local(env)&&env.ACCESS_MODE==='invite'?'invite':'public';}
export async function authorize(request,env){
 if(accessMode(env)==='public')return {authorized:true};
 const team=env.ACCESS_TEAM_DOMAIN,aud=env.ACCESS_AUD;
 if(typeof team!=='string'||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)||!aud)return {authorized:false,configured:false};
 const token=request.headers.get('Cf-Access-Jwt-Assertion')||request.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!token)return {authorized:false,configured:true,login_url:team+'/cdn-cgi/access/login/'+new URL(request.url).hostname};
 try{
  if(!keySets.has(team))keySets.set(team,createRemoteJWKSet(new URL(team+'/cdn-cgi/access/certs')));
  const {payload}=await jwtVerify(token,keySets.get(team),{issuer:team,audience:aud,algorithms:['RS256'],requiredClaims:['sub','exp','iat']});
  if(typeof payload.sub!=='string')return {authorized:false,configured:true};
  return {authorized:true,subject:payload.sub};
 }catch{return {authorized:false,configured:true};}
}
