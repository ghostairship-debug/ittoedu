import { z } from 'zod'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolResult, ToolTarget, ToolRunGrant, ToolResultImage, PreparedToolImage } from '../../shared/workbench/tools'
import type { ImageGenerationRequest, ImageJobSnapshot, ImageModelSelection } from '../../shared/workbench/images'
import { parseGeneratedImageReference } from '../../shared/workbench/images'
import type { HostImageInput } from './imageResource'
import type { HostMediaInput } from './mediaResource'
import type { AssetSource } from '../../shared/contracts/media-v1'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { ComputeArtifact, ComputeJobInput, ComputeJobSnapshot } from '../../shared/workbench/compute'
import { DocumentRegistry } from '../documents/DocumentRegistry'
import { documentDigest } from '../documents/documentDigest'
import type { SkillServicePort, LocalToolRunIntent, LocalToolRunPreview, ReadonlyDelegationIntent, PreparedTaskSource } from '../../shared/workbench/toolPorts'
import { executeSkillRead, executeSkillList } from './SkillTools'
import { documentDeliveryReceiptResult, executeDocumentDeliveryTool, executeTaskFinishDelivery, type TaskFinishDeliveryContext } from './DocumentDeliveryTools'
import { executeViewObserveTool, type ViewObserveToolContext } from './ViewObserveTools'
import type { DocumentDeliveryServicePort, ObservationServicePort } from '../../shared/workbench/toolPorts'
import { handleToolTarget, hasRunWrite, toolRegistrationFor, type ToolSupportContext } from './ToolRegistration'
import type { OfficeContentToolName } from './OfficeContentTools'
import { computeArtifactSource, delegationArtifactSource, resolveArtifactSource, type HostArtifactSaveInput, type HostArtifactResolvedSource } from './HostArtifactTools'
import type { MaterialToolName } from './MaterialTools'
import type { HtmlActionToolName } from './HtmlActionTools'
import { serviceToolOutcome } from './modelToolResult'

