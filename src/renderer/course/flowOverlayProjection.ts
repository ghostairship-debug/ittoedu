import {
  getEffectiveCourseLayerOrder,
  isCourseLayerVisibleAtLocation,
} from '../../shared/courseProjectModel'
import type {
  CourseProjectDocument,
  FlowBlock,
  FlowBodyLayerPlane,
  LayerItem,
} from '../../shared/courseProjectTypes'
import {
  carrierForLayerItem,
  isTeacherControllerLayerItem,
  makeGlobalLayerAuthoringAddress,
} from './globalLayerCommands'
import {
  walkFlowBlocks,
  flowSurfaceIn,
} from './flowDocumentModel'
import { isFlowZOrderLayerBlock } from './flowEditorSlice'
import {
  buildFlowEditorView,
  type FlowEditorLayerView,
} from './flowEditorView'

/**
 * Flow overlay membership. Ordinary document blocks never become z-order
 * rows. Teacher controller is a viewport overlay, not a document footer.
 */
export type FlowLayerMembership = 'document-block' | 'viewport-overlay'
export type FlowOverlayPlacement = 'viewport-overlay'

export interface FlowDocumentOwnedEntry {
  readonly blockId: string
  readonly type: FlowBlock['type']
  readonly membership: 'document-block'
  readonly inCourseTree: boolean
  readonly inUnifiedLayers: false
}

export interface FlowUnifiedOverlayRow {
  readonly source: 'global' | 'surface'
  readonly layerItemId: string
  readonly authoringAddress: string
  readonly membership: 'viewport-overlay'
  readonly placement: FlowOverlayPlacement
  readonly isTeacherController: boolean
  readonly scopedVisible: boolean
  readonly effectiveVisible: boolean
  /** Effective page-overlay plane around the Flow body; global rows carry null. */
  readonly bodyPlane: FlowBodyLayerPlane | null
  readonly item: LayerItem
}

export interface FlowUnifiedOverlayProjection {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly overlayRows: readonly FlowUnifiedOverlayRow[]
  readonly documentOwned: readonly FlowDocumentOwnedEntry[]
  readonly teacherController: FlowUnifiedOverlayRow | null
  readonly effectiveOrderIds: readonly string[]
  readonly nodesTabIds: readonly string[]
}

function overlayRow(entry: FlowEditorLayerView): FlowUnifiedOverlayRow {
  const isTeacherController = isTeacherControllerLayerItem(entry.item as LayerItem)
  return Object.freeze({
    source: entry.source,
    layerItemId: entry.selectionId,
    authoringAddress: entry.authoringAddress,
    membership: 'viewport-overlay',
    placement: 'viewport-overlay',
    isTeacherController,
    scopedVisible: entry.scopedVisible,
    effectiveVisible: entry.effectiveVisible,
    bodyPlane: entry.flowBodyPlane,
    item: entry.item as LayerItem,
  })
}

export function listFlowDocumentOwnedBlocks(
  project: CourseProjectDocument,
  surfaceId: string,
): FlowDocumentOwnedEntry[] {
  const surface = flowSurfaceIn(project, surfaceId)
  const owned: FlowDocumentOwnedEntry[] = []
  walkFlowBlocks(surface.blocks, (block) => {
    if (isFlowZOrderLayerBlock(block)) {
      throw new Error('普通 Flow 块不能进入通用图层')
    }
    owned.push(Object.freeze({
      blockId: block.id,
      type: block.type,
      membership: 'document-block',
      inCourseTree: block.type === 'heading' || block.type === 'section',
      inUnifiedLayers: false,
    }))
  })
  return owned
}

export function flowBlockLayerMembership(_block: FlowBlock): 'document-block' {
  return 'document-block'
}

export function isFlowDocumentOwnedId(
  project: CourseProjectDocument,
  surfaceId: string,
  id: string,
): boolean {
  return listFlowDocumentOwnedBlocks(project, surfaceId).some((entry) => entry.blockId === id)
}

/**
 * NodesTab / unified z-order for a Flow page. Only real overlays.
 * Paragraph, heading, in-document media and FlowComponentBlock are excluded.
 */
export function projectFlowUnifiedOverlays(
  project: CourseProjectDocument,
  locationId: string,
): FlowUnifiedOverlayProjection {
  const view = buildFlowEditorView({ project, locationId })
  const documentOwned = Object.freeze(listFlowDocumentOwnedBlocks(project, view.surfaceId))
  const ownedIds = new Set(documentOwned.map((entry) => entry.blockId))
  const overlayRows = Object.freeze(
    view.overlayLayers
      .filter((entry) => !ownedIds.has(entry.selectionId))
      .map(overlayRow),
  )
  const engine = getEffectiveCourseLayerOrder({
    project,
    surfaceId: view.surfaceId,
    locationId,
  })
  const effectiveOrderIds = Object.freeze(
    engine
      .filter((entry) => !ownedIds.has(entry.item.layerItemId))
      .map((entry) => entry.item.layerItemId),
  )
  const leaked = overlayRows.find((row) => ownedIds.has(row.layerItemId))
  if (leaked) {
    throw new Error('普通 Flow 块不能进入通用图层')
  }
  const teacherController = overlayRows.find((row) => row.isTeacherController) ?? null
  return Object.freeze({
    projectId: view.projectId,
    revision: view.revision,
    locationId: view.locationId,
    surfaceId: view.surfaceId,
    overlayRows,
    documentOwned,
    teacherController,
    effectiveOrderIds,
    nodesTabIds: Object.freeze(overlayRows.map((row) => row.layerItemId)),
  })
}

export function listFlowGlobalAuthoringItems(
  project: CourseProjectDocument,
  locationId: string,
): readonly FlowUnifiedOverlayRow[] {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error('请先选择一个流式页面')
  return Object.freeze(project.globalLayerItems.map((entry) => {
    const scopedVisible = isCourseLayerVisibleAtLocation(entry, locationId)
    return Object.freeze({
      source: 'global' as const,
      layerItemId: entry.item.layerItemId,
      authoringAddress: makeGlobalLayerAuthoringAddress(
        project.id,
        entry.item.layerItemId,
        carrierForLayerItem(entry.item),
        'item',
      ),
      membership: 'viewport-overlay' as const,
      placement: 'viewport-overlay' as const,
      isTeacherController: isTeacherControllerLayerItem(entry.item),
      scopedVisible,
      effectiveVisible: scopedVisible && entry.item.visible,
      bodyPlane: null,
      item: entry.item,
    })
  }))
}

export function teacherControllerOverlayPlacement(
  item: LayerItem,
): FlowOverlayPlacement | null {
  if (!isTeacherControllerLayerItem(item)) return null
  return 'viewport-overlay'
}
