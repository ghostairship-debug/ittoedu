import { requireProjectWorkspace } from './r18NativeAuthoringFixture'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { localAgentRecordV2Schema, type LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import {
  FIXTURE_IDS, MANUAL_TITLE, NATIVE_PROMPTS, assertNativeHistoryPreserved, closeNativeEditor,
  imageItem, launchNativeEditor, nativeRecords, observeRuntimeTiming, prepareNativeExecutionProfile,
  preserveNativeFailure, readSaved, recordEvidence, runtimeItem, sampleRuntimeMotion, saveStage,
  selectLayer, sendNatural, titleItem, waitNativeTurn, type NativeRun, type NativeT01Resume,
} from './r18NativeAuthoringFixture'

// Explicitly bounded to these two actual failed visual results. No fixture restore,
// archive writer, candidate replay, prefix execution, or automatic paid retry.
const productRoot = resolve(__dirname, '../..')
const worktrees = resolve(productRoot, '../courseware-r18-worktrees/20260908-development')
const slots = {
  A: join(worktrees, 'codex-opencode/output/r18-native-authoring/claude-2-2026-09-08T14-13-09-491Z'),
  B: join(worktrees, 'flow/output/r18-native-authoring/claude-3-2026-09-08T13-04-42-466Z'),
} as const
const bSuffix = 'failed-t07-suffix-2026-09-08T15-15-21-978Z'
const bLatestFailure = 'claude-runtime-2026-09-08T16-55-10-962Z'
const selectedSlot = process.env.COURSEWARE_R18_CLAUDE_RUNTIME_SLOT
const execute = process.env.COURSEWARE_R18_CLAUDE_RUNTIME_GATE === 'same-native-actual-visual-repair'
const timeout = 20 * 60_000
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const records = (path: string): LocalAgentRecordV2[] => json(path).records.map((value: unknown) => localAgentRecordV2Schema.parse(value))
const committed = (record: LocalAgentRecordV2) => record.hostResults.flatMap(result => result.receipts).filter(receipt => receipt.status === 'committed')
const repairPrompts = {
  A: '现在这个翻滚立方体旋转时会被自身显示区域的边缘裁掉。请修好，让它在完整翻滚过程中始终完整可见，仍保持当前的位置、外框大小和已调慢的速度。不要改标题和绿色图片。',
  B: '上一轮仍未修好。检查发现你准备的后备图片原文件可以正常打开，但交付到课件时图片数据损坏了。请保留原文件完整数据，把这个问题修好。也请继续原来的动画目标：让立方体持续明显转动，能看清不同的面，仍比最初调慢前慢，但不能像当前这样观察近50秒几乎不动。保留同一个立方体、现在的位置和外框大小，以及教师手工修改后的标题、字号和绿色图片；不重复已经完成的标题修改。',
} as const

function loadCheckpoint(slot: keyof typeof slots) {
  const sourceRoot = realpathSync(slots[slot])
  const evidenceRoot = slot === 'A' ? sourceRoot : realpathSync(join(sourceRoot, 'attempts', bLatestFailure))
  const prior = json(join(evidenceRoot, 'run.json'))
  const projectPath = realpathSync(prior.projectPath)
  expect(dirname(projectPath)).toBe(sourceRoot)
  const current = readSaved(projectPath)
  const profilePath = realpathSync(slot === 'A' ? join(sourceRoot, 'profile') : prior.executionProfilePath)
  const t01Record = records(join(sourceRoot, 'T01.native.json'))[0]!
  const historyFiles: NativeT01Resume['historyFiles'] = []
  for (const profile of new Set([realpathSync(join(sourceRoot, 'profile')), profilePath])) {
    for (const directory of readdirSync(join(profile, 'local-agent/v2'), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const folder = join(profile, 'local-agent/v2', directory.name)
      for (const entry of readdirSync(folder).filter(name => /^[a-f0-9-]{36}(?:\.display)?\.json$/i.test(name))) {
        const path = join(folder, entry); historyFiles.push({ path, bytes: readFileSync(path) })
      }
    }
  }
  const persisted = historyFiles.filter(file => file.path.startsWith(profilePath) && !file.path.endsWith('.display.json'))
    .map(file => localAgentRecordV2Schema.parse(JSON.parse(file.bytes.toString('utf8'))))
  const identity = (record: LocalAgentRecordV2) => {
    expect(record.externalSessionId).toBe(t01Record.externalSessionId)
    expect(record.workspace).toEqual(t01Record.workspace)
    expect(requireProjectWorkspace(record.workspace).projectId).toBe(current.project.id)
    expect(requireProjectWorkspace(record.workspace).normalizedPath).toBe(projectPath.replace(/\\/g, '/').toLowerCase())
  }
  let selected: LocalAgentRecordV2
  if (slot === 'A') {
    expect(prior.status).toBe('failed')
    expect(prior.failure).toContain('Timeout 60000ms exceeded while waiting on the predicate')
    expect(prior.failure).toContain('afterSend')
    expect(current, 'No failure archive exists: prove the actual disk result still equals the last committed T04').toEqual(readSaved(join(sourceRoot, 'T04.h5lesson')))
    for (const file of ['T07-manual.h5lesson', 'T07.input.json', 'T07.h5lesson']) expect(existsSync(join(sourceRoot, file))).toBe(false)
    const failed = records(join(sourceRoot, 'failure.native.json')).find(record => record.tasks.at(-1)?.goal === NATIVE_PROMPTS.T07Start)!
    expect(failed).toBeDefined(); expect(committed(failed)).toHaveLength(0)
    selected = persisted.find(record => record.id === failed.id)!
    expect(selected).toBeDefined(); expect(committed(selected)).toHaveLength(0)
    // Closing the real app cancelled this orphan; retain both snapshots as-is.
    expect(selected.tasks.at(-1)?.status).toBe('cancelled')
    expect(selected.tasks.at(-1)?.taskId).toBe(failed.tasks.at(-1)?.taskId)
    expect(titleItem(current.project).content.data.text).toBe('简谐运动')
  } else {
    expect(prior.status).toBe('failed')
    expect(prior.failureSavedRevision).toBe(8)
    expect(current).toEqual(readSaved(join(evidenceRoot, 'failure-current.h5lesson')))
    const review = json(join(evidenceRoot, 'manual-review.json'))
    expect(review.status).toBe('runtime-repair-failed-candidate-image-copy-corruption')
    expect(review.currentHostSessionId).toBe('c260b173-da4a-44dc-ad5d-ed967412d6b1')
    expect(review.nativeExternalSessionId).toBe('30d2f0a6-087e-41de-af2f-3d46775d6f87')
    const t07Root = realpathSync(join(sourceRoot, 'attempts', bSuffix))
    for (const file of ['T07-repaired.h5lesson', 'T07-redone.h5lesson', 'final.h5lesson', 'reopened.h5lesson']) {
      expect(current).toEqual(readSaved(join(t07Root, file)))
    }
    expect(current.project.revision).toBe(8)
    expect(titleItem(current.project).content.data.text).toBe(MANUAL_TITLE)
    expect(titleItem(current.project).content.data.style.fontSize).toBe(58)
    const manual = readSaved(join(sourceRoot, 'T07-manual.h5lesson'))
    expect(titleItem(manual.project).content.data.style.fontSize).toBe(44)
    expect(titleItem(readSaved(join(t07Root, 'T07-undone.h5lesson')).project)).toEqual(titleItem(manual.project))
    expect(runtimeItem(current.project)).toEqual(runtimeItem(manual.project))
    expect(imageItem(current.project)).toEqual(imageItem(manual.project))
    selected = persisted.find(record => record.id === review.currentHostSessionId)!
    expect(selected).toBeDefined(); expect(selected.tasks.at(-1)?.status).toBe('failed')
    expect(committed(selected)).toHaveLength(0)
    expect(selected.externalSessionId).toBe(review.nativeExternalSessionId)
  }
  for (const record of persisted) identity(record)
  identity(selected)
  const config = [...selected.events].reverse().find(event => event.kind === 'configuration')
  if (config?.kind !== 'configuration') throw new Error('Latest actual record lacks acknowledged configuration')
  expect(config.capabilities.current).toMatchObject({ model: 'sonnet', effort: 'low' })
  const speedPath = join(sourceRoot, 'T06-speed-comparison.json'), speed = json(speedPath)
  expect(speed.status).toBe('passed')
  if (slot === 'A') expect(speed).toMatchObject({ beforePeriodMs: 6000, afterPeriodMs: 12000, periodRatio: 2 })
  else expect(speed.speedRatio).toBeCloseTo(0.0499630562701513, 10)
  expect(runtimeItem(current.project)).toEqual(runtimeItem(readSaved(join(sourceRoot, 'T06.h5lesson')).project))
  const resume: NativeT01Resume = { sourceRoot, projectPath, profilePath, historyFiles, t01Record, original: readSaved(join(sourceRoot, 'T01.h5lesson')) }
  return { resume, evidenceRoot, selected, current, speedPath, speed }
}

async function correctUnpassedT07(run: NativeRun, externalId: string | null | undefined) {
  const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
  await selectLayer(run.page, FIXTURE_IDS.title)
  const before = readSaved(run.projectPath), priorIds = new Set(nativeRecords(run).map(record => record.id))
  const deadline = Date.now() + timeout
  let manualRevision = -1
  writeFileSync(join(run.runRoot, 'T07-start.input.json'), JSON.stringify({ prompt: NATIVE_PROMPTS.T07Start,
    startedAt: new Date().toISOString(), deadline, selectedSession: await chat.getByLabel('会话', { exact: true }).inputValue() }, null, 2))
  await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07Start)
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeEnabled()
  {
    // This slot's successful T04 first text/tool arrived after 70.4s. The
    // historical 60s timeout stays retained; use the existing task deadline,
    // without accepting a late intervention after any commit or terminal state.
    let inFlight: LocalAgentRecordV2 | undefined
    while (Date.now() < deadline) {
      inFlight = nativeRecords(run).find(record => !priorIds.has(record.id))
      if (inFlight) {
        if (committed(inFlight).length) throw new Error('T07 committed before teacher intervention; this is not valid race evidence')
        if (inFlight.tasks.at(-1)?.status !== 'running') throw new Error(`T07 ended before teacher intervention: ${inFlight.tasks.at(-1)?.status}`)
        if (inFlight.events.some(event => ['text', 'tool'].includes(event.kind))) break
      }
      await run.page.waitForTimeout(300)
    }
    if (!inFlight?.events.some(event => ['text', 'tool'].includes(event.kind))) throw new Error('T07 exhausted its original 20 minute task budget before first text/tool')
    expect(committed(inFlight), 'Teacher must intervene before any live commit').toHaveLength(0)
    await selectLayer(run.page, FIXTURE_IDS.title)
    const editor = run.page.getByRole('textbox', { name: '文字内容', exact: true })
    await editor.fill(MANUAL_TITLE); await editor.press('Tab')
    manualRevision = (await saveStage(run, 'T07-manual')).project.revision
    writeFileSync(join(run.runRoot, 'T07.input.json'), JSON.stringify({ prompt: NATIVE_PROMPTS.T07, sentAfterManualRevision: manualRevision }, null, 2))
    const use = chat.getByLabel('输入用途', { exact: true })
    if (await use.count()) await use.selectOption('correct')
    await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07)
    await chat.getByRole('button', { name: /^(发送输入|发送)$/ }).click()
    await expect.poll(async () => {
      const id = await chat.getByLabel('会话', { exact: true }).inputValue()
      return id !== inFlight.id && nativeRecords(run).find(record => record.id === id)?.observations.some(observation => observation.documentRevision >= manualRevision)
    }, { timeout: Math.max(1, deadline - Date.now()) }).toBe(true)
    const cancelled = nativeRecords(run).find(record => record.id === inFlight.id)!
    expect(cancelled.tasks.at(-1)?.status).toBe('cancelled'); expect(committed(cancelled)).toHaveLength(0)
    await recordEvidence(run, 'T07-refreshed')
  }
  await waitNativeTurn(run, 'T07', Math.max(1, deadline - Date.now()))
  const saved = await saveStage(run, 'T07')
  const id = await chat.getByLabel('会话', { exact: true }).inputValue()
  const result = nativeRecords(run).find(record => record.id === id)!
  expect(result.externalSessionId).toBe(externalId)
  expect(committed(result).length).toBeGreaterThan(0)
  for (const receipt of committed(result)) expect(receipt.beforeRevision).toBeGreaterThanOrEqual(manualRevision)
  expect(titleItem(saved.project).content.data.text).toBe(MANUAL_TITLE)
  expect(titleItem(saved.project).content.data.style.fontSize).toBeGreaterThan(titleItem(before.project).content.data.style.fontSize)
  expect(runtimeItem(saved.project)).toEqual(runtimeItem(before.project))
  expect(imageItem(saved.project)).toEqual(imageItem(before.project))
}

