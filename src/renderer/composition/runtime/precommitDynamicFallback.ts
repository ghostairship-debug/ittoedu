import { nanoid } from 'nanoid'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { DocumentOperationResult, DocumentSnapshot } from '../../../shared/workbench/document'
import { CourseV9Driver } from '../../../core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../../core/drivers/course/layerProperties'
import { componentPackagesFromArchive } from '../../components/componentPackageStore'
import { capturePublishedCourseV2Stage } from '../../export/playerCapture'
import { buildPublishedCourseTryRunPayload } from '../../ui/coursePlayerTryRun'
import { DocumentExactAckUnknownError, type DocumentProjection } from '../../documents/DocumentProjection'
import { assertDynamicFallbackTarget, planDynamicFallbackIntent, type DynamicFallbackIntent } from './precommitDynamicFallbackPlan'

export type { DynamicFallbackIntent } from './precommitDynamicFallbackPlan'
export type DynamicFallbackResult =
  | { readonly status: 'applied'; readonly receipt: Extract<DocumentOperationResult, { revision: number }> }
  | { readonly status: 'unchanged'; readonly receipt: null }
  | { readonly status: 'failed' | 'conflict' | 'blocked' | 'unknown'; readonly taskId: string; readonly reason: string }
export interface DynamicFallbackTaskHandle { readonly taskId: string; readonly settled: Promise<DynamicFallbackResult> }
export interface DynamicFallbackTaskState { readonly taskId: string; readonly itemId: string; readonly status: 'queued' | 'planning' | 'capturing' | 'sending' | 'done' | 'failed' | 'conflict' | 'blocked' | 'unknown'; readonly reason?: string }

