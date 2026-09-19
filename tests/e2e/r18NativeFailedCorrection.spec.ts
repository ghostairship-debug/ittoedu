import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { localAgentRecordV2Schema, type LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import {
  FIXTURE_IDS, MANUAL_TITLE, NATIVE_PROMPTS, assertNativeHistoryPreserved, assertObservedRuntimeSlower,
  closeNativeEditor, imageItem, launchNativeEditor, nativeRecords, observeRuntimeTiming, prepareNativeExecutionProfile,
  readSaved, recordEvidence, runtimeItem, sampleRuntimeMotion, saveStage, preserveNativeFailure, selectLayer, sendNatural, titleItem,
  type NativeCli, type NativeRun, type NativeT01Resume,
} from './r18NativeAuthoringFixture'
import { selectReferenceScope } from './chatReferenceTarget'

const productRoot = resolve(__dirname, '..', '..')
const source = process.env.COURSEWARE_R18_FAILED_CORRECTION_SOURCE ?? ''
const model = process.env.COURSEWARE_R18_FAILED_CORRECTION_MODEL ?? ''
const effort = process.env.COURSEWARE_R18_FAILED_CORRECTION_EFFORT ?? ''
const gate = process.env.COURSEWARE_R18_FAILED_CORRECTION_GATE ?? ''
const repairRuntime = process.env.COURSEWARE_R18_FAILED_CORRECTION_RUNTIME === '1'
const runtimeRepairSource = process.env.COURSEWARE_R18_FAILED_CORRECTION_RUNTIME_SOURCE ?? ''
const inspectOnly = process.env.COURSEWARE_R18_FAILED_CORRECTION_INSPECT === '1'
const timeout = 20 * 60_000

function receiptCount(record: LocalAgentRecordV2) {
  return record.hostResults.flatMap(result => result.receipts).filter(receipt => receipt.status === 'committed').length
}
function readRecords(file: string): LocalAgentRecordV2[] {
  return JSON.parse(readFileSync(file, 'utf8')).records.map((record: unknown) => localAgentRecordV2Schema.parse(record))
}
function loadCheckpoint() {
  const evidenceRoot = realpathSync(source), prior = JSON.parse(readFileSync(join(evidenceRoot, 'run.json'), 'utf8'))
  expect(prior.status).toBe('failed')
  expect(prior.failure).toContain('T07-start: 编辑未完成')
  expect(prior.prompts).toEqual(NATIVE_PROMPTS)
  const projectPath = realpathSync(prior.projectPath), slotRoot = dirname(projectPath)
  expect(dirname(slotRoot).toLowerCase()).toBe(join(productRoot, 'output', 'r18-native-authoring').toLowerCase())
  expect(evidenceRoot.toLowerCase() === slotRoot.toLowerCase() || dirname(evidenceRoot).toLowerCase() === join(slotRoot, 'attempts').toLowerCase()).toBe(true)
  const manual = readSaved(join(evidenceRoot, 'T07-manual.h5lesson')), t04 = readSaved(join(evidenceRoot, 'T04.h5lesson'))
  if (!runtimeRepairSource) expect(readSaved(projectPath), 'Continue the actual manual result; never restore a fixture').toEqual(manual)
  expect(titleItem(manual.project).content.data.text).toBe(MANUAL_TITLE)
  expect(manual.project.revision).toBeGreaterThan(t04.project.revision)
  expect(titleItem(t04.project).content.data.text).toBe('简谐运动')
  expect(titleItem(t04.project).content.data.style.align).toBe('center')
  expect(Math.abs(titleItem(t04.project).frame.x + titleItem(t04.project).frame.width / 2 - 640)).toBeLessThan(4)
  expect(runtimeItem(manual.project)).toEqual(runtimeItem(t04.project))
  expect(imageItem(manual.project)).toEqual(imageItem(t04.project))
  expect(JSON.parse(readFileSync(join(evidenceRoot, 'T07.input.json'), 'utf8'))).toMatchObject({ prompt: NATIVE_PROMPTS.T07, sentAfterManualRevision: manual.project.revision })
  const failed = readRecords(join(evidenceRoot, 'failure.native.json'))
  const oldRecord = failed.find(record => record.tasks.at(-1)?.goal === NATIVE_PROMPTS.T07Start && record.tasks.at(-1)?.status === 'cancelled'
    && record.observations.some(observation => observation.documentRevision === t04.project.revision))
  const record = failed.find(record => record.tasks.at(-1)?.status === 'failed' && record.tasks.at(-1)?.goal.includes(NATIVE_PROMPTS.T07Start)
    && record.tasks.at(-1)?.goal.includes(NATIVE_PROMPTS.T07) && record.observations.some(observation => observation.documentRevision === manual.project.revision))
  if (!oldRecord || !record) throw new Error('The actual cancelled original and failed corrected tasks must both exist')
  expect(receiptCount(oldRecord)).toBe(0); expect(receiptCount(record)).toBe(0)
  expect(record.externalSessionId).toBe(oldRecord.externalSessionId)
  const t01Record = readRecords(join(slotRoot, 'T01.native.json'))[0]!
  expect(record.externalSessionId).toBe(t01Record.externalSessionId)
  expect(record.workspace).toEqual(t01Record.workspace)
  const configuration = [...record.events].reverse().find(event => event.kind === 'configuration')
  if (configuration?.kind !== 'configuration') throw new Error('Failed task has no native configuration')
  expect(configuration.capabilities.current.model).toBe(prior.selected.model)
  if (prior.selected.effort !== 'default') expect(configuration.capabilities.current.effort).toBe(prior.selected.effort)
  let profilePath = realpathSync(prior.continuation?.executionProfilePath ?? join(slotRoot, 'profile'))
  let runtimeOnly: { source: string; record: LocalAgentRecordV2; corrected: ReturnType<typeof readSaved>; selected: typeof prior.selected } | undefined
  const originalProfilePath = profilePath
  if (runtimeRepairSource) {
    expect(repairRuntime).toBe(true)
    const root = realpathSync(runtimeRepairSource), previous = JSON.parse(readFileSync(join(root, 'run.json'), 'utf8'))
    expect(dirname(root).toLowerCase()).toBe(join(slotRoot, 'attempts').toLowerCase())
    expect(previous.source).toBe(evidenceRoot)
    expect(previous.status).toBe('failed')
    expect(previous.failure).toContain('T05-affected-rework: 编辑未完成')
    expect(previous.existingHistoryPreserved).toBe(true)
    expect(previous.nativeExternalSessionId).toBe(record.externalSessionId)
    const records = readRecords(join(root, 'failure.native.json'))
    const correction = records.find(value => value.tasks.at(-1)?.goal === `${NATIVE_PROMPTS.T07Start}\n${NATIVE_PROMPTS.T07}`)
    const failedRuntime = records.find(value => value.tasks.at(-1)?.goal === NATIVE_PROMPTS.T05)
    if (!correction || !failedRuntime) throw new Error('Actual successful correction and failed Runtime records are required')
    expect(correction.tasks.at(-1)?.status).toBe('completed'); expect(receiptCount(correction)).toBeGreaterThan(0)
    expect(failedRuntime.tasks.at(-1)?.status).toBe('failed'); expect(receiptCount(failedRuntime)).toBe(0)
    for (const value of [correction, failedRuntime]) {
      expect(value.externalSessionId).toBe(record.externalSessionId); expect(value.workspace).toEqual(record.workspace)
      const configuration = [...value.events].reverse().find(event => event.kind === 'configuration')
      if (configuration?.kind !== 'configuration') throw new Error('Missing actual suffix configuration')
      expect(configuration.capabilities.current).toMatchObject({ model: previous.selected.model, effort: previous.selected.effort })
    }
    const corrected = readSaved(join(root, 'T07-repaired.h5lesson'))
    expect(readSaved(projectPath), 'Continue the current revision after the successful correction without repeating it').toEqual(readSaved(join(root, 'T07-redone.h5lesson')))
    expect(readSaved(projectPath).project).toEqual(corrected.project)
    expect(titleItem(corrected.project).content.data.text).toBe(MANUAL_TITLE)
    expect(titleItem(corrected.project).content.data.style.fontSize).toBeGreaterThan(titleItem(manual.project).content.data.style.fontSize)
    expect(titleItem(readSaved(join(root, 'T07-undone.h5lesson')).project)).toEqual(titleItem(manual.project))
    expect(runtimeItem(corrected.project)).toEqual(runtimeItem(manual.project)); expect(imageItem(corrected.project)).toEqual(imageItem(manual.project))
    profilePath = realpathSync(previous.executionProfilePath)
    runtimeOnly = { source: root, record: failedRuntime, corrected, selected: previous.selected }
  }
  expect(profilePath.toLowerCase().startsWith(slotRoot.toLowerCase() + '\\') || profilePath.toLowerCase().startsWith(slotRoot.toLowerCase() + '/')).toBe(true)
  const historyFiles: NativeT01Resume['historyFiles'] = []
  for (const profile of new Set([join(slotRoot, 'profile'), originalProfilePath, profilePath])) {
    const historyRoot = join(profile, 'local-agent', 'v2')
    for (const directory of readdirSync(historyRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const folder = join(historyRoot, directory.name)
      for (const entry of readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile() && /^[a-f0-9-]{36}(?:\.display)?\.json$/i.test(entry.name))) {
        const path = join(folder, entry.name); historyFiles.push({ path, bytes: readFileSync(path) })
      }
    }
  }
  for (const original of [record, oldRecord, ...(runtimeOnly ? [runtimeOnly.record] : [])]) {
    const persisted = historyFiles.find(file => file.path.startsWith(profilePath) && file.path.endsWith(`${original.id}.json`))
    if (!persisted) throw new Error('The original failed task is missing from the execution profile')
    expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(original)
  }
  const resume: NativeT01Resume = { sourceRoot: slotRoot, projectPath, profilePath,
    original: readSaved(join(slotRoot, 'T01.h5lesson')), t01Record, historyFiles }
  return { evidenceRoot, prior, manual, oldRecord, record, resume, runtimeOnly }
}

test('continue the retained failed correction, with optional affected Runtime rework', async ({}, info) => {
  test.skip(!source || !gate, 'No real native correction gate was selected')
  test.setTimeout(5 * timeout)
  expect(gate).toBe('same-slot-failed-correction')
  expect(model).not.toBe(''); expect(effort).not.toBe('')
  const checkpoint = loadCheckpoint(), { resume, manual, prior, runtimeOnly } = checkpoint
  const failedRecord = runtimeOnly?.record ?? checkpoint.record
  const adapter = prior.selected.adapter as NativeCli
  const runRoot = join(resume.sourceRoot, 'attempts', `failed-correction-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const manifest: Record<string, unknown> = { status: 'prepared', runRoot, source: checkpoint.evidenceRoot,
    selected: { adapter, ordinal: prior.selected.ordinal, model, effort }, previousConfiguration: runtimeOnly?.selected ?? prior.selected,
    nativeExternalSessionId: failedRecord.externalSessionId, originalFailedTask: failedRecord.id, originalCancelledTask: checkpoint.oldRecord.id,
    manualRevision: manual.project.revision, projectPath: resume.projectPath, fixtureRestored: false, candidateReplayed: false,
    modelTransition: model !== (runtimeOnly?.selected ?? prior.selected).model || effort !== (runtimeOnly?.selected ?? prior.selected).effort,
    // The app was restarted after the failure. Repeat exactly the original two
    // teacher instructions; live-race evidence remains in the unchanged source.
    correctionPrompt: `${NATIVE_PROMPTS.T07Start}\n${NATIVE_PROMPTS.T07}`, repairRuntime,
    runtimeOnlySource: runtimeOnly?.source ?? null,
    reusedCorrectionEvidence: runtimeOnly ? ['T07-repair.native.json', 'T07-repaired.h5lesson', 'T07-undone.h5lesson', 'T07-redone.h5lesson'].map(file => join(runtimeOnly.source, file)) : [],
    repeatedEarlierTasks: [], visualReviewRequired: repairRuntime, countsAsCompleteIndependentSlot: false }
  const persist = () => writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2))
  persist()
  if (inspectOnly) {
    manifest.status = 'checkpoint-verified-without-model'; manifest.nativeTurnsStarted = 0
    assertNativeHistoryPreserved(resume); persist(); return
  }
  prepareNativeExecutionProfile(resume, runRoot)
  manifest.executionProfilePath = resume.executionProfilePath
  let run: NativeRun | undefined
  const selectedRecord = async () => {
    const id = await run!.page.getByRole('complementary', { name: 'CLI 创作助手' }).getByLabel('会话', { exact: true }).inputValue()
    const record = nativeRecords(run!).find(value => value.id === id)
    if (!record) throw new Error('Current native record missing')
    expect(record.externalSessionId).toBe(failedRecord.externalSessionId)
    const configuration = [...record.events].reverse().find(event => event.kind === 'configuration')
    if (configuration?.kind !== 'configuration') throw new Error('No native configuration acknowledgement')
    expect(configuration.capabilities.current).toMatchObject({ model, effort })
    return record
  }
  try {
    run = await launchNativeEditor(productRoot, runRoot, resume.projectPath, resume)
    const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
    await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
    await chat.getByLabel('CLI', { exact: true }).selectOption(adapter)
    await expect(chat.getByLabel('会话', { exact: true }).locator(`option[value="${failedRecord.id}"]`)).toHaveCount(1)
    await chat.getByLabel('会话', { exact: true }).selectOption(failedRecord.id)
    const selector = chat.getByLabel('模型', { exact: true })
    await expect(selector).toBeEnabled({ timeout: 60000 }); await selector.selectOption(model); await expect(selector).toBeEnabled({ timeout: 60000 })
    const strength = chat.getByLabel('强度', { exact: true })
    await expect(strength).toBeEnabled({ timeout: 60000 }); await strength.selectOption(effort); await expect(strength).toBeEnabled({ timeout: 60000 })
    await selectReferenceScope(chat, 'selection')
    manifest.status = 'running'; persist()
    let corrected = runtimeOnly?.corrected ?? manual
    if (!runtimeOnly) {
    await selectLayer(run.page, FIXTURE_IDS.title)
    await expect(run.page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(MANUAL_TITLE)
    await sendNatural(run, 'T07-repair', manifest.correctionPrompt as string, timeout)
    corrected = await saveStage(run, 'T07-repaired')
    const correction = await selectedRecord()
    expect(receiptCount(correction)).toBeGreaterThan(0)
    expect(titleItem(corrected.project).content.data.text).toBe(MANUAL_TITLE)
    expect(titleItem(corrected.project).content.data.style.fontSize).toBeGreaterThan(titleItem(manual.project).content.data.style.fontSize)
    expect(runtimeItem(corrected.project)).toEqual(runtimeItem(manual.project))
    expect(imageItem(corrected.project)).toEqual(imageItem(manual.project))
    for (let index = 0; index < receiptCount(correction); index++) await run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    const undone = await saveStage(run, 'T07-undone')
    expect(titleItem(undone.project)).toEqual(titleItem(manual.project))
    for (let index = 0; index < receiptCount(correction); index++) await run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect(titleItem((await saveStage(run, 'T07-redone')).project)).toEqual(titleItem(corrected.project))
    }
    if (repairRuntime) {
      await selectLayer(run.page, runtimeItem(corrected.project).layerItemId)
      await sendNatural(run, 'T05-affected-rework', NATIVE_PROMPTS.T05, timeout)
      const cube = await saveStage(run, 'T05-reworked')
      expect(runtimeItem(cube.project).frame).toEqual(runtimeItem(manual.project).frame)
      expect(titleItem(cube.project)).toEqual(titleItem(corrected.project))
      await selectedRecord()
      await sampleRuntimeMotion(run, runtimeItem(cube.project), 'T05-reworked-runtime')
      const before = await observeRuntimeTiming(run, runtimeItem(cube.project), 'T06-before')
      await selectLayer(run.page, runtimeItem(cube.project).layerItemId)
      await sendNatural(run, 'T06-affected-rework', NATIVE_PROMPTS.T06, timeout)
      const slower = await saveStage(run, 'T06-reworked')
      expect(runtimeItem(slower.project).layerItemId).toBe(runtimeItem(cube.project).layerItemId)
      expect(runtimeItem(slower.project).frame).toEqual(runtimeItem(cube.project).frame)
      const speedChange = await selectedRecord()
      await sampleRuntimeMotion(run, runtimeItem(slower.project), 'T06-reworked-runtime')
      const after = await observeRuntimeTiming(run, runtimeItem(slower.project), 'T06-after')
      writeFileSync(join(runRoot, 'T06-speed-comparison.json'), JSON.stringify(assertObservedRuntimeSlower(before, after), null, 2))
      expect(receiptCount(speedChange)).toBeGreaterThan(0)
      for (let index = 0; index < receiptCount(speedChange); index++) await run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
      expect(runtimeItem((await saveStage(run, 'T06-undone')).project)).toEqual(runtimeItem(cube.project))
      for (let index = 0; index < receiptCount(speedChange); index++) await run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
      expect(runtimeItem((await saveStage(run, 'T06-redone')).project)).toEqual(runtimeItem(slower.project))
    }
    const final = await saveStage(run, 'final')
    await recordEvidence(run, 'final')
    await closeNativeEditor(run); run = undefined
    run = await launchNativeEditor(productRoot, runRoot, resume.projectPath, resume)
    expect((await saveStage(run, 'reopened')).project).toEqual(final.project)
    await sampleRuntimeMotion(run, runtimeItem(final.project), 'reopened-runtime')
    manifest.status = 'passed-affected-suffix-awaiting-visual-review'
    manifest.freshCoverage = [...(runtimeOnly ? [] : ['failed T07 correction']), 'Undo/Redo', ...(repairRuntime ? ['failed T05 Runtime result', 'affected T06'] : []), 'save/reopen', 'actual preview motion']
  } catch (error) {
    manifest.status = 'failed'; manifest.failure = String(error)
    if (run) {
      await recordEvidence(run, 'failure').catch(() => {}); await run.page.screenshot({ path: join(runRoot, 'failure.png') }).catch(() => {})
      try { manifest.failureSavedRevision = await preserveNativeFailure(run) }
      catch (saveError) { manifest.failureSaveError = String(saveError) }
    }
    throw error
  } finally {
    if (run) await closeNativeEditor(run)
    assertNativeHistoryPreserved(resume); manifest.existingHistoryPreserved = true; persist()
    await info.attach('failed-correction-manifest', { path: join(runRoot, 'run.json'), contentType: 'application/json' })
  }
})
