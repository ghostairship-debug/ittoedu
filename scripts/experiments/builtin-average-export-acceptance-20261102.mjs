// Isolated exported HTML acceptance; does not edit the work or call a model.
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const option = key => {
  const i = args.indexOf('--' + key)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
  return value
}
const sourceArg = option('source'), outArg = option('out'), expectedSourceSha256 = option('expected-sha256')
const expectedTitles = [option('title-one') ?? '平均数会被谁拉走？', option('title-two') ?? '谁在拉动平均数？',
  option('title-three') ?? '为什么平均数会被拉动？']
if (!sourceArg || !outArg) throw new Error('Usage: node builtin-average-export-acceptance-20261102.mjs --source <export.html> --out <new-directory>')
const source = resolve(sourceArg), out = resolve(outArg), url = pathToFileURL(source).href
await mkdir(out) // A new directory only; never overwrite earlier results.
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const result = { startedAtUtc: new Date().toISOString(), source, out, status: 'running', checks: {}, screenshots: [],
  expectedTitles, externalRequests: [], pageErrors: [], consoleErrors: [], visualReview: 'not-performed' }
let browser, page
function check(name, passed, details) {
  result.checks[name] = { passed: Boolean(passed), details }
  if (!passed) throw new Error(`${name}: ${JSON.stringify(details)}`)
}
async function browserPid(instance) {
  const session = await instance.newBrowserCDPSession()
  try {
    const result = await session.send('SystemInfo.getProcessInfo'), process = result.processInfo.find(item => item.type === 'browser')
    if (!process || !Number.isInteger(process.id)) throw new Error('Cannot identify Chromium browser process')
    return process.id
  } finally { await session.detach() }
}
async function shot(label) {
  const file = join(out, `${label}.png`)
  await page.screenshot({ path: file }); result.screenshots.push(file)
}
async function visibleFrame(selector) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try { if (await frame.locator(selector).isVisible()) return frame } catch { /* frame replaced while navigating */ }
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Visible frame control not found: ${selector}`)
}
async function nextScene(label, title) {
  // The accepted authoring source uses this native scene.next text object.
  // Do not fall back to an unrelated navigation path if it is unavailable.
  // The observed outer content span is display:contents; its child paints the
  // actual glyphs and receives the user's click. Measure and click that child.
  const next = page.locator('span[data-document-path]:visible > span').filter({ hasText: /^下一页\s*→$/ })
  await next.first().waitFor({ state: 'visible', timeout: 15000 })
  const count = await next.count()
  check(`${label}-unique-next`, count === 1, { count })
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Viewport size unavailable')
  await inViewport(`${label}-next-bounds`, next, viewport)
  await next.click()
  await page.getByText(title, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
}
async function inViewport(label, locator, viewport) {
  const box = await locator.boundingBox()
  check(label, !!box && box.width > 0 && box.height > 0 && box.x >= -1 && box.y >= -1
    && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, { box, viewport })
}
function number(raw) {
  const match = raw.match(/-?\d+(?:\.\d+)?/)
  if (!match) throw new Error(`No numeric value in ${JSON.stringify(raw)}`)
  return Number(match[0])
}
async function runScenario(label, width, height) {
  const viewport = { width, height }, context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  try {
    await context.route('**/*', route => {
      const request = route.request().url()
      if (/^https?:/i.test(request)) { result.externalRequests.push({ label, url: request }); return route.abort() }
      return route.continue()
    })
    page = await context.newPage(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => result.pageErrors.push({ label, message: error.message }))
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push({ label, message: message.text() }) })
    await page.goto(url, { waitUntil: 'load' })
    const title = page.getByText(expectedTitles[0], { exact: true })
    const fiction = page.getByText('虚构教学数据 · 用于理解统计量，不代表真实调查', { exact: true })
    await title.waitFor({ state: 'visible' }); await fiction.waitFor({ state: 'visible' })
    await inViewport(`${label}-page1-title-bounds`, title, viewport)
    await inViewport(`${label}-page1-fiction-bounds`, fiction, viewport)
    await shot(`${label}-01`)
    await nextScene(`${label}-page1`, expectedTitles[1])
    const scene2Title = page.getByText(expectedTitles[1], { exact: true })
    await inViewport(`${label}-page2-title-bounds`, scene2Title, viewport)
    const frame = await visibleFrame('#range'), slider = frame.locator('#range')
    for (const selector of ['#mean', '#median', '#v0', '#v1', '#v2', '#v3', '#v4', '#b0', '#b1', '#b2', '#b3', '#b4', '#reset']) {
      await frame.locator(selector).waitFor({ state: 'visible' })
      await inViewport(`${label}-page2-${selector.slice(1)}-bounds`, frame.locator(selector), viewport)
    }
    const attrs = await slider.evaluate(node => ({ min: node.min, max: node.max, step: node.step, type: node.type }))
    check(`${label}-range-contract`, attrs.type === 'range' && attrs.min === '18' && attrs.max === '90' && attrs.step === '1', attrs)
    let barScale
    async function state(expected, stage) {
      const value = await slider.inputValue(), meanText = (await frame.locator('#mean').innerText()).trim(), medianText = (await frame.locator('#median').innerText()).trim()
      const valueTexts = await Promise.all(Array.from({ length: 5 }, (_, i) => frame.locator(`#v${i}`).innerText()))
      const values = valueTexts.map(number), expectedHeight = expected / 90 * 175
      // Let any authored CSS transition settle before measuring the rendered bar.
      await frame.waitForFunction(height => {
        const node = document.querySelector('#b4')
        return !!node && Math.abs(Number.parseFloat(getComputedStyle(node).height) - height) < 0.5
      }, expectedHeight, { timeout: 5000 })
      const rawHeight = await frame.locator('#b4').evaluate(node => ({ tag: node.tagName.toLowerCase(), height: node.style.height, computedHeight: getComputedStyle(node).height }))
      const box = await frame.locator('#b4').boundingBox(), styleHeight = Number.parseFloat(rawHeight.height)
      const expectedMean = (52 + expected) / 5
      const sorted = [...values].sort((a, b) => a - b)
      check(`${label}-${stage}-value`, Number(value) === expected && values[4] === expected && JSON.stringify(values.slice(0, 4)) === '[10,12,14,16]',
        { value, valueTexts, values })
      check(`${label}-${stage}-statistics`, Math.abs(number(meanText) - expectedMean) < 0.051 && number(medianText) === 14 && sorted[2] === 14
        && /分钟/.test(meanText) && /分钟/.test(medianText) && valueTexts.every(text => /分钟/.test(text)),
      { meanText, medianText, expectedMean, valueTexts })
      check(`${label}-${stage}-bar-style`, rawHeight.tag === 'div' && Number.isFinite(styleHeight) && Math.abs(styleHeight - expectedHeight) < 0.02 && !!box && box.height > 0,
        { ...rawHeight, styleHeight, expectedHeight, box })
      if (barScale === undefined) barScale = box.height / expectedHeight
      check(`${label}-${stage}-bar-render`, Math.abs(box.height - barScale * expectedHeight) <= 1,
        { actualHeight: box.height, scale: barScale, expectedHeight, expectedRenderedHeight: barScale * expectedHeight })
      await inViewport(`${label}-${stage}-bar-bounds`, frame.locator('#b4'), viewport)
    }
    await state(18, 'initial-18')
    await shot(`${label}-02-default`)
    await slider.focus(); await page.keyboard.press('Home'); await state(18, 'home-18')
    await page.keyboard.press('ArrowRight'); await state(19, 'right-19')
    for (let i = 0; i < 51; i++) await page.keyboard.press('ArrowRight')
    await state(70, 'right-70'); await shot(`${label}-02-70`)
    await page.keyboard.press('End'); await state(90, 'end-90')
    await frame.locator('#reset').click(); await state(18, 'reset-18')
    await nextScene(`${label}-page2`, expectedTitles[2])
    const scene3Title = page.getByText(expectedTitles[2], { exact: true })
    const closing = page.getByText('以上为虚构教学数据，不能当作真实通勤调查结论。', { exact: true })
    await scene3Title.waitFor({ state: 'visible' }); await closing.waitFor({ state: 'visible' })
    await inViewport(`${label}-page3-title-bounds`, scene3Title, viewport)
    await inViewport(`${label}-page3-fiction-bounds`, closing, viewport)
    const quiz = await visibleFrame('button[data-answer="a"]'), feedback = quiz.locator('.feedback')
    for (const choice of ['a', 'b', 'c']) {
      const button = quiz.locator(`button[data-answer="${choice}"]`)
      await button.waitFor({ state: 'visible' }); await inViewport(`${label}-answer-${choice}-bounds`, button, viewport)
    }
    await shot(`${label}-03`)
    // Answer identity must match the actual exported source; verify the two
    // expected feedback states, permitting a retry in the same instance.
    await quiz.locator('button[data-answer="b"]').click()
    const wrong = (await feedback.innerText()).trim()
    check(`${label}-wrong-feedback`, wrong.includes('再想一想'), { wrong })
    await inViewport(`${label}-wrong-feedback-bounds`, feedback, viewport)
    await quiz.locator('button[data-answer="a"]').click()
    const right = (await feedback.innerText()).trim()
    check(`${label}-correct-after-wrong`, right.includes('答对了') && right !== wrong, { wrong, right })
    await inViewport(`${label}-correct-feedback-bounds`, feedback, viewport)
    await shot(`${label}-03-feedback`)
  } catch (error) {
    if (page && !page.isClosed()) await shot(`${label}-failure`).catch(() => {})
    throw error
  } finally { await context.close() }
}

