import { createControllerFixture } from '../fixtures/teacherController'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { z } from 'zod'
import { chromium, expect, type Locator } from '@playwright/test'
import type { CourseProjectDocument, FlowBlock, FlowSurfaceDocument, RuntimeLayerItem, SlideSurfaceDocument, SpatialSurfaceDocument } from '../../src/shared/courseProjectTypes'
import { localAgentRecordV2Schema, type LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { materialRecordV1Schema } from '../../src/shared/materialContract'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { createShapeNode, } from '../../src/renderer/project/nativeNodeFactories'
import { createCourseProjectArchive, type CourseProjectArchiveData } from '../../src/renderer/project/courseProjectArchive'
import { addCourseFlowPage, addCourseSlidePage, addCourseSpatialPage } from '../../src/renderer/course/courseLocationCommands'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { FIXTURE_IDS, nativeRecords, readSaved, recordEvidence, saveStage, titleItem, verifyGreenImage, writeNativeLesson, type NativeCli, type NativeRun, type NativeTextItem } from './r18NativeAuthoringFixture'

export const REMAINING_IDS = Object.freeze({ paragraphOne: 'remaining-flow-first', paragraphTwo: 'remaining-flow-second',
  spatialObject: 'remaining-spatial-object', brokenRuntime: 'remaining-click-runtime' })
export const REMAINING_PROMPTS = Object.freeze({
  T03: '只把红色部分改绿，其他保持。',
  T08Plan: '先给我调整方案，不改课件', T08Apply: '按这个改',
  T09Flow: '缩短第二段', T09Spatial: '移到镜头中央',
  T10: '这个按钮点了没反应，检查并修好。',
  T11Ask: '先问我标题要改成什么，等我回答后再修改。',
  T11Answer: '标题改成“波动的秘密”，只改文字。',
  T11Start: '为这一页设计并制作一个展示弹簧振子的连续动画，先说明你的做法，再完成制作并检查运行效果。',
  T11Supplement: '补充：请保持现有标题和图片不变，动画放在右侧。',
  T12Preview: '把标题改成“保存与恢复验证”，只改文字。',
  T12Resume: '继续。当前标题是什么？先别修改。',
  T050Generate: '根据已引用的“分数含义基准材料”，在当前空白演示页做一页简洁讲解：标题“认识分数”，正文完整使用材料原文，全部文字可以直接编辑。只改当前页。',
  T050Continue: '把这一页的标题文字改为“平均分与分数”，保留正文、位置和其他内容。',
})
// Source material only. The new scene is empty: no generated answer, title,
// candidate or implementation is preloaded into the lesson or native session.
export const MATERIAL_FIXTURE = Object.freeze({
  blankPageName: '材料练习空白页', title: '分数含义基准材料', locator: 'r18-050 固定工程材料',
  text: '分数表示把一个整体平均分成若干份，取其中的一份或几份。',
  initialTitle: '认识分数', revisedTitle: '平均分与分数',
})
export const FIRST_PARAGRAPH = '摆锤在重力作用下往复运动。我们可以用平衡位置、振幅和周期描述它的运动。'
export const SECOND_PARAGRAPH = '为了测量摆锤往复运动一次需要的时间，我们先观察摆锤经过平衡位置的时刻，再连续记录十次完整往复运动的总时间。把测得的总时间除以十，就可以估算摆锤的周期。多测几组并比较结果，可以减少一次计时带来的误差，使记录更加可靠。'
export const MANUAL_AFTER_AI = '教师后续手工文字：这一版必须保留'

// Deliberately authored broken lesson content, not a mocked host or repair hint.
// A real click does nothing because this DOM event name never fires on a click.
const BROKEN_BUTTON_SOURCE = `CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){
  var box=document.createElement('section');
  box.style.cssText='position:absolute;left:32px;top:28px;width:440px;padding:18px;background:#eef2ff;border:2px solid #334155;border-radius:16px;font:24px Microsoft YaHei,sans-serif;color:#172554';
  var button=document.createElement('button');button.textContent='显示答案';
  button.style.cssText='font:inherit;padding:10px 24px;background:#2563eb;color:white;border:0;border-radius:10px;cursor:pointer';
  var answer=document.createElement('p');answer.textContent='答案尚未显示';
  var showAnswer=function(){answer.textContent='正确答案：周期是完成一次往复运动所用的时间。'};
  button.addEventListener('doubleclick',showAnswer);box.append(button,answer);ctx.dom.overlay.appendChild(box);
  return{destroy(){button.removeEventListener('doubleclick',showAnswer);box.remove()}};
}})`

export function flowSurface(document: CourseProjectDocument): FlowSurfaceDocument {
  const surface = document.surfaces.find((item): item is FlowSurfaceDocument => item.type === 'flow')
  if (!surface) throw new Error('The real Flow surface is missing')
  return surface
}
export function spatialSurface(document: CourseProjectDocument): SpatialSurfaceDocument {
  const surface = document.surfaces.find((item): item is SpatialSurfaceDocument => item.type === 'spatial-2d')
  if (!surface) throw new Error('The real Spatial surface is missing')
  return surface
}
export function materialSlide(document: CourseProjectDocument, surfaceId: string): SlideSurfaceDocument {
  const surface = document.surfaces.find(item => item.id === surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('The material task must keep its original Slide surface identity')
  return surface
}
export function materialTexts(document: CourseProjectDocument, surfaceId: string): NativeTextItem[] {
  return materialSlide(document, surfaceId).scenes.flatMap(scene => scene.layerItems)
    .filter((item): item is NativeTextItem => item.kind === 'native' && item.content.nativeType === 'text')
}
export function expectMaterialBody(document: CourseProjectDocument, surfaceId: string): void {
  const text = materialTexts(document, surfaceId).map(item => item.content.data.text).join('')
  expect(text.replace(/\s+/g, '')).toContain(MATERIAL_FIXTURE.text.replace(/\s+/g, ''))
}
export function flowParagraph(document: CourseProjectDocument, id: string): Extract<FlowBlock, { type: 'paragraph' }> {
  const block = flowSurface(document).blocks.find(item => item.id === id)
  if (!block || block.type !== 'paragraph') throw new Error(`The paragraph identity was not retained: ${id}`)
  return block
}
export function buttonRuntime(document: CourseProjectDocument): RuntimeLayerItem {
  const item = document.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : [])
    .find(item => item.layerItemId === REMAINING_IDS.brokenRuntime)
  if (!item || item.kind !== 'runtime') throw new Error('The existing button Runtime identity was lost')
  return item
}

export interface RemainingFlowResume {
  sourceRoot: string
  projectPath: string
  profilePath: string
  executionProfilePath?: string
  original: CourseProjectArchiveData
  current: CourseProjectArchiveData
  record: LocalAgentRecordV2
  historyFiles: Array<{ path: string; bytes: Buffer }>
  phase: 'after-Flow' | 'after-recovered-Flow' | 'after-reviewed-T08-and-Flow' | 'after-Spatial-observation-fix' | 'after-Spatial-success' | 'after-failed-T10' | 'after-T11' | 'after-T11-queued-cancelled'
  /** Save As has a different WorkspaceIdentity, so a later native turn starts
   * a fresh CLI session. All other retained checkpoints keep their real one. */
  reuseNativeSession?: boolean
  requiresFreshFlowFeedback?: boolean
  previousExternalSessionId?: string
  continuationRoot?: string
  reusedT08Root?: string
  previousFlowFailureRoot?: string
  previousFailureRoot?: string
  previousFailedCommitIds?: string[]
  spatialCompletedRoot?: string
  failedT10Root?: string
  failedT10CommitIds?: string[]
  t11ProgressRoot?: string
  /** The preceding native turn was stopped after only a queued supplement.
   * Its delivery must be retried and observed rather than represented as
   * consumed by the earlier run. */
  t11QueuedCancelledRoot?: string
  t11QueuedCancelledRecordId?: string
  requiresQueuedSupplementCompletion?: boolean
  unresolvedQuestionRecordId?: string
  cancelledT12RecordId?: string
  t11AutoHeightChange?: { before: number; after: number }
}

type RemainingSelection = { cli: NativeCli; slot: number; model: string; effort: string; gate: string }
type NativeHistoryFile = { path: string; bytes: Buffer }

function samePath(left: string, right: string) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

function contained(root: string, candidate: string) {
  const path = relative(resolve(root), resolve(candidate))
  return path !== '..' && !path.startsWith('..\\') && !path.startsWith('../') && !isAbsolute(path)
}

function nativeHistoryFiles(profilePath: string): NativeHistoryFile[] {
  const root = join(profilePath, 'local-agent', 'v2')
  if (!existsSync(root)) throw new Error(`The native history root is missing: ${root}`)
  const files: NativeHistoryFile[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && /^[a-f0-9-]{36}(?:\.display)?\.json$/i.test(entry.name)) files.push({ path, bytes: readFileSync(path) })
    }
  }
  visit(root)
  return files
}

function nativeRecordsFromEvidence(path: string): LocalAgentRecordV2[] {
  const evidence = JSON.parse(readFileSync(path, 'utf8')) as { records?: unknown[] }
  if (!Array.isArray(evidence.records)) throw new Error(`Native evidence has no records: ${path}`)
  return evidence.records.map(record => localAgentRecordV2Schema.parse(record))
}

function persistedRecord(historyFiles: NativeHistoryFile[], record: LocalAgentRecordV2, description: string): void {
  const persisted = historyFiles.find(file => file.path.endsWith(`${record.id}.json`))
  if (!persisted) throw new Error(`${description} is missing from durable native history`)
  expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(record)
}

/** The first remaining attempt stopped before any Spatial model call because
 * the driver clicked a pointer-events:none drawing layer. Reuse only the real
 * completed T03/T08/Flow prefix and its unmodified saved project. */
