import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { FIXTURE_IDS, MANUAL_TITLE, NATIVE_PROMPTS, assertNativeHistoryPreserved, assertObservedRuntimeSlower, closeNativeEditor,
  launchNativeEditor, loadNativeT05Resume, nativeRecords, observeRuntimeTiming, preserveNativeFailure, readSaved,
  recordEvidence, runtimeItem, sampleRuntimeMotion, saveStage, selectLayer, sendNatural, titleItem, waitNativeTurn, type NativeRun } from './r18NativeAuthoringFixture'
import { validateCanvasPoses, type CanvasMotion } from './runtimeCanvasMotionObservation'
import { selectReferenceScope } from './chatReferenceTarget'

const sourceRoot = 'C:/Users/74755/Documents/courseware-r18-worktrees/20260908-development/claude/output/r18-native-authoring/opencode-2-2026-09-08T15-54-05-765Z'
const productRoot = resolve(sourceRoot, '../../..')
const baselineRoot = resolve(__dirname, '../../output/r18-development-20260908/opencode2-canvas-observation-2026-09-08T16-17-57-404Z')
const selected = { adapter: 'opencode' as const, ordinal: 2, model: 'openai/gpt-5.6-luna', effort: 'max' }
const gate = process.env.COURSEWARE_R18_OPENCODE2_CANVAS_TAIL ?? ''
if (gate && gate !== 'execute-once') throw new Error('Unknown OpenCode 2 tail gate')
const turnTimeout = 20 * 60_000
test.use({ trace: 'off' })

async function prepare() {
  const resume = await loadNativeT05Resume(productRoot, sourceRoot, selected)
  expect(resume.afterT05!.restoreRequired).toBe(false)
  expect(resume.projectPath).toBe(join(resume.sourceRoot, 'lesson.h5lesson'))
  expect(resume.profilePath).toBe(join(resume.sourceRoot, 'profile'))
  expect(resume.executionProfilePath).toBeUndefined()
  expect(readSaved(resume.projectPath)).toEqual(resume.afterT05!.cube)
  const attempts = join(sourceRoot, 'attempts')
  if (existsSync(attempts)) for (const directory of readdirSync(attempts, { withFileTypes: true }).filter(value => value.isDirectory())) {
    if (existsSync(join(attempts, directory.name, 'T06.input.json'))) throw new Error('A T06 attempt already exists; use its actual checkpoint instead of repeating the paid request')
  }
  expect(readSaved(join(baselineRoot, 'T05-readonly-copy.h5lesson'))).toEqual(resume.afterT05!.cube)
  const before = JSON.parse(readFileSync(join(baselineRoot, 'T05-before.timing.json'), 'utf8')) as CanvasMotion
  expect(before.source).toBe('actual-preview-canvas-painted-quadrilaterals')
  expect(before.runtimeId).toBe(runtimeItem(resume.afterT05!.cube.project).layerItemId)
  validateCanvasPoses(before.poses)
  const validation = JSON.parse(readFileSync(join(baselineRoot, 'observer-validation.json'), 'utf8'))
  expect(validation).toMatchObject({ staticRejected: true, sameSpeedRejected: true, realSlowedRuntimeTested: false, paidCalls: 0 })
  assertNativeHistoryPreserved(resume)
  return { resume, before }
}

test('OpenCode 2 Canvas tail preparation only: actual T05 and native checkpoint', async () => {
  const { resume, before } = await prepare()
  console.log(JSON.stringify({ preparation: 'passed', paidCalls: 0, selected, productRoot, projectPath: resume.projectPath,
    profilePath: resume.profilePath, externalSessionId: resume.afterT05!.record.externalSessionId,
    revision: resume.afterT05!.cube.project.revision, baseline: join(baselineRoot, 'T05-before.timing.json'), paintedPoses: before.poses.length,
    freshCoverage: ['T06', 'T04', 'T07', 'Undo/Redo', 'save/reopen'], repeatedPrefixTurns: 0 }))
})

