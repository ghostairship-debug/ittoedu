const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
let chromium;try{({chromium}=require('playwright'))}catch{({chromium}=require('D:/果铃工作台/node_modules/@playwright/test'))}
const dir=__dirname,out=path.join(dir,'evidence');fs.mkdirSync(out,{recursive:true});
const facts={checkedAt:new Date().toISOString(),scope:'standalone candidate; formal GLX evidence is separate',errors:[],checks:[]};
function check(label,ok,detail){facts.checks.push({label,passed:!!ok,detail});if(!ok)throw Error(label+': '+JSON.stringify(detail))}
(async()=>{
 const browser=await chromium.launch({headless:true});facts.browser=await browser.version();
 try{
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:1});
   await context.addInitScript(()=>{window.__studyRafCount=0;const original=requestAnimationFrame;window.requestAnimationFrame=(fn)=>original.call(window,(t)=>{window.__studyRafCount++;fn(t)})});
   const page=await context.newPage();page.on('pageerror',e=>facts.errors.push(String(e)));
   await page.goto(pathToFileURL(path.join(dir,'u06-inline.html')).href);await page.addStyleTag({content:'html { background:#e8eeea!important }'});await page.waitForTimeout(250);
   const before=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,width:innerWidth,mode:document.querySelector('[data-water-lab]').dataset.mode,labels:[...document.querySelectorAll('.water-legend,.diagram-heading,.water-figure figcaption')].map(el=>({text:el.textContent,size:getComputedStyle(el).fontSize}))}));
   check(width+' no horizontal overflow',before.scrollWidth<=width,before);
   await page.screenshot({path:path.join(out,`${width}-extract-start.png`),fullPage:true});
   await page.locator('[data-replay]').click();await page.waitForTimeout(3600);await page.screenshot({path:path.join(out,`${width}-extract-active.png`),fullPage:true});
   check(width+' extraction midstage',await page.locator('[data-water-lab]').getAttribute('data-step')==='1');
   await page.locator('[data-replay]').click();
   await page.locator('[data-next]').click();check(width+' dilution baseline',await page.locator('output[data-concentration]').textContent()==='1.50');
   await page.locator('[data-add="100"]').click();await page.waitForTimeout(900);
   const diluted=await page.locator('[data-water-lab]').evaluate(el=>({...el.dataset}));
   check(width+' fixed mass and count',diluted.solute==='3'&&diluted.total==='300'&&diluted.concentration==='1.00'&&diluted.visibleParticles==='72',diluted);
   await page.screenshot({path:path.join(out,`${width}-dilute-maximum.png`),fullPage:true});
   const r1=await page.evaluate(()=>window.__studyRafCount);await page.waitForTimeout(350);const r2=await page.evaluate(()=>window.__studyRafCount);check(width+' idle animation stopped',r2===r1,{r1,r2});
   await page.reload();await page.waitForTimeout(100);check(width+' state reload',await page.locator('output[data-concentration]').textContent()==='1.00');
   await page.locator('[data-reset]').click();await page.waitForTimeout(650);check(width+' reset',await page.locator('output[data-total]').textContent()==='200');
   await page.locator('[data-sound]').click();check(width+' sound trigger',Number(await page.locator('[data-water-lab]').getAttribute('data-audio-events'))>=1);
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>facts.errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(dir,'u06-inline.html')).href);await page.locator('[data-replay]').click();check('reduced motion advances static phase',await page.locator('[data-water-lab]').getAttribute('data-step')==='1');check('reduced motion no playback',await page.locator('[data-water-lab]').getAttribute('data-playing')==='false');
  await page.goto(pathToFileURL(path.join(dir,'sugar-inline.html')).href);await page.addStyleTag({content:'html { background:#e8eeea!important }'});check('sugar original concentration',await page.locator('output[data-concentration]').textContent()==='10.00');await page.locator('[data-add="300"]').click();check('sugar diluted concentration',await page.locator('output[data-concentration]').textContent()==='5.00');check('sugar fixed solute',await page.locator('output[data-solute]').textContent()==='30');await page.screenshot({path:path.join(out,'390-sugar-dilute.png'),fullPage:true});await context.close();
  check('no page errors',facts.errors.length===0,facts.errors);facts.passed=true;
 }catch(e){facts.passed=false;facts.failure=String(e);throw e}finally{fs.writeFileSync(path.join(out,'candidate-facts.json'),JSON.stringify(facts,null,2));await browser.close();console.log(JSON.stringify(facts,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