type Captured = { meta: AssetMeta; bytes: Uint8Array }
type CourseModel = Extract<DocumentSnapshot['model'], { kind: 'course-v9' }>
interface Task extends DynamicFallbackTaskState {
  readonly intent: DynamicFallbackIntent
  status: DynamicFallbackTaskState['status']
  reason?: string
  resolve(result: DynamicFallbackResult): void
  settled: Promise<DynamicFallbackResult>
  ackUnknown?: boolean
  prepared?: { snapshot: DocumentSnapshot; command: { type: 'course.replace'; project: CourseModel['project']; resources: CourseModel['resources'] }; operationId: string }
}
interface Queue {
  readonly documentId: string
  readonly epoch: string
  readonly projection: DocumentProjection
  readonly release: () => void
  readonly tasks: Task[]
  expectedRevision: number
  baseRevision: number
  ownRevision: number
  readonly externalAtReserve: number
  baselineReady: boolean
  running: boolean
  idle?: Promise<void>
  resolveIdle?: () => void
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 24) throw new Error('静态后备图 PNG 无效')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
function pngBytes(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('静态截图没有返回 PNG')
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** Capture the planned candidate, including the semantic text/image change, before any Main write. */
export async function capturePrecommitDynamicFallback(model: CourseModel, intent: DynamicFallbackIntent): Promise<Captured> {
  const location = model.project.locations.find(value => value.id === intent.locationId)
  if (!location) throw new Error('截图页面已不存在')
  const payload = buildPublishedCourseTryRunPayload({ project: model.project, assetFiles: model.resources.assets,
    components: componentPackagesFromArchive(model.project, model.resources.components) })
  const dataUrl = await capturePublishedCourseV2Stage({ payload, locationId: intent.locationId, surfaceId: location.surfaceId,
    layerItemId: intent.itemId, includeGlobalLayerItems: true })
  const bytes = pngBytes(dataUrl), id = `fallback-${intent.itemId}-${nanoid(8)}`
  return { bytes, meta: { id, filename: `${id}.png`, mimeType: 'image/png', kind: 'image', path: `assets/${id}.png`,
    byteLength: bytes.byteLength, ...pngSize(bytes) } }
}

function completedCandidate(snapshot: DocumentSnapshot, intent: DynamicFallbackIntent, candidate: CourseModel, image: Captured | null): CourseModel {
  if (snapshot.model.kind !== 'course-v9') throw new Error('目标不是课件')
  const model = structuredClone(candidate)
  if (image) {
    if (Object.hasOwn(model.project.assets, image.meta.id) || Object.hasOwn(model.resources.assets, image.meta.id)) throw new Error('静态图片编号冲突')
    const located = locateCourseLayer(model.project, intent.itemId)
    if (!located || (located.item.kind !== 'runtime' && located.item.kind !== 'component')) throw new Error('程序截图目标已不存在')
    if (located.item.kind === 'runtime') {
      if (!located.item.runtime.staticFallback) throw new Error('Runtime 后备图已改变')
      located.item.runtime.staticFallback.assetId = image.meta.id
    } else {
      if (!located.item.staticFallbackAssetId) throw new Error('组件后备图已改变')
      located.item.staticFallbackAssetId = image.meta.id
    }
    model.project.assets[image.meta.id] = image.meta
    model.resources.assets[image.meta.id] = image.bytes
  }
  // CourseV9Driver requires the command's project revision to equal its exact base.
  model.project.revision = snapshot.model.project.revision
  new CourseV9Driver().validate(model)
  return model
}

const unfinished = (task: Task) => task.status !== 'done'
const actionable = (task: Task) => task.status === 'queued' || task.status === 'planning' || task.status === 'capturing' || task.status === 'sending'

/** Per-document authoring queue. It owns only transient intents; Main remains the document and History writer. */
export class PrecommitDynamicFallback {
  private readonly queues = new Map<string, Queue>()
  private readonly allTasks = new Map<string, Task>()
  constructor(private readonly capture: (model: CourseModel, intent: DynamicFallbackIntent) => Promise<Captured> = capturePrecommitDynamicFallback) {}

  submit(projection: DocumentProjection, input: DynamicFallbackIntent): DynamicFallbackTaskHandle {
    const intent = structuredClone(input)
    const current = projection.read().committed
    if (!current || current.documentId !== intent.documentId || current.model.kind !== 'course-v9'
      || current.model.project.id !== intent.projectId || !projection.read().connected) throw new Error('动态编辑目标文档未连接')
    let queue = this.queues.get(intent.documentId)
    if (!queue) {
      const release = projection.reservePrecommit()
      queue = { documentId: intent.documentId, epoch: current.epoch, projection, release, tasks: [],
        baseRevision: current.revision, expectedRevision: current.revision, ownRevision: current.revision,
        externalAtReserve: projection.precommitExternalChangeCount(), baselineReady: projection.read().pending.length === 0,
        running: false }
      this.queues.set(intent.documentId, queue)
    } else if (queue.projection !== projection || queue.epoch !== current.epoch) throw new Error('动态编辑文档会话已替换')
    const taskId = crypto.randomUUID()
    let resolve!: (value: DynamicFallbackResult) => void
    const settled = new Promise<DynamicFallbackResult>(done => { resolve = done })
    const task: Task = { taskId, intent, itemId: intent.itemId, status: 'queued', resolve, settled }
    queue.tasks.push(task); this.allTasks.set(taskId, task)
    if (queue.tasks.some(value => value !== task && ['failed', 'conflict', 'unknown', 'blocked'].includes(value.status))) {
      task.status = 'blocked'; task.reason = '前序动态编辑需要重试或放弃'
      resolve({ status: 'blocked', taskId, reason: task.reason })
    } else this.start(queue)
    return { taskId, settled }
  }

  state(documentId: string): readonly DynamicFallbackTaskState[] {
    return this.queues.get(documentId)?.tasks.map(({ taskId, itemId, status, reason }) =>
      ({ taskId, itemId, status, ...(reason ? { reason } : {}) })) ?? []
  }
  pendingCount(documentId: string): number { return this.queues.get(documentId)?.tasks.filter(unfinished).length ?? 0 }
  assertReady(documentId: string): void {
    const task = this.queues.get(documentId)?.tasks.find(unfinished)
    if (task) throw new Error(task.reason ?? '动态内容及静态后备图尚未完成，请等待或处理保留的草稿')
  }
  async wait(documentId: string): Promise<void> {
    for (;;) {
      const queue = this.queues.get(documentId)
      if (!queue) return
      if (queue.idle) await queue.idle
      const active = queue.tasks.find(actionable)
      if (!active) { this.assertReady(documentId); return }
    }
  }
  async retry(taskId: string): Promise<DynamicFallbackResult> {
    const task = this.allTasks.get(taskId)
    if (!task || !['failed', 'conflict', 'blocked', 'unknown'].includes(task.status)) throw new Error('没有可重试的动态编辑草稿')
    const queue = this.queues.get(task.intent.documentId)
    if (!queue || queue.tasks.some(value => value !== task && value.status !== 'done' && queue.tasks.indexOf(value) < queue.tasks.indexOf(task)))
      throw new Error('请先处理更早的动态编辑草稿')
    if (task.status === 'conflict') {
      const current = await queue.projection.drainForPrecommit()
      if (current.epoch !== queue.epoch) throw new Error('文档会话已替换，请放弃旧草稿后重新编辑')
      queue.baseRevision = current.revision
      queue.expectedRevision = current.revision
      queue.ownRevision = current.revision
      queue.baselineReady = true
    }
    let resolve!: (value: DynamicFallbackResult) => void
    if (task.status !== 'unknown') task.prepared = undefined
    task.settled = new Promise(done => { resolve = done }); task.resolve = resolve
    task.status = 'queued'; task.reason = undefined
    this.start(queue)
    return task.settled
  }
  discard(taskId: string): void {
    const task = this.allTasks.get(taskId), queue = task && this.queues.get(task.intent.documentId)
    if (!task || !queue || actionable(task) || task.status === 'unknown') throw new Error('只能放弃已明确未写入的动态编辑草稿；回执未知时请先重试核实')
    queue.tasks.splice(queue.tasks.indexOf(task), 1)
    this.allTasks.delete(taskId)
    this.releaseIfClear(queue)
  }

  private start(queue: Queue): void {
    if (queue.running) return
    const first = queue.tasks.find(task => task.status === 'queued')
    if (!first) return
    queue.running = true
    queue.idle = new Promise(done => { queue.resolveIdle = done })
    void this.run(queue).finally(() => {
      queue.running = false; queue.resolveIdle?.(); queue.idle = undefined; queue.resolveIdle = undefined
      this.start(queue)
      this.releaseIfClear(queue)
    })
  }
  private async run(queue: Queue): Promise<void> {
    for (const task of queue.tasks) {
      if (task.status !== 'queued') continue
      try {
        const snapshot = task.prepared?.snapshot ?? await queue.projection.drainForPrecommit()
        if (!queue.baselineReady) {
          if (queue.projection.precommitExternalChangeCount() !== queue.externalAtReserve)
            throw new Error('文档已在其他位置改变，语义意图未提交')
          queue.baseRevision = snapshot.revision
          queue.expectedRevision = snapshot.revision
          queue.ownRevision = snapshot.revision
          queue.baselineReady = true
        }
        if (snapshot.epoch !== queue.epoch || snapshot.revision !== queue.expectedRevision) throw new Error('文档已在其他位置改变，语义意图未提交')
        let prepared = task.prepared
        if (!prepared) {
          task.status = 'planning'
          assertDynamicFallbackTarget(snapshot, task.intent)
          const plan = planDynamicFallbackIntent(snapshot, task.intent, new Date().toISOString(),
            queue.ownRevision > queue.baseRevision && snapshot.revision === queue.ownRevision)
          if (!plan) {
            task.status = 'done'; task.resolve({ status: 'unchanged', receipt: null }); continue
          }
          task.status = plan.hasFallback ? 'capturing' : 'sending'
          const image = plan.hasFallback ? await this.capture(plan.model, task.intent) : null
          const candidate = completedCandidate(snapshot, task.intent, plan.model, image)
          prepared = { snapshot, command: { type: 'course.replace', project: candidate.project, resources: candidate.resources },
            operationId: crypto.randomUUID() }
          task.prepared = prepared
        }
        task.status = 'sending'
        const result = await queue.projection.editExact(prepared.snapshot, prepared.command, prepared.operationId)
        if (result.status === 'applied' || result.status === 'unchanged') {
          queue.expectedRevision = result.revision
          queue.ownRevision = result.revision
          task.status = 'done'; task.prepared = undefined; task.ackUnknown = false
          task.resolve({ status: 'applied', receipt: result }); continue
        }
        task.status = result.status === 'conflict' ? 'conflict' : 'failed'
        task.ackUnknown = false
        const reason = 'message' in result ? result.message : '动态编辑被拒绝'
        task.reason = reason
        task.resolve({ status: task.status, taskId: task.taskId, reason })
      } catch (error) {
        task.ackUnknown = task.ackUnknown || error instanceof DocumentExactAckUnknownError
        task.status = task.ackUnknown ? 'unknown'
          : error instanceof Error && (error.message.includes('基准已变化') || error.message.includes('其他位置改变') || error.message.includes('文档会话已改变')) ? 'conflict' : 'failed'
        task.reason = error instanceof Error ? error.message : '动态编辑未提交'
        task.resolve({ status: task.status, taskId: task.taskId, reason: task.reason })
      }
      for (const later of queue.tasks.slice(queue.tasks.indexOf(task) + 1)) if (later.status === 'queued') {
        later.status = 'blocked'; later.reason = '前序动态编辑未提交，后续输入已保留'
        later.resolve({ status: 'blocked', taskId: later.taskId, reason: later.reason })
      }
      return
    }
  }
  private releaseIfClear(queue: Queue): void {
    if (queue.running || queue.tasks.some(unfinished)) return
    for (const task of queue.tasks) this.allTasks.delete(task.taskId)
    queue.release(); this.queues.delete(queue.documentId)
  }
}
