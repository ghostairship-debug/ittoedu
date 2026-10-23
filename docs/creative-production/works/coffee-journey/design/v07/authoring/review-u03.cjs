'use strict';
const fs=require('node:fs'),path=require('node:path'),{chromium,expect}=require('@playwright/test');
const base=path.resolve(__dirname,'..'),root=path.join(base,'programs/u03');
(async()=>{const browser=await chromium.launch(),records=[];try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:width<700?844:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://coffee-art.local/**',route=>{const file=path.join(root,decodeURIComponent(new URL(route.request().url()).pathname));return route.fulfill({status:fs.existsSync(file)?200:404,body:fs.existsSync(file)?fs.readFileSync(file):'missing',contentType:file.endsWith('.html')?'text/html':file.endsWith('.webp')?'image/webp':file.endsWith('.svg')?'image/svg+xml':'text/plain'})});
  await page.goto('http://coffee-art.local/u03.html');await page.waitForFunction(()=>[...document.images].every(im=>im.complete&&im.naturalWidth));
  const lab=page.locator('[data-process-lab]');await page.locator('button[data-method="honey"]').click();await page.locator('[data-detail]').click();await expect(lab).toHaveAttribute('data-method','honey');
  await page.screenshot({path:path.join(base,'previews',`u03-material-${width}-detail.png`),fullPage:true});
  await page.locator('[data-compare-button]').click();await expect(lab).toHaveAttribute('data-compare','true');
  await page.screenshot({path:path.join(base,'previews',`u03-material-${width}-compare.png`),fullPage:true});
  const facts=await page.evaluate(()=>({images:[...document.images].map(x=>({src:x.getAttribute('src'),decoded:x.complete&&x.naturalWidth>0})),overflow:document.documentElement.scrollWidth>innerWidth,matrixCells:[...document.querySelectorAll('.matrix-value')].map(x=>x.textContent)}));
  await page.locator('[data-compare-close]').click();await expect(lab).toHaveAttribute('data-method','honey');await expect(page.locator('[data-detail-panel]')).toHaveAttribute('data-open','true');
  await page.locator('button[data-method="natural"]').click();await page.locator('button[data-method="natural"]').press('ArrowRight');await expect(lab).toHaveAttribute('data-method','washed');
  records.push({width,...facts,stateReturn:true,keyboard:true,errors});await page.close();
 }
 fs.writeFileSync(path.join(base,'evidence/u03-material-review.json'),JSON.stringify(records,null,2));console.log(JSON.stringify(records.map(x=>({width:x.width,overflow:x.overflow,images:x.images.length,stateReturn:x.stateReturn,errors:x.errors})),null,2));
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});