import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { expect, test } from '@playwright/test'
import type { LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import { createCourseProjectArchive, type CourseProjectArchiveData } from '../../src/renderer/project/courseProjectArchive'
import {
  FIXTURE_IDS, closeNativeEditor, launchNativeEditor, nativeRecords, preserveNativeFailure, readSaved,
  recordEvidence, saveStage, selectLayer, slideItems, titleItem, writeNativeLesson, type NativeCli, type NativeRun,
} from './r18NativeAuthoringFixture'
import { chat, configureRemainingChat } from './r18NativeAuthoringRemainingFixture'

const productRoot = resolve(__dirname, '..', '..')
const adapter = (process.env.COURSEWARE_R18_NATIVE_CLI ?? 'codex') as NativeCli
const model = process.env.COURSEWARE_R18_NATIVE_MODEL ?? ''
const effort = process.env.COURSEWARE_R18_NATIVE_EFFORT ?? ''
const gate = process.env.COURSEWARE_R18_SHORT_PATH_GATE ?? ''
const prompt = '把这一页排整齐：标题在页面上方居中，红色图片和蓝色正方形放在标题下方，顶端对齐、左右留白相同，中间留出空隙；保持它们的大小、颜色和内容不变。'
const deadlineMs = 20 * 60_000
const ids = { title: FIXTURE_IDS.title, image: FIXTURE_IDS.image, square: FIXTURE_IDS.square }

function currentTask(run: NativeRun) {
  for (const record of nativeRecords(run)) {
    const task = record.tasks.find(task => task.goal === prompt)
    if (task) return { record, task }
  }
  return undefined
}

async function mountedLayout(run: NativeRun, originalTitle: string, screenshotName?: string) {
  const geometry = await run.page.evaluate(({ ids, originalTitle }) => {
    const elements = Object.fromEntries(Object.entries(ids).map(([kind, id]) => [kind,
      document.querySelector(`[data-slide-layer-item="${id}"]`)])) as Record<keyof typeof ids, HTMLElement | null>
    const stage = elements.title?.closest<HTMLElement>('.slide-published-adapter')
    if (!stage || !elements.title || !elements.image || !elements.square) return { correct: false, reason: 'original-layers-not-mounted', layout: null, css: null }
    const canvas = stage.getBoundingClientRect(), width = stage.offsetWidth, height = stage.offsetHeight
    if (!canvas.width || !canvas.height || !width || !height) return { correct: false, reason: 'page-not-visible', layout: null, css: null }
    const css = Object.fromEntries(Object.entries(elements).map(([kind, element]) => {
      const box = element!.getBoundingClientRect()
      return [kind, { x: box.x, y: box.y, width: box.width, height: box.height }]
    })) as Record<keyof typeof ids, { x: number; y: number; width: number; height: number }>
    const scaleX = canvas.width / width, scaleY = canvas.height / height
    const logical = (box: { x: number; y: number; width: number; height: number }) => ({
      x: (box.x - canvas.x) / scaleX, y: (box.y - canvas.y) / scaleY, width: box.width / scaleX, height: box.height / scaleY,
    })
    const title = logical(css.title), image = logical(css.image), square = logical(css.square)
    // Text glyph ranges verify actual title alignment, not just its outer frame.
    const walker = document.createTreeWalker(elements.title, NodeFilter.SHOW_TEXT), ranges: DOMRect[] = []
    while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) {
      const range = document.createRange(); range.selectNodeContents(walker.currentNode)
      ranges.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0))
    }
    const glyphCenter = ranges.length ? ((Math.min(...ranges.map(rect => rect.left)) + Math.max(...ranges.map(rect => rect.right))) / 2 - canvas.x) / scaleX : null
    const [left, right] = [image, square].sort((a, b) => a.x - b.x)
    const leftMargin = left!.x, rightMargin = width - right!.x - right!.width
    const gap = right!.x - left!.x - left!.width, titleGap = Math.min(image.y, square.y) - title.y - title.height
    const tolerance = 2, minimumGap = 8
    const visible = Object.values(elements).every(element => {
      const style = getComputedStyle(element!)
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0
    })
    const checks = {
      visible, originalTitle: elements.title.textContent?.trim() === originalTitle,
      titleFrameCentered: Math.abs(title.x + title.width / 2 - width / 2) <= tolerance,
      titleGlyphsCentered: glyphCenter !== null && Math.abs(glyphCenter - width / 2) <= tolerance,
      titleAbove: title.y >= -tolerance && title.y + title.height / 2 < height / 2 && titleGap >= minimumGap,
      topAligned: Math.abs(image.y - square.y) <= tolerance,
      equalOuterMargins: leftMargin > tolerance && rightMargin > tolerance && Math.abs(leftMargin - rightMargin) <= tolerance,
      visibleGap: gap >= minimumGap,
      withinPage: [title, image, square].every(box => box.x >= -tolerance && box.y >= -tolerance
        && box.x + box.width <= width + tolerance && box.y + box.height <= height + tolerance),
    }
    return { correct: Object.values(checks).every(Boolean), checks, reason: null,
      layout: { page: { width, height }, title, image, square, glyphCenter, leftMargin, rightMargin, gap, titleGap,
        toleranceLogicalPx: tolerance, minimumVisibleGapLogicalPx: minimumGap }, css }
  }, { ids, originalTitle })
  if (!geometry.correct || !geometry.css) return { correct: false, geometry, pixels: null }
  // Whole-window capture avoids locator.screenshot's selected-layer stability
  // wait; crop the actual painted image and shape at their current DOM bounds.
  const viewport = await run.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const screenshot = await run.page.screenshot({ animations: 'allow' })
  const meta = await sharp(screenshot).metadata(), scaleX = meta.width! / viewport.width, scaleY = meta.height! / viewport.height
  const pixels = []
  for (const kind of ['image', 'square'] as const) {
    const box = geometry.css[kind]
    const left = Math.max(0, Math.floor(box.x * scaleX)), top = Math.max(0, Math.floor(box.y * scaleY))
    const width = Math.min(meta.width! - left, Math.ceil(box.width * scaleX)), height = Math.min(meta.height! - top, Math.ceil(box.height * scaleY))
    if (width <= 0 || height <= 0) return { correct: false, geometry, pixels, reason: `${kind}-not-in-captured-frame` }
    const data = await sharp(screenshot).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer()
    let red = 0, blue = 0
    for (let offset = 0; offset < data.length; offset += 4) {
      const [r, g, b, a] = data.subarray(offset, offset + 4)
      if (a! < 200) continue
      if (r! > 150 && r! > g! * 1.5 && r! > b! * 1.5) red++
      if (b! > 150 && b! > r! * 1.5 && b! > g! * 1.15) blue++
    }
    pixels.push({ kind, width, height, red, blue, correct: (kind === 'image' ? red : blue) > width * height * .2 })
  }
  const correct = pixels.every(sample => sample.correct)
  if (correct && screenshotName) writeFileSync(join(run.runRoot, `${screenshotName}.png`), screenshot)
  return { correct, geometry, pixels }
}

