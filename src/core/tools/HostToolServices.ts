import { z } from 'zod'
import type { DocumentOperation, DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolDefinition, ToolResult, ToolTarget, ToolRunGrant } from '../../shared/workbench/tools'
import type { ImageGenerationRequest, ImageJobSnapshot, ImageModelSelection } from '../../shared/workbench/images'
import { buildToolCallSchema, type BuildCreateTicket, type BuildCreateLookup, type BuildBudget, type BuildImportArtifact, type BuildJobInput, type BuildJobSnapshot, type BuildToolCall } from '../../shared/workbench/build'
import type { HostImageInput } from './imageResource'
import { DocumentRegistry } from '../documents/DocumentRegistry'
import { documentDigest } from '../documents/documentDigest'

/** Main supplies real services. Neither their implementations nor credentials enter core. */
export interface HostToolServices {
  /** Freeze role/connection selections before the run can issue any service operation. */
  beginRun?(grant: ToolRunGrant): Promise<void>
  images?: {
    selection(runId: string, documentId: string, operation: 'generate' | 'edit'): ImageModelSelection | Promise<ImageModelSelection>
    run(request: ImageGenerationRequest, options?: { signal?: AbortSignal }): Promise<ImageJobSnapshot>
    read(jobId: string): Promise<ImageJobSnapshot>
    stop(jobId: string): Promise<ImageJobSnapshot>
    readResource(resourceId: string): Promise<HostImageInput>
    readReadyResourceFromJob?(input: { jobId: string; sourceRunId: string; sourceDocumentId: string; resourceId: string }): Promise<HostImageInput>
  }
  builds?: {
    create(input: BuildJobInput, ticket: BuildCreateTicket): Promise<BuildJobSnapshot>
    lookupCreate(runId: string, ticket: BuildCreateTicket): Promise<BuildCreateLookup | null>
    execute(runId: string, call: BuildToolCall): Promise<unknown>
    artifact(runId: string, jobId: string, artifactId: string): Promise<BuildImportArtifact>
    cancelRun(runId: string): Promise<unknown>
    policy?(runId: string, documentId: string): { allowedOrigins: readonly string[]; budget?: Partial<BuildBudget> } | Promise<{ allowedOrigins: readonly string[]; budget?: Partial<BuildBudget> }>
  }
}
const handle = z.string().min(1).max(512)
// The currently supported OAuth and OpenAI-compatible Images routes accept these
// common request options; decoding still preserves the actual raster format.
const output = z.object({ size: z.union([z.literal('auto'), z.string().regex(/^\d{2,5}x\d{2,5}$/)]).optional(), quality: z.enum(['auto', 'low', 'medium', 'high']).optional(), format: z.literal('png').optional(), background: z.enum(['auto', 'opaque', 'transparent']).optional() }).strict()
const imageInput = z.object({ target: handle, prompt: z.string().min(1).max(200_000), output: output.optional() }).strict()
const schema = {
  'image.generate': imageInput,
  'image.edit': imageInput.extend({ references: z.array(handle).min(1).max(5) }).strict(),
  'image.status': z.object({ job: handle }).strict(),
  'build.create': z.object({ target: handle }).strict(),
  'build.read': buildToolCallSchema.options[1].omit({ type: true, jobId: true }).extend({ job: handle, path: buildToolCallSchema.options[1].shape.path.optional() }).strict(),
  'build.write': buildToolCallSchema.options[2].omit({ type: true, jobId: true }).extend({ job: handle }).strict(),
  'build.compile': buildToolCallSchema.options[3].omit({ type: true, jobId: true }).extend({ job: handle }).strict(),
  'build.check': buildToolCallSchema.options[4].omit({ type: true, jobId: true }).extend({ job: handle }).strict(),
  'build.logs': buildToolCallSchema.options[5].omit({ type: true, jobId: true }).extend({ job: handle }).strict(),
  'build.import': z.object({ job: handle, artifact: handle }).strict(),
} as const
export type HostToolName = keyof typeof schema
const descriptions: Record<HostToolName, string> = {
  'image.generate': '通过任务开始时冻结的 GPT OAuth 或已显式启用的 OpenAI Images API 连接生成真实图片，返回持久任务状态和资源短句柄；当前仅接受 PNG 格式和 auto/low/medium/high 画质，不填写 moderation。ready 不是文档提交；插入前检查已有文字和对象的范围，明确 frame 避免遮挡，再使用 media.insert/apply 正式应用。',
  'image.edit': '发送本任务参考图资源句柄的原始字节进行编辑，原件保留；当前仅接受 PNG 格式和 auto/low/medium/high 画质，不填写 moderation。API 路径当前只接受一张参考图；模型不填写供应商、凭据或文件路径；未知结果不自动重发。',
  'image.status': '查询本任务图片状态；准备完成的图片返回本任务/文档资源句柄，不返回 base64 或临时 URL。',
  'build.create': '从有整份文档写权限的 V9 文档句柄建立受管 scratch，冻结当前基线和读集合；不会修改正式文档。',
  'build.read': '读取构建 scratch 的相对路径文件，支持分页；省略 path 列出文件和任务状态。',
  'build.write': '写入受管 scratch 相对路径，现有准入制品随源码变更失效；不能写正式工程或宿主任意路径。',
  'build.compile': '仅对指定 Component/Runtime JavaScript 做语法编译，不执行候选。通过不等于协议、闭包或真实动态准入；继续 build.check。',
  'build.check': '执行正式协议、来源、资源闭包及受影响动态目标的隔离宿主准入，返回可读错误或准备好的 artifact；尚未应用文档。',
  'build.logs': '分页读取构建日志和精确错误，用于同一任务修复；预算或无进展耗尽后停止。',
  'build.import': '导入已准入 artifact，重新验证原 document/epoch/revision/project/digest/readset，资源与内容一次提交和撤销；前提变化即冲突。',
}
export const hostToolCatalog = (Object.keys(schema) as HostToolName[]).map(name => ({ name, description: descriptions[name], inputSchema: schema[name], manual: { label: name, group: (name.endsWith('.read') || name.endsWith('.logs') || name.endsWith('.status') ? 'read' : 'edit') as 'read' | 'edit', targetKinds: (name.startsWith('build.') ? ['document'] : ['document', 'course-owner', 'course-object', 'course-background', 'flow-block']) as ToolDefinition['manual']['targetKinds'] } }))
export const isHostToolName = (name: string): name is HostToolName => Object.hasOwn(schema, name)
interface HostAuthority {
  resolve(runId: string, target: string): Promise<{ snapshot: DocumentSnapshot; target: ToolTarget }>
  resolveImage(runId: string, target: string): Promise<{ snapshot: DocumentSnapshot; target: ToolTarget }>
  active(runId: string, documentId: string, epoch: string): void
  actor(runId: string): DocumentOperation['actor']
  ownsDocument(runId: string, documentId: string): boolean
  provideImage(runId: string, documentId: string, source: HostImageInput): Promise<string>
  readImage(runId: string, documentId: string, resource: string): Promise<HostImageInput>
}
interface Job { runId: string; documentId: string; epoch: string; jobId: string }
interface ImageJob extends Job { kind: 'image'; request: ImageGenerationRequest; controller: AbortController; resources: Map<string, string> }
interface BuildJob extends Job { kind: 'build'; frozen: BuildJobInput }