for (const slot of ['A', 'B'] as const) test(`Claude ${slot} actual Runtime continuation checkpoint and bounded suffix`, async () => {
  test.skip(selectedSlot !== slot, 'Select exactly one actual retained slot')
  test.setTimeout(4 * timeout)
  const checkpoint = loadCheckpoint(slot), { resume, current, selected } = checkpoint
  const executionRoot = slot === 'B' ? realpathSync(join(worktrees, 'flow')) : productRoot
  let buildGate: Record<string, unknown> | undefined
  if (slot === 'B') {
    await expect(sharp(current.assetFiles[runtimeItem(current.project).runtime.staticFallback!.assetId]!).raw().toBuffer()).rejects.toThrow()
    const generated = json(join(productRoot, 'src/shared/generated/courseAgentCapabilities.json'))
    const built = json(join(executionRoot, 'dist-electron/shared/generated/courseAgentCapabilities.json'))
    expect(built.semanticVersion, 'Main must ship the current generated capability contract before any native send').toBe(generated.semanticVersion)
    expect(JSON.parse(built.files['tools/runtime.source.json']).inputSchema.properties.staticFallback).toBeDefined()
    const { createGenerationProfile } = require(join(executionRoot, 'dist-electron/main/localAgent/profile.js'))
    const profile = createGenerationProfile('claude', { purpose: 'local-edit', requestId: 'pre-send-build-gate', expectedResult: 'candidate' })
    expect(profile.resultChannel, 'Built Claude profile must deliver complete data through the existing staging file channel').toBe('session-staging-file')
    expect(profile.capability.candidateFileIngestion).toBe(true)
    buildGate = { semanticVersion: built.semanticVersion, runtimeSourceStaticFallback: true,
      claudeResultChannel: profile.resultChannel, candidateFileIngestion: profile.capability.candidateFileIngestion }
  }
  const runRoot = execute ? join(resume.sourceRoot, 'attempts', `claude-runtime-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    : join(productRoot, 'output/r18-claude-runtime-continuation', `${slot}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const manifest: Record<string, unknown> = { status: 'checkpoint-verified-without-model', slot, source: checkpoint.evidenceRoot,
    projectPath: resume.projectPath, projectRevision: current.project.revision, profilePath: resume.profilePath, executionRoot, buildGate,
    selectedSessionId: selected.id, nativeExternalSessionId: selected.externalSessionId,
    selected: { adapter: 'claude', model: 'sonnet', effort: 'low' }, modelTransition: false,
    nativeTurnsStarted: 0, repeatedEarlierTasks: [], reusedT07: slot === 'B', fixtureRestored: false, candidateReplayed: false,
    originalSpeedEvidence: { path: checkpoint.speedPath, value: checkpoint.speed },
    speedInterpretation: slot === 'B' ? 'The retained original T06 was slower (ratio about 0.05), but visually inadequate. New visible-speed repair is supplementary and cannot be substituted for that original comparison.'
      : 'Retain the original 6000/12000ms comparison. Geometry repair must preserve the current 12000ms animation period.',
    repairPrompt: repairPrompts[slot], countsAsCompleteIndependentSlot: false, ownerAcceptance: false, visualReviewRequired: true }
  const persist = () => writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2))
  persist()
  if (!execute) { assertNativeHistoryPreserved(resume); console.log(`CLAUDE_RUNTIME_CHECKPOINT ${runRoot}`); return }
  prepareNativeExecutionProfile(resume, runRoot)
  manifest.executionProfilePath = resume.executionProfilePath
  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(executionRoot, runRoot, resume.projectPath, resume)
    const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
    await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
    await chat.getByLabel('CLI', { exact: true }).selectOption('claude')
    await chat.getByLabel('会话', { exact: true }).selectOption(selected.id)
    const model = chat.getByLabel('模型', { exact: true }), effort = chat.getByLabel('强度', { exact: true })
    await expect(model).toBeEnabled({ timeout: 60000 }); await model.selectOption('sonnet')
    await expect(model).toBeEnabled({ timeout: 60000 }); await expect(model).toHaveValue('sonnet')
    await expect(effort).toBeEnabled({ timeout: 60000 }); await effort.selectOption('low')
    await expect(effort).toBeEnabled({ timeout: 60000 }); await expect(effort).toHaveValue('low')
    await chat.getByLabel('本轮引用', { exact: true }).selectOption('selection')
    await selectLayer(run.page, runtimeItem(current.project).layerItemId)
    manifest.status = 'running'; delete manifest.nativeTurnsStarted
    manifest.nativeExecutionRequested = true; persist()
    await sendNatural(run, 'Runtime-visual-repair', repairPrompts[slot], timeout)
    const repaired = await saveStage(run, 'Runtime-repaired')
    const id = await chat.getByLabel('会话', { exact: true }).inputValue()
    const repair = nativeRecords(run).find(record => record.id === id)!
    expect(repair.externalSessionId).toBe(selected.externalSessionId); expect(repair.workspace).toEqual(selected.workspace)
    const config = [...repair.events].reverse().find(event => event.kind === 'configuration')
    if (config?.kind !== 'configuration') throw new Error('Missing native configuration acknowledgement')
    expect(config.capabilities.current).toMatchObject({ model: 'sonnet', effort: 'low' })
    expect(committed(repair).length).toBeGreaterThan(0)
    expect(runtimeItem(repaired.project).layerItemId).toBe(runtimeItem(current.project).layerItemId)
    expect(runtimeItem(repaired.project).frame).toEqual(runtimeItem(current.project).frame)
    expect(titleItem(repaired.project)).toEqual(titleItem(current.project))
    expect(imageItem(repaired.project)).toEqual(imageItem(current.project))
    if (slot === 'B') {
      const fallbackId = runtimeItem(repaired.project).runtime.staticFallback!.assetId
      expect(fallbackId).not.toBe(runtimeItem(current.project).runtime.staticFallback!.assetId)
      const decoded = await sharp(repaired.assetFiles[fallbackId]!).raw().toBuffer({ resolveWithObject: true })
      manifest.repairedFallback = { assetId: fallbackId, decoded: true, width: decoded.info.width, height: decoded.info.height }
    }
    for (const _receipt of committed(repair)) await run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect((await saveStage(run, 'Runtime-undone')).project).toEqual(current.project)
    for (const _receipt of committed(repair)) await run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect((await saveStage(run, 'Runtime-redone')).project).toEqual(repaired.project)
    await sampleRuntimeMotion(run, runtimeItem(repaired.project), 'Runtime-repaired')
    if (slot === 'B') {
      const timing = await observeRuntimeTiming(run, runtimeItem(repaired.project), 'Runtime-repaired-timing')
      if (timing.source !== checkpoint.speed.mechanism || timing.source !== 'actual-preview-raf-dom-transforms') {
        throw new Error('New motion mechanism cannot be compared with the retained original T05 observer; matched observation is required')
      }
      expect(timing.clock).toBe(checkpoint.speed.clock)
      expect(timing.frameDeltaCapMs).toBe(checkpoint.speed.frameDeltaCapMs)
      expect(timing.requestedPaintCadenceMs).toBe(checkpoint.speed.requestedPaintCadenceMs)
      expect(timing.angularSpeedDegreesPerSecond).toBeGreaterThan(checkpoint.speed.afterDegreesPerSecond)
      expect(timing.angularSpeedDegreesPerSecond).toBeLessThan(checkpoint.speed.beforeDegreesPerSecond)
      manifest.supplementarySpeedComparison = { originalEvidencePath: checkpoint.speedPath,
        originalT05DegreesPerSecond: checkpoint.speed.beforeDegreesPerSecond,
        repairedDegreesPerSecond: timing.angularSpeedDegreesPerSecond,
        interpretation: 'Fresh repair is faster than the visually inadequate T06 and still slower than retained actual T05. This does not replace the original T06 evidence or prove visual quality.' }
    }
    if (slot === 'A') {
      const timing = await observeRuntimeTiming(run, runtimeItem(repaired.project), 'Runtime-repaired-timing')
      if (timing.source !== 'actual-preview-web-animations') throw new Error('A repair changed timing mechanism; original speed preservation requires review')
      expect(timing.effectivePeriodMs).toBe(12000)
      await correctUnpassedT07(run, selected.externalSessionId)
    }
    const final = await saveStage(run, 'final'); await recordEvidence(run, 'final')
    await closeNativeEditor(run); run = undefined
    run = await launchNativeEditor(executionRoot, runRoot, resume.projectPath, resume)
    expect(await saveStage(run, 'reopened')).toEqual(final)
    await sampleRuntimeMotion(run, runtimeItem(final.project), 'reopened-runtime')
    manifest.status = 'engineering-suffix-awaiting-visual-review'
    manifest.remaining = ['Review full chronological frames for cube geometry, clipping and visible rolling quality', 'Owner acceptance']
  } catch (error) {
    manifest.status = 'failed'; manifest.failure = String(error)
    if (run) {
      await recordEvidence(run, 'failure').catch(() => {})
      try { manifest.failureSavedRevision = await preserveNativeFailure(run) }
      catch (saveError) { manifest.failureSaveError = String(saveError) }
    }
    throw error
  } finally {
    if (run) await closeNativeEditor(run)
    assertNativeHistoryPreserved(resume); manifest.existingHistoryPreserved = true; persist()
  }
})
test.describe.configure({ retries: 0 })
