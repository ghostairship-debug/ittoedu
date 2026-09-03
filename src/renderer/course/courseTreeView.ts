import type {
  CourseLocation,
  CourseProjectDocument,
  SlideSurfaceDocument,
  SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import { listFlowCourseTreePages, type FlowCourseTreeSource } from './flowEditorView'

export const SHARED_CONTENT_SECTION_ID = 'shared-content' as const
export const GLOBAL_LAYER_ENTRY_ID = 'global-layer' as const
export const SPATIAL_CAMERA_GROUP_LABEL = '本页镜头' as const

export interface CourseTreeGlobalLayerEntry {
  readonly id: typeof GLOBAL_LAYER_ENTRY_ID
  readonly kind: 'global-layer'
  readonly label: '全局层'
  readonly rangeLabel: '全课'
  readonly isLocation: false
  readonly writesHistory: false
}

export interface CourseTreeSharedContent {
  readonly id: typeof SHARED_CONTENT_SECTION_ID
  readonly kind: 'shared-content'
  readonly label: '共享内容'
  readonly globalEntry: CourseTreeGlobalLayerEntry
  readonly entries: readonly [CourseTreeGlobalLayerEntry]
}

export type CourseTreeNodeKind =
  | 'slide-page'
  | 'slide-scene'
  | 'flow-page'
  | 'flow-heading'
  | 'flow-section'
  | 'spatial-page'
  | 'spatial-camera-group'
  | 'spatial-camera'

export interface CourseTreeNode {
  readonly id: string
  readonly kind: CourseTreeNodeKind
  readonly surfaceId: string
  readonly surfaceType: 'slide' | 'flow' | 'spatial-2d'
  readonly label: string
  readonly locationId: string | null
  readonly isLocation: boolean
  readonly writesHistory: boolean
  readonly children: readonly CourseTreeNode[]
  /** Stable Spatial camera frame identity; only set on spatial-camera nodes. */
  readonly cameraFrameId?: string
}

export interface CourseTreeViewModel {
  readonly shared: CourseTreeSharedContent
  readonly pages: readonly CourseTreeNode[]
}

const FIXED_GLOBAL_LAYER_ENTRY: CourseTreeGlobalLayerEntry = Object.freeze({
  id: GLOBAL_LAYER_ENTRY_ID,
  kind: 'global-layer',
  label: '全局层',
  rangeLabel: '全课',
  isLocation: false,
  writesHistory: false,
})

const FIXED_SHARED_CONTENT: CourseTreeSharedContent = Object.freeze({
  id: SHARED_CONTENT_SECTION_ID,
  kind: 'shared-content',
  label: '共享内容',
  globalEntry: FIXED_GLOBAL_LAYER_ENTRY,
  entries: Object.freeze([FIXED_GLOBAL_LAYER_ENTRY]) as readonly [CourseTreeGlobalLayerEntry],
})

type TreeProject = FlowCourseTreeSource

function surfacesById(project: TreeProject): Map<string, CourseProjectDocument['surfaces'][number]> {
  const map = new Map<string, CourseProjectDocument['surfaces'][number]>()
  for (const surface of project.surfaces) {
    map.set(surface.id, surface)
  }
  return map
}

function orderedSurfaceIds(project: TreeProject): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const location of project.locations) {
    if (!seen.has(location.surfaceId)) {
      seen.add(location.surfaceId)
      ordered.push(location.surfaceId)
    }
  }
  for (const surface of project.surfaces) {
    if (!seen.has(surface.id)) {
      seen.add(surface.id)
      ordered.push(surface.id)
    }
  }
  return ordered
}

function locationsForSurface(
  project: TreeProject,
  surfaceId: string,
): CourseLocation[] {
  return project.locations.filter((location) => location.surfaceId === surfaceId)
}

function primarySlideLocations(
  locations: readonly CourseLocation[],
): Array<Extract<CourseLocation, { kind: 'slide-scene' }>> {
  const slideLocations = locations.filter(
    (location): location is Extract<CourseLocation, { kind: 'slide-scene' }> =>
      location.kind === 'slide-scene',
  )
  const withoutState = slideLocations.filter((location) => location.stateId === undefined)
  return withoutState.length > 0 ? withoutState : slideLocations
}

function slideSceneLabel(
  surface: SlideSurfaceDocument,
  location: Extract<CourseLocation, { kind: 'slide-scene' }>,
): string {
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  return scene?.name ?? location.label
}

