import type { LocalAgentId } from '../../shared/localAgentContract'
import type { ConversationAgentWorkspace } from '../../shared/workspaceIdentity'
import type { LessonDocumentAiAPI } from '../../shared/lessonDocumentAiTask'
import type { LessonDocumentEditorHandle } from './LessonDocumentEditor'
import type { DocumentFileRef, DocumentFileVersion } from '../../shared/document/ports'
import { type ContextualEditTarget } from '../../shared/document/ports'
import { freezeContextualEditTarget, validateContextualEditTarget } from '../../shared/document/contextualEditTarget'
export interface DocumentChatTarget {
  name: string
  scope?: 'document'
  applyPolicy?: 'auto' | 'preview'
  getEditor(): LessonDocumentEditorHandle | null
  getContextualEditTarget?(): ContextualEditTarget | null
  subscribeCommands?(listener: (instruction: string, target: ContextualEditTarget) => void): () => void
}
export type DocumentAiTaskState = 'running' | 'preview' | 'completed' | 'stopped' | 'failed'
let lastEpoch = Date.now()
export function nextDocumentAiEpoch() { lastEpoch = Math.max(Date.now(), lastEpoch + 1); return lastEpoch }
export class DocumentAiTaskController {
  private taskId: string | undefined
  private cancelled = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private unregister: (() => void) | undefined
  private session: LessonDocumentEditorHandle['session'] | undefined
  private finished = false
  constructor(private api: LessonDocumentAiAPI, private workspace: ConversationAgentWorkspace, private notify: (message: string, state?: DocumentAiTaskState) => void) {}
  private releaseRegistration() { this.unregister?.(); this.unregister = undefined }
  private finish() { this.finished = true; clearTimeout(this.timer); this.releaseRegistration() }
  private async invalidateAndStopNative() {
    let failure: unknown
    let stoppedMessage: string | undefined
    try { await this.session?.invalidatePreparedAiEdits() } catch (error) { failure = error }
    if (this.taskId) {
      try { stoppedMessage = (await this.api({ operation: 'stop', workspace: this.workspace, taskId: this.taskId })).message }
      catch (error) { failure ??= error }
    }
    this.releaseRegistration()
    if (failure) throw failure
    return stoppedMessage
  }
  async start(target: DocumentChatTarget, adapter: LocalAgentId, instruction: string, onApplied?: (ref: DocumentFileRef, version: DocumentFileVersion) => Promise<void>, frozenTarget?: ContextualEditTarget) {
    const editor = target.getEditor()
    if (!editor) throw new Error('当前文档已关闭，请重新打开。')
    const session = editor.session, initial = session.getSnapshot()
    let selected = frozenTarget ?? target.getContextualEditTarget?.() ?? null
    if (!selected && target.scope !== 'document') throw new Error('请选择要修改的内容，或明确选择全文。')
    if (selected) {
      if (!initial.disk) throw new Error('文档尚未读取完成。')
      validateContextualEditTarget(selected, { ref: session.ref, source: initial.source, version: initial.disk.version, epoch: session.epoch })
      selected = freezeContextualEditTarget(selected)
    }
    this.session = session
    this.unregister = session.registerAiTaskStop(() => this.stop())
    let result
    try {
      if (!await editor.flush()) throw new Error('请先保存当前文档并处理冲突')
      if (this.cancelled) return
      const saved = session.getSnapshot(), source = saved.source, epoch = nextDocumentAiEpoch()
      if (source !== initial.source) throw new Error('保存期间内容已改变，请重新选择。')
      if (selected) {
        // Only this flush may advance the version of an unchanged dirty draft.
        if (initial.dirty && saved.disk) selected = freezeContextualEditTarget({ ...selected, baseVersion: saved.disk.version })
        validateContextualEditTarget(selected, { ref: session.ref, source, version: saved.disk!.version, epoch: session.epoch })
      }
      if (this.workspace.kind === 'directory' && session.ref.kind !== 'file') throw new Error('目录会话只能修改真实文件')
      if (this.workspace.kind === 'lesson' && session.ref.kind !== 'lesson') throw new Error('课例会话只能修改课例文档')
      const ranges = selected?.ranges?.map(range => ({ ...range, after: range.before })) ?? [{ from: 0, to: source.length, before: source, after: source }]
      const prepared = await session.prepareAiEdit(ranges, epoch)
      if (this.cancelled) { try { await session.invalidatePreparedAiEdits() } catch { /* stop already owns the reported failure */ } return }
      if (prepared.status !== 'ready') throw new Error(prepared.message)
      if (selected && (prepared.document.source !== source || JSON.stringify(prepared.document.version) !== JSON.stringify(selected.baseVersion))) throw new Error('准备期间文档已改变，请重新发送。')
      result = await this.api({ operation: 'start', workspace: this.workspace, ref: session.ref, baseVersion: prepared.document.version, ranges: prepared.ranges, epoch, adapter, instruction })
      this.taskId = result.taskId
      if (this.cancelled) {
        try { await this.api({ operation: 'stop', workspace: this.workspace, taskId: result.taskId }) } finally { this.finish() }
        return
      }
    } catch (error) {
      if (this.cancelled) return
      try { await this.invalidateAndStopNative() } catch { /* Preserve the actionable start failure. */ }
      this.finish()
      this.notify((error as Error).message, 'failed')
      throw error
    }
    this.notify(result.message, 'running')
    const poll = async () => {
      if (this.cancelled || !this.taskId) return
      try {
        const result = await this.api({ operation: 'read', workspace: this.workspace, taskId: this.taskId })
        if (this.cancelled) return
        if (result.status === 'candidate' && result.apply) {
          if (target.applyPolicy === 'preview') {
            session.previewAiEdit(result.apply, () => { this.finish(); this.notify('', 'completed') })
            this.notify('AI 改动已准备好，请在文档中查看后应用。', 'preview')
            return
          }
          const applied = await session.applyAiEdit(result.apply)
          const state: DocumentAiTaskState = applied.status === 'failed' ? 'failed' : 'completed'
          this.notify(applied.status === 'failed' ? applied.message : applied.status === 'applied' ? 'AI 修改已保存' : applied.status === 'partial' ? `已保存无冲突修改，${applied.conflicts.length} 处建议待处理` : 'AI 建议与当前稿冲突，教师修改已保留', state)
          this.finish()
          if (applied.status === 'applied') {
            try { if (!this.cancelled) await onApplied?.(session.ref, applied.record.savedVersion) } catch (error) { this.notify(`文档修改已保存，阶段状态仍需处理：${(error as Error).message}`) }
          }
        } else if (result.status === 'running') this.timer = setTimeout(() => void poll(), 1000)
        else {
          try { await session.invalidatePreparedAiEdits() } finally { this.finish() }
          this.notify(result.message, result.status === 'stopped' ? 'stopped' : 'failed')
        }
      } catch (error) {
        if (this.cancelled) return
        try { await this.invalidateAndStopNative() } catch { /* Preserve the polling failure. */ }
        this.finish()
        this.notify((error as Error).message, 'failed')
      }
    }
    this.timer = setTimeout(() => void poll(), 1000)
    return result.sessionId
  }
  async stop() {
    if (this.finished) return
    this.cancelled = true; clearTimeout(this.timer)
    try {
      const message = await this.invalidateAndStopNative()
      this.finish()
      this.notify(message ?? '文档修改已停止。', 'stopped')
    } catch (error) {
      this.finish()
      this.notify((error as Error).message, 'failed')
      throw error
    }
  }
}
