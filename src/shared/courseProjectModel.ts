import { projectDocumentSchema } from './projectSchema'
import type {
  InteractionRule,
} from './interactionTypes'
import type {
  EmbeddedComponentPackageMeta,
  GlobalLayerVisibility,
  ProjectDocument,
  SceneNode,
  SceneNodeOverride,
  TextRun,
} from './projectTypes'
import { compareStableStrings } from './stableOrder'
import { makeAuthoringAddress } from './authoringAddress'
import {
  compareCourseLayerItems,
  composeCourseProjectLocation,
} from './courseLayerComposition'
import { courseProjectDocumentSchema } from './courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseLocation,
  type CourseProjectDocument,
  type CourseSurfaceDocument,
  type FlowBlock,
  type FlowTableCell,
  type LayerItem,
  type LayerItemBase,
  type LayerItemOverride,
  type NativeElementContent,
  type ScopedLayerItem,
  type SlidePresentation,
  type SlideSceneDocument,
} from './courseProjectTypes'

/** Absent Spatial/Flow `backgroundColor` is white. Slide scenes keep their own required field. */
export const DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR = '#ffffff'

export function resolveCourseSurfaceBackgroundColor(
  backgroundColor: string | undefined,
): string {
  return backgroundColor ?? DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR
}

export type CourseProjectPath = ReadonlyArray<string | number>

export interface CourseProjectVisitor {
  surface?(surface: CourseSurfaceDocument, path: CourseProjectPath): void
  scene?(scene: SlideSceneDocument, path: CourseProjectPath): void
  block?(block: FlowBlock, path: CourseProjectPath): void
  layerItem?(item: LayerItem, path: CourseProjectPath): void
  location?(location: CourseLocation, path: CourseProjectPath): void
}

export type CourseProjectReferenceKind =
  | 'asset'
  | 'component'
  | 'surface'
  | 'scene'
  | 'block'
  | 'camera-frame'
  | 'layer-item'
  | 'location'
  | 'course-state'
  | 'presentation-state'
  | 'sound'

export interface CourseProjectReference {
  kind: CourseProjectReferenceKind
  id: string
  path: CourseProjectPath
  version?: string
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

function walkBlocks(
  blocks: ReadonlyArray<FlowBlock>,
  path: CourseProjectPath,
  visitor: CourseProjectVisitor,
): void {
  blocks.forEach((block, index) => {
    const blockPath = [...path, index]
    visitor.block?.(block, blockPath)
    if (block.type === 'section') walkBlocks(block.blocks, [...blockPath, 'blocks'], visitor)
  })
}

export function visitCourseProject(
  project: CourseProjectDocument,
  visitor: CourseProjectVisitor,
): void {
  project.globalLayerItems.forEach((entry, index) => {
    visitor.layerItem?.(entry.item, ['globalLayerItems', index, 'item'])
  })
  project.locations.forEach((location, index) => {
    visitor.location?.(location, ['locations', index])
  })
  project.surfaces.forEach((surface, surfaceIndex) => {
    const surfacePath: CourseProjectPath = ['surfaces', surfaceIndex]
    visitor.surface?.(surface, surfacePath)
    surface.surfaceLayerItems.forEach((entry, index) => {
      visitor.layerItem?.(entry.item, [...surfacePath, 'surfaceLayerItems', index, 'item'])
    })
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene, sceneIndex) => {
        const scenePath = [...surfacePath, 'scenes', sceneIndex]
        visitor.scene?.(scene, scenePath)
        scene.layerItems.forEach((item, itemIndex) => {
          visitor.layerItem?.(item, [...scenePath, 'layerItems', itemIndex])
        })
      })
    } else if (surface.type === 'flow') {
      walkBlocks(surface.blocks, [...surfacePath, 'blocks'], visitor)
    } else {
      surface.world.layerItems.forEach((item, itemIndex) => {
        visitor.layerItem?.(item, [...surfacePath, 'world', 'layerItems', itemIndex])
      })
    }
  })
}

