import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [sourceArg, outArg] = process.argv.slice(2)
if (!sourceArg || !outArg) throw new Error('Usage: node rain-export-acceptance-20261102.mjs <export.html> <new-output-directory>')
const source = resolve(sourceArg), out = resolve(outArg), url = pathToFileURL(source).href
await mkdir(out, { recursive: false })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const result = { startedAtUtc: new Date().toISOString(), source, out, status: 'running', checks: {}, screenshots: [], externalRequests: [], pageErrors: [] }
let browser, page
function check(name, condition, details) {
  result.checks[name] = { passed: Boolean(condition), details }
  if (!condition) throw new Error(`${name}: ${JSON.stringify(details)}`)
}
async function browserPid(instance) {
  const session = await instance.newBrowserCDPSession()
  try {
    const info = await session.send('SystemInfo.getProcessInfo'), process = info.processInfo.find(item => item.type === 'browser')
    if (!process || !Number.isInteger(process.id)) throw new Error('Could not identify Chromium browser process')
    return process.id
  } finally { await session.detach() }
}
async function screenshot(name) {
  const path = join(out, `${name}.png`)
  await page.screenshot({ path }); result.screenshots.push(path)
}
async function waitFrame(selector) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try { if (await frame.locator(selector).count()) return frame } catch { /* frame was replaced while navigating */ }
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Could not find ${selector} in a mounted frame`)
}
async function nextScene() {
  const next = page.getByRole('button', { name: '下一场景', exact: true })
  if (!await next.isVisible()) await page.getByRole('button', { name: '展开全局控制台', exact: true }).click()
  const prior = await page.evaluate(() => document.body.innerText)
  await next.click()
  await page.waitForFunction(previous => document.body.innerText !== previous, prior, { timeout: 15000 })
}
async function measuredText(frame, selector) {
  const raw = await frame.locator(selector).innerText(), match = raw.match(/-?\d+(?:\.\d+)?/)
  if (!match) throw new Error(`No number in ${selector}: ${JSON.stringify(raw)}`)
  return { raw, number: Number(match[0]) }
}
async function near(frame, selector, expected) {
  const measured = await measuredText(frame, selector)
  return { ...measured, expected, passed: Math.abs(measured.number - expected) < 0.001 }
}
async function openContext(label, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  await context.route('**/*', route => {
    const request = route.request().url()
    if (/^https?:/i.test(request)) { result.externalRequests.push({ label, url: request }); return route.abort() }
    return route.continue()
  })
  page = await context.newPage(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => result.pageErrors.push({ label, message: error.message }))
  await page.goto(url, { waitUntil: 'load' })
  const open = page.getByRole('button', { name: '展开全局控制台', exact: true })
  await open.waitFor({ state: 'visible' }); await open.click()
  await page.getByRole('button', { name: '下一场景', exact: true }).waitFor({ state: 'visible' })
  await screenshot(`${label}-01`)
  await nextScene(); await screenshot(`${label}-02`)
  await nextScene()
  await page.getByText('改变条件，比较估算径流', { exact: true }).waitFor({ state: 'visible' })
  const frame = await waitFrame('#rain')
  for (const selector of ['#green', '#rainOut', '#greenOut', '#q', '#hard', '#reset']) await frame.locator(selector).waitFor({ state: 'visible' })
  await screenshot(`${label}-03`)
  return { context, frame }
}
async function runScenario(label, width, height) {
  const { context, frame } = await openContext(label, width, height)
  const rain = frame.locator('#rain'), green = frame.locator('#green')
  let q = await near(frame, '#q', 18.6), hard = await near(frame, '#hard', 27)
  check(`${label}-default`, await rain.inputValue() === '30' && await green.inputValue() === '40' && q.passed && hard.passed,
    { rain: await rain.inputValue(), green: await green.inputValue(), rainOut: await frame.locator('#rainOut').innerText(), greenOut: await frame.locator('#greenOut').innerText(), q, hard })
  await rain.focus(); await page.keyboard.press('Home'); q = await near(frame, '#q', 0); hard = await near(frame, '#hard', 0)
  check(`${label}-zero-rain`, await rain.inputValue() === '0' && q.passed && hard.passed, { q, hard })
  await page.keyboard.press('End'); await green.focus(); await page.keyboard.press('Home')
  q = await near(frame, '#q', 54); hard = await near(frame, '#hard', 54)
  check(`${label}-all-hard`, await rain.inputValue() === '60' && await green.inputValue() === '0' && q.passed && hard.passed, { q, hard })
  await page.keyboard.press('End'); q = await near(frame, '#q', 12); hard = await near(frame, '#hard', 54)
  check(`${label}-all-green`, await green.inputValue() === '100' && q.passed && hard.passed, { q, hard })
  await frame.locator('#reset').click(); q = await near(frame, '#q', 18.6); hard = await near(frame, '#hard', 27)
  check(`${label}-reset`, await rain.inputValue() === '30' && await green.inputValue() === '40' && q.passed && hard.passed, { q, hard })
  await nextScene()
  await page.getByText('你能用模型说明原因吗？', { exact: true }).waitFor({ state: 'visible' })
  const quiz = await waitFrame('#feedback')
  const wrong = quiz.locator('button[data-correct="false"]').first(), correct = quiz.locator('button[data-correct="true"]').first()
  await wrong.waitFor({ state: 'visible' }); await correct.waitFor({ state: 'visible' })
  await screenshot(`${label}-04`)
  await wrong.click(); const wrongText = (await quiz.locator('#feedback').innerText()).trim()
  check(`${label}-wrong-feedback`, /错|再|不对|试|想/.test(wrongText), wrongText)
  await correct.click(); const correctText = (await quiz.locator('#feedback').innerText()).trim()
  check(`${label}-retry-correct`, /对|正确|没错/.test(correctText) && correctText !== wrongText, { wrongText, correctText })
  await screenshot(`${label}-04-feedback`)
  await context.close()
}
try {
  result.sourceSha256 = hash(await readFile(source))
  browser = await chromium.launch({ headless: true }); result.browserVersion = browser.version(); result.initialBrowserPid = await browserPid(browser)
  await runScenario('1440x900', 1440, 900)
  await runScenario('900x650', 900, 650)
  await browser.close()
  browser = await chromium.launch({ headless: true }); result.coldBrowserPid = await browserPid(browser)
  check('independent-browser-process', result.coldBrowserPid !== result.initialBrowserPid, { initial: result.initialBrowserPid, cold: result.coldBrowserPid })
  await runScenario('cold-900x650', 900, 650)
  check('no-external-network', result.externalRequests.length === 0, result.externalRequests)
  check('no-page-errors', result.pageErrors.length === 0, result.pageErrors)
  check('source-unchanged', hash(await readFile(source)) === result.sourceSha256, result.sourceSha256)
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'; result.failure = error instanceof Error ? error.stack : String(error); process.exitCode = 1
  if (page && !page.isClosed()) await screenshot('failure').catch(() => {})
} finally {
  result.finishedAtUtc = new Date().toISOString()
  if (browser) await browser.close().catch(() => {})
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}
