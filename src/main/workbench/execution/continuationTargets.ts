import type { DocumentSession } from '../../../core/documents/DocumentSession'
import { isSourceDocumentModel } from '../../../shared/workbench/document'
import type { ExecutionDocumentReference } from '../../../shared/workbench/executionDesktop'
import { documentDigest } from '../../../core/documents/documentDigest'
import { courseInstanceFieldIdentity, isCourseInstanceRange, mapMarkdownRange, mapSequenceRange, readCourseInstanceText, readTarget } from '../../../core/tools/ToolTargets'
import { mapAcknowledgedRange } from '../../../core/tools/ToolReadCoverage'
import { traceSourceRange } from '../../../core/drivers/course/elementFields'
import type { FlowTextContent } from '../../../shared/document/content'

const tokens = (content: FlowTextContent): string[] => content.inlines.flatMap(inline => inline.type === 'math'
  ? [documentDigest(inline)] : Array.from(inline.text, text => documentDigest({ ...inline, text })))
const disjoint = (range: { from: number; to: number }, edit: { from: number; to: number }) =>
  edit.to <= range.from || edit.from >= range.to
const sameTokens = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index])

/** Refreshes only the original stable targets, following committed changes without searching for equal text. */
export async function continueDocumentTargets(session: DocumentSession, reference: ExecutionDocumentReference, ownRuns: ReadonlySet<string>): Promise<ExecutionDocumentReference> {
  const snapshot = await session.drain()
  if (snapshot.documentId !== reference.documentId) throw new Error('恢复的文档身份不一致')
  const ranges = [...reference.writable, ...(reference.selection ?? [])].some(target => target.kind === 'markdown-range' || isCourseInstanceRange(target))
  const changes = ranges ? session.committedChangesSince(reference.revision) : []
  const map = (original: ExecutionDocumentReference['writable'][number]) => {
    let target = structuredClone(original)
    for (const change of changes) {
      const own = change.actor === 'agent' && !!change.runId && ownRuns.has(change.runId)
      if (isCourseInstanceRange(target)) {
        if (!change.before || !change.after || change.before.kind !== 'course-v10' || change.after.kind !== 'course-v10') throw new Error('原文字范围历史不足以确认')
        if (documentDigest(courseInstanceFieldIdentity(change.before, target)) !== documentDigest(courseInstanceFieldIdentity(change.after, target))) throw new Error('原文字字段所在行、项或单元格已改变，请重新选择')
        const before = readCourseInstanceText(change.before, target), after = readCourseInstanceText(change.after, target)
        if (before === null || after === null || typeof before !== typeof after) throw new Error('原文字字段已不存在')
        const a = typeof before === 'string' ? Array.from(before) : tokens(before)
        const b = typeof after === 'string' ? Array.from(after) : tokens(after)
        const end = target.to + b.length - a.length
        const inside = own && end >= target.from && sameTokens(a.slice(0, target.from), b.slice(0, target.from))
          && sameTokens(a.slice(target.to), b.slice(end))
        target = inside ? { ...target, to: end } : mapSequenceRange(a, b, target)
        continue
      }
      if (target.kind !== 'markdown-range') break
      const edits = change.textChanges?.source
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
      if (change.sourceChange) {
        if (change.sourceChange.kind === 'unchanged') continue
        const { before, after } = change.sourceChange
        const moved = own ? traceSourceRange(before, after, target.from, target.to) : null
        target = moved ? { ...target, ...moved } : mapMarkdownRange(before, after, target)
        continue
      }
      if (!change.before || !change.after) throw new Error('原选区历史不足以确认当前位置，请重新选择')
      if (target.kind === 'markdown-range' && isSourceDocumentModel(change.before) && isSourceDocumentModel(change.after)) {
        const moved = own ? traceSourceRange(change.before.source, change.after.source, target.from, target.to) : null
        target = moved ? { ...target, ...moved } : mapMarkdownRange(change.before.source, change.after.source, target)
      } else throw new Error('原选区文档格式已改变')
    }
    readTarget(snapshot.model, target)
    if ((target.kind === 'markdown-range' || isCourseInstanceRange(target)) && target.to <= target.from) throw new Error('原选区已删除，请重新选择')
    return target
  }
  return { ...reference, epoch: snapshot.epoch, revision: snapshot.revision,
    writable: reference.writable.map(map), ...(reference.selection ? { selection: reference.selection.map(target => map(target) as typeof target) } : {}) }
}
