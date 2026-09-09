import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import { expect, test } from '@playwright/test'
import { localAgentRecordV2Schema, type LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import { workspaceIdentityKey } from '../../src/shared/workspaceIdentity'
import {
  FIXTURE_IDS,
  MANUAL_TITLE,
  NATIVE_PROMPTS,
  assertObservedRuntimeSlower,
  closeNativeEditor,
  launchNativeEditor,
  nativeEvidence,
  nativeRecords,
  observeRuntimeTiming,
  preserveNativeFailure,
  readSaved,
  recordEvidence,
  runtimeItem,
  sampleRuntimeMotion,
  saveStage,
  selectLayer,
  sendNatural,
  slideItems,
  titleItem,
  waitNativeTurn,
  type NativeRun,
} from './r18NativeAuthoringFixture'

const productRoot = resolve(__dirname, '..', '..')
const sourceRoot = resolve(productRoot, '../courseware-r18-worktrees/20260908-development/flow/output/r18-native-authoring/opencode-3-2026-09-08T14-14-21-479Z')
const recoveryRoot = join(sourceRoot, 'attempts', 'same-workspace-recovery-2026-09-08T16-19-46-069Z')
const recoveryCurrentPath = join(recoveryRoot, 'recovered-current.h5lesson')
const recoveryProfile = join(recoveryRoot, 'execution-profile')
const cancelledRepairRoot = join(sourceRoot, 'attempts', 'same-native-opencode3-repair-2026-09-08T16-48-33-831Z')
const cancelledRepairCurrentPath = join(cancelledRepairRoot, 'failure-current.h5lesson')
const cancelledRepairProfile = join(cancelledRepairRoot, 'execution-profile')
const committedRepairRoot = join(sourceRoot, 'attempts', 'same-native-opencode3-repair-2026-09-08T17-04-43-215Z')
const committedRepairCurrentPath = join(committedRepairRoot, 'failure-current.h5lesson')
const committedRepairProfile = join(committedRepairRoot, 'execution-profile')
const projectPath = join(sourceRoot, 'lesson.h5lesson')
const adapter = 'opencode' as const
const model = 'openai/gpt-5.6-luna'
const effort = 'max'
const oldExternalSessionId = 'ses_f7ea062c3ffexFCcEEF1LeOaZR'
const oldWorkingDirectoryId = '0ec79151-6966-41af-b648-2e13be933165'
const oldPartialRecordId = 'fa62fdb9-3711-47e9-95a3-7ced755b8bda'
const cancelledRepairRecordId = 'c866fa7b-a506-40e8-8341-7e595252f11e'
const committedRepairRecordId = 'ddbe9706-dbe5-483e-8de9-1141f5280447'
const committedFallbackAssetId = 'asset_QVtltJv4ka3tVOyFmaPZX'
const runtimeFallbackCapabilitySemanticVersion = 'aedad6ceb0bbacefb952e635dbafa1185e6bad352bff4c41e19427e5913562c6'
const expectedOldRecordIds = Object.freeze([
  '0ec79151-6966-41af-b648-2e13be933165',
  '1f4217b8-18df-4144-bad8-dec48cdbd5bf',
  oldPartialRecordId,
])
const expectedContinuationRecordIds = Object.freeze([...expectedOldRecordIds, cancelledRepairRecordId])
const expectedRev3RecordIds = Object.freeze([...expectedContinuationRecordIds, committedRepairRecordId])
const turnTimeoutMs = 20 * 60_000
const repairPrompt = [
  '当前这个蓝色立方体能正常转动，但静态后备图片已损坏。',
  '请只修好它的静态图片，保留同一个立方体、原有转动效果、位置和大小，其他内容保持不变。',
].join('')

async function observeCubeContainment(run: NativeRun, name: string) {
  await run.page.getByRole('button', { name: '全屏 16:9 整课预览', exact: true }).click()
  const stage = run.page.getByTestId('course-preview-host').locator('.slide-published-adapter')
  const cube = stage.locator('[data-slide-layer-item="runtime-WapXfJ1IDl"]')
  await expect(cube).toBeVisible()
  const samples: Array<{ at: number; overflow: number }> = []
  try {
    for (let index = 0; index < 24; index++) {
      const root = await cube.boundingBox()
      if (!root) throw new Error('Runtime frame is not visible')
      const faces = await cube.locator('div').evaluateAll(elements => elements
        .filter(element => (element as HTMLElement).style.backfaceVisibility === 'hidden')
        .map(element => element.getBoundingClientRect().toJSON()))
      expect(faces).toHaveLength(6)
      const overflow = Math.max(0, ...faces.flatMap(face => [root.x - face.left, root.y - face.top,
        face.right - root.x - root.width, face.bottom - root.y - root.height]))
      samples.push({ at: Date.now(), overflow })
      if ([0, 8, 16, 23].includes(index)) await run.page.screenshot({ path: join(run.runRoot, `${name}-full-${index}.png`), animations: 'allow' })
      await run.page.waitForTimeout(400)
    }
    const result = { source: 'actual unmodified preview; six transformed face bounds versus runtime frame',
      elapsedMs: samples.at(-1)!.at - samples[0]!.at, maximumOverflowCssPx: Math.max(...samples.map(sample => sample.overflow)), samples }
    writeFileSync(join(run.runRoot, `${name}-containment.json`), JSON.stringify(result, null, 2))
    expect(result.elapsedMs).toBeGreaterThan(8400)
    return result
  } finally { await run.page.getByTestId('course-preview-overlay').getByRole('button', { name: '关闭预览', exact: true }).click() }
}

interface FileSnapshot {
  readonly path: string
  readonly bytes: Buffer
}

interface SameNativeRecoveryCheckpoint {
  readonly manifest: Record<string, unknown>
  readonly recovered: ReturnType<typeof readSaved>
  readonly current: ReturnType<typeof readSaved>
  readonly records: LocalAgentRecordV2[]
  readonly workspace: LocalAgentRecordV2['workspace']
  readonly oldRecordFiles: FileSnapshot[]
}

interface SameNativeRepairContinuationCheckpoint {
  readonly recovery: SameNativeRecoveryCheckpoint
  readonly current: ReturnType<typeof readSaved>
  readonly records: LocalAgentRecordV2[]
  readonly workspace: LocalAgentRecordV2['workspace']
  readonly originalRecordFiles: FileSnapshot[]
  readonly cancelledRecordFiles: FileSnapshot[]
  readonly capabilitySemanticVersion: string
}

interface SameNativeRev3TailCheckpoint {
  readonly current: ReturnType<typeof readSaved>
  readonly records: LocalAgentRecordV2[]
  readonly workspace: LocalAgentRecordV2['workspace']
  readonly recordFiles: FileSnapshot[]
  readonly committedRepair: LocalAgentRecordV2
}

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return files(path)
    if (entry.isFile()) return [path]
    throw new Error('Unsupported profile entry: ' + path)
  })
}

function copyTree(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(destination, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isFile()) copyFileSync(from, to)
    else throw new Error('Unsupported profile entry: ' + from)
  }
}

function recordSnapshots(profile: string): FileSnapshot[] {
  const root = join(profile, 'local-agent', 'v2')
  return files(root)
    .filter(path => /^[a-f0-9-]{36}(?:\.display)?\.json$/i.test(basename(path)))
    .map(path => ({ path, bytes: readFileSync(path) }))
}

function committed(record: LocalAgentRecordV2) {
  return record.hostResults.flatMap(result => result.receipts).filter(receipt => receipt.status === 'committed')
}

async function selectedRecord(run: NativeRun): Promise<LocalAgentRecordV2> {
  const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
  const id = await chat.getByLabel('会话', { exact: true }).inputValue()
  const record = nativeRecords(run).find(value => value.id === id)
  if (!record) throw new Error('No durable native record for selected session ' + id)
  return record
}

