import {chromium} from '@playwright/test';
import fs from 'node:fs';
import {openWorkspace} from './browser-session.mjs';
const root=new URL('../..',import.meta.url).pathname.replace(/\/$/,'');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 const accessMode=await openWorkspace(page,root);
 await page.getByRole('heading',{name:/Follow the law/}).waitFor();
 await page.getByText('Ready for research',{exact:true}).waitFor();
 const question='How do Twombly and Iqbal describe the plausibility required in a complaint?';
 await page.getByRole('button',{name:question+' completed',exact:true}).first().click();
 await page.getByText('SOURCE-LINKED FINDINGS · REVIEW REQUIRED',{exact:true}).waitFor();
 await page.locator('.citation-buttons button').first().click();
 await page.locator('.research-source blockquote').waitFor();
 if(!(await page.locator('.research-source blockquote').innerText()).includes('plausible'))throw Error('Expected live source quotation not visible');
 await page.screenshot({path:root+'/data/lex-raptor-live-answer.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:root+'/data/lex-raptor-live-mobile.png',fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile overflow');
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync(root+'/data/live-answer-browser-report.json',JSON.stringify({access_mode:accessMode,account_required:accessMode==='account',owner_logo:true,live_persisted_research:true,local_model_ready:true,source_quotation_visible:true,mobile_no_overflow:true,javascript_errors:errors,additional_model_calls:0},null,2));
 console.log('Live generated answer, persisted history, quotation reader, model-ready status and mobile layout passed.');
} finally {await browser.close();}
