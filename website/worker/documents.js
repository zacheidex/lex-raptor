import {SourceError} from './sources.js';
const encoder=new TextEncoder();
export function validateDocuments(input){
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>5)throw new SourceError('Attach up to five documents.');
 let bytes=0;
 return input.map((doc,i)=>{
  if(!doc||typeof doc.name!=='string'||!doc.name.trim()||doc.name.length>160||/[\\/\u0000-\u001f]/.test(doc.name)||!['PDF','DOCX','text'].includes(doc.type)||!Array.isArray(doc.pages)||!doc.pages.length||doc.pages.length>200)throw new SourceError('Invalid document metadata.');
  const pages=doc.pages.map((p,j)=>{
   if(!p||p.number!==j+1||typeof p.text!=='string')throw new SourceError('Invalid document text or page order.');
   bytes+=encoder.encode(p.text).length;if(bytes>300000)throw new SourceError('Combined document text exceeds 300 KB. Split the documents.');
   return {number:p.number,text:p.text.replace(/\s+/g,' ').trim(),label:doc.type==='DOCX'?(['Document body','footnotes','endnotes'].includes(p.label)?p.label:'Extracted text'):undefined};
  });
  if(!pages.some(p=>p.text))throw new SourceError('An attachment contains no readable text.');
  return {id:'attachment-'+(i+1),name:doc.name,type:doc.type,pages,warnings:doc.type==='DOCX'?['Extracted DOCX text has no original pagination or formatting.']:pages.some(p=>!p.text)?['Some PDF pages have no extractable text; OCR is not included.']:[]};
 });
}
export function documentPassages(documents,query){
 const terms=[...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g)||[])].filter(t=>!['the','and','for','this','that','document','attached','summarize','what','are','with','from'].includes(t));
 const groups=documents.map(doc=>{
  const passages=[];
  for(const p of doc.pages)for(let at=0;at<p.text.length;at+=1400){const text=p.text.slice(at,at+1600);if(!text.trim())continue;const words=new Set(text.toLowerCase().match(/[a-z0-9]+/g)||[]);const score=terms.reduce((n,t)=>n+(words.has(t)?1:0),0);const location=doc.type==='PDF'?'Page '+p.number:doc.type==='DOCX'?p.label:'Document text';passages.push({score,id:doc.id+'-'+p.number+'-'+at,case_id:doc.id,name:doc.name,citation:doc.name+' · '+location,court:'User-provided document',decision_date:'Not independently established',opinion_type:doc.type,source_url:'',database_id:'documents',database_name:'Attached documents',kind:'attachment',source_status:'User-provided text; not verified legal authority. Only selected excerpts are analyzed.',text,locator:location+', normalized characters '+(at+1)+'–'+(at+text.length),page:p.number});}
  return passages.sort((a,b)=>b.score-a.score).slice(0,6);
 });
 const result=[];for(let i=0;i<6;i++)for(const group of groups)if(group[i]){const {score,...p}=group[i];result.push(p);}return result;
}
export function documentCoverage(documents,sources){return documents.map(doc=>{const selected=sources.filter(s=>s.case_id===doc.id);return {name:doc.name,type:doc.type,pages:doc.pages.length,extracted_characters:doc.pages.reduce((n,p)=>n+p.text.length,0),selected_passages:selected.length,selected_characters:selected.reduce((n,s)=>n+s.text.length,0),warnings:doc.warnings};});}
