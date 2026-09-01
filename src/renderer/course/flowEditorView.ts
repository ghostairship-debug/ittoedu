import { makeAuthoringAddress } from '../../shared/authoringAddress'
import {
  composeCourseProjectLocation,
  type CourseLayerComposition,
} from '../../shared/courseLayerComposition'
import type {
  CourseProjectDocument,
  FlowBlock,
  FlowBodyLayerPlane,
  FlowSurfaceDocument,
  GlobalLayerPlane,
  LayerItem,
} from '../../shared/courseProjectTypes'
import {
  carrierForFlowBlock,
  findFlowBlockRecursive,
  flowBlockLabel,
  flowCourseAnchorLabel,
  flowSurfaceIn,
  isFlowCourseAnchor,
  isFlowCourseBlockLocation,
  makeFlowBlockAuthoringAddress,
  walkFlowBlocks,
} from './flowDocumentModel'
import { isFlowZOrderLayerBlock } from './flowEditorSlice'

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T :
    T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[] :
      T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } :
        T

export interface FlowBlockView {
  readonly blockId: string
  readonly parentId: string | null
  readonly depth: number
  readonly index: number
  readonly authoringAddress: string
  readonly label: string
  readonly navigable: boolean
  readonly layerKind: 'document-block'
  readonly block: DeepReadonly<FlowBlock>
}

export type FlowOutlineKind = 'heading' | 'section'

export interface FlowOutlineEntry {
  readonly locationId: string | null
  readonly blockId: string
  readonly title: string
  readonly level: number
  readonly depth: number
  readonly kind: FlowOutlineKind
  readonly authoringAddress: string
}

export type FlowOverlayLayerSource = 'global' | 'surface'

export interface FlowEditorLayerView {
  readonly source: FlowOverlayLayerSource
  /** Exact canonical/legacy-resolved plane for globals; surface entries carry null. */
  readonly globalPlane: GlobalLayerPlane | null
  /** Surface overlay plane around the semantic body; globals carry null. */
  readonly flowBodyPlane: FlowBodyLayerPlane | null
  /** Dense composition slot. It is a read-model fact and is never written to item.order. */
  readonly stackOrder: number
  readonly scopedVisible: boolean
  readonly effectiveVisible: boolean
  readonly selectionId: string
  readonly authoringAddress: string
  readonly item: DeepReadonly<LayerItem>
}

export interface FlowCourseTreeHeading {
  readonly locationId: string
  readonly blockId: string
  readonly kind: FlowOutlineKind
  readonly title: string
  readonly level: number
  readonly authoringAddress: string
}

export interface FlowCourseTreePage {
  readonly surfaceId: string
  readonly surfaceTitle: string
  readonly startLocationId: string
  readonly headings: readonly FlowCourseTreeHeading[]
}

export interface FlowEditorView {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly surfaceTitle: string
  readonly activeBlockId: string
  readonly layout: DeepReadonly<FlowSurfaceDocument['layout']>
  readonly blocks: readonly FlowBlockView[]
  readonly outline: readonly FlowOutlineEntry[]
  readonly courseTree: FlowCourseTreePage
  readonly overlayLayers: readonly FlowEditorLayerView[]
}

export interface BuildFlowEditorViewInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value as DeepReadonly<T>
  }
  if (!ArrayBuffer.isView(value)) {
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry))
  }
  return Object.freeze(value) as DeepReadonly<T>
}

function resolveFlowLocation(
  project: CourseProjectDocument,
  locationId: string,
): {
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'flow-block' }>
  surface: FlowSurfaceDocument
} {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  if (location.kind !== 'flow-block') {
    throw new Error(`FlowEditorView 只接受 Flow 块位置：${locationId}`)
  }
  const surface = flowSurfaceIn(project, location.surfaceId)
  return { location, surface }
}

function overlayLayerView(
  projectId: string,
  surfaceId: string,
  source: FlowOverlayLayerSource,
  item: LayerItem,
  scopedVisible: boolean,
  globalPlane: GlobalLayerPlane | null,
  flowBodyPlane: FlowBodyLayerPlane | null,
  stackOrder: number,
): FlowEditorLayerView {
  return {
    source,
    globalPlane,
    flowBodyPlane,
    stackOrder,
    scopedVisible,
    effectiveVisible: scopedVisible && item.visible,
    selectionId: item.layerItemId,
    authoringAddress: makeAuthoringAddress({
      projectId,
      scope: source === 'global' ? 'global' : 'surface',
      surfaceId: source === 'global' ? undefined : surfaceId,
      carrier: item.kind === 'component' ? 'component' : item.kind === 'runtime' ? 'runtime' : 'native',
      layerItemId: item.layerItemId,
      field: 'item',
    }),
    item: deepFreeze(structuredClone(item)),
  }
}

