import { documentTextLength, sliceDocumentText, type FlowTextContent } from '../../../shared/document/content'
import { isSourceDocumentModel, type DocumentModel } from '../../../shared/workbench/document'
import type { ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import { resolveComponentPresentation, type ComponentPresentationState, type CourseProjectV10, type JsonValue } from '../../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import { isCourseInstanceRange, readCourseInstanceText, readHtmlAuthorField, sliceCourseInstanceText } from '../../tools/ToolTargets'

/** Authored component fields flattened for a card inverse; absent keys are absent fields. */
export type ElementFields = Readonly<Record<string, unknown>>

/** V10 card inverses observe mutable fields; canonical ComponentEdits remain the sole writer. */
export function readComponentElementFields(project: CourseProjectV10, instanceId: string): ElementFields | null {
  return componentElementFields(project, instanceId)
}
/** State frame/visibility are authored slots; data/style retain field-level card inverses. */
export function readComponentStateElementFields(project: CourseProjectV10, surfaceId: string, stateId: string, instanceId: string): ElementFields | null {
  const state = project.surfaces.find(surface => surface.id === surfaceId)?.presentation?.states.find(value => value.id === stateId)
  if (!state) return null
  return componentElementFields(project, instanceId, state, resolveComponentPresentation(project, surfaceId, stateId))
}
function componentElementFields(project: CourseProjectV10, instanceId: string, state?: ComponentPresentationState, effective = project): ElementFields | null {
  const instance = project.instances[instanceId]
  if (!instance) return null
  const fields: Record<string, unknown> = {}
  const add = (value: unknown, path: string[]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) add(child, [...path, key])
    } else if (value !== undefined) fields[JSON.stringify(path)] = structuredClone(value)
  }
  add(effective.instances[instanceId].data, ['data'])
  const effectiveStyle = effective.instances[instanceId].style
  if (effectiveStyle && Object.keys(effectiveStyle).length) add(effectiveStyle, ['style'])
  if (instance.flowLayout) add(instance.flowLayout, ['flowLayout'])
  for (const key of ['name', 'frame', 'implementationOverride', 'childIds', 'visibility', 'flowPlacement'] as const) {
    const value = state && key === 'frame' ? state.overrides[instanceId]?.frame : instance[key]
    if (value !== undefined) fields[JSON.stringify([key])] = structuredClone(value)
  }
  if (state) {
    const override = state.overrides[instanceId]
    if (override?.visible !== undefined) fields['["visible"]'] = override.visible
    for (const root of ['data', 'style'] as const) if (override?.[root] !== undefined) fields[JSON.stringify(['override', root])] = true
  } else fields['["visible"]'] = instance.visible ?? true
  fields['["locked"]'] = instance.locked ?? false
  fields['["playbackInitialVisibility"]'] = instance.playbackInitialVisibility ?? 'inherit'
  fields['["attachments"]'] = structuredClone(instance.attachments ?? [])
  for (const childId of instance.childIds ?? []) {
    const child = componentElementFields(project, childId, state, effective)
    if (child) for (const [key, value] of Object.entries(child)) fields[JSON.stringify(['descendant', childId, ...JSON.parse(key) as string[]])] = value
  }
  return fields
}

/** Exact data/style author slots used only to decide whether an inverse can restore inheritance. */
export function readComponentStateOverrideRoots(project: CourseProjectV10, surfaceId: string, stateId: string, instanceId: string): ElementFields {
  const state = project.surfaces.find(surface => surface.id === surfaceId)?.presentation?.states.find(value => value.id === stateId)
  if (!state || !project.instances[instanceId]) throw new Error('捕获的展示状态或对象已不存在。')
  const roots: Record<string, unknown> = {}
  const visit = (id: string) => {
    for (const root of ['data', 'style'] as const) if (state.overrides[id]?.[root] !== undefined) roots[JSON.stringify([id, root])] = structuredClone(state.overrides[id][root])
    for (const childId of project.instances[id].childIds ?? []) visit(childId)
  }
  visit(instanceId); return roots
}

