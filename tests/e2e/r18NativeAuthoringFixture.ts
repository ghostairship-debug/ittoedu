import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createImageNode, createShapeNode, createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { createCourseProjectArchive, openCourseProjectArchive, type CourseProjectArchiveData } from '../../src/renderer/project/courseProjectArchive'
import type { CourseProjectDocument, LayerItem, NativeLayerItem, RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import { localAgentRecordV2Schema, type LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import { generationRequestSchema } from '../../src/shared/generationContract'
import { workspaceIdentityKey } from '../../src/shared/workspaceIdentity'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { compareCanvasMotion, startCanvasPoseObservation, validateCanvasPoses, type CanvasMotion } from './runtimeCanvasMotionObservation'

export const NATIVE_PROMPTS = Object.freeze({
  T01: '这是什么颜色？先别修改。',
  T02: '帮我把颜色改为绿色。',
  T04: '把这个标题改成‘简谐运动’，放大一点并居中。',
  T05: '把这个正方形改成 runtime 形式的翻滚立方体。',
  T06: '再慢一点，保持原来的位置。',
  T07Start: '把这个标题再放大一点。',
  T07: '以现在的内容为准',
})
export const FIXTURE_IDS = Object.freeze({ image: 'native-red-image', title: 'native-title', square: 'native-square', asset: 'native-red-artwork' })
export const MANUAL_TITLE = '教师手工保留：现在的标题'
export type NativeCli = 'codex' | 'claude' | 'opencode'
export type NativeImageItem = NativeLayerItem & { content: Extract<NativeLayerItem['content'], { nativeType: 'image' }> }
export type NativeTextItem = NativeLayerItem & { content: Extract<NativeLayerItem['content'], { nativeType: 'text' }> }

export function slideItems(project: CourseProjectDocument): LayerItem[] {
  return [...project.globalLayerItems.map(entry => entry.item), ...project.surfaces.flatMap(surface => surface.type === 'slide'
    ? [...surface.surfaceLayerItems.map(entry => entry.item), ...surface.scenes.flatMap(scene => scene.layerItems)] : [])]
}
export function imageItem(project: CourseProjectDocument): NativeImageItem {
  const item = slideItems(project).find(value => value.layerItemId === FIXTURE_IDS.image)
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'image') throw new Error('The selected image identity was lost')
  return item as NativeImageItem
}
export function titleItem(project: CourseProjectDocument): NativeTextItem {
  const item = slideItems(project).find(value => value.layerItemId === FIXTURE_IDS.title)
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('The selected title identity was lost')
  return item as NativeTextItem
}
export function runtimeItem(project: CourseProjectDocument): RuntimeLayerItem {
  const items = slideItems(project).filter((item): item is RuntimeLayerItem => item.kind === 'runtime')
  expect(items, 'The square must become exactly one Runtime layer, without duplicate overlays').toHaveLength(1)
  return items[0]!
}
export function readSaved(projectPath: string): CourseProjectArchiveData {
  return openCourseProjectArchive(new Uint8Array(readFileSync(projectPath)))
}

export interface NativeT01Resume {
  sourceRoot: string
  projectPath: string
  profilePath: string
  executionProfilePath?: string
  original: CourseProjectArchiveData
  t01Record: LocalAgentRecordV2
  historyFiles: Array<{ path: string; bytes: Buffer }>
  afterT02?: { evidenceRoot: string; record: LocalAgentRecordV2; edited: CourseProjectArchiveData }
  recoveredT05?: {
    manifestPath: string
    originalSourceRoot: string
    previousExternalSessionId: string
    workspaceBoundary: string
  }
  afterT05?: {
    evidenceRoot: string
    record: LocalAgentRecordV2
    cube: CourseProjectArchiveData
    motion: Awaited<ReturnType<typeof sampleRuntimeMotion>>
    baselinePath: string
    currentBeforeReset: CourseProjectArchiveData
    restoreRequired: boolean
  }
  afterT06?: {
    evidenceRoot: string
    record: LocalAgentRecordV2
    slowed: CourseProjectArchiveData
    timingEvidencePath: string
  }
  afterFailedT04?: { evidenceRoot: string; record: LocalAgentRecordV2; saved: CourseProjectArchiveData }
  afterT04?: {
    evidenceRoot: string
    record: LocalAgentRecordV2
    saved: CourseProjectArchiveData
    interruptionPath: string
  }
  afterT07Manual?: {
    evidenceRoot: string
    oldRecord: LocalAgentRecordV2
    record: LocalAgentRecordV2
    manual: CourseProjectArchiveData
    t04: CourseProjectArchiveData
  }
}

/** Resume only the same predeclared slot after its actual T01 evidence passed.
 * This reads artifacts and preserves every old record; it never replays a candidate. */
function readNativeT01Evidence(productRoot: string, source: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): NativeT01Resume {
  const sourceRoot = realpathSync(resolve(source))
  const evidenceRoot = realpathSync(join(productRoot, 'output', 'r18-native-authoring'))
  if (resolve(sourceRoot, '..').toLowerCase() !== evidenceRoot.toLowerCase()) throw new Error('Resume source must be one original run in this product workspace')
  const manifest = JSON.parse(readFileSync(join(sourceRoot, 'run.json'), 'utf8'))
  expect(manifest.selected, 'Resume must preserve CLI, independent slot, model and effort').toEqual(selected)
  expect(resolve(manifest.productRoot).toLowerCase()).toBe(resolve(productRoot).toLowerCase())
  expect(resolve(manifest.runRoot).toLowerCase()).toBe(sourceRoot.toLowerCase())
  expect(manifest.prompts).toEqual(NATIVE_PROMPTS)
  const projectPath = join(sourceRoot, 'lesson.h5lesson'), profilePath = join(sourceRoot, 'profile')
  expect(resolve(manifest.projectPath).toLowerCase()).toBe(projectPath.toLowerCase())
  if (!contained(sourceRoot, realpathSync(projectPath)) || !contained(sourceRoot, realpathSync(profilePath))) throw new Error('Resume fixture paths escaped their original run')
  const t01Input = JSON.parse(readFileSync(join(sourceRoot, 'T01.input.json'), 'utf8'))
  expect({ cli: t01Input.cli, model: t01Input.model, effort: t01Input.effort, prompt: t01Input.prompt }).toEqual({
    cli: selected.adapter, model: selected.model, effort: selected.effort === 'default' ? '' : selected.effort, prompt: NATIVE_PROMPTS.T01,
  })
  const original = readSaved(join(sourceRoot, '00-original.h5lesson'))
  const t01Saved = readSaved(join(sourceRoot, 'T01.h5lesson'))
  expect(t01Saved).toEqual(original)
  expect(JSON.parse(readFileSync(join(sourceRoot, 'T01.project.json'), 'utf8'))).toEqual(original.project)
  expect(existsSync(join(sourceRoot, 'T01.png'))).toBe(true)
  expect(titleItem(original.project).content.data.text).toBe('振动的世界')
  expect(imageItem(original.project).content.data.assetId).toBe(FIXTURE_IDS.asset)
  expect(slideItems(original.project).map(item => item.layerItemId).sort()).toEqual([FIXTURE_IDS.image, FIXTURE_IDS.title, FIXTURE_IDS.square].sort())
  const evidence = JSON.parse(readFileSync(join(sourceRoot, 'T01.native.json'), 'utf8'))
  const t01Records = (evidence.records as unknown[]).map(record => localAgentRecordV2Schema.parse(record))
  expect(t01Records).toHaveLength(1)
  const t01Record = t01Records[0]!
  expect(t01Record.adapter).toBe(selected.adapter)
  expect(t01Record.externalSessionId).toBeTruthy()
  expect(requireProjectWorkspace(t01Record.workspace).projectId).toBe(original.project.id)
  expect(requireProjectWorkspace(t01Record.workspace).normalizedPath).toBe(projectPath.replace(/\\/g, '/').toLowerCase())
  expect(t01Record.tasks.at(-1)?.goal).toBe(NATIVE_PROMPTS.T01)
  expect(t01Record.tasks.at(-1)?.status).toBe('completed')
  expect(t01Record.hostResults).toHaveLength(0)
  expect(t01Record.events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
  expect(t01Record.events.flatMap(event => event.kind === 'text' ? [event.text] : []).join('')).toMatch(/红色|red/i)
  const configuration = [...t01Record.events].reverse().find(event => event.kind === 'configuration')
  if (configuration?.kind !== 'configuration') throw new Error('T01 has no native configuration evidence')
  expect(configuration.capabilities.current.model).toBe(selected.model)
  if (selected.effort !== 'default') expect(configuration.capabilities.current.effort).toBe(selected.effort)
  const historyFiles: NativeT01Resume['historyFiles'] = []
  const recordsRoot = join(profilePath, 'local-agent', 'v2')
  for (const workspace of readdirSync(recordsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const directory = join(recordsRoot, workspace.name)
    for (const entry of readdirSync(directory, { withFileTypes: true }).filter(value => value.isFile() && /^[a-f0-9-]{36}(?:\.display)?\.json$/i.test(value.name))) {
      const path = join(directory, entry.name)
      historyFiles.push({ path, bytes: readFileSync(path) })
    }
  }
  const persisted = historyFiles.find(file => file.path.endsWith(`${t01Record.id}.json`))
  if (!persisted) throw new Error('T01 native history is missing from the original profile')
  expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(t01Record)
  return { sourceRoot, projectPath, profilePath, original, t01Record, historyFiles }
}

export function loadNativeT01Resume(productRoot: string, source: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): NativeT01Resume {
  const resume = readNativeT01Evidence(productRoot, source, selected)
  expect(readSaved(resume.projectPath), 'Resume may not silently reuse a changed fixture').toEqual(resume.original)
  return resume
}

/** Continue the already saved real image edit after a later generation failed.
 * The completed image task and the failed task remain in their original profile. */
export async function loadNativeT02Resume(productRoot: string, source: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): Promise<NativeT01Resume> {
  const evidenceRoot = realpathSync(resolve(source))
  const manifest = JSON.parse(readFileSync(join(evidenceRoot, 'run.json'), 'utf8'))
  expect(manifest.selected).toEqual(selected)
  expect(manifest.status).toBe('failed')
  expect(manifest.continuation?.phase).toBe('after-T01')
  expect(resolve(manifest.runRoot).toLowerCase()).toBe(evidenceRoot.toLowerCase())
  const resume = readNativeT01Evidence(productRoot, manifest.continuation.from,
    manifest.modelTransition?.previousConfiguration ?? selected)
  expect(resolve(evidenceRoot, '..').toLowerCase()).toBe(join(resume.sourceRoot, 'attempts').toLowerCase())
  expect(resolve(manifest.projectPath).toLowerCase()).toBe(resume.projectPath.toLowerCase())
  const edited = readSaved(join(evidenceRoot, 'T02.h5lesson'))
  await verifyGreenImage(resume.original, edited)
  expect(readSaved(resume.projectPath), 'The real saved image result must still be current').toEqual(edited)
  const input = JSON.parse(readFileSync(join(evidenceRoot, 'T02.input.json'), 'utf8'))
  expect(input).toMatchObject({ prompt: NATIVE_PROMPTS.T02, cli: selected.adapter, model: selected.model,
    effort: selected.effort === 'default' ? '' : selected.effort })
  const evidence = JSON.parse(readFileSync(join(evidenceRoot, 'T02.native.json'), 'utf8'))
  const record = (evidence.records as unknown[]).map(value => localAgentRecordV2Schema.parse(value))
    .find(value => value.tasks.at(-1)?.goal === NATIVE_PROMPTS.T02 && value.tasks.at(-1)?.status === 'completed')
  if (!record) throw new Error('No completed native image-edit record exists')
  expect(record.workspace).toEqual(resume.t01Record.workspace)
  expect(record.externalSessionId).toBe(resume.t01Record.externalSessionId)
  expect(record.hostResults.at(-1)).toMatchObject({ status: 'committed', afterRevision: edited.project.revision })
  const configuration = [...record.events].reverse().find(event => event.kind === 'configuration')
  if (configuration?.kind !== 'configuration') throw new Error('The image edit lacks native configuration evidence')
  expect(configuration.capabilities.current.model).toBe(selected.model)
  if (selected.effort !== 'default') expect(configuration.capabilities.current.effort).toBe(selected.effort)
  const profilePath = realpathSync(manifest.continuation.executionProfilePath ?? manifest.continuation.profilePath)
  if (!contained(resume.sourceRoot, profilePath)) throw new Error('The execution profile escaped its independent slot')
  const historyFiles = [...resume.historyFiles]
  const root = join(profilePath, 'local-agent', 'v2')
  for (const workspace of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const directory = join(root, workspace.name)
    for (const entry of readdirSync(directory, { withFileTypes: true }).filter(value => value.isFile() && /^[a-f0-9-]{36}(?:\.display)?\.json$/i.test(value.name))) {
      const path = join(directory, entry.name)
      if (!historyFiles.some(file => file.path === path)) historyFiles.push({ path, bytes: readFileSync(path) })
    }
  }
  const persisted = historyFiles.find(file => contained(profilePath, file.path) && file.path.endsWith(`${record.id}.json`))
  if (!persisted) throw new Error('The completed image-edit record is missing from its execution profile')
  expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(record)
  return { ...resume, profilePath, historyFiles, afterT02: { evidenceRoot, record, edited } }
}

/** Reuse the passed T01/T02/T05 prefix, preserving the failed T06 result and
 * every original native record. The normal run restores this known test input
 * before launch and sends the original T06 text through the existing UI session. */
async function readNativeT05Evidence(productRoot: string, source: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): Promise<NativeT01Resume> {
  const evidenceRoot = realpathSync(resolve(source))
  const manifest = JSON.parse(readFileSync(join(evidenceRoot, 'run.json'), 'utf8'))
  expect(manifest.selected).toEqual(selected)
  if (manifest.continuation) expect(manifest.continuation.phase).toBe('after-T01')
  const resume = readNativeT01Evidence(productRoot, manifest.continuation?.from ?? evidenceRoot, selected)
  if (manifest.continuation) expect(resolve(evidenceRoot, '..').toLowerCase()).toBe(join(resume.sourceRoot, 'attempts').toLowerCase())
  else expect(evidenceRoot.toLowerCase()).toBe(resume.sourceRoot.toLowerCase())
  expect(resolve(manifest.runRoot).toLowerCase()).toBe(evidenceRoot.toLowerCase())
  expect(resolve(manifest.productRoot).toLowerCase()).toBe(resolve(productRoot).toLowerCase())
  expect(resolve(manifest.projectPath).toLowerCase()).toBe(resume.projectPath.toLowerCase())
  expect(manifest.prompts).toEqual(NATIVE_PROMPTS)
  expect(manifest.status).toBe('failed')
  if (manifest.continuation) expect(manifest.existingHistoryPreserved).toBe(true)
  const t02 = readSaved(join(evidenceRoot, 'T02.h5lesson'))
  await verifyGreenImage(resume.original, t02)
  const cube = readSaved(join(evidenceRoot, 'T05.h5lesson'))
  expect(cube.project.id).toBe(resume.original.project.id)
  expect(imageItem(cube.project)).toEqual(imageItem(t02.project))
  expect(slideItems(cube.project).some(item => item.layerItemId === FIXTURE_IDS.square)).toBe(false)
  expect(runtimeItem(cube.project).runtime.enabled).toBe(true)
  expect(runtimeItem(cube.project).runtime.source.trim().length).toBeGreaterThan(0)
  const evidence = JSON.parse(readFileSync(join(evidenceRoot, 'T05.native.json'), 'utf8'))
  const records = (evidence.records as unknown[]).map(value => localAgentRecordV2Schema.parse(value))
  const record = records.find(value => value.tasks.at(-1)?.goal === NATIVE_PROMPTS.T05 && value.tasks.at(-1)?.status === 'completed')
  if (!record) throw new Error('The prefix has no completed native T05 record')
  expect(record.adapter).toBe(selected.adapter)
  expect(record.externalSessionId).toBe(resume.t01Record.externalSessionId)
  expect(record.workspace).toEqual(resume.t01Record.workspace)
  expect(record.hostResults.at(-1)).toMatchObject({ status: 'committed', afterRevision: cube.project.revision })
  const currentConfiguration = [...record.events].reverse().find(event => event.kind === 'configuration')
  if (currentConfiguration?.kind !== 'configuration') throw new Error('T05 has no native model configuration')
  expect(currentConfiguration.capabilities.current.model).toBe(selected.model)
  if (selected.effort !== 'default') expect(currentConfiguration.capabilities.current.effort).toBe(selected.effort)
  const persisted = resume.historyFiles.find(file => file.path.endsWith(`${record.id}.json`))
  if (!persisted) throw new Error('T05 native record is missing from the original profile')
  expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(record)
  const motion = JSON.parse(readFileSync(join(evidenceRoot, 'T05-runtime.motion.json'), 'utf8')) as Awaited<ReturnType<typeof sampleRuntimeMotion>>
  expect(motion.samples).toHaveLength(24)
  expect(motion.differences.filter(value => value.meanAbsoluteDelta > .3).length).toBeGreaterThan(16)
  expect(motion.deltaPerSecond).toBeGreaterThan(0)
  for (const sample of motion.samples) if (!contained(evidenceRoot, realpathSync(sample.file))) throw new Error('T05 motion evidence escaped its source attempt')
  expect(existsSync(join(evidenceRoot, 'T05-runtime.filmstrip.png'))).toBe(true)
  const currentBeforeReset = readSaved(resume.projectPath)
  expect(currentBeforeReset.project.id).toBe(cube.project.id)
  return { ...resume, afterT05: { evidenceRoot, record, cube, motion, baselinePath: join(evidenceRoot, 'T05.h5lesson'), currentBeforeReset, restoreRequired: false } }
}

export async function loadNativeT05Resume(productRoot: string, source: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): Promise<NativeT01Resume> {
  const resume = await readNativeT05Evidence(productRoot, source, selected)
  const checkpoint = resume.afterT05!, failedT06 = join(checkpoint.evidenceRoot, 'T06.h5lesson')
  if (existsSync(failedT06)) {
    expect(checkpoint.currentBeforeReset, 'Only the explicitly preserved failed T06 fixture may be reset to T05').toEqual(readSaved(failedT06))
    checkpoint.restoreRequired = true
  } else {
    const manifest = JSON.parse(readFileSync(join(checkpoint.evidenceRoot, 'run.json'), 'utf8'))
    expect(manifest.failure, 'A fresh-slot continuation is only for the retained unsupported timing observer').toMatch(/requires one observable Web Animation|Motion observer not applicable/)
    expect(existsSync(join(checkpoint.evidenceRoot, 'T06.input.json')), 'Do not repeat a paid T06 request through this entry').toBe(false)
    expect(checkpoint.currentBeforeReset, 'The successful T05 fixture must still be the current saved lesson').toEqual(checkpoint.cube)
  }
  return resume
}

async function readNativeT06Evidence(productRoot: string, source: string, timingPath: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }, budgetInterrupted = false): Promise<NativeT01Resume> {
  const evidenceRoot = realpathSync(resolve(source))
  const manifest = JSON.parse(readFileSync(join(evidenceRoot, 'run.json'), 'utf8'))
  expect(manifest.selected).toEqual(selected)
  const fresh = !manifest.continuation
  if (!fresh) expect(manifest.continuation.phase).toBe('after-T05')
  if (budgetInterrupted) {
    expect(manifest.status).toBe('running')
    expect(JSON.parse(readFileSync(join(evidenceRoot, 'interruption.json'), 'utf8'))).toMatchObject({
      status: 'interrupted-by-user-budget-instruction', lastCompletedStage: 'T04', nativeHistoryRewritten: false,
      unfinishedRecord: { committedResults: 0 },
    })
  } else if (!fresh) expect(manifest.existingHistoryPreserved).toBe(true)
  const resume = await readNativeT05Evidence(productRoot, fresh ? evidenceRoot : manifest.continuation.passedPrefixAttempt, selected)
  if (fresh) expect(evidenceRoot.toLowerCase()).toBe(resume.sourceRoot.toLowerCase())
  else expect(resolve(evidenceRoot, '..').toLowerCase()).toBe(join(resume.sourceRoot, 'attempts').toLowerCase())
  expect(resolve(manifest.runRoot).toLowerCase()).toBe(evidenceRoot.toLowerCase())
  expect(resolve(manifest.projectPath).toLowerCase()).toBe(resume.projectPath.toLowerCase())
  if (!fresh) expect(resolve(manifest.continuation.from).toLowerCase()).toBe(resume.sourceRoot.toLowerCase())
  const slowed = readSaved(join(evidenceRoot, 'T06.h5lesson')), runtime = runtimeItem(slowed.project)
  expect(runtime.layerItemId).toBe(runtimeItem(resume.afterT05!.cube.project).layerItemId)
  expect(runtime.frame).toEqual(runtimeItem(resume.afterT05!.cube.project).frame)
  const evidence = JSON.parse(readFileSync(join(evidenceRoot, 'T06.native.json'), 'utf8'))
  const records = (evidence.records as unknown[]).map(value => localAgentRecordV2Schema.parse(value))
  const record = records.find(value => value.tasks.at(-1)?.goal === NATIVE_PROMPTS.T06 && value.tasks.at(-1)?.status === 'completed'
    && value.hostResults.some(result => result.status === 'committed' && result.afterRevision === slowed.project.revision
      && result.receipts.some(receipt => receipt.affected.some(effect => effect.id === runtime.layerItemId && effect.operation === 'updated'))
      && result.receipts.every(receipt => receipt.affected.every(effect => effect.operation === 'updated'))))
  if (!record) throw new Error('T06 has no successful native commit preserving the same Runtime')
  expect(record.adapter).toBe(selected.adapter)
  expect(record.externalSessionId).toBe(resume.t01Record.externalSessionId)
  expect(record.workspace).toEqual(resume.t01Record.workspace)
  const configuration = [...record.events].reverse().find(event => event.kind === 'configuration')
  if (configuration?.kind !== 'configuration') throw new Error('T06 has no native configuration')
  expect(configuration.capabilities.current.model).toBe(selected.model)
  if (selected.effort !== 'default') expect(configuration.capabilities.current.effort).toBe(selected.effort)
  const persisted = resume.historyFiles.find(file => file.path.endsWith(`${record.id}.json`))
  if (!persisted) throw new Error('T06 original native record is missing')
  expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(record)
  const timingEvidencePath = realpathSync(resolve(timingPath))
  const timing = JSON.parse(readFileSync(timingEvidencePath, 'utf8'))
  if (timingEvidencePath.toLowerCase() === join(evidenceRoot, 'T06-speed-comparison.json').toLowerCase()) {
    const beforeTiming = JSON.parse(readFileSync(join(evidenceRoot, 'T06-before.timing.json'), 'utf8'))
    const afterTiming = JSON.parse(readFileSync(join(evidenceRoot, 'T06-after.timing.json'), 'utf8'))
    expect(timing).toEqual(assertObservedRuntimeSlower(beforeTiming, afterTiming))
  } else {
  if (!contained(join(resume.sourceRoot, 'observations'), timingEvidencePath)) throw new Error('Paired timing evidence must belong to this original slot')
  expect(timing).toMatchObject({ status: 'passed', nativeTurnsStarted: 0, before: { effectivePeriodMs: 8000 }, after: { effectivePeriodMs: 12000 } })
  expect(resolve(timing.source).toLowerCase()).toBe(evidenceRoot.toLowerCase())
  expect(resolve(timing.beforePath).toLowerCase()).toBe(resume.afterT05!.baselinePath.toLowerCase())
  expect(resolve(timing.afterPath).toLowerCase()).toBe(join(evidenceRoot, 'T06.h5lesson').toLowerCase())
  expect(timing.before.observedClockRate).toBeGreaterThan(.8)
  expect(timing.after.observedClockRate).toBeGreaterThan(.8)
  }
  const motion = JSON.parse(readFileSync(join(evidenceRoot, 'T06-runtime.motion.json'), 'utf8'))
  expect(motion.samples).toHaveLength(24)
  expect(motion.differences.filter((value: { meanAbsoluteDelta: number }) => value.meanAbsoluteDelta > .3).length).toBeGreaterThan(16)
  return { ...resume, afterT06: { evidenceRoot, record, slowed, timingEvidencePath } }
}

/** Continue the user-interrupted second slot after actual T04; the old model's
 * saved evidence remains attributed to that model. No old candidate is replayed. */
export async function loadNativeT04Resume(productRoot: string, source: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): Promise<NativeT01Resume> {
  const evidenceRoot = realpathSync(resolve(source))
  const resume = await readNativeT06Evidence(productRoot, evidenceRoot, join(evidenceRoot, 'T06-speed-comparison.json'), selected, true)
  const interruptionPath = join(evidenceRoot, 'interruption.json')
  const interruption = JSON.parse(readFileSync(interruptionPath, 'utf8'))
  expect(interruption.nativeExternalSessionId).toBe(resume.t01Record.externalSessionId)
  const saved = readSaved(join(evidenceRoot, 'T04.h5lesson'))
  expect(readSaved(resume.projectPath), 'Resume the actual last saved project only').toEqual(saved)
  const title = titleItem(saved.project), beforeTitle = titleItem(resume.original.project)
  expect(title.content.data.text).toBe('简谐运动')
  expect(title.content.data.style.fontSize).toBeGreaterThan(beforeTitle.content.data.style.fontSize)
  expect(title.content.data.style.align).toBe('center')
  expect(Math.abs(title.frame.x + title.frame.width / 2 - 640)).toBeLessThan(4)
  expect(runtimeItem(saved.project)).toEqual(runtimeItem(resume.afterT06!.slowed.project))
  expect(imageItem(saved.project)).toEqual(imageItem(resume.afterT06!.slowed.project))
  const undone = readSaved(join(evidenceRoot, 'T06-undone.h5lesson')), redone = readSaved(join(evidenceRoot, 'T06-redone.h5lesson'))
  expect(runtimeItem(undone.project)).toEqual(runtimeItem(resume.afterT05!.cube.project))
  expect(runtimeItem(redone.project)).toEqual(runtimeItem(resume.afterT06!.slowed.project))
  const evidence = JSON.parse(readFileSync(join(evidenceRoot, 'T04.native.json'), 'utf8'))
  const records = (evidence.records as unknown[]).map(value => localAgentRecordV2Schema.parse(value))
  const record = records.find(value => value.id === interruption.lastCommit.sessionId)
  if (!record) throw new Error('The interrupted checkpoint has no actual completed T04 record')
  expect(record.tasks.at(-1)).toMatchObject({ goal: NATIVE_PROMPTS.T04, status: 'completed' })
  expect(record.externalSessionId).toBe(resume.t01Record.externalSessionId)
  expect(record.workspace).toEqual(resume.t01Record.workspace)
  expect(record.hostResults.at(-1)).toMatchObject({ status: 'committed', afterRevision: saved.project.revision })
  const configuration = [...record.events].reverse().find(event => event.kind === 'configuration')
  if (configuration?.kind !== 'configuration') throw new Error('T04 has no actual native model configuration')
  expect(configuration.capabilities.current.model).toBe(selected.model)
  if (selected.effort !== 'default') expect(configuration.capabilities.current.effort).toBe(selected.effort)
  const persisted = resume.historyFiles.find(file => file.path.endsWith(`${record.id}.json`))
  if (!persisted) throw new Error('T04 original native history is missing')
  expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(record)
  const unfinished = resume.historyFiles.find(file => file.path.endsWith(`${interruption.unfinishedRecord.sessionId}.json`))
  if (!unfinished) throw new Error('The interrupted T07 start must remain recorded')
  const orphan = localAgentRecordV2Schema.parse(JSON.parse(unfinished.bytes.toString('utf8')))
  expect(orphan.tasks.at(-1)?.goal).toBe(NATIVE_PROMPTS.T07Start)
  expect(orphan.hostResults).toHaveLength(0)
  expect(orphan.events).toHaveLength(1)
  for (const name of ['T07-manual.h5lesson', 'T07.input.json', 'T07.h5lesson']) expect(existsSync(join(evidenceRoot, name))).toBe(false)
  return { ...resume, afterT04: { evidenceRoot, record, saved, interruptionPath } }
}

/** Product startup can mark orphaned turns interrupted. Run that normal cleanup
 * in a full profile copy so original native evidence stays byte-for-byte intact. */
export function prepareNativeExecutionProfile(resume: NativeT01Resume, attemptRoot: string): void {
  if (!contained(resume.sourceRoot, realpathSync(attemptRoot))) throw new Error('Execution profile must stay in its original independent slot')
  const destination = join(attemptRoot, 'execution-profile')
  if (existsSync(destination)) throw new Error('Execution profile must be new')
  // Node 24.14 fs.cpSync terminates the Windows worker on this real long-path
  // profile. Copy ordinary profile entries explicitly so IO errors stay visible.
  const copyDirectory = (source: string, target: string) => {
    mkdirSync(target)
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const input = join(source, entry.name), output = join(target, entry.name)
      if (entry.isDirectory()) copyDirectory(input, output)
      else if (entry.isFile()) copyFileSync(input, output, constants.COPYFILE_EXCL)
      else throw new Error(`Execution profile has an unsupported entry: ${input}`)
    }
  }
  copyDirectory(resume.profilePath, destination)
  for (const file of resume.historyFiles) {
    if (!contained(resume.profilePath, file.path)) continue
    const copiedPath = join(destination, relative(resume.profilePath, file.path))
    expect(readFileSync(copiedPath).equals(file.bytes), 'Copy must preserve original native records before product startup').toBe(true)
  }
  resume.executionProfilePath = destination
  writeFileSync(join(attemptRoot, 'execution-profile.json'), JSON.stringify({ source: resume.profilePath, destination,
    projectPath: resume.projectPath, projectPathChanged: false, nativeHistoryRewritten: false,
    originalNativeHistoryPreserved: true, productMayRecoverOrphanedTurnsInExecutionCopy: true }, null, 2))
}

/** A real recovery followed by Save creates a new file-location workspace.
 * Its old committed cube is reused, but native identity continuity starts anew. */
export async function loadRecoveredNativeT05(productRoot: string, manifestPath: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): Promise<NativeT01Resume> {
  const path = realpathSync(resolve(manifestPath)), manifest = JSON.parse(readFileSync(path, 'utf8'))
  expect(manifest).toMatchObject({ version: 1, kind: 'claude-t05-budget-recovery', status: 'zero-model-recovery-validated' })
  expect(selected.adapter).toBe('claude')
  const old = readNativeT01Evidence(productRoot, manifest.source.runRoot, selected)
  expect(resolve(manifest.source.profilePath).toLowerCase()).toBe(old.profilePath.toLowerCase())
  expect(resolve(manifest.source.projectPath).toLowerCase()).toBe(old.projectPath.toLowerCase())
  expect(manifest.source.externalSessionId).toBe(old.t01Record.externalSessionId)
  expect(manifest.source.configuration).toMatchObject({ model: selected.model, effort: selected.effort })
  const recordPath = realpathSync(resolve(manifest.source.recordPath))
  if (!contained(old.profilePath, recordPath)) throw new Error('Recovered source record must belong to the original profile')
  const record = localAgentRecordV2Schema.parse(JSON.parse(readFileSync(recordPath, 'utf8')))
  expect(record.id).toBe(manifest.source.localSessionId)
  expect(record.tasks.at(-1)).toMatchObject({ goal: NATIVE_PROMPTS.T05, status: 'partial' })
  expect(record.externalSessionId).toBe(old.t01Record.externalSessionId)
  expect(record.workspace).toEqual(old.t01Record.workspace)
  expect(record.hostResults).toContainEqual(manifest.source.commit)
  const configuration = [...record.events].reverse().find(event => event.kind === 'configuration')
  if (configuration?.kind !== 'configuration') throw new Error('Recovered T05 has no actual native configuration')
  expect(configuration.capabilities.current.model).toBe(selected.model)
  if (selected.effort !== 'default') expect(configuration.capabilities.current.effort).toBe(selected.effort)
  const t02 = readSaved(join(old.sourceRoot, 'T02.h5lesson'))
  await verifyGreenImage(old.original, t02)
  const sourceRecovery = realpathSync(resolve(manifest.source.recoveryArchivePath))
  if (!contained(old.profilePath, sourceRecovery)) throw new Error('Recovery archive must belong to the original profile')
  const recovered = readSaved(sourceRecovery)
  expect(recovered.project.revision).toBe(manifest.source.commit.afterRevision)
  expect(imageItem(recovered.project)).toEqual(imageItem(t02.project))
  expect(titleItem(recovered.project)).toEqual(titleItem(t02.project))
  expect(slideItems(recovered.project).some(item => item.layerItemId === FIXTURE_IDS.square)).toBe(false)
  const runtime = runtimeItem(recovered.project)
  expect(runtime.layerItemId).toBe(manifest.execution.runtimeId)
  expect(runtime.runtime.enabled).toBe(true)
  const sourceRoot = realpathSync(resolve(manifest.execution.runRoot))
  if (!contained(join(productRoot, 'output'), sourceRoot) || !contained(sourceRoot, path)) throw new Error('Recovery execution must stay in this workspace output')
  const projectPath = realpathSync(resolve(manifest.execution.projectPath)), profilePath = realpathSync(resolve(manifest.execution.profilePath))
  if (!contained(sourceRoot, projectPath) || !contained(sourceRoot, profilePath)) throw new Error('Recovered execution paths escaped their root')
  expect(projectPath.toLowerCase()).not.toBe(old.projectPath.toLowerCase())
  const baselinePath = realpathSync(resolve(manifest.execution.savedT05ArchivePath))
  if (!contained(sourceRoot, baselinePath)) throw new Error('Recovered saved evidence escaped its root')
  const cube = readSaved(baselinePath)
  expect(cube).toEqual(recovered)
  expect(readSaved(projectPath)).toEqual(cube)
  expect(JSON.parse(readFileSync(manifest.execution.savedProjectJsonPath, 'utf8'))).toEqual(cube.project)
  const result = JSON.parse(readFileSync(manifest.execution.recoveryResultPath, 'utf8'))
  expect(result).toMatchObject({ status: 'recovered-saved-reopened-motion-and-visual-checked', pageErrors: [],
    attribution: { recoveryValidationModelCalls: 0 }, visualReview: { reviewed: true, ownerAcceptance: false } })
  expect(result.sourceIntegrityAfter).toEqual(result.sourceIntegrityBefore)
  const motion = JSON.parse(readFileSync(manifest.execution.motionPath, 'utf8')) as Awaited<ReturnType<typeof sampleRuntimeMotion>>
  expect(motion.samples).toHaveLength(24)
  expect(motion.differences.filter(value => value.meanAbsoluteDelta > .3).length).toBeGreaterThan(16)
  for (const sample of motion.samples) if (!contained(sourceRoot, realpathSync(sample.file))) throw new Error('Recovered motion evidence escaped its root')
  expect(existsSync(manifest.execution.filmstripPath)).toBe(true)
  expect(manifest.execution).toMatchObject({ modelCalls: 0, visualReviewed: true, ownerAcceptance: false, nextPrompt: NATIVE_PROMPTS.T06 })
  expect(manifest.execution.requestedNextConfiguration).toEqual({ model: process.env.COURSEWARE_R18_NATIVE_MODEL, effort: process.env.COURSEWARE_R18_NATIVE_EFFORT })
  return { ...old, sourceRoot, projectPath, profilePath,
    recoveredT05: { manifestPath: path, originalSourceRoot: old.sourceRoot, previousExternalSessionId: old.t01Record.externalSessionId!,
      workspaceBoundary: manifest.execution.workspaceIdentityTransition },
    afterT05: { evidenceRoot: sourceRoot, record, cube, motion, baselinePath, currentBeforeReset: cube, restoreRequired: false } }
}

export async function loadNativeT06Resume(productRoot: string, source: string, timingPath: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): Promise<NativeT01Resume> {
  const resume = await readNativeT06Evidence(productRoot, source, timingPath, selected)
  const current = readSaved(resume.projectPath), evidenceRoot = resume.afterT06!.evidenceRoot
  const manifest = JSON.parse(readFileSync(join(evidenceRoot, 'run.json'), 'utf8'))
  if (!manifest.continuation && existsSync(join(evidenceRoot, 'T04.h5lesson'))) {
    expect(manifest.status).toBe('failed')
    expect(manifest.failure).toContain('toBeLessThan')
    expect(existsSync(join(evidenceRoot, 'T07.input.json')), 'Do not replay a previously started T07').toBe(false)
    const saved = readSaved(join(evidenceRoot, 'T04.h5lesson'))
    expect(current, 'Continue the actual failed title edit; do not restore the earlier T06 archive').toEqual(saved)
    expect(Math.abs(titleItem(saved.project).frame.x + titleItem(saved.project).frame.width / 2 - 640)).toBeGreaterThanOrEqual(4)
    const unchanged = structuredClone(saved)
    unchanged.project.revision = resume.afterT06!.slowed.project.revision
    unchanged.project.updatedAt = resume.afterT06!.slowed.project.updatedAt
    Object.assign(titleItem(unchanged.project), structuredClone(titleItem(resume.afterT06!.slowed.project)))
    expect(unchanged, 'Only the already recorded failed title edit may differ from the successful T06 checkpoint').toEqual(resume.afterT06!.slowed)
    const records = JSON.parse(readFileSync(join(evidenceRoot, 'T04.native.json'), 'utf8')).records.map((record: unknown) => localAgentRecordV2Schema.parse(record)) as LocalAgentRecordV2[]
    const record = records.find(value => value.tasks.at(-1)?.goal === NATIVE_PROMPTS.T04 && value.tasks.at(-1)?.status === 'completed'
      && value.hostResults.some(result => result.status === 'committed' && result.afterRevision === saved.project.revision))
    if (!record) throw new Error('The actual committed-but-misplaced T04 native evidence is missing')
    expect(record.externalSessionId).toBe(resume.t01Record.externalSessionId)
    expect(record.workspace).toEqual(resume.t01Record.workspace)
    const persisted = resume.historyFiles.find(file => file.path.endsWith(`${record.id}.json`))
    if (!persisted) throw new Error('The failed T04 native history is missing')
    expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(record)
    resume.afterFailedT04 = { evidenceRoot, record, saved }
  } else expect(current, 'Continue only the already committed successful T06 fixture').toEqual(resume.afterT06!.slowed)
  return resume
}

/** Preserve the real T07 race and manual draft after a driver interrupted the
 * refreshed native turn. Continue through the same UI/native identity, without
 * recreating a race or replaying any candidate. */
export async function loadNativeT07ManualResume(productRoot: string, source: string,
  selected: { adapter: NativeCli; ordinal: number; model: string; effort: string }): Promise<NativeT01Resume> {
  const evidenceRoot = realpathSync(resolve(source))
  const manifest = JSON.parse(readFileSync(join(evidenceRoot, 'run.json'), 'utf8'))
  expect(manifest.selected).toEqual(selected)
  expect(manifest.continuation?.phase).toBe('after-T06')
  expect(manifest.existingHistoryPreserved).toBe(true)
  expect(manifest.failure).toContain('T07-start: 已停止；未应用候选已丢弃')
  const resume = await readNativeT06Evidence(productRoot, manifest.continuation.passedT06Attempt, manifest.continuation.actualTimingEvidence, selected)
  expect(resolve(evidenceRoot, '..').toLowerCase()).toBe(join(resume.sourceRoot, 'attempts').toLowerCase())
  expect(resolve(manifest.runRoot).toLowerCase()).toBe(evidenceRoot.toLowerCase())
  expect(resolve(manifest.projectPath).toLowerCase()).toBe(resume.projectPath.toLowerCase())
  const t04 = readSaved(join(evidenceRoot, 'T04.h5lesson'))
  expect(titleItem(t04.project).content.data.text).toBe('简谐运动')
  expect(titleItem(t04.project).content.data.style.fontSize).toBeGreaterThan(titleItem(resume.original.project).content.data.style.fontSize)
  expect(titleItem(t04.project).content.data.style.align).toBe('center')
  const title = titleItem(t04.project)
  expect(Math.abs(title.frame.x + title.frame.width / 2 - 640)).toBeLessThan(4)
  const undone = readSaved(join(evidenceRoot, 'T04-undone.h5lesson')), redone = readSaved(join(evidenceRoot, 'T04-redone.h5lesson'))
  expect(titleItem(undone.project)).toEqual(titleItem(resume.original.project))
  expect(titleItem(redone.project)).toEqual(title)
  expect(runtimeItem(undone.project)).toEqual(runtimeItem(t04.project))
  expect(runtimeItem(redone.project)).toEqual(runtimeItem(t04.project))
  const manual = readSaved(join(evidenceRoot, 'T07-manual.h5lesson'))
  expect(readSaved(resume.projectPath), 'The real manual draft must remain unchanged at continuation').toEqual(manual)
  expect(titleItem(manual.project).content.data.text).toBe(MANUAL_TITLE)
  expect(runtimeItem(manual.project)).toEqual(runtimeItem(t04.project))
  expect(imageItem(manual.project)).toEqual(imageItem(t04.project))
  expect(manual.project.revision).toBeGreaterThan(t04.project.revision)
  const correction = JSON.parse(readFileSync(join(evidenceRoot, 'T07.input.json'), 'utf8'))
  expect(correction).toMatchObject({ prompt: NATIVE_PROMPTS.T07, sentAfterManualRevision: manual.project.revision })
  const records = resume.historyFiles.filter(file => !file.path.endsWith('.display.json')).map(file => localAgentRecordV2Schema.parse(JSON.parse(file.bytes.toString('utf8'))))
  const oldRecord = records.find(record => record.tasks.at(-1)?.goal === NATIVE_PROMPTS.T07Start
    && record.observations.some(observation => observation.documentRevision === t04.project.revision))
  const record = records.find(record => record.tasks.at(-1)?.goal.includes(NATIVE_PROMPTS.T07Start)
    && record.tasks.at(-1)?.goal.includes(NATIVE_PROMPTS.T07)
    && record.observations.some(observation => observation.documentRevision === manual.project.revision))
  if (!oldRecord || !record) throw new Error('The original T07 start and refreshed correction records must both be preserved')
  for (const value of [oldRecord, record]) {
    expect(value.externalSessionId).toBe(resume.t01Record.externalSessionId)
    expect(value.workspace).toEqual(resume.t01Record.workspace)
    expect(value.tasks.at(-1)?.status).toBe('cancelled')
    expect(value.hostResults).toHaveLength(0)
    expect(value.events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'cancelled', failure: null })
  }
  expect(oldRecord.events.some(event => event.kind === 'text' || event.kind === 'tool')).toBe(true)
  expect(record.events[0]!.time).toBeGreaterThan(oldRecord.events.at(-1)!.time)
  expect(existsSync(join(evidenceRoot, 'T07-manual.png'))).toBe(true)
  return { ...resume, afterT07Manual: { evidenceRoot, oldRecord, record, manual, t04 } }
}

