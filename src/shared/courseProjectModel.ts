import type {
  NativeRenderableBase,
  NativeRenderableNode,
  TextRun,
} from './contracts/native-v1'
import { compareStableStrings } from './stableOrder'
import { makeAuthoringAddress } from './authoringAddress'
import {
  compareCourseLayerItems,
  composeCourseProjectLocation,
} from './courseLayerComposition'
import {
  type CourseProjectDocument,
  type FlowBlock,
  type FlowTableCell,
  type LayerItem,
  type LayerItemBase,
  type NativeElementContent,
  type ScopedLayerItem,
} from './courseProjectTypes'

export {
  collectCourseProjectReferences,
  visitCourseProject,
  visitCourseProjectReferences,
} from './contracts/course-project-v9/references'
export type {
  CourseProjectPath,
  CourseProjectReference,
  CourseProjectReferenceKind,
  CourseProjectVisitor,
} from './contracts/course-project-v9/references'

/** Absent Spatial/Flow `backgroundColor` is white. Slide scenes keep their own required field. */
export const DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR = '#ffffff'

export function resolveCourseSurfaceBackgroundColor(
  backgroundColor: string | undefined,
): string {
  return backgroundColor ?? DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR
}

export type AuthoringInventoryValueKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'asset'
  | 'formula'
  | 'object'
  | 'array'

/**
 * Derived only: never persisted and never carries the current value. The
 * stable path is ID-based; jsonPointer is a disposable projection for the
 * current revision and must be regenerated after structural edits.
 */
export interface DerivedAuthoringInventoryEntry {
  stablePath: string
  jsonPointer: string
  valueKind: AuthoringInventoryValueKind
  label: string
}

export type DerivedAuthoringInventory = Readonly<
  Record<string, Readonly<DerivedAuthoringInventoryEntry>>
>

export interface DerivedAuthoringInventorySnapshot {
  projectId: string
  revision: number
  entries: DerivedAuthoringInventory
}

export function isCanonicalLayerOrder(
  items: ReadonlyArray<Pick<LayerItemBase, 'layerItemId' | 'order'>>,
): boolean {
  const ids = new Set<string>()
  let previousOrder = -1
  return items.every((item) => {
    if (ids.has(item.layerItemId) || item.order <= previousOrder) return false
    ids.add(item.layerItemId)
    previousOrder = item.order
    return true
  })
}

/** Returns a new stable back-to-front view; it never mutates authoring data. */
export function getEffectiveLayerOrder<T extends Pick<LayerItemBase, 'layerItemId' | 'order'>>(
  items: ReadonlyArray<T>,
): T[] {
  return [...items].sort(compareCourseLayerItems)
}

export function getEffectiveScopedLayerOrder<T extends ScopedLayerItem>(
  items: ReadonlyArray<T>,
): T[] {
  return [...items].sort((left, right) => compareCourseLayerItems(left.item, right.item))
}

export interface EffectiveCourseLayerItem {
  item: LayerItem
  source: 'global' | 'surface' | 'scene' | 'world'
}

export function isCourseLayerVisibleAtLocation(
  entry: ScopedLayerItem,
  locationId: string,
): boolean {
  if (entry.visibility.mode === 'all') return true
  const listed = entry.visibility.locationIds.includes(locationId)
  return entry.visibility.mode === 'include' ? listed : !listed
}

/** The one back-to-front layer fact consumed by editor, Player, hit and export. */
export function getEffectiveCourseLayerOrder(input: {
  project: CourseProjectDocument
  surfaceId: string
  locationId: string
}): EffectiveCourseLayerItem[] {
  const surface = input.project.surfaces.find((candidate) => candidate.id === input.surfaceId)
  if (!surface) throw new Error(`Unknown course surface: ${input.surfaceId}`)
  const location = input.project.locations.find((candidate) => candidate.id === input.locationId)
  if (!location || location.surfaceId !== surface.id) {
    throw new Error(`Location ${input.locationId} does not belong to surface ${surface.id}`)
  }
  return composeCourseProjectLocation({
    project: input.project,
    locationId: location.id,
    stateId: null,
  }).entries
    .filter((entry) => entry.applicable)
    .map(({ item, source }) => ({ item, source }))
}