function assertPreserved(before: CourseProjectArchiveData, after: CourseProjectArchiveData) {
  const original = slideItems(before.project), changed = slideItems(after.project)
  expect(changed.map(item => item.layerItemId)).toEqual(original.map(item => item.layerItemId))
  const changedIds = original.filter(item => JSON.stringify(changed.find(next => next.layerItemId === item.layerItemId)) !== JSON.stringify(item)).map(item => item.layerItemId)
  expect(changedIds.length, 'This is a relationship edit across at least two existing objects').toBeGreaterThanOrEqual(2)
  const normalized = structuredClone(after.project)
  for (const item of slideItems(normalized)) {
    const prior = original.find(value => value.layerItemId === item.layerItemId)!
    // Only position is movable. Frame mode, width and height stay exact.
    item.frame.x = prior.frame.x; item.frame.y = prior.frame.y
  }
  // Centering may change paragraph alignment, but no title text, font, size,
  // color, runs, image bytes or other content is exempted from preservation.
  titleItem(normalized).content.data.style.align = titleItem(before.project).content.data.style.align
  normalized.revision = before.project.revision; normalized.updatedAt = before.project.updatedAt
  expect(normalized).toEqual(before.project)
  expect(after.assetFiles).toEqual(before.assetFiles)
  expect(after.componentFiles).toEqual(before.componentFiles)
  return changedIds
}

