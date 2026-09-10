import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { expect, test } from '@playwright/test'
import type { LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import {
  FIXTURE_IDS, NATIVE_PROMPTS, closeNativeEditor, imageItem, launchNativeEditor, nativeRecords, preserveNativeFailure,
  readSaved, recordEvidence, saveStage, selectLayer, slideItems, titleItem, verifyGreenImage, writeNativeLesson,
  type NativeCli, type NativeRun,
} from './r18NativeAuthoringFixture'

const productRoot = resolve(__dirname, '..', '..')
const adapter = (process.env.COURSEWARE_R18_NATIVE_CLI ?? 'codex') as NativeCli
const model = process.env.COURSEWARE_R18_NATIVE_MODEL ?? ''
const effort = process.env.COURSEWARE_R18_NATIVE_EFFORT ?? ''
const gate = process.env.COURSEWARE_R18_SHORT_PATH_GATE ?? ''
const deadlineMs = 20 * 60_000
const scenarios = [{ kind: 'text', apply: 'auto' }, { kind: 'image', apply: 'auto' }, { kind: 'text', apply: 'preview' }] as const

function currentTask(run: NativeRun, prompt: string) {
  for (const record of nativeRecords(run)) {
    const task = record.tasks.find(task => task.goal === prompt)
    if (task) return { record, task }
  }
  return undefined
}

async function configure(run: NativeRun, apply: 'auto' | 'preview') {
  await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
  const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
  await chat.getByLabel('CLI', { exact: true }).selectOption(adapter)
  const models = chat.getByLabel('模型', { exact: true })
  await expect(models).toBeEnabled({ timeout: 60_000 })
  expect(await models.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toContain(model)
  await models.selectOption(model)
  await expect(models).toBeEnabled()
  const efforts = chat.getByLabel('强度', { exact: true })
  if (effort !== 'default') { await expect(efforts).toBeEnabled(); await efforts.selectOption(effort) }
  else if (await efforts.isEnabled()) await efforts.selectOption('')
  await chat.getByLabel('意图', { exact: true }).selectOption('edit')
  await chat.getByLabel('应用方式', { exact: true }).selectOption(apply)
  // Keep the mixed page in the request while focusing the actual UI selection.
  await chat.getByLabel('本轮引用', { exact: true }).selectOption('page')
  return chat
}

async function correctMountedResult(run: NativeRun, kind: 'text' | 'image') {
  const layer = run.page.locator(`[data-slide-layer-item="${kind === 'text' ? FIXTURE_IDS.title : FIXTURE_IDS.image}"]`).first()
  if (!await layer.isVisible()) return { correct: false }
  if (kind === 'text') return layer.evaluate(element => {
    const stage = element.closest('.slide-published-adapter')
    if (!stage) return { correct: false }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), sizes: number[] = []
    while (walker.nextNode()) if (walker.currentNode.textContent?.trim() && walker.currentNode.parentElement) {
      sizes.push(Number.parseFloat(getComputedStyle(walker.currentNode.parentElement).fontSize))
    }
    const bounds = element.getBoundingClientRect(), canvas = stage.getBoundingClientRect()
    const centered = Math.abs(bounds.x + bounds.width / 2 - canvas.x - canvas.width / 2) < 4
    return { correct: element.textContent?.trim() === '简谐运动' && sizes.length > 0 && Math.min(...sizes) > 32 && centered,
      text: element.textContent, fontSizes: sizes, centered,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }
  })
  // Sample the actually painted frame without waiting for the editor's selected
  // layer bounds to settle across its resize observers and selection affordances.
  const box = await layer.boundingBox()
  if (!box) return { correct: false }
  const viewport = await run.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const frame = await run.page.screenshot({ animations: 'allow' })
  const metadata = await sharp(frame).metadata()
  const scaleX = metadata.width! / viewport.width, scaleY = metadata.height! / viewport.height
  const left = Math.max(0, Math.floor(box.x * scaleX)), top = Math.max(0, Math.floor(box.y * scaleY))
  const width = Math.min(metadata.width! - left, Math.ceil(box.width * scaleX))
  const height = Math.min(metadata.height! - top, Math.ceil(box.height * scaleY))
  if (width <= 0 || height <= 0) return { correct: false }
  const png = await sharp(frame).extract({ left, top, width, height }).toBuffer()
  const pixels = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let red = 0, green = 0
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const [r, g, b, a] = pixels.data.subarray(offset, offset + 4)
    if (a! < 200) continue
    if (r! > 150 && r! > g! * 1.5 && r! > b! * 1.5) red++
    if (g! > 100 && g! > r! * 1.35 && g! > b! * 1.2) green++
  }
  const correct = green > pixels.info.width * pixels.info.height * .2 && red < green * .02
  if (correct) writeFileSync(join(run.runRoot, 'first-usable-layer.png'), png)
  return { correct, red, green, width: pixels.info.width, height: pixels.info.height }
}