export function reindexLayerItems<T extends LayerItem>(items: ReadonlyArray<T>): T[] {
  return getEffectiveLayerOrder(items).map((item, order) => ({ ...item, order }))
}

/**
 * Same-version Flow rich-text fallback.
 * `TextRun` is a style range over `text`, not a glyph carrier, so missing
 * `text` cannot be recovered from runs and becomes `''`. Missing `runs` become
 * one empty-style span covering the whole plain string (or `[]` if empty).
 */
export function normalizeFlowRichText(input: {
  text?: string
  runs?: ReadonlyArray<TextRun>
}): { text: string; runs: TextRun[] } {
  const text = input.text ?? ''
  if (!input.runs) {
    const characterCount = Array.from(text).length
    return {
      text,
      runs: characterCount === 0 ? [] : [{ start: 0, end: characterCount, style: {} }],
    }
  }
  return { text, runs: structuredClone(input.runs) as TextRun[] }
}

export function decodeFlowTableCell(cell: FlowTableCell): { text: string; runs: TextRun[] } {
  return typeof cell === 'string'
    ? normalizeFlowRichText({ text: cell })
    : normalizeFlowRichText(cell)
}

export function flowPlainTextFallback(content: {
  text?: string
  runs?: ReadonlyArray<TextRun>
}): string {
  return normalizeFlowRichText(content).text
}

export function flowRunsFallback(content: {
  text?: string
  runs?: ReadonlyArray<TextRun>
}): TextRun[] {
  return normalizeFlowRichText(content).runs
}

const baseNodeKeys = new Set([
  'id',
  'name',
  'type',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'playbackInitialVisibility',
])

export interface ComponentLayerSourceNode extends Omit<NativeRenderableBase, 'type'> {
  type: 'external-component'
  component: {
    packageId: string
    version: string
  }
  props: Record<string, unknown>
}

export type CourseLayerSourceNode = NativeRenderableNode | ComponentLayerSourceNode

function nodeBase(node: CourseLayerSourceNode, order: number): LayerItemBase {
  return {
    layerItemId: node.id,
    label: node.name,
    frame: {
      mode: 'absolute',
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    },
    order,
    visible: node.visible,
    locked: node.locked,
    rotation: node.rotation,
    opacity: node.opacity,
    hitPolicy: 'auto',
    playbackInitialVisibility: node.playbackInitialVisibility,
  }
}

function nodeData(node: NativeRenderableNode): NativeElementContent {
  const data = Object.fromEntries(
    Object.entries(node).filter(([key]) => !baseNodeKeys.has(key)),
  )
  return {
    nativeType: node.type,
    data,
  } as NativeElementContent
}

/**
 * Converts one editor-native node into the canonical Course Project layer
 * representation. This is a neutral shape conversion: callers do not need to
 * construct a legacy project merely to create a V9 layer item.
 */
