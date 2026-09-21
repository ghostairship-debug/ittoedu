import type { DocumentChatTarget } from '../../documentFiles/documentAiTaskController'
import { freezeContextualEditTarget, validateContextualEditTarget } from '../../../shared/document/contextualEditTarget'
import type { ContextualEditTarget } from '../../../shared/document/ports'
export type DocumentEditScope = 'selection' | 'document'
export function contextualTargetOf(target: DocumentChatTarget | undefined): ContextualEditTarget | null { return target?.getContextualEditTarget?.() ?? null }
export function freezeDocumentEditTarget(target: DocumentChatTarget, scope: DocumentEditScope): ContextualEditTarget {
  const editor = target.getEditor()
  if (!editor) throw new Error('当前文档已关闭，请重新打开。')
  const snapshot = editor.session.getSnapshot()
  if (!snapshot.disk) throw new Error('文档尚未读取完成。')
  const current = { ref: editor.session.ref, source: snapshot.source, version: snapshot.disk.version, epoch: editor.session.epoch }
  if (scope === 'selection') {
    const selected = contextualTargetOf(target)
    if (!selected) throw new Error('当前没有可用选区，请重新选择内容，或明确选择全文。')
    validateContextualEditTarget(selected, current)
    return freezeContextualEditTarget(selected)
  }
  return freezeContextualEditTarget({ scope, ref: current.ref, baseVersion: current.version, epoch: current.epoch,
    source: current.source, revision: current.source, mode: 'source', selection: null,
    ranges: [{ from: 0, to: current.source.length, before: current.source }], label: '全文' })
}
export function describeContextualTarget(target: DocumentChatTarget | undefined): { hasSelection: boolean; label: string } {
  const contextual = contextualTargetOf(target)
  return { hasSelection: !!contextual, label: contextual?.label ?? '当前选区' }
}