function assertOldHistory(records: LocalAgentRecordV2[], workspace: LocalAgentRecordV2['workspace']): void {
  expect(records).toHaveLength(3)
  expect(records.map(record => record.id).sort()).toEqual([...expectedOldRecordIds].sort())
  for (const record of records) {
    expect(record.adapter).toBe(adapter)
    expect(record.workspace).toEqual(workspace)
    expect(record.externalSessionId).toBe(oldExternalSessionId)
    expect(record.workingDirectoryId).toBe(oldWorkingDirectoryId)
  }
  const partial = records.find(record => record.id === oldPartialRecordId)
  expect(partial?.tasks.at(-1)?.status).toBe('partial')
  expect(partial?.tasks.at(-1)?.goal).toBe(NATIVE_PROMPTS.T05)
  expect(partial && committed(partial)).toHaveLength(1)
}

function samePath(value: unknown, expected: string): boolean {
  return typeof value === 'string'
    && resolve(value).replace(/\\/g, '/').toLowerCase() === resolve(expected).replace(/\\/g, '/').toLowerCase()
}

/** Read the actual zero-model recovery result. This is intentionally pure: it
 * does not start Electron, replay a candidate, write a profile, or contact a
 * provider. The paid driver below consumes this same parsed checkpoint. */
function loadSameNativeRecoveryCheckpoint(): SameNativeRecoveryCheckpoint {
  const manifestPath = join(recoveryRoot, 'recovery-result.json')
  if (!existsSync(manifestPath)) throw new Error('Actual same-native recovery manifest is unavailable')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  expect(manifest).toMatchObject({
    sourceRoot,
    projectPath,
    executionProfilePath: recoveryProfile,
    modelCalls: 0,
    status: 'same-workspace-recovered-saved-reopened-zero-model',
    externalSessionId: oldExternalSessionId,
    originalHistoryPreserved: true,
  })
  expect(samePath(manifest.recoveryPath, join(sourceRoot, 'profile', 'project-data', 'recovery.h5lesson'))).toBe(true)
  expect(samePath(manifest.savedPath, recoveryCurrentPath)).toBe(true)
  expect(manifest.boundary).toMatchObject({
    workspace: {
      version: 1,
      projectId: 'project_UMTFNPtGtoWHwAN_eOyyS',
      normalizedPath: projectPath.replace(/\\/g, '/').toLowerCase(),
    },
  })
  expect(existsSync(join(recoveryProfile, 'project-data', 'recovery.h5lesson'))).toBe(false)
  const recovered = readSaved(recoveryCurrentPath)
  const current = readSaved(projectPath)
  expect(current).toEqual(recovered)
  expect(current.project.revision).toBe(2)
  expect(current.project.id).toBe('project_UMTFNPtGtoWHwAN_eOyyS')
  const records = nativeRecords({ userData: recoveryProfile } as NativeRun)
  const workspace = records[0]?.workspace
  if (!workspace) throw new Error('Recovered execution profile has no durable native record')
  assertOldHistory(records, workspace)
  const oldRecordFiles = recordSnapshots(recoveryProfile)
  expect(oldRecordFiles).toHaveLength(6)
  return { manifest, recovered, current, records, workspace, oldRecordFiles }
}

function generatedRuntimeSourceCapability(relativePath: string) {
  const generated = JSON.parse(readFileSync(join(productRoot, relativePath), 'utf8')) as {
    semanticVersion?: unknown
    files?: Record<string, unknown>
  }
  const rawCard = generated.files?.['tools/runtime.source.json']
  if (typeof generated.semanticVersion !== 'string' || typeof rawCard !== 'string') {
    throw new Error('Generated runtime.source capability is unreadable: ' + relativePath)
  }
  return {
    semanticVersion: generated.semanticVersion,
    card: JSON.parse(rawCard) as { name?: unknown, inputSchema?: { properties?: Record<string, unknown> } },
  }
}

function assertCurrentRuntimeFallbackCapability(): string {
  const source = generatedRuntimeSourceCapability('src/shared/generated/courseAgentCapabilities.json')
  const built = generatedRuntimeSourceCapability('dist-electron/shared/generated/courseAgentCapabilities.json')
  expect(source.semanticVersion, 'Renderer and Main must use one current generated capability contract').toBe(built.semanticVersion)
  expect(source.semanticVersion).toBe(runtimeFallbackCapabilitySemanticVersion)
  for (const capability of [source, built]) {
    expect(capability.card.name).toBe('runtime.source')
    expect(capability.card.inputSchema?.properties?.staticFallback).toMatchObject({
      type: 'object',
      properties: { assetId: { type: 'string' }, coverage: { type: 'string' } },
    })
  }
  return source.semanticVersion
}

function recordFilesForIds(profile: string, ids: readonly string[]): FileSnapshot[] {
  return recordSnapshots(profile).filter(file => {
    const match = /^([a-f0-9-]{36})(?:\.display)?\.json$/i.exec(basename(file.path))
    return !!match && ids.includes(match[1]!)
  })
}

function actualRuntimeSourceCapability(profile: string, recordId: string, semanticVersion: string) {
  const recordFile = recordSnapshots(profile).find(file => basename(file.path) === recordId + '.json')
  if (!recordFile) throw new Error('No durable record file for runtime capability check: ' + recordId)
  const path = join(dirname(recordFile.path), 'staging', 'capabilities', semanticVersion, 'tools', 'runtime.source.json')
  if (!existsSync(path)) throw new Error('The newly launched Main did not stage its current runtime.source capability: ' + path)
  return JSON.parse(readFileSync(path, 'utf8')) as { name?: unknown, inputSchema?: { properties?: Record<string, unknown> } }
}

function loadSameNativeRepairContinuationCheckpoint(): SameNativeRepairContinuationCheckpoint {
  const recovery = loadSameNativeRecoveryCheckpoint()
  if (!existsSync(cancelledRepairCurrentPath) || !existsSync(cancelledRepairProfile)) {
    throw new Error('The latest cancelled same-native repair checkpoint is unavailable')
  }
  const current = readSaved(cancelledRepairCurrentPath)
  expect(current).toEqual(recovery.current)
  expect(readSaved(projectPath)).toEqual(current)
  expect(current.project.revision).toBe(2)
  expect(current.project.id).toBe('project_UMTFNPtGtoWHwAN_eOyyS')
  const records = nativeRecords({ userData: cancelledRepairProfile } as NativeRun)
  expect(records).toHaveLength(4)
  expect(records.map(record => record.id).sort()).toEqual([...expectedContinuationRecordIds].sort())
  const workspace = records[0]?.workspace
  if (!workspace) throw new Error('The cancelled repair profile has no durable native record')
  assertOldHistory(records.filter(record => expectedOldRecordIds.includes(record.id)), workspace)
  const cancelled = records.find(record => record.id === cancelledRepairRecordId)
  expect(cancelled).toMatchObject({
    adapter,
    workspace,
    externalSessionId: oldExternalSessionId,
    workingDirectoryId: oldWorkingDirectoryId,
  })
  expect(cancelled?.tasks.at(-1)).toMatchObject({ status: 'cancelled', goal: repairPrompt, committedResultIds: [] })
  expect(cancelled && committed(cancelled)).toHaveLength(0)
  expect(cancelled?.hostResults).toHaveLength(0)
  expect(cancelled?.events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'cancelled', failure: null })
  const originalRecordFiles = recordFilesForIds(cancelledRepairProfile, expectedOldRecordIds)
  const cancelledRecordFiles = recordFilesForIds(cancelledRepairProfile, [cancelledRepairRecordId])
  expect(originalRecordFiles).toHaveLength(recovery.oldRecordFiles.length)
  expect(cancelledRecordFiles).toHaveLength(2)
  for (const source of recovery.oldRecordFiles) {
    const copied = join(cancelledRepairProfile, relative(recoveryProfile, source.path))
    expect(existsSync(copied), 'The cancelled profile must retain every original history record').toBe(true)
    expect(readFileSync(copied)).toEqual(source.bytes)
  }
  return {
    recovery,
    current,
    records,
    workspace,
    originalRecordFiles,
    cancelledRecordFiles,
    capabilitySemanticVersion: assertCurrentRuntimeFallbackCapability(),
  }
}

