import {
  composeCourseProjectLocation,
  type CourseLayerComposition,
} from '../../shared/courseLayerComposition'
import { makeAuthoringAddress, type AuthoringCarrier } from '../../shared/authoringAddress'
import { resolveCourseSurfaceBackgroundColor } from '../../shared/courseProjectModel'
import type {
  CourseLocation,
  CourseProjectDocument,
  GlobalLayerPlane,
  LayerItem,
  NativeLayerItem,
  SpatialCameraFrame,
  SpatialCameraPose,
  SpatialPathDocument,
  SpatialRelationDocument,
  SpatialSemanticZoomRule,
  SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  ownerKeyFor,
  type CourseAuthoringOwner,
} from '../authoring/courseAuthoringScope'
import {
  captureCourseAuthoringTarget,
  type CourseAuthoringSessionToken,
  type CourseAuthoringTarget,
} from '../authoring/courseAuthoringSession'
import {
  createStageViewportTransform,
  type StagePoint,
  type StageRect,
  type StageViewportTransform,
} from '../authoring/stageViewportTransform'

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T :
    T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[] :
      T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } :
        T

export type SpatialEditorLayerScope = 'global' | 'surface' | 'world'
export type SpatialCoordinateSpace = 'world' | 'viewport'
export type SpatialEditorLocationKind = 'spatial-camera'
export type SpatialEditorLayerOwner = Extract<CourseAuthoringOwner, 'global' | 'surface' | 'world'>

export type SpatialEditorGraphSelection =
  | { readonly kind: 'path'; readonly id: string }
  | { readonly kind: 'relation'; readonly id: string }

export interface SpatialEditorStableTarget {
  readonly layerItemId: string
  readonly authoringAddress: string
  readonly coordinateSpace: SpatialCoordinateSpace
  readonly owner: SpatialEditorLayerOwner
}

export type SpatialEditorAuthoringTargetInput =
  | { readonly kind: 'surface'; readonly field?: string }
  | { readonly kind: 'world'; readonly field?: string }
  | { readonly kind: 'layer'; readonly layerItemId: string; readonly field?: string }
  | { readonly kind: 'camera-frame'; readonly frameId: string; readonly field?: string }
  | { readonly kind: 'path'; readonly pathId: string; readonly field?: string }
  | { readonly kind: 'relation'; readonly relationId: string; readonly field?: string }
  | { readonly kind: 'semantic-rule'; readonly ruleId: string; readonly field?: string }

export const SPATIAL_SESSIONLESS_ERROR = '没有活动的 Spatial 编辑会话，不能从旧工程恢复界面'

/** Temporary editor camera. Never persisted in Course Project revision/history. */
export interface SpatialSessionCamera {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export interface SpatialEditorLayerView {
  readonly source: SpatialEditorLayerScope
  readonly owner: SpatialEditorLayerOwner
  readonly ownerKey: string
  /** G3: global (including non-controller HUD) and teacher-controller are viewport. */
  readonly coordinateSpace: SpatialCoordinateSpace
  /** Resolved global plane; non-global entries carry null. */
  readonly globalPlane: GlobalLayerPlane | null
  /** Dense back-to-front slot from the shared composition read model. */
  readonly stackOrder: number
  readonly scopedVisible: boolean
  readonly effectiveVisible: boolean
  readonly locked: boolean
  readonly selectionId: string
  readonly authoringAddress: string
  readonly item: DeepReadonly<LayerItem>
}

export interface SpatialEditorCameraView {
  readonly home: DeepReadonly<SpatialCameraPose>
  readonly frames: readonly DeepReadonly<SpatialCameraFrame>[]
  readonly activeFrameId: string
  readonly activeFrame: DeepReadonly<SpatialCameraFrame>
}

export interface SpatialEditorPathView {
  readonly pathId: string
  readonly path: DeepReadonly<SpatialPathDocument>
}

export interface SpatialEditorRelationView {
  readonly relationId: string
  readonly relation: DeepReadonly<SpatialRelationDocument>
}

export interface SpatialEditorWorldGraphView {
  readonly paths: readonly SpatialEditorPathView[]
  readonly relations: readonly SpatialEditorRelationView[]
}

export interface SpatialEditorActiveLocation {
  readonly locationId: string
  readonly surfaceId: string
  readonly cameraFrameId: string
  readonly label: string
}

export interface SpatialEditorNavigationLocation {
  readonly locationId: string
  readonly label: string
  readonly kind: CourseLocation['kind']
  readonly surfaceId: string
}

export interface SpatialEditorView {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly surfaceTitle: string
  readonly backgroundColor: string
  readonly activeLocation: SpatialEditorActiveLocation
  readonly navigationLocations: readonly SpatialEditorNavigationLocation[]
  readonly camera: SpatialEditorCameraView
  readonly worldBounds: DeepReadonly<SpatialSurfaceDocument['world']['bounds']>
  readonly worldGraph: SpatialEditorWorldGraphView
  readonly visibilityRules: readonly DeepReadonly<SpatialSemanticZoomRule>[]
  /** Live session camera. Active editor views never synthesize a fallback camera. */
  readonly sessionCamera: SpatialSessionCamera
  readonly layers: readonly SpatialEditorLayerView[]
}

export interface BuildSpatialEditorViewInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
  /** Session-only camera. Copied onto the view and never written back. */
  readonly sessionCamera: SpatialSessionCamera
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value as DeepReadonly<T>
  }
  if (!ArrayBuffer.isView(value)) {
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry))
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

