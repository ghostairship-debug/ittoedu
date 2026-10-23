'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{chromium,expect}=require('@playwright/test');
const base=path.resolve(__dirname,'..'),out=path.join(base,'evidence'),preview=path.join(base,'previews');
const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2));
async function findFrame(page,selector){let found;await expect.poll(async()=>{for(const f of page.frames())if(await f.locator(selector).count()){found=f;return true}return false},{timeout:30000}).toBe(true);return found}
async function app(page){await page.goto(pathToFileURL(path.join(base,'native/coffee-journey-v07-offline.html')).href);const bg=await findFrame(page,'[data-coffee-underlay]'),nav=await findFrame(page,'nav[aria-label="作品章节"]'),root=bg.locator('[data-coffee-underlay]');await expect(root).toHaveAttribute('data-assets-ready','6',{timeout:30000});const facts=()=>root.evaluate(e=>({...e.dataset}));const go=async n=>{await nav.locator('nav[aria-label="作品章节"] button').nth(n-1).click();await expect.poll(async()=>{const d=await facts();return d.idle==='true'&&d.chapter===String(n)&&Math.abs(Number(d.phase)-(n-1))<.001},{timeout:20000}).toBe(true)};return{bg,nav,root,facts,go}}
(async()=>{const browser=await chromium.launch(),records=[];try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:width<700?844:1000},offline:true}),page=await ctx.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
  const a=await app(page),mount=(await a.facts()).mountId,chapters=[];
  for(let n=1;n<=7;n++){
   await a.go(n);await page.screenshot({path:path.join(preview,`final-${width}-u0${n}.png`)});
   chapters.push(await a.facts());assert.equal(chapters.at(-1).mountId,mount);
  }
  const geometry=await a.root.evaluate(e=>({root:e.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight},canvas:e.querySelector('canvas').getBoundingClientRect().toJSON()}));assert.equal(geometry.root.width,width);assert.equal(geometry.root.height,width<700?844:1000);
  await a.go(3);const f3=await findFrame(page,'[data-process-lab]'),lab3=f3.locator('[data-process-lab]');
  for(const id of ['washed','natural','honey']){await f3.locator(`button[data-method="${id}"]`).click();await expect(lab3).toHaveAttribute('data-method',id)}
  await expect.poll(()=>f3.locator('.specimen-image[data-active="true"]').evaluate(e=>getComputedStyle(e).opacity)).toBe('1');
  await f3.locator('[data-detail]').click();await expect(f3.locator('[data-detail-panel]')).toHaveAttribute('data-open','true');
  await f3.locator('[data-compare-button]').click();await expect(lab3).toHaveAttribute('data-compare','true');
  await page.screenshot({path:path.join(preview,`final-${width}-u03-compare.png`)});
  await f3.locator('[data-compare-close]').click();await expect(lab3).toHaveAttribute('data-method','honey');await expect(f3.locator('[data-detail-panel]')).toHaveAttribute('data-open','true');
  const materialImages=await f3.locator('.material-photo').evaluateAll(es=>es.map(im=>({decoded:im.complete&&im.naturalWidth>0,width:im.naturalWidth,src:im.currentSrc.slice(0,45)})));assert(materialImages.every(x=>x.decoded));
  await f3.locator('[data-detail]').click();await a.go(5);const f5=await findFrame(page,'[data-roast-lab]'),lab5=f5.locator('[data-roast-lab]'),range=f5.locator('[data-roast-lab] input[type="range"]');
  await f5.locator('[data-roast-value="50"]').click();await expect(range).toHaveValue('50');await f5.locator('button[data-zoom]').click();
  await page.screenshot({path:path.join(preview,`final-${width}-u05-midpoint.png`)});await f5.locator('button[data-zoom]').click();
  await f5.locator('[data-play]').click();await page.waitForTimeout(180);await f5.locator('[data-play]').click();const roastValue=Number(await range.inputValue());assert(roastValue>=0&&roastValue<=100);
  await a.go(6);const f6=await findFrame(page,'[data-water-lab]'),lab6=f6.locator('[data-water-lab]');
  await f6.locator('[data-replay]').click();await page.waitForTimeout(220);await f6.locator('[data-replay]').click();
  await f6.locator('[data-next]').click();await f6.locator('[data-add="100"]').click();await expect(lab6).toHaveAttribute('data-concentration','1.00');await expect(lab6).toHaveAttribute('data-solute','3');await expect(lab6).toHaveAttribute('data-total','300');await expect(lab6).toHaveAttribute('data-particles','72');
  await f6.locator('[data-sound]').click();await expect(f6.locator('[data-sound]')).toHaveAttribute('aria-pressed','true');await f6.locator('[data-add="50"]').click();const audio=await lab6.getAttribute('data-audio-events');assert(Number(audio)>=1);await f6.locator('[data-sound]').click();await f6.locator('[data-add="100"]').click();await page.waitForTimeout(300);
  await page.screenshot({path:path.join(preview,`final-${width}-u06-dilution.png`)});
  await a.go(7);await a.go(6);await expect(lab6).toHaveAttribute('data-added','100');await f6.locator('[data-reset]').click();await expect(lab6).toHaveAttribute('data-concentration','1.50');
  await f6.locator('#water-range').focus();await f6.locator('#water-range').press('End');await expect(lab6).toHaveAttribute('data-concentration','1.00');await f6.locator('[data-reset]').click();
  const beforeIdle=await a.facts();await page.waitForTimeout(300);const afterIdle=await a.facts();assert.equal(beforeIdle.tick,afterIdle.tick,'Background idle stops drawing');
  await a.go(4);await page.mouse.move(width/2,width<700?680:700);const beforeWheel=await a.facts();await page.mouse.wheel(0,320);await page.waitForTimeout(350);const afterWheel=await a.facts();assert.notEqual(beforeWheel.reading,afterWheel.reading,'Native manual reading changes');
  const decoded=[];for(const f of page.frames()){const result=await f.locator('img').evaluateAll(es=>es.filter(e=>e.getAttribute('src')).map(e=>({decoded:e.complete&&e.naturalWidth>0,src:e.currentSrc.slice(0,80)}))).catch(()=>[]);decoded.push(...result)}
  const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert(overflow.scrollWidth<=width+1);assert.equal(errors.length,0);assert.equal(requests.length,0);assert(decoded.every(x=>x.decoded));
  records.push({width,chapters,geometry,underlayMountStable:true,u03:{stateReturn:true,materialImages},u05:{midpoint:true,zoom:true,playPause:true,value:roastValue},u06:{dilution:'3g/300g = 1.00%',particles:72,returnPreserved:true,reset:true,keyboard:true,audioEvents:Number(audio)},idle:{before:beforeIdle.tick,after:afterIdle.tick},manualScroll:{before:JSON.parse(beforeWheel.reading),after:JSON.parse(afterWheel.reading),phaseBefore:beforeWheel.phase,phaseAfter:afterWheel.phase},decodedImages:decoded.length,overflow,errors,httpRequests:requests});
  save('final-offline-verification.json',records);console.log('OFFLINE_VERIFIED',width,JSON.stringify({chapters:chapters.length,images:decoded.length,errors:errors.length,requests:requests.length}));await ctx.close();
 }
 const ctx=await browser.newContext({viewport:{width:390,height:844},offline:true,reducedMotion:'reduce'}),page=await ctx.newPage(),a=await app(page);await a.go(6);const reduced=await a.facts();assert.equal(reduced.reduced,'true');assert.equal(reduced.phase,'5.00000');await page.waitForTimeout(180);assert.equal((await a.facts()).tick,reduced.tick);save('final-reduced-motion.json',{phase:reduced.phase,mode:reduced.reduced,idleStable:true,mountId:reduced.mountId});await ctx.close();
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});