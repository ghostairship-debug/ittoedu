import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=path.resolve('output/comprehensive-execution-20261101/creation/'+(process.argv[3]||'moon-verification'));
await fs.mkdir(out,{recursive:true});
const source=path.resolve(process.argv[2]||'output/comprehensive-execution-20261101/creation/workspace/月光的几何-离线.html');
const browser=await chromium.launch(),facts=[]; let stage='start';
async function containing(page,selector){
 let found; await expect.poll(async()=>{for(const frame of page.frames())if(await frame.locator(selector).count()){found=frame;return true}return false},{timeout:15000}).toBe(true);return found;
}
try{
 for(const [width,height]of [[1440,900],[900,650],[390,844]]){
  stage='viewport-'+width;const context=await browser.newContext({viewport:{width,height},offline:true});
  const page=await context.newPage(),errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url())});
  const started=performance.now();await page.goto(pathToFileURL(source).href);
  await expect(page.getByText(process.argv[4]||'借来的光，变化的形。',{exact:true})).toBeVisible({timeout:20000});
  const loadMs=performance.now()-started;
  await page.screenshot({path:path.join(out,'page1-'+width+'.png')});
  await page.getByText('进入实验  →',{exact:true}).click();
  let lab=await containing(page,'#fraction');await expect(lab.locator('#phase')).toHaveText('上弦月');
  const phaseEvidence=[];
  for(const [angle,label,fraction]of [[0,'新月','0%'],[90,'上弦月','50%'],[180,'满月','100%'],[270,'下弦月','50%']]){
   await lab.locator('[data-phase="'+angle+'"]').click();await expect(lab.locator('#phase')).toHaveText(label);await expect(lab.locator('#fraction')).toHaveText(fraction);
   phaseEvidence.push({angle,label,fraction,path:await lab.locator('#light').getAttribute('d')});
  }
  await lab.locator('#angle').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await expect(lab.locator('#degrees')).toHaveText('1°');
  await lab.locator('#reset').click();await expect(lab.locator('#degrees')).toHaveText('90°');
  const labGeometry=await lab.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
  assert.ok(labGeometry.scrollWidth<=labGeometry.width+1,'lab horizontal overflow');assert.ok(labGeometry.scrollHeight<=labGeometry.height+1,'lab vertical overflow');
  await page.screenshot({path:path.join(out,'page2-'+width+'.png')});
  await page.getByText('检验直觉  →',{exact:true}).click();
  const quiz=await containing(page,'[data-answer="half"]');
  await quiz.locator('[data-answer="quarter"]').click();await expect(quiz.locator('#answer')).toContainText('再想一步');
  await quiz.locator('[data-answer="half"]').click();await expect(quiz.locator('#answer')).toContainText('正确');
  const quizGeometry=await quiz.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
  assert.ok(quizGeometry.scrollWidth<=quizGeometry.width+1,'quiz horizontal overflow');assert.ok(quizGeometry.scrollHeight<=quizGeometry.height+1,'quiz vertical overflow');
  await page.screenshot({path:path.join(out,'page3-'+width+'.png')});
  await quiz.locator('#reset').click();await expect(quiz.locator('[data-answer="half"]')).toHaveAttribute('aria-pressed','false');
  await page.getByText('←  回到实验',{exact:true}).click();lab=await containing(page,'#fraction');await expect(lab.locator('#phase')).toBeVisible();
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  facts.push({width,height,loadMs,phaseEvidence,labGeometry,quizGeometry,errors,network,navigation:true,keyboard:true,quiz:true,reset:true});
  await context.close();
 }
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'behavior-verified-awaiting-root-visual-review-and-author-handoff',checkedAt:new Date().toISOString(),source,bytes:(await fs.stat(source)).size,facts},null,2));
 console.log(JSON.stringify({status:'passed',viewports:facts.map(f=>[f.width,f.height]),out}));
}catch(error){await fs.writeFile(path.join(out,'failure-'+Date.now()+'.json'),JSON.stringify({stage,error:String(error),stack:error.stack,facts},null,2));throw error}finally{await browser.close()}