export async function loadRemainingFlowResume(productRoot: string, source: string,
  selected: { cli: NativeCli; slot: number; model: string; effort: string; gate: string },
  spatialFailure?: string, spatialCompleted?: string, failedT10?: string, afterT11?: string): Promise<RemainingFlowResume> {
  if (afterT11 && !failedT10) throw new Error('An after-T11 continuation requires its actual earlier failed T10 evidence')
  if (failedT10 && !spatialCompleted) throw new Error('A failed T10 continuation requires its completed Spatial evidence')
  const sourceRoot = realpathSync(resolve(source)), evidenceRoot = realpathSync(join(productRoot, 'output', 'r18-native-authoring-remaining'))
  expect(resolve(sourceRoot, '..').toLowerCase()).toBe(evidenceRoot.toLowerCase())
  const manifest = JSON.parse(readFileSync(join(sourceRoot, 'run.json'), 'utf8'))
  expect(manifest.selected).toEqual(selected)
  expect(manifest.prompts).toEqual(REMAINING_PROMPTS)
  expect(manifest.status).toBe('failed')
  expect(manifest.failure).toContain('spatial-stage-stack')
  expect(manifest.failure).toContain('intercepts pointer events')
  expect(resolve(manifest.productRoot).toLowerCase()).toBe(resolve(productRoot).toLowerCase())
  expect(resolve(manifest.runRoot).toLowerCase()).toBe(sourceRoot.toLowerCase())
  const projectPath = realpathSync(join(sourceRoot, 'remaining.h5lesson')), profilePath = realpathSync(join(sourceRoot, 'profile'))
  expect(resolve(manifest.projectPath).toLowerCase()).toBe(projectPath.toLowerCase())
  expect(existsSync(join(sourceRoot, 'T09-spatial.input.json')), 'Never repeat a paid Spatial request through this checkpoint').toBe(false)
  const original = readSaved(join(sourceRoot, '00-original.h5lesson')), t03 = readSaved(join(sourceRoot, 'T03.h5lesson'))
  await verifyGreenImage(original, t03)
  expect(titleItem(t03.project)).toEqual(titleItem(original.project))
  expect(buttonRuntime(t03.project)).toEqual(buttonRuntime(original.project))
  const plan = JSON.parse(readFileSync(join(sourceRoot, 'T08-plan-visible.review.json'), 'utf8'))
  expect(plan.text.length).toBeGreaterThan(30)
  expect(plan.text).toMatch(/方案|调整|建议|标题|字号|居中/)
  expect(readSaved(join(sourceRoot, 'T08-plan-zero-write.h5lesson'))).toEqual(t03)
  const applied = readSaved(join(sourceRoot, 'T08-applied.h5lesson'))
  expect(titleItem(applied.project)).not.toEqual(titleItem(t03.project))
  const current = readSaved(join(sourceRoot, 'T09-flow.h5lesson'))
  if (!spatialFailure) expect(readSaved(projectPath), 'Continue the already saved Flow result, without restoration or replay').toEqual(current)
  const paragraph = flowParagraph(current.project, REMAINING_IDS.paragraphTwo)
  expect(paragraph.text.length).toBeLessThan(SECOND_PARAGRAPH.length * .8)
  expect(paragraph.text).toMatch(/周期/)
  expect(paragraph.text).toMatch(/往复|计时|时间/)
  // Regression guard for the observed physical error. Full text and image
  // review remains the semantic acceptance evidence.
  expect(paragraph.text).toMatch(/(?:十次完整往复(?:运动)?|十个周期)[\s\S]{0,60}总时间[\s\S]{0,60}除以\s*(?:十|10)/)
  expect(flowParagraph(current.project, REMAINING_IDS.paragraphOne)).toEqual(flowParagraph(applied.project, REMAINING_IDS.paragraphOne))
  expect(flowSurface(current.project).blocks.map(block => block.id)).toEqual(flowSurface(applied.project).blocks.map(block => block.id))
  expect(spatialSurface(current.project)).toEqual(spatialSurface(applied.project))
  for (const name of ['T03.png', 'T08-plan-visible.png', 'T08-applied.png', 'T09-flow.png', 'T09-flow-controls.png']) expect(existsSync(join(sourceRoot, name))).toBe(true)
  const historyFiles: RemainingFlowResume['historyFiles'] = []
  const recordsRoot = join(profilePath, 'local-agent', 'v2')
  for (const workspace of readdirSync(recordsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const directory = join(recordsRoot, workspace.name)
    for (const entry of readdirSync(directory, { withFileTypes: true }).filter(value => value.isFile() && /^[a-f0-9-]{36}(?:\.display)?\.json$/i.test(value.name))) {
      const path = join(directory, entry.name)
      historyFiles.push({ path, bytes: readFileSync(path) })
    }
  }
  let nativeId: string | null = null, finalRecord: LocalAgentRecordV2 | undefined
  for (const [stage, goal, archive] of [['T03', REMAINING_PROMPTS.T03, t03], ['T08-plan', REMAINING_PROMPTS.T08Plan, t03],
    ['T08-apply-plan', REMAINING_PROMPTS.T08Apply, applied], ['T09-flow', REMAINING_PROMPTS.T09Flow, current]] as const) {
    const evidence = JSON.parse(readFileSync(join(sourceRoot, `${stage}.native.json`), 'utf8'))
    const records = (evidence.records as unknown[]).map(value => localAgentRecordV2Schema.parse(value))
    const record = records.find(value => value.tasks.at(-1)?.goal === goal && value.tasks.at(-1)?.status === 'completed')
    if (!record) throw new Error(`No actual completed native record for ${stage}`)
    confirmConfiguration(record, selected.cli, selected.model, selected.effort)
    nativeId ??= record.externalSessionId
    expect(record.externalSessionId).toBe(nativeId)
    expect(record.workspace.normalizedPath).toBe(projectPath.replace(/\\/g, '/').toLowerCase())
    if (stage === 'T08-plan') { expect(record.tasks.at(-1)?.intent).toBe('plan'); expect(committed(record)).toHaveLength(0) }
    else expect(committed(record).at(-1)?.afterRevision).toBe(archive.project.revision)
    const persisted = historyFiles.find(file => file.path.endsWith(`${record.id}.json`))
    if (!persisted) throw new Error(`${stage} native history is missing from its original profile`)
    expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(record)
    finalRecord = record
  }
  if (spatialFailure) {
    const failureRoot = realpathSync(resolve(spatialFailure))
    expect(resolve(failureRoot, '..').toLowerCase()).toBe(join(sourceRoot, 'attempts').toLowerCase())
    const failure = JSON.parse(readFileSync(join(failureRoot, 'run.json'), 'utf8'))
    expect(failure.selected).toEqual(selected); expect(failure.prompts).toEqual(REMAINING_PROMPTS)
    expect(failure.status).toBe('failed'); expect(failure.continuation.phase).toBe('after-Flow')
    expect(resolve(failure.continuation.from).toLowerCase()).toBe(sourceRoot.toLowerCase())
    expect(failure.failure).toContain('toBeLessThan')
    expect(existsSync(join(failureRoot, 'T10.input.json')), 'This continuation cannot repeat a paid T10 request').toBe(false)
    expect(JSON.parse(readFileSync(join(failureRoot, 'T09-spatial.input.json'), 'utf8')).prompt).toBe(REMAINING_PROMPTS.T09Spatial)
    const failedArchive = readSaved(join(failureRoot, 'T09-spatial.h5lesson'))
    if (!spatialCompleted) expect(readSaved(projectPath), 'Keep both actual failed Spatial commits and continue from the actual saved result').toEqual(failedArchive)
    const failedSurface = spatialSurface(failedArchive.project)
    const failedItem = failedSurface.world.layerItems.find(item => item.layerItemId === REMAINING_IDS.spatialObject)!
    const unchanged = structuredClone(failedArchive)
    unchanged.project.revision = current.project.revision
    expect(Date.parse(failedArchive.project.updatedAt)).toBeGreaterThan(Date.parse(current.project.updatedAt))
    unchanged.project.updatedAt = current.project.updatedAt
    spatialSurface(unchanged.project).world.layerItems.find(item => item.layerItemId === REMAINING_IDS.spatialObject)!.frame =
      structuredClone(spatialSurface(current.project).world.layerItems.find(item => item.layerItemId === REMAINING_IDS.spatialObject)!.frame)
    expect(unchanged).toEqual(current)
    expect(Math.abs(failedItem.frame.x + failedItem.frame.width / 2 - failedSurface.camera.home.x)).toBeGreaterThan(2)
    const failedRecords = JSON.parse(readFileSync(join(failureRoot, 'T09-spatial.native.json'), 'utf8')).records.map((value: unknown) => localAgentRecordV2Schema.parse(value)) as LocalAgentRecordV2[]
    const failedRecord = failedRecords.find(record => record.tasks.at(-1)?.goal === REMAINING_PROMPTS.T09Spatial && record.tasks.at(-1)?.status === 'completed')
    if (!failedRecord) throw new Error('No actual completed Spatial failure record')
    confirmConfiguration(failedRecord, selected.cli, selected.model, selected.effort)
    expect(failedRecord.externalSessionId).toBe(nativeId)
    const receipts = committed(failedRecord)
    expect(receipts.map(receipt => [receipt.beforeRevision, receipt.afterRevision])).toEqual([
      [current.project.revision, current.project.revision + 1], [current.project.revision + 1, failedArchive.project.revision],
    ])
    const persisted = historyFiles.find(file => file.path.endsWith(`${failedRecord.id}.json`))
    if (!persisted) throw new Error('The actual failed Spatial native history is missing')
    expect(localAgentRecordV2Schema.parse(JSON.parse(persisted.bytes.toString('utf8')))).toEqual(failedRecord)
    const resumed: RemainingFlowResume = { sourceRoot, projectPath, profilePath, original, current: failedArchive, record: failedRecord, historyFiles,
      phase: 'after-Spatial-observation-fix', previousFailureRoot: failureRoot, previousFailedCommitIds: receipts.map(receipt => receipt.candidateId) }
    if (spatialCompleted) {
      const completedRoot = realpathSync(resolve(spatialCompleted))
      expect(resolve(completedRoot, '..').toLowerCase()).toBe(join(sourceRoot, 'attempts').toLowerCase())
      const completedManifest = JSON.parse(readFileSync(join(completedRoot, 'run.json'), 'utf8'))
      expect(completedManifest.selected).toEqual(selected); expect(completedManifest.prompts).toEqual(REMAINING_PROMPTS)
      expect(completedManifest.status).toBe('failed'); expect(completedManifest.continuation.phase).toBe('after-Spatial-observation-fix')
      expect(completedManifest.failure).toContain('data-canvas-runtime-phaser')
      expect(completedManifest.failure).toContain('intercepts pointer events')
      expect(completedManifest.existingHistoryPreserved).toBe(true)
      expect(existsSync(join(completedRoot, 'T10.input.json')), 'This checkpoint is before the first paid T10 request').toBe(false)
      const centered = readSaved(join(completedRoot, 'T09-spatial.h5lesson'))
      if (!failedT10) expect(readSaved(projectPath), 'Continue the saved successful Spatial result without restoration').toEqual(centered)
      const cameraEvidence = JSON.parse(readFileSync(join(completedRoot, 'T09-spatial-current-camera.json'), 'utf8'))
      const centeredItem = spatialSurface(centered.project).world.layerItems.find(item => item.layerItemId === REMAINING_IDS.spatialObject)!
      expect(Math.abs(centeredItem.frame.x + centeredItem.frame.width / 2 - cameraEvidence.camera.x)).toBeLessThan(2)
      expect(Math.abs(centeredItem.frame.y + centeredItem.frame.height / 2 - cameraEvidence.camera.y)).toBeLessThan(2)
      expect(centeredItem.frame.width).toBe(failedItem.frame.width); expect(centeredItem.frame.height).toBe(failedItem.frame.height)
      const withoutMove = structuredClone(centered)
      withoutMove.project.revision = failedArchive.project.revision; withoutMove.project.updatedAt = failedArchive.project.updatedAt
      spatialSurface(withoutMove.project).world.layerItems.find(item => item.layerItemId === REMAINING_IDS.spatialObject)!.frame = structuredClone(failedItem.frame)
      expect(withoutMove).toEqual(failedArchive)
      const completedRecords = JSON.parse(readFileSync(join(completedRoot, 'T09-spatial.native.json'), 'utf8')).records.map((value: unknown) => localAgentRecordV2Schema.parse(value)) as LocalAgentRecordV2[]
      const completedRecord = completedRecords.find(record => record.tasks.at(-1)?.goal === REMAINING_PROMPTS.T09Spatial
        && record.tasks.at(-1)?.status === 'completed' && committed(record).at(-1)?.afterRevision === centered.project.revision)
      if (!completedRecord) throw new Error('Missing the actual completed Spatial native record')
      confirmConfiguration(completedRecord, selected.cli, selected.model, selected.effort)
      expect(completedRecord.externalSessionId).toBe(nativeId)
      expect(committed(completedRecord).map(receipt => [receipt.beforeRevision, receipt.afterRevision])).toEqual([[failedArchive.project.revision, centered.project.revision]])
      const savedRecord = historyFiles.find(file => file.path.endsWith(`${completedRecord.id}.json`))
      if (!savedRecord) throw new Error('Completed Spatial native history is missing')
      expect(localAgentRecordV2Schema.parse(JSON.parse(savedRecord.bytes.toString('utf8')))).toEqual(completedRecord)
      for (const name of ['T09-spatial-visible.png', 'T09-spatial-controls.png']) expect(existsSync(join(completedRoot, name))).toBe(true)
      const afterSpatial: RemainingFlowResume = { ...resumed, current: centered, record: completedRecord,
        phase: 'after-Spatial-success', spatialCompletedRoot: completedRoot }
      if (!failedT10) return afterSpatial
      const failedT10Root = realpathSync(resolve(failedT10))
      expect(resolve(failedT10Root, '..').toLowerCase()).toBe(join(sourceRoot, 'attempts').toLowerCase())
      const failedT10Manifest = JSON.parse(readFileSync(join(failedT10Root, 'run.json'), 'utf8'))
      expect(failedT10Manifest.selected).toEqual(selected); expect(failedT10Manifest.prompts).toEqual(REMAINING_PROMPTS)
      expect(failedT10Manifest.status).toBe('failed'); expect(failedT10Manifest.continuation.phase).toBe('after-Spatial-success')
      expect(resolve(failedT10Manifest.continuation.from).toLowerCase()).toBe(sourceRoot.toLowerCase())
      expect(resolve(failedT10Manifest.continuation.spatialCompletedRoot).toLowerCase()).toBe(completedRoot.toLowerCase())
      expect(failedT10Manifest.failure).toContain('data-canvas-runtime-phaser')
      expect(failedT10Manifest.failure).toContain('intercepts pointer events')
      expect(failedT10Manifest.existingHistoryPreserved).toBe(true)
      expect(existsSync(join(failedT10Root, 'T11-question.input.json')), 'Do not repeat a paid T11 through this checkpoint').toBe(false)
      expect(JSON.parse(readFileSync(join(failedT10Root, 'T10.input.json'), 'utf8')).prompt).toBe(REMAINING_PROMPTS.T10)
      const failedT10Archive = readSaved(join(failedT10Root, 'T10-repaired.h5lesson'))
      expect(failedT10Archive.project.revision).toBe(11)
      if (!afterT11) expect(readSaved(projectPath), 'Retain both actual failed T10 commits; never restore the earlier fixture').toEqual(failedT10Archive)
      expect(JSON.parse(readFileSync(join(failedT10Root, 'T10-repaired.project.json'), 'utf8'))).toEqual(failedT10Archive.project)
      expect(buttonRuntime(failedT10Archive.project).runtime.source).not.toBe(buttonRuntime(centered.project).runtime.source)
      const beforeFailedSource = structuredClone(failedT10Archive)
      beforeFailedSource.project.revision = centered.project.revision; beforeFailedSource.project.updatedAt = centered.project.updatedAt
      buttonRuntime(beforeFailedSource.project).runtime.source = buttonRuntime(centered.project).runtime.source
      expect(beforeFailedSource).toEqual(centered)
      const t10Records = JSON.parse(readFileSync(join(failedT10Root, 'T10.native.json'), 'utf8')).records
        .map((value: unknown) => localAgentRecordV2Schema.parse(value)) as LocalAgentRecordV2[]
      const t10Record = t10Records.find(record => record.tasks.at(-1)?.goal === REMAINING_PROMPTS.T10
        && record.tasks.at(-1)?.status === 'completed' && committed(record).at(-1)?.afterRevision === failedT10Archive.project.revision)
      if (!t10Record) throw new Error('The actual native record of the failed T10 repair is missing')
      confirmConfiguration(t10Record, selected.cli, selected.model, selected.effort)
      expect(t10Record.externalSessionId).toBe(nativeId); expect(t10Record.workspace).toEqual(completedRecord.workspace)
      expect(t10Record.workingDirectoryId).toBe(completedRecord.workingDirectoryId)
      const t10Commits = committed(t10Record)
      expect(t10Commits.map(receipt => [receipt.beforeRevision, receipt.afterRevision])).toEqual([[9, 10], [10, 11]])
      const t10Persisted = historyFiles.find(file => file.path.endsWith(`${t10Record.id}.json`))
      if (!t10Persisted) throw new Error('The original failed T10 native history is missing')
      expect(localAgentRecordV2Schema.parse(JSON.parse(t10Persisted.bytes.toString('utf8')))).toEqual(t10Record)
      for (const name of ['T10-broken-before-click.png', 'T10-broken-after-click.png', 'T10-repaired-before-click.png']) {
        expect(existsSync(join(failedT10Root, name))).toBe(true)
      }
      const afterFailedT10: RemainingFlowResume = { ...afterSpatial, current: failedT10Archive, record: t10Record, phase: 'after-failed-T10',
        failedT10Root, failedT10CommitIds: t10Commits.map(receipt => receipt.candidateId) }
      return afterT11 ? loadRemainingAfterT11(afterFailedT10, afterT11, selected) : afterFailedT10
    }
    return resumed
  }
  return { sourceRoot, projectPath, profilePath, original, current, record: finalRecord!, historyFiles, phase: 'after-Flow' }
}

/** A failed OpenCode Flow capture did commit revision 6. The operator then used
 * the actual recovery UI, Save As, and reopen path without sending a model
 * message. That created a new WorkspaceIdentity, so this checkpoint protects
 * the old partial record as evidence but deliberately starts the next native
 * session only when the recovered paragraph is sent again. */
export async function loadRemainingRecoveredFlowResume(productRoot: string, source: string, recovery: string,
  selected: RemainingSelection): Promise<RemainingFlowResume> {
  expect(selected).toEqual({ cli: 'opencode', slot: 1, model: 'openai/gpt-5.6-luna', effort: 'max', gate: 'opencode-once' })
  const sourceRoot = realpathSync(resolve(source))
  const evidenceRoot = realpathSync(join(productRoot, 'output', 'r18-native-authoring-remaining'))
  expect(samePath(resolve(sourceRoot, '..'), evidenceRoot)).toBe(true)
  const recoveryRoot = realpathSync(resolve(recovery))
  expect(samePath(resolve(recoveryRoot, '..'), join(sourceRoot, 'attempts'))).toBe(true)

  const sourceManifest = JSON.parse(readFileSync(join(sourceRoot, 'run.json'), 'utf8'))
  expect(sourceManifest.selected).toEqual(selected)
  expect(sourceManifest.prompts).toEqual(REMAINING_PROMPTS)
  expect(sourceManifest.status).toBe('failed')
  expect(sourceManifest.failure).toContain('T09-flow')
  expect(sourceManifest.failure).toContain('观察待同步')
  expect(samePath(sourceManifest.productRoot, productRoot)).toBe(true)
  expect(samePath(sourceManifest.runRoot, sourceRoot)).toBe(true)

  const sourceProjectPath = realpathSync(join(sourceRoot, 'remaining.h5lesson'))
  const sourceProfilePath = realpathSync(join(sourceRoot, 'profile'))
  expect(samePath(sourceManifest.projectPath, sourceProjectPath)).toBe(true)
  expect(existsSync(join(sourceRoot, 'T09-spatial.input.json')), 'No Spatial request may be invented before this recovery').toBe(false)
  const original = readSaved(join(sourceRoot, '00-original.h5lesson'))
  const t03 = readSaved(join(sourceRoot, 'T03.h5lesson'))
  await verifyGreenImage(original, t03)
  expect(titleItem(t03.project)).toEqual(titleItem(original.project))
  expect(buttonRuntime(t03.project)).toEqual(buttonRuntime(original.project))
  const planReview = JSON.parse(readFileSync(join(sourceRoot, 'T08-plan-visible.review.json'), 'utf8'))
  expect(planReview.text).toMatch(/方案|调整|建议|标题|字号|居中/)
  expect(planReview.text.length).toBeGreaterThan(30)
  expect(readSaved(join(sourceRoot, 'T08-plan-zero-write.h5lesson'))).toEqual(t03)
  const applied = readSaved(join(sourceRoot, 'T08-applied.h5lesson'))
  expect(titleItem(applied.project)).not.toEqual(titleItem(t03.project))
  // The host committed the Flow result before its observation-sync failure.
  // The normal stage save never ran, so the only truthful persisted result is
  // its recovery copy under the real native profile.
  expect(readSaved(sourceProjectPath)).toEqual(applied)
  const sourceRecoveryPath = realpathSync(join(sourceProfilePath, 'project-data', 'recovery.h5lesson'))
  expect(contained(sourceProfilePath, sourceRecoveryPath)).toBe(true)
  const sourceFlow = readSaved(sourceRecoveryPath)
  const recoveredParagraph = flowParagraph(sourceFlow.project, REMAINING_IDS.paragraphTwo)
  expect(recoveredParagraph.text.length).toBeLessThan(SECOND_PARAGRAPH.length * .8)
  expect(recoveredParagraph.text).toMatch(/周期/)
  expect(recoveredParagraph.text).toMatch(/往复|计时|时间/)
  expect(recoveredParagraph.text).toMatch(/(?:十次完整往复(?:运动)?|十个周期)[\s\S]{0,60}总时间[\s\S]{0,60}除以\s*(?:十|10)/)
  expect(flowParagraph(sourceFlow.project, REMAINING_IDS.paragraphOne)).toEqual(flowParagraph(applied.project, REMAINING_IDS.paragraphOne))
  expect(flowSurface(sourceFlow.project).blocks.map(block => block.id)).toEqual(flowSurface(applied.project).blocks.map(block => block.id))
  expect(spatialSurface(sourceFlow.project)).toEqual(spatialSurface(applied.project))

  const sourceRecords = nativeRecordsFromEvidence(join(sourceRoot, 'failure.native.json'))
  const recordFor = (goal: string, status: 'completed' | 'partial') => {
    const record = sourceRecords.find(value => value.tasks.at(-1)?.goal === goal && value.tasks.at(-1)?.status === status)
    if (!record) throw new Error(`The actual OpenCode record is missing: ${goal} (${status})`)
    confirmConfiguration(record, selected.cli, selected.model, selected.effort)
    return record
  }
  const t03Record = recordFor(REMAINING_PROMPTS.T03, 'completed')
  const t08PlanRecord = recordFor(REMAINING_PROMPTS.T08Plan, 'completed')
  const t08ApplyRecord = recordFor(REMAINING_PROMPTS.T08Apply, 'completed')
  const partialFlowRecord = recordFor(REMAINING_PROMPTS.T09Flow, 'partial')
  const previousExternalSessionId = partialFlowRecord.externalSessionId
  if (!previousExternalSessionId) throw new Error('The partial OpenCode Flow record has no native session identity')
  for (const record of [t03Record, t08PlanRecord, t08ApplyRecord, partialFlowRecord]) {
    expect(record.externalSessionId).toBe(partialFlowRecord.externalSessionId)
    expect(record.workspace.normalizedPath).toBe(sourceProjectPath.replace(/\\/g, '/').toLowerCase())
  }
  expect(t08PlanRecord.tasks.at(-1)?.intent).toBe('plan')
  expect(committed(t08PlanRecord)).toHaveLength(0)
  expect(committed(t03Record).at(-1)?.afterRevision).toBe(t03.project.revision)
  expect(committed(t08ApplyRecord).at(-1)?.afterRevision).toBe(applied.project.revision)
  expect(committed(partialFlowRecord).at(-1)?.afterRevision).toBe(sourceFlow.project.revision)
  const sourceHistory = nativeHistoryFiles(sourceProfilePath)
  for (const record of [t03Record, t08PlanRecord, t08ApplyRecord, partialFlowRecord]) persistedRecord(sourceHistory, record, 'Original OpenCode record')

  const result = JSON.parse(readFileSync(join(recoveryRoot, 'recovery-result.json'), 'utf8'))
  expect(result).toMatchObject({ version: 1, kind: 'remaining-Flow-recovery', status: 'recovered-saved-reopened-zero-model',
    modelCalls: 0, sourceRevision: applied.project.revision, restoredRevision: sourceFlow.project.revision,
    paragraph: recoveredParagraph.text, sourceNativeStatus: 'partial', originalNativeHistoryPreserved: true,
    nativeIdentityContinuity: 'not-claimed-across-save-as', modelCandidateReplayed: false, fixtureRestored: false, ownerAcceptance: false })
  expect(samePath(result.source.runRoot, sourceRoot)).toBe(true)
  expect(samePath(result.source.profilePath, sourceProfilePath)).toBe(true)
  expect(samePath(result.source.projectPath, sourceProjectPath)).toBe(true)
  expect(samePath(result.source.recoveryPath, sourceRecoveryPath)).toBe(true)
  expect(result.source.recordId).toBe(partialFlowRecord.id)
  expect(result.source.externalSessionId).toBe(partialFlowRecord.externalSessionId)

  const projectPath = realpathSync(join(recoveryRoot, 'recovered-Flow.h5lesson'))
  const profilePath = realpathSync(join(recoveryRoot, 'execution-profile'))
  expect(samePath(result.execution.runRoot, recoveryRoot)).toBe(true)
  expect(samePath(result.execution.projectPath, projectPath)).toBe(true)
  expect(samePath(result.execution.profilePath, profilePath)).toBe(true)
  expect(result.workspaceBoundary).toMatchObject({ workspace: {
    projectId: sourceFlow.project.id, normalizedPath: projectPath.replace(/\\/g, '/').toLowerCase(),
  }, records: [] })
  expect(result.workspaceBoundary.workspace.normalizedPath).not.toBe(partialFlowRecord.workspace.normalizedPath)
  const recovered = readSaved(projectPath)
  expect(recovered).toEqual(sourceFlow)
  expect(readSaved(sourceProjectPath)).toEqual(applied)
  const executionHistory = nativeHistoryFiles(profilePath)
  for (const record of [t03Record, t08PlanRecord, t08ApplyRecord, partialFlowRecord]) persistedRecord(executionHistory, record, 'Save As execution copy')

  return { sourceRoot, projectPath, profilePath, original, current: recovered, record: partialFlowRecord,
    historyFiles: [...sourceHistory, ...executionHistory], phase: 'after-recovered-Flow', reuseNativeSession: false,
    requiresFreshFlowFeedback: true, previousExternalSessionId, continuationRoot: recoveryRoot }
}

/** Load only a completed Claude continuation that contains both a real review
 * decision and the first real Flow commit. The current failed clarification
 * roots intentionally do not satisfy this contract. */
export async function loadRemainingPlanContinuation(_productRoot: string, continuation: string,
  selected: RemainingSelection): Promise<RemainingFlowResume> {
  expect(selected).toEqual({ cli: 'claude', slot: 1, model: 'sonnet', effort: 'low', gate: 'claude-once' })
  const continuationRoot = realpathSync(resolve(continuation))
  const manifest = JSON.parse(readFileSync(join(continuationRoot, 'run.json'), 'utf8'))
  expect(manifest).toMatchObject({ version: 1, kind: 'r18-remaining-reviewed-T08-continuation', selected, prompts: REMAINING_PROMPTS,
    status: 'T08-and-Flow-checks-passed-awaiting-result-visual-review',
    originalFailuresRetained: true, automaticPlanApproval: false, noAutomaticRetries: true,
    visibleWindowsAllowed: false, traceEnabled: false, ownerAcceptance: false, existingHistoryPreserved: true })
  expect(samePath(manifest.runRoot, continuationRoot)).toBe(true)
  const checkpoint = manifest.checkpoint
  if (!checkpoint || typeof checkpoint !== 'object') throw new Error('No completed reviewed-T08-and-Flow checkpoint exists')
  expect(checkpoint).toMatchObject({ phase: 'after-reviewed-T08-and-Flow', originalFailuresRetained: true, nativeHistoryRewritten: false })
  expect(samePath(checkpoint.continuationRoot, continuationRoot)).toBe(true)

  const sourceRoot = realpathSync(resolve(checkpoint.sourceRoot))
  const historicalProductRoot = realpathSync(resolve(manifest.productRoot))
  const evidenceRoot = realpathSync(join(historicalProductRoot, 'output', 'r18-native-authoring-remaining'))
  expect(samePath(resolve(sourceRoot, '..'), evidenceRoot)).toBe(true)
  expect(samePath(manifest.sourceRoot, sourceRoot)).toBe(true)
  expect(samePath(checkpoint.reusedT03Root, sourceRoot)).toBe(true)
  expect(samePath(resolve(continuationRoot, '..'), join(sourceRoot, 'attempts'))).toBe(true)
  const projectPath = realpathSync(resolve(checkpoint.projectPath))
  const profilePath = realpathSync(resolve(checkpoint.profilePath))
  const savedPath = realpathSync(resolve(checkpoint.savedPath))
  expect(samePath(projectPath, join(sourceRoot, 'remaining.h5lesson'))).toBe(true)
  expect(samePath(manifest.projectPath, projectPath)).toBe(true)
  expect(samePath(profilePath, join(continuationRoot, 'execution-profile'))).toBe(true)
  expect(samePath(manifest.executionProfilePath, profilePath)).toBe(true)
  expect(samePath(savedPath, join(continuationRoot, 'T09-flow.h5lesson'))).toBe(true)
  expect(typeof checkpoint.finalRecordId).toBe('string')
  expect(typeof checkpoint.externalSessionId).toBe('string')
  expect(checkpoint.externalSessionId.length).toBeGreaterThan(0)
  expect(manifest.nativeExternalSessionId).toBe(checkpoint.externalSessionId)
  const hasFlowCorrection = typeof manifest.previousFlowFailureSource === 'string'
  const reusedT08Root = hasFlowCorrection
    ? realpathSync(resolve(manifest.reusedT08Source))
    : continuationRoot
  expect(samePath(resolve(reusedT08Root, '..'), join(sourceRoot, 'attempts'))).toBe(true)
  if (hasFlowCorrection) {
    expect(samePath(reusedT08Root, continuationRoot)).toBe(false)
    expect(samePath(manifest.previousFlowFailureSource, reusedT08Root)).toBe(true)
    expect(samePath(checkpoint.reusedT08Source, reusedT08Root)).toBe(true)
    expect(samePath(checkpoint.previousFlowFailureSource, reusedT08Root)).toBe(true)
  }
  const reusedT08Manifest = hasFlowCorrection
    ? JSON.parse(readFileSync(join(reusedT08Root, 'run.json'), 'utf8'))
    : manifest
  expect(reusedT08Manifest).toMatchObject({ version: 1, kind: 'r18-remaining-reviewed-T08-continuation', selected,
    status: 'T08-and-Flow-checks-passed-awaiting-result-visual-review', existingT03Reused: true, includeFlow: true })
  expect(samePath(reusedT08Manifest.runRoot, reusedT08Root)).toBe(true)
  expect(samePath(reusedT08Manifest.sourceRoot, sourceRoot)).toBe(true)
  expect(samePath(reusedT08Manifest.projectPath, projectPath)).toBe(true)

  const sourceManifest = JSON.parse(readFileSync(join(sourceRoot, 'run.json'), 'utf8'))
  expect(sourceManifest.selected).toEqual(selected)
  expect(sourceManifest.prompts).toEqual(REMAINING_PROMPTS)
  expect(sourceManifest.status).toBe('failed')
  expect(sourceManifest.failure).toContain('T08-apply-plan: 编辑未完成')
  const original = readSaved(join(sourceRoot, '00-original.h5lesson'))
  const t03 = readSaved(join(sourceRoot, 'T03.h5lesson'))
  await verifyGreenImage(original, t03)
  expect(titleItem(t03.project)).toEqual(titleItem(original.project))
  expect(buttonRuntime(t03.project)).toEqual(buttonRuntime(original.project))
  expect(readSaved(join(sourceRoot, 'T08-plan-zero-write.h5lesson'))).toEqual(t03)
  expect(existsSync(join(sourceRoot, 'T09-flow.input.json')), 'The failed original must not be recast as Flow evidence').toBe(false)
  const sourceHistory = nativeHistoryFiles(realpathSync(join(sourceRoot, 'profile')))
  const sourceRecords = nativeRecordsFromEvidence(join(sourceRoot, 'failure.native.json'))
  const sourceRecordFor = (goal: string) => {
    const record = sourceRecords.find(value => value.tasks.at(-1)?.goal === goal)
    if (!record) throw new Error('Original Claude record is missing: ' + goal)
    confirmConfiguration(record, selected.cli, selected.model, selected.effort)
    expect(record.externalSessionId).toBe(checkpoint.externalSessionId)
    expect(record.workspace.normalizedPath).toBe(projectPath.replace(/\\/g, '/').toLowerCase())
    persistedRecord(sourceHistory, record, 'Original Claude record')
    return record
  }
  const originalPlan = sourceRecordFor(REMAINING_PROMPTS.T08Plan)
  const originalApply = sourceRecordFor(REMAINING_PROMPTS.T08Apply)
  const originalT03 = sourceRecordFor(REMAINING_PROMPTS.T03)
  expect(originalPlan.tasks.at(-1)?.intent).toBe('plan')
  expect(originalPlan.tasks.at(-1)?.status).toBe('completed')
  expect(committed(originalPlan)).toHaveLength(0)
  expect(originalApply.tasks.at(-1)?.status).toBe('failed')
  expect(committed(originalApply)).toHaveLength(0)
  expect(committed(originalT03).at(-1)?.afterRevision).toBe(t03.project.revision)
  expect(reusedT08Manifest.previousPlanRecordId).toBe(originalPlan.id)
  expect(reusedT08Manifest.previousApplyRecordId).toBe(originalApply.id)

  // Preserve the rejected plan retry as evidence, but do not treat it as the
  // reviewed source. The actual reviewed reply came from the later read-only
  // conversation whose intent was recorded as discuss.
  const clarificationRoot = realpathSync(resolve(reusedT08Manifest.clarificationRoot))
  expect(samePath(resolve(clarificationRoot, '..'), join(sourceRoot, 'attempts'))).toBe(true)
  const clarificationManifest = JSON.parse(readFileSync(join(clarificationRoot, 'run.json'), 'utf8'))
  expect(clarificationManifest.selected).toEqual(selected)
  expect(clarificationManifest.status).toBe('failed')
  expect(clarificationManifest.failure).toContain('Actual plan was not approved:')
  expect(samePath(clarificationManifest.projectPath, projectPath)).toBe(true)
  expect(readSaved(join(clarificationRoot, 'T08-plan-zero-write.h5lesson'))).toEqual(t03)
  expect(existsSync(join(clarificationRoot, 'T09-flow.input.json')), 'The rejected clarification cannot become a successful Flow checkpoint').toBe(false)
  const rejectedPending = JSON.parse(readFileSync(join(clarificationRoot, 'T08-plan-review.pending.json'), 'utf8'))
  const rejectedAnswer = JSON.parse(readFileSync(join(clarificationRoot, 'T08-plan-review.answer.json'), 'utf8'))
  expect(rejectedAnswer).toMatchObject({ approved: false, reviewKey: rejectedPending.reviewKey, actualText: rejectedPending.actualText })
  const clarificationProfile = realpathSync(resolve(clarificationManifest.executionProfilePath))
  expect(samePath(clarificationProfile, join(clarificationRoot, 'execution-profile'))).toBe(true)
  const clarificationHistory = nativeHistoryFiles(clarificationProfile)
  const clarificationRecords = nativeRecordsFromEvidence(join(clarificationRoot, 'failure.native.json'))
  const rejectedRecord = clarificationRecords.find(value => value.id === rejectedPending.recordId)
  if (!rejectedRecord) throw new Error('The rejected plan record is missing')
  expect(rejectedRecord.tasks.at(-1)).toMatchObject({ goal: REMAINING_PROMPTS.T08Plan, intent: 'plan', status: 'completed' })
  expect(committed(rejectedRecord)).toHaveLength(0)
  confirmConfiguration(rejectedRecord, selected.cli, selected.model, selected.effort)
  expect(rejectedRecord.externalSessionId).toBe(checkpoint.externalSessionId)
  persistedRecord(clarificationHistory, rejectedRecord, 'Rejected plan record')

  const actualReadonlySource = manifest.actualReadonlySource
  if (!actualReadonlySource || typeof actualReadonlySource !== 'object') {
    throw new Error('The completed checkpoint has no reviewed actual read-only source')
  }
  const actualReadonlyRoot = realpathSync(resolve(actualReadonlySource.root))
  expect(samePath(resolve(actualReadonlyRoot, '..'), join(sourceRoot, 'attempts'))).toBe(true)
  expect(samePath(actualReadonlyRoot, clarificationRoot)).toBe(false)
  expect(actualReadonlySource.intent).toBe('discuss')
  expect(typeof actualReadonlySource.recordId).toBe('string')
  expect(actualReadonlySource.externalSessionId).toBe(checkpoint.externalSessionId)
  expect(typeof actualReadonlySource.evaluationCorrection).toBe('string')
  expect(actualReadonlySource.evaluationCorrection).toContain('read-only')
  expect(actualReadonlySource.evaluationCorrection).toContain('discuss')
  expect(actualReadonlySource.evaluationCorrection).toContain('zero commits')
  expect(checkpoint.actualReadonlySource).toEqual(actualReadonlySource)
  expect(reusedT08Manifest.actualReadonlySource).toEqual(actualReadonlySource)

  const actualSavedPath = realpathSync(resolve(actualReadonlySource.savedPath))
  const actualNativePath = realpathSync(resolve(actualReadonlySource.nativePath))
  const actualReviewPath = realpathSync(resolve(actualReadonlySource.reviewPath))
  expect(contained(actualReadonlyRoot, actualSavedPath)).toBe(true)
  expect(contained(actualReadonlyRoot, actualNativePath)).toBe(true)
  expect(contained(actualReadonlyRoot, actualReviewPath)).toBe(true)
  expect(samePath(actualSavedPath, join(actualReadonlyRoot, 'failure-current.h5lesson'))).toBe(true)
  expect(samePath(actualNativePath, join(actualReadonlyRoot, 'failure.native.json'))).toBe(true)
  expect(samePath(actualReviewPath, join(actualReadonlyRoot, 'actual-plan-review.json'))).toBe(true)
  expect(samePath(reusedT08Manifest.sourceFailure, actualNativePath)).toBe(true)

  const actualReadonlyManifest = JSON.parse(readFileSync(join(actualReadonlyRoot, 'run.json'), 'utf8'))
  expect(actualReadonlyManifest.selected).toEqual(selected)
  expect(actualReadonlyManifest.status).toBe('failed')
  expect(String(actualReadonlyManifest.failure).replace(/\u001b\[[0-9;]*m/g, '')).toContain('Received: "discuss"')
  expect(samePath(actualReadonlyManifest.projectPath, projectPath)).toBe(true)
  expect(samePath(actualReadonlyManifest.clarificationRoot, clarificationRoot)).toBe(true)
  expect(actualReadonlyManifest.existingHistoryPreserved).toBe(true)
  expect(actualReadonlyManifest.failureSavedRevision).toBe(t03.project.revision)
  expect(readSaved(actualSavedPath)).toEqual(t03)
  expect(existsSync(join(actualReadonlyRoot, 'T08-apply-plan.input.json'))).toBe(false)
  expect(existsSync(join(actualReadonlyRoot, 'T09-flow.input.json'))).toBe(false)
  expect(existsSync(join(continuationRoot, 'T08-plan.input.json')), 'The approved actual reply must be reused without a new plan request').toBe(false)

  const visiblePlanPath = realpathSync(join(actualReadonlyRoot, 'T08-plan-visible.review.json'))
  const visiblePlan = JSON.parse(readFileSync(visiblePlanPath, 'utf8'))
  expect(typeof visiblePlan.text).toBe('string')
  expect(visiblePlan.text.length).toBeGreaterThan(30)
  const actualReview = JSON.parse(readFileSync(actualReviewPath, 'utf8'))
  expect(actualReview).toMatchObject({ approved: true, recordId: actualReadonlySource.recordId,
    externalSessionId: actualReadonlySource.externalSessionId, actualText: visiblePlan.text })
  expect(typeof actualReview.reason).toBe('string')
  expect(actualReview.reason.trim().length).toBeGreaterThan(0)
  expect(Date.parse(actualReview.reviewedAt)).toBeGreaterThanOrEqual(Date.parse(visiblePlan.capturedAt))
  expect(samePath(actualReview.reviewedScreenshot, join(actualReadonlyRoot, 'T08-plan-visible.png'))).toBe(true)
  expect(samePath(actualReview.reviewedCurrentPage, join(actualReadonlyRoot, 'failure-current.png'))).toBe(true)

  const planReview = manifest.planReview
  if (!planReview || typeof planReview !== 'object' || !planReview.request || !planReview.answer) {
    throw new Error('The completed checkpoint has no reviewed actual plan pair')
  }
  expect(reusedT08Manifest.planReview).toEqual(planReview)
  const request = planReview.request, answer = planReview.answer
  expect(request).toMatchObject({ recordId: actualReadonlySource.recordId, externalSessionId: actualReadonlySource.externalSessionId,
    actualText: visiblePlan.text, requestedAt: visiblePlan.capturedAt })
  expect(samePath(request.reviewPath, visiblePlanPath)).toBe(true)
  expect(samePath(request.screenshot, join(actualReadonlyRoot, 'T08-plan-visible.png'))).toBe(true)
  expect(samePath(request.currentProjectScreenshot, join(actualReadonlyRoot, 'failure-current.png'))).toBe(true)
  expect(samePath(request.answerPath, actualReviewPath)).toBe(true)
  expect(answer).toMatchObject({ approved: true, recordId: request.recordId, externalSessionId: request.externalSessionId,
    actualText: request.actualText, reviewedScreenshot: request.screenshot, reviewedCurrentPage: request.currentProjectScreenshot })
  expect(typeof answer.reason).toBe('string')
  expect(answer.reason.trim().length).toBeGreaterThan(0)
  expect(Date.parse(answer.reviewedAt)).toBeGreaterThanOrEqual(Date.parse(request.requestedAt))

  const actualRecords = nativeRecordsFromEvidence(actualNativePath)
  const actualRecord = actualRecords.find(value => value.id === actualReadonlySource.recordId)
  if (!actualRecord) throw new Error('The reviewed actual read-only record is missing')
  expect(reusedT08Manifest.clarificationRecordId).toBe(actualRecord.id)
  expect(typeof reusedT08Manifest.clarificationPrompt).toBe('string')
  expect(actualRecord.tasks.at(-1)).toMatchObject({ goal: reusedT08Manifest.clarificationPrompt, intent: 'discuss', status: 'completed' })
  expect(committed(actualRecord)).toHaveLength(0)
  expect(actualRecord.externalSessionId).toBe(checkpoint.externalSessionId)
  expect(actualRecord.workspace).toEqual(rejectedRecord.workspace)
  confirmConfiguration(actualRecord, selected.cli, selected.model, selected.effort)
  const actualProfilePath = realpathSync(resolve(actualReadonlyManifest.executionProfilePath))
  expect(samePath(actualProfilePath, join(actualReadonlyRoot, 'execution-profile'))).toBe(true)
  const reusedT08ProfilePath = realpathSync(resolve(reusedT08Manifest.executionProfilePath))
  expect(samePath(reusedT08ProfilePath, join(reusedT08Root, 'execution-profile'))).toBe(true)
  if (hasFlowCorrection) expect(samePath(manifest.profilePath, reusedT08ProfilePath)).toBe(true)
  else expect(samePath(manifest.profilePath, actualProfilePath)).toBe(true)
  const actualHistory = nativeHistoryFiles(actualProfilePath)
  for (const record of actualRecords) persistedRecord(actualHistory, record, 'Actual read-only record')
  for (const record of clarificationRecords) expect(actualRecords.find(actual => actual.id === record.id)).toEqual(record)

  const reusedT08Records = nativeRecordsFromEvidence(join(reusedT08Root, 'final.native.json'))
  const appliedRecord = reusedT08Records.find(value => value.tasks.at(-1)?.goal === REMAINING_PROMPTS.T08Apply
    && value.tasks.at(-1)?.status === 'completed')
  if (!appliedRecord) throw new Error('The actual reviewed-plan application is missing from reused native evidence')
  const reusedT08History = nativeHistoryFiles(reusedT08ProfilePath)
  for (const record of reusedT08Records) persistedRecord(reusedT08History, record, 'Reused T08/Flow record')

  const finalRecords = nativeRecordsFromEvidence(join(continuationRoot, 'final.native.json'))
  const reviewedRecord = finalRecords.find(value => value.id === actualRecord.id)
  const finalRecord = finalRecords.find(value => value.id === checkpoint.finalRecordId)
  if (!reviewedRecord || !finalRecord) {
    throw new Error('The reviewed record, applied plan, or final Flow record is missing from actual native evidence')
  }
  expect(reviewedRecord).toEqual(actualRecord)
  expect(finalRecord.tasks.at(-1)).toMatchObject({ goal: hasFlowCorrection ? manifest.correctionPrompt : REMAINING_PROMPTS.T09Flow,
    status: 'completed' })
  expect(committed(appliedRecord).length).toBeGreaterThan(0)
  expect(committed(finalRecord).length).toBeGreaterThan(0)
  for (const record of [reviewedRecord, appliedRecord, finalRecord]) {
    confirmConfiguration(record, selected.cli, selected.model, selected.effort)
    expect(record.externalSessionId).toBe(checkpoint.externalSessionId)
    expect(record.workspace.normalizedPath).toBe(projectPath.replace(/\\/g, '/').toLowerCase())
  }
  const executionHistory = nativeHistoryFiles(profilePath)
  for (const record of [...sourceRecords, ...clarificationRecords, ...actualRecords, ...reusedT08Records, finalRecord]) {
    persistedRecord(executionHistory, record, 'Claude continuation record')
  }

  const applied = readSaved(join(reusedT08Root, 'T08-applied.h5lesson'))
  expect(titleItem(applied.project)).not.toEqual(titleItem(t03.project))
  expect(titleItem(applied.project).content.data.text).toBe(titleItem(t03.project).content.data.text)
  const withoutTitleAdjustment = structuredClone(applied)
  Object.assign(titleItem(withoutTitleAdjustment.project), structuredClone(titleItem(t03.project)))
  withoutTitleAdjustment.project.revision = t03.project.revision
  withoutTitleAdjustment.project.updatedAt = t03.project.updatedAt
  expect(withoutTitleAdjustment.project).toEqual(t03.project)
  expect(withoutTitleAdjustment.assetFiles).toEqual(t03.assetFiles)
  expect(withoutTitleAdjustment.componentFiles).toEqual(t03.componentFiles)
  if (hasFlowCorrection) {
    expect(typeof manifest.correctionPrompt).toBe('string')
    const previousFlowFailureRoot = realpathSync(resolve(manifest.previousFlowFailureSource))
    expect(samePath(previousFlowFailureRoot, reusedT08Root)).toBe(true)
    const previousFlowFailure = manifest.previousFlowSemanticFailure
    if (!previousFlowFailure || typeof previousFlowFailure !== 'object') {
      throw new Error('The Flow correction omitted the actual rejected Flow semantic review')
    }
    expect(typeof previousFlowFailure.actualText).toBe('string')
    expect(typeof previousFlowFailure.reason).toBe('string')
    expect(previousFlowFailure.reason.trim().length).toBeGreaterThan(0)
    const incorrectPrevious = readSaved(join(previousFlowFailureRoot, 'T09-flow.h5lesson'))
    const incorrectParagraph = flowParagraph(incorrectPrevious.project, REMAINING_IDS.paragraphTwo)
    expect(previousFlowFailure.actualText).toBe(incorrectParagraph.text)
    expect(incorrectParagraph.text).toContain('经过平衡位置')
    expect(incorrectParagraph.text).not.toMatch(/(?:十次完整往复(?:运动)?|十个周期)[\s\S]{0,60}总时间[\s\S]{0,60}除以\s*(?:十|10)/)
    expect(readSaved(join(continuationRoot, 'before-Flow-correction.h5lesson'))).toEqual(incorrectPrevious)
  }
  const current = readSaved(savedPath)
  expect(readSaved(projectPath)).toEqual(current)
  const paragraph = flowParagraph(current.project, REMAINING_IDS.paragraphTwo)
  expect(paragraph.text.length).toBeLessThan(SECOND_PARAGRAPH.length * .8)
  expect(paragraph.text).toMatch(/周期/)
  expect(paragraph.text).toMatch(/往复|计时|时间/)
  // Reject the observed “ten crossings” error without claiming that this
  // narrow assertion replaces the retained human semantic review.
  expect(paragraph.text).toMatch(/(?:十次完整往复(?:运动)?|十个周期)[\s\S]{0,60}总时间[\s\S]{0,60}除以\s*(?:十|10)/)
  expect(flowParagraph(current.project, REMAINING_IDS.paragraphOne)).toEqual(flowParagraph(applied.project, REMAINING_IDS.paragraphOne))
  expect(flowSurface(current.project).blocks.map(block => block.id)).toEqual(flowSurface(applied.project).blocks.map(block => block.id))
  expect(spatialSurface(current.project)).toEqual(spatialSurface(applied.project))
  if (hasFlowCorrection) {
    const flowSemanticReview = manifest.flowSemanticReview
    if (!flowSemanticReview || typeof flowSemanticReview !== 'object') {
      throw new Error('The Flow correction has no completed human semantic review')
    }
    expect(checkpoint.flowSemanticReview).toEqual(flowSemanticReview)
    expect(flowSemanticReview).toMatchObject({ approved: true, pending: false, recordId: finalRecord.id,
      externalSessionId: finalRecord.externalSessionId, actualText: paragraph.text, savedPath })
    expect(typeof flowSemanticReview.reviewer).toBe('string')
    expect(flowSemanticReview.reviewer.trim().length).toBeGreaterThan(0)
    expect(typeof flowSemanticReview.reason).toBe('string')
    expect(flowSemanticReview.reason.trim().length).toBeGreaterThan(0)
    expect(Date.parse(flowSemanticReview.reviewedAt)).toBeGreaterThan(0)
    expect(samePath(flowSemanticReview.screenshot, join(continuationRoot, 'T09-flow.png'))).toBe(true)
    expect(JSON.parse(readFileSync(join(continuationRoot, 'flow-semantic-review.json'), 'utf8'))).toEqual(flowSemanticReview)
  }
  expect(existsSync(join(continuationRoot, 'T09-spatial.input.json')), 'The next paid turn must begin at Spatial; no past Spatial failure exists').toBe(false)

  return { sourceRoot, projectPath, profilePath, original, current, record: finalRecord,
    historyFiles: [...sourceHistory, ...clarificationHistory, ...actualHistory, ...reusedT08History, ...executionHistory], phase: 'after-reviewed-T08-and-Flow',
    reuseNativeSession: true, continuationRoot, reusedT08Root,
    previousFlowFailureRoot: hasFlowCorrection ? reusedT08Root : undefined }
}
/** Continue from actual saved progress after the Main inspection transport was
 * lost. T11's text question ended failed: preserve that unresolved defect and
 * only reuse its independent answer/edit and Stop evidence. */
function loadRemainingAfterT11(previous: RemainingFlowResume, source: string,
  selected: { cli: NativeCli; slot: number; model: string; effort: string; gate: string }): RemainingFlowResume {
  const root = realpathSync(resolve(source))
  expect(resolve(root, '..').toLowerCase()).toBe(join(previous.sourceRoot, 'attempts').toLowerCase())
  const manifest = JSON.parse(readFileSync(join(root, 'run.json'), 'utf8'))
  expect(manifest.selected).toEqual(selected); expect(manifest.prompts).toEqual(REMAINING_PROMPTS)
  expect(manifest.status).toBe('failed'); expect(manifest.continuation.phase).toBe('after-failed-T10')
  expect(resolve(manifest.continuation.failedT10Root).toLowerCase()).toBe(previous.failedT10Root!.toLowerCase())
  expect(manifest.failure).toContain('electronApplication.evaluate: Execution context was destroyed')
  expect(manifest.failure).toContain('expectBackgroundWindowsIsolated.ts')
  expect(manifest.existingHistoryPreserved).toBe(true)
  expect(existsSync(join(root, 'T12-applied.h5lesson')), 'This checkpoint may not replay a completed T12 edit').toBe(false)
  const records = JSON.parse(readFileSync(join(root, 'failure.native.json'), 'utf8')).records
    .map((value: unknown) => localAgentRecordV2Schema.parse(value)) as LocalAgentRecordV2[]
  const recordFor = (goal: string, revision?: number) => {
    const record = records.find(value => value.tasks.at(-1)?.goal === goal
      && (revision === undefined || committed(value).at(-1)?.afterRevision === revision))
    if (!record) throw new Error(`Missing actual native evidence: ${goal}`)
    confirmConfiguration(record, selected.cli, selected.model, selected.effort)
    expect(record.externalSessionId).toBe(previous.record.externalSessionId)
    expect(record.workspace).toEqual(previous.record.workspace)
    expect(record.workingDirectoryId).toBe(previous.record.workingDirectoryId)
    return record
  }
  const persisted = (record: LocalAgentRecordV2) => {
    const file = previous.historyFiles.find(item => item.path.endsWith(`${record.id}.json`))
    if (!file) throw new Error(`The original native history is missing: ${record.id}`)
    return localAgentRecordV2Schema.parse(JSON.parse(file.bytes.toString('utf8')))
  }
  const repaired = readSaved(join(root, 'T10-repaired.h5lesson'))
  expect(repaired.project.revision).toBe(previous.current.project.revision + 1)
  expect(buttonRuntime(repaired.project).runtime.source).not.toBe(buttonRuntime(previous.current.project).runtime.source)
  const withoutRepair = structuredClone(repaired)
  withoutRepair.project.revision = previous.current.project.revision; withoutRepair.project.updatedAt = previous.current.project.updatedAt
  buttonRuntime(withoutRepair.project).runtime.source = buttonRuntime(previous.current.project).runtime.source
  expect(withoutRepair).toEqual(previous.current)
  const repairRecord = recordFor(REMAINING_PROMPTS.T10, repaired.project.revision)
  expect(repairRecord.tasks.at(-1)?.status).toBe('completed')
  expect(committed(repairRecord).map(receipt => [receipt.beforeRevision, receipt.afterRevision])).toEqual([[11, 12]])
  expect(persisted(repairRecord)).toEqual(repairRecord)
  const observation = JSON.parse(readFileSync(join(root, 'T10-runtime-dom-observation.json'), 'utf8'))
  expect(observation.sessionId).toBe(repairRecord.id); expect(observation.initialRevision).toBe(11)
  const initialControl = observation.evidence.find((item: { documentRevision: number }) => item.documentRevision === 11)
    .facts.domControls.instances.find((item: { instanceId: string }) => item.instanceId === REMAINING_IDS.brokenRuntime).controls[0]
  expect(initialControl).toMatchObject({ pointerEvents: 'none', centerHit: { status: 'other-element', element: { runtimeLayer: 'phaser' } } })
  expect(existsSync(join(root, 'T10-repaired-after-click.png')), 'Retain the actual normal click success evidence').toBe(true)
  const question = recordFor(REMAINING_PROMPTS.T11Ask)
  expect(question.tasks.at(-1)?.status, 'Preserve the observed unresolved question failure; this is not a T11 pass').toBe('failed')
  expect(committed(question)).toHaveLength(0); expect(persisted(question)).toEqual(question)
  expect(JSON.parse(readFileSync(join(root, 'T11-clarification-path.json'), 'utf8')).clarification).toBe('text')
  expect(readSaved(join(root, 'T11-before-answer.h5lesson'))).toEqual(repaired)
  const answered = readSaved(join(root, 'T11-answered.h5lesson'))
  expect(answered.project.revision).toBe(13); expect(titleItem(answered.project).content.data.text).toBe('波动的秘密')
  const withoutAnswer = structuredClone(answered)
  withoutAnswer.project.revision = repaired.project.revision; withoutAnswer.project.updatedAt = repaired.project.updatedAt
  titleItem(withoutAnswer.project).content.data.text = titleItem(repaired.project).content.data.text
  // The actual canonical text edit derived the automatic height. Preserve the
  // recorded change explicitly; do not misreport it as unchanged geometry.
  expect(titleItem(answered.project).content.data.style.overflow).toBe('auto-height')
  expect(titleItem(repaired.project).frame.height).toBe(78)
  expect(titleItem(answered.project).frame.height).toBe(48.8)
  titleItem(withoutAnswer.project).frame.height = titleItem(repaired.project).frame.height
  expect(withoutAnswer).toEqual(repaired)
  const answer = recordFor(REMAINING_PROMPTS.T11Answer, answered.project.revision)
  expect(answer.tasks.at(-1)?.status).toBe('completed')
  expect(committed(answer).map(receipt => [receipt.beforeRevision, receipt.afterRevision])).toEqual([[12, 13]])
  expect(persisted(answer)).toEqual(answer)
  const stopped = recordFor(REMAINING_PROMPTS.T11Start)
  expect(stopped.tasks.at(-1)?.status).toBe('cancelled'); expect(stopped.tasks.at(-1)?.epoch).toBe(1)
  expect(stopped.hostResults).toHaveLength(0); expect(persisted(stopped)).toEqual(stopped)
  expect(stopped.events.some(event => event.kind === 'input-delivery' && event.delivery.status === 'accepted')).toBe(true)
  expect(stopped.events.some(event => event.kind === 'turn-ended' && event.status === 'cancelled')).toBe(true)
  for (const stage of ['T11-before-stop', 'T11-stopped', 'T11-late-result-window']) expect(readSaved(join(root, `${stage}.h5lesson`))).toEqual(answered)
  const interrupted = recordFor(REMAINING_PROMPTS.T12Preview), cancelled = persisted(interrupted)
  expect(interrupted.tasks.at(-1)?.status).toBe('running'); expect(interrupted.tasks.at(-1)?.epoch).toBe(0)
  expect(interrupted.events.map(event => event.kind)).toEqual(['configuration'])
  expect(interrupted.hostResults).toHaveLength(0)
  expect(cancelled.tasks.at(-1)?.taskId).toBe(interrupted.tasks.at(-1)?.taskId)
  expect(cancelled.tasks.at(-1)?.status).toBe('cancelled'); expect(cancelled.tasks.at(-1)?.epoch).toBe(1)
  expect(cancelled.tasks.at(-1)?.applyPolicy).toBe('preview')
  expect(cancelled.hostResults).toHaveLength(0); expect(cancelled.events.slice(0, -1)).toEqual(interrupted.events)
  expect(cancelled.events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'cancelled' })
  expect(readSaved(previous.projectPath), 'Continue actual revision 13 without rewriting the fixture or replaying any candidate').toEqual(answered)
  return { ...previous, current: answered, record: cancelled, phase: 'after-T11', t11ProgressRoot: root,
    unresolvedQuestionRecordId: question.id, cancelledT12RecordId: cancelled.id, t11AutoHeightChange: { before: 78, after: 48.8 } }
}

/**
 * The recovered-Flow OpenCode run completed Flow, Spatial, T10, and the
 * clarification/answer sequence, then its test driver lost the Main-process
 * inspection context while waiting for a queued supplement. The normal failure
 * cleanup really clicked Stop, but the queued delivery was never accepted or
 * consumed and the five-second late-write window did not run. Resume only that
 * unfinished tail; do not turn a queued input into successful evidence.
 */
export async function loadRemainingAfterT11QueuedCancelledResume(productRoot: string, source: string,
  selected: RemainingSelection): Promise<RemainingFlowResume> {
  expect(selected).toEqual({ cli: 'opencode', slot: 1, model: 'openai/gpt-5.6-luna', effort: 'max', gate: 'opencode-once' })
  const root = realpathSync(resolve(source))
  const manifest = JSON.parse(readFileSync(join(root, 'run.json'), 'utf8'))
  expect(manifest.selected).toEqual(selected)
  expect(manifest.prompts).toEqual(REMAINING_PROMPTS)
  expect(manifest.status).toBe('failed')
  expect(manifest.failure).toContain('electronApplication.evaluate: Execution context was destroyed')
  expect(manifest.failure).toContain('expectBackgroundWindowsIsolated.ts')
  expect(manifest.existingHistoryPreserved).toBe(true)
  expect(manifest.continuation?.phase).toBe('after-recovered-Flow')

  const sourceRoot = realpathSync(resolve(manifest.continuation.from))
  const evidenceRoot = realpathSync(join(productRoot, 'output', 'r18-native-authoring-remaining'))
  expect(samePath(resolve(root, '..'), join(sourceRoot, 'attempts'))).toBe(true)
  expect(samePath(resolve(sourceRoot, '..'), evidenceRoot)).toBe(true)
  const projectPath = realpathSync(resolve(manifest.projectPath))
  const profilePath = realpathSync(resolve(manifest.continuation.profilePath))
  expect(samePath(manifest.continuation.profilePath, profilePath)).toBe(true)
  expect(existsSync(join(root, 'T12-preview.input.json')), 'The failed run may not already contain a T12 request').toBe(false)
  expect(existsSync(join(root, 'T050-generate.input.json')), 'The failed run may not already contain a material-generation request').toBe(false)
  for (const name of [
    'T09-flow.native.json', 'T09-flow.h5lesson', 'T09-flow-controls.png',
    'T09-spatial.native.json', 'T09-spatial.h5lesson', 'T09-spatial-current-camera.json', 'T09-spatial-visible.png', 'T09-spatial-controls.png',
    'T10.native.json', 'T10-repaired.h5lesson', 'T10-repaired-after-click.png', 'T10-runtime-dom-observation.json',
    'T11-question.input.json', 'T11-before-answer.h5lesson', 'T11-question-visible.review.json', 'T11-answered.native.json', 'T11-answered.h5lesson',
    'T11-active.input.json', 'T11-supplement.input.json', 'failure.native.json', 'failure-current.h5lesson', 'failure-current.project.json', 'failure.ui.txt',
  ]) expect(existsSync(join(root, name)), `Missing retained evidence: ${name}`).toBe(true)

  const original = readSaved(join(sourceRoot, '00-original.h5lesson'))
  const flow = readSaved(join(root, 'T09-flow.h5lesson'))
  const spatial = readSaved(join(root, 'T09-spatial.h5lesson'))
  const repaired = readSaved(join(root, 'T10-repaired.h5lesson'))
  const answered = readSaved(join(root, 'T11-answered.h5lesson'))
  const stopped = readSaved(join(root, 'failure-current.h5lesson'))
  const current = readSaved(projectPath)
  expect(current).toEqual(stopped)
  expect(answered.project).toEqual(current.project)
  expect(answered.assetFiles).toEqual(current.assetFiles)
  expect(answered.componentFiles).toEqual(current.componentFiles)
  expect(JSON.parse(readFileSync(join(root, 'failure-current.project.json'), 'utf8'))).toEqual(current.project)

  const paragraph = flowParagraph(flow.project, REMAINING_IDS.paragraphTwo)
  expect(paragraph.text.length).toBeLessThan(SECOND_PARAGRAPH.length * .8)
  expect(paragraph.text).toMatch(/周期/)
  expect(paragraph.text).toMatch(/往复|计时|时间/)
  expect(paragraph.text).toMatch(/(?:十次完整往复(?:运动)?|十个周期)[\s\S]{0,60}总时间[\s\S]{0,60}除以\s*(?:十|10)/)
  expect(spatial.project.revision).toBe(flow.project.revision + 1)
  const camera = JSON.parse(readFileSync(join(root, 'T09-spatial-current-camera.json'), 'utf8'))
  const spatialItem = spatialSurface(spatial.project).world.layerItems.find(item => item.layerItemId === REMAINING_IDS.spatialObject)
  if (!spatialItem) throw new Error('The retained completed Spatial object is missing')
  expect(Math.abs(spatialItem.frame.x + spatialItem.frame.width / 2 - camera.camera.x)).toBeLessThan(2)
  expect(Math.abs(spatialItem.frame.y + spatialItem.frame.height / 2 - camera.camera.y)).toBeLessThan(2)
  expect(repaired.project.revision).toBe(spatial.project.revision + 1)
  expect(buttonRuntime(repaired.project).runtime.source).not.toBe(buttonRuntime(spatial.project).runtime.source)
  expect(answered.project.revision).toBe(repaired.project.revision + 1)
  expect(titleItem(answered.project).content.data.text).toBe('波动的秘密')
  expect(titleItem(answered.project).frame.height).toBe(titleItem(repaired.project).frame.height)

  const records = nativeRecordsFromEvidence(join(root, 'failure.native.json'))
  const workspacePath = projectPath.replace(/\\/g, '/').toLowerCase()
  const recordFor = (goal: string, status: string) => {
    const record = records.find(value => value.workspace.normalizedPath === workspacePath
      && value.tasks.at(-1)?.goal === goal && value.tasks.at(-1)?.status === status)
    if (!record) throw new Error(`Missing actual retained native record: ${goal} (${status})`)
    confirmConfiguration(record, selected.cli, selected.model, selected.effort)
    return record
  }
  const flowRecord = recordFor(REMAINING_PROMPTS.T09Flow, 'completed')
  const spatialRecord = recordFor(REMAINING_PROMPTS.T09Spatial, 'completed')
  const repairRecord = recordFor(REMAINING_PROMPTS.T10, 'completed')
  const questionRecord = recordFor(REMAINING_PROMPTS.T11Ask, 'failed')
  const answerRecord = recordFor(REMAINING_PROMPTS.T11Answer, 'completed')
  const queuedRecord = recordFor(REMAINING_PROMPTS.T11Start, 'running')
  const nativeId = flowRecord.externalSessionId
  if (!nativeId) throw new Error('The recovered native continuation has no external session identity')
  for (const record of [flowRecord, spatialRecord, repairRecord, questionRecord, answerRecord, queuedRecord]) {
    expect(record.externalSessionId).toBe(nativeId)
    expect(record.workspace.normalizedPath).toBe(workspacePath)
  }
  expect(committed(flowRecord).at(-1)?.afterRevision).toBe(flow.project.revision)
  expect(committed(spatialRecord).at(-1)?.afterRevision).toBe(spatial.project.revision)
  expect(committed(repairRecord).at(-1)?.afterRevision).toBe(repaired.project.revision)
  expect(committed(questionRecord)).toHaveLength(0)
  expect(committed(answerRecord).at(-1)?.afterRevision).toBe(answered.project.revision)
  expect(committed(queuedRecord)).toHaveLength(0)
  expect(queuedRecord.hostResults).toHaveLength(0)
  const queuedTask = queuedRecord.tasks.at(-1)
  if (!queuedTask) throw new Error('The retained queued task is missing')
  const queuedDelivery = queuedRecord.events.find(event => event.kind === 'input-delivery' && event.delivery.status === 'queued')
  if (!queuedDelivery || queuedDelivery.kind !== 'input-delivery') throw new Error('The retained supplement was not actually queued')
  const queuedInputs = queuedTask.pendingInputs ?? []
  expect(queuedInputs).toHaveLength(1)
  expect(queuedInputs[0]).toMatchObject({ inputId: queuedDelivery.delivery.inputId, kind: 'supplement', text: REMAINING_PROMPTS.T11Supplement })
  expect(queuedRecord.events.some(event => event.kind === 'input-delivery' && ['accepted', 'consumed'].includes(event.delivery.status))).toBe(false)

  const historyFiles = nativeHistoryFiles(profilePath)
  for (const record of [flowRecord, spatialRecord, repairRecord, questionRecord, answerRecord]) persistedRecord(historyFiles, record, 'Completed predecessor native record')
  const queuedHistory = historyFiles.find(file => file.path.endsWith(`${queuedRecord.id}.json`))
  if (!queuedHistory) throw new Error('The stopped queued native record is missing from durable history')
  const cancelledRecord = localAgentRecordV2Schema.parse(JSON.parse(queuedHistory.bytes.toString('utf8')))
  const cancelledTask = cancelledRecord.tasks.at(-1)
  if (!cancelledTask) throw new Error('The durable stopped task is missing')
  expect(cancelledTask.taskId).toBe(queuedTask.taskId)
  expect(cancelledTask.status).toBe('cancelled')
  expect(cancelledTask.epoch).toBe(queuedTask.epoch + 1)
  expect(cancelledTask.committedResultIds).toEqual([])
  expect(cancelledRecord.hostResults).toHaveLength(0)
  expect(cancelledRecord.events.slice(0, -1)).toEqual(queuedRecord.events)
  expect(cancelledRecord.events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'cancelled' })
  const cancelledInputs = cancelledTask.pendingInputs ?? []
  expect(cancelledInputs).toHaveLength(1)
  expect(cancelledInputs[0]).toMatchObject({ inputId: queuedDelivery.delivery.inputId, kind: 'supplement' })
  expect(cancelledRecord.events.some(event => event.kind === 'input-delivery' && ['accepted', 'consumed'].includes(event.delivery.status))).toBe(false)
  expect(existsSync(join(root, 'T11-before-stop.h5lesson')), 'The automatic cleanup did not run the intended before-Stop assertion').toBe(false)
  expect(existsSync(join(root, 'T11-late-result-window.h5lesson')), 'The automatic cleanup did not run the intended late-write window').toBe(false)

  return { sourceRoot, projectPath, profilePath, original, current, record: cancelledRecord, historyFiles,
    phase: 'after-T11-queued-cancelled', reuseNativeSession: true, previousExternalSessionId: manifest.continuation.previousExternalSessionId,
    continuationRoot: root, spatialCompletedRoot: root, t11ProgressRoot: root,
    t11QueuedCancelledRoot: root, t11QueuedCancelledRecordId: cancelledRecord.id, requiresQueuedSupplementCompletion: true,
    unresolvedQuestionRecordId: questionRecord.id,
    t11AutoHeightChange: { before: titleItem(repaired.project).frame.height, after: titleItem(answered.project).frame.height } }
}

