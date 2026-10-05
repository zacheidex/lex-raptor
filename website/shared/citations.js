// Conservative deterministic candidate extraction. CourtListener's Eyecite
// endpoint performs authoritative reporter normalization and identity matching.
// Unrecognized/short-form candidates remain visible; no model guesses identity.
const reporter=String.raw`(?:U\.?\s*S\.?|S\.?\s*Ct\.?|L\.?\s*Ed\.?(?:\s*2d)?|F\.?\s*(?:Supp\.?(?:\s*(?:2d|3d))?|App(?:['’]x|x)\.?|2d|3d|4th)?|(?:A|P|N\.?\s*E|N\.?\s*W|S\.?\s*E|S\.?\s*W|So)\.?(?:\s*(?:2d|3d))?|(?:Cal|N\.?\s*Y|Ga|Mass|Va|Ohio|Ill|Tex|Fla|Pa|Mich|Haw)\.(?:\s*(?:App|Ct|Super|St|2d|3d|4th|5th)\.?)*|[A-Z][A-Za-z.]{0,22}(?:\s+(?:App|Supp|Ct|Super|2d|3d|4th|5th)\.?)*)`;
export function citationOccurrences(text,location={document:'Pasted text',page:null}){
 const re=new RegExp(String.raw`\b\d{1,4}\s+${reporter}\s+\d{1,6}\b`,'g'),out=[];
 for(const m of text.matchAll(re))out.push({...location,text:m[0],start:m.index,end:m.index+m[0].length,uncertain:false});
 // Preserve malformed and short references as review items, rather than
 // presenting a successful empty collection. They cannot auto-resolve.
 for(const m of text.matchAll(/\b(?:\d{1,4}\s+(?:U\.?\s*S\.?|F\.?\s*(?:2d|3d|4th))\s+[_—–-]+|(?:Id\.|Ibid\.|supra)\s*(?:at\s+\d+)?)/gi))if(!out.some(o=>m.index>=o.start&&m.index<o.end))out.push({...location,text:m[0].trim(),start:m.index,end:m.index+m[0].length,uncertain:true});
 return out.sort((a,b)=>a.start-b.start);
}
export const citationKey=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
export function exactIntent(body){
 const q=(body.question||body.text||'').trim(),citations=citationOccurrences(q).filter(o=>!o.uncertain);
 const name=q.replace(/^(?:please\s+)?(?:brief(?: the case(?: of)?)?|summarize(?: the case(?: of)?)?|case brief(?: of)?|tell me about|what (?:was|is) the holding (?:in|of))[:\s]+/i,'').replace(/,?\s*\d{1,4}\s+(?:U\.?\s*S\.?|F\.).*$/i,'').replace(/[?.]$/,'');
 const explicitNameRequest=name!==q.replace(/[?.]$/,'');
 const named=(explicitNameRequest||!/^(?:what|what['’]s|whats|is|are|does|do|how|why|when|where|can|compare|explain|has|was|were|could|should|would|did|will)\b/i.test(q))&&/\b(?:v\.?|vs\.?|versus)\s+\p{L}/iu.test(name)&&name.length<220;
 const simple=!/\b(compare|apply|application|regulation|statute|later treatment|good law|current status|overruled|overturned|insurance|under state|relat(?:es|e) to)\b/i.test(q);
 return citations.length||named||body.case_context?{citations,name:named?name:'',simple,context:body.case_context||null}:null;
}
