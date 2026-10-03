import { z } from 'zod'
import type { DocumentOperation, DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolDefinition, ToolResult, ToolTarget, ToolRunGrant } from '../../shared/workbench/tools'
import type { ImageGenerationRequest, ImageJobSnapshot, ImageModelSelection } from '../../shared/workbench/images'
import { buildToolCallSchema, type BuildCreateTicket, type BuildCreateLookup, type BuildImportArtifact, type BuildJobInput, type BuildJobSnapshot, type BuildToolCall } from '../../shared/workbench/build'
import type { HostImageInput } from './imageResource'
import type { AssetSource } from '../../shared/contracts/media-v1'
import type { ComputeArtifact, ComputeJobInput, ComputeJobSnapshot } from '../../shared/workbench/compute'
import { DocumentRegistry } from '../documents/DocumentRegistry'
import { documentDigest } from '../documents/documentDigest'
import type { SkillServicePort } from '../../shared/workbench/toolPorts'
import { executeSkillRead, executeSkillList } from './SkillTools'
import { executeHtmlImport, htmlImportReceiptResult } from './HtmlImportTools'
import { documentDeliveryReceiptResult, executeDocumentDeliveryTool } from './DocumentDeliveryTools'
import { executeViewObserveTool, type ViewObserveToolContext } from './ViewObserveTools'
import type { DocumentDeliveryServicePort, HtmlImportServicePort, ObservationServicePort } from '../../shared/workbench/toolPorts'
import type { PageParsePort } from '../projectFiles/pageHtml'

/** Main supplies real services. Neither their implementations nor credentials enter core. */
export interface HostToolServices {
  skills?: SkillServicePort
  htmlImports?: HtmlImportServicePort
  deliveries?: DocumentDeliveryServicePort
  observations?: ObservationServicePort
  /** Project files: the existing HTML importer parser reads pages back. */
  projectFiles?: { parsePage: PageParsePort }
  /** Thin routes to the existing durable owners; this is not a second job store. */
  jobs?: {
    status(ref: HostJobRef): Promise<HostJobView>
    wait(ref: HostJobRef & { milliseconds: number; signal?: AbortSignal }): Promise<HostJobView>
    logs(ref: HostJobRef & { after?: number; limit?: number }): Promise<unknown>
    cancel(ref: HostJobRef): Promise<HostJobView>
  }
  compute?: {
    start(input: ComputeJobInput): Promise<ComputeJobSnapshot>
    readArtifact(runId: string, jobId: string, name: string): Promise<{ artifact: ComputeArtifact; bytes: Uint8Array }>
    cancel(runId: string, jobId: string): Promise<ComputeJobSnapshot>
    cancelRun(runId: string): Promise<void>
  }
  delegation?: {
    availability(): { ready: boolean; reason: string }
    startManaged(input: { runId: string; jobId: string; taskId: string; goal: string; workspaceRoot: string;
      permission: 'workspace' | 'full'; materials?: readonly string[]; expectedArtifacts: readonly string[] }): Promise<HostDelegationSnapshot>
    readArtifact(runId: string, jobId: string, name: string): Promise<{
      artifact: { name: string; digest: string; byteLength: number }; bytes: Uint8Array }>
    cancel(runId: string, jobId: string): Promise<HostDelegationSnapshot>
    cancelRun(runId: string): Promise<void>
  }
  web?: {
    search(input: { runId: string; query: string; limit?: number; cursor?: string; signal?: AbortSignal }): Promise<unknown>
    open(input: { runId: string; url?: string; sourceId?: string; version?: string; offset?: number; limit?: number; signal?: AbortSignal }): Promise<unknown>
  }
  mcp?: {
    discover(runId: string, signal?: AbortSignal): Promise<unknown>
    invoke(input: { runId: string; operationId: string; name: string; arguments: Record<string, unknown>; snapshotId?: string; signal?: AbortSignal }): Promise<unknown>
    readResource(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> | { mimeType: string; bytes: Uint8Array }
    lookup(runId: string, operationId: string): Promise<unknown | null>
  }
  media?: {
    discover(runId: string): unknown
    start(runId: string, input: { kind: 'speech' | 'video' | 'music'; prompt: string; durationSeconds?: number; language?: string;
      referenceResources?: readonly string[] }, options?: { signal?: AbortSignal }): Promise<unknown>
  }
  /** Open-license image libraries; candidates and previews belong to one run. */
  openImages?: {
    search(input: { runId: string; query: string; limit?: number; page?: number; allowShareAlike?: boolean; signal?: AbortSignal }): Promise<unknown>
    preview(input: { runId: string; images: readonly string[]; signal?: AbortSignal }): Promise<unknown>
    readPreview(runId: string, resourceId: string): { mimeType: string; bytes: Uint8Array }
    fetch(input: { runId: string; image: string; format?: 'jpeg' | 'png' | 'webp'; signal?: AbortSignal }): Promise<
      | { status: 'ready'; file: HostImageInput; width: number; height: number; source: AssetSource }
      | { status: 'failed' | 'rejected'; reason: string }>
  }
  /** The component library: search, an HTML component's files, and saving into the managed library. */
  assetLibrary?: {
    search(input: { runId: string; query: string; limit?: number }): Promise<unknown>
    read(input: { runId: string; packageId: string; version?: string }): Promise<
      | { status: 'ready'; packageId: string; version: string; name: string; html: string; assets: { path: string; mimeType: string; bytes: Uint8Array }[] }
      | { status: 'rejected' | 'failed'; reason: string }>
    save(input: { runId: string; name: string; description?: string; subject?: readonly string[]; schoolStage?: readonly string[];
      tags?: readonly string[]; sourceCourse?: string; html: string; assets: readonly { path: string; mimeType: string; bytes: Uint8Array }[] }): Promise<unknown>
  }
  /** Freeze role/connection selections before the run can issue any service operation. */
  beginRun?(grant: ToolRunGrant): Promise<void>
  stopRun?(runId: string): Promise<void> | void
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
    policy?(runId: string, documentId: string): { allowedOrigins: readonly string[] } | undefined | Promise<{ allowedOrigins: readonly string[] } | undefined>
  }
}
export type HostJobRef = { runId: string; kind: 'image' | 'build' | 'compute' | 'delegation'; jobId: string }
export type HostJobView = { kind: HostJobRef['kind']; jobId: string; status: string; terminal: boolean; snapshot: unknown }
export type ComputeRunInput = Omit<ComputeJobInput, 'runId' | 'jobId'>
export type DelegationRunInput = { goal: string; materials?: readonly string[]; expectedArtifacts: readonly string[] }
export type DelegationReadInput = { job: string; name: string; offset?: number; limit?: number; version?: string }
type HostDelegationSnapshot = { jobId: string; status: string; terminal: boolean; stopped: boolean;
  reason?: string; artifacts: readonly { name: string; digest: string; byteLength: number }[] }