/** Restore only this card's fields in a copy of the current presentation, preserving every other slot. */
export function restoreComponentStateElementEdits(project: CourseProjectV10, surfaceId: string, stateId: string, instanceId: string,
  fields: ElementFields, inheritRoots: ReadonlySet<string> = new Set()): ComponentEdit[] {
  const original = project.surfaces.find(surface => surface.id === surfaceId)?.presentation
  if (!original?.states.some(value => value.id === stateId)) throw new Error('捕获的展示状态已不存在。')
  const presentation = structuredClone(original), state = presentation.states.find(value => value.id === stateId)!
  const effective = resolveComponentPresentation(project, surfaceId, stateId), edits: ComponentEdit[] = []
  let changed = false
  const visit = (id: string, values: ElementFields) => {
    const instance = project.instances[id]
    if (!instance) throw new Error('这个对象已不存在。')
    const base: Record<string, unknown> = {}, content: Record<string, unknown> = {}, children = new Map<string, Record<string, unknown>>()
    for (const [key, value] of Object.entries(values)) {
      const [root, ...path] = JSON.parse(key) as string[]
      if (root === 'descendant') {
        const childId = path[0]!, child = children.get(childId) ?? {}
        if (!instance.childIds?.includes(childId)) throw new Error('子实例归属已改变，请用编辑器撤销。')
        child[JSON.stringify(path.slice(1))] = value; children.set(childId, child)
      } else if (root === 'frame' || root === 'visible') {
        const override = state.overrides[id] ??= {}
        if (value === undefined) delete override[root]
        else if (root === 'frame') override.frame = structuredClone(value) as NonNullable<ComponentPresentationState['overrides'][string]['frame']> | null
        else override.visible = value as boolean
        changed = true
      } else if (root === 'data' || root === 'style') content[key] = value
      else if (root === 'override') { changed = true }
      else base[key] = value
    }
    edits.push(...restoreComponentElementEdits(project, id, base))
    for (const edit of restoreComponentElementEdits(effective, id, content)) {
      const override = state.overrides[id] ??= {}
      if (edit.type === 'data.set') override.data = edit.value
      else if (edit.type === 'style.set') override.style = edit.value as NonNullable<ComponentPresentationState['overrides'][string]['style']>
      changed = true
    }
    for (const root of ['data', 'style'] as const) if (inheritRoots.has(JSON.stringify([id, root]))) { if (state.overrides[id]) delete state.overrides[id][root]; changed = true }
    if (state.overrides[id] && !Object.keys(state.overrides[id]).length) delete state.overrides[id]
    for (const [childId, child] of children) visit(childId, child)
  }
  visit(instanceId, fields)
  if (changed) edits.push({ type: 'surface.presentation.set', surfaceId, presentation })
  return edits
}

