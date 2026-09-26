import type { CourseProjectDocument, SlidePresentationState } from '../../../shared/courseProjectTypes'
import { locateCourseLayer, type LocatedCourseLayer } from './layerProperties'

/**
 * One native object's authored fields, flattened to what an element card's undo restores one by one (M15): the
 * item's own fields (frame and content one level down, text style one more), its scoped entry (page visibility,
 * plane) and its overrides in each named state of its scene. Keys are JSON arrays of path segments; an absent key is
 * an absent field.
 */
export type ElementFields = Readonly<Record<string, unknown>>

const ITEM_EXPAND = ['frame', 'content', 'content.data', 'content.data.style']
const OVERRIDE_EXPAND = ['frame', 'nativeData', 'nativeData.style', 'componentProps']
const IDENTITY = new Set([['item', 'layerItemId'], ['item', 'kind'], ['item', 'content', 'nativeType']].map(path => JSON.stringify(path)))

function flatten(out: Record<string, unknown>, prefix: readonly string[], value: object, expand: readonly string[], path: readonly string[] = []) {
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue
    const relative = [...path, key]
    if (expand.includes(relative.join('.')) && child !== null && typeof child === 'object' && !Array.isArray(child)) flatten(out, prefix, child, expand, relative)
    else out[JSON.stringify([...prefix, ...relative])] = structuredClone(child)
  }
}

function sceneStates(project: CourseProjectDocument, located: LocatedCourseLayer): SlidePresentationState[] {
  if (located.source !== 'scene') return []
  const surface = project.surfaces.find(item => item.id === located.surfaceId)
  const scene = surface?.type === 'slide' ? surface.scenes.find(item => item.id === located.sceneId) : undefined
  return scene?.presentation?.states ?? []
}

/** The object's fields now, or null when it is gone or is not a native object (components and Runtime are not restored field by field). */
export function readElementFields(project: CourseProjectDocument, itemId: string): ElementFields | null {
  const located = locateCourseLayer(project, itemId)
  if (!located || located.item.kind !== 'native') return null
  const out: Record<string, unknown> = {}
  flatten(out, ['item'], located.item, ITEM_EXPAND)
  for (const key of IDENTITY) delete out[key]
  if (located.scoped) {
    const { item: _item, ...entry } = located.scoped
    flatten(out, ['entry'], entry, [])
  }
  for (const state of sceneStates(project, located)) {
    const override = state.layerItemOverrides[itemId]
    if (override) flatten(out, ['state', state.id], override, OVERRIDE_EXPAND)
  }
  return out
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

/**
 * Writes fields back into a copy of the project: a value sets its field, undefined removes it. The object must
 * still be the native object the fields were read from.
 */
export function writeElementFields(project: CourseProjectDocument, itemId: string, fields: Readonly<Record<string, unknown>>): CourseProjectDocument {
  const next = structuredClone(project)
  const located = locateCourseLayer(next, itemId)
  if (!located || located.item.kind !== 'native') throw new Error('这个对象已不存在。')
  const states = sceneStates(next, located)
  for (const [key, value] of Object.entries(fields)) {
    const [root, ...path] = JSON.parse(key) as string[]
    if (root === 'item' && path.length) setPath(located.item as unknown as Record<string, unknown>, path, value)
    else if (root === 'entry' && path.length && located.scoped) setPath(located.scoped as unknown as Record<string, unknown>, path, value)
    else if (root === 'state' && path.length > 1) {
      const [stateId, ...rest] = path
      const state = states.find(item => item.id === stateId)
      if (!state) { if (value === undefined) continue; throw new Error('对象所在的命名态已不存在。') }
      const overrides = state.layerItemOverrides as Record<string, Record<string, unknown>>
      const override = overrides[itemId] ?? {}
      setPath(override, rest, value)
      if (value === undefined) prune(override, rest)
      if (Object.keys(override).length) overrides[itemId] = override
      else delete overrides[itemId]
    } else throw new Error('无法恢复这项设置。')
  }
  return next
}

const LABELS: Record<string, string> = {
  label: '名称', x: '位置', y: '位置', width: '大小', height: '大小', rotation: '旋转', opacity: '不透明度', visible: '显示',
  locked: '锁定', order: '层级', hitPolicy: '点击设置', playbackInitialVisibility: '播放时的初始显示', paperSpace: '纸面位置',
  visibility: '在哪些页显示', plane: '图层位置', bodyPlane: '图层位置', text: '文字', runs: '文字', color: '文字颜色', fontSize: '字号',
  fontFamily: '字体', bold: '加粗', italic: '斜体', underline: '下划线', strike: '删除线', highlightColor: '高亮', align: '对齐',
  backgroundColor: '底色', assetId: '图片', fit: '显示方式', crop: '裁剪', fill: '填充', stroke: '线条',
}
/** A teacher's name for the fields a unit restores, e.g. "位置" or "命名态中的文字颜色". */
export function elementUnitLabel(unit: readonly string[]): string {
  const path = JSON.parse(unit[0]!) as string[]
  const name = LABELS[path.at(-1)!] ?? '其他设置'
  return path[0] === 'state' ? `命名态中的${name}` : name
}