try {
  result.sourceSha256 = hash(await readFile(source))
  if (expectedSourceSha256) check('expected-source-version', result.sourceSha256 === expectedSourceSha256.toLowerCase(), { expected: expectedSourceSha256, actual: result.sourceSha256 })
  browser = await chromium.launch({ headless: true }); result.browserVersion = browser.version(); result.initialBrowserPid = await browserPid(browser)
  await runScenario('1440x900', 1440, 900)
  await runScenario('900x650', 900, 650)
  await browser.close(); browser = undefined
  browser = await chromium.launch({ headless: true }); result.coldBrowserPid = await browserPid(browser)
  check('independent-browser-process', result.coldBrowserPid !== result.initialBrowserPid, { initial: result.initialBrowserPid, cold: result.coldBrowserPid })
  await runScenario('cold-900x650', 900, 650)
  check('no-external-network', result.externalRequests.length === 0, result.externalRequests)
  check('no-page-errors', result.pageErrors.length === 0, result.pageErrors)
  check('no-console-errors', result.consoleErrors.length === 0, result.consoleErrors)
  check('source-unchanged', hash(await readFile(source)) === result.sourceSha256, result.sourceSha256)
  result.status = 'passed-functional-awaiting-visual-review'
} catch (error) {
  result.status = 'failed'; result.failure = error instanceof Error ? error.stack : String(error); process.exitCode = 1
  if (page && !page.isClosed()) await shot('failure').catch(() => {})
} finally {
  try {
    result.finalSourceSha256 = hash(await readFile(source))
    result.originalUnchanged = Boolean(result.sourceSha256) && result.finalSourceSha256 === result.sourceSha256
    if (!result.originalUnchanged) { result.status = 'failed'; process.exitCode = 1 }
  } catch (error) { result.originalCheckError = String(error); result.status = 'failed'; process.exitCode = 1 }
  result.finishedAtUtc = new Date().toISOString()
  if (browser) await browser.close().catch(() => {})
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}
