import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
const out = path.resolve('output/comprehensive-execution-20261101/resilient-20261101/builtin-inspection')
await fs.mkdir(out, { recursive: true })
try {
 const port = (await fs.readFile('C:/Users/74755/AppData/Roaming/ittoedu-courseware-editor-v8-rebuild/DevToolsActivePort','utf8')).split(/\r?\n/)[0]
 const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
 let page
 for (const candidate of browser.contexts().flatMap(c=>c.pages())) {
  if (await candidate.evaluate(() => !!window.desktopAPI?.execution).catch(() => false)) { page = candidate; break }
 }
 if (!page) throw new Error('No normal App window exposes the public execution API.')
 const facts = await page.evaluate(async () => {
  const r = await window.desktopAPI.execution.run('634e8c1a-96c2-4960-ae5f-25fcd49ddfce')
  if (!r) return { missing: true }
  const selection = r.input.selection
  const safe = value => {
   let text = JSON.stringify(value)
   for (const id of [selection.connection.id, selection.connection.accountId, selection.connection.auth.credentialRef]) if(id) text=text.split(id).join('[connection-identity-omitted]')
   return text
  }
  return { status:r.status, requests:r.requests.map(q=>({state:q.state,timing:q.timing,usage:q.usage})), errors:r.tools.filter(t=>t.result?.kind==='error').map(t=>({name:t.call.name,inputKeys:Object.keys(t.call.input??{}),inputSummary:safe(t.call.input).slice(0,700),result:safe(t.result).slice(0,4000)})), lastTools:r.tools.slice(-8).map(t=>({name:t.call.name,state:t.state})) }
 })
 await fs.writeFile(path.join(out,'live-facts.json'),JSON.stringify(facts,null,2))
 await page.screenshot({path:path.join(out,'live-app.png')})
 console.log(JSON.stringify({ status: facts.status, requests: facts.requests?.length, errors: facts.errors, lastTools: facts.lastTools }))
 process.exit(0)
} catch (error) { console.error(error.message); process.exit(1) }
