import { isSourceDocumentModel, type DocumentModel, type DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolTarget, TextFragmentTarget } from '../../shared/workbench/tools'
import type { DocumentSelection, DocumentSlot } from '../../shared/document/ports'
import type { ExecutionContentOutput } from '../../shared/workbench/execution'
import { documentDigest } from '../documents/documentDigest'
import { componentDefinitionBuiltinKey, componentIsLocked, owningContainer, resolveComponentPresentation, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import { tableCellTextField, tableCellRichTextEdit } from '../../components/table/data'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentFieldIdentityPaths, componentValueAt, equalComponentValue } from '../drivers/courseV10Operations'
import { HTML_AUTHORING_CONSUMER_ID, HTML_AUTHORING_DATA_ID, patchHtmlAuthoringRecords, readHtmlAuthoringRecords } from '../../shared/html/htmlAuthoringRecords'
import { decodeHtmlEntities } from '../../shared/html/htmlSourceScanner'
import { escapeHtmlAttribute, escapeHtmlText } from '../../shared/html/htmlSourceEscaping'
import { locateHtmlAuthorRecordSource } from '../../shared/html/htmlSourceLocator'
import { componentAuthorRecordSchema } from '../../shared/contracts/component-platform/schema'
import { documentTextLength, documentTextContentSchema, documentVisibleTextSlots, walkDocument, normalizeDocumentText, sliceDocumentText, plainDocumentText, type FlowTextContent } from '../../shared/document/content'
import { projectFlowDocument } from '../components/document/flowDocumentProjection'
import { documentSourceEdits } from '../../shared/document/sourceMerge'
import { parseDocumentMarkdown } from '../../shared/document/markdown'
import { inlineHtml } from '../../shared/document/html'
import { readHtmlDocumentText, type DocumentHtmlNode } from '../../shared/document/htmlText'
import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5'

export type CourseInstanceTarget = Extract<ToolTarget, { kind: 'course-instance' }>
export type HtmlAuthorFieldTarget = Extract<ToolTarget, { kind: 'html-author-field' }>
/** A dynamic HTML spot owns a decoded content field; the software wrapper is never model content. */
export function readHtmlAuthorField(model: DocumentModel, target: HtmlAuthorFieldTarget) {
  if (!isSourceDocumentModel(model)) throw new Error('HTML 作者字段需要源文档')
  const records = readHtmlAuthoringRecords(model.source)
  const frozen = componentAuthorRecordSchema.parse(target.record), current = records[target.authorKey]
  const identity = (record: typeof frozen) => ({ kind: record.kind, scope: record.scope, binding: record.binding })
  if (target.field !== (frozen.kind === 'text' ? 'text' : 'src')) throw new Error('HTML 作者字段类型已改变')
  if (current && !equalComponentValue(identity(current), identity(frozen))) throw new Error('HTML 作者字段绑定已改变，请重新选择')
  // A captured spot supplies its binding when no record exists yet. Its old
  // overrides are never current data after a human undo removes that record.
  const record = current ?? { ...frozen, overrides: {} }
  if (target.source) {
    const { from, to } = target.source
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > model.source.length) throw new Error('HTML 正文字段范围已失效')
    return { records, record, identity: identity(record), value: current?.overrides[target.field] ?? decodeHtmlEntities(model.source.slice(from, to).replace(/\r\n?/g, '\n')) }
  }
  return { records, record, identity: identity(record), value: record.overrides[target.field] ?? record.binding.baseline }
}
function encodedHtmlAuthorField(target: HtmlAuthorFieldTarget, content: string): string {
  return target.field === 'src' ? escapeHtmlAttribute(content, target.source?.quote ?? '') : escapeHtmlText(content)
}
/** Follow a source-backed field with the same range mechanics as source selections.
 * Cards may follow an edit inside the field to show a conflict; write handles may not. */
