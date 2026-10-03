import path from 'node:path'
import type { FileArtifactBinding } from '../../../shared/workbench/mediaFiles'
import type { WorkspaceOperationResult } from '../../../shared/workbench/workspaceFiles'
import { validateWorkspaceEntryName } from '../WorkspaceFiles'
import { AgentFileOutcomeUnknown } from '../../../core/tools/AgentFileTools'
import { applyOfficeContent, inspectOfficeContent, officeContentRequestSchema } from './OfficeContentService'
import type { OfficeCalculation, OfficeContentInspection, OfficeContentRequest, OfficeDiagnostic, OfficeFormat } from '../../../shared/workbench/officeFiles'

export interface OfficeFileContext {
  signal?: AbortSignal
  expectedVersion?: string
  /** Supplied by the frozen task owner; checked again at the physical commit. */
  assertActive?(): void
}
export interface OfficeFileDestination {
  workspaceId: string
  targetDirectoryId: string
  name: string
  operationId: string
}
export interface OfficeFileResult {
  status: 'saved'
  binding: FileArtifactBinding
  inspection: OfficeContentInspection
  diagnostics: OfficeDiagnostic[]
  calculation?: OfficeCalculation
}
export interface OfficeFileHost {
  artifacts: {
    bind(path: string): Promise<FileArtifactBinding>
    read(binding: FileArtifactBinding, signal?: AbortSignal): Promise<Uint8Array>
    replace(binding: FileArtifactBinding, bytes: Uint8Array, signal?: AbortSignal, beforeCommit?: () => void): Promise<FileArtifactBinding>
  }
  files: {
    createFile(input: OfficeFileDestination & { format: 'file'; bytes: Uint8Array }, beforeCommit?: () => void): Promise<WorkspaceOperationResult>
  }
}

/** Authority resolves paths and issues bindings before this service. Format mechanics use the existing file writer. */
export class OfficeFileService {
  constructor(private readonly host: OfficeFileHost) {}
  private active(context: OfficeFileContext): void { context.signal?.throwIfAborted(); context.assertActive?.() }
  async inspect(binding: FileArtifactBinding, format: OfficeFormat, context: OfficeFileContext = {}): Promise<{ binding: FileArtifactBinding; inspection: OfficeContentInspection }> {
    this.active(context)
    const bytes = await this.host.artifacts.read(binding, context.signal)
    this.active(context)
    return { binding, inspection: inspectOfficeContent(bytes, format) }
  }
  async create(destination: OfficeFileDestination, input: Extract<OfficeContentRequest, { operation: 'create' }>, context: OfficeFileContext = {}): Promise<OfficeFileResult> {
    const request = officeContentRequestSchema.parse(input)
    if (request.operation !== 'create') throw new Error('新建 Office 文件需要 create 内容请求')
    validateWorkspaceEntryName(destination.name)
    if (path.extname(destination.name).toLowerCase() !== `.${request.format}`) throw new Error(`此内容需要 .${request.format} 文件名`)
    this.active(context)
    const prepared = await applyOfficeContent(undefined, request)
    this.active(context)
    const receipt = await this.host.files.createFile({ ...destination, format: 'file', bytes: prepared.bytes }, () => this.active(context))
    const created = receipt.items.find(item => (item.status === 'success' || item.status === 'partial') && item.targetPath)
    if (!created?.targetPath) throw new Error(receipt.items.find(item => item.error)?.error?.message ?? 'Office 文件尚未保存')
    let binding: FileArtifactBinding, inspection: OfficeContentInspection
    try {
      binding = await this.host.artifacts.bind(created.targetPath)
      inspection = inspectOfficeContent(await this.host.artifacts.read(binding), request.format)
    } catch (cause) {
      throw new AgentFileOutcomeUnknown(`Office 文件已创建，但回读结果未确认；请先读取原件，不要重复新建：${cause instanceof Error ? cause.message : String(cause)}`)
    }
    // A stop after publication cannot turn an existing saved file into a claim that no write happened.
    return { status: 'saved', binding, inspection, diagnostics: [
      ...prepared.diagnostics,
      ...(created.error ? [{ code: created.error.code, message: created.error.message }] : []),
    ], ...(prepared.calculation ? { calculation: prepared.calculation } : {}) }
  }
  async edit(binding: FileArtifactBinding, input: Extract<OfficeContentRequest, { operation: 'edit' }>, context: OfficeFileContext = {}): Promise<OfficeFileResult> {
    const request = officeContentRequestSchema.parse(input)
    if (request.operation !== 'edit') throw new Error('已有 Office 文件修改需要 edit 内容请求')
    if (context.expectedVersion !== undefined && context.expectedVersion !== binding.fileVersion) throw new Error('Office 文件版本已改变，请读取当前内容后修改')
    this.active(context)
    const current = await this.host.artifacts.read(binding, context.signal)
    this.active(context)
    const prepared = await applyOfficeContent(current, request)
    this.active(context)
    const saved = await this.host.artifacts.replace(binding, prepared.bytes, context.signal, () => this.active(context))
    let inspection: OfficeContentInspection
    try { inspection = inspectOfficeContent(await this.host.artifacts.read(saved), request.format) }
    catch (cause) { throw new AgentFileOutcomeUnknown(`Office 修改已写入，但回读结果未确认；请先读取原件后继续：${cause instanceof Error ? cause.message : String(cause)}`) }
    return { status: 'saved', binding: saved, inspection, diagnostics: prepared.diagnostics,
      ...(prepared.calculation ? { calculation: prepared.calculation } : {}) }
  }
}