export function isSpatialTeacherController(item: DeepReadonly<LayerItem> | LayerItem): boolean {
  return item.kind === 'native' && item.content.nativeType === 'teacher-controller'
}

export function spatialLayerCoordinateSpace(
  source: SpatialEditorLayerScope,
  item: DeepReadonly<LayerItem> | LayerItem,
): SpatialCoordinateSpace {
  if (isSpatialTeacherController(item) || source === 'global') return 'viewport'
  return 'world'
}

export function isSpatialViewportLayer(layer: SpatialEditorLayerView): boolean {
  return layer.coordinateSpace === 'viewport'
}

export function resolveSpatialSurface(
  project: CourseProjectDocument,
  locationId: string,
): {
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'spatial-camera' }>
  surface: SpatialSurfaceDocument
  frame: SpatialCameraFrame
} {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  if (location.kind !== 'spatial-camera') {
    throw new Error(`SpatialEditorView 只接受 Spatial 镜头位置：${locationId}`)
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'spatial-2d') {
    throw new Error(`找不到 Spatial 表面：${location.surfaceId}`)
  }
  const frame = surface.camera.frames.find((candidate) => candidate.id === location.cameraFrameId)
  if (!frame) throw new Error(`找不到 Spatial 镜头帧：${location.cameraFrameId}`)
  return { location, surface, frame }
}

export function isSpatialEditorLocationKind(
  kind: string | null | undefined,
): kind is SpatialEditorLocationKind {
  return kind === 'spatial-camera'
}

export function spatialLayerOwner(source: SpatialEditorLayerScope): SpatialEditorLayerOwner {
  if (source === 'global') return 'global'
  if (source === 'surface') return 'surface'
  return 'world'
}

function layerView(
  projectId: string,
  surfaceId: string,
  item: LayerItem,
  source: SpatialEditorLayerScope,
  scopedVisible: boolean,
  globalPlane: GlobalLayerPlane | null,
  stackOrder: number,
): SpatialEditorLayerView {
  const readonlyItem = deepFreeze(item)
  const owner = spatialLayerOwner(source)
  return {
    source,
    owner,
    ownerKey: ownerKeyFor(owner, surfaceId, null),
    coordinateSpace: spatialLayerCoordinateSpace(source, readonlyItem),
    globalPlane,
    stackOrder,
    scopedVisible,
    effectiveVisible: scopedVisible && readonlyItem.visible,
    locked: readonlyItem.locked,
    selectionId: readonlyItem.layerItemId,
    authoringAddress: makeAuthoringAddress({
      projectId,
      scope: owner === 'global' ? 'global' : 'surface',
      surfaceId: owner === 'global' ? undefined : surfaceId,
      carrier: spatialLayerCarrier(readonlyItem),
      layerItemId: readonlyItem.layerItemId,
      field: defaultSpatialAuthoringField(readonlyItem),
    }),
    item: readonlyItem,
  }
}

/** Spatial read-model adapter. Camera/semantic visibility remains outside composition. */
export function composeSpatialEditorLocation(input: {
  readonly project: CourseProjectDocument
  readonly locationId: string
}): CourseLayerComposition<LayerItem> {
  return composeCourseProjectLocation({ ...input, stateId: null })
}

/**
 * Read-only Spatial projection from the active V9 document + location.
 * Path/relation/semantic-zoom live under worldGraph/visibilityRules so R5-A
 * snapshots that forbid top-level `paths` / `relations` / `semanticZoom` stay valid.
 * Session camera is copied onto the view and is never written to the document.
 */