const handle = z.string().min(1)
// The currently supported OAuth and OpenAI-compatible Images routes accept these
// common request options; decoding still preserves the actual raster format.
const output = z.object({ size: z.union([z.literal('auto'), z.string().regex(/^\d{2,5}x\d{2,5}$/)]).optional(), quality: z.enum(['auto', 'low', 'medium', 'high']).optional(), format: z.literal('png').optional(), background: z.enum(['auto', 'opaque', 'transparent']).optional() }).strict()
// A document target is required for a V9 insertion workflow, but workspace
// image work has no reason to manufacture an empty V9 document.
const imageInput = z.object({ target: handle.optional(), prompt: z.string().min(1), output: output.optional() }).strict()
const schema = {
  'image.generate': imageInput,
  'image.edit': imageInput.extend({ references: z.array(handle).min(1) }).strict(),
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
  'image.generate': '通过任务开始时冻结的 GPT OAuth 或已显式启用的 OpenAI Images API 连接生成真实图片。target 可省略以生成独立工作空间资源；有 target 时继续使用 V9 资源句柄。返回持久任务状态，ready 不等于文件或文档交付；当前只请求 PNG、auto/low/medium/high 画质。',
  'image.edit': '编辑本任务已有图片；独立图片的 references 使用生成结果中的 job@resourceId 句柄，宿主核对原作业及真实字节。target 可省略以保留独立成果；有 target 时继续使用 V9 资源句柄。未知结果不自动重发。',
  'image.status': '查询本任务图片状态；ready 返回已校验的本任务图片资源身份，不返回 base64 或临时 URL。',
  'build.create': '从有整份文档写权限的 V9 文档句柄建立受管 scratch，冻结当前基线和读集合；不会修改正式文档。',
  'build.read': '读取构建 scratch 的相对路径文件，支持分页；省略 path 列出文件和任务状态。',
  'build.write': '写入受管 scratch 相对路径，现有准入制品随源码变更失效；不能写正式工程或宿主任意路径。',
  'build.compile': '仅对指定 Component/Runtime JavaScript 做语法编译，不执行候选。通过不等于协议、闭包或真实动态准入；继续 build.check。',
  'build.check': '执行正式协议、来源、资源闭包及受影响动态目标的隔离宿主准入，返回可读错误或准备好的 artifact；尚未应用文档。',
  'build.logs': '分页读取构建日志和精确错误，用于同一任务修复。',
  'build.import': '导入已准入 artifact，重新验证原 document/epoch/revision/project/digest/readset，资源与内容一次提交和撤销；前提变化即冲突。',
}
export const hostToolCatalog = (Object.keys(schema) as HostToolName[]).map(name => ({ name, description: descriptions[name], inputSchema: schema[name], manual: { label: name, group: (name.endsWith('.read') || name.endsWith('.logs') || name.endsWith('.status') ? 'read' : 'edit') as 'read' | 'edit', targetKinds: (name.startsWith('build.') ? ['document'] : ['document', 'course-owner', 'course-object', 'course-background', 'flow-block']) as ToolDefinition['manual']['targetKinds'] } }))
export const isHostToolName = (name: string): name is HostToolName => Object.hasOwn(schema, name)
interface HostAuthority {
  resolve(runId: string, target: string): Promise<{ snapshot: DocumentSnapshot; target: ToolTarget }>
  resolveImage(runId: string, target: string): Promise<{ snapshot: DocumentSnapshot; target: ToolTarget }>
  active(runId: string, documentId: string, epoch: string): void
  actor(runId: string): DocumentOperation['actor']
  applied(runId: string, before: DocumentSnapshot, after: DocumentSnapshot): void
  ownsDocument(runId: string, documentId: string): boolean
  provideImage(runId: string, documentId: string, source: HostImageInput): Promise<string>
  readImage(runId: string, documentId: string, resource: string): Promise<HostImageInput>
}
interface Job { runId: string; documentId: string; epoch: string; jobId: string }
interface ImageJob extends Job { kind: 'image'; scope: 'document' | 'workspace'; controller: AbortController; resources: Map<string, string> }
interface BuildJob extends Job { kind: 'build'; frozen: BuildJobInput }