export function sceneNodeToCourseLayerItem(
  node: CourseLayerSourceNode,
  order = 0,
): LayerItem {
  const base = nodeBase(node, order)
  if (node.type === 'external-component') {
    return {
      ...base,
      kind: 'component',
      component: structuredClone(node.component),
      props: structuredClone(node.props),
    }
  }
  return {
    ...base,
    kind: 'native',
    content: nodeData(node),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonPointerEscape(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function inventoryKind(value: unknown, semantic?: 'asset' | 'formula'): AuthoringInventoryValueKind {
  if (semantic) return semantic
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

interface InventoryTargetContext {
  scope: 'global' | 'surface' | 'scene'
  surfaceId?: string
  sceneId?: string
  carrier: LayerItem['kind']
  layerItemId: string
  stablePrefix: string
  jsonPointer: string
}

interface LayerInventoryTargetContext extends InventoryTargetContext {
  item: LayerItem
}

function addInventoryEntry(
  project: CourseProjectDocument,
  inventory: Record<string, DerivedAuthoringInventoryEntry>,
  target: InventoryTargetContext,
  field: string,
  label: string,
  value: unknown,
  semantic?: 'asset' | 'formula',
  pointerSegments?: ReadonlyArray<string | number>,
): void {
  const address = makeAuthoringAddress({
    projectId: project.id,
    scope: target.scope,
    surfaceId: target.surfaceId,
    sceneId: target.sceneId,
    carrier: target.carrier,
    layerItemId: target.layerItemId,
    field,
  })
  const pointerSuffix = (pointerSegments ?? field.split('.'))
    .map(String)
    .map(jsonPointerEscape)
    .join('/')
  inventory[address] = {
    stablePath: `${target.stablePrefix}/${field}`,
    jsonPointer: `${target.jsonPointer}/${pointerSuffix}`,
    valueKind: inventoryKind(value, semantic),
    label,
  }
}

function visitLeafValues(
  value: unknown,
  prefix: ReadonlyArray<string | number>,
  visit: (path: ReadonlyArray<string | number>, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => visitLeafValues(child, [...prefix, index], visit))
    return
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, child]) => {
      visitLeafValues(child, [...prefix, key], visit)
    })
    return
  }
  visit(prefix, value)
}

function deriveLayerInventory(
  project: CourseProjectDocument,
  inventory: Record<string, DerivedAuthoringInventoryEntry>,
  target: LayerInventoryTargetContext,
): void {
  ;([
    ['label', '图层名称'],
    ['frame.x', '水平位置'],
    ['frame.y', '垂直位置'],
    ['frame.width', '宽度'],
    ['frame.height', '高度'],
    ['rotation', '旋转'],
    ['opacity', '不透明度'],
    ['visible', '可见性'],
  ] as const).forEach(([field, label]) => {
    const value = field.startsWith('frame.')
      ? target.item.frame[field.slice(6) as keyof LayerItem['frame']]
      : target.item[field as keyof LayerItem]
    addInventoryEntry(project, inventory, target, field, label, value)
  })

  if (target.item.kind === 'runtime') {
    Object.entries(target.item.runtime.content.values).forEach(([key, value]) => {
      const metadata = target.item.kind === 'runtime'
        ? target.item.runtime.content.metadata?.[key]
        : undefined
      addInventoryEntry(
        project,
        inventory,
        target,
        `runtime/content/values/${jsonPointerEscape(key)}`,
        metadata?.label ?? key,
        value,
        undefined,
        ['runtime', 'content', 'values', key],
      )
    })
    Object.entries(target.item.runtime.assets).forEach(([key, binding]) => {
      addInventoryEntry(
        project,
        inventory,
        target,
        `runtime/assets/${jsonPointerEscape(key)}/assetId`,
        key,
        binding.assetId,
        'asset',
        ['runtime', 'assets', key, 'assetId'],
      )
    })
    return
  }
  if (target.item.kind === 'component') {
    visitLeafValues(target.item.props, ['props'], (segments, value) => {
      const field = segments.map(String).map(jsonPointerEscape).join('/')
      addInventoryEntry(project, inventory, target, field, segments.slice(1).join('.'), value, undefined, segments)
    })
    return
  }

  const content = target.item.content
  if (content.nativeType === 'text') {
    addInventoryEntry(project, inventory, target, 'content.data.text', '文字', content.data.text)
  } else if (content.nativeType === 'formula') {
    addInventoryEntry(project, inventory, target, 'content.data.accessibleText', '公式说明', content.data.accessibleText)
    addInventoryEntry(project, inventory, target, 'content.data.ast', '公式', content.data.ast, 'formula')
  } else if (content.nativeType === 'image') {
    addInventoryEntry(project, inventory, target, 'content.data.assetId', '图片', content.data.assetId, 'asset')
  } else if (content.nativeType === 'video') {
    addInventoryEntry(project, inventory, target, 'content.data.assetId', '视频', content.data.assetId, 'asset')
    if (content.data.poster.assetId) {
      addInventoryEntry(project, inventory, target, 'content.data.poster.assetId', '视频封面', content.data.poster.assetId, 'asset')
    }
  } else if (content.nativeType === 'teacher-controller') {
    addInventoryEntry(project, inventory, target, 'content.data.title', '教师控制器标题', content.data.title)
    content.data.buttons.forEach((button, index) => {
      addInventoryEntry(project, inventory, target, `content.data.buttons.${index}.label`, `按钮：${button.id}`, button.label)
    })
  } else if (content.nativeType === 'table') {
    content.data.rows.forEach((row, rIdx) => {
      row.cells.forEach((cell, cIdx) => {
        addInventoryEntry(project, inventory, target, `content.data.rows.${rIdx}.cells.${cIdx}.text`, `单元格：${cell.id}`, cell.text)
      })
    })
  } else if (content.nativeType === 'chart') {
    addInventoryEntry(project, inventory, target, 'content.data.title', '图表标题', content.data.title)
    content.data.categories.forEach((cat, index) => {
      addInventoryEntry(project, inventory, target, `content.data.categories.${index}.label`, `分类：${cat.id}`, cat.label)
    })
    content.data.series.forEach((s, index) => {
      addInventoryEntry(project, inventory, target, `content.data.series.${index}.name`, `系列：${s.id}`, s.name)
    })
  } else {
    visitLeafValues(content.data.style, ['content', 'data', 'style'], (segments, value) => {
      const field = segments.map(String).map(jsonPointerEscape).join('/')
      addInventoryEntry(project, inventory, target, field, segments.slice(3).join('.'), value, undefined, segments)
    })
  }
}

