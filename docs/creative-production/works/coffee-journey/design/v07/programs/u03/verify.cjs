const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const facts=[];
 for(const width of [1200,390]){
  const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.join(__dirname,'u03.html'));
  await page.locator('.method-button[data-method="honey"]').click();
  await page.locator('[data-detail]').click();
  const before=await page.locator('[data-process-lab]').getAttribute('data-method');
  await page.locator('[data-compare-button]').click();
  await page.screenshot({path:path.join(__dirname,`compare-${width}.png`),fullPage:true});
  const compare=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,svgCount:document.querySelectorAll('.compare svg').length,tableCells:[...document.querySelectorAll('.matrix-value')].map(e=>e.textContent),svgBoxes:[...document.querySelectorAll('.compare svg')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),bodyBackground:getComputedStyle(document.body).backgroundColor,rootBackground:getComputedStyle(document.documentElement).backgroundColor}));
  await page.locator('[data-compare-close]').click();
  const state=await page.evaluate(()=>({selected:document.querySelector('[data-process-lab]').dataset.method,detailOpen:document.querySelector('[data-detail-panel]').dataset.open,activeButtons:document.querySelectorAll('.method-button[aria-pressed="true"]').length}));
  await page.locator('[data-detail-panel]').screenshot({path:path.join(__dirname,`detail-${width}.png`)});
  await page.locator('.method-button[data-method="honey"]').focus();await page.keyboard.press('ArrowRight');
  const keyboard=await page.locator('[data-process-lab]').getAttribute('data-method');
  facts.push({width,before,compare,state,keyboard,errors,pass:compare.scrollWidth===width&&compare.svgCount===3&&state.selected==='honey'&&state.detailOpen==='true'&&state.activeButtons===1&&keyboard==='natural'&&errors.length===0});await page.close();
 }
 await browser.close();fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify({facts,scope:'Local SVG/layout/state check. Photography assets unavailable in local scratch; remote GLX integration and image rendering must be verified by Root.'},null,2));console.log(JSON.stringify(facts));
})().catch(e=>{console.error(e);process.exit(1)});
