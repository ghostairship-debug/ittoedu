import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentHostService } from '../DocumentHostService'
import type { ExecutionDesktopService } from '../execution/ExecutionDesktopService'
import type { ImageGenerationService } from './ImageGenerationService'
import type { ImageJobSnapshot, ImageModelSelection } from '../../../shared/workbench/images'
import { imageResultsRequestSchema, type ImageResultEvent, type ImageResultOwner, type ImageResultView } from '../../../shared/workbench/imageResultsDesktop'
import type { DocumentOperationResult } from '../../../shared/workbench/document'
import type { ModelToolCall } from '../../../shared/workbench/tools'

type Request = ReturnType<typeof imageResultsRequestSchema.parse>
type ActionRequest = Extract<Request, { type: 'apply' | 'edit' }>
interface Action { version: 1; input: ActionRequest; digest: string; runId: string; source: ImageResultEvent['source']; call?: ModelToolCall; result?: DocumentOperationResult; childJobId?: string }
interface ReleaseIntent { version: 1; workspaceId: string; conversationId: string; runIds: string[] }
export interface ImageResultsDesktopOptions {
  directory: string
  images: ImageGenerationService
  documents: DocumentHostService
  execution: Pick<ExecutionDesktopService, 'conversations' | 'runs' | 'appendExternalEvent'>
  selection(runId: string, operation: 'generate' | 'edit'): ImageModelSelection | Promise<ImageModelSelection>
  onError?(error: unknown): void
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const labels = { preparing: '正在准备图片', running: '正在生成图片', ready: '已生成，尚未应用', unapplied: '任务停止后取得图片，尚未应用', stopped: '已停止', unknown: '结果未知，不自动重试', failed: '图片请求失败' }

/** UI authority is checked against durable conversation ownership, never against a caller-provided path. */
export class ImageResultsDesktopService {
  private sink?: (event: ImageResultEvent) => void
  private readonly pending = new Map<string, { digest: string; promise: Promise<unknown>; workspaceId: string; conversationId: string }>()
  private readonly liveRuns = new Set<string>()
  private readonly ownerCache = new Map<string, ImageResultOwner>()
  private readonly deleting = new Set<string>()
  private tail = Promise.resolve()
  private disposed = false
  private readonly stop: () => void
  private readonly stopSettled: () => void
  constructor(private readonly options: ImageResultsDesktopOptions) {
    this.stop = options.images.subscribe(job => this.enqueue(() => this.publish(job)))
    this.stopSettled = options.images.subscribeSettled(() => this.requestCollect())
    this.requestCollect()
  }
  setEventSink(sink?: (event: ImageResultEvent) => void) { this.sink = sink }
  private report(error: unknown) { try { this.options.onError?.(error) } catch { /* Diagnostics cannot alter a successful operation. */ } }
  private enqueue(work: () => Promise<void>) {
    if (this.disposed) return
    this.tail = this.tail.then(work).catch(error => this.report(error))
  }
  async flush() { await this.tail }
  dispose() { this.disposed = true; this.stop(); this.stopSettled(); this.sink = undefined }
  private actionFile(actionId: string) { return path.join(this.options.directory, `${actionId}.json`) }
  private deletionKey(owner: Pick<ImageResultOwner, 'workspaceId' | 'conversationId'>) { return `${owner.workspaceId}:${owner.conversationId}` }
  private releaseFile(owner: Pick<ImageResultOwner, 'workspaceId' | 'conversationId'>) {
    return path.join(this.options.directory, 'released', `${createHash('sha256').update(this.deletionKey(owner)).digest('hex')}.json`)
  }
  private async releaseIntent(filename: string): Promise<ReleaseIntent | undefined> {
    let value: ReleaseIntent
    try { value = JSON.parse(await fs.readFile(filename, 'utf8')) as ReleaseIntent }
    catch (error) { if (missing(error)) return; throw error }
    if (value.version !== 1 || !value.workspaceId || !value.conversationId || !Array.isArray(value.runIds)
      || value.runIds.some(runId => typeof runId !== 'string' || !runId)
      || this.releaseFile(value) !== filename) throw new Error('图片资源释放记录损坏，已停止清理')
    return value
  }
  /** Called before the durable conversation delete. A surviving conversation keeps every result. */
  async prepareConversationDeletion(input: { workspaceId: string; conversationId: string; runIds: readonly string[] }): Promise<void> {
    const key = this.deletionKey(input), filename = this.releaseFile(input)
    this.deleting.add(key)
    try {
      await Promise.allSettled([...this.pending.values()].filter(item => this.deletionKey(item) === key).map(item => item.promise))
      const prior = await this.releaseIntent(filename)
      const intent: ReleaseIntent = { version: 1, workspaceId: input.workspaceId, conversationId: input.conversationId,
        runIds: [...new Set([...(prior?.runIds ?? []), ...input.runIds])] }
      await fs.mkdir(path.dirname(filename), { recursive: true })
      const temporary = `${filename}.${randomUUID()}.tmp`
      try { const file = await fs.open(temporary, 'wx'); try { await file.writeFile(JSON.stringify(intent)); await file.sync() } finally { await file.close() }; await fs.rename(temporary, filename) }
      finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    } catch (error) { this.deleting.delete(key); throw error }
  }
  abortConversationDeletion(owner: Pick<ImageResultOwner, 'workspaceId' | 'conversationId'>) { this.deleting.delete(this.deletionKey(owner)) }
  requestCollect() { this.enqueue(() => this.collectReleased()) }
  private async collectReleased(): Promise<void> {
    const root = path.join(this.options.directory, 'released')
    const names = await fs.readdir(root).catch(error => { if (missing(error)) return [] as string[]; throw error })
    for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
      const filename = path.join(root, name), intent = await this.releaseIntent(filename)
      if (!intent || await this.options.execution.conversations.readConversation(intent)) continue
      const live = (await Promise.all((await this.options.execution.conversations.listWorkspaces())
        .map(space => this.options.execution.conversations.listConversations(space.workspaceId)))).flat()
      const protectedRuns = new Set(live.flatMap(conversation => [...conversation.runIndex.builtinRunIds, ...conversation.runIndex.externalRunIds]))
      const actions = (await this.actions()).filter(action => action.input.workspaceId === intent.workspaceId && action.input.conversationId === intent.conversationId)
      const released = [...new Set([...intent.runIds, ...actions.map(action => action.runId)])].filter(runId => !protectedRuns.has(runId))
      const result = await this.options.images.releaseRunJobs(released)
      if (result.deferred) continue
      for (const action of actions) await fs.rm(this.actionFile(action.input.actionId), { force: true })
      await fs.rm(filename, { force: true })
      this.deleting.delete(this.deletionKey(intent))
    }
  }
  private async action(actionId: string): Promise<Action | undefined> {
    if (!/^[a-f0-9-]{36}$/i.test(actionId)) return
    try {
      const value = JSON.parse(await fs.readFile(this.actionFile(actionId), 'utf8')) as Action
      const parsed = imageResultsRequestSchema.parse(value.input)
      if (value.version !== 1 || !['apply', 'edit'].includes(parsed.type) || !('actionId' in parsed) || parsed.actionId !== actionId || value.digest !== digest(parsed) || value.runId !== `image-result:${actionId}`) throw new Error('图片操作票据无效，未重新执行')
      return value
    } catch (error) { if (missing(error)) return; throw error }
  }
  private async store(value: Action) {
    await fs.mkdir(this.options.directory, { recursive: true })
    const filename = this.actionFile(value.input.actionId), temporary = `${filename}.${randomUUID()}.tmp`
    try { const file = await fs.open(temporary, 'wx'); try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }; await fs.rename(temporary, filename) }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  private async actions(): Promise<Action[]> {
    let names: string[]
    try { names = await fs.readdir(this.options.directory) } catch (error) { if (missing(error)) return []; throw error }
    const result: Action[] = []
    for (const name of names.filter(value => /^[a-f0-9-]{36}\.json$/i.test(value))) { const value = await this.action(name.slice(0, -5)); if (value) result.push(value) }
    return result
  }
  private async ownership(owner: ImageResultOwner, job: ImageJobSnapshot): Promise<ImageResultEvent['source']> {
    if (owner.runId !== job.runId || owner.jobId !== job.jobId) throw new Error('图片任务与请求身份不一致')
    const conversation = await this.options.execution.conversations.readConversation(owner)
    if (!conversation) throw new Error('图片所属会话已不存在')
    if (conversation.runIndex.builtinRunIds.includes(job.runId)) {
      const run = await this.options.execution.runs.read(job.runId)
      if (!run || run.input.conversationId !== owner.conversationId || !run.input.documents.some(value => value.documentId === job.documentId)) throw new Error('图片运行不属于该会话文档')
      return 'builtin'
    }
    if (conversation.runIndex.externalRunIds.includes(job.runId)) return 'external-mcp'
    if (job.runId.startsWith('image-result:')) {
      const action = await this.action(job.runId.slice('image-result:'.length))
      if (action?.input.type === 'edit' && action.childJobId === job.jobId && action.input.workspaceId === owner.workspaceId && action.input.conversationId === owner.conversationId) {
        const parent = await this.options.images.read(action.input.jobId)
        return this.ownership(action.input, parent)
      }
    }
    throw new Error('图片运行不属于当前会话')
  }
  private async locate(job: ImageJobSnapshot): Promise<ImageResultOwner | undefined> {
    const cached = this.ownerCache.get(job.jobId)
    if (cached) { try { await this.ownership(cached, job); return cached } catch { this.ownerCache.delete(job.jobId); return } }
    if (job.runId.startsWith('image-result:')) {
      const action = await this.action(job.runId.slice('image-result:'.length))
      if (action) {
        const owner = { workspaceId: action.input.workspaceId, conversationId: action.input.conversationId, runId: job.runId, jobId: job.jobId }
        await this.ownership(owner, job); this.ownerCache.set(job.jobId, owner); return owner
      }
    }
    for (const workspace of await this.options.execution.conversations.listWorkspaces()) for (const conversation of await this.options.execution.conversations.listConversations(workspace.workspaceId)) {
      if (!conversation.runIndex.builtinRunIds.includes(job.runId) && !conversation.runIndex.externalRunIds.includes(job.runId)) continue
      const owner = { workspaceId: workspace.workspaceId, conversationId: conversation.conversationId, runId: job.runId, jobId: job.jobId }
      await this.ownership(owner, job); this.ownerCache.set(job.jobId, owner); return owner
    }
  }
  private async publish(job: ImageJobSnapshot) {
    const owner = await this.locate(job)
    if (!owner || this.disposed) return
    const source = await this.ownership(owner, job), event = { ...owner, job, source, userRequested: job.runId.startsWith('image-result:') }
    try { this.sink?.(structuredClone(event)) } catch (error) { this.report(error) }
    await this.options.execution.appendExternalEvent({ eventId: `image:${job.jobId}:${digest(job)}`, itemId: `image:${job.jobId}`,
      conversationId: owner.conversationId, runId: job.runId, taskId: job.jobId, source, type: 'image', update: 'snapshot', time: Date.parse(job.updatedAt),
      data: { jobId: job.jobId, documentId: job.documentId, status: job.status, label: labels[job.status], resourceIds: job.resources.map(resource => resource.resourceId), ...(job.failure ? { error: job.failure.message } : {}) } })
  }
  async read(owner: ImageResultOwner): Promise<ImageResultView> {
    const job = await this.options.images.read(owner.jobId), source = await this.ownership(owner, job)
    this.ownerCache.set(job.jobId, owner)
    const applications = (await this.actions()).filter(action => action.input.type === 'apply' && action.input.jobId === job.jobId && action.input.conversationId === owner.conversationId && action.result)
      .map(action => ({ actionId: action.input.actionId, documentId: (action.input as Extract<ActionRequest, { type: 'apply' }>).target.documentId, result: action.result! }))
    return { workspaceId: owner.workspaceId, conversationId: owner.conversationId, runId: job.runId, job, source, applications, userRequested: job.runId.startsWith('image-result:') }
  }
  async list(owner: Pick<ImageResultOwner, 'workspaceId' | 'conversationId'>): Promise<ImageResultView[]> {
    if (!await this.options.execution.conversations.readConversation(owner)) throw new Error('会话已不存在')
    const results: ImageResultView[] = []
    for (const job of await this.options.images.list()) {
      const located = await this.locate(job)
      if (located?.workspaceId === owner.workspaceId && located.conversationId === owner.conversationId) { results.push(await this.read(located)); this.enqueue(() => this.publish(job)) }
    }
    return results
  }
  async preview(owner: ImageResultOwner & { resourceId: string }) {
    const view = await this.read(owner), resource = view.job.resources.find(value => value.resourceId === owner.resourceId)
    if (!resource) throw new Error('资源不属于该图片成果')
    const image = await this.options.images.readResource(resource.resourceId)
    return { bytes: image.bytes, mimeType: image.mimeType, width: resource.width, height: resource.height }
  }
  async operate(raw: unknown): Promise<unknown> {
    const input = imageResultsRequestSchema.parse(raw)
    if (input.type === 'list') return this.list(input)
    if (input.type === 'read') return this.read(input)
    if (input.type === 'stop') { await this.read(input); await this.options.images.stop(input.jobId); return this.read(input) }
    if (input.type === 'preview') return this.preview(input)
    if (this.deleting.has(this.deletionKey(input))) throw new Error('会话正在删除，图片操作已停止')
    const existing = this.pending.get(input.actionId)
    if (existing) { if (existing.digest !== digest(input)) throw new Error('同一操作编号不能用于不同图片请求'); return existing.promise }
    const work = this.perform(input); this.pending.set(input.actionId, { digest: digest(input), promise: work, workspaceId: input.workspaceId, conversationId: input.conversationId })
    try { return await work } finally { this.pending.delete(input.actionId) }
  }
  private async perform(input: ActionRequest): Promise<unknown> {
    if (input.type === 'apply') {
      if (input.target.address.kind === 'course-owner' && !input.frame) throw new Error('插入图片前请明确画布位置与尺寸')
      if (input.target.address.kind !== 'course-owner' && input.frame) throw new Error('替换图片不接受插入位置与尺寸')
    }
    const view = await this.read(input), image = await this.preview(input)
    const gateway = this.options.documents.tools, prior = await this.action(input.actionId)
    if (prior) {
      if (prior.digest !== digest(input)) throw new Error('同一操作编号不能用于不同图片请求')
      if (input.type === 'edit' && prior.childJobId) return this.read({ ...input, runId: prior.runId, jobId: prior.childJobId })
      if (prior.result) return prior.result
      if (prior.call && input.type === 'apply') {
        if (!this.liveRuns.has(prior.runId)) { gateway.recoverRun({ runId: prior.runId, actor: 'human', documents: [{ documentId: input.target.documentId, writable: [] }] }); this.liveRuns.add(prior.runId) }
        const receipt = await gateway.lookup(prior.runId, input.actionId, prior.call)
        if (receipt?.kind === 'document-operation') { prior.result = receipt.result; await this.store(prior); return receipt.result }
      }
      throw new Error('上次图片操作结果未知；未重新请求模型或重复应用，请重新观察文档。')
    }
    const documentId = input.type === 'apply' ? input.target.documentId : view.job.documentId
    const current = await this.options.documents.registry.get(documentId).drain()
    if (input.type === 'apply' && (current.epoch !== input.target.epoch || current.revision !== input.target.revision)) throw new Error('目标文档已改变，请重新选择图片应用位置')
    const action: Action = { version: 1, input, digest: digest(input), runId: `image-result:${input.actionId}`, source: view.source }
    if (input.type === 'edit') action.childJobId = `image-edit:${input.actionId}`
    await this.store(action)
    await gateway.beginRun({ runId: action.runId, actor: 'human', documents: [{ documentId, writable: input.type === 'apply' ? [input.target.address] : [] }] }); this.liveRuns.add(action.runId)
    try {
      const resource = await gateway.provideImage(action.runId, documentId, { ...image, filename: `${input.resourceId}.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1]}` })
      if (input.type === 'edit') {
        const selection = await this.options.selection(action.runId, 'edit')
        await this.options.images.run({ jobId: action.childJobId!, runId: action.runId, documentId, operation: 'edit', prompt: input.prompt, selection, referenceIds: [resource] })
        return this.read({ ...input, runId: action.runId, jobId: action.childJobId! })
      }
      const latest = await this.options.documents.registry.get(documentId).drain()
      if (latest.epoch !== input.target.epoch || latest.revision !== input.target.revision) throw new Error('准备图片期间目标已改变，请重新选择')
      const target = await gateway.issueTarget(action.runId, documentId, input.target.address)
      action.call = input.target.address.kind === 'course-owner' ? { name: 'media.insert', input: { target, resource, properties: { label: '生成图片', fit: 'contain', ...input.frame } } } : { name: 'media.apply', input: { target, resource } }
      await this.store(action)
      const result = await gateway.execute(action.runId, input.actionId, action.call)
      if (result.kind !== 'document-operation') throw new Error(result.kind === 'error' ? result.message : '图片操作未返回正式文档回执')
      action.result = result.result; await this.store(action)
      if ('revision' in result.result) await this.options.execution.appendExternalEvent({ eventId: `image-apply:${input.actionId}`, itemId: `image-apply:${input.actionId}`, conversationId: input.conversationId, runId: input.runId, taskId: input.jobId, source: view.source,
        type: 'document.commit', update: 'snapshot', time: Date.now(), data: { label: '用户应用图片', documentId, revision: result.result.revision, operationId: result.result.operationId, applicationStatus: result.result.status, jobId: input.jobId } }).catch(error => this.report(error))
      return result.result
    } finally { await gateway.stop(action.runId).catch(error => this.report(error)) }
  }
}