function slideSceneNodes(
  surface: SlideSurfaceDocument,
  locations: readonly CourseLocation[],
): CourseTreeNode[] {
  return primarySlideLocations(locations).map((location) => ({
    id: location.id,
    kind: 'slide-scene' as const,
    surfaceId: surface.id,
    surfaceType: 'slide' as const,
    label: slideSceneLabel(surface, location),
    locationId: location.id,
    isLocation: true,
    writesHistory: true,
    children: [],
  }))
}

function flowPageChildren(
  project: TreeProject,
  surfaceId: string,
): CourseTreeNode[] {
  const flowPage = listFlowCourseTreePages(project)
    .find((page) => page.surfaceId === surfaceId)
  if (!flowPage) return []
  return flowPage.headings.map((heading) => ({
    id: heading.locationId,
    kind: heading.kind === 'section' ? 'flow-section' as const : 'flow-heading' as const,
    surfaceId,
    surfaceType: 'flow' as const,
    label: heading.title,
    locationId: heading.locationId,
    isLocation: true,
    writesHistory: true,
    children: [],
  }))
}

function spatialCameraNodes(
  surface: SpatialSurfaceDocument,
  locations: readonly CourseLocation[],
): CourseTreeNode[] {
  const locationByFrameId = new Map(
    locations.flatMap((location) =>
      location.kind === 'spatial-camera'
        ? [[location.cameraFrameId, location] as const]
        : [],
    ),
  )
  return surface.camera.frames.flatMap((frame) => {
    const location = locationByFrameId.get(frame.id)
    if (!location || location.kind !== 'spatial-camera') return []
    return [{
      id: location.id,
      kind: 'spatial-camera' as const,
      surfaceId: surface.id,
      surfaceType: 'spatial-2d' as const,
      label: frame.name,
      locationId: location.id,
      cameraFrameId: frame.id,
      isLocation: true,
      writesHistory: true,
      children: [],
    }]
  })
}

function buildSurfacePageNode(
  project: TreeProject,
  surfaceId: string,
): CourseTreeNode | null {
  const surface = surfacesById(project).get(surfaceId)
  if (!surface) return null
  const locations = locationsForSurface(project, surfaceId)

  if (surface.type === 'slide') {
    const scenes = slideSceneNodes(surface, locations)
    return {
      id: surfaceId,
      kind: 'slide-page',
      surfaceId,
      surfaceType: 'slide',
      label: surface.title,
      locationId: scenes[0]?.locationId ?? locations[0]?.id ?? null,
      isLocation: false,
      writesHistory: false,
      children: scenes,
    }
  }

  if (surface.type === 'flow') {
    const children = flowPageChildren(project, surfaceId)
    const flowPages = listFlowCourseTreePages(project)
    const flowPage = flowPages.find((page) => page.surfaceId === surfaceId)
    return {
      id: surfaceId,
      kind: 'flow-page',
      surfaceId,
      surfaceType: 'flow',
      label: surface.title,
      locationId: flowPage?.startLocationId ?? locations[0]?.id ?? null,
      isLocation: false,
      writesHistory: false,
      children,
    }
  }

  const cameras = spatialCameraNodes(surface, locations)
  return {
    id: surfaceId,
    kind: 'spatial-page',
    surfaceId,
    surfaceType: 'spatial-2d',
    label: surface.title,
    locationId: cameras[0]?.locationId ?? locations[0]?.id ?? null,
    isLocation: false,
    writesHistory: false,
    children: [{
      id: `cameras:${surfaceId}`,
      kind: 'spatial-camera-group',
      surfaceId,
      surfaceType: 'spatial-2d',
      label: SPATIAL_CAMERA_GROUP_LABEL,
      locationId: null,
      isLocation: false,
      writesHistory: false,
      children: cameras,
    }],
  }
}

function collectTreeNodeIds(nodes: readonly CourseTreeNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    ids.push(node.id)
    ids.push(...collectTreeNodeIds(node.children))
  }
  return ids
}

export function buildCourseTreeView(project: TreeProject): CourseTreeViewModel {
  const pages = orderedSurfaceIds(project).flatMap((surfaceId) => {
    const node = buildSurfacePageNode(project, surfaceId)
    return node ? [node] : []
  })
  return Object.freeze({
    shared: FIXED_SHARED_CONTENT,
    pages: Object.freeze(pages),
  })
}

export function collectCourseTreeNodeIds(view: CourseTreeViewModel): string[] {
  return [
    view.shared.id,
    view.shared.globalEntry.id,
    ...view.pages.flatMap((page) => collectTreeNodeIds([page])),
  ]
}