export function restoreComponentElementEdits(project: CourseProjectV10, instanceId: string, fields: ElementFields): ComponentEdit[] {
  const instance = project.instances[instanceId]
  if (!instance) throw new Error('这个对象已不存在。')
  const edits: ComponentEdit[] = [], data = structuredClone(instance.data), style = structuredClone(instance.style ?? {})
  let writeData = false, writeStyle = false
  let nextData = data, nextStyle = style
  let flowLayout: unknown = structuredClone(instance.flowLayout ?? {}), writeFlowLayout = false
  const descendants = new Map<string, Record<string, unknown>>()
  for (const [key, value] of Object.entries(fields)) {
    const [root, ...path] = JSON.parse(key) as string[]
    if (root === 'descendant') {
      const childId = path[0]!, childFields = descendants.get(childId) ?? {}
      if (!instance.childIds?.includes(childId)) throw new Error('子实例归属已改变，请用编辑器撤销。')
      childFields[JSON.stringify(path.slice(1))] = value; descendants.set(childId, childFields)
    } else if (root === 'data' || root === 'style') {
      if (root === 'data') writeData = true; else writeStyle = true
      if (!path.length) {
        if (root === 'data') nextData = structuredClone(value) as JsonValue
        else nextStyle = (structuredClone(value) ?? {}) as typeof style
      } else {
        const target = root === 'data' ? nextData : nextStyle
        if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('原字段结构已改变，请用编辑器撤销。')
        setPath(target as Record<string, unknown>, path, value)
      }
    } else if (root === 'frame') {
      edits.push({ type: 'frame.set', instanceId, frame: value === undefined ? null : value as NonNullable<typeof instance.frame> })
    } else if (root === 'implementationOverride') edits.push({ type: 'implementation.set', instanceId, implementation: value === undefined ? null : value as NonNullable<typeof instance.implementationOverride> })
    else if (root === 'flowPlacement') edits.push({ type: 'instance.flowPlacement.set', instanceId, flowPlacement: value === undefined ? null : value as NonNullable<typeof instance.flowPlacement> })
    else if (root === 'flowLayout') {
      writeFlowLayout = true
      if (!path.length) flowLayout = structuredClone(value)
      else {
        if (!flowLayout || typeof flowLayout !== 'object' || Array.isArray(flowLayout)) throw new Error('原 Flow 排版字段结构已改变，请用编辑器撤销。')
        setPath(flowLayout as Record<string, unknown>, path, value)
        if (value === undefined) prune(flowLayout as Record<string, unknown>, path)
      }
    }
    else if (root === 'visibility') edits.push({ type: 'instance.patch', instanceId, patch: { visibility: value === undefined ? null : value as NonNullable<typeof instance.visibility> } })
    else if (root === 'attachments') edits.push({ type: 'attachments.set', instanceId, attachments: value as NonNullable<typeof instance.attachments> })
    else if (root === 'name') edits.push({ type: 'instance.patch', instanceId, patch: { name: value === undefined ? null : String(value) } })
    else if (root === 'visible' || root === 'locked' || root === 'playbackInitialVisibility') {
      if (value === undefined) throw new Error('原属性已无法确认，请用编辑器撤销。')
      edits.push({ type: 'instance.patch', instanceId, patch: { [root]: value } as Extract<ComponentEdit, { type: 'instance.patch' }>['patch'] })
    } else throw new Error('组件结构修改请用编辑器撤销（Ctrl+Z）。')
  }
  if (writeData) edits.push({ type: 'data.set', instanceId, path: [], value: nextData })
  if (writeStyle) edits.push({ type: 'style.set', instanceId, path: [], value: nextStyle })
  if (writeFlowLayout) edits.push({ type: 'instance.flowLayout.set', instanceId, flowLayout: flowLayout && typeof flowLayout === 'object' && Object.keys(flowLayout).length
    ? flowLayout as NonNullable<typeof instance.flowLayout> : null })
  for (const [childId, values] of descendants) edits.push(...restoreComponentElementEdits(project, childId, values))
  return edits
}

/** Structural equality of JSON values; key order does not matter. */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((value, index) => sameFieldValue(value, (b as unknown[])[index]))
  const left = Object.keys(a).filter(key => (a as Record<string, unknown>)[key] !== undefined)
  const right = Object.keys(b).filter(key => (b as Record<string, unknown>)[key] !== undefined)
  return left.length === right.length && left.every(key => sameFieldValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

/** Text and its runs change together; every other field stands alone. */
function unitOf(key: string): string {
  const path = JSON.parse(key) as string[]
  const last = path.at(-1), parent = path.at(-2)
  return last === 'runs' && (parent === 'data' || parent === 'nativeData') ? JSON.stringify([...path.slice(0, -1), 'text']) : key
}

/** The fields that differ, grouped into the units an undo restores together; each unit lists all its keys. */
export function elementChangeUnits(before: ElementFields, after: ElementFields): string[][] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const changed = new Set(keys.filter(key => !sameFieldValue(before[key], after[key])).map(unitOf))
  const units = new Map<string, string[]>()
  for (const key of keys) {
    const unit = unitOf(key)
    if (changed.has(unit)) units.set(unit, [...units.get(unit) ?? [], key])
  }
  return [...units.values()]
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown) {
  let parent = target
  for (const segment of path.slice(0, -1)) {
    const next = parent[segment]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) parent[segment] = {}
    parent = parent[segment] as Record<string, unknown>
  }
  const leaf = path.at(-1)!
  if (value === undefined) delete parent[leaf]
  else parent[leaf] = structuredClone(value)
}
/** Drops objects a removal left empty, from the deepest up (named-state overrides only). */
function prune(target: Record<string, unknown>, path: readonly string[]) {
  for (let depth = path.length - 1; depth > 0; depth--) {
    let parent: Record<string, unknown> | undefined = target
    for (const segment of path.slice(0, depth - 1)) parent = parent?.[segment] as Record<string, unknown> | undefined
    const key = path[depth - 1]!, child = parent?.[key]
    if (parent && child && typeof child === 'object' && !Array.isArray(child) && !Object.keys(child).length) delete parent[key]
  }
}