function assertDurableFinish(record: LocalAgentRecordV2, taskId: string) {
  const task = record.tasks.find(task => task.taskId === taskId)!
  const results = record.hostResults.filter(result => result.taskId === taskId && result.status === 'committed')
  expect(results, 'A precise local edit commits exactly one transaction').toHaveLength(1)
  const result = results[0]!
  expect(result).toMatchObject({ afterCommit: { action: 'finish' }, beforeRevision: 0, afterRevision: 1 })
  expect(result.receipts).toHaveLength(1)
  expect(task).toMatchObject({ status: 'completed', committedResultIds: [result.resultId],
    completion: { version: 1, resultId: result.resultId, outcome: 'modified' }, execution: { turnCount: 1 } })
  const events = record.events.filter(event => event.taskId === taskId)
  const turns = new Set(events.map(event => event.nativeTurnId).filter(Boolean))
  const runs = new Set(events.map(event => event.runId))
  expect(runs.size, 'No host-feedback/summarization run starts after finish').toBe(1)
  expect(turns.size, 'Native turn IDs are transport evidence, not internal model-request counts').toBeLessThanOrEqual(1)
  const configuration = events.filter(event => event.kind === 'configuration').at(-1)
  expect(record.externalSessionId).toBeTruthy()
  expect(configuration?.kind).toBe('configuration')
  if (configuration?.kind === 'configuration') {
    expect(configuration.capabilities.current.model).toBe(model)
    if (effort !== 'default') expect(configuration.capabilities.current.effort).toBe(effort)
  }
  return { task, result, nativeTurnIds: [...turns], runIds: [...runs], configuration,
    usage: events.filter(event => event.kind === 'usage'), internalModelRequests: null }
}

