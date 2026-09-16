import { requireProjectWorkspace } from './r18NativeAuthoringFixture'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import {
  FIXTURE_IDS, MANUAL_TITLE, NATIVE_PROMPTS, assertNativeHistoryPreserved, assertObservedRuntimeSlower, closeNativeEditor, imageItem, launchNativeEditor, loadNativeT01Resume, loadNativeT02Resume, loadNativeT04Resume, loadNativeT05Resume, loadNativeT06Resume, loadNativeT07ManualResume, loadRecoveredNativeT05, nativeEvidence, nativeRecords, observeRuntimeTiming, prepareNativeExecutionProfile, restoreNativeT05Fixture,
  readSaved, recordEvidence, runtimeItem, sampleRuntimeMotion, saveStage, preserveNativeFailure, selectLayer, sendNatural, slideItems, titleItem,
  verifyGreenImage, writeNativeLesson, type NativeCli, type NativeRun,
} from './r18NativeAuthoringFixture'

const productRoot = resolve(__dirname, '..', '..')
const adapter = (process.env.COURSEWARE_R18_NATIVE_CLI ?? 'codex') as NativeCli
const runCount = Number(process.env.COURSEWARE_R18_NATIVE_COUNT ?? '1')
const firstOrdinal = Number(process.env.COURSEWARE_R18_NATIVE_ORDINAL ?? '1')
const gate = process.env.COURSEWARE_R18_NATIVE_GATE ?? ''
const model = process.env.COURSEWARE_R18_NATIVE_MODEL ?? ''
const effort = process.env.COURSEWARE_R18_NATIVE_EFFORT ?? ''
const resumeAfterT01 = process.env.COURSEWARE_R18_NATIVE_RESUME_AFTER_T01 ?? ''
const resumeAfterT02 = process.env.COURSEWARE_R18_NATIVE_RESUME_AFTER_T02 ?? ''
const resumeAfterT04 = process.env.COURSEWARE_R18_NATIVE_RESUME_AFTER_T04 ?? ''
const recoveredT05 = process.env.COURSEWARE_R18_NATIVE_RECOVERED_T05 ?? ''
const resumeAfterT05 = process.env.COURSEWARE_R18_NATIVE_RESUME_AFTER_T05 ?? ''
const resumeAfterT06 = process.env.COURSEWARE_R18_NATIVE_RESUME_AFTER_T06 ?? ''
const resumeAfterT07Manual = process.env.COURSEWARE_R18_NATIVE_RESUME_AFTER_T07_MANUAL ?? ''
const timingEvidence = process.env.COURSEWARE_R18_NATIVE_TIMING_EVIDENCE ?? ''
const timingSource = process.env.COURSEWARE_R18_NATIVE_TIMING_SOURCE ?? ''
const modelTransition = process.env.COURSEWARE_R18_NATIVE_MODEL_TRANSITION ?? ''
const previousModel = process.env.COURSEWARE_R18_NATIVE_PREVIOUS_MODEL ?? ''
const previousEffort = process.env.COURSEWARE_R18_NATIVE_PREVIOUS_EFFORT ?? ''
const executionProfileCopy = process.env.COURSEWARE_R18_NATIVE_EXECUTION_PROFILE_COPY === '1'
if ([resumeAfterT01, resumeAfterT02, resumeAfterT04, resumeAfterT05, resumeAfterT06, resumeAfterT07Manual, recoveredT05].filter(Boolean).length > 1) throw new Error('Choose one explicit native evidence checkpoint')
if (modelTransition && modelTransition !== 'user-budget') throw new Error('Only the explicit user-budget model transition is supported')
if (modelTransition && (!previousModel || !previousEffort || ![resumeAfterT01, resumeAfterT02, resumeAfterT04, resumeAfterT05, resumeAfterT06, resumeAfterT07Manual, recoveredT05].some(Boolean))) throw new Error('A budget transition requires an actual checkpoint and its previous model and effort')
if (!modelTransition && (previousModel || previousEffort || resumeAfterT04 || recoveredT05)) throw new Error('Previous configuration and budget recovery require the explicit budget transition')
const turnTimeoutMs = 20 * 60_000