export async function recordSpatialObservation(run: NativeRun, camera: { x: number; y: number; zoom: number }) {
  const record = await selectedRecord(run), task = record.tasks.at(-1)!
  const observations = record.observations.filter(observation => observation.taskId === task.taskId)
  expect(observations.length).toBeGreaterThan(0)
  const repository = new LocalAgentRepository(run.userData), evidence = []
  for (const observation of observations) {
    const request = await repository.readGenerationRequest(record.workspace, record.workingDirectoryId, observation.observationId)
    expect(request?.observation?.spatialView?.camera).toEqual(camera)
    expect(request?.observation?.spatialView?.cameraAnchor).toBe('viewport-center')
    const structure = JSON.parse(readFileSync(join(repository.observationPath(record.workspace, record.workingDirectoryId, observation.observationId), 'observation/current-structure.json'), 'utf8'))
    expect(structure.spatialView).toEqual(request!.observation!.spatialView)
    evidence.push({ observationId: observation.observationId, requestId: request!.requestId, documentRevision: request!.documentRevision, spatialView: request!.observation!.spatialView })
  }
  writeFileSync(join(run.runRoot, 'T09-spatial-current-camera.json'), JSON.stringify({ camera, sessionId: record.id, externalSessionId: record.externalSessionId, evidence }, null, 2))
}

