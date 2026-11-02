import path from 'node:path'
import { Buffer } from 'node:buffer'
import type { FileArtifactBinding } from '../../../shared/workbench/mediaFiles'
import type { WorkspaceOperationResult } from '../../../shared/workbench/workspaceFiles'
import { validateWorkspaceEntryName } from '../WorkspaceFiles'
import { AgentFileOutcomeUnknown } from '../../../core/tools/AgentFileTools'
import { applyOfficeContentOffThread, inspectOfficeContentOffThread } from './officeContentWorker'
import { officeContentRequestSchema, type OfficeCalculation, type OfficeContentInspection, type OfficeContentRequest, type OfficeDiagnostic, type OfficeFormat, type OfficeHistorySnapshot } from '../../../shared/workbench/officeFiles'
import type { ArtifactHistoryMetadata } from '../FileArtifactHistory'

export interface OfficeFileContext {
  signal?: AbortSignal
  expectedVersion?: string
  /** Supplied by the frozen task owner; checked again at the physical commit. */
  assertActive?(): void
  /** Trusted entry point supplies actor/label; the format request cannot impersonate a human edit. */
  actor?: 'human' | 'ai'
  historyLabel?: string
  operationId?: string
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
    replace(binding: FileArtifactBinding, bytes: Uint8Array, signal?: AbortSignal, beforeCommit?: () => void, metadata?: ArtifactHistoryMetadata): Promise<FileArtifactBinding>
    history?(binding: FileArtifactBinding, signal?: AbortSignal): Promise<OfficeHistorySnapshot>
    moveHistory?(binding: FileArtifactBinding, action: 'undo' | 'redo', signal?: AbortSignal, beforeCommit?: () => void): Promise<FileArtifactBinding>
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
    const inspection = await inspectOfficeContentOffThread(bytes, format, context.signal)
    this.active(context)
    return { binding, inspection }
  }
  async create(destination: OfficeFileDestination, input: Extract<OfficeContentRequest, { operation: 'create' }>, context: OfficeFileContext = {}): Promise<OfficeFileResult> {
    const request = officeContentRequestSchema.parse(input)
    if (request.operation !== 'create') throw new Error('新建 Office 文件需要 create 内容请求')
    validateWorkspaceEntryName(destination.name)
    if (path.extname(destination.name).toLowerCase() !== `.${request.format}`) throw new Error(`此内容需要 .${request.format} 文件名`)
    this.active(context)
    const prepared = await applyOfficeContentOffThread(undefined, request, context.signal)
    this.active(context)
    const receipt = await this.host.files.createFile({ ...destination, format: 'file', bytes: prepared.bytes }, () => this.active(context))
    const created = receipt.items.find(item => (item.status === 'success' || item.status === 'partial') && item.targetPath)
    if (!created?.targetPath) throw new Error(receipt.items.find(item => item.error)?.error?.message ?? 'Office 文件尚未保存')
    let binding: FileArtifactBinding, inspection: OfficeContentInspection
    try {
      binding = await this.host.artifacts.bind(created.targetPath)
      inspection = await inspectOfficeContentOffThread(await this.host.artifacts.read(binding), request.format)
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
    const prepared = await applyOfficeContentOffThread(current, request, context.signal)
    this.active(context)
    if (Buffer.from(current).equals(prepared.bytes)) {
      // Revalidate through the physical owner, but do not manufacture a new file version for a no-op.
      const { inspection } = await this.inspect(binding, request.format, context)
      return { status: 'saved', binding, inspection, diagnostics: prepared.diagnostics,
        ...(prepared.calculation ? { calculation: prepared.calculation } : {}) }
    }
    const metadata: ArtifactHistoryMetadata | undefined = request.format === 'pptx' && path.extname(binding.path).toLowerCase() === '.pptx' ? {
      actor: context.actor ?? 'ai', label: context.historyLabel ?? (context.actor === 'human' ? '手动编辑演示文稿' : 'AI 编辑演示文稿'),
      ...(context.operationId ? { operationId: context.operationId } : {}),
    } : undefined
    const saved = await this.host.artifacts.replace(binding, prepared.bytes, context.signal, () => this.active(context), metadata)
    let inspection: OfficeContentInspection
    try { inspection = await inspectOfficeContentOffThread(await this.host.artifacts.read(saved), request.format) }
    catch (cause) { throw new AgentFileOutcomeUnknown(`Office 修改已写入，但回读结果未确认；请先读取原件后继续：${cause instanceof Error ? cause.message : String(cause)}`) }
    return { status: 'saved', binding: saved, inspection, diagnostics: prepared.diagnostics,
      ...(prepared.calculation ? { calculation: prepared.calculation } : {}) }
  }
  async history(binding: FileArtifactBinding, context: OfficeFileContext = {}): Promise<OfficeHistorySnapshot> {
    this.active(context)
    if (!this.host.artifacts.history) throw new Error('当前文件 owner 尚未提供共同编辑历史')
    return this.host.artifacts.history(binding, context.signal)
  }
  async moveHistory(binding: FileArtifactBinding, action: 'undo' | 'redo', context: OfficeFileContext = {}): Promise<OfficeFileResult> {
    this.active(context)
    if (context.expectedVersion !== undefined && context.expectedVersion !== binding.fileVersion) throw new Error('Office 文件版本已改变，请重新读取后操作')
    if (!this.host.artifacts.moveHistory) throw new Error('当前文件 owner 尚未提供共同编辑历史')
    const saved = await this.host.artifacts.moveHistory(binding, action, context.signal, () => this.active(context))
    let inspection: OfficeContentInspection
    try { inspection = await inspectOfficeContentOffThread(await this.host.artifacts.read(saved), 'pptx') }
    catch (cause) { throw new AgentFileOutcomeUnknown(`PPT 撤销/重做已写入，但回读未确认；请重新读取原件：${cause instanceof Error ? cause.message : String(cause)}`) }
    return { status: 'saved', binding: saved, inspection, diagnostics: [] }
  }
}