function loadSameNativeRev3TailCheckpoint(): SameNativeRev3TailCheckpoint {
  if (!existsSync(committedRepairCurrentPath) || !existsSync(committedRepairProfile)) {
    throw new Error('The committed rev3 same-native repair checkpoint is unavailable')
  }
  const current = readSaved(committedRepairCurrentPath)
  expect(readSaved(projectPath)).toEqual(current)
  expect(current.project.revision).toBe(3)
  expect(current.project.id).toBe('project_UMTFNPtGtoWHwAN_eOyyS')
  const records = nativeRecords({ userData: committedRepairProfile } as NativeRun)
  expect(records).toHaveLength(5)
  expect(records.map(record => record.id).sort()).toEqual([...expectedRev3RecordIds].sort())
  const workspace = records[0]?.workspace
  if (!workspace) throw new Error('The committed rev3 execution profile has no durable native record')
  assertOldHistory(records.filter(record => expectedOldRecordIds.includes(record.id)), workspace)
  const cancelled = records.find(record => record.id === cancelledRepairRecordId)
  expect(cancelled?.tasks.at(-1)).toMatchObject({ status: 'cancelled', committedResultIds: [] })
  expect(cancelled && committed(cancelled)).toHaveLength(0)
  const committedRepair = records.find(record => record.id === committedRepairRecordId)
  expect(committedRepair).toMatchObject({ adapter, workspace, externalSessionId: oldExternalSessionId, workingDirectoryId: oldWorkingDirectoryId })
  expect(committedRepair?.tasks.at(-1)).toMatchObject({ status: 'partial', goal: repairPrompt })
  const repairReceipts = committed(committedRepair!)
  expect(repairReceipts).toHaveLength(1)
  expect(repairReceipts[0]).toMatchObject({ beforeRevision: 2, afterRevision: 3, resources: { assetIds: [committedFallbackAssetId] } })
  expect(repairReceipts[0]?.affected).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: committedFallbackAssetId, operation: 'created' }),
    expect.objectContaining({ id: 'runtime-WapXfJ1IDl', operation: 'updated' }),
  ]))
  const runtime = runtimeItem(current.project)
  expect(runtime.layerItemId).toBe('runtime-WapXfJ1IDl')
  expect(runtime.runtime.staticFallback).toEqual({ assetId: committedFallbackAssetId, coverage: 'scene' })
  expect(current.project.assets[committedFallbackAssetId]).toMatchObject({ kind: 'image', mimeType: 'image/svg+xml' })
  expect(slideItems(current.project).some(item => item.layerItemId === FIXTURE_IDS.square)).toBe(false)
  const recordFiles = recordSnapshots(committedRepairProfile)
  expect(recordFiles).toHaveLength(10)
  return { current, records, workspace, recordFiles, committedRepair: committedRepair! }
}

function assertResumedIdentity(record: LocalAgentRecordV2, workspace: LocalAgentRecordV2['workspace'], previousId: string): void {
  expect(record.id).not.toBe(previousId)
  expect(record.adapter).toBe(adapter)
  expect(record.workspace).toEqual(workspace)
  expect(record.externalSessionId).toBe(oldExternalSessionId)
  expect(record.workingDirectoryId).toBe(oldWorkingDirectoryId)
  const configuration = [...record.events].reverse().find(event => event.kind === 'configuration' && event.capabilities.current.model !== null)
  if (!configuration || configuration.kind !== 'configuration') throw new Error('No native-confirmed OpenCode configuration was recorded')
  expect(configuration.capabilities.current.model).toBe(model)
  expect(configuration.capabilities.current.effort).toBe(effort)
}

function resumedStagingRoot(run: NativeRun, workspace: LocalAgentRecordV2['workspace'], workingDirectoryId: string): string {
  const workspaceDirectory = join(run.userData, 'local-agent', 'v2', createHash('sha256').update(workspaceIdentityKey(workspace)).digest('hex'))
  const ownerRecordPath = join(workspaceDirectory, `${workingDirectoryId}.json`)
  if (!existsSync(ownerRecordPath)) throw new Error('The resumed V2 owner record is not stored in the exact workspace directory')
  const owner = localAgentRecordV2Schema.parse(JSON.parse(readFileSync(ownerRecordPath, 'utf8')))
  expect(owner.workingDirectoryId).toBe(workingDirectoryId)
  expect(owner.workspace).toEqual(workspace)
  const stagingRoot = join(workspaceDirectory, workingDirectoryId, 'staging')
  if (!existsSync(stagingRoot)) throw new Error('The exact resumed owner has no staging directory')
  return stagingRoot
}

