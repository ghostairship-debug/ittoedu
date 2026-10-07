import { z } from 'zod'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolResult, ToolTarget, ToolRunGrant } from '../../shared/workbench/tools'
import type { ImageGenerationRequest, ImageJobSnapshot, ImageModelSelection } from '../../shared/workbench/images'
import type { HostImageInput } from './imageResource'
import type { AssetSource } from '../../shared/contracts/media-v1'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { ComputeArtifact, ComputeJobInput, ComputeJobSnapshot } from '../../shared/workbench/compute'
import { DocumentRegistry } from '../documents/DocumentRegistry'
import { documentDigest } from '../documents/documentDigest'
import type { SkillServicePort } from '../../shared/workbench/toolPorts'
import { executeSkillRead, executeSkillList } from './SkillTools'
import { documentDeliveryReceiptResult, executeDocumentDeliveryTool } from './DocumentDeliveryTools'
import { executeViewObserveTool, type ViewObserveToolContext } from './ViewObserveTools'
import type { DocumentDeliveryServicePort, ObservationServicePort } from '../../shared/workbench/toolPorts'
import { handleToolTarget, hasRunWrite, toolRegistrationFor, type ToolSupportContext } from './ToolRegistration'
import type { OfficeContentToolName } from './OfficeContentTools'
import type { HostArtifactSaveInput } from './HostArtifactTools'
import type { MaterialToolName } from './MaterialTools'

/** Main supplies real services. Neither their implementations nor credentials enter core. */
export interface HostToolServices {
  office?: {
    execute(input: { grant: ToolRunGrant; operationId: string; name: OfficeContentToolName; input: unknown;
      approvedPaths?: readonly string[]; assertActive(): void }): Promise<ToolResult>
  }
  materials?: {
    admit(runId: string, sourceIds: readonly string[]): Promise<void>
    read(runId: string, name: MaterialToolName, input: unknown): Promise<ToolResult>
    readResource(input: { runId: string; resourceId: string }): Promise<{ mimeType: string; bytes: Uint8Array }>
  }
  artifacts?: {
    lookup(runId: string, operationId: string): Promise<unknown | null>
    save(input: { grant: ToolRunGrant; operationId: string; source: HostArtifactSaveInput; bytes: Uint8Array;
      approvedPaths?: readonly string[]; assertActive(): void }): Promise<unknown>
  }
  computeInputs?: { freeze(runId: string, sources: readonly string[]): Promise<ComputeJobInput['inputs']> }
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
  'image.generate': '通过任务开始时冻结的 GPT OAuth 或已显式启用的 OpenAI Images API 连接生成图片。target 绑定当前获授权的课件或对象，省略时生成独立工作空间资源。ready 返回本任务资源，可用 project.apply from 插入或 media.apply 原位替换；ready 本身未写入工程。当前请求 PNG、auto/low/medium/high 画质。',
  'image.edit': '编辑已有图片。课件 references 可用本任务图片资源，或当前文档的整张专业图片/图片素材句柄；独立图片用 job@resourceId。宿主读取原字节并使用冻结连接。返回资源须经 project.apply 或 media.apply 正式应用；未知结果不自动重发。',
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
  provideImage(runId: string, documentId: string, source: HostImageInput): Promise<string>
  readImage(runId: string, documentId: string, resource: string): Promise<HostImageInput>
}
interface Job { runId: string; documentId: string; epoch: string; jobId: string }
interface ImageJob extends Job { kind: 'image'; scope: 'document' | 'workspace'; controller: AbortController; resources: Map<string, string> }