/** Service work prepares results. Only import executes an acknowledged canonical operation. */
export class HostToolCoordinator {
  private readonly jobs = new Map<string, ImageJob | BuildJob>()
  private readonly results = new Map<string, Promise<ToolResult>>()
  private readonly reissuedImages = new Map<string, Promise<string>>()
  constructor(private services: HostToolServices, private readonly registry: DocumentRegistry, private readonly authority: HostAuthority) {}
  configure(services: HostToolServices) { this.services = services }
  async beginRun(grant: ToolRunGrant) { await this.services.beginRun?.(structuredClone(grant)) }
  supports(name: string) { return !isHostToolName(name) || (name.startsWith('image.') ? !!this.services.images : !!this.services.builds) }
  /** The caller proves sourceRunId belongs to its durable continuation lineage. */
  reissueImageForContinuation(currentRunId: string, sourceDocumentId: string, destinationDocumentId: string,
    sourceRunId: string, jobId: string, resourceId: string): Promise<string> {
    if (!this.services.images?.readReadyResourceFromJob || !this.authority.ownsDocument(currentRunId, destinationDocumentId))
      return Promise.reject(new Error('当前任务无权重新签发此图片资源'))
    const key = JSON.stringify([currentRunId, sourceDocumentId, destinationDocumentId, sourceRunId, jobId, resourceId])
    const existing = this.reissuedImages.get(key)
    if (existing) return existing
    const work = (async () => {
      const snapshot = await this.registry.get(destinationDocumentId).drain()
      this.authority.active(currentRunId, destinationDocumentId, snapshot.epoch)
      const image = await this.services.images!.readReadyResourceFromJob!({ jobId, sourceRunId, sourceDocumentId, resourceId })
      this.authority.active(currentRunId, destinationDocumentId, snapshot.epoch)
      return this.authority.provideImage(currentRunId, destinationDocumentId, image)
    })()
    this.reissuedImages.set(key, work)
    void work.catch(() => { if (this.reissuedImages.get(key) === work) this.reissuedImages.delete(key) })
    return work
  }
  async stop(runId: string) {
    for (const job of this.jobs.values()) if (job.runId === runId && job.kind === 'image') job.controller.abort()
    await Promise.allSettled([
      ...[...this.jobs.values()].filter((job): job is ImageJob => job.runId === runId && job.kind === 'image').map(job => this.services.images!.stop(job.jobId)),
      ...(this.services.builds ? [this.services.builds.cancelRun(runId)] : []),
    ])
  }
  invoke(runId: string, operationId: string, requestDigest: string, name: HostToolName, raw: unknown): Promise<ToolResult> {
    if (!this.supports(name)) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '宿主未配置该正式服务' })
    const input = schema[name].parse(raw)
    if (name === 'image.status' || name === 'build.read' || name === 'build.logs') return this.execute(runId, operationId, requestDigest, name, input)
    const existing = this.results.get(operationId)
    if (existing) return existing.then(result => structuredClone(result))
    const promise = this.execute(runId, operationId, requestDigest, name, input)
    this.results.set(operationId, promise)
    return promise.then(result => structuredClone(result))
  }
  /** Recovery queries only; no registration of edit authority or reconstruction of a task. */
  async lookup(runId: string, operationId: string, requestDigest: string, name: string): Promise<ToolResult | null> {
    if (name !== 'build.create' || !this.services.builds) return null
    const result = await this.services.builds.lookupCreate(runId, { operationId, requestDigest })
    if (!result) return null
    const target = result.status === 'created' ? result.job.target : result.target
    if (!this.authority.ownsDocument(runId, target.documentId)) throw new Error('原构建文档不属于当前恢复授权')
    if (result.status === 'unknown') return { kind: 'error', code: 'build-create-unknown', message: '上次构建创建中断，完成情况未知；原暂存和票据保留，不会自动新建或重放。' }
    return this.buildResult(result.job)
  }
  private get(runId: string, id: string, kind: 'image' | 'build') {
    const job = this.jobs.get(id)
    if (!job || job.runId !== runId || job.kind !== kind) throw new Error('服务任务句柄不属于当前任务')
    this.authority.active(runId, job.documentId, job.epoch)
    return job
  }
  private async imageResult(job: ImageJob, snapshot: ImageJobSnapshot): Promise<ToolResult> {
    if (snapshot.jobId !== job.jobId || snapshot.runId !== job.runId || snapshot.documentId !== job.documentId) throw new Error('图像服务返回了不同任务的结果')
    this.authority.active(job.runId, job.documentId, job.epoch)
    const resources = []
    if (snapshot.status === 'ready' && !snapshot.stopped) for (const resource of snapshot.resources) {
      let id = job.resources.get(resource.resourceId)
      if (!id) { id = await this.authority.provideImage(job.runId, job.documentId, await this.services.images!.readResource(resource.resourceId)); job.resources.set(resource.resourceId, id) }
      resources.push({ resource: id, resourceId: resource.resourceId, mimeType: resource.mimeType, width: resource.width, height: resource.height, byteLength: resource.byteLength })
    }
    return { kind: 'read', data: { job: job.jobId, documentId: job.documentId, status: snapshot.status, stopped: snapshot.stopped, resources, provenance: snapshot.provenance,
      ...(snapshot.failure ? { failure: snapshot.failure } : {}), ...(snapshot.timing?.length ? { timing: snapshot.timing } : {}) } }
  }
  private buildResult(value: unknown): ToolResult {
    if (value && typeof value === 'object' && 'jobId' in value) {
      const job = value as BuildJobSnapshot
      return { kind: 'read', data: { job: job.jobId, status: job.status, sourceRevision: job.sourceRevision, writes: job.writes, checks: job.checks, deadline: job.deadline, ...(job.artifactId ? { artifact: job.artifactId, prepared: true } : {}) } }
    }
    if (value && typeof value === 'object' && 'job' in value) {
      const listed = value as { job: BuildJobSnapshot; files: unknown }
      return { kind: 'read', data: { ...(this.buildResult(listed.job) as Extract<ToolResult, { kind: 'read' }>).data as object, files: listed.files } }
    }
    return { kind: 'read', data: value }
  }
  private async execute(runId: string, operationId: string, requestDigest: string, name: HostToolName, input: z.infer<(typeof schema)[HostToolName]>): Promise<ToolResult> {
    if (name === 'image.generate' || name === 'image.edit') {
      const value = schema[name].parse(input), { snapshot } = await this.authority.resolveImage(runId, value.target)
      const operation = name === 'image.edit' ? 'edit' : 'generate'
      const references = name === 'image.edit' ? schema['image.edit'].parse(input).references : undefined
      for (const reference of references ?? []) await this.authority.readImage(runId, snapshot.documentId, reference)
      const selection = structuredClone(await this.services.images!.selection(runId, snapshot.documentId, operation))
      this.authority.active(runId, snapshot.documentId, snapshot.epoch)
      const jobId = `image-${operationId}`
      const request: ImageGenerationRequest = { jobId, runId, documentId: snapshot.documentId, operation, prompt: value.prompt, selection, ...(references ? { referenceIds: references } : {}), ...(value.output ? { output: value.output } : {}) }
      const job: ImageJob = { kind: 'image', jobId, runId, documentId: snapshot.documentId, epoch: snapshot.epoch, request, controller: new AbortController(), resources: new Map() }
      this.jobs.set(jobId, job)
      const result = await this.services.images!.run(request, { signal: job.controller.signal })
      return this.imageResult(job, result)
    }
    if (name === 'image.status') {
      const job = this.get(runId, schema[name].parse(input).job, 'image') as ImageJob
      return this.imageResult(job, await this.services.images!.read(job.jobId))
    }
    if (name === 'build.create') {
      const recovered = await this.lookup(runId, operationId, requestDigest, name)
      if (recovered) return recovered
      const { snapshot, target } = await this.authority.resolve(runId, schema[name].parse(input).target)
      if (target.kind !== 'document' || snapshot.model.kind !== 'course-v9') throw new Error('构建导入要求整份 V9 文档授权，不接受局部范围')
      const policy = await this.services.builds!.policy?.(runId, snapshot.documentId)
      this.authority.active(runId, snapshot.documentId, snapshot.epoch)
      const digest = documentDigest(snapshot.model)
      const frozen: BuildJobInput = { runId, target: { documentId: snapshot.documentId, projectId: snapshot.model.project.id, epoch: snapshot.epoch, baseRevision: snapshot.revision, modelDigest: digest }, readSet: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, digest }], baseline: snapshot.model, allowedOrigins: policy?.allowedOrigins ?? snapshot.model.project.network?.connectOrigins ?? [], ...(policy?.budget ? { budget: policy.budget } : {}) }
      const value = await this.services.builds!.create(structuredClone(frozen), { operationId, requestDigest })
      if (value.runId !== runId || documentDigest(value.target) !== documentDigest(frozen.target) || documentDigest(value.readSet) !== documentDigest(frozen.readSet)) throw new Error('构建服务返回了不同冻结前提的任务')
      const job: BuildJob = { kind: 'build', runId, documentId: snapshot.documentId, epoch: snapshot.epoch, jobId: value.jobId, frozen: structuredClone(frozen) }
      this.jobs.set(job.jobId, job)
      try { this.authority.active(runId, job.documentId, job.epoch) } catch (error) { await this.services.builds!.cancelRun(runId); throw error }
      return this.buildResult(value)
    }
    const value = input as { job: string }, job = this.get(runId, value.job, 'build') as BuildJob
    if (name === 'build.import') {
      const artifact = await this.services.builds!.artifact(runId, job.jobId, schema[name].parse(input).artifact)
      if (artifact.artifactId !== schema[name].parse(input).artifact || !artifact.admission.ok || artifact.jobId !== job.jobId || artifact.runId !== runId || documentDigest(artifact.target) !== documentDigest(job.frozen.target) || documentDigest(artifact.readSet) !== documentDigest(job.frozen.readSet)) throw new Error('准入制品与冻结构建任务不符')
      const session = this.registry.get(job.documentId), current = await session.drain()
      this.authority.active(runId, job.documentId, job.epoch)
      if (current.epoch !== artifact.target.epoch || current.revision !== artifact.target.baseRevision || current.model.kind !== 'course-v9' || current.model.project.id !== artifact.target.projectId || documentDigest(current.model) !== artifact.target.modelDigest) return { kind: 'error', code: 'build-target-conflict', message: '构建前提已改变，制品未导入；不会替换为最新版本绕过冲突' }
      if (artifact.command.project.id !== artifact.target.projectId || artifact.command.project.revision !== artifact.target.baseRevision || !artifact.command.resources) throw new Error('构建制品的工程身份、基线或资源闭包无效')
      const result = await session.execute({ documentId: job.documentId, epoch: artifact.target.epoch, baseRevision: artifact.target.baseRevision, operationId, requestDigest, runId, actor: this.authority.actor(runId), mutation: { type: 'command', command: artifact.command } })
      return { kind: 'document-operation', result, affected: [] }
    }
    const { job: _job, ...parameters } = input as Record<string, unknown>
    const type = name === 'build.compile' ? 'syntax' : name.slice('build.'.length)
    const call = name === 'build.read' && !parameters.path ? { type: 'list', jobId: job.jobId } : { type, jobId: job.jobId, ...parameters }
    const result = await this.services.builds!.execute(runId, buildToolCallSchema.parse(call))
    this.authority.active(runId, job.documentId, job.epoch)
    return this.buildResult(result)
  }
}