/**
 * Rebuilds the complete authoring inventory from Project V9. Nothing returned
 * here is persisted; callers must discard it when `project.revision` changes.
 */
export function deriveCourseProjectAuthoringInventory(
  project: CourseProjectDocument,
): DerivedAuthoringInventory {
  const inventory: Record<string, DerivedAuthoringInventoryEntry> = {}
  project.globalLayerItems.forEach((entry, index) => {
    deriveLayerInventory(project, inventory, {
      scope: 'global',
      item: entry.item,
      carrier: entry.item.kind,
      layerItemId: entry.item.layerItemId,
      stablePrefix: `global/layer:${entry.item.layerItemId}`,
      jsonPointer: `/globalLayerItems/${index}/item`,
    })
  })
  project.surfaces.forEach((surface, surfaceIndex) => {
    surface.surfaceLayerItems.forEach((entry, itemIndex) => {
      deriveLayerInventory(project, inventory, {
        scope: 'surface',
        surfaceId: surface.id,
        item: entry.item,
        carrier: entry.item.kind,
        layerItemId: entry.item.layerItemId,
        stablePrefix: `surface:${surface.id}/layer:${entry.item.layerItemId}`,
        jsonPointer: `/surfaces/${surfaceIndex}/surfaceLayerItems/${itemIndex}/item`,
      })
    })
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene, sceneIndex) => {
        scene.layerItems.forEach((item, itemIndex) => {
          deriveLayerInventory(project, inventory, {
            scope: 'scene',
            surfaceId: surface.id,
            sceneId: scene.id,
            item,
            carrier: item.kind,
            layerItemId: item.layerItemId,
            stablePrefix: `surface:${surface.id}/scene:${scene.id}/layer:${item.layerItemId}`,
            jsonPointer: `/surfaces/${surfaceIndex}/scenes/${sceneIndex}/layerItems/${itemIndex}`,
          })
        })
      })
    } else if (surface.type === 'flow') {
      const walk = (blocks: FlowBlock[], indices: number[]): void => {
        blocks.forEach((block, index) => {
          const nextIndices = [...indices, index]
          const pointerParts: Array<string | number> = ['surfaces', surfaceIndex, 'blocks']
          nextIndices.forEach((part, partIndex) => {
            pointerParts.push(part)
            if (partIndex < nextIndices.length - 1) pointerParts.push('blocks')
          })
          const pointer = `/${pointerParts.map(String).map(jsonPointerEscape).join('/')}`
          const target: InventoryTargetContext = {
            scope: 'surface', surfaceId: surface.id,
            carrier: block.type === 'component' ? 'component' : 'native',
            layerItemId: block.id,
            stablePrefix: `surface:${surface.id}/block:${block.id}`,
            jsonPointer: pointer,
          }
          if ('text' in block && typeof block.text === 'string') {
            addInventoryEntry(project, inventory, target, 'text', block.type, block.text)
          }
          if (block.type === 'quote' && block.citation !== undefined) {
            addInventoryEntry(project, inventory, target, 'citation', '引用出处', block.citation)
          } else if (block.type === 'list') {
            block.items.forEach((item, itemIndex) => {
              addInventoryEntry(
                project, inventory, target, `items/${jsonPointerEscape(item.id)}/text`,
                `列表项：${item.id}`, item.text, undefined, ['items', itemIndex, 'text'],
              )
            })
          } else if (block.type === 'media') {
            addInventoryEntry(project, inventory, target, 'assetId', '媒体', block.assetId, 'asset')
            if (block.altText !== undefined) addInventoryEntry(project, inventory, target, 'altText', '替代文本', block.altText)
            if (block.caption !== undefined) addInventoryEntry(project, inventory, target, 'caption', '图注', block.caption)
          } else if (block.type === 'table') {
            block.columns.forEach((column, columnIndex) => {
              addInventoryEntry(
                project, inventory, target, `columns/${jsonPointerEscape(column.id)}/header`,
                `列标题：${column.id}`, column.header, undefined, ['columns', columnIndex, 'header'],
              )
            })
            block.rows.forEach((row, rowIndex) => {
              block.columns.forEach((column) => {
                addInventoryEntry(
                  project, inventory, target,
                  `rows/${jsonPointerEscape(row.id)}/cells/${jsonPointerEscape(column.id)}`,
                  `表格：${row.id}/${column.id}`, row.cells[column.id] ?? '', undefined,
                  ['rows', rowIndex, 'cells', column.id],
                )
              })
            })
          } else if (block.type === 'formula') {
            addInventoryEntry(project, inventory, target, 'accessibleText', '公式说明', block.accessibleText)
            addInventoryEntry(project, inventory, target, 'ast', '公式', block.ast, 'formula')
          } else if (block.type === 'code') {
            addInventoryEntry(project, inventory, target, 'code', '代码', block.code)
          } else if (block.type === 'callout') {
            addInventoryEntry(project, inventory, target, 'body', '提示内容', block.body)
            if (block.title !== undefined) addInventoryEntry(project, inventory, target, 'title', '提示标题', block.title)
          } else if (block.type === 'section') {
            addInventoryEntry(project, inventory, target, 'title', '章节标题', block.title)
            walk(block.blocks, nextIndices)
          } else if (block.type === 'component') {
            visitLeafValues(block.props, ['props'], (segments, value) => {
              const field = segments.map(String).map(jsonPointerEscape).join('/')
              addInventoryEntry(project, inventory, target, field, segments.slice(1).join('.'), value, undefined, segments)
            })
            addInventoryEntry(project, inventory, target, 'staticFallbackAssetId', '静态后备', block.staticFallbackAssetId, 'asset')
          }
        })
      }
      walk(surface.blocks, [])
    } else {
      surface.world.layerItems.forEach((item, itemIndex) => {
        deriveLayerInventory(project, inventory, {
          scope: 'surface',
          surfaceId: surface.id,
          item,
          carrier: item.kind,
          layerItemId: item.layerItemId,
          stablePrefix: `surface:${surface.id}/layer:${item.layerItemId}`,
          jsonPointer: `/surfaces/${surfaceIndex}/world/layerItems/${itemIndex}`,
        })
      })
    }
  })
  return Object.freeze(Object.fromEntries(
    Object.entries(inventory)
      .sort(([left], [right]) => compareStableStrings(left, right))
      .map(([address, entry]) => [address, Object.freeze(entry)]),
  ))
}

export function deriveCourseProjectAuthoringInventorySnapshot(
  project: CourseProjectDocument,
): Readonly<DerivedAuthoringInventorySnapshot> {
  return Object.freeze({
    projectId: project.id,
    revision: project.revision,
    entries: deriveCourseProjectAuthoringInventory(project),
  })
}
