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
import { replaceDocumentText } from '../../shared/document/textInteraction'
import { projectFlowDocument } from '../components/document/flowDocumentProjection'
import { documentSourceEdits, sequenceSourceEditRanges } from '../../shared/document/sourceMerge'
import { parseDocumentMarkdown } from '../../shared/document/markdown'
import { inlineHtml } from '../../shared/document/html'
import { readHtmlDocumentText, type DocumentHtmlNode } from '../../shared/document/htmlText'
import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { spatialGraphItem, spatialGraphDependencyPaths } from '../course/courseSpatialEdits'
import { formatTextContent, type TextStyle } from './textFormatting'
import { authorSpotEdits } from '../components/authoring/componentAuthorEdits'
import { normalizeOwnedDocumentPath } from '../../components/web/ownedDocumentIdentity'
import { readAuthorSourceText } from '../components/authoring/sourceAuthorText'
import type { ComponentAuthorField, ComponentAuthorSpot } from '../../shared/contracts/component-platform/runtime'
import { allocateTextSelectionReplacement } from '../../shared/document/textSelectionReplacement'

export type CourseInstanceTarget = Extract<ToolTarget, { kind: 'course-instance' }>

/** Freeze only author coordinates; runtime bounds and mount identity are never author authority. */
export function courseAuthorFieldTarget(surfaceId: string, spot: ComponentAuthorSpot, stateId?: string | null): CourseInstanceTarget {
  const { kind, authorKey, scope, binding, bindingStatus, fieldScope, dataPath, sourceRegion, initialValue } = spot
  if (kind === 'text' && dataPath?.length && !sourceRegion && fieldScope !== 'authoring')
    return { kind: 'course-instance', surfaceId, instanceId: spot.instanceId, stateId: stateId ?? null,
      fieldScope: fieldScope ?? 'data', dataPath: [...dataPath] }
  if (!sourceRegion && !dataPath?.length && !(authorKey && binding)) throw new Error('此处没有可编辑的精确作者地址')
  if (typeof initialValue !== 'string') throw new Error('此处请使用专业字段编辑入口')
  const authorField: Omit<ComponentAuthorField, 'initialValue'> & { initialValue: string } = structuredClone({ kind, authorKey, scope, binding, bindingStatus, fieldScope, dataPath, sourceRegion, initialValue })
  return { kind: 'course-instance', surfaceId, instanceId: spot.instanceId, stateId: stateId ?? null, authorField }
}
function authorFieldSource(model: DocumentModel, target: CourseInstanceTarget): string {
  const { instance, project } = courseInstanceContext(model, { ...target, authorField: undefined, dataPath: undefined })
  const region = target.authorField?.sourceRegion
  if (!region) throw new Error('此处没有精确源码地址')
  if (region.kind === 'data') {
    const value = componentValueAt(project, ['instances', instance.id, 'data', ...region.path ?? []]).value
    if (typeof value !== 'string') throw new Error('作者字段源文已不存在')
    return value
  }
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  if (implementation?.kind !== 'source') throw new Error('作者字段源码载体已变化')
  if (implementation.workspace && model.kind === 'course-v10') {
    const bytes = model.resources.components[implementation.workspace.ownerId]?.[region.path?.join('/') || implementation.workspace.entry]
    if (!bytes) throw new Error('作者字段源码文件已不存在')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  if (typeof implementation.source !== 'string') throw new Error('作者字段源码已不存在')
  return implementation.source
}
function authorFieldIdentity(field: ComponentAuthorField) {
  return { kind: field.kind, authorKey: field.authorKey, scope: field.scope, binding: field.binding,
    fieldScope: field.fieldScope, dataPath: field.dataPath,
    sourceRegion: field.sourceRegion && { kind: field.sourceRegion.kind, path: field.sourceRegion.path, encoding: field.sourceRegion.encoding } }
}
export function readCourseAuthorField(model: DocumentModel, target: CourseInstanceTarget) {
  const field = target.authorField
  if (!field) throw new Error('目标没有作者字段')
  const context = courseInstanceContext(model, { ...target, authorField: undefined, dataPath: undefined })
  const recorded = field.authorKey ? context.instance.authoring?.records?.[field.authorKey] : undefined
  if (recorded && field.binding && !equalComponentValue({ kind: recorded.kind, scope: recorded.scope, binding: recorded.binding },
    { kind: field.kind, scope: field.scope, binding: field.binding })) throw new Error('作者字段绑定已变化，请重新选择')
  const override = recorded?.overrides[field.kind === 'text' ? 'text' : 'src']
  if (field.sourceRegion && override !== undefined) {
    return { ...context, value: override }
  }
  if (field.sourceRegion) {
    const source = authorFieldSource(model, target), { start, end, encoding } = field.sourceRegion
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.length) throw new Error('作者字段源码范围已失效')
    return { ...context, value: readAuthorSourceText(source, field.sourceRegion) }
  }
  if (field.authorKey && field.binding) {
    const current = context.instance.authoring?.records?.[field.authorKey]
    if (current && !equalComponentValue({ kind: current.kind, scope: current.scope, binding: current.binding },
      { kind: field.kind, scope: field.scope, binding: field.binding })) throw new Error('作者字段绑定已变化，请重新选择')
    return { ...context, value: current?.overrides[field.kind === 'text' ? 'text' : 'src'] ?? field.binding.baseline }
  }
  if (!field.dataPath) throw new Error('作者字段没有可编辑地址')
  const value = componentValueAt(context.project, ['instances', context.instance.id, field.fieldScope ?? 'data', ...field.dataPath])
  if (!value.exists) throw new Error('作者字段已不存在')
  return { ...context, value: value.value }
}
/** Current narrow identity dependencies become the final transaction CAS. */
export function courseAuthorFieldReadPaths(model: DocumentModel, target: CourseInstanceTarget): string[][] {
  const { instance } = readCourseAuthorField(model, target), field = target.authorField!
  const base = ['instances', instance.id], paths = [[...base, 'definitionId'], ['@owner', instance.id]]
  if (field.sourceRegion?.kind === 'implementation') {
    paths.push([...base, 'implementationOverride'])
    if (!instance.implementationOverride) paths.push(['definitions', instance.definitionId, 'implementation'])
  } else if (field.sourceRegion) paths.push([...base, 'data', ...field.sourceRegion.path ?? []])
  else if (field.authorKey) {
    const record = [...base, 'authoring', 'records', field.authorKey]
    paths.push(...['kind', 'scope', 'binding'].map(key => [...record, key]), [...record, 'overrides', field.kind === 'text' ? 'text' : 'src'])
    const path = field.scope?.['document:path']
    // A first observed child address still uses parser positions until the
    // same edit persists its software frame keys. Its source is a dependency.
    if (path && normalizeOwnedDocumentPath(path) !== path) paths.push([...base, 'data', 'html'])
  } else if (field.dataPath) paths.push([...base, field.fieldScope ?? 'data', ...field.dataPath])
  if (target.stateId) {
    const index = model.kind === 'course-v10' ? model.project.surfaces.find(surface => surface.id === target.surfaceId)?.presentation?.states.findIndex(state => state.id === target.stateId) : -1
    if (index === undefined || index < 0) throw new Error('展示状态已不存在')
    const state = ['@surface', target.surfaceId, 'presentation', 'states', String(index)]
    paths.push([...state, 'id'])
    // Record and data values can be supplied by this state. Capture the matching
    // override leaves too, including absence; another state remains independent.
    for (const path of [...paths]) if (path[0] === 'instances' && ['data', 'authoring'].includes(path[2]))
      paths.push([...state, 'overrides', instance.id, ...path.slice(2)])
  }
  return paths
}
export function replaceCourseAuthorField(model: DocumentModel, target: CourseInstanceTarget, content: string): ComponentEdit[] {
  const { project, instance, value } = readCourseAuthorField(model, target)
  if (model.kind !== 'course-v10' || componentIsLocked(project, instance.id)) throw new Error('所选内容已锁定，请先解锁')
  if (target.authorField!.kind !== 'text') throw new Error('图片字段不能作为正文替换')
  return authorSpotEdits(project, { ...target.authorField!, instanceId: instance.id, initialValue: value as JsonValue }, content, model.resources)
}
function mapCourseAuthorField(before: DocumentModel, after: DocumentModel, target: CourseInstanceTarget, followInside: boolean): CourseInstanceTarget {
  const field = target.authorField!
  if (!field.sourceRegion) {
    let mapped = target
    const path = field.scope?.['document:path'], stable = path && normalizeOwnedDocumentPath(path)
    if (followInside && field.authorKey && field.binding && path && stable && stable !== path) {
      const previous = courseInstanceContext(before, { ...target, authorField: undefined }).instance.authoring?.records?.[field.authorKey]
      const recorded = courseInstanceContext(after, { ...target, authorField: undefined }).instance.authoring?.records?.[field.authorKey]
      // This planned first edit persists the observed software frame keys in
      // the same transaction. Follow only that promotion, keeping every other
      // part of the author's address strict; arbitrary rebindings still fail.
      const scope = { ...field.scope, 'document:path': stable }
      if (!previous && recorded && equalComponentValue({ kind: recorded.kind, scope: recorded.scope, binding: recorded.binding },
        { kind: field.kind, scope, binding: field.binding })) mapped = { ...target, authorField: { ...field, scope } }
    }
    readCourseAuthorField(after, mapped)
    if (path && stable !== path && mapped === target) {
      const previous = courseInstanceContext(before, { ...target, authorField: undefined }).instance.data
      const current = courseInstanceContext(after, { ...target, authorField: undefined }).instance.data
      if (!equalComponentValue((previous as { html?: JsonValue }).html, (current as { html?: JsonValue }).html))
        throw new Error('子文档源码已变化，请重新选择文字')
    }
    return mapped
  }
  const region = field.sourceRegion, fromSource = authorFieldSource(before, target), toSource = authorFieldSource(after, target)
  const range = mapSequenceRange(fromSource, toSource, { from: region.start, to: region.end }, followInside)
  const next = { ...target, authorField: { ...field, sourceRegion: { ...region, start: range.from, end: range.to } } }
  const record = after.kind === 'course-v10' && field.authorKey ? courseInstanceContext(after, { ...target, authorField: undefined }).instance.authoring?.records?.[field.authorKey] : undefined
  if (followInside && record) next.authorField.binding = structuredClone(record.binding)
  return { ...next, authorField: { ...next.authorField, initialValue: readCourseAuthorField(after, next).value as string } }
}

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
    if(project.instances[block.id]?.visible===false)return
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
      && componentDefinitionBuiltinKey(project.definitions[instance.definitionId])!=='guoling.table'
    const from = index === 0 ? start.offset : 0, to = index === selected.length - 1 ? end.offset : entry.length
    if (from < 0 || to > entry.length || from > to) throw new Error('正文范围已失效')
    return { kind: 'course-instance', surfaceId, instanceId: instance.id, stateId: stateId ?? null,
      ...(caption ? { fieldScope: 'flowLayout' as const } : {}), dataPath: courseInstanceSlotPath(caption ? instance.flowLayout : instance.data, slot), from, to }
  }).filter(target => target.from < target.to)
  return textSelectionTarget(model, targets)
}
/** Preserve a rectangular PM cell selection as its real cell fields, never a whole-table grant. */
export function flowCellSelectionTargets(model:DocumentModel,surfaceId:string,selection:Extract<DocumentSelection,{kind:'cells'}>,stateId?:string|null):CourseInstanceTarget[] {
  if(model.kind!=='course-v10')throw new Error('当前文档不是 Project V10')
  const project=resolveComponentPresentation(model.project,surfaceId,stateId??null)
  let table:Extract<import('../../shared/document/content').DocumentBlock,{type:'table'}>|undefined
  walkDocument(projectFlowDocument(project,surfaceId).content.blocks,block=>{if(block.id===selection.tableId && block.type==='table')table=block})
  if(!table || project.instances[table.id]?.visible===false)throw new Error('所选表格已不存在或不可见')
  const row=(id:string)=>table!.rows.findIndex(value=>value.id===id),column=(id:string)=>table!.columns.findIndex(value=>value.id===id)
  const a=row(selection.anchor.rowId),b=row(selection.head.rowId),c=column(selection.anchor.columnId),d=column(selection.head.columnId)
  if([a,b,c,d].some(index=>index<0))throw new Error('所选单元格已不存在')
  return documentVisibleTextSlots(table).flatMap(slot=>{
    const cell=slot.tableCell;if(!cell?.rowId)return []
    const r=row(cell.rowId),col=column(cell.columnId)
    if(r<Math.min(a,b)||r>Math.max(a,b)||col<Math.min(c,d)||col>Math.max(c,d))return []
    const length=documentTextLength(slot.content)
    return [{kind:'course-instance' as const,surfaceId,instanceId:table!.id,stateId:stateId??null,dataPath:courseInstanceSlotPath(project.instances[table!.id].data,{kind:'cell',rowId:cell.rowId,columnId:cell.columnId}),...(length ? {from:0,to:length}:{})}]
  })
}
export function instanceRootOwner(project: CourseProjectV10, instanceId: string) {
  let owner = owningContainer(project, instanceId)
  while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
  return owner
}
export function courseInstanceContext(model: DocumentModel, target: CourseInstanceTarget): { project: CourseProjectV10; instance: CourseProjectV10['instances'][string]; surface: CourseProjectV10['surfaces'][number]; owner: NonNullable<ReturnType<typeof instanceRootOwner>>; value?: unknown } {
  if (model.kind !== 'course-v10') throw new Error('对象目标需要 Project V10 文档')
  if (target.stateId && !model.project.surfaces.find(value => value.id === target.surfaceId)?.presentation?.states.some(value => value.id === target.stateId)) throw new Error('捕获的展示状态已不存在')
  const project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
  const instance = project.instances[target.instanceId]
  const surface = model.project.surfaces.find(value => value.id === target.surfaceId)
  const owner = instanceRootOwner(model.project, target.instanceId)
  if (!instance || !surface || !owner || owner.kind === 'surface' && owner.surfaceId !== surface.id) throw new Error('对象不属于捕获的表面')
  if (target.authorField) return readCourseAuthorField(model, target)
  const field = target.dataPath === undefined ? undefined : componentValueAt(project, ['instances', instance.id, target.fieldScope ?? 'data', ...target.dataPath])
  if (field && !field.exists && target.fieldScope === 'authoring' && target.dataPath?.length === 4
    && target.dataPath[0] === 'records' && target.dataPath[2] === 'overrides') {
    const record = componentAuthorRecordSchema.safeParse(componentValueAt(project,
      ['instances', instance.id, 'authoring', 'records', target.dataPath[1]]).value)
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
  return componentFieldIdentityPaths(project, path).map(identity => ({ path: semanticComponentPath(project,identity), ...componentValueAt(project, identity) }))
}
function semanticComponentPath(project:CourseProjectV10,path:readonly string[]):string[] {
  return path.map((part,index)=>{
    const parent=componentValueAt(project,path.slice(0,index)).value
    if(!Array.isArray(parent) || !/^\d+$/.test(part))return part
    const value=parent[Number(part)] as Record<string,unknown>|undefined
    return value && typeof value.id==='string' ? JSON.stringify({id:value.id,...(typeof value.columnId==='string' ? {columnId:value.columnId}:{})}):part
  })
}
/** Relocate through the same captured row/item/cell identities across array insertion/reorder. */
export function relocateCourseInstanceFieldTarget(before:DocumentModel,after:DocumentModel,target:CourseInstanceTarget):CourseInstanceTarget {
  if(!target.dataPath)return target
  const old=courseInstanceContext(before,target),next=courseInstanceContext(after,{...target,dataPath:undefined})
  let a:unknown=old.instance[target.fieldScope ?? 'data'],b:unknown=next.instance[target.fieldScope ?? 'data']
  const path:string[]=[]
  for(const part of target.dataPath) {
    let key=part
    if(Array.isArray(a) && /^\d+$/.test(part)) {
      const value=a[Number(part)] as Record<string,unknown>|undefined
      if(value && typeof value==='object' && typeof value.id==='string') {
        const index=Array.isArray(b) ? b.findIndex(item=>item?.id===value.id && (value.columnId===undefined || item?.columnId===value.columnId)):-1
        if(index<0)throw new Error('原文字字段所在行、项或单元格已不存在')
        key=String(index)
      }
    }
    path.push(key);a=a && typeof a==='object' ? (a as any)[part]:undefined;b=b && typeof b==='object' ? (b as any)[key]:undefined
  }
  return courseInstanceTextTarget(after,{...target,dataPath:path})
}
/** The effective native text implementation has one body field; other objects keep explicit slots. */
export function courseInstanceTextTarget(model: DocumentModel, target: CourseInstanceTarget): CourseInstanceTarget {
  if (target.authorField) return target
  if (target.dataPath !== undefined || target.fieldScope === 'flowLayout') {
    if (target.dataPath && (target.fieldScope ?? 'data') === 'data' && model.kind === 'course-v10') {
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
  if (target.authorField?.kind === 'image') return null
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
  try { readTarget(snapshot.model, target) } catch { return undefined }
  return { kind: 'content', documentId: snapshot.documentId, target: structuredClone(target) }
}
/** Content-only replacement is partitioned by the existing text diff; no source gap or platform address comes from the model. */
export function planTextSelectionReplacement(model: DocumentModel, target: Extract<ToolTarget, { kind: 'text-selection' }>, content: string,
  format: 'text' | 'html' = 'text'): { target: TextFragmentTarget; content: string; format: 'text' | 'html' }[] {
  const atoms = (value: FlowTextContent) => value.inlines.map(inline => inline.type !== 'text' ? '\uFFFC' : inline.text).join('')
  const fragments = target.fragments.map(fragment => {
    const selected = readTarget(model, fragment.target)
    return { ...fragment, text: typeof selected === 'string' ? selected : atoms(selected as FlowTextContent) }
  })
  const previous = normalizeDocumentText({ inlines: fragments.flatMap(fragment => {
    const value = readTarget(model, fragment.target)
    return [...(fragment.separatorBefore ? [{ type: 'text' as const, text: fragment.separatorBefore }] : []),
      ...(typeof value === 'string' ? [{ type: 'text' as const, text: value }] : (value as FlowTextContent).inlines)]
  }) })
  const rich = format === 'html' ? parseEditableInlineHtml(content, previous) : undefined
  const next = rich ? atoms(rich) : content
  const allocations = allocateTextSelectionReplacement(fragments, next)
  return fragments.map((fragment, index) => {
    const { from, to, text: selected } = allocations[index]!
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
    next = replaceDocumentText(value, from, to, { inlines: replacement })
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
  if (target.fieldScope === 'authoring') return { type: 'authoring.set', instanceId: instance.id, path: [...target.dataPath], value: value as unknown as JsonValue }
  if ((target.fieldScope ?? 'data') === 'data') return { type: 'data.set', instanceId: instance.id, path: [...target.dataPath], value: value as unknown as JsonValue }
  if (!instance.flowLayout || target.dataPath.length !== 1 || target.dataPath[0] !== 'caption' || typeof value === 'string') throw new Error('当前 Flow 字段不是可编辑的富文本题注')
  return { type: 'instance.flowLayout.set', instanceId: instance.id, flowLayout: { ...structuredClone(instance.flowLayout), caption: structuredClone(value) } }
}

/** Formatting follows the captured text field; it never widens a range to object properties. */
export function formatCourseInstanceText(model: DocumentModel, target: CourseInstanceTarget, style: TextStyle): ComponentEdit {
  const original = target, context = courseInstanceContext(model, target)
  if (componentIsLocked(context.project, target.instanceId)) throw new Error('对象已锁定，请先解锁')
  const builtin = componentDefinitionBuiltinKey(context.project.definitions[context.instance.definitionId])
  if (builtin === 'guoling.formula' && !original.dataPath && original.from === undefined && original.to === undefined) {
    if (Object.keys(style).some(key => key !== 'fontSize' && key !== 'color')) throw new Error('独立公式仅支持字号和颜色格式')
    const formula = (context.instance.data as { formula: { style?: Record<string, JsonValue> } }).formula
    return { type: 'data.set', instanceId: target.instanceId, path: ['formula', 'style'], value: { ...formula.style, ...style } }
  }
  target = courseInstanceTextTarget(model, target)
  const value = readCourseInstanceText(model, target)
  if (value === null) throw new Error('当前目标没有可格式化的正文')
  if (typeof value === 'string' && !(builtin === 'guoling.table' && target.dataPath?.[0] === 'rows' && target.dataPath?.[2] === 'cells'))
    throw new Error('当前字段保存为无格式文字，不能通过格式操作改变其内容类型')
  const content = typeof value === 'string' ? { inlines: [{ type: 'text' as const, text: value }] } : value
  return courseInstanceTextEdit(model, target, formatTextContent(content, target.from ?? 0, target.to ?? documentTextLength(content), style))
}

export function containsTarget(allowed: ToolTarget, target: ToolTarget, model?: DocumentModel): boolean {
  if (target.kind === 'text-selection') return target.fragments.length > 0 && target.fragments.every(fragment => containsTarget(allowed, fragment.target, model))
  if (allowed.kind === 'text-selection') return allowed.fragments.some(fragment => containsTarget(fragment.target, target, model))
  const kinds = ['document', 'markdown-range', 'html-author-field', 'course-instance', 'course-surface', 'course-asset', 'spatial-graph']
  if (!kinds.includes(allowed.kind) || !kinds.includes(target.kind)) return false
  if (allowed.kind === 'document') return true
  if (allowed.kind === 'html-author-field' && target.kind === 'html-author-field')
    return allowed.authorKey === target.authorKey && allowed.field === target.field
      && (allowed.source ? target.source?.from === allowed.source.from && target.source.to === allowed.source.to : !target.source)
      && equalComponentValue({ kind: allowed.record.kind, scope: allowed.record.scope, binding: allowed.record.binding },
        { kind: target.record.kind, scope: target.record.scope, binding: target.record.binding })
  if (allowed.kind === 'course-surface' && target.kind === 'spatial-graph') return allowed.surfaceId === target.surfaceId && !allowed.stateId
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
      if (allowed.authorField || allowed.dataPath || model?.kind !== 'course-v10') return false
      let owner = owningContainer(model.project, target.instanceId)
      while (owner?.kind === 'instance') {
        if (owner.instanceId === allowed.instanceId) return true
        owner = owningContainer(model.project, owner.instanceId)
      }
      return false
    }
    if (allowed.authorField) return Boolean(target.authorField && equalComponentValue(authorFieldIdentity(allowed.authorField), authorFieldIdentity(target.authorField))
      && equalComponentValue(allowed.authorField.sourceRegion, target.authorField.sourceRegion))
    if (!allowed.dataPath) return true
    if (target.authorField) return false
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
  if (target.kind === 'spatial-graph') return spatialGraphItem(model.project, target)
  if (target.kind === 'course-instance') {
    const { instance, value } = courseInstanceContext(model, target)
    if (isCourseInstanceRange(target)) {
      const content = readCourseInstanceText(model, target)
      if (content === null) throw new Error('所选字段不是文字')
      return sliceCourseInstanceText(content, target.from, target.to)
    }
    if (target.authorField || target.dataPath !== undefined) return value
    // Put existing geometry before large author data in every shared read projection.
    const { id, definitionId, frame, ...fields } = instance
    return { id, definitionId, ...(Object.hasOwn(instance, 'frame') ? { frame } : {}), ...fields }
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

/** Model-facing content read. Full object inspection and internal CAS keep readTarget's exact projection. */
export function readSemanticTarget(model: DocumentModel, target: ToolTarget): unknown {
  const plain = (value: unknown) => {
    const text = documentTextContentSchema.safeParse(value)
    return text.success ? plainDocumentText(text.data) : value
  }
  if (target.kind === 'course-instance' && model.kind === 'course-v10' && !target.authorField && target.dataPath === undefined) {
    const { project, instance } = courseInstanceContext(model, target)
    const text = readCourseInstanceText(model, target)
    if (text !== null) return typeof text === 'string' ? text : plainDocumentText(text)
    if (componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.text') {
      const content = documentTextContentSchema.safeParse((instance.data as Record<string, unknown>)?.content)
      if (content.success) return plainDocumentText(content.data)
    }
    return { id: instance.id, definitionId: instance.definitionId, ...(instance.name ? { name: instance.name } : {}),
      data: instance.data, ...(instance.childIds ? { childIds: instance.childIds } : {}) }
  }
  const current = readTarget(model, target)
  if (target.kind === 'course-surface' && model.kind === 'course-v10') {
    const surface = current as CourseProjectV10['surfaces'][number]
    return { ...surface, ...(surface.presentation ? { presentation: { ...surface.presentation,
      states: surface.presentation.states.map(({ id, title, order }) => ({ id, title, ...(order ? { order } : {}) })) } } : {}) }
  }
  return plain(current)
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
    if (target.authorField) {
      const field = target.authorField
      const sourceIdentity = !field.sourceRegion && field.binding && typeof (context.instance.data as any)?.html === 'string'
        ? htmlAuthorFieldSourceIdentity((context.instance.data as any).html, { kind: 'html-author-field', authorKey: field.authorKey!, field: field.kind === 'text' ? 'text' : 'src', record: { kind: field.kind, scope: field.scope, binding: field.binding, overrides: {} } }) : undefined
      return documentDigest({ definitionId: context.instance.definitionId, owner: context.owner, stateId: target.stateId ?? null,
        identity: authorFieldIdentity(field), sourceIdentity, value: context.value })
    }
    const tableField=target.fieldScope!=='flowLayout' && target.dataPath && componentDefinitionBuiltinKey(context.project.definitions[context.instance.definitionId])==='guoling.table' && tableCellTextField(context.instance.data,target.dataPath)
    const selected=isCourseInstanceRange(target) ? readTarget(model,target):undefined
    const value=typeof selected==='string' ? normalizeDocumentText({inlines:[{type:'text',text:selected}]}):selected
    const semanticPath=target.dataPath ? semanticComponentPath(context.project,['instances',target.instanceId,target.fieldScope ?? 'data',...target.dataPath]).slice(3):undefined
    if(tableField && semanticPath)semanticPath[semanticPath.length-1]='#cell-text'
    return documentDigest({ definitionId: context.instance.definitionId, owner: owningContainer(model.project, target.instanceId),
      stateId: target.stateId ?? null, ...(target.dataPath ? { fieldScope: target.fieldScope ?? 'data', dataPath: semanticPath } : {}),
      ...(target.dataPath ? { fieldIdentity: courseInstanceFieldIdentity(model, target) } : {}),
      value: isCourseInstanceRange(target) ? value : target.dataPath ? context.value : context.instance })
  }
  if (target.kind === 'spatial-graph' && model.kind === 'course-v10') return documentDigest({
    graph: readTarget(model, target), dependencies: spatialGraphDependencyPaths(model.project, target).map(path => ({ path, ...componentValueAt(model.project, path) })) })
  return documentDigest(readTarget(model, target))
}

/** Verified mapping of disjoint source edits; ambiguous/overlapping edits conflict. */
export function mapMarkdownRange(before: string, after: string, range: Extract<ToolTarget, { kind: 'markdown-range' }>, followInside = false): typeof range {
  return mapSequenceRange(before, after, range, followInside)
}
/** Canonical commits map the same professional field; no search for matching text elsewhere. */
export function mapExternalCourseTextTarget(before: DocumentModel, after: DocumentModel, target: ToolTarget, followInside = false): ToolTarget {
  if (target.kind === 'text-selection') return { ...target, fragments: target.fragments.map(fragment => ({ ...fragment,
    target: mapExternalCourseTextTarget(before, after, fragment.target, followInside) as typeof fragment.target })) }
  if (target.kind === 'course-instance' && target.authorField) return mapCourseAuthorField(before, after, target, followInside)
  if(target.kind==='course-instance' && target.dataPath) {
    const relocated=relocateCourseInstanceFieldTarget(before,after,target)
    if(!isCourseInstanceRange(target))return relocated
    const oldValue=readCourseInstanceText(before,target),newValue=readCourseInstanceText(after,relocated)
    if(oldValue===null || newValue===null)throw new Error('正文目标已改变字段类型')
    const tokens=(value:string|FlowTextContent):string[]=>typeof value==='string' ? Array.from(value):value.inlines.flatMap(inline=>inline.type==='text' ? Array.from(inline.text)
      : inline.type==='math' ? [`math:${inline.formulaId}:${inline.latex}`] : [`component:${inline.instanceId}:${inline.accessibleText ?? ''}`])
    return mapSequenceRange(tokens(oldValue),tokens(newValue),relocated as CourseInstanceRange,followInside)
  }
  return target
}
/** The same verified mapping for source code units or rich-text code-point/atom tokens. */
function sameSequenceSpan<T>(before: ArrayLike<T>, from: number, after: ArrayLike<T>, nextFrom: number, length: number) {
  for (let index = 0; index < length; index++) if (before[from + index] !== after[nextFrom + index]) return false
  return true
}

export function mapSequenceRange<T, R extends { from: number; to: number }>(
  before: { readonly length: number; readonly [index: number]: T },
  after: { readonly length: number; readonly [index: number]: T }, range: R, followInside = false): R {
  if (before === after) return { ...range }
  // Current-draft ACK follows this original field's complete edited range.
  // Do this before diff decomposition: incidental equal letters inside a
  // replacement must not split or shorten the manual draft being confirmed.
  const currentEnd = range.to + after.length - before.length
  if (followInside && currentEnd >= range.from && range.from <= before.length && range.to <= before.length
    && sameSequenceSpan(before, 0, after, 0, range.from) && sameSequenceSpan(before, range.to, after, currentEnd, before.length - range.to))
    return { ...range, to: currentEnd }
  const edits = sequenceSourceEditRanges(before, after)
  if (edits.length > 1) {
    let current = before, mapped = { ...range }
    for (const edit of [...edits].reverse()) {
      const currentSource: unknown = current, nextSource: unknown = after
      const next = typeof currentSource === 'string' && typeof nextSource === 'string'
        ? (currentSource.slice(0, edit.from) + nextSource.slice(edit.nextFrom, edit.nextTo) + currentSource.slice(edit.to)) as unknown as typeof before
        : [...Array.from({ length: edit.from }, (_, index) => current[index]!),
          ...Array.from({ length: edit.nextTo - edit.nextFrom }, (_, index) => after[edit.nextFrom + index]!),
          ...Array.from({ length: current.length - edit.to }, (_, index) => current[edit.to + index]!)]
      mapped = mapSingleSequenceRange(current, next, mapped, followInside,
        { from: edit.from, to: edit.to, inserted: edit.nextTo - edit.nextFrom })
      current = next
    }
    if (!followInside && ambiguousRangeCorrespondence(before, after, range, mapped,
      edits.reduce((cost, edit) => cost + edit.to - edit.from + edit.nextTo - edit.nextFrom, 0)))
      throw new Error('重复文字导致范围映射不唯一，请重新读取目标')
    return mapped
  }
  return mapSingleSequenceRange(before, after, range, followInside)
}

/** A known replacement must not recursively regain a fresh fine-diff budget. */
function mapSingleSequenceRange<T, R extends { from: number; to: number }>(before: ArrayLike<T>, after: ArrayLike<T>, range: R, followInside: boolean,
  known?: { from: number; to: number; inserted: number }): R {
  const currentEnd = range.to + after.length - before.length
  if (known && followInside && currentEnd >= range.from && range.from <= before.length && range.to <= before.length
    && sameSequenceSpan(before, 0, after, 0, range.from) && sameSequenceSpan(before, range.to, after, currentEnd, before.length - range.to))
    return { ...range, to: currentEnd }
  // The diff already proves the unchanged prefix/suffix around this one stage.
  // Re-scanning those spans (or diffing the stage again) multiplies large-source work by every edit.
  let from = known?.from ?? 0
  while (from < before.length && from < after.length && before[from] === after[from]) from += 1
  if (from === before.length && from === after.length) return { ...range }
  let oldTo = known?.to ?? before.length, newTo = known ? known.from + known.inserted : after.length
  const slide = Math.max(0, from - Math.min(oldTo, newTo))
  oldTo += slide; newTo += slide
  while (oldTo > from && newTo > from && before[oldTo - 1] === after[newTo - 1]) { oldTo -= 1; newTo -= 1 }
  // Explicit current-draft confirmation can adopt edits inside this same logical range.
  // Ordinary write/read mapping keeps the strict overlap behavior below.
  if (followInside && from >= range.from && oldTo <= range.to)
    return { ...range, to: range.to + newTo - oldTo }
  if (oldTo === from) {
    const added = after.length - before.length
    // Equal surrounding text can make several insertion points explain the same
    // snapshots. A frozen range remains usable only if every point maps it alike.
    let earliest = from
    while (earliest > 0 && before[earliest - 1] === after[earliest - 1 + added]) earliest -= 1
    if (from <= range.from) return { ...range, from: range.from + added, to: range.to + added }
    if (earliest >= range.to && earliest > range.from) return { ...range }
    throw new Error(earliest < from ? '重复文字导致范围映射不唯一，请重新读取目标' : '正文目标已发生重叠修改，请重新读取目标')
  }
  if (newTo === from) {
    const removed = before.length - after.length
    let earliest = from
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

/** Check alternate equally good alignments, without re-binding a target by text search. */
function ambiguousRangeCorrespondence<T>(before: ArrayLike<T>, after: ArrayLike<T>, range: { from: number; to: number }, mapped: { from: number; to: number }, distance: number): boolean {
  const selectedLength = range.to - range.from, selected = (index: number) => before[range.from + index]
  if (!selectedLength) return false
  const prefix = new Uint32Array(selectedLength)
  for (let index = 1, length = 0; index < selectedLength; index++) {
    while (length && selected(index) !== selected(length)) length = prefix[length - 1]!
    if (selected(index) === selected(length)) length++
    prefix[index] = length
  }
  const placements: number[] = []
  for (let index = 0, length = 0; index < after.length; index++) {
    while (length && after[index] !== selected(length)) length = prefix[length - 1]!
    if (after[index] === selected(length)) length++
    if (length === selectedLength) { placements.push(index + 1 - length); length = prefix[length - 1]! }
  }
  if (placements.length < 2) return false
  const leading = prefixEditCosts(before, after, distance, 0, range.from)
  const trailing = prefixEditCosts(before, after, distance, range.to, before.length, true)
  const cost = (from: number) => (leading.get(from) ?? Infinity) + (trailing.get(after.length - from - selectedLength) ?? Infinity)
  const actual = cost(mapped.from)
  return placements.some(from => from !== mapped.from && cost(from) <= actual)
}

/** Indel distance to each possible boundary, using the same bounded edit cost as the actual diff. */
function prefixEditCosts<T>(before: ArrayLike<T>, after: ArrayLike<T>, limit: number, from: number, to: number, reverse = false): Map<number, number> {
  let previous = new Map<number, number>()
  for (let index = 0; index <= Math.min(after.length, limit); index++) previous.set(index, index)
  for (let row = 1; row <= to - from; row++) {
    const current = new Map<number, number>()
    for (let column = Math.max(0, row - limit); column <= Math.min(after.length, row + limit); column++) {
      const value = Math.min((previous.get(column) ?? Infinity) + 1, (current.get(column - 1) ?? Infinity) + 1,
        column > 0 && before[reverse ? to - row : from + row - 1] === after[reverse ? after.length - column : column - 1] ? previous.get(column - 1) ?? Infinity : Infinity)
      if (value <= limit) current.set(column, value)
    }
    previous = current
  }
  return previous
}

export function childTargets(model: DocumentModel, target: ToolTarget): { target: ToolTarget; label: string }[] {
  if (model.kind === 'course-v10' && (target.kind === 'course-surface' || target.kind === 'course-instance')) {
    readTarget(model, target)
    const project = target.stateId ? resolveComponentPresentation(model.project, target.surfaceId, target.stateId) : model.project
    const ids = target.kind === 'course-surface' ? project.surfaces.find(value => value.id === target.surfaceId)!.childIds
      : target.authorField || target.dataPath ? [] : project.instances[target.instanceId].childIds ?? []
    const graphs = target.kind === 'course-surface' && !target.stateId
      ? (['paths', 'relations'] as const).flatMap(kind => (project.surfaces.find(value => value.id === target.surfaceId)?.spatial?.[kind] ?? []).map(item => ({
          target: { kind: 'spatial-graph' as const, surfaceId: target.surfaceId, graph: kind === 'paths' ? 'path' as const : 'relation' as const, graphId: item.id },
          label: ('title' in item ? item.title : 'label' in item ? item.label : undefined) ?? (kind === 'paths' ? '路径' : '关系') }))) : []
    return [...graphs, ...ids.map(instanceId => ({ target: { kind: 'course-instance' as const, surfaceId: target.surfaceId, instanceId, stateId: target.stateId ?? null },
      label: model.project.instances[instanceId].name ?? model.project.definitions[model.project.instances[instanceId].definitionId]?.title ?? '所选对象' }))]
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