export async function recordRuntimeDomObservation(run: NativeRun, initialRevision: number) {
  const record = await selectedRecord(run), task = record.tasks.at(-1)!
  expect(task.goal).toBe(REMAINING_PROMPTS.T10)
  const observations = record.observations.filter(observation => observation.taskId === task.taskId)
  const repository = new LocalAgentRepository(run.userData), evidence = []
  for (const observation of observations) {
    const request = await repository.readGenerationRequest(record.workspace, record.workingDirectoryId, observation.observationId)
    if (!request?.observation?.runtime) continue
    const file = request.observation.files.find(file => file.fileId === 'runtime-state')
    if (!file) throw new Error('The real trial observation did not persist its runtime-state resource')
    const path = join(repository.observationPath(record.workspace, record.workingDirectoryId, observation.observationId), file.relativePath)
    const facts = JSON.parse(readFileSync(path, 'utf8'))
    expect(facts.sessionId).toBe(request.observation.runtime.sessionId)
    expect(facts.stateVersion).toBe(request.observation.runtime.stateVersion)
    expect(facts.domControls).toMatchObject({ clickPerformed: false, functionalResult: 'not-tested' })
    evidence.push({ observationId: observation.observationId, requestId: request.requestId, documentRevision: request.documentRevision,
      source: request.observation.source, resource: path, facts })
  }
  const initial = evidence.find(item => item.documentRevision === initialRevision)
  expect(initial, 'The model must receive the original failed Runtime with real hit-test facts before editing').toBeTruthy()
  expect(initial!.source).toBe('trial')
  expect(initial!.facts.domControls.instances).toContainEqual(expect.objectContaining({ instanceId: REMAINING_IDS.brokenRuntime,
    controls: expect.arrayContaining([expect.objectContaining({ label: '显示答案', pointerEvents: 'none',
      centerHit: expect.objectContaining({ status: 'other-element', element: expect.objectContaining({ runtimeLayer: 'phaser' }) }) })]) }))
  writeFileSync(join(run.runRoot, 'T10-runtime-dom-observation.json'), JSON.stringify({ sessionId: record.id,
    externalSessionId: record.externalSessionId, initialRevision, evidence }, null, 2))
}

