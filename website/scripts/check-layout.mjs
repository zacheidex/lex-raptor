// Public UI fixtures only: no live provider, model or Google requests.
// Optional: LEX_RAPTOR_BROWSER=webkit (requires its Playwright system libraries).
import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.LEX_RAPTOR_URL||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Use a local build.');
const engine=process.env.LEX_RAPTOR_BROWSER||'chromium';
if(!['chromium','webkit'].includes(engine))throw new Error('Use chromium or webkit.');
const browser=await({chromium,webkit}[engine]).launch({headless:true});
let layouts=0;
await mkdir('.local-data/browser-check',{recursive:true});
try{
 const page=await browser.newPage(),errors=[],apiRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.context().route('https://scholar.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Scholar navigation fixture</title>'}));
 await page.route('**/api/demo/**',async route=>{const path=new URL(route.request().url()).pathname.split('/').at(-1);apiRequests.push(path);assert.ok(['status','courts'].includes(path),'Unexpected provider request: '+path);await route.fulfill({contentType:'application/json',body:JSON.stringify(path==='status'?{enabled:true,search_enabled:true,inference:'api',databases:[{id:'courtlistener',name:'CourtListener',available:true}]}:{courts:[],states:[]})});});
 for(const width of [320,360,390,768,1440]){
  await page.setViewportSize({width,height:950});await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#ask').disabled);
  for(const textSize of [16,32]){
   await page.evaluate(size=>document.documentElement.style.fontSize=size+'px',textSize);
   for(const task of ['auto','arguments','collect','lookup','search','scholar']){
    await page.locator('#task').selectOption(task);
    for(const busy of [false,true]){
     // Exercise the same compact controls with long override/loading labels.
     await page.evaluate(busy=>{document.getElementById('cancel-work').hidden=!busy;document.getElementById('open-options').textContent=busy?'Refine · 4':'Refine';if(busy)document.getElementById('ask').textContent='Working';},busy);
     const violations=await page.evaluate(()=>{
      const nodes=[...document.querySelectorAll('.composer-controls button,.composer-controls select')].filter(e=>e.getClientRects().length),box=e=>e.getBoundingClientRect(),outer=box(document.querySelector('.composer'));
      const errors=[];
      for(let i=0;i<nodes.length;i++){const a=box(nodes[i]);if(a.left<outer.left||a.right>outer.right+1)errors.push(nodes[i].id+' escapes composer');for(let j=i+1;j<nodes.length;j++){const b=box(nodes[j]);if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)errors.push(nodes[i].id+' overlaps '+nodes[j].id);}}
      if(document.documentElement.scrollWidth>innerWidth)errors.push('Horizontal page overflow');return errors;
     });assert.deepEqual(violations,[],JSON.stringify({width,textSize,task,busy,violations}));layouts++;
    }
   }
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='16px');await page.locator('#task').selectOption('auto');await page.evaluate(()=>document.getElementById('cancel-work').hidden=true);
  await page.locator('#open-options').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#open-options').evaluate(e=>e===document.activeElement),true);
  await page.screenshot({path:'.local-data/browser-check/compact-'+width+'.png'});
  await page.getByRole('link',{name:'Open source',exact:true}).click();assert.equal(new URL(page.url()).pathname,'/open-source');await page.getByRole('heading',{name:'Free software. Optional services.'}).waitFor();
  await page.locator('.dataset-list details').last().locator('summary').click();assert.match(await page.locator('.dataset-list details').last().innerText(),/Google Scholar/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.local-data/browser-check/open-source-'+width+'.png',fullPage:true});
 }
 for(const path of ['/sources','/sources.html']){const response=await page.request.get(base+path,{maxRedirects:0});assert.equal(response.status(),308);assert.equal(response.headers().location,'/open-source#datasets');await page.goto(base+path);assert.equal(new URL(page.url()).pathname,'/open-source');assert.equal(new URL(page.url()).hash,'#datasets');}
 await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#ask').disabled);await page.locator('#task').selectOption('scholar');assert.equal(await page.locator('#open-options').isDisabled(),true);
 const query='Celotex 477 U.S. 317 & summary judgment';await page.locator('#question').fill(query);const count=apiRequests.length;
 const popupEvent=page.waitForEvent('popup');await page.locator('#ask').click();const popup=await popupEvent;await popup.waitForLoadState();const url=new URL(popup.url());assert.equal(url.hostname,'scholar.google.com');assert.equal(url.searchParams.get('q'),query);assert.equal(url.searchParams.get('as_sdt'),'2006');assert.equal(apiRequests.length,count);assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,layout_scenarios:layouts,text_scale:'100% and 200%',viewports:[320,360,390,768,1440],redirects:'passed',scholar_navigation:'mocked destination; no model or provider requests',browser_errors:0}));
}finally{await browser.close();}
