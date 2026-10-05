const DB_NAME='lex-raptor-projects',VERSION=1;
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,VERSION);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Browser storage is unavailable. Export the project as JSON instead.'));});}
async function transaction(mode,run){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('projects',mode),request=run(tx.objectStore('projects'));let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('Project storage failed. Export your work before closing this tab.'));});}finally{db.close();}}
export function projectData(value){
 if(!value||value.format!=='lex-raptor-project'||value.version!==1||typeof value.name!=='string'||!value.name.trim()||value.name.length>120||!Array.isArray(value.history)||value.history.length>100||!Array.isArray(value.bookmarks)||value.bookmarks.length>100||typeof value.notes!=='string'||value.notes.length>100000)throw new Error('This is not a supported Lex Raptor project.');
 for(const r of value.history){if(!r||typeof r.question!=='string'||r.question.length>64000||!Array.isArray(r.sources)||!Array.isArray(r.propositions||[]))throw new Error('A saved research record is invalid.');}
 for(const r of value.history){
  for(const key of ['sources','propositions','searched','authorities','missing_sections','coverage_notes'])if(r[key]!==undefined&&!Array.isArray(r[key]))throw new Error('Invalid saved '+key+'.');
  if((r.sources||[]).some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string'||s.text!==undefined&&typeof s.text!=='string')||(r.propositions||[]).some(p=>!p||typeof p.claim!=='string'||typeof p.source_id!=='string'||p.source_ids!==undefined&&!Array.isArray(p.source_ids)))throw new Error('Invalid saved findings or sources.');
 }
 if(value.scope&&(!['any','state','federal',undefined].includes(value.scope.level)||value.scope.court_ids!==undefined&&!Array.isArray(value.scope.court_ids)))throw new Error('Invalid saved scope.');
 if(value.collection&&(!Array.isArray(value.collection.items)||value.collection.items.length>100||value.collection.items.some(i=>!i||!Array.isArray(i.occurrences)||!Array.isArray(i.original_citations)||typeof i.status!=='string')))throw new Error('Invalid saved collection.');
 if(value.bookmarks.some(b=>!b||typeof b.key!=='string'))throw new Error('Invalid saved bookmarks.');
 // Explicitly omit original attachments and transient browser/server jobs.
 const history=value.history.map(({documents,attachments,request_id,...record})=>record);
 const data={format:value.format,version:1,id:typeof value.id==='string'&&/^[a-f0-9-]{36}$/.test(value.id)?value.id:crypto.randomUUID(),name:value.name.trim(),history,scope:value.scope||{},source_settings:value.source_settings||{},bookmarks:value.bookmarks,notes:value.notes,collection:value.collection||null,updated_at:new Date().toISOString()};
 if(new TextEncoder().encode(JSON.stringify(data)).length>10000000)throw new Error('Project exceeds 10 MB. Export a smaller collection.');return data;
}
export async function saveProject(value){const data=projectData(value);await transaction('readwrite',store=>store.put(data));return data;}
export const listProjects=()=>transaction('readonly',store=>store.getAll());
export const getProject=id=>transaction('readonly',store=>store.get(id));
export const deleteProject=id=>transaction('readwrite',store=>store.delete(id));
export async function importProject(file){if(file.size>10000000)throw new Error('Project file exceeds 10 MB.');const p=projectData(JSON.parse(await file.text()));p.id=crypto.randomUUID();return saveProject(p);}