export function mapHtmlAuthorFieldTarget(before: string, after: string, target: HtmlAuthorFieldTarget, followInside = false): HtmlAuthorFieldTarget {
  if (!target.source) return target
  const recorded = readHtmlAuthoringRecords(after)[target.authorKey]
  if (recorded) {
    const previous = locateHtmlAuthorRecordSource(before, target.record, target.authorKey, true)
    const anchored = recorded.binding.path.at(-1)?.attributes?.['data-cw-author-key'] === target.authorKey
    const previousAnchor = previous?.path.at(-1)?.attributes?.['data-cw-author-key'] === target.authorKey
    const samePath = (path: typeof recorded.binding.path) => path.map(step => ({ tag: step.tag, index: step.index }))
    if (!anchored || previous?.valueSpan?.start !== target.source.from || previous.valueSpan.end !== target.source.to
      || recorded.kind !== target.record.kind || !equalComponentValue(recorded.scope, target.record.scope)
      || !equalComponentValue(recorded.binding.context, target.record.binding.context)
      || !previousAnchor && !equalComponentValue(samePath(recorded.binding.path), samePath(target.record.binding.path)))
      throw new Error('HTML 作者字段已重新绑定，请重新选择')
    const located = locateHtmlAuthorRecordSource(after, recorded, target.authorKey, true)
    if (!located?.valueSpan) throw new Error('HTML 作者字段源节点已不存在')
    const { start: from, end: to } = located.valueSpan, quote = after[from - 1]
    return { ...target, record: structuredClone(recorded), source: { from, to,
      ...(target.field === 'src' ? { quote: quote === '"' || quote === "'" ? quote : '' } : {}) } }
  }
  const { from, to } = target.source, end = to + after.length - before.length
  const inside = followInside && end >= from && before.slice(0, from) === after.slice(0, from) && before.slice(to) === after.slice(end)
  const source = inside ? { ...target.source, to: end } : mapSequenceRange(before, after, target.source)
  return { ...target, source }
}
/** Re-prepare from the latest source, preserving every unrelated author field and author-authored byte. */
export function prepareHtmlAuthorFieldSource(model: DocumentModel, target: HtmlAuthorFieldTarget, content: string): string {
  return prepareHtmlAuthorFieldEdit(model, target, content).source
}
export function prepareHtmlAuthorFieldEdit(model: DocumentModel, target: HtmlAuthorFieldTarget, content: string) {
  const { records, record } = readHtmlAuthorField(model, target)
  if (!isSourceDocumentModel(model)) throw new Error('HTML 作者字段需要源文档')
  const changedSpan = (before: string, after: string) => {
    if (before === after) return []
    let from = 0, to = before.length, end = after.length
    while (from < to && from < end && before[from] === after[from]) from++
    while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end-- }
    return [{ from, to, inserted: end - from }]
  }
  if (target.source) {
    const encoded = encodedHtmlAuthorField(target, content)
    const source = model.source.slice(0, target.source.from) + encoded + model.source.slice(target.source.to)
    const splices = source === model.source ? [] : [{ from: target.source.from, to: target.source.to, inserted: encoded.length }]
    if (!records[target.authorKey]) return { source, splices }
    // A first drag can add the existing geometry owner while this source edit is in flight.
    // Keep that owner's other fields and make the edited source the sole content value.
    const overrides = { ...record.overrides }; delete overrides[target.field]
    records[target.authorKey] = { ...record, binding: { ...record.binding, baseline: content }, overrides }
    const updated = patchHtmlAuthoringRecords(source, records)
    return { source: updated, splices: [...splices, ...changedSpan(source, updated)] }
  }
  records[target.authorKey] = { ...structuredClone(record), overrides: { ...record.overrides, [target.field]: content } }
  const source = patchHtmlAuthoringRecords(model.source, records)
  return { source, splices: changedSpan(model.source, source) }
}
/** Source-side binding facts, without unrelated text/image fields or software records. */
function htmlAuthorFieldSourceIdentity(source: string, target: HtmlAuthorFieldTarget): unknown {
  const document = parse(source), scripts: unknown[] = []
  type Element = DefaultTreeAdapterTypes.Element
  const children = (node: DefaultTreeAdapterTypes.ParentNode) => node.childNodes.filter((child): child is Element => 'tagName' in child)
  const attributes = (element: Element) => Object.fromEntries(element.attrs.filter(attribute => attribute.name !== 'style').map(attribute => [attribute.name, attribute.value]))
  const content = (node: DefaultTreeAdapterTypes.ParentNode): string => node.childNodes.map(child => child.nodeName === '#text'
    ? (child as DefaultTreeAdapterTypes.TextNode).value : 'childNodes' in child ? content(child) : '').join('')
  const visit = (node: DefaultTreeAdapterTypes.ParentNode) => {
    for (const element of children(node)) {
      const attrs = attributes(element)
      if (element.tagName === 'script' && ![HTML_AUTHORING_DATA_ID, HTML_AUTHORING_CONSUMER_ID].includes(attrs.id)) scripts.push({ attributes: attrs, content: content(element) })
      visit(element)
    }
  }
  visit(document)
  const root = children(document).find(element => element.tagName === 'html')
  const trace = (path: typeof target.record.binding.path, includeText: boolean) => {
    let candidates = root ? [root] : []
    const steps: unknown[] = []
    for (const step of path) {
      candidates = candidates.flatMap(parent => children(parent).filter(element => element.tagName === step.tag
        && Object.entries(step.attributes ?? {}).every(([name, value]) => name === 'class'
          ? value.split(/\s+/).every(token => (attributes(element).class ?? '').split(/\s+/).includes(token)) : attributes(element)[name] === value)))
      steps.push(candidates.length === 1 ? attributes(candidates[0]!) : null)
    }
    // Runtime scope can distinguish nodes a static parse cannot. Such siblings are
    // not evidence about this field, so their body text must not become its CAS.
    const element = candidates.length === 1 ? candidates[0] : undefined
    return { steps, value: !element ? undefined : includeText ? content(element) : target.field === 'src' ? attributes(element).src
      : element.childNodes.filter(child => child.nodeName === '#text').map(child => (child as DefaultTreeAdapterTypes.TextNode).value)[target.record.binding.textIndex ?? 0] }
  }
  return { scripts, target: trace(target.record.binding.path, false), context: target.record.binding.context?.map(value => trace(value.path, true)) }
}
export type CourseInstanceRange = CourseInstanceTarget & { dataPath: string[]; from: number; to: number }
export function isCourseInstanceRange(target: ToolTarget): target is CourseInstanceRange {
  return target.kind === 'course-instance' && target.dataPath !== undefined && target.from !== undefined && target.to !== undefined
}
/** The editor's semantic slot resolves once to the actual professional data field. */
export function courseInstanceSlotPath(data: unknown, slot: DocumentSlot): string[] {
  const value = data as Record<string, unknown>
  if (slot.kind === 'field') return [slot.field]
  const index = (key: string, id: string) => {
    const values = value[key]
    const found = Array.isArray(values) ? values.findIndex(item => item?.id === id) : -1
    if (found < 0) throw new Error('所选正文位置已不存在。')
    return String(found)
  }
  if (slot.kind === 'item') return ['items', index('items', slot.itemId), 'content']
  if (slot.kind === 'header') return ['columns', index('columns', slot.columnId), 'header']
  const rowIndex = index('rows', slot.rowId), row = (value.rows as Array<{ cells: unknown }>)[Number(rowIndex)]!
  if (Array.isArray(row.cells)) {
    const cellIndex = row.cells.findIndex(cell => cell?.columnId === slot.columnId)
    if (cellIndex < 0) throw new Error('所选表格单元格已不存在。')
    const cell = row.cells[cellIndex] as Record<string, unknown>
    return ['rows', rowIndex, 'cells', String(cellIndex), Object.hasOwn(cell, 'content') ? 'content' : 'text']
  }
  if (!row.cells || typeof row.cells !== 'object' || !Object.hasOwn(row.cells, slot.columnId)) throw new Error('所选表格单元格已不存在。')
  return ['rows', rowIndex, 'cells', slot.columnId]
}
/** Join only the selected fragments; syntax in source gaps never becomes writable text. */
export function textSelectionTarget<T extends ToolTarget>(model: DocumentModel, targets: readonly T[]): T | Extract<ToolTarget, { kind: 'text-selection' }>
export function textSelectionTarget(model: DocumentModel, targets: readonly ToolTarget[]): ToolTarget {
  if (!targets.length) throw new Error('选区为空，不会扩大到整份文档。')
  if (targets.length === 1 && (model.kind !== 'markdown' || targets[0].kind === 'text-selection')) return targets[0]
  const fragments: Extract<ToolTarget, { kind: 'text-selection' }>['fragments'] = []
  for (const target of targets) {
    if (target.kind !== 'markdown-range' && !isCourseInstanceRange(target)) throw new Error('当前选区包含非文字内容，请使用对象内容入口')
    if (target.from >= target.to) continue
    readEditableTargetContent(model, target)
    const previous = fragments.at(-1)?.target
    let separatorBefore = ''
    if (previous?.kind === 'markdown-range' && target.kind === 'markdown-range' && isSourceDocumentModel(model)) {
      if (target.from < previous.to) throw new Error('正文选区顺序或范围无效')
      const gap = model.source.slice(previous.to, target.from)
      separatorBefore = /\r?\n[\s]*\r?\n/.test(gap) ? '\n\n' : /[\r\n]/.test(gap) ? '\n' : ''
    } else if (previous) separatorBefore = '\n'
    fragments.push({ target: structuredClone(target), ...(separatorBefore ? { separatorBefore } : {}) })
  }
  if (!fragments.length) throw new Error('选区为空，不会扩大到整份文档。')
  return { kind: 'text-selection', fragments }
}
/** Uses the mature Flow document projection and its visible slot order, including section children. */
export function flowTextSelectionTarget(model: DocumentModel, surfaceId: string, selection: Extract<DocumentSelection, { kind: 'text' }>, stateId?: string | null): Extract<ToolTarget, { kind: 'course-instance' | 'text-selection' }> {
  if (model.kind !== 'course-v10') throw new Error('当前文档不是 Project V10')
  const project = resolveComponentPresentation(model.project, surfaceId, stateId ?? null)
  const entries: { blockId: string; key: string; length: number; barrier?: boolean }[] = []
  walkDocument(projectFlowDocument(project, surfaceId).content.blocks, block => {
    const slots = documentVisibleTextSlots(block)
    if (!slots.length) entries.push({ blockId: block.id, key: '', length: 0, barrier: true })
    for (const slot of slots) entries.push({ blockId: block.id, key: slot.key, length: documentTextLength(slot.content) })
  })
  const keyOf = (slot: DocumentSlot) => slot.kind === 'field' ? slot.field : slot.kind === 'item' ? `item:${slot.itemId}`
    : slot.kind === 'header' ? `column:${slot.columnId}` : `cell:${JSON.stringify([slot.rowId, slot.columnId])}`
  const a = entries.findIndex(entry => entry.blockId === selection.anchor.blockId && entry.key === keyOf(selection.anchor.slot))
  const b = entries.findIndex(entry => entry.blockId === selection.head.blockId && entry.key === keyOf(selection.head.slot))
  if (a < 0 || b < 0) throw new Error('所选正文位置已不存在')
  const forward = a < b || a === b && selection.anchor.offset <= selection.head.offset
  const start = forward ? selection.anchor : selection.head, end = forward ? selection.head : selection.anchor
  const selected = entries.slice(Math.min(a, b), Math.max(a, b) + 1)
  const targets = selected.map((entry, index): Extract<TextFragmentTarget, { kind: 'course-instance' }> => {
    if (entry.barrier) throw new Error('选区内包含独立对象，请使用对象内容入口；不会跳过对象修改其它文字')
    const instance = project.instances[entry.blockId]
    const slot: DocumentSlot = entry.key.startsWith('item:') ? { kind: 'item', itemId: entry.key.slice(5) }
      : entry.key.startsWith('column:') ? { kind: 'header', columnId: entry.key.slice(7) }
      : entry.key.startsWith('cell:') ? (() => { const [rowId, columnId] = JSON.parse(entry.key.slice(5)) as string[]; return { kind: 'cell' as const, rowId, columnId } })()
      : { kind: 'field', field: entry.key as Extract<DocumentSlot, { kind: 'field' }>['field'] }
    const caption = slot.kind === 'field' && slot.field === 'caption' && instance.flowLayout?.caption !== undefined
    const from = index === 0 ? start.offset : 0, to = index === selected.length - 1 ? end.offset : entry.length
    if (from < 0 || to > entry.length || from > to) throw new Error('正文范围已失效')
    return { kind: 'course-instance', surfaceId, instanceId: instance.id, stateId: stateId ?? null,
      ...(caption ? { fieldScope: 'flowLayout' as const } : {}), dataPath: courseInstanceSlotPath(caption ? instance.flowLayout : instance.data, slot), from, to }
  }).filter(target => target.from < target.to)
  return textSelectionTarget(model, targets)
}
export function instanceRootOwner(project: CourseProjectV10, instanceId: string) {
  let owner = owningContainer(project, instanceId)
  while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
  return owner
}
export function courseInstanceContext(model: DocumentModel, target: CourseInstanceTarget) {
  if (model.kind !== 'course-v10') throw new Error('对象目标需要 Project V10 文档')
  if (target.stateId && !model.project.surfaces.find(value => value.id === target.surfaceId)?.presentation?.states.some(value => value.id === target.stateId)) throw new Error('捕获的展示状态已不存在')
  const project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
  const instance = project.instances[target.instanceId]
  const surface = model.project.surfaces.find(value => value.id === target.surfaceId)
  const owner = instanceRootOwner(model.project, target.instanceId)
  if (!instance || !surface || !owner || owner.kind === 'surface' && owner.surfaceId !== surface.id) throw new Error('对象不属于捕获的表面')
  const field = target.dataPath === undefined ? undefined : componentValueAt(project, ['instances', instance.id, target.fieldScope ?? 'data', ...target.dataPath])
  if (field && !field.exists && (target.fieldScope ?? 'data') === 'data' && target.dataPath?.length === 4
    && target.dataPath[0] === 'authoringRecords' && target.dataPath[2] === 'overrides') {
    const record = componentAuthorRecordSchema.safeParse(componentValueAt(project,
      ['instances', instance.id, 'data', 'authoringRecords', target.dataPath[1]]).value)
    const property = record.success ? record.data.kind === 'text' ? 'text' : 'src' : null
    if (record.success && target.dataPath[3] === property) {
      field.exists = true
      field.value = record.data.binding.baseline
    }
  }
  if (field && !field.exists) throw new Error('所选数据字段已不存在')
  return { project, instance, surface, owner, ...(field ? { value: field.value } : {}) }
}
/** Existing row/item/cell identities along this exact field path; never search or rebind another slot. */
export function courseInstanceFieldIdentity(model: DocumentModel, target: CourseInstanceTarget) {
  if (target.dataPath) target = courseInstanceTextTarget(model, target)
  const { project } = courseInstanceContext(model, target)
  if (!target.dataPath) return []
  const path = ['instances', target.instanceId, target.fieldScope ?? 'data', ...target.dataPath]
  return componentFieldIdentityPaths(project, path).map(identity => ({ path: identity, ...componentValueAt(project, identity) }))
}
/** The effective native text implementation has one body field; other objects keep explicit slots. */
export function courseInstanceTextTarget(model: DocumentModel, target: CourseInstanceTarget): CourseInstanceTarget {
  if (target.dataPath !== undefined || target.fieldScope === 'flowLayout') {
    if (target.dataPath && target.fieldScope !== 'flowLayout' && model.kind === 'course-v10') {
      const project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null), instance = project.instances[target.instanceId]
      if (instance && componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.table') {
        const field = tableCellTextField(instance.data, target.dataPath)
        if (field) return { ...target, dataPath: field.path }
      }
    }
    return target
  }
  const { project, instance } = courseInstanceContext(model, target)
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  return implementation?.kind === 'builtin' && implementation.key === 'guoling.text'
    ? { ...target, dataPath: ['content'] } : target
}
/** The existing HTML component owns source, so SVG/canvas/program bytes stay source rather than an inline projection. */
function isHtmlSourceTextTarget(model: DocumentModel, target: CourseInstanceTarget): boolean {
  const { project, instance } = courseInstanceContext(model, target)
  return target.fieldScope !== 'flowLayout' && target.dataPath?.length === 1 && target.dataPath[0] === 'html'
    && ['guoling.web', 'guoling.html-program'].includes(componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) ?? '')
}
/** A real data field, never text searched elsewhere in an implementation or the document. */
export function readCourseInstanceText(model: DocumentModel, target: CourseInstanceTarget): string | FlowTextContent | null {
  target = courseInstanceTextTarget(model, target)
  const { value } = courseInstanceContext(model, target)
  if (target.fieldScope === 'flowLayout' && (target.dataPath?.length !== 1 || target.dataPath[0] !== 'caption')) return null
  if (typeof value === 'string') return value
  const parsed = documentTextContentSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
export function sliceCourseInstanceText(value: string | FlowTextContent, from: number, to: number): string | FlowTextContent {
  const length = typeof value === 'string' ? Array.from(value).length : documentTextLength(value)
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > length) throw new Error('所选文字范围已失效')
  return typeof value === 'string' ? Array.from(value).slice(from, to).join('') : sliceDocumentText(value, from, to)
}
/** The editable projection contains content, never the target's identity or bookkeeping. */
export function readEditableTargetContent(model: DocumentModel, target: ToolTarget): { text: string; format: 'text' | 'markdown' | 'html' } {
  if (target.kind === 'text-selection') {
    const parsed = model.kind === 'markdown' ? parseDocumentMarkdown(model.source, { target: 'file', createId: () => crypto.randomUUID() }) : undefined
    const units = parsed?.status === 'valid' ? parsed.sourceMap.blocks.flatMap(block => block.slots.flatMap(slot => slot.units)) : undefined
    const values = target.fragments.map(fragment => fragment.target.kind === 'markdown-range' && units
      ? { text: units.filter(unit => !unit.barrier && unit.from >= fragment.target.from && unit.to <= fragment.target.to).map(unit => unit.text).join(''), format: 'text' as const }
      : readEditableTargetContent(model, fragment.target))
    const rich = values.some(value => value.format === 'html')
    return { text: target.fragments.map((fragment, index) => (rich ? escapeHtmlText(fragment.separatorBefore ?? '').replace(/\n/g, '<br>') : fragment.separatorBefore ?? '')
      + (rich && values[index].format !== 'html' ? escapeHtmlText(values[index].text) : values[index].text)).join(''), format: rich ? 'html' : 'text' }
  }
  if (target.kind === 'html-author-field') return { text: readHtmlAuthorField(model, target).value, format: 'text' }
  if (target.kind === 'markdown-range' && isSourceDocumentModel(model))
    return { text: readTarget(model, target) as string, format: model.kind === 'markdown' ? 'markdown' : 'text' }
  if (target.kind !== 'course-instance') throw new Error('当前目标不是可直接改写的正文')
  target = courseInstanceTextTarget(model, target)
  if (componentIsLocked(courseInstanceContext(model, target).project, target.instanceId)) throw new Error('所选内容已锁定，请先解锁')
  const value = readCourseInstanceText(model, target)
  if (value === null) throw new Error('当前目标不是可直接改写的文字字段')
  const selected = isCourseInstanceRange(target) ? sliceCourseInstanceText(value, target.from, target.to) : value
  if (typeof selected === 'string') {
    const { project, instance } = courseInstanceContext(model, target)
    if (target.dataPath && componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.table'
      && tableCellTextField(instance.data, target.dataPath)) return { text: inlineHtml({ inlines: [{ type: 'text', text: selected }] }), format: 'html' }
    return { text: selected, format: isHtmlSourceTextTarget(model, target) ? 'html' : 'text' }
  }
  // A rich slot stays rich even when today's text has no marks: the request may
  // legitimately add a link, formula or emphasis without switching workflows.
  return { text: inlineHtml(selected), format: 'html' }
}
/** Both visible selection entry points and Main use the same current-content eligibility. */
export function prepareExecutionContentOutput(snapshot: DocumentSnapshot, target: ToolTarget): ExecutionContentOutput | undefined {
  if (target.kind !== 'markdown-range' && target.kind !== 'course-instance' && target.kind !== 'html-author-field' && target.kind !== 'text-selection') return undefined
  try { readEditableTargetContent(snapshot.model, target) } catch { return undefined }
  return { kind: 'replace-text', documentId: snapshot.documentId, target: structuredClone(target) }
}
/** Content-only replacement is partitioned by the existing text diff; no source gap or platform address comes from the model. */
export function planTextSelectionReplacement(model: DocumentModel, target: Extract<ToolTarget, { kind: 'text-selection' }>, content: string,
  format: 'text' | 'html' = 'text'): { target: TextFragmentTarget; content: string; format: 'text' | 'html' }[] {
  const atoms = (value: FlowTextContent) => value.inlines.map(inline => inline.type === 'math' ? '\uFFFC' : inline.text).join('')
  const fragments = target.fragments.map(fragment => {
    const selected = readTarget(model, fragment.target)
    return { ...fragment, text: typeof selected === 'string' ? selected : atoms(selected as FlowTextContent) }
  })
  const base = fragments.map(fragment => (fragment.separatorBefore ?? '') + fragment.text).join('')
  const previous = normalizeDocumentText({ inlines: fragments.flatMap(fragment => {
    const value = readTarget(model, fragment.target)
    return [...(fragment.separatorBefore ? [{ type: 'text' as const, text: fragment.separatorBefore }] : []),
      ...(typeof value === 'string' ? [{ type: 'text' as const, text: value }] : (value as FlowTextContent).inlines)]
  }) })
  const rich = format === 'html' ? parseEditableInlineHtml(content, previous) : undefined
  const next = rich ? atoms(rich) : content
  const edits = documentSourceEdits(base, next)
  const boundary = (offset: number, affinity: 'left' | 'right' = 'right'): number => {
    if (offset === base.length) return next.length
    let delta = 0
    for (const edit of edits) {
      if (edit.from === edit.to && offset === edit.from && affinity === 'right') { delta += edit.text.length; continue }
      if (offset <= edit.from) break
      if (offset >= edit.to) { delta += edit.text.length - edit.to + edit.from; continue }
      // A fully rewritten inline run retains the original formatting proportions.
      // This is content allocation within the selected runs, never target relocation.
      const oldBefore = Array.from(base.slice(edit.from, offset)).length, oldSize = Array.from(base.slice(edit.from, edit.to)).length
      const inserted = Array.from(edit.text)
      return edit.from + delta + inserted.slice(0, Math.round(inserted.length * oldBefore / oldSize)).join('').length
    }
    return offset + delta
  }
  let at = 0
  return fragments.map(fragment => {
    const separator = fragment.separatorBefore ?? '', separatorStart = boundary(at)
    at += separator.length
    let from = at === 0 ? 0 : boundary(at, separator ? 'left' : 'right')
    if (next.slice(separatorStart, from) !== separator) from = separatorStart
    at += fragment.text.length
    const to = boundary(at)
    const selected = next.slice(from, to)
    if (!rich || fragment.target.kind === 'markdown-range') return { target: fragment.target, content: selected, format: 'text' as const }
    const start = Array.from(next.slice(0, from)).length, end = Array.from(next.slice(0, to)).length
    return { target: fragment.target, content: inlineHtml(sliceDocumentText(rich, start, end)), format: 'html' as const }
  })
}