export function assertRemainingHistoryPreserved(resume: RemainingFlowResume): void {
  for (const file of resume.historyFiles) expect(readFileSync(file.path).equals(file.bytes), `Existing native record changed: ${file.path}`).toBe(true)
}

export async function selectSpatialObject(run: NativeRun): Promise<void> {
  const target = run.page.getByTestId('spatial-world-layer').locator(`[data-layer-item-id="${REMAINING_IDS.spatialObject}"]`)
  await expect(target).toBeVisible()
  const bounds = await target.boundingBox(), stage = run.page.getByTestId('spatial-world-stage'), viewport = await stage.boundingBox()
  if (!bounds || !viewport) throw new Error('The visible Spatial object and real hit-test stage need actual bounds')
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  expect(point.x).toBeGreaterThan(viewport.x); expect(point.x).toBeLessThan(viewport.x + viewport.width)
  expect(point.y).toBeGreaterThan(viewport.y); expect(point.y).toBeLessThan(viewport.y + viewport.height)
  // The drawing item intentionally has pointer-events:none. Send a real mouse
  // click at its measured position so Spatial's normal stage hit-test selects it.
  await run.page.mouse.click(point.x, point.y)
  await expect(run.page.getByTestId('spatial-selection-overlay')).toBeVisible()
}
export function committed(record: LocalAgentRecordV2) {
  return record.hostResults.flatMap(result => result.receipts).filter(receipt => receipt.status === 'committed')
}
export async function selectedRecord(run: NativeRun): Promise<LocalAgentRecordV2> {
  const id = await chat(run).getByLabel('会话', { exact: true }).inputValue()
  const record = nativeRecords(run).find(item => item.id === id)
  if (!record) throw new Error(`The UI-selected session has no durable native record: ${id}`)
  return record
}
export function chat(run: NativeRun) { return run.page.getByRole('complementary', { name: 'CLI 创作助手' }) }

