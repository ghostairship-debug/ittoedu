/** Actual browser geometry for the A2 moving label after the reviewed Source change. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';import{chromium,expect}from'@playwright/test';
const source=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),hash=b=>createHash('sha256').update(b).digest('hex'),before=hash(await fs.readFile(source));
await fs.mkdir(out,{recursive:false});const browser=await chromium.launch(),report={source,sha256:before,startedAt:new Date().toISOString(),errors:[],network:[],shots:[]};
try{
 const context=await browser.newContext({viewport:{width:900,height:650},offline:true}),page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url())});
 await page.goto(pathToFileURL(source).href);await page.getByText('进入实验  →',{exact:true}).click();
 let lab;await expect.poll(async()=>{for(const f of page.frames())if(await f.locator('#moon-label').count()){lab=f;return true}return false}).toBe(true);
 report.geometry=await lab.evaluate(()=>{
  const range=document.querySelector('#angle'),svg=document.querySelector('.orbit'),moon=document.querySelector('#moon-label'),labels=[...svg.querySelectorAll('text')],caption=labels.at(-1);
  const rect=el=>{const b=el.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};
  const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>0.25&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>0.25;
  const failures=[],svgRect=rect(svg),margin=[];
  for(let angle=0;angle<=360;angle++){range.value=String(angle);range.dispatchEvent(new Event('input',{bubbles:true}));const m=rect(moon);
   if(m.x<svgRect.x-.5||m.y<svgRect.y-.5||m.right>svgRect.right+.5||m.bottom>svgRect.bottom+.5)failures.push({angle,kind:'svg-clipping',moon:m});
   for(const label of labels)if(label!==moon&&overlap(m,rect(label)))failures.push({angle,kind:'label-overlap',other:label.textContent});
   margin.push({angle,bottomGap:rect(caption).y-m.bottom});
  }
  return{anglesChecked:361,failures,svg:svgRect,fontSizes:labels.map(e=>({text:e.textContent,font:getComputedStyle(e).fontSize})),minimumCaptionVerticalGap:Math.min(...margin.map(m=>m.bottomGap))};
 });
 assert.deepEqual(report.geometry.failures,[]);
 for(const angle of [0,90,180,269,270,359]){
  await lab.locator('#angle').evaluate((input,angle)=>{input.value=String(angle);input.dispatchEvent(new Event('input',{bubbles:true}))},angle);
  await expect(lab.locator('#degrees')).toHaveText(angle+'°');const shot=path.join(out,'labels-'+angle+'-900.png');await page.screenshot({path:shot});report.shots.push({angle,shot});
 }
 await lab.locator('#reset').click();await expect(lab.locator('#degrees')).toHaveText('90°');await expect(lab.locator('#reset')).toHaveText('回到上弦');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[]);assert.equal(hash(await fs.readFile(source)),before);report.status='browser-label-geometry-passed-awaiting-visual-review';
}catch(error){report.status='failed';report.error=String(error);throw error}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({status:report.status,out,geometry:report.geometry}))}
