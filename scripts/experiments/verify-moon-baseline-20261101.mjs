import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const out=path.resolve('output/comprehensive-execution-20261101/creation/baseline');
const source=path.join(out,'moon-geometry.html'),browser=await chromium.launch();
const facts=[];
try{
 for(const [width,height] of [[1440,900],[900,650],[390,844]]){
  const context=await browser.newContext({viewport:{width,height},offline:true});
  const page=await context.newPage(),errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url())});
  const started=performance.now();await page.goto(pathToFileURL(source).href);await page.locator('#phase').waitFor();
  const loadMs=performance.now()-started;
  await page.screenshot({path:path.join(out,'hero-'+width+'.png')});
  for(const [angle,label,percent]of [[0,'新月','0%'],[90,'上弦月','50%'],[180,'满月','100%'],[270,'下弦月','50%']]){
   await page.locator('[data-angle="'+angle+'"]').click();
   assert.equal(await page.locator('#phase').textContent(),label);assert.equal(await page.locator('#percent').textContent(),percent);
  }
  await page.locator('#angle').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#angle-value').textContent(),'1°');
  await page.locator('[data-angle="90"]').click();
  await page.locator('.lab').screenshot({path:path.join(out,'lab-'+width+'.png')});
  await page.locator('[data-answer="quarter"]').click();assert.match(await page.locator('#feedback').textContent(),/再想/);
  await page.locator('[data-answer="half"]').click();assert.match(await page.locator('#feedback').textContent(),/正确/);
  await page.locator('#reset').click();assert.equal(await page.locator('#phase').textContent(),'上弦月');
  assert.equal(await page.locator('[data-answer="half"]').getAttribute('aria-pressed'),'false');
  const geometry=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,
   buttons:[...document.querySelectorAll('button')].map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}));
  assert.ok(geometry.documentWidth<=width+1,'Horizontal overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  facts.push({width,height,loadMs,geometry,errors,network,phasePresets:true,keyboard:true,quizWrongAndCorrect:true,reset:true});
  await context.close();
 }
 const result={status:'behavior-verified-awaiting-visual-review',checkedAt:new Date().toISOString(),source,bytes:(await fs.stat(source)).size,facts};
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}