export async function writeRemainingLesson(projectPath: string): Promise<CourseProjectArchiveData> {
  const base = await writeNativeLesson(projectPath)
  const flow = addCourseFlowPage(base.project, { title: '摆锤的流式讲义' })
  if (!flow.ok) throw new Error(flow.reason)
  const spatial = addCourseSpatialPage(flow.project, { title: '运动概念无限画布' })
  if (!spatial.ok) throw new Error(spatial.reason)
  const material = addCourseSlidePage(spatial.project, { title: MATERIAL_FIXTURE.blankPageName })
  if (!material.ok) throw new Error(material.reason)
  const project = material.project
  const paper = flowSurface(project), heading = paper.blocks[0]!
  if (heading.type !== 'heading') throw new Error('Formal Flow factory did not create its heading anchor')
  heading.text = '观察摆锤的运动'
  paper.blocks = [heading, { id: REMAINING_IDS.paragraphOne, type: 'paragraph', text: FIRST_PARAGRAPH },
    { id: REMAINING_IDS.paragraphTwo, type: 'paragraph', text: SECOND_PARAGRAPH }]
  project.locations.find(location => location.id === heading.id)!.label = heading.text
  const world = spatialSurface(project)
  world.camera.home = { x: 240, y: -120, zoom: .8 }
  Object.assign(world.camera.frames[0]!, world.camera.home, { name: '当前教学镜头' })
  world.world.layerItems.push(sceneNodeToCourseLayerItem(createShapeNode('ellipse', { id: REMAINING_IDS.spatialObject,
    name: '需要移动的蓝色圆形', x: -220, y: 60, width: 180, height: 140,
    style: { fillColor: '#2563eb', borderColor: '#172554', borderWidth: 3 } }), 1))
  const authored = createPublishedCanvasRuntimeV2Fixture([{ itemId: REMAINING_IDS.brokenRuntime, renderMode: 'dom', source: BROKEN_BUTTON_SOURCE }])
  const runtime = structuredClone(buttonRuntime(authored.project))
  runtime.label = '点击显示答案'; runtime.frame = { mode: 'absolute', x: 635, y: 410, width: 555, height: 290 }
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  if (slide.type !== 'slide') throw new Error('Initial Slide is missing')
  runtime.order = 4; slide.scenes[0]!.layerItems.push(runtime)
  project.playback.controls = 'canvas'
  project.globalLayerItems.push({ item: createControllerFixture({}, 100),
    plane: 'overlay', visibility: { mode: 'all', locationIds: [] } })
  const data = { ...base, project: courseProjectDocumentSchema.parse(project) }
  writeFileSync(projectPath, createCourseProjectArchive(data))
  return readSaved(projectPath)
}