export function buildSpatialEditorView(input: BuildSpatialEditorViewInput): SpatialEditorView {
  if (!input.sessionCamera) {
    throw new Error(SPATIAL_SESSIONLESS_ERROR)
  }
  const { project, locationId } = input
  const { location, surface, frame } = resolveSpatialSurface(project, locationId)

  const composition = composeSpatialEditorLocation({ project, locationId })
  const layers = composition.entries.map((entry) => layerView(
    project.id,
    surface.id,
    entry.item,
    entry.source as SpatialEditorLayerScope,
    entry.applicable,
    entry.globalPlane,
    entry.stackOrder,
  ))

  const view = deepFreeze({
    projectId: project.id,
    revision: project.revision,
    locationId,
    surfaceId: surface.id,
    surfaceTitle: surface.title,
    backgroundColor: resolveCourseSurfaceBackgroundColor(surface.backgroundColor),
    activeLocation: {
      locationId,
      surfaceId: surface.id,
      cameraFrameId: frame.id,
      label: location.label,
    },
    navigationLocations: project.locations.map((candidate) => ({
      locationId: candidate.id,
      label: candidate.label,
      kind: candidate.kind,
      surfaceId: candidate.surfaceId,
    })),
    camera: {
      home: { ...surface.camera.home },
      frames: surface.camera.frames.map((candidate) => ({ ...candidate })),
      activeFrameId: frame.id,
      activeFrame: { ...frame },
    },
    worldBounds: structuredClone(surface.world.bounds),
    worldGraph: {
      paths: (surface.world.paths ?? []).map((path) => ({
        pathId: path.id,
        path: structuredClone(path),
      })),
      relations: (surface.world.relations ?? []).map((relation) => ({
        relationId: relation.id,
        relation: structuredClone(relation),
      })),
    },
    visibilityRules: structuredClone(surface.semanticZoom),
    sessionCamera: copySpatialSessionCamera(input.sessionCamera),
    layers,
  })
  assertActiveSpatialEditorView(view)
  return view
}

export function assertActiveSpatialEditorView(view: SpatialEditorView): void {
  if (
    !view.projectId
    || !view.locationId
    || !view.surfaceId
    || !view.camera.activeFrameId
    || !view.sessionCamera
    || view.activeLocation.locationId !== view.locationId
    || view.activeLocation.surfaceId !== view.surfaceId
    || view.activeLocation.cameraFrameId !== view.camera.activeFrameId
  ) {
    throw new Error(SPATIAL_SESSIONLESS_ERROR)
  }
}

export function spatialEditorStableTargets(
  view: SpatialEditorView,
): readonly SpatialEditorStableTarget[] {
  return view.layers.map((layer) => ({
    layerItemId: layer.selectionId,
    authoringAddress: layer.authoringAddress,
    coordinateSpace: layer.coordinateSpace,
    owner: layer.owner,
  }))
}

export function spatialEntityAuthoringAddress(input: {
  readonly projectId: string
  readonly surfaceId: string
  readonly entityKind: Exclude<SpatialEditorAuthoringTargetInput['kind'], 'layer'>
  readonly itemId: string
  readonly field: string
}): string {
  return makeAuthoringAddress({
    projectId: input.projectId,
    scope: 'surface',
    surfaceId: input.surfaceId,
    carrier: 'native',
    // Spatial graph/camera/world IDs live in separate schema namespaces. Keep
    // that discriminator in the address so valid cross-kind ID collisions do
    // not become the same authoring target.
    layerItemId: `@spatial:${input.entityKind}:${input.itemId}`,
    field: input.field,
  })
}

export function spatialPathAuthoringAddress(
  projectId: string,
  surfaceId: string,
  pathId: string,
  field = 'world.paths',
): string {
  return spatialEntityAuthoringAddress({
    projectId,
    surfaceId,
    entityKind: 'path',
    itemId: pathId,
    field,
  })
}

export function spatialCameraFrameAuthoringAddress(
  projectId: string,
  surfaceId: string,
  frameId: string,
  field = 'camera.frames',
): string {
  return spatialEntityAuthoringAddress({
    projectId,
    surfaceId,
    entityKind: 'camera-frame',
    itemId: frameId,
    field,
  })
}

export function spatialRelationAuthoringAddress(
  projectId: string,
  surfaceId: string,
  relationId: string,
  field = 'world.relations',
): string {
  return spatialEntityAuthoringAddress({
    projectId,
    surfaceId,
    entityKind: 'relation',
    itemId: relationId,
    field,
  })
}