/** Service work prepares results. Only import executes an acknowledged canonical operation. */
export class HostToolCoordinator {
  private readonly jobs = new Map<string, ImageJob | BuildJob>()
  private readonly runs = new Map<string, { grant: ToolRunGrant; stopped: boolean;
    computeJobs: Set<string>; pendingCompute: Set<Promise<ComputeJobSnapshot>>;
    delegationJobs: Set<string>; pendingDelegation: Set<Promise<HostDelegationSnapshot>> }>()
  private readonly results = new Map<string, Promise<ToolResult>>()
  private readonly reissuedImages = new Map<string, Promise<string>>()
  constructor(private services: HostToolServices, private readonly registry: DocumentRegistry, private readonly authority: HostAuthority) {}
  configure(services: HostToolServices) { this.services = services }
  async beginRun(grant: ToolRunGrant) {
    await this.services.beginRun?.(structuredClone(grant))
    this.runs.set(grant.runId, { grant: structuredClone(grant), stopped: false, computeJobs: new Set(), pendingCompute: new Set(),
      delegationJobs: new Set(), pendingDelegation: new Set() })
  }
  private serviceRun(runId: string) {
    const run = this.runs.get(runId)
    if (!run || run.stopped) throw new Error('任务尚未授权或已经停止')
    return run
  }
  private builtInRun(runId: string) {
    const run = this.serviceRun(runId)
    if (run.grant.actor !== 'agent' || !run.grant.fileAccess) throw new Error('当前任务没有冻结的宿主服务授权')
    return run
  }
  private writableRun(runId: string) {
    const run = this.builtInRun(runId)
    if (run.grant.fileAccess?.permission === 'read-only') throw new Error('只读任务不能提交外部作业')
    return run
  }
  private workspaceImageScope(runId: string): string {
    const run = this.writableRun(runId)
    const root = run.grant.fileAccess?.workspaceRoot
    if (!root) throw new Error('独立图片需要本任务冻结的工作空间根目录')
    return `workspace:${documentDigest({ root })}`
  }
  private standaloneReference(jobId: string, resourceId: string): string {
    return `${jobId}@${resourceId}`
  }
  private parseStandaloneReference(value: string): { jobId: string; resourceId: string } {
    const match = /^(image-tool:[a-f0-9]{64})@(image_[a-f0-9]{64})$/.exec(value)
    if (!match) throw new Error('独立参考图句柄无效；请使用本任务已完成图片的 resource 字段')
    return { jobId: match[1]!, resourceId: match[2]! }
  }
  projectFileServices() { return this.services.projectFiles }
  supports(name: string) { return name.startsWith('project.') ? !!this.services.projectFiles : name === 'course.createFromHtml' ? false : name === 'skills.read' || name === 'skills.list' ? !!this.services.skills : name === 'view.observe' ? !!this.services.observations : name === 'html.import' ? !!this.services.htmlImports
    : name === 'file.save' || name === 'document.export' ? !!this.services.deliveries
      : !isHostToolName(name) || (name.startsWith('image.') ? !!this.services.images : !!this.services.builds) }
  observePage(context: ViewObserveToolContext, input: unknown): Promise<ToolResult> {
    if (!this.services.observations) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '画面观察服务尚未就绪' })
    return executeViewObserveTool(this.services.observations, context, input)
  }
  readObservationResource(input: { runId: string; resourceId: string }): Promise<{ mimeType: string; bytes: Uint8Array }> {
    if (!this.services.observations) return Promise.reject(new Error('画面观察服务尚未就绪'))
    return this.services.observations.readResource(input)
  }
  deliverDocument(context: { runId: string; operationId: string; requestDigest: string; resolveHandle(handle: string, access: 'write'): Promise<{ documentId: string; epoch: string; revision: number }> }, name: 'file.save' | 'document.export', input: unknown): Promise<ToolResult> {
    if (!this.services.deliveries) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '文档保存与导出服务尚未就绪' })
    return executeDocumentDeliveryTool(this.services.deliveries, context, name, input)
  }
  importHtml(context: { runId: string; operationId: string; requestDigest: string; resolveHandle(handle: string, access: 'read' | 'write'): Promise<{ documentId: string; epoch: string; revision: number; bindingVersion: number | null }> }, input: unknown): Promise<ToolResult> {
    if (!this.services.htmlImports) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: 'HTML 导入服务尚未就绪' })
    return executeHtmlImport(this.services.htmlImports, context, input)
  }
  readSkill(runId: string, input: unknown): Promise<ToolResult> {
    if (!this.services.skills) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '随附 Skill 尚未就绪' })
    return executeSkillRead(this.services.skills, input, runId)
  }
  listSkills(runId: string, input: unknown): Promise<ToolResult> {
    if (!this.services.skills) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: 'Skill 服务尚未就绪' })
    return executeSkillList(this.services.skills, runId, input)
  }
  private serviceUnavailable(message: string): ToolResult { return { kind: 'error', code: 'service-unavailable', message } }
  async jobStatus(runId: string, input: Omit<HostJobRef, 'runId'>): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.jobs ? { kind: 'read', data: await this.services.jobs.status({ runId, ...input }) }
      : this.serviceUnavailable('通用作业服务尚未配置')
  }
  async jobWait(runId: string, input: Omit<HostJobRef, 'runId'> & { milliseconds: number }, signal?: AbortSignal): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.jobs ? { kind: 'read', data: await this.services.jobs.wait({ runId, ...input, signal }) }
      : this.serviceUnavailable('通用作业服务尚未配置')
  }
  async jobLogs(runId: string, input: Omit<HostJobRef, 'runId'> & { after?: number; limit?: number }): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.jobs ? { kind: 'read', data: await this.services.jobs.logs({ runId, ...input }) }
      : this.serviceUnavailable('通用作业服务尚未配置')
  }
  async jobCancel(runId: string, input: Omit<HostJobRef, 'runId'>): Promise<ToolResult> {
    this.writableRun(runId)
    return this.services.jobs ? { kind: 'read', data: await this.services.jobs.cancel({ runId, ...input }) }
      : this.serviceUnavailable('通用作业服务尚未配置')
  }
  async runCompute(runId: string, operationId: string, input: ComputeRunInput): Promise<ToolResult> {
    const run = this.writableRun(runId)
    if (!this.services.compute) return this.serviceUnavailable('受限计算后端未配置固定镜像')
    if (!operationId || operationId.length > 512) throw new Error('计算操作身份无效')
    const jobId = `compute-${documentDigest([runId, operationId])}`
    const pending = this.services.compute.start({ ...structuredClone(input), runId, jobId })
    run.pendingCompute.add(pending)
    try {
      const snapshot = await pending
      run.computeJobs.add(jobId)
      if (run.stopped) {
        const stopped = await this.services.compute.cancel(runId, jobId)
        return { kind: 'read', data: { job: jobId, status: stopped.status, stopped: true, outputNames: stopped.outputNames,
          artifacts: stopped.artifacts, reason: stopped.reason ?? '任务已停止；成果不自动应用' } }
      }
      return { kind: 'read', data: { job: jobId, status: snapshot.status, stopped: snapshot.stopped,
        outputNames: snapshot.outputNames, artifacts: snapshot.artifacts, ...(snapshot.reason ? { reason: snapshot.reason } : {}) } }
    } finally { run.pendingCompute.delete(pending) }
  }
  async readComputeArtifact(runId: string, jobId: string, name: string): Promise<{ artifact: ComputeArtifact; bytes: Uint8Array }> {
    this.writableRun(runId)
    if (!this.services.compute) throw new Error('受限计算后端未配置')
    return this.services.compute.readArtifact(runId, jobId, name)
  }
  async runDelegate(runId: string, operationId: string, input: DelegationRunInput): Promise<ToolResult> {
    const run = this.writableRun(runId)
    if (!this.services.delegation) return this.serviceUnavailable('有限委派服务尚未配置')
    const available = this.services.delegation.availability()
    if (!available.ready) return { kind: 'error', code: 'delegation-blocked', message: available.reason }
    const permission = run.grant.fileAccess?.permission
    if (permission !== 'workspace' && permission !== 'full')
      return { kind: 'error', code: 'delegation-blocked', message: '修改前询问权限尚无外部委派逐项确认通道' }
    const workspaceRoot = run.grant.fileAccess?.workspaceRoot
    if (!workspaceRoot) return { kind: 'error', code: 'delegation-blocked', message: '本次任务没有冻结的工作空间根目录' }
    if (!operationId || operationId.length > 512) throw new Error('委派操作身份无效')
    const jobId = `delegate-${documentDigest([runId, operationId])}`
    const pending = this.services.delegation.startManaged({ ...structuredClone(input), runId, jobId,
      taskId: operationId, workspaceRoot, permission })
    run.pendingDelegation.add(pending)
    try {
      const snapshot = await pending
      run.delegationJobs.add(jobId)
      if (run.stopped) {
        const stopped = await this.services.delegation.cancel(runId, jobId)
        return { kind: 'read', data: { job: jobId, status: stopped.status, stopped: true,
          reason: stopped.reason ?? '父任务已停止；委派成果不自动应用' } }
      }
      return { kind: 'read', data: { job: jobId, status: snapshot.status, stopped: snapshot.stopped,
        artifacts: snapshot.artifacts, ...(snapshot.reason ? { reason: snapshot.reason } : {}) } }
    } finally { run.pendingDelegation.delete(pending) }
  }
  async readDelegation(runId: string, input: DelegationReadInput): Promise<ToolResult> {
    this.builtInRun(runId)
    if (!this.services.delegation) return this.serviceUnavailable('有限委派服务尚未配置')
    const { artifact, bytes } = await this.services.delegation.readArtifact(runId, input.job, input.name)
    if (input.version && input.version !== artifact.digest) throw new Error('委派成果版本已变化')
    let content: string
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { return { kind: 'read', data: { status: 'binary', job: input.job, artifact } } }
    if (content.includes('\0')) return { kind: 'read', data: { status: 'binary', job: input.job, artifact } }
    const offset = input.offset ?? 0, limit = input.limit ?? 20_000
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20_000)
      throw new Error('委派成果分页无效')
    if (offset > content.length) throw new Error('委派成果读取位置超过末尾')
    const text = content.slice(offset, offset + limit)
    return { kind: 'read', data: { status: 'read', job: input.job, name: artifact.name,
      version: artifact.digest, byteLength: artifact.byteLength, verifiedBytes: true, offset, text,
      ...(offset + limit < content.length ? { nextOffset: offset + limit } : {}),
      source: 'delegated-candidate-untrusted' } }
  }
  /** Byte port for the file owner. A model never receives the generated bytes. */
  async readStandaloneImage(runId: string, jobId: string, resourceId: string): Promise<HostImageInput> {
    const scope = this.workspaceImageScope(runId)
    if (!this.services.images?.readReadyResourceFromJob) throw new Error('独立图片资源读取服务尚未配置')
    return this.services.images.readReadyResourceFromJob({ jobId, sourceRunId: runId, sourceDocumentId: scope, resourceId })
  }
  async webSearch(runId: string, input: { query: string; limit?: number; cursor?: string }, signal?: AbortSignal): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.web ? { kind: 'read', data: await this.services.web.search({ runId, ...input, signal }) }
      : this.serviceUnavailable('联网搜索服务尚未配置')
  }
  async webOpen(runId: string, input: { url?: string; sourceId?: string; version?: string; offset?: number; limit?: number }, signal?: AbortSignal): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.web ? { kind: 'read', data: await this.services.web.open({ runId, ...input, signal }) }
      : this.serviceUnavailable('网页读取服务尚未配置')
  }
  async mcpDiscover(runId: string, signal?: AbortSignal): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.mcp ? { kind: 'read', data: await this.services.mcp.discover(runId, signal) }
      : this.serviceUnavailable('外部 MCP 服务尚未配置')
  }
  async mcpInvoke(runId: string, operationId: string, name: string, args: Record<string, unknown>, snapshotId?: string, signal?: AbortSignal): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.mcp ? { kind: 'read', data: await this.services.mcp.invoke({ runId, operationId, name, arguments: args, ...(snapshotId ? { snapshotId } : {}), signal }) }
      : this.serviceUnavailable('外部 MCP 服务尚未配置')
  }
  async readMcpResource(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    this.builtInRun(runId)
    if (!this.services.mcp) throw new Error('外部 MCP 服务尚未配置')
    return this.services.mcp.readResource(runId, resourceId)
  }
  async lookupMcp(runId: string, operationId: string): Promise<unknown | null> {
    return this.services.mcp?.lookup(runId, operationId) ?? null
  }
  mediaDiscover(runId: string): ToolResult {
    this.builtInRun(runId)
    return this.services.media ? { kind: 'read', data: this.services.media.discover(runId) }
      : this.serviceUnavailable('媒体生成服务尚未配置')
  }
  async mediaStart(runId: string, input: { kind: 'speech' | 'video' | 'music'; prompt: string; durationSeconds?: number; language?: string;
    referenceResources?: readonly string[] }, signal?: AbortSignal): Promise<ToolResult> {
    this.writableRun(runId)
    return this.services.media ? { kind: 'read', data: await this.services.media.start(runId, input, { signal }) }
      : this.serviceUnavailable('媒体生成服务尚未配置')
  }
  async imageSearch(runId: string, input: { query: string; limit?: number; page?: number; allowShareAlike?: boolean }, signal?: AbortSignal): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.openImages ? { kind: 'read', data: await this.services.openImages.search({ runId, ...input, signal }) }
      : this.serviceUnavailable('开放图库服务尚未配置')
  }
  async imagePreview(runId: string, input: { images: readonly string[] }, signal?: AbortSignal): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.openImages ? { kind: 'read', data: await this.services.openImages.preview({ runId, images: input.images, signal }) }
      : this.serviceUnavailable('开放图库服务尚未配置')
  }
  /** Preview bytes go only to the run's next model request, never into a document. */
  readImagePreview(runId: string, resourceId: string): { mimeType: string; bytes: Uint8Array } {
    this.builtInRun(runId)
    if (!this.services.openImages) throw new Error('开放图库服务尚未配置')
    return this.services.openImages.readPreview(runId, resourceId)
  }
  /** One candidate's verified bytes and source; the Gateway places them as a project asset or a run resource. */
  openImageFile(runId: string, image: string, format?: 'jpeg' | 'png' | 'webp', signal?: AbortSignal) {
    this.writableRun(runId)
    if (!this.services.openImages) throw new Error('开放图库服务尚未配置')
    return this.services.openImages.fetch({ runId, image, ...(format ? { format } : {}), signal })
  }
  async assetSearch(runId: string, input: { query: string; limit?: number }): Promise<ToolResult> {
    this.builtInRun(runId)
    return this.services.assetLibrary ? { kind: 'read', data: await this.services.assetLibrary.search({ runId, ...input }) }
      : this.serviceUnavailable('资产库检索服务尚未配置')
  }
  /** One HTML component's text and asset files for the Gateway, which writes them into a course. */
  libraryComponent(runId: string, packageId: string, version?: string) {
    this.writableRun(runId)
    if (!this.services.assetLibrary) throw new Error('资产库服务尚未配置')
    return this.services.assetLibrary.read({ runId, packageId, ...(version ? { version } : {}) })
  }
  async saveLibraryComponent(runId: string, input: Omit<Parameters<NonNullable<HostToolServices['assetLibrary']>['save']>[0], 'runId'>): Promise<ToolResult> {
    this.writableRun(runId)
    return this.services.assetLibrary ? { kind: 'read', data: await this.services.assetLibrary.save({ runId, ...input }) }
      : this.serviceUnavailable('资产库服务尚未配置')
  }
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
    const run = this.runs.get(runId)
    if (run) run.stopped = true
    for (const job of this.jobs.values()) if (job.runId === runId && job.kind === 'image') job.controller.abort()
    await Promise.allSettled([
      ...(this.services.stopRun ? [this.services.stopRun(runId)] : []),
      ...(this.services.observations?.stopRun ? [this.services.observations.stopRun(runId)] : []),
      ...[...this.jobs.values()].filter((job): job is ImageJob => job.runId === runId && job.kind === 'image').map(job => this.services.images!.stop(job.jobId)),
      ...(this.services.builds ? [this.services.builds.cancelRun(runId)] : []),
      ...(this.services.compute ? [this.services.compute.cancelRun(runId)] : []),
      ...(this.services.delegation ? [this.services.delegation.cancelRun(runId)] : []),
      ...(run?.pendingCompute ? [...run.pendingCompute].map(async pending => { const result = await pending; await this.services.compute?.cancel(runId, result.jobId) }) : []),
      ...(run?.computeJobs ? [...run.computeJobs].map(jobId => this.services.compute?.cancel(runId, jobId)) : []),
      ...(run?.pendingDelegation ? [...run.pendingDelegation].map(async pending => {
        const result = await pending; await this.services.delegation?.cancel(runId, result.jobId)
      }) : []),
      ...(run?.delegationJobs ? [...run.delegationJobs].map(jobId => this.services.delegation?.cancel(runId, jobId)) : []),
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
    if ((name === 'file.save' || name === 'document.export') && this.services.deliveries) {
      const receipt = await this.services.deliveries.lookup({ runId, operationId, requestDigest })
      return receipt ? documentDeliveryReceiptResult(receipt) : null
    }
    if (name === 'html.import' && this.services.htmlImports) {
      const receipt = await this.services.htmlImports.lookup({ runId, operationId, requestDigest })
      return receipt ? htmlImportReceiptResult(receipt) : null
    }
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
    if (job.kind === 'image' && job.scope === 'workspace') {
      if (job.documentId !== this.workspaceImageScope(runId)) throw new Error('图片作业不属于当前任务工作空间')
    } else this.authority.active(runId, job.documentId, job.epoch)
    return job
  }
  private async imageResult(job: ImageJob, snapshot: ImageJobSnapshot): Promise<ToolResult> {
    if (snapshot.jobId !== job.jobId || snapshot.runId !== job.runId || snapshot.documentId !== job.documentId) throw new Error('图像服务返回了不同任务的结果')
    if (job.scope === 'workspace') this.workspaceImageScope(job.runId)
    else this.authority.active(job.runId, job.documentId, job.epoch)
    const resources = []
    if (snapshot.status === 'ready' && !snapshot.stopped) for (const resource of snapshot.resources) {
      let id = job.resources.get(resource.resourceId)
      if (!id) {
        if (job.scope === 'workspace') {
          await this.readStandaloneImage(job.runId, job.jobId, resource.resourceId)
          id = this.standaloneReference(job.jobId, resource.resourceId)
        } else id = await this.authority.provideImage(job.runId, job.documentId, await this.services.images!.readResource(resource.resourceId))
        job.resources.set(resource.resourceId, id)
      }
      resources.push({ resource: id, resourceId: resource.resourceId, mimeType: resource.mimeType, width: resource.width, height: resource.height, byteLength: resource.byteLength })
    }
    return { kind: 'read', data: { job: job.jobId, ...(job.scope === 'workspace' ? { scope: 'workspace' } : { documentId: job.documentId }), status: snapshot.status, stopped: snapshot.stopped, resources, provenance: snapshot.provenance,
      ...(snapshot.failure ? { failure: snapshot.failure } : {}), ...(snapshot.timing?.length ? { timing: snapshot.timing } : {}) } }
  }
  private buildResult(value: unknown): ToolResult {
    if (value && typeof value === 'object' && 'jobId' in value) {
      const job = value as BuildJobSnapshot
      return { kind: 'read', data: { job: job.jobId, status: job.status, sourceRevision: job.sourceRevision, writes: job.writes, checks: job.checks, ...(job.artifactId ? { artifact: job.artifactId, prepared: true } : {}) } }
    }
    if (value && typeof value === 'object' && 'job' in value) {
      const listed = value as { job: BuildJobSnapshot; files: unknown }
      return { kind: 'read', data: { ...(this.buildResult(listed.job) as Extract<ToolResult, { kind: 'read' }>).data as object, files: listed.files } }
    }
    return { kind: 'read', data: value }
  }
  private async execute(runId: string, operationId: string, requestDigest: string, name: HostToolName, input: z.infer<(typeof schema)[HostToolName]>): Promise<ToolResult> {
    if (name === 'image.generate' || name === 'image.edit') {
      const value = schema[name].parse(input)
      const operation = name === 'image.edit' ? 'edit' : 'generate'
      const references = name === 'image.edit' ? schema['image.edit'].parse(input).references : undefined
      const target = value.target ? await this.authority.resolveImage(runId, value.target) : undefined
      const documentId = target?.snapshot.documentId ?? this.workspaceImageScope(runId)
      if (target) for (const reference of references ?? []) await this.authority.readImage(runId, documentId, reference)
      else for (const reference of references ?? []) {
        const source = this.parseStandaloneReference(reference)
        await this.readStandaloneImage(runId, source.jobId, source.resourceId)
      }
      const selection = structuredClone(await this.services.images!.selection(runId, documentId, operation))
      if (target) this.authority.active(runId, documentId, target.snapshot.epoch)
      else this.workspaceImageScope(runId)
      const jobId = `image-${operationId}`
      const request: ImageGenerationRequest = { jobId, runId, documentId, operation, prompt: value.prompt, selection, ...(references ? { referenceIds: references } : {}), ...(value.output ? { output: value.output } : {}) }
      const job: ImageJob = { kind: 'image', scope: target ? 'document' : 'workspace', jobId, runId, documentId, epoch: target?.snapshot.epoch ?? '', controller: new AbortController(), resources: new Map() }
      this.jobs.set(jobId, job)
      const result = await this.services.images!.run(request, { signal: job.controller.signal })
      return this.imageResult(job, result)
    }
    if (name === 'image.status') {
      const jobId = schema[name].parse(input).job
      const known = this.jobs.get(jobId)
      if (known) return this.imageResult(this.get(runId, jobId, 'image') as ImageJob, await this.services.images!.read(jobId))
      // A recovered standalone result has no V9 target handle to reconstruct.
      // The durable owner and frozen workspace scope still prove its authority.
      const snapshot = await this.services.images!.read(jobId), scope = this.workspaceImageScope(runId)
      if (snapshot.runId !== runId || snapshot.documentId !== scope) throw new Error('图片作业不属于当前任务工作空间')
      const recovered: ImageJob = { kind: 'image', scope: 'workspace', jobId, runId, documentId: scope, epoch: '', controller: new AbortController(), resources: new Map() }
      this.jobs.set(jobId, recovered)
      return this.imageResult(recovered, snapshot)
    }
    if (name === 'build.create') {
      const recovered = await this.lookup(runId, operationId, requestDigest, name)
      if (recovered) return recovered
      const { snapshot, target } = await this.authority.resolve(runId, schema[name].parse(input).target)
      if (target.kind !== 'document' || snapshot.model.kind !== 'course-v9') throw new Error('构建导入要求整份 V9 文档授权，不接受局部范围')
      const policy = await this.services.builds!.policy?.(runId, snapshot.documentId)
      this.authority.active(runId, snapshot.documentId, snapshot.epoch)
      const digest = documentDigest(snapshot.model)
      const frozen: BuildJobInput = { runId, target: { documentId: snapshot.documentId, projectId: snapshot.model.project.id, epoch: snapshot.epoch, baseRevision: snapshot.revision, modelDigest: digest }, readSet: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, digest }], baseline: snapshot.model, allowedOrigins: policy?.allowedOrigins ?? snapshot.model.project.network?.connectOrigins ?? [] }
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
      if (result.status === 'applied') {
        const after = await session.drain()
        if (after.revision === result.revision && after.epoch === current.epoch) this.authority.applied(runId, current, after)
      }
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
