import type { LocalAgentId } from '../../shared/localAgentContract'
import type { LessonAgentWorkspace } from '../../shared/workspaceIdentity'
import type { LessonDocumentAiAPI } from '../../shared/lessonDocumentAiTask'
import type { LessonDocumentEditorHandle } from './LessonDocumentEditor'
import type { DocumentFileRef, DocumentFileVersion } from '../../shared/document/ports'
export interface DocumentChatTarget { name: string; getEditor(): LessonDocumentEditorHandle | null }
let lastEpoch = Date.now()
export function nextDocumentAiEpoch() { lastEpoch = Math.max(Date.now(), lastEpoch + 1); return lastEpoch }
export class DocumentAiTaskController {
  private taskId: string | undefined
  private cancelled = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private unregister: (() => void) | undefined
  private session: LessonDocumentEditorHandle['session'] | undefined
  private finished = false
  constructor(private api: LessonDocumentAiAPI, private workspace: LessonAgentWorkspace, private notify: (message: string) => void) {}
  async start(target: DocumentChatTarget, adapter: LocalAgentId, instruction: string, onApplied?: (ref: DocumentFileRef, version: DocumentFileVersion) => Promise<void>) {
    const editor = target.getEditor()
    if (!editor || !await editor.flush()) throw new Error('请先保存当前文档并处理冲突')
    const session = editor.session, source = session.getSnapshot().source, epoch = nextDocumentAiEpoch()
    this.session = session
    const ranges = [{ from: 0, to: source.length, before: source, after: source }]
    const prepared = await session.prepareAiEdit(ranges, epoch)
    if (prepared.status !== 'ready') throw new Error(prepared.message)
    this.unregister = session.registerAiTaskStop(() => this.stop())
    let result
    try { result = await this.api({ operation: 'start', workspace: this.workspace, ref: session.ref, baseVersion: prepared.document.version, ranges: prepared.ranges, epoch, adapter, instruction }) }
    catch (error) { await this.stop(); throw error }
    this.taskId = result.taskId
    if (this.cancelled) { await this.stop(); return }
    this.notify(result.message)
    const poll = async () => {
      if (this.cancelled || !this.taskId) return
      try {
        const result = await this.api({ operation: 'read', workspace: this.workspace, taskId: this.taskId })
        if (this.cancelled) return
        if (result.status === 'candidate' && result.apply) {
          const applied = await session.applyAiEdit(result.apply)
          this.notify(applied.status === 'failed' ? applied.message : applied.status === 'applied' ? 'AI 修改已保存' : applied.status === 'partial' ? `已保存无冲突修改，${applied.conflicts.length} 处建议待处理` : 'AI 建议与当前稿冲突，教师修改已保留')
          this.finished = true
          this.unregister?.(); this.unregister = undefined
          if (applied.status === 'applied') {
            try { if (!this.cancelled) await onApplied?.(session.ref, applied.record.savedVersion) } catch (error) { this.notify(`文档修改已保存，阶段状态仍需处理：${(error as Error).message}`) }
          }
        } else if (result.status === 'running') this.timer = setTimeout(() => void poll(), 1000)
        else { this.notify(result.message); await this.stop() }
      } catch (error) { this.notify((error as Error).message); await this.stop() }
    }
    this.timer = setTimeout(() => void poll(), 1000)
    return result.sessionId
  }
  async stop() {
    if (this.finished) return
    this.cancelled = true; clearTimeout(this.timer)
    await this.session?.invalidatePreparedAiEdits()
    if (this.taskId) await this.api({ operation: 'stop', workspace: this.workspace, taskId: this.taskId })
    this.unregister?.(); this.unregister = undefined
  }
}
