import { documentTextContentSchema, normalizeDocumentText, type FlowInline, type FlowTextContent } from '../../shared/document/content'
import type { CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { equalComponentValue } from '../drivers/courseV10Operations'
import { duplicateSurfaceEdits } from './courseSurfaceStructure'
import { planTextRunRemap } from '../../shared/textRuns'
import type { TextRun } from '../../shared/contracts/native-v1/types'

export type ProductivityScope = 'page' | 'surface' | 'course'
export type ColorProperty = 'text' | 'fill' | 'stroke' | 'background' | 'all'
export type ProductivityRequest = { kind: 'text'; scope: ProductivityScope; find: string; replacement: string } | { kind: 'color'; scope: ProductivityScope; tokenId: string; property: ColorProperty }
export interface ProductivityPreviewItem { id: string; target: string; owner: string; property: string; oldValue: string; newValue: string }
export interface CourseProductivityPreview { projectId: string; revision: number; surfaceId: string | null; request: ProductivityRequest; items: ProductivityPreviewItem[]; unsupported: string[] }
type Field = ProductivityPreviewItem & { color?: ColorProperty; write(value: string, replacement?: { find: string; replacement: string }): void }
const colors: Record<string, ColorProperty> = { color: 'text', textColor: 'text', fill: 'fill', fillColor: 'fill', borderColor: 'stroke', stroke: 'stroke', strokeColor: 'stroke', backgroundColor: 'background', highlightColor: 'background' }
const textKeys = new Set(['text', 'title', 'label', 'name', 'placeholder', 'altText', 'caption', 'citation', 'body', 'header'])

function fields(document: CourseProjectV10, target: { surfaceId: string | null }, scope: ProductivityScope) {
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

export function createCourseProductivityPreview(project: CourseProjectV10, surfaceId: string | null, request: ProductivityRequest): CourseProductivityPreview {
  const context = { document: project, target: { surfaceId } }
  if (request.kind === 'text' && !request.find) throw new Error('请输入查找文字')
  const color = request.kind === 'color' ? context.document.designTokens?.colors.find(token => token.id === request.tokenId)?.color : undefined
  if (request.kind === 'color' && !color) throw new Error('项目颜色已失效，请重新选择')
  const collected = fields(context.document, context.target, request.scope)
  const items = collected.fields.flatMap(field => {
    if (request.kind === 'text' ? field.color || !field.oldValue.includes(request.find) : !field.color || (request.property !== 'all' && field.color !== request.property)) return []
    const newValue = request.kind === 'text' ? field.oldValue.split(request.find).join(request.replacement) : color!
    return newValue === field.oldValue ? [] : [{ id: field.id, target: field.target, owner: field.owner, property: field.property, oldValue: field.oldValue, newValue }]
  })
  return { projectId: context.document.id, revision: context.document.revision, surfaceId, request: { ...request }, items, unsupported: collected.unsupported }
}
function changedFields(before: unknown, after: unknown, path: string[], write: (path: string[], value: JsonValue) => void): void {
  if (equalComponentValue(before, after)) return
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || documentTextContentSchema.safeParse(after).success
    || Array.isArray(before) !== Array.isArray(after) || Array.isArray(after) && (before as unknown[]).length !== after.length) { write(path, after as JsonValue); return }
  for (const [key, value] of Object.entries(after)) changedFields((before as Record<string, unknown>)[key], value, [...path, key], write)
}

/** Scan and assemble formal edits for both the human preview and public intent entry. */
export function planCourseProductivityEdits(project: CourseProjectV10, surfaceId: string | null, request: ProductivityRequest, options: { selectedIds?: readonly string[] } = {}) {
  const fresh = createCourseProductivityPreview(project, surfaceId, request)
  const selectedIds = options.selectedIds ?? fresh.items.map(item => item.id)
  const selected = new Set(selectedIds)
  if (selected.size !== selectedIds.length || selectedIds.some(id => !fresh.items.some(item => item.id === id))) throw new Error('选择项无效，请重新预览')
  const draft = structuredClone(project)
  const editable = fields(draft, { surfaceId }, request.scope).fields
  fresh.items.filter(item => selected.has(item.id)).forEach(item => editable.find(field => field.id === item.id)!.write(item.newValue, request.kind === 'text' ? request : undefined))
  const edits: ComponentEdit[] = []
  for (const [id, after] of Object.entries(draft.instances)) {
    const before = project.instances[id]!
    changedFields(before.data, after.data, [], (path, value) => edits.push({ type: 'data.set', instanceId: id, path, value }))
    if (after.style) changedFields(before.style, after.style, [], (path, value) => edits.push({ type: 'style.set', instanceId: id, path, value }))
  }
  if (!equalComponentValue(project.background, draft.background)) edits.push({ type: 'project.background.set', background: draft.background ?? null })
  for (const surface of draft.surfaces) if (!equalComponentValue(project.surfaces.find(before => before.id === surface.id)?.background, surface.background)) edits.push({ type: 'surface.background.set', surfaceId: surface.id, background: surface.background ?? null })
  return { edits, items: fresh.items.filter(item => selected.has(item.id)), unsupported: fresh.unsupported }
}

export interface RemixSlot { id: string; instanceId: string; dataPath: string[]; label: string; original: string; replacement: string; capacity: string; issue?: string }
export interface CourseStyleRemixPreview { projectId: string; revision: number; sourceSceneId: string; sourceLabel: string; slots: RemixSlot[]; issues: string[] }
function referenceSurface(project: CourseProjectV10, surfaceId: string) {
  const surface = project.surfaces.find(value => value.kind === 'slide' && value.id === surfaceId)
  if (!surface) throw new Error('参考页不存在，请重新选择')
  return surface
}
/** Reference clone is the formal surface copy use case, including its prepared identity map. */
export function prepareCourseReferenceClone(project: CourseProjectV10, sourceSurfaceId: string, createId?: () => string) {
  const source = referenceSurface(project, sourceSurfaceId)
  const plan = duplicateSurfaceEdits(project, sourceSurfaceId, createId)
  const insertion = plan.edits.find(edit => edit.type === 'surface.insert')!
  if (insertion.type !== 'surface.insert') throw new Error('缺少复制页面')
  const instances = plan.edits.flatMap(edit => edit.type === 'instance.insert' ? edit.instances : [])
  return { source, surface: insertion.surface, instances, ids: plan.ids, edits: plan.edits }
}
export function replaceCourseRemixText(content: FlowTextContent, text: string): FlowTextContent {
  if (content.inlines.some(inline => inline.type !== 'text')) throw new Error('公式与文字混排请在原文选区中编辑')
  let offset = 0
  const runs: TextRun[] = content.inlines.map(inline => {
    const value = inline.type === 'text' ? inline.text : '', start = offset; offset += Array.from(value).length
    return { start, end: offset, style: { ...inline.style } }
  })
  const mapped = planTextRunRemap(content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join(''), text, runs)
  if (!mapped.ok) throw new Error(mapped.reason)
  const atoms = content.inlines.flatMap(inline => inline.type === 'text' ? Array.from(inline.text).map(text => ({ ...inline, text })) : [])
  for (const edit of [...mapped.edits].reverse()) {
    const source = atoms[edit.start] ?? atoms[edit.start - 1] ?? { type: 'text' as const, text: '' }
    atoms.splice(edit.start, edit.end - edit.start, ...Array.from(edit.replacement).map(text => ({ ...source, text })))
  }
  return normalizeDocumentText({ inlines: atoms })
}

export function previewCourseStyleRemix(project: CourseProjectV10, sourceSceneId: string, replacements: Readonly<Record<string, string>>): CourseStyleRemixPreview {
  const surface = referenceSurface(project, sourceSceneId), slots: RemixSlot[] = [], issues: string[] = []
  const visit = (instanceId: string, value: unknown, dataPath: string[]) => {
    if (!value || typeof value !== 'object') return
    const parsed = documentTextContentSchema.safeParse(value)
    if (parsed.success) {
      const item = project.instances[instanceId]!, id = `${instanceId}:${JSON.stringify(dataPath)}`
      if (parsed.data.inlines.some(inline => inline.type !== 'text')) { issues.push(`${item.name ?? instanceId}：保留公式混排，请在原页局部精修`); return }
      const original = parsed.data.inlines.map(inline => inline.type === 'text' ? inline.text : '').join(''), replacement = replacements[id] ?? ''
      let issue = replacement.trim() ? undefined : '请填写此槽位'
      if (!issue) try { replaceCourseRemixText(parsed.data, replacement) } catch (error) { issue = error instanceof Error ? error.message : '无法保留文字格式' }
      const frame = item.frame
      slots.push({ id, instanceId, dataPath, label: item.name ?? project.definitions[item.definitionId]?.title ?? instanceId, original, replacement,
        capacity: frame ? `${frame.width} × ${frame.height}，保持原框` : '保持原排版', ...(issue ? { issue } : {}) })
      return
    }
    if (Array.isArray(value)) value.forEach((child, index) => visit(instanceId, child, [...dataPath, String(index)]))
    else for (const [key, child] of Object.entries(value)) if (!['source', 'props', 'metadata'].includes(key)) visit(instanceId, child, [...dataPath, key])
  }
  const instance = (id: string) => {
    const item = project.instances[id]!
    const implementation = item.implementationOverride ?? project.definitions[item.definitionId]?.implementation
    if (!item.locked && implementation?.kind === 'builtin') visit(id, item.data, [])
    item.childIds?.forEach(instance)
  }
  surface.childIds.forEach(instance)
  if (!slots.length) issues.push('参考页没有可直接替换的正式文字槽位')
  for (const id of Object.keys(replacements)) if (!slots.some(slot => slot.id === id)) throw new Error(`槽位 ${id} 已不存在`)
  return { projectId: project.id, revision: project.revision, sourceSceneId, sourceLabel: surface.title, slots, issues }
}


/** Return observed slots; authoring chooses prose, while software owns all paths and copy identities. */
export function inspectCourseRemixSlots(project: CourseProjectV10, sourceSurfaceId: string) {
  const preview = previewCourseStyleRemix(project, sourceSurfaceId, {})
  return { ...preview, slots: preview.slots.map(slot => {
    if (slot.issue !== '请填写此槽位') return slot
    const { issue: _formIssue, ...observed } = slot
    return observed
  }) }
}
/** A public partial intent changes only supplied observed slots; an explicit empty string clears text. */
export function planCourseStyleRemixEdits(project: CourseProjectV10, sourceSurfaceId: string, replacements: Readonly<Record<string, string>>, createId?: () => string) {
  const checked = previewCourseStyleRemix(project, sourceSurfaceId, replacements)
  if (!checked.slots.length) throw new Error('没有可替换的文字槽位')
  const clone = prepareCourseReferenceClone(project, sourceSurfaceId, createId)
  clone.surface.title = `${clone.source.title} 改写`
  for (const slot of checked.slots.filter(slot => Object.hasOwn(replacements, slot.id))) {
    const item = clone.instances.find(instance => instance.id === clone.ids.get(slot.instanceId))!
    let value: unknown = item.data
    for (const part of slot.dataPath) value = (value as Record<string, unknown>)[part]
    const replacement = replaceCourseRemixText(documentTextContentSchema.parse(value), slot.replacement)
    if (!slot.dataPath.length) item.data = replacement as unknown as JsonValue
    else {
      let parent = item.data as Record<string, unknown>
      for (const part of slot.dataPath.slice(0, -1)) parent = parent[part] as Record<string, unknown>
      parent[slot.dataPath.at(-1)!] = replacement
    }
  }
  return { edits: clone.edits, createdSurfaceId: clone.surface.id, instanceIds: clone.ids }
}