const BLOCK_LABELS: Record<string, string> = {
  assetId: '图片或媒体', mediaKind: '媒体类型', altText: '替代文字', caption: '说明文字', layout: '排版', wrap: '环绕', columns: '表头',
  rows: '表格内容', merges: '合并单元格', chart: '图表', height: '高度', latex: '公式', accessibleText: '朗读说明', style: '样式',
  code: '代码', language: '语言', tone: '提示类型', title: '标题', body: '正文', collapsedByDefault: '默认折叠', props: '组件设置',
  component: '组件', staticFallbackAssetId: '静态图', content: '文字', items: '列表项', level: '级别', ordered: '编号',
}
const LABELS: Record<string, string> = {
  data: '内容',
  name: '名称', content: '文字', frame: '位置与大小', implementationOverride: '源码', attachments: '互动', childIds: '组件结构',
  label: '名称', x: '位置', y: '位置', width: '大小', height: '大小', rotation: '旋转', opacity: '不透明度', visible: '显示',
  locked: '锁定', order: '层级', hitPolicy: '点击设置', playbackInitialVisibility: '播放时的初始显示', paperSpace: '纸面位置',
  visibility: '在哪些页显示', plane: '图层位置', bodyPlane: '图层位置', text: '文字', runs: '文字', color: '文字颜色', fontSize: '字号',
  fontFamily: '字体', bold: '加粗', italic: '斜体', underline: '下划线', strike: '删除线', highlightColor: '高亮', align: '对齐',
  backgroundColor: '底色', assetId: '图片', fit: '显示方式', crop: '裁剪', fill: '填充', stroke: '线条',
}
/** A teacher's name for the fields a unit restores, e.g. "位置" or "命名态中的文字颜色". */
export function elementUnitLabel(unit: readonly string[]): string {
  const path = JSON.parse(unit[0]!) as string[]
  if (path[0] === 'block') return BLOCK_LABELS[path[1]!] ?? '内容'
  const name = LABELS[path.at(-1)!] ?? '其他设置'
  return path[0] === 'state' ? `命名态中的${name}` : name
}

/** The source or component text held by the original target, without searching elsewhere. */
export function textTargetContent(model: DocumentModel, target: ExecutionSelectionTarget): string | null {
  if (target.kind === 'text-selection') {
    const values = target.fragments.map(fragment => textTargetContent(model, fragment.target))
    return values.some(value => value === null) ? null : JSON.stringify(values)
  }
  if (target.kind === 'html-author-field') { try { return readHtmlAuthorField(model, target).value } catch { return null } }
  if (target.kind === 'course-instance' && model.kind === 'course-v10') {
    try {
      const content = readCourseInstanceText(model, target)
      if (content === null) return null
      const selected = isCourseInstanceRange(target) ? sliceCourseInstanceText(content, target.from, target.to) : content
      return typeof selected === 'string' ? selected : JSON.stringify(selected)
    } catch { return null }
  }
  if (target.kind === 'markdown-range') return isSourceDocumentModel(model) && target.to <= model.source.length ? model.source.slice(target.from, target.to) : null
  return null
}
/** Where a range of Markdown source is after a change inside it; null when the text around it changed too. */
export function traceSourceRange(before: string, after: string, from: number, to: number): { from: number; to: number } | null {
  const end = to + after.length - before.length
  return end >= from && before.slice(0, from) === after.slice(0, from) && before.slice(to) === after.slice(end) ? { from, to: end } : null
}
/** Where a range of a Flow text slot is after a change inside it; null when the text around it changed too. */
export function traceFlowRange(before: FlowTextContent, after: FlowTextContent, from: number, to: number): { from: number; to: number } | null {
  const length = documentTextLength(before), next = documentTextLength(after), end = to + next - length
  const same = (a: FlowTextContent, b: FlowTextContent) => JSON.stringify(a) === JSON.stringify(b)
  return end >= from && same(sliceDocumentText(before, 0, from), sliceDocumentText(after, 0, from))
    && same(sliceDocumentText(before, to, length), sliceDocumentText(after, end, next)) ? { from, to: end } : null
}
