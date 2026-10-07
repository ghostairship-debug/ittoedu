import { isSourceDocumentModel, type DocumentModel, type DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolTarget } from '../../shared/workbench/tools'
import type { ExecutionContentOutput } from '../../shared/workbench/execution'
import { documentDigest } from '../documents/documentDigest'
import { owningContainer, resolveComponentPresentation, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentFieldIdentityPaths, componentValueAt } from '../drivers/courseV10Operations'
import { documentTextLength, documentTextContentSchema, normalizeDocumentText, sliceDocumentText, plainDocumentText, type FlowTextContent } from '../../shared/document/content'
import { inlineHtml } from '../../shared/document/html'
import { readHtmlDocumentText, type DocumentHtmlNode } from '../../shared/document/htmlText'
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'

export type CourseInstanceTarget = Extract<ToolTarget, { kind: 'course-instance' }>
export type CourseInstanceRange = CourseInstanceTarget & { dataPath: string[]; from: number; to: number }
export function isCourseInstanceRange(target: ToolTarget): target is CourseInstanceRange {
  return target.kind === 'course-instance' && target.dataPath !== undefined && target.from !== undefined && target.to !== undefined
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
  if (field && !field.exists) throw new Error('所选数据字段已不存在')
  return { project, instance, surface, owner, ...(field ? { value: field.value } : {}) }
}
/** Existing row/item/cell identities along this exact field path; never search or rebind another slot. */
export function courseInstanceFieldIdentity(model: DocumentModel, target: CourseInstanceTarget) {
  const { project } = courseInstanceContext(model, target)
  if (!target.dataPath) return []
  const path = ['instances', target.instanceId, target.fieldScope ?? 'data', ...target.dataPath]
  return componentFieldIdentityPaths(project, path).map(identity => ({ path: identity, ...componentValueAt(project, identity) }))
}
/** The effective native text implementation has one body field; other objects keep explicit slots. */
export function courseInstanceTextTarget(model: DocumentModel, target: CourseInstanceTarget): CourseInstanceTarget {
  if (target.dataPath !== undefined || target.fieldScope === 'flowLayout') return target
  const { project, instance } = courseInstanceContext(model, target)
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  return implementation?.kind === 'builtin' && implementation.key === 'guoling.text'
    ? { ...target, dataPath: ['content'] } : target
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
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > length) throw new Error('所选文字范围已失效')
  return typeof value === 'string' ? Array.from(value).slice(from, to).join('') : sliceDocumentText(value, from, to)
}
/** The editable projection contains content, never the target's identity or bookkeeping. */
export function readEditableTargetContent(model: DocumentModel, target: ToolTarget): { text: string; format: 'text' | 'markdown' | 'html' } {
  if (target.kind === 'markdown-range' && isSourceDocumentModel(model))
    return { text: readTarget(model, target) as string, format: model.kind === 'markdown' ? 'markdown' : 'text' }
  if (target.kind !== 'course-instance') throw new Error('当前目标不是可直接改写的正文')
  if (courseInstanceContext(model, target).instance.locked) throw new Error('所选内容已锁定，请先解锁')
  const value = readCourseInstanceText(model, target)
  if (value === null) throw new Error('当前目标不是可直接改写的文字字段')
  const selected = isCourseInstanceRange(target) ? sliceCourseInstanceText(value, target.from, target.to) : value
  if (typeof selected === 'string') return { text: selected, format: 'text' }
  // A rich slot stays rich even when today's text has no marks: the request may
  // legitimately add a link, formula or emphasis without switching workflows.
  return { text: inlineHtml(selected), format: 'html' }
}
/** Both visible selection entry points and Main use the same current-content eligibility. */
export function prepareExecutionContentOutput(snapshot: DocumentSnapshot, target: ToolTarget): ExecutionContentOutput | undefined {
  if (target.kind !== 'markdown-range' && target.kind !== 'course-instance') return undefined
  try { readEditableTargetContent(snapshot.model, target) } catch { return undefined }
  return { kind: 'replace-text', documentId: snapshot.documentId, target: structuredClone(target) }
}