export function restoreNativeT05Fixture(resume: NativeT01Resume, attemptRoot: string): void {
  if (!resume.afterT05 || resume.afterT06 || !resume.afterT05.restoreRequired) return
  expect(readSaved(resume.projectPath)).toEqual(resume.afterT05.currentBeforeReset)
  if (!contained(resume.sourceRoot, attemptRoot)) throw new Error('Checkpoint reset evidence must stay in the original fixture')
  writeFileSync(join(attemptRoot, 'pre-resume-failed-T06.h5lesson'), readFileSync(resume.projectPath))
  writeFileSync(resume.projectPath, readFileSync(resume.afterT05.baselinePath))
  expect(readSaved(resume.projectPath)).toEqual(resume.afterT05.cube)
  writeFileSync(join(attemptRoot, 'checkpoint-restoration.json'), JSON.stringify({ kind: 'test-input-restoration',
    from: resume.afterT05.baselinePath, to: resume.projectPath, preservedPriorResult: join(attemptRoot, 'pre-resume-failed-T06.h5lesson'),
    beforeRevision: resume.afterT05.currentBeforeReset.project.revision, afterRevision: resume.afterT05.cube.project.revision,
    nativeHistoryRewritten: false, modelCandidateReplayed: false }, null, 2))
}

export function assertNativeHistoryPreserved(resume: NativeT01Resume): void {
  for (const file of resume.historyFiles) expect(readFileSync(file.path).equals(file.bytes), `Existing native history was changed: ${file.path}`).toBe(true)
}