function assertFinish(record: LocalAgentRecordV2, taskId: string, baselineRevision: number, changedIds: string[]) {
  const task = record.tasks.find(task => task.taskId === taskId)!
  const results = record.hostResults.filter(result => result.taskId === taskId && result.status === 'committed')
  expect(results).toHaveLength(1)
  const result = results[0]!
  expect(result).toMatchObject({ beforeRevision: baselineRevision, afterRevision: baselineRevision + 1, afterCommit: { action: 'finish' } })
  expect(result.receipts).toHaveLength(1)
  const affected = result.receipts[0]!.affected
  expect(affected.every(effect => effect.operation === 'updated' && Object.values(ids).some(id => id === effect.id))).toBe(true)
  expect([...new Set(affected.map(effect => effect.id))].sort()).toEqual([...changedIds].sort())
  expect(task).toMatchObject({ status: 'completed', committedResultIds: [result.resultId], execution: { turnCount: 1 },
    completion: { version: 1, resultId: result.resultId, outcome: 'modified' } })
  const events = record.events.filter(event => event.taskId === taskId), runIds = [...new Set(events.map(event => event.runId))]
  const nativeTurnIds = [...new Set(events.map(event => event.nativeTurnId).filter(Boolean))]
  expect(runIds).toHaveLength(1)
  expect(nativeTurnIds.length, 'These are native transport IDs, not internal model-request counts').toBeLessThanOrEqual(1)
  expect(record.externalSessionId).toBeTruthy()
  const configuration = events.filter(event => event.kind === 'configuration').at(-1)
  expect(configuration).toBeDefined()
  expect(configuration!.capabilities.current.model).toBe(model)
  if (effort !== 'default') expect(configuration!.capabilities.current.effort).toBe(effort)
  return { task, result, runIds, nativeTurnIds, configuration, usage: events.filter(event => event.kind === 'usage'), internalModelRequests: null }
}

