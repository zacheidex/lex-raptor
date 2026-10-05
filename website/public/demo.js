const $=id=>document.getElementById(id);
let state={enabled:false,search_enabled:false,exhausted:false,databases:[]},busy=false,lastResult=null,initialized=false;
const selected=new Set(['cap']);
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
const descriptions={research:'Find supported answers with quotations you can inspect.',brief:'Extract facts, issue, holding and reasoning from retrieved case passages.',memo:'Organize rules, application, counterarguments and a qualified conclusion.',compare:'Compare shared rules, differences and practical implications.',arguments:'Develop a supported position, opposing arguments and responses.'};
async function api(path,body){
 const response=await fetch('/api/demo/'+path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Research is unavailable.');return data;
}
function render(){
 const connected=state.databases.some(d=>d.id==='courtlistener'&&d.available);
 $('search').disabled=busy||!state.search_enabled||!selected.size;
 $('ask').disabled=busy||!state.enabled||state.exhausted||state.daily_remaining===0||!selected.size;
 $('check-citations').disabled=busy||!connected;
 $('task-description').textContent=descriptions[$('task').value];
 $('ask').textContent=busy?'Working…':'Draft '+({'research':'answer',brief:'case brief',memo:'memo',compare:'comparison',arguments:'arguments'}[$('task').value]);
 $('selection-note').textContent=state.databases.filter(d=>selected.has(d.id)).map(d=>d.name).join(' · ')||'Select a connected database';
 $('availability').textContent=!state.search_enabled?'The research service is temporarily unavailable.':state.inference==='local'?'Local model mode. Search public databases or use the offline starter library.':state.exhausted?'The shared AI allowance has been used. Source search and citation lookup remain available.':!state.enabled?'Source search is available. AI drafting is currently disabled.':state.daily_remaining===0?'This network has used its daily AI allowance. A slot opens '+new Date(state.daily_reset_at).toLocaleString()+'. Source search remains available; local Ollama drafting has no demo limit.':'Open research preview. '+state.daily_remaining+' AI drafts remain for this network today. Source search uses no model credits.';
 if(!connected)$('citation-status').textContent='Connect CourtListener to enable citation lookup.';
 if(state.inference==='local'){
  $('runtime-badge').textContent='Local · '+state.model;
  $('limits-copy').textContent='Local inference has no API fee or demo cap. Public data providers have their own request limits. The CAP starter collection works offline.';
  $('privacy-note').textContent='AI drafts use your local Ollama model. Selecting an online database sends search terms to that provider. Questions and drafts are not saved here; fetched public source records are cached locally.';
 }
}
function renderDatabases(){
 $('database-options').replaceChildren();
 for(const d of state.databases){const label=el('label',null,'source-choice'+(!d.available?' unavailable':''));const input=el('input');input.type='checkbox';input.value=d.id;input.id='database-'+d.id;input.checked=selected.has(d.id);input.disabled=!d.available;input.addEventListener('change',()=>{input.checked?selected.add(d.id):selected.delete(d.id);render();});const info=el('span');info.append(el('strong',d.name),el('small',d.description));label.append(input,info);$('database-options').append(label);}
}
async function refresh(){try{state=await api('status');if(!initialized){initialized=true;if(state.databases.some(d=>d.id==='courtlistener'&&d.available)){selected.clear();selected.add('courtlistener');}}for(const id of selected)if(!state.databases.some(d=>d.id===id&&d.available))selected.delete(id);renderDatabases();render();}catch(e){state.search_enabled=false;state.enabled=false;render();$('availability').textContent=e.message;}}
$('task').addEventListener('change',render);
document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>{$('question').value=b.dataset.question;$('search-query').value=b.dataset.query;$('task').value=b.dataset.task;selected.clear();selected.add(b.dataset.database);renderDatabases();render();$('question').focus();}));
function requestBody(){return {question:$('question').value,search_query:$('search-query').value,task:$('task').value,database_ids:[...selected],filters:{court:$('court').value,after:$('after').value,before:$('before').value},request_id:crypto.randomUUID()};}
function link(text,url){const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function showResult(data,draft,question){
 lastResult={...data,question};
 $('result-title').textContent=draft?(state.tasks?.[data.task]?.name||'Research draft'):'Source search';
 $('model-label').textContent=data.model_used?data.model:'No AI call';
 $('result-query').textContent='Search terms: '+data.query+' · Retrieved '+new Date(data.retrieved_at).toLocaleString();
 $('coverage-report').replaceChildren();
 for(const r of data.searched||[]){const item=el('p');const name=state.databases.find(d=>d.id===r.id)?.name||r.id;item.textContent=name+': '+r.status+' · '+r.passages+' passages'+(r.total!==null?' · '+Number(r.total).toLocaleString()+' reported matches':'')+'. '+r.note;item.className=r.status==='unavailable'?'source-warning':'';$('coverage-report').append(item);for(const warning of r.warnings||[])$('coverage-report').append(el('p',warning,'source-warning'));}
 $('propositions').replaceChildren();$('sources').replaceChildren();
 let section='';
 for(const p of data.propositions||[]){if(p.section!==section){section=p.section;$('propositions').append(el('h3',section));}const item=el('article',null,'proposition');item.append(el('p',p.claim),el('blockquote',p.quote));const source=data.sources.find(s=>s.id===p.source_id);const a=el('a',(source?.citation||'Source')+' · '+source?.opinion_type);a.href='#source-'+p.source_id;item.append(a);$('propositions').append(item);}
 for(const s of data.sources){const d=el('details',null,'source-detail');d.id='source-'+s.id;d.append(el('summary',s.name+' · '+s.citation),el('p',s.database_name+' · '+s.court+' · '+s.decision_date),el('p',s.source_status,'source-status'),el('p',s.opinion_type+' · '+s.locator),el('div',s.text,'passage'));if(s.source_url)d.append(link('Open source record',s.source_url));if(s.official_url)d.append(document.createTextNode(' · '),link('Official PDF',s.official_url));$('sources').append(d);}
 let note=draft?(data.removed?data.removed+' proposition(s) removed because their source quotations could not be verified.':'Every displayed quotation matches its retrieved passage exactly.'):'Search does not call an AI model.';
 if(draft&&!data.propositions?.length){$('propositions').append(el('p',data.incomplete?'The model did not return a complete usable draft. Review the passages below.':'No supported draft was produced. Review database status and try more focused search terms.'));note='';}
 if(data.missing_sections?.length)note+=' Sections without a retained finding: '+data.missing_sections.join(', ')+'.';
 if(draft&&data.task==='compare'&&new Set(data.sources.map(s=>s.case_id)).size<2)note+=' Only one authority was retrieved; this comparison is incomplete.';
 $('validation-note').textContent=note;$('result').hidden=false;
}
async function research(draft){
 if(busy||$(draft?'ask':'search').disabled||!$('research-form').reportValidity())return;
 busy=true;render();$('research-status').textContent=draft?'Searching selected databases, reading source text, then drafting…':'Searching selected databases and fetching source text…';$('result').hidden=true;
 const submitted=requestBody();
 try{const data=await api(draft?'research':'search',submitted);showResult(data,draft,submitted.question);$('research-status').textContent='';}catch(e){$('research-status').textContent=e.message;}
 finally{busy=false;await refresh();}
}
$('research-form').addEventListener('submit',e=>{e.preventDefault();research(false);});
$('ask').addEventListener('click',()=>research(true));
$('citation-form').addEventListener('submit',async e=>{
 e.preventDefault();if(busy||$('check-citations').disabled)return;busy=true;render();$('citation-status').textContent='Looking up case citations…';$('citation-results').replaceChildren();
 try{const data=await api('citations',{text:$('citation-text').value});for(const r of data.citations){const item=el('div',null,'citation-result');item.append(el('strong',r.citation),el('p',({200:'Matching record found',300:'Ambiguous: multiple records',404:'No matching record found',400:'Unrecognized citation',429:'Not checked: source limit reached'})[r.status]||'Not checked'));for(const m of r.matches)if(m.url)item.append(link(m.name,m.url));$('citation-results').append(item);}$('citation-status').textContent=(data.citations.length?'':'No case citations were identified. ')+data.limitation;}catch(e){$('citation-status').textContent=e.message;}finally{busy=false;render();}
});
function download(content,name,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
$('export-json').addEventListener('click',()=>{if(lastResult)download(JSON.stringify(lastResult,null,2),'lex-raptor-research.json','application/json');});
$('export-text').addEventListener('click',()=>{if(!lastResult)return;const r=lastResult;const lines=['Lex Raptor research draft',r.question,'Search terms: '+r.query,'Retrieved: '+r.retrieved_at,'Model: '+(r.model_used?r.model:'No AI call'),'Review required. Quote matching does not establish legal support or current validity.',''];for(const s of r.searched||[])lines.push(s.id+': '+s.status+' — '+s.note);for(const p of r.propositions||[]){const s=r.sources.find(s=>s.id===p.source_id);lines.push('',p.section,p.claim,'“'+p.quote+'”',s?.citation||'',s?.source_url||'');}for(const s of r.sources)lines.push('','SOURCE: '+s.name+' · '+s.citation,s.source_status,s.source_url,s.locator,s.text);download(lines.join('\n'),'lex-raptor-research.txt','text/plain;charset=utf-8');});
document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#source-"]');if(a){const target=document.getElementById(a.hash.slice(1));if(target)target.open=true;}});
refresh();