// Three independent slots are fixed in advance for every CLI. The default driver
// selects Codex slot 1 only; widening execution needs the separate matrix gate.
const plannedMatrix = (['codex', 'claude', 'opencode'] as const).flatMap(cli => [1, 2, 3].map(ordinal => ({ cli, ordinal })))
if (!['codex', 'claude', 'opencode'].includes(adapter) || ![1, 3].includes(runCount) || ![1, 2, 3].includes(firstOrdinal)
  || firstOrdinal + runCount - 1 > 3) throw new Error('Use a known CLI and the predeclared 1–3 independent run slots; count must be 1 or 3')

async function selectedNativeRecord(run: NativeRun): Promise<LocalAgentRecordV2> {
  const id = await run.page.getByRole('complementary', { name: 'CLI 创作助手' }).getByLabel('会话', { exact: true }).inputValue()
  const value = nativeRecords(run).find(record => record.id === id)
  if (!value) throw new Error(`No durable native record for the UI-selected session ${id}`)
  return value
}
function committed(record: LocalAgentRecordV2) {
  return record.hostResults.flatMap(result => result.receipts).filter(receipt => receipt.status === 'committed')
}
function confirmNativeConfiguration(record: LocalAgentRecordV2) {
  expect(record.adapter).toBe(adapter)
  expect(record.externalSessionId, 'Native identity must come from a real CLI response').toBeTruthy()
  const config = [...record.events].reverse().find(event => event.kind === 'configuration' && event.capabilities.current.model !== null)
  expect(config, 'At least one current configuration must be confirmed by native transport').toBeTruthy()
  if (config?.kind !== 'configuration') throw new Error('Native model configuration was not confirmed')
  expect(config.capabilities.current.model).toBe(model)
  if (effort !== 'default') expect(config.capabilities.current.effort).toBe(effort)
}
async function configureNativeModel(run: NativeRun) {
  const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
  const cliSelector = chat.getByLabel('CLI', { exact: true })
  if (await cliSelector.inputValue() !== adapter) await cliSelector.selectOption(adapter)
  const selector = chat.getByLabel('模型', { exact: true })
  await expect(selector).toBeEnabled({ timeout: 60000 })
  expect(await selector.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toContain(model)
  await selector.selectOption(model)
  await expect(selector).toBeEnabled()
  const effortSelector = chat.getByLabel('强度', { exact: true })
  if (effort !== 'default') {
    await expect(effortSelector).toBeEnabled()
    await effortSelector.selectOption(effort)
    await expect(effortSelector).toBeEnabled()
  } else if (await effortSelector.isEnabled()) await effortSelector.selectOption('')
  await chat.getByLabel('本轮引用', { exact: true }).selectOption('selection')
  return chat
}
async function configureChat(run: NativeRun) {
  await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
  return configureNativeModel(run)
}

for (let offset = 0; offset < runCount; offset++) {
  const ordinal = firstOrdinal + offset
  test(`R18 native ${adapter} independent run ${ordinal}: T01→T02→T05→T06 and T04/T07`, async ({}, testInfo) => {
    test.skip(!!timingSource, 'The selected mode only observes existing artifacts; it never launches a native agent')
    test.skip(!gate, 'Real paid CLI gate is closed. --list is discovery only; this is not a pass.')
    expect(gate === 'matrix' || gate === 'codex-first' && adapter === 'codex' && ordinal === 1 && runCount === 1,
      'Only the explicitly opened first Codex slot or the full matrix gate may launch native calls').toBe(true)
    expect(model, 'Freeze COURSEWARE_R18_NATIVE_MODEL before executing a paid native run').not.toBe('')
    expect(effort, 'Freeze COURSEWARE_R18_NATIVE_EFFORT (or explicit default) before executing').not.toBe('')
    test.setTimeout(8 * turnTimeoutMs + 10 * 60_000)
    const traceMode = testInfo.project.use.trace
    const traceEnabled = (typeof traceMode === 'object' ? traceMode.mode : traceMode) !== 'off'
    testInfo.annotations.push({ type: 'native-evidence', description: 'Real native CLI and UI; no model/tool/auth mocks. A complete run is engineering evidence, not Owner acceptance.' })
    if (resumeAfterT01 || resumeAfterT02 || resumeAfterT04 || resumeAfterT05 || resumeAfterT06 || resumeAfterT07Manual || recoveredT05) expect(runCount, 'A continuation preserves exactly one independent slot').toBe(1)
    const historicalConfiguration = { adapter, ordinal, model: modelTransition ? previousModel : model, effort: modelTransition ? previousEffort : effort }
    const resume = recoveredT05 ? await loadRecoveredNativeT05(productRoot, recoveredT05, historicalConfiguration)
      : resumeAfterT04 ? await loadNativeT04Resume(productRoot, resumeAfterT04, historicalConfiguration)
      : resumeAfterT07Manual ? await loadNativeT07ManualResume(productRoot, resumeAfterT07Manual, historicalConfiguration)
      : resumeAfterT06 ? await loadNativeT06Resume(productRoot, resumeAfterT06, timingEvidence, historicalConfiguration)
      : resumeAfterT05 ? await loadNativeT05Resume(productRoot, resumeAfterT05, historicalConfiguration)
      : resumeAfterT02 ? await loadNativeT02Resume(productRoot, resumeAfterT02, historicalConfiguration)
      : resumeAfterT01 ? loadNativeT01Resume(productRoot, resumeAfterT01, historicalConfiguration) : undefined
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const runRoot = resume ? join(resume.sourceRoot, 'attempts', `${resume.recoveredT05 ? 'recovered-after-T05-budget' : resume.afterT04 ? 'after-T04-budget' : resume.afterT07Manual ? 'after-T07-manual' : resume.afterT06 ? 'after-T06' : resume.afterT05 ? 'after-T05' : resume.afterT02 ? 'after-T02' : 'after-T01'}-${stamp}`)
      : join(productRoot, 'output', 'r18-native-authoring', `${adapter}-${ordinal}-${stamp}`)
    mkdirSync(runRoot, { recursive: true })
    const projectPath = resume?.projectPath ?? join(runRoot, 'lesson.h5lesson')
    const manifest: Record<string, unknown> = { plannedMatrix, selected: { adapter, ordinal, model, effort }, prompts: NATIVE_PROMPTS,
      startedAt: new Date().toISOString(), status: 'running', runRoot, projectPath, productRoot,
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: productRoot, encoding: 'utf8', windowsHide: true }).trim(),
      dirtyPaths: execFileSync('git', ['status', '--porcelain'], { cwd: productRoot, encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(Boolean),
      coverage: ['T01', 'T02', 'T05', 'T06', 'T04', 'T07', 'Undo/Redo', 'save/reopen', 'actual preview animation'],
      notCovered: ['T03', 'T08', 'T09', 'T10', 'full T11', 'application restart recovery', 'external Builder', 'Owner acceptance'],
      visualReview: 'Required: chronological T05/T06 runtime filmstrips must depict a rolling cube with lower speed. Pixel-motion checks alone do not close T05/T06.',
      noAutomaticRetries: true, traceEnabled, automaticPermissionScope: 'Visible Allow once for file requests wholly inside this run only; all other questions wait for a recorded manual UI answer' }
    if (resume) {
      if (!resume.recoveredT05 && (modelTransition || executionProfileCopy)) prepareNativeExecutionProfile(resume, runRoot)
      if (modelTransition) manifest.modelTransition = { reason: 'user-budget-direction', previousConfiguration: historicalConfiguration,
        currentConfiguration: { adapter, ordinal, model, effort }, previousEvidenceRetainsOriginalConfiguration: true }
      const selectedRecord = resume.afterFailedT04?.record ?? resume.afterT04?.record ?? resume.afterT07Manual?.record ?? resume.afterT06?.record ?? resume.afterT05?.record ?? resume.afterT02?.record ?? resume.t01Record
      manifest.continuation = resume.recoveredT05 ? { from: resume.recoveredT05.originalSourceRoot, phase: 'recovered-after-T05',
        recoveryManifest: resume.recoveredT05.manifestPath, executionRoot: resume.sourceRoot, profilePath: resume.profilePath,
        projectPath: resume.projectPath, previousExternalSessionId: resume.recoveredT05.previousExternalSessionId,
        currentExternalSessionId: null, workspaceBoundary: resume.recoveredT05.workspaceBoundary,
        crossSaveAsNativeIdentityContinuity: 'not-claimed', historicalT05Status: 'committed-partial-then-real-recovery-verified',
        preservedHistoricalFiles: resume.historyFiles.map(file => file.path),
        freshCoverage: ['T06', 'T04', 'T07', 'Undo/Redo', 'save/reopen', 'actual preview animation'] }
        : { from: resume.sourceRoot, phase: resume.afterT04 ? 'after-T04' : resume.afterT07Manual ? 'after-T07-manual' : resume.afterT06 ? 'after-T06' : resume.afterT05 ? 'after-T05' : resume.afterT02 ? 'after-T02' : 'after-T01', profilePath: resume.profilePath,
        executionProfilePath: resume.executionProfilePath ?? resume.profilePath,
        sessionId: selectedRecord.id, externalSessionId: selectedRecord.externalSessionId,
        reusedEvidence: ['run.json', 'T01.input.json', 'T01.native.json', 'T01.h5lesson', 'T01.project.json', 'T01.png'].map(file => join(resume.sourceRoot, file)),
        ...(resume.afterT02 ? { passedImageEditAttempt: resume.afterT02.evidenceRoot,
          passedImageEditEvidence: ['T02.input.json', 'T02.native.json', 'T02.h5lesson', 'T02.pixels.json', 'T02.png'].map(file => join(resume.afterT02!.evidenceRoot, file)) } : {}),
        ...(resume.afterT05 ? { passedPrefixAttempt: resume.afterT05.evidenceRoot,
          passedPrefixEvidence: ['run.json', 'T02.input.json', 'T02.native.json', 'T02.h5lesson', 'T02.pixels.json', 'T05.input.json', 'T05.native.json', 'T05.h5lesson', 'T05-runtime.motion.json', 'T05-runtime.filmstrip.png'].map(file => join(resume.afterT05!.evidenceRoot, file)),
          ...(!resume.afterT06 && resume.afterT05.restoreRequired ? { testInputRestoration: { from: resume.afterT05.baselinePath, to: resume.projectPath, preserveFailedResultAs: join(runRoot, 'pre-resume-failed-T06.h5lesson') } } : {}) } : {}),
        ...(resume.afterT06 ? { passedT06Attempt: resume.afterT06.evidenceRoot, actualTimingEvidence: resume.afterT06.timingEvidencePath,
          undoRedoBoundary: resume.afterT04 ? 'Reuse actual completed T06 Undo/Redo evidence from the interrupted attempt; no history replay' : resume.afterT07Manual ? 'Reuse completed normal T04 Undo/Redo evidence from the prior attempt; no history replay' : 'Previous app history is not replayed; verify normal AI Undo/Redo after the new real T04 commit' } : {}),
        ...(resume.afterFailedT04 ? { failedT04Retained: { evidenceRoot: resume.afterFailedT04.evidenceRoot,
          recordId: resume.afterFailedT04.record.id, revision: resume.afterFailedT04.saved.project.revision,
          restoration: false, freshCoverage: ['T04', 'T07', 'save/reopen'] } } : {}),
        ...(resume.afterT04 ? { passedT04Attempt: resume.afterT04.evidenceRoot, interruption: resume.afterT04.interruptionPath,
          reusedT04AndUndoRedoEvidence: ['T04.native.json', 'T04.h5lesson', 'T06-undone.h5lesson', 'T06-redone.h5lesson'].map(file => join(resume.afterT04!.evidenceRoot, file)) } : {}),
        ...(resume.afterT07Manual ? { passedT04AndManualAttempt: resume.afterT07Manual.evidenceRoot,
          originalCancelledTask: resume.afterT07Manual.oldRecord.id, interruptedRefreshedTask: resume.afterT07Manual.record.id,
          manualRevision: resume.afterT07Manual.manual.project.revision, repeatedManualEdits: 0, resumePrompt: NATIVE_PROMPTS.T07 } : {}),
        preservedHistoricalFiles: resume.historyFiles.map(file => file.path), freshCoverage: [...(resume.afterT05 || resume.afterT02 ? [] : ['T02']), ...(resume.afterT05 ? [] : ['T05']), ...(resume.afterT06 ? [] : ['T06']), ...(resume.afterT04 || resume.afterT07Manual ? [] : ['T04', 'Undo/Redo']), 'T07', 'save/reopen', 'actual preview animation'] }
      writeFileSync(join(runRoot, 'continuation-index.json'), JSON.stringify(manifest.continuation, null, 2))
    }
    const persistManifest = () => writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2))
    persistManifest()
    let run: NativeRun | undefined
    try {
      const original = resume?.original ?? await writeNativeLesson(projectPath)
      if (!resume) writeFileSync(join(runRoot, '00-original.h5lesson'), readFileSync(projectPath))
      if (resume) restoreNativeT05Fixture(resume, runRoot)
      run = await launchNativeEditor(productRoot, runRoot, projectPath, resume)
      if (traceEnabled) await run.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      const chat = await configureChat(run)
      if (resume && !resume.recoveredT05) {
        const selectedRecord = resume.afterFailedT04?.record ?? resume.afterT04?.record ?? resume.afterT07Manual?.record ?? resume.afterT06?.record ?? resume.afterT05?.record ?? resume.afterT02?.record ?? resume.t01Record
        const session = chat.getByLabel('会话', { exact: true })
        await expect(session.locator(`option[value="${selectedRecord.id}"]`)).toHaveCount(1)
        await session.selectOption(selectedRecord.id)
        if (!resume.afterT07Manual && !resume.afterT04) await expect(chat.locator('.chat-message').last()).toContainText(resume.afterFailedT04 ? /简谐运动/i : resume.afterT06 ? /慢|减速|周期/i : resume.afterT05 ? /立方体|Runtime|翻滚/i : resume.afterT02 ? /绿|green/i : /红色|red/i)
        expect((await selectedNativeRecord(run)).externalSessionId).toBe(selectedRecord.externalSessionId)
        // Historical selection refreshes the provider capabilities. Reapply the
        // explicitly requested current controls after that normal UI transition.
        await configureNativeModel(run)
      }
      await run.page.screenshot({ path: join(runRoot, '00-chat-layout.png') })
      await selectLayer(run.page, FIXTURE_IDS.image)
      await run.page.screenshot({ path: join(runRoot, '00-selection-and-chat.png') })
      if (!resume) {
        await chat.getByLabel('意图', { exact: true }).selectOption('discuss')
        await test.step('T01 real image understanding with zero project writes', async () => {
        await sendNatural(run!, 'T01', NATIVE_PROMPTS.T01, turnTimeoutMs)
        await expect(chat.locator('.chat-message').last()).toContainText(/红色|red/i)
        const saved = await saveStage(run!, 'T01')
        expect(saved.project).toEqual(original.project)
        expect(saved.assetFiles).toEqual(original.assetFiles)
        const record = await selectedNativeRecord(run!)
        confirmNativeConfiguration(record)
        expect(committed(record)).toHaveLength(0)
        })
      }
      let firstNativeId = resume?.recoveredT05 ? null : (await selectedNativeRecord(run)).externalSessionId
      if (resume?.recoveredT05) {
        expect(await chat.getByLabel('会话', { exact: true }).inputValue(), 'Save As must begin with no rebound old native session').toBe('')
      }
      await chat.getByLabel('意图', { exact: true }).selectOption('edit')
      await chat.getByLabel('应用方式', { exact: true }).selectOption('auto')
      if (!resume?.afterT05 && !resume?.afterT02) await test.step('T02 edits the actual image while preserving geometry and visual details', async () => {
        await sendNatural(run!, 'T02', NATIVE_PROMPTS.T02, turnTimeoutMs)
        const saved = await saveStage(run!, 'T02')
        const pixels = await verifyGreenImage(original, saved)
        writeFileSync(join(runRoot, 'T02.pixels.json'), JSON.stringify(pixels, null, 2))
        const record = await selectedNativeRecord(run!)
        confirmNativeConfiguration(record)
        expect(record.externalSessionId).toBe(firstNativeId)
        expect(committed(record).length).toBeGreaterThan(0)
        expect(saved.project.revision).toBe(committed(record).at(-1)!.afterRevision)
      })
      let cube = resume?.afterT05?.cube ?? original
      if (!resume?.afterT05) await test.step('T05 replaces the square with one continuously animated Runtime in real preview', async () => {
        await selectLayer(run!.page, FIXTURE_IDS.square)
        await sendNatural(run!, 'T05', NATIVE_PROMPTS.T05, turnTimeoutMs)
        cube = await saveStage(run!, 'T05')
        const runtime = runtimeItem(cube.project)
        expect(slideItems(cube.project).some(item => item.layerItemId === FIXTURE_IDS.square)).toBe(false)
        expect(runtime.runtime.enabled).toBe(true)
        expect(runtime.runtime.source.trim().length).toBeGreaterThan(0)
        expect(imageItem(cube.project).frame).toEqual(imageItem(original.project).frame)
        expect(committed(await selectedNativeRecord(run!)).length).toBeGreaterThan(0)
        await sampleRuntimeMotion(run!, runtime, 'T05-runtime')
      })
      let slowed = resume?.afterT06?.slowed ?? cube
      if (!resume?.afterT06) await test.step('T06 modifies the same Runtime, measures slower motion, and survives Undo/Redo', async () => {
        await selectLayer(run!.page, runtimeItem(cube.project).layerItemId)
        const firstTiming = await observeRuntimeTiming(run!, runtimeItem(cube.project), 'T06-before')
        await sendNatural(run!, 'T06', NATIVE_PROMPTS.T06, turnTimeoutMs)
        slowed = await saveStage(run!, 'T06')
        const before = runtimeItem(cube.project), after = runtimeItem(slowed.project)
        expect(after.layerItemId).toBe(before.layerItemId)
        expect(after.frame).toEqual(before.frame)
        expect(after.runtime).not.toEqual(before.runtime)
        await sampleRuntimeMotion(run!, after, 'T06-runtime')
        const secondTiming = await observeRuntimeTiming(run!, after, 'T06-after')
        const timingComparison = assertObservedRuntimeSlower(firstTiming, secondTiming)
        writeFileSync(join(runRoot, 'T06-speed-comparison.json'), JSON.stringify(timingComparison, null, 2))
        const record = await selectedNativeRecord(run!)
        confirmNativeConfiguration(record)
        if (resume?.recoveredT05) {
          expect(record.externalSessionId).not.toBe(resume.recoveredT05.previousExternalSessionId)
          expect(requireProjectWorkspace(record.workspace).normalizedPath).toBe(projectPath.replace(/\\/g, '/').toLowerCase())
          firstNativeId = record.externalSessionId
          const continuation = manifest.continuation as Record<string, unknown>
          continuation.currentExternalSessionId = firstNativeId
          writeFileSync(join(runRoot, 'continuation-index.json'), JSON.stringify(continuation, null, 2))
          persistManifest()
        }
        expect(record.externalSessionId).toBe(firstNativeId)
        const count = committed(record).length
        expect(count).toBeGreaterThan(0)
        for (let index = 0; index < count; index++) await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
        const undone = await saveStage(run!, 'T06-undone')
        expect(runtimeItem(undone.project)).toEqual(before)
        for (let index = 0; index < count; index++) await run!.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
        const redone = await saveStage(run!, 'T06-redone')
        expect(runtimeItem(redone.project)).toEqual(after)
      })
      if (!resume?.afterT04 && !resume?.afterT07Manual) await test.step('T04 changes real title content, font size and horizontal placement', async () => {
        await selectLayer(run!.page, FIXTURE_IDS.title)
        const before = titleItem(readSaved(projectPath).project)
        await sendNatural(run!, 'T04', NATIVE_PROMPTS.T04, turnTimeoutMs)
        const saved = await saveStage(run!, 'T04')
        const title = titleItem(saved.project)
        expect(title.content.data.text).toBe('简谐运动')
        const data = title.content.data
        const effectiveSizes = Array.from({ length: data.text.length }, (_, index) => data.runs.filter(run => run.start <= index && run.end > index).at(-1)?.style.fontSize ?? data.style.fontSize)
        expect(Math.min(...effectiveSizes)).toBeGreaterThan(before.content.data.style.fontSize)
        expect(title.content.data.style.align).toBe('center')
        expect(Math.abs(title.frame.x + title.frame.width / 2 - 640)).toBeLessThan(4)
        expect(committed(await selectedNativeRecord(run!)).length).toBeGreaterThan(0)
        if (resume?.afterT06) {
          const count = committed(await selectedNativeRecord(run!)).length
          for (let index = 0; index < count; index++) await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
          const undone = await saveStage(run!, 'T04-undone')
          expect(titleItem(undone.project)).toEqual(before)
          expect(runtimeItem(undone.project)).toEqual(runtimeItem(saved.project))
          for (let index = 0; index < count; index++) await run!.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
          const redone = await saveStage(run!, 'T04-redone')
          expect(titleItem(redone.project)).toEqual(title)
          expect(runtimeItem(redone.project)).toEqual(runtimeItem(saved.project))
        }
      })
      await test.step('T07 preserves an interleaved teacher edit and uses the correction as fresh context', async () => {
        await selectLayer(run!.page, FIXTURE_IDS.title)
        const priorIds = new Set(nativeRecords(run!).map(record => record.id))
        let manualRevision = resume?.afterT07Manual?.manual.project.revision ?? -1
        const beforeTitle = resume?.afterT07Manual ? titleItem(resume.afterT07Manual.manual.project) : titleItem(readSaved(projectPath).project)
        if (resume?.afterT07Manual) {
          await selectLayer(run!.page, FIXTURE_IDS.title)
          await expect(run!.page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(MANUAL_TITLE)
          await sendNatural(run!, 'T07', NATIVE_PROMPTS.T07, turnTimeoutMs)
        } else await sendNatural(run!, 'T07-start', NATIVE_PROMPTS.T07Start, turnTimeoutMs, async () => {
          await expect.poll(() => nativeRecords(run!).some(record => !priorIds.has(record.id) && record.tasks.at(-1)?.status === 'running'
            && record.events.some(event => ['text', 'tool'].includes(event.kind))), { timeout: 60000 }).toBe(true)
          const inFlight = nativeRecords(run!).find(record => !priorIds.has(record.id))
          expect(inFlight && committed(inFlight), 'T07 must intervene before the first live commit; missing this timing window is not valid concurrency evidence').toHaveLength(0)
          await selectLayer(run!.page, FIXTURE_IDS.title)
          const editor = run!.page.getByRole('textbox', { name: '文字内容', exact: true })
          await editor.fill(MANUAL_TITLE)
          await editor.press('Tab')
          const manual = await saveStage(run!, 'T07-manual')
          manualRevision = manual.project.revision
          expect(titleItem(manual.project).content.data.text).toBe(MANUAL_TITLE)
          writeFileSync(join(runRoot, 'T07.input.json'), JSON.stringify({ prompt: NATIVE_PROMPTS.T07, sentAfterManualRevision: manualRevision, time: new Date().toISOString() }, null, 2))
          const use = chat.getByLabel('输入用途', { exact: true })
          if (await use.count()) await use.selectOption('correct')
          await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07)
          await chat.getByRole('button', { name: /^(发送输入|发送)$/ }).click()
          // Refresh deliberately cancels the old turn before capturing the new
          // observation. Do not mistake that short terminal state for completion
          // of the correction or close the app before the new turn starts.
          await expect.poll(async () => {
            const id = await chat.getByLabel('会话', { exact: true }).inputValue()
            const fresh = nativeRecords(run!).find(record => record.id === id)
            return fresh && id !== inFlight!.id && fresh.observations.some(observation => observation.documentRevision >= manualRevision)
          }, { timeout: 60000 }).toBe(true)
          const cancelled = nativeRecords(run!).find(record => record.id === inFlight!.id)!
          expect(cancelled.tasks.at(-1)?.status).toBe('cancelled')
          expect(committed(cancelled)).toHaveLength(0)
          await recordEvidence(run!, 'T07-refreshed')
        })
        const saved = await saveStage(run!, 'T07')
        expect(titleItem(saved.project).content.data.text).toBe(MANUAL_TITLE)
        const current = await selectedNativeRecord(run!)
        confirmNativeConfiguration(current)
        expect(current.externalSessionId).toBe(firstNativeId)
        expect(current.observations.some(observation => observation.documentRevision >= manualRevision)).toBe(true)
        expect(committed(current), 'The original size-change goal must actually complete after correction').not.toHaveLength(0)
        expect(titleItem(saved.project).content.data.style.fontSize).toBeGreaterThan(beforeTitle.content.data.style.fontSize)
        for (const receipt of committed(current)) expect(receipt.beforeRevision).toBeGreaterThanOrEqual(manualRevision)
      })
      await test.step('saved project reopens through the editor and runs again', async () => {
        const final = readSaved(projectPath)
        await chat.getByRole('button', { name: '关闭', exact: true }).click()
        await run!.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
        await selectLayer(run!.page, FIXTURE_IDS.title)
        await expect(run!.page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(MANUAL_TITLE)
        const reopened = await saveStage(run!, 'final-reopened')
        expect(reopened.project).toEqual(final.project)
        expect(reopened.assetFiles).toEqual(final.assetFiles)
        expect(reopened.componentFiles).toEqual(final.componentFiles)
        await sampleRuntimeMotion(run!, runtimeItem(reopened.project), 'reopened-runtime')
      })
      await recordEvidence(run, 'final')
      expect(run.pageErrors).toEqual([])
      manifest.status = 'automated-checks-passed-awaiting-visual-review'
    } catch (error) {
      manifest.status = 'failed'
      manifest.failure = error instanceof Error ? error.stack : String(error)
      if (run) {
        await run.page.screenshot({ path: join(runRoot, 'failure.png'), animations: 'allow' }).catch(() => {})
        await recordEvidence(run, 'failure').catch(() => {})
        writeFileSync(join(runRoot, 'failure.ui.txt'), await run.page.locator('body').innerText().catch(() => 'UI unavailable'))
        try { manifest.failureSavedRevision = await preserveNativeFailure(run) }
        catch (saveError) { manifest.failureSaveError = String(saveError) }
      }
      throw error
    } finally {
      manifest.finishedAt = new Date().toISOString()
      if (run) {
        manifest.pageErrors = run.pageErrors
        manifest.consoleErrors = run.consoleErrors
        try { manifest.native = nativeEvidence(run).summary }
        catch (error) { manifest.nativeEvidenceError = String(error) }
        if (traceEnabled) await run.app.context().tracing.stop({ path: join(runRoot, 'trace.zip') }).catch(() => {})
        await closeNativeEditor(run)
      }
      if (resume) {
        try { assertNativeHistoryPreserved(resume); manifest.existingHistoryPreserved = true }
        catch (error) { manifest.existingHistoryPreserved = false; manifest.historyPreservationError = String(error); persistManifest(); throw error }
      }
      persistManifest()
      await testInfo.attach('native-run-manifest', { path: join(runRoot, 'run.json'), contentType: 'application/json' })
    }
  })
}