async function configureOpenCode(run: NativeRun) {
  await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
  const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
  await chat.getByLabel('CLI', { exact: true }).selectOption(adapter)
  const modelControl = chat.getByLabel('模型', { exact: true })
  await expect(modelControl).toBeEnabled({ timeout: 60_000 })
  expect(await modelControl.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toContain(model)
  await modelControl.selectOption(model)
  const effortControl = chat.getByLabel('强度', { exact: true })
  await expect(effortControl).toBeEnabled()
  await effortControl.selectOption(effort)
  await chat.getByLabel('本轮引用', { exact: true }).selectOption('selection')
  await chat.getByLabel('意图', { exact: true }).selectOption('edit')
  await chat.getByLabel('应用方式', { exact: true }).selectOption('auto')
  return chat
}

async function expectUndecodable(bytes: Uint8Array): Promise<void> {
  let decoded = true
  try {
    await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer()
  } catch {
    decoded = false
  }
  expect(decoded, 'The recovered fixture must retain the actual malformed static fallback').toBe(false)
}

async function assertBlueFallback(bytes: Uint8Array): Promise<{ width: number; height: number; bluePixels: number }> {
  const decoded = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let bluePixels = 0
  for (let offset = 0; offset < decoded.data.length; offset += 4) {
    const red = decoded.data[offset]!, green = decoded.data[offset + 1]!, blue = decoded.data[offset + 2]!, alpha = decoded.data[offset + 3]!
    if (alpha > 180 && blue > red * 1.2 && blue > green * 1.08) bluePixels++
  }
  expect(decoded.info.width).toBeGreaterThan(8)
  expect(decoded.info.height).toBeGreaterThan(8)
  expect(bluePixels, 'The replacement fallback must visibly contain a blue cube rather than a blank or unrelated image').toBeGreaterThan(
    Math.max(16, decoded.info.width * decoded.info.height * .04),
  )
  return { width: decoded.info.width, height: decoded.info.height, bluePixels }
}

// This is an explicitly budgeted, one-shot native continuation. It starts from
// the recovered rev2 lesson and old OpenCode session; no recovery UI, historic
// candidate replay, or T01/T02/T05 setup is part of this driver.
test.use({ trace: 'off' })
test('R18 OpenCode rev3 tail checkpoint validates the committed SVG and native identity without a model turn', async () => {
  const checkpoint = loadSameNativeRev3TailCheckpoint()
  const fallback = runtimeItem(checkpoint.current.project).runtime.staticFallback!
  await assertBlueFallback(checkpoint.current.assetFiles[fallback.assetId]!)
  const staging = resumedStagingRoot({ userData: committedRepairProfile } as NativeRun, checkpoint.workspace, oldWorkingDirectoryId)
  expect(existsSync(join(staging, 'capabilities', runtimeFallbackCapabilitySemanticVersion))).toBe(true)
})

test('R18 OpenCode same-native checkpoint inspection consumes the latest cancelled rev2 repair profile without a model turn', () => {
  test.skip(!existsSync(join(recoveryRoot, 'recovery-result.json')) || !existsSync(cancelledRepairProfile), 'The retained same-native recovery artifacts are unavailable in this checkout')
  const checkpoint = loadSameNativeRepairContinuationCheckpoint()
  expect(checkpoint.recovery.manifest.modelCalls).toBe(0)
  expect(checkpoint.records.find(record => record.id === oldPartialRecordId)?.tasks.at(-1)?.status).toBe('partial')
  expect(checkpoint.records.find(record => record.id === cancelledRepairRecordId)?.tasks.at(-1)?.status).toBe('cancelled')
})

test('R18 OpenCode3 repairs the original recovered Runtime then continues T06/T04/T07 through the same native workspace', async ({}, testInfo) => {
  test.skip(process.env.COURSEWARE_R18_OPENCODE3_SAME_NATIVE_REPAIR !== 'opencode-3-repair', 'Explicit same-native OpenCode repair gate is closed')
  expect(testInfo.retry).toBe(0)
  test.setTimeout(6 * turnTimeoutMs + 10 * 60_000)
  testInfo.annotations.push({ type: 'native-evidence', description: 'One real OpenCode continuation in the already recovered original workspace. It is engineering evidence, not Owner acceptance.' })

  const checkpoint = loadSameNativeRepairContinuationCheckpoint()
  const { current, records: sourceRecords, workspace, originalRecordFiles, cancelledRecordFiles, capabilitySemanticVersion } = checkpoint

  const baselineRuntime = runtimeItem(current.project)
  const baselineFallback = baselineRuntime.runtime.staticFallback
  if (!baselineFallback) throw new Error('Recovered Runtime has no static fallback to repair')
  const baselineFallbackBytes = current.assetFiles[baselineFallback.assetId]
  if (!baselineFallbackBytes) throw new Error('Recovered Runtime fallback has no archived asset bytes')
  await expectUndecodable(baselineFallbackBytes)
  expect(slideItems(current.project).some(item => item.layerItemId === FIXTURE_IDS.square)).toBe(false)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runRoot = join(sourceRoot, 'attempts', 'same-native-opencode3-repair-' + stamp)
  const executionProfile = join(runRoot, 'execution-profile')
  mkdirSync(runRoot, { recursive: true })
  copyTree(cancelledRepairProfile, executionProfile)
  const manifest: Record<string, unknown> = {
    sourceRoot,
    recoveryRoot,
    recoveryCurrentPath,
    recoveryExecutionProfile: recoveryProfile,
    cancelledRepairRoot,
    cancelledRepairCurrentPath,
    cancelledRepairProfile,
    projectPath,
    executionProfile,
    selected: { adapter, model, effort, resumeSessionId: cancelledRepairRecordId, externalSessionId: oldExternalSessionId },
    sourceRevision: current.project.revision,
    sourceProjectId: current.project.id,
    originalRecordIds: expectedOldRecordIds,
    cancelledRepairRecordId,
    oldWorkingDirectoryId,
    capabilitySemanticVersion,
    allowedWrites: [runRoot, projectPath],
    noRecoveryUi: true,
    noHistoricalCandidateReplay: true,
    noT01T02T05Replay: true,
    noAutomaticRetries: true,
    ownerAcceptance: false,
    status: 'prepared-no-provider-turn',
  }
  const persist = () => writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2))
  persist()

  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(productRoot, runRoot, projectPath, {
      sourceRoot,
      projectPath,
      profilePath: cancelledRepairProfile,
      executionProfilePath: executionProfile,
    })
    await expect(run.page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })).toHaveCount(0)
    expect(readSaved(projectPath)).toEqual(current)
    expect(nativeRecords(run)).toEqual(sourceRecords)

    const chat = await configureOpenCode(run)
    const session = chat.getByLabel('会话', { exact: true })
    await expect(session.locator('option[value="' + cancelledRepairRecordId + '"]')).toHaveCount(1)
    await session.selectOption(cancelledRepairRecordId)
    await expect.poll(async () => (await selectedRecord(run!)).id).toBe(cancelledRepairRecordId)
    expect((await selectedRecord(run)).tasks.at(-1)?.status).toBe('cancelled')
    expect(nativeRecords(run)).toEqual(sourceRecords)
    await selectLayer(run.page, baselineRuntime.layerItemId)
    await sampleRuntimeMotion(run, baselineRuntime, 'repair-before')
    expect(existsSync(join(runRoot, 'T01.input.json'))).toBe(false)
    expect(existsSync(join(runRoot, 'T02.input.json'))).toBe(false)

    manifest.status = 'old-native-selected-awaiting-one-repair-turn'
    persist()
    await test.step('repair only the corrupt static fallback on the selected Runtime', async () => {
      await sendNatural(run!, 'repair-static-fallback', repairPrompt, turnTimeoutMs)
      const repaired = await saveStage(run!, 'repair-static-fallback')
      const after = runtimeItem(repaired.project)
      expect(after.layerItemId).toBe(baselineRuntime.layerItemId)
      expect(after.frame).toEqual(baselineRuntime.frame)
      expect(after.runtime.source).toBe(baselineRuntime.runtime.source)
      expect(after.runtime.content).toEqual(baselineRuntime.runtime.content)
      expect(after.runtime.assets).toEqual(baselineRuntime.runtime.assets)
      expect(after.runtime.staticFallback?.coverage).toBe(baselineFallback.coverage)
      expect(after.runtime.staticFallback?.assetId).not.toBe(baselineFallback.assetId)
      const replacementFallbackId = after.runtime.staticFallback?.assetId
      if (!replacementFallbackId) throw new Error('Repair removed the Runtime fallback instead of rebinding it')
      expect(repaired.project.assets[replacementFallbackId]?.kind).toBe('image')
      const replacementBytes = repaired.assetFiles[replacementFallbackId]
      if (!replacementBytes) throw new Error('Repair registered a fallback without archived image bytes')
      const fallbackEvidence = await assertBlueFallback(replacementBytes)
      const record = await selectedRecord(run!)
      assertResumedIdentity(record, workspace, cancelledRepairRecordId)
      const actualCapability = actualRuntimeSourceCapability(executionProfile, cancelledRepairRecordId, capabilitySemanticVersion)
      expect(actualCapability.name).toBe('runtime.source')
      expect(actualCapability.inputSchema?.properties?.staticFallback).toMatchObject({
        type: 'object',
        properties: { assetId: { type: 'string' }, coverage: { type: 'string' } },
      })
      expect(record.tasks.at(-1)?.goal).toBe(repairPrompt)
      const receipts = committed(record)
      expect(receipts).not.toHaveLength(0)
      expect(receipts.some(receipt => receipt.affected.some(effect => effect.id === after.layerItemId && effect.operation === 'updated'))).toBe(true)
      expect(receipts.some(receipt => receipt.resources.assetIds.includes(replacementFallbackId))).toBe(true)
      expect(receipts.flatMap(receipt => receipt.affected).some(effect => effect.id === FIXTURE_IDS.square)).toBe(false)
      expect(slideItems(repaired.project).some(item => item.layerItemId === FIXTURE_IDS.square)).toBe(false)
      await sampleRuntimeMotion(run!, after, 'repair-after')
      manifest.repair = {
        recordId: record.id,
        priorRecordId: cancelledRepairRecordId,
        runtimeId: after.layerItemId,
        oldFallbackAssetId: baselineFallback.assetId,
        replacementFallbackAssetId: replacementFallbackId,
        fallbackEvidence,
        actualCapabilitySemanticVersion: capabilitySemanticVersion,
        receipts,
      }
      persist()

      const beforeTiming = await observeRuntimeTiming(run!, after, 'T06-before')
      await selectLayer(run!.page, after.layerItemId)
      await sendNatural(run!, 'T06', NATIVE_PROMPTS.T06, turnTimeoutMs)
      const slowed = await saveStage(run!, 'T06')
      const slowRuntime = runtimeItem(slowed.project)
      expect(slowRuntime.layerItemId).toBe(after.layerItemId)
      expect(slowRuntime.frame).toEqual(after.frame)
      expect(slowRuntime.runtime.staticFallback).toEqual(after.runtime.staticFallback)
      expect(slowRuntime.runtime.source).not.toBe(after.runtime.source)
      await sampleRuntimeMotion(run!, slowRuntime, 'T06-runtime')
      const afterTiming = await observeRuntimeTiming(run!, slowRuntime, 'T06-after')
      const timingComparison = assertObservedRuntimeSlower(beforeTiming, afterTiming)
      writeFileSync(join(runRoot, 'T06-speed-comparison.json'), JSON.stringify(timingComparison, null, 2))
      const t06Record = await selectedRecord(run!)
      assertResumedIdentity(t06Record, workspace, record.id)
      const t06CommitCount = committed(t06Record).length
      expect(t06CommitCount).toBeGreaterThan(0)
      for (let index = 0; index < t06CommitCount; index++) await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
      const t06Undone = await saveStage(run!, 'T06-undone')
      expect(runtimeItem(t06Undone.project)).toEqual(after)
      for (let index = 0; index < t06CommitCount; index++) await run!.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
      const t06Redone = await saveStage(run!, 'T06-redone')
      expect(runtimeItem(t06Redone.project)).toEqual(slowRuntime)

      await selectLayer(run!.page, FIXTURE_IDS.title)
      const beforeTitle = titleItem(t06Redone.project)
      await sendNatural(run!, 'T04', NATIVE_PROMPTS.T04, turnTimeoutMs)
      const t04 = await saveStage(run!, 'T04')
      const title = titleItem(t04.project)
      expect(title.content.data.text).toBe('简谐运动')
      const effectiveSizes = Array.from({ length: title.content.data.text.length }, (_, index) =>
        title.content.data.runs.filter(item => item.start <= index && item.end > index).at(-1)?.style.fontSize ?? title.content.data.style.fontSize,
      )
      expect(Math.min(...effectiveSizes)).toBeGreaterThan(beforeTitle.content.data.style.fontSize)
      expect(title.content.data.style.align).toBe('center')
      expect(Math.abs(title.frame.x + title.frame.width / 2 - 640)).toBeLessThan(4)
      expect(runtimeItem(t04.project)).toEqual(slowRuntime)
      const t04Record = await selectedRecord(run!)
      assertResumedIdentity(t04Record, workspace, t06Record.id)
      const t04CommitCount = committed(t04Record).length
      expect(t04CommitCount).toBeGreaterThan(0)
      for (let index = 0; index < t04CommitCount; index++) await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
      const t04Undone = await saveStage(run!, 'T04-undone')
      expect(titleItem(t04Undone.project)).toEqual(beforeTitle)
      expect(runtimeItem(t04Undone.project)).toEqual(slowRuntime)
      for (let index = 0; index < t04CommitCount; index++) await run!.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
      const t04Redone = await saveStage(run!, 'T04-redone')
      expect(titleItem(t04Redone.project)).toEqual(title)
      expect(runtimeItem(t04Redone.project)).toEqual(slowRuntime)

      await selectLayer(run!.page, FIXTURE_IDS.title)
      const priorIds = new Set(nativeRecords(run!).map(item => item.id))
      const t07Deadline = Date.now() + turnTimeoutMs
      let manualRevision = -1
      let interruptedId = ''
      writeFileSync(join(runRoot, 'T07-start.input.json'), JSON.stringify({
        prompt: NATIVE_PROMPTS.T07Start,
        startedAt: new Date().toISOString(),
        deadline: t07Deadline,
        cli: await chat.getByLabel('CLI', { exact: true }).inputValue(),
        model: await chat.getByLabel('模型', { exact: true }).inputValue(),
        effort: await chat.getByLabel('强度', { exact: true }).inputValue(),
        selectedSession: await chat.getByLabel('会话', { exact: true }).inputValue(),
        reference: await chat.getByLabel('本轮引用摘要').innerText(),
      }, null, 2))
      await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07Start)
      await chat.getByRole('button', { name: '发送', exact: true }).click()
      await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeEnabled()
      // A successful real first text/tool previously arrived after 70.4 seconds.
      // The intervention must use the same fixed 20-minute task deadline as the
      // terminal wait, while still rejecting any commit or terminal turn first.
      let inFlight: LocalAgentRecordV2 | undefined
      while (Date.now() < t07Deadline) {
        inFlight = nativeRecords(run!).find(item => !priorIds.has(item.id))
        if (inFlight) {
          if (committed(inFlight).length) throw new Error('T07 committed before teacher intervention; this is not valid race evidence')
          if (inFlight.tasks.at(-1)?.status !== 'running') throw new Error('T07 ended before teacher intervention: ' + inFlight.tasks.at(-1)?.status)
          if (inFlight.events.some(event => event.kind === 'text' || event.kind === 'tool')) break
        }
        await run!.page.waitForTimeout(300)
      }
      if (!inFlight || !inFlight.events.some(event => event.kind === 'text' || event.kind === 'tool')) {
        throw new Error('T07 exhausted its original 20 minute task budget before first text/tool')
      }
      interruptedId = inFlight.id
      {
        expect(committed(inFlight), 'T07 must be manually interrupted before any live commit').toHaveLength(0)
        await selectLayer(run!.page, FIXTURE_IDS.title)
        const editor = run!.page.getByRole('textbox', { name: '文字内容', exact: true })
        await editor.fill(MANUAL_TITLE)
        await editor.press('Tab')
        const manual = await saveStage(run!, 'T07-manual')
        manualRevision = manual.project.revision
        expect(titleItem(manual.project).content.data.text).toBe(MANUAL_TITLE)
        expect(runtimeItem(manual.project)).toEqual(slowRuntime)
        writeFileSync(join(run!.runRoot, 'T07.input.json'), JSON.stringify({
          prompt: NATIVE_PROMPTS.T07,
          sentAfterManualRevision: manualRevision,
          time: new Date().toISOString(),
        }, null, 2))
        const use = chat.getByLabel('输入用途', { exact: true })
        if (await use.count()) await use.selectOption('correct')
        await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07)
        await chat.getByRole('button', { name: /^(发送输入|发送)$/ }).click()
        await expect.poll(async () => {
          const id = await chat.getByLabel('会话', { exact: true }).inputValue()
          const fresh = nativeRecords(run!).find(item => item.id === id)
          return fresh && id !== interruptedId && fresh.observations.some(observation => observation.documentRevision >= manualRevision)
        }, { timeout: Math.min(60_000, Math.max(1, t07Deadline - Date.now())) }).toBe(true)
        const cancelled = nativeRecords(run!).find(item => item.id === interruptedId)
        expect(cancelled?.tasks.at(-1)?.status).toBe('cancelled')
        expect(cancelled && committed(cancelled)).toHaveLength(0)
        await recordEvidence(run!, 'T07-refreshed')
      }
      await waitNativeTurn(run!, 'T07', Math.max(1, t07Deadline - Date.now()))
      const t07 = await saveStage(run!, 'T07')
      expect(titleItem(t07.project).content.data.text).toBe(MANUAL_TITLE)
      expect(runtimeItem(t07.project)).toEqual(slowRuntime)
      const t07Record = await selectedRecord(run!)
      assertResumedIdentity(t07Record, workspace, interruptedId)
      expect(t07Record.observations.some(observation => observation.documentRevision >= manualRevision)).toBe(true)
      expect(committed(t07Record), 'The correction must actually finish the requested title-size change').not.toHaveLength(0)
      expect(titleItem(t07.project).content.data.style.fontSize).toBeGreaterThan(title.content.data.style.fontSize)
      for (const receipt of committed(t07Record)) expect(receipt.beforeRevision).toBeGreaterThanOrEqual(manualRevision)

      const final = readSaved(projectPath)
      await chat.getByRole('button', { name: '关闭', exact: true }).click()
      await run!.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
      await selectLayer(run!.page, FIXTURE_IDS.title)
      await expect(run!.page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(MANUAL_TITLE)
      const reopened = await saveStage(run!, 'final-reopened')
      expect(reopened.project).toEqual(final.project)
      expect(reopened.assetFiles).toEqual(final.assetFiles)
      expect(reopened.componentFiles).toEqual(final.componentFiles)
      expect(runtimeItem(reopened.project)).toEqual(slowRuntime)
      await sampleRuntimeMotion(run!, runtimeItem(reopened.project), 'reopened-runtime')
      await recordEvidence(run!, 'final')
      expect(run!.pageErrors).toEqual([])
      manifest.status = 'automated-checks-passed-awaiting-visual-review'
    })
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
      await closeNativeEditor(run)
    }
    const sourceOriginalRecordsUnchanged = originalRecordFiles.every(file => readFileSync(file.path).equals(file.bytes))
    const sourceCancelledRecordUnchanged = cancelledRecordFiles.every(file => readFileSync(file.path).equals(file.bytes))
    const copiedOriginalRecordsUnchanged = originalRecordFiles.every(file => {
      const copied = join(executionProfile, relative(cancelledRepairProfile, file.path))
      return existsSync(copied) && readFileSync(copied).equals(file.bytes)
    })
    const copiedCancelledRecordUnchanged = cancelledRecordFiles.every(file => {
      const copied = join(executionProfile, relative(cancelledRepairProfile, file.path))
      return existsSync(copied) && readFileSync(copied).equals(file.bytes)
    })
    manifest.sourceOriginalRecordBytesUnchanged = sourceOriginalRecordsUnchanged
    manifest.sourceCancelledRecordBytesUnchanged = sourceCancelledRecordUnchanged
    manifest.copiedOriginalRecordBytesUnchanged = copiedOriginalRecordsUnchanged
    manifest.copiedCancelledRecordBytesUnchanged = copiedCancelledRecordUnchanged
    persist()
    expect(sourceOriginalRecordsUnchanged).toBe(true)
    expect(sourceCancelledRecordUnchanged).toBe(true)
    expect(copiedOriginalRecordsUnchanged).toBe(true)
    expect(copiedCancelledRecordUnchanged).toBe(true)
    await testInfo.attach('same-native-repair-manifest', { path: join(runRoot, 'run.json'), contentType: 'application/json' })
  }
})

