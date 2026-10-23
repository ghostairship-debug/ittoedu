'use strict';
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('@playwright/test');
const base=path.resolve(__dirname,'..');
(async()=>{const profile=path.join(__dirname,'final-assembly-2026-10-23T03-56-38-778Z');const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);const records=[];for(const context of browser.contexts())for(const page of context.pages()){
 const record={url:page.url(),title:await page.title(),body:(await page.locator('body').innerText()).slice(0,16000),frames:page.frames().map(f=>f.url()),editors:await page.locator('.course-editor-frame').count()};records.push(record);
 if(record.url.includes('index.html'))await page.screenshot({path:path.join(base,'previews/assembly-open-diagnostic.png')});
}fs.writeFileSync(path.join(base,'evidence/assembly-open-diagnostic.json'),JSON.stringify(records,null,2));console.log(JSON.stringify(records,null,2));await browser.close()})().catch(e=>{console.error(e.stack);process.exitCode=1});