test('R18 native timing observation: existing T05/T06 artifacts only', async () => {
  test.skip(!timingSource, 'Read-only artifact observation is explicitly selected separately from native model runs')
  test.setTimeout(120_000)
  const source = resolve(timingSource), manifest = JSON.parse(readFileSync(join(source, 'run.json'), 'utf8'))
  expect(manifest.selected).toEqual({ adapter, ordinal: firstOrdinal, model, effort })
  expect(runCount).toBe(1)
  expect(resolve(manifest.runRoot).toLowerCase()).toBe(source.toLowerCase())
  expect(manifest.continuation.phase).toBe('after-T05')
  expect(resolve(manifest.productRoot).toLowerCase()).toBe(productRoot.toLowerCase())
  const originalRun = resolve(manifest.continuation.from), prefix = resolve(manifest.continuation.passedPrefixAttempt)
  expect(resolve(source, '..').toLowerCase()).toBe(join(originalRun, 'attempts').toLowerCase())
  expect(resolve(prefix, '..').toLowerCase()).toBe(join(originalRun, 'attempts').toLowerCase())
  const beforePath = join(prefix, 'T05.h5lesson'), afterPath = join(source, 'T06.h5lesson')
  const before = runtimeItem(readSaved(beforePath).project), after = runtimeItem(readSaved(afterPath).project)
  expect(after.layerItemId).toBe(before.layerItemId)
  expect(after.frame).toEqual(before.frame)
  const outputRoot = join(originalRun, 'observations', `timing-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(outputRoot, { recursive: true })
  const evidence: Record<string, unknown> = { mode: 'existing-artifact-observation', beforePath, afterPath, source,
    nativeTurnsStarted: 0, originalProfileUsed: false, originalFilesWritten: false, status: 'running' }
  try {
    let run: NativeRun | undefined
    let beforeTiming: Awaited<ReturnType<typeof observeRuntimeTiming>>
    try {
      run = await launchNativeEditor(productRoot, join(outputRoot, 'before'), beforePath)
      beforeTiming = await observeRuntimeTiming(run, before, 'before')
      evidence.before = beforeTiming
    } finally { if (run) await closeNativeEditor(run) }
    run = undefined
    let afterTiming: Awaited<ReturnType<typeof observeRuntimeTiming>>
    try {
      run = await launchNativeEditor(productRoot, join(outputRoot, 'after'), afterPath)
      afterTiming = await observeRuntimeTiming(run, after, 'after')
      evidence.after = afterTiming
    } finally { if (run) await closeNativeEditor(run) }
    if (beforeTiming.source !== 'actual-preview-web-animations' || afterTiming.source !== 'actual-preview-web-animations') throw new Error('This retained paired checkpoint belongs to its observed WAAPI implementation')
    expect(beforeTiming.effectivePeriodMs).toBe(8000)
    expect(afterTiming.effectivePeriodMs).toBe(12000)
    evidence.periodRatio = afterTiming.effectivePeriodMs / beforeTiming.effectivePeriodMs
    evidence.continuousFrameEvidence = [join(prefix, 'T05-runtime.motion.json'), join(source, 'T06-runtime.motion.json')]
    evidence.status = 'passed'
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error }
  finally { writeFileSync(join(outputRoot, 'timing-comparison.json'), JSON.stringify(evidence, null, 2)); console.log(`NATIVE_TIMING_EVIDENCE ${outputRoot}`) }
})

test.describe.configure({ mode: 'serial', retries: 0 })