test(`R18 short path ${adapter} layout auto: page relationships, preserved content and one finish`, async ({}, testInfo) => {
  test.skip(!gate, 'Paid real CLI gate closed; --list is discovery, not a passed run.')
  expect(gate).toBe('short-path')
  expect(['codex', 'claude', 'opencode']).toContain(adapter)
  expect(model, 'Freeze the actual model before this one real sample').not.toBe('')
  expect(effort, 'Freeze the effort or explicit default').not.toBe('')
  test.setTimeout(deadlineMs + 180_000)
  const runRoot = join(productRoot, 'output', 'r18-short-path', `${adapter}-layout-auto-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson'), baseline = await writeNativeLesson(projectPath)
  // Fixed text bounds make this a strict size-preservation layout scenario.
  // The separate text samples cover the supported automatic-height behavior.
  titleItem(baseline.project).content.data.style.overflow = 'fixed'
  writeFileSync(projectPath, createCourseProjectArchive(baseline))
  const originalTitle = titleItem(baseline.project).content.data.text
  const metrics: Record<string, unknown> = { scenario: { kind: 'layout', apply: 'auto' }, adapter, requestedModel: model, requestedEffort: effort,
    prompt, status: 'running', serviceTier: null, serviceTierEvidence: 'not-exposed-by-formal-configuration-projection',
    coldOrWarm: 'fresh-application-and-native-session', traceMode: testInfo.project.use.trace, samplingIntervalMs: 200,
    hiddenWindow: true, userWaitMs: 0, internalModelRequests: null,
    timingBoundary: 'UI Send click to first sampled correct whole-page DOM geometry and painted original colors; task terminal is sampled independently.' }
  const persist = () => writeFileSync(join(runRoot, 'result.json'), JSON.stringify(metrics, null, 2))
  persist()
  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(productRoot, runRoot, projectPath)
    await selectLayer(run.page, FIXTURE_IDS.title)
    await configureRemainingChat(run, adapter, model, effort)
    await chat(run).getByLabel('本轮引用', { exact: true }).selectOption('page')
    await chat(run).getByLabel('意图', { exact: true }).selectOption('edit')
    await chat(run).getByLabel('应用方式', { exact: true }).selectOption('auto')
    metrics.beforeMounted = await mountedLayout(run, originalTitle)
    expect((metrics.beforeMounted as { correct: boolean }).correct).toBe(false)
    await run.page.screenshot({ path: join(runRoot, 'before-layout.png'), animations: 'allow' })
    await chat(run).getByLabel('发送给创作助手', { exact: true }).fill(prompt)
    const startedAt = Date.now(); metrics.startedAt = startedAt
    await chat(run).getByRole('button', { name: '发送', exact: true }).click()
    let firstUsableAt: number | undefined, completedAt: number | undefined, taskId: string | undefined
    while (Date.now() - startedAt < deadlineMs) {
      const current = currentTask(run)
      if (current) {
        taskId = current.task.taskId
        if (['failed', 'cancelled', 'partial'].includes(current.task.status)) throw new Error(`Task ended as ${current.task.status}`)
        if (current.task.status === 'completed' && !completedAt) { completedAt = Date.now(); metrics.taskCompletedMs = completedAt - startedAt }
        if (current.record.hostResults.some(result => result.taskId === taskId && result.status === 'committed')) {
          if (metrics.receiptObservedMs === undefined) metrics.receiptObservedMs = Date.now() - startedAt
          if (!firstUsableAt) {
            const mounted = await mountedLayout(run, originalTitle, 'first-usable-ui')
            metrics.lastMounted = mounted
            if (mounted.correct) { firstUsableAt = Date.now(); metrics.firstMountedLayoutMs = firstUsableAt - startedAt; metrics.mounted = mounted }
          }
        }
        persist()
        if (firstUsableAt && completedAt) break
        if (completedAt && Date.now() - completedAt > 10_000) throw new Error('The completed layout still fails the actual whole-page geometry or painted-color checks')
      }
      const alerts = await chat(run).getByRole('alert').allTextContents()
      if (alerts.length) throw new Error(alerts.join('\n'))
      if (await chat(run).locator('section.native-agent-question').count()) throw new Error('This specified layout requested native user input; keep this failed unattended sample without inventing answers.')
      await run.page.waitForTimeout(200)
    }
    expect(firstUsableAt).toBeTruthy(); expect(completedAt).toBeTruthy(); expect(taskId).toBeTruthy()
    await expect(chat(run).locator('.chat-scroll > [role="status"]')).toHaveText('修改已应用，实际结果已保存')
    await expect(chat(run).getByRole('button', { name: '停止', exact: true })).toBeDisabled()
    const saved = await saveStage(run, 'correct-result'), changedIds = assertPreserved(baseline, saved)
    metrics.changedExistingItemIds = changedIds
    const completed = currentTask(run)!
    metrics.finish = assertFinish(completed.record, taskId!, baseline.project.revision, changedIds)
    // Promote the sampled timestamp only after the saved source/resources and
    // single receipt prove that this mounted layout was actually correct.
    metrics.firstUsableMs = firstUsableAt! - startedAt
    await recordEvidence(run, 'completed')
    await run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect(await saveStage(run, 'one-undo')).toEqual(baseline)
    await run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect(await saveStage(run, 'one-redo')).toEqual(saved)
    expect((await mountedLayout(run, originalTitle, 'redone-layout')).correct).toBe(true)
    expect(run.pageErrors).toEqual([])
    await closeNativeEditor(run); run = undefined
    run = await launchNativeEditor(productRoot, runRoot, projectPath)
    expect(readSaved(projectPath)).toEqual(saved)
    expect((await mountedLayout(run, originalTitle, 'reopened-layout')).correct).toBe(true)
    const reopened = currentTask(run)!
    expect(assertFinish(reopened.record, taskId!, baseline.project.revision, changedIds)).toEqual(metrics.finish)
    await recordEvidence(run, 'reopened')
    expect(run.pageErrors).toEqual([])
    metrics.status = 'engineering-checks-passed-awaiting-visual-review'
    metrics.visualReview = 'Review before, first usable, one Undo/Redo and reopened page images. This validates one relationship edit, not a latency distribution or S3 acceptance.'
  } catch (error) {
    metrics.status = 'failed'; metrics.failure = error instanceof Error ? error.stack : String(error)
    if (run) {
      await recordEvidence(run, 'failure').catch(() => {})
      await run.page.screenshot({ path: join(runRoot, 'failure.png') }).catch(() => {})
      try { metrics.failureSavedRevision = await preserveNativeFailure(run) } catch (saveError) { metrics.failureSaveError = String(saveError) }
    }
    throw error
  } finally {
    metrics.finishedAt = Date.now(); persist()
    if (run) await closeNativeEditor(run)
    await testInfo.attach('short-path-layout-result', { path: join(runRoot, 'result.json'), contentType: 'application/json' })
  }
})

test.describe.configure({ mode: 'serial', retries: 0 })
