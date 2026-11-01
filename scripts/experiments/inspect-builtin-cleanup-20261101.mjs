import {chromium} from '@playwright/test'
import fs from 'node:fs/promises'
const timer=setTimeout(()=>process.exit(2),15000);timer.unref()
const dir='output/comprehensive-execution-20261101/creation/builtin-moon-normal-20261101T084000/'
const port=(await fs.readFile('C:/Users/74755/AppData/Roaming/ittoedu-courseware-editor-v8-rebuild/DevToolsActivePort','utf8')).split(/\r?\n/)[0]
const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:4000})
for(const page of browser.contexts().flatMap(c=>c.pages())) {
 const has=await Promise.race([page.evaluate(()=>!!window.desktopAPI?.execution),new Promise(r=>setTimeout(()=>r(false),1500))]).catch(()=>false)
 if(!has)continue
 const restore=JSON.parse(await fs.readFile(dir+'profile-restore.json','utf8'))
 const data=await page.evaluate(async restore=>{
  const profile=await Promise.race([window.desktopAPI.executionSettings.read(),new Promise(r=>setTimeout(()=>r(null),2000))])
  return {url:location.href,title:document.querySelector('[aria-label="切换工作空间"]')?.getAttribute('title'),dialogs:[...document.querySelectorAll('[role="dialog"]')].map(n=>n.textContent?.slice(0,1200)),profileReadable:!!profile,profileRestored:profile?JSON.stringify(profile.profile.roles)===JSON.stringify(restore.originalRoles):null,profileStillTemporary:profile?JSON.stringify(profile.profile.roles)===JSON.stringify(restore.temporaryRoles):null}
 },restore)
 await fs.writeFile(dir+'cleanup-observation.json',JSON.stringify(data,null,2))
 await page.screenshot({path:dir+'cleanup-observation.png',timeout:3000})
 console.log(JSON.stringify(data))
 break
}
process.exit(0)