function parseEditableInlineHtml(html: string, previous: FlowTextContent): FlowTextContent {
  const project = (node: DefaultTreeAdapterTypes.ChildNode): DocumentHtmlNode[] => {
    if (node.nodeName === '#text') return [{ kind: 'text', text: (node as DefaultTreeAdapterTypes.TextNode).value }]
    if (!('tagName' in node)) return []
    if (['script', 'style', 'iframe', 'img', 'video', 'audio', 'object', 'svg', 'canvas', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.tagName))
      throw new Error('文字字段不能承载媒体、程序或独立块结构；返回的内容已保留，请使用对象内容修改入口')
    const element: DocumentHtmlNode = { kind: 'element', tagName: node.tagName,
      attributes: Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value])), children: node.childNodes.flatMap(project) }
    return node.tagName === 'p' || node.tagName === 'div' ? [element, { kind: 'element', tagName: 'br', attributes: {}, children: [] }] : [element]
  }
  const nodes = parseFragment(html).childNodes.flatMap(project)
  if (nodes.at(-1)?.kind === 'element' && (nodes.at(-1) as { tagName: string }).tagName === 'br'
    && /<\/(?:p|div)>\s*$/i.test(html)) nodes.pop()
  const parsed = readHtmlDocumentText(nodes, { createFormulaId: () => crypto.randomUUID() })
  // Formula identities belong to the selected source. Reusing an unchanged formula must
  // not allocate a new identity merely because the surrounding words were rewritten.
  const available = previous.inlines.filter(inline => inline.type === 'math')
  for (const inline of parsed.inlines) if (inline.type === 'math') {
    const index = available.findIndex(old => old.latex === inline.latex)
    if (index >= 0) inline.formulaId = available.splice(index, 1)[0]!.formulaId
  }
  return documentTextContentSchema.parse(parsed)
}
/** A committed replacement carries its exact new extent; continuation never widens to an entire field. */
export function recoverEditableTargetAfterReplacement(model: DocumentModel, original: ToolTarget, content: string,
  format?: 'text' | 'html'): ToolTarget | null {
  if (original.kind === 'html-author-field') {
    let target = original.source ? { ...original, source: { ...original.source, to: original.source.from + encodedHtmlAuthorField(original, content).length } } : original
    if (original.source && isSourceDocumentModel(model)) {
      const recorded = readHtmlAuthoringRecords(model.source)[original.authorKey]
      if (recorded && recorded.binding.path.at(-1)?.attributes?.['data-cw-author-key'] === original.authorKey
        && recorded.kind === original.record.kind && equalComponentValue(recorded.scope, original.record.scope)) {
        const located = locateHtmlAuthorRecordSource(model.source, recorded, original.authorKey, true)
        if (!located?.valueSpan) return null
        target = { ...original, record: recorded, source: { ...original.source, from: located.valueSpan.start, to: located.valueSpan.end } }
      }
    }
    return readHtmlAuthorField(model, target).value === content ? target : null
  }
  if (original.kind === 'markdown-range' && isSourceDocumentModel(model)) {
    const target = { ...original, to: original.from + content.length }
    return readTarget(model, target) === content ? target : null
  }
  if (original.kind !== 'course-instance') return null
  const field = courseInstanceTextTarget(model, original)
  const value = readCourseInstanceText(model, field)
  if (value === null) return null
  const rich = !isHtmlSourceTextTarget(model, field) && (format === 'html' || format === undefined && typeof value !== 'string')
  const parsed = rich ? parseEditableInlineHtml(content, { inlines: [] }) : undefined
  const inserted = parsed ? documentTextLength(parsed) : Array.from(content).length
  const target = original.from !== undefined && original.to !== undefined ? { ...field, to: original.from + inserted } : field
  const selected = isCourseInstanceRange(target) ? sliceCourseInstanceText(value, target.from, target.to) : value
  const matches = parsed ? typeof selected !== 'string' && inlineHtml(selected) === inlineHtml(parsed)
    : (typeof selected === 'string' ? selected : plainDocumentText(selected)) === content
  return matches ? target : null
}
/** Canonical data edit for content-only generation, preserving unselected rich text and its formatting. */
export function replaceCourseInstanceText(model: DocumentModel, target: CourseInstanceTarget, text: string, format: 'text' | 'html' = 'text'): ComponentEdit {
  target = courseInstanceTextTarget(model, target)
  const { instance } = courseInstanceContext(model, target)
  if (componentIsLocked(courseInstanceContext(model, target).project, instance.id)) throw new Error('所选内容已锁定，请先解锁')
  let value = readCourseInstanceText(model, target)
  if (value === null || !target.dataPath) throw new Error('当前目标不是可直接改写的文字字段')
  const richCell = typeof value === 'string' && format === 'html' && tableCellTextField(instance.data, target.dataPath)
    && componentDefinitionBuiltinKey(courseInstanceContext(model, target).project.definitions[instance.definitionId]) === 'guoling.table'
  if (richCell) value = { inlines: [{ type: 'text', text: value as string }] }
  const from = target.from ?? 0, to = target.to ?? (typeof value === 'string' ? Array.from(value).length : documentTextLength(value))
  if (target.from !== undefined || target.to !== undefined) sliceCourseInstanceText(value, from, to)
  let next: string | FlowTextContent
  if (typeof value === 'string') {
    if (format === 'html' && !isHtmlSourceTextTarget(model, target)) throw new Error('纯文字字段不接受富文本 HTML')
    const chars = Array.from(value)
    next = chars.slice(0, from).join('') + text + chars.slice(to).join('')
  } else {
    const selection = sliceDocumentText(value, from, to)
    const selected = selection.inlines.find(inline => inline.type === 'text')
    const replacement = format === 'html' ? parseEditableInlineHtml(text, selection).inlines
      : [{ type: 'text' as const, text, ...(selected?.style ? { style: selected.style } : {}), ...(selected?.link ? { link: selected.link } : {}), ...(selected?.code ? { code: true } : {}) }]
    next = normalizeDocumentText({ inlines: [...sliceDocumentText(value, 0, from).inlines,
      ...replacement,
      ...sliceDocumentText(value, to, documentTextLength(value)).inlines] })
  }
  return courseInstanceTextEdit(model, target, next)
}
/** A scoped text value writes its original authored field, including Flow media captions. */
export function courseInstanceTextEdit(model: DocumentModel, target: CourseInstanceTarget, value: string | FlowTextContent): ComponentEdit {
  target = courseInstanceTextTarget(model, target)
  const { instance } = courseInstanceContext(model, target)
  if (!target.dataPath) throw new Error('当前目标没有可编辑的文字字段')
  if (typeof value !== 'string' && target.fieldScope !== 'flowLayout'
    && componentDefinitionBuiltinKey(courseInstanceContext(model, target).project.definitions[instance.definitionId]) === 'guoling.table') {
    const upgrade = tableCellRichTextEdit(instance.data, target.dataPath, value)
    if (upgrade) return { type: 'data.set', instanceId: instance.id, path: upgrade.path, value: upgrade.value as unknown as JsonValue }
  }
  if ((target.fieldScope ?? 'data') === 'data') return { type: 'data.set', instanceId: instance.id, path: [...target.dataPath], value: value as unknown as JsonValue }
  if (!instance.flowLayout || target.dataPath.length !== 1 || target.dataPath[0] !== 'caption' || typeof value === 'string') throw new Error('当前 Flow 字段不是可编辑的富文本题注')
  return { type: 'instance.flowLayout.set', instanceId: instance.id, flowLayout: { ...structuredClone(instance.flowLayout), caption: structuredClone(value) } }
}

