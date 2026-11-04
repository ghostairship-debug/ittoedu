import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { FileArtifactBinding } from '../../../shared/workbench/mediaFiles'
import type { WorkspaceOperationResult } from '../../../shared/workbench/workspaceFiles'
import { validateWorkspaceEntryName } from '../WorkspaceFiles'
import { AgentFileOutcomeUnknown } from '../../../core/tools/AgentFileTools'
import { applyOfficeContentOffThread, applyOfficeObjectEditOffThread, inspectOfficeContentOffThread, mergeOfficeDraftOffThread } from './officeContentWorker'
import { officeContentRequestSchema, type OfficeCalculation, type OfficeContentInspection, type OfficeContentRequest, type OfficeContentResult, type OfficeDiagnostic, type OfficeFormat, type OfficeHistoryEntry, type OfficeHistorySnapshot } from '../../../shared/workbench/officeFiles'
import type { OfficeObjectEdit } from '../../../shared/workbench/officeObjectEdit'
import { validateOfficeCandidate } from './officeCandidate'
import { OfficeDraftMergeConflict } from './officeDraftMergeError'
import type { ArtifactHistoryMetadata, ArtifactHistorySnapshot, OfficeDraftRecovery } from '../FileArtifactHistory'
import { advanceOfficeDraft, assertOfficeDraft, assertOfficeDraftSession, closeOfficeDraft, findOfficeDraft, OfficeDraftUpdatedError,
  openOfficeDraft, readOfficeDraftObservation, type OfficeDraft } from './OfficeDrafts'

export interface OfficeFileContext {
  signal?: AbortSignal
  expectedVersion?: string
  /** Main retains the bytes read at this exact issued binding for an in-flight edit. */
  observedBytes?: Uint8Array
  /** Supplied by the frozen task owner; checked again at the physical commit. */
  assertActive?(): void
  /** Trusted entry point supplies actor/label; the format request cannot impersonate a human edit. */
  actor?: 'human' | 'ai'
  historyLabel?: string
  historyGroup?: string
  operationId?: string
}
export interface OfficeFileDestination {
  workspaceId: string
  targetDirectoryId: string
  name: string
  operationId: string
}
export interface OfficeFileResult {
  status: 'saved' | 'draft'
  binding: FileArtifactBinding
  inspection: OfficeContentInspection
  diagnostics: OfficeDiagnostic[]
  calculation?: OfficeCalculation
  /** Main-only exact receipt snapshot. Never publish to the model or persist it as tool data. */
  observedBytes?: Uint8Array
  /** Whether this operation changed the staged bytes. */
  applied?: boolean
}
export interface OfficeFileHost {
  artifacts: {
    bind(path: string): Promise<FileArtifactBinding>
    read(binding: FileArtifactBinding, signal?: AbortSignal): Promise<Uint8Array>
    replace(binding: FileArtifactBinding, bytes: Uint8Array, signal?: AbortSignal, beforeCommit?: () => void, metadata?: ArtifactHistoryMetadata): Promise<FileArtifactBinding>
    saveCopy?(source: FileArtifactBinding, target: string, bytes: Uint8Array, overwrite?: FileArtifactBinding): Promise<FileArtifactBinding>
    history?(binding: FileArtifactBinding, signal?: AbortSignal, offset?: number): Promise<ArtifactHistorySnapshot>
    readHistoryAtOffset?(binding: FileArtifactBinding, offset: number, signal?: AbortSignal): Promise<Uint8Array>
    moveHistory?(binding: FileArtifactBinding, action: 'undo' | 'redo', signal?: AbortSignal, beforeCommit?: () => void): Promise<FileArtifactBinding>
    notifyOfficeDraft?(before: FileArtifactBinding, binding: FileArtifactBinding): void
    nextOfficeDraftVersion?(): number
    readOfficeDraft?(binding: FileArtifactBinding): Promise<OfficeDraftRecovery | undefined>
    removeOfficeDraft?(binding: FileArtifactBinding): Promise<void>
  }
  files: {
    createFile(input: OfficeFileDestination & { format: 'file'; bytes: Uint8Array }, beforeCommit?: () => void): Promise<WorkspaceOperationResult>
  }
}