function addLayerReferences(
  item: LayerItem,
  path: CourseProjectPath,
  emit: (reference: CourseProjectReference) => void,
): void {
  if (item.kind === 'component') {
    emit({
      kind: 'component',
      id: item.component.packageId,
      version: item.component.version,
      path: [...path, 'component'],
    })
    if (item.staticFallbackAssetId) {
      emit({ kind: 'asset', id: item.staticFallbackAssetId, path: [...path, 'staticFallbackAssetId'] })
    }
    return
  }
  if (item.kind === 'runtime') {
    Object.entries(item.runtime.assets).forEach(([key, binding]) => {
      emit({ kind: 'asset', id: binding.assetId, path: [...path, 'runtime', 'assets', key, 'assetId'] })
    })
    Object.entries(item.runtime.nodeBindings ?? {}).forEach(([key, itemId]) => {
      emit({ kind: 'layer-item', id: itemId, path: [...path, 'runtime', 'nodeBindings', key] })
    })
    if (item.runtime.staticFallback) {
      emit({ kind: 'asset', id: item.runtime.staticFallback.assetId, path: [...path, 'runtime', 'staticFallback', 'assetId'] })
    }
    return
  }
  if (item.content.nativeType === 'image') {
    emit({ kind: 'asset', id: item.content.data.assetId, path: [...path, 'content', 'data', 'assetId'] })
  } else if (item.content.nativeType === 'video') {
    emit({ kind: 'asset', id: item.content.data.assetId, path: [...path, 'content', 'data', 'assetId'] })
    if (item.content.data.poster.assetId) {
      emit({ kind: 'asset', id: item.content.data.poster.assetId, path: [...path, 'content', 'data', 'poster', 'assetId'] })
    }
  } else if (item.content.nativeType === 'teacher-controller') {
    item.content.data.buttons.forEach((button, index) => {
      if (button.action.type === 'scene.go') {
        emit({ kind: 'scene', id: button.action.sceneId, path: [...path, 'content', 'data', 'buttons', index, 'action', 'sceneId'] })
      }
    })
  }
}

function addInteractionReferences(
  rules: ReadonlyArray<InteractionRule>,
  path: CourseProjectPath,
  emit: (reference: CourseProjectReference) => void,
): void {
  const add = (
    kind: CourseProjectReferenceKind,
    id: string,
    referencePath: CourseProjectPath,
  ): void => emit({ kind, id, path: referencePath })
  rules.forEach((rule, ruleIndex) => {
    const rulePath = [...path, ruleIndex]
    const trigger = rule.trigger
    if ('nodeId' in trigger) add('layer-item', trigger.nodeId, [...rulePath, 'trigger', 'nodeId'])
    if (trigger.type === 'presentation.enter') {
      add('presentation-state', trigger.stateId, [...rulePath, 'trigger', 'stateId'])
    } else if (trigger.type === 'audio.ended') {
      add('sound', trigger.soundId, [...rulePath, 'trigger', 'soundId'])
    }
    rule.conditions.forEach((condition, conditionIndex) => {
      if (condition.type === 'scene.in') {
        condition.sceneIds.forEach((sceneId, sceneIndex) => {
          add('scene', sceneId, [...rulePath, 'conditions', conditionIndex, 'sceneIds', sceneIndex])
        })
      } else if (condition.type === 'presentation.in') {
        condition.stateIds.forEach((stateId, stateIndex) => {
          add('presentation-state', stateId, [...rulePath, 'conditions', conditionIndex, 'stateIds', stateIndex])
        })
      } else {
        add('course-state', condition.key, [...rulePath, 'conditions', conditionIndex, 'key'])
      }
    })
    rule.actions.forEach((step, stepIndex) => {
      const action = step.action
      const actionPath = [...rulePath, 'actions', stepIndex, 'action']
      if (action.type === 'presentation.set') {
        add('presentation-state', action.stateId, [...actionPath, 'stateId'])
      } else if (action.type === 'scene.go') {
        add('scene', action.sceneId, [...actionPath, 'sceneId'])
        if (action.targetStateId) add('presentation-state', action.targetStateId, [...actionPath, 'targetStateId'])
      } else if ('nodeId' in action) {
        add('layer-item', action.nodeId, [...actionPath, 'nodeId'])
      } else if (action.type === 'audio.play') {
        add('sound', action.soundId, [...actionPath, 'soundId'])
      } else if (
        action.type === 'audio.pause' ||
        action.type === 'audio.resume' ||
        action.type === 'audio.stop' ||
        action.type === 'audio.toggle-mute'
      ) {
        if (action.target.kind === 'sound') {
          add('sound', action.target.soundId, [...actionPath, 'target', 'soundId'])
        }
      } else if (action.type === 'course-state.set') {
        add('course-state', action.key, [...actionPath, 'key'])
      }
    })
  })
}