export async function configureRemainingChat(run: NativeRun, cli: NativeCli, model: string, effort: string) {
  await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
  await chat(run).getByLabel('CLI', { exact: true }).selectOption(cli)
  await configureRemainingModel(run, model, effort)
  await chat(run).getByLabel('本轮引用', { exact: true }).selectOption('selection')
}
export async function configureRemainingModel(run: NativeRun, model: string, effort: string) {
  const modelControl = chat(run).getByLabel('模型', { exact: true })
  await expect(modelControl).toBeEnabled({ timeout: 60000 })
  expect(await modelControl.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toContain(model)
  await modelControl.selectOption(model); await expect(modelControl).toBeEnabled()
  const effortControl = chat(run).getByLabel('强度', { exact: true })
  if (effort !== 'default') { await expect(effortControl).toBeEnabled(); await effortControl.selectOption(effort) }
  else if (await effortControl.isEnabled()) await effortControl.selectOption('')
  await expect(modelControl).toBeEnabled()
}
export function confirmConfiguration(record: LocalAgentRecordV2, cli: NativeCli, model: string, effort: string) {
  expect(record.adapter).toBe(cli); expect(record.externalSessionId).toBeTruthy()
  const event = [...record.events].reverse().find(event => event.kind === 'configuration' && event.capabilities.current.model !== null)
  if (!event || event.kind !== 'configuration') throw new Error('No native-confirmed model configuration was recorded')
  expect(event.capabilities.current.model).toBe(model)
  if (effort !== 'default') expect(event.capabilities.current.effort).toBe(effort)
}
export async function openSurface(run: NativeRun, kind: 'slide-scene' | 'flow-page' | 'spatial-camera') {
  const row = run.page.getByTestId('course-page-tree').locator(`[data-kind="${kind}"]`).first()
  await row.locator('button.course-page-tree__label').first().click()
  if (kind !== 'slide-scene') await expect(run.page.getByTestId(kind === 'flow-page' ? 'flow-workspace' : 'spatial-workspace')).toBeVisible()
  else await expect(run.page.locator('[data-testid="canvas-stage"] canvas').first()).toBeVisible()
}
export async function beginNatural(run: NativeRun, step: string, prompt: string) {
  writeFileSync(join(run.runRoot, `${step}.input.json`), JSON.stringify({ prompt, time: new Date().toISOString(),
    selectedSession: await chat(run).getByLabel('会话', { exact: true }).inputValue(),
    reference: await chat(run).getByLabel('本轮引用摘要').innerText(),
    model: await chat(run).getByLabel('模型', { exact: true }).inputValue(), effort: await chat(run).getByLabel('强度', { exact: true }).inputValue() }, null, 2))
  await chat(run).getByLabel('发送给创作助手', { exact: true }).fill(prompt)
  await chat(run).getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat(run).getByRole('button', { name: '停止', exact: true })).toBeEnabled()
}

/** Dedicated boundary waits cannot call the shared terminal-turn waiter, because
 * that would swallow the very question/preview/Stop boundary under examination.
 * Unexpected native permissions are answered through the same visible GUI after
 * a real operator supplies exact answers; no permissions or CLI results are mocked. */