/** Formal V9 factories and archive writer create a real saved lesson. No final
 * answer, candidate, Runtime source, tool schema or model hint is preloaded. */
export async function writeNativeLesson(projectPath: string): Promise<CourseProjectArchiveData> {
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect x="12" y="12" width="216" height="136" rx="24" fill="#e53935"/><circle cx="76" cy="80" r="26" fill="white"/><path d="M124 62h62M124 82h46M124 102h62" stroke="white" stroke-width="8" stroke-linecap="round"/></svg>')).png().toBuffer()
  const project = createBlankCourseProject({ title: '自然语言编辑验收', includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Expected the formal default Slide surface')
  const scene = surface.scenes[0]!
  scene.name = '红色图片、标题与正方形'
  scene.layerItems.push(
    sceneNodeToCourseLayerItem(createTextNode({ id: FIXTURE_IDS.title, name: '课程标题', text: '振动的世界', x: 86, y: 72, width: 760, height: 78, style: { fontSize: 32, align: 'left' } }), 0),
    sceneNodeToCourseLayerItem(createImageNode({ id: FIXTURE_IDS.image, name: '红色图片', assetId: FIXTURE_IDS.asset, x: 150, y: 265, width: 360, height: 240 }), 1),
    sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id: FIXTURE_IDS.square, name: '正方形', x: 810, y: 275, width: 220, height: 220,
      style: { fillColor: '#2563eb', borderColor: '#173d88', borderWidth: 3 } }), 2),
  )
  project.assets[FIXTURE_IDS.asset] = { id: FIXTURE_IDS.asset, kind: 'image', filename: 'red-artwork.png', mimeType: 'image/png',
    path: 'assets/red-artwork.png', byteLength: image.length, width: 240, height: 160 }
  const data = { project: courseProjectDocumentSchema.parse(project), assetFiles: { [FIXTURE_IDS.asset]: new Uint8Array(image) }, componentFiles: {} }
  mkdirSync(resolve(projectPath, '..'), { recursive: true })
  writeFileSync(projectPath, createCourseProjectArchive(data))
  return readSaved(projectPath)
}

