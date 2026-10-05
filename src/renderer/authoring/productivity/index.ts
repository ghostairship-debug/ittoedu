import { documentTextContentSchema, normalizeDocumentText, type FlowInline, type FlowTextContent } from '../../../shared/document/content'
import type { CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import { captureComponentOperation, equalComponentValue, presentationComponentEdits } from '../../../core/drivers/courseV10Operations'
import type { CapturedComponentOperation, CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'

export interface ProductivityContext { document: CourseProjectV10; target: CapturedCourseTarget }
export type DesignProductionStep = CapturedComponentOperation & { createdSurfaceId?: string; originSurfaceId?: string | null }
export type ProductivityScope = 'page' | 'surface' | 'course'
export type ColorProperty = 'text' | 'fill' | 'stroke' | 'background' | 'all'
export type ProductivityRequest = { kind: 'text'; scope: ProductivityScope; find: string; replacement: string } | { kind: 'color'; scope: ProductivityScope; tokenId: string; property: ColorProperty }
export interface ProductivityPreviewItem { id: string; target: string; owner: string; property: string; oldValue: string; newValue: string }
export interface ProductivityPreview { projectId: string; revision: number; target: CapturedCourseTarget; request: ProductivityRequest; items: ProductivityPreviewItem[]; unsupported: string[] }
export type ProductivityApplyResult = { ok: true; step: DesignProductionStep | null } | { ok: false; reason: string }
type Field = ProductivityPreviewItem & { color?: ColorProperty; write(value: string, replacement?: { find: string; replacement: string }): void }
const colors: Record<string, ColorProperty> = { color: 'text', textColor: 'text', fill: 'fill', fillColor: 'fill', borderColor: 'stroke', stroke: 'stroke', strokeColor: 'stroke', backgroundColor: 'background', highlightColor: 'background' }
const textKeys = new Set(['text', 'title', 'label', 'name', 'placeholder', 'altText', 'caption', 'citation', 'body', 'header'])

function fields(document: CourseProjectV10, target: CapturedCourseTarget, scope: ProductivityScope) {
  const result: Field[] = [], unsupported: string[] = []
  if (!document.surfaces.some(surface => surface.id === target.surfaceId)) throw new Error('捕获页面已不存在')
  const add = (object: Record<string, unknown>, key: string, id: string, owner: string, label: string, color?: ColorProperty) => {
    const value = object[key]
    if (typeof value !== 'string') return
    result.push({ id, owner, target: label, property: key, oldValue: value, newValue: '', color, write(next) { object[key] = next } })
  }
  const rich = (content: FlowTextContent, id: string, owner: string, label: string) => {
    let group: Extract<FlowInline, { type: 'text' }>[] = [], groupIndex = 0
    const flush = () => {
      if (!group.length) return
      const original = group, value = original.map(inline => inline.text).join(''); group = []
      result.push({ id: `${id}/text/${groupIndex++}`, owner, target: label, property: '正文', oldValue: value, newValue: '', write(next, replacement) {
        const start = content.inlines.indexOf(original[0]!)
        if (start < 0) throw new Error('正文目标已变化')
        const atoms = original.flatMap(inline => Array.from(inline.text).map(text => ({ ...inline, text })))
        if (replacement) {
          const offsets: number[] = []
          for (let offset = value.indexOf(replacement.find); offset >= 0; offset = value.indexOf(replacement.find, offset + replacement.find.length)) offsets.push(offset)
          for (const offset of offsets.reverse()) {
            const from = Array.from(value.slice(0, offset)).length, length = Array.from(replacement.find).length
            const source = atoms[from] ?? original[0]!
            atoms.splice(from, length, ...Array.from(replacement.replacement).map(text => ({ ...source, text })))
          }
        } else atoms.splice(0, atoms.length, { ...original[0]!, text: next })
        content.inlines.splice(start, original.length, ...normalizeDocumentText({ inlines: atoms }).inlines)
      } })
    }
    for (const inline of content.inlines) { if (inline.type === 'text') group.push(inline); else flush() }
    flush()
    if (content.inlines.length) result.push({ id: `${id}/color`, owner, target: label, property: '全文颜色', color: 'text', oldValue: [...new Set(content.inlines.map(inline => inline.style?.color).filter(Boolean))].join(' / ') || '默认文字色', newValue: '', write(value) { for (const inline of content.inlines) inline.style = { ...inline.style, color: value } } })
  }
  const visit = (value: unknown, path: string[], owner: string, label: string, style: boolean) => {
    if (!value || typeof value !== 'object') return
    if (documentTextContentSchema.safeParse(value).success) { rich(value as FlowTextContent, path.join('/'), owner, label); return }
    if (Array.isArray(value)) { value.forEach((child, index) => visit(child, [...path, String(index)], owner, label, style)); return }
    const object = value as Record<string, unknown>
    for (const [key, child] of Object.entries(object)) {
      if (key === 'source' || key === 'props' || key === 'metadata' || key.endsWith('Id') || key.endsWith('Ids')) continue
      if (colors[key] && typeof child === 'string') add(object, key, [...path, key].join('/'), owner, label, colors[key])
      else if (!style && textKeys.has(key) && typeof child === 'string') add(object, key, [...path, key].join('/'), owner, label)
      else visit(child, [...path, key], owner, label, style)
    }
  }
  const seen = new Set<string>()
  const instance = (id: string, owner: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const item = document.instances[id]; if (!item) return
    const definition = document.definitions[item.definitionId]
    const label = `${item.name ?? definition?.title ?? item.definitionId} (${id})`
    if (item.locked) unsupported.push(`${owner} · ${label}：对象已锁定`)
    else if ((item.implementationOverride ?? definition?.implementation)?.kind !== 'builtin') unsupported.push(`${owner} · ${label}：自定义组件的数据和源码保留原样`)
    else { visit(item.data, [id, 'data'], owner, label, false); visit(item.style, [id, 'style'], owner, label, true) }
    item.childIds?.forEach(child => instance(child, owner))
  }
  const background = (object: { background?: { mode?: 'inherit' | 'own'; color?: string } }, id: string, owner: string) => {
    result.push({ id: `${id}/background`, owner, target: '背景', property: 'backgroundColor', color: 'background', oldValue: object.background?.color ?? document.background?.color ?? '#ffffff', newValue: '', write(color) { object.background = { ...object.background, mode: 'own', color } } })
  }
  if (scope === 'course') background(document, 'project', '整课')
  for (const surface of document.surfaces) {
    if (scope !== 'course' && surface.id !== target.surfaceId) continue
    surface.childIds.forEach(id => instance(id, surface.title)); background(surface, surface.id, surface.title)
  }
  if (scope !== 'page') for (const id of [...document.global.underlay, ...document.global.overlay]) instance(id, '整课全局')
  return { fields: result, unsupported }
}

export function createProductivityPreview(context: ProductivityContext, request: ProductivityRequest): ProductivityPreview {
  if (request.kind === 'text' && !request.find) throw new Error('请输入查找文字')
  const color = request.kind === 'color' ? context.document.designTokens?.colors.find(token => token.id === request.tokenId)?.color : undefined
  if (request.kind === 'color' && !color) throw new Error('项目颜色已失效，请重新选择')
  const collected = fields(context.document, context.target, request.scope)
  const items = collected.fields.flatMap(field => {
    if (request.kind === 'text' ? field.color || !field.oldValue.includes(request.find) : !field.color || (request.property !== 'all' && field.color !== request.property)) return []
    const newValue = request.kind === 'text' ? field.oldValue.split(request.find).join(request.replacement) : color!
    return newValue === field.oldValue ? [] : [{ id: field.id, target: field.target, owner: field.owner, property: field.property, oldValue: field.oldValue, newValue }]
  })
  return { projectId: context.document.id, revision: context.document.revision, target: context.target, request: { ...request }, items, unsupported: collected.unsupported }
}
export function createTextReplacePreview(context: ProductivityContext, request: Omit<Extract<ProductivityRequest, { kind: 'text' }>, 'kind'>) { return createProductivityPreview(context, { ...request, kind: 'text' }) }
export function createTokenApplyPreview(context: ProductivityContext, request: Omit<Extract<ProductivityRequest, { kind: 'color' }>, 'kind'>) { return createProductivityPreview(context, { ...request, kind: 'color' }) }

export function designProductionStep(context: ProductivityContext, edits: ComponentEdit[]): DesignProductionStep {
  const mapped = presentationComponentEdits(context.target.project, context.target.surfaceId, context.target.activeStateId, edits)
  return { ...captureComponentOperation(context.target.project, mapped), documentId: context.target.documentId, epoch: context.target.epoch, originSurfaceId: context.target.surfaceId }
}
function changedFields(before: unknown, after: unknown, path: string[], write: (path: string[], value: JsonValue) => void): void {
  if (equalComponentValue(before, after)) return
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || documentTextContentSchema.safeParse(after).success
    || Array.isArray(before) !== Array.isArray(after) || Array.isArray(after) && (before as unknown[]).length !== after.length) { write(path, after as JsonValue); return }
  for (const [key, value] of Object.entries(after)) changedFields((before as Record<string, unknown>)[key], value, [...path, key], write)
}

export function applyProductivityPreview(context: ProductivityContext, preview: ProductivityPreview, selectedIds: readonly string[]): ProductivityApplyResult {
  try {
    if (context.target.documentId !== preview.target.documentId || context.target.epoch !== preview.target.epoch || context.target.surfaceId !== preview.target.surfaceId || context.target.activeStateId !== preview.target.activeStateId) throw new Error('预览目标已改变，请重新预览')
    const fresh = createProductivityPreview(context, preview.request)
    if (!equalComponentValue(fresh.items, preview.items)) throw new Error('内容已变化，请重新预览')
    const selected = new Set(selectedIds)
    if (selected.size !== selectedIds.length || selectedIds.some(id => !fresh.items.some(item => item.id === id))) throw new Error('选择项无效，请重新预览')
    if (!selected.size) return { ok: true, step: null }
    const draft = structuredClone(context.document)
    const editable = fields(draft, context.target, preview.request.scope).fields
    fresh.items.filter(item => selected.has(item.id)).forEach(item => editable.find(field => field.id === item.id)!.write(item.newValue, preview.request.kind === 'text' ? preview.request : undefined))
    const edits: ComponentEdit[] = []
    for (const [id, after] of Object.entries(draft.instances)) {
      const before = context.document.instances[id]!
      changedFields(before.data, after.data, [], (path, value) => edits.push({ type: 'data.set', instanceId: id, path, value }))
      if (after.style) changedFields(before.style, after.style, [], (path, value) => edits.push({ type: 'style.set', instanceId: id, path, value }))
    }
    if (!equalComponentValue(context.document.background, draft.background)) edits.push({ type: 'project.background.set', background: draft.background ?? null })
    for (const surface of draft.surfaces) if (!equalComponentValue(context.document.surfaces.find(before => before.id === surface.id)?.background, surface.background)) edits.push({ type: 'surface.background.set', surfaceId: surface.id, background: surface.background ?? null })
    return { ok: true, step: designProductionStep(context, edits) }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '批量修改失败' } }
}
