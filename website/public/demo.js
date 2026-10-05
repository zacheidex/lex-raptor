const $=id=>document.getElementById(id);
let state={enabled:false,unlocked:false,exhausted:false},busy=false;
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
async function api(path,body){
  const response=await fetch('/api/demo/'+path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok){if(response.status===401){state.unlocked=false;render();}throw new Error(data.error||'The demo is unavailable.');}return data;
}
function render(){
  $('unlock-panel').hidden=!state.enabled||state.unlocked||state.exhausted;
  $('lock-demo').hidden=!state.unlocked;
  $('ask').disabled=busy||!state.enabled||!state.unlocked||state.exhausted||!$('cap').checked;
  $('ask').textContent=busy?'Reading the selected opinions…':'Research question';
  $('selection-note').textContent=$('cap').checked?'Searching CAP · 12 opinions':'Select at least one available database';
  $('availability').textContent=!state.enabled?'The online demo is awaiting activation. You can explore the questions below or run the full app locally.':state.exhausted?'The shared demo allowance has been used. The local app remains available.':state.unlocked?'Demo unlocked. Questions use the shared API allowance.':'The research demo is available with a passcode from the project owner.';
}
async function refresh(){try{state=await api('status');render();}catch(e){$('availability').textContent=e.message;$('ask').disabled=true;}}
$('cap').addEventListener('change',render);
document.querySelectorAll('[data-question]').forEach(b=>b.addEventListener('click',()=>{$('question').value=b.dataset.question;$('question').focus();}));
$('unlock-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;$('unlock-status').textContent='';try{await api('unlock',{passcode:$('passcode').value});$('passcode').value='';await refresh();$('question').focus();}catch(err){$('unlock-status').textContent=err.message;}finally{button.disabled=false;}});
$('lock-demo').addEventListener('click',async()=>{try{await api('logout',{});state.unlocked=false;render();}catch(err){$('research-status').textContent=err.message;}});
$('research-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy||$('ask').disabled)return;busy=true;render();$('research-status').textContent='Searching the selected collection and checking quoted passages. This can take up to 90 seconds.';$('result').hidden=true;
  try {
    const data=await api('research',{question:$('question').value,database_ids:$('cap').checked?['cap']:[],request_id:crypto.randomUUID()});
    $('propositions').replaceChildren();$('sources').replaceChildren();
    for(const p of data.propositions){const item=el('article',null,'proposition');item.append(el('p',p.claim),el('blockquote',p.quote));const source=data.sources.find(s=>s.id===p.source_id);const link=el('a',source?.citation+' · '+source?.opinion_type);link.href='#source-'+p.source_id;item.append(link);$('propositions').append(item);}
    for(const s of data.sources){const d=el('details',null,'source-detail');d.id='source-'+s.id;d.append(el('summary',s.name+' · '+s.citation),el('p',s.opinion_type+' opinion · '+s.locator+' · '+s.decision_date),el('div',s.text,'passage'));const a=el('a','Read the original public record');a.href=s.source_url;a.target='_blank';a.rel='noopener noreferrer';d.append(a);$('sources').append(d);}
    $('model-label').textContent=data.model;
    $('validation-note').textContent=data.removed?`${data.removed} proposition(s) were removed because their quotations could not be verified.`:'Every displayed quotation matches its retrieved passage exactly.';
    if(!data.propositions.length){$('propositions').append(el('p',data.incomplete?'The model did not return a complete usable draft. Review the retrieved passages below.':'The retrieved passages did not produce a supported answer. Try a narrower question about the starter collection.'));$('validation-note').textContent=data.removed?`${data.removed} unsupported proposition(s) removed.`:'';}
    $('research-status').textContent='';$('result').hidden=false;
  }catch(err){$('research-status').textContent=err.message;}
  finally{busy=false;await refresh();render();}
});
refresh();
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#source-"]');
  if(link){const target=document.getElementById(link.hash.slice(1));if(target)target.open=true;}
});
