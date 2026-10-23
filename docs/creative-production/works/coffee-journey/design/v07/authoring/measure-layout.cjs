'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium,expect}=require('@playwright/test');
const base=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch();const records=[];try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:width<700?844:1000},offline:true}),page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.join(base,'native/coffee-journey-v07-offline.html')).href);
  let bg,nav;await expect.poll(async()=>{for(const f of page.frames()){if(await f.locator('[data-coffee-underlay]').count())bg=f;if(await f.locator('nav[aria-label="作品章节"]').count())nav=f}return Boolean(bg&&nav)},{timeout:20000}).toBe(true);
  const root=bg.locator('[data-coffee-underlay]');await expect(root).toHaveAttribute('data-assets-ready','6');
  for(let n=1;n<=7;n++){
   await nav.locator('nav[aria-label="作品章节"] button').nth(n-1).click();await expect.poll(async()=>{const d=await root.evaluate(e=>({...e.dataset}));return d.chapter===String(n)&&d.idle==='true'&&Math.abs(Number(d.phase)-(n-1))<.001},{timeout:15000}).toBe(true);
   const d=await root.evaluate(e=>({...e.dataset}));records.push({width,chapter:n,reading:JSON.parse(d.reading),phase:Number(d.phase),size:d.size});
   if(width===390)await page.screenshot({path:path.join(base,'previews',`before-final-mobile-u0${n}.png`)});
  }
  records.push({width,errors});await ctx.close();
 }
 fs.writeFileSync(path.join(base,'evidence/reading-knots.json'),JSON.stringify(records,null,2));console.log(JSON.stringify(records,null,2));
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});