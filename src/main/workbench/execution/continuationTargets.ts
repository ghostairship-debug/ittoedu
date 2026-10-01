import type { DocumentSession } from '../../../core/documents/DocumentSession'
import { isSourceDocumentModel } from '../../../shared/workbench/document'
import type { ExecutionDocumentReference } from '../../../shared/workbench/executionDesktop'
import { documentDigest } from '../../../core/documents/documentDigest'
import { mapMarkdownRange, mapSequenceRange, readTarget } from '../../../core/tools/ToolTargets'
import { mapAcknowledgedRange } from '../../../core/tools/ToolReadCoverage'
import { flowSlotContent, traceFlowRange, traceSourceRange } from '../../../core/drivers/course/elementFields'
import type { FlowTextContent } from '../../../shared/document/content'

const tokens = (content: FlowTextContent): string[] => content.inlines.flatMap(inline => inline.type === 'math'
  ? [documentDigest(inline)] : Array.from(inline.text, text => documentDigest({ ...inline, text })))
const disjoint = (range: { from: number; to: number }, edit: { from: number; to: number }) =>
  edit.to <= range.from || edit.from >= range.to

/** Refreshes only the original stable targets, following committed changes without searching for equal text. */
export async function continueDocumentTargets(session: DocumentSession, reference: ExecutionDocumentReference, ownRuns: ReadonlySet<string>): Promise<ExecutionDocumentReference> {
  const snapshot = await session.drain()
  if (snapshot.documentId !== reference.documentId) throw new Error('恢复的文档身份不一致')
  const ranges = [...reference.writable, ...(reference.selection ?? [])].some(target => target.kind === 'markdown-range' || target.kind === 'flow-range')
  const changes = ranges ? session.committedChangesSince(reference.revision) : []
  const map = (original: ExecutionDocumentReference['writable'][number]) => {
    let target = structuredClone(original)
    for (const change of changes) {
      const own = change.actor === 'agent' && !!change.runId && ownRuns.has(change.runId)
      if (target.kind !== 'markdown-range' && target.kind !== 'flow-range') break
      const edits = target.kind === 'markdown-range' ? change.textChanges?.source
        : change.textChanges?.flow.filter(edit => target.kind === 'flow-range' && edit.surfaceId === target.surfaceId
          && edit.blockId === target.blockId && edit.parentId === target.parentId && documentDigest(edit.slot) === documentDigest(target.slot))
      if (edits?.length) {
        for (const edit of edits) {
          if (!own && !disjoint(target, edit)) throw new Error('原选区已被其他操作改动，请重新选择')
          if (!own && edit.to <= target.from) {
            const delta = edit.inserted - (edit.to - edit.from)
            target = { ...target, from: target.from + delta, to: target.to + delta }
          } else if (own || edit.from < target.to) target = mapAcknowledgedRange(target, [edit])
        }
        continue
      }
      if (!change.before || !change.after) throw new Error('原选区历史不足以确认当前位置，请重新选择')
      if (target.kind === 'markdown-range' && isSourceDocumentModel(change.before) && isSourceDocumentModel(change.after)) {
        const moved = own ? traceSourceRange(change.before.source, change.after.source, target.from, target.to) : null
        target = moved ? { ...target, ...moved } : mapMarkdownRange(change.before.source, change.after.source, target)
      } else if (target.kind === 'flow-range' && change.before.kind === 'course-v9' && change.after.kind === 'course-v9') {
        const before = flowSlotContent(change.before.project, target), after = flowSlotContent(change.after.project, target)
        if (!before || !after) throw new Error('原正文位置已不存在，请重新选择')
        const moved = own ? traceFlowRange(before, after, target.from, target.to) : null
        target = moved ? { ...target, ...moved } : mapSequenceRange(tokens(before), tokens(after), target)
      } else throw new Error('原选区文档格式已改变')
    }
    readTarget(snapshot.model, target)
    if ((target.kind === 'markdown-range' || target.kind === 'flow-range') && target.to <= target.from) throw new Error('原选区已删除，请重新选择')
    return target
  }
  return { ...reference, epoch: snapshot.epoch, revision: snapshot.revision,
    writable: reference.writable.map(map), ...(reference.selection ? { selection: reference.selection.map(target => map(target) as typeof target) } : {}) }
}