/** Flow read-model adapter. Flow has no presentation state, so stateId is exact null. */
export function composeFlowEditorLocation(input: {
  readonly project: CourseProjectDocument
  readonly locationId: string
}): CourseLayerComposition<LayerItem> {
  return composeCourseProjectLocation({ ...input, stateId: null })
}

export function listFlowCourseTreePages(project: CourseProjectDocument): FlowCourseTreePage[] {
  return project.surfaces.flatMap((surface) => {
    if (surface.type !== 'flow') return []
    const locations = project.locations
      .filter(isFlowCourseBlockLocation)
      .filter((location) => location.surfaceId === surface.id)
    const headings: FlowCourseTreeHeading[] = []
    walkFlowBlocks(surface.blocks, (block, _parentId, _index, depth) => {
      if (!isFlowCourseAnchor(block)) return
      const location = locations.find((candidate) => candidate.blockId === block.id)
      if (!location) return
      headings.push({
        locationId: location.id,
        blockId: block.id,
        kind: block.type,
        title: flowCourseAnchorLabel(block),
        level: block.type === 'heading' ? block.level + depth : depth + 1,
        authoringAddress: makeFlowBlockAuthoringAddress({
          projectId: project.id,
          surfaceId: surface.id,
          blockId: block.id,
          field: 'block',
          carrier: carrierForFlowBlock(block),
        }),
      })
    })
    const startLocationId = locations.some((location) => location.id === project.startLocationId)
      ? project.startLocationId
      : (locations[0]?.id ?? '')
    return [{
      surfaceId: surface.id,
      surfaceTitle: surface.title,
      startLocationId,
      headings,
    }]
  })
}

export function buildFlowEditorView(input: BuildFlowEditorViewInput): FlowEditorView {
  const { project, locationId } = input
  const { location, surface } = resolveFlowLocation(project, locationId)
  const locationByBlockId = new Map<string, string>()
  for (const candidate of project.locations) {
    if (candidate.kind === 'flow-block' && candidate.surfaceId === surface.id) {
      locationByBlockId.set(candidate.blockId, candidate.id)
    }
  }

  const blocks: FlowBlockView[] = []
  const outline: FlowOutlineEntry[] = []
  walkFlowBlocks(surface.blocks, (block, parentId, index, depth) => {
    const authoringAddress = makeFlowBlockAuthoringAddress({
      projectId: project.id,
      surfaceId: surface.id,
      blockId: block.id,
      field: 'block',
      carrier: carrierForFlowBlock(block),
    })
    blocks.push({
      blockId: block.id,
      parentId,
      depth,
      index,
      authoringAddress,
      label: flowBlockLabel(block),
      navigable: isFlowCourseAnchor(block),
      layerKind: 'document-block',
      block: deepFreeze(structuredClone(block)),
    })
    if (block.type === 'heading') {
      outline.push({
        locationId: locationByBlockId.get(block.id) ?? null,
        blockId: block.id,
        title: flowCourseAnchorLabel(block),
        level: block.level + depth,
        depth,
        kind: 'heading',
        authoringAddress,
      })
    } else if (block.type === 'section') {
      outline.push({
        locationId: locationByBlockId.get(block.id) ?? null,
        blockId: block.id,
        title: flowCourseAnchorLabel(block),
        level: depth + 1,
        depth,
        kind: 'section',
        authoringAddress,
      })
    }
  })

  if (!findFlowBlockRecursive(surface.blocks, location.blockId)) {
    throw new Error(`找不到 Flow 块：${location.blockId}`)
  }

  const composition = composeFlowEditorLocation({ project, locationId })
  const overlayLayers = composition.entries
    .filter((entry) => entry.applicable)
    .map((entry) => overlayLayerView(
      project.id,
      surface.id,
      entry.source === 'global' ? 'global' : 'surface',
      entry.item,
      entry.applicable,
      entry.globalPlane,
      entry.flowBodyPlane,
      entry.stackOrder,
    ))

  const courseTree = listFlowCourseTreePages(project).find((page) => page.surfaceId === surface.id)
  if (!courseTree) throw new Error(`找不到 Flow 表面：${surface.id}`)

  for (const block of blocks) {
    if (isFlowZOrderLayerBlock(block.block as FlowBlock)) {
      throw new Error('普通 Flow 块不能进入通用图层')
    }
  }

  return deepFreeze({
    projectId: project.id,
    revision: project.revision,
    locationId,
    surfaceId: surface.id,
    surfaceTitle: surface.title,
    activeBlockId: location.blockId,
    layout: { ...surface.layout },
    blocks,
    outline,
    courseTree,
    overlayLayers,
  })
}