export function containsTarget(allowed: ToolTarget, target: ToolTarget, model?: DocumentModel): boolean {
  if (target.kind === 'text-selection') return target.fragments.length > 0 && target.fragments.every(fragment => containsTarget(allowed, fragment.target, model))
  if (allowed.kind === 'text-selection') return allowed.fragments.some(fragment => containsTarget(fragment.target, target, model))
  const kinds = ['document', 'markdown-range', 'html-author-field', 'course-instance', 'course-surface', 'course-asset']
  if (!kinds.includes(allowed.kind) || !kinds.includes(target.kind)) return false
  if (allowed.kind === 'document') return true
  if (allowed.kind === 'html-author-field' && target.kind === 'html-author-field')
    return allowed.authorKey === target.authorKey && allowed.field === target.field
      && (allowed.source ? target.source?.from === allowed.source.from && target.source.to === allowed.source.to : !target.source)
      && equalComponentValue({ kind: allowed.record.kind, scope: allowed.record.scope, binding: allowed.record.binding },
        { kind: target.record.kind, scope: target.record.scope, binding: target.record.binding })
  if (allowed.kind === 'course-surface' && target.kind === 'course-instance' && model?.kind === 'course-v10') {
    const owner = instanceRootOwner(model.project, target.instanceId)
    return allowed.surfaceId === target.surfaceId && owner?.kind === 'surface' && owner.surfaceId === allowed.surfaceId
      && (allowed.stateId === undefined || allowed.stateId === (target.stateId ?? null))
  }
  if (allowed.kind === 'course-surface' && target.kind === 'course-surface') return allowed.surfaceId === target.surfaceId
    && (allowed.stateId === undefined || allowed.stateId === target.stateId)
  if (allowed.kind === 'course-instance' && target.kind === 'course-instance') {
    if (allowed.surfaceId !== target.surfaceId || (allowed.stateId ?? null) !== (target.stateId ?? null)) return false
    if (allowed.instanceId !== target.instanceId) {
      if (allowed.dataPath || model?.kind !== 'course-v10') return false
      let owner = owningContainer(model.project, target.instanceId)
      while (owner?.kind === 'instance') {
        if (owner.instanceId === allowed.instanceId) return true
        owner = owningContainer(model.project, owner.instanceId)
      }
      return false
    }
    if (!allowed.dataPath) return true
    if ((allowed.fieldScope ?? 'data') !== (target.fieldScope ?? 'data')) return false
    if (!target.dataPath || !allowed.dataPath.every((part, index) => part === target.dataPath![index])) return false
    if (!isCourseInstanceRange(allowed)) return true
    return isCourseInstanceRange(target) && target.dataPath.length === allowed.dataPath.length && target.from >= allowed.from && target.to <= allowed.to
  }
  if (allowed.kind === 'markdown-range' && target.kind === 'markdown-range') return target.from >= allowed.from && target.to <= allowed.to
  return documentDigest(allowed) === documentDigest(target)
}