test('OpenCode 2 Canvas paid tail: T06 then T04 T07 save reopen', async ({}, testInfo) => {
  test.skip(gate !== 'execute-once', 'Paid tail is closed; preparation is separate zero-model evidence')
  const trace = testInfo.project.use.trace
  expect(typeof trace === 'object' ? trace.mode : trace).toBe('off')
  test.setTimeout(6 * turnTimeout + 5 * 60_000)
  const { resume, before: beforeTiming } = await prepare()
  const cube = resume.afterT05!.cube, originalNativeId = resume.afterT05!.record.externalSessionId
  const runRoot = join(resume.sourceRoot, 'attempts', `after-T05-canvas-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const manifest: Record<string, unknown> = { selected, prompts: NATIVE_PROMPTS, productRoot, runRoot, projectPath: resume.projectPath,
    status: 'running', startedAt: new Date().toISOString(), noAutomaticRetries: true,
    continuation: { phase: 'after-T05', from: resume.sourceRoot, passedPrefixAttempt: resume.sourceRoot,
      reason: 'Retained actual Phaser Canvas implementation was unsupported by the former DOM timing observer',
      originalNativeId, profilePath: resume.profilePath, restoredArchive: false, replayedCandidate: false,
      preservedHistoricalFiles: resume.historyFiles.map(file => file.path), baselineTiming: join(baselineRoot, 'T05-before.timing.json') },
    coverage: ['T06', 'T04', 'T07', 'Undo/Redo', 'save/reopen', 'actual preview animation'],
    notCovered: ['T03', 'T08', 'T09', 'T10', 'full T11', 'Owner acceptance'] }
  const persist = () => writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2))
  persist()
  writeFileSync(join(runRoot, 'continuation-index.json'), JSON.stringify(manifest.continuation, null, 2))
  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(productRoot, runRoot, resume.projectPath, resume)
    await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption(selected.adapter)
    await chat.getByLabel('会话', { exact: true }).selectOption(resume.afterT05!.record.id)
    const model = chat.getByLabel('模型', { exact: true }), effort = chat.getByLabel('强度', { exact: true })
    await expect(model).toBeEnabled({ timeout: 60_000 }); await model.selectOption(selected.model)
    await expect(effort).toBeEnabled(); await effort.selectOption(selected.effort)
    await expect(model).toBeEnabled(); await expect(effort).toBeEnabled()
    await selectReferenceScope(chat, 'selection')
    await chat.getByLabel('意图', { exact: true }).selectOption('edit')
    await chat.getByLabel('应用方式', { exact: true }).selectOption('auto')
    const current = async () => {
      const id = await chat.getByLabel('会话', { exact: true }).inputValue()
      const record = nativeRecords(run!).find(value => value.id === id)
      if (!record) throw new Error('UI-selected durable record is missing')
      expect(record.adapter).toBe(selected.adapter)
      expect(record.externalSessionId).toBe(originalNativeId)
      expect(record.workspace).toEqual(resume.afterT05!.record.workspace)
      const configuration = [...record.events].reverse().find(event => event.kind === 'configuration' && event.capabilities.current.model !== null)
      if (configuration?.kind !== 'configuration') throw new Error('Native model configuration is missing')
      expect(configuration.capabilities.current.model).toBe(selected.model)
      expect(configuration.capabilities.current.effort).toBe(selected.effort)
      return record
    }
    const committed = async () => (await current()).hostResults.flatMap(result => result.receipts).filter(receipt => receipt.status === 'committed')
    await current()
    await test.step('T06 original text and actual Canvas speed', async () => {
      const before = runtimeItem(cube.project)
      await selectLayer(run!.page, before.layerItemId)
      await sendNatural(run!, 'T06', NATIVE_PROMPTS.T06, turnTimeout)
      const saved = await saveStage(run!, 'T06'), after = runtimeItem(saved.project)
      expect(after.layerItemId).toBe(before.layerItemId); expect(after.frame).toEqual(before.frame)
      expect(after.runtime).not.toEqual(before.runtime)
      await sampleRuntimeMotion(run!, after, 'T06-runtime')
      const afterTiming = await observeRuntimeTiming(run!, after, 'T06-after')
      writeFileSync(join(runRoot, 'T06-speed-comparison.json'), JSON.stringify(assertObservedRuntimeSlower(beforeTiming, afterTiming), null, 2))
      const count = (await committed()).length
      expect(count).toBeGreaterThan(0)
      for (let index = 0; index < count; index++) await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
      expect(runtimeItem((await saveStage(run!, 'T06-undone')).project)).toEqual(before)
      for (let index = 0; index < count; index++) await run!.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
      expect(runtimeItem((await saveStage(run!, 'T06-redone')).project)).toEqual(after)
    })
    await test.step('T04 real title', async () => {
      await selectLayer(run!.page, FIXTURE_IDS.title)
      const before = titleItem(readSaved(resume.projectPath).project)
      await sendNatural(run!, 'T04', NATIVE_PROMPTS.T04, turnTimeout)
      const title = titleItem((await saveStage(run!, 'T04')).project), data = title.content.data
      expect(data.text).toBe('简谐运动')
      const sizes = Array.from({ length: data.text.length }, (_, index) => data.runs.filter(value => value.start <= index && value.end > index).at(-1)?.style.fontSize ?? data.style.fontSize)
      expect(Math.min(...sizes)).toBeGreaterThan(before.content.data.style.fontSize)
      expect(data.style.align).toBe('center'); expect(Math.abs(title.frame.x + title.frame.width / 2 - 640)).toBeLessThan(4)
      expect((await committed()).length).toBeGreaterThan(0)
    })
    await test.step('T07 actual teacher interleaving', async () => {
      await selectLayer(run!.page, FIXTURE_IDS.title)
      const priorIds = new Set(nativeRecords(run!).map(record => record.id)), before = titleItem(readSaved(resume.projectPath).project)
      const deadline = Date.now() + turnTimeout
      let manualRevision = -1
      writeFileSync(join(runRoot, 'T07-start.input.json'), JSON.stringify({ prompt: NATIVE_PROMPTS.T07Start,
        startedAt: new Date().toISOString(), deadline, selectedSession: await chat.getByLabel('会话', { exact: true }).inputValue() }, null, 2))
      await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07Start)
      await chat.getByRole('button', { name: '发送', exact: true }).click()
      await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeEnabled()
      {
        let inFlight: ReturnType<typeof nativeRecords>[number] | undefined
        while (Date.now() < deadline) {
          inFlight = nativeRecords(run!).find(record => !priorIds.has(record.id))
          if (inFlight) {
            if (inFlight.hostResults.some(value => value.receipts.some(receipt => receipt.status === 'committed'))) throw new Error('T07 committed before teacher intervention')
            if (inFlight.tasks.at(-1)?.status !== 'running') throw new Error(`T07 ended before teacher intervention: ${inFlight.tasks.at(-1)?.status}`)
            if (inFlight.events.some(event => ['text', 'tool'].includes(event.kind))) break
          }
          await run!.page.waitForTimeout(300)
        }
        if (!inFlight?.events.some(event => ['text', 'tool'].includes(event.kind))) throw new Error('T07 exhausted its original 20 minute task budget before first text/tool')
        expect(inFlight.hostResults.flatMap(value => value.receipts).filter(value => value.status === 'committed')).toHaveLength(0)
        await selectLayer(run!.page, FIXTURE_IDS.title)
        const editor = run!.page.getByRole('textbox', { name: '文字内容', exact: true })
        await editor.fill(MANUAL_TITLE); await editor.press('Tab')
        const manual = await saveStage(run!, 'T07-manual'); manualRevision = manual.project.revision
        expect(titleItem(manual.project).content.data.text).toBe(MANUAL_TITLE)
        writeFileSync(join(runRoot, 'T07.input.json'), JSON.stringify({ prompt: NATIVE_PROMPTS.T07, sentAfterManualRevision: manualRevision, time: new Date().toISOString() }, null, 2))
        const use = chat.getByLabel('输入用途', { exact: true }); if (await use.count()) await use.selectOption('correct')
        await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07)
        await chat.getByRole('button', { name: /^(发送输入|发送)$/ }).click()
        await expect.poll(async () => {
          const id = await chat.getByLabel('会话', { exact: true }).inputValue(), fresh = nativeRecords(run!).find(record => record.id === id)
          return fresh && id !== inFlight!.id && fresh.observations.some(value => value.documentRevision >= manualRevision)
        }, { timeout: Math.max(1, deadline - Date.now()) }).toBe(true)
        const cancelled = nativeRecords(run!).find(record => record.id === inFlight!.id)!
        expect(cancelled.tasks.at(-1)?.status).toBe('cancelled')
        expect(cancelled.hostResults.flatMap(value => value.receipts).filter(value => value.status === 'committed')).toHaveLength(0)
        await recordEvidence(run!, 'T07-refreshed')
      }
      await waitNativeTurn(run!, 'T07', Math.max(1, deadline - Date.now()))
      const saved = await saveStage(run!, 'T07')
      expect(titleItem(saved.project).content.data.text).toBe(MANUAL_TITLE)
      expect(titleItem(saved.project).content.data.style.fontSize).toBeGreaterThan(before.content.data.style.fontSize)
      expect((await current()).observations.some(value => value.documentRevision >= manualRevision)).toBe(true)
      const receipts = await committed(); expect(receipts.length).toBeGreaterThan(0)
      for (const receipt of receipts) expect(receipt.beforeRevision).toBeGreaterThanOrEqual(manualRevision)
    })
    await test.step('save reopen actual playback', async () => {
      const final = readSaved(resume.projectPath)
      await chat.getByRole('button', { name: '关闭', exact: true }).click()
      await run!.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
      await selectLayer(run!.page, FIXTURE_IDS.title)
      await expect(run!.page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(MANUAL_TITLE)
      expect(await saveStage(run!, 'final-reopened')).toEqual(final)
      await sampleRuntimeMotion(run!, runtimeItem(final.project), 'reopened-runtime')
    })
    await recordEvidence(run, 'final'); expect(run.pageErrors).toEqual([])
    manifest.status = 'automated-checks-passed-awaiting-visual-review'
  } catch (error) {
    manifest.status = 'failed'; manifest.failure = error instanceof Error ? error.stack : String(error)
    if (run) {
      await recordEvidence(run, 'failure').catch(() => {})
      try { manifest.failureSavedRevision = await preserveNativeFailure(run) } catch (saveError) { manifest.failureSaveError = String(saveError) }
    }
    throw error
  } finally {
    if (run) await closeNativeEditor(run)
    manifest.finishedAt = new Date().toISOString()
    try { assertNativeHistoryPreserved(resume); manifest.existingHistoryPreserved = true }
    catch (error) { manifest.existingHistoryPreserved = false; manifest.historyPreservationError = String(error); throw error }
    finally { persist() }
  }
})

test.describe.configure({ mode: 'serial', retries: 0 })