export interface NativeRun {
  app: ElectronApplication
  page: Page
  runRoot: string
  workspaceRoot: string
  projectPath: string
  userData: string
  pageErrors: string[]
  consoleErrors: string[]
  /**
   * Narrow, test-owned native permission policy. It is absent for every
   * ordinary fixture run, so no test gains a default CLI permission grant.
   */
  nativePermissionPolicy?: NativePermissionPolicy
}

export interface NativePermissionPolicy {
  /** Stable session staging directory for the one resumed native workspace. */
  readonly stagingRoot: string
  /** Exact immutable capability snapshot for this turn. */
  readonly capabilityRoot: string
  /** The product output root, read/search only. */
  readonly outputRoot: string
  readonly workspace: LocalAgentRecordV2['workspace']
  readonly workingDirectoryId: string
  readonly model: string
  readonly effort: string
}

export async function launchNativeEditor(productRoot: string, runRoot: string, projectPath: string, resume?: Pick<NativeT01Resume, 'sourceRoot' | 'projectPath' | 'profilePath' | 'executionProfilePath'>): Promise<NativeRun> {
  for (const artifact of ['dist-electron/main/index.js', 'dist-renderer/index.html', 'dist-player/player.iife.js']) {
    if (!existsSync(join(productRoot, artifact))) throw new Error(`Build gate: missing ${artifact}; prepare the integrated product before the native run`)
  }
  const workspaceRoot = resume?.sourceRoot ?? runRoot
  if (!contained(workspaceRoot, runRoot) || resume && resolve(projectPath).toLowerCase() !== resume.projectPath.toLowerCase()) throw new Error('Resume launch must retain its validated fixture and evidence root')
  const profilePath = resume?.executionProfilePath ?? resume?.profilePath ?? join(runRoot, 'profile')
  const app = await electron.launch({ cwd: productRoot, args: ['.', `--user-data-dir=${profilePath}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const pageErrors: string[] = [], consoleErrors: string[] = []
    const page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()) })
    const userData = await app.evaluate(({ app: native }) => native.getPath('userData'))
    if (resolve(userData).toLowerCase() !== resolve(profilePath).toLowerCase()) throw new Error('The test must use its exact validated profile')
    const run = { app, page, runRoot, workspaceRoot, projectPath, userData, pageErrors, consoleErrors }
    await expectBackgroundWindowsIsolated(app, true)
    // Enter only the landing page; never replace an already opened editor or recovery draft.
    const startupMore = page.locator('.lesson-workspace-more > summary')
    const startupEditor = page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true })
    const startupRecovery = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
    await expect.poll(async () => await startupEditor.isVisible() || await startupMore.isVisible() || await startupRecovery.isVisible()).toBe(true)
    if (!await startupEditor.isVisible() && await startupMore.isVisible() && !await startupRecovery.isVisible()) {
      await startupMore.click()
      await page.getByRole('button', { name: '新建独立课件', exact: true }).click()
    }
    await page.locator('[data-testid="canvas-stage"] canvas').first().waitFor()
    // Only the OS file picker is replaced so this hidden test can choose its own
    // known lesson. Native CLI launch, auth, configuration, tools and IPC are real.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const professional = page.getByRole('button', { name: '专业', exact: true })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
    await showEditorPanel(page, '属性与素材')
    await page.getByRole('tab', { name: '图层', exact: true }).click()
    await expect(page.getByTestId(`node-item-${FIXTURE_IDS.image}`)).toHaveCount(1)
    await expectBackgroundWindowsIsolated(app, true)
    return run
  } catch (error) { await app.close().catch(() => {}); throw error }
}

export async function showEditorPanel(page: Page, name: '页面与图层' | '属性与素材'): Promise<void> {
  if (!await page.locator('[aria-label="课件编辑面板"]').isVisible()) return
  const button = page.getByRole('button', { name, exact: true })
  await expect(button).toBeVisible()
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
}

export async function closeNativeEditor(run: NativeRun): Promise<void> {
  const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
  const stop = chat.getByRole('button', { name: '停止', exact: true })
  if (await stop.count().catch(() => 0) && await stop.isEnabled().catch(() => false)) await stop.click().catch(() => {})
  await expectBackgroundWindowsIsolated(run.app, true).catch(() => {})
  await run.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach(window => window.destroy())
  }).catch(() => {})
  await run.app.close().catch(() => {})
  // Run roots are intentionally retained, including failed native sessions.
}

export async function selectLayer(page: Page, id: string): Promise<void> {
  await showEditorPanel(page, '属性与素材')
  const layers = page.getByRole('tab', { name: '图层', exact: true })
  await layers.click()
  await expect(layers).toHaveAttribute('aria-selected', 'true')
  const row = page.getByTestId(`node-item-${id}`)
  await expect(row).toBeVisible()
  await row.locator('.node-name').click()
  const properties = page.getByRole('tab', { name: '属性', exact: true })
  await expect(properties).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('properties-tab')).toBeVisible()
}

export async function saveStage(run: NativeRun, name: string): Promise<CourseProjectArchiveData> {
  const previous = statSync(run.projectPath).mtimeMs
  await run.page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
  await expect.poll(() => statSync(run.projectPath).mtimeMs, { timeout: 15000 }).toBeGreaterThan(previous)
  const saved = readSaved(run.projectPath)
  writeFileSync(join(run.runRoot, `${name}.h5lesson`), readFileSync(run.projectPath))
  writeFileSync(join(run.runRoot, `${name}.project.json`), JSON.stringify(saved.project, null, 2))
  await run.page.screenshot({ path: join(run.runRoot, `${name}.png`), animations: 'allow' })
  return saved
}

/** Preserve actual partial work through the ordinary Save UI before closing a failed run. */
export async function preserveNativeFailure(run: NativeRun): Promise<number> {
  const stop = run.page.getByRole('complementary', { name: 'CLI 创作助手' }).getByRole('button', { name: '停止', exact: true })
  if (await stop.count() && await stop.isEnabled()) {
    await stop.click({ timeout: 10000 })
    await expect.poll(async () => await stop.count() > 0 && await stop.isEnabled(), { timeout: 10000 }).toBe(false)
  }
  return (await saveStage(run, 'failure-current')).project.revision
}

/** Read only the dedicated run's persisted V2 records. Raw native identities,
 * configurations, observations and actual commit receipts remain in artifacts. */
export function nativeRecords(run: NativeRun): LocalAgentRecordV2[] {
  const root = join(run.userData, 'local-agent', 'v2')
  if (!existsSync(root)) return []
  const values: LocalAgentRecordV2[] = []
  for (const workspace of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const directory = join(root, workspace.name)
    for (const entry of readdirSync(directory, { withFileTypes: true }).filter(value => value.isFile() && /^[a-f0-9-]{36}\.json$/i.test(value.name))) {
      values.push(localAgentRecordV2Schema.parse(JSON.parse(readFileSync(join(directory, entry.name), 'utf8'))))
    }
  }
  return values
}
export function nativeEvidence(run: NativeRun) {
  const records = nativeRecords(run)
  return { records, summary: records.map(record => ({ sessionId: record.id, externalSessionId: record.externalSessionId,
    tasks: record.tasks, observations: record.observations, hostResults: record.hostResults,
    configuration: record.events.filter(event => event.kind === 'configuration').map(event => event.kind === 'configuration' ? event.capabilities : null) })) }
}

export async function recordEvidence(run: NativeRun, name: string) {
  const value = nativeEvidence(run)
  writeFileSync(join(run.runRoot, `${name}.native.json`), JSON.stringify(value, null, 2))
  return value
}

function contained(root: string, candidate: string) {
  const inside = relative(resolve(root), resolve(candidate))
  return inside !== '..' && !inside.startsWith('..\\') && !inside.startsWith('../') && !isAbsolute(inside)
}

interface VisibleNativePermission {
  readonly questionId: string
  readonly title: string
  readonly labels: ReadonlyArray<{ readonly name: string | null; readonly text: string }>
  readonly paths: readonly string[]
}

type NativePermissionScope = 'candidate-read-write' | 'capability-read' | 'output-read-search'

interface NativeCandidateBinding {
  readonly root: string
  readonly requestId: string
  readonly observationId: string
}

interface NativePermissionAuthorization {
  readonly scope: NativePermissionScope
  readonly activeTools: string[]
  readonly recordId: string
  readonly taskId: string
  readonly observationId: string
  readonly requestId: string
}

function nativePermissionPaths(title: string): string[] {
  const encoded = title.match(/\{[\s\S]*\}/)?.[0]
  if (!encoded) return []
  try {
    const value = JSON.parse(encoded) as { filepath?: unknown; parentDir?: unknown }
    const paths = [value.filepath, value.parentDir].filter((path): path is string => typeof path === 'string' && path.length > 0)
    return [...new Set(paths)]
  } catch {
    return []
  }
}

function sameWorkspace(left: LocalAgentRecordV2['workspace'], right: LocalAgentRecordV2['workspace']): boolean {
  const leftProject = requireProjectWorkspace(left)
  const rightProject = requireProjectWorkspace(right)
  return leftProject.version === rightProject.version && leftProject.projectId === rightProject.projectId && leftProject.normalizedPath === rightProject.normalizedPath
}

export function requireProjectWorkspace(workspace: LocalAgentRecordV2['workspace']) {
  if (!('projectId' in workspace) || !('normalizedPath' in workspace)) throw new Error('Expected an engineering project workspace for this authoring test')
  return workspace
}

function sameNativePath(left: string, right: string): boolean {
  return resolve(left).replace(/[\\/]/g, '/').toLowerCase() === resolve(right).replace(/[\\/]/g, '/').toLowerCase()
}

function activePolicyRecord(records: LocalAgentRecordV2[], policy: NativePermissionPolicy, question: VisibleNativePermission): LocalAgentRecordV2 | undefined {
  const matches = records.filter(record => {
    const task = record.tasks.at(-1)
    if (record.workingDirectoryId !== policy.workingDirectoryId
      || !sameWorkspace(record.workspace, policy.workspace)
      || !task
      || (task.status !== 'running' && task.status !== 'waiting-input')
      || !sameWorkspace(task.workspace, policy.workspace)) return false
    const asked = record.events.filter(event => event.kind === 'question'
      && event.question.purpose === 'permission'
      && event.question.taskId === task.taskId
      && event.question.epoch === task.epoch
      && sameWorkspace(event.question.workspace, policy.workspace)
      && event.question.questionId === question.questionId
      && event.question.questions.length === 1
      && event.question.questions[0]?.id === question.questionId
      && event.question.questions[0]?.title === question.title).at(-1)
    if (!asked) return false
    return !record.events.some(event => event.kind === 'input-delivery'
      && event.sequence > asked.sequence
      && event.delivery.questionId === question.questionId
      && event.delivery.status !== 'rejected')
  })
  return matches.length === 1 ? matches[0] : undefined
}

function ownerWorkspaceRoot(run: NativeRun, policy: NativePermissionPolicy): string | undefined {
  const workspaceRoot = join(run.userData, 'local-agent', 'v2', createHash('sha256').update(workspaceIdentityKey(policy.workspace)).digest('hex'))
  const stagingRoot = join(workspaceRoot, policy.workingDirectoryId, 'staging')
  return sameNativePath(policy.stagingRoot, stagingRoot) ? workspaceRoot : undefined
}

/** The host creates this request-specific root before opening the native CLI.
 * The current task's durable observation is the Owner of its request UUID, so
 * later host feedback can lawfully refresh to a new UUID without widening the
 * session or accepting an arbitrary displayed path. */
function currentCandidateRoot(run: NativeRun, policy: NativePermissionPolicy, record: LocalAgentRecordV2): NativeCandidateBinding | undefined {
  const task = record?.tasks.at(-1)
  const workspaceRoot = ownerWorkspaceRoot(run, policy)
  if (!task?.observationId || !workspaceRoot || record.workingDirectoryId !== policy.workingDirectoryId) return undefined
  const observations = record.observations.filter(value => value.observationId === task.observationId
    && value.taskId === task.taskId && value.epoch === task.epoch && sameWorkspace(value.workspace, policy.workspace))
  if (observations.length !== 1) return undefined
  const observation = observations[0]!
  const metadataPath = join(workspaceRoot, policy.workingDirectoryId, 'observations', observation.observationId, 'generation-request.json')
  const metadataResult = existsSync(metadataPath) ? generationRequestSchema.safeParse(JSON.parse(readFileSync(metadataPath, 'utf8'))) : undefined
  if (!metadataResult?.success) return undefined
  const metadata = metadataResult.data
  if (!sameWorkspace(metadata.workspace, policy.workspace)
    || metadata.documentRevision !== observation.documentRevision
    || metadata.sessionGeneration !== observation.sessionGeneration) return undefined
  const root = join(policy.stagingRoot, 'candidates', metadata.requestId)
  const requestPath = join(root, 'request.json')
  if (!existsSync(requestPath)) return undefined
  try {
    if (!sameNativePath(realpathSync(root), root)) return undefined
    // request.json is the CLI projection (resourceIndex instead of resourceFiles).
    // Its identity must match the strict durable request; it is not that schema.
    const { resourceIndex: _resourceIndex, fileAccess: _fileAccess, destinationAliases: _destinations,
      assetAliases: _assets, ...stagedRequest } = JSON.parse(readFileSync(requestPath, 'utf8'))
    const staged = generationRequestSchema.safeParse(stagedRequest)
    if (!staged.success || staged.data.requestId !== metadata.requestId
      || !sameWorkspace(staged.data.workspace, metadata.workspace)
      || staged.data.documentRevision !== metadata.documentRevision
      || staged.data.sessionGeneration !== metadata.sessionGeneration) return undefined
    return { root, requestId: metadata.requestId, observationId: observation.observationId }
  } catch {
    return undefined
  }
}

function isCapabilityDocument(root: string, file: string): boolean {
  if (!contained(root, file)) return false
  const first = relative(resolve(root), resolve(file)).split(/[\\/]/)[0]
  return first === 'tools' || first === 'protocols' || first === 'skills'
}

/** Use the exact current task/epoch's last tool state. The chat activity list
 * is historical presentation, so it cannot establish a permission boundary. */
function activeNativeTools(record: LocalAgentRecordV2, task: LocalAgentRecordV2['tasks'][number]): string[] {
  const latest = new Map<string, string | null>()
  for (const event of record.events) {
    if (event.kind !== 'tool' || event.taskId !== task.taskId || event.epoch !== task.epoch) continue
    latest.set(event.itemId, event.status === 'running' ? event.name.toLowerCase() : null)
  }
  return [...new Set([...latest.values()].filter((name): name is string => name !== null))]
}

function hasOnlyActiveTools(names: readonly string[], allowed: readonly string[]): boolean {
  return names.length > 0 && names.every(name => allowed.includes(name))
}

function hasExpectedNativeConfiguration(record: LocalAgentRecordV2, policy: NativePermissionPolicy): boolean {
  const configuration = record && [...record.events].reverse().find(event => event.kind === 'configuration')
  return configuration?.kind === 'configuration'
    && configuration.capabilities.current.model === policy.model
    && configuration.capabilities.current.effort === policy.effort
}

export async function preauthorizedNativePermission(run: NativeRun, question: VisibleNativePermission): Promise<NativePermissionAuthorization | undefined> {
  const policy = run.nativePermissionPolicy
  if (!policy || !question.paths.length) return undefined
  if (/\b(Bash|PowerShell|terminal|command|execute|network|permissions)\b|执行|终端|网络/i.test(question.title)) return undefined
  const record = activePolicyRecord(nativeRecords(run), policy, question)
  if (!record || !hasExpectedNativeConfiguration(record, policy)) return undefined
  const task = record.tasks.at(-1)
  const candidate = currentCandidateRoot(run, policy, record)
  if (!task || !candidate) return undefined
  const activeTools = activeNativeTools(record, task)
  const authorized = (scope: NativePermissionScope): NativePermissionAuthorization => ({
    scope, activeTools, recordId: record.id, taskId: task.taskId, observationId: candidate.observationId, requestId: candidate.requestId,
  })
  if (question.paths.every(path => contained(candidate.root, path))
    && hasOnlyActiveTools(activeTools, ['read', 'search', 'glob', 'write', 'edit'])) {
    return authorized('candidate-read-write')
  }
  if (question.paths.every(path => isCapabilityDocument(policy.capabilityRoot, path))
    && hasOnlyActiveTools(activeTools, ['read', 'search', 'glob'])) {
    return authorized('capability-read')
  }
  if (question.paths.every(path => contained(policy.outputRoot, path))
    && hasOnlyActiveTools(activeTools, ['read', 'search', 'glob'])) {
    return authorized('output-read-search')
  }
  return undefined
}

async function submitVisibleAllowOnce(run: NativeRun, section: Locator, question: VisibleNativePermission, allow: { readonly name: string | null; readonly text: string }, authorization: NativePermissionAuthorization): Promise<void> {
  const safeId = `${authorization.taskId}-${authorization.requestId}-${question.questionId}`.replace(/[^A-Za-z0-9_-]/g, '_')
  writeFileSync(join(run.runRoot, `${safeId}.request.json`), JSON.stringify({ questionId: question.questionId, title: question.title,
    paths: question.paths, labels: question.labels, ...authorization, capturedAt: new Date().toISOString() }, null, 2))
  await run.page.screenshot({ path: join(run.runRoot, `${safeId}.request.png`) })
  await section.getByRole('radio', { name: allow.text, exact: true }).check()
  await section.getByRole('button', { name: '确认选择', exact: true }).click()
  await expect.poll(() => run.page.locator('section.native-agent-question input[type=radio]').evaluateAll(inputs => inputs.map(input => input.getAttribute('name')))).not.toContain(allow.name)
  writeFileSync(join(run.runRoot, `${safeId}.answer.json`), JSON.stringify({ questionId: question.questionId, choice: allow.text,
    ...authorization, submittedAt: new Date().toISOString() }, null, 2))
}

/** Select Allow once only through the visible GUI. Default fixture runs retain
 * the old human-decision path; the opt-in policy is bound to one verified
 * candidate root, immutable capability snapshot, and read-only output lookup. */
async function answerNativeQuestion(run: NativeRun, section: Locator, deadline: number): Promise<void> {
  const legends = await section.locator('legend').allTextContents()
  const labels = await section.getByRole('radio').evaluateAll(inputs => inputs.map(input => ({ name: input.getAttribute('name'), text: input.closest('label')?.textContent?.trim() ?? '' })))
  const title = legends.join('\n')
  const questionId = [...new Set(labels.map(label => label.name).filter((name): name is string => typeof name === 'string' && name.length > 0))]
  const question: VisibleNativePermission | undefined = questionId.length === 1 ? { questionId: questionId[0]!, title, labels, paths: nativePermissionPaths(title) } : undefined
  const fileRequest = /\b(Read|Write|Edit|file|path)\b|读[取写]|写入|文件/i.test(title) && !/\b(Bash|PowerShell|terminal|command|execute|network|permissions)\b|执行|终端|网络/i.test(title)
  const allow = labels.find(label => /^(仅允许这次|允许一次|允许这次操作|Allow once|Allow this time)$/i.test(label.text))
  const preauthorized = question && allow && await section.getAttribute('aria-label') === 'CLI 授权请求'
    ? await preauthorizedNativePermission(run, question)
    : undefined
  if (question && allow && preauthorized) {
    await submitVisibleAllowOnce(run, section, question, allow, preauthorized)
    return
  }
  const paths = [...title.matchAll(/[A-Za-z]:[\\/][^"\n\r<>|]+/g)].map(match => match[0]!.replace(/[),;\]} ]+$/, ''))
  if (!run.nativePermissionPolicy && await section.getAttribute('aria-label') === 'CLI 授权请求' && fileRequest && paths.length && paths.every(file => contained(run.workspaceRoot, file)) && allow) {
    writeFileSync(join(run.runRoot, `permission-${Date.now()}.json`), JSON.stringify({ title, paths, choice: allow.text, scope: run.workspaceRoot }, null, 2))
    await section.getByRole('radio', { name: allow.text, exact: true }).check()
    await section.getByRole('button', { name: '确认选择', exact: true }).click()
    await expect.poll(() => run.page.locator('section.native-agent-question input[type=radio]').evaluateAll(inputs => inputs.map(input => input.getAttribute('name')))).not.toContain(allow.name)
    return
  }
  const pending = join(run.runRoot, 'pending-native-question.json')
  const answerPath = join(run.runRoot, 'pending-native-question.answer.json')
  const questionKey = `${Date.now()}-${legends.join('|')}`
  writeFileSync(pending, JSON.stringify({ questionKey, legends, labels, answerPath,
    responseFormat: { questionKey, answers: [{ title: legends[0], values: ['exact visible option or typed answer'] }] } }, null, 2))
  await run.page.screenshot({ path: join(run.runRoot, 'pending-native-question.png') })
  console.log(`NATIVE_INPUT_REQUIRED ${pending}`)
  while (Date.now() < deadline) {
    const currentNames = await section.getByRole('radio').evaluateAll(inputs => inputs.map(input => input.getAttribute('name')))
    if (question && !currentNames.includes(question.questionId)) return
    // The visible question can precede the debounced durable V2 record.
    const durableAuthorization = question && allow && await section.getAttribute('aria-label') === 'CLI 授权请求'
      ? await preauthorizedNativePermission(run, question) : undefined
    if (question && allow && durableAuthorization) {
      await submitVisibleAllowOnce(run, section, question, allow, durableAuthorization)
      return
    }
    if (existsSync(answerPath)) {
      const reply = JSON.parse(readFileSync(answerPath, 'utf8')) as { questionKey: string; answers: Array<{ title: string; values: string[] }> }
      if (reply.questionKey === questionKey) {
        for (const answer of reply.answers) {
          const field = section.getByRole('group', { name: answer.title, exact: true })
          for (const value of answer.values) {
            const option = field.getByLabel(value, { exact: true })
            if (await option.count()) await option.check()
            else await field.getByRole('textbox').fill(value)
          }
        }
        await section.getByRole('button', { name: /^(确认选择|发送回答)$/ }).click()
        if (question) await expect.poll(() => run.page.locator('section.native-agent-question input[type=radio]').evaluateAll(inputs => inputs.map(input => input.getAttribute('name')))).not.toContain(question.questionId)
        return
      }
    }
    await run.page.waitForTimeout(500)
  }
  throw new Error(`Native question requires an explicit UI answer: ${pending}`)
}

export async function waitNativeTurn(run: NativeRun, step: string, timeoutMs: number): Promise<void> {
  const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const nativeQuestion = chat.locator('section.native-agent-question').first()
    if (await nativeQuestion.count()) await answerNativeQuestion(run, nativeQuestion, deadline)
    const alerts = await chat.getByRole('alert').allTextContents()
    if (alerts.length) throw new Error(`${step}: ${alerts.join('\n')}`)
    if (!(await chat.getByRole('button', { name: '停止', exact: true }).isEnabled())) {
      const notice = await chat.locator('.chat-scroll > [role="status"]').innerText()
      if (/未完成|未全部完成|已停止|失败|过期/.test(notice)) throw new Error(`${step}: ${notice}`)
      await recordEvidence(run, step)
      return
    }
    await run.page.waitForTimeout(300)
  }
  throw new Error(`${step}: native turn exceeded the fixed ${timeoutMs} ms budget; no retry was attempted`)
}

export async function sendNatural(run: NativeRun, step: string, prompt: string, timeoutMs: number, afterSend?: () => Promise<void>) {
  const chat = run.page.getByRole('complementary', { name: 'CLI 创作助手' })
  const before = nativeEvidence(run)
  writeFileSync(join(run.runRoot, `${step}.input.json`), JSON.stringify({ prompt, startedAt: new Date().toISOString(),
    cli: await chat.getByLabel('CLI', { exact: true }).inputValue(), model: await chat.getByLabel('模型', { exact: true }).inputValue(),
    effort: await chat.getByLabel('强度', { exact: true }).inputValue(), selectedSession: await chat.getByLabel('会话', { exact: true }).inputValue(),
    reference: await chat.getByLabel('本轮引用摘要').innerText(), before: before.summary }, null, 2))
  await chat.getByLabel('发送给创作助手', { exact: true }).fill(prompt)
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeEnabled()
  if (afterSend) await afterSend()
  await waitNativeTurn(run, step, timeoutMs)
}

export async function verifyGreenImage(before: CourseProjectArchiveData, after: CourseProjectArchiveData) {
  const original = imageItem(before.project), changed = imageItem(after.project)
  expect(changed.frame).toEqual(original.frame)
  expect(changed.rotation).toBe(original.rotation)
  const { assetId: _sourceId, ...originalDisplay } = original.content.data
  const { assetId: _changedId, ...changedDisplay } = changed.content.data
  expect(changedDisplay).toEqual(originalDisplay)
  const source = await sharp(before.assetFiles[original.content.data.assetId]!).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const output = await sharp(after.assetFiles[changed.content.data.assetId]!).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect([output.info.width, output.info.height]).toEqual([source.info.width, source.info.height])
  let redPixels = 0, greenPixels = 0, transparent = 0, preservedTransparent = 0, white = 0, preservedWhite = 0
  for (let i = 0; i < source.data.length; i += 4) {
    const [r, g, b, alpha] = source.data.subarray(i, i + 4)
    const [nextR, nextG, nextB, nextA] = output.data.subarray(i, i + 4)
    if (alpha! < 5) { transparent++; if (nextA! < 5) preservedTransparent++ }
    if (alpha! > 250 && r! > 245 && g! > 245 && b! > 245) { white++; if (nextR! > 230 && nextG! > 230 && nextB! > 230) preservedWhite++ }
    if (alpha! > 200 && r! > g! * 1.8 && r! > b! * 1.8) { redPixels++; if (nextG! > nextR! * 1.35 && nextG! > nextB! * 1.35 && nextA! > 180) greenPixels++ }
  }
  expect(redPixels).toBeGreaterThan(1000)
  expect(greenPixels / redPixels, 'The real embedded image must turn green').toBeGreaterThan(.9)
  expect(preservedTransparent / transparent, 'Transparent corners must remain').toBeGreaterThan(.98)
  expect(preservedWhite / white, 'White details must survive; a plain green rectangle is not a valid edit').toBeGreaterThan(.95)
  return { redPixels, greenPixels, transparent, preservedTransparent, white, preservedWhite }
}

async function openRuntimePreview(run: NativeRun, runtime: RuntimeLayerItem) {
  await run.page.getByRole('button', { name: '整课预览', exact: true }).click()
  const overlay = run.page.getByTestId('course-preview-overlay')
  const stage = run.page.getByTestId('course-preview-host').locator('.slide-published-adapter')
  await expect(stage).toBeVisible()
  await expectBackgroundWindowsIsolated(run.app, true)
  await expect(stage.locator('.courseware-runtime-error')).toHaveCount(0)
  await expect(stage.locator('[data-runtime-fallback="true"]')).toHaveCount(0)
  const bounds = await stage.boundingBox()
  if (!bounds) throw new Error('Actual preview stage is missing')
  const renderedRuntime = stage.locator(`[data-slide-layer-item=${JSON.stringify(runtime.layerItemId)}]`)
  await expect(renderedRuntime).toHaveAttribute('data-slide-runtime-state', 'playback')
  const clip = await renderedRuntime.boundingBox()
  if (!clip || clip.width <= 0 || clip.height <= 0) throw new Error('Runtime has no visible render bounds')
  return { overlay, renderedRuntime, clip }
}

/** Read the browser's actual running animation clocks, including open Shadow
 * DOM. No animation state, speed, source or frame is altered by this observer. */
type RotationAxes = { x: number; y: number; z: number }
type RafMotionNode = { path: string; inlineTransform: string; computedTransform: string; angles: RotationAxes }
type RafMotionFrame = { at: number; sampledAt: number; nodes: RafMotionNode[] }

export function measureObservedRafRotation(frames: RafMotionFrame[], source: string) {
  if (!/\brequestAnimationFrame\s*\(/.test(source)) throw new Error('Motion observer not applicable: no actual rAF implementation was identified')
  // This is a clock declaration, not the speed measurement. The angles below
  // come only from the actual DOM on real animation frames. A recognized clamp
  // makes the runtime's own elapsed-time scale explicit for a hidden compositor.
  const clamps = [...source.matchAll(/Math\.min\(\s*[\w$]+\s*-\s*[\w$]+\s*,\s*(\d+(?:\.\d+)?)\s*\)/g)]
  if (clamps.length > 1) throw new Error('Motion observer not applicable: ambiguous rAF elapsed-time clamps')
  const frameDeltaCapMs = clamps[0] ? Number(clamps[0][1]) : null
  if (frameDeltaCapMs !== null && !(frameDeltaCapMs > 0 && frameDeltaCapMs <= 1000)) throw new Error('Motion observer not applicable: unrecognized rAF clock bound')
  expect(frames.length, 'Actual rAF timestamps must accompany the rendered angle samples').toBeGreaterThan(5)
  const candidates = frames[0]!.nodes.map(node => {
    const samples = frames.map(frame => ({ at: frame.at, node: frame.nodes.find(value => value.path === node.path) }))
    if (samples.some(sample => !sample.node)) return null
    const intervals = samples.slice(1).map((sample, index) => {
      const previous = samples[index]!, elapsedMs = sample.at - previous.at
      const unwrap = (after: number, before: number) => ((after - before + 180) % 360 + 360) % 360 - 180
      const delta = { x: unwrap(sample.node!.angles.x, previous.node!.angles.x),
        y: unwrap(sample.node!.angles.y, previous.node!.angles.y), z: unwrap(sample.node!.angles.z, previous.node!.angles.z) }
      return { elapsedMs, animationElapsedMs: frameDeltaCapMs === null ? elapsedMs : Math.min(elapsedMs, frameDeltaCapMs), delta,
        angularTravelDegrees: Math.hypot(delta.x, delta.y, delta.z) }
    })
    if (intervals.filter(interval => interval.angularTravelDegrees > .0001).length < 4) return null
    return { path: node.path, samples, intervals }
  }).filter((value): value is NonNullable<typeof value> => value !== null)
  expect(candidates, 'Motion observer not applicable: expected exactly one changing DOM rotation target').toHaveLength(1)
  const target = candidates[0]!
  for (const interval of target.intervals) {
    expect(interval.elapsedMs).toBeGreaterThan(0)
    expect(Math.max(Math.abs(interval.delta.x), Math.abs(interval.delta.y), Math.abs(interval.delta.z)), 'Angular samples must be frequent enough to unwrap without aliasing').toBeLessThan(90)
  }
  expect(new Set(target.samples.map(sample => sample.node!.computedTransform)).size).toBeGreaterThan(3)
  const wallElapsedMs = target.intervals.reduce((sum, interval) => sum + interval.elapsedMs, 0)
  const animationElapsedMs = target.intervals.reduce((sum, interval) => sum + interval.animationElapsedMs, 0)
  const angularTravelDegrees = target.intervals.reduce((sum, interval) => sum + interval.angularTravelDegrees, 0)
  const axisTravelDegrees = target.intervals.reduce((sum, interval) => ({ x: sum.x + interval.delta.x, y: sum.y + interval.delta.y, z: sum.z + interval.delta.z }), { x: 0, y: 0, z: 0 })
  return { targetPath: target.path, frameCount: frames.length, frameDeltaCapMs, sourceClockExpression: clamps[0]?.[0] ?? null,
    clock: frameDeltaCapMs === null ? 'actual-rAF-monotonic-time' as const : 'actual-rAF-time-with-source-declared-clamp' as const,
    wallElapsedMs, animationElapsedMs, angularTravelDegrees, axisTravelDegrees,
    angularSpeedDegreesPerSecond: angularTravelDegrees / animationElapsedMs * 1000,
    wallAngularSpeedDegreesPerSecond: angularTravelDegrees / wallElapsedMs * 1000,
    intervals: target.intervals, targetSamples: target.samples,
    clockExplanation: frameDeltaCapMs === null ? 'Angular travel is divided by actual monotonic rAF time.'
      : `The actual runtime caps each frame delta at ${frameDeltaCapMs} ms. Both wall time and the accumulated capped animation time are retained; speed uses measured DOM angle travel per animation second. No runtime source, angle, playback state or clock was modified.` }
}

export async function observeRuntimeTiming(run: NativeRun, runtime: RuntimeLayerItem, name: string) {
  const { overlay, renderedRuntime, clip } = await openRuntimePreview(run, runtime)
  if (runtime.runtime.renderMode === 'phaser') {
    const observer = await startCanvasPoseObservation(renderedRuntime)
    try {
      for (let index = 0; index < 20; index++) {
        await run.page.screenshot({ clip, animations: 'allow', ...(index === 0 || index === 19 ? { path: join(run.runRoot, `${name}.canvas-frame-${index}.png`) } : {}) })
        await run.page.waitForTimeout(160)
      }
      const observed = await observer.evaluate(value => value.stop())
      const evidence: CanvasMotion = { source: 'actual-preview-canvas-painted-quadrilaterals', runtimeId: runtime.layerItemId, poses: observed.poses }
      writeFileSync(join(run.runRoot, `${name}.canvas-samples.json`), JSON.stringify({ ...evidence, overflow: observed.overflow }, null, 2))
      expect(observed.overflow, 'Canvas observation must not truncate actual painted poses').toBe(false)
      const measurement = validateCanvasPoses(observed.poses)
      writeFileSync(join(run.runRoot, `${name}.timing.json`), JSON.stringify({ ...evidence, ...measurement }, null, 2))
      return evidence
    } finally {
      await observer.evaluate(value => value.stop()).catch(() => {})
      await observer.dispose()
      await overlay.getByRole('button', { name: '关闭预览', exact: true }).click()
    }
  }
  // The observer owns only this extra read callback. It does not replace the
  // runtime's rAF, patch globals, seek an animation or change the rendered DOM.
  const rafObserver = await renderedRuntime.evaluateHandle(root => {
    const frames: RafMotionFrame[] = []
    let request = 0, stopped = false, overflow = false
    const visit = (element: Element, path: string, nodes: RafMotionNode[]) => {
      const inlineTransform = element instanceof HTMLElement || element instanceof SVGElement ? element.style.transform : ''
      const rotations = [...inlineTransform.matchAll(/rotate([XYZ])\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(deg|rad|turn)\s*\)/gi)]
      if (rotations.length) {
        const angles: RotationAxes = { x: 0, y: 0, z: 0 }
        for (const rotation of rotations) angles[rotation[1]!.toLowerCase() as keyof RotationAxes]
          += Number(rotation[2]) * (rotation[3]!.toLowerCase() === 'rad' ? 180 / Math.PI : rotation[3]!.toLowerCase() === 'turn' ? 360 : 1)
        nodes.push({ path, inlineTransform, computedTransform: getComputedStyle(element).transform, angles })
      }
      if (element.shadowRoot) Array.from(element.shadowRoot.children).forEach((child, index) => visit(child, `${path}/shadow/${index}`, nodes))
      Array.from(element.children).forEach((child, index) => visit(child, `${path}/${index}`, nodes))
    }
    const sample = (at: number) => {
      if (stopped) return
      const nodes: RafMotionNode[] = []
      visit(root, 'root', nodes)
      frames.push({ at, sampledAt: performance.now(), nodes })
      if (frames.length >= 4096) { overflow = true; return }
      request = requestAnimationFrame(sample)
    }
    request = requestAnimationFrame(sample)
    return { stop() { stopped = true; cancelAnimationFrame(request); return { frames, overflow } } }
  })
  try {
    const snapshots = []
    for (let index = 0; index < 6; index++) {
      // A hidden Electron compositor needs a paint request to advance its frame
      // timeline. Capture an actual frame without seeking or altering animation.
      await run.page.screenshot({ path: join(run.runRoot, `${name}.clock-frame-${index}.png`), clip, animations: 'allow' })
      snapshots.push(await renderedRuntime.evaluate(root => {
        const found = new Set<Animation>()
        const visit = (element: Element) => {
          for (const animation of element.getAnimations()) found.add(animation)
          if (element.shadowRoot) for (const child of element.shadowRoot.children) visit(child)
          for (const child of element.children) visit(child)
        }
        visit(root)
        return { at: performance.now(), animations: [...found].filter(animation => animation.effect instanceof KeyframeEffect
          && animation.effect.getKeyframes().some(frame => typeof frame.transform === 'string')).map(animation => {
          const effect = animation.effect as KeyframeEffect, computed = effect.getComputedTiming()
          return { playState: animation.playState, playbackRate: animation.playbackRate,
            currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
            duration: computed.duration, progress: computed.progress, currentIteration: computed.currentIteration,
            iterations: Number.isFinite(computed.iterations) ? computed.iterations : 'Infinity',
            keyframes: effect.getKeyframes(), targetTransform: effect.target ? getComputedStyle(effect.target).transform : null }
        }) }
      }))
      await run.page.waitForTimeout(160)
    }
    const raf = await rafObserver.evaluate(observer => observer.stop())
    writeFileSync(join(run.runRoot, `${name}.clock-samples.json`), JSON.stringify(snapshots, null, 2))
    writeFileSync(join(run.runRoot, `${name}.raf-samples.json`), JSON.stringify({ requestedPaintCadenceMs: 160, ...raf }, null, 2))
    if (snapshots.every(sample => sample.animations.length === 0)) {
      expect(raf.overflow, 'Motion observation must not silently truncate its frame clock').toBe(false)
      const measurement = measureObservedRafRotation(raf.frames, runtime.runtime.source)
      const evidence = { source: 'actual-preview-raf-dom-transforms' as const, runtimeId: runtime.layerItemId,
        requestedPaintCadenceMs: 160, paintSnapshots: snapshots, ...measurement }
      writeFileSync(join(run.runRoot, `${name}.timing.json`), JSON.stringify(evidence, null, 2))
      return evidence
    }
    expect(snapshots.every(sample => sample.animations.length === 1), 'Motion observer not applicable: expected one stable Web Animation or an observable rAF DOM rotation').toBe(true)
    const first = snapshots[0]!, last = snapshots.at(-1)!, animation = first.animations[0]!
    expect(typeof animation.duration).toBe('number')
    expect(animation.playbackRate).toBeGreaterThan(0)
    for (const sample of snapshots) {
      expect(sample.animations[0]).toMatchObject({ playState: 'running', playbackRate: animation.playbackRate, duration: animation.duration })
      expect(typeof sample.animations[0]!.currentTime).toBe('number')
    }
    const observedClockRate = (last.animations[0]!.currentTime! - animation.currentTime!) / (last.at - first.at)
    expect(observedClockRate).toBeGreaterThan(animation.playbackRate * .8)
    expect(observedClockRate).toBeLessThan(animation.playbackRate * 1.2)
    expect(new Set(snapshots.map(sample => sample.animations[0]!.targetTransform)).size).toBeGreaterThan(3)
    const evidence = { source: 'actual-preview-web-animations' as const, runtimeId: runtime.layerItemId,
      effectivePeriodMs: (animation.duration as number) / animation.playbackRate, observedClockRate, snapshots }
    writeFileSync(join(run.runRoot, `${name}.timing.json`), JSON.stringify(evidence, null, 2))
    await run.page.screenshot({ path: join(run.runRoot, `${name}.png`), clip, animations: 'allow' })
    return evidence
  } finally {
    await rafObserver.evaluate(observer => observer.stop()).catch(() => {})
    await rafObserver.dispose()
    await overlay.getByRole('button', { name: '关闭预览', exact: true }).click()
  }
}

export function assertObservedRuntimeSlower(before: Awaited<ReturnType<typeof observeRuntimeTiming>>, after: Awaited<ReturnType<typeof observeRuntimeTiming>>) {
  expect(after.runtimeId).toBe(before.runtimeId)
  expect(after.source, 'Different motion implementations require an explicitly matched observer').toBe(before.source)
  if (before.source === 'actual-preview-canvas-painted-quadrilaterals' && after.source === 'actual-preview-canvas-painted-quadrilaterals') return compareCanvasMotion(before, after)
  if (before.source === 'actual-preview-web-animations' && after.source === 'actual-preview-web-animations') {
    expect(after.effectivePeriodMs, 'The actual running animation must take longer per cycle').toBeGreaterThan(before.effectivePeriodMs)
    return { status: 'passed', mechanism: before.source, beforePeriodMs: before.effectivePeriodMs, afterPeriodMs: after.effectivePeriodMs,
      periodRatio: after.effectivePeriodMs / before.effectivePeriodMs }
  }
  if (before.source !== 'actual-preview-raf-dom-transforms' || after.source !== 'actual-preview-raf-dom-transforms') throw new Error('Motion mechanisms were not matched')
  expect(after.requestedPaintCadenceMs).toBe(before.requestedPaintCadenceMs)
  expect(after.clock).toBe(before.clock)
  expect(after.frameDeltaCapMs, 'Compare the same declared animation time scale').toBe(before.frameDeltaCapMs)
  expect(after.angularSpeedDegreesPerSecond, 'The actual unwrapped DOM rotation must advance more slowly').toBeLessThan(before.angularSpeedDegreesPerSecond)
  return { status: 'passed', mechanism: before.source, clock: before.clock, frameDeltaCapMs: before.frameDeltaCapMs,
    requestedPaintCadenceMs: before.requestedPaintCadenceMs, beforeDegreesPerSecond: before.angularSpeedDegreesPerSecond,
    afterDegreesPerSecond: after.angularSpeedDegreesPerSecond, speedRatio: after.angularSpeedDegreesPerSecond / before.angularSpeedDegreesPerSecond,
    beforeWallDegreesPerSecond: before.wallAngularSpeedDegreesPerSecond, afterWallDegreesPerSecond: after.wallAngularSpeedDegreesPerSecond,
    beforeFrameCount: before.frameCount, afterFrameCount: after.frameCount, interpretation: before.clockExplanation }
}

export async function sampleRuntimeMotion(run: NativeRun, runtime: RuntimeLayerItem, name: string) {
  const { overlay, clip } = await openRuntimePreview(run, runtime)
  const samples: Array<{ at: number; file: string; pixels: Buffer }> = []
  try {
    for (let index = 0; index < 24; index++) {
      const file = join(run.runRoot, `${name}.frame-${String(index).padStart(2, '0')}.png`)
      const started = performance.now()
      const png = await run.page.screenshot({ path: file, clip, animations: 'allow' })
      const pixels = await sharp(png).resize(160, 160, { fit: 'fill' }).removeAlpha().raw().toBuffer()
      samples.push({ at: (started + performance.now()) / 2, file, pixels })
      await run.page.waitForTimeout(80)
    }
    const differences = samples.slice(1).map((sample, index) => {
      const previous = samples[index]!
      let sum = 0
      for (let pixel = 0; pixel < sample.pixels.length; pixel++) sum += Math.abs(sample.pixels[pixel]! - previous.pixels[pixel]!)
      return { elapsedMs: sample.at - previous.at, meanAbsoluteDelta: sum / sample.pixels.length }
    })
    const deltaPerSecond = differences.reduce((total, value) => total + value.meanAbsoluteDelta, 0)
      / differences.reduce((total, value) => total + value.elapsedMs / 1000, 0)
    expect(differences.filter(value => value.meanAbsoluteDelta > .3).length, 'A static fallback cannot satisfy continuous animation').toBeGreaterThan(16)
    await sharp({ create: { width: 960, height: 640, channels: 3, background: '#f3f4f6' } })
      .composite(await Promise.all(samples.map(async (sample, index) => ({ input: await sharp(sample.file).resize(160, 160, { fit: 'contain', background: '#f3f4f6' }).png().toBuffer(),
        left: index % 6 * 160, top: Math.floor(index / 6) * 160 })))).png().toFile(join(run.runRoot, `${name}.filmstrip.png`))
    const evidence = { clip, visualReview: 'Review chronological rendered frames to confirm cube shape and speed; pixel motion alone does not prove semantic correctness', samples: samples.map(({ pixels: _pixels, ...sample }) => sample), differences, deltaPerSecond }
    writeFileSync(join(run.runRoot, `${name}.motion.json`), JSON.stringify(evidence, null, 2))
    return evidence
  } finally { await overlay.getByRole('button', { name: '关闭预览', exact: true }).click() }
}