export function readTarget(model: DocumentModel, target: ToolTarget): unknown {
  if (target.kind === 'text-selection') return readEditableTargetContent(model, target).text
  if (target.kind === 'html-author-field') return readHtmlAuthorField(model, target).value
  if (target.kind === 'document') {
    if (isSourceDocumentModel(model)) return model.source
    if (model.kind === 'course-v10') return { title: model.project.title, background: model.project.background,
      designTokens: model.project.designTokens, playback: model.project.playback, media: model.project.media, logic: model.project.logic,
      global: model.project.global, surfaces: model.project.surfaces.map(value => ({ id: value.id, kind: value.kind, title: value.title })) }
    throw new Error('当前工具只支持 Project V10、Markdown 和 Text 文档')
  }
  if (target.kind === 'markdown-range') {
    if (!isSourceDocumentModel(model) || !Number.isSafeInteger(target.from) || !Number.isSafeInteger(target.to) || target.from < 0 || target.to < target.from || target.to > model.source.length) throw new Error('正文范围无效')
    return model.source.slice(target.from, target.to)
  }
  if (model.kind !== 'course-v10') throw new Error('组件目标需要 Project V10 文档')
  if (target.kind === 'course-instance') {
    const { instance, value } = courseInstanceContext(model, target)
    if (isCourseInstanceRange(target)) {
      const content = readCourseInstanceText(model, target)
      if (content === null) throw new Error('所选字段不是文字')
      return sliceCourseInstanceText(content, target.from, target.to)
    }
    return target.dataPath === undefined ? instance : value
  }
  if (target.kind === 'course-surface') {
    if (target.stateId && !model.project.surfaces.find(value => value.id === target.surfaceId)?.presentation?.states.some(value => value.id === target.stateId))
      throw new Error('展示状态已不存在')
    const project = target.stateId ? resolveComponentPresentation(model.project, target.surfaceId, target.stateId) : model.project
    const surface = project.surfaces.find(value => value.id === target.surfaceId)
    if (!surface) throw new Error('表面已不存在')
    return surface
  }
  if (target.kind === 'course-asset') {
    const asset = model.project.assets[target.assetId]
    if (!asset) throw new Error('素材已不存在')
    return asset
  }
  throw new Error('当前工具不支持此目标；请重新选择组件、表面或素材')
}

