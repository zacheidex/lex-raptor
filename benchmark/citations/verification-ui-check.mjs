import {chromium} from '../../apps/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const results=[];
for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/demo/research',r=>r.fulfill({json:{task:'research',query:'Property',databases:['legal_web'],propositions:[{section:'Findings',claim:'Synthetic property claim.',source_id:'W1',source_ids:['W1'],quote:'',evidence_method:'web_citation'}],sources:[{id:'W1',kind:'web_page',database_id:'legal_web',name:'Public code',citation:'',text:'',source_url:'https://example.gov/property',evidence_method:'web_citation'}],searched:[]}}));
 await page.route('**/api/demo/verify',async r=>{calls.push(r.request().postDataJSON());await new Promise(done=>setTimeout(done,250));await r.fulfill({json:{checked_at:new Date().toISOString(),findings:[{id:'F1',claim:'Synthetic property claim.',source_ids:['V1'],verdict:'contradicted',reason:'The source specifies a different period.',evidence:[{source_id:'V1',url:'https://example.gov/property',text:'Synthetic source states a different period.',method:'direct'}]}],pages:[{id:'V1',url:'https://example.gov/property',status:'read',method:'direct'}],limitation:'AI review of retrieved excerpts.'}});});
 await page.goto('http://127.0.0.1:8787/');await page.waitForFunction(()=>!document.querySelector('#ask').disabled);
 assert.equal(await page.locator('#runtime-badge,.chat-header').count(),0);
 assert.equal(await page.locator('.raptor-mark').getAttribute('src'),'/raptor-cyan.svg');assert.ok(await page.locator('.raptor-mark').evaluate(img=>img.complete&&img.naturalWidth>0));
 assert.equal(await page.locator('nav a[href="/sources"]').innerText(),'Sources');
 await page.screenshot({path:'/tmp/cyan-'+width+'.png',fullPage:true});
 await page.fill('#question','Synthetic test question');await page.click('#ask');await page.getByText('Synthetic property claim.',{exact:true}).waitFor();
 await page.locator('.answer-citation-check').click();await page.getByText('Reopening cited sources…',{exact:true}).waitFor();await page.getByText('Source conflicts with this finding',{exact:true}).waitFor();
 assert.equal(calls.length,1);assert.equal(calls[0].findings[0].urls[0],'https://example.gov/property');assert.equal(calls[0].question,undefined);
 assert.doesNotMatch(await page.locator('#citation-dialog').innerText(),/have not been independently rechecked|No case citations/);
 assert.equal(await page.locator('#citation-form').isVisible(),false);await page.getByText('Text reviewed',{exact:true}).click();await page.getByText('Synthetic source states a different period.',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(errors.length,0,errors.join('\n'));
 await page.screenshot({path:'/tmp/verification-'+width+'.png',fullPage:true});results.push({width,passed:true,api_calls:calls.length});await page.close();
}
console.log(JSON.stringify({checks:results,api_spend:0}));await browser.close();