/** Traverses references without guessing inside arbitrary component props. */
export function visitCourseProjectReferences(
  project: CourseProjectDocument,
  emit: (reference: CourseProjectReference) => void,
): void {
  emit({ kind: 'location', id: project.startLocationId, path: ['startLocationId'] })
  Object.entries(project.media.audio.sounds).forEach(([key, sound]) => {
    emit({ kind: 'asset', id: sound.assetId, path: ['media', 'audio', 'sounds', key, 'assetId'] })
  })
  const addVisibilityReferences = (
    entries: ReadonlyArray<ScopedLayerItem>,
    path: CourseProjectPath,
  ): void => {
    entries.forEach((entry, entryIndex) => {
      entry.visibility.locationIds.forEach((locationId, locationIndex) => {
        emit({
          kind: 'location',
          id: locationId,
          path: [...path, entryIndex, 'visibility', 'locationIds', locationIndex],
        })
      })
    })
  }
  addVisibilityReferences(project.globalLayerItems, ['globalLayerItems'])
  addInteractionReferences(project.globalInteractions, ['globalInteractions'], emit)
  visitCourseProject(project, {
    layerItem: (item, path) => addLayerReferences(item, path, emit),
    location: (location, path) => {
      emit({ kind: 'surface', id: location.surfaceId, path: [...path, 'surfaceId'] })
      if (location.kind === 'slide-scene') {
        emit({ kind: 'scene', id: location.sceneId, path: [...path, 'sceneId'] })
      } else if (location.kind === 'flow-block') {
        emit({ kind: 'block', id: location.blockId, path: [...path, 'blockId'] })
      } else {
        emit({ kind: 'camera-frame', id: location.cameraFrameId, path: [...path, 'cameraFrameId'] })
      }
    },
    scene: (scene, path) => {
      addInteractionReferences(scene.interactions, [...path, 'interactions'], emit)
      if (scene.backgroundAssetId) {
        emit({ kind: 'asset', id: scene.backgroundAssetId, path: [...path, 'backgroundAssetId'] })
      }
      scene.presentation?.states.forEach((state, index) => {
        if (state.backgroundAssetId) {
          emit({ kind: 'asset', id: state.backgroundAssetId, path: [...path, 'presentation', 'states', index, 'backgroundAssetId'] })
        }
        Object.keys(state.layerItemOverrides).forEach((itemId) => {
          emit({ kind: 'layer-item', id: itemId, path: [...path, 'presentation', 'states', index, 'layerItemOverrides', itemId] })
        })
        state.layerItemOrder?.forEach((itemId, itemIndex) => {
          emit({ kind: 'layer-item', id: itemId, path: [...path, 'presentation', 'states', index, 'layerItemOrder', itemIndex] })
        })
      })
    },
    block: (block, path) => {
      if (block.type === 'media') {
        emit({ kind: 'asset', id: block.assetId, path: [...path, 'assetId'] })
      } else if (block.type === 'component') {
        emit({ kind: 'component', id: block.component.packageId, version: block.component.version, path: [...path, 'component'] })
        emit({ kind: 'asset', id: block.staticFallbackAssetId, path: [...path, 'staticFallbackAssetId'] })
      }
    },
    surface: (surface, path) => {
      addVisibilityReferences(surface.surfaceLayerItems, [...path, 'surfaceLayerItems'])
      if (surface.type === 'spatial-2d') {
        surface.semanticZoom.forEach((rule, ruleIndex) => {
          rule.layerItemIds.forEach((itemId, itemIndex) => {
            emit({ kind: 'layer-item', id: itemId, path: [...path, 'semanticZoom', ruleIndex, 'layerItemIds', itemIndex] })
          })
        })
      }
    },
  })
  project.navigationGuards.forEach((guard, guardIndex) => {
    ;[...(guard.fromLocationIds ?? []), ...guard.toLocationIds].forEach((locationId, index) => {
      emit({ kind: 'location', id: locationId, path: ['navigationGuards', guardIndex, 'locations', index] })
    })
    guard.conditions.forEach((condition, conditionIndex) => {
      emit({ kind: 'course-state', id: condition.key, path: ['navigationGuards', guardIndex, 'conditions', conditionIndex, 'key'] })
    })
  })
  project.mixedPrintPlan?.entries.forEach((entry, entryIndex) => {
    const path: CourseProjectPath = ['mixedPrintPlan', 'entries', entryIndex]
    emit({ kind: 'surface', id: entry.surfaceId, path: [...path, 'surfaceId'] })
    if (entry.kind === 'slide-scenes') {
      entry.sceneIds.forEach((sceneId, sceneIndex) => {
        emit({ kind: 'scene', id: sceneId, path: [...path, 'sceneIds', sceneIndex] })
      })
    } else if (entry.kind === 'spatial-frames') {
      entry.cameraFrameIds.forEach((frameId, frameIndex) => {
        emit({ kind: 'camera-frame', id: frameId, path: [...path, 'cameraFrameIds', frameIndex] })
      })
    }
  })
}