export function spatialSemanticZoomAuthoringAddress(
  projectId: string,
  surfaceId: string,
  ruleId: string,
  field = 'semanticZoom',
): string {
  return spatialEntityAuthoringAddress({
    projectId,
    surfaceId,
    entityKind: 'semantic-rule',
    itemId: ruleId,
    field,
  })
}

/**
 * Captures the exact Spatial entity shown by one immutable editor view.
 * Camera/path/relation/semantic entities are world-owned but intentionally do
 * not masquerade as LayerItems or use temporary hit identities.
 */
export function captureSpatialEditorAuthoringTarget(input: {
  readonly view: SpatialEditorView
  readonly sessionToken: CourseAuthoringSessionToken
  readonly target: SpatialEditorAuthoringTargetInput
}): CourseAuthoringTarget {
  const { view, sessionToken, target } = input
  if (
    sessionToken.surfaceType !== 'spatial-2d'
    || sessionToken.locationId !== view.locationId
    || sessionToken.revision !== view.revision
  ) {
    throw new Error(SPATIAL_SESSIONLESS_ERROR)
  }

  if (target.kind === 'layer') {
    const layer = view.layers.find((candidate) => candidate.selectionId === target.layerItemId)
    if (!layer) throw new Error(`找不到 Spatial 图层：${target.layerItemId}`)
    return captureCourseAuthoringTarget({
      sessionToken,
      projectId: view.projectId,
      surfaceId: view.surfaceId,
      stateId: null,
      owner: layer.owner,
      ownerKey: layer.ownerKey,
      itemId: layer.selectionId,
      authoringAddress: spatialLayerAuthoringAddress(view, layer, target.field),
    })
  }

  let itemId = view.surfaceId
  let owner: SpatialEditorLayerOwner = target.kind === 'surface' ? 'surface' : 'world'
  let field = target.field ?? (
    target.kind === 'camera-frame' ? 'camera.frames'
      : target.kind === 'path' ? 'world.paths'
        : target.kind === 'relation' ? 'world.relations'
          : target.kind === 'semantic-rule' ? 'semanticZoom'
            : 'item'
  )

  if (target.kind === 'camera-frame') {
    const frame = view.camera.frames.find((candidate) => candidate.id === target.frameId)
    if (!frame) throw new Error(`找不到 Spatial 镜头：${target.frameId}`)
    itemId = frame.id
  } else if (target.kind === 'path') {
    const path = view.worldGraph.paths.find((candidate) => candidate.pathId === target.pathId)
    if (!path) throw new Error(`找不到 Spatial 路径：${target.pathId}`)
    itemId = path.pathId
  } else if (target.kind === 'relation') {
    const relation = view.worldGraph.relations.find(
      (candidate) => candidate.relationId === target.relationId,
    )
    if (!relation) throw new Error(`找不到 Spatial 关系：${target.relationId}`)
    itemId = relation.relationId
  } else if (target.kind === 'semantic-rule') {
    const rule = view.visibilityRules.find((candidate) => candidate.id === target.ruleId)
    if (!rule) throw new Error(`找不到 Spatial 语义缩放规则：${target.ruleId}`)
    itemId = rule.id
  } else if (target.kind === 'surface') {
    field = target.field ?? 'surface'
    owner = 'surface'
  } else {
    field = target.field ?? 'world'
  }

  const address = target.kind === 'camera-frame'
    ? spatialCameraFrameAuthoringAddress(view.projectId, view.surfaceId, itemId, field)
    : target.kind === 'path'
      ? spatialPathAuthoringAddress(view.projectId, view.surfaceId, itemId, field)
      : target.kind === 'relation'
        ? spatialRelationAuthoringAddress(view.projectId, view.surfaceId, itemId, field)
        : target.kind === 'semantic-rule'
          ? spatialSemanticZoomAuthoringAddress(view.projectId, view.surfaceId, itemId, field)
          : spatialEntityAuthoringAddress({
              projectId: view.projectId,
              surfaceId: view.surfaceId,
              entityKind: target.kind,
              itemId,
              field,
            })

  return captureCourseAuthoringTarget({
    sessionToken,
    projectId: view.projectId,
    surfaceId: view.surfaceId,
    stateId: null,
    owner,
    ownerKey: ownerKeyFor(owner, view.surfaceId, null),
    itemId,
    authoringAddress: address,
  })
}

export function spatialEditorWorldLayerItems(
  view: SpatialEditorView,
): readonly DeepReadonly<LayerItem>[] {
  return view.layers
    .filter((layer) => layer.source === 'world')
    .map((layer) => layer.item)
}