export function targetFootprint(model: DocumentModel, target: ToolTarget): string {
  if (target.kind === 'text-selection') return documentDigest(target.fragments.map(fragment => ({ separator: fragment.separatorBefore ?? '', footprint: targetFootprint(model, fragment.target) })))
  if (target.kind === 'course-instance' && target.dataPath) target = courseInstanceTextTarget(model, target)
  if (target.kind === 'html-author-field' && isSourceDocumentModel(model)) {
    const { value, identity } = readHtmlAuthorField(model, target)
    if (target.source) return documentDigest({ kind: identity.kind, scope: identity.scope, value })
    // Program/binding changes may redirect a dynamic object. Unrelated static text,
    // image fields and author records do not change this field's identity or value.
    return documentDigest({ identity, value, source: htmlAuthorFieldSourceIdentity(model.source, target) })
  }
  if (target.kind === 'course-instance' && model.kind === 'course-v10') {
    const context = courseInstanceContext(model, target)
    return documentDigest({ definitionId: context.instance.definitionId, owner: owningContainer(model.project, target.instanceId),
      stateId: target.stateId ?? null, ...(target.dataPath ? { fieldScope: target.fieldScope ?? 'data', dataPath: target.dataPath } : {}),
      ...(target.dataPath ? { fieldIdentity: courseInstanceFieldIdentity(model, target) } : {}),
      value: target.dataPath ? context.value : context.instance })
  }
  return documentDigest(readTarget(model, target))
}