export function collectCourseProjectReferences(
  project: CourseProjectDocument,
): CourseProjectReference[] {
  const references: CourseProjectReference[] = []
  visitCourseProjectReferences(project, (reference) => references.push(reference))
  return references
}

/**
 * Same-version Flow rich-text fallback.
 * V8 `TextRun` is a style range over `text`, not a glyph carrier, so missing
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

function nodeBase(node: SceneNode, order: number): LayerItemBase {
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

function nodeData(node: Exclude<SceneNode, { type: 'external-component' }>): NativeElementContent {
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
  node: SceneNode,
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

const migrateNode = sceneNodeToCourseLayerItem

function migrateRuntime(
  runtime: NonNullable<ProjectDocument['globalRuntime']>,
  layerItemId: string,
  label: string,
  order: number,
): LayerItem {
  return {
    layerItemId,
    label,
    kind: 'runtime',
    frame: {
      mode: 'absolute',
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    },
    order,
    visible: runtime.enabled,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: runtime.enabled,
      renderMode: runtime.renderMode,
      source: runtime.source,
      content: structuredClone(runtime.content),
      assets: structuredClone(runtime.assets),
      nodeBindings: runtime.nodeBindings ? structuredClone(runtime.nodeBindings) : undefined,
      staticFallback: runtime.staticFallback
        ? {
            assetId: runtime.staticFallback.assetId,
            coverage: runtime.staticFallback.coverage === 'full-scene' ? 'scene' : 'surface',
          }
        : undefined,
    },
  }
}

function uniqueGeneratedId(preferred: string, reserved: ReadonlySet<string>): string {
  if (!reserved.has(preferred)) return preferred
  let suffix = 2
  while (reserved.has(`${preferred}:${suffix}`)) suffix += 1
  return `${preferred}:${suffix}`
}

function migrateOverride(
  override: SceneNodeOverride,
  node: SceneNode,
): LayerItemOverride {
  const source = structuredClone(override) as Record<string, unknown>
  const migrated: LayerItemOverride = {}
  if (typeof source.name === 'string') migrated.label = source.name
  delete source.name

  const frame: LayerItemOverride['frame'] = {}
  ;(['x', 'y', 'width', 'height'] as const).forEach((key) => {
    if (typeof source[key] === 'number') frame[key] = source[key] as never
    delete source[key]
  })
  if (Object.keys(frame).length > 0) migrated.frame = frame

  if (typeof source.visible === 'boolean') migrated.visible = source.visible
  if (typeof source.locked === 'boolean') migrated.locked = source.locked
  if (typeof source.rotation === 'number') migrated.rotation = source.rotation
  if (typeof source.opacity === 'number') migrated.opacity = source.opacity
  if (source.playbackInitialVisibility === 'inherit' || source.playbackInitialVisibility === 'hidden') {
    migrated.playbackInitialVisibility = source.playbackInitialVisibility
  }
  delete source.visible
  delete source.rotation
  delete source.opacity
  delete source.locked
  delete source.playbackInitialVisibility
  delete source.id
  delete source.type
  delete source.component

  if (node.type === 'external-component') {
    if (isRecord(source.props)) migrated.componentProps = source.props
    delete source.props
  }
  if (Object.keys(source).length > 0) migrated.nativeData = source
  return migrated
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

function migratePresentation(
  scene: ProjectDocument['scenes'][number],
): SlidePresentation | undefined {
  if (!scene.presentation) return undefined
  const nodesById = new Map(scene.nodes.map((node) => [node.id, node]))
  return {
    initialStateId: scene.presentation.initialStateId,
    thumbnailStateId: scene.presentation.thumbnailStateId,
    states: scene.presentation.states.map((state) => ({
      id: state.id,
      name: state.name,
      description: state.description,
      backgroundColor: state.backgroundColor,
      backgroundAssetId: state.backgroundAssetId,
      layerItemOverrides: Object.fromEntries(
        Object.entries(state.nodeOverrides).map(([nodeId, override]) => [
          nodeId,
          migrateOverride(override, nodesById.get(nodeId)!),
        ]),
      ),
      layerItemOrder: state.nodeOrder ? [...state.nodeOrder] : undefined,
    })),
  }
}

export class ProjectV8MigrationCompatibilityError extends Error {
  readonly scope: 'scene' | 'global'
  readonly runtimeId: string

  constructor(scope: 'scene' | 'global', runtimeId: string) {
    super(
      `旧版工程中的${scope === 'global' ? '全局' : '场景'}动态内容同时位于其他内容的下方和上方；` +
      '当前编辑器无法在不改变显示层级的情况下自动迁移。' +
      '请先在原编辑器中将该动态内容统一到一个层级，再重新导入。',
    )
    this.name = 'ProjectV8MigrationCompatibilityError'
    this.scope = scope
    this.runtimeId = runtimeId
  }
}

export class LegacyComponentPackageMigrationConflictError extends Error {
  readonly packageId: string
  readonly versions: readonly string[]

  constructor(
    packageId: string,
    versions: readonly string[],
    reason: 'multiple-versions' | 'conflicting-metadata' = 'multiple-versions',
  ) {
    const sortedVersions = [...versions].sort(compareStableStrings)
    const detail = reason === 'multiple-versions'
      ? `同时包含多个版本（${sortedVersions.join('、')}）`
      : `包含多份内容不一致的 ${sortedVersions[0] ?? '未知'} 版本记录`
    super(
      `旧工程中的同一个组件${detail}，无法确定应保留哪一份。` +
      '请先在原编辑器中只保留一份组件，再重新导入。',
    )
    this.name = 'LegacyComponentPackageMigrationConflictError'
    this.packageId = packageId
    this.versions = sortedVersions
  }
}

function migrateComponentPackages(
  packages: Readonly<Record<string, EmbeddedComponentPackageMeta>>,
): CourseProjectDocument['componentPackages'] {
  const grouped = new Map<string, EmbeddedComponentPackageMeta[]>()
  for (const metadata of Object.values(packages)) {
    const entries = grouped.get(metadata.packageId) ?? []
    entries.push(metadata)
    grouped.set(metadata.packageId, entries)
  }

  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => compareStableStrings(left, right))
      .map(([packageId, entries]) => {
        const versions = [...new Set(entries.map((entry) => entry.version))]
          .sort(compareStableStrings)
        if (versions.length > 1) {
          throw new LegacyComponentPackageMigrationConflictError(packageId, versions)
        }
        const [first, ...duplicates] = entries
        if (!first) throw new Error('Unexpected empty component package group')
        const canonicalMetadata = JSON.stringify(first)
        if (duplicates.some((entry) => JSON.stringify(entry) !== canonicalMetadata)) {
          throw new LegacyComponentPackageMigrationConflictError(
            packageId,
            versions,
            'conflicting-metadata',
          )
        }
        return [packageId, structuredClone(first)]
      }),
  )
}

function legacyRuntimePlane(
  runtime: ProjectDocument['globalRuntime'],
  scope: 'scene' | 'global',
  runtimeId: string,
): 'underlay' | 'overlay' {
  if (!runtime) return 'overlay'
  // Runtime API 2 did not declare plane usage. A conservative source audit is
  // therefore the only safe migration boundary: ambiguous dual-plane code is
  // rejected instead of being silently collapsed into one V9 item.
  const usesUnderlay = /\bunderlay\b/u.test(runtime.source)
  // Runtime API 2 defines every default root alias as the overlay plane.
  // Prefer executable source evidence over a potentially stale static-fallback
  // label; the latter is only used when the source does not name any root.
  const usesOverlay = /\boverlay\b|\bdomRoot\b|\b(?:dom|phaser)\s*(?:\?\.|\.)\s*root\b/u.test(runtime.source)
  if (usesUnderlay && usesOverlay) {
    throw new ProjectV8MigrationCompatibilityError(scope, runtimeId)
  }
  if (usesUnderlay) return 'underlay'
  if (usesOverlay) return 'overlay'
  return runtime.staticFallback?.layer ?? 'overlay'
}

function migrateScene(
  scene: ProjectDocument['scenes'][number],
  orderOffset = 0,
): SlideSceneDocument {
  const reserved = new Set(scene.nodes.map((node) => node.id))
  const runtimeId = uniqueGeneratedId(`${scene.id}:legacy-runtime`, reserved)
  const layerItems: LayerItem[] = []
  const runtimeIsUnderlay = scene.runtime
    ? legacyRuntimePlane(scene.runtime, 'scene', runtimeId) === 'underlay'
    : false
  if (scene.runtime && runtimeIsUnderlay) {
    layerItems.push(migrateRuntime(
      scene.runtime,
      runtimeId,
      `${scene.name} runtime`,
      orderOffset,
    ))
  }
  scene.nodes.forEach((node) => layerItems.push(migrateNode(
    node,
    orderOffset + layerItems.length,
  )))
  if (scene.runtime && !runtimeIsUnderlay) {
    layerItems.push(migrateRuntime(
      scene.runtime,
      runtimeId,
      `${scene.name} runtime`,
      orderOffset + layerItems.length,
    ))
  }
  return {
    id: scene.id,
    name: scene.name,
    backgroundColor: scene.backgroundColor,
    backgroundAssetId: scene.backgroundAssetId,
    layerItems,
    presentation: migratePresentation(scene),
    interactions: structuredClone(scene.interactions),
  }
}

function migrateVisibility(visibility: GlobalLayerVisibility): ScopedLayerItem['visibility'] {
  return {
    mode: visibility.mode,
    locationIds: [...visibility.sceneIds],
  }
}

/**
 * Pure, explicit Project V8 -> Course Project V9 migration.
 * Existing project/scene/node/state ids are retained. Only the new surface and
 * formerly anonymous runtime items receive deterministic generated ids.
 */
