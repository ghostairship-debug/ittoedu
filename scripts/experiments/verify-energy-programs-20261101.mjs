import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const source=path.resolve(process.argv[2]||'output/comprehensive-execution-20261101/creation/workspace/灯塔守夜人-离线.html');
const variant=process.argv[3]||'lighthouse',out=path.resolve('output/comprehensive-execution-20261101/creation/'+variant+'-verification');
const low=variant==='night-station-low',initial=low?2:3,minimumGap=low?3:2;
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch();const facts=[];let stage='start';
try{for(const [width,height]of [[1440,900],[900,650],[390,844]]){
 stage=width+'-load';const context=await browser.newContext({viewport:{width,height},offline:true});const page=await context.newPage(),errors=[],network=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url())});
 const started=performance.now();await page.goto(pathToFileURL(source).href);let app;
 await expect.poll(async()=>{for(const f of page.frames())if(await f.locator('#execute').count()){app=f;return true}return false},{timeout:20000}).toBe(true);
 await expect(app.locator('#round')).toContainText('1');const loadMs=performance.now()-started;
 await page.screenshot({path:path.join(out,'start-'+width+'.png')});
 stage=width+'-default';const expected=low?[[0,0,4],[3,0,1],[1,2,0],[0,0,2],[1,0,1],[1,1,0]]:[[0,0,5],[3,0,2],[2,1,0],[0,0,2],[1,0,1],[1,1,0]],rounds=[];
 for(let i=0;i<6;i++){await app.locator('#execute').click();await expect(app.locator('#battery')).toHaveText(String(expected[i][2]));const cells=await app.locator('#ledger tr').nth(i).locator('td').allTextContents();assert.deepEqual(cells.slice(-3),expected[i].map(String));rounds.push(cells)}
 await expect(app.locator('#execute')).toBeDisabled();await expect(app.locator('#result')).toContainText(String(minimumGap));
 if(variant.startsWith('night-station'))await expect.poll(()=>app.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(92, 59, 64)');
 await page.screenshot({path:path.join(out,'complete-'+width+'.png')});
 stage=width+'-undo';await app.locator('#undo').click();await expect(app.locator('#execute')).toBeEnabled();await expect(app.locator('#battery')).toHaveText('1');await app.locator('#execute').click();await expect(app.locator('#battery')).toHaveText('0');
 stage=width+'-alternative';await app.locator('#reset').click();await expect(app.locator('#battery')).toHaveText(String(initial));await expect(app.locator('#undo')).toBeDisabled();await app.locator('#execute').click();
 await app.locator('#release').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await expect(app.locator('#release-value')).toHaveText('1');await app.locator('#execute').click();
 await expect(app.locator('#battery')).toHaveText(low?'3':'4');assert.deepEqual((await app.locator('#ledger tr').nth(1).locator('td').allTextContents()).slice(-3),['1','2',low?'3':'4']);
 for(let i=0;i<4;i++)await app.locator('#execute').click();
 await expect(app.locator('#battery')).toHaveText('0');
 const alternative=await app.locator('#ledger tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('td')].map(e=>e.textContent)));
 assert.deepEqual(alternative.map(r=>Number(r.at(-2))),low?[0,2,0,0,0,1]:[0,2,0,0,0,0]);
 await app.locator('#motion').click();await expect(app.locator('#motion')).toHaveAttribute('aria-pressed','true');await app.locator('#motion').click();await expect(app.locator('#motion')).toHaveAttribute('aria-pressed','false');
 const geometry=await app.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
 assert.ok(geometry.scrollWidth<=geometry.width+1,'horizontal overflow');
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 facts.push({width,height,loadMs,rounds,alternative,geometry,errors,network,undo:true,reset:true,keyboard:true,motion:true});
 await page.reload();await expect.poll(async()=>{for(const f of page.frames())if(await f.locator('#execute').count()){app=f;return true}return false}).toBe(true);await expect(app.locator('#battery')).toHaveText(String(initial));
 await context.close();
}
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'behavior-verified-awaiting-root-visual-review-and-cold-author',checkedAt:new Date().toISOString(),source,bytes:(await fs.stat(source)).size,facts},null,2));console.log(JSON.stringify({status:'passed',source,out}));
}catch(error){await fs.writeFile(path.join(out,'failure-'+Date.now()+'.json'),JSON.stringify({stage,error:String(error),stack:error.stack,facts},null,2));throw error}finally{await browser.close()}