/** Conservative verified mapping for a single disjoint source edit; ambiguous/overlapping edits conflict. */
export function mapMarkdownRange(before: string, after: string, range: Extract<ToolTarget, { kind: 'markdown-range' }>): typeof range {
  return mapSequenceRange(before, after, range)
}
/** The same verified mapping for source code units or rich-text code-point/atom tokens. */
export function mapSequenceRange<T, R extends { from: number; to: number }>(
  before: { readonly length: number; readonly [index: number]: T },
  after: { readonly length: number; readonly [index: number]: T }, range: R): R {
  if (before === after) return { ...range }
  let from = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from += 1
  if (from === before.length && from === after.length) return { ...range }
  let oldTo = before.length, newTo = after.length
  while (oldTo > from && newTo > from && before[oldTo - 1] === after[newTo - 1]) { oldTo -= 1; newTo -= 1 }
  if (oldTo === from) {
    const added = after.length - before.length
    // Equal surrounding text can make several insertion points explain the same
    // snapshots. A frozen range remains usable only if every point maps it alike.
    let earliest = before.length
    while (earliest > 0 && before[earliest - 1] === after[earliest - 1 + added]) earliest -= 1
    if (from <= range.from) return { ...range, from: range.from + added, to: range.to + added }
    if (earliest >= range.to && earliest > range.from) return { ...range }
    throw new Error(earliest < from ? '重复文字导致范围映射不唯一，请重新读取目标' : '正文目标已发生重叠修改，请重新读取目标')
  }
  if (newTo === from) {
    const removed = before.length - after.length
    let earliest = after.length
    while (earliest > 0 && before[earliest - 1 + removed] === after[earliest - 1]) earliest -= 1
    if (from + removed <= range.from) return { ...range, from: range.from - removed, to: range.to - removed }
    if (earliest >= range.to && earliest > range.from) return { ...range }
    throw new Error(earliest < from ? '重复文字导致范围映射不唯一，请重新读取目标' : '正文目标已发生重叠修改，请重新读取目标')
  }
  if (oldTo <= range.from && from < range.from) {
    const shift = newTo - oldTo
    return { ...range, from: range.from + shift, to: range.to + shift }
  }
  if (from >= range.to && from > range.from) return { ...range }
  throw new Error('正文目标已发生重叠修改，请重新读取目标')
}