export function migrateProjectV8ToCourseProjectV9(
  input: ProjectDocument,
): CourseProjectDocument {
  const project = projectDocumentSchema.parse(structuredClone(input))
  const slideSurfaceId = `slide:${project.id}`
  const globalReserved = new Set(project.globalLayer.map((entry) => entry.node.id))
  const globalRuntimeId = uniqueGeneratedId(`${project.id}:legacy-global-runtime`, globalReserved)
  const globalRuntimePlane = project.globalRuntime
    ? legacyRuntimePlane(project.globalRuntime, 'global', globalRuntimeId)
    : undefined
  const globalLayerItems: ScopedLayerItem[] = []
  const underlayEntries = project.globalLayer.filter((entry) => entry.layer === 'underlay')
  const overlayEntries = project.globalLayer.filter((entry) => entry.layer === 'overlay')

  const migrateGlobalEntry = (
    entry: ProjectDocument['globalLayer'][number],
    order: number,
  ): void => {
    globalLayerItems.push({
      item: migrateNode(entry.node, order),
      visibility: migrateVisibility(entry.visibility),
    })
  }
  underlayEntries.forEach((entry, index) => migrateGlobalEntry(entry, index))
  const sceneOrderOffset = underlayEntries.length + (globalRuntimePlane === 'underlay' ? 1 : 0)
  if (project.globalRuntime && globalRuntimePlane === 'underlay') {
    globalLayerItems.push({
      item: migrateRuntime(
        project.globalRuntime,
        globalRuntimeId,
        'Global runtime',
        underlayEntries.length,
      ),
      visibility: { mode: 'all', locationIds: [] },
    })
  }
  const migratedScenes = project.scenes.map((scene) => migrateScene(scene, sceneOrderOffset))
  const maximumSceneItems = Math.max(0, ...migratedScenes.map((scene) => scene.layerItems.length))
  const overlayOrderOffset = sceneOrderOffset + maximumSceneItems + 1
  overlayEntries.forEach((entry, index) => migrateGlobalEntry(
    entry,
    overlayOrderOffset + index,
  ))
  if (project.globalRuntime && globalRuntimePlane === 'overlay') {
    globalLayerItems.push({
      item: migrateRuntime(
        project.globalRuntime,
        globalRuntimeId,
        'Global runtime',
        overlayOrderOffset + overlayEntries.length,
      ),
      visibility: { mode: 'all', locationIds: [] },
    })
  }

  const locations: CourseLocation[] = project.scenes.map((scene) => ({
    id: scene.id,
    label: scene.name,
    kind: 'slide-scene',
    surfaceId: slideSurfaceId,
    sceneId: scene.id,
  }))

  const migrated: CourseProjectDocument = {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: project.id,
    revision: 0,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    assets: structuredClone(project.assets),
    componentPackages: migrateComponentPackages(project.componentPackages),
    designTokens: structuredClone(project.designTokens),
    media: structuredClone(project.media),
    playback: structuredClone(project.playback),
    courseState: [],
    navigationGuards: [],
    locations,
    startLocationId: locations[0]!.id,
    globalLayerItems,
    globalInteractions: structuredClone(project.globalInteractions),
    surfaces: [{
      id: slideSurfaceId,
      title: project.title,
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: migratedScenes,
    }],
  }

  return courseProjectDocumentSchema.parse(migrated)
}
