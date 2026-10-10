import type { DocumentSession } from '../../../core/documents/DocumentSession'
import { isSourceDocumentModel } from '../../../shared/workbench/document'
import type { ToolTarget } from '../../../shared/workbench/tools'
import { documentDigest } from '../../../core/documents/documentDigest'
import { courseInstanceFieldIdentity, courseInstanceTextTarget, isCourseInstanceRange, mapHtmlAuthorFieldTarget, mapMarkdownRange, mapSequenceRange, readCourseInstanceText, readTarget } from '../../../core/tools/ToolTargets'
import { mapAcknowledgedRange } from '../../../core/tools/ToolReadCoverage'
import { traceSourceRange } from '../../../core/drivers/course/elementFields'
import { normalizeDocumentText, type FlowTextContent } from '../../../shared/document/content'

const tokens = (value: string | FlowTextContent): string[] => normalizeDocumentText(typeof value === 'string' ? { inlines: [{ type: 'text', text: value }] } : value).inlines.flatMap(inline => inline.type === 'math'
  ? [documentDigest(inline)] : Array.from(inline.text, text => documentDigest({ ...inline, text })))
const disjoint = (range: { from: number; to: number }, edit: { from: number; to: number }) =>
  edit.to <= range.from || edit.from >= range.to
const sameTokens = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index])

/** Refreshes only the original stable targets, following committed changes without searching for equal text. */
export async function continueDocumentTargets<T extends { documentId: string; epoch: string; revision: number;
  writable: readonly ToolTarget[]; selection?: readonly ToolTarget[] }>(session: DocumentSession, reference: T, ownRuns: ReadonlySet<string>, options: { followCurrent?: boolean } = {}): Promise<T> {
  const snapshot = await session.drain()
  if (snapshot.documentId !== reference.documentId) throw new Error('恢复的文档身份不一致')
  const ranges = [...reference.writable, ...(reference.selection ?? [])].some(target => target.kind === 'text-selection' || target.kind === 'markdown-range' || isCourseInstanceRange(target)
    || target.kind === 'html-author-field' && target.source)
  if (snapshot.epoch !== reference.epoch && (!options.followCurrent || ranges)) throw new Error('原文档会话已改变，请重新选择')
  const changes = ranges ? session.committedChangesSince(reference.revision) : []
  const advance = (target: ToolTarget, change: typeof changes[number], own: boolean): ToolTarget => {
      if (target.kind === 'text-selection') {
        const acknowledged = own && change.textChanges?.aggregateMappings?.find(mapping => documentDigest(mapping.before) === documentDigest(target))
        if (acknowledged) return structuredClone(acknowledged.after)
        return { ...target, fragments: target.fragments.map(fragment => ({ ...fragment,
          target: advance(fragment.target, change, own) as typeof fragment.target })) }
      }
      if (target.kind === 'html-author-field' && target.source) {
        if (!change.before || !change.after || !isSourceDocumentModel(change.before) || !isSourceDocumentModel(change.after))
          throw new Error('原 HTML 作者字段历史不足以确认')
        const before = readTarget(change.before, target)
        const mapped = mapHtmlAuthorFieldTarget(change.before.source, change.after.source, target, own)
        if (!own && readTarget(change.after, mapped) !== before) throw new Error('原 HTML 正文字段已被其他操作改动，请重新选择')
        target = mapped
        return target
      }
      if (isCourseInstanceRange(target)) {
        if (!change.before || !change.after || change.before.kind !== 'course-v10' || change.after.kind !== 'course-v10') throw new Error('原文字范围历史不足以确认')
        if (documentDigest(courseInstanceFieldIdentity(change.before, target)) !== documentDigest(courseInstanceFieldIdentity(change.after, target))) throw new Error('原文字字段所在行、项或单元格已改变，请重新选择')
        const before = readCourseInstanceText(change.before, target), after = readCourseInstanceText(change.after, target)
        if (before === null || after === null) throw new Error('原文字字段已不存在')
        const a = tokens(before), b = tokens(after)
        const end: number = target.to + b.length - a.length
        const inside: boolean = own && end >= target.from && sameTokens(a.slice(0, target.from), b.slice(0, target.from))
          && sameTokens(a.slice(target.to), b.slice(end))
        target = inside ? { ...target, to: end } : mapSequenceRange(a, b, target)
        if (target.dataPath) target = courseInstanceTextTarget(change.after, target)
        return target
      }
      if (target.kind !== 'markdown-range') return target
      const edits = change.textChanges?.source
      if (edits?.length) {
        for (const edit of edits) {
          if (!own && !disjoint(target, edit)) throw new Error('原选区已被其他操作改动，请重新选择')
          if (!own && edit.to <= target.from) {
            const delta = edit.inserted - (edit.to - edit.from)
            target = { ...target, from: target.from + delta, to: target.to + delta }
          } else if (own || edit.from < target.to) target = mapAcknowledgedRange(target, [edit])
        }
        return target
      }
      if (change.sourceChange) {
        if (change.sourceChange.kind === 'unchanged') return target
        const { before, after } = change.sourceChange
        const moved: { from: number; to: number } | null = own ? traceSourceRange(before, after, target.from, target.to) : null
        target = moved ? { ...target, ...moved } : mapMarkdownRange(before, after, target)
        return target
      }
      if (!change.before || !change.after) throw new Error('原选区历史不足以确认当前位置，请重新选择')
      if (target.kind === 'markdown-range' && isSourceDocumentModel(change.before) && isSourceDocumentModel(change.after)) {
        const moved: { from: number; to: number } | null = own ? traceSourceRange(change.before.source, change.after.source, target.from, target.to) : null
        target = moved ? { ...target, ...moved } : mapMarkdownRange(change.before.source, change.after.source, target)
      } else throw new Error('原选区文档格式已改变')
    return target
  }
  const map = (original: ToolTarget): ToolTarget => {
    let target: ToolTarget = structuredClone(original)
    for (const change of changes) target = advance(target, change,
      options.followCurrent === true || change.actor === 'agent' && !!change.runId && ownRuns.has(change.runId))
    readTarget(snapshot.model, target)
    if ((target.kind === 'markdown-range' || isCourseInstanceRange(target)) && target.to <= target.from) throw new Error('原选区已删除，请重新选择')
    return target
  }
  return { ...reference, epoch: snapshot.epoch, revision: snapshot.revision,
    writable: reference.writable.map(map), ...(reference.selection ? { selection: reference.selection.map(target => map(target) as typeof target) } : {}) }
}