export function childTargets(model: DocumentModel, target: ToolTarget): { target: ToolTarget; label: string }[] {
  if (model.kind === 'course-v10' && (target.kind === 'course-surface' || target.kind === 'course-instance')) {
    readTarget(model, target)
    const project = target.stateId ? resolveComponentPresentation(model.project, target.surfaceId, target.stateId) : model.project
    const ids = target.kind === 'course-surface' ? project.surfaces.find(value => value.id === target.surfaceId)!.childIds
      : target.dataPath ? [] : project.instances[target.instanceId].childIds ?? []
    return ids.map(instanceId => ({ target: { kind: 'course-instance', surfaceId: target.surfaceId, instanceId, stateId: target.stateId ?? null },
      label: model.project.instances[instanceId].name ?? model.project.definitions[model.project.instances[instanceId].definitionId]?.title ?? '所选对象' }))
  }
  if (target.kind === 'document') {
    if (isSourceDocumentModel(model)) return [{ target: { kind: 'markdown-range', from: 0, to: model.source.length }, label: '正文' }]
    if (model.kind === 'course-v10') return [
      ...model.project.surfaces.map(surface => ({ target: { kind: 'course-surface' as const, surfaceId: surface.id }, label: surface.title })),
      ...(['underlay', 'overlay'] as const).flatMap(plane => model.project.global[plane].map(instanceId => ({
        target: { kind: 'course-instance' as const, surfaceId: model.project.surfaces[0]!.id, instanceId },
        label: `全局${plane === 'underlay' ? '底层' : '上层'} · ${model.project.instances[instanceId].name ?? model.project.definitions[model.project.instances[instanceId].definitionId]?.title ?? '对象'}`,
      }))),
      ...Object.values(model.project.assets).map(asset => ({ target: { kind: 'course-asset' as const, assetId: asset.id }, label: asset.path })),
    ]
    throw new Error('当前工具只支持 Project V10、Markdown 和 Text 文档')
  }
  throw new Error('当前目标没有可列出的子项')
}