async function answerUnexpectedQuestion(run: NativeRun, section: Locator) {
  const legends = await section.locator('legend').allTextContents()
  const labels = await section.locator('label').allTextContents()
  const questionKey = `${Date.now()}-${legends.join('|')}`
  const pending = join(run.runRoot, 'remaining-pending-native-question.json')
  const answerPath = join(run.runRoot, 'remaining-pending-native-question.answer.json')
  writeFileSync(pending, JSON.stringify({ questionKey, legends, labels, answerPath,
    responseFormat: { questionKey, answers: [{ title: legends[0], values: ['exact visible option or typed answer'] }] } }, null, 2))
  await run.page.screenshot({ path: join(run.runRoot, 'remaining-pending-native-question.png') })
  console.log(`NATIVE_INPUT_REQUIRED ${pending}`)
  const deadline = Date.now() + 3 * 60_000
  while (Date.now() < deadline) {
    if (existsSync(answerPath)) {
      const response = JSON.parse(readFileSync(answerPath, 'utf8')) as { questionKey: string; answers: Array<{ title: string; values: string[] }> }
      if (response.questionKey === questionKey) {
        for (const answer of response.answers) {
          const field = section.getByRole('group', { name: answer.title, exact: true })
          for (const value of answer.values) {
            const option = field.getByLabel(value, { exact: true })
            if (await option.count()) await option.check()
            else await field.getByRole('textbox').fill(value)
          }
        }
        await section.getByRole('button', { name: /^(确认选择|发送回答)$/ }).click()
        return
      }
    }
    await run.page.waitForTimeout(500)
  }
  throw new Error(`No recorded answer for the real native question: ${pending}`)
}
export async function waitUiBoundary(run: NativeRun, name: string, timeoutMs: number, ready: () => Promise<boolean>, allowClarification = false) {
  const deadline = Date.now() + timeoutMs
  // Window isolation is a lifecycle invariant. Check it once when entering
  // this boundary wait; repeatedly calling Electron Main.evaluate while the
  // same UI is merely waiting adds no observation and can race its inspector.
  await expectBackgroundWindowsIsolated(run.app, true)
  while (Date.now() < deadline) {
    if (await ready()) return
    const question = chat(run).locator('section.native-agent-question').first()
    if (await question.count() && !(allowClarification && await question.getAttribute('aria-label') === 'CLI 提问')) await answerUnexpectedQuestion(run, question)
    const errors = await chat(run).getByRole('alert').allTextContents()
    if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`)
    await run.page.waitForTimeout(250)
  }
  throw new Error(`${name}: the real UI did not reach this boundary in ${timeoutMs} ms; no retry was attempted`)
}
export async function saveVisualReview(run: NativeRun, step: string, locator: Locator) {
  const text = await locator.innerText()
  const bounds = await locator.boundingBox()
  if (!text.trim() || !bounds || bounds.width < 8 || bounds.height < 8) throw new Error(`${step}: the review surface is not actually visible`)
  const screenshot = join(run.runRoot, `${step}.png`)
  await locator.screenshot({ path: screenshot, animations: 'allow' })
  writeFileSync(join(run.runRoot, `${step}.review.json`), JSON.stringify({ capturedAt: new Date().toISOString(), text, bounds, screenshot,
    review: 'The driver read the actual UI before continuing; semantic and visual Owner review remains required.' }, null, 2))
  return text
}

export async function verifyButtonClick(run: NativeRun, expected: 'broken' | 'repaired', name: string, leaveRunning = false) {
  await openSurface(run, 'slide-scene')
  const edit = run.page.getByRole('button', { name: '编辑状态', exact: true })
  if (await edit.getAttribute('aria-pressed') === 'true') await run.page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
  else {
    const trial = run.page.getByRole('button', { name: '当前位置试运行', exact: true })
    if (await trial.getAttribute('aria-pressed') !== 'true') await trial.click()
  }
  const button = run.page.getByRole('button', { name: '显示答案', exact: true })
  await expect(button).toBeVisible()
  await expect(run.page.getByText('答案尚未显示', { exact: true })).toBeVisible()
  await run.page.screenshot({ path: join(run.runRoot, `${name}-before-click.png`), animations: 'allow' })
  if (expected === 'broken') {
    const bounds = await button.boundingBox()
    if (!bounds) throw new Error('The broken button has no visible bounds for a real user click')
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const hit = await run.page.evaluate(point => document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 1000) ?? null, point)
    writeFileSync(join(run.runRoot, `${name}-click.json`), JSON.stringify({ point, bounds, hit, method: 'actual mouse click at visible button center' }, null, 2))
    // A broken interactive surface can itself intercept the click. Reproduce a
    // real user's attempt; repaired content must pass normal actionability.
    await run.page.mouse.click(point.x, point.y)
  } else await button.click()
  if (expected === 'broken') {
    await run.page.waitForTimeout(500)
    await expect(run.page.getByText('答案尚未显示', { exact: true })).toBeVisible()
    await expect(run.page.getByText('正确答案：周期是完成一次往复运动所用的时间。', { exact: true })).toHaveCount(0)
  } else await expect(run.page.getByText('正确答案：周期是完成一次往复运动所用的时间。', { exact: true })).toBeVisible()
  await run.page.screenshot({ path: join(run.runRoot, `${name}-after-click.png`), animations: 'allow' })
  await expectBackgroundWindowsIsolated(run.app, true)
  if (!leaveRunning) await edit.click()
}

export async function verifyPublishedControls(run: NativeRun, name: string) {
  await run.page.getByRole('button', { name: '整课预览', exact: true }).click()
  const overlay = run.page.getByTestId('course-preview-overlay')
  try {
    const control = overlay.getByRole('button', { name: '缩放', exact: true })
    await expect(control).toBeVisible(); await control.click()
    await expect(overlay.getByRole('button', { name: '恢复视图', exact: true })).toBeVisible()
    await run.page.screenshot({ path: join(run.runRoot, `${name}-controls.png`), animations: 'allow' })
    await expectBackgroundWindowsIsolated(run.app, true)
  } finally { await overlay.getByRole('button', { name: '关闭预览', exact: true }).click() }
}

export async function waitReviewedPreviews(run: NativeRun, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let reviews = 0
  while (Date.now() < deadline) {
    const preview = chat(run).getByRole('region', { name: '候选变更预览' })
    if (await preview.count()) {
      await expect(preview.getByTestId('generation-candidate-player')).toHaveAttribute('data-candidate-ready', 'true', { timeout: 60000 })
      await saveVisualReview(run, `T12-preview-${++reviews}`, preview)
      await expect(preview.getByRole('img', { name: '发送请求时的课件画面' })).toBeVisible()
      await preview.getByRole('button', { name: '应用候选', exact: true }).click()
      await expect(preview).toHaveCount(0)
    }
    const question = chat(run).locator('section.native-agent-question').first()
    if (await question.count()) await answerUnexpectedQuestion(run, question)
    const errors = await chat(run).getByRole('alert').allTextContents()
    if (errors.length) throw new Error(`T12: ${errors.join('\n')}`)
    if (!(await chat(run).getByRole('button', { name: '停止', exact: true }).isEnabled())) {
      const notice = await chat(run).locator('.chat-scroll > [role="status"]').innerText()
      if (/未完成|未全部完成|已停止|失败|过期/.test(notice)) throw new Error(`T12: ${notice}`)
      expect(reviews, 'At least one actual candidate was reviewed before applying').toBeGreaterThan(0)
      await recordEvidence(run, 'T12-applied')
      return reviews
    }
    await run.page.waitForTimeout(250)
  }
  throw new Error('T12: reviewed candidate loop exceeded its fixed budget')
}

export async function assertSavedUnchanged(run: NativeRun, step: string, before: CourseProjectArchiveData) {
  const after = await saveStage(run, step)
  expect(after.project).toEqual(before.project)
  expect(after.assetFiles).toEqual(before.assetFiles)
  expect(after.componentFiles).toEqual(before.componentFiles)
  return after
}

export async function importAndReferenceMaterial(run: NativeRun, cli: NativeCli, model: string, effort: string) {
  const previous = await selectedRecord(run)
  await chat(run).getByRole('button', { name: '关闭', exact: true }).click()
  await run.page.getByLabel('创作工具', { exact: true }).click()
  await run.page.getByRole('menuitem', { name: /教学材料库/ }).click()
  const library = run.page.getByRole('dialog', { name: '教学材料库', exact: true })
  await library.getByLabel('标题', { exact: true }).fill(MATERIAL_FIXTURE.title)
  await library.getByLabel('来源定位', { exact: true }).fill(MATERIAL_FIXTURE.locator)
  await library.getByLabel('材料正文', { exact: true }).fill(MATERIAL_FIXTURE.text)
  await library.getByRole('button', { name: '保存文本材料', exact: true }).click()
  const saved = library.getByRole('listitem').filter({ hasText: MATERIAL_FIXTURE.title })
  await expect(saved).toHaveCount(1)
  await expect(saved).toContainText(MATERIAL_FIXTURE.text)
  await expect(library.getByRole('alert')).toHaveCount(0)
  await saveVisualReview(run, 'T050-material-library', library)
  await library.getByRole('button', { name: '关闭', exact: true }).click()
  // The real panel reloads the actual project material library when it mounts.
  await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
  await chat(run).getByLabel('CLI', { exact: true }).selectOption(cli)
  await chat(run).getByLabel('会话', { exact: true }).selectOption(previous.id)
  await configureRemainingModel(run, model, effort)
  await chat(run).getByLabel('本轮引用', { exact: true }).selectOption('page')
  await chat(run).getByLabel('意图', { exact: true }).selectOption('edit')
  await chat(run).getByLabel('应用方式', { exact: true }).selectOption('auto')
  await chat(run).getByText('引用教学材料（0）', { exact: true }).click()
  await chat(run).getByLabel(MATERIAL_FIXTURE.title, { exact: true }).check()
  await expect(chat(run).getByText('引用教学材料（1）', { exact: true })).toBeVisible()
  await expectBackgroundWindowsIsolated(run.app, true)
  return previous.externalSessionId!
}

export async function recordMaterialObservation(run: NativeRun, step: string, expectedLocationId: string) {
  const record = await selectedRecord(run), task = record.tasks.at(-1)!
  const observations = record.observations.filter(observation => observation.taskId === task.taskId)
  expect(observations.length, 'The material task needs its own immutable UI observation').toBeGreaterThan(0)
  const repository = new LocalAgentRepository(run.userData)
  const evidence = []
  const toolTrace = record.events.filter((event): event is Extract<LocalAgentRecordV2['events'][number], { kind: 'tool' }> =>
    event.kind === 'tool' && event.taskId === task.taskId)
  const materialReference = materialRecordV1Schema.omit({ text: true }).extend({
    textFile: z.string().min(1), textByteLength: z.number().int().nonnegative(),
  }).strict()
  const materialReadIds = new Set<string>()
  for (const observation of observations) {
    expect(observation.locationId).toBe(expectedLocationId)
    const request = await repository.readGenerationRequest(record.workspace, record.workingDirectoryId, observation.observationId)
    if (!request) throw new Error('The actual material generation request was not retained in its observation directory')
    const context = request.context
    if (!context || typeof context !== 'object' || Array.isArray(context) || !Array.isArray(context.materials)) {
      throw new Error('The actual immutable request does not contain the GUI-selected material')
    }
    const references = context.materials.map(value => materialReference.parse(value))
    const reference = references.find(value => value.title === MATERIAL_FIXTURE.title)
    expect(reference).toBeTruthy()
    expect(reference!.textFile).toBe(`resources/materials/${encodeURIComponent(reference!.id)}.txt`)
    const materialFile = observation.files.find(file => file.relativePath === reference!.textFile.slice('resources/'.length))
    expect(materialFile?.role).toBe('material')
    expect(materialFile!.byteLength).toBe(reference!.textByteLength)
    const absolutePath = join(repository.observationPath(record.workspace, record.workingDirectoryId, observation.observationId), materialFile!.relativePath)
    const text = readFileSync(absolutePath, 'utf8')
    expect(text).toBe(MATERIAL_FIXTURE.text)
    expect(Buffer.byteLength(text, 'utf8')).toBe(reference!.textByteLength)
    const { textFile, textByteLength, ...metadata } = reference!
    const material = materialRecordV1Schema.parse({ ...metadata, text })
    expect(material.source).toEqual({ kind: 'text', locator: MATERIAL_FIXTURE.locator })
    expect(material.workspace).toEqual(record.workspace)
    for (const event of toolTrace) {
      const detail = JSON.stringify({ name: event.name, detail: event.detail })
      if (detail.includes(`${reference!.id}.txt`) && /\bread\b|Get-Content|ReadAllText|readFile|read_text|\bcat\b|open\s*\(/i.test(detail)) materialReadIds.add(event.itemId)
    }
    evidence.push({ observation, requestId: request.requestId, reference, absolutePath, material })
  }
  const completedReads = toolTrace.filter(event => materialReadIds.has(event.itemId) && event.status === 'completed')
  writeFileSync(join(run.runRoot, `${step}.material-observations.json`), JSON.stringify({
    sessionId: record.id, externalSessionId: record.externalSessionId, taskId: task.taskId, evidence, toolTrace, completedReads,
    provenance: 'Read-only inspection of actual durable requests and complete material files after UI import/reference. Material text is read on demand by the native CLI; no request/candidate is injected.',
  }, null, 2))
  if (step === 'T050-generated') expect(completedReads.length,
    'The generation turn must retain a completed native tool read of the actual material file').toBeGreaterThan(0)
}

/** The picker selects a unique destination; export, packing and offline playback
 * are the actual product paths. A previous file cannot satisfy this proof. */
export async function verifyFreshRemainingHtml(run: NativeRun, final: CourseProjectArchiveData, materialSurfaceId: string) {
  const htmlPath = join(run.runRoot, 'remaining-final.html')
  expect(existsSync(htmlPath), 'A final export must not reuse an older HTML file').toBe(false)
  if (await chat(run).count()) await chat(run).getByRole('button', { name: '关闭', exact: true }).click()
  await run.app.evaluate(({ dialog }, file) => {
    const state = globalThis as typeof globalThis & { __r18RemainingSaveDialog?: typeof dialog.showSaveDialog }
    state.__r18RemainingSaveDialog = dialog.showSaveDialog
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = (args.length === 1 ? args[0] : args[1]) as { title?: string }
      if (options.title?.includes('HTML')) return { canceled: false, filePath: file }
      return Reflect.apply(state.__r18RemainingSaveDialog!, dialog, args)
    }) as typeof dialog.showSaveDialog
  }, htmlPath)
  const startedAt = Date.now()
  try {
    await run.page.getByTestId('export-menu-trigger').click()
    await run.page.getByTestId('export-single-html').click()
    const preflight = run.page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(preflight).toContainText('0 个错误')
    await preflight.getByRole('button', { name: '继续导出', exact: true }).click()
    await expect.poll(() => {
      if (!existsSync(htmlPath)) return false
      const html = readFileSync(htmlPath, 'utf8')
      return html.includes(MATERIAL_FIXTURE.revisedTitle) && html.includes(MATERIAL_FIXTURE.text) && html.includes(MANUAL_AFTER_AI)
    }, { timeout: 60000 }).toBe(true)
  } finally {
    await run.app.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { __r18RemainingSaveDialog?: typeof dialog.showSaveDialog }
      if (state.__r18RemainingSaveDialog) dialog.showSaveDialog = state.__r18RemainingSaveDialog
      delete state.__r18RemainingSaveDialog
    })
  }
  await expectBackgroundWindowsIsolated(run.app, true)
  expect(readSaved(run.projectPath)).toEqual(final)
  return verifyRemainingOfflineHtml(htmlPath, final, materialSurfaceId, run.runRoot, startedAt)
}

/** Read an actual product export without re-exporting or invoking any CLI. */
export async function verifyRemainingOfflineHtml(htmlPath: string, final: CourseProjectArchiveData, materialSurfaceId: string,
  runRoot: string, startedAt = Date.now()) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.setDefaultTimeout(10000)
  const pageErrors: string[] = [], requests: string[] = []
  const proof: Record<string, unknown> = { htmlPath, startedAt, htmlBytes: statSync(htmlPath).size,
    sourceRevision: final.project.revision, pageErrors, externalRequests: requests, status: 'running' }
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()) })
  const controllerActions: unknown[] = []
  proof.controllerActions = controllerActions
  const clickController = async (label: string) => {
    const button = page.getByRole('button', { name: label, exact: true })
    await expect(button).toBeVisible(); await expect(button).toBeEnabled()
    await button.scrollIntoViewIfNeeded()
    const bounds = await button.boundingBox()
    if (!bounds) throw new Error(`The actual teacher control has no visible bounds: ${label}`)
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const action: Record<string, unknown> = { label, bounds, point, method: 'real mouse click at visible control center' }
    controllerActions.push(action)
    await expect.poll(async () => {
      const hit = await button.evaluate((element, point) => {
        const target = element.ownerDocument.elementFromPoint(point.x, point.y), owner = element.closest('nav')
        return { belongsToController: target === element || !!owner && (target === owner || target?.closest('nav') === owner),
          tag: target?.tagName, role: target?.getAttribute('aria-label'), html: target?.outerHTML.slice(0, 700) }
      }, point)
      action.hit = hit
      return hit.belongsToController
    }, { message: 'The real pointer must reach this control or its formal delegated nav owner', timeout: 10000 }).toBe(true)
    // TeacherControllerDom routes painted-button gestures through its nav
    // owner; the child buttons intentionally have pointer-events:none.
    await page.mouse.click(point.x, point.y)
  }
  try {
    await page.context().setOffline(true)
    await page.goto(pathToFileURL(htmlPath).href)
    await expect.poll(() => page.evaluate(() => window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex())).toBe(0)
    await expect(page.locator(`[data-slide-layer-item="${FIXTURE_IDS.title}"]`)).toHaveText(MANUAL_AFTER_AI)
    const paintedImage = page.locator(`[data-slide-layer-item="${FIXTURE_IDS.image}"]`)
    await expect(paintedImage).toBeVisible()
    await expect.poll(async () => {
      return paintedImage.locator('img').evaluateAll(images => images.length > 0
        && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))
    }).toBe(true)
    const pixels = await paintedImage.screenshot({ path: join(runRoot, 'T050-html-green-image.png') })
    const raw = await sharp(pixels).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let green = 0, red = 0, white = 0
    for (let i = 0; i < raw.data.length; i += 4) {
      const r = raw.data[i]!, g = raw.data[i + 1]!, b = raw.data[i + 2]!
      if (g > r + 30 && g > b + 20) green++
      if (r > g + 40 && r > b + 40) red++
      if (Math.min(r, g, b) > 225) white++
    }
    expect(green).toBeGreaterThan(1000); expect(red).toBeLessThan(green * .05); expect(white).toBeGreaterThan(100)
    proof.renderedImagePixels = { green, red, white, width: raw.info.width, height: raw.info.height }
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await expect(page.getByText('正确答案：周期是完成一次往复运动所用的时间。', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(runRoot, 'T050-html-final-original-page.png'), animations: 'allow' })
    const targetIndex = final.project.locations.findIndex(location => location.surfaceId === materialSurfaceId)
    expect(targetIndex).toBeGreaterThan(0)
    // Navigate through the real teacher controls, including the Flow/Spatial
    // transitions. The public index API is observed only to await completion.
    for (let index = 1; index <= targetIndex; index++) {
      const expand = page.getByRole('button', { name: '展开教师控制器', exact: true })
      if (await expand.isVisible()) await clickController('展开教师控制器')
      await expect(page.getByRole('button', { name: '下一场景', exact: true })).toBeVisible()
      await clickController('下一场景')
      await expect.poll(() => page.evaluate(() => window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex())).toBe(index)
    }
    const texts = materialTexts(final.project, materialSurfaceId)
    for (const text of texts) await expect(page.locator(`[data-slide-layer-item="${text.layerItemId}"]`)).toBeVisible()
    await expect(page.getByText(MATERIAL_FIXTURE.revisedTitle, { exact: true })).toBeVisible()
    const renderedText = (await page.locator('[data-native-type="text"]:visible').allTextContents()).join('')
    expect(renderedText.replace(/\s+/g, '')).toContain(MATERIAL_FIXTURE.text.replace(/\s+/g, ''))
    proof.renderedMaterialText = renderedText
    await page.screenshot({ path: join(runRoot, 'T050-html-material-page.png'), animations: 'allow' })
    expect(pageErrors).toEqual([]); expect(requests).toEqual([])
    proof.status = 'passed-awaiting-visual-and-semantic-review'
    return proof
  } catch (error) {
    proof.status = 'failed'; proof.failure = error instanceof Error ? error.stack : String(error)
    await page.screenshot({ path: join(runRoot, 'T050-html-failure.png') }).catch(() => {})
    throw error
  } finally {
    writeFileSync(join(runRoot, 'T050-fresh-html.json'), JSON.stringify(proof, null, 2))
    await browser.close()
  }
}
