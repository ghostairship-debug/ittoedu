'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{chromium,expect}=require('@playwright/test');
const base=path.resolve(__dirname,'..'),shots=path.join(base,'previews/motion');fs.mkdirSync(shots,{recursive:true});
async function find(page,selector){let frame;await expect.poll(async()=>{for(const f of page.frames())if(await f.locator(selector).count()){frame=f;return true}return false},{timeout:30000}).toBe(true);return frame}
(async()=>{const browser=await chromium.launch(),results=[];try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},offline:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(base,'native/coffee-journey-v07-offline.html')).href);
  const bg=await find(page,'[data-coffee-underlay]'),nav=await find(page,'nav[aria-label="作品章节"]'),root=bg.locator('[data-coffee-underlay]'),buttons=nav.locator('nav[aria-label="作品章节"] button');await expect(root).toHaveAttribute('data-assets-ready','6');
  const facts=()=>root.evaluate(e=>({...e.dataset})),mount=(await facts()).mountId;
  await buttons.nth(0).click();await expect(root).toHaveAttribute('data-phase','0.00000');await expect(root).toHaveAttribute('data-idle','true');
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+100));
  const click=async n=>{await buttons.nth(n-1).click({force:true,noWaitAfter:true});await page.clock.runFor(1)};
  const settle=async()=>{for(let k=0;k<240;k++){await page.clock.runFor(8);const f=await facts();if(f.idle==='true')return f}throw Error('Motion did not settle')};
  const record={width,transitions:[],rapid:[],errors};
  for(let i=0;i<6;i++){
   if(i!==0){await click(i+1);await settle()}
   const selected=width===1440||[1,3,4,5].includes(i),samples=[];
   const capture=async(q,d)=>{const file=`${width}-u0${i+1}-u0${i+2}-${String(Math.round(q*100)).padStart(3,'0')}.png`;if(selected){const buffer=await page.screenshot({animations:'allow'});for(let attempt=0;attempt<3;attempt++){try{fs.writeFileSync(path.join(shots,file),buffer);break}catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,150))}}}samples.push({requested:q,phase:Number(d.phase),progress:Number(d.motionProgress),scrollTop:Number(d.scrollTop),reading:JSON.parse(d.reading),motionId:d.motionId,mountId:d.mountId,paperPhase:Number(d.paperPhase),file:selected?file:null})};
   await capture(0,await facts());await click(i+2);let next=.25,done=false;
   for(let k=0;k<240;k++){
    await page.clock.runFor(8);const d=await facts();assert.equal(d.mountId,mount);
    if(next<=.75&&Number(d.motionProgress)>=next){await capture(next,d);next+=.25}
    if(d.idle==='true'&&Math.abs(Number(d.phase)-(i+1))<.001){await capture(1,d);done=true;break}
   }
   assert(done);assert.equal(samples.length,5,'All intermediate quarters captured');
   const moving=samples.slice(1,4);for(const s of moving)assert(Math.abs(s.phase-(i+s.progress))<.025,'Background follows actual navigation progress');
   assert(new Set(moving.map(x=>x.scrollTop)).size>1,'Foreground really scrolls');assert(new Set(moving.map(x=>x.phase)).size>1,'Material really changes');
   record.transitions.push({from:i+1,to:i+2,samples});console.log('MOTION_FRAMES',width,i+1,'to',i+2);
  }
  await click(1);await settle();await click(7);await page.clock.runFor(176);const interrupted=await facts();
  await click(2);const reversed=await facts();assert(Math.abs(Number(reversed.phase)-Number(interrupted.phase))<.45,'Reverse starts at visible phase, not an endpoint');record.rapid.push({type:'reverse',before:interrupted,after:reversed});
  await page.clock.runFor(64);await click(6);await page.clock.runFor(48);await click(3);const finished=await settle();assert.equal(finished.phase,'2.00000');assert.equal(finished.mountId,mount);record.rapid.push({type:'fast-sequence-2-6-3',final:finished});
  const tick=finished.tick;await page.clock.runFor(2000);assert.equal((await facts()).tick,tick);record.idleStopped=true;
  await click(7);await page.clock.runFor(176);const beforeWheel=await facts();await page.mouse.move(width/2,420);await page.mouse.wheel(0,-220);await page.clock.runFor(250);const afterWheel=await facts();record.manualTakeover={before:beforeWheel,after:afterWheel};assert.notEqual(afterWheel.motionStatus,'running');
  assert.equal(errors.length,0);results.push(record);fs.writeFileSync(path.join(base,'evidence/final-motion-frames.json'),JSON.stringify(results,null,2));await context.close();
 }
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});