/** Service work prepares resources; the Gateway owns canonical document operations. */
export class HostToolCoordinator {
  private readonly jobs = new Map<string, ImageJob>()
  private readonly runs = new Map<string, { grant: ToolRunGrant; stopped: boolean;
    computeJobs: Set<string>; pendingCompute: Set<Promise<ComputeJobSnapshot>>;
    delegationJobs: Set<string>; pendingDelegation: Set<Promise<HostDelegationSnapshot>> }>()
  private readonly results = new Map<string, Promise<ToolResult>>()
  private readonly reissuedImages = new Map<string, Promise<string>>()
  private readonly approvedPaths = new Map<string, readonly string[]>()
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
    if (!run.grant.fileAccess) throw new Error('当前任务没有冻结的宿主服务授权')
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
  authorizeOperationPaths(runId: string, operationId: string, paths: readonly string[]): void {
    this.serviceRun(runId)
    this.approvedPaths.set(operationId, [...paths])
  }
  async executeOffice(runId: string, operationId: string, name: OfficeContentToolName, input: unknown): Promise<ToolResult> {
    const run = name === 'office.inspect' ? this.serviceRun(runId) : this.writableRun(runId)
    if (!this.services.office) return this.serviceUnavailable('Office 原格式服务尚未接入')
    const execute = () => this.services.office!.execute({ grant: run.grant, operationId, name, input,
      approvedPaths: this.approvedPaths.get(operationId), assertActive: () => { this.serviceRun(runId) } })
    if (name === 'office.inspect') return execute()
    const previous = this.results.get(operationId)
    if (previous) return structuredClone(await previous)
    const result = execute()
    this.results.set(operationId, result)
    return structuredClone(await result)
  }
  readMaterial(runId: string, name: MaterialToolName, input: unknown): Promise<ToolResult> {
    this.serviceRun(runId)
    if (!this.services.materials) return Promise.resolve(this.serviceUnavailable('材料读取服务尚未接入'))
    return this.services.materials.read(runId, name, input)
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
    const source = input.kind === 'image' ? await this.readStandaloneImage(runId, input.job, input.resourceId)
      : await this.readComputeArtifact(runId, input.job, input.name)
    return { kind: 'read', data: await service.save({ grant: run.grant, operationId, source: input, bytes: source.bytes,
      approvedPaths: this.approvedPaths.get(operationId), assertActive: () => { this.writableRun(runId) } }) }
  }
  supportContext(): ToolSupportContext {
    return { office: !!this.services.office, materials: !!this.services.materials, artifacts: !!this.services.artifacts,
      images: !!this.services.images, skills: !!this.services.skills, deliveries: !!this.services.deliveries,
      observations: !!this.services.observations, projectFiles: !!this.services.projectFiles, jobs: !!this.services.jobs,
      compute: !!this.services.compute, delegation: !!this.services.delegation, web: !!this.services.web,
      mcp: !!this.services.mcp, media: !!this.services.media, openImages: !!this.services.openImages, assetLibrary: !!this.services.assetLibrary }
  }
  observePage(context: ViewObserveToolContext, input: unknown): Promise<ToolResult> {
    if (!this.services.observations) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '画面观察服务尚未就绪' })
    return executeViewObserveTool(this.services.observations, context, input)
  }
  readObservationResource(input: { runId: string; resourceId: string }): Promise<{ mimeType: string; bytes: Uint8Array }> {
    if (input.resourceId.startsWith('material:')) {
      this.serviceRun(input.runId)
      if (!this.services.materials) return Promise.reject(new Error('材料图片服务尚未接入'))
      return this.services.materials.readResource(input)
    }
    if (!this.services.observations) return Promise.reject(new Error('画面观察服务尚未就绪'))
    return this.services.observations.readResource(input)
  }
  deliverDocument(context: { runId: string; operationId: string; requestDigest: string; resolveHandle(handle: string, access: 'write'): Promise<{ documentId: string; epoch: string; revision: number }> }, name: 'file.save' | 'document.export', input: unknown): Promise<ToolResult> {
    if (!this.services.deliveries) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '文档保存与导出服务尚未就绪' })
    return executeDocumentDeliveryTool(this.services.deliveries, context, name, input)
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
        outputNames: snapshot.outputNames, artifacts: snapshot.artifacts, ...(snapshot.reason ? { reason: snapshot.reason } : {}),
        ...(snapshot.outputDiagnostics ? { outputDiagnostics: snapshot.outputDiagnostics } : {}),
        ...(snapshot.locations ? { locations: snapshot.locations } : {}), ...(snapshot.inputs ? { inputs: snapshot.inputs } : {}) } }
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
  /** One complete API 5 example for the canonical project writer. */
  libraryComponent(runId: string, packageId: string, version?: string) {
    this.writableRun(runId)
    if (!this.services.assetLibrary) throw new Error('资产库服务尚未配置')
    return this.services.assetLibrary.read({ runId, packageId, ...(version ? { version } : {}) })
  }
  async saveLibraryComponent(runId: string, operationId: string, input: Omit<Parameters<NonNullable<HostToolServices['assetLibrary']>['save']>[0], 'runId'>): Promise<ToolResult> {
    this.writableRun(runId)
    const existing = this.results.get(operationId)
    if (existing) return structuredClone(await existing)
    const result: Promise<ToolResult> = this.services.assetLibrary
      ? this.services.assetLibrary.save({ runId, ...input }).then(data => ({ kind: 'read', data }))
      : Promise.resolve(this.serviceUnavailable('资产库服务尚未配置'))
    this.results.set(operationId, result)
    return structuredClone(await result)
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
    const registration = hostToolRegistration(name)!
    if (!registration.supports(this.supportContext())) return Promise.resolve({ kind: 'error', code: 'service-unavailable', message: '宿主未配置该正式服务' })
    const invoke = () => registration.handler({ run: (toolName, input) => this.execute(runId, operationId, requestDigest, toolName, input) }, raw)
    if (registration.capability === 'read') return invoke()
    const existing = this.results.get(operationId)
    if (existing) return existing.then(result => structuredClone(result))
    const promise = invoke()
    this.results.set(operationId, promise)
    return promise.then(result => structuredClone(result))
  }
  /** Recovery queries only; no registration of edit authority or reconstruction of a task. */
  async lookup(runId: string, operationId: string, requestDigest: string, name: string): Promise<ToolResult | null> {
    if (name === 'artifact.save' && this.services.artifacts) {
      const receipt = await this.services.artifacts.lookup(runId, operationId)
      return receipt ? { kind: 'read', data: receipt } : null
    }
    if (name.startsWith('office.') && this.results.has(operationId)) return structuredClone(await this.results.get(operationId)!)
    if (name === 'asset.save') return this.results.has(operationId) ? structuredClone(await this.results.get(operationId)!) : null
    if ((name === 'file.save' || name === 'document.export') && this.services.deliveries) {
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
      // A recovered standalone result needs no document target handle to reconstruct.
      // The durable owner and frozen workspace scope still prove its authority.
      const snapshot = await this.services.images!.read(jobId), scope = this.workspaceImageScope(runId)
      if (snapshot.runId !== runId || snapshot.documentId !== scope) throw new Error('图片作业不属于当前任务工作空间')
      const recovered: ImageJob = { kind: 'image', scope: 'workspace', jobId, runId, documentId: scope, epoch: '', controller: new AbortController(), resources: new Map() }
      this.jobs.set(jobId, recovered)
      return this.imageResult(recovered, snapshot)
    }

    throw new Error('宿主服务工具不受支持')
  }
}