function parseEditableInlineHtml(html: string, previous: FlowTextContent): FlowTextContent {
  const project = (node: DefaultTreeAdapterTypes.ChildNode): DocumentHtmlNode[] => {
    if (node.nodeName === '#text') return [{ kind: 'text', text: (node as DefaultTreeAdapterTypes.TextNode).value }]
    if (!('tagName' in node)) return []
    if (['script', 'style', 'iframe', 'img', 'video', 'audio', 'object', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.tagName))
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
  if (original.kind === 'markdown-range' && isSourceDocumentModel(model)) {
    const target = { ...original, to: original.from + content.length }
    return readTarget(model, target) === content ? target : null
  }
  if (original.kind !== 'course-instance') return null
  const field = courseInstanceTextTarget(model, original)
  const value = readCourseInstanceText(model, field)
  if (value === null) return null
  const rich = format === 'html' || format === undefined && typeof value !== 'string'
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
  if (instance.locked) throw new Error('所选内容已锁定，请先解锁')
  const value = readCourseInstanceText(model, target)
  if (value === null || !target.dataPath) throw new Error('当前目标不是可直接改写的文字字段')
  const from = target.from ?? 0, to = target.to ?? (typeof value === 'string' ? Array.from(value).length : documentTextLength(value))
  if (target.from !== undefined || target.to !== undefined) sliceCourseInstanceText(value, from, to)
  let next: string | FlowTextContent
  if (typeof value === 'string') {
    if (format === 'html') throw new Error('纯文字字段不接受富文本 HTML')
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
  if ((target.fieldScope ?? 'data') === 'data') return { type: 'data.set', instanceId: instance.id, path: [...target.dataPath], value: value as unknown as JsonValue }
  if (!instance.flowLayout || target.dataPath.length !== 1 || target.dataPath[0] !== 'caption' || typeof value === 'string') throw new Error('当前 Flow 字段不是可编辑的富文本题注')
  return { type: 'instance.flowLayout.set', instanceId: instance.id, flowLayout: { ...structuredClone(instance.flowLayout), caption: structuredClone(value) } }
}

export function containsTarget(allowed: ToolTarget, target: ToolTarget, model?: DocumentModel): boolean {
  const kinds = ['document', 'markdown-range', 'course-instance', 'course-surface', 'course-asset']
  if (!kinds.includes(allowed.kind) || !kinds.includes(target.kind)) return false
  if (allowed.kind === 'document') return true
  if (allowed.kind === 'course-surface' && target.kind === 'course-instance' && model?.kind === 'course-v10') {
    const owner = instanceRootOwner(model.project, target.instanceId)
    return allowed.surfaceId === target.surfaceId && owner?.kind === 'surface' && owner.surfaceId === allowed.surfaceId
  }
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
  if (target.kind === 'document') {
    if (isSourceDocumentModel(model)) return model.source
    if (model.kind === 'course-v10') return { title: model.project.title, surfaces: model.project.surfaces.map(value => ({ id: value.id, kind: value.kind })) }
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
    const surface = model.project.surfaces.find(value => value.id === target.surfaceId)
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
    const ids = target.kind === 'course-surface' ? model.project.surfaces.find(value => value.id === target.surfaceId)!.childIds
      : target.dataPath ? [] : model.project.instances[target.instanceId].childIds ?? []
    return ids.map(instanceId => ({ target: { kind: 'course-instance', surfaceId: target.surfaceId, instanceId, ...(target.kind === 'course-instance' ? { stateId: target.stateId ?? null } : {}) },
      label: model.project.instances[instanceId].name ?? model.project.definitions[model.project.instances[instanceId].definitionId]?.title ?? '所选对象' }))
  }
  if (target.kind === 'document') {
    if (isSourceDocumentModel(model)) return [{ target: { kind: 'markdown-range', from: 0, to: model.source.length }, label: '正文' }]
    if (model.kind === 'course-v10') return [
      ...model.project.surfaces.map(surface => ({ target: { kind: 'course-surface' as const, surfaceId: surface.id }, label: surface.title })),
      ...Object.values(model.project.assets).map(asset => ({ target: { kind: 'course-asset' as const, assetId: asset.id }, label: asset.path })),
    ]
    throw new Error('当前工具只支持 Project V10、Markdown 和 Text 文档')
  }
  throw new Error('当前目标没有可列出的子项')
}
