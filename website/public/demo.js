const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
let state={enabled:false,search_enabled:false,exhausted:false,databases:[]},busy=false,initialized=false,turnCount=0;
const selected=new Set(['cap']),history=[];
async function api(path,body){const response=await fetch('/api/demo/'+path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Research is unavailable.');return data;}
function render(){
 const hasSources=$('auto-databases').checked||selected.size>0;
 $('ask').disabled=busy||!state.enabled||state.exhausted||!hasSources;
 $('search').disabled=busy||!state.search_enabled||!hasSources;
 $('new-chat').disabled=busy;
 $('check-citations').disabled=busy||!state.databases.some(d=>d.id==='courtlistener'&&d.available);
 $('ask').textContent=busy?'Working…':'Send';
 $('runtime-badge').textContent=state.inference==='local'?'Local · '+state.model:'Cloud AI';
 $('selection-note').textContent=$('auto-databases').checked?'Databases chosen from your message.':state.databases.filter(d=>selected.has(d.id)).map(d=>d.name).join(' · ')||'Select at least one connected database.';
 $('availability').textContent=!state.search_enabled?'Research is temporarily unavailable.':state.exhausted?'The shared $10 AI allowance is used. Source search and citation lookup are still available.':!state.enabled?'AI is unavailable. Source search and citation lookup are still available.':busy?'Searching and reading sources…':'';
 if(state.inference==='local')$('privacy-note').textContent='AI runs locally. Online searches go to the selected databases. Review sources before relying on an answer.';
 else $('privacy-note').textContent='Use public or hypothetical facts. Messages go to OpenAI; searches go to selected databases.';
 $('manual-databases').disabled=$('auto-databases').checked;
}
function renderDatabases(){
 $('database-options').replaceChildren();
 for(const d of state.databases){const label=el('label',null,'source-choice');const input=el('input');input.type='checkbox';input.value=d.id;input.id='database-'+d.id;input.checked=selected.has(d.id);input.disabled=!d.available;input.addEventListener('change',()=>{input.checked?selected.add(d.id):selected.delete(d.id);render();});const info=el('span');info.append(el('strong',d.name),el('small',d.description));label.append(input,info);$('database-options').append(label);}
}
async function refresh(){try{state=await api('status');if(!initialized){initialized=true;if(state.databases.some(d=>d.id==='courtlistener'&&d.available)){selected.clear();selected.add('courtlistener');}}for(const id of selected)if(!state.databases.some(d=>d.id===id&&d.available))selected.delete(id);renderDatabases();render();}catch(e){state.search_enabled=false;state.enabled=false;render();$('availability').textContent=e.message;}}
$('auto-databases').addEventListener('change',render);
$('open-options').addEventListener('click',()=>$('options-dialog').showModal());
$('open-citations').addEventListener('click',()=>{$('citation-dialog').showModal();$('citation-status').textContent=state.databases.some(d=>d.id==='courtlistener'&&d.available)?'':'CourtListener is not connected.';});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>{$('question').value=b.dataset.question;$('question').focus();}));
$('new-chat').addEventListener('click',()=>{history.length=0;$('conversation').replaceChildren();document.body.classList.remove('has-conversation');$('question').value='';$('question').focus();});
function requestBody(){return {question:$('question').value.trim(),search_query:$('search-query').value,task:$('task').value,auto_fields:$('task').value==='auto'||$('auto-databases').checked||!$('search-query').value.trim(),database_ids:$('auto-databases').checked?'auto':[...selected],filters:{court:$('court').value,after:$('after').value,before:$('before').value},context:history.slice(-3).map(r=>'User: '+r.question+'\nTask: '+r.task+'\nPrevious draft (unverified): '+(r.propositions||[]).map(p=>p.claim).join(' ').slice(0,650)).join('\n\n').slice(-3500),request_id:crypto.randomUUID()};}
function link(text,url){const a=el('a',text);try{const u=new URL(url);if(u.protocol!=='https:')return el('span',text);a.href=u.href;}catch{return el('span',text);}a.target='_blank';a.rel='noopener noreferrer';return a;}
function download(content,name,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function exportText(r){const lines=['Lex Raptor',r.question,'Task: '+r.task,'Search terms: '+r.query,'Retrieved: '+r.retrieved_at,'Model: '+(r.model_used?r.model:'No AI call'),'Review required. Quote matching does not establish legal support or current validity.',''];for(const s of r.searched||[])lines.push(s.id+': '+s.status+' — '+s.note);for(const p of r.propositions||[]){const s=r.sources.find(s=>s.id===p.source_id);lines.push('',p.section,p.claim,'“'+p.quote+'”',s?.citation||'',s?.source_url||'');}for(const s of r.sources)lines.push('','SOURCE: '+s.name+' · '+s.citation,s.source_status,s.source_url,s.locator,s.text);return lines.join('\n');}
function showResult(container,data,draft,question,id){
 const record={...data,question};if(draft)history.push(record);
 container.replaceChildren();
 const taskName=state.tasks?.[data.task]?.name||'Research';
 const names=(data.databases||[]).map(id=>state.databases.find(d=>d.id===id)?.name||id);
 container.append(el('div',(draft?taskName:'Source search')+' · '+names.join(', ')+(data.automatic?' · Auto settings':''),'plan-summary'));
 let section='';
 for(const p of data.propositions||[]){if(p.section!==section){section=p.section;if(section!=='Findings')container.append(el('h3',section));}container.append(el('p',p.claim));const s=data.sources.find(s=>s.id===p.source_id);const quote=el('details',null,'quote');quote.append(el('summary',s?.citation||s?.name||'Source quotation'),el('blockquote',p.quote));const a=el('a','Read source passage');a.href='#source-'+id+'-'+p.source_id;quote.append(a);container.append(quote);}
 if(draft&&!data.propositions?.length)container.append(el('p',data.no_evidence?'I couldn’t retrieve supporting text for this request. Try more focused search terms or another database.':data.incomplete?'The model did not return a complete draft. You can review the retrieved sources below.':'No findings passed the quotation check. Review the sources below or refine your question.'));
 const info=el('details',null,'result-details');info.append(el('summary','Sources & research details · '+data.sources.length+' passages'));
 info.append(el('p','Search: '+data.query,'small'));
 if(data.filters)info.append(el('p','Court: '+(data.filters.court||'Any')+' · Dates: '+(data.filters.after||'Any')+' to '+(data.filters.before||'Any'),'small'));
 info.append(el('p','Retrieved '+new Date(data.retrieved_at).toLocaleString()+' · '+(data.model_used?data.model:'No AI call'),'small'));
 for(const r of data.searched||[]){const name=state.databases.find(d=>d.id===r.id)?.name||r.id;info.append(el('p',name+': '+r.status+' · '+r.passages+' passages'+(r.total!==null?' · '+Number(r.total).toLocaleString()+' reported matches':'')+'. '+r.note,r.status==='unavailable'?'source-warning':'small'));for(const w of r.warnings||[])info.append(el('p',w,'source-warning'));}
 for(const s of data.sources){const d=el('details',null,'source-detail');d.id='source-'+id+'-'+s.id;d.append(el('summary',s.name+' · '+s.citation),el('p',s.database_name+' · '+s.court+' · '+s.decision_date),el('p',s.source_status),el('p',s.opinion_type+' · '+s.locator),el('div',s.text,'passage'));if(s.source_url)d.append(link('Open source record',s.source_url));if(s.official_url)d.append(document.createTextNode(' · '),link('Official PDF',s.official_url));info.append(d);}
 container.append(info);
 const notes=[];if(data.removed)notes.push(data.removed+' finding(s) removed because quotations could not be verified.');if(data.missing_sections?.length)notes.push('No retained findings for: '+data.missing_sections.join(', ')+'.');if(draft&&data.task==='compare'&&new Set(data.sources.map(s=>s.case_id)).size<2)notes.push('Fewer than two authorities retrieved; comparison is incomplete.');if(notes.length)container.append(el('p',notes.join(' '),'validation-note'));
 if(draft)container.append(el('p','Check the cited sources and legal context. Later treatment and current validity have not been verified.','review-note'));
 const actions=el('div',null,'export-actions');const txt=el('button','Download text'),json=el('button','Export JSON');txt.type=json.type='button';txt.addEventListener('click',()=>download(exportText(record),'lex-raptor-research.txt','text/plain;charset=utf-8'));json.addEventListener('click',()=>download(JSON.stringify(record,null,2),'lex-raptor-research.json','application/json'));actions.append(txt,json);container.append(actions);
}
async function research(draft){
 if(busy||$(draft?'ask':'search').disabled)return;
 if(!$('research-form').reportValidity()){$('options-dialog').close();$('question').focus();return;}
 if(!['court','after','before','search-query'].every(id=>$(id).reportValidity())){$('options-dialog').showModal();return;}
 const submitted=requestBody();busy=true;render();$('options-dialog').close();document.body.classList.add('has-conversation');
 const id=++turnCount,turn=el('section',null,'turn'),user=el('p',submitted.question,'user-message'),heading=el('div',null,'answer-heading'),logo=el('img');logo.src='/logo.png';logo.alt='';heading.append(logo,document.createTextNode('Lex Raptor'));const answer=el('div',null,'answer');answer.append(el('p',draft?'Preparing your research…':'Searching sources…','muted'));turn.append(user,heading,answer);$('conversation').append(turn);$('question').value='';user.scrollIntoView({block:'start',behavior:'auto'});
 try{const data=await api(draft?'research':'search',submitted);showResult(answer,data,draft,submitted.question,id);}catch(e){answer.replaceChildren(el('p',e.message,'error'));const retry=el('button','Edit request');retry.type='button';retry.addEventListener('click',()=>{$('question').value=submitted.question;$('question').focus();});answer.append(retry);}finally{busy=false;await refresh();}
}
$('research-form').addEventListener('submit',e=>{e.preventDefault();research(true);});
$('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();research(true);}});
$('search').addEventListener('click',()=>research(false));
$('citation-form').addEventListener('submit',async e=>{e.preventDefault();if(busy||$('check-citations').disabled)return;busy=true;render();$('citation-status').textContent='Looking up citations…';$('citation-results').replaceChildren();try{const data=await api('citations',{text:$('citation-text').value});for(const r of data.citations){const item=el('div',null,'citation-result');item.append(el('strong',r.citation),el('p',({200:'Matching record found',300:'Ambiguous: multiple records',404:'No matching record found',400:'Unrecognized citation',429:'Not checked: source limit reached'})[r.status]||'Not checked'));for(const m of r.matches)if(m.url)item.append(link(m.name,m.url));$('citation-results').append(item);}$('citation-status').textContent=(data.citations.length?'':'No case citations were identified. ')+data.limitation;}catch(e){$('citation-status').textContent=e.message;}finally{busy=false;render();}});
document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#source-"]');if(a){const target=document.getElementById(a.hash.slice(1));if(target){target.open=true;let parent=target.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}}}});
refresh();