// This tail starts after the real SVG fallback commit. It never sends the repair
// request again, and its short user-data profile is only an Electron/Chromium
// execution container: the workspace identity remains the original lesson path.
test('R18 OpenCode3 continues T06/T04/T07 from the real rev3 ddbe native partial without replaying the repair', async ({}, testInfo) => {
  test.skip(process.env.COURSEWARE_R18_OPENCODE3_SAME_NATIVE_TAIL !== 'opencode-3-tail', 'Explicit rev3 same-native OpenCode tail gate is closed')
  expect(testInfo.retry).toBe(0)
  test.setTimeout(6 * turnTimeoutMs + 12 * 60_000)
  testInfo.annotations.push({ type: 'native-evidence', description: 'One real OpenCode tail from the committed rev3 Runtime. It is engineering evidence, not Owner acceptance.' })

  const checkpoint = loadSameNativeRev3TailCheckpoint()
  const { current, records: sourceRecords, workspace, recordFiles } = checkpoint
  const baselineRuntime = runtimeItem(current.project)
  const baselineFallback = baselineRuntime.runtime.staticFallback
  if (!baselineFallback) throw new Error('Committed rev3 Runtime has no static fallback')
  const baselineFallbackBytes = current.assetFiles[baselineFallback.assetId]
  if (!baselineFallbackBytes) throw new Error('Committed rev3 fallback has no archived bytes')
  await assertBlueFallback(baselineFallbackBytes)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runRoot = join(sourceRoot, 'attempts', 'same-native-opencode3-rev3-tail-' + stamp)
  // Chromium cannot reliably make a profile at the long evidence path. This
  // profile is short, isolated, and copied from ddbe; it does not alter the
  // workspace identity, project path, source records, or model history.
  const executionProfile = join(productRoot, 'output', 'r18-op3-profile-tail-' + stamp.replace(/-/g, '').slice(-14))
  mkdirSync(runRoot, { recursive: true })
  if (existsSync(executionProfile)) throw new Error('The short rev3 execution profile must be new')
  copyTree(committedRepairProfile, executionProfile)
  const manifest: Record<string, unknown> = {
    sourceRoot,
    committedRepairRoot,
    committedRepairCurrentPath,
    committedRepairProfile,
    projectPath,
    executionProfile,
    selected: { adapter, model, effort, resumeSessionId: committedRepairRecordId, externalSessionId: oldExternalSessionId },
    sourceRevision: current.project.revision,
    sourceProjectId: current.project.id,
    sourceRecordIds: expectedRev3RecordIds,
    noRepairReplay: true,
    noHistoricalCandidateReplay: true,
    noT01T02T05Replay: true,
    noAutomaticRetries: true,
    ownerAcceptance: false,
    status: 'prepared-no-provider-turn',
  }
  const persist = () => writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2))
  persist()

  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(productRoot, runRoot, projectPath, {
      sourceRoot,
      projectPath,
      profilePath: committedRepairProfile,
      executionProfilePath: executionProfile,
    })
    expect(samePath(run.userData, executionProfile), 'Main must use the exact short isolated profile').toBe(true)
    await expect(run.page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })).toHaveCount(0)
    expect(readSaved(projectPath)).toEqual(current)
    expect(nativeRecords(run)).toEqual(sourceRecords)

    const chat = await configureOpenCode(run)
    const session = chat.getByLabel('会话', { exact: true })
    await expect(session.locator('option[value="' + committedRepairRecordId + '"]')).toHaveCount(1)
    await session.selectOption(committedRepairRecordId)
    await expect.poll(async () => (await selectedRecord(run!)).id).toBe(committedRepairRecordId)
    expect((await selectedRecord(run)).tasks.at(-1)?.status).toBe('partial')
    const stagingRoot = resumedStagingRoot(run, workspace, oldWorkingDirectoryId)
    const capabilityRoot = join(stagingRoot, 'capabilities', runtimeFallbackCapabilitySemanticVersion)
    if (!existsSync(capabilityRoot)) throw new Error('The exact immutable Runtime capability snapshot is unavailable')
    run.nativePermissionPolicy = {
      stagingRoot,
      capabilityRoot,
      outputRoot: join(productRoot, 'output'),
      workspace,
      workingDirectoryId: oldWorkingDirectoryId,
      model,
      effort,
    }
    manifest.nativePermissionPolicy = {
      owner: { userData: run.userData, workspaceKey: workspaceIdentityKey(workspace), workingDirectoryId: oldWorkingDirectoryId },
      candidate: 'current-task-observation-request-only',
      capability: runtimeFallbackCapabilitySemanticVersion,
      output: 'read-search-glob-only',
      choice: 'visible-allow-once-only',
      ambiguity: 'leave-pending',
    }
    await selectLayer(run.page, baselineRuntime.layerItemId)
    expect(existsSync(join(runRoot, 'repair-static-fallback.input.json'))).toBe(false)
    manifest.status = 'rev3-ddbe-selected-awaiting-T06'
    persist()

    await test.step('T06 slows the repaired Runtime without replacing its identity or SVG fallback', async () => {
      const beforeTiming = await observeRuntimeTiming(run!, baselineRuntime, 'T06-before')
      await sendNatural(run!, 'T06', NATIVE_PROMPTS.T06, turnTimeoutMs)
      const slowed = await saveStage(run!, 'T06')
      const slowRuntime = runtimeItem(slowed.project)
      expect(slowRuntime.layerItemId).toBe(baselineRuntime.layerItemId)
      expect(slowRuntime.frame).toEqual(baselineRuntime.frame)
      expect(slowRuntime.runtime.staticFallback).toEqual(baselineRuntime.runtime.staticFallback)
      expect(slowRuntime.runtime.content).toEqual(baselineRuntime.runtime.content)
      expect(slowRuntime.runtime.assets).toEqual(baselineRuntime.runtime.assets)
      expect(slowRuntime.runtime.source).not.toBe(baselineRuntime.runtime.source)
      await sampleRuntimeMotion(run!, slowRuntime, 'T06-runtime')
      const afterTiming = await observeRuntimeTiming(run!, slowRuntime, 'T06-after')
      const timingComparison = assertObservedRuntimeSlower(beforeTiming, afterTiming)
      writeFileSync(join(runRoot, 'T06-speed-comparison.json'), JSON.stringify(timingComparison, null, 2))
      const t06Record = await selectedRecord(run!)
      assertResumedIdentity(t06Record, workspace, committedRepairRecordId)
      const t06CommitCount = committed(t06Record).length
      expect(t06CommitCount).toBeGreaterThan(0)
      for (let index = 0; index < t06CommitCount; index++) await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
      const t06Undone = await saveStage(run!, 'T06-undone')
      expect(runtimeItem(t06Undone.project)).toEqual(baselineRuntime)
      for (let index = 0; index < t06CommitCount; index++) await run!.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
      const t06Redone = await saveStage(run!, 'T06-redone')
      expect(runtimeItem(t06Redone.project)).toEqual(slowRuntime)

      await test.step('T04 changes only the title and supports Undo/Redo', async () => {
        await selectLayer(run!.page, FIXTURE_IDS.title)
        const beforeTitle = titleItem(t06Redone.project)
        await sendNatural(run!, 'T04', NATIVE_PROMPTS.T04, turnTimeoutMs)
        const t04 = await saveStage(run!, 'T04')
        const title = titleItem(t04.project)
        expect(title.content.data.text).toBe('简谐运动')
        const effectiveSizes = Array.from({ length: title.content.data.text.length }, (_, index) =>
          title.content.data.runs.filter(item => item.start <= index && item.end > index).at(-1)?.style.fontSize ?? title.content.data.style.fontSize,
        )
        expect(Math.min(...effectiveSizes)).toBeGreaterThan(beforeTitle.content.data.style.fontSize)
        expect(title.content.data.style.align).toBe('center')
        expect(Math.abs(title.frame.x + title.frame.width / 2 - 640)).toBeLessThan(4)
        expect(runtimeItem(t04.project)).toEqual(slowRuntime)
        const t04Record = await selectedRecord(run!)
        assertResumedIdentity(t04Record, workspace, t06Record.id)
        const t04CommitCount = committed(t04Record).length
        expect(t04CommitCount).toBeGreaterThan(0)
        for (let index = 0; index < t04CommitCount; index++) await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
        const t04Undone = await saveStage(run!, 'T04-undone')
        expect(titleItem(t04Undone.project)).toEqual(beforeTitle)
        expect(runtimeItem(t04Undone.project)).toEqual(slowRuntime)
        for (let index = 0; index < t04CommitCount; index++) await run!.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
        const t04Redone = await saveStage(run!, 'T04-redone')
        expect(titleItem(t04Redone.project)).toEqual(title)
        expect(runtimeItem(t04Redone.project)).toEqual(slowRuntime)

        await test.step('T07 cancels the stale turn, accepts the manual title, and continues from a fresh observation', async () => {
          await selectLayer(run!.page, FIXTURE_IDS.title)
          const priorIds = new Set(nativeRecords(run!).map(item => item.id))
          const t07Deadline = Date.now() + turnTimeoutMs
          writeFileSync(join(runRoot, 'T07-start.input.json'), JSON.stringify({
            prompt: NATIVE_PROMPTS.T07Start,
            startedAt: new Date().toISOString(),
            deadline: t07Deadline,
            cli: await chat.getByLabel('CLI', { exact: true }).inputValue(),
            model: await chat.getByLabel('模型', { exact: true }).inputValue(),
            effort: await chat.getByLabel('强度', { exact: true }).inputValue(),
            selectedSession: await chat.getByLabel('会话', { exact: true }).inputValue(),
            reference: await chat.getByLabel('本轮引用摘要').innerText(),
          }, null, 2))
          await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07Start)
          await chat.getByRole('button', { name: '发送', exact: true }).click()
          await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeEnabled()
          let inFlight: LocalAgentRecordV2 | undefined
          while (Date.now() < t07Deadline) {
            inFlight = nativeRecords(run!).find(item => !priorIds.has(item.id))
            if (inFlight) {
              if (committed(inFlight).length) throw new Error('T07 committed before teacher intervention; this is not valid race evidence')
              if (inFlight.tasks.at(-1)?.status !== 'running') throw new Error('T07 ended before teacher intervention: ' + inFlight.tasks.at(-1)?.status)
              if (inFlight.events.some(event => event.kind === 'text' || event.kind === 'tool')) break
            }
            await run!.page.waitForTimeout(300)
          }
          if (!inFlight || !inFlight.events.some(event => event.kind === 'text' || event.kind === 'tool')) {
            throw new Error('T07 exhausted its original 20 minute task budget before first text/tool')
          }
          const interruptedId = inFlight.id
          expect(committed(inFlight), 'T07 must be manually interrupted before any live commit').toHaveLength(0)
          await selectLayer(run!.page, FIXTURE_IDS.title)
          const editor = run!.page.getByRole('textbox', { name: '文字内容', exact: true })
          await editor.fill(MANUAL_TITLE)
          await editor.press('Tab')
          const manual = await saveStage(run!, 'T07-manual')
          const manualRevision = manual.project.revision
          expect(titleItem(manual.project).content.data.text).toBe(MANUAL_TITLE)
          expect(runtimeItem(manual.project)).toEqual(slowRuntime)
          writeFileSync(join(runRoot, 'T07.input.json'), JSON.stringify({ prompt: NATIVE_PROMPTS.T07, sentAfterManualRevision: manualRevision, time: new Date().toISOString() }, null, 2))
          const use = chat.getByLabel('输入用途', { exact: true })
          if (await use.count()) await use.selectOption('correct')
          await chat.getByLabel('发送给创作助手', { exact: true }).fill(NATIVE_PROMPTS.T07)
          await chat.getByRole('button', { name: /^(发送输入|发送)$/ }).click()
          await expect.poll(async () => {
            const id = await chat.getByLabel('会话', { exact: true }).inputValue()
            const fresh = nativeRecords(run!).find(item => item.id === id)
            return fresh && id !== interruptedId && fresh.observations.some(observation => observation.documentRevision >= manualRevision)
          }, { timeout: Math.min(60_000, Math.max(1, t07Deadline - Date.now())) }).toBe(true)
          const cancelled = nativeRecords(run!).find(item => item.id === interruptedId)
          expect(cancelled?.tasks.at(-1)?.status).toBe('cancelled')
          expect(cancelled && committed(cancelled)).toHaveLength(0)
          await waitNativeTurn(run!, 'T07', Math.max(1, t07Deadline - Date.now()))
          const t07 = await saveStage(run!, 'T07')
          expect(titleItem(t07.project).content.data.text).toBe(MANUAL_TITLE)
          expect(runtimeItem(t07.project)).toEqual(slowRuntime)
          const t07Record = await selectedRecord(run!)
          assertResumedIdentity(t07Record, workspace, interruptedId)
          expect(t07Record.observations.some(observation => observation.documentRevision >= manualRevision)).toBe(true)
          expect(committed(t07Record), 'The correction must actually finish the requested title-size change').not.toHaveLength(0)
          expect(titleItem(t07.project).content.data.style.fontSize).toBeGreaterThan(title.content.data.style.fontSize)
          for (const receipt of committed(t07Record)) expect(receipt.beforeRevision).toBeGreaterThanOrEqual(manualRevision)

          const final = readSaved(projectPath)
          await chat.getByRole('button', { name: '关闭', exact: true }).click()
          await run!.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
          await selectLayer(run!.page, FIXTURE_IDS.title)
          await expect(run!.page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(MANUAL_TITLE)
          const reopened = await saveStage(run!, 'final-reopened')
          expect(reopened.project).toEqual(final.project)
          expect(reopened.assetFiles).toEqual(final.assetFiles)
          expect(reopened.componentFiles).toEqual(final.componentFiles)
          expect(runtimeItem(reopened.project)).toEqual(slowRuntime)
          await sampleRuntimeMotion(run!, runtimeItem(reopened.project), 'final-reopened-runtime')
          await recordEvidence(run!, 'final')
          expect(run!.pageErrors).toEqual([])
          manifest.status = 'automated-tail-checks-passed-awaiting-visual-review'
        })
      })
    })
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
      await closeNativeEditor(run)
    }
    const sourceRecordsUnchanged = recordFiles.every(file => readFileSync(file.path).equals(file.bytes))
    const copiedRecordsUnchanged = recordFiles.every(file => {
      const copied = join(executionProfile, relative(committedRepairProfile, file.path))
      return existsSync(copied) && readFileSync(copied).equals(file.bytes)
    })
    manifest.sourceRecordBytesUnchanged = sourceRecordsUnchanged
    manifest.copiedOriginalRecordBytesUnchanged = copiedRecordsUnchanged
    persist()
    expect(sourceRecordsUnchanged).toBe(true)
    expect(copiedRecordsUnchanged).toBe(true)
    await testInfo.attach('same-native-rev3-tail-manifest', { path: join(runRoot, 'run.json'), contentType: 'application/json' })
  }
})