/** Authority resolves paths and issues bindings before this service. Format mechanics use the existing file writer. */
export class OfficeFileService {
  constructor(private readonly host: OfficeFileHost) {}
  private active(context: OfficeFileContext): void { context.signal?.throwIfAborted(); context.assertActive?.() }
  private draft(filename: string) { return findOfficeDraft(this.host.artifacts, filename) }
  async bindWorking(filename: string, open = false): Promise<FileArtifactBinding> {
    const base = await this.host.artifacts.bind(filename)
    let draft = this.draft(base.path)
    if (!draft && open) {
      const recovery = await this.host.artifacts.readOfficeDraft?.(base)
      const original = recovery ? await this.host.artifacts.read(base) : undefined
      draft = this.draft(base.path)
      if (!draft) {
        draft = openOfficeDraft(this.host.artifacts, base)
        if (recovery) {
          draft.recoveryBinding = base
          if (Buffer.from(original!).equals(recovery.bytes)) {
            draft.original = original; draft.bytes = original
            await this.clearRecovery(draft)
          } else {
            Object.assign(draft, recovery)
            advanceOfficeDraft(this.host.artifacts, draft, recovery.bytes, true)
          }
        }
      }
    }
    if (draft?.saveOutcomeUnknown && !draft.saving && base.fileVersion !== draft.baseVersion) {
      const binding = draft.binding, bytes = await this.host.artifacts.read(base)
      assertOfficeDraft(this.host.artifacts, draft, binding)
      if (Buffer.from(bytes).equals(draft.bytes!)) {
        this.finishSave(draft, base, bytes)
        await this.clearRecovery(draft)
      }
    }
    if (draft && !draft.saving && base.bindingVersion !== draft.base.bindingVersion) {
      if (draft.dirty && draft.bytes) {
        draft.base = base
        advanceOfficeDraft(this.host.artifacts, draft, draft.bytes, true)
      } else {
        draft = openOfficeDraft(this.host.artifacts, base)
      }
    }
    return draft?.binding ?? base
  }
  isDraftDirty(filename: string): boolean { return this.draft(filename)?.dirty ?? false }
  verifyDraftTarget(binding: FileArtifactBinding): string {
    const draft = this.draft(binding.path)
    if (!draft) throw new Error('目标 Office 文件已关闭，请重新打开并选择。')
    assertOfficeDraft(this.host.artifacts, draft, binding)
    return draft.binding.path
  }
  verifyDraftSession(binding: FileArtifactBinding): string {
    const draft = this.draft(binding.path)
    if (!draft) throw new Error('目标 Office 文件已关闭，请重新打开并选择。')
    assertOfficeDraftSession(this.host.artifacts, draft, binding)
    return draft.binding.path
  }
  baseBinding(binding: FileArtifactBinding): FileArtifactBinding { return this.draft(binding.path)?.base ?? binding }
  async closeWorking(filename: string, discard: boolean): Promise<void> {
    if (!discard && this.isDraftDirty(filename)) throw new Error('Office 文件有未保存的修改。')
    const draft = this.draft(filename)
    if (draft?.recoveryBinding) {
      assertOfficeDraft(this.host.artifacts, draft, draft.binding)
      draft.saving = true
      try { await this.clearRecovery(draft) }
      finally { draft.saving = false }
    }
    closeOfficeDraft(this.host.artifacts, filename)
  }
  async readWorking(binding: FileArtifactBinding, context: OfficeFileContext = {}): Promise<Uint8Array> {
    this.active(context)
    const draft = this.draft(binding.path)
    if (!draft) return this.host.artifacts.read(binding, context.signal)
    if (context.actor === 'ai') {
      assertOfficeDraftSession(this.host.artifacts, draft, binding)
      const observed = readOfficeDraftObservation(draft, binding)
      if (observed) return observed
    }
    assertOfficeDraft(this.host.artifacts, draft, binding)
    if (draft.bytes) return draft.bytes
    const original = await this.host.artifacts.read(draft.base, context.signal)
    this.active(context)
    assertOfficeDraft(this.host.artifacts, draft, binding)
    draft.bytes = original; draft.original = original
    return original
  }
  private async readMutationBase(draft: OfficeDraft | undefined, binding: FileArtifactBinding, context: OfficeFileContext) {
    if (!draft) return this.readWorking(binding, context)
    this.active(context)
    assertOfficeDraftSession(this.host.artifacts, draft, binding)
    const observed = context.observedBytes ?? readOfficeDraftObservation(draft, binding)
    if (observed) return observed
    return this.readWorking(binding, context)
  }
  private async recordDraft(draft: OfficeDraft, binding: FileArtifactBinding, before: Uint8Array, after: Uint8Array,
    context: OfficeFileContext): Promise<FileArtifactBinding> {
    const historyGroup = context.actor === 'human' ? undefined : context.historyGroup
    const previous = draft.past.at(-1)
    const entry: OfficeHistoryEntry = { id: context.operationId ?? randomUUID(), actor: context.actor ?? 'ai',
      label: context.historyLabel ?? (context.actor === 'human' ? '手动编辑 Office 文件' : 'AI 编辑 Office 文件'), at: new Date().toISOString() }
    let persisted: { before: Uint8Array; entry: typeof entry } | undefined
    if (historyGroup && !previous && !draft.future.length && draft.offset === 0) {
      const history = await this.draftHistory(draft, 0, context)
      if (history.headGroup === historyGroup && !history.redoDepth) {
        const original = await this.host.artifacts.readHistoryAtOffset?.(draft.base, -1, context.signal)
        const head = history.entries.at(-1)
        if (original && head) persisted = { before: original, entry: head }
      }
    }
    assertOfficeDraft(this.host.artifacts, draft, binding); this.active(context)
    if (draft.saveOutcomeUnknown) throw new Error('上次保存结果待确认，请重新载入原件。')
    if (persisted) draft.offset = -1
    draft.branchOffset = draft.offset
    if (historyGroup && previous?.historyGroup === historyGroup && !draft.future.length) {
      previous.after = after
    } else {
      draft.past.push({ before, after, entry, ...persisted, ...(historyGroup ? { historyGroup } : {}) })
    }
    draft.future = []
    advanceOfficeDraft(this.host.artifacts, draft, after, !Buffer.from(draft.original!).equals(after))
    const accepted = draft.binding
    this.host.artifacts.notifyOfficeDraft?.(binding, accepted)
    return accepted
  }
  private finishSave(draft: OfficeDraft, base: FileArtifactBinding, bytes: Uint8Array): void {
    draft.base = base; draft.baseVersion = base.fileVersion; draft.original = bytes; draft.saveOutcomeUnknown = false
    draft.offset = 0; draft.branchOffset = 0
    draft.past = []; draft.future = []; draft.history.clear()
    draft.bytes = bytes; draft.dirty = false
  }
  private async clearRecovery(draft: OfficeDraft): Promise<void> {
    if (!draft.recoveryBinding) return
    await this.host.artifacts.removeOfficeDraft?.(draft.recoveryBinding)
    draft.recoveryBinding = undefined
  }
  async saveWorking(binding: FileArtifactBinding): Promise<FileArtifactBinding> {
    const draft = this.draft(binding.path)
    if (!draft) return binding
    assertOfficeDraft(this.host.artifacts, draft, binding)
    if (!draft.dirty || !draft.bytes) return draft.binding
    if (draft.saveOutcomeUnknown) throw new Error('上次保存结果待确认，请重新载入原件。')
    if (draft.base.fileVersion !== draft.baseVersion) throw new Error('磁盘原件已改变，不能覆盖；Office 草稿仍保留。')
    draft.saving = true
    try {
      const entry = draft.past.at(-1)?.entry
      const saved = await this.host.artifacts.replace(draft.base, draft.bytes, undefined, undefined, {
        actor: entry?.actor ?? 'human', label: entry?.label ?? '保存 Office 文件',
        sequence: { offset: draft.offset, branchOffset: draft.branchOffset, past: draft.past, future: draft.future },
      })
      this.finishSave(draft, saved, draft.bytes)
      await this.clearRecovery(draft).catch(() => {})
      return draft.binding
    } catch (reason) {
      if (reason instanceof AgentFileOutcomeUnknown) draft.saveOutcomeUnknown = true
      throw reason
    } finally { draft.saving = false }
  }
  async saveWorkingAs<T>(binding: FileArtifactBinding, target: string, overwrite: FileArtifactBinding | undefined,
    openSaved: (saved: FileArtifactBinding) => Promise<T>): Promise<T> {
    const artifacts = this.host.artifacts
    const draft = this.draft(binding.path)
    if (!draft || !artifacts.saveCopy) throw new Error('Office 草稿已关闭，请重新打开后另存。')
    const bytes = await this.readWorking(binding)
    assertOfficeDraft(artifacts, draft, binding)
    draft.saving = true
    let copied = false
    try {
      const saved = await artifacts.saveCopy(draft.base, target, bytes, overwrite)
      openOfficeDraft(artifacts, saved)
      let snapshot: T
      try { snapshot = await openSaved(saved) }
      catch (error) { closeOfficeDraft(artifacts, saved.path); throw error }
      copied = true
      await this.clearRecovery(draft).catch(() => {})
      return snapshot
    } finally {
      draft.saving = false
      if (copied) closeOfficeDraft(artifacts, draft.binding.path)
    }
  }
  async inspect(binding: FileArtifactBinding, format: OfficeFormat, context: OfficeFileContext = {}): Promise<{
    binding: FileArtifactBinding; inspection: OfficeContentInspection; observedBytes: Uint8Array
  }> {
    this.active(context)
    const bytes = await this.readWorking(binding, context)
    this.active(context)
    const inspection = await inspectOfficeContentOffThread(bytes, format, context.signal)
    this.active(context)
    const draft = this.draft(binding.path)
    if (draft) {
      if (context.actor === 'ai') assertOfficeDraftSession(this.host.artifacts, draft, binding)
      else assertOfficeDraft(this.host.artifacts, draft, binding)
    }
    return { binding, inspection, observedBytes: bytes }
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
    const draft = this.draft(binding.path)
    const current = await this.readMutationBase(draft, binding, context)
    this.active(context)
    const prepared = await applyOfficeContentOffThread(current, request, context.signal)
    this.active(context)
    if (draft) return this.stageContent(draft, binding, current, prepared, request.format, context)
    if (Buffer.from(current).equals(prepared.bytes)) {
      // Revalidate through the physical owner, but do not manufacture a new file version for a no-op.
      const { inspection } = await this.inspect(binding, request.format, context)
      return { status: 'saved', binding, inspection, diagnostics: prepared.diagnostics,
        ...(prepared.calculation ? { calculation: prepared.calculation } : {}) }
    }
    const metadata: ArtifactHistoryMetadata = {
      actor: context.actor ?? 'ai', label: context.historyLabel ?? (context.actor === 'human' ? '手动编辑 Office 文件' : 'AI 编辑 Office 文件'),
      ...(context.operationId ? { operationId: context.operationId } : {}),
      ...(context.historyGroup ? { historyGroup: context.historyGroup } : {}),
    }
    const saved = await this.host.artifacts.replace(binding, prepared.bytes, context.signal, () => this.beforeDirectWrite(binding, context), metadata)
    let inspection: OfficeContentInspection
    try { inspection = await inspectOfficeContentOffThread(await this.host.artifacts.read(saved), request.format) }
    catch (cause) { throw new AgentFileOutcomeUnknown(`Office 修改已写入，但回读结果未确认；请先读取原件后继续：${cause instanceof Error ? cause.message : String(cause)}`) }
    return { status: 'saved', binding: saved, inspection, diagnostics: prepared.diagnostics,
      ...(prepared.calculation ? { calculation: prepared.calculation } : {}) }
  }
  async editObject(binding: FileArtifactBinding, input: OfficeObjectEdit, context: OfficeFileContext = {}): Promise<OfficeFileResult> {
    const draft = this.draft(binding.path)
    if (!draft) throw new Error('请先在工作台打开目标 Office 文件。')
    if (context.expectedVersion !== undefined && context.expectedVersion !== binding.fileVersion)
      throw new Error('Office 文件版本已改变，请读取当前内容后修改')
    if (path.extname(binding.path).toLowerCase() !== '.' + input.format)
      throw new Error('对象编辑格式与当前文件不一致')
    const current = await this.readMutationBase(draft, binding, context)
    const prepared = await applyOfficeObjectEditOffThread(current, input, context.signal)
    return this.stageContent(draft, binding, current, prepared, input.format, context, input)
  }
  private async stageContent(draft: OfficeDraft, binding: FileArtifactBinding, original: Uint8Array, prepared: OfficeContentResult,
    format: OfficeFormat, context: OfficeFileContext, objectEdit?: OfficeObjectEdit): Promise<OfficeFileResult> {
    // Rebase the original intent against the latest draft every time. An intervening
    // edit during off-thread inspection or merge must also be retained on undo.
    for (;;) {
      this.active(context); assertOfficeDraftSession(this.host.artifacts, draft, binding)
      if (draft.saveOutcomeUnknown) throw new Error('上次保存结果待确认，请重新载入原件。')
      const latest = draft.binding
      try {
        const current = draft.bytes ?? await this.readWorking(latest, context)
        const result = binding.fileVersion === latest.fileVersion ? prepared
          : await mergeOfficeDraftOffThread(original, prepared, current, context.signal, objectEdit)
        const inspection = await inspectOfficeContentOffThread(result.bytes, format, context.signal)
        assertOfficeDraft(this.host.artifacts, draft, latest); this.active(context)
        const unchanged = Buffer.from(current).equals(result.bytes)
        const accepted = unchanged ? latest : await this.recordDraft(draft, latest, current, result.bytes, context)
        return { status: 'draft', binding: accepted, inspection, diagnostics: result.diagnostics, observedBytes: result.bytes, applied: !unchanged,
          ...(result.calculation ? { calculation: result.calculation } : {}) }
      } catch (error) {
        if (latest === draft.binding || !(error instanceof OfficeDraftUpdatedError || error instanceof OfficeDraftMergeConflict)) throw error
      }
    }
  }
  /** Editor bytes are candidates, never a second physical save path. */
  async commitCandidate(binding: FileArtifactBinding, bytes: Uint8Array, format: OfficeFormat, context: OfficeFileContext = {}): Promise<OfficeFileResult> {
    this.active(context)
    if (context.expectedVersion !== binding.fileVersion) throw new Error('候选文件须绑定当前原件版本')
    if (path.extname(binding.path).toLowerCase() !== '.' + format) throw new Error('候选文件格式与原件不一致')
    const draft = this.draft(binding.path)
    const current = await this.readMutationBase(draft, binding, context)
    validateOfficeCandidate(current, bytes, format)
    if (draft) return this.stageContent(draft, binding, current, { format, bytes, diagnostics: [], changedParts: [] }, format,
      { ...context, actor: context.actor ?? 'human' })
    const inspection = await inspectOfficeContentOffThread(bytes, format, context.signal)
    this.active(context)
    if (Buffer.from(current).equals(bytes)) return { status: 'saved', binding, inspection, diagnostics: [] }
    const saved = await this.host.artifacts.replace(binding, bytes, context.signal, () => this.beforeDirectWrite(binding, context), {
      actor: context.actor ?? 'human', label: context.historyLabel ?? '手动编辑 Office 文件',
      ...(context.operationId ? { operationId: context.operationId } : {}),
      ...(context.historyGroup ? { historyGroup: context.historyGroup } : {}),
    })
    return { status: 'saved', binding: saved, inspection, diagnostics: [] }
  }
  async history(binding: FileArtifactBinding, context: OfficeFileContext = {}): Promise<OfficeHistorySnapshot> {
    this.active(context)
    const draft = this.draft(binding.path)
    if (draft) {
      assertOfficeDraft(this.host.artifacts, draft, binding)
      const offset = draft.offset
      const persisted = await this.draftHistory(draft, offset, context)
      assertOfficeDraft(this.host.artifacts, draft, binding)
      const redoDepth = draft.past.length || draft.branchOffset === offset && draft.future.length ? draft.future.length
        : draft.future.length && offset < draft.branchOffset ? draft.branchOffset - offset + draft.future.length : persisted.redoDepth
      return { ...(persisted.notice ? { notice: persisted.notice } : {}), undoDepth: persisted.undoDepth + draft.past.length, redoDepth,
        entries: [...persisted.entries, ...draft.past.map(change => change.entry)] }
    }
    if (!this.host.artifacts.history) throw new Error('当前文件 owner 尚未提供共同编辑历史')
    const { headGroup: _headGroup, ...snapshot } = await this.host.artifacts.history(binding, context.signal)
    return snapshot
  }
  private async draftHistory(draft: OfficeDraft, offset: number, context: OfficeFileContext): Promise<ArtifactHistorySnapshot> {
    if (draft.base.fileVersion !== draft.baseVersion)
      return { undoDepth: 0, redoDepth: 0, entries: [], notice: '磁盘原件已改变；未保存草稿已保留。' }
    const known = draft.history.get(offset)
    if (known) return known
    if (!this.host.artifacts.history) return { undoDepth: 0, redoDepth: 0, entries: [] }
    const base = draft.base
    const snapshot = await this.host.artifacts.history(base, context.signal, offset)
    if (draft.base === base) draft.history.set(offset, snapshot)
    return snapshot
  }
  private beforeDirectWrite(binding: FileArtifactBinding, context: OfficeFileContext): void {
    this.active(context)
    if (this.draft(binding.path)) throw new Error('文件已在工作台中打开，请读取当前 Office 草稿后再修改。')
  }
  async moveHistory(binding: FileArtifactBinding, action: 'undo' | 'redo', context: OfficeFileContext = {}): Promise<OfficeFileResult> {
    this.active(context)
    if (context.expectedVersion !== undefined && context.expectedVersion !== binding.fileVersion) throw new Error('Office 文件版本已改变，请重新读取后操作')
    const draft = this.draft(binding.path)
    if (draft) {
      if (draft.saveOutcomeUnknown) throw new Error('上次保存结果待确认，请重新载入原件。')
      assertOfficeDraft(this.host.artifacts, draft, binding)
      const original = draft.original ?? await this.readWorking(binding, context)
      const source = action === 'undo' ? draft.past : draft.future, destination = action === 'undo' ? draft.future : draft.past
      const change = action === 'undo' || draft.offset === draft.branchOffset ? source.at(-1) : undefined
      if (action === 'redo' && !change && draft.past.length) throw new Error('没有可重做的草稿修改')
      const offset = change ? draft.offset : draft.offset + (action === 'undo' ? -1 : 1)
      if (!change && draft.base.fileVersion !== draft.baseVersion) throw new Error('磁盘原件已改变，无法读取旧历史。')
      const bytes = change ? action === 'undo' ? change.before : change.after
        : await this.host.artifacts.readHistoryAtOffset?.(draft.base, offset, context.signal)
      if (!bytes) throw new Error(action === 'undo' ? '没有可撤销的文件修改' : '没有可重做的文件修改')
      if (!change) await this.draftHistory(draft, offset, context)
      const inspection = await inspectOfficeContentOffThread(bytes, path.extname(binding.path).slice(1).toLowerCase() as OfficeFormat, context.signal)
      assertOfficeDraft(this.host.artifacts, draft, binding); this.active(context)
      if (change) { source.pop(); destination.push(change) }
      draft.offset = offset
      advanceOfficeDraft(this.host.artifacts, draft, bytes, !Buffer.from(original).equals(bytes))
      this.host.artifacts.notifyOfficeDraft?.(binding, draft.binding)
      return { status: 'draft', binding: draft.binding, inspection, diagnostics: [] }
    }
    if (!this.host.artifacts.moveHistory) throw new Error('当前文件 owner 尚未提供共同编辑历史')
    const saved = await this.host.artifacts.moveHistory(binding, action, context.signal, () => this.beforeDirectWrite(binding, context))
    let inspection: OfficeContentInspection
    try { inspection = await inspectOfficeContentOffThread(await this.host.artifacts.read(saved), path.extname(saved.path).slice(1).toLowerCase() as OfficeFormat) }
    catch (cause) { throw new AgentFileOutcomeUnknown(`Office 撤销/重做已写入，但回读未确认；请重新读取原件：${cause instanceof Error ? cause.message : String(cause)}`) }
    return { status: 'saved', binding: saved, inspection, diagnostics: [] }
  }
}