for (const scenario of scenarios) test(`R18 short path ${adapter} ${scenario.kind} ${scenario.apply}: first usable and finish without another native turn`, async ({}, testInfo) => {
  test.skip(!gate, 'Paid real CLI gate closed; --list is discovery, not a passed run.')
  expect(gate).toBe('short-path')
  expect(['codex', 'claude', 'opencode']).toContain(adapter)
  expect(model, 'Freeze the actual model before this one real sample').not.toBe('')
  expect(effort, 'Freeze the effort or explicit default').not.toBe('')
  test.setTimeout(deadlineMs + 180_000)
  const runRoot = join(productRoot, 'output', 'r18-short-path', `${adapter}-${scenario.kind}-${scenario.apply}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson')
  let baseline = await writeNativeLesson(projectPath)
  if (scenario.kind === 'image') {
    const surface = baseline.project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Slide fixture required')
    surface.scenes[0]!.layerItems.push({ ...structuredClone(imageItem(baseline.project)), layerItemId: 'unselected-shared-image',
      label: '共享同一原图的另一个实例', order: 3, frame: { mode: 'absolute', x: 620, y: 405, width: 150, height: 100 } })
    writeFileSync(projectPath, createCourseProjectArchive(baseline))
    baseline = readSaved(projectPath)
  }
  const prompt = scenario.kind === 'text' ? NATIVE_PROMPTS.T04 : NATIVE_PROMPTS.T02
  const metrics: Record<string, unknown> = { scenario, adapter, requestedModel: model, requestedEffort: effort,
    serviceTier: null, serviceTierEvidence: 'not-exposed-by-formal-configuration-projection',
    coldOrWarm: 'fresh-application-and-native-session', prompt, status: 'running',
    traceMode: testInfo.project.use.trace,
    timingBoundary: 'UI Send click to first sampled correct mounted result; save/reopen and pixel checks validate that result afterwards.',
    samplingIntervalMs: 200, hiddenWindow: true, userWaitMs: 0, internalModelRequests: null }
  const persist = () => writeFileSync(join(runRoot, 'result.json'), JSON.stringify(metrics, null, 2))
  persist()
  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(productRoot, runRoot, projectPath)
    await selectLayer(run.page, scenario.kind === 'text' ? FIXTURE_IDS.title : FIXTURE_IDS.image)
    const chat = await configure(run, scenario.apply)
    await chat.getByLabel('发送给创作助手', { exact: true }).fill(prompt)
    const startedAt = Date.now()
    metrics.startedAt = startedAt
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    let firstUsableAt: number | undefined, completedAt: number | undefined, previewReadyAt: number | undefined
    let taskId: string | undefined
    while (Date.now() - startedAt < deadlineMs) {
      const alerts = await chat.getByRole('alert').allTextContents()
      if (alerts.length) throw new Error(alerts.join('\n'))
      if (await chat.locator('section.native-agent-question').count()) throw new Error('This precise edit unexpectedly needs native user input; retain the question as a failed timing sample.')
      const current = currentTask(run, prompt)
      if (current) {
        taskId = current.task.taskId
        if (['failed', 'cancelled', 'partial'].includes(current.task.status)) throw new Error(`Task ended as ${current.task.status}`)
        if (current.task.status === 'completed' && !completedAt) {
          completedAt = Date.now(); metrics.taskCompletedMs = completedAt - startedAt
        }
        if (scenario.apply === 'preview' && !previewReadyAt && current.task.status === 'awaiting-apply') {
          const apply = chat.getByRole('button', { name: '应用候选', exact: true })
          if (await apply.isEnabled()) {
            previewReadyAt = Date.now(); metrics.previewReadyMs = previewReadyAt - startedAt
            expect(current.record.hostResults.filter(result => result.taskId === taskId && result.status === 'committed')).toHaveLength(0)
            expect(current.task).not.toHaveProperty('completion')
            expect(readSaved(projectPath).project.revision).toBe(0)
            const beforeImage = chat.getByAltText('发送请求时的课件画面', { exact: true })
            await expect.poll(() => beforeImage.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true)
            await expect(chat.getByTestId('generation-candidate-player')).toHaveAttribute('data-candidate-ready', 'true')
            const previewViews = []
            for (const [name, locator] of [
              ['before', beforeImage], ['candidate', chat.locator('.generation-candidate-preview__viewport')],
            ] as const) {
              await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
              const view = await locator.evaluate(element => {
                const target = element.getBoundingClientRect(), scroll = element.closest('.chat-scroll')!.getBoundingClientRect()
                const left = Math.max(0, target.left, scroll.left), top = Math.max(0, target.top, scroll.top)
                const right = Math.min(innerWidth, target.right, scroll.right), bottom = Math.min(innerHeight, target.bottom, scroll.bottom)
                return { x: left, y: top, width: right - left, height: bottom - top,
                  targetWidth: target.width, targetHeight: target.height, scrollHeight: scroll.height }
              })
              expect(view.width, 'The preview must be horizontally readable').toBeGreaterThanOrEqual(view.targetWidth - 2)
              expect(view.height, 'User scrolling must expose the preview within the available chat viewport').toBeGreaterThanOrEqual(Math.min(view.targetHeight, view.scrollHeight) - 2)
              await run.page.screenshot({ path: join(runRoot, `preview-${name}-visible.png`),
                clip: { x: view.x, y: view.y, width: view.width, height: view.height }, animations: 'allow' })
              previewViews.push({ name, ...view })
            }
            metrics.previewViews = previewViews
            await apply.scrollIntoViewIfNeeded()
            await expect(apply).toBeInViewport()
            await run.page.screenshot({ path: join(runRoot, 'awaiting-apply.png') })
            const appliedAt = Date.now(); metrics.userWaitMs = appliedAt - previewReadyAt
            metrics.userWaitSource = 'test clicks after verifying the real preview boundary'
            await apply.click()
          }
        }
        if (current.record.hostResults.some(result => result.taskId === taskId && result.status === 'committed')) {
          if (metrics.receiptObservedMs === undefined) metrics.receiptObservedMs = Date.now() - startedAt
          if (!firstUsableAt) {
            const mounted = await correctMountedResult(run, scenario.kind)
            metrics.lastMounted = mounted
            if (mounted.correct) {
              firstUsableAt = Date.now(); metrics.firstUsableMs = firstUsableAt - startedAt; metrics.mounted = mounted
              await run.page.screenshot({ path: join(runRoot, 'first-usable-ui.png'), animations: 'allow' })
            }
          }
        }
        persist()
        if (firstUsableAt && completedAt) break
        if (completedAt && Date.now() - completedAt > 10_000) throw new Error('The task reports completion but the mounted result is still incorrect after the normal UI paint window')
      }
      await run.page.waitForTimeout(200)
    }
    expect(firstUsableAt, 'A real mounted correct result must appear within the fixed task deadline').toBeTruthy()
    expect(completedAt, 'The persisted task must finish within the same deadline').toBeTruthy()
    expect(taskId).toBeTruthy()
    await expect(chat.locator('.chat-scroll > [role="status"]')).toHaveText('修改已应用，实际结果已保存')
    await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeDisabled()
    const saved = await saveStage(run, 'correct-result')
    expect(saved.project.revision).toBe(baseline.project.revision + 1)
    const changedId = scenario.kind === 'text' ? FIXTURE_IDS.title : FIXTURE_IDS.image
    expect(slideItems(saved.project).filter(item => item.layerItemId !== changedId)).toEqual(slideItems(baseline.project).filter(item => item.layerItemId !== changedId))
    if (scenario.kind === 'image') {
      metrics.pixels = await verifyGreenImage(baseline, saved)
      expect(saved.assetFiles[FIXTURE_IDS.asset]).toEqual(baseline.assetFiles[FIXTURE_IDS.asset])
    } else {
      const title = titleItem(saved.project), data = title.content.data
      expect(data.text).toBe('简谐运动')
      const sizes = Array.from({ length: data.text.length }, (_, index) => data.runs.filter(run => run.start <= index && run.end > index).at(-1)?.style.fontSize ?? data.style.fontSize)
      expect(Math.min(...sizes)).toBeGreaterThan(titleItem(baseline.project).content.data.style.fontSize)
      expect(data.style.align).toBe('center')
      expect(Math.abs(title.frame.x + title.frame.width / 2 - 640)).toBeLessThan(4)
      expect(saved.assetFiles).toEqual(baseline.assetFiles)
    }
    const finished = currentTask(run, prompt)!
    metrics.finish = assertDurableFinish(finished.record, taskId!)
    await recordEvidence(run, 'completed')
    await run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect((await saveStage(run, 'one-undo')).project).toEqual(baseline.project)
    await run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect((await saveStage(run, 'one-redo')).project).toEqual(saved.project)
    expect(run.pageErrors).toEqual([])
    await closeNativeEditor(run); run = undefined
    run = await launchNativeEditor(productRoot, runRoot, projectPath)
    expect(readSaved(projectPath).project).toEqual(saved.project)
    const reopened = currentTask(run, prompt)!
    const reopenedFinish = assertDurableFinish(reopened.record, taskId!)
    expect(reopenedFinish.runIds).toEqual((metrics.finish as { runIds: string[] }).runIds)
    await recordEvidence(run, 'reopened')
    metrics.status = 'engineering-checks-passed-awaiting-visual-review'
    metrics.visualReview = 'Review first-usable-ui.png and preserved result/Undo/Redo images; one sample is not a performance distribution or S3 acceptance.'
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
    await testInfo.attach('short-path-result', { path: join(runRoot, 'result.json'), contentType: 'application/json' })
  }
})

test.describe.configure({ mode: 'serial', retries: 0 })