export function spatialNativeLayerItem(
  view: SpatialEditorView,
  layerItemId: string,
  nativeType?: NativeLayerItem['content']['nativeType'],
): DeepReadonly<NativeLayerItem> | null {
  const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer || layer.item.kind !== 'native') return null
  if (nativeType && layer.item.content.nativeType !== nativeType) return null
  return layer.item as DeepReadonly<NativeLayerItem>
}

function spatialLayerCarrier(item: DeepReadonly<LayerItem> | LayerItem): AuthoringCarrier {
  if (item.kind === 'runtime') return 'runtime'
  if (item.kind === 'component') return 'component'
  return 'native'
}

function defaultSpatialAuthoringField(item: DeepReadonly<LayerItem> | LayerItem): string {
  if (item.kind === 'native' && item.content.nativeType === 'text') return 'content.data.text'
  if (item.kind === 'native' && item.content.nativeType === 'formula') return 'content.data'
  if (
    item.kind === 'native' &&
    (item.content.nativeType === 'image' || item.content.nativeType === 'video')
  ) {
    return 'content.data.assetId'
  }
  return 'item'
}

/**
 * World items use authoring `surface` scope because `makeAuthoringAddress`
 * has no `world` scope. Coordinate space remains `world`.
 */
export function spatialLayerAuthoringAddress(
  view: SpatialEditorView,
  layer: SpatialEditorLayerView,
  field?: string,
): string {
  const resolvedField = field ?? defaultSpatialAuthoringField(layer.item)
  if (resolvedField === defaultSpatialAuthoringField(layer.item)) {
    return layer.authoringAddress
  }
  return makeAuthoringAddress({
    projectId: view.projectId,
    scope: layer.source === 'global' ? 'global' : 'surface',
    surfaceId: layer.source === 'global' ? undefined : view.surfaceId,
    carrier: spatialLayerCarrier(layer.item),
    layerItemId: layer.selectionId,
    field: resolvedField,
  })
}

function copyViewport(viewport: StageRect): StageRect {
  if (![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite)) {
    throw new TypeError('viewport must be finite')
  }
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new RangeError('viewport dimensions must be greater than zero')
  }
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  }
}

export function copySpatialSessionCamera(camera: SpatialSessionCamera): SpatialSessionCamera {
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) {
    throw new Error('会话相机位置必须是有效数字')
  }
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0 || camera.zoom > 1_000) {
    throw new Error('会话相机缩放必须大于 0 且不超过 1000')
  }
  return Object.freeze({ x: camera.x, y: camera.y, zoom: camera.zoom })
}

export function spatialSessionCameraFromPose(pose: SpatialCameraPose): SpatialSessionCamera {
  return copySpatialSessionCamera({ x: pose.x, y: pose.y, zoom: pose.zoom })
}

/**
 * Spatial world view: sessionCamera *is* the view inside `viewport`.
 * Editor chrome letterboxes a 1280×720 hole and should pass that logical
 * viewport; this helper does not apply a second page-fit on the camera.
 */
export function createSpatialWorldViewTransform(
  viewport: StageRect,
  sessionCamera: SpatialSessionCamera,
): StageViewportTransform {
  const view = copyViewport(viewport)
  const camera = copySpatialSessionCamera(sessionCamera)
  const scale = camera.zoom
  return {
    viewport: view,
    zoom: camera.zoom,
    pan: { x: 0, y: 0 },
    fitScale: 1,
    scale,
    stageRect: {
      x: view.x + view.width / 2 - camera.x * scale,
      y: view.y + view.height / 2 - camera.y * scale,
      width: view.width,
      height: view.height,
    },
  }
}

/**
 * Viewport/global overlay matrix. Controllers and other HUD items use the R2
 * stage transform (1280×720 canonical stage), never the world session camera.
 */
export function createSpatialViewportOverlayTransform(
  viewport: StageRect,
  options: { zoom?: number; pan?: StagePoint } = {},
): StageViewportTransform {
  return createStageViewportTransform({
    viewport,
    zoom: options.zoom,
    pan: options.pan,
  })
}

export function spatialWorldPointerDeltaToWorld(
  sessionCamera: SpatialSessionCamera,
  cssDelta: StagePoint,
): StagePoint {
  const camera = copySpatialSessionCamera(sessionCamera)
  return {
    x: cssDelta.x / camera.zoom,
    y: cssDelta.y / camera.zoom,
  }
}