test('R18 OpenCode3 repairs observed cube corner clipping after the completed native tail', async ({}, testInfo) => {
  test.skip(process.env.COURSEWARE_R18_OPENCODE3_VISUAL_REPAIR !== 'opencode-3-visual', 'Explicit bounded visual repair gate is closed')
  expect(testInfo.retry).toBe(0)
  test.setTimeout(turnTimeoutMs + 8 * 60_000)
  const tailRoot = resolve(process.env.COURSEWARE_R18_OPENCODE3_TAIL_CHECKPOINT ?? '')
  expect(relative(join(sourceRoot, 'attempts'), tailRoot).startsWith('..')).toBe(false)
  const tail = JSON.parse(readFileSync(join(tailRoot, 'run.json'), 'utf8'))
  const screenshotOnlyFailure = tail.status === 'failed' && /Clipped area is either empty or outside/.test(tail.failure ?? '')
    && existsSync(join(tailRoot, 'final-reopened.h5lesson'))
  const formatTimeoutContinuation = process.env.COURSEWARE_R18_OPENCODE3_FORMAT_CONTINUATION === 'missing-carrier-reason'
    && tail.status === 'failed' && /visual-repair: native turn exceeded/.test(tail.failure ?? '') && tail.failureSavedRevision === 8
  const replayOutputContinuation = process.env.COURSEWARE_R18_OPENCODE3_FORMAT_CONTINUATION === 'native-replay-output-budget'
    && tail.status === 'failed' && /visual-repair: output-limit/.test(tail.failure ?? '') && tail.failureSavedRevision === 8
  const failedCandidateContinuation = formatTimeoutContinuation || replayOutputContinuation
  expect(tail.status === 'automated-tail-checks-passed-awaiting-visual-review' || screenshotOnlyFailure || failedCandidateContinuation).toBe(true)
  expect(tail.projectPath).toBe(projectPath)
  const before = readSaved(projectPath)
  expect(before).toEqual(readSaved(join(tailRoot, failedCandidateContinuation ? 'failure-current.h5lesson' : 'final-reopened.h5lesson')))
  const baseline = runtimeItem(before.project)
  expect(titleItem(before.project).content.data.text).toBe(MANUAL_TITLE)
  const originalRecords = nativeRecords({ userData: tail.executionProfile } as NativeRun)
  const previous = [...originalRecords].sort((a, b) => (b.events.at(-1)?.time ?? 0) - (a.events.at(-1)?.time ?? 0))[0]!
  if (failedCandidateContinuation) {
    expect(previous.tasks.at(-1)?.status).toBe(replayOutputContinuation ? 'failed' : 'cancelled')
    expect(previous.tasks.at(-1)?.committedResultIds).toEqual([])
    if (replayOutputContinuation) expect(previous.events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'failed', failure: { category: 'limit', message: 'output-limit' } })
    else expect(previous.tasks.at(-1)?.execution?.lastDiagnostic).toContain('lowerCarrierReason')
  } else expect(previous.tasks.at(-1)?.status).toBe('completed')
  expect(previous.externalSessionId).toBe(oldExternalSessionId)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runRoot = join(sourceRoot, 'attempts', `same-native-opencode3-visual-${stamp}`)
  const profile = join(productRoot, 'output', `r18-op3-visual-${Date.now()}`)
  mkdirSync(runRoot, { recursive: true })
  copyTree(tail.executionProfile, profile)
  const manifest: Record<string, unknown> = { sourceRoot, tailRoot, projectPath, executionProfile: profile,
    selected: { adapter, model, effort, resumeSessionId: previous.id, externalSessionId: oldExternalSessionId },
    sourceRevision: before.project.revision, priorScreenshotOnlyFailure: screenshotOnlyFailure, formatTimeoutContinuation, replayOutputContinuation,
    continuationBasis: replayOutputContinuation ? 'New native replay/turn output accounting build; same native candidate after premature 8MiB history charge, zero prior commits'
      : formatTimeoutContinuation ? 'New question-persistence build; same native failed candidate and exact missing lowerCarrierReason feedback, zero prior commits' : null,
    noT01T02T05T06T04T07Replay: true, ownerAcceptance: false,
    status: 'prepared-no-provider-turn' }
  const persist = () => writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2))
  persist()
  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(productRoot, runRoot, projectPath, { sourceRoot, projectPath, profilePath: tail.executionProfile, executionProfilePath: profile })
    const chat = await configureOpenCode(run)
    await chat.getByLabel('会话', { exact: true }).selectOption(previous.id)
    const stagingRoot = resumedStagingRoot(run, previous.workspace, oldWorkingDirectoryId)
    run.nativePermissionPolicy = { stagingRoot, capabilityRoot: join(stagingRoot, 'capabilities', runtimeFallbackCapabilitySemanticVersion),
      outputRoot: join(productRoot, 'output'), workspace: previous.workspace, workingDirectoryId: oldWorkingDirectoryId, model, effort }
    manifest.nativePermissionPolicy = { owner: { userData: profile, workspaceKey: workspaceIdentityKey(previous.workspace), workingDirectoryId: oldWorkingDirectoryId },
      candidate: 'current-task-observation-request-only', capability: runtimeFallbackCapabilitySemanticVersion, output: 'read-search-glob-only', choice: 'visible-allow-once-only' }
    persist()
    const clipping = await observeCubeContainment(run, 'before')
    expect(clipping.maximumOverflowCssPx, 'New provider work requires confirmed visible geometry failure').toBeGreaterThan(1)
    await selectLayer(run.page, baseline.layerItemId)
    const prompt = replayOutputContinuation
      ? '继续上次被会话输出限制中断的立方体边角裁切修复。沿用你已经补齐载体理由并检查的修复，按本轮当前目标交付，不重新做前面已完成的任务。让完整立方体在整个转动周期中清楚可见，保留外层位置、尺寸、当前转速、静态后备和现在的标题；正式提交成功后确认完成并结束。'
      : formatTimeoutContinuation
      ? '继续上次因缺少载体理由而未提交的立方体边角裁切修复。沿用你已生成并检查的修复，只补齐宿主反馈指出的缺项，按本轮当前目标交付。让完整立方体在整个转动周期中清楚可见，保留外层位置、尺寸、当前转速、静态后备和现在的标题；正式提交成功后确认完成并结束。'
      : '立方体转动时有些边角被框裁掉了。请让完整立方体在整个转动周期中都清楚可见，保留外层的位置和尺寸、当前转动速度、静态后备以及现在的标题，只修好这个显示问题。'
    await sendNatural(run, 'visual-repair', prompt, turnTimeoutMs)
    const after = await saveStage(run, 'visual-repaired')
    const updated = runtimeItem(after.project)
    expect({ ...updated, runtime: { ...updated.runtime, source: baseline.runtime.source } }).toEqual(baseline)
    expect(updated.runtime.source).not.toBe(baseline.runtime.source)
    expect(titleItem(after.project)).toEqual(titleItem(before.project))
    expect(after.assetFiles).toEqual(before.assetFiles)
    expect(after.componentFiles).toEqual(before.componentFiles)
    const record = await selectedRecord(run)
    assertResumedIdentity(record, previous.workspace, previous.id)
    expect(committed(record)).toHaveLength(1)
    const contained = await observeCubeContainment(run, 'after')
    expect(contained.maximumOverflowCssPx).toBeLessThanOrEqual(1)
    const timing = await observeRuntimeTiming(run, updated, 'visual-repaired-speed')
    if (timing.source !== 'actual-preview-web-animations') throw new Error('The existing CSS animation mechanism must remain')
    expect(timing.effectivePeriodMs).toBe(8400)
    await run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect(runtimeItem((await saveStage(run, 'visual-undone')).project)).toEqual(baseline)
    await run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect(runtimeItem((await saveStage(run, 'visual-redone')).project)).toEqual(updated)
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    await run.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const reopened = await saveStage(run, 'final-reopened')
    expect(reopened).toEqual(after)
    await sampleRuntimeMotion(run, updated, 'final-reopened-runtime')
    await recordEvidence(run, 'final')
    expect(run.pageErrors).toEqual([])
    manifest.clipping = { before: clipping.maximumOverflowCssPx, after: contained.maximumOverflowCssPx }
    manifest.status = 'automated-tail-checks-passed-awaiting-visual-review'
  } catch (error) {
    manifest.status = 'failed'
    manifest.failure = error instanceof Error ? error.stack : String(error)
    if (run) {
      await recordEvidence(run, 'failure').catch(() => {})
      manifest.failureSavedRevision = await preserveNativeFailure(run).catch(() => null)
    }
    throw error
  } finally {
    if (run) { await closeNativeEditor(run); manifest.pageErrors = run.pageErrors }
    manifest.finishedAt = new Date().toISOString()
    persist()
  }
})

test.describe.configure({ mode: 'serial', retries: 0 })
