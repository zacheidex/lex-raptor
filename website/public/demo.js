import {conversationContext} from '/conversation.js';
import {extractFiles} from '/documents.js';
const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
let state={enabled:false,search_enabled:false,exhausted:false,databases:[]},busy=false,initialized=false,turnCount=0,readingFiles=false;
const selected=new Set(),history=[],attachments=[];
async function api(path,body){const response=await fetch('/api/demo/'+path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Research is unavailable.');return data;}
async function researchApi(path,body,onProgress){
 const response=await fetch('/api/demo/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(body)});
 if(!response.headers.get('Content-Type')?.includes('text/event-stream')){const data=await response.json();if(!response.ok)throw new Error(data.error||'Research is unavailable.');return data;}
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result;
 try{for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let end;
  while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const event=frame.match(/^event: (.+)$/m)?.[1],raw=frame.match(/^data: (.+)$/m)?.[1];if(!raw)continue;const data=JSON.parse(raw);if(event==='error')throw new Error(data.error||'Research was interrupted.');if(event==='progress')onProgress(data);if(event==='result')result=data;}
  if(done)break;
 }}finally{reader.releaseLock();}
 if(!result)throw new Error('The connection ended before the answer arrived. Your request was not automatically retried.');return result;
}
function render(){
 const hasSources=attachments.length||$('auto-databases').checked||selected.size>0;
 $('attach').disabled=busy||readingFiles;
 $('attachment-scope').hidden=!attachments.length;
 $('attachment-scope').textContent=$('search-with-documents').checked?'Documents + database research':'Document-only analysis · change in Search settings';
 $('file-input').disabled=busy||readingFiles;
 $('ask').disabled=busy||readingFiles||!state.enabled||state.exhausted||!hasSources;
 $('search').disabled=busy||readingFiles||!state.search_enabled||!hasSources;
 $('new-chat').disabled=busy||readingFiles;
 $('check-citations').disabled=busy||!state.databases.some(d=>d.id==='courtlistener'&&d.available);
 document.querySelectorAll('.follow-up-choices button').forEach(b=>b.disabled=busy||readingFiles||!state.enabled||state.exhausted);
 $('ask').textContent=busy?'Working':'Send';
 $('runtime-badge').textContent=state.inference==='local'?'Local · '+state.model:'Cloud AI';
 $('selection-note').textContent=$('auto-databases').checked?'Only relevant databases will be chosen from your message.':state.databases.filter(d=>selected.has(d.id)).map(d=>d.name).join(' · ')||'Select at least one connected database.';
 $('availability').textContent=!state.search_enabled?'Research is temporarily unavailable.':state.exhausted?'The shared $10 AI allowance is used. Source search and citation lookup are still available.':!state.enabled?'AI is unavailable. Source search and citation lookup are still available.':'';
 if(state.inference==='local')$('privacy-note').textContent='AI runs locally. Online searches go to the selected databases. Review sources before relying on an answer.';
 else $('privacy-note').textContent='Use public or hypothetical facts. Messages go to OpenAI; searches go to selected databases.';
 if(attachments.length)$('privacy-note').textContent=state.inference==='local'?'Document analysis runs locally. Enabling database research sends your question to those providers.':'On Send, extracted document text goes to OpenAI. Files stay in this tab; Lex Raptor does not save them.';
 $('manual-databases').disabled=$('auto-databases').checked;
 $('open-options').textContent=$('auto-databases').checked?'Sources · Auto':'Sources · '+selected.size;
}
function renderDatabases(){
 $('database-options').replaceChildren();
 for(const d of state.databases){const label=el('label',null,'source-choice');const input=el('input');input.type='checkbox';input.value=d.id;input.id='database-'+d.id;input.checked=selected.has(d.id);input.disabled=!d.available;input.addEventListener('change',()=>{input.checked?selected.add(d.id):selected.delete(d.id);render();});const info=el('span');info.append(el('strong',d.name),el('small',d.description));label.append(input,info);$('database-options').append(label);}
}
async function refresh(){try{state=await api('status');if(!initialized){initialized=true;selected.clear();for(const d of state.databases)if(d.available&&d.id!=='cap')selected.add(d.id);if(!selected.size&&state.databases.some(d=>d.id==='cap'&&d.available))selected.add('cap');}for(const id of selected)if(!state.databases.some(d=>d.id===id&&d.available))selected.delete(id);renderDatabases();render();}catch(e){state.search_enabled=false;state.enabled=false;render();$('availability').textContent=e.message;}}
$('auto-databases').addEventListener('change',render);
$('search-with-documents').addEventListener('change',render);
$('open-options').addEventListener('click',()=>$('options-dialog').showModal());
$('open-citations').addEventListener('click',()=>{if($('question').value.trim())$('citation-text').value=$('question').value.trim();$('citation-dialog').showModal();$('citation-status').textContent=state.databases.some(d=>d.id==='courtlistener'&&d.available)?'':'CourtListener is not connected.';});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>{$('question').value=b.dataset.question;$('question').focus();}));
$('new-chat').addEventListener('click',()=>{history.length=0;attachments.length=0;renderAttachments();$('attachment-status').textContent='';$('conversation').replaceChildren();document.body.classList.remove('has-conversation');$('question').value='';$('question').focus();});
function requestBody(){return {documents:attachments.map(d=>({...d})),document_mode:$('search-with-documents').checked?'with_sources':'only',question:$('question').value.trim(),search_query:$('search-query').value,task:$('task').value,auto_fields:$('task').value==='auto'||$('auto-databases').checked||!$('search-query').value.trim(),database_ids:$('auto-databases').checked?'auto':[...selected],filters:{court:$('court').value,after:$('after').value,before:$('before').value},context:conversationContext(history),request_id:crypto.randomUUID()};}
function link(text,url){const a=el('a',text);try{const u=new URL(url);if(u.protocol!=='https:')return el('span',text);a.href=u.href;}catch{return el('span',text);}a.target='_blank';a.rel='noopener noreferrer';return a;}
function download(content,name,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function exportText(r){const lines=['Lex Raptor',r.question,'Task: '+r.task,'Search terms: '+r.query,'Retrieved: '+r.retrieved_at,'Model: '+(r.model_used?r.model:'No AI call'),'Review required. Quote matching does not establish legal support or current validity.',...(r.coverage_notes||[]),...(r.unanswered_issues||[]).map(i=>'Unresolved: '+i.question),''];for(const d of r.document_coverage||[])lines.push('DOCUMENT: '+d.name+' — '+d.selected_passages+' excerpt(s) from '+d.extracted_characters+' characters. Not a complete document review.');for(const s of r.searched||[])lines.push(s.id+': '+s.status+' — '+s.note);for(const p of r.propositions||[]){const s=r.sources.find(s=>s.id===p.source_id);lines.push('',p.section,p.claim,p.evidence_method==='web_citation'?'Web citation — page text not independently quote-checked.':'“'+p.quote+'”',s?.citation||'',...(p.source_ids||[p.source_id]).map(id=>r.sources.find(s=>s.id===id)?.source_url||''));}for(const s of r.sources)lines.push('','SOURCE: '+s.name+' · '+s.citation,s.source_status,s.source_url,s.locator,s.text);return lines.join('\n');}
function showResult(container,data,draft,question,id){
 const record={...data,question};if(draft)history.push(record);
 container.replaceChildren();
 if(data.follow_up){
  container.append(el('p',data.follow_up.message,'follow-up-message'));
  const choices=el('div',null,'follow-up-choices');
  for(const text of data.follow_up.suggestions){const button=el('button',text);button.type='button';button.addEventListener('click',()=>{if(busy)return;$('question').value=text;research(true);});choices.append(button);}
  if(choices.childElementCount)container.append(choices);
  container.append(el('p',choices.childElementCount?'Choose a reply or type your own.':'Reply below.','review-note'));
  for(const note of data.coverage_notes||[])container.append(el('p',note,'coverage-note'));
  return;
 }
 const taskName=state.tasks?.[data.task]?.name||'Research';
 const names=(data.databases||[]).map(id=>(id==='documents'?'Attached documents':state.databases.find(d=>d.id===id)?.name||id));
 container.append(el('div',(draft?taskName:'Source search')+' · '+names.join(', ')+(data.automatic?' · Auto settings':''),'plan-summary'));
 for(const note of data.coverage_notes||[])container.append(el('p',note,'coverage-note'));
 if(data.propositions?.length&&data.unanswered_issues?.length)container.append(el('p','Still unresolved: '+data.unanswered_issues.map(i=>i.question).join(' · '),'coverage-note'));
 if(data.document_coverage?.length)container.append(el('p','Analysis uses selected document excerpts. Review the full files for context and omissions.','document-note'));
 let section='';
 for(const p of data.propositions||[]){if(p.section!==section){section=p.section;if(section!=='Findings')container.append(el('h3',section));}container.append(el('p',p.claim));const s=data.sources.find(s=>s.id===p.source_id);if(p.evidence_method==='web_citation'){const citation=el('p',null,'web-citation');for(const sid of p.source_ids||[p.source_id]){const ref=data.sources.find(s=>s.id===sid);if(citation.childNodes.length)citation.append(document.createTextNode(' · '));citation.append(link(ref?.name||'Open source',ref?.source_url));}citation.append(document.createTextNode(' · Web citation'));container.append(citation);}else{const quote=el('details',null,'quote');quote.append(el('summary',s?.name? s.name+(s.citation&&s.citation!==s.name?' · '+s.citation:''):'Source quotation'),el('blockquote',p.quote));const a=el('a','Read source passage');a.href='#source-'+id+'-'+p.source_id;quote.append(a);container.append(quote);}}
 if(draft&&!data.propositions?.length)container.append(el('p',data.no_evidence?'I couldn’t retrieve supporting text for this request. Try more focused search terms or another database.':data.incomplete?'The model did not return a complete draft. You can review the retrieved sources below.':data.removed?'The draft’s source references could not be verified, so those findings were removed. Review the source passages below.':'The retrieved passages did not support an answer to this question. No findings were generated. Review the search details or adjust the scope.'));
 const info=el('details',null,'result-details');info.append(el('summary','Sources & research details · '+data.sources.filter(s=>s.kind!=='web_page').length+' passages'+(data.sources.some(s=>s.kind==='web_page')?' · '+data.sources.filter(s=>s.kind==='web_page').length+' web pages':'')));
 info.append(el('p',data.database_reason||'Searching your selected databases.','small'));
 info.append(el('p','Search: '+data.query,'small'));
 if(data.jurisdiction_note)info.append(el('p',data.jurisdiction_note,'small'));
 if(data.filters)info.append(el('p','Court: '+(data.filters.court||'Any')+' · Dates: '+(data.filters.after||'Any')+' to '+(data.filters.before||'Any'),'small'));
 info.append(el('p','Retrieved '+new Date(data.retrieved_at).toLocaleString()+' · '+(data.model_used?data.model:'No AI call'),'small'));
 for(const r of data.searched||[]){const name=r.id==='documents'?'Attached documents':state.databases.find(d=>d.id===r.id)?.name||r.id;info.append(el('p',name+': '+r.status+' · '+(r.id==='legal_web'?(r.pages||0)+' web pages':r.passages+' passages')+(r.total!==null?' · '+Number(r.total).toLocaleString()+' reported matches':'')+'. '+r.note,r.status==='unavailable'?'source-warning':'small'));for(const step of r.searches||[])info.append(el('p',step.phase+': '+step.query+' · '+(step.mode?step.mode+' · ':'')+step.status+(step.court?' · '+step.court:'')+(step.after?' · after '+step.after:'')+(step.before?' · before '+step.before:''),'small'));for(const w of r.warnings||[])info.append(el('p',w,'source-warning'));}
 for(const d of data.document_coverage||[]){info.append(el('p',d.name+': '+d.selected_passages+' selected passages from '+d.extracted_characters.toLocaleString()+' extracted characters'+(d.type==='PDF'?' across '+d.pages+' pages':'')+'.','small'));for(const w of d.warnings||[])info.append(el('p',w,'source-warning'));}
 for(const s of data.sources){const d=el('details',null,'source-detail');d.id='source-'+id+'-'+s.id;d.append(el('summary',s.name+' · '+s.citation),el('p',(s.database_name||state.databases.find(d=>d.id===s.database_id)?.name||'Source')+' · '+s.court+' · '+s.decision_date),el('p',s.source_status),el('p',s.opinion_type+' · '+s.locator),el('div',s.text,'passage'));if(s.source_url)d.append(link('Open source record',s.source_url));if(s.official_url)d.append(document.createTextNode(' · '),link('Official PDF',s.official_url));info.append(d);}
 container.append(info);
 const notes=[];if(data.removed)notes.push(data.removed+' finding(s) removed because source references could not be verified.');if(data.missing_sections?.length)notes.push('No retained findings for: '+data.missing_sections.join(', ')+'.');if(draft&&data.task==='compare'&&new Set(data.sources.map(s=>s.case_id)).size<2)notes.push('Fewer than two authorities retrieved; comparison is incomplete.');if(notes.length)container.append(el('p',notes.join(' '),'validation-note'));
 if(draft)container.append(el('p',data.research_focus==='case_status'?'This answer uses a limited search for later treatment, not a comprehensive citator check. Review the cited opinions and any jurisdiction-specific law.':'Check the cited sources and legal context. This search does not establish current validity.','review-note'));
 const actions=el('div',null,'export-actions');const txt=el('button','Download text'),json=el('button','Export JSON');txt.type=json.type='button';txt.addEventListener('click',()=>download(exportText(record),'lex-raptor-research.txt','text/plain;charset=utf-8'));json.addEventListener('click',()=>download(JSON.stringify(record,null,2),'lex-raptor-research.json','application/json'));actions.append(txt,json);container.append(actions);
}
async function research(draft){
 if(busy||$(draft?'ask':'search').disabled)return;
 if(!$('research-form').reportValidity()){$('options-dialog').close();$('question').focus();return;}
 if(!['court','after','before','search-query'].every(id=>$(id).reportValidity())){$('options-dialog').showModal();return;}
 const submitted=requestBody();busy=true;render();$('options-dialog').close();document.body.classList.add('has-conversation');
 const id=++turnCount,turn=el('section',null,'turn'),user=el('p',submitted.question,'user-message');
 const answer=el('div',null,'answer'),waiting=el('div',null,'research-progress'),stage=el('p','Starting research','progress-stage'),elapsed=el('span','','progress-elapsed'),activity=el('div',null,'progress-sources');
 const scene=el('div',null,'meteor-scene'),earth=el('img',null,'research-earth'),meteor=el('span',null,'research-meteor'),impact=el('span',null,'research-impact'),debris=el('span',null,'research-debris');
 scene.setAttribute('aria-hidden','true');earth.src='/research-earth.svg';earth.alt='';earth.width=earth.height=18;scene.append(earth,meteor,impact,debris);
 stage.setAttribute('role','status');elapsed.setAttribute('aria-hidden','true');const line=el('div',null,'progress-line');line.append(scene,stage);waiting.append(line,elapsed,activity);answer.append(waiting);answer.setAttribute('aria-busy','true');
 if(submitted.documents.length)user.append(el('span',submitted.documents.map(d=>d.name).join(' · '),'user-attachments'));
 turn.append(user,answer);$('conversation').append(turn);$('question').value='';
 const rect=user.getBoundingClientRect();if(rect.top<0||rect.bottom>innerHeight*.65)user.scrollIntoView({block:'nearest',behavior:'auto'});
 const started=Date.now(),clock=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);elapsed.textContent=seconds+'s'+(seconds>=20?' · Still working. Database responses can take a little longer.':'');},1000),providers=new Map();
 const progress=data=>{stage.textContent=data.message.replace(/[.…]+$/u,'');if(data.database){const name=state.databases.find(d=>d.id===data.database)?.name||data.database;providers.set(data.database,data.stage==='source_complete'?data.message:name+' · Searching and reading');activity.replaceChildren(...[...providers.values()].map(text=>el('div',text)));}};
 try{const data=await researchApi(draft?'research':'search',submitted,progress);showResult(answer,data,draft,submitted.question,id);}catch(e){answer.replaceChildren(el('p',e.message,'error'));const retry=el('button','Edit request');retry.type='button';retry.addEventListener('click',()=>{$('question').value=submitted.question;$('question').focus();});answer.append(retry);}finally{clearInterval(clock);answer.removeAttribute('aria-busy');busy=false;await refresh();}

}
$('research-form').addEventListener('submit',e=>{e.preventDefault();research(true);});
$('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();research(true);}});
$('search').addEventListener('click',()=>research(false));
$('citation-form').addEventListener('submit',async e=>{e.preventDefault();if(busy||$('check-citations').disabled)return;busy=true;render();$('citation-status').textContent='Looking up citations…';$('citation-results').replaceChildren();try{const data=await api('citations',{text:$('citation-text').value});for(const r of data.citations){const item=el('div',null,'citation-result');item.append(el('strong',r.citation),el('p',({200:'Matching record found',300:'Ambiguous: multiple records',404:'No matching record found',400:'Unrecognized citation',429:'Not checked: source limit reached'})[r.status]||'Not checked'));for(const m of r.matches)if(m.url)item.append(link(m.name,m.url));$('citation-results').append(item);}$('citation-status').textContent=(data.citations.length?'':'No case citations were identified. ')+data.limitation;}catch(e){$('citation-status').textContent=e.message;}finally{busy=false;render();}});
document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#source-"]');if(a){const target=document.getElementById(a.hash.slice(1));if(target){target.open=true;let parent=target.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}}}});
function renderAttachments(){
 $('attachment-list').replaceChildren();
 for(let i=0;i<attachments.length;i++){const doc=attachments[i],chip=el('div',null,'attachment-chip');chip.append(el('span',doc.name));const remove=el('button','Remove');remove.type='button';remove.setAttribute('aria-label','Remove '+doc.name);remove.disabled=busy;remove.addEventListener('click',()=>{attachments.splice(i,1);renderAttachments();});chip.append(remove);$('attachment-list').append(chip);}render();
}
async function addFiles(files){
 if(busy||readingFiles||!files.length)return;readingFiles=true;render();$('attachment-status').textContent='Reading document text on your device…';
 try{const docs=await extractFiles([...files],attachments);attachments.push(...docs);renderAttachments();$('attachment-status').textContent=docs.flatMap(d=>d.warnings).join(' ')||'Ready · PDF, DOCX, TXT or Markdown · 5 MB per file';}catch(e){$('attachment-status').textContent=e.message||'The document could not be read.';}finally{readingFiles=false;$('file-input').value='';render();}
}
$('attach').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',e=>addFiles(e.target.files));
const composer=$('research-form');
composer.addEventListener('dragover',e=>{e.preventDefault();composer.classList.add('drag-over');});
composer.addEventListener('dragleave',()=>composer.classList.remove('drag-over'));
composer.addEventListener('drop',e=>{e.preventDefault();composer.classList.remove('drag-over');addFiles(e.dataTransfer.files);});
refresh();