/** Main supplies real services. Neither their implementations nor credentials enter core. */
export interface HostToolServices {
  /** The document owner proves a saved source and an opened document share identity; this grants no access. */
  matchesSavedDocument?(sourceDocumentId: string, currentDocumentId: string): Promise<boolean>
  htmlActions?: {
    execute(runId: string, document: { documentId: string; epoch: string; revision: number },
      action: { name: HtmlActionToolName; input: unknown; operationId: string }): Promise<unknown>
    readResource(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }>
  }
  office?: {
    execute(input: { grant: ToolRunGrant; operationId: string; name: OfficeContentToolName; input: unknown;
      approvedPaths?: readonly string[]; assertActive(): void }): Promise<ToolResult>
  }
  pptxImport?: {
    import(input: { grant: ToolRunGrant; operationId: string; requestDigest: string; path: string; destination?: string; assertActive(): void }): Promise<ToolResult>
    lookup?(runId: string, operationId: string, requestDigest: string): Promise<ToolResult | null>
  }
  materials?: {
    admit(runId: string, sourceIds: readonly string[]): Promise<void>
    read(runId: string, name: MaterialToolName, input: unknown): Promise<ToolResult>
    readResource(input: { runId: string; resourceId: string }): Promise<{ mimeType: string; bytes: Uint8Array }>
  }
  artifacts?: {
    preflight?(input: { grant: ToolRunGrant; destination: string }): Promise<{ path: string; parent: string; outsideWorkspace: boolean; approvalRequired: boolean }>
    lookup(runId: string, operationId: string): Promise<unknown | null>
    save(input: { grant: ToolRunGrant; operationId: string; source: HostArtifactResolvedSource; bytes: Uint8Array;
      approvedPaths?: readonly string[]; assertActive(): void }): Promise<unknown>
  }
  computeInputs?: { freeze(runId: string, sources: readonly string[]): Promise<ComputeJobInput['inputs']> }
  taskInputs?: { freeze(runId: string, sources: readonly string[]): Promise<readonly PreparedTaskSource[]> }
  /** Existing file authorization freezes source bytes; this port owns no document or write state. */
  mediaFiles?: { read(runId: string, source: string): Promise<HostMediaInput> }
  skills?: SkillServicePort
  deliveries?: DocumentDeliveryServicePort
  observations?: ObservationServicePort
  /** Course paths open through the formal document host under the frozen file grant. */
  projectFiles?: {
    /** Open a course named by path through the document host, within the task's file access. */
    openProject?(input: { runId: string; path: string; fileAccess: ToolRunGrant['fileAccess'] }): Promise<{ documentId: string; writable: boolean }>
  }
  /** Thin routes to the existing durable owners; this is not a second job store. */
  jobs?: {
    status(ref: HostJobRef): Promise<HostJobView>
    wait(ref: HostJobRef & { milliseconds: number; signal?: AbortSignal }): Promise<HostJobView>
    logs(ref: HostJobRef & { after?: number; limit?: number }): Promise<unknown>
    cancel(ref: HostJobRef): Promise<HostJobView>
  }
  compute?: {
    availability?(): Promise<{ available: boolean; reason?: string }> | { available: boolean; reason?: string }
    start(input: ComputeJobInput): Promise<ComputeJobSnapshot>
    readArtifact(runId: string, jobId: string, name: string): Promise<{ artifact: ComputeArtifact; bytes: Uint8Array }>
    cancel(runId: string, jobId: string): Promise<ComputeJobSnapshot>
    cancelRun(runId: string): Promise<void>
  }
  delegation?: {
    availability(): { ready: boolean; reason: string }
    prepareLocal?(input: { runId: string; jobId: string; taskId: string; intent: LocalToolRunIntent; sources: readonly PreparedTaskSource[] }): Promise<LocalToolRunPreview>
    authorizeLocal?(input: { runId: string; jobId: string; taskId: string; intent: LocalToolRunIntent }): void | Promise<void>
    startLocal?(input: { runId: string; jobId: string; taskId: string; intent: LocalToolRunIntent }): Promise<HostDelegationSnapshot>
    startReadonly?(input: { runId: string; jobId: string; taskId: string; intent: ReadonlyDelegationIntent; sources: readonly PreparedTaskSource[] }): Promise<HostDelegationSnapshot>
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
  /** The same Component API 5 catalog used by the component panel. */
  assetLibrary?: {
    import(input: { runId: string; file: string }): Promise<unknown>
    delete(input: { runId: string; packageId: string; version?: string; sourceId?: string }): Promise<unknown>
    search(input: { runId: string; query: string; limit?: number }): Promise<unknown>
    read(input: { runId: string; packageId: string; version?: string }): Promise<
      | { status: 'ready'; packageId: string; version: string; name: string; entry: ComponentLibraryEntry }
      | { status: 'rejected' | 'failed'; reason: string }>
    save(input: { runId: string; entry: ComponentLibraryEntry; description?: string; subject?: readonly string[]; schoolStage?: readonly string[];
      tags?: readonly string[]; sourceCourse?: string }): Promise<unknown>
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
}
export type HostJobRef = { runId: string; kind: 'image' | 'compute' | 'delegation'; jobId: string }
export type HostJobView = { kind: HostJobRef['kind']; jobId: string; status: string; terminal: boolean; snapshot: unknown }
export type ComputeRunInput = Omit<ComputeJobInput, 'runId' | 'jobId'> & { sources?: readonly string[] }
export type DelegationRunInput = { goal: string; materials?: readonly string[]; expectedArtifacts: readonly string[] }
export type DelegationReadInput = { job: string; name: string; offset?: number; limit?: number; version?: string }
type HostDelegationSnapshot = { jobId: string; status: string; terminal: boolean; stopped: boolean;
  reason?: string; artifacts: readonly { name: string; digest: string; byteLength: number }[] }
const handle = z.string().min(1)
// The currently supported OAuth and OpenAI-compatible Images routes accept these
// common request options; decoding still preserves the actual raster format.
const output = z.object({ size: z.union([z.literal('auto'), z.string().regex(/^\d{2,5}x\d{2,5}$/)]).optional(), quality: z.enum(['auto', 'low', 'medium', 'high']).optional(), format: z.literal('png').optional(), background: z.enum(['auto', 'opaque', 'transparent']).optional() }).strict()
// Document work binds resources to its captured target; workspace work needs no empty course.
const imageInput = z.object({ target: handle.optional(), prompt: z.string().min(1), output: output.optional() }).strict()
const schema = {
  'image.generate': imageInput,
  'image.edit': imageInput.extend({ references: z.array(handle).min(1) }).strict(),
  'image.status': z.object({ job: handle }).strict(),
} as const
export type HostToolName = keyof typeof schema
const descriptions: Record<HostToolName, string> = {
  'image.generate': '通过任务开始时冻结的 GPT OAuth 或已显式启用的 OpenAI Images API 连接生成图片。target 绑定当前获授权的课件或对象，省略时生成独立工作空间资源。ready 返回本任务资源，可用 project.apply from 插入或 media.apply 原位替换，也可直接把 htmlSource 用作 HTML 图片 src 或 CSS 图片 URL；软件读取已授权字节并存入工程，勿自造资源地址。ready 本身未写入工程。当前请求 PNG、auto/low/medium/high 画质。',
  'image.edit': '编辑已有图片。references 原样传入返回的 source/resource，或当前文档的整张专业图片/图片素材句柄。宿主读取原字节并使用冻结连接。返回资源须经 project.apply 或 media.apply 正式应用；未知结果不自动重发。',
  'image.status': '查询本任务图片状态；ready 返回已校验的本任务图片资源身份，不返回 base64 或临时 URL。',
}
interface HostImageToolHandler {
  run(name: HostToolName, input: z.infer<(typeof schema)[HostToolName]>): Promise<ToolResult>
}
const registerImage = toolRegistrationFor<HostImageToolHandler>()
export const hostToolCatalog = (Object.keys(schema) as HostToolName[]).map(name => registerImage({ name, description: descriptions[name], inputSchema: schema[name],
  manual: { label: name, group: name === 'image.status' ? 'read' : 'edit', targetKinds: ['document', 'course-surface', 'course-instance'] },
}, {
  capability: name === 'image.status' ? 'read' : 'resource', effect: name === 'image.status' ? null : 'image-generation',
  supports: context => context.images !== false && (context.standaloneImage === true || hasRunWrite(context, ['course-instance'], 'course-v10')),
  targets: (input, resolver) => 'target' in input && input.target ? handleToolTarget({ target: input.target }, resolver) : [],
  handler: (context, input) => context.run(name, input),
}))
export function hostToolRegistration(name: string) { return hostToolCatalog.find(tool => tool.name === name) }
export const isHostToolName = (name: string): name is HostToolName => Object.hasOwn(schema, name)
interface HostAuthority {
  resolveImage(runId: string, target: string): Promise<{ snapshot: DocumentSnapshot; target: ToolTarget }>
  active(runId: string, documentId: string, epoch: string): void
  ownsDocument(runId: string, documentId: string): boolean
  /** Current Gateway grants include documents opened after the run began. */
  documentIds?(runId: string): readonly string[]
  /** Prior receipt identity, including a detached document; never edit authority. */
  ownsReceiptDocument?(runId: string, documentId: string): boolean
  provideImage(runId: string, documentId: string, source: HostImageInput): Promise<string>
  readImage(runId: string, documentId: string, resource: string): Promise<HostImageInput>
  /** The Gateway resolves its own current-run resource handle; absent means this is another image source. */
  readRunImage?(runId: string, resource: string): Promise<HostImageInput | null>
}
interface Job { runId: string; documentId: string; epoch: string; jobId: string }
interface ImageJob extends Job { kind: 'image'; scope: 'document' | 'workspace'; sourceRunId?: string; sourceDocumentId?: string; controller: AbortController; resources: Map<string, string> }
interface CachedResult { runId: string; name: string; promise: Promise<ToolResult>; pending: boolean; uncertain: boolean; receipt: boolean }

/** Service work prepares resources; the Gateway owns canonical document operations. */
export class HostToolCoordinator {
  private readonly jobs = new Map<string, ImageJob>()
  private readonly runs = new Map<string, { grant: ToolRunGrant; stopped: boolean;
    computeJobs: Set<string>; pendingCompute: Set<Promise<ComputeJobSnapshot>>; continuationReads: Set<string>;
    delegationJobs: Set<string>; pendingDelegation: Set<Promise<HostDelegationSnapshot>> }>()
  private readonly results = new Map<string, CachedResult>()
  private readonly reissuedImages = new Map<string, { runId: string; promise: Promise<string> }>()
  private readonly approvedPaths = new Map<string, { runId: string; paths: readonly string[] }>()
  private readonly htmlResources = new Map<string, Set<string>>()
  constructor(private services: HostToolServices, private readonly registry: DocumentRegistry, private readonly authority: HostAuthority) {}
  configure(services: HostToolServices) { this.services = services }
  async beginRun(grant: ToolRunGrant) {
    await this.services.beginRun?.(structuredClone(grant))
    this.runs.set(grant.runId, { grant: structuredClone(grant), stopped: false, computeJobs: new Set(), pendingCompute: new Set(), continuationReads: new Set(),
      delegationJobs: new Set(), pendingDelegation: new Set() })
  }
  private serviceRun(runId: string) {
    const run = this.runs.get(runId)
    if (!run || run.stopped) throw new Error('任务尚未授权或已经停止')
    return run
  }
  private builtInRun(runId: string) {
    const run = this.serviceRun(runId)
    if (!run.grant.fileAccess) throw new Error('当前任务没有冻结的宿主服务授权')
    return run
  }
  private writableRun(runId: string) {
    const run = this.builtInRun(runId)
    if (run.grant.fileAccess?.permission === 'read-only') throw new Error('只读任务不能提交外部作业')
    return run
  }
  private workspaceImageScope(runId: string): string {
    const run = this.builtInRun(runId)
    const root = run.grant.fileAccess?.workspaceRoot
    if (!root) throw new Error('独立图片需要本任务冻结的工作空间根目录')
    return `workspace:${documentDigest({ root })}`
  }
  /** Main supplies verified same-task ancestors. This permits ready-result reads, never writes or cancellation. */
  authorizeContinuationReads(runId: string, sourceRunIds: readonly string[]): void {
    const run = this.builtInRun(runId)
    run.continuationReads = new Set(sourceRunIds.filter(source => source !== runId))
  }
  private standaloneReference(jobId: string, resourceId: string): string {
    return `${jobId}@${resourceId}`
  }
  parseStandaloneImageReference(value: string): { jobId: string; resourceId: string } | null {
    return parseGeneratedImageReference(value)
  }
  private parseStandaloneReference(value: string): { jobId: string; resourceId: string } {
    const reference = this.parseStandaloneImageReference(value)
    if (!reference) throw new Error('独立参考图句柄无效；请使用本任务已完成图片的 resource 字段')
    return reference
  }
  projectFileServices() { return this.services.projectFiles }
  authorizeOperationPaths(runId: string, operationId: string, paths: readonly string[]): void {
    this.serviceRun(runId)
    this.approvedPaths.set(operationId, { runId, paths: [...paths] })
  }
  async executeOffice(runId: string, operationId: string, name: OfficeContentToolName, input: unknown): Promise<ToolResult> {
    const run = name === 'office.inspect' ? this.serviceRun(runId) : this.writableRun(runId)
    if (!this.services.office) return this.serviceUnavailable('Office 原格式服务尚未接入')
    const execute = () => this.services.office!.execute({ grant: run.grant, operationId, name, input,
      approvedPaths: this.approvedPaths.get(operationId)?.paths, assertActive: () => { this.serviceRun(runId) } })
    if (name === 'office.inspect') return execute()
    const previous = this.results.get(operationId)
    if (previous) return structuredClone(await previous.promise)
    const result = execute()
    this.rememberResult(runId, operationId, name, result)
    return structuredClone(await result)
  }
  async importPptx(runId: string, operationId: string, requestDigest: string, input: { path: string; destination?: string }): Promise<ToolResult> {
    const run = this.writableRun(runId), service = this.services.pptxImport
    if (!service) return this.serviceUnavailable('PPTX 课件导入服务尚未接入')
    const previous = this.results.get(operationId)
    if (previous) return structuredClone(await previous.promise)
    const result = service.import({ grant: run.grant, operationId, requestDigest, ...input, assertActive: () => { this.writableRun(runId) } })
    this.rememberResult(runId, operationId, 'course.importPptx', result)
    return structuredClone(await result)
  }
  async readMaterial(runId: string, name: MaterialToolName, input: unknown): Promise<ToolResult> {
    this.serviceRun(runId)
    if (!this.services.materials) return this.serviceUnavailable('材料读取服务尚未接入')
    const result = await this.services.materials.read(runId, name, input)
    this.serviceRun(runId)
    return this.observationImageResult(result)
  }
  async bindMaterialSources(runId: string, sourceIds: readonly string[]): Promise<void> {
    this.serviceRun(runId)
    if (!this.services.materials) throw new Error('材料读取服务尚未接入')
    await this.services.materials.admit(runId, sourceIds)
  }
  async saveArtifact(runId: string, operationId: string, _requestDigest: string, input: HostArtifactSaveInput): Promise<ToolResult> {
    const run = this.writableRun(runId), service = this.services.artifacts
    if (!service) return this.serviceUnavailable('成果文件保存服务尚未接入')
    const previous = await service.lookup(runId, operationId)
    if (previous) return { kind: 'read', data: previous }
    const resolved = resolveArtifactSource(input)
    const source = resolved.kind === 'image' ? await this.readGeneratedImageReference(runId, input.source)
      : resolved.kind === 'image-resource' ? await this.authority.readRunImage?.(runId, resolved.resource)
      : resolved.kind === 'compute' ? await this.readComputeArtifact(runId, resolved.job, resolved.name)
        : await this.readDelegationArtifact(runId, resolved.job, resolved.name)
    if (!source) throw new Error('图片资源引用无效')
    return { kind: 'read', data: await service.save({ grant: run.grant, operationId, source: resolved, bytes: source.bytes,
      approvedPaths: this.approvedPaths.get(operationId)?.paths, assertActive: () => { this.writableRun(runId) } }) }
  }
  async preflightArtifactSave(runId: string, input: HostArtifactSaveInput) {
    const run = this.writableRun(runId)
    if (!this.services.artifacts?.preflight) throw new Error('成果文件保存服务尚未接入路径预检')
    const result = await this.services.artifacts.preflight({ grant: run.grant, destination: input.destination })
    this.writableRun(runId)
    return result
  }
  supportContext(): ToolSupportContext {
    return { pptxImport: !!this.services.pptxImport, htmlActions: !!this.services.htmlActions, office: !!this.services.office, materials: !!this.services.materials, artifacts: !!this.services.artifacts,
      images: !!this.services.images, skills: !!this.services.skills, deliveries: !!this.services.deliveries,
      observations: !!this.services.observations, projectFiles: !!this.services.projectFiles, jobs: !!this.services.jobs,
      compute: !!this.services.compute, delegation: !!this.services.delegation, web: !!this.services.web,
      mcp: !!this.services.mcp, media: !!this.services.media, openImages: !!this.services.openImages, assetLibrary: !!this.services.assetLibrary }
  }
  async observePage(context: ViewObserveToolContext, input: unknown): Promise<ToolResult> {
    if (!this.services.observations) return { kind: 'error', code: 'service-unavailable', message: '画面观察服务尚未就绪' }
    return this.observationImageResult(await executeViewObserveTool(this.services.observations, context, input))
  }
  /** Result producers declare pixels once; transport consumers never infer their source. */
  private observationImageResult(result: ToolResult): ToolResult {
    if (result.kind !== 'read' || !result.data || typeof result.data !== 'object') return result
    const data = result.data as { image?: { resourceId?: unknown; mimeType?: unknown; byteLength?: unknown }; detail?: unknown }
    const image = data.image
    if (!image || typeof image.resourceId !== 'string' || typeof image.mimeType !== 'string' || !image.mimeType.startsWith('image/')) return result
    return { ...result, images: [{ kind: 'image', source: 'observation', resourceId: image.resourceId, mimeType: image.mimeType,
      ...(typeof image.byteLength === 'number' ? { byteLength: image.byteLength } : {}),
      ...(data.detail === 'auto' || data.detail === 'low' || data.detail === 'high' ? { detail: data.detail } : {}) }] }
  }
  /** Authorized bytes shared by UI/model/MCP adapters; no resource or document is created here. */
  async prepareResultImages(runId: string, result: ToolResult): Promise<readonly PreparedToolImage[]> {
    this.serviceRun(runId)
    if (result.kind !== 'read') return []
    const images: PreparedToolImage[] = []
    for (const image of result.images ?? []) {
      let prepared: { mimeType: string; bytes: Uint8Array }
      switch (image.source) {
        case 'preview': prepared = await this.readImagePreview(runId, image.resourceId); break
        case 'observation': prepared = await this.readObservationResource({ runId, resourceId: image.resourceId }); break
        case 'mcp': prepared = await this.readMcpResource(runId, image.resourceId); break
        default: { const unavailable: never = image.source; throw new Error(`不支持的图片来源：${unavailable}`) }
      }
      this.serviceRun(runId)
      if (prepared.mimeType !== image.mimeType || image.byteLength !== undefined && prepared.bytes.byteLength !== image.byteLength)
        throw new Error('图片资源身份或字节长度已变化')
      images.push({ kind: 'image', source: this.imageSourceIdentity(runId, image), mimeType: prepared.mimeType, bytes: Uint8Array.from(prepared.bytes),
        ...(image.label ? { label: image.label } : {}), ...(image.detail ? { detail: image.detail } : {}) })
    }
    return images
  }
  private imageSourceIdentity(runId: string, image: ToolResultImage): string {
    if (image.resourceId.startsWith('mcp:')) return `mcp:${runId}:${image.resourceId.slice(4)}`
    if (this.isImageSource(image.resourceId)) return image.resourceId
    for (const job of this.jobs.values()) if (job.runId === runId)
      for (const [resourceId, handle] of job.resources) if (handle === image.resourceId) return this.standaloneReference(job.jobId, resourceId)
    return `${image.source}:${runId}:${image.resourceId}`
  }
  readObservationResource(input: { runId: string; resourceId: string }): Promise<{ mimeType: string; bytes: Uint8Array }> {
    if (this.htmlResources.get(input.runId)?.has(input.resourceId) && this.services.htmlActions) {
      this.serviceRun(input.runId)
      return this.services.htmlActions.readResource(input.runId, input.resourceId)
    }
    if (input.resourceId.startsWith('material:')) {
      this.serviceRun(input.runId)
      if (!this.services.materials) return Promise.reject(new Error('材料图片服务尚未接入'))
      return this.services.materials.readResource(input)
    }
    if (!this.services.observations) return Promise.reject(new Error('画面观察服务尚未就绪'))
    return this.services.observations.readResource(input)
  }
  async executeHtmlAction(runId: string, document: { documentId: string; epoch: string; revision: number },
    action: { name: HtmlActionToolName; input: unknown; operationId: string }): Promise<ToolResult> {
    const run = this.serviceRun(runId)
    if ((action.name === 'html.click' || action.name === 'html.input') && run.grant.fileAccess?.permission === 'read-only')
      return { kind: 'error', code: 'not-authorized', message: '只读任务不能点击或输入 HTML 页面内容' }
    if (!this.services.htmlActions) return this.serviceUnavailable('HTML 页面操作服务尚未配置')
    const data = await this.services.htmlActions.execute(runId, document, action)
    this.serviceRun(runId)
    const resourceId = (data as { image?: { resourceId?: string } })?.image?.resourceId
    if (resourceId) {
      let resources = this.htmlResources.get(runId)
      if (!resources) { resources = new Set(); this.htmlResources.set(runId, resources) }
      resources.add(resourceId)
    }
    return this.observationImageResult({ kind: 'read', data })
  }
  deliverDocument(context: { runId: string; operationId: string; requestDigest: string; resolveHandle(handle: string, access: 'write'): Promise<{ documentId: string; epoch: string; revision: number }> }, name: 'file.save' | 'document.export', input: unknown): Promise<ToolResult> {
    if (!this.services.deliveries) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '文档保存与导出服务尚未就绪' })
    return executeDocumentDeliveryTool(this.services.deliveries, context, name, input)
  }
  completeTaskDelivery(context: TaskFinishDeliveryContext, input: unknown): Promise<ToolResult> {
    if (!this.services.deliveries) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '文档保存与导出服务尚未就绪' })
    return executeTaskFinishDelivery(this.services.deliveries, context, input)
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
  private recoveredWorkspaceImageScope(runId: string, snapshot: ImageJobSnapshot): string {
    const scope = this.workspaceImageScope(runId)
    if (snapshot.documentId !== scope || snapshot.runId !== runId && (snapshot.status !== 'ready' || snapshot.stopped))
      throw new Error('图片作业不属于当前任务工作空间的已完成成果')
    return scope
  }
  private async recoveredImageScope(runId: string, snapshot: ImageJobSnapshot): Promise<Pick<ImageJob, 'scope' | 'documentId' | 'epoch' | 'sourceDocumentId'>> {
    if (/^workspace:[a-f0-9]{64}$/.test(snapshot.documentId))
      return { scope: 'workspace', documentId: this.recoveredWorkspaceImageScope(runId, snapshot), epoch: '' }
    this.serviceRun(runId)
    if (snapshot.status !== 'ready' || snapshot.stopped)
      throw new Error('图片作业不属于当前已授权文档的已完成成果')
    let documentId = this.authority.ownsDocument(runId, snapshot.documentId) ? snapshot.documentId : undefined
    if (!documentId && this.services.matchesSavedDocument) for (const candidate of this.authority.documentIds?.(runId) ?? []) {
      if (this.authority.ownsDocument(runId, candidate) && await this.services.matchesSavedDocument(snapshot.documentId, candidate)) {
        documentId = candidate
        break
      }
    }
    if (!documentId) throw new Error('图片作业不属于当前已授权文档的已完成成果')
    const current = await this.registry.get(documentId).drain()
    this.authority.active(runId, documentId, current.epoch)
    return { scope: 'document', documentId, epoch: current.epoch, sourceDocumentId: snapshot.documentId }
  }
  private async readableJobRef(runId: string, input: Omit<HostJobRef, 'runId'>): Promise<HostJobRef> {
    const run = this.builtInRun(runId)
    if (input.kind === 'compute' && this.services.jobs && run.continuationReads.size) {
      try { await this.services.jobs.status({ runId, ...input }); return { runId, ...input } }
      catch (error) {
        if ((error as { code?: string }).code !== 'job-not-authorized') throw error
        for (const sourceRunId of run.continuationReads) {
          let view: HostJobView
          try { view = await this.services.jobs.status({ runId: sourceRunId, ...input }) }
          catch (cause) { if ((cause as { code?: string }).code === 'job-not-authorized') continue; throw cause }
          const snapshot = view.snapshot as ComputeJobSnapshot
          if (snapshot.status !== 'ready' || snapshot.stopped) throw new Error('原计算作业不是可读取的已完成成果')
          this.builtInRun(runId)
          return { runId: sourceRunId, ...input }
        }
        throw error
      }
    }
    if (input.kind !== 'image' || !this.services.images) return { runId, ...input }
    const snapshot = await this.services.images.read(input.jobId)
    if (snapshot.runId !== runId) await this.recoveredImageScope(runId, snapshot)
    // Only completed results admitted by the existing image reader can refer to
    // their durable producer. This does not grant that producer's cancel rights.
    return { runId: snapshot.runId, ...input }
  }
  async jobStatus(runId: string, input: Omit<HostJobRef, 'runId'>): Promise<ToolResult> {
    this.builtInRun(runId)
    if (!this.services.jobs) return this.serviceUnavailable('通用作业服务尚未配置')
    const data = this.jobResult(await this.services.jobs.status(await this.readableJobRef(runId, input)))
    this.builtInRun(runId)
    return { kind: 'read', data }
  }
  async jobWait(runId: string, input: Omit<HostJobRef, 'runId'> & { milliseconds: number }, signal?: AbortSignal): Promise<ToolResult> {
    this.builtInRun(runId)
    if (!this.services.jobs) return this.serviceUnavailable('通用作业服务尚未配置')
    const data = this.jobResult(await this.services.jobs.wait({ ...input, ...await this.readableJobRef(runId, input), signal }))
    this.builtInRun(runId)
    return { kind: 'read', data }
  }
  async jobLogs(runId: string, input: Omit<HostJobRef, 'runId'> & { after?: number; limit?: number }): Promise<ToolResult> {
    this.builtInRun(runId)
    if (!this.services.jobs) return this.serviceUnavailable('通用作业服务尚未配置')
    const data = await this.services.jobs.logs({ ...input, ...await this.readableJobRef(runId, input) })
    this.builtInRun(runId)
    return { kind: 'read', data }
  }
  async jobCancel(runId: string, input: Omit<HostJobRef, 'runId'>): Promise<ToolResult> {
    this.writableRun(runId)
    return this.services.jobs ? { kind: 'read', data: await this.services.jobs.cancel({ runId, ...input }) }
      : this.serviceUnavailable('通用作业服务尚未配置')
  }
  private computeArtifacts(snapshot: ComputeJobSnapshot) {
    return snapshot.artifacts.map(artifact => ({ ...artifact, source: computeArtifactSource(snapshot.jobId, artifact.name) }))
  }
  private delegationArtifacts(snapshot: HostDelegationSnapshot) {
    return snapshot.artifacts.map(artifact => ({ ...artifact, source: delegationArtifactSource(snapshot.jobId, artifact.name),
      read: { job: snapshot.jobId, name: artifact.name, version: artifact.digest } }))
  }
  private imageSources(snapshot: ImageJobSnapshot) {
    return snapshot.resources.map(resource => ({ ...resource, source: this.standaloneReference(snapshot.jobId, resource.resourceId),
      htmlSource: `cw-result:${encodeURIComponent(this.standaloneReference(snapshot.jobId, resource.resourceId))}`,
      resource: this.standaloneReference(snapshot.jobId, resource.resourceId) }))
  }
  private jobResult(view: HostJobView): HostJobView {
    if (view.kind === 'compute') {
      const snapshot = view.snapshot as ComputeJobSnapshot
      return { ...view, snapshot: { ...snapshot, artifacts: this.computeArtifacts(snapshot) } }
    }
    if (view.kind === 'image') {
      const snapshot = view.snapshot as ImageJobSnapshot
      return { ...view, snapshot: { ...snapshot, resources: this.imageSources(snapshot) } }
    }
    if (view.kind === 'delegation') {
      const snapshot = view.snapshot as HostDelegationSnapshot
      return { ...view, snapshot: { ...snapshot, artifacts: this.delegationArtifacts(snapshot) } }
    }
    return view
  }
  async runCompute(runId: string, operationId: string, input: ComputeRunInput): Promise<ToolResult> {
    const run = this.writableRun(runId)
    if (!this.services.compute) return this.serviceUnavailable('内置 Python 计算服务未配置')
    const availability = await this.services.compute.availability?.()
    if (availability && !availability.available) return this.serviceUnavailable(availability.reason ?? '受限计算后端尚未配置')
    if (!operationId || operationId.length > 512) throw new Error('计算操作身份无效')
    const jobId = `compute-${documentDigest([runId, operationId])}`
    const { sources, ...request } = input
    if (sources?.length && !this.services.computeInputs) return this.serviceUnavailable('计算输入文件读取尚未接入')
    const inputs = sources?.length ? await this.services.computeInputs!.freeze(runId, sources) : request.inputs
    this.writableRun(runId)
    const pending = this.services.compute.start({ ...structuredClone(request), ...(inputs ? { inputs } : {}), runId, jobId })
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
        outputNames: snapshot.outputNames, artifacts: this.computeArtifacts(snapshot), ...(snapshot.reason ? { reason: snapshot.reason } : {}),
        ...(snapshot.outputDiagnostics ? { outputDiagnostics: snapshot.outputDiagnostics } : {}),
        ...(snapshot.locations ? { locations: snapshot.locations } : {}), ...(snapshot.inputs ? { inputs: snapshot.inputs } : {}) } }
    } finally { run.pendingCompute.delete(pending) }
  }
  async readComputeArtifact(runId: string, jobId: string, name: string): Promise<{ artifact: ComputeArtifact; bytes: Uint8Array }> {
    this.builtInRun(runId)
    if (!this.services.compute) throw new Error('受限计算后端未配置')
    const ref = await this.readableJobRef(runId, { kind: 'compute', jobId })
    const artifact = await this.services.compute.readArtifact(ref.runId, jobId, name)
    this.builtInRun(runId)
    return artifact
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
        artifacts: this.delegationArtifacts(snapshot), ...(snapshot.reason ? { reason: snapshot.reason } : {}) } }
    } finally { run.pendingDelegation.delete(pending) }
  }
  private delegationIdentity(runId: string, operationId: string) {
    if (!operationId || operationId.length > 512) throw new Error('任务操作身份无效')
    return { runId, jobId: `delegate-${documentDigest([runId, operationId])}`, taskId: operationId }
  }
  async prepareLocalRun(runId: string, operationId: string, intent: LocalToolRunIntent): Promise<LocalToolRunPreview> {
    this.writableRun(runId)
    if (!this.services.delegation?.prepareLocal) throw new Error('本地工具执行服务尚未接入')
    if (intent.sources?.length && !this.services.taskInputs) throw new Error('任务输入读取服务尚未接入')
    const sources = intent.sources?.length ? await this.services.taskInputs!.freeze(runId, intent.sources) : []
    this.writableRun(runId)
    return this.services.delegation.prepareLocal({ ...this.delegationIdentity(runId, operationId), intent, sources })
  }
  async authorizeLocalRun(runId: string, operationId: string, intent: LocalToolRunIntent): Promise<void> {
    this.writableRun(runId)
    if (!this.services.delegation?.authorizeLocal) throw new Error('本地工具逐项批准服务尚未接入')
    await this.services.delegation.authorizeLocal({ ...this.delegationIdentity(runId, operationId), intent })
    this.writableRun(runId)
  }
  async runLocalTool(runId: string, operationId: string, intent: LocalToolRunIntent): Promise<ToolResult> {
    this.writableRun(runId)
    if (!this.services.delegation?.startLocal) return this.serviceUnavailable('本地工具执行服务尚未接入')
    return this.startTaskJob(runId, this.services.delegation.startLocal({ ...this.delegationIdentity(runId, operationId), intent }))
  }
  async runReadonlyDelegate(runId: string, operationId: string, intent: ReadonlyDelegationIntent): Promise<ToolResult> {
    this.builtInRun(runId)
    if (!this.services.delegation?.startReadonly) return this.serviceUnavailable('只读子任务服务尚未接入')
    if (intent.sources.length && !this.services.taskInputs) return this.serviceUnavailable('任务输入读取服务尚未接入')
    const sources = intent.sources.length ? await this.services.taskInputs!.freeze(runId, intent.sources) : []
    this.builtInRun(runId)
    return this.startTaskJob(runId, this.services.delegation.startReadonly({ ...this.delegationIdentity(runId, operationId), intent, sources }))
  }
  private async startTaskJob(runId: string, pending: Promise<HostDelegationSnapshot>): Promise<ToolResult> {
    const run = this.builtInRun(runId)
    run.pendingDelegation.add(pending)
    try {
      const snapshot = await pending
      run.delegationJobs.add(snapshot.jobId)
      const result = run.stopped ? await this.services.delegation!.cancel(runId, snapshot.jobId) : snapshot
      return { kind: 'read', data: { ...result, job: result.jobId, artifacts: this.delegationArtifacts(result) } }
    } finally { run.pendingDelegation.delete(pending) }
  }
  async readDelegationArtifact(runId: string, jobId: string, name: string) {
    this.builtInRun(runId)
    if (!this.services.delegation) throw new Error('任务成果读取尚未配置')
    const ref = await this.readableJobRef(runId, { kind: 'delegation', jobId })
    const result = await this.services.delegation.readArtifact(ref.runId, jobId, name)
    this.builtInRun(runId)
    return result
  }
  async readDelegation(runId: string, input: DelegationReadInput): Promise<ToolResult> {
    this.builtInRun(runId)
    if (!this.services.delegation) return this.serviceUnavailable('有限委派服务尚未配置')
    const { artifact, bytes } = await this.readDelegationArtifact(runId, input.job, input.name)
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
      source: delegationArtifactSource(input.job, artifact.name), trust: 'delegated-candidate-untrusted' } }
  }
  /** Byte port for the file owner. A model never receives the generated bytes. */
  async readStandaloneImage(runId: string, jobId: string, resourceId: string): Promise<HostImageInput> {
    const scope = this.workspaceImageScope(runId)
    if (!this.services.images?.readReadyResourceFromJob) throw new Error('独立图片资源读取服务尚未配置')
    const snapshot = await this.services.images.read(jobId)
    if (snapshot.documentId !== scope) throw new Error('图片作业不属于当前任务工作空间')
    return this.services.images.readReadyResourceFromJob({ jobId, sourceRunId: snapshot.runId, sourceDocumentId: scope, resourceId })
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
    if (!this.services.mcp) return this.serviceUnavailable('外部 MCP 服务尚未配置')
    const data = await this.services.mcp.invoke({ runId, operationId, name, arguments: args, ...(snapshotId ? { snapshotId } : {}), signal })
    this.builtInRun(runId)
    return { kind: 'read', data: this.mcpResultSources(data) }
  }
  /** Normal replies and uncertain-call lookup expose the same owner-issued sources without granting resource access. */
  private mcpResultSources(data: unknown): unknown {
    if (!data || typeof data !== 'object') return data
    const source = (item: unknown): unknown => item && typeof item === 'object' && 'resourceId' in item
      && typeof item.resourceId === 'string' && 'mimeType' in item && typeof item.mimeType === 'string' && /^(?:image|audio|video)\//.test(item.mimeType)
      ? { ...item, source: `mcp:${item.resourceId}` } : item
    const result = data as { content?: unknown[]; downloads?: unknown[] }
    return { ...data, ...(Array.isArray(result.content) ? { content: result.content.map(source) } : {}),
      ...(Array.isArray(result.downloads) ? { downloads: result.downloads.map(source) } : {}) }
  }
  async readMcpResource(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    this.builtInRun(runId)
    if (!this.services.mcp) throw new Error('外部 MCP 服务尚未配置')
    return this.services.mcp.readResource(runId, resourceId)
  }
  async lookupMcp(runId: string, operationId: string): Promise<unknown | null> {
    return this.mcpResultSources(await this.services.mcp?.lookup(runId, operationId) ?? null)
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
    const previews: { image: string; resourceId: string; mimeType: string; byteLength: number }[] = []
    const failures: { image: string; reason: string }[] = [], candidates: string[] = []
    for (const image of input.images) {
      try {
        const file = await this.generatedImagePreview(runId, image)
        if (file) previews.push({ image, resourceId: image, mimeType: file.mimeType, byteLength: file.bytes.byteLength })
        else candidates.push(image)
      } catch (error) { failures.push({ image, reason: error instanceof Error ? error.message : '图片读取失败' }) }
    }
    if (candidates.length) {
      if (!this.services.openImages) failures.push(...candidates.map(image => ({ image, reason: '图片资源不属于本任务，且开放图库服务尚未配置' })))
      else {
        const result = await this.services.openImages.preview({ runId, images: candidates, signal })
        // Preserve the existing library receipt, including its partial-result diagnostics.
        if (!previews.length && !failures.length) return this.previewImageResult(result)
        const library = result as { previews?: typeof previews; failures?: typeof failures; reason?: string }
        previews.push(...library.previews ?? [])
        failures.push(...library.failures ?? (library.reason ? candidates.map(image => ({ image, reason: library.reason! })) : []))
      }
    }
    this.builtInRun(runId)
    return this.previewImageResult(previews.length ? { status: 'prepared', previews, ...(failures.length ? { failures } : {}) }
      : { status: 'failed', reason: '没有取得可查看的图片', failures })
  }
  private previewImageResult(data: unknown): ToolResult {
    const prepared = data as { status?: string; previews?: { image: string; resourceId: string; mimeType: string; byteLength: number }[] }
    const images: ToolResultImage[] = prepared?.status === 'prepared' ? (prepared.previews ?? []).map(image => ({
      kind: 'image', source: 'preview', resourceId: image.resourceId, mimeType: image.mimeType,
      byteLength: image.byteLength, label: `图片 ${image.image}：`,
    })) : []
    return { kind: 'read', data, ...(images.length ? { images } : {}) }
  }
  private async generatedImagePreview(runId: string, image: string): Promise<HostImageInput | null> {
    return this.readImageReference(runId, image)
  }
  async readImageReference(runId: string, image: string): Promise<HostImageInput | null> {
    this.serviceRun(runId)
    const result = await this.readImageSource(runId, image) ?? await this.authority.readRunImage?.(runId, image) ?? null
    this.serviceRun(runId)
    return result
  }
  isImageSource(source: string): boolean {
    return !!this.parseStandaloneImageReference(source) || /^(?:material:|mcp:|compute-[^@\s]+@)/.test(source)
  }
  /** Existing resource owners validate the source; application still registers bytes in its one canonical transaction. */
  private async readResourceSource(runId: string, source: string): Promise<HostMediaInput | null> {
    const generated = await this.readGeneratedImageReference(runId, source)
    if (generated) return generated
    let file: { bytes: Uint8Array; mimeType: string } | undefined, filename: string | undefined
    if (source.startsWith('material:')) file = await this.readObservationResource({ runId, resourceId: source })
    else if (source.startsWith('mcp:')) file = await this.readMcpResource(runId, source.slice(4))
    else if (source.startsWith('compute-') && source.includes('@')) {
      const reference = resolveArtifactSource({ source, destination: '' })
      if (reference.kind !== 'compute') return null
      const result = await this.readComputeArtifact(runId, reference.job, reference.name)
      file = { bytes: result.bytes, mimeType: result.artifact.mimeType }; filename = result.artifact.name
    }
    if (!file) return null
    this.serviceRun(runId)
    return { ...file, filename: filename ?? `source.${file.mimeType.split('/')[1]}` }
  }
  async readImageSource(runId: string, source: string): Promise<HostImageInput | null> {
    const file = await this.readResourceSource(runId, source)
    if (file && !file.mimeType.startsWith('image/')) throw new Error('所选来源不是图片')
    return file
  }
  async readMediaSource(runId: string, source: string): Promise<HostMediaInput> {
    this.serviceRun(runId)
    const file = await this.readResourceSource(runId, source) ?? await this.authority.readRunImage?.(runId, source)
      ?? await this.services.mediaFiles?.read(runId, source)
    this.serviceRun(runId)
    if (!file) throw new Error('所选媒体来源不可读取')
    if (!/^(?:image|audio|video)\//.test(file.mimeType)) throw new Error('所选来源不是图片、音频或视频')
    return file
  }
  /** One generated-result reader for preview, reference editing and formal application. */
  async readGeneratedImageReference(runId: string, image: string): Promise<HostImageInput | null> {
    const reference = this.parseStandaloneImageReference(image)
    if (!reference) return null
    const service = this.services.images
    if (!service?.readReadyResourceFromJob) throw new Error('图片资源读取服务尚未配置')
    const snapshot = await service.read(reference.jobId), scope = await this.recoveredImageScope(runId, snapshot)
    const file = await service.readReadyResourceFromJob({ ...reference, sourceRunId: snapshot.runId, sourceDocumentId: snapshot.documentId })
    if (scope.scope === 'document') this.authority.active(runId, scope.documentId, scope.epoch)
    else this.workspaceImageScope(runId)
    return file
  }
  /** Preview bytes go only to the run's next model request, never into a document. */
  async readImagePreview(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    this.builtInRun(runId)
    const generated = await this.generatedImagePreview(runId, resourceId)
    if (generated) return generated
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
  /** One complete API 5 example for the canonical project writer. */
  libraryComponent(runId: string, packageId: string, version?: string) {
    this.writableRun(runId)
    if (!this.services.assetLibrary) throw new Error('资产库服务尚未配置')
    return this.services.assetLibrary.read({ runId, packageId, ...(version ? { version } : {}) })
  }
  async saveLibraryComponent(runId: string, operationId: string, input: Omit<Parameters<NonNullable<HostToolServices['assetLibrary']>['save']>[0], 'runId'>): Promise<ToolResult> {
    this.writableRun(runId)
    const existing = this.results.get(operationId)
    if (existing) return structuredClone(await existing.promise)
    const result: Promise<ToolResult> = this.services.assetLibrary
      ? this.services.assetLibrary.save({ runId, ...input }).then(data => ({ kind: 'read', data }))
      : Promise.resolve(this.serviceUnavailable('资产库服务尚未配置'))
    this.rememberResult(runId, operationId, 'asset.save', result)
    return structuredClone(await result)
  }
  async changeLibrary(runId: string, operationId: string, change: { kind: 'import'; file: string }
    | { kind: 'delete'; packageId: string; version?: string; sourceId?: string }): Promise<ToolResult> {
    this.writableRun(runId)
    const previous = this.results.get(operationId)
    if (previous) return structuredClone(await previous.promise)
    const service = this.services.assetLibrary
    if (!service) return this.serviceUnavailable('资产库服务尚未配置')
    const { kind, ...input } = change
    const result: Promise<ToolResult> = (kind === 'import' ? service.import({ runId, file: (input as { file: string }).file })
      : service.delete({ runId, ...(input as { packageId: string; version?: string; sourceId?: string }) }))
      .then(data => ({ kind: 'read', data }))
    this.rememberResult(runId, operationId, `asset.${kind}`, result)
    return structuredClone(await result)
  }
  /** The caller proves durable continuation lineage or current authority over the exact source document. */
  reissueImageForContinuation(currentRunId: string, sourceDocumentId: string, destinationDocumentId: string,
    sourceRunId: string, jobId: string, resourceId: string): Promise<string> {
    if (!this.services.images?.readReadyResourceFromJob || !this.authority.ownsDocument(currentRunId, destinationDocumentId))
      return Promise.reject(new Error('当前任务无权重新签发此图片资源'))
    const key = JSON.stringify([currentRunId, sourceDocumentId, destinationDocumentId, sourceRunId, jobId, resourceId])
    const existing = this.reissuedImages.get(key)
    if (existing) return existing.promise
    const work = (async () => {
      const snapshot = await this.registry.get(destinationDocumentId).drain()
      this.authority.active(currentRunId, destinationDocumentId, snapshot.epoch)
      const image = await this.services.images!.readReadyResourceFromJob!({ jobId, sourceRunId, sourceDocumentId, resourceId })
      this.authority.active(currentRunId, destinationDocumentId, snapshot.epoch)
      return this.authority.provideImage(currentRunId, destinationDocumentId, image)
    })()
    this.reissuedImages.set(key, { runId: currentRunId, promise: work })
    void work.catch(() => { if (this.reissuedImages.get(key)?.promise === work) this.reissuedImages.delete(key) })
    return work
  }
  async stop(runId: string) {
    const run = this.runs.get(runId)
    if (run) run.stopped = true
    for (const job of this.jobs.values()) if (job.runId === runId && job.kind === 'image') job.controller.abort()
    try {
      await Promise.allSettled([
        ...(this.services.stopRun ? [this.services.stopRun(runId)] : []),
        ...(this.services.observations?.stopRun ? [this.services.observations.stopRun(runId)] : []),
        ...[...this.jobs.values()].filter((job): job is ImageJob => job.runId === runId && job.kind === 'image').map(job => this.services.images!.stop(job.jobId)),
        ...(this.services.compute ? [this.services.compute.cancelRun(runId)] : []),
        ...(this.services.delegation ? [this.services.delegation.cancelRun(runId)] : []),
        ...(run?.pendingCompute ? [...run.pendingCompute].map(async pending => { const result = await pending; await this.services.compute?.cancel(runId, result.jobId) }) : []),
        ...(run?.computeJobs ? [...run.computeJobs].map(jobId => this.services.compute?.cancel(runId, jobId)) : []),
        ...(run?.pendingDelegation ? [...run.pendingDelegation].map(async pending => {
          const result = await pending; await this.services.delegation?.cancel(runId, result.jobId)
        }) : []),
        ...(run?.delegationJobs ? [...run.delegationJobs].map(jobId => this.services.delegation?.cancel(runId, jobId)) : []),
      ])
    } finally { this.releaseRuntime(runId) }
  }
  /** Called by stop after cancellation; durable owners retain jobs and delivery receipts. */
  releaseRuntime(runId: string): void {
    if (this.runs.get(runId)?.stopped === false) throw new Error('运行中的任务不能释放宿主授权和资源句柄')
    this.runs.delete(runId)
    for (const [id, job] of this.jobs) if (job.runId === runId) this.jobs.delete(id)
    for (const [id, entry] of this.approvedPaths) if (entry.runId === runId) this.approvedPaths.delete(id)
    for (const [id, entry] of this.reissuedImages) if (entry.runId === runId) this.reissuedImages.delete(id)
    this.htmlResources.delete(runId)
    for (const [id, entry] of this.results) if (entry.runId === runId && !entry.pending && !entry.uncertain && !entry.receipt) this.results.delete(id)
  }
  /** Counts the actual structures, including receipts which recovery still consumes. */
  runtimeCounts(runId?: string) {
    const belongs = (entry: { runId: string }) => runId === undefined || entry.runId === runId
    const runs = [...this.runs.entries()].filter(([id]) => runId === undefined || id === runId).map(([, run]) => run)
    const jobs = [...this.jobs.values()].filter(belongs), results = [...this.results.values()].filter(belongs)
    return { runs: runs.length, imageJobs: jobs.length, imageResources: jobs.reduce((count, job) => count + job.resources.size, 0),
      computeJobs: runs.reduce((count, run) => count + run.computeJobs.size, 0), pendingCompute: runs.reduce((count, run) => count + run.pendingCompute.size, 0),
      delegationJobs: runs.reduce((count, run) => count + run.delegationJobs.size, 0), pendingDelegation: runs.reduce((count, run) => count + run.pendingDelegation.size, 0),
      approvedPaths: [...this.approvedPaths.values()].filter(belongs).length, reissuedImages: [...this.reissuedImages.values()].filter(belongs).length,
      htmlResources: [...this.htmlResources.entries()].filter(([id]) => runId === undefined || id === runId).reduce((count, [, resources]) => count + resources.size, 0),
      results: results.length, pendingResults: results.filter(entry => entry.pending).length, uncertainResults: results.filter(entry => entry.uncertain).length,
      receiptResults: results.filter(entry => entry.receipt).length }
  }
  private rememberResult(runId: string, operationId: string, name: string, promise: Promise<ToolResult>): void {
    const entry: CachedResult = { runId, name, promise, pending: true, uncertain: false,
      receipt: name.startsWith('office.') || name === 'asset.save' || name === 'asset.import' || name === 'asset.delete'
        || name === 'course.importPptx' && !this.services.pptxImport?.lookup }
    this.results.set(operationId, entry)
    void promise.then(result => {
      entry.pending = false
      const outcome = serviceToolOutcome(name, result)
      entry.uncertain = outcome?.status === 'unknown' || outcome?.status === 'pending'
        || result.kind === 'error' && result.code === 'tool-outcome-unknown'
      // A service call may settle after stop has removed its runtime owner.
      if (!this.runs.has(runId) && !entry.uncertain && !entry.receipt && this.results.get(operationId) === entry) this.results.delete(operationId)
    }, () => { entry.pending = false; entry.uncertain = true })
  }
  invoke(runId: string, operationId: string, requestDigest: string, name: HostToolName, raw: unknown): Promise<ToolResult> {
    this.serviceRun(runId)
    const registration = hostToolRegistration(name)!
    if (!registration.supports(this.supportContext())) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '宿主未配置该正式服务' })
    const invoke = () => registration.handler({ run: (toolName, input) => this.execute(runId, operationId, requestDigest, toolName, input) }, raw)
    if (registration.capability === 'read') return invoke()
    const existing = this.results.get(operationId)
    if (existing) return existing.promise.then(result => structuredClone(result))
    const promise = invoke()
    this.rememberResult(runId, operationId, name, promise)
    return promise.then(result => structuredClone(result))
  }
  /** Recovery queries only; no registration of edit authority or reconstruction of a task. */
  async lookup(runId: string, operationId: string, requestDigest: string, name: string): Promise<ToolResult | null> {
    if ((name === 'local.run' || name === 'delegate.readonly') && this.services.jobs) {
      const identity = this.delegationIdentity(runId, operationId)
      let view: HostJobView
      try { view = await this.services.jobs.status({ runId, kind: 'delegation', jobId: identity.jobId }) }
      catch (error) { if ((error as { code?: string }).code === 'unknown-job') return null; throw error }
      const snapshot = this.jobResult(view).snapshot as HostDelegationSnapshot
      return { kind: 'read', data: { ...snapshot, job: identity.jobId } }
    }
    if ((name === 'image.generate' || name === 'image.edit') && this.services.images) {
      const jobId = `image-${operationId}`
      let snapshot: ImageJobSnapshot
      try { snapshot = await this.services.images.read(jobId) }
      catch (error) {
        if ((error as { code?: string } | null)?.code === 'unknown-image-job') return null
        throw error
      }
      const workspace = /^workspace:[a-f0-9]{64}$/.test(snapshot.documentId)
      if (snapshot.jobId !== jobId || snapshot.runId !== runId || snapshot.operation !== (name === 'image.edit' ? 'edit' : 'generate')
        || !workspace && !(this.authority.ownsReceiptDocument?.(runId, snapshot.documentId)
          ?? this.authority.ownsDocument(runId, snapshot.documentId))) throw new Error('原图片回执不属于此任务或文档')
      // The durable owner binds this fixed job/run identity to its original workspace.
      // Only immutable source references are returned; no current-run handle or write grant is reconstructed here.
      return { kind: 'read', data: { job: jobId, ...(workspace ? { scope: 'workspace' } : { documentId: snapshot.documentId }),
        status: snapshot.status, stopped: snapshot.stopped, resources: this.imageSources(snapshot), provenance: structuredClone(snapshot.provenance),
        ...(snapshot.failure ? { failure: structuredClone(snapshot.failure) } : {}), ...(snapshot.timing?.length ? { timing: structuredClone(snapshot.timing) } : {}) } }
    }
    if (name === 'artifact.save' && this.services.artifacts) {
      const receipt = await this.services.artifacts.lookup(runId, operationId)
      return receipt ? { kind: 'read', data: receipt } : null
    }
    if (name === 'course.importPptx' && this.services.pptxImport?.lookup) {
      const receipt = await this.services.pptxImport.lookup(runId, operationId, requestDigest)
      if (receipt) return structuredClone(receipt)
    }
    const cached = this.results.get(operationId)
    if (cached && cached.runId === runId && cached.name === name) return structuredClone(await cached.promise)
    if ((name === 'file.save' || name === 'document.export' || name === 'task.delivery') && this.services.deliveries) {
      const receipt = await this.services.deliveries.lookup({ runId, operationId, requestDigest })
      return receipt ? documentDeliveryReceiptResult(receipt) : null
    }
    return null
  }
  private get(runId: string, id: string, kind: 'image') {
    const job = this.jobs.get(id)
    if (!job || job.runId !== runId || job.kind !== kind) throw new Error('服务任务句柄不属于当前任务')
    if (job.kind === 'image' && job.scope === 'workspace') {
      if (job.documentId !== this.workspaceImageScope(runId)) throw new Error('图片作业不属于当前任务工作空间')
    } else this.authority.active(runId, job.documentId, job.epoch)
    return job
  }
  private async imageResult(job: ImageJob, snapshot: ImageJobSnapshot): Promise<ToolResult> {
    if (snapshot.jobId !== job.jobId || snapshot.runId !== (job.sourceRunId ?? job.runId) || snapshot.documentId !== (job.sourceDocumentId ?? job.documentId)) throw new Error('图像服务返回了不同任务的结果')
    if (job.scope === 'workspace') this.workspaceImageScope(job.runId)
    else this.authority.active(job.runId, job.documentId, job.epoch)
    const resources = []
    if (snapshot.status === 'ready' && !snapshot.stopped) for (const resource of snapshot.resources) {
      let id = job.resources.get(resource.resourceId)
      if (!id) {
        if (job.scope === 'workspace') {
          await this.readStandaloneImage(job.runId, job.jobId, resource.resourceId)
          id = this.standaloneReference(job.jobId, resource.resourceId)
        } else if (job.sourceRunId) {
          id = await this.reissueImageForContinuation(job.runId, job.sourceDocumentId ?? job.documentId, job.documentId, job.sourceRunId, job.jobId, resource.resourceId)
        } else id = await this.authority.provideImage(job.runId, job.documentId, await this.services.images!.readResource(resource.resourceId))
        job.resources.set(resource.resourceId, id)
      }
      resources.push({ resource: id, htmlSource: `cw-result:${encodeURIComponent(id)}`, source: this.standaloneReference(job.jobId, resource.resourceId), resourceId: resource.resourceId, mimeType: resource.mimeType, width: resource.width, height: resource.height, byteLength: resource.byteLength })
    }
    return { kind: 'read', data: { job: job.jobId, ...(job.scope === 'workspace' ? { scope: 'workspace' } : { documentId: job.documentId }), status: snapshot.status, stopped: snapshot.stopped, resources, provenance: snapshot.provenance,
      ...(snapshot.failure ? { failure: snapshot.failure } : {}), ...(snapshot.timing?.length ? { timing: snapshot.timing } : {}) } }
  }
  private async execute(runId: string, operationId: string, requestDigest: string, name: HostToolName, input: z.infer<(typeof schema)[HostToolName]>): Promise<ToolResult> {
    if (name === 'image.generate' || name === 'image.edit') {
      const value = schema[name].parse(input)
      const operation = name === 'image.edit' ? 'edit' : 'generate'
      const references = name === 'image.edit' ? schema['image.edit'].parse(input).references : undefined
      const target = value.target ? await this.authority.resolveImage(runId, value.target) : undefined
      if (!target) this.writableRun(runId)
      const documentId = target?.snapshot.documentId ?? this.workspaceImageScope(runId)
      if (target) for (const reference of references ?? []) await this.authority.readImage(runId, documentId, reference)
      else for (const reference of references ?? []) {
        const source = this.parseStandaloneReference(reference)
        await this.readStandaloneImage(runId, source.jobId, source.resourceId)
      }
      const selection = structuredClone(await this.services.images!.selection(runId, documentId, operation))
      if (target) this.authority.active(runId, documentId, target.snapshot.epoch)
      else { this.writableRun(runId); this.workspaceImageScope(runId) }
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
      if (known?.runId === runId) return this.imageResult(this.get(runId, jobId, 'image') as ImageJob, await this.services.images!.read(jobId))
      // A completed result can outlive its SDK session. Current document grants
      // or the frozen workspace scope prove access; old task handles are not reused.
      const snapshot = await this.services.images!.read(jobId), scope = await this.recoveredImageScope(runId, snapshot)
      const recovered: ImageJob = { kind: 'image', ...scope, jobId, runId, sourceRunId: snapshot.runId,
        controller: new AbortController(), resources: new Map() }
      this.jobs.set(jobId, recovered)
      return this.imageResult(recovered, snapshot)
    }

    throw new Error('宿主服务工具不受支持')
  }
}
