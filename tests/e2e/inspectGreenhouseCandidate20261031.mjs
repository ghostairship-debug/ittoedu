/** Read-only, candidate-specific browser consumer. No model calls, author writes,
 * DOM clicks or forced clicks. The original producer/cold reports stay unchanged. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'

const BENCH = '16e486c9-d8a9-4993-a092-890e21ee6e10', RECORD = 'a39a6f90-99ab-4d9f-be93-020c8088ab1f'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value, null, 2)
const iframeFor = (page, id) => page.locator(`[data-component-object="${id}"] iframe`)
async function visibleClick(page, iframe, element, out) {
  await expect(element).toBeVisible(); await expect(element).toBeEnabled()
  const frame = await iframe.evaluate(node => { const rect = node.getBoundingClientRect(); return {
    x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    offsetWidth: node.offsetWidth, offsetHeight: node.offsetHeight, clientLeft: node.clientLeft, clientTop: node.clientTop,
  } })
  const local = await element.evaluate(node => { const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })
  const point = { x: frame.x + (frame.clientLeft + local.x) * frame.width / frame.offsetWidth,
    y: frame.y + (frame.clientTop + local.y) * frame.height / frame.offsetHeight }
  const topHit = await iframe.evaluate((node, point) => {
    let hit = node.ownerDocument.elementFromPoint(point.x, point.y)
    while (hit?.shadowRoot) { const next = hit.shadowRoot.elementFromPoint(point.x, point.y); if (!next || next === hit) break; hit = next }
    return hit === node
  }, point)
  const childHit = await element.evaluate((node, point) => {
    const hit = node.ownerDocument.elementFromPoint(point.x, point.y); return hit === node || Boolean(hit && node.contains(hit))
  }, local)
  await fs.appendFile(path.join(out, 'pointer-evidence.jsonl'), JSON.stringify({ frame, local, point, topHit, childHit }) + '\n')
  assert(topHit && childHit, 'visible-control-is-obstructed')
  await page.mouse.click(point.x, point.y)
}

assert.equal(process.argv.length, 3, 'one absolute config file required')
const config = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'))
for (const key of ['producerResult', 'out']) assert(path.isAbsolute(config[key]))
const producer = JSON.parse(await fs.readFile(config.producerResult, 'utf8'))
const html = path.join(producer.original, producer.html.relative), glx = path.join(producer.original, producer.document.relative)
assert.equal(sha(await fs.readFile(html)), producer.html.sha256); assert.equal(sha(await fs.readFile(glx)), producer.document.sha256)
await fs.mkdir(config.out, { recursive: true }); assert.deepEqual(await fs.readdir(config.out), [], 'observation output must be new')
const startedAt = Date.now(), findings = [], cases = [], remoteRequests = [], errors = []
let browser, context, page, stage = 'launch', primaryError, report, humanVisible
const checkpoint = async name => { stage = name; await fs.appendFile(path.join(config.out, 'stages.jsonl'), JSON.stringify({ stage, at: Date.now() }) + '\n') }
try {
  browser = await chromium.launch()
  context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 900 } })
  page = await context.newPage(); page.setDefaultTimeout(12_000); page.setDefaultNavigationTimeout(20_000)
  page.on('request', request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  const load = async () => {
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction(() => Boolean(window.coursePlayer || window.__coursePlaybackFailed), undefined, { timeout: 20_000 })
    assert.equal(await page.evaluate(() => window.__coursePlaybackFailed ?? false), false)
    await expect(iframeFor(page, BENCH).contentFrame().locator('[data-record]')).toBeDisabled()
  }
  await load(); await checkpoint('initial-guard')
  if (producer.repair) {
    await checkpoint('preserved-human-content-after-ai')
    const human = producer.repair.human
    const input = JSON.parse(await fs.readFile(path.join(path.dirname(config.producerResult), 'repair-input-author.json'), 'utf8'))
    const replacement = Uint8Array.from(input.model.resources.assets[human.imageAssetId])
    assert.equal(sha(replacement), human.replacementSha256)
    const object = id => page.locator(`[data-component-object="${id}"]`)
    await expect(object(human.titleId)).toBeVisible(); await expect(object(human.titleId)).toContainText(human.titleNote)
    await expect(object(human.descriptionId)).toBeVisible(); await expect(object(human.descriptionId)).toContainText(human.descriptionNote)
    const image = object(human.imageId).locator('img')
    await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true)
    // Compare the actually decoded visible image, without fetching a blob URL
    // or relaxing opaque-frame CSP. The reference is the verified human PNG.
    const pixels = await image.evaluate(async (node, bytes) => {
      const expected = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
      try {
        const canvas = document.createElement('canvas'); canvas.width = expected.width; canvas.height = expected.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('pixel-comparison-canvas-unavailable')
        context.drawImage(expected, 0, 0); const reference = context.getImageData(0, 0, canvas.width, canvas.height).data
        context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(node, 0, 0)
        const actual = context.getImageData(0, 0, canvas.width, canvas.height).data
        let differingBytes = 0; for (let index = 0; index < reference.length; index++) if (reference[index] !== actual[index]) differingBytes++
        return { width: node.naturalWidth, height: node.naturalHeight, expectedWidth: expected.width, expectedHeight: expected.height,
          comparedBytes: reference.length, differingBytes }
      } finally { expected.close() }
    }, [...replacement])
    assert.equal(pixels.width, pixels.expectedWidth); assert.equal(pixels.height, pixels.expectedHeight); assert.equal(pixels.differingBytes, 0)
    humanVisible = { title: await object(human.titleId).innerText(), description: await object(human.descriptionId).innerText(),
      descriptionBounds: await object(human.descriptionId).boundingBox(), imageBounds: await image.boundingBox(), pixels,
      imageSourceSha256: human.replacementSha256, exactAuthorGeometryPreserved: producer.repairAuthor?.authorPreserved === true }
    assert.equal(humanVisible.exactAuthorGeometryPreserved, true)
  }
  await page.screenshot({ path: path.join(config.out, '01-initial.png') })
  // The authored document explicitly enables ordinary keyboard navigation.
  // Probe it before focusing any input, then reset by a real page reload.
  const keyboard = []
  for (const key of ['ArrowRight', 'PageDown']) {
    await page.mouse.click(20, 20); await page.keyboard.press(key)
    const entered = await expect(iframeFor(page, RECORD)).toBeVisible({ timeout: 2000 }).then(() => true, () => false)
    keyboard.push({ key, enteredBeforeExecution: entered })
    if (entered) {
      const record = iframeFor(page, RECORD).contentFrame()
      const visible = {
        status: await record.locator('[data-status]').innerText(),
        initial: await record.locator('[data-initial]').innerText(),
        used: await record.locator('[data-used]').innerText(),
        remaining: await record.locator('[data-remaining]').innerText(),
        detail: await record.locator('[data-detail]').innerText(),
      }
      const lockedPlaceholder = visible.status.includes('尚未解锁') && visible.initial === '60 L' &&
        visible.used === '—' && visible.remaining === '—' && visible.detail.includes('这里才会显示真实结果')
      keyboard[keyboard.length - 1] = { key, enteredBeforeExecution: entered, lockedPlaceholder, visible }
      if (!lockedPlaceholder) findings.push({ code: 'handoff-shows-result-before-execution', key, visible })
      await page.screenshot({ path: path.join(config.out, '02-keyboard-before-execution.png') })
      break
    }
  }
  await load()
  const execute = async used => {
    const iframe = iframeFor(page, BENCH), frame = iframe.contentFrame(), slider = frame.locator('[data-amount]')
    await visibleClick(page, iframe, slider, config.out)
    await page.keyboard.press('Home')
    for (let count = 0; count < used / 10; count++) await page.keyboard.press('ArrowRight')
    await expect(slider).toHaveValue(String(used)); await expect(frame.locator('[data-selected]')).toHaveText(`${used} L`)
    await visibleClick(page, iframe, frame.locator('[data-run]'), config.out)
    await expect(frame.locator('[data-result]')).toHaveText(`上次执行：用水 ${used} L · 余量 ${60 - used} L`)
    await expect(frame.locator('[data-record]')).toBeEnabled()
    await visibleClick(page, iframe, frame.locator('[data-record]'), config.out)
    const record = iframeFor(page, RECORD).contentFrame()
    await expect(record.locator('[data-initial]')).toHaveText('60 L')
    await expect(record.locator('[data-used]')).toHaveText(`${used} L`)
    await expect(record.locator('[data-remaining]')).toHaveText(`${60 - used} L`)
    await expect(record.locator('[data-detail]')).toContainText(`60 − ${used} = ${60 - used} L`)
    cases.push({ selected: used, initial: 60, used, remaining: 60 - used, actualControlsAndHandoff: true })
  }
  const back = async used => {
    const iframe = iframeFor(page, RECORD)
    await visibleClick(page, iframe, iframe.contentFrame().locator('[data-back]'), config.out)
    const frame = iframeFor(page, BENCH).contentFrame()
    await expect(frame.locator('[data-amount]')).toHaveValue(String(used))
    await expect(frame.locator('[data-result]')).toContainText(`用水 ${used} L · 余量 ${60 - used} L`)
  }
  for (const used of [0, 20, 50]) { await checkpoint(`execute-${used}`); await execute(used); await back(used) }
  await execute(50); await page.screenshot({ path: path.join(config.out, '03-updated-handoff.png') })
  await checkpoint('reset-from-record')
  const recordFrame = iframeFor(page, RECORD)
  await visibleClick(page, recordFrame, recordFrame.contentFrame().locator('[data-reset]'), config.out)
  let bench = iframeFor(page, BENCH).contentFrame()
  await expect(bench.locator('[data-amount]')).toHaveValue('0'); await expect(bench.locator('[data-record]')).toBeDisabled()
  await expect(bench.locator('[data-result]')).toContainText('尚未执行')
  await checkpoint('execute-60-after-reset'); await execute(60); await back(60)
  const benchFrame = iframeFor(page, BENCH)
  await visibleClick(page, benchFrame, benchFrame.contentFrame().locator('[data-reset]'), config.out)
  bench = benchFrame.contentFrame()
  await expect(bench.locator('[data-level]')).toHaveText('60 L'); await expect(bench.locator('[data-record]')).toBeDisabled()
  await expect(bench.locator('[data-amount]')).toHaveValue('0'); await expect(bench.locator('[data-result]')).toContainText('尚未执行')
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, [])
  assert.equal(sha(await fs.readFile(html)), producer.html.sha256); assert.equal(sha(await fs.readFile(glx)), producer.document.sha256)
  report = { status: findings.length ? 'needs-repair' : 'behavior-verified', findings, keyboard, cases, resetFromBothScenes: true,
    originalFilesUnchanged: true, htmlSha256: producer.html.sha256, glxSha256: producer.document.sha256,
    ...(humanVisible ? { humanVisibleAfterAi: humanVisible, experimentKind: 'review-guided-follow-up' } : {}),
    modelRequests: 0, nativeEditingAndSingleModuleReviewPending: !humanVisible || producer.repairAuthor?.singleSharedBusinessOwner !== true,
    trialStartedAt: producer.trialStartedAt, firstQualifiedAt: null }
} catch (error) {
  primaryError = error
  if (page) await page.screenshot({ path: path.join(config.out, 'failure.png'), timeout: 5000 }).catch(() => {})
  report = { status: 'consumer-failed', stage, error: String(error), findings, cases, modelRequests: 0, firstQualifiedAt: null }
} finally {
  const cleanupErrors = []
  for (const [name, work] of [['context', () => context?.close()], ['browser', () => browser?.close()]]) {
    let timer
    try { await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name}-cleanup-timeout`)), 10_000) })]) }
    catch (error) { cleanupErrors.push(String(error)) } finally { clearTimeout(timer) }
  }
  await fs.writeFile(path.join(config.out, 'result.json'), json({ ...report, startedAt, finishedAt: Date.now(), stage, errors, remoteRequests, cleanupErrors }))
  console.log(JSON.stringify({ status: report.status, findings: findings.map(item => item.code), cases: cases.length, modelRequests: 0, report: path.join(config.out, 'result.json') }))
  process.exitCode = primaryError || cleanupErrors.length ? 1 : findings.length ? 2 : 0
}
